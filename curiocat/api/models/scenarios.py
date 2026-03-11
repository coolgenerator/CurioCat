"""Pydantic schemas for scenario endpoints."""

from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel

from curiocat.api.models.graph import GraphResponse


class ForkRequest(BaseModel):
    """Request body for forking a new scenario from a project."""

    project_id: UUID
    name: str
    description: str | None = None
    edge_overrides: dict[str, float] = {}  # {edge_id: new_strength}
    injected_events: list[str] = []


class ScenarioResponse(BaseModel):
    """A scenario record."""

    id: UUID
    project_id: UUID
    name: str
    description: str | None = None
    parent_scenario_id: UUID | None = None
    narrative: str | None = None
    key_insights: list[str] = []
    conclusion: str | None = None
    edge_change_reasons: list[dict] = []


class ScenarioListResponse(BaseModel):
    """Response for listing scenarios of a project."""

    scenarios: list[ScenarioResponse]


class ForkWithGraphResponse(BaseModel):
    """Fork response including the computed scenario graph."""

    scenario: ScenarioResponse
    graph: GraphResponse
    narrative: str | None = None
    key_insights: list[str] = []
    conclusion: str | None = None
    edge_change_reasons: list[dict] = []


class ReportItem(BaseModel):
    """A scenario report with its project context."""

    id: UUID
    project_id: UUID
    project_title: str
    name: str
    description: str | None = None
    narrative: str | None = None
    key_insights: list[str] = []
    conclusion: str | None = None
    edge_change_reasons: list[dict] = []
    created_at: str | None = None


class ReportsListResponse(BaseModel):
    """Response for listing all scenario reports."""

    reports: list[ReportItem]


class ScenarioComparison(BaseModel):
    """Result of comparing two scenarios."""

    scenario_a: GraphResponse
    scenario_b: GraphResponse
    divergent_nodes: list[UUID]
    convergent_nodes: list[UUID]
