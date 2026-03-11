"""Scenario comparison for causal DAGs.

Compares two scenario graphs to identify where beliefs diverge and where
they converge, as well as structural differences in edges.
"""

from __future__ import annotations

import logging
from typing import Any

import networkx as nx

logger = logging.getLogger(__name__)

# Belief difference threshold for classifying nodes as divergent
_DIVERGENCE_THRESHOLD = 0.1


def diff_scenarios(
    graph_a: nx.DiGraph,
    graph_b: nx.DiGraph,
) -> dict[str, Any]:
    """Compare two scenario graphs and identify differences.

    Compares node beliefs between the two graphs and identifies structural
    edge changes.

    Args:
        graph_a: The first scenario graph (e.g., baseline).
        graph_b: The second scenario graph (e.g., alternative scenario).

    Returns:
        A dict with the following keys:
        - divergent_nodes: List of dicts for nodes where belief differs by > 0.1.
            Each dict has: node_id, belief_a, belief_b, delta.
        - convergent_nodes: List of dicts for nodes where belief is within 0.1.
            Each dict has: node_id, belief_a, belief_b, delta.
        - added_edges: Edges present in graph_b but not in graph_a.
            Each entry is a dict with: source, target, and edge attributes.
        - removed_edges: Edges present in graph_a but not in graph_b.
            Each entry is a dict with: source, target, and edge attributes.
    """
    nodes_a = set(graph_a.nodes)
    nodes_b = set(graph_b.nodes)
    common_nodes = nodes_a & nodes_b

    divergent_nodes: list[dict[str, Any]] = []
    convergent_nodes: list[dict[str, Any]] = []

    for node_id in common_nodes:
        belief_a = graph_a.nodes[node_id].get("belief", 0.5)
        belief_b = graph_b.nodes[node_id].get("belief", 0.5)
        delta = abs(belief_a - belief_b)

        node_info = {
            "node_id": node_id,
            "belief_a": belief_a,
            "belief_b": belief_b,
            "delta": delta,
            "text": graph_a.nodes[node_id].get("text", ""),
        }

        if delta > _DIVERGENCE_THRESHOLD:
            divergent_nodes.append(node_info)
        else:
            convergent_nodes.append(node_info)

    # Sort divergent nodes by delta (largest first)
    divergent_nodes.sort(key=lambda n: n["delta"], reverse=True)

    # Identify structural edge differences
    edges_a = set(graph_a.edges)
    edges_b = set(graph_b.edges)

    added_edges: list[dict[str, Any]] = []
    for u, v in edges_b - edges_a:
        edge_data = dict(graph_b.edges[u, v])
        # Remove non-serializable attributes like embeddings
        edge_data.pop("embedding", None)
        added_edges.append({"source": u, "target": v, **edge_data})

    removed_edges: list[dict[str, Any]] = []
    for u, v in edges_a - edges_b:
        edge_data = dict(graph_a.edges[u, v])
        edge_data.pop("embedding", None)
        removed_edges.append({"source": u, "target": v, **edge_data})

    # Also report nodes unique to each graph
    nodes_only_a = nodes_a - nodes_b
    nodes_only_b = nodes_b - nodes_a

    result = {
        "divergent_nodes": divergent_nodes,
        "convergent_nodes": convergent_nodes,
        "added_edges": added_edges,
        "removed_edges": removed_edges,
        "nodes_only_in_a": list(nodes_only_a),
        "nodes_only_in_b": list(nodes_only_b),
    }

    logger.info(
        "Scenario diff: %d divergent nodes, %d convergent nodes, "
        "%d added edges, %d removed edges",
        len(divergent_nodes),
        len(convergent_nodes),
        len(added_edges),
        len(removed_edges),
    )

    return result
