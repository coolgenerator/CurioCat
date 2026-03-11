"""Stage 2: Causal Link Inference.

Uses a two-pass approach: first filters candidate claim pairs by embedding
cosine similarity, then calls the LLM to judge causal relationships for
each candidate pair.
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
    CAUSAL_INFERENCE_SCHEMA,
    CAUSAL_INFERENCE_SYSTEM,
)
from curiocat.pipeline.validation import validate_causal_output

logger = logging.getLogger(__name__)

# Minimum cosine similarity to consider a pair of claims as candidates
_SIMILARITY_THRESHOLD = 0.3

# Maximum concurrent LLM calls for causal inference
_MAX_CONCURRENT_LLM_CALLS = 5


class CausalInferrer:
    """Infers causal relationships between claims using embedding similarity
    filtering followed by LLM-based judgment.
    """

    def __init__(self, llm: LLMClient) -> None:
        self._llm = llm

    async def infer(self, claims: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Infer causal links between the provided claims.

        Pass 1: Build a cosine similarity matrix from claim embeddings using
        numpy. Filter pairs where similarity > 0.3 as candidate pairs.

        Pass 2: For each candidate pair, call the LLM to judge whether a
        causal relationship exists. Concurrent calls are limited by a
        semaphore.

        Args:
            claims: List of claim dicts, each with "text", "type",
                "confidence", "embedding", and "order_index" keys.

        Returns:
            A list of edge dicts for confirmed causal links, each containing:
              - source_idx (int): Index into the claims list for the cause.
              - target_idx (int): Index into the claims list for the effect.
              - mechanism (str): Description of the causal mechanism.
              - strength (float): Causal strength, 0.0 to 1.0.
              - time_delay (str): Estimated time between cause and effect.
              - conditions (list[str]): Conditions for the link to hold.
              - reversible (bool): Whether the effect is reversible.

        Raises:
            PipelineError: If causal inference fails.
        """
        if len(claims) < 2:
            logger.info("Fewer than 2 claims; no causal inference needed")
            return []

        # Pass 1: Build cosine similarity matrix and find candidate pairs
        candidate_pairs = self._find_candidate_pairs(claims)
        logger.info(
            "Found %d candidate pairs from %d claims (similarity > %.2f)",
            len(candidate_pairs),
            len(claims),
            _SIMILARITY_THRESHOLD,
        )

        if not candidate_pairs:
            logger.info("No candidate pairs above similarity threshold")
            return []

        # Pass 2: LLM-based causal judgment for each candidate pair
        semaphore = asyncio.Semaphore(_MAX_CONCURRENT_LLM_CALLS)
        tasks = [
            self._judge_pair(claims, i, j, semaphore)
            for i, j in candidate_pairs
        ]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        edges: list[dict[str, Any]] = []
        for result in results:
            if isinstance(result, Exception):
                logger.warning("Causal inference failed for a pair: %s", result)
                continue
            if result is not None:
                edges.append(result)

        logger.info("Confirmed %d causal edges", len(edges))
        return edges

    async def infer_incremental(
        self,
        all_claims: list[dict[str, Any]],
        new_claim_indices: set[int],
    ) -> list[dict[str, Any]]:
        """Infer causal links involving at least one new claim.

        Instead of O(n^2) over all claims, only checks pairs (i, j) where
        i in new_claim_indices OR j in new_claim_indices.
        Uses the same similarity filtering + LLM judgment pipeline.

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

    def _find_candidate_pairs(
        self, claims: list[dict[str, Any]]
    ) -> list[tuple[int, int]]:
        """Build cosine similarity matrix and return pairs above threshold.

        Args:
            claims: List of claim dicts with "embedding" keys.

        Returns:
            List of (i, j) tuples where i < j and cosine similarity > threshold.
        """
        embeddings = np.array([c["embedding"] for c in claims])

        # Compute pairwise cosine similarity matrix efficiently
        # Normalize rows to unit length
        norms = np.linalg.norm(embeddings, axis=1, keepdims=True)
        # Avoid division by zero
        norms = np.where(norms == 0, 1.0, norms)
        normalized = embeddings / norms

        # Similarity matrix via dot product of normalized vectors
        similarity_matrix = normalized @ normalized.T

        # Extract candidate pairs (upper triangle only, no self-pairs)
        pairs: list[tuple[int, int]] = []
        n = len(claims)
        for i in range(n):
            for j in range(i + 1, n):
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
        """Call the LLM to judge whether a causal link exists between two claims.

        Args:
            claims: The full list of claims.
            i: Index of claim A.
            j: Index of claim B.
            semaphore: Concurrency limiter.

        Returns:
            An edge dict if a causal link is found, or None otherwise.

        Raises:
            PipelineError: If the LLM call fails.
        """
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
                # For bidirectional, we still pick a primary direction (A -> B)
                # and note it. The graph layer can handle this if needed.
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
