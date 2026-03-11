"""Noisy-OR belief propagation along a causal DAG.

Propagates belief scores through the graph in topological order using
the Noisy-OR model with evidence modulation.
"""

from __future__ import annotations

import logging

import networkx as nx

logger = logging.getLogger(__name__)


def _evidence_modulation(evidence_score: float) -> float:
    """Compute evidence modulation factor.

    Maps evidence_score to a modulation factor in [0.0, 1.0]:
    - evidence_score = 0.0 -> 0.0 (no evidence: zero effectiveness)
    - evidence_score = 0.5 -> ~0.35 (partial evidence: conservative)
    - evidence_score = 1.0 -> 1.0 (full evidence: full effectiveness)

    Args:
        evidence_score: The evidence score for an edge, in [0, 1].

    Returns:
        The modulation factor, in [0.0, 1.0].
    """
    return evidence_score ** 1.5  # floor 0.0, gentler curve


def _noisy_or_belief_full(
    graph: nx.DiGraph, node_id: str, predecessors: list[str]
) -> float:
    """Compute Noisy-OR belief with inhibiting edge support.

    Normal (non-inhibiting) parents contribute to the OR product.
    Inhibiting parents reduce the final belief multiplicatively.

    With no inhibitors: identical to the original algorithm.
    """
    noisy_or_product = 1.0
    inhibition_factor = 1.0

    for parent_id in predecessors:
        parent_belief = graph.nodes[parent_id].get("belief", 0.5)
        edge_data = graph.edges[parent_id, node_id]
        strength = edge_data.get("strength", 0.5)
        ev_score = edge_data.get("evidence_score", 0.5)
        effective = strength * _evidence_modulation(ev_score)
        causal_type = edge_data.get("causal_type", "direct")

        if causal_type == "inhibiting":
            inhibition_factor *= 1.0 - parent_belief * effective
        else:
            noisy_or_product *= 1.0 - parent_belief * effective

    belief = (1.0 - noisy_or_product) * inhibition_factor
    return max(0.0, min(1.0, belief))


def _and_gate_belief(
    graph: nx.DiGraph, node_id: str, predecessors: list[str]
) -> float:
    """Compute AND-gate belief: product of all parent contributions.

    Only non-zero when ALL parents are active. A single inactive parent
    drives the result toward zero.
    """
    belief = 1.0
    for parent_id in predecessors:
        parent_belief = graph.nodes[parent_id].get("belief", 0.5)
        edge_data = graph.edges[parent_id, node_id]
        strength = edge_data.get("strength", 0.5)
        ev_score = edge_data.get("evidence_score", 0.5)
        effective = strength * _evidence_modulation(ev_score)
        belief *= parent_belief * effective

    return max(0.0, min(1.0, belief))


def propagate_beliefs(graph: nx.DiGraph) -> nx.DiGraph:
    """Propagate beliefs through a DAG using gate-aware computation.

    For each node processed in topological order:
    - Root nodes (no parents): belief = claim confidence.
    - AND-gate nodes: belief = product(parent_belief * effective_strength).
    - OR-gate nodes: Noisy-OR with inhibiting edge support.

    Args:
        graph: A directed acyclic graph with node attributes "confidence"
            and edge attributes "strength" and "evidence_score".

    Returns:
        The same graph with updated "belief" attributes on each node.
    """
    try:
        topo_order = list(nx.topological_sort(graph))
    except nx.NetworkXUnfeasible:
        logger.error("Cannot propagate beliefs: graph contains cycles")
        return graph

    for node_id in topo_order:
        predecessors = list(graph.predecessors(node_id))

        if not predecessors:
            # Root node: belief equals the initial claim confidence
            confidence = graph.nodes[node_id].get("confidence", 0.5)
            graph.nodes[node_id]["belief"] = confidence
        else:
            logic_gate = graph.nodes[node_id].get("logic_gate", "or")
            if logic_gate == "and":
                belief = _and_gate_belief(graph, node_id, predecessors)
            else:
                belief = _noisy_or_belief_full(graph, node_id, predecessors)

            graph.nodes[node_id]["belief"] = belief

    logger.info("Belief propagation complete for %d nodes", len(topo_order))
    return graph


def compute_belief_intervals(
    graph: nx.DiGraph, perturbation: float = 0.1
) -> dict[str, tuple[float, float]]:
    """Compute belief confidence intervals via perturbation analysis.

    For each node, perturbs all parent edge strengths by +/-perturbation,
    re-propagates, and reports (low, high) bounds.
    """
    intervals: dict[str, tuple[float, float]] = {}
    try:
        topo_order = list(nx.topological_sort(graph))
    except nx.NetworkXUnfeasible:
        return intervals

    for node_id in topo_order:
        predecessors = list(graph.predecessors(node_id))
        if not predecessors:
            confidence = graph.nodes[node_id].get("confidence", 0.5)
            intervals[node_id] = (confidence, confidence)
            continue

        logic_gate = graph.nodes[node_id].get("logic_gate", "or")
        beliefs: list[float] = []
        for delta in [-perturbation, perturbation]:
            # Temporarily perturb all parent edge strengths
            original_strengths: dict[str, float] = {}
            for p in predecessors:
                original_strengths[p] = graph.edges[p, node_id].get("strength", 0.5)
                graph.edges[p, node_id]["strength"] = max(
                    0.0, min(1.0, original_strengths[p] + delta)
                )

            if logic_gate == "and":
                b = _and_gate_belief(graph, node_id, predecessors)
            else:
                b = _noisy_or_belief_full(graph, node_id, predecessors)
            beliefs.append(b)

            # Restore original strengths
            for p in predecessors:
                graph.edges[p, node_id]["strength"] = original_strengths[p]

        intervals[node_id] = (min(beliefs), max(beliefs))

    return intervals
