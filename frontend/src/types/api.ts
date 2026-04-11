import type { CausalGraph, ClaimType } from './graph.ts'

export interface AnalyzeRequest {
  title: string
  text: string
}

export interface AnalyzeResponse {
  project_id: string
  status: string
}

export interface PipelineStage {
  stage: string
  status: string
  progress: number
  data: Record<string, unknown> | null
  timestamp: string
  layer?: number
}

export interface ProjectSummary {
  id: string
  title: string
  status: string
  created_at: string
}

export interface ProjectStatus {
  project_id: string
  title: string
  status: string
  created_at: string
  stages: PipelineStage[]
  claim_count?: number
}

export interface ForkRequest {
  project_id: string
  name: string
  description?: string
  edge_overrides: Record<string, number>
  injected_events: string[]
}

export interface ScenarioComparison {
  scenario_a: CausalGraph
  scenario_b: CausalGraph
  divergent_nodes: string[]
  convergent_nodes: string[]
}

export interface ExtractedClaim {
  id: string
  text: string
  claimType: ClaimType
  confidence: number
  layer?: number
}

// --- Streamed Pipeline Data ---

export interface StreamedEvidence {
  evidence_type: 'supporting' | 'contradicting'
  source_title: string
  source_url: string
  snippet: string
  relevance_score: number
}

export interface StreamedEdge {
  source_text: string
  target_text: string
  mechanism: string
  strength: number
  causal_type: string
  evidence_score?: number
  evidences?: StreamedEvidence[]
  bias_warnings?: Array<{ type: string; severity: string }>
}

// --- Graph Operations ---

export interface ExpandRequest {
  node_id: string
}

export interface TraceBackRequest {
  node_id: string
}

export interface ChallengeRequest {
  edge_id: string
}

export interface WhatIfModification {
  type: 'edge_strength' | 'node_probability'
  target_id: string
  value: number
  source_id?: string
}

export interface WhatIfRequest {
  modifications: WhatIfModification[]
}

export interface ApiBeliefChange {
  old_belief: number
  new_belief: number
  delta: number
}

export interface ApiGraphOperationResult {
  new_nodes: Record<string, unknown>[]
  new_edges: Record<string, unknown>[]
  converged_edges: Record<string, unknown>[]
  graph: Record<string, unknown>
}

export interface ApiChallengeResult {
  edge_id: string
  new_evidence_score: number
  new_evidences: Record<string, unknown>[]
  belief_changes: Record<string, ApiBeliefChange>
  graph: Record<string, unknown>
}

export interface ApiWhatIfResult {
  changes: Record<string, ApiBeliefChange>
  modified_graph: Record<string, unknown>
}

export interface ApiPathInfo {
  path: string[]
  compound_probability: number
}

export interface ApiFocusResult {
  focus_node_id: string
  visible_node_ids: string[]
  paths: ApiPathInfo[]
}

// --- Enrich ---

export interface ApiEnrichResult {
  new_nodes: Record<string, unknown>[]
  new_edges: Record<string, unknown>[]
  merged_nodes: Record<string, unknown>[]
  skipped_duplicates: number
  graph: Record<string, unknown>
}

// --- Auto Explore ---

export interface ApiWeaknessReport {
  node_id: string | null
  edge_id: string | null
  weakness_type: string
  action_taken: string
  result_summary: string
}

export interface ApiAutoExploreResult {
  weaknesses_found: ApiWeaknessReport[]
  new_nodes: Record<string, unknown>[]
  new_edges: Record<string, unknown>[]
  converged_edges: Record<string, unknown>[]
  convergence_reached: boolean
  graph: Record<string, unknown>
}

// --- Strategic Advisor ---

export interface ApiPerspectiveSuggestion {
  label: string
  description: string
}

export interface ApiSuggestPerspectivesResult {
  suggestions: ApiPerspectiveSuggestion[]
}

export interface ApiDirectImpact {
  claim_text: string
  impact_description: string
  severity: 'critical' | 'high' | 'medium' | 'low'
  timeline: string
}

export interface ApiIndirectImpact {
  causal_chain: string
  impact_description: string
  severity: 'critical' | 'high' | 'medium' | 'low'
  timeline: string
}

export interface ApiImpactAssessment {
  summary: string
  overall_severity: 'critical' | 'high' | 'medium' | 'low'
  direct_impacts: ApiDirectImpact[]
  indirect_impacts: ApiIndirectImpact[]
}

export interface ApiPrediction {
  prediction: string
  probability: number
  timeframe: string
  basis: string
  confidence_note: string
}

export interface ApiRecommendedAction {
  action: string
  priority: 'immediate' | 'short-term' | 'medium-term' | 'long-term'
  timeframe: string
  addresses_claim: string
  rationale: string
}

export interface ApiEscalationScenario {
  scenario_name: string
  trigger: string
  causal_chain: string
  impact_on_user: string
  probability: number
  severity: 'critical' | 'high' | 'medium' | 'low'
  contingency_actions: string[]
}

export interface ApiKeyIndicator {
  indicator: string
  data_source: string
  related_claim: string
  threshold: string
  signal_type: 'leading' | 'coincident' | 'lagging'
}

export interface ApiAdviseResult {
  impact_assessment: ApiImpactAssessment
  predictions: ApiPrediction[]
  recommended_actions: ApiRecommendedAction[]
  escalation_scenarios: ApiEscalationScenario[]
  key_indicators: ApiKeyIndicator[]
}
