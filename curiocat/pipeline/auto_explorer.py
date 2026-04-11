"""Auto Explorer — identifies graph weaknesses and automatically strengthens them.

Analyzes the causal graph to find weak edges, leaf/root nodes, and
high-sensitivity-but-low-evidence areas, then runs the appropriate
operation (challenge, expand, trace_back) to fill the gaps.
"""

from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass, field
from typing import Any

import networkx as nx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from curiocat.db.models import CausalEdge, Claim
from curiocat.evidence.web_search import BraveSearchClient
from curiocat.llm.client import LLMClient
from curiocat.llm.embeddings import EmbeddingService
from curiocat.pipeline.graph_ops import GraphOperations

logger = logging.getLogger(__name__)

# Maximum operations per auto-explore run
_MAX_OPS_PER_RUN = 5

# Thresholds
_WEAK_EVIDENCE_THRESHOLD = 0.3
_LOW_CONFIDENCE_THRESHOLD = 0.7


@dataclass
class WeaknessItem:
    """A single weakness found in the graph."""

    node_id: uuid.UUID | None = None
    edge_id: uuid.UUID | None = None
    weakness_type: str = ""  # "weak_edge", "leaf", "root", "high_sensitivity"
    priority: float = 0.0  # Higher = address first
    action: str = ""  # "challenge", "expand", "trace_back"
    description: str = ""


@dataclass
class AutoExploreResult:
    """Result of an auto-explore run."""

    weaknesses_found: list[dict[str, Any]] = field(default_factory=list)
    new_nodes: list[Claim] = field(default_factory=list)
    new_edges: list[CausalEdge] = field(default_factory=list)
    converged_edges: list[CausalEdge] = field(default_factory=list)
    convergence_reached: bool = False


