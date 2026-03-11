"""Stage 3: Evidence Grounding.

Searches for supporting and contradicting evidence for each causal edge,
then scores relevance and credibility to compute an evidence score.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable
from datetime import datetime, timezone
from typing import Any

from curiocat.evidence.scorer import score_credibility
from curiocat.evidence.web_search import BraveSearchClient
from curiocat.exceptions import PipelineError
from curiocat.llm.client import LLMClient
from curiocat.llm.prompts.evidence_search import (
    EVIDENCE_RELEVANCE_SCHEMA,
    EVIDENCE_RELEVANCE_SYSTEM,
)

logger = logging.getLogger(__name__)

# Maximum concurrent evidence search/scoring tasks
_MAX_CONCURRENT_SEARCHES = 3

# Edges below this causal strength threshold are skipped (zero evidence)
_MIN_STRENGTH_FOR_GROUNDING = 0.3

# Search result counts per edge
_SUPPORT_RESULT_COUNT = 3
_CONTRA_RESULT_COUNT = 2

# Brave Search limits: 50 words and 400 characters
_MAX_QUERY_WORDS = 40  # Leave headroom for the prefix
_MAX_QUERY_CHARS = 380


def _truncate_query(query: str) -> str:
    """Truncate a search query to fit Brave Search API limits."""
    # Truncate by word count first
    words = query.split()
    if len(words) > _MAX_QUERY_WORDS:
        query = " ".join(words[:_MAX_QUERY_WORDS])
    # Then by character count
    if len(query) > _MAX_QUERY_CHARS:
        query = query[:_MAX_QUERY_CHARS]
    return query


class EvidenceGrounder:
    """Grounds causal edges with web-sourced evidence.

    For each edge, searches for both supporting and contradicting evidence,
    scores relevance via LLM, computes source credibility, and produces
    a composite evidence score.
    """

    def __init__(self, llm: LLMClient, search_client: BraveSearchClient) -> None:
        self._llm = llm
        self._search = search_client

    async def ground(
        self,
        claims: list[dict[str, Any]],
        edges: list[dict[str, Any]],
        on_progress: Callable[[int, int, dict[str, Any]], Awaitable[None]] | None = None,
    ) -> list[dict[str, Any]]:
        """Ground each causal edge with web evidence.

        For each edge:
        1. Construct search queries from source/target claims + mechanism.
        2. Search for supporting evidence.
        3. Search for contradicting evidence.
        4. For each result, use the LLM to score relevance.
        5. Classify source and score credibility.
        6. Compute a composite evidence_score for the edge.

        Args:
            claims: The list of claim dicts (with "text" keys).
            edges: The list of edge dicts from the causal inferrer.
            on_progress: Optional callback invoked after each edge is grounded.
                Signature: (completed_count, total_count, grounded_edge).

        Returns:
            Updated edge dicts with "evidence_score" and "evidences" attached.

        Raises:
            PipelineError: If evidence grounding fails critically.
        """
        if not edges:
            return edges

        # Partition edges: skip weak edges (below strength threshold)
        edges_to_ground: list[tuple[int, dict[str, Any]]] = []
        skipped_edges: list[tuple[int, dict[str, Any]]] = []
        for i, edge in enumerate(edges):
            if edge.get("strength", 0.5) < _MIN_STRENGTH_FOR_GROUNDING:
                skipped_edges.append((i, edge))
            else:
                edges_to_ground.append((i, edge))

        if skipped_edges:
            logger.info(
                "Evidence grounding: skipping %d/%d edges with strength < %.2f",
                len(skipped_edges), len(edges), _MIN_STRENGTH_FOR_GROUNDING,
            )

        total = len(edges)
        semaphore = asyncio.Semaphore(_MAX_CONCURRENT_SEARCHES)
        lock = asyncio.Lock()
        completed = 0
        grounded_edges: list[dict[str, Any]] = []

        async def _ground_and_report(i: int, edge: dict[str, Any]) -> dict[str, Any]:
            nonlocal completed
            result = await self._ground_edge(claims, edge, semaphore)
            async with lock:
                completed += 1
                grounded_edges.append(result)
                if on_progress:
                    await on_progress(completed, total, result)
            return result

        results_map: dict[int, dict[str, Any]] = {}

        # Ground eligible edges
        if edges_to_ground:
            results = await asyncio.gather(
                *(_ground_and_report(i, e) for i, e in edges_to_ground),
                return_exceptions=True,
            )
            for (orig_idx, orig_edge), result in zip(edges_to_ground, results):
                if isinstance(result, Exception):
                    logger.warning(
                        "Evidence grounding failed for edge %d: %s", orig_idx, result
                    )
                    fallback = orig_edge.copy()
                    fallback["evidence_score"] = 0.5
                    fallback["evidences"] = []
                    results_map[orig_idx] = fallback
                else:
                    results_map[orig_idx] = result

        # Assign zero evidence to skipped weak edges
        for orig_idx, edge in skipped_edges:
            skipped = edge.copy()
            skipped["evidence_score"] = 0.0
            skipped["evidences"] = []
            results_map[orig_idx] = skipped
            # Report progress for skipped edges too
            async with lock:
                completed += 1
                if on_progress:
                    await on_progress(completed, total, skipped)

        # Reassemble in original order
        return [results_map[i] for i in range(len(edges))]

    async def _ground_edge(
        self,
        claims: list[dict[str, Any]],
        edge: dict[str, Any],
        semaphore: asyncio.Semaphore,
    ) -> dict[str, Any]:
        """Ground a single causal edge with evidence.

        Args:
            claims: All claims.
            edge: The edge dict to ground.
            semaphore: Concurrency limiter.

        Returns:
            Updated edge dict with evidence data.
        """
        async with semaphore:
            source_text = claims[edge["source_idx"]]["text"]
            target_text = claims[edge["target_idx"]]["text"]
            mechanism = edge.get("mechanism", "")

            # Construct the causal claim description for search
            causal_claim = (
                f"{source_text} causes {target_text} through {mechanism}"
            )

            # Search for supporting evidence
            support_query = _truncate_query(
                f"evidence {mechanism} {source_text[:100]}"
            )
            try:
                support_results = await self._search.search(support_query, count=_SUPPORT_RESULT_COUNT)
            except PipelineError as exc:
                logger.warning("Supporting evidence search failed for edge: %s", exc)
                support_results = []

            # Search for contradicting evidence
            contra_query = _truncate_query(
                f"counter-evidence against {mechanism} {target_text[:100]}"
            )
            try:
                contra_results = await self._search.search(contra_query, count=_CONTRA_RESULT_COUNT)
            except PipelineError as exc:
                logger.warning("Contradicting evidence search failed for edge: %s", exc)
                contra_results = []

            # Score each result
            all_evidences: list[dict[str, Any]] = []

            for search_result in support_results:
                evidence = await self._score_evidence(
                    causal_claim, search_result, "supporting"
                )
                if evidence is not None:
                    all_evidences.append(evidence)

            for search_result in contra_results:
                evidence = await self._score_evidence(
                    causal_claim, search_result, "contradicting"
                )
                if evidence is not None:
                    all_evidences.append(evidence)

            # Compute composite evidence score
            evidence_score = self._compute_evidence_score(all_evidences)

            updated_edge = edge.copy()
            updated_edge["evidence_score"] = evidence_score
            updated_edge["evidences"] = all_evidences
            return updated_edge

    async def _score_evidence(
        self,
        causal_claim: str,
        search_result: dict[str, Any],
        search_type: str,
    ) -> dict[str, Any] | None:
        """Score a single search result for relevance to the causal claim.

        Args:
            causal_claim: Text description of the causal relationship.
            search_result: Dict with title, url, snippet.
            search_type: "supporting" or "contradicting".

        Returns:
            An evidence dict or None if scoring fails.
        """
        snippet = search_result.get("snippet", "")
        if not snippet:
            return None

        user_prompt = (
            f"CAUSAL CLAIM: {causal_claim}\n\n"
            f"EVIDENCE SNIPPET:\n"
            f"Title: {search_result.get('title', '')}\n"
            f"Source: {search_result.get('url', '')}\n"
            f"Content: {snippet}"
        )

        try:
            result = await self._llm.complete_json(
                system=EVIDENCE_RELEVANCE_SYSTEM,
                user=user_prompt,
                schema=EVIDENCE_RELEVANCE_SCHEMA,
            )
        except Exception as exc:
            logger.warning("Evidence scoring LLM call failed: %s", exc)
            return None

        # Classify source credibility (with social media tier)
        url = search_result.get("url", "")
        source_type, credibility = score_credibility(url)

        # Check for social media sources
        source_tier = _source_type_to_tier(source_type)

        # Extract published date and compute freshness
        published_date = _parse_page_age(search_result.get("page_age"))
        freshness = compute_freshness_score(published_date)

        return {
            "evidence_type": "supporting" if result.get("is_supporting", True) else "contradicting",
            "source_url": url,
            "source_title": search_result.get("title", ""),
            "source_type": source_type,
            "snippet": snippet,
            "relevance_score": result.get("relevance_score", 0.0),
            "credibility_score": credibility,
            "summary": result.get("summary", ""),
            "source_tier": source_tier,
            "published_date": published_date,
            "freshness_score": freshness,
        }

    @staticmethod
    def _compute_evidence_score(evidences: list[dict[str, Any]]) -> float:
        """Compute a composite evidence score from individual evidence items.

        Incorporates freshness and source tier as multipliers.

        Args:
            evidences: List of scored evidence dicts.

        Returns:
            A float between 0.0 and 1.0 representing the overall evidence score.
        """
        if not evidences:
            return 0.5  # Neutral when no evidence is available

        supporting_scores: list[float] = []
        contradicting_scores: list[float] = []

        for ev in evidences:
            tier = ev.get("source_tier", 4)
            freshness = ev.get("freshness_score", 0.5)
            tier_multiplier = 1.0 - ((tier - 1) / 10.0)
            weighted = (
                ev["relevance_score"]
                * ev["credibility_score"]
                * freshness
                * tier_multiplier
            )
            if ev["evidence_type"] == "supporting":
                supporting_scores.append(weighted)
            else:
                contradicting_scores.append(weighted)

        support_avg = (
            sum(supporting_scores) / len(supporting_scores)
            if supporting_scores
            else 0.0
        )
        contra_avg = (
            sum(contradicting_scores) / len(contradicting_scores)
            if contradicting_scores
            else 0.0
        )

        # Combine: more support raises the score, contradictions lower it
        raw_score = 0.5 + 0.5 * (support_avg - contra_avg)

        # Source diversity: penalize if all evidence from same domain
        domains: set[str] = set()
        for ev in evidences:
            url = ev.get("source_url", "")
            try:
                from urllib.parse import urlparse
                domain = urlparse(url).netloc.replace("www.", "")
                if domain:
                    domains.add(domain)
            except Exception:
                pass
        unique_domains = len(domains) if domains else 1
        total_evidences = len(evidences)
        diversity_factor = min(1.0, unique_domains / max(1, total_evidences * 0.5))
        raw_score *= 0.7 + 0.3 * diversity_factor  # Up to 30% penalty for no diversity

        return max(0.0, min(1.0, raw_score))

    @staticmethod
    def compute_consensus_level(evidences: list[dict[str, Any]]) -> str:
        """Compute consensus level from evidence list.

        Returns one of: strong_support, moderate_support, contested,
        moderate_opposition, strong_opposition, insufficient.
        """
        if not evidences:
            return "insufficient"

        supporting = [e for e in evidences if e.get("evidence_type") == "supporting"]
        contradicting = [e for e in evidences if e.get("evidence_type") == "contradicting"]

        total = len(evidences)
        if total < 2:
            return "insufficient"

        support_ratio = len(supporting) / total

        if support_ratio >= 0.8:
            return "strong_support"
        if support_ratio >= 0.6:
            return "moderate_support"
        if support_ratio >= 0.4:
            return "contested"
        if support_ratio >= 0.2:
            return "moderate_opposition"
        return "strong_opposition"


# --- Module-level helpers ---

_SOURCE_TIER_MAP = {
    "academic": 1,
    "news": 3,
    "blog": 4,
    "forum": 5,
    "social": 6,
    "other": 4,
}

# Social media domains
_SOCIAL_DOMAINS = {
    "twitter.com", "x.com", "facebook.com", "instagram.com",
    "tiktok.com", "threads.net", "mastodon.social",
}


def _source_type_to_tier(source_type: str) -> int:
    """Map source_type string to numeric tier."""
    return _SOURCE_TIER_MAP.get(source_type, 4)


def _parse_page_age(page_age: str | None) -> datetime | None:
    """Parse Brave Search page_age field into a datetime."""
    if not page_age:
        return None
    try:
        # Brave returns ISO format dates
        return datetime.fromisoformat(page_age.replace("Z", "+00:00"))
    except (ValueError, AttributeError):
        return None


def compute_freshness_score(published_date: datetime | None) -> float:
    """Compute freshness score from published date.

    Maps age to [0.1, 1.0]:
    - < 1 month: 1.0
    - 1-6 months: 0.8
    - 6-12 months: 0.6
    - 1-3 years: 0.4
    - 3-5 years: 0.25
    - > 5 years: 0.1
    """
    if published_date is None:
        return 0.5  # Unknown age

    now = datetime.now(timezone.utc)
    if published_date.tzinfo is None:
        published_date = published_date.replace(tzinfo=timezone.utc)

    age_days = (now - published_date).days

    if age_days < 30:
        return 1.0
    if age_days < 180:
        return 0.8
    if age_days < 365:
        return 0.6
    if age_days < 1095:
        return 0.4
    if age_days < 1825:
        return 0.25
    return 0.1
