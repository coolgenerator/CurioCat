"""LLM-driven scenario hypothesis analysis.

Analyzes how a hypothetical scenario would affect edge strengths in a causal
graph, producing edge overrides and a narrative report.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import TYPE_CHECKING

import networkx as nx

from curiocat.graph.summarizer import build_scenario_context
from curiocat.llm.client import get_llm_client
from curiocat.llm.prompts import language_instruction
from curiocat.llm.prompts.scenario_analysis import (
    SCENARIO_ANALYSIS_SCHEMA,
    SCENARIO_ANALYSIS_SYSTEM,
)

if TYPE_CHECKING:
    from curiocat.db.models import CausalEdge

logger = logging.getLogger(__name__)


@dataclass
class ScenarioAnalysisResult:
    """Result of LLM scenario analysis."""

    edge_overrides: dict[str, float]  # {edge_uuid: new_strength}
    analysis: str
    key_insights: list[str]
    conclusion: str
    edge_change_reasons: list[dict] = field(default_factory=list)


def _build_user_prompt(
    graph_summary: str,
    scenario_name: str,
    description: str | None,
    injected_events: list[str],
    sample_text: str,
) -> str:
    """Build the user prompt for the LLM call."""
    parts = [
        "# Causal Graph\n",
        graph_summary,
        "\n\n# Scenario Hypothesis\n",
        f"**Name**: {scenario_name}\n",
    ]
    if description:
        parts.append(f"**Description**: {description}\n")
    if injected_events:
        parts.append("**Hypothetical Events**:\n")
        for event in injected_events:
            parts.append(f"- {event}\n")

    # Append language instruction based on graph content language
    parts.append(language_instruction(sample_text))

    return "".join(parts)


async def analyze_scenario(
    graph: nx.DiGraph,
    critical_path: list[str],
    scenario_name: str,
    description: str | None,
    injected_events: list[str],
    edges_orm: list[CausalEdge] | None = None,
) -> ScenarioAnalysisResult:
    """Analyze how a scenario hypothesis would affect the causal graph.

    Args:
        graph: The NetworkX causal graph with belief propagation already run.
        critical_path: List of node IDs on the critical path.
        scenario_name: Name of the scenario.
        description: Optional scenario description.
        injected_events: List of hypothetical events.
        edges_orm: Optional ORM edge objects with loaded evidences for
            rich context (evidence snippets, bias warnings).

    Returns:
        ScenarioAnalysisResult with edge overrides and narrative.
    """
    graph_summary, edge_index_map = build_scenario_context(
        graph, critical_path, edges_orm=edges_orm,
    )

    # Collect sample text from node content for language detection
    sample_texts = [
        graph.nodes[n].get("text", "") for n in list(graph.nodes())[:10]
    ]
    sample_text = " ".join(sample_texts)

    user_prompt = _build_user_prompt(
        graph_summary, scenario_name, description, injected_events, sample_text
    )

    llm = get_llm_client()
    result = await llm.complete_json(
        system=SCENARIO_ANALYSIS_SYSTEM,
        user=user_prompt,
        schema=SCENARIO_ANALYSIS_SCHEMA,
        max_tokens=8192,
    )

    # Map edge indices back to edge UUIDs
    edge_overrides: dict[str, float] = {}
    edge_change_reasons: list[dict] = []

    for change in result.get("edge_changes", []):
        idx = change.get("edge_index")
        new_strength = change.get("new_strength")
        reason = change.get("reason", "")

        if idx is None or new_strength is None:
            continue
        if idx not in edge_index_map:
            logger.warning("LLM returned invalid edge_index %d, skipping", idx)
            continue

        src_id, tgt_id = edge_index_map[idx]
        edge_data = graph.edges.get((src_id, tgt_id), {})
        edge_uuid = edge_data.get("edge_id")
        if not edge_uuid:
            continue

        old_strength = edge_data.get("strength", 0.5)
        new_strength = max(0.0, min(1.0, new_strength))
        edge_overrides[edge_uuid] = new_strength
        edge_change_reasons.append({
            "edge_id": edge_uuid,
            "reason": reason,
            "old_strength": round(old_strength, 3),
            "new_strength": round(new_strength, 3),
        })

    return ScenarioAnalysisResult(
        edge_overrides=edge_overrides,
        analysis=result.get("analysis", ""),
        key_insights=result.get("key_insights", []),
        conclusion=result.get("conclusion", ""),
        edge_change_reasons=edge_change_reasons,
    )
