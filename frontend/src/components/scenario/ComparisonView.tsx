import { useEffect, useState, useCallback } from 'react'
import { useParams, useSearchParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Layers, GitBranch, BarChart3, Check, FlaskConical } from 'lucide-react'
import { toast } from 'sonner'
import { useScenario } from '../../hooks/useScenario.ts'
import { useAnalysis } from '../../context/AnalysisContext.tsx'
import { useT } from '../../i18n/index.tsx'
import type { ScenarioComparison } from '../../types/api.ts'
import type { CausalGraph } from '../../types/graph.ts'
import ForceGraph from '../tree/ForceGraph.tsx'
import MergeOverlay from './MergeOverlay.tsx'
import Button from '../ui/Button.tsx'

type ViewMode = 'side-by-side' | 'overlay'

export default function ComparisonView() {
  const { projectId } = useParams<{ projectId: string }>()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { state, dispatch } = useAnalysis()
  const { t } = useT()

  // Sync projectId from URL to context
  useEffect(() => {
    if (projectId && state.projectId !== projectId) {
      dispatch({ type: 'SET_PROJECT_ID', projectId })
    }
  }, [projectId, state.projectId, dispatch])

  const scenarioAId = searchParams.get('a') ?? ''
  const scenarioBId = searchParams.get('b') ?? ''

  const { scenarios, compareScenarios, loading } = useScenario(projectId ?? null)
  const [comparison, setComparison] = useState<ScenarioComparison | null>(null)
  const [viewMode, setViewMode] = useState<ViewMode>('side-by-side')
  const [error, setError] = useState<string | null>(null)
  const [pickA, setPickA] = useState<string | null>(null)
  const [pickB, setPickB] = useState<string | null>(null)

  useEffect(() => {
    if (!scenarioAId || !scenarioBId) return

    let cancelled = false

    async function fetchComparison() {
      const result = await compareScenarios(scenarioAId, scenarioBId)
      if (cancelled) return

      if (result) {
        setComparison(result)
      } else {
        setError(t.errors.comparisonLoadFailed)
        toast.error(t.errors.comparisonFailed)
      }
    }

    void fetchComparison()
    return () => { cancelled = true }
  }, [scenarioAId, scenarioBId, compareScenarios, t])

  const handleNodeClick = useCallback(() => {
    // No-op for comparison view
  }, [])

  const handleEdgeClick = useCallback(() => {
    // No-op for comparison view
  }, [])

  const handleEdgeStrengthChange = useCallback(() => {
    // No-op for comparison view
  }, [])

  const defaultFilters = { depthLimit: null, searchQuery: '' }

  if (!scenarioAId || !scenarioBId) {
    const hasScenarios = scenarios.length >= 2
    const canCompare = pickA && pickB && pickA !== pickB

    // No scenarios yet — guide user to create them
    if (!hasScenarios) {
      return (
        <div className="flex items-center justify-center h-[calc(100vh-3.5rem)]">
          <div className="max-w-md text-center">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-ocean-500/10 border border-ocean-500/20 mb-4">
              <FlaskConical className="w-6 h-6 text-ocean-400" />
            </div>
            <h2 className="text-lg font-semibold text-text-primary mb-2">{t.comparison.needScenarios}</h2>
            <p className="text-sm text-text-secondary mb-6">
              {t.comparison.needScenariosHint}
            </p>
            <Button
              variant="secondary"
              onClick={() => projectId ? navigate(`/graph/${projectId}`) : navigate('/graph')}
            >
              <GitBranch className="w-4 h-4" />
              {t.comparison.guide.goToGraph}
            </Button>
          </div>
        </div>
      )
    }

    // Has scenarios — split-screen picker
    return (
      <div className="flex flex-col h-[calc(100vh-3.5rem)]">
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-2.5 bg-surface-800 border-b border-surface-700 shrink-0">
          <BarChart3 className="w-4 h-4 text-ocean-400" />
          <h2 className="text-sm font-semibold text-text-primary">{t.comparison.pickTitle}</h2>
          <div className="flex-1" />
          <Button
            size="sm"
            disabled={!canCompare}
            onClick={() => {
              if (canCompare) {
                navigate(`/compare/${projectId}?a=${encodeURIComponent(pickA)}&b=${encodeURIComponent(pickB)}`)
              }
            }}
          >
            <BarChart3 className="w-3.5 h-3.5" />
            {t.comparison.startCompare}
          </Button>
        </div>

        {/* Split panels */}
        <div className="flex flex-1 min-h-0">
          {/* Scenario A picker */}
          <div className="flex-1 border-r border-surface-700 flex flex-col">
            <div className="px-4 py-2 bg-surface-800/50 border-b border-surface-700">
              <span className="text-xs font-medium text-text-secondary">{t.comparison.scenarioA}</span>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {scenarios.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setPickA(s.id)}
                  disabled={s.id === pickB}
                  className={`w-full text-left px-4 py-3 rounded-xl border transition-colors ${
                    s.id === pickA
                      ? 'border-ocean-500 bg-ocean-500/10'
                      : s.id === pickB
                        ? 'border-surface-700 bg-surface-800/50 opacity-40 cursor-not-allowed'
                        : 'border-surface-700 bg-surface-800 hover:border-surface-600 hover:bg-surface-800/80'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className={`text-sm truncate mr-2 ${s.id === pickA ? 'text-ocean-400 font-medium' : 'text-text-primary'}`}>
                      {s.name}
                    </span>
                    {s.id === pickA && <Check className="w-4 h-4 text-ocean-400 shrink-0" />}
                  </div>
                  {s.description && (
                    <p className="text-xs text-text-muted mt-1 line-clamp-2">{s.description}</p>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Scenario B picker */}
          <div className="flex-1 flex flex-col">
            <div className="px-4 py-2 bg-surface-800/50 border-b border-surface-700">
              <span className="text-xs font-medium text-text-secondary">{t.comparison.scenarioB}</span>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {scenarios.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setPickB(s.id)}
                  disabled={s.id === pickA}
                  className={`w-full text-left px-4 py-3 rounded-xl border transition-colors ${
                    s.id === pickB
                      ? 'border-ocean-500 bg-ocean-500/10'
                      : s.id === pickA
                        ? 'border-surface-700 bg-surface-800/50 opacity-40 cursor-not-allowed'
                        : 'border-surface-700 bg-surface-800 hover:border-surface-600 hover:bg-surface-800/80'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className={`text-sm truncate mr-2 ${s.id === pickB ? 'text-ocean-400 font-medium' : 'text-text-primary'}`}>
                      {s.name}
                    </span>
                    {s.id === pickB && <Check className="w-4 h-4 text-ocean-400 shrink-0" />}
                  </div>
                  {s.description && (
                    <p className="text-xs text-text-muted mt-1 line-clamp-2">{s.description}</p>
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (loading && !comparison) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-3.5rem)]">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-ocean-400 border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-text-secondary">{t.comparison.loading}</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-3.5rem)]">
        <div className="text-center">
          <h2 className="text-lg font-semibold text-text-primary mb-2">{t.comparison.error}</h2>
          <p className="text-sm text-text-secondary mb-4">{error}</p>
          <Button variant="secondary" onClick={() => navigate(-1)}>
            <ArrowLeft className="w-4 h-4" />
            {t.comparison.goBack}
          </Button>
        </div>
      </div>
    )
  }

  if (!comparison) return null

  const divergentSet = new Set(comparison.divergent_nodes)
  const convergentSet = new Set(comparison.convergent_nodes)

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)]">
      {/* Header toolbar */}
      <div className="flex items-center gap-3 px-4 py-2.5 bg-surface-800 border-b border-surface-700 shrink-0">
        <button
          onClick={() => navigate(-1)}
          className="p-1.5 rounded-lg hover:bg-surface-700 text-text-muted hover:text-text-primary transition-colors"
          aria-label="Go back"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>

        <h2 className="text-sm font-semibold text-text-primary">
          {t.comparison.title}
        </h2>

        <div className="flex-1" />

        {/* Stats */}
        <div className="flex items-center gap-3 text-xs">
          <span className="text-confidence-low">
            {comparison.divergent_nodes.length} {t.comparison.divergent}
          </span>
          <span className="text-confidence-high">
            {comparison.convergent_nodes.length} {t.comparison.convergent}
          </span>
        </div>

        {/* View mode toggle */}
        <button
          onClick={() => setViewMode(viewMode === 'side-by-side' ? 'overlay' : 'side-by-side')}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary bg-surface-700 hover:bg-surface-600 rounded-lg border border-surface-600 transition-colors"
        >
          <Layers className="w-3.5 h-3.5" />
          {viewMode === 'side-by-side' ? t.comparison.overlay : t.comparison.sideBySide}
        </button>
      </div>

      {/* Main content */}
      {viewMode === 'side-by-side' ? (
        <div className="flex flex-1 min-h-0">
          {/* Scenario A */}
          <div className="flex-1 border-r border-surface-700 flex flex-col">
            <div className="px-3 py-1.5 bg-surface-800/50 border-b border-surface-700">
              <span className="text-xs font-medium text-text-secondary">{t.comparison.scenarioA}</span>
            </div>
            <div className="flex-1 min-h-0 relative">
              <ComparisonTree
                graph={comparison.scenario_a}
                divergentNodes={divergentSet}
                convergentNodes={convergentSet}
                onNodeClick={handleNodeClick}
                onEdgeClick={handleEdgeClick}
                onEdgeStrengthChange={handleEdgeStrengthChange}
                filters={defaultFilters}
              />
            </div>
          </div>

          {/* Scenario B */}
          <div className="flex-1 flex flex-col">
            <div className="px-3 py-1.5 bg-surface-800/50 border-b border-surface-700">
              <span className="text-xs font-medium text-text-secondary">{t.comparison.scenarioB}</span>
            </div>
            <div className="flex-1 min-h-0 relative">
              <ComparisonTree
                graph={comparison.scenario_b}
                divergentNodes={divergentSet}
                convergentNodes={convergentSet}
                onNodeClick={handleNodeClick}
                onEdgeClick={handleEdgeClick}
                onEdgeStrengthChange={handleEdgeStrengthChange}
                filters={defaultFilters}
              />
            </div>
          </div>
        </div>
      ) : (
        <div className="flex-1 min-h-0">
          <MergeOverlay comparison={comparison} />
        </div>
      )}

      {/* Comparison details table */}
      <div className="border-t border-surface-700 bg-surface-800 max-h-48 overflow-y-auto">
        <div className="px-4 py-2">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-text-muted border-b border-surface-700">
                <th className="text-left py-1.5 pr-4">{t.comparison.node}</th>
                <th className="text-left py-1.5 pr-4">{t.comparison.status}</th>
                <th className="text-left py-1.5">{t.comparison.detail}</th>
              </tr>
            </thead>
            <tbody>
              {comparison.divergent_nodes.map((nodeId) => {
                const nodeA = comparison.scenario_a.nodes.find((n) => n.id === nodeId)
                const nodeB = comparison.scenario_b.nodes.find((n) => n.id === nodeId)
                return (
                  <tr key={nodeId} className="border-b border-surface-700/50">
                    <td className="py-1.5 pr-4 text-text-primary truncate max-w-[200px]">
                      {nodeA?.text ?? nodeB?.text ?? nodeId}
                    </td>
                    <td className="py-1.5 pr-4">
                      <span className="text-confidence-low">{t.comparison.divergentLabel}</span>
                    </td>
                    <td className="py-1.5 text-text-muted">
                      A: {nodeA?.confidence.toFixed(2) ?? 'N/A'} |
                      B: {nodeB?.confidence.toFixed(2) ?? 'N/A'}
                    </td>
                  </tr>
                )
              })}
              {comparison.convergent_nodes.slice(0, 10).map((nodeId) => {
                const nodeA = comparison.scenario_a.nodes.find((n) => n.id === nodeId)
                return (
                  <tr key={nodeId} className="border-b border-surface-700/50">
                    <td className="py-1.5 pr-4 text-text-primary truncate max-w-[200px]">
                      {nodeA?.text ?? nodeId}
                    </td>
                    <td className="py-1.5 pr-4">
                      <span className="text-confidence-high">{t.comparison.convergentLabel}</span>
                    </td>
                    <td className="py-1.5 text-text-muted">
                      {t.comparison.beliefsAlign}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// --- Comparison Tree wrapper that highlights divergent/convergent nodes ---

function ComparisonTree({
  graph,
  divergentNodes: _divergentNodes,
  convergentNodes: _convergentNodes,
  onNodeClick,
  onEdgeClick,
  onEdgeStrengthChange,
  filters,
}: {
  graph: CausalGraph
  divergentNodes: Set<string>
  convergentNodes: Set<string>
  onNodeClick: (nodeId: string) => void
  onEdgeClick: (edgeId: string) => void
  onEdgeStrengthChange: (edgeId: string, strength: number) => void
  filters: { depthLimit: number | null; searchQuery: string }
}) {
  return (
    <ForceGraph
      graph={graph}
      onNodeClick={onNodeClick}
      onEdgeClick={onEdgeClick}
      onEdgeStrengthChange={onEdgeStrengthChange}
      filters={filters}
    />
  )
}
