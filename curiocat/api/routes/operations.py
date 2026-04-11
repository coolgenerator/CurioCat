"""Graph operations API routes.

Provides endpoints for interactive graph exploration: expand, trace-back,
challenge, what-if analysis, and focus subgraph computation.
"""

from __future__ import annotations

import copy
import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from curiocat.api.models.graph import (
    AdviseRequest,
    AdviseResult,
    AutoExploreRequest,
    AutoExploreResult,
    BeliefChange,
    EnrichResult,
    EnrichTextRequest,
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
    WeaknessReport,
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
# Enrich
# ---------------------------------------------------------------------------


def _build_merger(session: AsyncSession):
    """Factory for GraphMerger service."""
    from curiocat.llm.embeddings import EmbeddingService
    from curiocat.pipeline.graph_merger import GraphMerger

    return GraphMerger(session, EmbeddingService())


@router.post(
    "/graph/{project_id}/enrich/text",
    response_model=EnrichResult,
)
async def enrich_text(
    project_id: UUID,
    req: EnrichTextRequest,
    session: AsyncSession = Depends(get_session),
) -> EnrichResult:
    """Enrich an existing graph with additional text.

    Extracts claims from the text, finds causal links between new and
    existing claims, then merges everything with deduplication.
    """
    from curiocat.llm.client import get_llm_client
    from curiocat.llm.embeddings import EmbeddingService
    from curiocat.pipeline.claim_extractor import ClaimExtractor
    from curiocat.pipeline.causal_inferrer import CausalInferrer
    from curiocat.pipeline.graph_merger import GraphMerger

    llm = get_llm_client()
    embedder = EmbeddingService()

    # 1. Extract claims from new text
    extractor = ClaimExtractor(llm, embedder)
    input_text = req.text
    if req.context:
        input_text = f"{req.context}\n\n{req.text}"
    raw_claims, _ = await extractor.extract(input_text)
    if not raw_claims:
        graph = await _compute_full_graph(project_id, session)
        return EnrichResult(
            new_nodes=[], new_edges=[], merged_nodes=[],
            skipped_duplicates=0, graph=graph,
        )

    # 2. Embed and dedup new claims among themselves
    raw_claims = await extractor.embed_claims(raw_claims)

    # 3. Load existing claims for dedup + causal inference context
    from sqlalchemy import select as sa_select
    from curiocat.db.models import Claim

    existing_result = await session.execute(
        sa_select(Claim)
        .where(Claim.project_id == project_id)
        .order_by(Claim.order_index)
    )
    existing_claims = list(existing_result.scalars().all())

    # 4. Run causal inference: find links between ALL claims (new + existing)
    existing_claim_dicts = [
        {
            "text": c.text,
            "type": c.claim_type,
            "confidence": c.confidence,
            "embedding": c.embedding,
            "order_index": c.order_index,
        }
        for c in existing_claims
        if c.embedding is not None
    ]
    all_claims_for_inference = existing_claim_dicts + raw_claims
    new_indices = set(range(len(existing_claim_dicts), len(all_claims_for_inference)))

    inferrer = CausalInferrer(llm)
    new_edges = await inferrer.infer_incremental(all_claims_for_inference, new_indices)

    # 5. Remap edge indices: existing claims keep their DB IDs
    existing_id_map = {
        i: existing_claims[i].id
        for i in range(len(existing_claim_dicts))
    }
    # New claims use their position in raw_claims
    new_offset = len(existing_claim_dicts)
    remapped_edges = []
    for edge in new_edges:
        src_idx = edge["source_idx"]
        tgt_idx = edge["target_idx"]

        # Convert to raw_claims index space for the merger
        new_src = src_idx - new_offset if src_idx >= new_offset else None
        new_tgt = tgt_idx - new_offset if tgt_idx >= new_offset else None

        if new_src is not None and new_tgt is not None:
            # Both are new claims — use raw index
            remapped_edges.append({**edge, "source_idx": new_src, "target_idx": new_tgt})
        elif new_src is not None:
            # Source is new, target is existing
            raw_claims[new_src].setdefault("_merged_to", None)
            edge_copy = {**edge}
            edge_copy["_existing_target"] = existing_id_map[tgt_idx]
            edge_copy["source_idx"] = new_src
            edge_copy["target_idx"] = None
            remapped_edges.append(edge_copy)
        elif new_tgt is not None:
            edge_copy = {**edge}
            edge_copy["_existing_source"] = existing_id_map[src_idx]
            edge_copy["source_idx"] = None
            edge_copy["target_idx"] = new_tgt
            remapped_edges.append(edge_copy)
        # If both are existing, skip (edge already exists or should)

    # 6. Merge claims (dedup against existing)
    merger = GraphMerger(session, embedder)
    merge_result = await merger.merge_claims(project_id, raw_claims, existing_claims)

    # 7. Wire edges using merged IDs
    import uuid as uuid_mod
    from curiocat.db.models import CausalEdge

    for edge in remapped_edges:
        src_idx = edge.get("source_idx")
        tgt_idx = edge.get("target_idx")

        # Resolve source ID
        if src_idx is not None and src_idx < len(raw_claims):
            src_id = raw_claims[src_idx].get("_merged_to")
        elif "_existing_source" in edge:
            src_id = edge["_existing_source"]
        else:
            continue

        # Resolve target ID
        if tgt_idx is not None and tgt_idx < len(raw_claims):
            tgt_id = raw_claims[tgt_idx].get("_merged_to")
        elif "_existing_target" in edge:
            tgt_id = edge["_existing_target"]
        else:
            continue

        if src_id is None or tgt_id is None or src_id == tgt_id:
            continue

        if await merger._would_create_cycle(project_id, src_id, tgt_id):
            continue

        new_edge = CausalEdge(
            project_id=project_id,
            source_claim_id=src_id,
            target_claim_id=tgt_id,
            mechanism=edge.get("mechanism", ""),
            strength=edge.get("strength", 0.5),
            time_delay=edge.get("time_delay"),
            conditions=edge.get("conditions"),
            reversible=edge.get("reversible", False),
            evidence_score=0.5,
            causal_type=edge.get("causal_type", "direct"),
            condition_type=edge.get("condition_type", "contributing"),
        )
        session.add(new_edge)
        merge_result.new_edges.append(new_edge)

    await session.commit()

    graph = await _compute_full_graph(project_id, session)

    return EnrichResult(
        new_nodes=[_claim_to_response(c) for c in merge_result.new_claims],
        new_edges=[_edge_to_response(e) for e in merge_result.new_edges],
        merged_nodes=[_claim_to_response(c) for c in merge_result.merged_claims],
        skipped_duplicates=merge_result.skipped_duplicates,
        graph=graph,
    )


@router.post(
    "/graph/{project_id}/enrich/csv",
    response_model=EnrichResult,
)
async def enrich_csv(
    project_id: UUID,
    file: UploadFile,
    question: str = "What are the causal relationships between these metrics?",
    data_type: str = "time_series",
    max_lag: int = 5,
    alpha: float = 0.05,
    session: AsyncSession = Depends(get_session),
) -> EnrichResult:
    """Enrich a graph by uploading CSV data for statistical causal analysis.

    Runs ThreeLayerEngine on the CSV data, then converts discovered
    FusedEdges into graph claims and edges with deduplication.
    """
    from curiocat.api.routes.causal_analysis import _parse_csv, _persist_evidence, _persist_metrics
    from curiocat.llm.client import get_llm_client
    from curiocat.pipeline.three_layer_engine import ThreeLayerEngine

    if file.filename is None:
        raise HTTPException(400, "File must have a name")

    content_bytes = await file.read()
    if len(content_bytes) > 20 * 1024 * 1024:
        raise HTTPException(400, "File exceeds 20MB limit")

    try:
        data = _parse_csv(content_bytes)
    except Exception as exc:
        raise HTTPException(400, f"Failed to parse CSV: {exc}")

    if len(data) < 2:
        raise HTTPException(400, "Need at least 2 numeric columns")

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

    # Persist metrics and evidence
    await _persist_metrics(session, project_id, data, file.filename)
    await _persist_evidence(session, project_id, result)

    # Load existing claims and merge fused edges into the graph
    from sqlalchemy import select as sa_select
    from curiocat.db.models import Claim

    existing_result = await session.execute(
        sa_select(Claim)
        .where(Claim.project_id == project_id)
        .order_by(Claim.order_index)
    )
    existing_claims = list(existing_result.scalars().all())

    merger = _build_merger(session)
    merge_result = await merger.merge_fused_edges(
        project_id, result.edges, existing_claims
    )

    await session.commit()

    graph = await _compute_full_graph(project_id, session)

    return EnrichResult(
        new_nodes=[_claim_to_response(c) for c in merge_result.new_claims],
        new_edges=[_edge_to_response(e) for e in merge_result.new_edges],
        merged_nodes=[_claim_to_response(c) for c in merge_result.merged_claims],
        skipped_duplicates=merge_result.skipped_duplicates,
        graph=graph,
    )


@router.post(
    "/graph/{project_id}/enrich/screenshot",
    response_model=EnrichResult,
)
async def enrich_screenshot(
    project_id: UUID,
    file: UploadFile,
    question: str = "What causal relationships can you identify from this data?",
    session: AsyncSession = Depends(get_session),
) -> EnrichResult:
    """Enrich a graph by uploading a screenshot for data extraction + analysis.

    Uses Claude Vision to extract data from the image, runs ThreeLayerEngine,
    then merges discovered relationships into the graph.
    """
    from curiocat.api.routes.causal_analysis import (
        _extract_data_from_image,
        _parse_extracted_data,
        _persist_evidence,
    )
    from curiocat.llm.client import get_llm_client
    from curiocat.pipeline.three_layer_engine import ThreeLayerEngine

    if file.filename is None:
        raise HTTPException(400, "File must have a name")

    content_bytes = await file.read()
    if len(content_bytes) > 20 * 1024 * 1024:
        raise HTTPException(400, "File exceeds 20MB limit")

    llm = get_llm_client()
    extracted = await _extract_data_from_image(
        llm, content_bytes, file.content_type or "image/png"
    )

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
        time_series=time_series,
        cross_section=cross_section,
        context_text=extracted.get("description", "Data extracted from screenshot"),
        question=question,
    )

    await _persist_evidence(session, project_id, result)

    # Load existing claims and merge
    from sqlalchemy import select as sa_select
    from curiocat.db.models import Claim

    existing_result = await session.execute(
        sa_select(Claim)
        .where(Claim.project_id == project_id)
        .order_by(Claim.order_index)
    )
    existing_claims = list(existing_result.scalars().all())

    merger = _build_merger(session)
    merge_result = await merger.merge_fused_edges(
        project_id, result.edges, existing_claims
    )

    await session.commit()

    graph = await _compute_full_graph(project_id, session)

    return EnrichResult(
        new_nodes=[_claim_to_response(c) for c in merge_result.new_claims],
        new_edges=[_edge_to_response(e) for e in merge_result.new_edges],
        merged_nodes=[_claim_to_response(c) for c in merge_result.merged_claims],
        skipped_duplicates=merge_result.skipped_duplicates,
        graph=graph,
    )


