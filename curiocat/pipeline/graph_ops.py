"""Interactive graph operations: Expand, Trace Back, Challenge.

Each operation modifies the project's causal graph by adding new nodes/edges
or updating evidence, then persists changes to the database.
"""

from __future__ import annotations

import logging
import uuid
from typing import Any

import networkx as nx
import numpy as np
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from curiocat.db.models import CausalEdge, Claim, Evidence
from curiocat.evidence.web_search import BraveSearchClient
from curiocat.llm.client import LLMClient
from curiocat.llm.embeddings import EmbeddingService
from curiocat.llm.prompts import language_instruction
from curiocat.llm.prompts.graph_operations import (
    CONVERGENCE_CONFIRM_SCHEMA,
    CONVERGENCE_CONFIRM_SYSTEM,
    EXPAND_SCHEMA,
    EXPAND_SYSTEM,
    TRACE_BACK_SCHEMA,
    TRACE_BACK_SYSTEM,
)
from curiocat.pipeline.evidence_grounder import EvidenceGrounder

logger = logging.getLogger(__name__)

_CONVERGENCE_THRESHOLD = 0.85


def _cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
    """Compute cosine similarity between two vectors."""
    norm_a = np.linalg.norm(a)
    norm_b = np.linalg.norm(b)
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return float(np.dot(a, b) / (norm_a * norm_b))


