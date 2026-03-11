import { useEffect, useCallback, useState, useMemo, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Search, Filter, Download, Loader2, GitFork, Wifi, WifiOff, Eye, Focus as FocusIcon, ChevronLeft, ChevronRight, Check, Undo2, Info, Shield, Clock } from 'lucide-react'
import { toast } from 'sonner'
import { apiGet, apiPatch } from '../../lib/api/client.ts'
import { useAnalysis } from '../../context/AnalysisContext.tsx'
import { useGraphWebSocket } from '../../hooks/useGraphWebSocket.ts'
import { useGraphOperations } from '../../hooks/useGraphOperations.ts'
import { useKeyboardNavigation } from '../../hooks/useKeyboardNavigation.ts'
import { useT } from '../../i18n/index.tsx'
import type { CausalGraph, CausalNode, CausalEdge, Evidence, ViewMode } from '../../types/graph.ts'
import ForceGraph from './ForceGraph.tsx'
import NodeDetailPanel from './NodeDetailPanel.tsx'
import EvidencePanel from './EvidencePanel.tsx'
import EdgeBundlePanel from './EdgeBundlePanel.tsx'
import ClaimsBrowser from './ClaimsBrowser.tsx'
import ScenarioForge from '../scenario/ScenarioForge.tsx'
import ExportPanel from '../export/ExportPanel.tsx'
import StrategicAdvisorPanel from './StrategicAdvisorPanel.tsx'
import TimelineView from './TimelineView.tsx'
import TimeScrubber from './TimeScrubber.tsx'
import GraphLegend from './GraphLegend.tsx'
import ResizablePanel from '../ui/ResizablePanel.tsx'
import Slider from '../ui/Slider.tsx'
import { computeCumulativeTime } from '../../lib/graphUtils.ts'
import { computeVisibleNodes, findTopPaths } from '../../lib/graph/focusCompute.ts'
import { useTemporalBeliefs } from '../../hooks/useTemporalBeliefs.ts'

// --- Snake_case API response types ---

interface ApiNode {
  id: string
  text: string
  claim_type: string
  confidence: number
  belief: number | null
  sensitivity: number | null
  is_critical_path: boolean
  is_convergence_point: boolean
  logic_gate?: string
  order_index: number
}

interface ApiEvidence {
  id: string
  evidence_type: string
  source_url: string
  source_title: string
  source_type: string
  snippet: string
  relevance_score: number
  credibility_score: number
  source_tier?: number
  freshness_score?: number
  published_date?: string | null
}

interface ApiEdge {
  id: string
  source_claim_id: string
  target_claim_id: string
  mechanism: string
  strength: number
  time_delay: string | null
  conditions: string[] | null
  reversible: boolean
  evidence_score: number
  causal_type?: string
  condition_type?: string
  temporal_window?: string | null
  decay_type?: string
  bias_warnings?: Array<{ type: string; explanation: string; severity: string }>
  consensus_level?: string
  sensitivity: number | null
  evidences: ApiEvidence[]
}

interface ApiGraph {
  project_id: string
  claims: ApiNode[]
  edges: ApiEdge[]
  critical_path: string[]
  has_temporal?: boolean
}

// --- Transform helpers ---

function transformEvidence(api: ApiEvidence): Evidence {
  return {
    id: api.id,
    evidenceType: api.evidence_type as 'supporting' | 'contradicting',
    sourceUrl: api.source_url,
    sourceTitle: api.source_title,
    sourceType: api.source_type,
    snippet: api.snippet,
    relevanceScore: api.relevance_score,
    credibilityScore: api.credibility_score,
    sourceTier: api.source_tier ?? 4,
  }
}

function transformNode(api: ApiNode): CausalNode {
  return {
    id: api.id,
    text: api.text,
    claimType: api.claim_type as CausalNode['claimType'],
    confidence: api.confidence,
    belief: api.belief,
    sensitivity: api.sensitivity,
    isCriticalPath: api.is_critical_path,
    isConvergencePoint: api.is_convergence_point,
    logicGate: (api.logic_gate as CausalNode['logicGate']) ?? 'or',
    orderIndex: api.order_index,
  }
}

