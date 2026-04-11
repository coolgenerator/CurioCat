"""Graph operations API routes.

Provides endpoints for interactive graph exploration: expand, trace-back,
challenge, what-if analysis, and focus subgraph computation.
"""

from __future__ import annotations

import copy
import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from curiocat.api.models.graph import (
    AdviseRequest,
    AdviseResult,
    BeliefChange,
    PerspectiveSuggestion,
    SuggestPerspectivesResult,
    ChallengeRequest,
    ChallengeResult,
    ClaimResponse,
    EdgeResponse,
    EvidenceResponse,
    ExpandRequest,
    FocusResult,
    GraphOperationResult,
    PathInfo,
    TraceBackRequest,
    WhatIfModification,
    WhatIfRequest,
    WhatIfResult,
)
from curiocat.api.routes.graph import (
    _build_nx_graph,
    _compute_full_graph,
    _load_project_graph,
)
from curiocat.db.session import get_session
from curiocat.graph.belief_propagation import propagate_beliefs
from curiocat.graph.focus import compute_focus_subgraph
from curiocat.graph.path_finder import find_all_paths_to_node
from curiocat.graph.propagation import propagate_from_edge, propagate_from_node

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1", tags=["operations"])


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _build_ops(session: AsyncSession):
    """Factory for GraphOperations service."""
    from curiocat.config import settings
    from curiocat.llm.client import get_llm_client
    from curiocat.llm.embeddings import EmbeddingService
    from curiocat.pipeline.graph_ops import GraphOperations

    llm = get_llm_client()
    embedder = EmbeddingService()

    # Default to DuckDuckGo (free); use Brave if API key is configured
    if settings.brave_search_api_key:
        from curiocat.evidence.web_search import BraveSearchClient
        search_client = BraveSearchClient(settings.brave_search_api_key)
    else:
        from curiocat.evidence.web_search import DuckDuckGoSearchClient
        search_client = DuckDuckGoSearchClient()

    return GraphOperations(session, llm, embedder, search_client)


def _claim_to_response(claim) -> ClaimResponse:
    """Convert an ORM Claim to ClaimResponse."""
    return ClaimResponse(
        id=claim.id,
        text=claim.text,
        claim_type=claim.claim_type,
        confidence=claim.confidence,
        belief=None,
        sensitivity=None,
        is_critical_path=False,
        is_convergence_point=False,
        logic_gate=getattr(claim, "logic_gate", "or"),
        order_index=claim.order_index,
    )