class GraphOperations:
    """Service for interactive graph mutations.

    Provides expand, trace_back, and challenge operations that modify
    a project's causal graph via LLM generation and embedding-based
    convergence detection.
    """

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

    async def expand(
        self,
        project_id: uuid.UUID,
        node_id: uuid.UUID,
        *,
        user_reasoning: str | None = None,
    ) -> dict[str, list[Any]]:
        """Generate consequences for a node and add them to the graph.

        1. Load source claim + neighbor context
        2. LLM generates 3-5 consequences
        3. Embed new claims
        4. Convergence detection: cosine > 0.85 + LLM confirm → converge
        5. Persist new claims and edges

        Returns:
            ``{"new_nodes": [...], "new_edges": [...], "converged_edges": [...]}``
        """
        source_claim = await self._session.get(Claim, node_id)
        if source_claim is None:
            raise ValueError(f"Claim {node_id} not found")

        # Build context from neighbors
        context = await self._build_context(project_id, node_id)

        user_prompt = (
            f"SOURCE CLAIM: {source_claim.text}\n\n"
            f"CONTEXT (existing claims in the graph):\n{context}\n\n"
            f"Generate 3-5 direct consequences of the source claim."
        )
        if user_reasoning:
            user_prompt += f"\n\nUSER'S REASONING/QUESTION:\n{user_reasoning}\n"
        user_prompt += language_instruction(source_claim.text)

        result = await self._llm.complete_json(
            system=EXPAND_SYSTEM, user=user_prompt, schema=EXPAND_SCHEMA
        )
        consequences = result.get("consequences", [])
        if not consequences:
            return {"new_nodes": [], "new_edges": [], "converged_edges": []}

        # Embed new claims
        texts = [c["text"] for c in consequences]
        embeddings = await self._embedder.embed_batch(texts)

        # Load all existing claim embeddings for convergence detection
        existing_claims = await self._load_project_claims(project_id)

        # Get next order_index
        max_order = max((c.order_index for c in existing_claims), default=-1)

        new_nodes: list[Claim] = []
        new_edges: list[CausalEdge] = []
        converged_edges: list[CausalEdge] = []

        for i, consequence in enumerate(consequences):
            embedding = embeddings[i]
            converge_target = await self._check_convergence(
                embedding, existing_claims
            )

            if converge_target is not None:
                # Check if this edge would create a cycle
                if await self._would_create_cycle(
                    project_id, source_claim.id, converge_target.id
                ):
                    logger.warning(
                        "Skipping converged edge %s -> %s: would create cycle",
                        source_claim.id,
                        converge_target.id,
                    )
                    continue

                # Create edge to existing node (convergence)
                edge = CausalEdge(
                    project_id=project_id,
                    source_claim_id=source_claim.id,
                    target_claim_id=converge_target.id,
                    mechanism=consequence.get("mechanism", ""),
                    strength=consequence.get("strength", 0.5),
                    time_delay=consequence.get("time_delay"),
                    conditions=consequence.get("conditions"),
                    reversible=False,
                    evidence_score=0.5,
                    causal_type=consequence.get("causal_type", "direct"),
                    condition_type=consequence.get("condition_type", "contributing"),
                )
                self._session.add(edge)
                converged_edges.append(edge)
            else:
                # Create new claim node
                max_order += 1
                new_claim = Claim(
                    project_id=project_id,
                    text=consequence["text"],
                    claim_type=consequence.get("type", "PREDICTION"),
                    confidence=consequence.get("confidence", 0.5),
                    embedding=embedding,
                    order_index=max_order,
                )
                self._session.add(new_claim)
                await self._session.flush()  # Get the ID

                # Create edge: source -> new claim
                edge = CausalEdge(
                    project_id=project_id,
                    source_claim_id=source_claim.id,
                    target_claim_id=new_claim.id,
                    mechanism=consequence.get("mechanism", ""),
                    strength=consequence.get("strength", 0.5),
                    time_delay=consequence.get("time_delay"),
                    conditions=consequence.get("conditions"),
                    reversible=False,
                    evidence_score=0.5,
                    causal_type=consequence.get("causal_type", "direct"),
                    condition_type=consequence.get("condition_type", "contributing"),
                )
                self._session.add(edge)
                new_nodes.append(new_claim)
                new_edges.append(edge)

        await self._session.commit()

        return {
            "new_nodes": new_nodes,
            "new_edges": new_edges,
            "converged_edges": converged_edges,
        }

    async def trace_back(
        self,
        project_id: uuid.UUID,
        node_id: uuid.UUID,
        *,
        user_reasoning: str | None = None,
    ) -> dict[str, list[Any]]:
        """Generate causes for a node and add them to the graph.

        Same logic as expand but edges go new_cause → target_node.
        """
        target_claim = await self._session.get(Claim, node_id)
        if target_claim is None:
            raise ValueError(f"Claim {node_id} not found")

        context = await self._build_context(project_id, node_id)

        user_prompt = (
            f"TARGET CLAIM: {target_claim.text}\n\n"
            f"CONTEXT (existing claims in the graph):\n{context}\n\n"
            f"Generate 3-5 direct causes of the target claim."
        )
        if user_reasoning:
            user_prompt += f"\n\nUSER'S REASONING/QUESTION:\n{user_reasoning}\n"
        user_prompt += language_instruction(target_claim.text)

        result = await self._llm.complete_json(
            system=TRACE_BACK_SYSTEM, user=user_prompt, schema=TRACE_BACK_SCHEMA
        )
        causes = result.get("causes", [])
        if not causes:
            return {"new_nodes": [], "new_edges": [], "converged_edges": []}

        texts = [c["text"] for c in causes]
        embeddings = await self._embedder.embed_batch(texts)

        existing_claims = await self._load_project_claims(project_id)
        max_order = max((c.order_index for c in existing_claims), default=-1)

        new_nodes: list[Claim] = []
        new_edges: list[CausalEdge] = []
        converged_edges: list[CausalEdge] = []

        for i, cause in enumerate(causes):
            embedding = embeddings[i]
            converge_target = await self._check_convergence(
                embedding, existing_claims
            )

            if converge_target is not None:
                # Check if this edge would create a cycle
                if await self._would_create_cycle(
                    project_id, converge_target.id, target_claim.id
                ):
                    logger.warning(
                        "Skipping converged edge %s -> %s: would create cycle",
                        converge_target.id,
                        target_claim.id,
                    )
                    continue

                # Edge from existing node to our target (convergence)
                edge = CausalEdge(
                    project_id=project_id,
                    source_claim_id=converge_target.id,
                    target_claim_id=target_claim.id,
                    mechanism=cause.get("mechanism", ""),
                    strength=cause.get("strength", 0.5),
                    time_delay=cause.get("time_delay"),
                    conditions=cause.get("conditions"),
                    reversible=False,
                    evidence_score=0.5,
                    causal_type=cause.get("causal_type", "direct"),
                    condition_type=cause.get("condition_type", "contributing"),
                )
                self._session.add(edge)
                converged_edges.append(edge)
            else:
                max_order += 1
                new_claim = Claim(
                    project_id=project_id,
                    text=cause["text"],
                    claim_type=cause.get("type", "PREDICTION"),
                    confidence=cause.get("confidence", 0.5),
                    embedding=embedding,
                    order_index=max_order,
                )
                self._session.add(new_claim)
                await self._session.flush()

                # Edge: new cause -> target
                edge = CausalEdge(
                    project_id=project_id,
                    source_claim_id=new_claim.id,
                    target_claim_id=target_claim.id,
                    mechanism=cause.get("mechanism", ""),
                    strength=cause.get("strength", 0.5),
                    time_delay=cause.get("time_delay"),
                    conditions=cause.get("conditions"),
                    reversible=False,
                    evidence_score=0.5,
                    causal_type=cause.get("causal_type", "direct"),
                    condition_type=cause.get("condition_type", "contributing"),
                )
                self._session.add(edge)
                new_nodes.append(new_claim)
                new_edges.append(edge)

        await self._session.commit()

        return {
            "new_nodes": new_nodes,
            "new_edges": new_edges,
            "converged_edges": converged_edges,
        }

    async def challenge(
        self,
        project_id: uuid.UUID,
        edge_id: uuid.UUID,
        *,
        user_reasoning: str | None = None,
    ) -> dict[str, Any]:
        """Challenge an edge by re-grounding it with fresh evidence.

        1. Load edge + source/target claims
        2. Search for new evidence via EvidenceGrounder
        3. Save new Evidence rows, update edge.evidence_score
        4. Run partial belief propagation from the edge
        5. Return updated evidence and belief changes

        Returns:
            ``{"edge_id": …, "new_evidence_score": …, "new_evidences": [...],
               "belief_changes": {…}}``
        """
        result = await self._session.execute(
            select(CausalEdge)
            .where(CausalEdge.id == edge_id)
            .options(selectinload(CausalEdge.evidences))
        )
        edge = result.scalars().first()
        if edge is None:
            raise ValueError(f"Edge {edge_id} not found")

        source_claim = await self._session.get(Claim, edge.source_claim_id)
        target_claim = await self._session.get(Claim, edge.target_claim_id)
        if source_claim is None or target_claim is None:
            raise ValueError("Source or target claim not found")

        if self._search is None:
            raise ValueError("Search client required for challenge operation")

        # Use EvidenceGrounder on this single edge
        grounder = EvidenceGrounder(self._llm, self._search)
        edge_dict: dict[str, Any] = {
            "source_idx": 0,
            "target_idx": 1,
            "mechanism": edge.mechanism,
            "strength": edge.strength,
            "evidence_score": edge.evidence_score,
        }
        claims_list = [
            {"text": source_claim.text},
            {"text": target_claim.text},
        ]
        if user_reasoning:
            edge_dict["user_reasoning"] = user_reasoning

        grounded = await grounder.ground(claims_list, [edge_dict])
        grounded_edge = grounded[0] if grounded else edge_dict

        # Save new evidence rows
        new_evidences: list[Evidence] = []
        for ev_data in grounded_edge.get("evidences", []):
            evidence = Evidence(
                edge_id=edge.id,
                evidence_type=ev_data.get("evidence_type", "supporting"),
                source_url=ev_data.get("source_url", ""),
                source_title=ev_data.get("source_title", ""),
                source_type=ev_data.get("source_type", "other"),
                snippet=ev_data.get("snippet", ""),
                relevance_score=ev_data.get("relevance_score", 0.0),
                credibility_score=ev_data.get("credibility_score", 0.0),
            )
            self._session.add(evidence)
            new_evidences.append(evidence)

        # Update edge evidence score
        new_score = grounded_edge.get("evidence_score", edge.evidence_score)
        edge.evidence_score = new_score

        await self._session.commit()

        # Run partial propagation
        from curiocat.graph.propagation import propagate_from_edge

        # We need the full nx graph for propagation
        from curiocat.api.routes.graph import _build_nx_graph, _load_project_graph
        from curiocat.graph.belief_propagation import propagate_beliefs

        _, claims, edges = await _load_project_graph(project_id, self._session)
        nx_graph = _build_nx_graph(claims, edges)
        propagate_beliefs(nx_graph)

        prop_result = propagate_from_edge(
            nx_graph,
            str(edge.source_claim_id),
            str(edge.target_claim_id),
            new_evidence_score=new_score,
        )

        return {
            "edge_id": edge.id,
            "new_evidence_score": new_score,
            "new_evidences": new_evidences,
            "belief_changes": prop_result.get("changes", {}),
        }

    # --- Private helpers ---

    async def _build_context(
        self, project_id: uuid.UUID, node_id: uuid.UUID
    ) -> str:
        """Build a context string from neighboring claims."""
        claims = await self._load_project_claims(project_id)
        edges_result = await self._session.execute(
            select(CausalEdge).where(CausalEdge.project_id == project_id)
        )
        edges = list(edges_result.scalars().all())

        node_str = str(node_id)
        neighbor_ids: set[str] = set()
        for e in edges:
            if str(e.source_claim_id) == node_str:
                neighbor_ids.add(str(e.target_claim_id))
            if str(e.target_claim_id) == node_str:
                neighbor_ids.add(str(e.source_claim_id))

        lines: list[str] = []
        for claim in claims:
            if str(claim.id) in neighbor_ids:
                lines.append(f"- [{claim.claim_type}] {claim.text}")

        return "\n".join(lines) if lines else "(no neighboring claims)"

    async def _load_project_claims(
        self, project_id: uuid.UUID
    ) -> list[Claim]:
        """Load all claims for a project."""
        result = await self._session.execute(
            select(Claim)
            .where(Claim.project_id == project_id)
            .order_by(Claim.order_index)
        )
        return list(result.scalars().all())

    async def _check_convergence(
        self, embedding: list[float], existing_claims: list[Claim]
    ) -> Claim | None:
        """Check if a new embedding converges with any existing claim.

        Uses cosine similarity > 0.85 threshold, then LLM confirmation.
        """
        new_vec = np.array(embedding)

        for claim in existing_claims:
            if claim.embedding is None:
                continue
            existing_vec = np.array(claim.embedding)
            sim = _cosine_similarity(new_vec, existing_vec)

            if sim >= _CONVERGENCE_THRESHOLD:
                # LLM confirmation
                try:
                    confirm = await self._llm.complete_json(
                        system=CONVERGENCE_CONFIRM_SYSTEM,
                        user=(
                            f"CLAIM A (new): [new claim being evaluated]\n"
                            f"CLAIM B (existing): {claim.text}\n\n"
                            f"Embedding cosine similarity: {sim:.3f}\n"
                            f"Are these the same claim?"
                        ),
                        schema=CONVERGENCE_CONFIRM_SCHEMA,
                    )
                    if confirm.get("is_same_claim", False):
                        logger.info(
                            "Convergence detected: new claim matches %s (sim=%.3f)",
                            claim.id,
                            sim,
                        )
                        return claim
                except Exception as exc:
                    logger.warning("Convergence confirmation failed: %s", exc)

        return None

    async def _would_create_cycle(
        self,
        project_id: uuid.UUID,
        source_id: uuid.UUID,
        target_id: uuid.UUID,
    ) -> bool:
        """Check if adding source→target would create a cycle.

        Builds a lightweight DiGraph from all project edges and checks
        whether a path already exists from target back to source.
        If so, adding source→target would close a cycle.
        """
        result = await self._session.execute(
            select(CausalEdge.source_claim_id, CausalEdge.target_claim_id)
            .where(CausalEdge.project_id == project_id)
        )
        edges = result.all()

        g = nx.DiGraph()
        for src, tgt in edges:
            g.add_edge(str(src), str(tgt))

        src_str = str(source_id)
        tgt_str = str(target_id)

        # If there's already a path target→source, adding source→target creates a cycle
        if g.has_node(tgt_str) and g.has_node(src_str):
            return nx.has_path(g, tgt_str, src_str)
        return False