# ---------------------------------------------------------------------------
# Auto Explore
# ---------------------------------------------------------------------------


@router.post(
    "/graph/{project_id}/auto-explore",
    response_model=AutoExploreResult,
)
async def auto_explore(
    project_id: UUID,
    req: AutoExploreRequest,
    session: AsyncSession = Depends(get_session),
) -> AutoExploreResult:
    """Automatically identify and address graph weaknesses.

    Analyzes the graph for weak edges, leaf nodes, low-confidence roots,
    and high-sensitivity areas, then runs challenge/expand/trace-back
    operations to strengthen them.
    """
    from curiocat.config import settings
    from curiocat.llm.client import get_llm_client
    from curiocat.llm.embeddings import EmbeddingService
    from curiocat.pipeline.auto_explorer import AutoExplorer

    llm = get_llm_client()
    embedder = EmbeddingService()

    if settings.brave_search_api_key:
        from curiocat.evidence.web_search import BraveSearchClient
        search_client = BraveSearchClient(settings.brave_search_api_key)
    else:
        from curiocat.evidence.web_search import DuckDuckGoSearchClient
        search_client = DuckDuckGoSearchClient()

    explorer = AutoExplorer(session, llm, embedder, search_client)

    try:
        result = await explorer.explore(
            project_id, max_new_nodes=req.max_new_nodes
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    graph = await _compute_full_graph(project_id, session)

    return AutoExploreResult(
        weaknesses_found=[
            WeaknessReport(**w) for w in result.weaknesses_found
        ],
        new_nodes=[_claim_to_response(c) for c in result.new_nodes],
        new_edges=[_edge_to_response(e) for e in result.new_edges],
        converged_edges=[_edge_to_response(e) for e in result.converged_edges],
        convergence_reached=result.convergence_reached,
        graph=graph,
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

    graph_context = await _build_advise_prompt(project_id, req, session)

    # Build conversation history from session (if provided)
    conversation_history = ""
    if req.session_id:
        from sqlalchemy import select
        from curiocat.db.models import AdvisorMessage
        result = await session.execute(
            select(AdvisorMessage)
            .where(AdvisorMessage.session_id == UUID(req.session_id))
            .order_by(AdvisorMessage.created_at)
        )
        prev_messages = result.scalars().all()
        if prev_messages:
            history_parts = []
            for m in prev_messages:
                prefix = "User" if m.role == "user" else "Advisor"
                history_parts.append(f"**{prefix}:** {m.content}")
            conversation_history = (
                "\n\n## Previous Conversation\n"
                + "\n\n".join(history_parts)
                + "\n\n---\n"
            )

    user_msg = graph_context + conversation_history + f"\n\n## Current Question\n{req.user_context}"

    # Use plain text streaming (not JSON schema) for real-time output
    streaming_system = (
        STRATEGIC_ADVISOR_SYSTEM
        + "\n\nIMPORTANT: Output your analysis as well-structured markdown. "
        "Use ## headings for sections. If this is a follow-up question, "
        "build on the previous conversation context."
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


# --- Advisor sessions & messages ---

@router.get("/graph/{project_id}/advisor-sessions")
async def list_advisor_sessions(
    project_id: UUID,
    session: AsyncSession = Depends(get_session),
):
    """List all advisor conversation sessions for a project."""
    from sqlalchemy import select, func as sa_func
    from curiocat.db.models import AdvisorSession, AdvisorMessage

    result = await session.execute(
        select(
            AdvisorSession,
            sa_func.count(AdvisorMessage.id).label("message_count"),
        )
        .outerjoin(AdvisorMessage, AdvisorMessage.session_id == AdvisorSession.id)
        .where(AdvisorSession.project_id == project_id)
        .group_by(AdvisorSession.id)
        .order_by(AdvisorSession.updated_at.desc().nullslast(), AdvisorSession.created_at.desc())
    )
    rows = result.all()

    return [
        {
            "id": str(s.id),
            "title": s.title,
            "message_count": count,
            "created_at": s.created_at.isoformat() if s.created_at else None,
            "updated_at": s.updated_at.isoformat() if s.updated_at else None,
        }
        for s, count in rows
    ]


@router.post("/graph/{project_id}/advisor-sessions")
async def create_advisor_session(
    project_id: UUID,
    body: dict,
    session: AsyncSession = Depends(get_session),
):
    """Create a new advisor conversation session."""
    from curiocat.db.models import AdvisorSession

    s = AdvisorSession(
        project_id=project_id,
        title=body.get("title", "New conversation"),
    )
    session.add(s)
    await session.commit()
    await session.refresh(s)

    return {"id": str(s.id), "title": s.title}


@router.delete("/graph/{project_id}/advisor-sessions/{session_id}")
async def delete_advisor_session(
    project_id: UUID,
    session_id: UUID,
    session: AsyncSession = Depends(get_session),
):
    """Delete an advisor session and all its messages."""
    from curiocat.db.models import AdvisorSession

    s = await session.get(AdvisorSession, session_id)
    if s is None or s.project_id != project_id:
        raise HTTPException(status_code=404, detail="Session not found")
    await session.delete(s)
    await session.commit()
    return {"status": "deleted"}


@router.get("/graph/{project_id}/advisor-sessions/{session_id}/messages")
async def get_session_messages(
    project_id: UUID,
    session_id: UUID,
    session: AsyncSession = Depends(get_session),
):
    """Load all messages for a specific advisor session."""
    from sqlalchemy import select
    from curiocat.db.models import AdvisorMessage, AdvisorSession

    # Verify session belongs to project
    s = await session.get(AdvisorSession, session_id)
    if s is None or s.project_id != project_id:
        raise HTTPException(status_code=404, detail="Session not found")

    result = await session.execute(
        select(AdvisorMessage)
        .where(AdvisorMessage.session_id == session_id)
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


@router.post("/graph/{project_id}/advisor-sessions/{session_id}/messages")
async def save_session_message(
    project_id: UUID,
    session_id: UUID,
    body: dict,
    session: AsyncSession = Depends(get_session),
):
    """Save a message to an advisor session."""
    from curiocat.db.models import AdvisorMessage, AdvisorSession

    s = await session.get(AdvisorSession, session_id)
    if s is None or s.project_id != project_id:
        raise HTTPException(status_code=404, detail="Session not found")

    msg = AdvisorMessage(
        session_id=session_id,
        role=body["role"],
        content=body["content"],
        tags=body.get("tags"),
    )
    session.add(msg)

    # Auto-title: set session title from first user message
    if s.title == "New conversation" and body["role"] == "user":
        s.title = body["content"][:80]

    # Touch updated_at
    from sqlalchemy import func as sa_func
    s.updated_at = sa_func.now()

    await session.commit()
    return {"id": str(msg.id), "status": "saved"}
