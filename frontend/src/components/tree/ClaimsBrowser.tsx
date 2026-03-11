import { useMemo, useState, useRef, useEffect } from 'react'
import { Search, ChevronDown, ChevronRight } from 'lucide-react'
import type { CausalGraph, CausalNode } from '../../types/graph.ts'
import { computeDepths } from '../../lib/graphUtils.ts'
import { useT } from '../../i18n/index.tsx'
import Badge from '../ui/Badge.tsx'

interface ClaimsBrowserProps {
  graph: CausalGraph
  selectedNodeId: string | null
  onNodeClick: (nodeId: string) => void
}

function confidenceDotColor(val: number): string {
  if (val >= 0.7) return 'bg-confidence-high'
  if (val >= 0.4) return 'bg-confidence-medium'
  return 'bg-confidence-low'
}

export default function ClaimsBrowser({ graph, selectedNodeId, onNodeClick }: ClaimsBrowserProps) {
  const { t } = useT()
  const [searchQuery, setSearchQuery] = useState('')
  const [collapsedDepths, setCollapsedDepths] = useState<Set<number>>(new Set())
  const selectedRef = useRef<HTMLDivElement>(null)

  // Compute depths and group nodes
  const grouped = useMemo(() => {
    const { depths } = computeDepths(graph.nodes, graph.edges)
    const groups = new Map<number, CausalNode[]>()

    for (const node of graph.nodes) {
      const d = depths.get(node.id) ?? 0
      const list = groups.get(d) ?? []
      list.push(node)
      groups.set(d, list)
    }

    // Sort groups by depth key
    return [...groups.entries()].sort((a, b) => a[0] - b[0])
  }, [graph])

  // Filter by search
  const filteredGrouped = useMemo(() => {
    if (!searchQuery.trim()) return grouped
    const q = searchQuery.toLowerCase()
    return grouped
      .map(([depth, nodes]) => [depth, nodes.filter((n) => n.text.toLowerCase().includes(q))] as [number, CausalNode[]])
      .filter(([, nodes]) => nodes.length > 0)
  }, [grouped, searchQuery])

  // Auto-scroll to selected claim
  useEffect(() => {
    if (selectedNodeId && selectedRef.current) {
      selectedRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  }, [selectedNodeId])

  const toggleDepth = (depth: number) => {
    setCollapsedDepths((prev) => {
      const next = new Set(prev)
      if (next.has(depth)) next.delete(depth)
      else next.add(depth)
      return next
    })
  }

  return (
    <div className="h-full flex flex-col bg-surface-800 border-r border-surface-700">
      {/* Header */}
      <div className="px-3 py-3 border-b border-surface-700 shrink-0">
        <h3 className="text-sm font-semibold text-text-primary mb-2">
          {t.claimsBrowser?.title ?? 'Claims'}
        </h3>
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t.claimsBrowser?.search ?? 'Search claims...'}
            className="w-full pl-7 pr-2 py-1.5 text-xs bg-surface-700 border border-surface-600 rounded-lg text-text-primary placeholder-text-muted focus:outline-none focus:border-ocean-500 transition-colors"
          />
        </div>
      </div>

      {/* Claim groups */}
      <div className="flex-1 overflow-y-auto">
        {filteredGrouped.map(([depth, nodes]) => {
          const isCollapsed = collapsedDepths.has(depth)
          return (
            <div key={depth}>
              {/* Depth header */}
              <button
                onClick={() => toggleDepth(depth)}
                className="w-full flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-medium text-text-muted bg-surface-700/50 hover:bg-surface-700 transition-colors sticky top-0 z-[1]"
              >
                {isCollapsed ? (
                  <ChevronRight className="w-3 h-3" />
                ) : (
                  <ChevronDown className="w-3 h-3" />
                )}
                {t.claimsBrowser?.depthLabel ?? 'Depth'} {depth}
                <span className="ml-auto text-text-muted">{nodes.length}</span>
              </button>

              {/* Claim rows */}
              {!isCollapsed && nodes.map((node) => {
                const isSelected = node.id === selectedNodeId
                return (
                  <div
                    key={node.id}
                    ref={isSelected ? selectedRef : undefined}
                    onClick={() => onNodeClick(node.id)}
                    className={`px-3 py-2 cursor-pointer transition-colors border-l-2 ${
                      isSelected
                        ? 'border-l-ocean-500 bg-ocean-500/10'
                        : 'border-l-transparent hover:bg-surface-700/50'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <Badge type={node.claimType} className="text-[10px] px-1.5 py-0" />
                      <div className={`w-2 h-2 rounded-full shrink-0 ${confidenceDotColor(node.confidence)}`} />
                    </div>
                    <p className="text-xs text-text-secondary line-clamp-2 leading-relaxed">
                      {node.text}
                    </p>
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>
    </div>
  )
}
