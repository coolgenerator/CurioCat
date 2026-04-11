"""Graph Merger — deduplicates and merges new claims/edges into an existing graph.

Shared utility for both Manual Enrich and Auto Explore features.
Handles:
  - Merging raw claims (from text extraction) with embedding-based dedup
  - Converting FusedEdges (from ThreeLayerEngine) into graph claims + edges
  - Cycle detection before adding edges
"""

from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass, field
from typing import Any

import networkx as nx
import numpy as np
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from curiocat.db.models import CausalEdge, Claim
from curiocat.llm.embeddings import EmbeddingService
from curiocat.pipeline.three_layer_engine import FusedEdge

logger = logging.getLogger(__name__)

# Same threshold as graph_ops.py for convergence detection
_CONVERGENCE_THRESHOLD = 0.85

# Lower threshold for matching FusedEdge labels to existing claims
_LABEL_MATCH_THRESHOLD = 0.70


def _cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
    norm_a = np.linalg.norm(a)
    norm_b = np.linalg.norm(b)
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return float(np.dot(a, b) / (norm_a * norm_b))


@dataclass
class MergeResult:
    new_claims: list[Claim] = field(default_factory=list)
    new_edges: list[CausalEdge] = field(default_factory=list)
    merged_claims: list[Claim] = field(default_factory=list)
    skipped_duplicates: int = 0