class AutoExplorer:
    """Automatically identifies and addresses graph weaknesses."""

    def __init__(
        self,
        session: AsyncSession,
        llm: LLMClient,
        embedder: EmbeddingService,
        search_client: BraveSearchClient | None = None,
    ) -> None:
        self._session = session
        self._llm = llm
        self._embedder = embedder
        self._search = search_client

    async def explore(
        self,
        project_id: uuid.UUID,
        *,
        max_new_nodes: int = 10,
    ) -> AutoExploreResult:
        """Analyze graph weaknesses and automatically strengthen them.

        1. Load graph and compute metrics (in/out degree, evidence scores)
        2. Identify weaknesses and rank by priority
        3. Execute operations (challenge, expand, trace_back) until budget exhausted
        4. Return results with weakness report

        Args:
            project_id: The project to explore.
            max_new_nodes: Hard cap on new nodes to add.

        Returns:
            AutoExploreResult with weakness reports and new graph data.
        """
        result = AutoExploreResult()

        # 1. Load claims and edges
        claims = await self._load_claims(project_id)
        edges = await self._load_edges(project_id)

        if not claims:
            return result

        # 2. Build graph and identify weaknesses
        g = self._build_graph(claims, edges)
        weaknesses = self._identify_weaknesses(g, claims, edges)

        if not weaknesses:
            result.convergence_reached = True
            return result

        # Sort by priority descending
        weaknesses.sort(key=lambda w: w.priority, reverse=True)

        logger.info(
            "Auto-explore: found %d weaknesses for project %s",
            len(weaknesses), project_id,
        )

        # 3. Execute operations within budget
        ops = GraphOperations(
            self._session, self._llm, self._embedder, self._search
        )
        nodes_added = 0
        ops_executed = 0
        duplicates = 0
        total_generated = 0

        for weakness in weaknesses:
            if ops_executed >= _MAX_OPS_PER_RUN:
                break
            if nodes_added >= max_new_nodes:
                break

            report = {
                "node_id": str(weakness.node_id) if weakness.node_id else None,
                "edge_id": str(weakness.edge_id) if weakness.edge_id else None,
                "weakness_type": weakness.weakness_type,
                "action_taken": weakness.action,
                "result_summary": "",
            }

            try:
                if weakness.action == "challenge" and weakness.edge_id:
                    op_result = await ops.challenge(
                        project_id, weakness.edge_id
                    )
                    new_score = op_result.get("new_evidence_score", 0)
                    n_evidences = len(op_result.get("new_evidences", []))
                    report["result_summary"] = (
                        f"Found {n_evidences} new evidence(s), "
                        f"score updated to {new_score:.2f}"
                    )

                elif weakness.action == "expand" and weakness.node_id:
                    op_result = await ops.expand(project_id, weakness.node_id)
                    new_nodes = op_result.get("new_nodes", [])
                    converged = op_result.get("converged_edges", [])
                    result.new_nodes.extend(new_nodes)
                    result.new_edges.extend(op_result.get("new_edges", []))
                    result.converged_edges.extend(converged)
                    nodes_added += len(new_nodes)
                    total_generated += len(new_nodes) + len(converged)
                    duplicates += len(converged)
                    report["result_summary"] = (
                        f"Added {len(new_nodes)} node(s), "
                        f"{len(converged)} converged"
                    )

                elif weakness.action == "trace_back" and weakness.node_id:
                    op_result = await ops.trace_back(
                        project_id, weakness.node_id
                    )
                    new_nodes = op_result.get("new_nodes", [])
                    converged = op_result.get("converged_edges", [])
                    result.new_nodes.extend(new_nodes)
                    result.new_edges.extend(op_result.get("new_edges", []))
                    result.converged_edges.extend(converged)
                    nodes_added += len(new_nodes)
                    total_generated += len(new_nodes) + len(converged)
                    duplicates += len(converged)
                    report["result_summary"] = (
                        f"Added {len(new_nodes)} node(s), "
                        f"{len(converged)} converged"
                    )

                else:
                    report["action_taken"] = "skipped"
                    report["result_summary"] = "No valid target for action"

            except Exception as exc:
                logger.warning(
                    "Auto-explore op failed (%s on %s): %s",
                    weakness.action,
                    weakness.node_id or weakness.edge_id,
                    exc,
                )
                report["action_taken"] = "failed"
                report["result_summary"] = str(exc)

            result.weaknesses_found.append(report)
            ops_executed += 1

            # Convergence check: if >50% of generated claims were duplicates
            if total_generated >= 4 and duplicates / total_generated > 0.5:
                logger.info(
                    "Auto-explore: convergence reached "
                    "(%d/%d duplicates), stopping early",
                    duplicates, total_generated,
                )
                result.convergence_reached = True
                break

        # Include remaining unaddressed weaknesses in report
        for weakness in weaknesses[ops_executed:]:
            result.weaknesses_found.append({
                "node_id": str(weakness.node_id) if weakness.node_id else None,
                "edge_id": str(weakness.edge_id) if weakness.edge_id else None,
                "weakness_type": weakness.weakness_type,
                "action_taken": "skipped",
                "result_summary": "Budget exhausted",
            })

        logger.info(
            "Auto-explore: executed %d ops, added %d nodes, %d converged",
            ops_executed, nodes_added, duplicates,
        )
        return result

    # --- Weakness identification ---

    def _identify_weaknesses(
        self,
        g: nx.DiGraph,
        claims: list[Claim],
        edges: list[CausalEdge],
    ) -> list[WeaknessItem]:
        """Analyze graph structure and return ranked weaknesses."""
        weaknesses: list[WeaknessItem] = []

        # Build lookup maps
        claim_map = {str(c.id): c for c in claims}
        edge_map = {str(e.id): e for e in edges}

        # Node-level metrics
        for node_id in g.nodes:
            in_deg = g.in_degree(node_id)
            out_deg = g.out_degree(node_id)
            sensitivity = g.nodes[node_id].get("sensitivity", 0) or 0
            confidence = g.nodes[node_id].get("confidence", 0.5)
            claim = claim_map.get(node_id)
            if claim is None:
                continue
            claim_uuid = claim.id

            # 1. High-sensitivity nodes with weak incoming evidence
            if sensitivity > 0.3 and in_deg > 0:
                incoming_edges = [
                    edge_map.get(g.edges[u, node_id].get("edge_id", ""))
                    for u in g.predecessors(node_id)
                ]
                avg_evidence = 0.0
                weak_edge_id = None
                for e in incoming_edges:
                    if e is not None:
                        avg_evidence += e.evidence_score
                        if e.evidence_score < _WEAK_EVIDENCE_THRESHOLD:
                            weak_edge_id = e.id
                if incoming_edges:
                    avg_evidence /= len(incoming_edges)

                if avg_evidence < _WEAK_EVIDENCE_THRESHOLD and weak_edge_id:
                    weaknesses.append(WeaknessItem(
                        edge_id=weak_edge_id,
                        weakness_type="high_sensitivity_weak_evidence",
                        priority=sensitivity * 2.0,  # High priority
                        action="challenge",
                        description=(
                            f"High-sensitivity node ({sensitivity:.2f}) "
                            f"with weak evidence ({avg_evidence:.2f})"
                        ),
                    ))

            # 2. Leaf nodes (no outgoing edges) — expand to discover consequences
            if out_deg == 0 and in_deg > 0:
                weaknesses.append(WeaknessItem(
                    node_id=claim_uuid,
                    weakness_type="leaf_node",
                    priority=0.5 + confidence * 0.3,
                    action="expand",
                    description=f"Leaf node with no downstream consequences",
                ))

            # 3. Root nodes with low confidence — trace back to find causes
            if in_deg == 0 and out_deg > 0 and confidence < _LOW_CONFIDENCE_THRESHOLD:
                weaknesses.append(WeaknessItem(
                    node_id=claim_uuid,
                    weakness_type="low_confidence_root",
                    priority=0.6 + (1.0 - confidence) * 0.4,
                    action="trace_back",
                    description=(
                        f"Root node with low confidence ({confidence:.2f})"
                    ),
                ))

        # 4. Weak edges (low evidence score)
        for edge in edges:
            if edge.evidence_score < _WEAK_EVIDENCE_THRESHOLD:
                # Check if it's on the critical path (higher priority)
                src = str(edge.source_claim_id)
                tgt = str(edge.target_claim_id)
                is_on_path = g.has_node(src) and g.has_node(tgt)

                # Avoid duplicate if already captured by high_sensitivity check
                already_flagged = any(
                    w.edge_id == edge.id for w in weaknesses
                )
                if already_flagged:
                    continue

                weaknesses.append(WeaknessItem(
                    edge_id=edge.id,
                    weakness_type="weak_edge",
                    priority=0.4 + edge.strength * 0.3,
                    action="challenge",
                    description=(
                        f"Edge with weak evidence ({edge.evidence_score:.2f})"
                    ),
                ))

        return weaknesses

    # --- Helpers ---

    async def _load_claims(self, project_id: uuid.UUID) -> list[Claim]:
        result = await self._session.execute(
            select(Claim)
            .where(Claim.project_id == project_id)
            .order_by(Claim.order_index)
        )
        return list(result.scalars().all())

    async def _load_edges(self, project_id: uuid.UUID) -> list[CausalEdge]:
        result = await self._session.execute(
            select(CausalEdge)
            .where(CausalEdge.project_id == project_id)
            .options(selectinload(CausalEdge.evidences))
        )
        return list(result.scalars().all())

    def _build_graph(
        self, claims: list[Claim], edges: list[CausalEdge]
    ) -> nx.DiGraph:
        """Build a lightweight nx graph for analysis."""
        g = nx.DiGraph()
        for c in claims:
            g.add_node(
                str(c.id),
                confidence=c.confidence,
                sensitivity=None,  # Populated externally if available
            )
        for e in edges:
            if getattr(e, "is_feedback", False):
                continue
            g.add_edge(
                str(e.source_claim_id),
                str(e.target_claim_id),
                edge_id=str(e.id),
                strength=e.strength,
                evidence_score=e.evidence_score,
            )
        return g
