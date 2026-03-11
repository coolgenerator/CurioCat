"""Analysis API routes.

Provides endpoints to start a causal analysis pipeline, stream progress
via Server-Sent Events, and poll for status.
"""

from __future__ import annotations

import asyncio
import io
import json
import logging
from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, UploadFile, File
from sqlalchemy.ext.asyncio import AsyncSession
from sse_starlette.sse import EventSourceResponse

from sqlalchemy import select

from curiocat.api.models.analysis import (
    AnalyzeFileResponse,
    AnalyzeRequest,
    AnalyzeResponse,
    PipelineStageStatus,
    ProjectListResponse,
    ProjectStatus,
    ProjectSummary,
)
from curiocat.config import settings
from curiocat.db.models import Claim, Project
from curiocat.db.session import async_session, get_session
from curiocat.evidence.web_search import BraveSearchClient
from curiocat.llm.client import get_llm_client
from curiocat.llm.embeddings import EmbeddingService
from curiocat.pipeline.orchestrator import CausalPipeline, PipelineEvent

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1", tags=["analysis"])

# ---------------------------------------------------------------------------
# Replay-able event log: SSE consumers can reconnect and replay all events.
# This avoids losing events when React StrictMode double-invokes effects.
# ---------------------------------------------------------------------------

class _PipelineEventLog:
    """Append-only event log with notification for SSE consumers."""

    def __init__(self) -> None:
        self.events: list[PipelineEvent | None] = []
        self.notify = asyncio.Event()
        self.stage_history: list[PipelineStageStatus] = []

    def append(self, event: PipelineEvent | None) -> None:
        self.events.append(event)
        self.notify.set()

    def append_stage(self, stage: PipelineStageStatus) -> None:
        self.stage_history.append(stage)


_pipeline_logs: dict[str, _PipelineEventLog] = {}


async def _run_pipeline(project_id: str, text: str) -> None:
    """Background coroutine that executes the full causal pipeline.

    Appends PipelineEvent objects to the replay-able event log so that
    SSE stream consumers can read them (including on reconnection).
    A ``None`` sentinel signals completion.
    """
    log = _pipeline_logs.get(project_id)
    if log is None:
        log = _PipelineEventLog()
        _pipeline_logs[project_id] = log

    async with async_session() as session:
        try:
            llm_client = get_llm_client()
            embedding_service = EmbeddingService()

            search_client: BraveSearchClient | None = None
            if settings.brave_search_api_key:
                search_client = BraveSearchClient(settings.brave_search_api_key)

            pipeline = CausalPipeline(
                session=session,
                llm_client=llm_client,
                embedding_service=embedding_service,
                search_client=search_client,
            )

            async def event_callback(event: PipelineEvent) -> None:
                stage_status = PipelineStageStatus(
                    stage=event.stage,
                    status=event.status,
                    progress=event.progress,
                    data=event.data if isinstance(event.data, dict) else None,
                    timestamp=datetime.now(timezone.utc),
                )
                log.append_stage(stage_status)
                log.append(event)

            await pipeline.run(project_id, text, event_callback)
            await session.commit()

        except Exception as exc:
            logger.exception("Pipeline failed for project %s: %s", project_id, exc)
            error_event = PipelineEvent(
                stage="pipeline",
                status="error",
                data={"error": str(exc)},
                progress=0.0,
            )
            error_stage = PipelineStageStatus(
                stage="pipeline",
                status="error",
                data={"error": str(exc)},
                timestamp=datetime.now(timezone.utc),
            )
            log.append_stage(error_stage)
            log.append(error_event)

        finally:
            # Signal completion
            log.append(None)

            if search_client is not None:
                await search_client.close()


