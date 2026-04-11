"""Three-layer causal engine orchestrator for CurioCat.

Routes data through up to three layers depending on data quality:
  Layer 1 (LLM):        Hypothesis generation via CurioCat's existing pipeline
  Layer 2 (Monitoring):  Online drift detection, confidence decay (future)
  Layer 3 (Statistical): Granger causality, PC algorithm

Produces multi-layer evidence with confidence tiers and fused edge output.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from enum import Enum

import numpy as np

from curiocat.llm.client import LLMClient
from curiocat.statistical.granger import granger_matrix, GrangerResult
from curiocat.statistical.pc_algorithm import pc_algorithm, PCResult

logger = logging.getLogger(__name__)


class DataQuality(str, Enum):
    STRUCTURED_SUFFICIENT = "structured_sufficient"
    STRUCTURED_SPARSE = "structured_sparse"
    SEMI_STRUCTURED = "semi_structured"
    UNSTRUCTURED = "unstructured"


class ConfidenceTier(str, Enum):
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"
    UNVERIFIED = "unverified"


@dataclass
class EvidenceItem:
    source_label: str
    target_label: str
    layer: int
    algorithm: str
    edge_type: str
    confidence: float
    p_value: float | None = None
    effect_size: float | None = None
    lag: int | None = None
    reason: str | None = None
    data_type: str = "unknown"
    sample_size: int | None = None


@dataclass
class FusedEdge:
    source_label: str
    target_label: str
    evidence: list[EvidenceItem]
    verdict: str
    confidence_tier: ConfidenceTier
    fused_confidence: float
    best_p_value: float | None = None
    best_lag: int | None = None


@dataclass
class ThreeLayerResult:
    edges: list[FusedEdge]
    data_quality: DataQuality
    layers_used: list[int]
    summary: str | None = None
    raw_evidence: list[EvidenceItem] = field(default_factory=list)


class ThreeLayerEngine:
    """Orchestrates three-layer causal analysis."""

    def __init__(self, llm: LLMClient) -> None:
        self._llm = llm

    # P-value thresholds for statistical prior filtering.
    # Edges with p < _P_CLEAR_CONFIRM are accepted without LLM.
    # Edges with p > _P_CLEAR_REJECT are rejected without LLM.
    # Edges in between (the "grey zone") are sent to LLM for judgment.
    _P_CLEAR_CONFIRM = 0.01
    _P_CLEAR_REJECT = 0.10

    async def analyze(
        self,
        *,
        time_series: dict[str, np.ndarray] | None = None,
        cross_section: dict[str, np.ndarray] | None = None,
        context_text: str | None = None,
        question: str | None = None,
        max_lag: int = 5,
        alpha: float = 0.05,
    ) -> ThreeLayerResult:
        quality = self._assess_quality(time_series, cross_section, context_text)
        all_evidence: list[EvidenceItem] = []
        layers_used: list[int] = []

        # Layer 3: Statistical tests
        stat_evidence: list[EvidenceItem] = []
        if quality in (DataQuality.STRUCTURED_SUFFICIENT, DataQuality.STRUCTURED_SPARSE):
            if time_series and self._has_enough_data(time_series, 20):
                stat_evidence.extend(self._run_granger(time_series, max_lag, alpha))

            if cross_section and self._has_enough_data(cross_section, 10):
                stat_evidence.extend(self._run_pc(cross_section, alpha))

        if stat_evidence:
            all_evidence.extend(stat_evidence)
            layers_used.append(3)

        # Statistical prior filtering: partition edges by p-value clarity
        # Only send ambiguous edges to LLM, skip clear confirmations/rejections
        confirmed_pairs: set[tuple[str, str]] = set()
        rejected_pairs: set[tuple[str, str]] = set()
        ambiguous_evidence: list[EvidenceItem] = []

        for ev in stat_evidence:
            if ev.p_value is not None:
                pair = (ev.source_label, ev.target_label)
                if ev.p_value < self._P_CLEAR_CONFIRM:
                    confirmed_pairs.add(pair)
                    logger.info(
                        "Stat filter: CONFIRMED %s → %s (p=%.4f, skipping LLM)",
                        ev.source_label, ev.target_label, ev.p_value,
                    )
                elif ev.p_value > self._P_CLEAR_REJECT:
                    rejected_pairs.add(pair)
                    logger.info(
                        "Stat filter: REJECTED %s → %s (p=%.4f, skipping LLM)",
                        ev.source_label, ev.target_label, ev.p_value,
                    )
                else:
                    ambiguous_evidence.append(ev)
                    logger.info(
                        "Stat filter: AMBIGUOUS %s → %s (p=%.4f, sending to LLM)",
                        ev.source_label, ev.target_label, ev.p_value,
                    )

        # Layer 1: LLM reasoning — only for ambiguous edges + text-based discovery
        if context_text or question:
            llm_ev = await self._run_llm_reasoning(
                context_text=context_text,
                question=question,
                time_series_names=list(time_series.keys()) if time_series else None,
                cross_section_names=list(cross_section.keys()) if cross_section else None,
                statistical_results=ambiguous_evidence,  # Only pass ambiguous edges
                confirmed_pairs=confirmed_pairs,
                rejected_pairs=rejected_pairs,
            )
            all_evidence.extend(llm_ev)
            if llm_ev:
                layers_used.append(1)

        fused_edges = self._fuse_evidence(all_evidence)

        summary = None
        if question and fused_edges:
            summary = await self._generate_summary(question, fused_edges)

        layers_used.sort()

        return ThreeLayerResult(
            edges=fused_edges,
            data_quality=quality,
            layers_used=layers_used,
            summary=summary,
            raw_evidence=all_evidence,
        )

    # ── Layer 3 ──

    def _run_granger(self, data: dict[str, np.ndarray], max_lag: int, alpha: float) -> list[EvidenceItem]:
        results = granger_matrix(data, max_lag=max_lag, alpha=alpha)
        return [
            EvidenceItem(
                source_label=r.source, target_label=r.target, layer=3, algorithm="granger",
                edge_type="directed", confidence=1.0 - r.p_value, p_value=r.p_value,
                effect_size=r.effect_size, lag=r.lag,
                reason=f"Granger causality: F={r.f_statistic:.2f}, lag={r.lag}",
                data_type="time_series", sample_size=len(next(iter(data.values()))),
            )
            for r in results
        ]

    def _run_pc(self, data: dict[str, np.ndarray], alpha: float) -> list[EvidenceItem]:
        result = pc_algorithm(data, alpha=alpha)
        return [
            EvidenceItem(
                source_label=e.source, target_label=e.target, layer=3, algorithm="pc",
                edge_type=e.edge_type, confidence=1.0 - e.p_value, p_value=e.p_value,
                effect_size=e.partial_corr,
                reason=f"PC algorithm: partial_corr={e.partial_corr:.3f}",
                data_type="cross_section", sample_size=result.n_samples,
            )
            for e in result.edges
        ]

    # ── Layer 1 ──

    async def _run_llm_reasoning(
        self,
        *,
        context_text,
        question,
        time_series_names,
        cross_section_names,
        statistical_results,
        confirmed_pairs: set[tuple[str, str]] | None = None,
        rejected_pairs: set[tuple[str, str]] | None = None,
    ) -> list[EvidenceItem]:
        user_parts = []
        if question:
            user_parts.append(f"Question: {question}")
        if context_text:
            user_parts.append(f"Context:\n{context_text}")
        if time_series_names:
            user_parts.append(f"Time series variables: {', '.join(time_series_names)}")
        if cross_section_names:
            user_parts.append(f"Cross-section variables: {', '.join(cross_section_names)}")

        # Include statistically confirmed edges as facts (no need to re-evaluate)
        if confirmed_pairs:
            confirmed_text = "\n".join(
                f"  - {s} → {t} (statistically confirmed, p<0.01)"
                for s, t in confirmed_pairs
            )
            user_parts.append(
                f"Already confirmed causal links (do NOT re-evaluate, treat as given):\n{confirmed_text}"
            )

        # Include rejected pairs so LLM doesn't hallucinate them
        if rejected_pairs:
            rejected_text = "\n".join(
                f"  - {s} → {t} (statistically rejected, p>0.10)"
                for s, t in rejected_pairs
            )
            user_parts.append(
                f"Statistically rejected links (do NOT propose unless you have strong domain reason):\n{rejected_text}"
            )

        # Only pass ambiguous statistical findings for LLM evaluation
        if statistical_results:
            stat_summary = "\n".join(
                f"  - {e.source_label} → {e.target_label} "
                f"(algorithm={e.algorithm}, p={e.p_value:.4f}, effect={e.effect_size:.3f})"
                for e in statistical_results if e.p_value is not None
            )
            user_parts.append(f"Ambiguous statistical findings (need your judgment):\n{stat_summary}")

        user_prompt = "\n\n".join(user_parts)

        try:
            result = await self._llm.complete_json(
                system=_LLM_CAUSAL_SYSTEM,
                user=user_prompt,
                schema=_LLM_CAUSAL_SCHEMA,
            )
        except Exception as exc:
            logger.warning("LLM causal reasoning failed: %s", exc)
            return []

        evidence = []
        for edge in result.get("causal_edges", []):
            evidence.append(EvidenceItem(
                source_label=edge.get("source", ""), target_label=edge.get("target", ""),
                layer=1, algorithm="llm", edge_type=edge.get("edge_type", "hypothesized"),
                confidence=edge.get("confidence", 0.5), reason=edge.get("reason", ""),
                data_type="text",
            ))
        for hv in result.get("hidden_variables", []):
            evidence.append(EvidenceItem(
                source_label=hv.get("name", "unknown_latent"), target_label=hv.get("affects", ""),
                layer=1, algorithm="llm", edge_type="hypothesized",
                confidence=hv.get("confidence", 0.3),
                reason=hv.get("reason", "LLM-hypothesized hidden variable"),
                data_type="text",
            ))
        return evidence

    # ── Evidence Fusion ──

    def _fuse_evidence(self, evidence: list[EvidenceItem]) -> list[FusedEdge]:
        groups: dict[tuple[str, str], list[EvidenceItem]] = {}
        for e in evidence:
            groups.setdefault((e.source_label, e.target_label), []).append(e)

        fused = [self._fuse_group(src, tgt, items) for (src, tgt), items in groups.items()]
        fused.sort(key=lambda e: e.fused_confidence, reverse=True)
        return fused

    def _fuse_group(self, src: str, tgt: str, items: list[EvidenceItem]) -> FusedEdge:
        """Fuse evidence from multiple layers using multiplicative prior.

        When both statistical (Layer 3) and LLM (Layer 1) evidence exist,
        uses P_fused = P_stat * P_llm (normalized) for principled combination
        rather than simple averaging.
        """
        layers_present = {e.layer for e in items}
        p_values = [e.p_value for e in items if e.p_value is not None]
        best_p = min(p_values) if p_values else None
        lags = [e.lag for e in items if e.lag is not None]
        best_lag = min(lags) if lags else None

        stat_items = [e for e in items if e.layer == 3]
        llm_items = [e for e in items if e.layer == 1]
        has_strong_stat = any(e.confidence > 0.95 for e in stat_items)

        if has_strong_stat:
            verdict, tier = "confirmed", ConfidenceTier.HIGH
            fused_conf = max(e.confidence for e in stat_items)
        elif stat_items and llm_items:
            # Multiplicative prior fusion: P_fused = P_stat * P_llm
            stat_conf = max(e.confidence for e in stat_items)
            llm_conf = max(e.confidence for e in llm_items)
            fused_conf = float(stat_conf * llm_conf)
            # Normalize: boost slightly since agreement is informative
            fused_conf = min(1.0, fused_conf * 1.2)

            agreeing = sum(1 for e in items if e.edge_type in ("directed", "undirected"))
            if agreeing >= 2:
                verdict, tier = "supported", ConfidenceTier.MEDIUM
            else:
                verdict, tier = "conflicted", ConfidenceTier.LOW
        elif stat_items:
            verdict, tier = "supported", ConfidenceTier.MEDIUM
            fused_conf = float(np.mean([e.confidence for e in stat_items]))
        else:
            verdict, tier = "hypothesized", ConfidenceTier.UNVERIFIED
            fused_conf = max(e.confidence for e in items) * 0.7

        return FusedEdge(
            source_label=src, target_label=tgt, evidence=items,
            verdict=verdict, confidence_tier=tier, fused_confidence=float(fused_conf),
            best_p_value=best_p, best_lag=best_lag,
        )

    # ── Summary ──

    async def _generate_summary(self, question: str, edges: list[FusedEdge]) -> str:
        edges_text = "\n".join(
            f"- {e.source_label} → {e.target_label} [{e.verdict}, {e.confidence_tier.value}, "
            f"conf={e.fused_confidence:.2f}{f', p={e.best_p_value:.4f}' if e.best_p_value else ''}"
            f"{f', lag={e.best_lag}' if e.best_lag else ''}]"
            for e in edges[:15]
        )
        try:
            return await self._llm.complete(
                system="You are a causal analysis assistant. Explain findings clearly without jargon. Always mention confidence levels.",
                user=f"Question: {question}\n\nCausal analysis results:\n{edges_text}\n\nWrite a concise summary for a PM.",
                max_tokens=1024,
            )
        except Exception as exc:
            logger.warning("Summary generation failed: %s", exc)
            return ""

    # ── Helpers ──

    def _assess_quality(self, ts, cs, text) -> DataQuality:
        if ts and len(ts) >= 2:
            return DataQuality.STRUCTURED_SUFFICIENT if min(len(v) for v in ts.values()) >= 30 else DataQuality.STRUCTURED_SPARSE
        if cs and len(cs) >= 2:
            return DataQuality.STRUCTURED_SUFFICIENT if min(len(v) for v in cs.values()) >= 20 else DataQuality.STRUCTURED_SPARSE
        if text and len(text) > 100:
            return DataQuality.SEMI_STRUCTURED
        return DataQuality.UNSTRUCTURED

    def _has_enough_data(self, data: dict[str, np.ndarray], min_points: int) -> bool:
        return all(len(v) >= min_points for v in data.values())


# ── LLM Prompts ──

_LLM_CAUSAL_SYSTEM = """\
You are a causal reasoning engine. Given context about a business situation, \
identify causal relationships between variables or events.

