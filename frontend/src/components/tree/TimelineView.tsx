import { useMemo, useState, useCallback } from 'react'
import { Clock } from 'lucide-react'
import type { CausalGraph, CausalNode } from '../../types/graph.ts'
import { useT } from '../../i18n/index.tsx'
import { formatTimeDelayShort, parseTimeDelayDays } from '../../lib/visualConstants.ts'
import Badge from '../ui/Badge.tsx'

interface TimelineViewProps {
  graph: CausalGraph
  cumulativeTime: Map<string, number>
  selectedNodeId: string | null
  onNodeClick: (nodeId: string) => void
}

interface TimelineGroup {
  label: string
  days: number
  nodes: CausalNode[]
}

/** Format cumulative days into a readable label */
function formatDaysLabel(days: number): string {
  if (days <= 0) return 'Day 0'
  if (days < 1) return '< 1 day'
  if (days < 7) return `Day ${Math.round(days)}`
  if (days < 30) return `~${Math.round(days / 7)}w`
  if (days < 365) return `~${Math.round(days / 30)}mo`
  return `~${+(days / 365).toFixed(1)}y`
}

function confidenceColor(val: number): string {
  if (val >= 0.7) return 'bg-confidence-high/15 border-confidence-high/30 text-confidence-high'
  if (val >= 0.4) return 'bg-confidence-medium/15 border-confidence-medium/30 text-confidence-medium'
  return 'bg-confidence-low/15 border-confidence-low/30 text-confidence-low'
}