@router.post("/upload", response_model=AnalyzeFileResponse)
async def upload_file(file: UploadFile = File(...)) -> AnalyzeFileResponse:
    """Extract text content from an uploaded file.

    Supports: .txt, .md, .csv, .json, .pdf, .png, .jpg, .jpeg, .webp
    For PDF: extracts text from all pages.
    For images: uses OpenAI Vision API to describe the content.
    Returns extracted text so the frontend can populate the input form.
    """
    if file.filename is None:
        raise HTTPException(status_code=400, detail="No filename provided")

    filename = file.filename.lower()
    content = await file.read()

    # --- Plain text files ---
    if filename.endswith((".txt", ".md", ".csv", ".json")):
        try:
            text = content.decode("utf-8")
        except UnicodeDecodeError:
            text = content.decode("latin-1")
        title = file.filename.rsplit(".", 1)[0]
        return AnalyzeFileResponse(title=title, text=text)

    # --- PDF ---
    if filename.endswith(".pdf"):
        try:
            import pypdf
            reader = pypdf.PdfReader(io.BytesIO(content))
            pages_text = [page.extract_text() or "" for page in reader.pages]
            text = "\n\n".join(pages_text).strip()
        except ImportError:
            raise HTTPException(
                status_code=501,
                detail="PDF support requires pypdf. Install with: pip install pypdf",
            )
        if not text:
            raise HTTPException(status_code=422, detail="Could not extract text from PDF")
        title = file.filename.rsplit(".", 1)[0]
        return AnalyzeFileResponse(title=title, text=text)

    # --- Images (via OpenAI Vision) ---
    if filename.endswith((".png", ".jpg", ".jpeg", ".webp", ".gif")):
        import base64
        from curiocat.config import settings

        if not settings.openai_api_key:
            raise HTTPException(
                status_code=501,
                detail="Image analysis requires OPENAI_API_KEY for Vision API",
            )

        from openai import AsyncOpenAI
        client = AsyncOpenAI(api_key=settings.openai_api_key)

        # Determine MIME type
        ext = filename.rsplit(".", 1)[-1]
        mime_map = {"png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg", "webp": "image/webp", "gif": "image/gif"}
        mime_type = mime_map.get(ext, "image/png")

        b64_image = base64.b64encode(content).decode("utf-8")

        response = await client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": (
                                "Analyze this image in detail. Extract all factual claims, "
                                "assertions, data points, relationships, and causal statements "
                                "visible in the image. If it's a chart/graph/diagram, describe "
                                "the data and trends. If it's a document/screenshot, transcribe "
                                "the key content. If it's a photo/scene, describe what's happening "
                                "and any causal relationships you can identify. "
                                "Write your analysis as structured prose paragraphs."
                            ),
                        },
                        {
                            "type": "image_url",
                            "image_url": {"url": f"data:{mime_type};base64,{b64_image}"},
                        },
                    ],
                }
            ],
            max_tokens=4096,
        )

        text = response.choices[0].message.content or ""
        if not text:
            raise HTTPException(status_code=422, detail="Could not extract content from image")

        title = file.filename.rsplit(".", 1)[0]
        return AnalyzeFileResponse(title=title, text=text)

    raise HTTPException(
        status_code=415,
        detail=f"Unsupported file type. Supported: .txt, .md, .csv, .json, .pdf, .png, .jpg, .jpeg, .webp",
    )


@router.post("/analyze", response_model=AnalyzeResponse)
async def start_analysis(
    req: AnalyzeRequest,
    background_tasks: BackgroundTasks,
    session: AsyncSession = Depends(get_session),
) -> AnalyzeResponse:
    """Start a new causal analysis pipeline.

    Creates a project record in the database and kicks off the 5-stage
    pipeline as a background task.  Returns immediately with the
    ``project_id`` so the client can subscribe to the SSE stream.
    """
    project = Project(
        title=req.title,
        input_text=req.text,
        status="processing",
    )
    session.add(project)
    await session.commit()
    await session.refresh(project)

    project_id_str = str(project.id)

    # Create the event log *before* scheduling the background task
    _pipeline_logs[project_id_str] = _PipelineEventLog()

    background_tasks.add_task(_run_pipeline, project_id_str, req.text)

    return AnalyzeResponse(project_id=project.id, status="processing")


