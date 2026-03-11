import { createContext, useContext, useReducer, type Dispatch, type ReactNode } from 'react'
import type { PipelineStage } from '../types/api.ts'
import type { BeliefChange, CausalGraph, ClaimType, PathInfo, ViewMode } from '../types/graph.ts'

// --- Scenario State ---

export interface ScenarioState {
  id: string
  name: string
  description?: string
  graph: CausalGraph | null
  narrative?: string
  keyInsights?: string[]
  conclusion?: string
  edgeChangeReasons?: Array<{
    edge_id: string
    reason: string
    old_strength: number
    new_strength: number
  }>
}

// --- Analysis State ---

export interface AnalysisState {
  projectId: string | null
  status: 'idle' | 'analyzing' | 'complete' | 'error'
  stages: PipelineStage[]
  graph: CausalGraph | null
  selectedNodeId: string | null
  selectedEdgeId: string | null
  selectedEdgeIds: string[] | null
  filters: {
    depthLimit: number | null
    claimTypes: ClaimType[]
    minConfidence: number
    searchQuery: string
  }
  scenarios: ScenarioState[]
  error: string | null
  // Graph operations state
  viewMode: ViewMode
  focusNodeId: string | null
  focusVisibleIds: Set<string>
  focusPaths: PathInfo[]
  compareBaseline: CausalGraph | null
  compareChanges: Record<string, BeliefChange>
  operationLoading: string | null
}

// --- Actions ---

export type AnalysisAction =
  | { type: 'START_ANALYSIS'; projectId: string }
  | { type: 'SET_PROJECT_ID'; projectId: string }
  | { type: 'UPDATE_STAGE'; stage: PipelineStage }
  | { type: 'SET_GRAPH'; graph: CausalGraph }
  | { type: 'SELECT_NODE'; nodeId: string | null }
  | { type: 'SELECT_EDGE'; edgeId: string | null }
  | { type: 'SELECT_EDGE_BUNDLE'; edgeIds: string[]; primaryEdgeId: string }
  | { type: 'UPDATE_FILTERS'; filters: Partial<AnalysisState['filters']> }
  | { type: 'UPDATE_EDGE_STRENGTH'; edgeId: string; strength: number }
  | { type: 'SET_ERROR'; error: string }
  | { type: 'ADD_SCENARIO'; scenario: ScenarioState }
  | { type: 'REMOVE_SCENARIO'; scenarioId: string }
  | { type: 'LOAD_SCENARIOS'; scenarios: ScenarioState[] }
  | { type: 'RESET' }
  | { type: 'SET_VIEW_MODE'; mode: ViewMode }
  | { type: 'SET_FOCUS'; nodeId: string; visibleIds: Set<string>; paths: PathInfo[] }
  | { type: 'CLEAR_FOCUS' }
  | { type: 'SET_COMPARE'; baseline: CausalGraph; changes: Record<string, BeliefChange> }
  | { type: 'CLEAR_COMPARE' }
  | { type: 'SET_OPERATION_LOADING'; operation: string | null }
  | { type: 'MERGE_GRAPH_UPDATE'; graph: CausalGraph }

// --- Initial State ---

const initialState: AnalysisState = {
  projectId: null,
  status: 'idle',
  stages: [],
  graph: null,
  selectedNodeId: null,
  selectedEdgeId: null,
  selectedEdgeIds: null,
  filters: {
    depthLimit: null,
    claimTypes: ['FACT', 'ASSUMPTION', 'PREDICTION', 'OPINION'],
    minConfidence: 0,
    searchQuery: '',
  },
  scenarios: [],
  error: null,
  viewMode: 'panorama',
  focusNodeId: null,
  focusVisibleIds: new Set(),
  focusPaths: [],
  compareBaseline: null,
  compareChanges: {},
  operationLoading: null,
}

// --- Reducer ---

