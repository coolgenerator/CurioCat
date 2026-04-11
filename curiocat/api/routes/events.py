"""Event Timeline API — CRUD for PM intervention/change events."""

from __future__ import annotations

import logging
import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from curiocat.db.models import EventTimeline
from curiocat.db.session import get_session

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/events", tags=["events"])


class EventCreate(BaseModel):
    title: str
    description: str | None = None
    event_type: str
    event_date: datetime
    project_id: str | None = None
    affected_metrics: list[str] | None = None
    metadata: dict | None = None


class EventUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    event_type: str | None = None
    event_date: datetime | None = None
    affected_metrics: list[str] | None = None


class EventOut(BaseModel):
    id: str
    title: str
    description: str | None
    event_type: str
    event_date: str
    source: str
    project_id: str | None
    affected_metrics: list[str] | None
    evidence_ids: list[str] | None
    created_at: str


@router.post("", response_model=EventOut, status_code=status.HTTP_201_CREATED)
async def create_event(body: EventCreate, session: AsyncSession = Depends(get_session)):
    valid_types = {"pricing", "feature", "campaign", "external", "bug", "other"}
    if body.event_type not in valid_types:
        raise HTTPException(400, f"event_type must be one of: {valid_types}")

    project_id = uuid.UUID(body.project_id) if body.project_id else None
    event = EventTimeline(
        project_id=project_id, title=body.title, description=body.description,
        event_type=body.event_type, event_date=body.event_date,
        affected_metrics=body.affected_metrics, metadata_=body.metadata,
    )
    session.add(event)
    await session.commit()
    await session.refresh(event)
    return _to_out(event)


@router.get("", response_model=list[EventOut])
async def list_events(project_id: str | None = None, session: AsyncSession = Depends(get_session)):
    query = select(EventTimeline).order_by(EventTimeline.event_date.desc())
    if project_id:
        query = query.where(EventTimeline.project_id == uuid.UUID(project_id))
    result = await session.execute(query)
    return [_to_out(e) for e in result.scalars().all()]


@router.get("/{event_id}", response_model=EventOut)
async def get_event(event_id: uuid.UUID, session: AsyncSession = Depends(get_session)):
    result = await session.execute(select(EventTimeline).where(EventTimeline.id == event_id))
    event = result.scalar_one_or_none()
    if event is None:
        raise HTTPException(404, "Event not found")
    return _to_out(event)


@router.patch("/{event_id}", response_model=EventOut)
async def update_event(event_id: uuid.UUID, body: EventUpdate, session: AsyncSession = Depends(get_session)):
    result = await session.execute(select(EventTimeline).where(EventTimeline.id == event_id))
    event = result.scalar_one_or_none()
    if event is None:
        raise HTTPException(404, "Event not found")

    for field in ("title", "description", "event_type", "event_date", "affected_metrics"):
        val = getattr(body, field, None)
        if val is not None:
            setattr(event, field, val)

    await session.commit()
    await session.refresh(event)
    return _to_out(event)


@router.delete("/{event_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_event(event_id: uuid.UUID, session: AsyncSession = Depends(get_session)):
    result = await session.execute(select(EventTimeline).where(EventTimeline.id == event_id))
    event = result.scalar_one_or_none()
    if event is None:
        raise HTTPException(404, "Event not found")
    await session.delete(event)
    await session.commit()


def _to_out(event: EventTimeline) -> EventOut:
    return EventOut(
        id=str(event.id), title=event.title, description=event.description,
        event_type=event.event_type, event_date=event.event_date.isoformat(),
        source=event.source, project_id=str(event.project_id) if event.project_id else None,
        affected_metrics=event.affected_metrics, evidence_ids=event.evidence_ids,
        created_at=event.created_at.isoformat(),
    )
