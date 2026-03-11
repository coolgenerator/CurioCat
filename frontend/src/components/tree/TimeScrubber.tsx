import { useRef, useMemo, useCallback, useState } from 'react'
import { Clock, X } from 'lucide-react'
import type { CausalGraph, ClaimType } from '../../types/graph.ts'
import { useResizeObserver } from '../../hooks/useResizeObserver.ts'
import { useT } from '../../i18n/index.tsx'

interface TimeScrubberProps {
  graph: CausalGraph
  cumulativeTime: Map<string, number>
  maxTime: number
  value: number | null // null = show all
  onChange: (days: number | null) => void
  onClose: () => void
  getBeliefAtTime?: (nodeId: string, time: number) => number
}

// Layout constants
const PADDING_LEFT = 48
const PADDING_RIGHT = 16
const TRACK_Y = 24
const BAR_HEIGHT = 60

const CLAIM_COLORS: Record<ClaimType, string> = {
  FACT: '#22c55e',
  ASSUMPTION: '#eab308',
  PREDICTION: '#3b82f6',
  OPINION: '#a855f7',
}

/** Format days into short label */
function formatDays(days: number): string {
  if (days <= 0) return '0'
  if (days < 1) return '<1d'
  if (days < 7) return `${Math.round(days)}d`
  if (days < 30) return `${Math.round(days / 7)}w`
  if (days < 365) return `${Math.round(days / 30)}mo`
  return `${+(days / 365).toFixed(1)}y`
}

/** Generate nice tick values for a given max */
function generateTicks(max: number): number[] {
  if (max <= 0) return [0]
  const ticks: number[] = [0]

  // Choose tick interval based on range
  let interval: number
  if (max <= 7) interval = 1
  else if (max <= 30) interval = 7
  else if (max <= 180) interval = 30
  else if (max <= 730) interval = 90
  else interval = 365

  let v = interval
  while (v < max) {
    ticks.push(v)
    v += interval
  }
  // Always include the max
  if (ticks[ticks.length - 1] !== max) ticks.push(max)
  return ticks
}

