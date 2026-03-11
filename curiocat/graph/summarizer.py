"""Shared graph summary builders for LLM context.

Provides two functions:
- build_graph_summary: compressed summary for the strategic advisor.
- build_scenario_context: rich evidence-driven context for scenario analysis.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

import networkx as nx

if TYPE_CHECKING:
    from curiocat.db.models import CausalEdge

logger = logging.getLogger(__name__)

MAX_EDGES = 80


# ---------------------------------------------------------------------------
# Advisor summary (migrated from operations.py)
# ---------------------------------------------------------------------------


def build_graph_summary(
    graph: nx.DiGraph,
    critical_path: list[str],
    sensitivity: dict[str, dict[str, float]],
) -> str:
    """Compress a causal graph into a text summary for LLM context.

    Aims for ~2000-3000 tokens by giving full detail to the critical path
    and high-sensitivity nodes, and minimal detail to the rest.
    """
    lines: list[str] = []
    node_sens = sensitivity.get("nodes", {})
    edge_sens = sensitivity.get("edges", {})  # noqa: F841
    cp_set = set(critical_path)

    # --- Critical path ---
    if critical_path:
        lines.append("## Critical Path (strongest causal chain)")
        for nid in critical_path:
            nd = graph.nodes.get(nid, {})
            text = nd.get("text", nid)
            belief = nd.get("belief", "?")
            sens = node_sens.get(nid, 0)
            lines.append(f"- [{nid[:8]}] \"{text}\" (belief={belief:.2f}, sensitivity={sens:.2f})")

        # Edges along critical path
        for i in range(len(critical_path) - 1):
            src, tgt = critical_path[i], critical_path[i + 1]
            if graph.has_edge(src, tgt):
                ed = graph.edges[src, tgt]
                mech = ed.get("mechanism", "")
                strength = ed.get("strength", 0)
                ev_score = ed.get("evidence_score", 0)
                delay = ed.get("time_delay", "")
                lines.append(
                    f"  Edge {src[:8]}->{tgt[:8]}: "
                    f"mechanism=\"{mech}\", strength={strength:.2f}, "
                    f"evidence={ev_score:.2f}, delay={delay}"
                )
        lines.append("")

    # --- High-sensitivity nodes (not on critical path) ---
    high_sens = [
        (nid, node_sens.get(nid, 0))
        for nid in graph.nodes
        if nid not in cp_set and node_sens.get(nid, 0) > 0.5
    ]
    high_sens.sort(key=lambda x: x[1], reverse=True)
    if high_sens:
        lines.append("## High-Sensitivity Nodes")
        for nid, sens in high_sens[:15]:
            nd = graph.nodes.get(nid, {})
            lines.append(
                f"- [{nid[:8]}] \"{nd.get('text', nid)}\" "
                f"(belief={nd.get('belief', 0):.2f}, sensitivity={sens:.2f})"
            )
        lines.append("")

    # --- Root and terminal nodes ---
    roots = [n for n in graph.nodes if graph.in_degree(n) == 0 and n not in cp_set]
    terminals = [n for n in graph.nodes if graph.out_degree(n) == 0 and n not in cp_set]
    if roots:
        lines.append("## Root Nodes (initial causes)")
        for nid in roots:
            nd = graph.nodes.get(nid, {})
            lines.append(
                f"- [{nid[:8]}] \"{nd.get('text', nid)}\" "
                f"(type={nd.get('claim_type', '?')}, belief={nd.get('belief', 0):.2f})"
            )
        lines.append("")
    if terminals:
        lines.append("## Terminal Nodes (final effects)")
        for nid in terminals:
            nd = graph.nodes.get(nid, {})
            lines.append(
                f"- [{nid[:8]}] \"{nd.get('text', nid)}\" "
                f"(type={nd.get('claim_type', '?')}, belief={nd.get('belief', 0):.2f})"
            )
        lines.append("")

    # --- Top edges by strength * evidence_score ---
    scored_edges = []
    for u, v, ed in graph.edges(data=True):
        score = ed.get("strength", 0) * ed.get("evidence_score", 0)
        scored_edges.append((u, v, ed, score))
    scored_edges.sort(key=lambda x: x[3], reverse=True)
    top_edges = scored_edges[:10]
    if top_edges:
        lines.append("## Strongest Evidence-Backed Edges")
        for u, v, ed, score in top_edges:
            mech = ed.get("mechanism", "")
            lines.append(
                f"- {u[:8]}->{v[:8]}: \"{mech}\" "
                f"(strength={ed.get('strength', 0):.2f}, "
                f"evidence={ed.get('evidence_score', 0):.2f})"
            )
        lines.append("")

    # --- Remaining nodes (one-liner) ---
    covered = cp_set | {n for n, _ in high_sens} | set(roots) | set(terminals)
    remaining = [n for n in graph.nodes if n not in covered]
    if remaining:
        lines.append("## Other Nodes")
        for nid in remaining:
            nd = graph.nodes.get(nid, {})
            lines.append(
                f"- \"{nd.get('text', nid)}\" "
                f"(type={nd.get('claim_type', '?')}, belief={nd.get('belief', 0):.2f})"
            )
        lines.append("")

    # --- Summary stats ---
    lines.insert(0, f"Graph: {graph.number_of_nodes()} nodes, {graph.number_of_edges()} edges\n")

    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Rich scenario context
# ---------------------------------------------------------------------------


def _build_evidence_lines(
    edge_orm: CausalEdge | None,
    max_per_type: int = 2,
    snippet_len: int = 150,
) -> list[str]:
    """Format supporting/contradicting evidence from an ORM edge."""
    if edge_orm is None or not hasattr(edge_orm, "evidences") or not edge_orm.evidences:
        return []

    lines: list[str] = []
    supporting = [e for e in edge_orm.evidences if e.evidence_type == "supporting"]
    contradicting = [e for e in edge_orm.evidences if e.evidence_type == "contradicting"]

    # Sort by credibility descending
    supporting.sort(key=lambda e: e.credibility_score, reverse=True)
    contradicting.sort(key=lambda e: e.credibility_score, reverse=True)

    for ev in supporting[:max_per_type]:
        snippet = ev.snippet[:snippet_len] + ("..." if len(ev.snippet) > snippet_len else "")
        lines.append(
            f"    Supporting: \"{snippet}\" — {ev.source_title} "
            f"(credibility={ev.credibility_score:.2f})"
        )
    for ev in contradicting[:max_per_type]:
        snippet = ev.snippet[:snippet_len] + ("..." if len(ev.snippet) > snippet_len else "")
        lines.append(
            f"    Contradicting: \"{snippet}\" — {ev.source_title} "
            f"(credibility={ev.credibility_score:.2f})"
        )
    return lines


def build_scenario_context(
    graph: nx.DiGraph,
    critical_path: list[str],
    edges_orm: list[CausalEdge] | None = None,
    max_evidence_per_edge: int = 2,
    max_chains: int = 6,
) -> tuple[str, dict[int, tuple[str, str]]]:
    """Build rich scenario analysis context with evidence and causal chains.

    Returns:
        (context_text, edge_index_map) where edge_index_map maps
        edge index -> (source_node_id, target_node_id).
    """
    # Build ORM edge lookup by (source_id, target_id)
    orm_lookup: dict[tuple[str, str], CausalEdge] = {}
    if edges_orm:
        for e in edges_orm:
            orm_lookup[(str(e.source_claim_id), str(e.target_claim_id))] = e

    critical_set = set(critical_path)
    lines: list[str] = []
    lines.append(f"Graph: {graph.number_of_nodes()} nodes, {graph.number_of_edges()} edges")
    lines.append("")

    # --- Critical Path with evidence ---
    if critical_path:
        lines.append("## Critical Path")
        for i, nid in enumerate(critical_path):
            nd = graph.nodes.get(nid, {})
            text = nd.get("text", nid)
            belief = nd.get("belief", nd.get("confidence", 0))
            ctype = nd.get("claim_type", "?")
            lines.append(f"- \"{text}\" (belief={belief:.2f}, type={ctype}) [CRITICAL]")

            # Edge to next node
            if i < len(critical_path) - 1:
                tgt = critical_path[i + 1]
                if graph.has_edge(nid, tgt):
                    ed = graph.edges[nid, tgt]
                    mech = ed.get("mechanism", "")
                    strength = ed.get("strength", 0.5)
                    ev_score = ed.get("evidence_score", 0.5)
                    lines.append(
                        f"  → next: mechanism=\"{mech}\", "
                        f"strength={strength:.2f}, evidence={ev_score:.2f}"
                    )
                    # Evidence snippets
                    orm_edge = orm_lookup.get((nid, tgt))
                    ev_lines = _build_evidence_lines(orm_edge, max_evidence_per_edge)
                    lines.extend(ev_lines)
                    # Bias warnings
                    bias = ed.get("bias_warnings") or (
                        getattr(orm_edge, "bias_warnings", None) if orm_edge else None
                    )
                    if bias:
                        warnings = bias if isinstance(bias, list) else [bias]
                        for w in warnings:
                            label = w.get("type", w) if isinstance(w, dict) else str(w)
                            lines.append(f"    Bias: {label}")
        lines.append("")

    # --- Causal Argument Threads ---
    from curiocat.graph.path_finder import find_all_paths_to_node

    # Find terminal nodes (out-degree 0)
    terminals = [n for n in graph.nodes if graph.out_degree(n) == 0]
    all_thread_paths: list[dict] = []
    for terminal in terminals:
        paths = find_all_paths_to_node(graph, terminal)
        all_thread_paths.extend(paths)

    # Sort by compound probability, take top N
    all_thread_paths.sort(key=lambda p: p["compound_probability"], reverse=True)
    top_threads = all_thread_paths[:max_chains]

    if top_threads:
        lines.append("## Causal Argument Threads")
        for t_idx, thread in enumerate(top_threads, 1):
            path_nodes = thread["path"]
            prob = thread["compound_probability"]
            path_texts = [
                graph.nodes[n].get("text", n)[:50] for n in path_nodes
            ]
            lines.append(
                f"Thread {t_idx} (probability={prob:.3f}): "
                + " → ".join(f"\"{t}\"" for t in path_texts)
            )
            # Detail each hop
            for hop_idx in range(len(path_nodes) - 1):
                src, tgt = path_nodes[hop_idx], path_nodes[hop_idx + 1]
                if not graph.has_edge(src, tgt):
                    continue
                ed = graph.edges[src, tgt]
                mech = ed.get("mechanism", "")[:100]
                strength = ed.get("strength", 0.5)
                ev_score = ed.get("evidence_score", 0.5)
                lines.append(
                    f"  Hop {hop_idx + 1}: \"{graph.nodes[src].get('text', src)[:40]}\" "
                    f"→ \"{graph.nodes[tgt].get('text', tgt)[:40]}\""
                )
                lines.append(
                    f"    Mechanism: \"{mech}\""
                )
                lines.append(
                    f"    Strength={strength:.2f}, Evidence={ev_score:.2f}"
                )
                orm_edge = orm_lookup.get((src, tgt))
                ev_lines = _build_evidence_lines(orm_edge, max_evidence_per_edge)
                lines.extend(ev_lines)
        lines.append("")

    # --- Root Causes ---
    roots = [n for n in graph.nodes if graph.in_degree(n) == 0]
    if roots:
        lines.append("## Root Causes")
        for nid in roots:
            nd = graph.nodes.get(nid, {})
            lines.append(
                f"- \"{nd.get('text', nid)}\" "
                f"(type={nd.get('claim_type', '?')}, belief={nd.get('belief', 0):.2f})"
            )
        lines.append("")

    # --- Terminal Outcomes ---
    if terminals:
        lines.append("## Terminal Outcomes")
        for nid in terminals:
            nd = graph.nodes.get(nid, {})
            lines.append(
                f"- \"{nd.get('text', nid)}\" "
                f"(type={nd.get('claim_type', '?')}, belief={nd.get('belief', 0):.2f})"
            )
        lines.append("")

    # --- Edges (indexed for modification) ---
    edge_list: list[tuple[str, str, dict]] = []
    for u, v, data in graph.edges(data=True):
        edge_list.append((u, v, data))
    edge_list.sort(
        key=lambda e: e[2].get("strength", 0.5) * e[2].get("evidence_score", 0.5),
        reverse=True,
    )
    edge_list = edge_list[:MAX_EDGES]

    edge_index_map: dict[int, tuple[str, str]] = {}
    lines.append("## Edges (indexed for modification)")
    for idx, (u, v, data) in enumerate(edge_list):
        edge_index_map[idx] = (u, v)
        src_text = graph.nodes[u].get("text", u)[:60]
        tgt_text = graph.nodes[v].get("text", v)[:60]
        mechanism = data.get("mechanism", "")[:80]
        strength = data.get("strength", 0.5)
        ev_score = data.get("evidence_score", 0.5)
        lines.append(
            f"[{idx}] \"{src_text}\" → \"{tgt_text}\" "
            f"(strength={strength:.2f}, evidence={ev_score:.2f}, mechanism: {mechanism})"
        )

    return "\n".join(lines), edge_index_map