@router.get("/analyze/{project_id}/stream")
async def stream_analysis(
    project_id: UUID,
    session: AsyncSession = Depends(get_session),
) -> EventSourceResponse:
    """Stream pipeline progress via Server-Sent Events.

    Each event has:
    - ``event``: the pipeline stage name
    - ``data``: JSON with ``status``, ``progress``, and optional ``data``

    The stream terminates when the pipeline finishes (a ``None`` sentinel
    is received from the internal queue) or when the client disconnects.
    """
    # Verify the project exists
    project = await session.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")

    project_id_str = str(project_id)
    log = _pipeline_logs.get(project_id_str)

    if log is None:
        # Pipeline already finished or was never started
        if project.status in ("completed", "failed"):
            async def _completed_stream():
                yield {
                    "event": "complete",
                    "data": json.dumps({
                        "status": "complete",
                        "progress": 1.0 if project.status == "completed" else 0.0,
                    }),
                }

            return EventSourceResponse(_completed_stream())

        # Pipeline might not have started yet; create a log
        log = _PipelineEventLog()
        _pipeline_logs[project_id_str] = log

    async def _event_generator():
        # Replay-able: start from index 0 and read all events, including
        # those already appended before this SSE connection opened.
        # This is critical for React StrictMode which disconnects/reconnects.
        index = 0
        try:
            while True:
                # Yield all events available so far
                while index < len(log.events):
                    event = log.events[index]
                    index += 1

                    if event is None:
                        # Sentinel: pipeline finished
                        yield {
                            "event": "complete",
                            "data": json.dumps({"status": "complete", "progress": 1.0}),
                        }
                        return

                    yield _serialize_event(event)

                # No more events yet — wait for notification
                log.notify.clear()
                try:
                    await asyncio.wait_for(log.notify.wait(), timeout=300.0)
                except asyncio.TimeoutError:
                    yield {"comment": "keep-alive"}
        except asyncio.CancelledError:
            pass

    return EventSourceResponse(_event_generator())


def _serialize_event(event: PipelineEvent) -> dict[str, str]:
    """Serialize a PipelineEvent into an SSE-compatible dict."""
    payload: dict[str, Any] = {
        "status": event.status,
        "progress": event.progress,
        "stage": event.stage,
        "layer": getattr(event, "layer", 0),
    }
    if isinstance(event.data, dict):
        payload.update(event.data)

    event_name = event.stage
    if event.status == "error":
        payload["message"] = payload.get("error", "Pipeline error")
        event_name = "error_event"

    return {"event": event_name, "data": json.dumps(payload)}


@router.get("/projects", response_model=ProjectListResponse)
async def list_projects(
    session: AsyncSession = Depends(get_session),
) -> ProjectListResponse:
    """List all projects, ordered by creation date descending."""
    result = await session.execute(
        select(Project).order_by(Project.created_at.desc())
    )
    projects = result.scalars().all()

    return ProjectListResponse(
        projects=[
            ProjectSummary(
                id=p.id,
                title=p.title,
                status=p.status,
                created_at=p.created_at,
            )
            for p in projects
        ]
    )


@router.delete("/projects/{project_id}")
async def delete_project(
    project_id: UUID,
    session: AsyncSession = Depends(get_session),
) -> dict:
    """Delete a project and all associated data (cascades)."""
    project = await session.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    await session.delete(project)
    await session.commit()
    return {"ok": True}


@router.get("/status/{project_id}", response_model=ProjectStatus)
async def get_status(
    project_id: UUID,
    session: AsyncSession = Depends(get_session),
) -> ProjectStatus:
    """Polling fallback: return current project status with stage history."""
    project = await session.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")

    log = _pipeline_logs.get(str(project_id))
    stages = log.stage_history if log else []

    # Count persisted claims (non-zero means partial results exist)
    from sqlalchemy import func
    claim_count_result = await session.execute(
        select(func.count()).where(Claim.project_id == project_id)
    )
    claim_count = claim_count_result.scalar() or 0

    return ProjectStatus(
        project_id=project.id,
        title=project.title,
        status=project.status,
        created_at=project.created_at,
        stages=stages,
        claim_count=claim_count,
    )