For each causal relationship, provide:
- source: the cause variable/event
- target: the effect variable/event
- edge_type: "directed" (confident), "uncertain" (possible), or "hypothesized" (speculative)
- confidence: 0.0-1.0
- reason: brief explanation of the causal mechanism

Also identify potential hidden/confounding variables that might explain \
observed correlations but aren't directly measured.

If statistical findings are provided, use them to strengthen or weaken \
your causal hypotheses. Do NOT contradict strong statistical evidence \
(p < 0.01) without a compelling reason.

Output JSON."""

_LLM_CAUSAL_SCHEMA = {
    "type": "object",
    "properties": {
        "causal_edges": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "source": {"type": "string"},
                    "target": {"type": "string"},
                    "edge_type": {"type": "string", "enum": ["directed", "uncertain", "hypothesized"]},
                    "confidence": {"type": "number"},
                    "reason": {"type": "string"},
                },
                "required": ["source", "target", "edge_type", "confidence", "reason"],
            },
        },
        "hidden_variables": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "name": {"type": "string"},
                    "affects": {"type": "string"},
                    "confidence": {"type": "number"},
                    "reason": {"type": "string"},
                },
                "required": ["name", "affects", "reason"],
            },
        },
    },
    "required": ["causal_edges", "hidden_variables"],
}
