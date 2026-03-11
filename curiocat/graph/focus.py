"""Focus subgraph computation.

Returns the set of node IDs that should remain visible when focusing
on a particular node, limited to a configurable number of hops.
"""

from __future__ import annotations

from collections import deque

import networkx as nx


def compute_focus_subgraph(
    graph: nx.DiGraph,
    focus_node_id: str,
    max_hops: int = 2,
) -> set[str]:
    """Compute the visible node set when focusing on a node.

    Uses BFS in both directions (predecessors and successors) up to
    *max_hops* edges away.  This prevents the "whole graph visible"
    problem that occurs in dense graphs when using full ancestor /
    descendant reachability.

    Args:
        graph: The full causal graph.
        focus_node_id: The node to focus on.
        max_hops: Maximum edge distance from focus node (default 2).

    Returns:
        Set of node IDs within *max_hops* of the focus node.
    """
    if focus_node_id not in graph:
        return set()

    visible: set[str] = {focus_node_id}
    queue: deque[tuple[str, int]] = deque([(focus_node_id, 0)])

    while queue:
        node, dist = queue.popleft()
        if dist >= max_hops:
            continue
        # Traverse both directions (causes and effects)
        for neighbor in graph.predecessors(node):
            if neighbor not in visible:
                visible.add(neighbor)
                queue.append((neighbor, dist + 1))
        for neighbor in graph.successors(node):
            if neighbor not in visible:
                visible.add(neighbor)
                queue.append((neighbor, dist + 1))

    return visible
