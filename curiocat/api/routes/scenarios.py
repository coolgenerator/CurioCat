"""Scenario API routes.

Provides endpoints to fork alternative scenarios from a project and
compare two scenarios to identify where beliefs diverge.
"""

from __future__ import annotations

import copy
import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from curiocat.api.models.graph import GraphResponse
from curiocat.api.models.scenarios import (
    ForkRequest,
    ForkWithGraphResponse,
    ReportItem,
    ReportsListResponse,
    ScenarioComparison,
    ScenarioListResponse,
    ScenarioResponse,
)
from curiocat.api.routes.graph import (
    _assemble_graph_response,
    _break_cycles,
    _build_nx_graph,
    _load_project_graph,
)
from curiocat.db.models import CausalEdge, Claim, Project, Scenario
from curiocat.db.session import get_session
from curiocat.graph.belief_propagation import propagate_beliefs
from curiocat.graph.critical_path import find_critical_path
from curiocat.graph.scenario_diff import diff_scenarios
from curiocat.graph.sensitivity import analyze_sensitivity

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1", tags=["scenarios"])


def _apply_overrides(
    edges: list[CausalEdge],
    overrides: dict[str, float],
) -> list[CausalEdge]:
    """Return a shallow copy of edge list with strength overrides applied.

    Does not mutate the original ORM objects.
    """
    result: list[CausalEdge] = []
    for edge in edges:
        edge_id_str = str(edge.id)
        if edge_id_str in overrides:
            # Create a detached copy so we don't modify the DB object
            patched = copy.copy(edge)
            patched.strength = overrides[edge_id_str]
            result.append(patched)
        else:
            result.append(edge)
    return result


def _compute_scenario_graph(
    project_id: UUID,
    claims: list[Claim],
    edges: list[CausalEdge],
    edge_overrides: dict[str, float],
    has_temporal: bool = True,
) -> GraphResponse:
    """Build a full GraphResponse for a scenario with edge overrides applied."""
    patched_edges = _apply_overrides(edges, edge_overrides)

    if not claims:
        return GraphResponse(project_id=project_id, claims=[], edges=[], has_temporal=has_temporal)

    graph = _build_nx_graph(claims, patched_edges)
    graph = _break_cycles(graph)
    graph = propagate_beliefs(graph)
    # Skip expensive sensitivity analysis — same as main graph load
    sensitivity: dict[str, dict[str, float]] = {"edges": {}, "nodes": {}}
    critical_path = find_critical_path(graph)

    return _assemble_graph_response(
        project_id, claims, patched_edges, graph, sensitivity, critical_path,
        has_temporal=has_temporal,
    )


@router.get("/reports", response_model=ReportsListResponse)
async def list_reports(
    session: AsyncSession = Depends(get_session),
) -> ReportsListResponse:
    """List all scenario reports (scenarios that have a narrative) across all projects."""
    result = await session.execute(
        select(Scenario, Project.title)
        .join(Project, Scenario.project_id == Project.id)
        .where(Scenario.narrative.isnot(None))
        .order_by(Scenario.created_at.desc())
    )
    rows = result.all()

    reports = [
        ReportItem(
            id=s.id,
            project_id=s.project_id,
            project_title=title,
            name=s.name,
            description=s.description,
            narrative=s.narrative,
            key_insights=s.key_insights or [],
            conclusion=s.conclusion,
            edge_change_reasons=s.edge_change_reasons or [],
            created_at=s.created_at.isoformat() if s.created_at else None,
        )
        for s, title in rows
    ]

    return ReportsListResponse(reports=reports)


@router.get("/scenarios/{project_id}", response_model=ScenarioListResponse)
async def list_scenarios(
    project_id: UUID,
    session: AsyncSession = Depends(get_session),
) -> ScenarioListResponse:
    """List all scenarios for a given project."""
    project = await session.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")

    result = await session.execute(
        select(Scenario).where(Scenario.project_id == project_id)
    )
    scenarios = result.scalars().all()

    return ScenarioListResponse(
        scenarios=[
            ScenarioResponse(
                id=s.id,
                project_id=s.project_id,
                name=s.name,
                description=s.description,
                parent_scenario_id=s.parent_scenario_id,
                narrative=s.narrative,
                key_insights=s.key_insights or [],
                conclusion=s.conclusion,
                edge_change_reasons=s.edge_change_reasons or [],
            )
            for s in scenarios
        ]
    )


