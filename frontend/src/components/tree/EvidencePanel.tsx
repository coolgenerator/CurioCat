import { useState } from 'react'
import { X, ExternalLink, ArrowRight, ArrowLeft, Loader2, Shield, AlertTriangle, Clock, ChevronDown, ChevronUp, RefreshCw } from 'lucide-react'
import type { CausalGraph, Evidence } from '../../types/graph.ts'
import { useT } from '../../i18n/index.tsx'
import { CAUSAL_TYPE_META, CONDITION_TYPE_LABELS, BIAS_SEVERITY_COLORS, SOURCE_TIER_LABELS } from '../../lib/visualConstants.ts'
import Slider from '../ui/Slider.tsx'
import Progress from '../ui/Progress.tsx'

interface EvidencePanelProps {
  graph: CausalGraph
  edgeId: string
  onClose: () => void
  onBack?: () => void
  onStrengthChange: (edgeId: string, strength: number) => void
  onChallenge?: (edgeId: string, reasoning?: string) => void
  operationLoading?: string | null
}

export default function EvidencePanel({
  graph,
  edgeId,
  onClose,
  onBack,
  onStrengthChange,
  onChallenge,
  operationLoading,
}: EvidencePanelProps) {
  const { t } = useT()
  const [showChallenge, setShowChallenge] = useState(false)
  const [reasoning, setReasoning] = useState('')
  const edge = graph.edges.find((e) => e.id === edgeId)
  if (!edge) return null

  const sourceNode = graph.nodes.find((n) => n.id === edge.sourceId)
  const targetNode = graph.nodes.find((n) => n.id === edge.targetId)

  const supporting = edge.evidences.filter((e) => e.evidenceType === 'supporting')
  const contradicting = edge.evidences.filter((e) => e.evidenceType === 'contradicting')

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
          <h3 className="text-sm font-semibold text-text-primary">{t.evidence.title}</h3>
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

        {/* Feedback edge notice */}
        {edge.isFeedback && (
          <div className="flex items-start gap-1.5 px-3 py-2 rounded-lg bg-purple-500/10 border border-purple-500/20">
            <RefreshCw className="w-3.5 h-3.5 text-purple-400 mt-0.5 shrink-0" />
            <span className="text-xs text-purple-300">
              This edge forms a feedback loop and is excluded from belief propagation, but represents a real causal relationship.
            </span>
          </div>
        )}

        {/* Causal type + condition type */}
        <div>
          <label className="text-xs font-medium text-text-muted block mb-1.5">
            {t.causalTypes?.sectionTitle ?? 'Causal Type'}
          </label>
          {(() => {
            const ct = (edge.causalType ?? 'direct') as keyof typeof CAUSAL_TYPE_META
            const meta = CAUSAL_TYPE_META[ct]
            return (
              <div className="bg-surface-700/50 rounded-lg p-2.5">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-base">{meta?.icon}</span>
                  <span className="text-xs font-medium text-text-primary">{meta?.label ?? ct}</span>
                </div>
                <p className="text-[10px] text-text-muted leading-relaxed">{meta?.description}</p>
              </div>
            )
          })()}
          {edge.conditionType && (
            <div className="mt-1.5">
              <span className="text-[10px] text-text-muted">
                {t.causalTypes?.conditionType ?? 'Condition Type'}:{' '}
              </span>
              <span className="text-[10px] text-text-secondary">
                {CONDITION_TYPE_LABELS[(edge.conditionType ?? 'contributing') as keyof typeof CONDITION_TYPE_LABELS]}
              </span>
            </div>
          )}
        </div>

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
            <ul className="space-y-1">
              {edge.conditions.map((cond, i) => (
                <li key={i} className="text-xs text-text-secondary flex items-start gap-1.5">
                  <span className="text-text-muted mt-px">&bull;</span>
                  {cond}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Strength slider */}
        <Slider
          label={t.evidence.strength}
          value={edge.strength}
          min={0}
          max={1}
          step={0.05}
          onChange={(val) => onStrengthChange(edgeId, val)}
        />

        {/* Evidence score */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs font-medium text-text-muted">{t.evidence.evidenceScore}</label>
            <span className="text-xs text-text-secondary tabular-nums">
              {edge.evidenceScore.toFixed(2)}
            </span>
          </div>
          <Progress value={edge.evidenceScore * 100} />
        </div>

        {/* Temporal properties */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-text-muted flex items-center gap-1">
            <Clock className="w-3 h-3" />
            Temporal
          </label>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[10px]">
            {edge.timeDelay && (
              <>
                <span className="text-text-muted">{t.evidence.delay}</span>
                <span className="text-text-secondary">{edge.timeDelay}</span>
              </>
            )}
            {edge.temporalWindow && (
              <>
                <span className="text-text-muted">{t.causalTypes?.temporalWindow ?? 'Window'}</span>
                <span className="text-text-secondary">{edge.temporalWindow}</span>
              </>
            )}
            {edge.decayType && edge.decayType !== 'none' && (
              <>
                <span className="text-text-muted">{t.causalTypes?.decayType ?? 'Decay'}</span>
                <span className="text-text-secondary capitalize">{edge.decayType}</span>
              </>
            )}
            <span className="text-text-muted">{edge.reversible ? t.evidence.reversible : t.evidence.irreversible}</span>
          </div>
        </div>

        {/* Consensus indicator */}
        {edge.consensusLevel && edge.consensusLevel !== 'insufficient' && (
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-medium text-text-muted">{t.causalTypes?.consensus ?? 'Consensus'}</label>
              <span className={`text-[10px] font-medium ${
                edge.consensusLevel.includes('support') ? 'text-confidence-high'
                : edge.consensusLevel.includes('opposition') ? 'text-confidence-low'
                : 'text-confidence-medium'
              }`}>
                {(() => {
                  const key = edge.consensusLevel.replace(/_/g, '') as string
                  const map: Record<string, string> = {
                    strongsupport: t.causalTypes?.strongSupport ?? 'Strong Support',
                    moderatesupport: t.causalTypes?.moderateSupport ?? 'Moderate Support',
                    contested: t.causalTypes?.contested ?? 'Contested',
                    moderateopposition: t.causalTypes?.moderateOpposition ?? 'Moderate Opposition',
                    strongopposition: t.causalTypes?.strongOpposition ?? 'Strong Opposition',
                  }
                  return map[key] ?? edge.consensusLevel.replace(/_/g, ' ')
                })()}
              </span>
            </div>
            <div className="w-full h-1.5 bg-surface-700 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${
                  edge.consensusLevel.includes('support') ? 'bg-confidence-high'
                  : edge.consensusLevel.includes('opposition') ? 'bg-confidence-low'
                  : 'bg-confidence-medium'
                }`}
                style={{
                  width: `${
                    edge.consensusLevel === 'strong_support' ? 90
                    : edge.consensusLevel === 'moderate_support' ? 70
                    : edge.consensusLevel === 'contested' ? 50
                    : edge.consensusLevel === 'moderate_opposition' ? 30
                    : 10
                  }%`,
                }}
              />
            </div>
          </div>
        )}

        {/* Bias warnings */}
        {edge.biasWarnings && edge.biasWarnings.length > 0 && (
          <div>
            <label className="text-xs font-medium text-text-muted flex items-center gap-1 mb-1.5">
              <AlertTriangle className="w-3 h-3" />
              {t.causalTypes?.biasWarnings ?? 'Bias Warnings'}
            </label>
            <div className="space-y-1.5">
              {edge.biasWarnings.map((b, i) => (
                <div
                  key={i}
                  className="border-l-2 bg-surface-700/50 rounded-r-lg p-2 text-[10px]"
                  style={{ borderColor: BIAS_SEVERITY_COLORS[b.severity] ?? '#f59e0b' }}
                >
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <span className="font-medium text-text-primary">{b.type.replace(/_/g, ' ')}</span>
                    <span className="text-text-muted">({b.severity})</span>
                  </div>
                  <p className="text-text-secondary leading-relaxed">{b.explanation}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Supporting evidence */}
        {supporting.length > 0 && (
          <div>
            <label className="text-xs font-medium text-text-muted block mb-2">
              {t.evidence.supporting} ({supporting.length})
            </label>
            <div className="space-y-2">
              {supporting.map((ev) => (
                <EvidenceCard key={ev.id} evidence={ev} variant="supporting" />
              ))}
            </div>
          </div>
        )}

        {/* Contradicting evidence */}
        {contradicting.length > 0 && (
          <div>
            <label className="text-xs font-medium text-text-muted block mb-2">
              {t.evidence.contradicting} ({contradicting.length})
            </label>
            <div className="space-y-2">
              {contradicting.map((ev) => (
                <EvidenceCard key={ev.id} evidence={ev} variant="contradicting" />
              ))}
            </div>
          </div>
        )}

        {/* No evidence */}
        {edge.evidences.length === 0 && (
          <div className="text-center py-4">
            <p className="text-xs text-text-muted">{t.evidence.noEvidence}</p>
          </div>
        )}

        {/* Challenge section */}
        {onChallenge && (
          <div className="pt-2 border-t border-surface-700 space-y-2">
            {!showChallenge ? (
              <button
                onClick={() => setShowChallenge(true)}
                disabled={operationLoading === 'challenge'}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 text-xs rounded-lg bg-surface-700 hover:bg-surface-600 text-text-secondary hover:text-text-primary border border-surface-600 transition-colors disabled:opacity-50"
              >
                {operationLoading === 'challenge' ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Shield className="w-3.5 h-3.5" />
                )}
                {operationLoading === 'challenge' ? t.operations.challenging : t.operations.challenge}
              </button>
            ) : (
              <>
                <textarea
                  value={reasoning}
                  onChange={(e) => setReasoning(e.target.value)}
                  placeholder={t.operations?.edgeReasoningPlaceholder ?? 'Why do you doubt this relationship?'}
                  rows={2}
                  autoFocus
                  className="w-full px-3 py-2 text-xs bg-surface-700 border border-surface-600 rounded-lg text-text-primary placeholder-text-muted focus:outline-none focus:border-ocean-500 transition-colors resize-none"
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => { onChallenge(edgeId, reasoning || undefined); setReasoning(''); setShowChallenge(false) }}
                    disabled={operationLoading === 'challenge'}
                    className="flex-1 flex items-center justify-center gap-2 px-3 py-1.5 text-xs rounded-lg bg-ocean-500/15 hover:bg-ocean-500/25 text-ocean-400 border border-ocean-500/30 transition-colors disabled:opacity-50"
                  >
                    {operationLoading === 'challenge' ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Shield className="w-3.5 h-3.5" />
                    )}
                    {t.operations.challenge}
                  </button>
                  <button
                    onClick={() => { setShowChallenge(false); setReasoning('') }}
                    className="px-3 py-1.5 text-xs rounded-lg bg-surface-700 hover:bg-surface-600 text-text-muted hover:text-text-primary border border-surface-600 transition-colors"
                  >
                    {t.operations?.cancel ?? 'Cancel'}
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// --- Expandable text block ---

export function ExpandableText({
  label,
  text,
  showMoreLabel,
  showLessLabel,
}: {
  label: string
  text: string
  showMoreLabel: string
  showLessLabel: string
}) {
  const [expanded, setExpanded] = useState(false)
  const isLong = text.length > 150

  return (
    <div>
      <label className="text-xs font-medium text-text-muted block mb-1">{label}</label>
      <p className={`text-sm text-text-primary leading-relaxed ${expanded ? '' : 'line-clamp-3'}`}>
        {text}
      </p>
      {isLong && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-0.5 text-[10px] text-ocean-400 hover:text-ocean-300 transition-colors mt-1"
        >
          {expanded ? (
            <><ChevronUp className="w-3 h-3" />{showLessLabel}</>
          ) : (
            <><ChevronDown className="w-3 h-3" />{showMoreLabel}</>
          )}
        </button>
      )}
    </div>
  )
}

// --- Expandable claim pair ---

export function ExpandableClaimPair({
  sourceText,
  targetText,
  showMoreLabel,
  showLessLabel,
}: {
  sourceText: string
  targetText: string
  showMoreLabel: string
  showLessLabel: string
}) {
  const [expanded, setExpanded] = useState(false)
  const isLong = sourceText.length > 80 || targetText.length > 80

  return (
    <div className="bg-surface-700/50 rounded-lg p-3">
      <p className={`text-xs text-text-secondary mb-2 ${expanded ? '' : 'line-clamp-2'}`}>
        {sourceText}
      </p>
      <div className="flex items-center justify-center py-1">
        <ArrowRight className="w-4 h-4 text-ocean-400" />
      </div>
      <p className={`text-xs text-text-secondary mt-2 ${expanded ? '' : 'line-clamp-2'}`}>
        {targetText}
      </p>
      {isLong && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-0.5 text-[10px] text-ocean-400 hover:text-ocean-300 transition-colors mt-2"
        >
          {expanded ? (
            <><ChevronUp className="w-3 h-3" />{showLessLabel}</>
          ) : (
            <><ChevronDown className="w-3 h-3" />{showMoreLabel}</>
          )}
        </button>
      )}
    </div>
  )
}

// --- Evidence card sub-component ---

export function EvidenceCard({
  evidence,
  variant,
}: {
  evidence: Evidence
  variant: 'supporting' | 'contradicting'
}) {
  const { t } = useT()
  const [expanded, setExpanded] = useState(false)
  const borderColor = variant === 'supporting'
    ? 'border-l-evidence-supporting'
    : 'border-l-evidence-contested'

  const sourceTypeColors: Record<string, string> = {
    academic: 'bg-deep-400/15 text-deep-300 border-deep-400/30',
    news: 'bg-ocean-500/15 text-ocean-400 border-ocean-500/30',
    government: 'bg-confidence-high/15 text-confidence-high border-confidence-high/30',
  }

  const typeStyle = sourceTypeColors[evidence.sourceType] ??
    'bg-surface-600/40 text-text-muted border-surface-500/30'

  // Show expand toggle if snippet is likely longer than 3 lines (~120 chars)
  const isLong = evidence.snippet.length > 120

  return (
    <div className={`border-l-2 ${borderColor} bg-surface-700/50 rounded-r-lg p-3`}>
      {/* Source title */}
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <a
          href={evidence.sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs font-medium text-ocean-400 hover:text-ocean-300 transition-colors line-clamp-1 flex items-center gap-1"
        >
          {evidence.sourceTitle}
          <ExternalLink className="w-3 h-3 shrink-0" />
        </a>
      </div>

      {/* Source type badge + tier */}
      <div className="flex items-center gap-1.5 mb-1.5">
        <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border ${typeStyle}`}>
          {evidence.sourceType}
        </span>
        {evidence.sourceTier != null && evidence.sourceTier > 0 && (
          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border bg-surface-600/40 text-text-muted border-surface-500/30">
            T{evidence.sourceTier}: {SOURCE_TIER_LABELS[evidence.sourceTier] ?? ''}
          </span>
        )}
      </div>

      {/* Snippet with expand/collapse */}
      <p className={`text-xs text-text-secondary leading-relaxed mb-1 ${expanded ? '' : 'line-clamp-3'}`}>
        {evidence.snippet}
      </p>
      {isLong && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-0.5 text-[10px] text-ocean-400 hover:text-ocean-300 transition-colors mb-2"
        >
          {expanded ? (
            <>
              <ChevronUp className="w-3 h-3" />
              {t.evidence.showLess}
            </>
          ) : (
            <>
              <ChevronDown className="w-3 h-3" />
              {t.evidence.showMore}
            </>
          )}
        </button>
      )}
      {!isLong && <div className="mb-2" />}

      {/* Scores */}
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <div className="flex items-center justify-between mb-0.5">
            <span className="text-[10px] text-text-muted">{t.evidence.relevance}</span>
            <span className="text-[10px] text-text-muted tabular-nums">
              {(evidence.relevanceScore * 100).toFixed(0)}%
            </span>
          </div>
          <Progress value={evidence.relevanceScore * 100} size="sm" />
        </div>
        <div className="flex-1">
          <div className="flex items-center justify-between mb-0.5">
            <span className="text-[10px] text-text-muted">{t.evidence.credibility}</span>
            <span className="text-[10px] text-text-muted tabular-nums">
              {(evidence.credibilityScore * 100).toFixed(0)}%
            </span>
          </div>
          <Progress value={evidence.credibilityScore * 100} size="sm" />
        </div>
      </div>
    </div>
  )
}
