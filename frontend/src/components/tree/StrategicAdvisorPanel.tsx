import { useState, useCallback, useEffect } from 'react'
import {
  X, Shield, Loader2, ChevronDown, ChevronRight, ArrowLeft,
  Sparkles, Tag,
  AlertTriangle, TrendingUp, ListChecks, Siren, Activity,
} from 'lucide-react'
import { useT } from '../../i18n/index.tsx'
import type { ApiAdviseResult, ApiPerspectiveSuggestion } from '../../types/api.ts'

interface Props {
  onClose: () => void
  onAdvise: (userContext: string, perspectiveTags: string[]) => Promise<ApiAdviseResult | null>
  onSuggestPerspectives: () => Promise<{ suggestions: ApiPerspectiveSuggestion[] } | null>
  operationLoading: string | null
}

type Severity = 'critical' | 'high' | 'medium' | 'low'

const SEVERITY_COLORS: Record<Severity, string> = {
  critical: 'bg-red-500/15 text-red-400 border-red-500/30',
  high: 'bg-orange-500/15 text-orange-400 border-orange-500/30',
  medium: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30',
  low: 'bg-green-500/15 text-green-400 border-green-500/30',
}

const PRIORITY_COLORS: Record<string, string> = {
  immediate: 'bg-red-500/15 text-red-400',
  'short-term': 'bg-orange-500/15 text-orange-400',
  'medium-term': 'bg-yellow-500/15 text-yellow-400',
  'long-term': 'bg-blue-500/15 text-blue-400',
}

const SIGNAL_COLORS: Record<string, string> = {
  leading: 'bg-emerald-500/15 text-emerald-400',
  coincident: 'bg-blue-500/15 text-blue-400',
  lagging: 'bg-purple-500/15 text-purple-400',
}

function SeverityBadge({ severity }: { severity: Severity }) {
  const { t } = useT()
  return (
    <span className={`inline-flex items-center px-2 py-0.5 text-[10px] font-medium rounded-full border ${SEVERITY_COLORS[severity]}`}>
      {t.advisor.severity[severity]}
    </span>
  )
}

function CollapsibleSection({
  title,
  icon: Icon,
  count,
  defaultOpen,
  children,
}: {
  title: string
  icon: React.ComponentType<{ className?: string }>
  count: number
  defaultOpen?: boolean
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen ?? false)
  return (
    <div className="border border-surface-600 rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-3 py-2 text-sm font-medium text-text-primary hover:bg-surface-700 transition-colors"
      >
        {open ? <ChevronDown className="w-3.5 h-3.5 text-text-muted shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 text-text-muted shrink-0" />}
        <Icon className="w-3.5 h-3.5 text-ocean-400 shrink-0" />
        <span className="flex-1 text-left">{title}</span>
        <span className="text-[10px] text-text-muted bg-surface-600 px-1.5 py-0.5 rounded-full">{count}</span>
      </button>
      {open && <div className="px-3 pb-3 space-y-2">{children}</div>}
    </div>
  )
}

