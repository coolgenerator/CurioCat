"""Stage 2.5: Cognitive Bias Auditing.

Audits each causal edge for cognitive biases and applies a mechanism
penalty to edges missing a substantive mechanism description.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from curiocat.llm.client import LLMClient
from curiocat.llm.prompts.bias_detection import (
    BIAS_DETECTION_SCHEMA,
    BIAS_DETECTION_SYSTEM,
)

logger = logging.getLogger(__name__)

_MAX_CONCURRENT_AUDITS = 5


class BiasAuditor:
    """Audits causal edges for cognitive biases.

    Two checks per edge:
    1. Mechanism penalty: edges with empty/missing mechanism get strength *= 0.5.
    2. LLM-based bias detection: flags correlation_not_causation,
       survivorship_bias, narrative_fallacy, anchoring_effect.
    """

    def __init__(self, llm: LLMClient) -> None:
        self._llm = llm

    async def audit(
        self,
        claims: list[dict[str, Any]],
        edges: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        """Audit all edges for biases.

        Args:
            claims: List of claim dicts with "text" keys.
            edges: List of edge dicts from causal inference.

        Returns:
            Updated edge dicts with "bias_warnings" lists attached.
            Edges missing mechanisms also get strength reduced by 50%.
        """
        if not edges:
            return edges

        semaphore = asyncio.Semaphore(_MAX_CONCURRENT_AUDITS)
        tasks = [
            self._audit_edge(claims, edge, semaphore)
            for edge in edges
        ]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        audited_edges: list[dict[str, Any]] = []
        for i, result in enumerate(results):
            if isinstance(result, Exception):
                logger.warning("Bias audit failed for edge %d: %s", i, result)
                edge = edges[i].copy()
                edge["bias_warnings"] = []
                audited_edges.append(edge)
            else:
                audited_edges.append(result)

        logger.info("Bias audit complete for %d edges", len(audited_edges))
        return audited_edges

    async def _audit_edge(
        self,
        claims: list[dict[str, Any]],
        edge: dict[str, Any],
        semaphore: asyncio.Semaphore,
    ) -> dict[str, Any]:
        """Audit a single edge for biases."""
        updated = edge.copy()

        # Mechanism penalty
        mechanism = edge.get("mechanism", "").strip()
        if not mechanism:
            updated["strength"] = edge.get("strength", 0.5) * 0.5
            logger.debug("Mechanism penalty applied to edge")

        # LLM bias detection
        source_text = claims[edge["source_idx"]]["text"]
        target_text = claims[edge["target_idx"]]["text"]

        user_prompt = (
            f"CAUSAL RELATIONSHIP:\n"
            f"Cause: {source_text}\n"
            f"Effect: {target_text}\n"
            f"Mechanism: {mechanism or '(none provided)'}\n"
            f"Strength: {edge.get('strength', 0.5)}\n\n"
            f"Analyze this causal link for cognitive biases."
        )

        async with semaphore:
            try:
                result = await self._llm.complete_json(
                    system=BIAS_DETECTION_SYSTEM,
                    user=user_prompt,
                    schema=BIAS_DETECTION_SCHEMA,
                )
                updated["bias_warnings"] = result.get("bias_warnings", [])
            except Exception as exc:
                logger.warning("Bias detection LLM call failed: %s", exc)
                updated["bias_warnings"] = []

        # Apply severity-based strength penalty
        severity_penalties = {"low": 0.95, "medium": 0.80, "high": 0.60}
        for warning in updated.get("bias_warnings", []):
            sev = warning.get("severity", "low")
            penalty = severity_penalties.get(sev, 1.0)
            updated["strength"] = updated.get("strength", 0.5) * penalty
        # Floor strength at 0.05
        updated["strength"] = max(0.05, updated.get("strength", 0.5))

        return updated
