"""Stage 2: Causal Link Inference.

Uses a BFS-style approach for initial inference (O(n) LLM calls instead of
O(n²) pairwise), and falls back to pairwise for incremental inference of
newly discovered claims.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

import numpy as np

from curiocat.exceptions import PipelineError
from curiocat.llm.client import LLMClient
from curiocat.llm.prompts import language_instruction
from curiocat.llm.prompts.causal_inference import (
    BFS_EXPANSION_SCHEMA,
    BFS_EXPANSION_SYSTEM,
    BFS_ROOT_IDENTIFICATION_SCHEMA,
    BFS_ROOT_IDENTIFICATION_SYSTEM,
    CAUSAL_INFERENCE_SCHEMA,
    CAUSAL_INFERENCE_SYSTEM,
)
from curiocat.pipeline.validation import validate_causal_output

logger = logging.getLogger(__name__)

# Minimum cosine similarity to consider a pair of claims as candidates
_SIMILARITY_THRESHOLD = 0.3

# Maximum concurrent LLM calls for causal inference
_MAX_CONCURRENT_LLM_CALLS = 10

# Maximum candidate targets per source node (top-K by similarity)
_MAX_CANDIDATES_PER_NODE = 10


class CausalInferrer:
    """Infers causal relationships between claims.

    Primary method: BFS-style O(n) inference.
    Fallback: Pairwise O(n²) for incremental inference.
    """

    def __init__(self, llm: LLMClient) -> None:
        self._llm = llm

    async def infer(self, claims: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Infer causal links using BFS-style approach.

        1. Identify root causes (claims not caused by others).
        2. For each claim, ask the LLM "what does this cause?" in one call.
        3. Build edges from the results, with cycle detection.

        This reduces LLM calls from O(n²) pairwise to O(n).

        Args:
            claims: List of claim dicts with "text", "type", "confidence",
                "embedding", and "order_index" keys.

        Returns:
            A list of edge dicts for confirmed causal links.
        """
        if len(claims) < 2:
            logger.info("Fewer than 2 claims; no causal inference needed")
            return []

        # Step 1: Identify root causes
        root_indices = await self._identify_roots(claims)
        logger.info("BFS: identified %d root causes from %d claims", len(root_indices), len(claims))

        if not root_indices:
            # Fallback: treat all claims as potential roots
            root_indices = list(range(len(claims)))

        # Step 2: BFS expansion — for each claim, find what it causes
        # Use embedding similarity to pre-filter candidates per source
        edges: list[dict[str, Any]] = []
        visited_edges: set[tuple[int, int]] = set()
        semaphore = asyncio.Semaphore(_MAX_CONCURRENT_LLM_CALLS)

        # BFS queue: start from roots, expand layer by layer
        queue = list(root_indices)
        visited_nodes: set[int] = set()

        while queue:
            # Process current layer in parallel
            tasks = []
            for source_idx in queue:
                if source_idx in visited_nodes:
                    continue
                visited_nodes.add(source_idx)
                # Find candidate targets using embedding similarity
                candidates = self._find_candidates_for_source(
                    claims, source_idx
                )
                if candidates:
                    tasks.append(
                        self._expand_node(
                            claims, source_idx, candidates,
                            semaphore, visited_edges,
                        )
                    )

            if not tasks:
                break

            results = await asyncio.gather(*tasks, return_exceptions=True)

            next_queue: list[int] = []
            for result in results:
                if isinstance(result, Exception):
                    logger.warning("BFS expansion failed: %s", result)
                    continue
                for edge in result:
                    edges.append(edge)
                    target_idx = edge["target_idx"]
                    if target_idx not in visited_nodes:
                        next_queue.append(target_idx)

            queue = next_queue

        # Step 3: Expand any unvisited nodes — BFS from roots may miss
        # claims that are not reachable from root causes but still have
        # causal relationships among themselves.
        unvisited = [i for i in range(len(claims)) if i not in visited_nodes]
        if unvisited:
            logger.info(
                "BFS: expanding %d unvisited nodes after root BFS", len(unvisited)
            )
            tasks = []
            for source_idx in unvisited:
                visited_nodes.add(source_idx)
                candidates = self._find_candidates_for_source(
                    claims, source_idx
                )
                if candidates:
                    tasks.append(
                        self._expand_node(
                            claims, source_idx, candidates,
                            semaphore, visited_edges,
                        )
                    )

            if tasks:
                results = await asyncio.gather(*tasks, return_exceptions=True)
                for result in results:
                    if isinstance(result, Exception):
                        logger.warning("BFS expansion failed: %s", result)
                        continue
                    edges.extend(result)

        # Dynamic edge budget: keep the graph readable and evidence
        # grounding affordable.  Target roughly 2× the claim count so
        # that a 25-claim graph yields ≤50 edges, not 100+.
        max_edges = max(10, len(claims) * 2)

        if len(edges) > max_edges:
            # Keep the strongest edges
            edges.sort(key=lambda e: e.get("strength", 0), reverse=True)
            dropped = len(edges) - max_edges
            edges = edges[:max_edges]
            logger.info(
                "BFS: pruned %d weak edges to stay within budget (%d edges for %d claims)",
                dropped, max_edges, len(claims),
            )

        logger.info("BFS: confirmed %d causal edges from %d claims", len(edges), len(claims))
        return edges

    async def infer_incremental(
        self,
        all_claims: list[dict[str, Any]],
        new_claim_indices: set[int],
    ) -> list[dict[str, Any]]:
        """Infer causal links involving at least one new claim.

        Uses pairwise approach for incremental inference since only a small
        number of new claims are added at a time.

        Args:
            all_claims: The full list of claims (existing + new).
            new_claim_indices: Set of indices for newly discovered claims.

        Returns:
            A list of edge dicts for confirmed causal links involving new claims.
        """
        if not new_claim_indices or len(all_claims) < 2:
            return []

        # Find candidate pairs involving at least one new claim
        candidate_pairs = self._find_incremental_candidate_pairs(
            all_claims, new_claim_indices
        )
        logger.info(
            "Incremental inference: %d candidate pairs involving %d new claims",
            len(candidate_pairs),
            len(new_claim_indices),
        )

        if not candidate_pairs:
            return []

        # LLM-based causal judgment
        semaphore = asyncio.Semaphore(_MAX_CONCURRENT_LLM_CALLS)
        tasks = [
            self._judge_pair(all_claims, i, j, semaphore)
            for i, j in candidate_pairs
        ]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        edges: list[dict[str, Any]] = []
        for result in results:
            if isinstance(result, Exception):
                logger.warning("Incremental inference failed for a pair: %s", result)
                continue
            if result is not None:
                edges.append(result)

        logger.info("Incremental inference confirmed %d new edges", len(edges))
        return edges

    # --- BFS methods ---

    async def _identify_roots(
        self, claims: list[dict[str, Any]]
    ) -> list[int]:
        """Ask the LLM to identify root cause claims."""
        claims_text = "\n".join(
            f"[{i}] {c['text']}" for i, c in enumerate(claims)
        )
        user_prompt = (
            f"Identify root causes from these claims:\n\n{claims_text}"
            f"{language_instruction(claims[0]['text'])}"
        )

        try:
            result = await self._llm.complete_json(
                system=BFS_ROOT_IDENTIFICATION_SYSTEM,
                user=user_prompt,
                schema=BFS_ROOT_IDENTIFICATION_SCHEMA,
            )
        except Exception as exc:
            logger.warning("Root identification failed: %s", exc)
            return list(range(len(claims)))

        indices = result.get("root_indices", [])
        # Validate indices are in range
        valid = [i for i in indices if 0 <= i < len(claims)]
        return valid if valid else list(range(len(claims)))

    def _find_candidates_for_source(
        self,
        claims: list[dict[str, Any]],
        source_idx: int,
    ) -> list[int]:
        """Find candidate target claims using embedding similarity.

        Returns at most _MAX_CANDIDATES_PER_NODE candidates, sorted by
        descending similarity, to keep LLM prompts short and fast.
        """
        source_emb = np.array(claims[source_idx]["embedding"])
        source_norm = np.linalg.norm(source_emb)
        if source_norm == 0:
            return []

        scored: list[tuple[int, float]] = []
        for j, claim in enumerate(claims):
            if j == source_idx:
                continue
            target_emb = np.array(claim["embedding"])
            target_norm = np.linalg.norm(target_emb)
            if target_norm == 0:
                continue
            sim = float(np.dot(source_emb, target_emb) / (source_norm * target_norm))
            if sim > _SIMILARITY_THRESHOLD:
                scored.append((j, sim))

        # Sort by similarity descending, keep top-K
        scored.sort(key=lambda x: x[1], reverse=True)
        return [idx for idx, _ in scored[:_MAX_CANDIDATES_PER_NODE]]

    async def _expand_node(
        self,
        claims: list[dict[str, Any]],
        source_idx: int,
        candidate_indices: list[int],
        semaphore: asyncio.Semaphore,
        visited_edges: set[tuple[int, int]],
    ) -> list[dict[str, Any]]:
        """Expand a single node: ask LLM what it causes among candidates.

        One LLM call returns all causal links from this source.
        """
        async with semaphore:
            source_claim = claims[source_idx]

            # Build candidate list for the prompt
            candidates_text = "\n".join(
                f"[{idx}] {claims[ci]['text']}"
                for idx, ci in enumerate(candidate_indices)
            )

            user_prompt = (
                f"SOURCE CLAIM: {source_claim['text']}\n\n"
                f"CANDIDATE CLAIMS:\n{candidates_text}"
                f"{language_instruction(source_claim['text'])}"
            )

            try:
                result = await self._llm.complete_json(
                    system=BFS_EXPANSION_SYSTEM,
                    user=user_prompt,
                    schema=BFS_EXPANSION_SCHEMA,
                )
            except Exception as exc:
                raise PipelineError(
                    f"BFS expansion failed for claim [{source_idx}]: {exc}"
                ) from exc

            edges: list[dict[str, Any]] = []
            for caused in result.get("caused_claims", []):
                local_target_idx = caused.get("target_index")
                if local_target_idx is None or local_target_idx < 0 or local_target_idx >= len(candidate_indices):
                    continue

                # Map local index back to global claim index
                global_target_idx = candidate_indices[local_target_idx]
                edge_key = (source_idx, global_target_idx)

                # Cycle detection: skip if this edge already exists
                if edge_key in visited_edges:
                    continue
                visited_edges.add(edge_key)

                mechanism = caused.get("mechanism", "")
                # Validate mechanism
                validated = validate_causal_output(
                    {"mechanism": mechanism, "strength": caused.get("strength", 0.5)},
                    source_claim["text"],
                    claims[global_target_idx]["text"],
                )
                if validated is None:
                    continue

                edges.append({
                    "source_idx": source_idx,
                    "target_idx": global_target_idx,
                    "mechanism": mechanism,
                    "strength": validated["strength"],
                    "time_delay": caused.get("time_delay"),
                    "conditions": [],
                    "reversible": False,
                    "direction": "source_to_target",
                    "causal_type": caused.get("causal_type", "direct"),
                    "condition_type": "contributing",
                    "temporal_window": None,
                    "decay_type": "none",
                })

            return edges

    # --- Pairwise methods (used for incremental inference) ---

    def _find_incremental_candidate_pairs(
        self,
        claims: list[dict[str, Any]],
        new_indices: set[int],
    ) -> list[tuple[int, int]]:
        """Find candidate pairs where at least one claim is new."""
        embeddings = np.array([c["embedding"] for c in claims])

        norms = np.linalg.norm(embeddings, axis=1, keepdims=True)
        norms = np.where(norms == 0, 1.0, norms)
        normalized = embeddings / norms
        similarity_matrix = normalized @ normalized.T

        pairs: list[tuple[int, int]] = []
        n = len(claims)
        for i in range(n):
            for j in range(i + 1, n):
                # At least one must be a new claim
                if i not in new_indices and j not in new_indices:
                    continue
                if similarity_matrix[i, j] > _SIMILARITY_THRESHOLD:
                    pairs.append((i, j))

        return pairs

    async def _judge_pair(
        self,
        claims: list[dict[str, Any]],
        i: int,
        j: int,
        semaphore: asyncio.Semaphore,
    ) -> dict[str, Any] | None:
        """Call the LLM to judge whether a causal link exists between two claims."""
        async with semaphore:
            claim_a = claims[i]
            claim_b = claims[j]

            user_prompt = (
                f"Analyze whether a causal relationship exists between these claims.\n\n"
                f"CLAIM A: {claim_a['text']}\n"
                f"CLAIM B: {claim_b['text']}"
                f"{language_instruction(claim_a['text'])}"
            )

            try:
                result = await self._llm.complete_json(
                    system=CAUSAL_INFERENCE_SYSTEM,
                    user=user_prompt,
                    schema=CAUSAL_INFERENCE_SCHEMA,
                )
            except Exception as exc:
                raise PipelineError(
                    f"Causal inference LLM call failed for claims [{i}, {j}]: {exc}"
                ) from exc

            if not result.get("has_causal_link", False):
                return None

            # Post-LLM validation gate
            validated = validate_causal_output(
                result, claim_a["text"], claim_b["text"]
            )
            if validated is None:
                return None
            result = validated

            direction = result.get("direction", "none")
            if direction == "none":
                return None

            # Determine source and target based on direction
            if direction == "source_to_target":
                source_idx, target_idx = i, j
            elif direction == "target_to_source":
                source_idx, target_idx = j, i
            elif direction == "bidirectional":
                source_idx, target_idx = i, j
            else:
                return None

            return {
                "source_idx": source_idx,
                "target_idx": target_idx,
                "mechanism": result.get("mechanism", ""),
                "strength": result.get("strength", 0.5),
                "time_delay": result.get("time_delay"),
                "conditions": result.get("conditions", []),
                "reversible": result.get("reversible", False),
                "direction": direction,
                "causal_type": result.get("causal_type", "direct"),
                "condition_type": result.get("condition_type", "contributing"),
                "temporal_window": result.get("temporal_window"),
                "decay_type": result.get("decay_type", "none"),
            }
