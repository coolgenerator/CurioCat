/**
 * CausalAnalysisGraph — Three-layer causal analysis visualization.
 *
 * Two view modes:
 *   1. "fused" (default) — PM view: shows final verdict with confidence tiers
 *   2. "layers" — Expert view: shows each layer independently, side by side
 *
 * Visual encoding (fused mode):
 *   ━━━━━━━━▶  Solid thick + green glow  = Statistically confirmed
 *   ────────▶  Solid thin  + purple       = Multi-layer supported
 *   - - - - ▶  Dashed      + amber        = AI hypothesis only
 *   · · · · ▶  Dotted      + gray         = Unverified
 *
 * Visual encoding (layer mode):
 *   Layer 3 column: green edges only — what statistics found
 *   Layer 1 column: amber edges only — what AI inferred
 *   Overlap column: purple — where both agree
 */

import { useState, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import type { FusedEdge, CausalEvidence, CausalAnalysisResult } from '../../lib/api/client'

interface Props {
  data: CausalAnalysisResult
}

type ViewMode = 'fused' | 'layers'

// ── Visual constants ──

const tierVisuals: Record<string, {
  color: string; strokeWidth: number; dashArray: string; glowOpacity: number
  label: string; icon: string; description: string
}> = {
  high: {
    color: '#22c55e', strokeWidth: 3, dashArray: 'none', glowOpacity: 0.3,
    label: '统计验证', icon: '✓', description: '经过统计检验确认（p<0.05），可作为决策依据',
  },
  medium: {
    color: '#6366f1', strokeWidth: 2, dashArray: 'none', glowOpacity: 0,
    label: '多层支持', icon: '◐', description: '统计和 AI 推理一致认为存在因果关系',
  },
  low: {
    color: '#f59e0b', strokeWidth: 1.5, dashArray: '8 4', glowOpacity: 0,
    label: 'AI 推断', icon: '◯', description: '基于 AI 推理，尚未有统计数据验证',
  },
  unverified: {
    color: '#94a3b8', strokeWidth: 1, dashArray: '3 3', glowOpacity: 0,
    label: '待验证', icon: '?', description: '初步假设，需要更多数据才能判断',
  },
}

const layerMeta: Record<number, { color: string; label: string; shortLabel: string; description: string }> = {
  3: { color: '#22c55e', label: '统计检验 (Layer 3)', shortLabel: '统计', description: '基于数据的 Granger / PC 等算法检验' },
  2: { color: '#6366f1', label: '持续监测 (Layer 2)', shortLabel: '监测', description: '在线统计量跟踪与变点检测' },
  1: { color: '#f59e0b', label: 'AI 推理 (Layer 1)', shortLabel: 'AI', description: '大语言模型的因果假设推理' },
}

const algoLabels: Record<string, string> = { llm: 'AI 推理', granger: 'Granger 因果检验', pc: 'PC 算法', fci: 'FCI', pcmci: 'PCMCI' }


export default function CausalAnalysisGraph({ data }: Props) {
  const [viewMode, setViewMode] = useState<ViewMode>('fused')
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null)
  const [filterTier, setFilterTier] = useState<string | null>(null)

  const filteredEdges = useMemo(() => {
    if (!filterTier) return data.edges
    return data.edges.filter(e => e.confidence_tier === filterTier)
  }, [data.edges, filterTier])

  const tierCounts = useMemo(() => {
    const c: Record<string, number> = {}
    for (const e of data.edges) c[e.confidence_tier] = (c[e.confidence_tier] || 0) + 1
    return c
  }, [data.edges])

  // For layer view: split evidence by layer
  const layerEdges = useMemo(() => {
    const byLayer: Record<number, CausalEvidence[]> = {}
    for (const edge of data.edges) {
      for (const ev of edge.evidence) {
        if (!byLayer[ev.layer]) byLayer[ev.layer] = []
        byLayer[ev.layer].push(ev)
      }
    }
    return byLayer
  }, [data.edges])

  // Edges that appear in multiple layers (overlap)
  const overlapPairs = useMemo(() => {
    const pairLayers: Record<string, Set<number>> = {}
    for (const edge of data.edges) {
      const key = `${edge.source_label}→${edge.target_label}`
      if (!pairLayers[key]) pairLayers[key] = new Set()
      for (const ev of edge.evidence) pairLayers[key].add(ev.layer)
    }
    const result = new Set<string>()
    for (const [key, layers] of Object.entries(pairLayers)) {
      if (layers.size > 1) result.add(key)
    }
    return result
  }, [data.edges])

  return (
    <div className="bg-surface-800 rounded-xl p-5 mt-4">

      {/* ── Header ── */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-semibold text-text-primary">因果分析结果</h3>
          <p className="text-[11px] text-text-muted mt-0.5">
            发现 {data.edges.length} 条因果关系 · 使用了{' '}
            {data.layers_used.map(l => layerMeta[l]?.shortLabel || `L${l}`).join(' + ')}
          </p>
        </div>

        {/* View mode toggle */}
        <div className="flex items-center bg-surface-700 rounded-lg p-0.5">
          <button
            onClick={() => { setViewMode('fused'); setSelectedIdx(null) }}
            className={`text-[11px] px-3 py-1 rounded-md font-medium transition-colors ${
              viewMode === 'fused' ? 'bg-surface-600 text-text-primary shadow-sm' : 'text-text-muted hover:text-text-secondary'
            }`}
          >
            结论视图
          </button>
          <button
            onClick={() => { setViewMode('layers'); setSelectedIdx(null) }}
            className={`text-[11px] px-3 py-1 rounded-md font-medium transition-colors ${
              viewMode === 'layers' ? 'bg-surface-600 text-text-primary shadow-sm' : 'text-text-muted hover:text-text-secondary'
            }`}
          >
            分层视图
          </button>
        </div>
      </div>

      {viewMode === 'fused' ? (
        /* ════════════ FUSED VIEW (PM default) ════════════ */
        <>
          {/* Confidence tier filter = legend */}
          <div className="flex gap-2 mb-4 flex-wrap">
            <button
              onClick={() => setFilterTier(null)}
              className={`text-[11px] px-3 py-1.5 rounded-lg font-medium transition-colors ${
                !filterTier ? 'bg-surface-600 text-text-primary' : 'bg-surface-700/50 text-text-muted hover:text-text-secondary'
              }`}
            >
              全部 ({data.edges.length})
            </button>
            {(['high', 'medium', 'low', 'unverified'] as const).map(tier => {
              const v = tierVisuals[tier]
              const count = tierCounts[tier] || 0
              if (count === 0) return null
              return (
                <button
                  key={tier}
                  onClick={() => setFilterTier(filterTier === tier ? null : tier)}
                  className={`flex items-center gap-2 text-[11px] px-3 py-1.5 rounded-lg font-medium transition-colors ${
                    filterTier === tier ? 'text-text-primary' : 'text-text-muted hover:text-text-secondary'
                  }`}
                  style={{
                    background: filterTier === tier ? `${v.color}15` : undefined,
                    border: filterTier === tier ? `1px solid ${v.color}40` : '1px solid transparent',
                  }}
                >
                  <svg width="28" height="8" viewBox="0 0 28 8">
                    <line x1="0" y1="4" x2="22" y2="4" stroke={v.color} strokeWidth={v.strokeWidth} strokeDasharray={v.dashArray} />
                    <polygon points="20,1 26,4 20,7" fill={v.color} />
                  </svg>
                  <span style={{ color: v.color }}>{v.icon}</span>
                  {v.label} ({count})
                </button>
              )
            })}
          </div>

          {/* Graph diagram */}
          <FusedDiagram edges={filteredEdges} selectedIdx={selectedIdx} onSelect={setSelectedIdx} />

          {/* Edge list */}
          <EdgeDetailList edges={filteredEdges} selectedIdx={selectedIdx} onSelect={setSelectedIdx} />
        </>
      ) : (
        /* ════════════ LAYER VIEW (Expert) ════════════ */
        <LayerView
          layerEdges={layerEdges}
          overlapPairs={overlapPairs}
          layersUsed={data.layers_used}
          fusedEdges={data.edges}
        />
      )}

      {/* Summary (both views) */}
      {data.summary && (
        <div className="flex items-start gap-2 mt-4 px-3 py-2.5 bg-ocean-500/5 border border-ocean-500/10 rounded-lg">
          <span className="text-ocean-400 shrink-0 mt-0.5 text-xs">⚡</span>
          <p className="text-xs text-text-secondary leading-relaxed whitespace-pre-wrap">{data.summary}</p>
        </div>
      )}
    </div>
  )
}


/* ════════════════════════════════════════════════════════
   LAYER VIEW — Side-by-side comparison of each layer
   ════════════════════════════════════════════════════════ */

function LayerView({ layerEdges, overlapPairs, layersUsed, fusedEdges }: {
  layerEdges: Record<number, CausalEvidence[]>
  overlapPairs: Set<string>
  layersUsed: number[]
  fusedEdges: FusedEdge[]
}) {
  const [expandedLayer, setExpandedLayer] = useState<number | null>(null)

  // Sorted layers: 3 first (statistical), then 1 (LLM)
  const sortedLayers = [...layersUsed].sort((a, b) => b - a)

  return (
    <div className="space-y-3">
      {/* Layer columns */}
      <div className={`grid gap-3 ${sortedLayers.length >= 3 ? 'grid-cols-3' : sortedLayers.length === 2 ? 'grid-cols-2' : 'grid-cols-1'}`}>
        {sortedLayers.map(layer => {
          const meta = layerMeta[layer] || { color: '#94a3b8', label: `Layer ${layer}`, shortLabel: `L${layer}`, description: '' }
          const edges = layerEdges[layer] || []
          const isExpanded = expandedLayer === layer

          return (
            <div
              key={layer}
              className="rounded-lg border border-surface-600 bg-surface-700/50 overflow-hidden"
            >
              {/* Layer header */}
              <div
                className="px-3 py-2.5 cursor-pointer hover:bg-surface-700 transition-colors"
                style={{ borderBottom: `2px solid ${meta.color}` }}
                onClick={() => setExpandedLayer(isExpanded ? null : layer)}
              >
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: meta.color }} />
                  <span className="text-xs font-semibold text-text-primary">{meta.label}</span>
                  <span className="ml-auto text-[10px] font-mono text-text-muted">{edges.length} 条</span>
                </div>
                <p className="text-[10px] text-text-muted mt-0.5">{meta.description}</p>
              </div>

              {/* Edge list for this layer */}
              <div className="px-2 py-1.5 space-y-1 max-h-[300px] overflow-y-auto">
                {edges.length === 0 ? (
                  <div className="text-center py-4 text-[10px] text-text-muted">此层无数据</div>
                ) : (
                  edges.map((ev, i) => {
                    const pairKey = `${ev.source_label}→${ev.target_label}`
                    const isOverlap = overlapPairs.has(pairKey)

                    return (
                      <div
                        key={i}
                        className={`px-2 py-1.5 rounded-md text-[11px] ${
                          isOverlap ? 'bg-indigo-500/8 border border-indigo-500/20' : 'bg-surface-800/50'
                        }`}
                      >
                        <div className="flex items-center gap-1.5">
                          <span className="text-text-primary font-medium truncate">{ev.source_label}</span>
                          <svg width="12" height="6" viewBox="0 0 12 6" className="shrink-0">
                            <line x1="0" y1="3" x2="8" y2="3" stroke={meta.color} strokeWidth={1.5} />
                            <polygon points="7,0.5 11,3 7,5.5" fill={meta.color} />
                          </svg>
                          <span className="text-text-primary font-medium truncate">{ev.target_label}</span>

                          {isOverlap && (
                            <span className="ml-auto text-[9px] px-1.5 py-0.5 rounded bg-indigo-500/10 text-indigo-400 font-medium shrink-0">
                              多层
                            </span>
                          )}
                        </div>

                        {/* Stats */}
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-[10px] text-text-muted">{algoLabels[ev.algorithm] || ev.algorithm}</span>
                          {ev.p_value != null && (
                            <span className="text-[10px] font-mono text-emerald-400">
                              p={ev.p_value < 0.001 ? '<.001' : ev.p_value.toFixed(3)}
                            </span>
                          )}
                          <span className="text-[10px] font-mono text-text-muted">
                            conf={ev.confidence.toFixed(2)}
                          </span>
                        </div>

                        {/* Reason (expandable) */}
                        {isExpanded && ev.reason && (
                          <p className="text-[10px] text-text-secondary mt-1 leading-relaxed">{ev.reason}</p>
                        )}
                      </div>
                    )
                  })
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Cross-layer agreement summary */}
      {overlapPairs.size > 0 && (
        <div className="px-3 py-2.5 rounded-lg bg-indigo-500/5 border border-indigo-500/15">
          <div className="flex items-center gap-2 mb-2">
            <span className="w-2 h-2 rounded-full bg-indigo-400" />
            <span className="text-xs font-semibold text-text-primary">
              跨层一致 ({overlapPairs.size} 条)
            </span>
          </div>
          <p className="text-[11px] text-text-secondary mb-2">
            以下因果关系在多个层级中被独立发现，可信度更高:
          </p>
          <div className="space-y-1">
            {Array.from(overlapPairs).map(pair => {
              const [src, tgt] = pair.split('→')
              // Find the fused edge to get the verdict
              const fused = fusedEdges.find(e => e.source_label === src && e.target_label === tgt)
              const layers = fused?.evidence.map(e => e.layer) || []
              const uniqueLayers = [...new Set(layers)]

              return (
                <div key={pair} className="flex items-center gap-2 text-[11px]">
                  <span className="text-text-primary font-medium">{src}</span>
                  <span className="text-indigo-400">→</span>
                  <span className="text-text-primary font-medium">{tgt}</span>
                  <span className="text-text-muted ml-auto">
                    {uniqueLayers.map(l => layerMeta[l]?.shortLabel || `L${l}`).join(' + ')}
                  </span>
                  {fused && (
                    <span className="font-mono font-bold text-indigo-400">
                      {(fused.fused_confidence * 100).toFixed(0)}%
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}


/* ════════════════════════════════════════════════════════
   FUSED DIAGRAM — SVG node-link graph
   ════════════════════════════════════════════════════════ */

function FusedDiagram({ edges, selectedIdx, onSelect }: {
  edges: FusedEdge[]; selectedIdx: number | null; onSelect: (i: number | null) => void
}) {
  const layout = useMemo(() => {
    const nodeSet = new Set<string>()
    const adj: Record<string, string[]> = {}
    for (const e of edges) {
      nodeSet.add(e.source_label); nodeSet.add(e.target_label)
      if (!adj[e.source_label]) adj[e.source_label] = []
      adj[e.source_label].push(e.target_label)
    }
    const nodes = Array.from(nodeSet)
    if (!nodes.length) return { nodes: [], positions: {} as Record<string, {x:number;y:number}>, width: 0, height: 0 }

    const inDeg: Record<string, number> = {}
    for (const n of nodes) inDeg[n] = 0
    for (const e of edges) inDeg[e.target_label] = (inDeg[e.target_label] || 0) + 1
    const roots = nodes.filter(n => !inDeg[n])
    if (!roots.length) roots.push(nodes[0])

    const depth: Record<string, number> = {}
    const q = [...roots]
    for (const r of roots) depth[r] = 0
    while (q.length) { const c = q.shift()!; for (const nx of adj[c] || []) { if (depth[nx] === undefined) { depth[nx] = (depth[c]||0)+1; q.push(nx) } } }
    for (const n of nodes) if (depth[n] === undefined) depth[n] = 0

    const cols: Record<number, string[]> = {}; let maxC = 0
    for (const n of nodes) { const c = depth[n]; if (!cols[c]) cols[c] = []; cols[c].push(n); if (c > maxC) maxC = c }

    const cw = 180, rh = 52, positions: Record<string, {x:number;y:number}> = {}
    let maxH = 0
    for (let c = 0; c <= maxC; c++) {
      const items = cols[c] || []
      if (items.length > maxH) maxH = items.length
      items.forEach((n, i) => { positions[n] = { x: c * cw + 20, y: i * rh + 20 } })
    }
    return { nodes, positions, width: (maxC+1)*cw+40, height: maxH*rh+20 }
  }, [edges])

  if (!layout.nodes.length) return <div className="text-center py-8 text-xs text-text-muted">暂无因果关系数据</div>

  const nW = 140, nH = 32
  return (
    <div className="rounded-lg bg-surface-900/50 border border-surface-700 overflow-x-auto">
      <svg viewBox={`0 0 ${layout.width} ${layout.height}`} className="w-full" style={{ minHeight: 120, maxHeight: 400 }}>
        <defs>
          <filter id="edge-glow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="3" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          {(['high','medium','low','unverified'] as const).map(t => (
            <marker key={t} id={`arr-${t}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
              <path d="M0 1.5 L10 5 L0 8.5z" fill={tierVisuals[t].color} opacity={0.85} />
            </marker>
          ))}
        </defs>
        {edges.map((e, i) => {
          const sp = layout.positions[e.source_label], tp = layout.positions[e.target_label]
          if (!sp || !tp) return null
          const v = tierVisuals[e.confidence_tier] || tierVisuals.unverified
          const sx=sp.x+nW, sy=sp.y+nH/2, tx=tp.x, ty=tp.y+nH/2, mx=(sx+tx)/2
          const sel = selectedIdx === i, dim = selectedIdx !== null && !sel
          return (
            <g key={i} opacity={dim?0.15:1} style={{transition:'opacity 0.2s',cursor:'pointer'}} onClick={()=>onSelect(sel?null:i)}>
              {v.glowOpacity > 0 && <path d={`M${sx},${sy} C${mx},${sy} ${mx},${ty} ${tx},${ty}`} fill="none" stroke={v.color} strokeWidth={v.strokeWidth+4} opacity={v.glowOpacity} filter="url(#edge-glow)" />}
              <path d={`M${sx},${sy} C${mx},${sy} ${mx},${ty} ${tx},${ty}`} fill="none" stroke={v.color} strokeWidth={v.strokeWidth} strokeDasharray={v.dashArray} opacity={0.85} markerEnd={`url(#arr-${e.confidence_tier})`} />
            </g>
          )
        })}
        {layout.nodes.map(name => {
          const p = layout.positions[name]; if (!p) return null
          let best = 'unverified'
          for (const e of edges) if (e.source_label===name||e.target_label===name) { const r:{[k:string]:number}={high:3,medium:2,low:1,unverified:0}; if ((r[e.confidence_tier]||0)>(r[best]||0)) best=e.confidence_tier }
          const c = tierVisuals[best]?.color || '#94a3b8'
          return (
            <g key={name}>
              <rect x={p.x} y={p.y} width={nW} height={nH} rx={6} fill="var(--color-surface-700, #1e293b)" stroke={c} strokeWidth={1} opacity={0.9} />
              <text x={p.x+nW/2} y={p.y+nH/2+1} textAnchor="middle" dominantBaseline="central" fill="var(--color-text-primary, #e2e8f0)" fontSize={11} fontWeight={600}>
                {name.length > 16 ? name.slice(0, 15) + '…' : name}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}


/* ════════════════════════════════════════════════════════
   EDGE DETAIL LIST — Expandable rows under the diagram
   ════════════════════════════════════════════════════════ */

function EdgeDetailList({ edges, selectedIdx, onSelect }: {
  edges: FusedEdge[]; selectedIdx: number | null; onSelect: (i: number | null) => void
}) {
  return (
    <div className="mt-4 space-y-1.5">
      {edges.map((edge, i) => {
        const v = tierVisuals[edge.confidence_tier] || tierVisuals.unverified
        const isOpen = selectedIdx === i
        return (
          <motion.div
            key={`${edge.source_label}-${edge.target_label}-${i}`}
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.03 }}
            className={`rounded-lg border cursor-pointer transition-colors ${
              isOpen ? 'bg-surface-700/80 border-surface-500' : 'bg-surface-800 border-surface-700 hover:border-surface-600'
            }`}
            onClick={() => onSelect(isOpen ? null : i)}
          >
            <div className="flex items-center gap-2 px-3 py-2">
              <span className="text-[11px] w-5 h-5 rounded-full flex items-center justify-center font-bold shrink-0"
                style={{ background: `${v.color}20`, color: v.color, border: `1.5px solid ${v.color}50` }}>
                {v.icon}
              </span>
              <span className="text-xs font-medium text-text-primary truncate">{edge.source_label}</span>
              <svg width="24" height="8" viewBox="0 0 24 8" className="shrink-0">
                <line x1="0" y1="4" x2="18" y2="4" stroke={v.color} strokeWidth={v.strokeWidth} strokeDasharray={v.dashArray} />
                <polygon points="16,1 22,4 16,7" fill={v.color} />
              </svg>
              <span className="text-xs font-medium text-text-primary truncate">{edge.target_label}</span>
              <div className="ml-auto flex items-center gap-2 shrink-0">
                {edge.best_p_value != null && (
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400">
                    p={edge.best_p_value < 0.001 ? '<.001' : edge.best_p_value.toFixed(3)}
                  </span>
                )}
                {edge.best_lag != null && <span className="text-[10px] font-mono text-text-muted">lag {edge.best_lag}</span>}
                <span className="text-[11px] font-mono font-bold" style={{ color: v.color }}>
                  {(edge.fused_confidence * 100).toFixed(0)}%
                </span>
              </div>
            </div>

            <AnimatePresence>
              {isOpen && (
                <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                  <div className="px-3 pb-3 space-y-2">
                    <div className="flex items-center gap-2 px-2 py-1.5 rounded-md" style={{ background: `${v.color}08` }}>
                      <span className="text-[10px]" style={{ color: v.color }}>{v.icon}</span>
                      <span className="text-[11px] text-text-secondary">{v.description}</span>
                    </div>
                    <div className="border-t border-surface-600 pt-2 space-y-1.5">
                      <span className="text-[10px] text-text-muted font-medium">证据来源:</span>
                      {edge.evidence.map((ev, j) => (
                        <div key={j} className="flex items-center gap-2 text-[11px]">
                          <span className={`shrink-0 w-1.5 h-1.5 rounded-full ${ev.layer === 3 ? 'bg-emerald-400' : ev.layer === 2 ? 'bg-indigo-400' : 'bg-amber-400'}`} />
                          <span className={`shrink-0 text-[10px] font-medium ${ev.layer === 3 ? 'text-emerald-400' : ev.layer === 2 ? 'text-indigo-400' : 'text-amber-400'}`}>
                            {algoLabels[ev.algorithm] || ev.algorithm}
                          </span>
                          <span className="text-text-secondary flex-1 truncate">{ev.reason || '—'}</span>
                          {ev.p_value != null && <span className="text-text-muted font-mono shrink-0">p={ev.p_value.toFixed(4)}</span>}
                        </div>
                      ))}
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )
      })}
    </div>
  )
}
