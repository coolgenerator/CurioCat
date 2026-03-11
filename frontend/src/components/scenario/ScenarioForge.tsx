import { useState, useCallback, useMemo } from 'react'
import { X, GitFork, Plus, Trash2, ChevronDown, ChevronUp, Sparkles, TrendingUp, TrendingDown, Activity, Lightbulb, FileText, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { useScenario, type ScenarioImpact } from '../../hooks/useScenario.ts'
import { useAnalysis } from '../../context/AnalysisContext.tsx'
import { useT } from '../../i18n/index.tsx'
import Button from '../ui/Button.tsx'
import Slider from '../ui/Slider.tsx'
import MarkdownContent from '../ui/MarkdownContent.tsx'

interface ScenarioForgeProps {
  projectId: string
  onClose: () => void
  onCompare?: (scenarioAId: string, scenarioBId: string) => void
}

interface EdgeOverrideEntry {
  edgeId: string
  label: string
  strength: number
}

function DeltaBar({ delta }: { delta: number }) {
  const pct = Math.min(Math.abs(delta) * 100, 100)
  const color = delta > 0 ? '#22c55e' : '#ef4444'
  return (
    <div className="w-full h-1.5 bg-surface-600 rounded-full overflow-hidden">
      <div
        className="h-full rounded-full transition-all"
        style={{ width: `${pct}%`, backgroundColor: color }}
      />
    </div>
  )
}

export default function ScenarioForge({
  projectId,
  onClose,
  onCompare,
}: ScenarioForgeProps) {
  const { state } = useAnalysis()
  const { scenarios, forkScenario, deleteScenario, loadScenarioReport, regenerateReport, loading } = useScenario(projectId)
  const { t } = useT()

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [edgeOverrides, setEdgeOverrides] = useState<EdgeOverrideEntry[]>([])
  const [injectedEvents, setInjectedEvents] = useState<string[]>([])
  const [eventInput, setEventInput] = useState('')
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [impact, setImpact] = useState<ScenarioImpact | null>(null)
  const [showNarrative, setShowNarrative] = useState(false)

  const graph = state.graph
  const edges = graph?.edges ?? []

  // Generate event suggestions from graph's key nodes
  const eventSuggestions = useMemo(() => {
    if (!graph) return []
    const suggestions: string[] = []
    const keyNodes = graph.nodes
      .filter((n) => n.isCriticalPath || (n.sensitivity ?? 0) > 0.5)
      .slice(0, 6)
    for (const node of keyNodes) {
      const short = node.text.length > 50 ? node.text.slice(0, 50) + '...' : node.text
      if (node.claimType === 'PREDICTION') {
        suggestions.push(short)
      } else if (node.claimType === 'ASSUMPTION') {
        suggestions.push(short)
      }
    }
    if (suggestions.length < 3) {
      const rootNodes = graph.nodes.filter((n) => n.orderIndex === 0)
      for (const node of rootNodes.slice(0, 2)) {
        const short = node.text.length > 50 ? node.text.slice(0, 50) + '...' : node.text
        suggestions.push(short)
      }
    }
    return suggestions.slice(0, 4)
  }, [graph])

  const handleAddEdgeOverride = useCallback((edgeId: string) => {
    const edge = edges.find((e) => e.id === edgeId)
    if (!edge) return
    if (edgeOverrides.some((o) => o.edgeId === edgeId)) return

    const sourceNode = graph?.nodes.find((n) => n.id === edge.sourceId)
    const targetNode = graph?.nodes.find((n) => n.id === edge.targetId)
    const label = `${sourceNode?.text.slice(0, 30) ?? '?'} -> ${targetNode?.text.slice(0, 30) ?? '?'}`

    setEdgeOverrides((prev) => [...prev, { edgeId, label, strength: edge.strength }])
  }, [edges, edgeOverrides, graph])

  const handleRemoveEdgeOverride = useCallback((edgeId: string) => {
    setEdgeOverrides((prev) => prev.filter((o) => o.edgeId !== edgeId))
  }, [])

  const handleOverrideStrengthChange = useCallback((edgeId: string, strength: number) => {
    setEdgeOverrides((prev) =>
      prev.map((o) => o.edgeId === edgeId ? { ...o, strength } : o),
    )
  }, [])

  const handleAddEvent = useCallback(() => {
    const trimmed = eventInput.trim()
    if (!trimmed) return
    setInjectedEvents((prev) => [...prev, trimmed])
    setEventInput('')
  }, [eventInput])

  const handleRemoveEvent = useCallback((index: number) => {
    setInjectedEvents((prev) => prev.filter((_, i) => i !== index))
  }, [])

  const handleViewReport = useCallback(async (scenarioId: string) => {
    const result = await loadScenarioReport(scenarioId)
    if (result) {
      setImpact(result)
      setShowNarrative(false)
    } else {
      toast.error(t.errors.generic)
    }
  }, [loadScenarioReport, t])

  const handleRegenerateReport = useCallback(async (scenarioId: string) => {
    const ok = await regenerateReport(scenarioId)
    if (ok) {
      toast.success(t.scenario.reportGenerated ?? 'Report generated')
      // After regeneration, load the report to show it
      const result = await loadScenarioReport(scenarioId)
      if (result) {
        setImpact(result)
        setShowNarrative(false)
      }
    } else {
      toast.error(t.errors.generic)
    }
  }, [regenerateReport, loadScenarioReport, t])

  const handleCreateFork = useCallback(async () => {
    if (!name.trim()) {
      toast.error(t.errors.scenarioNameRequired)
      return
    }

    const overridesMap: Record<string, number> = {}
    for (const override of edgeOverrides) {
      overridesMap[override.edgeId] = override.strength
    }

    const result = await forkScenario({
      name: name.trim(),
      description: description.trim() || undefined,
      edgeOverrides: overridesMap,
      injectedEvents,
    })

    if (result) {
      toast.success(t.toasts.scenarioCreated.replace('{name}', result.scenarioName))
      setImpact(result)
      setName('')
      setDescription('')
      setEdgeOverrides([])
      setInjectedEvents([])
    } else {
      toast.error(t.errors.scenarioFailed)
    }
  }, [name, description, edgeOverrides, injectedEvents, forkScenario, t])

  const availableEdges = edges.filter(
    (e) => !edgeOverrides.some((o) => o.edgeId === e.id),
  )

  return (
    <div className="w-full bg-surface-800 border-l border-surface-700 h-full overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-surface-700">
        <div className="flex items-center gap-2">
          <GitFork className="w-4 h-4 text-ocean-400" />
          <h3 className="text-sm font-semibold text-text-primary">{t.scenario.title}</h3>
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
        {/* Impact Analysis Results (shown after scenario creation) */}
        {impact && (
          <div className="bg-surface-700/30 rounded-lg border border-ocean-500/30 p-3 space-y-3">
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-ocean-400" />
              <span className="text-xs font-semibold text-text-primary">
                {t.scenario.impactTitle ?? '影响分析'}: {impact.scenarioName}
              </span>
            </div>

            {/* Conclusion */}
            {impact.conclusion && (
              <div className="bg-surface-700/40 rounded-md p-2.5">
                <div className="flex items-center gap-1.5 mb-1.5">
                  <Activity className="w-3.5 h-3.5 text-ocean-400" />
                  <span className="text-[11px] font-semibold text-text-primary">
                    {t.scenario.conclusion}
                  </span>
                </div>
                <MarkdownContent compact>{impact.conclusion}</MarkdownContent>
              </div>
            )}

            {/* Key Insights */}
            {impact.keyInsights.length > 0 && (
              <div>
                <div className="flex items-center gap-1.5 mb-1.5">
                  <Lightbulb className="w-3.5 h-3.5 text-amber-400" />
                  <span className="text-[10px] font-semibold text-text-primary">
                    {t.scenario.keyInsights}
                  </span>
                </div>
                <ul className="space-y-1">
                  {impact.keyInsights.map((insight, i) => (
                    <li key={i} className="text-[10px] text-text-secondary leading-relaxed pl-3 relative before:content-['•'] before:absolute before:left-0 before:text-ocean-400">
                      <MarkdownContent compact>{insight}</MarkdownContent>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <p className="text-[10px] text-text-muted">
              {t.scenario.affectedNodes ?? '受影响节点'}: {impact.affectedCount}
            </p>

            {impact.topIncreased.length > 0 && (
              <div>
                <div className="flex items-center gap-1 mb-1.5">
                  <TrendingUp className="w-3 h-3 text-confidence-high" />
                  <span className="text-[10px] font-medium text-confidence-high">
                    {t.scenario.beliefIncrease ?? '置信度上升'}
                  </span>
                </div>
                {impact.topIncreased.map((node) => (
                  <div key={node.id} className="mb-1.5">
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="text-[10px] text-text-secondary truncate mr-2 flex-1">
                        {node.text.length > 60 ? node.text.slice(0, 60) + '...' : node.text}
                      </span>
                      <span className="text-[10px] font-mono text-confidence-high shrink-0">
                        +{(node.delta * 100).toFixed(1)}%
                      </span>
                    </div>
                    <DeltaBar delta={node.delta} />
                  </div>
                ))}
              </div>
            )}

            {impact.topDecreased.length > 0 && (
              <div>
                <div className="flex items-center gap-1 mb-1.5">
                  <TrendingDown className="w-3 h-3 text-confidence-low" />
                  <span className="text-[10px] font-medium text-confidence-low">
                    {t.scenario.beliefDecrease ?? '置信度下降'}
                  </span>
                </div>
                {impact.topDecreased.map((node) => (
                  <div key={node.id} className="mb-1.5">
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="text-[10px] text-text-secondary truncate mr-2 flex-1">
                        {node.text.length > 60 ? node.text.slice(0, 60) + '...' : node.text}
                      </span>
                      <span className="text-[10px] font-mono text-confidence-low shrink-0">
                        {(node.delta * 100).toFixed(1)}%
                      </span>
                    </div>
                    <DeltaBar delta={node.delta} />
                  </div>
                ))}
              </div>
            )}

            {impact.affectedCount === 0 && !impact.conclusion && (
              <p className="text-[10px] text-text-muted italic">
                {t.scenario.noImpact ?? '该场景未对任何节点的置信度产生显著影响。'}
              </p>
            )}

            {/* Detailed Analysis (collapsible) */}
            {impact.narrative && (
              <div>
                <button
                  onClick={() => setShowNarrative(!showNarrative)}
                  className="flex items-center gap-1.5 text-[10px] text-text-muted hover:text-text-secondary transition-colors"
                >
                  <FileText className="w-3 h-3" />
                  {showNarrative ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                  {t.scenario.detailedAnalysis}
                </button>
                {showNarrative && (
                  <div className="mt-1.5">
                    <MarkdownContent compact>{impact.narrative}</MarkdownContent>
                  </div>
                )}
              </div>
            )}

            <button
              onClick={() => { setImpact(null); setShowNarrative(false) }}
              className="text-[10px] text-text-muted hover:text-text-secondary transition-colors"
            >
              {t.scenario.dismiss ?? '关闭分析'}
            </button>
          </div>
        )}

        {/* Name input */}
        <div>
          <label className="text-xs font-medium text-text-muted block mb-1">
            {t.scenario.name}
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t.scenario.namePlaceholder}
            className="w-full px-3 py-1.5 text-sm bg-surface-700 border border-surface-600 rounded-lg text-text-primary placeholder-text-muted focus:outline-none focus:border-ocean-500 transition-colors"
          />
        </div>

        {/* Description textarea */}
        <div>
          <label className="text-xs font-medium text-text-muted block mb-1">
            {t.scenario.description}
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t.scenario.descPlaceholder}
            rows={2}
            className="w-full px-3 py-1.5 text-sm bg-surface-700 border border-surface-600 rounded-lg text-text-primary placeholder-text-muted focus:outline-none focus:border-ocean-500 transition-colors resize-none"
          />
        </div>

        {/* Inject Events (primary feature) */}
        <div>
          <label className="text-xs font-medium text-text-muted block mb-1">
            {t.scenario.injectedEvents} ({injectedEvents.length})
          </label>
          <p className="text-[10px] text-text-muted mb-2">
            {t.scenario.injectedEventsHint}
          </p>

          {injectedEvents.map((event, index) => (
            <div
              key={index}
              className="flex items-start gap-2 bg-surface-700/50 rounded-lg p-2 mb-1.5"
            >
              <span className="text-xs text-text-secondary flex-1">
                {event}
              </span>
              <button
                onClick={() => handleRemoveEvent(index)}
                className="p-0.5 text-text-muted hover:text-confidence-low transition-colors shrink-0 mt-0.5"
                aria-label="Remove event"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          ))}

          <div className="flex gap-1.5">
            <input
              type="text"
              value={eventInput}
              onChange={(e) => setEventInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleAddEvent()
              }}
              placeholder={t.scenario.newEvent}
              className="flex-1 px-2 py-1.5 text-xs bg-surface-700 border border-surface-600 rounded-lg text-text-primary placeholder-text-muted focus:outline-none focus:border-ocean-500 transition-colors"
            />
            <button
              onClick={handleAddEvent}
              disabled={!eventInput.trim()}
              className="p-1.5 bg-surface-700 border border-surface-600 rounded-lg text-text-secondary hover:text-text-primary hover:bg-surface-600 transition-colors disabled:opacity-30"
              aria-label="Add event"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Quick suggestions */}
          {eventSuggestions.length > 0 && injectedEvents.length === 0 && (
            <div className="mt-2.5">
              <label className="text-[10px] text-text-muted flex items-center gap-1 mb-1.5">
                <Sparkles className="w-3 h-3" />
                {t.scenario.suggestions}
              </label>
              <div className="flex flex-wrap gap-1">
                {eventSuggestions.map((suggestion, i) => (
                  <button
                    key={i}
                    onClick={() => {
                      setInjectedEvents((prev) => [...prev, suggestion])
                    }}
                    className="text-[10px] px-2 py-1 bg-surface-700/50 border border-surface-600 rounded-md text-text-secondary hover:text-ocean-400 hover:border-ocean-500/30 transition-colors text-left line-clamp-1"
                  >
                    + {suggestion}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Advanced: Edge Overrides (collapsed by default) */}
        <div className="border-t border-surface-700 pt-2">
          <button
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="flex items-center gap-1.5 text-xs text-text-muted hover:text-text-secondary transition-colors w-full"
          >
            {showAdvanced ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            {t.scenario.advanced}
            {edgeOverrides.length > 0 && (
              <span className="text-[10px] text-ocean-400">({edgeOverrides.length})</span>
            )}
          </button>

          {showAdvanced && (
            <div className="mt-2 space-y-2">
              <label className="text-[10px] text-text-muted block">
                {t.scenario.edgeOverrides}
              </label>

              {edgeOverrides.map((override) => (
                <div
                  key={override.edgeId}
                  className="bg-surface-700/50 rounded-lg p-2"
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-text-secondary truncate mr-2">
                      {override.label}
                    </span>
                    <button
                      onClick={() => handleRemoveEdgeOverride(override.edgeId)}
                      className="p-0.5 text-text-muted hover:text-confidence-low transition-colors shrink-0"
                      aria-label="Remove override"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                  <Slider
                    value={override.strength}
                    min={0}
                    max={1}
                    step={0.05}
                    onChange={(val) => handleOverrideStrengthChange(override.edgeId, val)}
                    className="w-full"
                  />
                </div>
              ))}

              {availableEdges.length > 0 && (
                <select
                  onChange={(e) => {
                    if (e.target.value) {
                      handleAddEdgeOverride(e.target.value)
                      e.target.value = ''
                    }
                  }}
                  defaultValue=""
                  className="w-full px-2 py-1.5 text-xs bg-surface-700 border border-surface-600 rounded-lg text-text-secondary focus:outline-none focus:border-ocean-500 transition-colors"
                >
                  <option value="">{t.scenario.addOverride}</option>
                  {availableEdges.map((edge) => {
                    const src = graph?.nodes.find((n) => n.id === edge.sourceId)
                    const tgt = graph?.nodes.find((n) => n.id === edge.targetId)
                    return (
                      <option key={edge.id} value={edge.id}>
                        {src?.text.slice(0, 25) ?? '?'} -&gt; {tgt?.text.slice(0, 25) ?? '?'}
                      </option>
                    )
                  })}
                </select>
              )}
            </div>
          )}
        </div>

        {/* Create Fork button */}
        <Button
          onClick={handleCreateFork}
          loading={loading}
          disabled={!name.trim()}
          className="w-full"
          size="sm"
        >
          <GitFork className="w-3.5 h-3.5" />
          {loading ? t.scenario.analyzing : t.scenario.createFork}
        </Button>

        {/* Existing scenarios */}
        {scenarios.length > 0 && (
          <div>
            <label className="text-xs font-medium text-text-muted block mb-2">
              {t.scenario.existing} ({scenarios.length})
            </label>
            <div className="space-y-2">
              {scenarios.map((scenario) => (
                <div
                  key={scenario.id}
                  className="bg-surface-700/50 rounded-lg p-3 border border-surface-600"
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-medium text-text-primary">
                      {scenario.name}
                    </span>
                    <button
                      onClick={() => deleteScenario(scenario.id)}
                      className="p-0.5 text-text-muted hover:text-confidence-low transition-colors shrink-0"
                      aria-label="Delete scenario"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                  {scenario.description && (
                    <p className="text-[10px] text-text-muted mb-2 line-clamp-2">
                      {scenario.description}
                    </p>
                  )}
                  <div className="flex items-center gap-2">
                    {scenario.narrative ? (
                      <button
                        onClick={() => handleViewReport(scenario.id)}
                        disabled={loading}
                        className="flex items-center gap-1 text-[10px] text-ocean-400 hover:text-ocean-300 transition-colors"
                      >
                        <FileText className="w-3 h-3" />
                        {loading ? t.scenario.loadingReport : t.scenario.hasReport}
                      </button>
                    ) : (
                      <button
                        onClick={() => handleRegenerateReport(scenario.id)}
                        disabled={loading}
                        className="flex items-center gap-1 text-[10px] text-text-muted hover:text-ocean-400 transition-colors"
                      >
                        <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
                        {loading ? t.scenario.analyzing : t.scenario.generateReport}
                      </button>
                    )}
                    {scenario.narrative && (
                      <button
                        onClick={() => handleRegenerateReport(scenario.id)}
                        disabled={loading}
                        className="flex items-center gap-1 text-[10px] text-text-muted hover:text-text-secondary transition-colors"
                      >
                        <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
                        {t.scenario.regenerateReport}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
