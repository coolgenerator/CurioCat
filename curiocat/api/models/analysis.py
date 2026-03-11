"""Pydantic schemas for analysis endpoints."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field


class AnalyzeRequest(BaseModel):
    """Request body for starting a new causal analysis."""

    title: str = Field(..., min_length=1, max_length=500)
    text: str = Field(..., min_length=10)


class AnalyzeFileResponse(BaseModel):
    """Response returned after extracting text from an uploaded file."""

    title: str
    text: str


class AnalyzeResponse(BaseModel):
    """Response returned when an analysis is kicked off."""

    project_id: UUID
    status: str


class PipelineStageStatus(BaseModel):
    """Status of an individual pipeline stage."""

    stage: str
    status: str  # started, progress, completed, error
    progress: float = 0.0
    data: dict | None = None
    timestamp: datetime


class ProjectSummary(BaseModel):
    """Lightweight project summary for list views."""

    id: UUID
    title: str
    status: str
    created_at: datetime


class ProjectListResponse(BaseModel):
    """Response for listing all projects."""

    projects: list[ProjectSummary]


class ProjectStatus(BaseModel):
    """Full project status with per-stage breakdown."""

    project_id: UUID
    title: str
    status: str
    created_at: datetime
    stages: list[PipelineStageStatus] = []
    claim_count: int = 0
