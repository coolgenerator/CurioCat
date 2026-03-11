"""Export API routes.

Provides endpoints to export a project's causal graph in multiple formats:
JSON, Markdown, and GraphML.
"""

from __future__ import annotations

import io
import logging
from uuid import UUID

import networkx as nx
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import PlainTextResponse, Response
from sqlalchemy.ext.asyncio import AsyncSession

from curiocat.api.routes.graph import (
    _build_nx_graph,
    _compute_full_graph,
    _load_project_graph,
)
from curiocat.db.session import get_session

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1", tags=["export"])


def _generate_markdown(graph_response) -> str:
    """Generate a structured Markdown report from a GraphResponse."""
    lines: list[str] = []

    lines.append(f"# Causal Analysis Report")
    lines.append("")
    lines.append(f"**Project ID:** `{graph_response.project_id}`")
    lines.append("")

    # Claims section
    lines.append("## Claims")
    lines.append("")

    if not graph_response.claims:
        lines.append("_No claims extracted._")
    else:
        for i, claim in enumerate(graph_response.claims, 1):
            belief_str = f"{claim.belief:.2f}" if claim.belief is not None else "N/A"
            critical = " **[CRITICAL PATH]**" if claim.is_critical_path else ""
            lines.append(f"### {i}. {claim.text}")
            lines.append("")
            lines.append(f"- **Type:** {claim.claim_type}")
            lines.append(f"- **Confidence:** {claim.confidence:.2f}")
            lines.append(f"- **Belief:** {belief_str}")
            if claim.sensitivity is not None:
                lines.append(f"- **Sensitivity:** {claim.sensitivity:.4f}")
            if critical:
                lines.append(f"- **Critical Path:** Yes")
            lines.append("")

    # Causal Edges section
    lines.append("## Causal Edges")
    lines.append("")

    if not graph_response.edges:
        lines.append("_No causal edges identified._")
    else:
        # Build a lookup from claim ID to claim text for readable output
        claim_lookup = {str(c.id): c.text for c in graph_response.claims}

        for edge in graph_response.edges:
            source_text = claim_lookup.get(
                str(edge.source_claim_id), str(edge.source_claim_id)
            )
            target_text = claim_lookup.get(
                str(edge.target_claim_id), str(edge.target_claim_id)
            )

            lines.append(f"### {source_text} -> {target_text}")
            lines.append("")
            lines.append(f"- **Mechanism:** {edge.mechanism}")
            lines.append(f"- **Strength:** {edge.strength:.2f}")
            lines.append(f"- **Evidence Score:** {edge.evidence_score:.2f}")
            if edge.time_delay:
                lines.append(f"- **Time Delay:** {edge.time_delay}")
            if edge.conditions:
                lines.append(
                    f"- **Conditions:** {', '.join(edge.conditions)}"
                )
            lines.append(f"- **Reversible:** {'Yes' if edge.reversible else 'No'}")
            if edge.sensitivity is not None:
                lines.append(f"- **Sensitivity:** {edge.sensitivity:.4f}")

            if edge.evidences:
                lines.append("")
                lines.append("**Evidence:**")
                lines.append("")
                for ev in edge.evidences:
                    lines.append(
                        f"  - [{ev.source_title}]({ev.source_url}) "
                        f"({ev.evidence_type}, relevance: {ev.relevance_score:.2f}, "
                        f"credibility: {ev.credibility_score:.2f})"
                    )
                    lines.append(f"    > {ev.snippet}")

            lines.append("")

    # Critical Path section
    if graph_response.critical_path:
        lines.append("## Critical Path")
        lines.append("")
        claim_lookup = {str(c.id): c.text for c in graph_response.claims}
        for i, node_id in enumerate(graph_response.critical_path, 1):
            node_text = claim_lookup.get(str(node_id), str(node_id))
            lines.append(f"{i}. {node_text}")
        lines.append("")

    # Summary
    lines.append("---")
    lines.append("")
    lines.append(
        f"*Report contains {len(graph_response.claims)} claims and "
        f"{len(graph_response.edges)} causal edges.*"
    )

    return "\n".join(lines)


def _generate_graphml(claims, edges) -> str:
    """Generate GraphML XML from claims and edges."""
    g = _build_nx_graph(claims, edges)

    # NetworkX write_graphml works with a BytesIO buffer
    buf = io.BytesIO()
    nx.write_graphml(g, buf)
    return buf.getvalue().decode("utf-8")


@router.get("/export/{project_id}/{format}")
async def export_graph(
    project_id: UUID,
    format: str,
    session: AsyncSession = Depends(get_session),
) -> Response:
    """Export a project's causal graph in the requested format.

    Supported formats:
    - ``json``: Full GraphResponse as JSON.
    - ``markdown``: Structured Markdown report.
    - ``graphml``: GraphML XML for import into graph tools.
    """
    if format not in ("json", "markdown", "graphml"):
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported format: {format}. Use 'json', 'markdown', or 'graphml'.",
        )

    if format == "json":
        graph_response = await _compute_full_graph(project_id, session)
        return Response(
            content=graph_response.model_dump_json(indent=2),
            media_type="application/json",
            headers={
                "Content-Disposition": f'attachment; filename="curiocat_{project_id}.json"'
            },
        )

    if format == "markdown":
        graph_response = await _compute_full_graph(project_id, session)
        md = _generate_markdown(graph_response)
        return PlainTextResponse(
            content=md,
            media_type="text/markdown",
            headers={
                "Content-Disposition": f'attachment; filename="curiocat_{project_id}.md"'
            },
        )

    if format == "graphml":
        _project, claims, edges = await _load_project_graph(
            project_id, session
        )
        xml = _generate_graphml(claims, edges)
        return Response(
            content=xml,
            media_type="application/xml",
            headers={
                "Content-Disposition": f'attachment; filename="curiocat_{project_id}.graphml"'
            },
        )

    # Should not reach here due to the check above, but satisfy the type checker
    raise HTTPException(status_code=400, detail="Unsupported format")
