"""Granger causality testing for time-series data.

Tests whether past values of X help predict Y beyond Y's own past values.
Uses OLS-based F-test, no GPU required.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

import numpy as np
from scipy import stats

logger = logging.getLogger(__name__)


@dataclass
class GrangerResult:
    """Result of a pairwise Granger causality test."""
    source: str
    target: str
    lag: int
    f_statistic: float
    p_value: float
    is_causal: bool  # p_value < alpha
    effect_size: float  # partial R² improvement


def granger_test(
    x: np.ndarray,
    y: np.ndarray,
    max_lag: int = 5,
    alpha: float = 0.05,
) -> GrangerResult | None:
    """Test if x Granger-causes y at the best lag.

    Fits two OLS models:
        Restricted:   y_t = a0 + a1*y_{t-1} + ... + ap*y_{t-p}
        Unrestricted: y_t = a0 + a1*y_{t-1} + ... + ap*y_{t-p} + b1*x_{t-1} + ... + bp*x_{t-p}

    Compares via F-test.

    Args:
        x: Source time series, shape (T,)
        y: Target time series, shape (T,)
        max_lag: Maximum lag to test (tests 1..max_lag, picks best)
        alpha: Significance threshold

    Returns:
        GrangerResult for the best lag, or None if data is insufficient.
    """
    x = np.asarray(x, dtype=np.float64).ravel()
    y = np.asarray(y, dtype=np.float64).ravel()

    T = min(len(x), len(y))
    if T < max_lag + 10:  # need enough observations
        return None

    x, y = x[:T], y[:T]

    best_result: GrangerResult | None = None
    best_p = 1.0

    for lag in range(1, max_lag + 1):
        result = _granger_test_single_lag(x, y, lag)
        if result is None:
            continue
        if result.p_value < best_p:
            best_p = result.p_value
            best_result = result

    if best_result is not None:
        best_result.is_causal = best_result.p_value < alpha

    return best_result


def _granger_test_single_lag(
    x: np.ndarray, y: np.ndarray, lag: int
) -> GrangerResult | None:
    """Granger test at a specific lag."""
    T = len(y)
    n = T - lag
    if n < lag * 2 + 2:
        return None

    # Build lagged matrices
    Y = y[lag:]  # dependent variable

    # Restricted model: only own lags
    Y_lags = np.column_stack([y[lag - k - 1 : T - k - 1] for k in range(lag)])
    X_restricted = np.column_stack([np.ones(n), Y_lags])

    # Unrestricted model: own lags + X lags
    X_lags = np.column_stack([x[lag - k - 1 : T - k - 1] for k in range(lag)])
    X_unrestricted = np.column_stack([X_restricted, X_lags])

    # Fit via OLS (normal equations)
    try:
        _, rss_r, _, _ = np.linalg.lstsq(X_restricted, Y, rcond=None)
        _, rss_u, _, _ = np.linalg.lstsq(X_unrestricted, Y, rcond=None)
    except np.linalg.LinAlgError:
        return None

    rss_r = rss_r[0] if len(rss_r) > 0 else np.sum((Y - X_restricted @ np.linalg.lstsq(X_restricted, Y, rcond=None)[0]) ** 2)
    rss_u = rss_u[0] if len(rss_u) > 0 else np.sum((Y - X_unrestricted @ np.linalg.lstsq(X_unrestricted, Y, rcond=None)[0]) ** 2)

    if rss_u <= 0 or rss_r <= 0:
        return None

    # F-test
    df1 = lag  # additional parameters in unrestricted model
    df2 = n - 2 * lag - 1

    if df2 <= 0:
        return None

    f_stat = ((rss_r - rss_u) / df1) / (rss_u / df2)
    p_value = 1.0 - stats.f.cdf(f_stat, df1, df2)

    # Effect size: partial R² = (RSS_r - RSS_u) / RSS_r
    effect_size = (rss_r - rss_u) / rss_r if rss_r > 0 else 0.0

    return GrangerResult(
        source="",  # caller fills in names
        target="",
        lag=lag,
        f_statistic=float(f_stat),
        p_value=float(p_value),
        is_causal=False,  # caller sets based on alpha
        effect_size=float(effect_size),
    )


def granger_matrix(
    data: dict[str, np.ndarray],
    max_lag: int = 5,
    alpha: float = 0.05,
) -> list[GrangerResult]:
    """Run pairwise Granger tests on all variable pairs.

    Args:
        data: Dict mapping variable name → time series array.
        max_lag: Maximum lag to test.
        alpha: Significance level.

    Returns:
        List of significant GrangerResults.
    """
    names = list(data.keys())
    results: list[GrangerResult] = []

    for i, src_name in enumerate(names):
        for j, tgt_name in enumerate(names):
            if i == j:
                continue
            result = granger_test(data[src_name], data[tgt_name], max_lag, alpha)
            if result is not None:
                result.source = src_name
                result.target = tgt_name
                if result.is_causal:
                    results.append(result)

    logger.info(
        "Granger matrix: %d variables, %d significant edges (alpha=%.3f)",
        len(names), len(results), alpha,
    )
    return results
