"""Pipeline Orchestrator.

Runs the full 5-stage causal analysis pipeline, emitting progress events
and persisting results to the database at each stage.
"""

from __future__ import annotations

import logging
import uuid
from typing import Any, Callable, Coroutine

from sqlalchemy.ext.asyncio import AsyncSession

from curiocat.db.models import Claim, CausalEdge, Evidence, Project
from curiocat.evidence.web_search import BraveSearchClient
from curiocat.exceptions import PipelineError
from curiocat.graph.belief_propagation import propagate_beliefs
from curiocat.graph.critical_path import find_critical_path
from curiocat.graph.sensitivity import analyze_sensitivity
from curiocat.llm.client import LLMClient
from curiocat.llm.embeddings import EmbeddingService
from curiocat.pipeline.bias_auditor import BiasAuditor
from curiocat.pipeline.causal_inferrer import CausalInferrer
from curiocat.pipeline.claim_extractor import ClaimExtractor
from curiocat.pipeline.dag_builder import DAGBuilder
from curiocat.pipeline.discovery import DiscoveryEngine
from curiocat.pipeline.evidence_grounder import EvidenceGrounder

logger = logging.getLogger(__name__)

# Maximum new claims to keep per discovery layer (prevents combinatorial explosion)
_MAX_CLAIMS_PER_LAYER = 30

# Pipeline stage names
STAGE_CLAIM_EXTRACTION = "claim_extraction"
STAGE_CAUSAL_INFERENCE = "causal_inference"
STAGE_BIAS_AUDIT = "bias_audit"
STAGE_EVIDENCE_GROUNDING = "evidence_grounding"
STAGE_DISCOVERY = "discovery"
STAGE_DAG_CONSTRUCTION = "dag_construction"
STAGE_BELIEF_PROPAGATION = "belief_propagation"

# Event callback type alias
EventCallback = Callable[["PipelineEvent"], Coroutine[Any, Any, None]] | None


class PipelineEvent:
    """Event emitted during pipeline execution.

    Attributes:
        stage: The current pipeline stage name.
        status: One of "started", "progress", "completed", or "error".
        data: Stage-specific data (e.g., extracted claims, edges).
        progress: Completion fraction, 0.0 to 1.0.
    """

    def __init__(
        self,
        stage: str,
        status: str,
        data: Any = None,
        progress: float = 0.0,
        layer: int = 0,
    ) -> None:
        self.stage = stage
        self.status = status
        self.data = data
        self.progress = progress
        self.layer = layer

    def __repr__(self) -> str:
        return (
            f"PipelineEvent(stage={self.stage!r}, status={self.status!r}, "
            f"progress={self.progress:.2f}, layer={self.layer})"
        )