@router.post("/scenario/{scenario_id}/regenerate", response_model=ScenarioResponse)
async def regenerate_scenario_report(
    scenario_id: UUID,
    session: AsyncSession = Depends(get_session),
) -> ScenarioResponse:
    """Re-run LLM analysis for an existing scenario and persist the report."""
    scenario = await session.get(Scenario, scenario_id)
    if scenario is None:
        raise HTTPException(status_code=404, detail="Scenario not found")

    _project, claims, edges = await _load_project_graph(scenario.project_id, session)

    if not claims:
        raise HTTPException(status_code=404, detail="No graph data")

    from curiocat.pipeline.scenario_analyst import analyze_scenario

    nx_graph = _build_nx_graph(claims, edges)
    nx_graph = _break_cycles(nx_graph)
    nx_graph = propagate_beliefs(nx_graph)
    critical_path = find_critical_path(nx_graph)

    analysis = await analyze_scenario(
        nx_graph,
        critical_path,
        scenario.name,
        scenario.description,
        scenario.injected_events or [],
        edges_orm=edges,
    )

    # Update the scenario record with the new report
    scenario.narrative = analysis.analysis
    scenario.key_insights = analysis.key_insights or None
    scenario.conclusion = analysis.conclusion
    scenario.edge_change_reasons = analysis.edge_change_reasons or None

    # Also update edge_overrides if the scenario had none and LLM produced some
    if not scenario.edge_overrides and analysis.edge_overrides:
        scenario.edge_overrides = analysis.edge_overrides

    await session.commit()
    await session.refresh(scenario)

    return ScenarioResponse(
        id=scenario.id,
        project_id=scenario.project_id,
        name=scenario.name,
        description=scenario.description,
        parent_scenario_id=scenario.parent_scenario_id,
        narrative=scenario.narrative,
        key_insights=scenario.key_insights or [],
        conclusion=scenario.conclusion,
        edge_change_reasons=scenario.edge_change_reasons or [],
    )


@router.delete("/scenarios/{scenario_id}")
async def delete_scenario(
    scenario_id: UUID,
    session: AsyncSession = Depends(get_session),
) -> dict:
    """Delete a scenario by ID."""
    scenario = await session.get(Scenario, scenario_id)
    if scenario is None:
        raise HTTPException(status_code=404, detail="Scenario not found")
    await session.delete(scenario)
    await session.commit()
    return {"ok": True}


