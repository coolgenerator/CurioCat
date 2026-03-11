export type ClaimType = 'FACT' | 'ASSUMPTION' | 'PREDICTION' | 'OPINION'
export type LogicGate = 'or' | 'and'
export type CausalType = 'direct' | 'indirect' | 'probabilistic' | 'enabling' | 'inhibiting' | 'triggering'
export type ConditionType = 'sufficient' | 'necessary' | 'contributing'
export type BiasSeverity = 'low' | 'medium' | 'high'

export interface BiasWarning {
  type: string
  explanation: string
  severity: BiasSeverity
}

export interface CausalNode {
  id: string
  text: string
  claimType: ClaimType
  confidence: number
  belief: number | null
  sensitivity: number | null
  isCriticalPath: boolean
  isConvergencePoint?: boolean
  logicGate: LogicGate
  orderIndex: number
  sourceSentence: string | null
  beliefLow: number | null
  beliefHigh: number | null
  // Layout computed
  x?: number
  y?: number
  depth?: number
  collapsed?: boolean
}

export interface CausalEdge {
  id: string
  sourceId: string
  targetId: string
  mechanism: string
  strength: number
  timeDelay: string | null
  conditions: string[] | null
  reversible: boolean
  evidenceScore: number
  causalType: CausalType
  conditionType: ConditionType
  temporalWindow: string | null
  decayType: string
  biasWarnings: BiasWarning[]
  consensusLevel: string
  sensitivity: number | null
  evidences: Evidence[]
}

export interface Evidence {
  id: string
  evidenceType: 'supporting' | 'contradicting'
  sourceUrl: string
  sourceTitle: string
  sourceType: string
  snippet: string
  relevanceScore: number
  credibilityScore: number
  sourceTier: number
}


export interface CausalGraph {
  projectId: string
  nodes: CausalNode[]
  edges: CausalEdge[]
  criticalPath: string[]
  hasTemporal: boolean
}

export interface BeliefChange {
  oldBelief: number
  newBelief: number
  delta: number
}

export interface PathInfo {
  path: string[]
  compoundProbability: number
}

export interface TemporalBeliefSample {
  time: number    // days from origin
  belief: number  // 0..1
}

export type ViewMode = 'panorama' | 'focus' | 'compare' | 'timeline'
