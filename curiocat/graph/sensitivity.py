"""Sensitivity analysis for causal DAGs.

Perturbs each edge's strength to measure downstream belief impact,
identifying which edges and nodes are most influential.
"""

from __future__ import annotations

import copy
import logging

import networkx as nx

from curiocat.graph.belief_propagation import propagate_beliefs

logger = logging.getLogger(__name__)

# Perturbation magnitude for sensitivity analysis
_PERTURBATION = 0.20


def analyze_sensitivity(graph: nx.DiGraph) -> dict[str, dict[str, float]]:
    """Analyze how sensitive downstream beliefs are to each edge's strength.

    For each edge, perturbs strength by +/-20%, re-propagates beliefs,
    and records the maximum absolute belief change across all downstream nodes.

    Args:
        graph: A DAG that has already undergone belief propagation (nodes
            must have "belief" attributes).

    Returns:
        A dict with two keys:
        - "edges": Maps edge IDs ("{source}->{target}") to sensitivity scores.
        - "nodes": Maps node IDs to the maximum sensitivity of their incoming edges.
    """
    # Get baseline beliefs
    baseline_graph = copy.deepcopy(graph)
    propagate_beliefs(baseline_graph)
    baseline_beliefs = {
        node: baseline_graph.nodes[node].get("belief", 0.5)
        for node in baseline_graph.nodes
    }

    edge_sensitivities: dict[str, float] = {}

    for u, v, edge_data in graph.edges(data=True):
        edge_id = f"{u}->{v}"
        original_strength = edge_data.get("strength", 0.5)

        # Test 1: Increase strength by 20%
        increased_strength = min(1.0, original_strength + _PERTURBATION)
        delta_up = _measure_delta(
            graph, u, v, increased_strength, baseline_beliefs
        )

        # Test 2: Decrease strength by 20%
        decreased_strength = max(0.0, original_strength - _PERTURBATION)
        delta_down = _measure_delta(
            graph, u, v, decreased_strength, baseline_beliefs
        )

        # Sensitivity is the maximum of the two perturbation deltas
        sensitivity = max(delta_up, delta_down)
        edge_sensitivities[edge_id] = sensitivity

    # Compute node sensitivities: max sensitivity of incoming edges
    node_sensitivities: dict[str, float] = {}
    for node_id in graph.nodes:
        incoming = list(graph.predecessors(node_id))
        if incoming:
            max_sensitivity = max(
                edge_sensitivities.get(f"{pred}->{node_id}", 0.0)
                for pred in incoming
            )
            node_sensitivities[node_id] = max_sensitivity
        else:
            node_sensitivities[node_id] = 0.0

    logger.info(
        "Sensitivity analysis complete: %d edges, %d nodes",
        len(edge_sensitivities),
        len(node_sensitivities),
    )

    return {
        "edges": edge_sensitivities,
        "nodes": node_sensitivities,
    }


def _measure_delta(
    graph: nx.DiGraph,
    u: str,
    v: str,
    perturbed_strength: float,
    baseline_beliefs: dict[str, float],
) -> float:
    """Perturb one edge's strength and measure the maximum downstream belief change.

    Args:
        graph: The original graph (will not be modified).
        u: Source node of the edge.
        v: Target node of the edge.
        perturbed_strength: The new strength value to test.
        baseline_beliefs: Dict mapping node IDs to baseline belief values.

    Returns:
        The maximum absolute belief change across all downstream nodes.
    """
    perturbed = copy.deepcopy(graph)
    perturbed.edges[u, v]["strength"] = perturbed_strength
    propagate_beliefs(perturbed)

    # Find all nodes reachable from v (downstream)
    downstream = nx.descendants(perturbed, v) | {v}

    max_delta = 0.0
    for node_id in downstream:
        new_belief = perturbed.nodes[node_id].get("belief", 0.5)
        old_belief = baseline_beliefs.get(node_id, 0.5)
        delta = abs(new_belief - old_belief)
        if delta > max_delta:
            max_delta = delta

    return max_delta
