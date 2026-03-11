"""Discovery Engine — extracts new claims from evidence snippets.

After evidence grounding attaches snippets to edges, the discovery engine
sends those snippets to the LLM to find novel facts not already in the graph.
New claims are deduplicated against existing claims using embedding similarity.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

import numpy as np

from curiocat.evidence.web_search import BraveSearchClient
from curiocat.llm.client import LLMClient
from curiocat.llm.embeddings import EmbeddingService
from curiocat.llm.prompts import language_instruction
from curiocat.llm.prompts.discovery import DISCOVERY_SCHEMA, DISCOVERY_SYSTEM
from curiocat.pipeline.claim_extractor import _cosine_similarity

logger = logging.getLogger(__name__)

# Reuse the same dedup threshold as claim extraction
_DEDUP_SIMILARITY_THRESHOLD = 0.95

# Max concurrent LLM calls for discovery
_MAX_CONCURRENT_DISCOVERY = 3

# Batch size for grouping edges before sending to LLM
_EDGE_BATCH_SIZE = 3


def _truncate_for_search(text: str, max_words: int = 20) -> str:
    """Truncate text to a short search query."""
    words = text.split()[:max_words]
    return " ".join(words)


class DiscoveryEngine:
    """Extracts new claims from evidence snippets attached to grounded edges."""

    def __init__(
        self,
        llm: LLMClient,
        embedder: EmbeddingService,
        search_client: "BraveSearchClient | None" = None,
    ) -> None:
        self._llm = llm
        self._embedder = embedder
        self._search = search_client

    async def discover(
        self,
        existing_claims: list[dict[str, Any]],
        grounded_edges: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        """Extract new claims from evidence snippets on grounded edges.

        For each edge that has evidence snippets, sends the edge context +
        snippets + existing claim list to the LLM for novel claim extraction.
        Deduplicates discovered claims against existing claims using 0.95
        cosine similarity threshold.

        Args:
            existing_claims: Current claim list (with "text" and "embedding" keys).
            grounded_edges: Edge dicts that may contain "evidences" lists.

        Returns:
            List of new claim dicts with embeddings attached, ready to be
            merged into the main claims list.
        """
        # Filter to edges that have evidence snippets
        edges_with_evidence = [
            e for e in grounded_edges
            if e.get("evidences") and len(e["evidences"]) > 0
        ]

        if not edges_with_evidence:
            logger.info("No edges with evidence snippets; skipping discovery")
            return []

        # Batch edges into groups
        batches: list[list[dict[str, Any]]] = []
        for i in range(0, len(edges_with_evidence), _EDGE_BATCH_SIZE):
            batches.append(edges_with_evidence[i : i + _EDGE_BATCH_SIZE])

        # Build existing claims summary for the LLM
        existing_texts = [c["text"] for c in existing_claims]
        claims_summary = "\n".join(
            f"- {text}" for text in existing_texts[:50]  # Cap to avoid token overflow
        )

        # Run LLM calls concurrently
        semaphore = asyncio.Semaphore(_MAX_CONCURRENT_DISCOVERY)
        tasks = [
            self._discover_batch(batch, existing_claims, claims_summary, semaphore)
            for batch in batches
        ]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        # Collect all raw new claims
        raw_new_claims: list[dict[str, Any]] = []
        for result in results:
            if isinstance(result, Exception):
                logger.warning("Discovery batch failed: %s", result)
                continue
            raw_new_claims.extend(result)

        if not raw_new_claims:
            logger.info("No new claims discovered from evidence")
            return []

        # Embed new claims
        new_texts = [c["text"] for c in raw_new_claims]
        try:
            new_embeddings = await self._embedder.embed_batch(new_texts)
        except Exception as exc:
            logger.warning("Failed to embed discovered claims: %s", exc)
            return []

        # Deduplicate against existing claims
        existing_embeddings = [
            np.array(c["embedding"]) for c in existing_claims
            if c.get("embedding") is not None
        ]

        unique_claims: list[dict[str, Any]] = []
        for idx, claim in enumerate(raw_new_claims):
            embedding = np.array(new_embeddings[idx])
            is_duplicate = False

            # Check against existing claims
            for existing_emb in existing_embeddings:
                if _cosine_similarity(embedding, existing_emb) > _DEDUP_SIMILARITY_THRESHOLD:
                    is_duplicate = True
                    break

            # Check against already-accepted new claims
            if not is_duplicate:
                for accepted in unique_claims:
                    if _cosine_similarity(embedding, np.array(accepted["embedding"])) > _DEDUP_SIMILARITY_THRESHOLD:
                        is_duplicate = True
                        break

            if not is_duplicate:
                claim["embedding"] = new_embeddings[idx]
                unique_claims.append(claim)

        # Web-verify discovered claims before accepting them
        if self._search and unique_claims:
            verified_claims: list[dict[str, Any]] = []
            for claim in unique_claims:
                query = _truncate_for_search(claim["text"])
                try:
                    results = await self._search.search(query, count=2)
                    if results:
                        verified_claims.append(claim)
                    else:
                        logger.info(
                            "Discovery: dropped unverifiable claim: %s",
                            claim["text"][:60],
                        )
                except Exception:
                    verified_claims.append(claim)  # Keep on search failure
            unique_claims = verified_claims

        logger.info(
            "Discovery: %d raw claims -> %d unique new claims (after dedup against %d existing)",
            len(raw_new_claims),
            len(unique_claims),
            len(existing_claims),
        )
        return unique_claims

    async def _discover_batch(
        self,
        edges: list[dict[str, Any]],
        existing_claims: list[dict[str, Any]],
        claims_summary: str,
        semaphore: asyncio.Semaphore,
    ) -> list[dict[str, Any]]:
        """Run discovery on a batch of edges."""
        # Build context from edge evidence snippets
        context_parts: list[str] = []
        for edge in edges:
            source_idx = edge.get("source_idx", 0)
            target_idx = edge.get("target_idx", 0)
            source_text = (
                existing_claims[source_idx]["text"]
                if source_idx < len(existing_claims) else "unknown"
            )
            target_text = (
                existing_claims[target_idx]["text"]
                if target_idx < len(existing_claims) else "unknown"
            )
            mechanism = edge.get("mechanism", "")

            snippets = []
            for ev in edge.get("evidences", []):
                snippet = ev.get("snippet", "")
                if snippet:
                    source_title = ev.get("source_title", "")
                    snippets.append(f"[{source_title}] {snippet}")

            if snippets:
                context_parts.append(
                    f"CAUSAL LINK: {source_text} -> {target_text}\n"
                    f"Mechanism: {mechanism}\n"
                    f"Evidence:\n" + "\n".join(f"  - {s}" for s in snippets)
                )

        if not context_parts:
            return []

        user_prompt = (
            f"EXISTING CLAIMS:\n{claims_summary}\n\n"
            f"CAUSAL LINKS WITH EVIDENCE:\n\n"
            + "\n\n".join(context_parts)
            + "\n\nExtract new claims not already in the existing list."
            + language_instruction(claims_summary)
        )

        async with semaphore:
            try:
                result = await self._llm.complete_json(
                    system=DISCOVERY_SYSTEM,
                    user=user_prompt,
                    schema=DISCOVERY_SCHEMA,
                )
                return result.get("new_claims", [])
            except Exception as exc:
                logger.warning("Discovery LLM call failed: %s", exc)
                return []