function analysisReducer(state: AnalysisState, action: AnalysisAction): AnalysisState {
  switch (action.type) {
    case 'START_ANALYSIS':
      return {
        ...initialState,
        projectId: action.projectId,
        status: 'analyzing',
      }

    case 'SET_PROJECT_ID':
      return {
        ...state,
        projectId: action.projectId,
      }

    case 'UPDATE_STAGE': {
      const stageIndex = state.stages.findIndex((s) => s.stage === action.stage.stage)
      const updatedStages = stageIndex >= 0
        ? state.stages.map((s, i) => (i === stageIndex ? action.stage : s))
        : [...state.stages, action.stage]

      // Check if complete
      const isComplete = action.stage.stage === 'complete' ||
        action.stage.status === 'completed'

      return {
        ...state,
        stages: updatedStages,
        status: isComplete ? 'complete' : state.status,
      }
    }

    case 'SET_GRAPH':
      return {
        ...state,
        graph: action.graph,
        status: 'complete',
      }

    case 'SELECT_NODE':
      return {
        ...state,
        selectedNodeId: action.nodeId,
        selectedEdgeId: action.nodeId ? null : state.selectedEdgeId,
        selectedEdgeIds: action.nodeId ? null : state.selectedEdgeIds,
      }

    case 'SELECT_EDGE':
      return {
        ...state,
        selectedEdgeId: action.edgeId,
        selectedNodeId: action.edgeId ? null : state.selectedNodeId,
        selectedEdgeIds: null,
      }

    case 'SELECT_EDGE_BUNDLE':
      return {
        ...state,
        selectedEdgeId: action.primaryEdgeId,
        selectedEdgeIds: action.edgeIds,
        selectedNodeId: null,
      }

    case 'UPDATE_FILTERS':
      return {
        ...state,
        filters: { ...state.filters, ...action.filters },
      }

    case 'UPDATE_EDGE_STRENGTH': {
      if (!state.graph) return state
      return {
        ...state,
        graph: {
          ...state.graph,
          edges: state.graph.edges.map((e) =>
            e.id === action.edgeId ? { ...e, strength: action.strength } : e
          ),
        },
      }
    }

    case 'SET_ERROR':
      return {
        ...state,
        status: 'error',
        error: action.error,
      }

    case 'ADD_SCENARIO':
      return {
        ...state,
        scenarios: [...state.scenarios, action.scenario],
      }

    case 'REMOVE_SCENARIO':
      return {
        ...state,
        scenarios: state.scenarios.filter((s) => s.id !== action.scenarioId),
      }

    case 'LOAD_SCENARIOS':
      return {
        ...state,
        scenarios: action.scenarios,
      }

    case 'RESET':
      return initialState

    case 'SET_VIEW_MODE':
      return { ...state, viewMode: action.mode }

    case 'SET_FOCUS':
      return {
        ...state,
        viewMode: 'focus',
        focusNodeId: action.nodeId,
        focusVisibleIds: action.visibleIds,
        focusPaths: action.paths,
        filters: { ...state.filters, depthLimit: 2 },
      }

    case 'CLEAR_FOCUS':
      return {
        ...state,
        viewMode: 'panorama',
        focusNodeId: null,
        focusVisibleIds: new Set(),
        focusPaths: [],
      }

    case 'SET_COMPARE':
      return {
        ...state,
        viewMode: 'compare',
        compareBaseline: action.baseline,
        compareChanges: action.changes,
      }

    case 'CLEAR_COMPARE':
      return {
        ...state,
        viewMode: 'panorama',
        compareBaseline: null,
        compareChanges: {},
      }

    case 'SET_OPERATION_LOADING':
      return { ...state, operationLoading: action.operation }

    case 'MERGE_GRAPH_UPDATE':
      return {
        ...state,
        graph: action.graph,
        operationLoading: null,
      }

    default:
      return state
  }
}

// --- Context ---

interface AnalysisContextValue {
  state: AnalysisState
  dispatch: Dispatch<AnalysisAction>
}

const AnalysisContext = createContext<AnalysisContextValue | null>(null)

// --- Provider ---

export function AnalysisProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(analysisReducer, initialState)

  return (
    <AnalysisContext.Provider value={{ state, dispatch }}>
      {children}
    </AnalysisContext.Provider>
  )
}

// --- Hook ---

export function useAnalysis(): AnalysisContextValue {
  const context = useContext(AnalysisContext)
  if (!context) {
    throw new Error('useAnalysis must be used within an AnalysisProvider')
  }
  return context
}
