import { useState, useCallback, useMemo } from 'react'
import { X, Loader2, AlertTriangle, CheckCircle2, XCircle, SkipForward, Zap, Search, ArrowRight, ArrowLeft } from 'lucide-react'
import { useT } from '../../i18n/index.tsx'
import type { CausalGraph } from '../../types/graph.ts'
import type { ApiAutoExploreResult, ApiWeaknessReport } from '../../types/api.ts'

interface AutoExplorePanelProps {
  graph: CausalGraph
  onClose: () => void
  onAutoExplore: (maxNewNodes: number) => Promise<ApiAutoExploreResult | null>
  operationLoading: string | null
}

const WEAKNESS_ICONS: Record<string, typeof AlertTriangle> = {
  weak_edge: AlertTriangle,
  leaf_node: ArrowRight,
  low_confidence_root: ArrowLeft,
  high_sensitivity_weak_evidence: Zap,
}

const ACTION_COLORS: Record<string, string> = {
  challenge: 'text-amber-400',
  expand: 'text-emerald-400',
  trace_back: 'text-blue-400',
  skipped: 'text-text-muted',
  failed: 'text-red-400',
}

export default function AutoExplorePanel({
  graph,
  onClose,
  onAutoExplore,
  operationLoading,
}: AutoExplorePanelProps) {
  const { t } = useT()
  const [maxNodes, setMaxNodes] = useState(10)
  const [result, setResult] = useState<ApiAutoExploreResult | null>(null)

  const isLoading = operationLoading === 'auto-explore'

  // Compute graph health metrics
  const health = useMemo(() => {
    const { nodes, edges } = graph
    const totalEdges = edges.length
    const weakEdges = edges.filter(e => e.evidenceScore < 0.3).length
    const avgEvidence = totalEdges > 0
      ? edges.reduce((sum, e) => sum + e.evidenceScore, 0) / totalEdges
      : 0

    const nodeInDegree = new Map<string, number>()
    const nodeOutDegree = new Map<string, number>()
    for (const n of nodes) {
      nodeInDegree.set(n.id, 0)
      nodeOutDegree.set(n.id, 0)
    }
    for (const e of edges) {
      nodeInDegree.set(e.targetId, (nodeInDegree.get(e.targetId) ?? 0) + 1)
      nodeOutDegree.set(e.sourceId, (nodeOutDegree.get(e.sourceId) ?? 0) + 1)
    }

    const leafNodes = nodes.filter(n =>
      (nodeOutDegree.get(n.id) ?? 0) === 0 && (nodeInDegree.get(n.id) ?? 0) > 0
    ).length
    const rootNodes = nodes.filter(n =>
      (nodeInDegree.get(n.id) ?? 0) === 0 && (nodeOutDegree.get(n.id) ?? 0) > 0
    ).length

    return { avgEvidence, weakEdges, totalEdges, leafNodes, rootNodes }
  }, [graph])

  const handleExplore = useCallback(async () => {
    const res = await onAutoExplore(maxNodes)
    if (res) setResult(res)
  }, [maxNodes, onAutoExplore])

  const weaknessLabel = (type: string): string => {
    const labels = t.autoExplore?.weaknessTypes as Record<string, string> | undefined
    return labels?.[type] ?? type.replace(/_/g, ' ')
  }

  const actionLabel = (action: string): string => {
    const labels = t.autoExplore?.actions as Record<string, string> | undefined
    return labels?.[action] ?? action
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-surface-700">
        <h3 className="text-sm font-semibold text-text-primary">
          {t.autoExplore?.title ?? 'Auto Explore'}
        </h3>
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-surface-700 text-text-muted hover:text-text-primary transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Description */}
        <p className="text-xs text-text-muted">
          {t.autoExplore?.description ?? 'Automatically identify and strengthen weak areas of the graph.'}
        </p>

        {/* Graph Health */}
        <div className="space-y-2">
          <h4 className="text-xs font-medium text-text-secondary">
            {t.autoExplore?.healthTitle ?? 'Graph Health'}
          </h4>
          <div className="grid grid-cols-2 gap-2">
            <HealthMetric
              label={t.autoExplore?.avgEvidence ?? 'Avg evidence'}
              value={`${(health.avgEvidence * 100).toFixed(0)}%`}
              color={health.avgEvidence > 0.5 ? 'text-emerald-400' : health.avgEvidence > 0.3 ? 'text-amber-400' : 'text-red-400'}
            />
            <HealthMetric
              label={t.autoExplore?.weakEdges ?? 'Weak edges'}
              value={`${health.weakEdges}/${health.totalEdges}`}
              color={health.weakEdges === 0 ? 'text-emerald-400' : 'text-amber-400'}
            />
            <HealthMetric
              label={t.autoExplore?.leafNodes ?? 'Leaf nodes'}
              value={String(health.leafNodes)}
              color={health.leafNodes === 0 ? 'text-emerald-400' : 'text-text-secondary'}
            />
            <HealthMetric
              label={t.autoExplore?.rootNodes ?? 'Root nodes'}
              value={String(health.rootNodes)}
              color="text-text-secondary"
            />
          </div>
        </div>

        {/* Max nodes slider */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label className="text-xs text-text-secondary">
              {t.autoExplore?.maxNodes ?? 'Max new nodes'}
            </label>
            <span className="text-xs text-text-primary tabular-nums">{maxNodes}</span>
          </div>
          <input
            type="range"
            min={1}
            max={30}
            value={maxNodes}
            onChange={(e) => setMaxNodes(Number(e.target.value))}
            className="w-full h-1.5 bg-surface-600 rounded-full appearance-none cursor-pointer accent-ocean-500"
            disabled={isLoading}
          />
        </div>

        {/* Explore button */}
        <button
          onClick={handleExplore}
          disabled={isLoading}
          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium bg-ocean-600 hover:bg-ocean-500 disabled:bg-surface-700 disabled:text-text-muted text-white rounded-lg transition-colors"
        >
          {isLoading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              {t.autoExplore?.exploring ?? 'Exploring...'}
            </>
          ) : (
            <>
              <Search className="w-4 h-4" />
              {t.autoExplore?.explore ?? 'Explore'}
            </>
          )}
        </button>

        {/* Results */}
        {result && (
          <div className="space-y-3 pt-2 border-t border-surface-700">
            {result.convergence_reached && (
              <div className="flex items-center gap-2 px-3 py-2 bg-emerald-500/10 border border-emerald-500/20 rounded-lg">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <span className="text-xs text-emerald-300">
                  {t.autoExplore?.convergenceReached ?? 'Graph has converged.'}
                </span>
              </div>
            )}

            {result.weaknesses_found.map((w, i) => (
              <WeaknessReportCard key={i} report={w} weaknessLabel={weaknessLabel} actionLabel={actionLabel} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function HealthMetric({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="flex items-center justify-between px-3 py-2 bg-surface-800 rounded-lg">
      <span className="text-xs text-text-muted">{label}</span>
      <span className={`text-xs font-medium tabular-nums ${color}`}>{value}</span>
    </div>
  )
}

function WeaknessReportCard({
  report,
  weaknessLabel,
  actionLabel,
}: {
  report: ApiWeaknessReport
  weaknessLabel: (type: string) => string
  actionLabel: (action: string) => string
}) {
  const Icon = WEAKNESS_ICONS[report.weakness_type] ?? AlertTriangle
  const actionColor = ACTION_COLORS[report.action_taken] ?? 'text-text-muted'

  const ActionIcon = report.action_taken === 'failed' ? XCircle
    : report.action_taken === 'skipped' ? SkipForward
    : CheckCircle2

  return (
    <div className="px-3 py-2.5 bg-surface-800 rounded-lg space-y-1.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon className="w-3.5 h-3.5 text-text-muted" />
          <span className="text-xs font-medium text-text-primary">
            {weaknessLabel(report.weakness_type)}
          </span>
        </div>
        <div className={`flex items-center gap-1 ${actionColor}`}>
          <ActionIcon className="w-3 h-3" />
          <span className="text-xs">{actionLabel(report.action_taken)}</span>
        </div>
      </div>
      {report.result_summary && (
        <p className="text-xs text-text-muted pl-5.5">
          {report.result_summary}
        </p>
      )}
    </div>
  )
}