export default function TimelineView({
  graph,
  cumulativeTime,
  selectedNodeId,
  onNodeClick,
}: TimelineViewProps) {
  const { t } = useT()

  // Filter state: indices of selected groups. Empty = show all.
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set())
  // Track last clicked index for shift-click range selection
  const [lastClickedIndex, setLastClickedIndex] = useState<number | null>(null)

  // Group nodes by their cumulative time into buckets
  const groups = useMemo(() => {
    const maxTime = Math.max(1, ...Array.from(cumulativeTime.values()))
    const hasTimeData = Array.from(cumulativeTime.values()).some((v) => v > 0)

    if (!hasTimeData) {
      return [{
        label: t.timeline.originLabel,
        days: 0,
        nodes: [...graph.nodes].sort((a, b) => a.orderIndex - b.orderIndex),
      }]
    }

    let bucketSize: number
    if (maxTime <= 7) bucketSize = 1
    else if (maxTime <= 60) bucketSize = 7
    else if (maxTime <= 365) bucketSize = 30
    else bucketSize = 365

    const bucketMap = new Map<number, CausalNode[]>()
    for (const node of graph.nodes) {
      const days = cumulativeTime.get(node.id) ?? 0
      const bucket = Math.floor(days / bucketSize) * bucketSize
      if (!bucketMap.has(bucket)) bucketMap.set(bucket, [])
      bucketMap.get(bucket)!.push(node)
    }

    const sorted = [...bucketMap.entries()].sort((a, b) => a[0] - b[0])
    return sorted.map(([days, nodes]): TimelineGroup => ({
      label: days === 0 ? t.timeline.originLabel : formatDaysLabel(days),
      days,
      nodes: nodes.sort((a, b) => a.orderIndex - b.orderIndex),
    }))
  }, [graph.nodes, cumulativeTime, t])

  // Handle chip click: toggle single, shift-click for range
  const handleChipClick = useCallback((index: number, shiftKey: boolean) => {
    setSelectedIndices((prev) => {
      // Shift-click: select range from last clicked to current
      if (shiftKey && lastClickedIndex !== null) {
        const next = new Set(prev)
        const lo = Math.min(lastClickedIndex, index)
        const hi = Math.max(lastClickedIndex, index)
        for (let i = lo; i <= hi; i++) next.add(i)
        return next
      }

      // Single click: toggle
      const next = new Set(prev)
      if (next.has(index)) {
        next.delete(index)
      } else {
        next.add(index)
      }
      return next
    })
    setLastClickedIndex(index)
  }, [lastClickedIndex])

  const handleShowAll = useCallback(() => {
    setSelectedIndices(new Set())
    setLastClickedIndex(null)
  }, [])

  // Visible groups
  const showAll = selectedIndices.size === 0
  const visibleGroups = showAll
    ? groups
    : groups.filter((_, i) => selectedIndices.has(i))

  const visibleNodeCount = visibleGroups.reduce((sum, g) => sum + g.nodes.length, 0)

  // Find incoming edges for a node to show time delay context
  const getIncomingDelay = (nodeId: string) => {
    const edges = graph.edges.filter((e) => e.targetId === nodeId && e.timeDelay)
    if (edges.length === 0) return null
    let maxEdge = edges[0]
    for (const e of edges) {
      if (parseTimeDelayDays(e.timeDelay) > parseTimeDelayDays(maxEdge.timeDelay)) {
        maxEdge = e
      }
    }
    return formatTimeDelayShort(maxEdge.timeDelay)
  }

  return (
    <div className="w-full h-full flex flex-col bg-surface-900">
      {/* Header + Filter bar */}
      <div className="shrink-0 px-4 pt-4 pb-3 border-b border-surface-700">
        <div className="max-w-2xl mx-auto">
          {/* Title row */}
          <div className="flex items-center gap-2 mb-3">
            <Clock className="w-4 h-4 text-ocean-400" />
            <h2 className="text-sm font-semibold text-text-primary">{t.timeline.title}</h2>
            <span className="text-xs text-text-muted ml-auto">
              {!showAll && (
                <span className="text-ocean-400 mr-1">
                  {t.timeline.visibleCount} {visibleNodeCount} /
                </span>
              )}
              {graph.nodes.length} {t.graph.nodes}
            </span>
          </div>

          {/* Time period chips */}
          {groups.length > 1 && (
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-thin">
              {/* All chip */}
              <button
                onClick={handleShowAll}
                className={`shrink-0 flex items-center gap-1 px-2 py-1 text-[11px] rounded-md border transition-colors ${
                  showAll
                    ? 'bg-ocean-500/15 text-ocean-400 border-ocean-500/30'
                    : 'bg-surface-700 text-text-muted border-surface-600 hover:text-text-secondary hover:border-surface-500'
                }`}
              >
                {t.timeline.allPeriods}
              </button>

              {/* Period chips */}
              {groups.map((group, gi) => {
                const isActive = selectedIndices.has(gi)
                return (
                  <button
                    key={gi}
                    onClick={(e) => handleChipClick(gi, e.shiftKey)}
                    className={`shrink-0 flex items-center gap-1 px-2 py-1 text-[11px] rounded-md border transition-colors ${
                      isActive
                        ? 'bg-ocean-500/15 text-ocean-400 border-ocean-500/30'
                        : showAll
                          ? 'bg-surface-800 text-text-secondary border-surface-600 hover:text-text-primary hover:border-surface-500'
                          : 'bg-surface-800 text-text-muted border-surface-700 hover:text-text-secondary hover:border-surface-600'
                    }`}
                  >
                    <span>{group.label}</span>
                    <span className={`text-[9px] ${isActive ? 'text-ocean-400/60' : 'text-text-muted/60'}`}>
                      {group.nodes.length}
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* Timeline content */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        <div className="max-w-2xl mx-auto">
          <div className="relative">
            {/* Vertical line */}
            <div className="absolute left-[72px] top-0 bottom-0 w-px bg-surface-600" />

            {visibleGroups.map((group) => (
              <div key={group.days} className="relative mb-6">
                {/* Time marker */}
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-[72px] text-right shrink-0">
                    <span className="text-[11px] font-medium text-ocean-400">{group.label}</span>
                  </div>
                  <div className="w-2.5 h-2.5 rounded-full bg-ocean-400 border-2 border-surface-900 relative z-10 shrink-0" />
                  <div className="h-px flex-1 bg-surface-700" />
                  <span className="text-[10px] text-text-muted shrink-0">
                    {group.nodes.length} {t.timeline.eventsCount}
                  </span>
                </div>

                {/* Event cards */}
                <div className="ml-[88px] space-y-2">
                  {group.nodes.map((node) => {
                    const isSelected = node.id === selectedNodeId
                    const delay = getIncomingDelay(node.id)
                    return (
                      <div
                        key={node.id}
                        onClick={() => onNodeClick(node.id)}
                        className={`
                          p-3 rounded-lg border cursor-pointer transition-all
                          ${isSelected
                            ? 'bg-ocean-500/10 border-ocean-500/40 ring-1 ring-ocean-500/20'
                            : 'bg-surface-800 border-surface-700 hover:border-surface-500 hover:bg-surface-750'
                          }
                        `}
                      >
                        <div className="flex items-start gap-2">
                          <Badge type={node.claimType} />
                          {delay && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface-700 text-text-muted border border-surface-600 shrink-0">
                              +{delay}
                            </span>
                          )}
                          {node.isCriticalPath && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-ocean-500/15 text-ocean-400 border border-ocean-500/30 shrink-0">
                              CP
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-text-primary leading-relaxed mt-1.5">
                          {node.text}
                        </p>
                        <div className="flex items-center gap-3 mt-2">
                          <span className={`text-[10px] px-1.5 py-0.5 rounded border ${confidenceColor(node.confidence)}`}>
                            {(node.confidence * 100).toFixed(0)}%
                          </span>
                          {node.belief !== null && (
                            <span className="text-[10px] text-text-muted">
                              belief: {node.belief.toFixed(2)}
                            </span>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}

            {/* Empty state when filter yields no results */}
            {visibleGroups.length === 0 && (
              <div className="flex items-center justify-center py-12">
                <span className="text-xs text-text-muted">{t.timeline.noTimeData}</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
