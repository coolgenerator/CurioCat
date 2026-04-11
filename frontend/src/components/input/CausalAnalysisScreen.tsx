/**
 * CausalAnalysisScreen — Three-layer causal analysis dashboard.
 *
 * Layout:
 *   ┌─────────────────────────────────────────────────────────┐
 *   │  Input bar (collapsible after first analysis)           │
 *   ├───────────────────────────┬─────────────────────────────┤
 *   │                           │                             │
 *   │   Graph (D3 force or      │   Detail panel              │
 *   │   layered column view)    │   (edge detail / layer      │
 *   │                           │    comparison / evidence)   │
 *   │                           │                             │
 *   ├───────────────────────────┴─────────────────────────────┤
 *   │  Bottom bar: confidence legend + summary                │
 *   └─────────────────────────────────────────────────────────┘
 */

import { useState, useCallback, useRef, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Upload, FileSpreadsheet, Image, MessageSquare, Loader2, X,
  ChevronDown, ChevronUp, Layers, Eye, Info
} from 'lucide-react'
import { analyzeCSV, analyzeScreenshot, analyzeText } from '../../lib/api/client'
import type { CausalAnalysisResult, FusedEdge, CausalEvidence } from '../../lib/api/client'

type InputMode = 'csv' | 'screenshot' | 'text'
type ViewMode = 'fused' | 'layers'

// ── Visual constants (matching CurioCat's design system) ──

const tierVisuals: Record<string, {
  color: string; strokeWidth: number; dashArray: string; glow: boolean
  label: string; icon: string; tagline: string
}> = {
  high: {
    color: '#22c55e', strokeWidth: 3, dashArray: 'none', glow: true,
    label: '统计验证', icon: '✓', tagline: '数据确认',
  },
  medium: {
    color: '#6366f1', strokeWidth: 2, dashArray: 'none', glow: false,
    label: '多层支持', icon: '◐', tagline: '交叉验证',
  },
  low: {
    color: '#f59e0b', strokeWidth: 1.5, dashArray: '8 4', glow: false,
    label: 'AI 推断', icon: '◯', tagline: '待验证',
  },
  unverified: {
    color: '#64748b', strokeWidth: 1, dashArray: '3 3', glow: false,
    label: '假设', icon: '?', tagline: '需更多数据',
  },
}

const layerMeta: Record<number, { color: string; label: string; short: string }> = {
  3: { color: '#22c55e', label: '统计检验', short: '统计' },
  2: { color: '#6366f1', label: '持续监测', short: '监测' },
  1: { color: '#f59e0b', label: 'AI 推理', short: 'AI' },
}

const algoLabels: Record<string, string> = {
  llm: 'AI 推理', granger: 'Granger', pc: 'PC', fci: 'FCI', pcmci: 'PCMCI',
}