class CausalPipeline:
    """Orchestrates the full 5-stage causal chain reasoning pipeline.

    Stages:
    1. Claim Extraction: Decompose input text into atomic claims.
    2. Causal Inference: Identify causal links between claims.
    3. Evidence Grounding: Search for and score supporting/contradicting evidence.
    4. DAG Construction: Build a directed acyclic graph, break cycles.
    5. Belief Propagation: Propagate beliefs through the graph via Noisy-OR.

    After all stages, sensitivity analysis and critical path are computed.
    """

    def __init__(
        self,
        session: AsyncSession,
        llm_client: LLMClient,
        embedding_service: EmbeddingService,
        search_client: BraveSearchClient | None = None,
    ) -> None:
        self.session = session
        self.claim_extractor = ClaimExtractor(llm_client, embedding_service)
        self.causal_inferrer = CausalInferrer(llm_client)
        self.bias_auditor = BiasAuditor(llm_client)
        self.evidence_grounder = (
            EvidenceGrounder(llm_client, search_client)
            if search_client
            else None
        )
        self.discovery_engine = DiscoveryEngine(llm_client, embedding_service, search_client)
        self.dag_builder = DAGBuilder()

    async def run(
        self,
        project_id: str,
        text: str,
        event_callback: EventCallback = None,
        max_layers: int = 3,
    ) -> dict[str, Any]:
        """Run the full pipeline with multi-layer discovery.

        Layer 0 (Seed): Extract claims from user text, infer causal links,
        audit for biases, and ground with evidence.

        Layers 1..N (Discovery): Extract new claims from evidence snippets,
        run incremental causal inference on new claims, audit and ground.
        Stops when no new claims are discovered, diminishing returns
        (<2 new claims AND <1 new edge), or layer budget exhausted.

        Final: Build DAG, propagate beliefs, compute critical path and
        sensitivity analysis.

        Args:
            project_id: The UUID of the project to associate results with.
            text: The input text to analyze.
            event_callback: Optional async callable to receive PipelineEvents.
            max_layers: Maximum number of discovery layers (default 3).

        Returns:
            A dict containing claims, edges, graph, critical_path, sensitivity.

        Raises:
            PipelineError: If any pipeline stage fails.
        """
        project_uuid = uuid.UUID(project_id) if isinstance(project_id, str) else project_id

        try:
            # ==================================================================
            # Layer 0: Seed
            # ==================================================================

            # Stage 1: Claim Extraction
            await self._emit(
                PipelineEvent(STAGE_CLAIM_EXTRACTION, "started", progress=0.0, layer=0),
                event_callback,
            )

            claims, has_temporal = await self.claim_extractor.extract(text)

            # Persist temporal relevance flag on the project
            project = await self.session.get(Project, project_uuid)
            if project is not None:
                project.has_temporal = has_temporal
                await self.session.flush()

            # Tag seed claims as layer 0
            for c in claims:
                c["layer"] = 0

            await self._emit(
                PipelineEvent(
                    STAGE_CLAIM_EXTRACTION, "completed",
                    data={
                        "count": len(claims),
                        "claims": _lightweight_claims(claims),
                    },
                    progress=0.10, layer=0,
                ),
                event_callback,
            )

            if not claims:
                raise PipelineError("No claims were extracted from the input text")

            # Persist claims immediately after extraction
            claim_db_ids = await self._save_claims(project_uuid, claims)
            await self.session.commit()
            logger.info("Claims committed: %d", len(claims))

            # Stage 2: Causal Inference
            await self._emit(
                PipelineEvent(STAGE_CAUSAL_INFERENCE, "started", progress=0.10, layer=0),
                event_callback,
            )

            edges = await self.causal_inferrer.infer(claims)

            await self._emit(
                PipelineEvent(
                    STAGE_CAUSAL_INFERENCE, "completed",
                    data={
                        "count": len(edges),
                        "edges": _lightweight_edges(claims, edges),
                    },
                    progress=0.20, layer=0,
                ),
                event_callback,
            )

            # Persist edges immediately after inference
            edge_db_ids = await self._save_edges(project_uuid, edges, claim_db_ids)
            await self.session.commit()
            logger.info("Edges committed: %d", len(edges))

            # Stage 2.5: Bias Audit
            await self._emit(
                PipelineEvent(STAGE_BIAS_AUDIT, "started", progress=0.20, layer=0),
                event_callback,
            )

            edges = await self.bias_auditor.audit(claims, edges)

            await self._emit(
                PipelineEvent(
                    STAGE_BIAS_AUDIT, "completed",
                    data={
                        "edges_audited": len(edges),
                        "edges": _lightweight_edges(claims, edges),
                    },
                    progress=0.30, layer=0,
                ),
                event_callback,
            )

            # Update edges in DB with bias audit results
            await self._update_edges(edge_db_ids, edges)
            await self.session.commit()
            logger.info("Bias audit committed for %d edges", len(edges))

            # Stage 3: Evidence Grounding
            if self.evidence_grounder and edges:
                await self._emit(
                    PipelineEvent(STAGE_EVIDENCE_GROUNDING, "started", progress=0.30, layer=0),
                    event_callback,
                )

                async def _evidence_progress_l0(completed: int, total: int, edge: dict[str, Any]) -> None:
                    frac = completed / total
                    await self._emit(
                        PipelineEvent(
                            STAGE_EVIDENCE_GROUNDING, "progress",
                            data={
                                "completed": completed,
                                "total": total,
                                "edge": _lightweight_edge(edge, claims),
                            },
                            progress=0.30 + frac * 0.10,  # 0.30 → 0.40
                            layer=0,
                        ),
                        event_callback,
                    )

                edges = await self.evidence_grounder.ground(claims, edges, on_progress=_evidence_progress_l0)

                await self._emit(
                    PipelineEvent(
                        STAGE_EVIDENCE_GROUNDING, "completed",
                        data={
                            "edges_grounded": len(edges),
                            "edges": _lightweight_edges(claims, edges),
                        },
                        progress=0.40, layer=0,
                    ),
                    event_callback,
                )

                # Update edges with evidence scores and save evidence records
                await self._update_edges(edge_db_ids, edges)
                await self._save_evidences(edges, edge_db_ids)
                await self.session.commit()
                logger.info("Evidence grounding committed for %d edges", len(edges))
            else:
                logger.info("Skipping evidence grounding (no search client or no edges)")
                await self._emit(
                    PipelineEvent(
                        STAGE_EVIDENCE_GROUNDING, "completed",
                        data={"skipped": True},
                        progress=0.40, layer=0,
                    ),
                    event_callback,
                )

            # ==================================================================
            # Layers 1..N: Discovery
            # ==================================================================
            # Discovery layers share progress range 0.40 -> 0.70
            discovery_progress_range = 0.30  # 0.40 to 0.70
            progress_per_layer = discovery_progress_range / max_layers if max_layers > 0 else 0

            for layer in range(1, max_layers + 1):
                layer_start = 0.40 + (layer - 1) * progress_per_layer
                layer_end = 0.40 + layer * progress_per_layer

                # Discovery stage
                await self._emit(
                    PipelineEvent(
                        STAGE_DISCOVERY, "started",
                        progress=layer_start, layer=layer,
                    ),
                    event_callback,
                )

                new_claims = await self.discovery_engine.discover(claims, edges)

                if len(new_claims) < 1:
                    logger.info("Discovery layer %d: no new claims, converging", layer)
                    await self._emit(
                        PipelineEvent(
                            STAGE_DISCOVERY, "completed",
                            data={"new_claims": 0, "converged": True},
                            progress=layer_end, layer=layer,
                        ),
                        event_callback,
                    )
                    break

                # Cap claims per layer to prevent combinatorial explosion
                if len(new_claims) > _MAX_CLAIMS_PER_LAYER:
                    # Keep highest-confidence claims
                    new_claims.sort(
                        key=lambda c: c.get("confidence", 0.5), reverse=True
                    )
                    new_claims = new_claims[:_MAX_CLAIMS_PER_LAYER]
                    logger.info(
                        "Discovery layer %d: capped to %d claims (from more)",
                        layer, _MAX_CLAIMS_PER_LAYER,
                    )

                # Tag new claims with layer number and assign order indices
                new_start_idx = len(claims)
                for i, c in enumerate(new_claims):
                    c["layer"] = layer
                    c["order_index"] = new_start_idx + i

                claims.extend(new_claims)
                new_indices = set(range(new_start_idx, len(claims)))

                logger.info(
                    "Discovery layer %d: found %d new claims",
                    layer, len(new_claims),
                )

                await self._emit(
                    PipelineEvent(
                        STAGE_DISCOVERY, "completed",
                        data={
                            "new_claims": len(new_claims),
                            "claims": _lightweight_claims(new_claims, start_index=new_start_idx),
                        },
                        progress=layer_start + progress_per_layer * 0.25, layer=layer,
                    ),
                    event_callback,
                )

                # Persist discovered claims immediately
                new_claim_db_ids = await self._save_claims(project_uuid, new_claims)
                claim_db_ids.extend(new_claim_db_ids)
                await self.session.commit()

                # Incremental causal inference
                await self._emit(
                    PipelineEvent(
                        STAGE_CAUSAL_INFERENCE, "started",
                        progress=layer_start + progress_per_layer * 0.25, layer=layer,
                    ),
                    event_callback,
                )

                new_edges = await self.causal_inferrer.infer_incremental(claims, new_indices)

                await self._emit(
                    PipelineEvent(
                        STAGE_CAUSAL_INFERENCE, "completed",
                        data={
                            "count": len(new_edges),
                            "edges": _lightweight_edges(claims, new_edges),
                        },
                        progress=layer_start + progress_per_layer * 0.5, layer=layer,
                    ),
                    event_callback,
                )

                # Persist new edges immediately
                new_edge_db_ids = await self._save_edges(
                    project_uuid, new_edges, claim_db_ids,
                )
                edge_db_ids.extend(new_edge_db_ids)
                await self.session.commit()

                # Bias audit on new edges
                if new_edges:
                    await self._emit(
                        PipelineEvent(
                            STAGE_BIAS_AUDIT, "started",
                            progress=layer_start + progress_per_layer * 0.5, layer=layer,
                        ),
                        event_callback,
                    )

                    new_edges = await self.bias_auditor.audit(claims, new_edges)

                    await self._emit(
                        PipelineEvent(
                            STAGE_BIAS_AUDIT, "completed",
                            data={
                                "edges_audited": len(new_edges),
                                "edges": _lightweight_edges(claims, new_edges),
                            },
                            progress=layer_start + progress_per_layer * 0.75, layer=layer,
                        ),
                        event_callback,
                    )

                    # Update edges in DB with bias results
                    await self._update_edges(new_edge_db_ids, new_edges)
                    await self.session.commit()

                # Evidence grounding on new edges
                if self.evidence_grounder and new_edges:
                    ev_start = layer_start + progress_per_layer * 0.75

                    await self._emit(
                        PipelineEvent(
                            STAGE_EVIDENCE_GROUNDING, "started",
                            progress=ev_start, layer=layer,
                        ),
                        event_callback,
                    )

                    async def _evidence_progress_ln(completed: int, total: int, edge: dict[str, Any]) -> None:
                        frac = completed / total
                        await self._emit(
                            PipelineEvent(
                                STAGE_EVIDENCE_GROUNDING, "progress",
                                data={
                                    "completed": completed,
                                    "total": total,
                                    "edge": _lightweight_edge(edge, claims),
                                },
                                progress=ev_start + frac * (layer_end - ev_start),
                                layer=layer,
                            ),
                            event_callback,
                        )

                    new_edges = await self.evidence_grounder.ground(
                        claims, new_edges, on_progress=_evidence_progress_ln,
                    )

                    await self._emit(
                        PipelineEvent(
                            STAGE_EVIDENCE_GROUNDING, "completed",
                            data={
                                "edges_grounded": len(new_edges),
                                "edges": _lightweight_edges(claims, new_edges),
                            },
                            progress=layer_end, layer=layer,
                        ),
                        event_callback,
                    )

                    # Update edges with evidence + save evidence records
                    await self._update_edges(new_edge_db_ids, new_edges)
                    await self._save_evidences(new_edges, new_edge_db_ids)
                    await self.session.commit()

                edges.extend(new_edges)
                logger.info(
                    "Layer %d fully committed: %d claims, %d edges",
                    layer, len(new_claims), len(new_edges),
                )

                # Convergence check
                if len(new_claims) < 2 and len(new_edges) < 1:
                    logger.info(
                        "Discovery layer %d: diminishing returns, converging", layer,
                    )
                    break

            # ==================================================================
            # Final: DAG Construction
            # ==================================================================
            await self._emit(
                PipelineEvent(STAGE_DAG_CONSTRUCTION, "started", progress=0.70),
                event_callback,
            )

            graph, logic_gate_map = self.dag_builder.build(claims, edges)

            await self._update_claim_logic_gates(
                claim_db_ids, claims, logic_gate_map
            )
            await self.session.commit()
            logger.info("DAG construction committed: logic gates updated")

            await self._emit(
                PipelineEvent(
                    STAGE_DAG_CONSTRUCTION, "completed",
                    data={
                        "nodes": graph.number_of_nodes(),
                        "edges": graph.number_of_edges(),
                    },
                    progress=0.85,
                ),
                event_callback,
            )

            # ==================================================================
            # Final: Belief Propagation + Analysis
            # ==================================================================
            await self._emit(
                PipelineEvent(STAGE_BELIEF_PROPAGATION, "started", progress=0.85),
                event_callback,
            )

            graph = propagate_beliefs(graph)
            critical_path = find_critical_path(graph)
            sensitivity = analyze_sensitivity(graph)

            await self._emit(
                PipelineEvent(
                    STAGE_BELIEF_PROPAGATION, "completed",
                    data={"critical_path_length": len(critical_path)},
                    progress=1.0,
                ),
                event_callback,
            )

            # Update project status and commit
            await self._update_project_status(project_uuid, "completed")
            await self.session.commit()

            logger.info(
                "Pipeline completed for project %s: %d claims, %d edges",
                project_id, len(claims), len(edges),
            )

            return {
                "claims": claims,
                "edges": edges,
                "graph": graph,
                "critical_path": critical_path,
                "sensitivity": sensitivity,
            }

        except PipelineError:
            await self._update_project_status(project_uuid, "failed")
            await self.session.commit()
            raise
        except Exception as exc:
            await self._update_project_status(project_uuid, "failed")
            await self.session.commit()
            await self._emit(
                PipelineEvent("pipeline", "error", data={"error": str(exc)}),
                event_callback,
            )
            raise PipelineError(f"Pipeline failed: {exc}") from exc

    async def _emit(
        self,
        event: PipelineEvent,
        callback: EventCallback,
    ) -> None:
        """Emit a pipeline event via the callback, if provided."""
        logger.debug("Pipeline event: %s", event)
        if callback is not None:
            await callback(event)

    async def _save_claims(
        self,
        project_id: uuid.UUID,
        claims: list[dict[str, Any]],
    ) -> list[uuid.UUID]:
        """Persist extracted claims to the database.

        Args:
            project_id: The project UUID.
            claims: List of claim dicts.

        Returns:
            List of generated claim UUIDs, in the same order as the input.
        """
        claim_ids: list[uuid.UUID] = []
        for claim_data in claims:
            claim_id = uuid.uuid4()
            claim = Claim(
                id=claim_id,
                project_id=project_id,
                text=claim_data["text"],
                claim_type=claim_data["type"],
                confidence=claim_data["confidence"],
                embedding=claim_data.get("embedding"),
                source_sentence=claim_data.get("source_sentence"),
                order_index=claim_data.get("order_index", 0),
                layer=claim_data.get("layer", 0),
            )
            self.session.add(claim)
            claim_ids.append(claim_id)

        await self.session.flush()
        logger.info("Saved %d claims to database", len(claim_ids))
        return claim_ids

    async def _save_edges(
        self,
        project_id: uuid.UUID,
        edges: list[dict[str, Any]],
        claim_ids: list[uuid.UUID],
    ) -> list[uuid.UUID]:
        """Persist causal edges to the database.

        Args:
            project_id: The project UUID.
            edges: List of edge dicts.
            claim_ids: List of claim UUIDs (indexed by claim order).

        Returns:
            List of generated edge UUIDs, in the same order as the input.
        """
        edge_ids: list[uuid.UUID] = []
        for edge_data in edges:
            edge_id = uuid.uuid4()
            source_idx = edge_data["source_idx"]
            target_idx = edge_data["target_idx"]

            edge = CausalEdge(
                id=edge_id,
                project_id=project_id,
                source_claim_id=claim_ids[source_idx],
                target_claim_id=claim_ids[target_idx],
                mechanism=edge_data.get("mechanism", ""),
                strength=edge_data.get("strength", 0.5),
                time_delay=edge_data.get("time_delay"),
                conditions=edge_data.get("conditions"),
                reversible=edge_data.get("reversible", False),
                evidence_score=edge_data.get("evidence_score", 0.5),
                causal_type=edge_data.get("causal_type", "direct"),
                condition_type=edge_data.get("condition_type", "contributing"),
                temporal_window=edge_data.get("temporal_window"),
                decay_type=edge_data.get("decay_type", "none"),
                bias_warnings=edge_data.get("bias_warnings"),
            )
            self.session.add(edge)
            edge_ids.append(edge_id)

        await self.session.flush()
        logger.info("Saved %d edges to database", len(edge_ids))
        return edge_ids

    async def _update_edges(
        self,
        edge_ids: list[uuid.UUID],
        edges: list[dict[str, Any]],
    ) -> None:
        """Update existing edges in the database with new data.

        Used after bias audit (updates strength, bias_warnings) and
        evidence grounding (updates evidence_score).
        """
        for edge_id, edge_data in zip(edge_ids, edges):
            db_edge = await self.session.get(CausalEdge, edge_id)
            if db_edge is None:
                continue
            db_edge.strength = edge_data.get("strength", db_edge.strength)
            db_edge.evidence_score = edge_data.get(
                "evidence_score", db_edge.evidence_score,
            )
            if "bias_warnings" in edge_data:
                db_edge.bias_warnings = edge_data["bias_warnings"]
        await self.session.flush()

    async def _save_evidences(
        self,
        edges: list[dict[str, Any]],
        edge_ids: list[uuid.UUID],
    ) -> None:
        """Persist evidence items to the database.

        Args:
            edges: List of edge dicts (some may contain "evidences" lists).
            edge_ids: Corresponding edge UUIDs.
        """
        count = 0
        for edge_data, edge_id in zip(edges, edge_ids):
            evidences = edge_data.get("evidences", [])
            for ev_data in evidences:
                evidence = Evidence(
                    id=uuid.uuid4(),
                    edge_id=edge_id,
                    evidence_type=ev_data.get("evidence_type", "supporting"),
                    source_url=ev_data.get("source_url", ""),
                    source_title=ev_data.get("source_title", ""),
                    source_type=ev_data.get("source_type", "other"),
                    snippet=ev_data.get("snippet", ""),
                    relevance_score=ev_data.get("relevance_score", 0.0),
                    credibility_score=ev_data.get("credibility_score", 0.4),
                    source_tier=ev_data.get("source_tier", 4),
                    published_date=ev_data.get("published_date"),
                    freshness_score=ev_data.get("freshness_score", 0.5),
                )
                self.session.add(evidence)
                count += 1

        if count > 0:
            await self.session.flush()
        logger.info("Saved %d evidence items to database", count)

    async def _update_claim_logic_gates(
        self,
        claim_ids: list[uuid.UUID],
        claims: list[dict[str, Any]],
        logic_gate_map: dict[str, str],
    ) -> None:
        """Update logic_gate on Claim records based on DAG analysis.

        Args:
            claim_ids: List of claim UUIDs (indexed by claim order).
            claims: Original claim dicts.
            logic_gate_map: Mapping from node_id (str index) to "or"|"and".
        """
        updated = 0
        for idx, claim_id in enumerate(claim_ids):
            gate = logic_gate_map.get(str(idx), "or")
            if gate != "or":
                claim = await self.session.get(Claim, claim_id)
                if claim is not None:
                    claim.logic_gate = gate
                    updated += 1

        if updated > 0:
            await self.session.flush()
        logger.info("Updated logic gates for %d claims", updated)

    async def _update_project_status(
        self,
        project_id: uuid.UUID,
        status: str,
    ) -> None:
        """Update the project's status field.

        Args:
            project_id: The project UUID.
            status: The new status string.
        """
        try:
            project = await self.session.get(Project, project_id)
            if project is not None:
                project.status = status
                await self.session.flush()
        except Exception as exc:
            logger.warning("Failed to update project status: %s", exc)


