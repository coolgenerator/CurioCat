import { useState, useMemo, useRef, useEffect, useCallback } from 'react'
import { X, ArrowRight, ArrowLeft, Loader2, ChevronDown, ChevronUp, Focus, AlertTriangle, HelpCircle, Clock, Zap } from 'lucide-react'
import { scaleLinear } from 'd3-scale'
import { area, line, curveMonotoneX } from 'd3-shape'
import type { CausalGraph, CausalNode, CausalEdge, BiasWarning, TemporalBeliefSample } from '../../types/graph.ts'
import { useT } from '../../i18n/index.tsx'
import { CAUSAL_TYPE_META, LOGIC_GATE_META, BIAS_SEVERITY_COLORS, formatTimeDelayShort } from '../../lib/visualConstants.ts'
import Badge from '../ui/Badge.tsx'
import Progress from '../ui/Progress.tsx'
import Tooltip from '../ui/Tooltip.tsx'

function HintIcon({ hint }: { hint: string }) {
  return (
    <Tooltip content={hint} position="top" maxWidth={220}>
      <HelpCircle className="w-3 h-3 text-text-muted/50 hover:text-text-muted cursor-help transition-colors shrink-0" />
    </Tooltip>
  )
}

interface NodeDetailPanelProps {
  graph: CausalGraph
  nodeId: string
  onClose: () => void
  onNodeClick: (nodeId: string) => void
  onEdgeClick: (edgeId: string) => void
  onExpand?: (nodeId: string, reasoning?: string) => void
  onTraceBack?: (nodeId: string, reasoning?: string) => void
  onFocus?: (nodeId: string) => void
  operationLoading?: string | null
  cumulativeTime?: Map<string, number>
  temporalSamples?: (nodeId: string) => TemporalBeliefSample[]
  currentTime?: number | null
}

