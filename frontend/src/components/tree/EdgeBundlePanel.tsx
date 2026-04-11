import { useState } from 'react'
import { X, ArrowLeft, ChevronDown, ChevronUp, ExternalLink, Clock, AlertTriangle, RefreshCw } from 'lucide-react'
import type { CausalGraph, CausalEdge } from '../../types/graph.ts'
import { useT } from '../../i18n/index.tsx'
import { CAUSAL_TYPE_META } from '../../lib/visualConstants.ts'
import { ExpandableClaimPair, ExpandableText } from './EvidencePanel.tsx'
import Progress from '../ui/Progress.tsx'

interface EdgeBundlePanelProps {
  graph: CausalGraph
  edgeIds: string[]
  onClose: () => void
  onBack?: () => void
  onStrengthChange: (edgeId: string, strength: number) => void
  onChallenge?: (edgeId: string, reasoning?: string) => void
  onSelectSingleEdge: (edgeId: string) => void
  operationLoading?: string | null
}

export default function EdgeBundlePanel({
  graph,
  edgeIds,
  onClose,
  onBack,
  onSelectSingleEdge,
}: EdgeBundlePanelProps) {
  const { t } = useT()
  const edges = edgeIds.map((id) => graph.edges.find((e) => e.id === id)).filter(Boolean) as CausalEdge[]
  if (edges.length === 0) return null

  const sourceNode = graph.nodes.find((n) => n.id === edges[0].sourceId)
  const targetNode = graph.nodes.find((n) => n.id === edges[0].targetId)

  const avgStrength = edges.reduce((s, e) => s + e.strength, 0) / edges.length
  const avgEvidence = edges.reduce((s, e) => s + e.evidenceScore, 0) / edges.length
  const causalTypes = [...new Set(edges.map((e) => e.causalType ?? 'direct'))]

  return (
    <div className="w-full bg-surface-800 border-l border-surface-700 h-full overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-surface-700">
        <div className="flex items-center gap-2">
          {onBack && (
            <button
              onClick={onBack}
              className="p-1 rounded-md hover:bg-surface-700 text-text-muted hover:text-text-primary transition-colors"
              aria-label={t.evidence.backToNode}
              title={t.evidence.backToNode}
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
          )}
          <h3 className="text-sm font-semibold text-text-primary">
            {t.bundledEdge?.title ?? 'Causal Links'} ({edges.length})
          </h3>
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded-md hover:bg-surface-700 text-text-muted hover:text-text-primary transition-colors"
          aria-label="Close panel"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="p-4 space-y-5">
        {/* Source -> Target */}
        <ExpandableClaimPair
          sourceText={sourceNode?.text ?? 'Unknown'}
          targetText={targetNode?.text ?? 'Unknown'}
          showMoreLabel={t.evidence.showMore}
          showLessLabel={t.evidence.showLess}
        />

        {/* Aggregate stats */}
        <div className="space-y-3">
          {/* Causal type badges */}
          <div className="flex flex-wrap gap-1.5">
            {causalTypes.map((ct) => {
              const meta = CAUSAL_TYPE_META[ct as keyof typeof CAUSAL_TYPE_META]
              return (
                <span key={ct} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-surface-700 text-[10px] text-text-secondary border border-surface-600">
                  {meta?.icon} {meta?.label ?? ct}
                </span>
              )
            })}
          </div>

          {/* Avg strength */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-medium text-text-muted">{t.bundledEdge?.avgStrength ?? 'Avg Strength'}</label>
              <span className="text-xs text-text-secondary tabular-nums">{(avgStrength * 100).toFixed(0)}%</span>
            </div>
            <Progress value={avgStrength * 100} />
          </div>

          {/* Avg evidence */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-medium text-text-muted">{t.bundledEdge?.avgEvidence ?? 'Avg Evidence'}</label>
              <span className="text-xs text-text-secondary tabular-nums">{(avgEvidence * 100).toFixed(0)}%</span>
            </div>
            <Progress value={avgEvidence * 100} />
          </div>
        </div>

        {/* Edge cards */}
        <div className="space-y-2">
          {edges.map((edge) => (
            <EdgeCard
              key={edge.id}
              edge={edge}
              onViewDetail={() => onSelectSingleEdge(edge.id)}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

// --- Collapsible edge card ---

function EdgeCard({
  edge,
  onViewDetail,
}: {
  edge: CausalEdge
  onViewDetail: () => void
}) {
  const { t } = useT()
  const [expanded, setExpanded] = useState(false)
  const ct = (edge.causalType ?? 'direct') as keyof typeof CAUSAL_TYPE_META
  const meta = CAUSAL_TYPE_META[ct]
  const biasCount = (edge.biasWarnings ?? []).length

  return (
    <div className="bg-surface-700/50 rounded-lg border border-surface-600 overflow-hidden">
      {/* Collapsed header — always visible */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-surface-700/80 transition-colors"
      >
        <span className="text-sm shrink-0">{meta?.icon}</span>
        {edge.isFeedback && (
          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-purple-500/15 text-[9px] text-purple-400 border border-purple-500/20 shrink-0">
            <RefreshCw className="w-2.5 h-2.5" /> Feedback
          </span>
        )}
        <span className="text-xs text-text-primary truncate flex-1">
          {edge.mechanism || meta?.label || ct}
        </span>
        <span className="text-[10px] text-text-muted tabular-nums shrink-0">
          {(edge.strength * 100).toFixed(0)}%
        </span>
        <span className="text-surface-500 shrink-0">|</span>
        <span className="text-[10px] text-text-muted tabular-nums shrink-0">
          {(edge.evidenceScore * 100).toFixed(0)}%
        </span>
        {expanded ? <ChevronUp className="w-3 h-3 text-text-muted shrink-0" /> : <ChevronDown className="w-3 h-3 text-text-muted shrink-0" />}
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div className="px-3 pb-3 space-y-3 border-t border-surface-600 pt-3">
          {/* Feedback edge notice */}
          {edge.isFeedback && (
            <div className="flex items-start gap-1.5 px-2 py-1.5 rounded-md bg-purple-500/10 border border-purple-500/20">
              <RefreshCw className="w-3 h-3 text-purple-400 mt-0.5 shrink-0" />
              <span className="text-[10px] text-purple-300">
                {t.bundledEdge?.feedbackNotice ?? 'This edge forms a feedback loop and is excluded from belief propagation, but represents a real causal relationship.'}
              </span>
            </div>
          )}

          {/* Mechanism */}
          {edge.mechanism && (
            <ExpandableText
              label={t.evidence.mechanism}
              text={edge.mechanism}
              showMoreLabel={t.evidence.showMore}
              showLessLabel={t.evidence.showLess}
            />
          )}

          {/* Conditions */}
          {edge.conditions && edge.conditions.length > 0 && (
            <div>
              <label className="text-xs font-medium text-text-muted block mb-1">{t.evidence.conditions}</label>
              <ul className="space-y-0.5">
                {edge.conditions.map((cond, i) => (
                  <li key={i} className="text-xs text-text-secondary flex items-start gap-1.5">
                    <span className="text-text-muted mt-px">&bull;</span>
                    {cond}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Temporal */}
          {edge.timeDelay && (
            <div className="flex items-center gap-1 text-[10px] text-text-muted">
              <Clock className="w-3 h-3" />
              <span>{t.evidence.delay}: {edge.timeDelay}</span>
            </div>
          )}

          {/* Bias warnings count */}
          {biasCount > 0 && (
            <div className="flex items-center gap-1 text-[10px] text-amber-400">
              <AlertTriangle className="w-3 h-3" />
              <span>{biasCount} {t.causalTypes?.biasWarnings ?? 'bias warnings'}</span>
            </div>
          )}

          {/* Evidence summary */}
          {edge.evidences.length > 0 && (
            <div className="text-[10px] text-text-muted">
              {edge.evidences.filter((e) => e.evidenceType === 'supporting').length} supporting,{' '}
              {edge.evidences.filter((e) => e.evidenceType === 'contradicting').length} contradicting
            </div>
          )}

          {/* View details button */}
          <button
            onClick={(e) => { e.stopPropagation(); onViewDetail() }}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-ocean-500/10 hover:bg-ocean-500/20 text-ocean-400 border border-ocean-500/20 transition-colors"
          >
            <ExternalLink className="w-3 h-3" />
            {t.bundledEdge?.viewDetail ?? 'View Details'}
          </button>
        </div>
      )}
    </div>
  )
}
