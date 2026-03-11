"""All-paths finder for causal DAGs.

Finds all simple paths to a target node and computes compound
probability for each path.
"""

from __future__ import annotations

import logging
import time

import networkx as nx

from curiocat.graph.belief_propagation import _evidence_modulation

logger = logging.getLogger(__name__)

_MAX_PATHS = 10
_MAX_PATH_LENGTH = 6
_MAX_CANDIDATES = 200       # stop enumeration after this many total candidates
_TIME_LIMIT_SECS = 3.0      # hard time limit for path enumeration


def find_all_paths_to_node(
    graph: nx.DiGraph, target_id: str
) -> list[dict[str, list[str] | float]]:
    """Find all simple paths from any root to *target_id*.

    Uses ``nx.all_simple_paths`` with aggressive limits to prevent
    combinatorial explosion in dense graphs:
    - Path length capped at ``_MAX_PATH_LENGTH`` (6)
    - Total candidate paths capped at ``_MAX_CANDIDATES`` (200)
    - Wall-clock time capped at ``_TIME_LIMIT_SECS`` (3s)

    Args:
        graph: A directed graph (need not be acyclic).
        target_id: The node to find paths to.

    Returns:
        A list of dicts sorted by compound probability (descending), each
        containing:
        - ``path``: list of node IDs from root to target.
        - ``edges``: list of ``(source, target)`` tuples along the path.
        - ``compound_probability``: product of effective edge strengths.
    """
    if target_id not in graph:
        return []

    # Find root nodes (in-degree 0)
    roots = [n for n in graph.nodes if graph.in_degree(n) == 0]
    if not roots:
        # Cyclic graph: use direct predecessors only (not all ancestors)
        roots = list(graph.predecessors(target_id))
        if not roots:
            return []

    all_paths: list[dict] = []
    deadline = time.monotonic() + _TIME_LIMIT_SECS

    for root in roots:
        if root == target_id:
            continue
        if time.monotonic() > deadline:
            logger.info("Path finding hit time limit after %d candidates", len(all_paths))
            break
        if len(all_paths) >= _MAX_CANDIDATES:
            break
        try:
            paths = nx.all_simple_paths(
                graph, root, target_id, cutoff=_MAX_PATH_LENGTH
            )
            for path in paths:
                if len(path) < 2:
                    continue
                edges = list(zip(path[:-1], path[1:]))
                prob = _compound_probability(graph, edges)
                all_paths.append({
                    "path": list(path),
                    "edges": edges,
                    "compound_probability": prob,
                })
                if len(all_paths) >= _MAX_CANDIDATES:
                    break
                if time.monotonic() > deadline:
                    break
        except nx.NetworkXError:
            continue

    # Sort by compound probability descending, take top N
    all_paths.sort(key=lambda p: p["compound_probability"], reverse=True)
    result = all_paths[:_MAX_PATHS]

    logger.info(
        "Found %d paths to node %s (from %d candidates)",
        len(result),
        target_id,
        len(all_paths),
    )
    return result


def _compound_probability(
    graph: nx.DiGraph, edges: list[tuple[str, str]]
) -> float:
    """Compute product of effective strengths along a path."""
    prob = 1.0
    for u, v in edges:
        edge_data = graph.edges[u, v]
        strength = edge_data.get("strength", 0.5)
        ev_score = edge_data.get("evidence_score", 0.5)
        prob *= strength * _evidence_modulation(ev_score)
    return prob