export default function NodeDetailPanel({
  graph,
  nodeId,
  onClose,
  onNodeClick,
  onEdgeClick,
  onExpand,
  onTraceBack,
  onFocus,
  operationLoading,
  cumulativeTime,
  temporalSamples,
  currentTime,
}: NodeDetailPanelProps) {
  const { t } = useT()
  const [activeOp, setActiveOp] = useState<'expand' | 'trace-back' | 'what-if' | null>(null)
  const [reasoning, setReasoning] = useState('')
  const node = graph.nodes.find((n) => n.id === nodeId)
  if (!node) return null

  const incomingEdges = graph.edges.filter((e) => e.targetId === nodeId)
  const outgoingEdges = graph.edges.filter((e) => e.sourceId === nodeId)

  const nodeMap = new Map<string, CausalNode>(graph.nodes.map((n) => [n.id, n]))

  function confidenceLabel(val: number): string {
    if (val >= 0.7) return t.nodeDetail.high
    if (val >= 0.4) return t.nodeDetail.medium
    return t.nodeDetail.low
  }

  function confidenceColorClass(val: number): string {
    if (val >= 0.7) return 'text-confidence-high'
    if (val >= 0.4) return 'text-confidence-medium'
    return 'text-confidence-low'
  }

  return (
    <div className="w-full bg-surface-800 border-l border-surface-700 h-full overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-surface-700">
        <h3 className="text-sm font-semibold text-text-primary">{t.nodeDetail.title}</h3>
        <button
          onClick={onClose}
          className="p-1 rounded-md hover:bg-surface-700 text-text-muted hover:text-text-primary transition-colors"
          aria-label="Close panel"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="p-4 space-y-5">
        {/* Claim type badge */}
        <div className="flex items-center gap-2">
          <Badge type={node.claimType} />
          {node.isCriticalPath && (
            <span className="text-xs px-2 py-0.5 rounded-md bg-ocean-500/15 text-ocean-400 border border-ocean-500/30">
              {t.nodeDetail.criticalPath}
            </span>
          )}
        </div>

        {/* Full text */}
        <div>
          <label className="text-xs font-medium text-text-muted block mb-1">{t.nodeDetail.claimText}</label>
          <p className="text-sm text-text-primary leading-relaxed">{node.text}</p>
          {node.sourceSentence && (
            <div className="text-xs text-text-muted mt-1 italic border-l-2 border-surface-600 pl-2">
              {node.sourceSentence}
            </div>
          )}
        </div>

        {/* Confidence */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs font-medium text-text-muted flex items-center gap-1">
              {t.nodeDetail.confidence}
              <HintIcon hint={t.nodeDetail.hints.confidence} />
            </label>
            <span className={`text-xs font-medium ${confidenceColorClass(node.confidence)}`}>
              {confidenceLabel(node.confidence)} ({(node.confidence * 100).toFixed(0)}%)
            </span>
          </div>
          <Progress value={node.confidence * 100} />
        </div>

        {/* Belief score */}
        {node.belief !== null && (
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-medium text-text-muted flex items-center gap-1">
                {t.nodeDetail.belief}
                <HintIcon hint={t.nodeDetail.hints.belief} />
              </label>
              <span className="text-xs text-text-secondary tabular-nums">
                {node.belief.toFixed(2)}
              </span>
            </div>
            <Progress value={node.belief * 100} />
            {node.beliefLow != null && node.beliefHigh != null && (
              <div className="mt-1">
                <div className="text-[10px] text-text-muted">
                  Uncertainty: {(node.beliefLow * 100).toFixed(0)}% – {(node.beliefHigh * 100).toFixed(0)}%
                </div>
                <div className="h-1.5 bg-surface-700 rounded-full mt-0.5 relative">
                  <div
                    className="absolute h-full bg-ocean-400/30 rounded-full"
                    style={{
                      left: `${node.beliefLow * 100}%`,
                      width: `${(node.beliefHigh - node.beliefLow) * 100}%`,
                    }}
                  />
                </div>
              </div>
            )}
          </div>
        )}

        {/* Belief sparkline (temporal) */}
        {temporalSamples && (
          <BeliefSparkline
            samples={temporalSamples(nodeId)}
            currentTime={currentTime}
            t={t}
          />
        )}

        {/* Sensitivity */}
        {node.sensitivity !== null && (
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-medium text-text-muted flex items-center gap-1">
                {t.nodeDetail.sensitivity}
                <HintIcon hint={t.nodeDetail.hints.sensitivity} />
              </label>
              <span className="text-xs text-text-secondary tabular-nums">
                {node.sensitivity.toFixed(2)}
              </span>
            </div>
            <Progress value={node.sensitivity * 100} />
          </div>
        )}

        {/* Logic Gate */}
        {node.logicGate && (
          <div className="flex items-center gap-2">
            <span className={`text-xs px-2 py-0.5 rounded-md font-mono border ${
              node.logicGate === 'and'
                ? 'bg-purple-500/15 text-purple-400 border-purple-500/30'
                : 'bg-surface-600/40 text-text-muted border-surface-500/30'
            }`}>
              {LOGIC_GATE_META[node.logicGate]?.label ?? 'OR'}
            </span>
            <span className="text-[10px] text-text-muted">
              {LOGIC_GATE_META[node.logicGate]?.description}
            </span>
            <HintIcon hint={t.nodeDetail.hints.logicGate} />
          </div>
        )}

        {/* Temporal Progression */}
        {(() => {
          const nodeDays = cumulativeTime?.get(nodeId)
          const hasTemporalData = (nodeDays != null && nodeDays > 0) || incomingEdges.some((e) => e.timeDelay) || outgoingEdges.some((e) => e.timeDelay)
          if (!hasTemporalData) return null

          const entries: { label: string; text: string; isSelf?: boolean; clickNodeId?: string }[] = []

          for (const edge of incomingEdges) {
            const sourceNode = nodeMap.get(edge.sourceId)
            const delay = formatTimeDelayShort(edge.timeDelay)
            if (sourceNode) {
              entries.push({
                label: delay ? `+${delay}` : '',
                text: sourceNode.text,
                clickNodeId: sourceNode.id,
              })
            }
          }

          const selfLabel = nodeDays != null && nodeDays > 0
            ? (formatTimeDelayShort(`${nodeDays} days`) ?? `${Math.round(nodeDays)}d`)
            : ''
          entries.push({
            label: selfLabel,
            text: node.text,
            isSelf: true,
          })

          for (const edge of outgoingEdges) {
            const targetNode = nodeMap.get(edge.targetId)
            const delay = formatTimeDelayShort(edge.timeDelay)
            if (targetNode) {
              entries.push({
                label: delay ? `+${delay}` : '',
                text: targetNode.text,
                clickNodeId: targetNode.id,
              })
            }
          }

          return (
            <TemporalTimeline
              entries={entries}
              selfLabel={selfLabel}
              nodeDays={nodeDays}
              t={t}
              onNodeClick={onNodeClick}
            />
          )
        })()}

        {/* Bias Warnings Summary (from incoming edges) */}
        {(() => {
          const allBiases: BiasWarning[] = incomingEdges.flatMap((e) => e.biasWarnings ?? [])
          const topBiases = allBiases
            .sort((a, b) => {
              const order = { high: 0, medium: 1, low: 2 }
              return (order[a.severity] ?? 2) - (order[b.severity] ?? 2)
            })
            .slice(0, 3)
          if (topBiases.length === 0) return null
          return (
            <div>
              <label className="text-xs font-medium text-text-muted flex items-center gap-1 mb-1.5">
                <AlertTriangle className="w-3 h-3" />
                {t.causalTypes?.biasWarnings ?? 'Bias Warnings'}
              </label>
              <div className="space-y-1.5">
                {topBiases.map((b, i) => (
                  <div
                    key={i}
                    className="text-[10px] text-text-secondary border-l-2 pl-2 py-0.5"
                    style={{ borderColor: BIAS_SEVERITY_COLORS[b.severity] ?? '#f59e0b' }}
                  >
                    <span className="font-medium">{b.type.replace(/_/g, ' ')}</span>
                    <span className="text-text-muted ml-1">({b.severity})</span>
                  </div>
                ))}
              </div>
            </div>
          )
        })()}

        {/* Incoming edges (causes) — grouped by causal type */}
        {incomingEdges.length > 0 && (
          <div>
            <label className="text-xs font-medium text-text-muted flex items-center gap-1 mb-2">
              {t.nodeDetail.causes} ({incomingEdges.length})
              <HintIcon hint={t.nodeDetail.hints.causes} />
            </label>
            <div className="space-y-2">
              {Object.entries(
                incomingEdges.reduce<Record<string, typeof incomingEdges>>((groups, edge) => {
                  const ct = edge.causalType ?? 'direct'
                  ;(groups[ct] ??= []).push(edge)
                  return groups
                }, {})
              ).map(([ct, edges]) => (
                <div key={ct}>
                  <div className="text-[10px] text-text-muted mb-1 flex items-center gap-1">
                    <span>{CAUSAL_TYPE_META[ct as keyof typeof CAUSAL_TYPE_META]?.icon}</span>
                    <span>{CAUSAL_TYPE_META[ct as keyof typeof CAUSAL_TYPE_META]?.label ?? ct}</span>
                  </div>
                  {edges.map((edge) => (
                    <EdgeCard
                      key={edge.id}
                      edge={edge}
                      node={nodeMap.get(edge.sourceId)}
                      direction="incoming"
                      onNodeClick={onNodeClick}
                      onEdgeClick={onEdgeClick}
                    />
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Outgoing edges (effects) */}
        {outgoingEdges.length > 0 && (
          <div>
            <label className="text-xs font-medium text-text-muted flex items-center gap-1 mb-2">
              {t.nodeDetail.effects} ({outgoingEdges.length})
              <HintIcon hint={t.nodeDetail.hints.effects} />
            </label>
            <div className="space-y-2">
              {outgoingEdges.map((edge) => (
                <EdgeCard
                  key={edge.id}
                  edge={edge}
                  node={nodeMap.get(edge.targetId)}
                  direction="outgoing"
                  onNodeClick={onNodeClick}
                  onEdgeClick={onEdgeClick}
                />
              ))}
            </div>
          </div>
        )}

        {/* Graph operations */}
        <div className="pt-2 border-t border-surface-700 space-y-2">
          {/* Operation toggle buttons */}
          <div className="flex gap-1.5">
            {onExpand && (
              <button
                onClick={() => { setActiveOp(activeOp === 'expand' ? null : 'expand'); setReasoning('') }}
                disabled={operationLoading === 'expand'}
                className={`flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-[11px] rounded-lg border transition-colors disabled:opacity-50 ${
                  activeOp === 'expand'
                    ? 'bg-ocean-500/15 text-ocean-400 border-ocean-500/30'
                    : 'bg-surface-700 hover:bg-surface-600 text-text-secondary hover:text-text-primary border-surface-600'
                }`}
              >
                {operationLoading === 'expand' ? <Loader2 className="w-3 h-3 animate-spin" /> : <ChevronDown className="w-3 h-3" />}
                {t.operations.expand}
              </button>
            )}
            {onTraceBack && (
              <button
                onClick={() => { setActiveOp(activeOp === 'trace-back' ? null : 'trace-back'); setReasoning('') }}
                disabled={operationLoading === 'trace-back'}
                className={`flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-[11px] rounded-lg border transition-colors disabled:opacity-50 ${
                  activeOp === 'trace-back'
                    ? 'bg-ocean-500/15 text-ocean-400 border-ocean-500/30'
                    : 'bg-surface-700 hover:bg-surface-600 text-text-secondary hover:text-text-primary border-surface-600'
                }`}
              >
                {operationLoading === 'trace-back' ? <Loader2 className="w-3 h-3 animate-spin" /> : <ChevronUp className="w-3 h-3" />}
                {t.operations.traceBack}
              </button>
            )}
            {onExpand && (
              <button
                onClick={() => { setActiveOp(activeOp === 'what-if' ? null : 'what-if'); setReasoning('') }}
                disabled={operationLoading === 'expand'}
                className={`flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-[11px] rounded-lg border transition-colors disabled:opacity-50 ${
                  activeOp === 'what-if'
                    ? 'bg-amber-500/15 text-amber-400 border-amber-500/30'
                    : 'bg-surface-700 hover:bg-surface-600 text-text-secondary hover:text-text-primary border-surface-600'
                }`}
              >
                <Zap className="w-3 h-3" />
                {t.operations.whatIf}
              </button>
            )}
          </div>

          {/* Shared textarea + submit — appears when any operation is selected */}
          {activeOp && (
            <div className="space-y-2">
              {activeOp === 'what-if' && (
                <p className="text-[10px] text-text-muted">{t.operations.whatIfHint}</p>
              )}
              <textarea
                value={reasoning}
                onChange={(e) => setReasoning(e.target.value)}
                placeholder={activeOp === 'what-if' ? t.operations.whatIfPlaceholder : t.operations.nodeReasoningPlaceholder}
                rows={2}
                autoFocus
                className={`w-full px-3 py-2 text-xs bg-surface-700 border rounded-lg text-text-primary placeholder-text-muted focus:outline-none transition-colors resize-none ${
                  activeOp === 'what-if'
                    ? 'border-amber-500/30 focus:border-amber-500/50'
                    : 'border-surface-600 focus:border-ocean-500'
                }`}
              />
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    if (activeOp === 'what-if' && onExpand) {
                      if (!reasoning.trim()) return
                      onExpand(nodeId, reasoning.trim())
                    } else if (activeOp === 'expand' && onExpand) {
                      onExpand(nodeId, reasoning || undefined)
                    } else if (activeOp === 'trace-back' && onTraceBack) {
                      onTraceBack(nodeId, reasoning || undefined)
                    }
                    setReasoning('')
                    setActiveOp(null)
                  }}
                  disabled={operationLoading != null || (activeOp === 'what-if' && !reasoning.trim())}
                  className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border transition-colors disabled:opacity-50 ${
                    activeOp === 'what-if'
                      ? 'bg-amber-500/15 hover:bg-amber-500/25 text-amber-400 border-amber-500/30'
                      : 'bg-ocean-500/15 hover:bg-ocean-500/25 text-ocean-400 border-ocean-500/30'
                  }`}
                >
                  {operationLoading != null ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : activeOp === 'what-if' ? (
                    <Zap className="w-3 h-3" />
                  ) : null}
                  {operationLoading === 'expand' ? t.operations.expanding
                    : operationLoading === 'trace-back' ? t.operations.tracingBack
                    : activeOp === 'expand' ? t.operations.expand
                    : activeOp === 'trace-back' ? t.operations.traceBack
                    : t.operations.whatIfSubmit}
                </button>
                <button
                  onClick={() => { setActiveOp(null); setReasoning('') }}
                  className="px-3 py-1.5 text-xs rounded-lg bg-surface-700 hover:bg-surface-600 text-text-muted hover:text-text-primary border border-surface-600 transition-colors"
                >
                  {t.operations.cancel}
                </button>
              </div>
            </div>
          )}

          {onFocus && (
            <button
              onClick={() => onFocus(nodeId)}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 text-xs rounded-lg bg-ocean-500/15 hover:bg-ocean-500/25 text-ocean-400 border border-ocean-500/30 transition-colors"
            >
              <Focus className="w-3.5 h-3.5" />
              {t.operations.focus}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// --- Edge card sub-component ---

function EdgeCard({
  edge,
  node,
  direction,
  onNodeClick,
  onEdgeClick,
}: {
  edge: CausalEdge
  node: CausalNode | undefined
  direction: 'incoming' | 'outgoing'
  onNodeClick: (nodeId: string) => void
  onEdgeClick: (edgeId: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [isOverflowing, setIsOverflowing] = useState(false)
  const textRef = useRef<HTMLParagraphElement>(null)
  const { t } = useT()

  useEffect(() => {
    const el = textRef.current
    if (!el || expanded) return
    setIsOverflowing(el.scrollWidth > el.clientWidth)
  }, [node?.text, expanded])

  if (!node) return null

  const Icon = direction === 'incoming' ? ArrowLeft : ArrowRight
  const borderColor = edge.evidenceScore > 0.6
    ? 'border-l-evidence-supporting'
    : edge.evidenceScore < 0.4
      ? 'border-l-evidence-contested'
      : 'border-l-evidence-none'

  return (
    <div
      className={`border-l-2 ${borderColor} bg-surface-700/50 rounded-r-lg p-2 cursor-pointer hover:bg-surface-700 transition-colors`}
      onClick={() => onEdgeClick(edge.id)}
    >
      <div className="flex items-start gap-2">
        <Icon className="w-3.5 h-3.5 text-text-muted mt-0.5 shrink-0" />
        <div className="min-w-0">
          <p
            ref={textRef}
            className={`text-xs text-text-primary cursor-pointer hover:text-ocean-400 transition-colors ${expanded ? 'whitespace-normal break-words' : 'truncate'}`}
            onClick={(e) => { e.stopPropagation(); onNodeClick(node.id) }}
          >
            {node.text}
          </p>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <span className="text-[10px] text-text-muted">
              str: {edge.strength.toFixed(2)}
            </span>
            <span className="text-[10px] text-text-muted">
              ev: {edge.evidenceScore.toFixed(2)}
            </span>
            {edge.timeDelay && formatTimeDelayShort(edge.timeDelay) && (
              <span className="text-[10px] text-ocean-400/70">
                {formatTimeDelayShort(edge.timeDelay)}
              </span>
            )}
            {(isOverflowing || expanded) && (
              <button
                className="text-[10px] text-ocean-400/70 hover:text-ocean-400 transition-colors"
                onClick={(e) => { e.stopPropagation(); setExpanded(!expanded) }}
              >
                {expanded ? t.evidence.showLess : t.evidence.showMore}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// --- Belief sparkline sub-component ---

const sparklineBeliefColor = scaleLinear<string>()
  .domain([0, 0.3, 0.6, 1])
  .range(['#64748b', '#ef4444', '#eab308', '#22c55e'])
  .clamp(true)

function BeliefSparkline({
  samples,
  currentTime,
  t,
}: {
  samples: TemporalBeliefSample[]
  currentTime?: number | null
  t: ReturnType<typeof useT>['t']
}) {
  const W = 200
  const H = 48
  const PX = 4
  const PY = 4

  const { linePath, areaPath, xScale, yScale } = useMemo(() => {
    if (samples.length < 2) return { linePath: '', areaPath: '', xScale: scaleLinear(), yScale: scaleLinear() }

    const xS = scaleLinear()
      .domain([samples[0].time, samples[samples.length - 1].time])
      .range([PX, W - PX])

    const yS = scaleLinear()
      .domain([0, 1])
      .range([H - PY, PY])

    const lineGen = line<TemporalBeliefSample>()
      .x((d) => xS(d.time))
      .y((d) => yS(d.belief))
      .curve(curveMonotoneX)

    const areaGen = area<TemporalBeliefSample>()
      .x((d) => xS(d.time))
      .y0(H - PY)
      .y1((d) => yS(d.belief))
      .curve(curveMonotoneX)

    return {
      linePath: lineGen(samples) ?? '',
      areaPath: areaGen(samples) ?? '',
      xScale: xS,
      yScale: yS,
    }
  }, [samples])

  if (samples.length < 2) return null

  // Interpolate belief at current time for the indicator
  let currentBelief: number | null = null
  let cx: number | null = null
  let cy: number | null = null
  if (currentTime != null) {
    // Binary search
    let lo = 0, hi = samples.length - 1
    while (lo < hi - 1) {
      const mid = (lo + hi) >> 1
      if (samples[mid].time <= currentTime) lo = mid
      else hi = mid
    }
    const s0 = samples[lo], s1 = samples[hi]
    const dt = s1.time - s0.time
    const t = dt === 0 ? 0 : (currentTime - s0.time) / dt
    currentBelief = s0.belief + t * (s1.belief - s0.belief)
    cx = xScale(currentTime)
    cy = yScale(currentBelief)
  }

  return (
    <div>
      <label className="text-xs font-medium text-text-muted flex items-center gap-1 mb-1">
        {t.timeline.beliefOverTime}
      </label>
      <svg width={W} height={H} className="rounded bg-surface-700/30">
        {/* Grid lines */}
        {[0.25, 0.5, 0.75].map((v) => (
          <line key={v} x1={PX} y1={yScale(v)} x2={W - PX} y2={yScale(v)}
            stroke="#334155" strokeWidth={0.5} strokeDasharray="2 2" />
        ))}
        {/* Area fill */}
        <path d={areaPath} fill="#0ea5e9" opacity={0.12} />
        {/* Line */}
        <path d={linePath} fill="none" stroke="#0ea5e9" strokeWidth={1.5} />
        {/* Current time indicator */}
        {cx != null && cy != null && currentBelief != null && (
          <>
            <line x1={cx} y1={PY} x2={cx} y2={H - PY}
              stroke="#f1f5f9" strokeWidth={1} strokeDasharray="3 2" opacity={0.5} />
            <circle cx={cx} cy={cy} r={3.5}
              fill={sparklineBeliefColor(currentBelief)} stroke="#f1f5f9" strokeWidth={1} />
            <text x={cx + 6} y={cy - 4} fontSize={9} fill="#f1f5f9" fontWeight="600">
              {(currentBelief * 100).toFixed(0)}%
            </text>
          </>
        )}
      </svg>
    </div>
  )
}

// --- Temporal timeline sub-component ---

interface TimelineEntry {
  label: string
  text: string
  isSelf?: boolean
  clickNodeId?: string
}

function TemporalTimeline({
  entries,
  selfLabel,
  nodeDays,
  t,
  onNodeClick,
}: {
  entries: TimelineEntry[]
  selfLabel: string
  nodeDays: number | undefined
  t: ReturnType<typeof useT>['t']
  onNodeClick: (nodeId: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const hasLongText = entries.some((e) => e.text.length > 50)

  return (
    <div>
      <label className="text-xs font-medium text-text-muted flex items-center gap-1 mb-2">
        <Clock className="w-3 h-3" />
        {t.nodeDetail.temporalPosition}
        {nodeDays != null && nodeDays > 0 && (
          <span className="text-ocean-400 ml-1">
            ({selfLabel} {t.nodeDetail.fromOrigin})
          </span>
        )}
        {hasLongText && (
          <button
            className="ml-auto text-[10px] text-ocean-400/70 hover:text-ocean-400 transition-colors"
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? t.evidence.showLess : t.evidence.showMore}
          </button>
        )}
      </label>
      <div className="relative pl-3 border-l border-surface-600 space-y-2">
        {entries.map((entry, i) => (
          <div
            key={i}
            className={`relative ${entry.clickNodeId ? 'cursor-pointer hover:bg-surface-700/50' : ''} rounded px-2 py-1 -ml-0.5 transition-colors`}
            onClick={() => entry.clickNodeId && onNodeClick(entry.clickNodeId)}
          >
            <div className={`absolute -left-[13.5px] top-2 w-2 h-2 rounded-full border-2 border-surface-800 ${
              entry.isSelf ? 'bg-ocean-400' : 'bg-surface-500'
            }`} />
            <div className={expanded ? 'space-y-0.5' : 'flex items-center gap-1.5'}>
              {entry.label && (
                <span className={`text-[10px] px-1 py-0.5 rounded shrink-0 inline-block ${
                  entry.isSelf
                    ? 'bg-ocean-500/15 text-ocean-400 border border-ocean-500/30'
                    : 'bg-surface-700 text-text-muted border border-surface-600'
                }`}>
                  {entry.label}
                </span>
              )}
              <span className={`text-[10px] leading-relaxed ${
                expanded ? 'block break-words' : 'truncate'
              } ${entry.isSelf ? 'text-text-primary font-medium' : 'text-text-secondary'}`}>
                {expanded ? entry.text : (entry.text.length > 50 ? entry.text.slice(0, 50) + '\u2026' : entry.text)}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
