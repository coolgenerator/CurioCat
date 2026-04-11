"""Web search clients for evidence retrieval.

Provides DuckDuckGo (free, default) and Brave Search (API key required)
implementations behind a common interface.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

import httpx

from curiocat.exceptions import PipelineError

logger = logging.getLogger(__name__)


class DuckDuckGoSearchClient:
    """Free web search client using DuckDuckGo.

    No API key required. Uses the duckduckgo-search library.
    Default search provider for CurioCat.
    """

    def __init__(self) -> None:
        pass

    async def search(self, query: str, count: int = 5) -> list[dict[str, Any]]:
        """Execute a web search query via DuckDuckGo.

        Args:
            query: The search query string.
            count: Number of results to return.

        Returns:
            A list of dicts with title, url, snippet keys.

        Raises:
            PipelineError: If the search fails.
        """
        try:
            from ddgs import DDGS

            def _sync_search() -> list[dict[str, Any]]:
                with DDGS() as ddgs:
                    raw = list(ddgs.text(query, max_results=count))
                return raw

            raw_results = await asyncio.to_thread(_sync_search)
        except ImportError:
            raise PipelineError(
                "ddgs is not installed. Run: uv pip install ddgs"
            )
        except Exception as exc:
            raise PipelineError(f"DuckDuckGo search failed: {exc}") from exc

        results: list[dict[str, Any]] = []
        for item in raw_results[:count]:
            results.append({
                "title": item.get("title", ""),
                "url": item.get("href", ""),
                "snippet": item.get("body", ""),
            })

        logger.debug(
            "DuckDuckGo returned %d results for: %s", len(results), query
        )
        return results

    async def close(self) -> None:
        """No-op: DuckDuckGo client has no persistent connection."""
        pass


class BraveSearchClient:
    """Async client for the Brave Web Search API.

    Requires a Brave Search API key. Used as an alternative to DuckDuckGo
    when higher quality or rate limits are needed.
    """

    BASE_URL = "https://api.search.brave.com/res/v1/web/search"

    def __init__(self, api_key: str) -> None:
        if not api_key:
            raise PipelineError("Brave Search API key is required")
        self._api_key = api_key
        self._client = httpx.AsyncClient(
            timeout=httpx.Timeout(30.0),
            headers={
                "Accept": "application/json",
                "Accept-Encoding": "gzip",
                "X-Subscription-Token": api_key,
            },
        )

    async def search(self, query: str, count: int = 5) -> list[dict[str, Any]]:
        """Execute a web search query via the Brave Search API.

        Args:
            query: The search query string.
            count: Number of results to return (max 20).

        Returns:
            A list of dicts with title, url, snippet keys.

        Raises:
            PipelineError: If the API call fails.
        """
        try:
            response = await self._client.get(
                self.BASE_URL,
                params={"q": query, "count": min(count, 20)},
            )
            response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            raise PipelineError(
                f"Brave Search API returned {exc.response.status_code}: "
                f"{exc.response.text}"
            ) from exc
        except httpx.RequestError as exc:
            raise PipelineError(
                f"Brave Search request failed: {exc}"
            ) from exc

        data = response.json()
        web_results = data.get("web", {}).get("results", [])

        results: list[dict[str, Any]] = []
        for item in web_results[:count]:
            results.append({
                "title": item.get("title", ""),
                "url": item.get("url", ""),
                "snippet": item.get("description", ""),
            })

        logger.debug("Brave Search returned %d results for: %s", len(results), query)
        return results

    async def close(self) -> None:
        """Close the underlying HTTP client."""
        await self._client.aclose()