export default function TimeScrubber({
  graph,
  cumulativeTime,
  maxTime,
  value,
  onChange,
  onClose,
  getBeliefAtTime,
}: TimeScrubberProps) {
  const { t } = useT()
  const containerRef = useRef<HTMLDivElement>(null)
  const { width } = useResizeObserver(containerRef)
  const [hoveredNode, setHoveredNode] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)

  const trackWidth = Math.max(0, width - PADDING_LEFT - PADDING_RIGHT)

  // Map days → x position
  const toX = useCallback((days: number) => {
    if (maxTime <= 0) return PADDING_LEFT
    return PADDING_LEFT + (days / maxTime) * trackWidth
  }, [maxTime, trackWidth])

  // Map x position → days
  const toDays = useCallback((x: number) => {
    if (trackWidth <= 0) return 0
    const clamped = Math.max(0, Math.min(x - PADDING_LEFT, trackWidth))
    return (clamped / trackWidth) * maxTime
  }, [maxTime, trackWidth])

  // Sorted node positions along the track
  const nodeMarkers = useMemo(() => {
    return graph.nodes
      .map((node) => ({
        id: node.id,
        days: cumulativeTime.get(node.id) ?? 0,
        claimType: node.claimType,
        text: node.text,
        isCriticalPath: node.isCriticalPath,
      }))
      .sort((a, b) => a.days - b.days)
  }, [graph.nodes, cumulativeTime])

  // Tick marks for the axis
  const ticks = useMemo(() => generateTicks(maxTime), [maxTime])

  // Handle thumb position
  const thumbX = value == null ? toX(maxTime) : toX(value)

  // Pointer interaction for dragging
  const handlePointerDown = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    const svg = e.currentTarget
    const rect = svg.getBoundingClientRect()
    const x = e.clientX - rect.left
    const days = toDays(x)
    onChange(days >= maxTime * 0.98 ? null : days)
    setDragging(true)
    svg.setPointerCapture(e.pointerId)
  }, [toDays, maxTime, onChange])

  const handlePointerMove = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    if (!dragging) return
    const svg = e.currentTarget
    const rect = svg.getBoundingClientRect()
    const x = e.clientX - rect.left
    const days = toDays(x)
    onChange(days >= maxTime * 0.98 ? null : days)
  }, [dragging, toDays, maxTime, onChange])

  const handlePointerUp = useCallback(() => {
    setDragging(false)
  }, [])

  // Count visible / total
  const visibleCount = value == null
    ? graph.nodes.length
    : nodeMarkers.filter((n) => n.days <= value).length

  return (
    <div
      ref={containerRef}
      className="bg-surface-800 border-t border-surface-700 shrink-0"
    >
      {/* Header row */}
      <div className="flex items-center gap-2 px-3 pt-2 pb-0.5">
        <Clock className="w-3 h-3 text-ocean-400" />
        <span className="text-[11px] font-medium text-text-secondary">{t.timeline.scrubber}</span>
        <span className="text-[10px] text-text-muted">
          {value != null && (
            <span className="text-ocean-400 mr-1">{visibleCount} /</span>
          )}
          {graph.nodes.length} {t.graph.nodes}
        </span>
        <span className="text-[11px] font-mono text-ocean-400 ml-auto mr-2">
          {value == null ? t.timeline.showAll : formatDays(value)}
        </span>
        <button
          onClick={onClose}
          className="p-0.5 rounded hover:bg-surface-700 text-text-muted hover:text-text-primary transition-colors"
        >
          <X className="w-3 h-3" />
        </button>
      </div>

      {/* SVG track */}
      <svg
        width={width}
        height={BAR_HEIGHT}
        className="cursor-crosshair select-none"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        {/* Dim overlay for filtered-out region */}
        {value != null && (
          <rect
            x={thumbX}
            y={0}
            width={Math.max(0, width - thumbX)}
            height={BAR_HEIGHT}
            fill="#0f172a"
            opacity={0.35}
          />
        )}

        {/* Track line */}
        <line
          x1={PADDING_LEFT}
          y1={TRACK_Y}
          x2={PADDING_LEFT + trackWidth}
          y2={TRACK_Y}
          stroke="#334155"
          strokeWidth={2}
          strokeLinecap="round"
        />

        {/* Active portion of track */}
        <line
          x1={PADDING_LEFT}
          y1={TRACK_Y}
          x2={thumbX}
          y2={TRACK_Y}
          stroke="#0ea5e9"
          strokeWidth={2}
          strokeLinecap="round"
        />

        {/* Tick marks + labels */}
        {ticks.map((tick) => {
          const x = toX(tick)
          return (
            <g key={tick}>
              <line
                x1={x}
                y1={TRACK_Y - 5}
                x2={x}
                y2={TRACK_Y + 5}
                stroke="#475569"
                strokeWidth={1}
              />
              <text
                x={x}
                y={BAR_HEIGHT - 4}
                textAnchor="middle"
                fontSize={9}
                fill="#64748b"
              >
                {formatDays(tick)}
              </text>
            </g>
          )
        })}

        {/* Node markers */}
        {nodeMarkers.map((node) => {
          const x = toX(node.days)
          const isFiltered = value != null && node.days > value
          const isHovered = hoveredNode === node.id
          const r = node.isCriticalPath ? 5 : 3.5
          // Temporal belief color when scrubber is at a specific time
          let markerFill: string
          if (isFiltered) {
            markerFill = '#334155'
          } else if (getBeliefAtTime && value != null) {
            const belief = getBeliefAtTime(node.id, value)
            markerFill = belief < 0.3 ? '#64748b' : belief < 0.6 ? '#eab308' : '#22c55e'
          } else {
            markerFill = CLAIM_COLORS[node.claimType]
          }
          return (
            <g key={node.id}>
              <circle
                cx={x}
                cy={TRACK_Y}
                r={isHovered ? r + 2 : r}
                fill={markerFill}
                opacity={isFiltered ? 0.3 : 0.9}
                stroke={isHovered ? '#e2e8f0' : node.isCriticalPath ? '#f59e0b' : 'none'}
                strokeWidth={isHovered ? 1.5 : node.isCriticalPath ? 1 : 0}
                onMouseEnter={() => setHoveredNode(node.id)}
                onMouseLeave={() => setHoveredNode(null)}
                style={{ pointerEvents: 'all', cursor: 'pointer', transition: 'r 0.15s, opacity 0.15s' }}
              />
              {/* Tooltip on hover */}
              {isHovered && (
                <g>
                  <rect
                    x={x - 80}
                    y={TRACK_Y - 38}
                    width={160}
                    height={22}
                    rx={4}
                    fill="#1e293b"
                    stroke="#475569"
                    strokeWidth={0.5}
                  />
                  <text
                    x={x}
                    y={TRACK_Y - 24}
                    textAnchor="middle"
                    fontSize={10}
                    fill="#e2e8f0"
                  >
                    {node.text.length > 30 ? node.text.slice(0, 29) + '\u2026' : node.text}
                  </text>
                </g>
              )}
            </g>
          )
        })}

        {/* Thumb / handle */}
        <line
          x1={thumbX}
          y1={TRACK_Y - 8}
          x2={thumbX}
          y2={TRACK_Y + 8}
          stroke="#0ea5e9"
          strokeWidth={2.5}
          strokeLinecap="round"
        />
        <circle
          cx={thumbX}
          cy={TRACK_Y}
          r={7}
          fill="#0ea5e9"
          stroke="#0c4a6e"
          strokeWidth={1.5}
          style={{ cursor: 'ew-resize' }}
        />
        <circle
          cx={thumbX}
          cy={TRACK_Y}
          r={2.5}
          fill="#0c4a6e"
        />
      </svg>
    </div>
  )
}