function transformEdge(api: ApiEdge): CausalEdge {
  return {
    id: api.id,
    sourceId: api.source_claim_id,
    targetId: api.target_claim_id,
    mechanism: api.mechanism,
    strength: api.strength,
    timeDelay: api.time_delay,
    conditions: api.conditions,
    reversible: api.reversible,
    evidenceScore: api.evidence_score,
    causalType: (api.causal_type ?? 'direct') as CausalEdge['causalType'],
    conditionType: (api.condition_type ?? 'contributing') as CausalEdge['conditionType'],
    temporalWindow: api.temporal_window ?? null,
    decayType: api.decay_type ?? 'none',
    biasWarnings: (api.bias_warnings ?? []) as CausalEdge['biasWarnings'],
    consensusLevel: api.consensus_level ?? 'insufficient',
    sensitivity: api.sensitivity,
    evidences: api.evidences.map(transformEvidence),
  }
}

function transformGraph(api: ApiGraph): CausalGraph {
  return {
    projectId: api.project_id,
    nodes: api.claims.map(transformNode),
    edges: api.edges.map(transformEdge),
    criticalPath: api.critical_path,
    hasTemporal: api.has_temporal ?? true,
  }
}

// --- Side panel type ---

type SidePanel = 'none' | 'node' | 'edge' | 'edge-bundle' | 'scenario' | 'export' | 'advisor'

// --- Component ---

