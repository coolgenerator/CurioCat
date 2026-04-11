"""Causal Analysis API — CSV, screenshot, and text-based three-layer analysis.

Supports three input modes:
  1. CSV upload → statistical + LLM analysis
  2. Screenshot upload → Claude Vision extracts data → analysis
  3. Text description → LLM-only causal reasoning
"""

from __future__ import annotations

import csv
import io
import logging
import uuid

import numpy as np
from fastapi import APIRouter, Depends, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from curiocat.db.models import MultiLayerEvidence, MetricSeries
from curiocat.db.session import get_session
from curiocat.llm.client import get_llm_client
from curiocat.pipeline.three_layer_engine import ThreeLayerEngine, ThreeLayerResult

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/causal", tags=["causal-analysis"])

MAX_FILE_SIZE = 20 * 1024 * 1024


# ── Request / Response Models ──

class TextAnalysisRequest(BaseModel):
    question: str
    context: str | None = None
    project_id: str | None = None


class EvidenceOut(BaseModel):
    source_label: str
    target_label: str
    layer: int
    algorithm: str
    edge_type: str
    confidence: float
    p_value: float | None = None
    effect_size: float | None = None
    lag: int | None = None
    reason: str | None = None


class FusedEdgeOut(BaseModel):
    source_label: str
    target_label: str
    verdict: str
    confidence_tier: str
    fused_confidence: float
    best_p_value: float | None = None
    best_lag: int | None = None
    evidence: list[EvidenceOut]


class CausalAnalysisResponse(BaseModel):
    edges: list[FusedEdgeOut]
    data_quality: str
    layers_used: list[int]
    summary: str | None = None
    metrics_saved: int = 0


# ── Endpoints ──

@router.post("/analyze/text", response_model=CausalAnalysisResponse)
async def analyze_text(
    body: TextAnalysisRequest,
    session: AsyncSession = Depends(get_session),
):
    """Run causal analysis from text description (Layer 1 only)."""
    llm = get_llm_client()
    engine = ThreeLayerEngine(llm)

    result = await engine.analyze(context_text=body.context, question=body.question)

    project_id = uuid.UUID(body.project_id) if body.project_id else None
    await _persist_evidence(session, project_id, result)

    return _to_response(result)


@router.post("/analyze/csv", response_model=CausalAnalysisResponse)
async def analyze_csv(
    file: UploadFile,
    question: str = "What are the causal relationships between these metrics?",
    project_id: str | None = None,
    data_type: str = "time_series",
    max_lag: int = 5,
    alpha: float = 0.05,
    session: AsyncSession = Depends(get_session),
):
    """Upload CSV data and run statistical + LLM causal analysis."""
    if file.filename is None:
        raise HTTPException(400, "File must have a name")

    content_bytes = await file.read()
    if len(content_bytes) > MAX_FILE_SIZE:
        raise HTTPException(400, "File exceeds 20MB limit")

    try:
        data = _parse_csv(content_bytes)
    except Exception as exc:
        raise HTTPException(400, f"Failed to parse CSV: {exc}")

    if len(data) < 2:
        raise HTTPException(400, "Need at least 2 numeric columns for causal analysis")

    llm = get_llm_client()
    engine = ThreeLayerEngine(llm)

    kwargs: dict = {
        "question": question,
        "context_text": f"Data from file: {file.filename}",
        "max_lag": max_lag,
        "alpha": alpha,
    }
    if data_type == "time_series":
        kwargs["time_series"] = data
    else:
        kwargs["cross_section"] = data

    result = await engine.analyze(**kwargs)

    pid = uuid.UUID(project_id) if project_id else None
    metrics_saved = await _persist_metrics(session, pid, data, file.filename)
    await _persist_evidence(session, pid, result)

    resp = _to_response(result)
    resp.metrics_saved = metrics_saved
    return resp


@router.post("/analyze/screenshot", response_model=CausalAnalysisResponse)
async def analyze_screenshot(
    file: UploadFile,
    question: str = "What causal relationships can you identify from this data?",
    project_id: str | None = None,
    session: AsyncSession = Depends(get_session),
):
    """Upload a screenshot, extract data via Claude Vision, then analyze."""
    if file.filename is None:
        raise HTTPException(400, "File must have a name")

    content_bytes = await file.read()
    if len(content_bytes) > MAX_FILE_SIZE:
        raise HTTPException(400, "File exceeds 20MB limit")

    llm = get_llm_client()
    extracted = await _extract_data_from_image(llm, content_bytes, file.content_type or "image/png")

    time_series, cross_section = None, None
    if extracted.get("data"):
        try:
            parsed = _parse_extracted_data(extracted["data"])
            if extracted.get("data_type") == "time_series":
                time_series = parsed
            else:
                cross_section = parsed
        except Exception:
            logger.warning("Could not parse extracted data as numeric arrays")

    engine = ThreeLayerEngine(llm)
    result = await engine.analyze(
        time_series=time_series, cross_section=cross_section,
        context_text=extracted.get("description", "Data extracted from screenshot"),
        question=question,
    )

    pid = uuid.UUID(project_id) if project_id else None
    await _persist_evidence(session, pid, result)

    return _to_response(result)


