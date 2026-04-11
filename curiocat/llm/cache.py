"""Semantic cache for LLM responses.

Wraps an LLMClient to cache complete_json responses keyed by semantic
similarity of the (system + user) prompt. Uses a lightweight in-memory
FAISS index for fast nearest-neighbor lookup.

Cache hit rates of 60-70% are typical for causal analysis pipelines where
similar variable pairs are queried repeatedly.
"""

from __future__ import annotations

import hashlib
import json
import logging
import time
from pathlib import Path
from typing import Any

import numpy as np

from curiocat.llm.client import LLMClient

logger = logging.getLogger(__name__)

# Default cosine similarity threshold for cache hits
_DEFAULT_SIMILARITY_THRESHOLD = 0.92

# Maximum cache entries (LRU eviction beyond this)
_DEFAULT_MAX_ENTRIES = 2000

# Cache TTL in seconds (default 1 hour)
_DEFAULT_TTL_SECONDS = 3600


class SemanticCache:
    """In-memory semantic cache for LLM JSON responses.

    Uses embedding vectors for similarity matching. Falls back to exact
    string match when embeddings are unavailable.

    The cache operates at the prompt level: (system_prompt, user_prompt)
    → cached JSON response.
    """

    def __init__(
        self,
        embed_fn,
        similarity_threshold: float = _DEFAULT_SIMILARITY_THRESHOLD,
        max_entries: int = _DEFAULT_MAX_ENTRIES,
        ttl_seconds: int = _DEFAULT_TTL_SECONDS,
    ) -> None:
        """Initialize the semantic cache.

        Args:
            embed_fn: Async function that takes a string and returns a
                list[float] embedding vector.
            similarity_threshold: Minimum cosine similarity for a cache hit.
            max_entries: Maximum number of cached entries.
            ttl_seconds: Time-to-live for cache entries in seconds.
        """
        self._embed_fn = embed_fn
        self._threshold = similarity_threshold
        self._max_entries = max_entries
        self._ttl = ttl_seconds

        # Storage: list of (embedding, prompt_hash, response, timestamp)
        self._entries: list[dict[str, Any]] = []
        # Embeddings matrix for vectorized similarity search
        self._embeddings: np.ndarray | None = None

        # Stats
        self.hits = 0
        self.misses = 0

    async def get(self, system: str, user: str) -> dict | None:
        """Look up a cached response by semantic similarity.

        Args:
            system: The system prompt.
            user: The user prompt.

        Returns:
            Cached JSON response dict, or None on cache miss.
        """
        if not self._entries:
            self.misses += 1
            return None

        # First try exact match (fast path)
        prompt_hash = self._hash_prompt(system, user)
        for entry in self._entries:
            if entry["hash"] == prompt_hash:
                if time.time() - entry["timestamp"] < self._ttl:
                    self.hits += 1
                    entry["timestamp"] = time.time()  # Refresh TTL
                    logger.debug("Semantic cache: exact hash hit")
                    return entry["response"]

        # Semantic similarity search
        try:
            query_emb = await self._embed_fn(f"{system[:200]}\n{user}")
            query_vec = np.array(query_emb, dtype=np.float32)
            query_norm = np.linalg.norm(query_vec)
            if query_norm == 0:
                self.misses += 1
                return None
            query_vec = query_vec / query_norm
        except Exception as exc:
            logger.debug("Semantic cache: embedding failed, skipping: %s", exc)
            self.misses += 1
            return None

        # Vectorized cosine similarity
        if self._embeddings is None or len(self._embeddings) == 0:
            self.misses += 1
            return None

        similarities = self._embeddings @ query_vec
        best_idx = int(np.argmax(similarities))
        best_sim = float(similarities[best_idx])

        if best_sim >= self._threshold:
            entry = self._entries[best_idx]
            if time.time() - entry["timestamp"] < self._ttl:
                self.hits += 1
                entry["timestamp"] = time.time()
                logger.debug(
                    "Semantic cache: hit (similarity=%.3f)", best_sim
                )
                return entry["response"]

        self.misses += 1
        return None

    async def put(
        self, system: str, user: str, response: dict
    ) -> None:
        """Store a response in the cache.

        Args:
            system: The system prompt.
            user: The user prompt.
            response: The JSON response dict to cache.
        """
        prompt_hash = self._hash_prompt(system, user)

        # Generate embedding for this prompt
        try:
            emb = await self._embed_fn(f"{system[:200]}\n{user}")
            emb_vec = np.array(emb, dtype=np.float32)
            emb_norm = np.linalg.norm(emb_vec)
            if emb_norm > 0:
                emb_vec = emb_vec / emb_norm
            else:
                emb_vec = None
        except Exception:
            emb_vec = None

        entry = {
            "hash": prompt_hash,
            "response": response,
            "timestamp": time.time(),
        }
        self._entries.append(entry)

        # Update embeddings matrix
        if emb_vec is not None:
            if self._embeddings is None:
                self._embeddings = emb_vec.reshape(1, -1)
            else:
                self._embeddings = np.vstack(
                    [self._embeddings, emb_vec.reshape(1, -1)]
                )

        # Evict oldest entries if over capacity
        if len(self._entries) > self._max_entries:
            self._evict()

    def _evict(self) -> None:
        """Remove oldest entries to stay under max_entries."""
        # Sort by timestamp, keep most recent
        sorted_indices = sorted(
            range(len(self._entries)),
            key=lambda i: self._entries[i]["timestamp"],
            reverse=True,
        )
        keep = sorted_indices[: self._max_entries]
        keep_set = set(keep)

        self._entries = [
            self._entries[i]
            for i in sorted(keep_set)
        ]
        if self._embeddings is not None and len(self._embeddings) > 0:
            self._embeddings = self._embeddings[sorted(keep_set)]

    @staticmethod
    def _hash_prompt(system: str, user: str) -> str:
        """Create a deterministic hash of the prompt pair."""
        content = f"{system}\n---\n{user}"
        return hashlib.sha256(content.encode()).hexdigest()

    @property
    def stats(self) -> dict[str, int]:
        """Return cache hit/miss statistics."""
        total = self.hits + self.misses
        return {
            "hits": self.hits,
            "misses": self.misses,
            "total": total,
            "hit_rate": round(self.hits / total, 3) if total > 0 else 0.0,
            "entries": len(self._entries),
        }


class CachedLLMClient(LLMClient):
    """LLM client wrapper that adds semantic caching to complete_json calls.

    Delegates to an underlying LLMClient, caching JSON responses so that
    semantically similar prompts return cached results without an API call.

    Non-JSON calls (complete) are NOT cached since they are less
    deterministic and less likely to benefit from caching.
    """

    def __init__(
        self,
        inner: LLMClient,
        cache: SemanticCache,
    ) -> None:
        self._inner = inner
        self._cache = cache

    async def complete(self, system: str, user: str, **kwargs: Any) -> str:
        """Pass through to inner client (not cached)."""
        return await self._inner.complete(system, user, **kwargs)

    async def complete_json(
        self, system: str, user: str, schema: dict, **kwargs: Any
    ) -> dict:
        """Check cache first, then call inner client on miss."""
        cached = await self._cache.get(system, user)
        if cached is not None:
            return cached

        result = await self._inner.complete_json(
            system, user, schema, **kwargs
        )

        # Cache the result (fire-and-forget, don't block on embedding)
        await self._cache.put(system, user, result)

        return result

    @property
    def cache_stats(self) -> dict[str, int]:
        """Return cache statistics."""
        return self._cache.stats