export default function GraphScreen() {
  const { projectId } = useParams<{ projectId: string }>()
  const navigate = useNavigate()
  const { state, dispatch } = useAnalysis()
  const { t } = useT()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [searchInput, setSearchInput] = useState('')
  const [sidePanel, setSidePanel] = useState<SidePanel>('none')
  const zoomInRef = useRef<(() => void) | null>(null)
  const zoomOutRef = useRef<(() => void) | null>(null)

  const graph = state.graph
  const { selectedNodeId, selectedEdgeId, selectedEdgeIds, filters, viewMode, focusNodeId, focusVisibleIds, focusPaths, compareChanges, operationLoading } = state
  const [activePathIndex, setActivePathIndex] = useState<number | null>(null)
  const [modifiedGraph, setModifiedGraph] = useState<CausalGraph | null>(null)
  const [previousNodeId, setPreviousNodeId] = useState<string | null>(null)
  const [showTimeScrubber, setShowTimeScrubber] = useState(false)
  const [timeFilter, setTimeFilter] = useState<number | null>(null)

  // Memoized cumulative time computation
  const cumulativeTime = useMemo(
    () => graph ? computeCumulativeTime(graph.nodes, graph.edges) : new Map<string, number>(),
    [graph],
  )

  // Max cumulative time for slider range
  const maxTime = useMemo(
    () => Math.max(1, ...Array.from(cumulativeTime.values())),
    [cumulativeTime],
  )

  // Derive temporal relevance flag
  const hasTemporal = graph?.hasTemporal ?? true

  // Temporal belief computation (skip when not temporally relevant)
  const { getBeliefAtTime, getSamples } = useTemporalBeliefs(hasTemporal ? graph : null, cumulativeTime)

  // Graph operations hook
  const ops = useGraphOperations(projectId ?? null)

  // WebSocket connection for real-time updates
  const { connected } = useGraphWebSocket(projectId ?? null)

  // Keyboard navigation
  useKeyboardNavigation(graph, {
    enabled: true,
    onZoomIn: () => zoomInRef.current?.(),
    onZoomOut: () => zoomOutRef.current?.(),
  })

  // Sync projectId from URL to context
  useEffect(() => {
    if (projectId && state.projectId !== projectId) {
      dispatch({ type: 'SET_PROJECT_ID', projectId })
    }
  }, [projectId, state.projectId, dispatch])

  // Fetch graph data
  useEffect(() => {
    if (!projectId) return

    // If graph is already loaded for this project, skip
    if (graph && graph.projectId === projectId) return

    let cancelled = false

    async function fetchGraph() {
      setLoading(true)
      setError(null)
      try {
        const apiGraph = await apiGet<ApiGraph>(`/api/v1/graph/${projectId}`)
        if (cancelled) return
        const causalGraph = transformGraph(apiGraph)
        dispatch({ type: 'SET_GRAPH', graph: causalGraph })
        toast.success(t.toasts.graphLoaded)
      } catch (err) {
        if (cancelled) return
        const message = err instanceof Error ? err.message : t.errors.loadGraphFailed
        setError(message)
        toast.error(t.errors.loadFailed)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void fetchGraph()
    return () => { cancelled = true }
  }, [projectId, graph, dispatch, t])

  // Reset active path index when focus paths change
  useEffect(() => {
    if (focusPaths.length > 0) {
      setActivePathIndex(0)
    } else {
      setActivePathIndex(null)
    }
  }, [focusPaths])

  // Track which side panel to show based on selection
  useEffect(() => {
    if (selectedNodeId) {
      setSidePanel('node')
    } else if (selectedEdgeIds && selectedEdgeIds.length > 1) {
      setSidePanel('edge-bundle')
    } else if (selectedEdgeId) {
      setSidePanel('edge')
    }
  }, [selectedNodeId, selectedEdgeId, selectedEdgeIds])

  // Auto-compute focus when entering focus mode or selecting a different node while in focus mode
  useEffect(() => {
    if (viewMode !== 'focus' || !graph) return
    const targetId = selectedNodeId ?? focusNodeId
    if (!targetId) return
    // Skip if we already have focus computed for this exact node
    if (focusNodeId === targetId && focusVisibleIds.size > 0) return
    const depthLimit = filters.depthLimit ?? 2
    const visibleIds = computeVisibleNodes(graph, targetId, depthLimit)
    const paths = findTopPaths(graph, targetId)
    dispatch({ type: 'SET_FOCUS', nodeId: targetId, visibleIds, paths })
  }, [viewMode, selectedNodeId, graph, focusNodeId, focusVisibleIds.size, filters.depthLimit, dispatch])

  // Node click handler
  const handleNodeClick = useCallback((nodeId: string) => {
    dispatch({
      type: 'SELECT_NODE',
      nodeId: selectedNodeId === nodeId ? null : nodeId,
    })
    if (selectedNodeId === nodeId) {
      setSidePanel('none')
    }
  }, [dispatch, selectedNodeId])

  // Edge click handler
  const handleEdgeClick = useCallback((edgeId: string, allEdgeIds?: string[]) => {
    // Remember which node we came from (if any) for back navigation
    if (selectedNodeId) {
      setPreviousNodeId(selectedNodeId)
    }
    // Toggle off if clicking the same edge
    if (selectedEdgeId === edgeId && !allEdgeIds) {
      dispatch({ type: 'SELECT_EDGE', edgeId: null })
      setSidePanel('none')
      return
    }
    // Bundle click
    if (allEdgeIds && allEdgeIds.length > 1) {
      dispatch({
        type: 'SELECT_EDGE_BUNDLE',
        edgeIds: allEdgeIds,
        primaryEdgeId: edgeId,
      })
    } else {
      dispatch({
        type: 'SELECT_EDGE',
        edgeId,
      })
    }
  }, [dispatch, selectedEdgeId, selectedNodeId])

  // Edge strength change handler (patch API + update state)
  const handleEdgeStrengthChange = useCallback(async (edgeId: string, strength: number) => {
    dispatch({ type: 'UPDATE_EDGE_STRENGTH', edgeId, strength })
    toast.success(t.toasts.edgeUpdated)
    try {
      await apiPatch(`/api/v1/graph/${projectId}/edges/${edgeId}`, { strength })
    } catch {
      toast.error(t.errors.edgeUpdateFailed)
    }
  }, [dispatch, projectId, t])

  // Depth limit change — in focus mode, recompute locally
  const handleDepthChange = useCallback((value: number) => {
    const depthLimit = value === 0 ? null : value
    dispatch({ type: 'UPDATE_FILTERS', filters: { depthLimit } })
    if (viewMode === 'focus' && focusNodeId && graph && depthLimit !== null) {
      const visibleIds = computeVisibleNodes(graph, focusNodeId, depthLimit)
      const paths = findTopPaths(graph, focusNodeId)
      dispatch({ type: 'SET_FOCUS', nodeId: focusNodeId, visibleIds, paths })
    }
  }, [dispatch, viewMode, focusNodeId, graph])

  // Search (debounced via local state)
  useEffect(() => {
    const timer = setTimeout(() => {
      dispatch({ type: 'UPDATE_FILTERS', filters: { searchQuery: searchInput } })
    }, 300)
    return () => clearTimeout(timer)
  }, [searchInput, dispatch])

  // Back from edge panel to the node we came from
  const handleBackToNode = useCallback(() => {
    if (previousNodeId) {
      dispatch({ type: 'SELECT_NODE', nodeId: previousNodeId })
      setPreviousNodeId(null)
    }
  }, [dispatch, previousNodeId])

  // Switch from bundle panel to single edge detail
  const handleSelectSingleEdge = useCallback((edgeId: string) => {
    dispatch({ type: 'SELECT_EDGE', edgeId })
  }, [dispatch])

  // Close side panels
  const handleClosePanel = useCallback(() => {
    dispatch({ type: 'SELECT_NODE', nodeId: null })
    dispatch({ type: 'SELECT_EDGE', edgeId: null })
    setSidePanel('none')
    setPreviousNodeId(null)
  }, [dispatch])

  // Toggle scenario forge panel
  const handleToggleScenario = useCallback(() => {
    if (sidePanel === 'scenario') {
      setSidePanel('none')
    } else {
      dispatch({ type: 'SELECT_NODE', nodeId: null })
      dispatch({ type: 'SELECT_EDGE', edgeId: null })
      setSidePanel('scenario')
    }
  }, [sidePanel, dispatch])

  // Toggle export panel
  const handleToggleExport = useCallback(() => {
    if (sidePanel === 'export') {
      setSidePanel('none')
    } else {
      dispatch({ type: 'SELECT_NODE', nodeId: null })
      dispatch({ type: 'SELECT_EDGE', edgeId: null })
      setSidePanel('export')
    }
  }, [sidePanel, dispatch])

  // Toggle advisor panel
  const handleToggleAdvisor = useCallback(() => {
    if (sidePanel === 'advisor') {
      setSidePanel('none')
    } else {
      dispatch({ type: 'SELECT_NODE', nodeId: null })
      dispatch({ type: 'SELECT_EDGE', edgeId: null })
      setSidePanel('advisor')
    }
  }, [sidePanel, dispatch])

  // Navigate to comparison view
  const handleCompare = useCallback((scenarioAId: string, scenarioBId: string) => {
    navigate(`/compare/${projectId}?a=${encodeURIComponent(scenarioAId)}&b=${encodeURIComponent(scenarioBId)}`)
  }, [navigate, projectId])

  // Find max depth for slider
  const maxPossibleDepth = graph
    ? Math.max(...graph.nodes.map((n) => n.orderIndex), 10)
    : 10

  // --- Render ---

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-3.5rem)]">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 text-ocean-400 animate-spin" />
          <p className="text-sm text-text-secondary">{t.graph.loading}</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-3.5rem)]">
        <div className="text-center">
          <h2 className="text-lg font-semibold text-text-primary mb-2">{t.graph.error}</h2>
          <p className="text-sm text-text-secondary mb-4">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 bg-ocean-500 text-white rounded-lg hover:bg-ocean-400 transition-colors text-sm"
          >
            {t.graph.retry}
          </button>
        </div>
      </div>
    )
  }

  if (!graph) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-3.5rem)]">
        <div className="text-center">
          <h2 className="text-lg font-semibold text-text-primary mb-2">{t.graph.noData}</h2>
          <p className="text-sm text-text-secondary">
            {t.graph.noDataHelp}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)]">
      {/* Toolbar */}
      <div className="flex items-center gap-3 px-4 py-2.5 bg-surface-800 border-b border-surface-700 shrink-0 flex-wrap md:flex-nowrap">
        {/* Search */}
        <div className="relative w-48 min-w-[120px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted" />
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder={t.graph.search}
            className="w-full pl-8 pr-3 py-1.5 text-sm bg-surface-700 border border-surface-600 rounded-lg text-text-primary placeholder-text-muted focus:outline-none focus:border-ocean-500 transition-colors"
          />
        </div>

        {/* Depth filter - hidden on mobile */}
        <div className="hidden md:flex items-center gap-2">
          <Filter className="w-3.5 h-3.5 text-text-muted" />
          <Slider
            label={t.graph.depth}
            value={filters.depthLimit ?? 0}
            min={0}
            max={Math.min(maxPossibleDepth, 10)}
            step={1}
            onChange={handleDepthChange}
            showValue
            className="w-32"
          />
          <span className="text-xs text-text-muted">
            {filters.depthLimit === null ? t.graph.depthAll : `${filters.depthLimit}`}
          </span>
        </div>

        {/* View mode selector */}
        <div className="flex items-center rounded-lg border border-surface-600 overflow-hidden">
          {(['panorama', 'focus', 'timeline'] as ViewMode[]).filter(m => m !== 'timeline' || hasTemporal).map((mode) => {
            const isActive = viewMode === mode
            const Icon = mode === 'panorama' ? Eye : mode === 'focus' ? FocusIcon : Clock
            return (
              <button
                key={mode}
                onClick={() => {
                  if (mode === 'panorama') {
                    ops.clearFocus()
                    ops.clearCompare()
                  }
                  dispatch({ type: 'SET_VIEW_MODE', mode })
                }}
                className={`flex items-center gap-1 px-2 py-1 text-xs transition-colors ${
                  isActive
                    ? 'bg-ocean-500/20 text-ocean-400'
                    : 'text-text-muted hover:text-text-secondary bg-surface-700 hover:bg-surface-600'
                }`}
              >
                <Icon className="w-3 h-3" />
                <span className="hidden md:inline">{t.viewModes[mode]}</span>
              </button>
            )
          })}
        </div>

        {/* Time scrubber toggle (only in graph modes, not timeline, and only when temporal) */}
        {hasTemporal && viewMode !== 'timeline' && (
          <button
            onClick={() => {
              setShowTimeScrubber((prev) => {
                if (prev) setTimeFilter(null)
                return !prev
              })
            }}
            className={`flex items-center gap-1.5 px-2 py-1 text-xs rounded-lg border transition-colors ${
              showTimeScrubber
                ? 'text-ocean-400 bg-ocean-500/15 border-ocean-500/30'
                : 'text-text-muted hover:text-text-secondary bg-surface-700 hover:bg-surface-600 border-surface-600'
            }`}
          >
            <Clock className="w-3 h-3" />
            <span className="hidden md:inline">{t.timeline.scrubber}</span>
          </button>
        )}

        {/* WebSocket status indicator */}
        <div className="flex items-center gap-1" title={connected ? t.graph.connected : t.graph.disconnected}>
          {connected ? (
            <Wifi className="w-3.5 h-3.5 text-confidence-high" />
          ) : (
            <WifiOff className="w-3.5 h-3.5 text-text-muted" />
          )}
        </div>

        {/* Node/edge count - hidden on mobile */}
        <span className="hidden md:inline text-xs text-text-muted">
          {graph.nodes.length} {t.graph.nodes} &middot; {graph.edges.length} {t.graph.edges}
        </span>

        {/* Push action buttons to right */}
        <div className="flex-1" />

        {/* Fork Scenario */}
        <button
          onClick={handleToggleScenario}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border transition-colors ${
            sidePanel === 'scenario'
              ? 'text-ocean-400 bg-ocean-500/15 border-ocean-500/30'
              : 'text-text-secondary hover:text-text-primary bg-surface-700 hover:bg-surface-600 border-surface-600'
          }`}
        >
          <GitFork className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">{t.graph.fork}</span>
        </button>

        {/* Export */}
        <button
          onClick={handleToggleExport}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border transition-colors ${
            sidePanel === 'export'
              ? 'text-ocean-400 bg-ocean-500/15 border-ocean-500/30'
              : 'text-text-secondary hover:text-text-primary bg-surface-700 hover:bg-surface-600 border-surface-600'
          }`}
        >
          <Download className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">{t.graph.export}</span>
        </button>

        {/* Strategic Advisor */}
        <button
          onClick={handleToggleAdvisor}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border transition-colors ${
            sidePanel === 'advisor'
              ? 'text-ocean-400 bg-ocean-500/15 border-ocean-500/30'
              : 'text-text-secondary hover:text-text-primary bg-surface-700 hover:bg-surface-600 border-surface-600'
          }`}
        >
          <Shield className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">{t.advisor.button}</span>
        </button>

      </div>

      {/* Main content area */}
      <div className="flex flex-1 min-h-0">
        {/* Left: Claims Browser */}
        <ResizablePanel side="left" defaultWidth={260} minWidth={200} maxWidth={400}
          storageKey="curiocat-left-panel">
          <ClaimsBrowser graph={graph} selectedNodeId={selectedNodeId}
            onNodeClick={handleNodeClick} />
        </ResizablePanel>

        {/* Center: ForceGraph or TimelineView */}
        <div className="flex-1 min-w-0 relative">
          {viewMode === 'timeline' ? (
            <TimelineView
              graph={graph}
              cumulativeTime={cumulativeTime}
              selectedNodeId={selectedNodeId}
              onNodeClick={handleNodeClick}
            />
          ) : (
            <ForceGraph
              graph={graph}
              onNodeClick={handleNodeClick}
              onEdgeClick={handleEdgeClick}
              onEdgeStrengthChange={handleEdgeStrengthChange}
              selectedNodeId={selectedNodeId}
              selectedEdgeId={selectedEdgeId}
              filters={filters}
              viewMode={viewMode}
              focusNodeId={focusNodeId}
              focusVisibleIds={focusVisibleIds}
              focusPaths={focusPaths}
              activePathIndex={activePathIndex}
              compareChanges={compareChanges}
              timeFilter={showTimeScrubber ? timeFilter : null}
              cumulativeTime={cumulativeTime}
              getBeliefAtTime={showTimeScrubber ? getBeliefAtTime : undefined}
            />
          )}
          {viewMode !== 'timeline' && <GraphLegend />}
        </div>

        {/* Right: Detail panels */}
        {sidePanel !== 'none' && (
          <ResizablePanel side="right" defaultWidth={320} minWidth={280} maxWidth={480}
            storageKey="curiocat-right-panel">
            {sidePanel === 'node' && selectedNodeId && (
              <NodeDetailPanel
                graph={graph}
                nodeId={selectedNodeId}
                onClose={handleClosePanel}
                onNodeClick={handleNodeClick}
                onEdgeClick={handleEdgeClick}
                onExpand={ops.expand}
                onTraceBack={ops.traceBack}
                onFocus={ops.focus}
                operationLoading={operationLoading}
                cumulativeTime={cumulativeTime}
                temporalSamples={hasTemporal && showTimeScrubber ? getSamples : undefined}
                currentTime={hasTemporal && showTimeScrubber ? timeFilter : undefined}
              />
            )}
            {sidePanel === 'edge' && selectedEdgeId && (
              <EvidencePanel
                graph={graph}
                edgeId={selectedEdgeId}
                onClose={handleClosePanel}
                onBack={previousNodeId ? handleBackToNode : undefined}
                onStrengthChange={handleEdgeStrengthChange}
                onChallenge={ops.challenge}
                operationLoading={operationLoading}
              />
            )}
            {sidePanel === 'edge-bundle' && selectedEdgeIds && selectedEdgeIds.length > 1 && (
              <EdgeBundlePanel
                graph={graph}
                edgeIds={selectedEdgeIds}
                onClose={handleClosePanel}
                onBack={previousNodeId ? handleBackToNode : undefined}
                onStrengthChange={handleEdgeStrengthChange}
                onChallenge={ops.challenge}
                onSelectSingleEdge={handleSelectSingleEdge}
                operationLoading={operationLoading}
              />
            )}
            {sidePanel === 'scenario' && projectId && (
              <ScenarioForge
                projectId={projectId}
                onClose={handleClosePanel}
                onCompare={handleCompare}
              />
            )}
            {sidePanel === 'export' && (
              <ExportPanel
                graph={graph}
                onClose={handleClosePanel}
              />
            )}
            {sidePanel === 'advisor' && (
              <StrategicAdvisorPanel
                onClose={handleClosePanel}
                onAdvise={ops.advise}
                onSuggestPerspectives={ops.suggestPerspectives}
                operationLoading={operationLoading}
              />
            )}
          </ResizablePanel>
        )}
      </div>

      {/* Focus mode: path cycling bar */}
      {viewMode === 'focus' && focusPaths.length > 0 && (
        <div className="flex items-center gap-3 px-4 py-2 bg-surface-800 border-t border-surface-700 shrink-0">
          <span className="text-xs text-text-muted">{t.viewModes.paths}</span>
          <button
            onClick={() => setActivePathIndex((prev) => {
              if (prev === null || prev <= 0) return focusPaths.length - 1
              return prev - 1
            })}
            className="p-1 rounded hover:bg-surface-700 text-text-muted hover:text-text-primary transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="text-xs text-text-primary tabular-nums min-w-[3rem] text-center">
            {(activePathIndex ?? 0) + 1} {t.viewModes.pathOf} {focusPaths.length}
          </span>
          <button
            onClick={() => setActivePathIndex((prev) => {
              if (prev === null || prev >= focusPaths.length - 1) return 0
              return prev + 1
            })}
            className="p-1 rounded hover:bg-surface-700 text-text-muted hover:text-text-primary transition-colors"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
          {activePathIndex !== null && focusPaths[activePathIndex] && (
            <span className="text-xs text-text-muted">
              {t.viewModes.probability}: {(focusPaths[activePathIndex].compoundProbability * 100).toFixed(1)}%
            </span>
          )}
          <div className="flex-1" />
          <button
            onClick={() => { ops.clearFocus(); setActivePathIndex(null) }}
            className="text-xs text-text-muted hover:text-text-primary transition-colors"
          >
            {t.viewModes.panorama}
          </button>
        </div>
      )}

      {/* Compare mode: apply/revert bar or empty state guide */}
      {viewMode === 'compare' && (
        Object.keys(compareChanges).length > 0 ? (
          <div className="flex items-center gap-3 px-4 py-2 bg-surface-800 border-t border-surface-700 shrink-0">
            <span className="text-xs text-text-muted">
              {Object.keys(compareChanges).length} {t.graph.nodes} {t.comparison.divergent}
            </span>
            <div className="flex-1" />
            <button
              onClick={() => {
                if (modifiedGraph) ops.applyCompare(modifiedGraph)
                else ops.clearCompare()
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-confidence-high/15 text-confidence-high border border-confidence-high/30 hover:bg-confidence-high/25 transition-colors"
            >
              <Check className="w-3.5 h-3.5" />
              {t.viewModes.apply}
            </button>
            <button
              onClick={() => { ops.clearCompare(); setModifiedGraph(null) }}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-surface-700 hover:bg-surface-600 text-text-secondary border border-surface-600 transition-colors"
            >
              <Undo2 className="w-3.5 h-3.5" />
              {t.viewModes.revert}
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-3 px-4 py-2.5 bg-surface-800 border-t border-surface-700 shrink-0">
            <Info className="w-4 h-4 text-ocean-400 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-xs text-text-secondary">{t.viewModes.compareSteps}</p>
            </div>
            <button
              onClick={() => dispatch({ type: 'SET_VIEW_MODE', mode: 'panorama' })}
              className="text-xs text-text-muted hover:text-text-primary transition-colors shrink-0"
            >
              {t.viewModes.panorama}
            </button>
          </div>
        )
      )}

      {/* Time scrubber bar */}
      {hasTemporal && showTimeScrubber && viewMode !== 'timeline' && (
        <TimeScrubber
          graph={graph}
          cumulativeTime={cumulativeTime}
          maxTime={maxTime}
          value={timeFilter}
          onChange={setTimeFilter}
          onClose={() => { setShowTimeScrubber(false); setTimeFilter(null) }}
          getBeliefAtTime={getBeliefAtTime}
        />
      )}
    </div>
  )
}