export default function CausalAnalysisScreen() {
  const [mode, setMode] = useState<InputMode>('text')
  const [question, setQuestion] = useState('')
  const [context, setContext] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [dataType, setDataType] = useState<'time_series' | 'cross_section'>('time_series')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<CausalAnalysisResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [inputCollapsed, setInputCollapsed] = useState(false)
  const [viewMode, setViewMode] = useState<ViewMode>('fused')
  const [selectedEdgeIdx, setSelectedEdgeIdx] = useState<number | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (f) {
      setFile(f)
      if (f.name.match(/\.(csv|tsv|xlsx?)$/i)) setMode('csv')
      else if (f.name.match(/\.(png|jpe?g|webp|gif)$/i)) setMode('screenshot')
    }
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    const f = e.dataTransfer.files[0]
    if (f) {
      setFile(f)
      if (f.name.match(/\.(csv|tsv|xlsx?)$/i)) setMode('csv')
      else if (f.name.match(/\.(png|jpe?g|webp|gif)$/i)) setMode('screenshot')
    }
  }, [])

  const handleSubmit = async () => {
    setLoading(true); setError(null); setResult(null); setSelectedEdgeIdx(null)
    try {
      let res: CausalAnalysisResult
      if (mode === 'csv' && file) res = await analyzeCSV(file, { question: question || undefined, data_type: dataType })
      else if (mode === 'screenshot' && file) res = await analyzeScreenshot(file, { question: question || undefined })
      else {
        if (!question.trim()) { setError('请输入你的问题'); setLoading(false); return }
        res = await analyzeText({ question, context: context || undefined })
      }
      setResult(res)
      setInputCollapsed(true)
    } catch (err: any) {
      setError(err.message || '分析失败')
    } finally { setLoading(false) }
  }

  const selectedEdge = result && selectedEdgeIdx !== null ? result.edges[selectedEdgeIdx] : null

  return (
    <div className="h-[calc(100vh-56px)] flex flex-col bg-surface-900">

      {/* ═══════════ INPUT BAR (collapsible) ═══════════ */}
      <div className={`border-b border-surface-700 bg-surface-800/80 backdrop-blur-sm transition-all ${inputCollapsed ? '' : ''}`}>
        <div className="max-w-7xl mx-auto px-4">
          {/* Collapsed header */}
          {inputCollapsed && result ? (
            <div className="flex items-center gap-3 py-2">
              <button onClick={() => setInputCollapsed(false)} className="text-text-muted hover:text-text-primary transition-colors">
                <ChevronDown size={16} />
              </button>
              <span className="text-xs text-text-secondary truncate flex-1">
                {question || '因果分析'} · {result.edges.length} 条关系 · {result.layers_used.map(l => layerMeta[l]?.short || `L${l}`).join('+')}
              </span>
              <button onClick={() => setInputCollapsed(false)} className="text-[11px] text-ocean-400 hover:text-ocean-300">
                修改问题
              </button>
            </div>
          ) : (
            /* Expanded input */
            <div className="py-4 space-y-3">
              <div className="flex items-center justify-between">
                <h1 className="text-sm font-bold text-text-primary">因果分析</h1>
                {result && (
                  <button onClick={() => setInputCollapsed(true)} className="text-text-muted hover:text-text-primary">
                    <ChevronUp size={16} />
                  </button>
                )}
              </div>

              {/* Mode tabs + input */}
              <div className="flex gap-2">
                {([
                  { id: 'text' as const, icon: MessageSquare, label: '文字' },
                  { id: 'csv' as const, icon: FileSpreadsheet, label: '数据' },
                  { id: 'screenshot' as const, icon: Image, label: '截图' },
                ] as const).map(tab => (
                  <button key={tab.id} onClick={() => setMode(tab.id)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                      mode === tab.id ? 'bg-ocean-500/15 text-ocean-400' : 'text-text-muted hover:text-text-secondary'
                    }`}>
                    <tab.icon size={12} /> {tab.label}
                  </button>
                ))}
              </div>

              <div className="flex gap-2">
                {/* File upload (compact) */}
                {(mode === 'csv' || mode === 'screenshot') && (
                  <div
                    onDragOver={e => e.preventDefault()} onDrop={handleDrop}
                    onClick={() => fileRef.current?.click()}
                    className="flex-1 border border-dashed border-surface-600 rounded-lg px-3 py-2 flex items-center gap-2 cursor-pointer hover:border-ocean-500/50 transition-colors"
                  >
                    <input ref={fileRef} type="file" className="hidden" accept={mode === 'csv' ? '.csv,.tsv,.xlsx,.xls' : '.png,.jpg,.jpeg,.webp,.gif'} onChange={handleFileChange} />
                    {file ? (
                      <>
                        <span className="text-xs text-text-primary truncate">{file.name}</span>
                        <button onClick={e => { e.stopPropagation(); setFile(null) }}><X size={12} className="text-text-muted" /></button>
                      </>
                    ) : (
                      <span className="text-xs text-text-muted">{mode === 'csv' ? '拖入 CSV/Excel' : '拖入截图'}</span>
                    )}
                  </div>
                )}

                {/* Question input */}
                <input
                  type="text" value={question} onChange={e => setQuestion(e.target.value)}
                  placeholder={mode === 'text' ? '改了定价之后转化率为什么下降了？' : '分析问题（可选）'}
                  className="flex-1 px-3 py-2 rounded-lg border border-surface-600 bg-surface-700 text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:border-ocean-500"
                  onKeyDown={e => e.key === 'Enter' && handleSubmit()}
                />

                <button onClick={handleSubmit} disabled={loading || (mode !== 'text' && !file)}
                  className="px-4 py-2 rounded-lg bg-ocean-500 text-white text-xs font-medium hover:bg-ocean-600 disabled:opacity-40 flex items-center gap-1.5 shrink-0">
                  {loading ? <Loader2 size={12} className="animate-spin" /> : null}
                  {loading ? '分析中' : '分析'}
                </button>
              </div>

              {/* Context (text mode, collapsible) */}
              {mode === 'text' && (
                <textarea value={context} onChange={e => setContext(e.target.value)} rows={2}
                  placeholder="补充背景：做了什么调整、观察到什么变化..."
                  className="w-full px-3 py-2 rounded-lg border border-surface-600 bg-surface-700 text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:border-ocean-500 resize-none" />
              )}

              {/* CSV data type selector */}
              {mode === 'csv' && (
                <div className="flex items-center gap-3">
                  {[{ id: 'time_series' as const, l: '时间序列' }, { id: 'cross_section' as const, l: '截面数据' }].map(o => (
                    <label key={o.id} className="flex items-center gap-1 cursor-pointer">
                      <input type="radio" name="dt" checked={dataType === o.id} onChange={() => setDataType(o.id)} className="accent-ocean-400 w-3 h-3" />
                      <span className="text-[11px] text-text-secondary">{o.l}</span>
                    </label>
                  ))}
                </div>
              )}

              {error && <div className="text-[11px] text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-1.5">{error}</div>}
            </div>
          )}
        </div>
      </div>

      {/* ═══════════ MAIN CONTENT ═══════════ */}
      {result ? (
        <div className="flex-1 flex min-h-0">

          {/* Left: Graph + controls */}
          <div className="flex-1 flex flex-col min-w-0">

            {/* Toolbar */}
            <div className="px-4 py-2 border-b border-surface-700 flex items-center gap-2">
              {/* View mode toggle */}
              <div className="flex items-center bg-surface-700 rounded-md p-0.5">
                <button onClick={() => { setViewMode('fused'); setSelectedEdgeIdx(null) }}
                  className={`flex items-center gap-1 text-[11px] px-2.5 py-1 rounded font-medium transition-colors ${viewMode === 'fused' ? 'bg-surface-600 text-text-primary shadow-sm' : 'text-text-muted'}`}>
                  <Eye size={11} /> 结论
                </button>
                <button onClick={() => { setViewMode('layers'); setSelectedEdgeIdx(null) }}
                  className={`flex items-center gap-1 text-[11px] px-2.5 py-1 rounded font-medium transition-colors ${viewMode === 'layers' ? 'bg-surface-600 text-text-primary shadow-sm' : 'text-text-muted'}`}>
                  <Layers size={11} /> 分层
                </button>
              </div>

              {/* Tier filter chips (fused mode) */}
              {viewMode === 'fused' && <TierFilterBar edges={result.edges} />}

              {/* Stats */}
              <div className="ml-auto flex items-center gap-3 text-[10px] text-text-muted">
                <span>{result.edges.length} 条关系</span>
                <span>{new Set(result.edges.flatMap(e => [e.source_label, e.target_label])).size} 个变量</span>
              </div>
            </div>

            {/* Graph area */}
            <div className="flex-1 overflow-auto p-4">
              {viewMode === 'fused' ? (
                <FusedGraphView
                  edges={result.edges}
                  selectedIdx={selectedEdgeIdx}
                  onSelect={setSelectedEdgeIdx}
                />
              ) : (
                <LayerComparisonView
                  edges={result.edges}
                  layersUsed={result.layers_used}
                />
              )}
            </div>

            {/* Bottom: summary */}
            {result.summary && (
              <div className="px-4 py-3 border-t border-surface-700 bg-surface-800/50">
                <p className="text-[11px] text-text-secondary leading-relaxed line-clamp-3">{result.summary}</p>
              </div>
            )}
          </div>

          {/* Right: Detail panel */}
          <AnimatePresence>
            {selectedEdge && (
              <motion.div
                initial={{ width: 0, opacity: 0 }} animate={{ width: 340, opacity: 1 }} exit={{ width: 0, opacity: 0 }}
                className="border-l border-surface-700 bg-surface-800 overflow-y-auto shrink-0"
              >
                <EdgeDetailPanel edge={selectedEdge} onClose={() => setSelectedEdgeIdx(null)} />
              </motion.div>
            )}
          </AnimatePresence>

        </div>
      ) : (
        /* Empty state */
        !loading && (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center max-w-md">
              <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-surface-800 border border-surface-700 flex items-center justify-center">
                <Layers size={24} className="text-text-muted" />
              </div>
              <h2 className="text-sm font-semibold text-text-primary mb-1">三层因果分析</h2>
              <p className="text-xs text-text-muted leading-relaxed">
                输入你的问题，上传数据或截图<br />
                系统会用统计检验 + AI 推理交叉验证因果关系
              </p>
            </div>
          </div>
        )
      )}
    </div>
  )
}


/* ════════════════════════════════════════════════════════
   TIER FILTER BAR — interactive legend
   ════════════════════════════════════════════════════════ */

function TierFilterBar({ edges }: { edges: FusedEdge[] }) {
  // Just show counts per tier (no filter state — keep it simple)
  const counts = useMemo(() => {
    const c: Record<string, number> = {}
    for (const e of edges) c[e.confidence_tier] = (c[e.confidence_tier] || 0) + 1
    return c
  }, [edges])

  return (
    <div className="flex items-center gap-1.5">
      {(['high', 'medium', 'low', 'unverified'] as const).map(tier => {
        const v = tierVisuals[tier]
        const n = counts[tier] || 0
        if (!n) return null
        return (
          <div key={tier} className="flex items-center gap-1 text-[10px] text-text-muted">
            <svg width="20" height="6" viewBox="0 0 20 6">
              <line x1="0" y1="3" x2="15" y2="3" stroke={v.color} strokeWidth={v.strokeWidth * 0.8} strokeDasharray={v.dashArray} />
              <polygon points="13,0.5 18,3 13,5.5" fill={v.color} />
            </svg>
            <span style={{ color: v.color }}>{n}</span>
          </div>
        )
      })}
    </div>
  )
}


/* ════════════════════════════════════════════════════════
   FUSED GRAPH VIEW — D3-style directed graph
   ════════════════════════════════════════════════════════ */

function FusedGraphView({ edges, selectedIdx, onSelect }: {
  edges: FusedEdge[]; selectedIdx: number | null; onSelect: (i: number | null) => void
}) {
  const layout = useMemo(() => computeLayout(edges), [edges])

  if (!layout.nodes.length) return <EmptyGraph />

  const nW = 130, nH = 30
  return (
    <svg viewBox={`0 0 ${layout.width} ${layout.height}`} className="w-full h-full" style={{ minHeight: 200 }}>
      <defs>
        <filter id="g" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="4" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
        {(['high','medium','low','unverified'] as const).map(t => (
          <marker key={t} id={`m-${t}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
            <path d="M0 1.5 L10 5 L0 8.5z" fill={tierVisuals[t].color} opacity={0.85} />
          </marker>
        ))}
      </defs>

      {/* Edges */}
      {edges.map((e, i) => {
        const sp = layout.pos[e.source_label], tp = layout.pos[e.target_label]
        if (!sp || !tp) return null
        const v = tierVisuals[e.confidence_tier] || tierVisuals.unverified
        const sx = sp.x + nW, sy = sp.y + nH / 2, tx = tp.x, ty = tp.y + nH / 2
        const mx = (sx + tx) / 2
        const sel = selectedIdx === i
        const dim = selectedIdx !== null && !sel
        return (
          <g key={i} opacity={dim ? 0.12 : 1} style={{ transition: 'opacity 0.25s', cursor: 'pointer' }} onClick={() => onSelect(sel ? null : i)}>
            {v.glow && <path d={`M${sx},${sy} C${mx},${sy} ${mx},${ty} ${tx},${ty}`} fill="none" stroke={v.color} strokeWidth={8} opacity={0.2} filter="url(#g)" />}
            <path d={`M${sx},${sy} C${mx},${sy} ${mx},${ty} ${tx},${ty}`} fill="none" stroke={v.color} strokeWidth={v.strokeWidth} strokeDasharray={v.dashArray} opacity={sel ? 1 : 0.8} markerEnd={`url(#m-${e.confidence_tier})`} />
            {/* Confidence badge on edge midpoint */}
            {sel && (
              <g>
                <circle cx={mx} cy={(sy+ty)/2} r={12} fill="#0f172a" stroke={v.color} strokeWidth={1.5} />
                <text x={mx} y={(sy+ty)/2+1} textAnchor="middle" dominantBaseline="central" fill={v.color} fontSize={9} fontWeight={700}>
                  {(e.fused_confidence*100).toFixed(0)}%
                </text>
              </g>
            )}
          </g>
        )
      })}

      {/* Nodes */}
      {layout.nodes.map(name => {
        const p = layout.pos[name]; if (!p) return null
        // Best tier for this node
        let best = 'unverified'
        const rank: Record<string, number> = { high: 3, medium: 2, low: 1, unverified: 0 }
        for (const e of edges) {
          if ((e.source_label === name || e.target_label === name) && (rank[e.confidence_tier] || 0) > (rank[best] || 0)) best = e.confidence_tier
        }
        const c = tierVisuals[best]?.color || '#64748b'
        // Is any connected edge selected?
        const highlighted = selectedIdx !== null && edges[selectedIdx] && (edges[selectedIdx].source_label === name || edges[selectedIdx].target_label === name)

        return (
          <g key={name}>
            {highlighted && <rect x={p.x - 2} y={p.y - 2} width={nW + 4} height={nH + 4} rx={8} fill="none" stroke={c} strokeWidth={2} opacity={0.4} />}
            <rect x={p.x} y={p.y} width={nW} height={nH} rx={6} fill="rgba(30,41,59,0.85)" stroke={c} strokeWidth={highlighted ? 1.5 : 0.8} />
            <text x={p.x + nW / 2} y={p.y + nH / 2 + 1} textAnchor="middle" dominantBaseline="central" fill="#e2e8f0" fontSize={11} fontWeight={600}>
              {name.length > 14 ? name.slice(0, 13) + '…' : name}
            </text>
          </g>
        )
      })}
    </svg>
  )
}


/* ════════════════════════════════════════════════════════
   LAYER COMPARISON VIEW — side-by-side columns
   ════════════════════════════════════════════════════════ */

function LayerComparisonView({ edges, layersUsed }: { edges: FusedEdge[]; layersUsed: number[] }) {
  // Group all evidence by layer
  const byLayer = useMemo(() => {
    const m: Record<number, { src: string; tgt: string; ev: CausalEvidence }[]> = {}
    for (const e of edges) for (const ev of e.evidence) {
      if (!m[ev.layer]) m[ev.layer] = []
      m[ev.layer].push({ src: e.source_label, tgt: e.target_label, ev })
    }
    return m
  }, [edges])

  // Find pairs that exist in multiple layers
  const multiLayerPairs = useMemo(() => {
    const pairLayers: Record<string, Set<number>> = {}
    for (const e of edges) {
      const k = `${e.source_label}\t${e.target_label}`
      if (!pairLayers[k]) pairLayers[k] = new Set()
      for (const ev of e.evidence) pairLayers[k].add(ev.layer)
    }
    return new Set(Object.entries(pairLayers).filter(([, s]) => s.size > 1).map(([k]) => k))
  }, [edges])

  const sorted = [...layersUsed].sort((a, b) => b - a) // Layer 3 first

  return (
    <div className="space-y-4">
      {/* Layer columns */}
      <div className={`grid gap-3 ${sorted.length >= 3 ? 'grid-cols-3' : sorted.length === 2 ? 'grid-cols-2' : 'grid-cols-1'}`}>
        {sorted.map(layer => {
          const meta = layerMeta[layer]
          const items = byLayer[layer] || []
          return (
            <div key={layer} className="rounded-lg overflow-hidden border border-surface-600">
              {/* Column header */}
              <div className="px-3 py-2" style={{ borderBottom: `2px solid ${meta.color}`, background: `${meta.color}08` }}>
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full" style={{ background: meta.color }} />
                  <span className="text-xs font-bold text-text-primary">{meta.label}</span>
                  <span className="ml-auto text-[10px] font-mono" style={{ color: meta.color }}>{items.length}</span>
                </div>
              </div>

              {/* Edges */}
              <div className="p-2 space-y-1 max-h-[400px] overflow-y-auto bg-surface-800/50">
                {items.length === 0 ? (
                  <div className="text-center py-6 text-[10px] text-text-muted">此层无结果</div>
                ) : items.map((item, i) => {
                  const pairKey = `${item.src}\t${item.tgt}`
                  const isMulti = multiLayerPairs.has(pairKey)
                  return (
                    <div key={i} className={`px-2.5 py-2 rounded-md ${isMulti ? 'border border-indigo-500/20 bg-indigo-500/5' : 'bg-surface-700/50'}`}>
                      <div className="flex items-center gap-1.5 text-[11px]">
                        <span className="text-text-primary font-medium truncate">{item.src}</span>
                        <span style={{ color: meta.color }}>→</span>
                        <span className="text-text-primary font-medium truncate">{item.tgt}</span>
                        {isMulti && <span className="ml-auto text-[9px] px-1 py-0.5 rounded bg-indigo-500/15 text-indigo-400 shrink-0">跨层</span>}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5 text-[10px] text-text-muted">
                        <span>{algoLabels[item.ev.algorithm] || item.ev.algorithm}</span>
                        {item.ev.p_value != null && <span className="font-mono text-emerald-400">p={item.ev.p_value < 0.001 ? '<.001' : item.ev.p_value.toFixed(3)}</span>}
                        <span className="font-mono">conf {(item.ev.confidence * 100).toFixed(0)}%</span>
                      </div>
                      {item.ev.reason && <p className="text-[10px] text-text-muted mt-1 line-clamp-2">{item.ev.reason}</p>}
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>

      {/* Cross-layer agreement */}
      {multiLayerPairs.size > 0 && (
        <div className="rounded-lg bg-indigo-500/5 border border-indigo-500/15 px-4 py-3">
          <div className="flex items-center gap-2 mb-2">
            <span className="w-2 h-2 rounded-full bg-indigo-400" />
            <span className="text-xs font-bold text-text-primary">跨层交叉验证 ({multiLayerPairs.size})</span>
          </div>
          <div className="space-y-1.5">
            {Array.from(multiLayerPairs).map(key => {
              const [src, tgt] = key.split('\t')
              const fused = edges.find(e => e.source_label === src && e.target_label === tgt)
              if (!fused) return null
              const v = tierVisuals[fused.confidence_tier]
              const layers = [...new Set(fused.evidence.map(e => e.layer))]
              return (
                <div key={key} className="flex items-center gap-2 text-[11px]">
                  <span className="w-4 text-center font-bold" style={{ color: v.color }}>{v.icon}</span>
                  <span className="text-text-primary font-medium">{src}</span>
                  <svg width="16" height="6" viewBox="0 0 16 6" className="shrink-0">
                    <line x1="0" y1="3" x2="11" y2="3" stroke={v.color} strokeWidth={v.strokeWidth * 0.7} strokeDasharray={v.dashArray} />
                    <polygon points="10,0.5 15,3 10,5.5" fill={v.color} />
                  </svg>
                  <span className="text-text-primary font-medium">{tgt}</span>
                  <span className="ml-auto text-text-muted">{layers.map(l => layerMeta[l]?.short || `L${l}`).join(' + ')}</span>
                  <span className="font-mono font-bold" style={{ color: v.color }}>{(fused.fused_confidence * 100).toFixed(0)}%</span>
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
   EDGE DETAIL PANEL — right sidebar
   ════════════════════════════════════════════════════════ */

function EdgeDetailPanel({ edge, onClose }: { edge: FusedEdge; onClose: () => void }) {
  const v = tierVisuals[edge.confidence_tier] || tierVisuals.unverified
  const layers = [...new Set(edge.evidence.map(e => e.layer))].sort((a, b) => b - a)

  return (
    <div className="p-4 space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold"
              style={{ background: `${v.color}20`, color: v.color, border: `1.5px solid ${v.color}50` }}>
              {v.icon}
            </span>
            <span className="text-xs font-bold" style={{ color: v.color }}>{v.label}</span>
          </div>
          <p className="text-[10px] text-text-muted mt-1">{v.tagline}</p>
        </div>
        <button onClick={onClose} className="p-1 rounded hover:bg-surface-700"><X size={14} className="text-text-muted" /></button>
      </div>

      {/* Edge pair */}
      <div className="bg-surface-700/50 rounded-lg px-3 py-2.5">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-text-primary">{edge.source_label}</span>
          <svg width="24" height="8" viewBox="0 0 24 8" className="shrink-0">
            <line x1="0" y1="4" x2="18" y2="4" stroke={v.color} strokeWidth={v.strokeWidth} strokeDasharray={v.dashArray} />
            <polygon points="16,1 22,4 16,7" fill={v.color} />
          </svg>
          <span className="text-xs font-semibold text-text-primary">{edge.target_label}</span>
        </div>
        <div className="flex items-center gap-3 mt-2">
          <div className="flex-1">
            <div className="text-[10px] text-text-muted mb-0.5">置信度</div>
            <div className="h-1.5 bg-surface-600 rounded-full overflow-hidden">
              <div className="h-full rounded-full" style={{ width: `${edge.fused_confidence * 100}%`, background: v.color }} />
            </div>
          </div>
          <span className="text-lg font-bold font-mono" style={{ color: v.color }}>{(edge.fused_confidence * 100).toFixed(0)}%</span>
        </div>
      </div>

      {/* Statistics */}
      {(edge.best_p_value != null || edge.best_lag != null) && (
        <div className="grid grid-cols-2 gap-2">
          {edge.best_p_value != null && (
            <div className="bg-surface-700/50 rounded-lg px-3 py-2">
              <div className="text-[10px] text-text-muted">p-value</div>
              <div className="text-sm font-mono font-bold text-emerald-400">
                {edge.best_p_value < 0.001 ? '< 0.001' : edge.best_p_value.toFixed(4)}
              </div>
            </div>
          )}
          {edge.best_lag != null && (
            <div className="bg-surface-700/50 rounded-lg px-3 py-2">
              <div className="text-[10px] text-text-muted">时间滞后</div>
              <div className="text-sm font-mono font-bold text-text-primary">{edge.best_lag} 期</div>
            </div>
          )}
        </div>
      )}

      {/* Evidence by layer */}
      <div>
        <h4 className="text-[11px] font-semibold text-text-secondary mb-2">证据来源 ({edge.evidence.length})</h4>
        {layers.map(layer => {
          const meta = layerMeta[layer]
          const evs = edge.evidence.filter(e => e.layer === layer)
          return (
            <div key={layer} className="mb-3">
              <div className="flex items-center gap-1.5 mb-1.5">
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: meta.color }} />
                <span className="text-[10px] font-semibold" style={{ color: meta.color }}>{meta.label}</span>
                <span className="text-[10px] text-text-muted">({evs.length})</span>
              </div>
              {evs.map((ev, j) => (
                <div key={j} className="ml-3 mb-1.5 pl-2.5 border-l-2" style={{ borderColor: `${meta.color}30` }}>
                  <div className="flex items-center gap-2 text-[11px]">
                    <span className="text-text-secondary font-medium">{algoLabels[ev.algorithm] || ev.algorithm}</span>
                    {ev.p_value != null && <span className="font-mono text-emerald-400">p={ev.p_value.toFixed(4)}</span>}
                    {ev.effect_size != null && <span className="font-mono text-text-muted">eff={ev.effect_size.toFixed(3)}</span>}
                  </div>
                  {ev.reason && <p className="text-[10px] text-text-muted mt-0.5 leading-relaxed">{ev.reason}</p>}
                </div>
              ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}


/* ════════════════════════════════════════════════════════
   LAYOUT COMPUTATION — BFS depth-based
   ════════════════════════════════════════════════════════ */

function computeLayout(edges: FusedEdge[]) {
  const nodeSet = new Set<string>()
  const adj: Record<string, string[]> = {}
  for (const e of edges) {
    nodeSet.add(e.source_label); nodeSet.add(e.target_label)
    if (!adj[e.source_label]) adj[e.source_label] = []
    adj[e.source_label].push(e.target_label)
  }
  const nodes = Array.from(nodeSet)
  if (!nodes.length) return { nodes: [], pos: {} as Record<string, { x: number; y: number }>, width: 0, height: 0 }

  // BFS depth
  const inDeg: Record<string, number> = {}
  for (const n of nodes) inDeg[n] = 0
  for (const e of edges) inDeg[e.target_label] = (inDeg[e.target_label] || 0) + 1
  const roots = nodes.filter(n => !inDeg[n])
  if (!roots.length) roots.push(nodes[0])

  const depth: Record<string, number> = {}
  const q = [...roots]
  for (const r of roots) depth[r] = 0
  while (q.length) { const c = q.shift()!; for (const nx of adj[c] || []) if (depth[nx] === undefined) { depth[nx] = (depth[c] || 0) + 1; q.push(nx) } }
  for (const n of nodes) if (depth[n] === undefined) depth[n] = 0

  const cols: Record<number, string[]> = {}; let maxC = 0
  for (const n of nodes) { const c = depth[n]; if (!cols[c]) cols[c] = []; cols[c].push(n); if (c > maxC) maxC = c }

  const cw = 180, rh = 50, pos: Record<string, { x: number; y: number }> = {}
  let maxH = 0
  for (let c = 0; c <= maxC; c++) {
    const items = cols[c] || []
    if (items.length > maxH) maxH = items.length
    items.forEach((n, i) => { pos[n] = { x: c * cw + 20, y: i * rh + 20 } })
  }
  return { nodes, pos, width: (maxC + 1) * cw + 40, height: maxH * rh + 20 }
}

function EmptyGraph() {
  return <div className="flex items-center justify-center h-full text-xs text-text-muted">暂无因果关系数据</div>
}
