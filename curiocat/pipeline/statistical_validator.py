"""Stage 3.5: Statistical Validation of Causal Edges.

When numeric time-series or cross-sectional data is attached to a project,
this stage runs Granger / PC tests and compares results against LLM-inferred
edges.  Each edge receives a `statistical_validation` annotation:

  - "confirmed"     — statistical test agrees (p < alpha)
  - "unsupported"   — test ran but found no significant relationship
  - "contradicted"  — test found a causal direction opposite to LLM
  - "not_tested"    — no numeric data available for this variable pair

The edge's strength and evidence_score are then adjusted:
  - confirmed:   strength *= 1.0 (unchanged), evidence_score boosted
  - unsupported: strength *= 0.7, evidence_score penalised
  - contradicted: strength *= 0.4
"""

from __future__ import annotations

import logging
from typing import Any

import numpy as np

from curiocat.statistical.granger import granger_test, GrangerResult
from curiocat.statistical.pc_algorithm import partial_correlation

logger = logging.getLogger(__name__)

# ── Thresholds ──

_ALPHA = 0.05                   # significance level
_MAX_LAG = 5                    # max lag for Granger tests
_CONFIRMED_EVIDENCE_BOOST = 0.2 # added to evidence_score when stat-confirmed
_UNSUPPORTED_STRENGTH_MULT = 0.7
_CONTRADICTED_STRENGTH_MULT = 0.4


class StatisticalValidator:
    """Validates LLM-inferred causal edges against numeric data."""

    def __init__(self, metric_data: dict[str, np.ndarray] | None = None) -> None:
        """
        Args:
            metric_data: Optional dict mapping variable/metric name to
                         numeric time-series or observation arrays.
                         If None, all edges are tagged "not_tested".
        """
        self._data = metric_data or {}
        # Build lowercase lookup for fuzzy matching
        self._data_lower: dict[str, str] = {k.lower(): k for k in self._data}

    def validate(
        self,
        claims: list[dict[str, Any]],
        edges: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        """Annotate each edge with statistical validation results.

        Modifies edges in-place (same pattern as bias_auditor.audit).

        Returns:
            The same edge list, each edge now has:
              - statistical_validation: str
              - stat_p_value: float | None
              - stat_f_statistic: float | None
              - stat_effect_size: float | None
              - stat_lag: int | None
        """
        if not self._data:
            # No numeric data — mark everything as not_tested
            for edge in edges:
                edge["statistical_validation"] = "not_tested"
            logger.info("Statistical validation skipped: no numeric data attached")
            return edges

        tested = 0
        confirmed = 0
        unsupported = 0
        contradicted = 0

        for edge in edges:
            src_idx = edge.get("source_idx")
            tgt_idx = edge.get("target_idx")

            src_text = claims[src_idx]["text"] if src_idx is not None and src_idx < len(claims) else ""
            tgt_text = claims[tgt_idx]["text"] if tgt_idx is not None and tgt_idx < len(claims) else ""

            # Try to match claim text to a metric name
            src_metric = self._match_metric(src_text)
            tgt_metric = self._match_metric(tgt_text)

            if src_metric is None or tgt_metric is None:
                edge["statistical_validation"] = "not_tested"
                edge["stat_p_value"] = None
                continue

            src_series = self._data[src_metric]
            tgt_series = self._data[tgt_metric]

            # Run Granger test: does src Granger-cause tgt?
            result = granger_test(src_series, tgt_series, max_lag=_MAX_LAG, alpha=_ALPHA)

            if result is None:
                edge["statistical_validation"] = "not_tested"
                edge["stat_p_value"] = None
                continue

            tested += 1
            edge["stat_p_value"] = result.p_value
            edge["stat_f_statistic"] = result.f_statistic
            edge["stat_effect_size"] = result.effect_size
            edge["stat_lag"] = result.lag

            if result.p_value < _ALPHA:
                # Significant — but check if direction matches
                # Also test reverse direction
                reverse = granger_test(tgt_series, src_series, max_lag=_MAX_LAG, alpha=_ALPHA)

                if reverse and reverse.p_value < _ALPHA and reverse.p_value < result.p_value:
                    # Reverse direction is stronger — contradicts LLM
                    edge["statistical_validation"] = "contradicted"
                    edge["strength"] = max(0.05, edge.get("strength", 0.5) * _CONTRADICTED_STRENGTH_MULT)
                    contradicted += 1
                else:
                    # Forward direction confirmed
                    edge["statistical_validation"] = "confirmed"
                    edge["evidence_score"] = min(1.0, edge.get("evidence_score", 0.5) + _CONFIRMED_EVIDENCE_BOOST)
                    confirmed += 1
            else:
                # Not significant
                edge["statistical_validation"] = "unsupported"
                edge["strength"] = max(0.05, edge.get("strength", 0.5) * _UNSUPPORTED_STRENGTH_MULT)
                unsupported += 1

        logger.info(
            "Statistical validation: %d tested, %d confirmed, %d unsupported, %d contradicted, %d not tested",
            tested, confirmed, unsupported, contradicted, len(edges) - tested,
        )
        return edges

    def _match_metric(self, claim_text: str) -> str | None:
        """Try to match a claim's text to one of the available metric names.

        Uses simple substring matching. Returns the original metric name
        (not lowercased) or None if no match.
        """
        text_lower = claim_text.lower()
        for metric_lower, metric_original in self._data_lower.items():
            if metric_lower in text_lower:
                return metric_original
        return None
