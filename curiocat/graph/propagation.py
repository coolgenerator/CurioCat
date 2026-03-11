"""Partial BFS belief propagation from a modification point.

Unlike the full-graph `propagate_beliefs()`, these functions perform
localised propagation starting from a specific node or edge, with
cycle dampening to handle non-DAG traversals.
"""

from __future__ import annotations

import logging
from collections import deque

import networkx as nx

from curiocat.graph.belief_propagation import (
    _and_gate_belief,
    _noisy_or_belief_full,
)

logger = logging.getLogger(__name__)

# Cycle handling parameters
_MAX_REVISITS = 4
_DAMPENING_BASE = 0.5
_MIN_DAMPENING = 0.05
_MIN_DELTA = 0.01


def _compute_node_belief(graph: nx.DiGraph, node_id: str) -> float:
    """Compute belief for a node using gate-aware computation."""
    predecessors = list(graph.predecessors(node_id))
    if not predecessors:
        return graph.nodes[node_id].get("confidence", 0.5)

    logic_gate = graph.nodes[node_id].get("logic_gate", "or")
    if logic_gate == "and":
        return _and_gate_belief(graph, node_id, predecessors)
    return _noisy_or_belief_full(graph, node_id, predecessors)


def propagate_from_node(
    graph: nx.DiGraph, start_node_id: str
) -> dict[str, dict[str, float]]:
    """BFS belief propagation from a node, with cycle dampening.

    Re-computes beliefs for the start node and all downstream nodes.

    Args:
        graph: A DiGraph with node "confidence"/"belief" and edge
            "strength"/"evidence_score" attributes. Modified in-place.
        start_node_id: The node from which to begin propagation.

    Returns:
        ``{"changes": {node_id: {"old_belief": …, "new_belief": …, "delta": …}}}``
    """
    changes: dict[str, dict[str, float]] = {}
    visit_counts: dict[str, int] = {}
    queue: deque[str] = deque([start_node_id])

    while queue:
        node_id = queue.popleft()
        visits = visit_counts.get(node_id, 0)
        if visits >= _MAX_REVISITS:
            continue
        dampening = _DAMPENING_BASE ** visits
        if dampening < _MIN_DAMPENING:
            continue

        visit_counts[node_id] = visits + 1

        old_belief = graph.nodes[node_id].get("belief", 0.5)
        raw_new = _compute_node_belief(graph, node_id)
        # Apply dampening to the change
        new_belief = old_belief + (raw_new - old_belief) * dampening
        new_belief = max(0.0, min(1.0, new_belief))

        delta = abs(new_belief - old_belief)
        if delta < _MIN_DELTA and visits > 0:
            continue

        graph.nodes[node_id]["belief"] = new_belief
        changes[node_id] = {
            "old_belief": old_belief,
            "new_belief": new_belief,
            "delta": new_belief - old_belief,
        }

        # Enqueue children
        for child in graph.successors(node_id):
            queue.append(child)

    logger.info(
        "Partial propagation from %s: %d nodes changed", start_node_id, len(changes)
    )
    return {"changes": changes}


def propagate_from_edge(
    graph: nx.DiGraph,
    source_id: str,
    target_id: str,
    new_strength: float | None = None,
    new_evidence_score: float | None = None,
) -> dict[str, dict[str, float]]:
    """BFS belief propagation after modifying an edge.

    Optionally updates the edge's strength and/or evidence_score before
    propagating from the target node.

    Args:
        graph: A DiGraph. Modified in-place.
        source_id: Source node of the edge.
        target_id: Target node of the edge.
        new_strength: If provided, set the edge strength before propagating.
        new_evidence_score: If provided, set the edge evidence_score.

    Returns:
        Same format as :func:`propagate_from_node`.
    """
    if not graph.has_edge(source_id, target_id):
        logger.warning("Edge %s->%s not found in graph", source_id, target_id)
        return {"changes": {}}

    if new_strength is not None:
        graph.edges[source_id, target_id]["strength"] = new_strength
    if new_evidence_score is not None:
        graph.edges[source_id, target_id]["evidence_score"] = new_evidence_score

    return propagate_from_node(graph, target_id)
