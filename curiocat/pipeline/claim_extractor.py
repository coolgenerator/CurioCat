"""Stage 1: Claim Decomposition.

Extracts atomic claims from input text, deduplicates by embedding similarity,
and returns structured claim data with embeddings.
"""

from __future__ import annotations

import logging
from typing import Any

import numpy as np

from curiocat.exceptions import PipelineError
from curiocat.llm.client import LLMClient
from curiocat.llm.embeddings import EmbeddingService
from curiocat.llm.prompts import language_instruction
from curiocat.llm.prompts.claim_extraction import (
    CLAIM_EXTRACTION_SCHEMA,
    CLAIM_EXTRACTION_SYSTEM,
)

logger = logging.getLogger(__name__)

# Chunking parameters
_MAX_CHUNK_LENGTH = 8000
_OVERLAP_LENGTH = 1000

# Claims with embedding cosine similarity above this threshold are duplicates
_DEDUP_SIMILARITY_THRESHOLD = 0.95


def _chunk_text(text: str) -> list[str]:
    """Split text into overlapping chunks when it exceeds the max length.

    Uses a sliding window approach with 1000-character overlap to preserve
    context across chunk boundaries.

    Args:
        text: The full input text.

    Returns:
        A list of text chunks. If the text is short enough, returns a
        single-element list.
    """
    if len(text) <= _MAX_CHUNK_LENGTH:
        return [text]

    chunks: list[str] = []
    start = 0
    while start < len(text):
        end = start + _MAX_CHUNK_LENGTH
        chunks.append(text[start:end])
        if end >= len(text):
            break
        start = end - _OVERLAP_LENGTH
    return chunks


def _cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
    """Compute cosine similarity between two vectors."""
    norm_a = np.linalg.norm(a)
    norm_b = np.linalg.norm(b)
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return float(np.dot(a, b) / (norm_a * norm_b))


class ClaimExtractor:
    """Extracts atomic claims from text using an LLM.

    Claims are deduplicated across chunks via embedding cosine similarity,
    and each claim is returned with its embedding vector.
    """

    def __init__(self, llm: LLMClient, embedder: EmbeddingService) -> None:
        self._llm = llm
        self._embedder = embedder

    async def extract(self, text: str) -> tuple[list[dict[str, Any]], bool]:
        """Extract atomic claims from the given text.

        Pipeline:
        1. Chunk long text into overlapping windows.
        2. For each chunk, call the LLM to extract structured claims.
        3. Merge results across chunks.
        4. Deduplicate claims by embedding cosine similarity (>0.95 = duplicate).
        5. Batch-embed all unique claims.
        6. Return list of claim dicts with their embeddings attached,
           plus a boolean indicating temporal relevance.

        Args:
            text: The input text to decompose into claims.

        Returns:
            A tuple of (claims, has_temporal_relevance) where claims is a list
            of dicts and has_temporal_relevance indicates whether the content
            describes events with meaningful temporal relationships.

        Raises:
            PipelineError: If claim extraction fails.
        """
        if not text or not text.strip():
            raise PipelineError("Cannot extract claims from empty text")

        chunks = _chunk_text(text)
        logger.info("Extracting claims from %d chunk(s)", len(chunks))

        # Stage 1: Extract claims from each chunk
        all_raw_claims: list[dict[str, Any]] = []
        has_temporal = True  # default to true for backwards compatibility
        for i, chunk in enumerate(chunks):
            logger.debug("Processing chunk %d/%d (%d chars)", i + 1, len(chunks), len(chunk))
            try:
                result = await self._llm.complete_json(
                    system=CLAIM_EXTRACTION_SYSTEM,
                    user=(
                        f"Extract all atomic claims from the following text:\n\n{chunk}"
                        f"{language_instruction(chunk)}"
                    ),
                    schema=CLAIM_EXTRACTION_SCHEMA,
                )
                claims = result.get("claims", [])
                # Use temporal relevance from the first chunk (which sees the opening context)
                if i == 0:
                    has_temporal = result.get("has_temporal_relevance", True)
                logger.debug("Extracted %d claims from chunk %d", len(claims), i + 1)
                all_raw_claims.extend(claims)
            except Exception as exc:
                raise PipelineError(
                    f"Claim extraction failed on chunk {i + 1}: {exc}"
                ) from exc

        if not all_raw_claims:
            logger.warning("No claims extracted from any chunk")
            return [], has_temporal

        # Stage 2: Embed all claim texts for deduplication
        claim_texts = [c["text"] for c in all_raw_claims]
        try:
            embeddings = await self._embedder.embed_batch(claim_texts)
        except Exception as exc:
            raise PipelineError(f"Failed to embed claims: {exc}") from exc

        # Stage 3: Deduplicate by cosine similarity
        embedding_matrix = np.array(embeddings)
        unique_indices: list[int] = []
        for idx in range(len(all_raw_claims)):
            is_duplicate = False
            for kept_idx in unique_indices:
                sim = _cosine_similarity(
                    embedding_matrix[idx], embedding_matrix[kept_idx]
                )
                if sim > _DEDUP_SIMILARITY_THRESHOLD:
                    is_duplicate = True
                    logger.debug(
                        "Claim %d is a duplicate of claim %d (similarity=%.3f)",
                        idx,
                        kept_idx,
                        sim,
                    )
                    break
            if not is_duplicate:
                unique_indices.append(idx)

        logger.info(
            "Deduplicated %d raw claims to %d unique claims",
            len(all_raw_claims),
            len(unique_indices),
        )

        # Stage 4: Build final output with embeddings
        result_claims: list[dict[str, Any]] = []
        for order, idx in enumerate(unique_indices):
            claim = all_raw_claims[idx]
            claim["embedding"] = embeddings[idx]
            claim["order_index"] = order
            claim["source_sentence"] = claim.get("source_sentence", "")
            result_claims.append(claim)

        return result_claims, has_temporal
