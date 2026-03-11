import {
  FileSearch,
  GitBranch,
  Search,
  Activity,
  Network,
  Check,
  Loader2,
  Circle,
  ShieldAlert,
  Lightbulb,
  Waypoints,
} from 'lucide-react'
import type { PipelineStage } from '../../types/api.ts'
import { useT } from '../../i18n/index.tsx'
import { Progress } from '../ui/index.ts'

interface StageTimelineProps {
  stages: PipelineStage[]
}

const STAGE_ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  claim_extraction: FileSearch,
  causal_inference: GitBranch,
  bias_audit: ShieldAlert,
  evidence_grounding: Search,
  evidence_search: Search,
  discovery: Lightbulb,
  dag_construction: Network,
  belief_propagation: Waypoints,
  sensitivity_analysis: Activity,
  graph_construction: Network,
}

function getBaseStageLabel(stageKey: string, t: ReturnType<typeof useT>['t']): string {
  const labels: Record<string, string> = {
    claim_extraction: t.processing.stages.claimExtraction,
    causal_inference: t.processing.stages.causalInference,
    bias_audit: t.processing.stages.biasAudit,
    evidence_grounding: t.processing.stages.evidenceSearch,
    evidence_search: t.processing.stages.evidenceSearch,
    discovery: t.processing.stages.discovery,
    dag_construction: t.processing.stages.graphConstruction,
    belief_propagation: t.processing.stages.beliefPropagation,
    sensitivity_analysis: t.processing.stages.sensitivityAnalysis,
    graph_construction: t.processing.stages.graphConstruction,
  }
  return labels[stageKey] ?? stageKey
}

function parseStageKey(stageKey: string): { baseName: string; layer: number } {
  const match = stageKey.match(/^(.+)_L(\d+)$/)
  if (match) {
    return { baseName: match[1], layer: parseInt(match[2], 10) }
  }
  return { baseName: stageKey, layer: 0 }
}

interface LayerGroup {
  layer: number
  stages: PipelineStage[]
}

function groupStagesByLayer(stages: PipelineStage[]): LayerGroup[] {
  const groups = new Map<number, PipelineStage[]>()

  for (const stage of stages) {
    const { layer } = parseStageKey(stage.stage)
    const effectiveLayer = stage.layer ?? layer
    if (!groups.has(effectiveLayer)) {
      groups.set(effectiveLayer, [])
    }
    groups.get(effectiveLayer)!.push(stage)
  }

  return Array.from(groups.entries())
    .sort(([a], [b]) => a - b)
    .map(([layer, stageList]) => ({ layer, stages: stageList }))
}

export default function StageTimeline({ stages }: StageTimelineProps) {
  const { t } = useT()

  const layerGroups = groupStagesByLayer(stages)

  return (
    <div className="space-y-1">
      <h3 className="text-sm font-medium text-text-secondary mb-3">
        {t.processing.pipelineProgress}
      </h3>
      <div className="relative">
        {/* Vertical line connecting stages */}
        <div className="absolute left-4 top-4 bottom-4 w-px bg-surface-700" />

        <div className="space-y-4">
          {layerGroups.map(({ layer, stages: layerStages }) => (
            <div key={`layer-${layer}`}>
              {/* Layer label */}
              <div className="flex items-center gap-2 ml-10 mb-2 mt-1">
                <div className="h-px flex-1 bg-ocean-500/30" />
                <span className="text-xs text-ocean-400 font-medium whitespace-nowrap">
                  {layer === 0
                    ? t.processing.stages.initialLayerLabel
                    : t.processing.stages.layerLabel.replace('{n}', String(layer))}
                </span>
                <div className="h-px flex-1 bg-ocean-500/30" />
              </div>

              {layerStages.map((stage) => {
                const { baseName } = parseStageKey(stage.stage)
                const Icon = STAGE_ICON_MAP[baseName] ?? Circle
                const baseLabel = getBaseStageLabel(baseName, t)
                // Prepend "Incremental" / "增量" for non-discovery stages in discovery layers
                const label = layer > 0 && baseName !== 'discovery'
                  ? `${t.processing.stages.incrementalPrefix}${baseLabel}`
                  : baseLabel

                const isActive = stage.status === 'running' || stage.status === 'in_progress' || stage.status === 'started'
                const isComplete = stage.status === 'complete' || stage.status === 'completed'
                const isPending = !isActive && !isComplete

                // Check for convergence data
                const converged = stage.data && (stage.data as Record<string, unknown>).converged === true

                return (
                  <div key={stage.stage} className="relative flex items-start gap-3 pl-0">
                    {/* Status icon */}
                    <div
                      className={`
                        relative z-10 flex items-center justify-center w-8 h-8 rounded-full
                        ${isComplete ? 'bg-confidence-high/15 text-confidence-high' : ''}
                        ${isActive ? 'bg-ocean-500/15 text-ocean-400' : ''}
                        ${isPending ? 'bg-surface-700 text-text-muted' : ''}
                      `}
                    >
                      {isComplete && <Check className="w-4 h-4" />}
                      {isActive && <Loader2 className="w-4 h-4 animate-spin" />}
                      {isPending && <Circle className="w-3 h-3" />}
                    </div>

                    {/* Stage info */}
                    <div className="flex-1 min-w-0 pt-0.5">
                      <div className="flex items-center gap-2">
                        <Icon className={`w-3.5 h-3.5 ${
                          isComplete ? 'text-confidence-high' :
                          isActive ? 'text-ocean-400' :
                          'text-text-muted'
                        }`} />
                        <span className={`text-sm font-medium ${
                          isComplete ? 'text-text-primary' :
                          isActive ? 'text-ocean-400' :
                          'text-text-muted'
                        }`}>
                          {label}
                        </span>
                        {isComplete && !converged && (
                          <span className="text-xs text-confidence-high">{t.processing.done}</span>
                        )}
                        {isComplete && converged && (
                          <span className="text-xs text-ocean-400">{t.processing.stages.converged}</span>
                        )}
                      </div>
                      {isActive && (
                        <div className="mt-1.5">
                          <Progress value={stage.progress * 100} size="sm" />
                          <span className="text-xs text-text-muted mt-0.5 block">
                            {Math.round(stage.progress * 100)}%
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
