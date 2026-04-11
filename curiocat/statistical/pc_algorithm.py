"""Simplified PC algorithm for cross-sectional causal discovery.

Discovers causal skeleton via conditional independence testing, then
orients edges using v-structures. Uses partial correlation for CI tests.
Designed for small variable sets (< 50 variables) on CPU.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from itertools import combinations

import numpy as np
from scipy import stats

logger = logging.getLogger(__name__)


@dataclass
class PCEdge:
    """An edge in the PC algorithm output graph."""
    source: str
    target: str
    edge_type: str  # "directed", "undirected", "bidirected"
    p_value: float  # from the CI test that failed to remove this edge
    partial_corr: float  # strength measure


@dataclass
class PCResult:
    """Result of running the PC algorithm."""
    edges: list[PCEdge]
    skeleton: list[tuple[str, str]]  # undirected adjacency
    separating_sets: dict[tuple[str, str], list[str]]  # sep sets for non-adjacent pairs
    n_variables: int
    n_samples: int
    alpha: float


def partial_correlation(
    data: np.ndarray, i: int, j: int, conditioning: list[int]
) -> tuple[float, float]:
    """Compute partial correlation between variables i and j given conditioning set.

    Uses recursive formula for small conditioning sets, falls back to
    regression-based approach for larger ones.

    Returns:
        (partial_corr, p_value)
    """
    n = data.shape[0]

    if len(conditioning) == 0:
        r = np.corrcoef(data[:, i], data[:, j])[0, 1]
        if np.isnan(r):
            return 0.0, 1.0
        t_stat = r * np.sqrt((n - 2) / (1 - r**2 + 1e-15))
        p_val = 2 * (1 - stats.t.cdf(abs(t_stat), df=n - 2))
        return float(r), float(p_val)

    # Regression-based partial correlation
    cols = [i, j] + conditioning
    sub = data[:, cols]

    # Regress i and j on conditioning set, get residuals
    Z = sub[:, 2:]  # conditioning variables
    Z_aug = np.column_stack([np.ones(n), Z])

    try:
        beta_i = np.linalg.lstsq(Z_aug, sub[:, 0], rcond=None)[0]
        beta_j = np.linalg.lstsq(Z_aug, sub[:, 1], rcond=None)[0]
    except np.linalg.LinAlgError:
        return 0.0, 1.0

    resid_i = sub[:, 0] - Z_aug @ beta_i
    resid_j = sub[:, 1] - Z_aug @ beta_j

    r = np.corrcoef(resid_i, resid_j)[0, 1]
    if np.isnan(r):
        return 0.0, 1.0

    df = n - len(conditioning) - 2
    if df <= 0:
        return float(r), 1.0

    t_stat = r * np.sqrt(df / (1 - r**2 + 1e-15))
    p_val = 2 * (1 - stats.t.cdf(abs(t_stat), df=df))
    return float(r), float(p_val)


def pc_algorithm(
    data: dict[str, np.ndarray],
    alpha: float = 0.05,
    max_conditioning_size: int = 3,
) -> PCResult:
    """Run the PC algorithm on cross-sectional data.

    Args:
        data: Dict mapping variable name → observation array, all same length.
        alpha: Significance threshold for CI tests.
        max_conditioning_size: Max size of conditioning sets to try.

    Returns:
        PCResult with discovered edges and metadata.
    """
    names = list(data.keys())
    n_vars = len(names)
    n_samples = len(next(iter(data.values())))

    # Build data matrix
    mat = np.column_stack([data[name] for name in names])

    # Start with complete undirected graph
    adjacency = {(i, j) for i in range(n_vars) for j in range(n_vars) if i != j}
    sep_sets: dict[tuple[int, int], list[int]] = {}

    # Phase 1: Skeleton discovery — remove edges via CI tests
    for cond_size in range(max_conditioning_size + 1):
        edges_to_remove = []

        for i, j in list(adjacency):
            if i >= j:
                continue
            if (i, j) not in adjacency and (j, i) not in adjacency:
                continue

            # Get neighbors of i (excluding j) as potential conditioning sets
            neighbors_i = [k for k in range(n_vars) if k != i and k != j and (i, k) in adjacency]

            if len(neighbors_i) < cond_size:
                continue

            for cond_set in combinations(neighbors_i, cond_size):
                cond_list = list(cond_set)
                pcorr, p_val = partial_correlation(mat, i, j, cond_list)

                if p_val > alpha:
                    # Conditionally independent → remove edge
                    edges_to_remove.append((i, j))
                    edges_to_remove.append((j, i))
                    sep_sets[(i, j)] = cond_list
                    sep_sets[(j, i)] = cond_list
                    break

        for edge in edges_to_remove:
            adjacency.discard(edge)

    # Phase 2: Orient v-structures (colliders)
    # If i - k - j with no edge i-j, and k not in sep(i,j), orient as i → k ← j
    oriented: set[tuple[int, int]] = set()

    for i in range(n_vars):
        for j in range(i + 1, n_vars):
            if (i, j) in adjacency:
                continue  # i and j are adjacent, skip

            # Find common neighbors
            for k in range(n_vars):
                if k == i or k == j:
                    continue
                if (i, k) in adjacency and (k, j) in adjacency:
                    sep = sep_sets.get((i, j), [])
                    if k not in sep:
                        # v-structure: i → k ← j
                        oriented.add((i, k))
                        oriented.add((j, k))

    # Build result edges
    edges: list[PCEdge] = []
    seen = set()

    for i, j in adjacency:
        if i > j:
            continue
        pair = (i, j)
        if pair in seen:
            continue
        seen.add(pair)

        # Check orientation
        if (i, j) in oriented and (j, i) not in oriented:
            edge_type = "directed"
            src, tgt = names[i], names[j]
        elif (j, i) in oriented and (i, j) not in oriented:
            edge_type = "directed"
            src, tgt = names[j], names[i]
        else:
            edge_type = "undirected"
            src, tgt = names[i], names[j]

        # Get the partial correlation strength
        pcorr, p_val = partial_correlation(mat, i, j, [])

        edges.append(PCEdge(
            source=src,
            target=tgt,
            edge_type=edge_type,
            p_value=p_val,
            partial_corr=abs(pcorr),
        ))

    skeleton = [(names[i], names[j]) for i, j in adjacency if i < j]
    named_sep = {
        (names[i], names[j]): [names[k] for k in v]
        for (i, j), v in sep_sets.items() if i < j
    }

    logger.info(
        "PC algorithm: %d variables, %d samples → %d edges",
        n_vars, n_samples, len(edges),
    )

    return PCResult(
        edges=edges,
        skeleton=skeleton,
        separating_sets=named_sep,
        n_variables=n_vars,
        n_samples=n_samples,
        alpha=alpha,
    )
