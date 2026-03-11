"""Critical path analysis for causal DAGs.

Finds the longest weighted path through the graph using dynamic programming
on topological order, where weights reflect causal strength modulated by
evidence.
"""

from __future__ import annotations

import logging

import networkx as nx

from curiocat.graph.belief_propagation import _evidence_modulation

logger = logging.getLogger(__name__)


def find_critical_path(graph: nx.DiGraph) -> list[str]:
    """Find the longest weighted path through the causal DAG.

    Uses dynamic programming on topological order. Edge weight is defined as
    ``strength * evidence_modulation(evidence_score)``.

    The critical path represents the strongest chain of causal reasoning
    through the graph.

    Args:
        graph: A directed acyclic graph with edge attributes "strength"
            and "evidence_score".

    Returns:
        A list of node IDs forming the critical (longest weighted) path,
        ordered from root to leaf. Returns an empty list if the graph has
        no edges.
    """
    if graph.number_of_edges() == 0:
        return []

    try:
        topo_order = list(nx.topological_sort(graph))
    except nx.NetworkXUnfeasible:
        logger.error("Cannot find critical path: graph contains cycles")
        return []

    # DP tables: longest path weight to reach each node, and predecessor
    dist: dict[str, float] = {node: 0.0 for node in topo_order}
    predecessor: dict[str, str | None] = {node: None for node in topo_order}

    for node_id in topo_order:
        for successor in graph.successors(node_id):
            edge_data = graph.edges[node_id, successor]
            # Skip inhibiting edges — they suppress downstream effects
            if edge_data.get("causal_type") == "inhibiting":
                continue
            strength = edge_data.get("strength", 0.5)
            ev_score = edge_data.get("evidence_score", 0.5)
            weight = strength * _evidence_modulation(ev_score)

            new_dist = dist[node_id] + weight
            if new_dist > dist[successor]:
                dist[successor] = new_dist
                predecessor[successor] = node_id

    # Find the node with the maximum distance (end of critical path)
    if not dist:
        return []

    end_node = max(dist, key=lambda n: dist[n])

    # If the max distance is 0, there is no meaningful path
    if dist[end_node] == 0.0:
        return []

    # Backtrack to reconstruct the path
    path: list[str] = []
    current: str | None = end_node
    while current is not None:
        path.append(current)
        current = predecessor[current]

    path.reverse()

    logger.info(
        "Critical path found: %d nodes, total weight=%.3f",
        len(path),
        dist[end_node],
    )

    return path