def _lightweight_claims(
    claims: list[dict[str, Any]], start_index: int = 0,
) -> list[dict[str, Any]]:
    """Strip embeddings and other heavy fields for SSE transmission."""
    return [
        {
            "id": c.get("id", f"claim-{start_index + i}"),
            "text": c.get("text", ""),
            "claim_type": c.get("type", "OPINION"),
            "confidence": c.get("confidence", 0.5),
            "layer": c.get("layer", 0),
        }
        for i, c in enumerate(claims)
    ]


def _lightweight_edge(edge: dict[str, Any], claims: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    """Strip heavy fields from edge for SSE."""
    source_text = edge.get("source_text", "")
    target_text = edge.get("target_text", "")
    # Resolve from claim indices if text not directly on the edge
    if claims and not source_text:
        src_idx = edge.get("source_idx")
        tgt_idx = edge.get("target_idx")
        if src_idx is not None and src_idx < len(claims):
            source_text = claims[src_idx].get("text", "")
        if tgt_idx is not None and tgt_idx < len(claims):
            target_text = claims[tgt_idx].get("text", "")
    e: dict[str, Any] = {
        "source_text": source_text,
        "target_text": target_text,
        "mechanism": edge.get("mechanism", ""),
        "strength": edge.get("strength", 0),
        "causal_type": edge.get("causal_type", "direct"),
    }
    if "evidence_score" in edge:
        e["evidence_score"] = edge["evidence_score"]
    if "evidences" in edge:
        e["evidences"] = [
            {
                "evidence_type": ev.get("evidence_type"),
                "source_title": ev.get("source_title", ""),
                "source_url": ev.get("source_url", ""),
                "snippet": ev.get("snippet", "")[:200],
                "relevance_score": ev.get("relevance_score", 0),
            }
            for ev in edge.get("evidences", [])
        ]
    if "bias_warnings" in edge:
        e["bias_warnings"] = edge["bias_warnings"]
    return e


def _lightweight_edges(claims: list[dict[str, Any]], edges: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Prepare all edges for SSE with source/target text resolved."""
    claim_map = {i: c.get("text", "") for i, c in enumerate(claims)}
    result = []
    for edge in edges:
        e = _lightweight_edge(edge)
        # Resolve source/target from indices if text not already set
        if not e.get("source_text"):
            src_idx = edge.get("source_idx")
            tgt_idx = edge.get("target_idx")
            if src_idx is not None:
                e["source_text"] = claim_map.get(src_idx, "")
            if tgt_idx is not None:
                e["target_text"] = claim_map.get(tgt_idx, "")
        result.append(e)
    return result
