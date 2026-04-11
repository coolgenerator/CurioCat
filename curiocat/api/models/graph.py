"""Pydantic schemas for graph endpoints."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field


class ClaimResponse(BaseModel):
    """A single claim node in the causal graph."""

    id: UUID
    text: str
    claim_type: str
    confidence: float
    belief: float | None = None  # From belief propagation
    sensitivity: float | None = None
    is_critical_path: bool = False
    is_convergence_point: bool = False
    logic_gate: str = "or"
    order_index: int
    source_sentence: str | None = None
    belief_low: float | None = None
    belief_high: float | None = None


class EvidenceResponse(BaseModel):
    """Evidence supporting or contradicting a causal edge."""

    id: UUID
    evidence_type: str
    source_url: str
    source_title: str
    source_type: str
    snippet: str
    relevance_score: float
    credibility_score: float
    source_tier: int = 4
    freshness_score: float = 0.5
    published_date: datetime | None = None


class EdgeResponse(BaseModel):
    """A causal edge between two claims."""

    id: UUID
    source_claim_id: UUID
    target_claim_id: UUID
    mechanism: str
    strength: float
    time_delay: str | None = None
    conditions: list[str] | None = None
    reversible: bool
    evidence_score: float
    causal_type: str = "direct"
    condition_type: str = "contributing"
    temporal_window: str | None = None
    decay_type: str = "none"
    bias_warnings: list[dict] = []
    consensus_level: str = "insufficient"
    sensitivity: float | None = None
    is_feedback: bool = False
    evidences: list[EvidenceResponse] = []
    statistical_validation: str | None = None  # confirmed, unsupported, contradicted, not_tested
    stat_p_value: float | None = None
    stat_f_statistic: float | None = None
    stat_effect_size: float | None = None
    stat_lag: int | None = None


class GraphResponse(BaseModel):
    """Complete graph data for a project, including computed attributes."""

    project_id: UUID
    claims: list[ClaimResponse]
    edges: list[EdgeResponse]
    critical_path: list[UUID] = []
    has_temporal: bool = True


class EdgeUpdateRequest(BaseModel):
    """Request body for updating an edge's strength."""

    strength: float = Field(..., ge=0.0, le=1.0)


# --- Graph Operations ---


class ExpandRequest(BaseModel):
    """Request to expand consequences from a node."""

    node_id: UUID
    user_reasoning: str | None = Field(None, max_length=2000)


class TraceBackRequest(BaseModel):
    """Request to trace back causes to a node."""

    node_id: UUID
    user_reasoning: str | None = Field(None, max_length=2000)


class ChallengeRequest(BaseModel):
    """Request to challenge an edge with fresh evidence."""

    edge_id: UUID
    user_reasoning: str | None = Field(None, max_length=2000)


class WhatIfModification(BaseModel):
    """A single modification for what-if analysis."""

    type: str = Field(..., description="edge_strength or node_probability")
    target_id: UUID
    value: float = Field(..., ge=0.0, le=1.0)
    source_id: UUID | None = None


class WhatIfRequest(BaseModel):
    """Request for what-if analysis with modifications."""

    modifications: list[WhatIfModification]


class BeliefChange(BaseModel):
    """Belief change for a single node."""

    old_belief: float
    new_belief: float
    delta: float


class GraphOperationResult(BaseModel):
    """Result of expand or trace-back operations."""

    new_nodes: list[ClaimResponse]
    new_edges: list[EdgeResponse]
    converged_edges: list[EdgeResponse]
    graph: GraphResponse


class ChallengeResult(BaseModel):
    """Result of a challenge operation."""

    edge_id: UUID
    new_evidence_score: float
    new_evidences: list[EvidenceResponse]
    belief_changes: dict[str, BeliefChange]
    graph: GraphResponse


class WhatIfResult(BaseModel):
    """Result of what-if analysis (non-persistent)."""

    changes: dict[str, BeliefChange]
    modified_graph: GraphResponse


class PathInfo(BaseModel):
    """A single path to a node with compound probability."""

    path: list[UUID]
    compound_probability: float


class FocusResult(BaseModel):
    """Result of focus subgraph computation."""

    focus_node_id: UUID
    visible_node_ids: list[UUID]
    paths: list[PathInfo]


# --- Strategic Advisor ---


class PerspectiveSuggestion(BaseModel):
    """A single AI-generated perspective suggestion."""

    label: str
    description: str


class SuggestPerspectivesResult(BaseModel):
    """Result of perspective suggestion generation."""

    suggestions: list[PerspectiveSuggestion]


class EnrichTextRequest(BaseModel):
    """Request to enrich a graph with additional text."""

    text: str = Field(..., min_length=10, max_length=50000)
    context: str | None = None


class EnrichResult(BaseModel):
    """Result of an enrich operation (text, CSV, or screenshot)."""

    new_nodes: list[ClaimResponse]
    new_edges: list[EdgeResponse]
    merged_nodes: list[ClaimResponse]
    skipped_duplicates: int
    graph: GraphResponse


class AutoExploreRequest(BaseModel):
    """Request for automatic graph exploration."""

    max_new_nodes: int = Field(10, ge=1, le=30)


class WeaknessReport(BaseModel):
    """Report on a single weakness found and action taken."""

    node_id: str | None = None
    edge_id: str | None = None
    weakness_type: str
    action_taken: str
    result_summary: str


class AutoExploreResult(BaseModel):
    """Result of automatic graph exploration."""

    weaknesses_found: list[WeaknessReport]
    new_nodes: list[ClaimResponse]
    new_edges: list[EdgeResponse]
    converged_edges: list[EdgeResponse]
    convergence_reached: bool
    graph: GraphResponse


class AdviseRequest(BaseModel):
    """Request for strategic advisory analysis."""

    user_context: str = Field(..., min_length=10, max_length=5000)
    perspective_tags: list[str] = []
    session_id: str | None = None


class DirectImpact(BaseModel):
    claim_text: str
    impact_description: str
    severity: str
    timeline: str


class IndirectImpact(BaseModel):
    causal_chain: str
    impact_description: str
    severity: str
    timeline: str


class ImpactAssessment(BaseModel):
    summary: str
    overall_severity: str
    direct_impacts: list[DirectImpact]
    indirect_impacts: list[IndirectImpact]


class Prediction(BaseModel):
    prediction: str
    probability: float
    timeframe: str
    basis: str
    confidence_note: str


class RecommendedAction(BaseModel):
    action: str
    priority: str
    timeframe: str
    addresses_claim: str
    rationale: str


class EscalationScenario(BaseModel):
    scenario_name: str
    trigger: str
    causal_chain: str
    impact_on_user: str
    probability: float
    severity: str
    contingency_actions: list[str]


class KeyIndicator(BaseModel):
    indicator: str
    data_source: str
    related_claim: str
    threshold: str
    signal_type: str


class AdviseResult(BaseModel):
    """Result of strategic advisory analysis."""

    impact_assessment: ImpactAssessment
    predictions: list[Prediction]
    recommended_actions: list[RecommendedAction]
    escalation_scenarios: list[EscalationScenario]
    key_indicators: list[KeyIndicator]