def _edge_to_response(edge) -> EdgeResponse:
    """Convert an ORM CausalEdge to EdgeResponse."""
    evidences = [
        EvidenceResponse(
            id=ev.id,
            evidence_type=ev.evidence_type,
            source_url=ev.source_url,
            source_title=ev.source_title,
            source_type=ev.source_type,
            snippet=ev.snippet,
            relevance_score=ev.relevance_score,
            credibility_score=ev.credibility_score,
            source_tier=getattr(ev, "source_tier", 4),
            freshness_score=getattr(ev, "freshness_score", 0.5),
            published_date=getattr(ev, "published_date", None),
        )
        for ev in (edge.evidences if hasattr(edge, 'evidences') and edge.evidences else [])
    ]
    return EdgeResponse(
        id=edge.id,
        source_claim_id=edge.source_claim_id,
        target_claim_id=edge.target_claim_id,
        mechanism=edge.mechanism,
        strength=edge.strength,
        time_delay=edge.time_delay,
        conditions=edge.conditions if isinstance(edge.conditions, list) else None,
        reversible=edge.reversible,
        evidence_score=edge.evidence_score,
        causal_type=getattr(edge, "causal_type", "direct"),
        condition_type=getattr(edge, "condition_type", "contributing"),
        temporal_window=getattr(edge, "temporal_window", None),
        decay_type=getattr(edge, "decay_type", "none"),
        bias_warnings=getattr(edge, "bias_warnings", None) or [],
        is_feedback=getattr(edge, "is_feedback", False),
        evidences=evidences,
    )


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.post(
    "/graph/{project_id}/expand",
    response_model=GraphOperationResult,
)
async def expand_node(
    project_id: UUID,
    req: ExpandRequest,
    session: AsyncSession = Depends(get_session),
) -> GraphOperationResult:
    """Expand consequences from a node using LLM generation."""
    ops = _build_ops(session)
    try:
        result = await ops.expand(
            project_id, req.node_id, user_reasoning=req.user_reasoning
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    graph = await _compute_full_graph(project_id, session)

    return GraphOperationResult(
        new_nodes=[_claim_to_response(c) for c in result["new_nodes"]],
        new_edges=[_edge_to_response(e) for e in result["new_edges"]],
        converged_edges=[_edge_to_response(e) for e in result["converged_edges"]],
        graph=graph,
    )


@router.post(
    "/graph/{project_id}/trace-back",
    response_model=GraphOperationResult,
)
async def trace_back_node(
    project_id: UUID,
    req: TraceBackRequest,
    session: AsyncSession = Depends(get_session),
) -> GraphOperationResult:
    """Trace back causes to a node using LLM generation."""
    ops = _build_ops(session)
    try:
        result = await ops.trace_back(
            project_id, req.node_id, user_reasoning=req.user_reasoning
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    graph = await _compute_full_graph(project_id, session)

    return GraphOperationResult(
        new_nodes=[_claim_to_response(c) for c in result["new_nodes"]],
        new_edges=[_edge_to_response(e) for e in result["new_edges"]],
        converged_edges=[_edge_to_response(e) for e in result["converged_edges"]],
        graph=graph,
    )


@router.post(
    "/graph/{project_id}/challenge",
    response_model=ChallengeResult,
)
async def challenge_edge(
    project_id: UUID,
    req: ChallengeRequest,
    session: AsyncSession = Depends(get_session),
) -> ChallengeResult:
    """Challenge an edge by searching for fresh evidence."""
    ops = _build_ops(session)
    try:
        result = await ops.challenge(
            project_id, req.edge_id, user_reasoning=req.user_reasoning
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    graph = await _compute_full_graph(project_id, session)

    belief_changes = {
        nid: BeliefChange(**change)
        for nid, change in result.get("belief_changes", {}).items()
    }

    return ChallengeResult(
        edge_id=result["edge_id"],
        new_evidence_score=result["new_evidence_score"],
        new_evidences=[
            EvidenceResponse(
                id=ev.id,
                evidence_type=ev.evidence_type,
                source_url=ev.source_url,
                source_title=ev.source_title,
                source_type=ev.source_type,
                snippet=ev.snippet,
                relevance_score=ev.relevance_score,
                credibility_score=ev.credibility_score,
            )
            for ev in result.get("new_evidences", [])
        ],
        belief_changes=belief_changes,
        graph=graph,
    )


@router.post(
    "/graph/{project_id}/what-if",
    response_model=WhatIfResult,
)
async def what_if(
    project_id: UUID,
    req: WhatIfRequest,
    session: AsyncSession = Depends(get_session),
) -> WhatIfResult:
    """Run what-if analysis without persisting changes.

    Builds an in-memory graph, applies modifications, runs BFS propagation,
    and returns the modified graph with belief changes.
    """
    project, claims, edges = await _load_project_graph(project_id, session)

    if not claims:
        raise HTTPException(status_code=404, detail="No graph data")

    has_temporal = getattr(project, 'has_temporal', True)

    # Build and propagate baseline
    baseline = _build_nx_graph(claims, edges)
    propagate_beliefs(baseline)

    baseline_beliefs = {
        node: baseline.nodes[node].get("belief", 0.5)
        for node in baseline.nodes
    }

    # Work on a copy
    modified = copy.deepcopy(baseline)

    # Apply modifications
    affected_nodes: set[str] = set()
    for mod in req.modifications:
        target = str(mod.target_id)
        if mod.type == "edge_strength" and mod.source_id is not None:
            source = str(mod.source_id)
            if modified.has_edge(source, target):
                modified.edges[source, target]["strength"] = mod.value
                affected_nodes.add(target)
        elif mod.type == "node_probability":
            if target in modified.nodes:
                modified.nodes[target]["confidence"] = mod.value
                affected_nodes.add(target)

    # Propagate from each affected node
    all_changes: dict[str, dict[str, float]] = {}
    for node_id in affected_nodes:
        result = propagate_from_node(modified, node_id)
        all_changes.update(result.get("changes", {}))

    # Also include nodes where belief differs from baseline
    for node_id in modified.nodes:
        new_belief = modified.nodes[node_id].get("belief", 0.5)
        old_belief = baseline_beliefs.get(node_id, 0.5)
        delta = new_belief - old_belief
        if abs(delta) > 0.01 and node_id not in all_changes:
            all_changes[node_id] = {
                "old_belief": old_belief,
                "new_belief": new_belief,
                "delta": delta,
            }

    # Build modified GraphResponse
    from curiocat.graph.critical_path import find_critical_path
    from curiocat.graph.sensitivity import analyze_sensitivity
    from curiocat.api.routes.graph import _assemble_graph_response

    sensitivity = analyze_sensitivity(modified)
    critical_path = find_critical_path(modified)
    modified_graph = _assemble_graph_response(
        project_id, claims, edges, modified, sensitivity, critical_path,
        has_temporal=has_temporal,
    )

    belief_changes = {
        nid: BeliefChange(**change) for nid, change in all_changes.items()
    }

    return WhatIfResult(changes=belief_changes, modified_graph=modified_graph)


@router.get(
    "/graph/{project_id}/focus/{node_id}",
    response_model=FocusResult,
)
async def focus_node(
    project_id: UUID,
    node_id: UUID,
    max_hops: int = 2,
    session: AsyncSession = Depends(get_session),
) -> FocusResult:
    """Compute focus subgraph and all paths to a node."""
    _project, claims, edges = await _load_project_graph(project_id, session)

    if not claims:
        raise HTTPException(status_code=404, detail="No graph data")

    graph = _build_nx_graph(claims, edges)
    propagate_beliefs(graph)

    node_str = str(node_id)
    if node_str not in graph:
        raise HTTPException(status_code=404, detail="Node not found in graph")

    # Compute focus subgraph (limited to max_hops from focus node)
    visible_ids = compute_focus_subgraph(graph, node_str, max_hops=max_hops)

    # Find all paths
    raw_paths = find_all_paths_to_node(graph, node_str)
    paths = [
        PathInfo(
            path=[UUID(nid) for nid in p["path"]],
            compound_probability=p["compound_probability"],
        )
        for p in raw_paths
    ]

    return FocusResult(
        focus_node_id=node_id,
        visible_node_ids=[UUID(nid) for nid in visible_ids],
        paths=paths,
    )


# ---------------------------------------------------------------------------
# Strategic Advisor
# ---------------------------------------------------------------------------


from curiocat.graph.summarizer import build_graph_summary as _build_graph_summary


@router.get(
    "/graph/{project_id}/suggest-perspectives",
    response_model=SuggestPerspectivesResult,
)
async def suggest_perspectives(
    project_id: UUID,
    session: AsyncSession = Depends(get_session),
) -> SuggestPerspectivesResult:
    """Generate AI-suggested stakeholder perspectives based on graph content."""
    from curiocat.llm.client import get_llm_client
    from curiocat.llm.prompts.strategic_advisor import (
        SUGGEST_PERSPECTIVES_SCHEMA,
        SUGGEST_PERSPECTIVES_SYSTEM,
    )

    _project, claims, edges = await _load_project_graph(project_id, session)
    if not claims:
        raise HTTPException(status_code=404, detail="No graph data")

    # Build a concise claim list for the LLM (just texts, no full graph)
    claim_texts = [c.text for c in claims[:40]]  # Cap to avoid token overflow
    user_msg = "Claims in the causal graph:\n" + "\n".join(
        f"- {text}" for text in claim_texts
    )

    llm = get_llm_client()
    result = await llm.complete_json(
        system=SUGGEST_PERSPECTIVES_SYSTEM,
        user=user_msg,
        schema=SUGGEST_PERSPECTIVES_SCHEMA,
        max_tokens=1024,
        temperature=0.5,
    )

    suggestions = [
        PerspectiveSuggestion(**s) for s in result.get("suggestions", [])
    ]
    return SuggestPerspectivesResult(suggestions=suggestions)


@router.post(
    "/graph/{project_id}/advise",
    response_model=AdviseResult,
)
async def advise(
    project_id: UUID,
    req: AdviseRequest,
    session: AsyncSession = Depends(get_session),
) -> AdviseResult:
    """Generate a strategic advisory report based on the causal graph and user context."""
    from curiocat.llm.client import get_llm_client
    from curiocat.llm.prompts.strategic_advisor import (
        STRATEGIC_ADVISOR_SCHEMA,
        STRATEGIC_ADVISOR_SYSTEM,
    )

    user_msg = await _build_advise_prompt(project_id, req, session)

    llm = get_llm_client()
    result = await llm.complete_json(
        system=STRATEGIC_ADVISOR_SYSTEM,
        user=user_msg,
        schema=STRATEGIC_ADVISOR_SCHEMA,
        max_tokens=8192,
        temperature=0.3,
    )

    return AdviseResult(**result)


@router.post("/graph/{project_id}/advise/stream")
async def advise_stream(
    project_id: UUID,
    req: AdviseRequest,
    session: AsyncSession = Depends(get_session),
):
    """Stream a strategic advisory report token by token via SSE.

    Instead of waiting for the full JSON response, streams raw text
    tokens as they arrive from the LLM. The frontend can display
    partial results progressively.
    """
    import json
    from sse_starlette.sse import EventSourceResponse
    from curiocat.llm.client import get_llm_client
    from curiocat.llm.prompts.strategic_advisor import STRATEGIC_ADVISOR_SYSTEM

    user_msg = await _build_advise_prompt(project_id, req, session)

    # Use plain text streaming (not JSON schema) for real-time output
    streaming_system = (
        STRATEGIC_ADVISOR_SYSTEM
        + "\n\nIMPORTANT: Output your analysis as well-structured markdown. "
        "Use ## headings for sections: Impact Assessment, Predictions, "
        "Recommended Actions, Escalation Scenarios, Key Indicators."
    )

    llm = get_llm_client(enable_cache=False)

    async def _event_generator():
        try:
            async for chunk in llm.stream_complete(
                system=streaming_system,
                user=user_msg,
                max_tokens=8192,
                temperature=0.3,
            ):
                yield {
                    "event": "token",
                    "data": json.dumps({"text": chunk}),
                }
            yield {
                "event": "complete",
                "data": json.dumps({"status": "done"}),
            }
        except Exception as exc:
            yield {
                "event": "error",
                "data": json.dumps({"message": str(exc)}),
            }

    return EventSourceResponse(_event_generator())


async def _build_advise_prompt(
    project_id: UUID,
    req: AdviseRequest,
    session: AsyncSession,
) -> str:
    """Build the advisor prompt from graph data and user context."""
    from curiocat.graph.critical_path import find_critical_path
    from curiocat.graph.sensitivity import analyze_sensitivity

    _project, claims, edges = await _load_project_graph(project_id, session)
    if not claims:
        raise HTTPException(status_code=404, detail="No graph data")

    graph = _build_nx_graph(claims, edges)
    propagate_beliefs(graph)
    sensitivity = analyze_sensitivity(graph)
    critical_path = find_critical_path(graph)

    summary = _build_graph_summary(graph, critical_path, sensitivity)

    perspective_str = ""
    if req.perspective_tags:
        perspective_str = f"\nPerspective/role: {', '.join(req.perspective_tags)}"

    return (
        f"## User Business Context\n{req.user_context}{perspective_str}\n\n"
        f"## Causal Graph Summary\n{summary}"
    )


# --- Advisor conversation history ---

@router.get("/graph/{project_id}/advisor-messages")
async def get_advisor_messages(
    project_id: UUID,
    session: AsyncSession = Depends(get_session),
):
    """Load persisted advisor conversation for a project."""
    from sqlalchemy import select
    from curiocat.db.models import AdvisorMessage

    result = await session.execute(
        select(AdvisorMessage)
        .where(AdvisorMessage.project_id == project_id)
        .order_by(AdvisorMessage.created_at)
    )
    messages = result.scalars().all()

    return [
        {
            "id": str(m.id),
            "role": m.role,
            "content": m.content,
            "tags": m.tags,
            "created_at": m.created_at.isoformat() if m.created_at else None,
        }
        for m in messages
    ]


@router.post("/graph/{project_id}/advisor-messages")
async def save_advisor_message(
    project_id: UUID,
    body: dict,
    session: AsyncSession = Depends(get_session),
):
    """Save a single advisor message (user or assistant)."""
    from curiocat.db.models import AdvisorMessage

    msg = AdvisorMessage(
        project_id=project_id,
        role=body["role"],
        content=body["content"],
        tags=body.get("tags"),
    )
    session.add(msg)
    await session.commit()
    await session.refresh(msg)

    return {"id": str(msg.id), "status": "saved"}
