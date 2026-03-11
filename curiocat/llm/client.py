"""Abstract LLM client with OpenAI and Anthropic implementations."""

from __future__ import annotations

import json
import logging
from abc import ABC, abstractmethod
from typing import Any

import anthropic
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


class LLMClient(ABC):
    """Abstract base class for LLM interactions."""

    @abstractmethod
    async def complete(self, system: str, user: str, **kwargs: Any) -> str:
        """Generate a text completion given system and user prompts.

        Args:
            system: The system prompt providing instructions and context.
            user: The user message to respond to.
            **kwargs: Additional provider-specific parameters.

        Returns:
            The generated text response.
        """
        ...

    @abstractmethod
    async def complete_json(
        self, system: str, user: str, schema: dict, **kwargs: Any
    ) -> dict:
        """Generate a structured JSON response conforming to the given schema.

        Args:
            system: The system prompt providing instructions and context.
            user: The user message to respond to.
            schema: A JSON Schema dict describing the expected output structure.
            **kwargs: Additional provider-specific parameters.

        Returns:
            A parsed dict matching the provided schema.
        """
        ...


class OpenAIClient(LLMClient):
    """LLM client backed by the OpenAI Chat Completions API."""

    def __init__(self, api_key: str | None = None, model: str | None = None) -> None:
        self._client = openai.AsyncOpenAI(api_key=api_key or settings.openai_api_key)
        self._model = model or settings.llm_model

    @retry(
        retry=retry_if_exception_type(
            (openai.APIConnectionError, openai.RateLimitError, openai.APITimeoutError)
        ),
        wait=wait_exponential(multiplier=1, min=1, max=30),
        stop=stop_after_attempt(3),
        reraise=True,
    )
    async def complete(self, system: str, user: str, **kwargs: Any) -> str:
        try:
            response = await self._client.chat.completions.create(
                model=self._model,
                messages=[
                    {"role": "system", "content": system},
                    {"role": "user", "content": user},
                ],
                temperature=kwargs.get("temperature", 0.3),
                max_tokens=kwargs.get("max_tokens", 4096),
            )
            content = response.choices[0].message.content
            if content is None:
                raise LLMError("OpenAI returned empty response content")
            return content
        except (
            openai.APIConnectionError,
            openai.RateLimitError,
            openai.APITimeoutError,
        ):
            raise
        except openai.APIError as exc:
            raise LLMError(f"OpenAI API error: {exc}") from exc

    @retry(
        retry=retry_if_exception_type(
            (openai.APIConnectionError, openai.RateLimitError, openai.APITimeoutError)
        ),
        wait=wait_exponential(multiplier=1, min=1, max=30),
        stop=stop_after_attempt(3),
        reraise=True,
    )
    async def complete_json(
        self, system: str, user: str, schema: dict, **kwargs: Any
    ) -> dict:
        try:
            response = await self._client.chat.completions.create(
                model=self._model,
                messages=[
                    {"role": "system", "content": system},
                    {"role": "user", "content": user},
                ],
                response_format={
                    "type": "json_schema",
                    "json_schema": {
                        "name": "response",
                        "schema": schema,
                        "strict": True,
                    },
                },
                temperature=kwargs.get("temperature", 0.2),
                max_tokens=kwargs.get("max_tokens", 4096),
            )
            content = response.choices[0].message.content
            if content is None:
                raise LLMError("OpenAI returned empty response content")
            return json.loads(content)
        except json.JSONDecodeError as exc:
            raise LLMError(f"Failed to parse OpenAI JSON response: {exc}") from exc
        except (
            openai.APIConnectionError,
            openai.RateLimitError,
            openai.APITimeoutError,
        ):
            raise
        except openai.APIError as exc:
            raise LLMError(f"OpenAI API error: {exc}") from exc


class AnthropicClient(LLMClient):
    """LLM client backed by the Anthropic Messages API."""

    def __init__(
        self, api_key: str | None = None, model: str | None = None
    ) -> None:
        self._client = anthropic.AsyncAnthropic(
            api_key=api_key or settings.anthropic_api_key
        )
        self._model = model or settings.llm_model

    @retry(
        retry=retry_if_exception_type(
            (
                anthropic.APIConnectionError,
                anthropic.RateLimitError,
                anthropic.APITimeoutError,
            )
        ),
        wait=wait_exponential(multiplier=1, min=1, max=30),
        stop=stop_after_attempt(3),
        reraise=True,
    )
    async def complete(self, system: str, user: str, **kwargs: Any) -> str:
        try:
            response = await self._client.messages.create(
                model=self._model,
                system=system,
                messages=[{"role": "user", "content": user}],
                temperature=kwargs.get("temperature", 0.3),
                max_tokens=kwargs.get("max_tokens", 4096),
            )
            text_blocks = [
                block.text for block in response.content if block.type == "text"
            ]
            if not text_blocks:
                raise LLMError("Anthropic returned no text content")
            return text_blocks[0]
        except (
            anthropic.APIConnectionError,
            anthropic.RateLimitError,
            anthropic.APITimeoutError,
        ):
            raise
        except anthropic.APIError as exc:
            raise LLMError(f"Anthropic API error: {exc}") from exc

    @retry(
        retry=retry_if_exception_type(
            (
                anthropic.APIConnectionError,
                anthropic.RateLimitError,
                anthropic.APITimeoutError,
            )
        ),
        wait=wait_exponential(multiplier=1, min=1, max=30),
        stop=stop_after_attempt(3),
        reraise=True,
    )
    async def complete_json(
        self, system: str, user: str, schema: dict, **kwargs: Any
    ) -> dict:
        """Use the prefill technique: start the assistant turn with '{' to force JSON."""
        try:
            response = await self._client.messages.create(
                model=self._model,
                system=system,
                messages=[
                    {"role": "user", "content": user},
                    {"role": "assistant", "content": "{"},
                ],
                temperature=kwargs.get("temperature", 0.2),
                max_tokens=kwargs.get("max_tokens", 4096),
            )
            text_blocks = [
                block.text for block in response.content if block.type == "text"
            ]
            if not text_blocks:
                raise LLMError("Anthropic returned no text content")
            # Reconstruct the full JSON (we prefilled with '{')
            raw_json = "{" + text_blocks[0]
            return json.loads(raw_json)
        except json.JSONDecodeError as exc:
            raise LLMError(
                f"Failed to parse Anthropic JSON response: {exc}"
            ) from exc
        except (
            anthropic.APIConnectionError,
            anthropic.RateLimitError,
            anthropic.APITimeoutError,
        ):
            raise
        except anthropic.APIError as exc:
            raise LLMError(f"Anthropic API error: {exc}") from exc


def get_llm_client() -> LLMClient:
    """Factory function that returns the appropriate LLM client based on settings.

    Returns:
        An LLMClient instance configured according to ``settings.llm_provider``.

    Raises:
        LLMError: If the configured provider is not supported.
    """
    provider = settings.llm_provider.lower()
    if provider == "openai":
        return OpenAIClient()
    elif provider == "anthropic":
        return AnthropicClient()
    else:
        raise LLMError(f"Unsupported LLM provider: {provider}")