@router.post("/fork", response_model=ForkWithGraphResponse)
async def fork_scenario(
    req: ForkRequest,
    session: AsyncSession = Depends(get_session),
) -> ForkWithGraphResponse:
    """Fork a new scenario from a project.

    Stores edge overrides and injected events, computes the modified graph
    with belief propagation, and returns both the scenario metadata and the
    resulting graph so the frontend can immediately show the impact analysis.

    If injected events or a description are provided, calls the LLM to
    analyze how the scenario affects edge strengths and generates a narrative
    report.  User-supplied edge overrides take priority over LLM suggestions.
    """
    project = await session.get(Project, req.project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")

    # Load the base project graph
    _project, claims, edges = await _load_project_graph(req.project_id, session)
    has_temporal = getattr(_project, 'has_temporal', True)

    # LLM-driven scenario analysis when hypothesis info is provided
    llm_overrides: dict[str, float] = {}
    narrative: str | None = None
    key_insights: list[str] = []
    conclusion: str | None = None
    edge_change_reasons: list[dict] = []

    if req.injected_events or req.description:
        try:
            from curiocat.pipeline.scenario_analyst import analyze_scenario

            # Build a temporary graph for LLM analysis
            nx_graph = _build_nx_graph(claims, edges)
            nx_graph = _break_cycles(nx_graph)
            nx_graph = propagate_beliefs(nx_graph)
            critical_path = find_critical_path(nx_graph)

            analysis = await analyze_scenario(
                nx_graph,
                critical_path,
                req.name,
                req.description,
                req.injected_events,
                edges_orm=edges,
            )
            llm_overrides = analysis.edge_overrides
            narrative = analysis.analysis
            key_insights = analysis.key_insights
            conclusion = analysis.conclusion
            edge_change_reasons = analysis.edge_change_reasons
        except Exception:
            logger.exception("LLM scenario analysis failed, continuing without it")

    # Merge: user manual overrides take priority over LLM suggestions
    merged_overrides = {**llm_overrides, **req.edge_overrides}

    # Persist the scenario with merged overrides and analysis report
    scenario = Scenario(
        project_id=req.project_id,
        name=req.name,
        description=req.description,
        edge_overrides=merged_overrides,
        injected_events=req.injected_events,
        narrative=narrative,
        key_insights=key_insights or None,
        conclusion=conclusion,
        edge_change_reasons=edge_change_reasons or None,
    )
    session.add(scenario)
    await session.commit()
    await session.refresh(scenario)

    # Compute the scenario graph with merged overrides applied
    graph_response = _compute_scenario_graph(
        req.project_id, claims, edges, merged_overrides,
        has_temporal=has_temporal,
    )

    scenario_response = ScenarioResponse(
        id=scenario.id,
        project_id=scenario.project_id,
        name=scenario.name,
        description=scenario.description,
        parent_scenario_id=scenario.parent_scenario_id,
        narrative=scenario.narrative,
        key_insights=scenario.key_insights or [],
        conclusion=scenario.conclusion,
        edge_change_reasons=scenario.edge_change_reasons or [],
    )

    return ForkWithGraphResponse(
        scenario=scenario_response,
        graph=graph_response,
        narrative=narrative,
        key_insights=key_insights,
        conclusion=conclusion,
        edge_change_reasons=edge_change_reasons,
    )


@router.get("/scenario/{scenario_id}/report", response_model=ForkWithGraphResponse)
async def get_scenario_report(
    scenario_id: UUID,
    session: AsyncSession = Depends(get_session),
) -> ForkWithGraphResponse:
    """Load a saved scenario report with its computed graph."""
    scenario = await session.get(Scenario, scenario_id)
    if scenario is None:
        raise HTTPException(status_code=404, detail="Scenario not found")

    _project, claims, edges = await _load_project_graph(scenario.project_id, session)
    has_temporal = getattr(_project, "has_temporal", True)

    graph_response = _compute_scenario_graph(
        scenario.project_id, claims, edges, scenario.edge_overrides or {},
        has_temporal=has_temporal,
    )

    scenario_response = ScenarioResponse(
        id=scenario.id,
        project_id=scenario.project_id,
        name=scenario.name,
        description=scenario.description,
        parent_scenario_id=scenario.parent_scenario_id,
        narrative=scenario.narrative,
        key_insights=scenario.key_insights or [],
        conclusion=scenario.conclusion,
        edge_change_reasons=scenario.edge_change_reasons or [],
    )

    return ForkWithGraphResponse(
        scenario=scenario_response,
        graph=graph_response,
        narrative=scenario.narrative,
        key_insights=scenario.key_insights or [],
        conclusion=scenario.conclusion,
        edge_change_reasons=scenario.edge_change_reasons or [],
    )


@router.get("/compare", response_model=ScenarioComparison)
async def compare_scenarios(
    scenario_a_id: UUID,
    scenario_b_id: UUID,
    session: AsyncSession = Depends(get_session),
) -> ScenarioComparison:
    """Compare two scenarios and identify divergent / convergent nodes.

    Loads the base project data, applies each scenario's edge overrides,
    runs belief propagation, and then diffs the resulting graphs.
    """
    # Load both scenarios
    scenario_a = await session.get(Scenario, scenario_a_id)
    if scenario_a is None:
        raise HTTPException(
            status_code=404, detail=f"Scenario {scenario_a_id} not found"
        )

    scenario_b = await session.get(Scenario, scenario_b_id)
    if scenario_b is None:
        raise HTTPException(
            status_code=404, detail=f"Scenario {scenario_b_id} not found"
        )

    if scenario_a.project_id != scenario_b.project_id:
        raise HTTPException(
            status_code=400,
            detail="Both scenarios must belong to the same project",
        )

    project_id = scenario_a.project_id

    # Load the base project graph data
    project, claims, edges = await _load_project_graph(project_id, session)
    has_temporal = getattr(project, 'has_temporal', True)

    # Build graph for each scenario
    overrides_a: dict[str, float] = scenario_a.edge_overrides or {}
    overrides_b: dict[str, float] = scenario_b.edge_overrides or {}

    edges_a = _apply_overrides(edges, overrides_a)
    edges_b = _apply_overrides(edges, overrides_b)

    graph_a = _build_nx_graph(claims, edges_a)
    graph_a = _break_cycles(graph_a)
    graph_a = propagate_beliefs(graph_a)

    graph_b = _build_nx_graph(claims, edges_b)
    graph_b = _break_cycles(graph_b)
    graph_b = propagate_beliefs(graph_b)

    # Diff the two graphs
    diff = diff_scenarios(graph_a, graph_b)

    # Build full GraphResponses for each scenario (skip expensive sensitivity)
    sensitivity: dict[str, dict[str, float]] = {"edges": {}, "nodes": {}}
    critical_path_a = find_critical_path(graph_a)
    response_a = _assemble_graph_response(
        project_id, claims, edges_a, graph_a, sensitivity, critical_path_a,
        has_temporal=has_temporal,
    )

    critical_path_b = find_critical_path(graph_b)
    response_b = _assemble_graph_response(
        project_id, claims, edges_b, graph_b, sensitivity, critical_path_b,
        has_temporal=has_temporal,
    )

    # Extract divergent/convergent node IDs from the diff result
    divergent_node_ids = [
        UUID(node["node_id"]) for node in diff.get("divergent_nodes", [])
    ]
    convergent_node_ids = [
        UUID(node["node_id"]) for node in diff.get("convergent_nodes", [])
    ]

    return ScenarioComparison(
        scenario_a=response_a,
        scenario_b=response_b,
        divergent_nodes=divergent_node_ids,
        convergent_nodes=convergent_node_ids,
    )
