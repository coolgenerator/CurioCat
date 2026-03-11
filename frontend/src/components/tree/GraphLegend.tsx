import { useState, useEffect, useCallback } from 'react'
import { Info, ChevronDown, ChevronRight, X } from 'lucide-react'
import { useT } from '../../i18n/index.tsx'

/* ── tiny SVG helpers ─────────────────────────────────────────────── */

function NodeShape({ dash, label }: { dash?: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <svg width={22} height={16} className="shrink-0">
        <rect
          x={1} y={1} width={20} height={14} rx={3}
          fill="none" stroke="#94a3b8" strokeWidth={1.5}
          strokeDasharray={dash}
        />
      </svg>
      <span className="text-xs text-text-secondary">{label}</span>
    </span>
  )
}

function DiamondShape({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <svg width={22} height={16} viewBox="0 0 22 16" className="shrink-0">
        <polygon
          points="11,1 21,8 11,15 1,8"
          fill="none" stroke="#94a3b8" strokeWidth={1.5}
        />
      </svg>
      <span className="text-xs text-text-secondary">{label}</span>
    </span>
  )
}

function EdgeLine({ color, dash, width, label }: { color: string; dash?: string; width?: number; label: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <svg width={32} height={12} className="shrink-0">
        <line
          x1={2} y1={6} x2={30} y2={6}
          stroke={color}
          strokeWidth={width ?? 2}
          strokeDasharray={dash}
          strokeLinecap="round"
        />
      </svg>
      <span className="text-xs text-text-secondary">{label}</span>
    </span>
  )
}

function ColorDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className="shrink-0 w-3 h-3 rounded-full" style={{ background: color }} />
      <span className="text-xs text-text-secondary">{label}</span>
    </span>
  )
}

/* ── collapsible section ──────────────────────────────────────────── */

function Section({ title, children, defaultOpen = true }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 w-full text-left py-1 text-xs font-medium text-text-primary hover:text-ocean-400 transition-colors"
      >
        {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        {title}
      </button>
      {open && <div className="flex flex-col gap-1.5 pl-4.5 pb-2">{children}</div>}
    </div>
  )
}

/* ── main legend ──────────────────────────────────────────────────── */

export default function GraphLegend() {
  const [open, setOpen] = useState(false)
  const { t } = useT()
  const leg = t.legend

  // Close on Escape
  const handleKey = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape' && open) setOpen(false)
  }, [open])

  useEffect(() => {
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [handleKey])

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="absolute bottom-4 left-4 z-20 flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-surface-800/90 backdrop-blur border border-surface-600 text-text-secondary hover:text-text-primary hover:border-surface-500 transition-colors shadow-lg"
      >
        <Info className="w-3.5 h-3.5" />
        {leg.toggle}
      </button>
    )
  }

  return (
    <div className="absolute bottom-4 left-4 z-20 w-72 max-h-[60vh] overflow-y-auto rounded-xl bg-surface-800/95 backdrop-blur border border-surface-600 shadow-xl">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-surface-700 sticky top-0 bg-surface-800/95 backdrop-blur rounded-t-xl">
        <span className="flex items-center gap-1.5 text-xs font-semibold text-text-primary">
          <Info className="w-3.5 h-3.5 text-ocean-400" />
          {leg.toggle}
        </span>
        <button
          onClick={() => setOpen(false)}
          className="p-0.5 rounded hover:bg-surface-700 text-text-muted hover:text-text-primary transition-colors"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Sections */}
      <div className="px-3 py-2 flex flex-col gap-1 divide-y divide-surface-700/50">
        {/* A. Node Shapes */}
        <Section title={leg.nodeShapes}>
          <NodeShape label={leg.factPrediction} />
          <NodeShape dash="6 3" label={leg.assumption} />
          <NodeShape dash="2 3" label={leg.opinion} />
          <DiamondShape label={leg.andGate} />
        </Section>

        {/* B. Node Colors */}
        <Section title={leg.nodeColors}>
          <span className="inline-flex items-center gap-2">
            <svg width={60} height={10} className="shrink-0">
              <defs>
                <linearGradient id="legend-conf-grad">
                  <stop offset="0%" stopColor="#ef4444" />
                  <stop offset="50%" stopColor="#eab308" />
                  <stop offset="100%" stopColor="#22c55e" />
                </linearGradient>
              </defs>
              <rect x={0} y={1} width={60} height={8} rx={4} fill="url(#legend-conf-grad)" />
            </svg>
            <span className="text-xs text-text-secondary">{leg.confidenceLow} → {leg.confidenceHigh}</span>
          </span>
          <span className="inline-flex items-center gap-2">
            <svg width={18} height={16} className="shrink-0">
              <rect x={2} y={2} width={14} height={12} rx={3} fill="none" stroke="#22d3ee" strokeWidth={2} opacity={0.8} />
            </svg>
            <span className="text-xs text-text-secondary">{leg.criticalPath}</span>
          </span>
          <span className="inline-flex items-center gap-2">
            <svg width={18} height={16} className="shrink-0">
              <rect x={1} y={1} width={16} height={14} rx={3} fill="none" stroke="#94a3b8" strokeWidth={1} />
              <circle cx={15} cy={3} r={4.5} fill="#8b5cf6" />
              <text x={15} y={5.5} textAnchor="middle" fill="white" fontSize={6} fontWeight="bold">3</text>
            </svg>
            <span className="text-xs text-text-secondary">{leg.convergence}</span>
          </span>
        </Section>

        {/* C. Edge Color (Evidence Score) */}
        <Section title={leg.edgeColor}>
          <ColorDot color="#3b82f6" label={leg.evidenceStrong} />
          <ColorDot color="#22c55e" label={leg.evidenceGood} />
          <ColorDot color="#f97316" label={leg.evidenceWeak} />
          <ColorDot color="#ef4444" label={leg.evidencePoor} />
        </Section>

        {/* D. Edge Style (Causal Type) */}
        <Section title={leg.edgeStyle}>
          <EdgeLine color="#94a3b8" label={leg.directCause} />
          <EdgeLine color="#94a3b8" dash="8 5" label={leg.indirectCause} />
          <EdgeLine color="#94a3b8" dash="2 4" label={leg.enablingCause} />
        </Section>

        {/* E. Edge Thickness */}
        <Section title={leg.edgeThickness}>
          <EdgeLine color="#94a3b8" width={1} label={leg.thinEdge} />
          <EdgeLine color="#94a3b8" width={5} label={leg.thickEdge} />
        </Section>

        {/* F. Warnings */}
        <Section title={leg.warnings}>
          <span className="inline-flex items-center gap-2">
            <span className="text-amber-400 text-sm shrink-0">&#9888;</span>
            <span className="text-xs text-text-secondary">{leg.biasWarning}</span>
          </span>
        </Section>
      </div>
    </div>
  )
}