# ── Internal Functions ──

def _parse_csv(content_bytes: bytes) -> dict[str, np.ndarray]:
    text = content_bytes.decode("utf-8", errors="replace")
    reader = csv.DictReader(io.StringIO(text))

    columns: dict[str, list[float]] = {}
    for row in reader:
        for key, value in row.items():
            if key is None or not key.strip():
                continue
            key = key.strip()
            try:
                columns.setdefault(key, []).append(float(value))
            except (ValueError, TypeError):
                if key in columns:
                    columns[key].append(float("nan"))

    result = {}
    for name, values in columns.items():
        arr = np.array(values)
        non_nan_ratio = np.count_nonzero(~np.isnan(arr)) / len(arr)
        if non_nan_ratio > 0.8 and len(arr) >= 5:
            mask = np.isnan(arr)
            if mask.any():
                for i in range(1, len(arr)):
                    if mask[i]:
                        arr[i] = arr[i - 1]
            result[name] = arr
    return result


async def _extract_data_from_image(llm, image_bytes: bytes, content_type: str) -> dict:
    import base64
    b64 = base64.b64encode(image_bytes).decode("utf-8")

    schema = {
        "type": "object",
        "properties": {
            "description": {"type": "string"},
            "data_type": {"type": "string", "enum": ["time_series", "cross_section"]},
            "data": {"type": "object", "additionalProperties": {"type": "array", "items": {"type": ["number", "null"]}}},
            "date_labels": {"type": "array", "items": {"type": "string"}},
        },
        "required": ["description", "data_type", "data"],
    }

    try:
        user_content = [
            {"type": "image", "source": {"type": "base64", "media_type": content_type, "data": b64}},
            {"type": "text", "text": "Extract all data from this image. Return JSON."},
        ]
        return await llm.complete_json(
            system="You are a data extraction engine. Extract all numerical data from charts/tables/dashboards in the image. Output JSON with description, data_type, data (column→number arrays), date_labels.",
            user=user_content, schema=schema,
        )
    except Exception as exc:
        logger.warning("Image data extraction failed: %s", exc)
        return {"description": "Failed to extract data", "data_type": "cross_section", "data": {}}


def _parse_extracted_data(data: dict) -> dict[str, np.ndarray]:
    result = {}
    for name, values in data.items():
        if not isinstance(values, list):
            continue
        cleaned = [v if v is not None else float("nan") for v in values]
        if len(cleaned) >= 3:
            arr = np.array(cleaned, dtype=np.float64)
            if np.count_nonzero(~np.isnan(arr)) >= 3:
                result[name] = arr
    return result


async def _persist_evidence(session: AsyncSession, project_id: uuid.UUID | None, result: ThreeLayerResult) -> None:
    for edge in result.edges:
        for ev in edge.evidence:
            session.add(MultiLayerEvidence(
                project_id=project_id, source_label=ev.source_label, target_label=ev.target_label,
                layer=ev.layer, algorithm=ev.algorithm, edge_type=ev.edge_type, lag=ev.lag,
                confidence=ev.confidence, p_value=ev.p_value, effect_size=ev.effect_size,
                sample_size=ev.sample_size, data_type=ev.data_type, reason=ev.reason,
            ))
    await session.flush()


async def _persist_metrics(session: AsyncSession, project_id: uuid.UUID | None, data: dict[str, np.ndarray], filename: str | None) -> int:
    count = 0
    for name, values in data.items():
        session.add(MetricSeries(
            project_id=project_id, name=name,
            data_points={"values": values.tolist()}, source_file=filename,
        ))
        count += 1
    await session.flush()
    return count


def _to_response(result: ThreeLayerResult) -> CausalAnalysisResponse:
    return CausalAnalysisResponse(
        edges=[
            FusedEdgeOut(
                source_label=e.source_label, target_label=e.target_label,
                verdict=e.verdict, confidence_tier=e.confidence_tier.value,
                fused_confidence=round(e.fused_confidence, 4),
                best_p_value=round(e.best_p_value, 6) if e.best_p_value else None,
                best_lag=e.best_lag,
                evidence=[
                    EvidenceOut(
                        source_label=ev.source_label, target_label=ev.target_label,
                        layer=ev.layer, algorithm=ev.algorithm, edge_type=ev.edge_type,
                        confidence=round(ev.confidence, 4),
                        p_value=round(ev.p_value, 6) if ev.p_value else None,
                        effect_size=round(ev.effect_size, 4) if ev.effect_size else None,
                        lag=ev.lag, reason=ev.reason,
                    )
                    for ev in e.evidence
                ],
            )
            for e in result.edges
        ],
        data_quality=result.data_quality.value,
        layers_used=result.layers_used,
        summary=result.summary,
    )
