import type { CausalEdge, CausalNode } from '../../types/graph.ts'
import { CAUSAL_TYPE_META, CONDITION_TYPE_LABELS, LOGIC_GATE_META } from '../../lib/visualConstants.ts'

export type TooltipData =
  | { type: 'node'; x: number; y: number; node: CausalNode; parentCount: number; childCount: number; temporalBelief?: number }
  | { type: 'edge'; x: number; y: number; edge: CausalEdge }
  | { type: 'edge-bundle'; x: number; y: number; edges: CausalEdge[]; primaryEdge: CausalEdge }

interface GraphTooltipProps {
  data: TooltipData
}

export default function GraphTooltip({ data }: GraphTooltipProps) {
  // Viewport-safe positioning
  const style: React.CSSProperties = {
    position: 'absolute',
    left: data.x + 12,
    top: data.y - 8,
    pointerEvents: 'none' as const,
    zIndex: 50,
    maxWidth: 280,
    animation: 'tooltip-in 0.12s ease-out',
  }

  if (data.type === 'node') {
    const { node, parentCount, childCount, temporalBelief } = data
    const gateMeta = LOGIC_GATE_META[node.logicGate ?? 'or']

    return (
      <div style={style} className="bg-surface-800 border border-surface-600 rounded-lg shadow-xl px-3 py-2 text-xs">
        <p className="text-text-primary line-clamp-2 mb-1.5">{node.text}</p>
        <div className="flex items-center gap-2 text-text-muted">
          <span>Belief: {node.belief !== null ? `${(node.belief * 100).toFixed(0)}%` : '—'}</span>
          {temporalBelief != null && (
            <>
              <span className="text-surface-500">|</span>
              <span className="text-ocean-400">@T: {(temporalBelief * 100).toFixed(0)}%</span>
            </>
          )}
          <span className="text-surface-500">|</span>
          <span>Conf: {(node.confidence * 100).toFixed(0)}%</span>
        </div>
        <div className="flex items-center gap-2 mt-1 text-text-muted">
          <span className="px-1 rounded bg-surface-700 text-[10px] font-mono">{gateMeta.label}</span>
          <span>{parentCount} causes → {childCount} effects</span>
        </div>
      </div>
    )
  }

  // Edge bundle tooltip
  if (data.type === 'edge-bundle') {
    const { edges } = data
    const avgStr = edges.reduce((s, e) => s + e.strength, 0) / edges.length
    const avgEv = edges.reduce((s, e) => s + e.evidenceScore, 0) / edges.length
    const types = [...new Set(edges.map((e) => e.causalType ?? 'direct'))]

    return (
      <div style={style} className="bg-surface-800 border border-surface-600 rounded-lg shadow-xl px-3 py-2 text-xs">
        <p className="text-text-primary font-medium mb-1">{edges.length} relationships</p>
        <div className="flex flex-wrap gap-1 mb-1.5">
          {types.map((ct) => {
            const meta = CAUSAL_TYPE_META[ct as keyof typeof CAUSAL_TYPE_META]
            return (
              <span key={ct} className="px-1 rounded bg-surface-700 text-[10px] text-text-secondary">
                {meta?.icon} {meta?.label ?? ct}
              </span>
            )
          })}
        </div>
        <div className="flex items-center gap-2 text-text-muted">
          <span>Avg Str: {(avgStr * 100).toFixed(0)}%</span>
          <span className="text-surface-500">|</span>
          <span>Avg Ev: {(avgEv * 100).toFixed(0)}%</span>
        </div>
        <p className="text-text-muted text-[10px] mt-1">Click to see all</p>
      </div>
    )
  }

  // Edge tooltip
  const { edge } = data
  const causalMeta = CAUSAL_TYPE_META[(edge.causalType ?? 'direct') as keyof typeof CAUSAL_TYPE_META]
  const condLabel = CONDITION_TYPE_LABELS[(edge.conditionType ?? 'contributing') as keyof typeof CONDITION_TYPE_LABELS]
  const biasCount = (edge.biasWarnings ?? []).length

  return (
    <div style={style} className="bg-surface-800 border border-surface-600 rounded-lg shadow-xl px-3 py-2 text-xs">
      <p className="text-text-primary line-clamp-2 mb-1.5">{edge.mechanism || 'No mechanism described'}</p>
      <div className="flex items-center gap-1.5 mb-1">
        <span className="px-1 rounded bg-surface-700 text-[10px] text-text-secondary">{causalMeta?.icon} {causalMeta?.label}</span>
      </div>
      <div className="flex items-center gap-2 text-text-muted">
        <span>Str: {(edge.strength * 100).toFixed(0)}%</span>
        <span className="text-surface-500">|</span>
        <span>Ev: {(edge.evidenceScore * 100).toFixed(0)}%</span>
      </div>
      {edge.timeDelay && (
        <div className="text-text-muted mt-0.5">Delay: {edge.timeDelay}</div>
      )}
      <div className="text-text-muted mt-0.5 text-[10px]">{condLabel?.split(' — ')[0]}</div>
      {biasCount > 0 && (
        <div className="text-amber-400 mt-0.5 text-[10px]">{biasCount} bias warning{biasCount > 1 ? 's' : ''}</div>
      )}
    </div>
  )
}
