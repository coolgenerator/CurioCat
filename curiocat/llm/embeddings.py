"""Embedding service using OpenAI's embedding API."""

from __future__ import annotations

import logging

import openai
from tenacity import (
    retry,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
)

from curiocat.config import settings
from curiocat.exceptions import LLMError

logger = logging.getLogger(__name__)

# Maximum number of texts per single embedding API call.
_BATCH_CHUNK_SIZE = 100


class EmbeddingService:
    """Generates vector embeddings via the OpenAI Embeddings API.

    Embeddings are always produced through OpenAI regardless of which LLM
    provider is used for text generation.
    """

    def __init__(self, api_key: str | None = None) -> None:
        self._client = openai.AsyncOpenAI(
            api_key=api_key or settings.openai_api_key,
        )
        self._model = settings.embedding_model
        self._dimensions = settings.embedding_dimensions

    @retry(
        retry=retry_if_exception_type(
            (openai.APIConnectionError, openai.RateLimitError, openai.APITimeoutError)
        ),
        wait=wait_exponential(multiplier=1, min=1, max=30),
        stop=stop_after_attempt(3),
        reraise=True,
    )
    async def embed(self, text: str) -> list[float]:
        """Embed a single text string.

        Args:
            text: The text to embed.

        Returns:
            A list of floats representing the embedding vector.
        """
        try:
            response = await self._client.embeddings.create(
                model=self._model,
                input=text,
                dimensions=self._dimensions,
            )
            return response.data[0].embedding
        except (
            openai.APIConnectionError,
            openai.RateLimitError,
            openai.APITimeoutError,
        ):
            raise
        except openai.APIError as exc:
            raise LLMError(f"Embedding API error: {exc}") from exc

    async def embed_batch(self, texts: list[str]) -> list[list[float]]:
        """Embed a batch of texts, chunking to respect API limits.

        Texts are sent in groups of up to 100 per API call.

        Args:
            texts: The list of texts to embed.

        Returns:
            A list of embedding vectors, one per input text (in order).
        """
        if not texts:
            return []

        all_embeddings: list[list[float]] = []
        for start in range(0, len(texts), _BATCH_CHUNK_SIZE):
            chunk = texts[start : start + _BATCH_CHUNK_SIZE]
            embeddings = await self._embed_chunk(chunk)
            all_embeddings.extend(embeddings)
        return all_embeddings

    @retry(
        retry=retry_if_exception_type(
            (openai.APIConnectionError, openai.RateLimitError, openai.APITimeoutError)
        ),
        wait=wait_exponential(multiplier=1, min=1, max=30),
        stop=stop_after_attempt(3),
        reraise=True,
    )
    async def _embed_chunk(self, texts: list[str]) -> list[list[float]]:
        """Embed a chunk of texts (up to _BATCH_CHUNK_SIZE) in a single call."""
        try:
            response = await self._client.embeddings.create(
                model=self._model,
                input=texts,
                dimensions=self._dimensions,
            )
            # Sort by index to guarantee order matches input
            sorted_data = sorted(response.data, key=lambda d: d.index)
            return [item.embedding for item in sorted_data]
        except (
            openai.APIConnectionError,
            openai.RateLimitError,
            openai.APITimeoutError,
        ):
            raise
        except openai.APIError as exc:
            raise LLMError(f"Embedding API error: {exc}") from exc