export default function StrategicAdvisorPanel({ onClose, onAdvise, onSuggestPerspectives, operationLoading }: Props) {
  const { t } = useT()
  const [phase, setPhase] = useState<'input' | 'results'>('input')
  const [userContext, setUserContext] = useState('')
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set())
  const [result, setResult] = useState<ApiAdviseResult | null>(null)

  // Dynamic perspective suggestions
  const [suggestions, setSuggestions] = useState<ApiPerspectiveSuggestion[]>([])
  const [suggestionsLoading, setSuggestionsLoading] = useState(false)

  const isLoading = operationLoading === 'advise'

  // Auto-fetch suggestions when panel opens
  useEffect(() => {
    let cancelled = false
    async function fetchSuggestions() {
      setSuggestionsLoading(true)
      const res = await onSuggestPerspectives()
      if (!cancelled && res?.suggestions) {
        setSuggestions(res.suggestions)
      }
      if (!cancelled) setSuggestionsLoading(false)
    }
    void fetchSuggestions()
    return () => { cancelled = true }
  }, [onSuggestPerspectives])

  const toggleTag = useCallback((label: string) => {
    setSelectedTags(prev => {
      const next = new Set(prev)
      if (next.has(label)) next.delete(label)
      else next.add(label)
      return next
    })
  }, [])

  const handleAnalyze = useCallback(async () => {
    if (userContext.length < 10) return
    const res = await onAdvise(userContext, Array.from(selectedTags))
    if (res) {
      setResult(res)
      setPhase('results')
    }
  }, [userContext, selectedTags, onAdvise])

  const handleNewAnalysis = useCallback(() => {
    setPhase('input')
    setResult(null)
  }, [])

  // --- Input Phase ---
  if (phase === 'input') {
    return (
      <div className="flex flex-col h-full bg-surface-800">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-surface-700">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-ocean-400" />
            <h2 className="text-sm font-semibold text-text-primary">{t.advisor.title}</h2>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-surface-700 text-text-muted hover:text-text-primary transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Context textarea */}
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1.5">{t.advisor.contextLabel}</label>
            <textarea
              value={userContext}
              onChange={(e) => setUserContext(e.target.value)}
              placeholder={t.advisor.contextPlaceholder}
              className="w-full h-32 px-3 py-2 text-sm bg-surface-700 border border-surface-600 rounded-lg text-text-primary placeholder-text-muted focus:outline-none focus:border-ocean-500 transition-colors resize-none"
            />
            <div className="flex justify-between mt-1">
              <span className="text-[10px] text-text-muted">{t.advisor.contextHint}</span>
              <span className={`text-[10px] ${userContext.length < 10 ? 'text-red-400' : 'text-text-muted'}`}>
                {userContext.length} / 5000
              </span>
            </div>
          </div>

          {/* AI-generated perspective suggestions */}
          <div>
            <div className="flex items-center gap-1.5 mb-1.5">
              <Sparkles className="w-3 h-3 text-ocean-400" />
              <label className="text-xs font-medium text-text-secondary">{t.advisor.perspectiveLabel}</label>
            </div>
            {suggestionsLoading ? (
              <div className="flex items-center gap-2 py-3">
                <Loader2 className="w-3.5 h-3.5 text-text-muted animate-spin" />
                <span className="text-xs text-text-muted">{t.advisor.loadingSuggestions}</span>
              </div>
            ) : suggestions.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {suggestions.map((s) => {
                  const selected = selectedTags.has(s.label)
                  return (
                    <button
                      key={s.label}
                      onClick={() => toggleTag(s.label)}
                      title={s.description}
                      className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg border transition-colors ${
                        selected
                          ? 'text-ocean-400 bg-ocean-500/15 border-ocean-500/30'
                          : 'text-text-muted hover:text-text-secondary bg-surface-700 hover:bg-surface-600 border-surface-600'
                      }`}
                    >
                      <Tag className="w-3 h-3" />
                      {s.label}
                    </button>
                  )
                })}
              </div>
            ) : (
              <p className="text-xs text-text-muted py-1">{t.advisor.noSuggestions}</p>
            )}
          </div>
        </div>

        {/* Analyze button */}
        <div className="px-4 py-3 border-t border-surface-700">
          <button
            onClick={handleAnalyze}
            disabled={userContext.length < 10 || isLoading}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium rounded-lg bg-ocean-500 text-white hover:bg-ocean-400 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isLoading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                {t.advisor.analyzing}
              </>
            ) : (
              <>
                <Shield className="w-4 h-4" />
                {t.advisor.analyzeButton}
              </>
            )}
          </button>
        </div>
      </div>
    )
  }

  // --- Results Phase ---
  if (!result) return null
  const { impact_assessment, predictions, recommended_actions, escalation_scenarios, key_indicators } = result

  return (
    <div className="flex flex-col h-full bg-surface-800">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-surface-700">
        <div className="flex items-center gap-2">
          <button onClick={handleNewAnalysis} className="p-1 rounded hover:bg-surface-700 text-text-muted hover:text-text-primary transition-colors">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <Shield className="w-4 h-4 text-ocean-400" />
          <h2 className="text-sm font-semibold text-text-primary">{t.advisor.title}</h2>
        </div>
        <div className="flex items-center gap-2">
          <SeverityBadge severity={impact_assessment.overall_severity as Severity} />
          <button onClick={onClose} className="p-1 rounded hover:bg-surface-700 text-text-muted hover:text-text-primary transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Scrollable results */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {/* Executive summary */}
        <div className="p-3 bg-surface-700/50 rounded-lg border border-surface-600">
          <p className="text-xs text-text-secondary leading-relaxed">{impact_assessment.summary}</p>
        </div>

        {/* Impact Assessment */}
        <CollapsibleSection
          title={t.advisor.sections.impact}
          icon={AlertTriangle}
          count={impact_assessment.direct_impacts.length + impact_assessment.indirect_impacts.length}
          defaultOpen
        >
          {impact_assessment.direct_impacts.length > 0 && (
            <div className="space-y-2">
              <p className="text-[10px] font-medium text-text-muted uppercase tracking-wider">{t.advisor.directImpacts}</p>
              {impact_assessment.direct_impacts.map((item, i) => (
                <div key={i} className="p-2 bg-surface-700/50 rounded border border-surface-600 space-y-1">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-xs text-text-primary leading-relaxed flex-1">{item.impact_description}</p>
                    <SeverityBadge severity={item.severity} />
                  </div>
                  <p className="text-[10px] text-text-muted italic">&ldquo;{item.claim_text}&rdquo;</p>
                  <p className="text-[10px] text-text-muted">{t.advisor.timeline}: {item.timeline}</p>
                </div>
              ))}
            </div>
          )}
          {impact_assessment.indirect_impacts.length > 0 && (
            <div className="space-y-2 mt-2">
              <p className="text-[10px] font-medium text-text-muted uppercase tracking-wider">{t.advisor.indirectImpacts}</p>
              {impact_assessment.indirect_impacts.map((item, i) => (
                <div key={i} className="p-2 bg-surface-700/50 rounded border border-surface-600 space-y-1">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-xs text-text-primary leading-relaxed flex-1">{item.impact_description}</p>
                    <SeverityBadge severity={item.severity} />
                  </div>
                  <p className="text-[10px] text-text-muted italic">{item.causal_chain}</p>
                  <p className="text-[10px] text-text-muted">{t.advisor.timeline}: {item.timeline}</p>
                </div>
              ))}
            </div>
          )}
        </CollapsibleSection>

        {/* Predictions */}
        <CollapsibleSection
          title={t.advisor.sections.predictions}
          icon={TrendingUp}
          count={predictions.length}
        >
          {predictions.map((item, i) => (
            <div key={i} className="p-2 bg-surface-700/50 rounded border border-surface-600 space-y-1.5">
              <p className="text-xs text-text-primary leading-relaxed">{item.prediction}</p>
              <div className="flex items-center gap-2">
                <div className="flex-1 h-1.5 bg-surface-600 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-ocean-400 rounded-full transition-all"
                    style={{ width: `${item.probability * 100}%` }}
                  />
                </div>
                <span className="text-[10px] text-text-muted tabular-nums w-8 text-right">{(item.probability * 100).toFixed(0)}%</span>
              </div>
              <p className="text-[10px] text-text-muted">{item.timeframe} &middot; {item.confidence_note}</p>
            </div>
          ))}
        </CollapsibleSection>

        {/* Recommended Actions */}
        <CollapsibleSection
          title={t.advisor.sections.actions}
          icon={ListChecks}
          count={recommended_actions.length}
        >
          {recommended_actions.map((item, i) => (
            <div key={i} className="p-2 bg-surface-700/50 rounded border border-surface-600 space-y-1">
              <div className="flex items-start justify-between gap-2">
                <p className="text-xs text-text-primary leading-relaxed flex-1">{item.action}</p>
                <span className={`inline-flex items-center px-2 py-0.5 text-[10px] font-medium rounded-full ${PRIORITY_COLORS[item.priority] ?? PRIORITY_COLORS['long-term']}`}>
                  {t.advisor.priority[item.priority as keyof typeof t.advisor.priority]}
                </span>
              </div>
              <p className="text-[10px] text-text-muted">{item.timeframe} &middot; {item.rationale}</p>
            </div>
          ))}
        </CollapsibleSection>

        {/* Escalation Scenarios */}
        <CollapsibleSection
          title={t.advisor.sections.escalation}
          icon={Siren}
          count={escalation_scenarios.length}
        >
          {escalation_scenarios.map((item, i) => (
            <div key={i} className="p-2 bg-surface-700/50 rounded border border-surface-600 space-y-1.5">
              <div className="flex items-start justify-between gap-2">
                <p className="text-xs font-medium text-text-primary">{item.scenario_name}</p>
                <SeverityBadge severity={item.severity as Severity} />
              </div>
              <p className="text-[10px] text-text-muted"><strong>{t.advisor.trigger}:</strong> {item.trigger}</p>
              <p className="text-[10px] text-text-muted italic">{item.causal_chain}</p>
              <p className="text-xs text-text-secondary">{item.impact_on_user}</p>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-text-muted">{t.advisor.probability}: {(item.probability * 100).toFixed(0)}%</span>
              </div>
              {item.contingency_actions.length > 0 && (
                <div className="mt-1 space-y-0.5">
                  <p className="text-[10px] font-medium text-text-muted">{t.advisor.contingency}:</p>
                  {item.contingency_actions.map((action, j) => (
                    <p key={j} className="text-[10px] text-text-secondary pl-2">- {action}</p>
                  ))}
                </div>
              )}
            </div>
          ))}
        </CollapsibleSection>

        {/* Key Indicators */}
        <CollapsibleSection
          title={t.advisor.sections.indicators}
          icon={Activity}
          count={key_indicators.length}
        >
          {key_indicators.map((item, i) => (
            <div key={i} className="p-2 bg-surface-700/50 rounded border border-surface-600 space-y-1">
              <div className="flex items-start justify-between gap-2">
                <p className="text-xs text-text-primary leading-relaxed flex-1">{item.indicator}</p>
                <span className={`inline-flex items-center px-2 py-0.5 text-[10px] font-medium rounded-full ${SIGNAL_COLORS[item.signal_type] ?? SIGNAL_COLORS.coincident}`}>
                  {t.advisor.signalType[item.signal_type as keyof typeof t.advisor.signalType]}
                </span>
              </div>
              <p className="text-[10px] text-text-muted">{t.advisor.threshold}: {item.threshold}</p>
              <p className="text-[10px] text-text-muted">{t.advisor.dataSource}: {item.data_source}</p>
            </div>
          ))}
        </CollapsibleSection>
      </div>
    </div>
  )
}