class GraphMerger:
    """Deduplicates and merges external data into an existing project graph."""

    def __init__(
        self,
        session: AsyncSession,
        embedder: EmbeddingService,
    ) -> None:
        self._session = session
        self._embedder = embedder

    async def merge_claims(
        self,
        project_id: uuid.UUID,
        raw_claims: list[dict[str, Any]],
        existing_claims: list[Claim],
    ) -> MergeResult:
        """Merge new claims into an existing graph with embedding dedup.

        Each claim dict must have 'text', 'embedding', and optionally
        'claim_type', 'confidence', 'order_index'.

        Returns a MergeResult with the new ORM Claim objects added and
        a mapping of duplicates to existing claims.
        """
        result = MergeResult()
        if not raw_claims:
            return result

        max_order = max(
            (c.order_index for c in existing_claims), default=-1
        )

        for claim_data in raw_claims:
            embedding = claim_data.get("embedding")
            if embedding is None:
                continue

            new_vec = np.array(embedding)

            # Check for duplicate against existing claims
            matched_claim = self._find_match(new_vec, existing_claims)
            if matched_claim is not None:
                result.skipped_duplicates += 1
                # Track the mapping so callers can wire edges to existing nodes
                result.merged_claims.append(matched_claim)
                # Store the mapping on the dict for edge wiring
                claim_data["_merged_to"] = matched_claim.id
                continue

            # Also check against claims we've already added this batch
            batch_match = self._find_match(
                new_vec, result.new_claims
            )
            if batch_match is not None:
                result.skipped_duplicates += 1
                claim_data["_merged_to"] = batch_match.id
                continue

            max_order += 1
            new_claim = Claim(
                project_id=project_id,
                text=claim_data["text"],
                claim_type=claim_data.get("claim_type", claim_data.get("type", "FACT")),
                confidence=claim_data.get("confidence", 0.5),
                embedding=embedding,
                order_index=max_order,
                source_sentence=claim_data.get("source_sentence", ""),
            )
            self._session.add(new_claim)
            await self._session.flush()  # Get the ID

            claim_data["_merged_to"] = new_claim.id
            result.new_claims.append(new_claim)

        return result

    async def merge_claims_and_edges(
        self,
        project_id: uuid.UUID,
        raw_claims: list[dict[str, Any]],
        raw_edges: list[dict[str, Any]],
        existing_claims: list[Claim],
    ) -> MergeResult:
        """Merge claims and their causal edges into an existing graph.

        raw_edges use source_idx/target_idx referencing positions in raw_claims.
        After merging claims (with dedup), edges are wired to the correct IDs.
        """
        claim_result = await self.merge_claims(
            project_id, raw_claims, existing_claims
        )

        # Build index→UUID mapping from raw_claims
        idx_to_id: dict[int, uuid.UUID] = {}
        for i, claim_data in enumerate(raw_claims):
            merged_to = claim_data.get("_merged_to")
            if merged_to is not None:
                idx_to_id[i] = merged_to

        # Wire edges
        for edge_data in raw_edges:
            src_idx = edge_data.get("source_idx")
            tgt_idx = edge_data.get("target_idx")
            if src_idx is None or tgt_idx is None:
                continue

            src_id = idx_to_id.get(src_idx)
            tgt_id = idx_to_id.get(tgt_idx)
            if src_id is None or tgt_id is None:
                continue
            if src_id == tgt_id:
                continue

            # Cycle check
            if await self._would_create_cycle(project_id, src_id, tgt_id):
                logger.warning(
                    "Skipping edge %s -> %s: would create cycle", src_id, tgt_id
                )
                continue

            edge = CausalEdge(
                project_id=project_id,
                source_claim_id=src_id,
                target_claim_id=tgt_id,
                mechanism=edge_data.get("mechanism", ""),
                strength=edge_data.get("strength", 0.5),
                time_delay=edge_data.get("time_delay"),
                conditions=edge_data.get("conditions"),
                reversible=edge_data.get("reversible", False),
                evidence_score=edge_data.get("evidence_score", 0.5),
                causal_type=edge_data.get("causal_type", "direct"),
                condition_type=edge_data.get("condition_type", "contributing"),
            )
            self._session.add(edge)
            claim_result.new_edges.append(edge)

        await self._session.flush()
        return claim_result

    async def merge_fused_edges(
        self,
        project_id: uuid.UUID,
        fused_edges: list[FusedEdge],
        existing_claims: list[Claim],
    ) -> MergeResult:
        """Convert ThreeLayerEngine FusedEdges into graph claims + edges.

        FusedEdges have string labels (e.g. "Revenue", "Marketing Spend").
        This method:
        1. Embeds each unique label
        2. Fuzzy-matches labels against existing claims (cosine > 0.70)
        3. Creates new claims for unmatched labels
        4. Creates CausalEdge rows with fused_confidence as strength
        """
        result = MergeResult()
        if not fused_edges:
            return result

        # Collect all unique labels
        labels: set[str] = set()
        for fe in fused_edges:
            labels.add(fe.source_label)
            labels.add(fe.target_label)

        label_list = sorted(labels)
        embeddings = await self._embedder.embed_batch(label_list)

        max_order = max(
            (c.order_index for c in existing_claims), default=-1
        )

        # Map label → Claim (existing or newly created)
        label_to_claim: dict[str, Claim] = {}

        for i, label in enumerate(label_list):
            embedding = embeddings[i]
            new_vec = np.array(embedding)

            # Try to match against existing claims
            matched = self._find_match(
                new_vec, existing_claims, threshold=_LABEL_MATCH_THRESHOLD
            )
            if matched is not None:
                label_to_claim[label] = matched
                result.merged_claims.append(matched)
                continue

            # Also check against claims we've created in this batch
            batch_claims = list(label_to_claim.values())
            batch_new = [c for c in batch_claims if c in result.new_claims]
            batch_match = self._find_match(
                new_vec, batch_new, threshold=_LABEL_MATCH_THRESHOLD
            )
            if batch_match is not None:
                label_to_claim[label] = batch_match
                result.skipped_duplicates += 1
                continue

            # Create new claim from the label
            max_order += 1
            new_claim = Claim(
                project_id=project_id,
                text=label,
                claim_type="FACT",
                confidence=0.5,
                embedding=embedding,
                order_index=max_order,
            )
            self._session.add(new_claim)
            await self._session.flush()

            label_to_claim[label] = new_claim
            result.new_claims.append(new_claim)

        # Create edges from fused edges
        for fe in fused_edges:
            src_claim = label_to_claim.get(fe.source_label)
            tgt_claim = label_to_claim.get(fe.target_label)
            if src_claim is None or tgt_claim is None:
                continue
            if src_claim.id == tgt_claim.id:
                continue

            if await self._would_create_cycle(
                project_id, src_claim.id, tgt_claim.id
            ):
                logger.warning(
                    "Skipping fused edge %s -> %s: would create cycle",
                    fe.source_label, fe.target_label,
                )
                continue

            # Map confidence tier to evidence_score
            tier_to_score = {
                "high": 0.9, "medium": 0.6, "low": 0.3, "unverified": 0.1,
            }
            evidence_score = tier_to_score.get(
                fe.confidence_tier.value
                if hasattr(fe.confidence_tier, "value")
                else str(fe.confidence_tier),
                0.3,
            )

            # Build mechanism from best evidence reason
            mechanism = ""
            if fe.evidence:
                reasons = [e.reason for e in fe.evidence if e.reason]
                mechanism = reasons[0] if reasons else ""

            edge = CausalEdge(
                project_id=project_id,
                source_claim_id=src_claim.id,
                target_claim_id=tgt_claim.id,
                mechanism=mechanism,
                strength=fe.fused_confidence,
                evidence_score=evidence_score,
                reversible=False,
                causal_type="direct",
                condition_type="contributing",
            )

            # Attach statistical validation if available
            if fe.best_p_value is not None:
                edge.statistical_validation = fe.verdict
                edge.stat_p_value = fe.best_p_value
                edge.stat_lag = fe.best_lag
                # Effect size from the best stat evidence
                stat_evidence = [e for e in fe.evidence if e.layer == 3]
                if stat_evidence:
                    effects = [e.effect_size for e in stat_evidence if e.effect_size is not None]
                    if effects:
                        edge.stat_effect_size = max(effects)

            self._session.add(edge)
            result.new_edges.append(edge)

        await self._session.flush()
        return result

    # --- Private helpers ---

    def _find_match(
        self,
        embedding: np.ndarray,
        claims: list[Claim],
        threshold: float = _CONVERGENCE_THRESHOLD,
    ) -> Claim | None:
        """Find the best matching claim above the similarity threshold."""
        best_claim: Claim | None = None
        best_sim = threshold

        for claim in claims:
            if claim.embedding is None:
                continue
            sim = _cosine_similarity(embedding, np.array(claim.embedding))
            if sim > best_sim:
                best_sim = sim
                best_claim = claim

        return best_claim

    async def _would_create_cycle(
        self,
        project_id: uuid.UUID,
        source_id: uuid.UUID,
        target_id: uuid.UUID,
    ) -> bool:
        """Check if adding source→target would create a cycle."""
        db_result = await self._session.execute(
            select(CausalEdge.source_claim_id, CausalEdge.target_claim_id).where(
                CausalEdge.project_id == project_id
            )
        )
        edges = db_result.all()

        g = nx.DiGraph()
        for src, tgt in edges:
            g.add_edge(str(src), str(tgt))

        src_str = str(source_id)
        tgt_str = str(target_id)

        if g.has_node(tgt_str) and g.has_node(src_str):
            return nx.has_path(g, tgt_str, src_str)
        return False
