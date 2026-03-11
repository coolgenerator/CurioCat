import { useRef, useEffect, useCallback, useState } from 'react'
import { select } from 'd3-selection'
import { zoom, zoomIdentity, type ZoomBehavior } from 'd3-zoom'
import { drag } from 'd3-drag'
import { scaleLinear } from 'd3-scale'
import 'd3-transition'
import type { BeliefChange, CausalGraph, CausalType, ClaimType, PathInfo, ViewMode } from '../../types/graph.ts'
import { EDGE_DASH, edgeStrokeWidth } from '../../lib/visualConstants.ts'
import {
  useForceLayout,
  CONVERGENCE_SCALE,
  type ForceNode,
  type ForceLink,
} from '../../hooks/useForceLayout.ts'
import { useResizeObserver } from '../../hooks/useResizeObserver.ts'
import GraphTooltip, { type TooltipData } from './GraphTooltip.tsx'
import MiniMap, { type MiniMapHandle } from './MiniMap.tsx'

// --- Props ---

interface ForceGraphProps {
  graph: CausalGraph
  onNodeClick: (nodeId: string) => void
  onEdgeClick: (edgeId: string, allEdgeIds?: string[]) => void
  onEdgeStrengthChange: (edgeId: string, strength: number) => void
  selectedNodeId?: string | null
  selectedEdgeId?: string | null
  filters: { depthLimit: number | null; searchQuery: string }
  viewMode?: ViewMode
  focusNodeId?: string | null
  focusVisibleIds?: Set<string>
  focusPaths?: PathInfo[]
  activePathIndex?: number | null
  compareChanges?: Record<string, BeliefChange>
  timeFilter?: number | null
  cumulativeTime?: Map<string, number>
  getBeliefAtTime?: (nodeId: string, time: number) => number
}

// Path colors for focus mode
const PATH_COLORS = ['#f97316', '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16', '#f59e0b']

// Secondary hover color in focus mode (purple — distinct from ocean blue)
const FOCUS_HOVER_COLOR = '#8b5cf6'

// --- Color scales ---

const confidenceColor = scaleLinear<string>()
  .domain([0, 0.4, 0.7, 1])
  .range(['#ef4444', '#ef4444', '#eab308', '#22c55e'])
  .clamp(true)

const beliefColor = scaleLinear<string>()
  .domain([0, 0.3, 0.6, 1])
  .range(['#64748b', '#ef4444', '#eab308', '#22c55e'])
  .clamp(true)

function edgeColor(evidenceScore: number): string {
  if (evidenceScore >= 0.75) return '#3b82f6'   // blue - strong
  if (evidenceScore >= 0.5) return '#22c55e'     // green - good
  if (evidenceScore >= 0.25) return '#f97316'    // orange - weak
  return '#ef4444'                                // red - poor
}

function borderDash(claimType: ClaimType): string {
  switch (claimType) {
    case 'ASSUMPTION': return '6 4'
    case 'OPINION': return '2 2'
    default: return 'none'
  }
}

// --- Helpers ---

function truncateText(text: string, maxLen: number): string {
  return text.length > maxLen ? text.slice(0, maxLen - 1) + '\u2026' : text
}

function bezierPath(sx: number, sy: number, tx: number, ty: number): string {
  const midY = (sy + ty) / 2
  return `M ${sx},${sy} C ${sx},${midY} ${tx},${midY} ${tx},${ty}`
}

// --- Theme-aware CSS variable reader ---

function getGraphTheme(): {
  nodeFill: string; nodeText: string
  collapseFill: string; collapseStroke: string; collapseText: string
  convergenceStroke: string; edgeDimmed: string
} {
  const s = getComputedStyle(document.documentElement)
  return {
    nodeFill: s.getPropertyValue('--graph-node-fill').trim() || 'rgba(30,41,59,0.65)',
    nodeText: s.getPropertyValue('--graph-node-text').trim() || '#f1f5f9',
    collapseFill: s.getPropertyValue('--graph-collapse-fill').trim() || '#1e293b',
    collapseStroke: s.getPropertyValue('--graph-collapse-stroke').trim() || '#475569',
    collapseText: s.getPropertyValue('--graph-collapse-text').trim() || '#94a3b8',
    convergenceStroke: s.getPropertyValue('--graph-convergence-stroke').trim() || '#1e1b4b',
    edgeDimmed: s.getPropertyValue('--graph-edge-dimmed').trim() || '#334155',
  }
}

// --- Component ---

export default function ForceGraph({
  graph,
  onNodeClick,
  onEdgeClick,
  onEdgeStrengthChange,
  selectedNodeId,
  selectedEdgeId,
  filters,
  viewMode = 'panorama',
  focusNodeId,
  focusVisibleIds,
  focusPaths,
  activePathIndex,
  compareChanges,
  timeFilter,
  cumulativeTime,
  getBeliefAtTime,
}: ForceGraphProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const zoomBehaviorRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null)
  const miniMapRef = useRef<MiniMapHandle>(null)
  const [collapsedNodes, setCollapsedNodes] = useState<Set<string>>(new Set())

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{
    x: number; y: number; edgeId: string; strength: number
  } | null>(null)

  // Tooltip state
  const [tooltip, setTooltip] = useState<TooltipData | null>(null)
  const tooltipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hasRenderedRef = useRef(false)
  const selectedNodeIdRef = useRef(selectedNodeId)
  const selectedEdgeIdRef = useRef(selectedEdgeId)
  const focusNodeIdRef = useRef(focusNodeId)
  selectedNodeIdRef.current = selectedNodeId
  selectedEdgeIdRef.current = selectedEdgeId
  focusNodeIdRef.current = focusNodeId

  // Stable refs for callback props — prevents heavy D3 effect from re-running on selection changes
  const onNodeClickRef = useRef(onNodeClick)
  const onEdgeClickRef = useRef(onEdgeClick)
  const onEdgeStrengthChangeRef = useRef(onEdgeStrengthChange)
  const getBeliefAtTimeRef = useRef(getBeliefAtTime)
  onNodeClickRef.current = onNodeClick
  onEdgeClickRef.current = onEdgeClick
  onEdgeStrengthChangeRef.current = onEdgeStrengthChange
  getBeliefAtTimeRef.current = getBeliefAtTime

  const { width, height } = useResizeObserver(containerRef)
  // Refs so D3 effect doesn't re-run on resize (panel open/close)
  const widthRef = useRef(width)
  const heightRef = useRef(height)
  widthRef.current = width
  heightRef.current = height
  // Boolean flag: triggers D3 effect once when dimensions first become available
  const hasDimensions = width > 0 && height > 0

  // Simulation tick: update DOM positions directly (no React re-render)
  const handleSimTick = useCallback(() => {
    if (!svgRef.current) return
    const svg = select(svgRef.current)
    const selNode = selectedNodeIdRef.current

    const focNode = focusNodeIdRef.current
    svg.selectAll<SVGGElement, ForceNode>('g.node')
      .attr('transform', (d) =>
        (d.id === selNode || d.id === focNode)
          ? `translate(${d.x},${d.y}) scale(1.08)`
          : `translate(${d.x},${d.y})`,
      )

    svg.selectAll<SVGPathElement, ForceLink>('path.edge-line')
      .attr('d', (d) => bezierPath(d.source.x, d.source.y, d.target.x, d.target.y))

    svg.selectAll<SVGPathElement, ForceLink>('path.edge-hitbox')
      .attr('d', (d) => bezierPath(d.source.x, d.source.y, d.target.x, d.target.y))

    svg.selectAll<SVGPathElement, ForceLink>('path.edge-glow')
      .attr('d', (d) => bezierPath(d.source.x, d.source.y, d.target.x, d.target.y))

    // Update bundle badge positions
    svg.selectAll<SVGGElement, ForceLink>('g.bundle-badge')
      .attr('transform', (d) => {
        const mx = (d.source.x + d.target.x) / 2
        const my = (d.source.y + d.target.y) / 2
        return `translate(${mx},${my})`
      })

    // Update MiniMap
    miniMapRef.current?.redraw()
  }, [])

  const { layout, reheat } = useForceLayout(graph, {
    depthLimit: filters.depthLimit,
    collapsedNodes,
    width,
    height,
    onTick: handleSimTick,
  })

  // Close context menu on click outside
  useEffect(() => {
    function handleClick() { setContextMenu(null) }
    document.addEventListener('click', handleClick)
    return () => document.removeEventListener('click', handleClick)
  }, [])

  // Stable node click handler (uses ref, never changes)
  const handleNodeClick = useCallback((nodeId: string) => {
    onNodeClickRef.current(nodeId)
  }, [])

  // Stable edge click handler (uses ref, never changes)
  const handleEdgeClick = useCallback((edgeId: string, allEdgeIds?: string[]) => {
    onEdgeClickRef.current(edgeId, allEdgeIds)
  }, [])

  // Double-click handler: toggle collapse
  const handleNodeDblClick = useCallback((nodeId: string) => {
    setCollapsedNodes((prev) => {
      const next = new Set(prev)
      if (next.has(nodeId)) {
        next.delete(nodeId)
      } else {
        next.add(nodeId)
      }
      return next
    })
  }, [])

  // --- D3 rendering ---
  useEffect(() => {
    if (!svgRef.current || !layout || widthRef.current === 0 || heightRef.current === 0) return

    const svg = select(svgRef.current)
    const theme = getGraphTheme()
    const isFocus = viewMode === 'focus' && focusVisibleIds && focusVisibleIds.size > 0

    // Clear previous content but keep defs
    svg.selectAll('g.graph-root').remove()

    // --- Defs ---
    let defs = svg.select<SVGDefsElement>('defs')
    if (defs.empty()) {
      defs = svg.append('defs')
    }
    defs.selectAll('*').remove()

    // Glow filter for critical path
    const glowFilter = defs.append('filter')
      .attr('id', 'glow-critical')
      .attr('x', '-50%').attr('y', '-50%')
      .attr('width', '200%').attr('height', '200%')
    glowFilter.append('feGaussianBlur')
      .attr('class', 'glow-blur')
      .attr('in', 'SourceGraphic')
      .attr('stdDeviation', '4')
      .attr('result', 'blur')
    glowFilter.append('feMerge')
      .selectAll('feMergeNode')
      .data(['blur', 'SourceGraphic'])
      .enter()
      .append('feMergeNode')
      .attr('in', (d) => d)

    // Desaturate filter for dimmed elements
    const dimFilter = defs.append('filter').attr('id', 'dim-grayscale')
    dimFilter.append('feColorMatrix')
      .attr('type', 'saturate')
      .attr('values', '0')

    // --- Root group (zoom/pan target) ---
    const rootG = svg.append('g').attr('class', 'graph-root')

    // --- Zoom behavior ---
    const zoomBehavior = zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.2, 5])
      .on('zoom', (event) => {
        rootG.attr('transform', event.transform.toString())
      })

    svg.call(zoomBehavior)
    zoomBehaviorRef.current = zoomBehavior

    // --- Search query matching ---
    const searchQuery = filters.searchQuery.toLowerCase().trim()
    const matchingNodeIds = new Set<string>()
    if (searchQuery) {
      // Build parentIds map for BFS backtracking
      const parentIdsMap = new Map(layout.nodes.map((n) => [n.id, n.parentIds]))

      for (const node of layout.nodes) {
        if (node.data.text.toLowerCase().includes(searchQuery)) {
          matchingNodeIds.add(node.id)
          // BFS up through all parents (multi-parent aware)
          const backQueue = [...(parentIdsMap.get(node.id) ?? [])]
          const backVisited = new Set<string>([node.id])
          while (backQueue.length > 0) {
            const pid = backQueue.shift()!
            if (backVisited.has(pid)) continue
            backVisited.add(pid)
            matchingNodeIds.add(pid)
            for (const grandParent of parentIdsMap.get(pid) ?? []) {
              if (!backVisited.has(grandParent)) backQueue.push(grandParent)
            }
          }
        }
      }
    }

    // --- Focus mode: compute active path edges and nodes ---
    const activePathEdgeSet = new Set<string>()
    const activePathNodeSet = new Set<string>()
    let activePathColor = PATH_COLORS[0]
    if (viewMode === 'focus' && focusPaths && activePathIndex != null && focusPaths[activePathIndex]) {
      const activePath = focusPaths[activePathIndex].path
      activePathColor = PATH_COLORS[activePathIndex % PATH_COLORS.length]
      for (const nodeId of activePath) {
        activePathNodeSet.add(nodeId)
      }
      for (let k = 0; k < activePath.length - 1; k++) {
        activePathEdgeSet.add(`${activePath[k]}->${activePath[k + 1]}`)
      }
    }

    // --- Focus mode: BFS distance map from focus node ---
    const focusDistance = new Map<string, number>()
    if (isFocus && focusNodeId) {
      focusDistance.set(focusNodeId, 0)
      const queue = [focusNodeId]
      while (queue.length > 0) {
        const id = queue.shift()!
        const dist = focusDistance.get(id)!
        for (const link of layout.links) {
          let neighbor: string | null = null
          if (link.source.id === id) neighbor = link.target.id
          else if (link.target.id === id) neighbor = link.source.id
          if (neighbor && !focusDistance.has(neighbor) && focusVisibleIds!.has(neighbor)) {
            focusDistance.set(neighbor, dist + 1)
            queue.push(neighbor)
          }
        }
      }
    }

    // Focus node's direct edge IDs (all edges in bundles touching focus node)
    const focusDirectEdgeIds = new Set<string>()
    if (isFocus && focusNodeId) {
      for (const link of layout.links) {
        if (link.source.id === focusNodeId || link.target.id === focusNodeId) {
          for (const e of link.edges) focusDirectEdgeIds.add(e.id)
        }
      }
    }

    // Helper: is this node in the focus subgraph?
    function isFocusVisible(nodeId: string): boolean {
      if (!isFocus) return true
      return focusDistance.get(nodeId) !== undefined
    }

    // Helper: graduated node opacity for focus mode
    function focusNodeOpacity(nodeId: string): number {
      if (!isFocus) return 1
      const d = focusDistance.get(nodeId)
      if (d === undefined) return 0.12  // unfocused: very faint
      if (d <= 1) return 1
      if (d === 2) return 0.85
      return 0.6
    }

    // Helper: graduated edge opacity for focus mode
    function focusEdgeOpacity(link: ForceLink): number {
      if (!isFocus) return 0.7
      if (!focusVisibleIds!.has(link.source.id) || !focusVisibleIds!.has(link.target.id)) return 0.04
      if (focusDirectEdgeIds.has(link.primaryEdge.id)) return 0.9
      const srcDist = focusDistance.get(link.source.id) ?? 99
      const tgtDist = focusDistance.get(link.target.id) ?? 99
      const minDist = Math.min(srcDist, tgtDist)
      if (minDist <= 1) return 0.7
      if (minDist <= 2) return 0.5
      return 0.3
    }

    // Helper: time filter check
    const isTimeFiltered = (nodeId: string) => {
      if (timeFilter == null || !cumulativeTime) return false
      return (cumulativeTime.get(nodeId) ?? 0) > timeFilter
    }

    // Helper: temporal belief for a node at current scrubber time
    const beliefAtTimeFn = getBeliefAtTimeRef.current
    const hasTemporalBelief = beliefAtTimeFn != null && timeFilter != null
    const getNodeTemporalBelief = (nodeId: string): number | null => {
      if (!hasTemporalBelief) return null
      return beliefAtTimeFn!(nodeId, timeFilter!)
    }

    // Helper: node color — uses temporal belief when scrubber active, otherwise confidence
    // Unfocused nodes in focus mode get grey
    const nodeStrokeColor = (d: ForceNode): string => {
      if (isFocus && !isFocusVisible(d.id)) return theme.collapseStroke
      const tb = getNodeTemporalBelief(d.id)
      if (tb != null && !isTimeFiltered(d.id)) return beliefColor(tb)
      return confidenceColor(d.data.confidence)
    }
    const nodeFillColor = (d: ForceNode): string => {
      if (isFocus && !isFocusVisible(d.id)) return theme.collapseFill
      return theme.nodeFill
    }

    // --- Edges ---
    const edgesG = rootG.append('g').attr('class', 'edges')

    // Invisible hitbox paths for clicking
    edgesG.selectAll('path.edge-hitbox')
      .data(layout.links)
      .enter()
      .append('path')
      .attr('class', 'edge-hitbox')
      .attr('d', (d) => bezierPath(d.source.x, d.source.y, d.target.x, d.target.y))
      .attr('fill', 'none')
      .attr('stroke', 'transparent')
      .attr('stroke-width', 20)
      .attr('cursor', (d) => isFocus && (!isFocusVisible(d.source.id) || !isFocusVisible(d.target.id)) ? 'default' : 'pointer')
      .attr('pointer-events', (d) => isFocus && (!isFocusVisible(d.source.id) || !isFocusVisible(d.target.id)) ? 'none' : 'stroke')
      .on('click', (_event, d) => {
        if (d.isBundled) handleEdgeClick(d.primaryEdge.id, d.edges.map((e) => e.id))
        else handleEdgeClick(d.edges[0].id)
      })
      .on('contextmenu', (event, d) => {
        event.preventDefault()
        setContextMenu({
          x: event.clientX,
          y: event.clientY,
          edgeId: d.primaryEdge.id,
          strength: d.primaryEdge.strength,
        })
      })

    // Active path glow layer (rendered behind visible edges)
    if (activePathEdgeSet.size > 0) {
      edgesG.selectAll('path.edge-glow')
        .data(layout.links.filter((d) => activePathEdgeSet.has(`${d.source.id}->${d.target.id}`)))
        .enter()
        .append('path')
        .attr('class', 'edge-glow')
        .attr('d', (d) => bezierPath(d.source.x, d.source.y, d.target.x, d.target.y))
        .attr('fill', 'none')
        .attr('stroke', activePathColor)
        .attr('stroke-width', 8)
        .attr('stroke-opacity', 0.3)
        .attr('pointer-events', 'none')
        .attr('filter', 'url(#glow-critical)')
    }

    // Visible edge paths
    edgesG.selectAll('path.edge-line')
      .data(layout.links)
      .enter()
      .append('path')
      .attr('class', (d) => `edge-line edge-${d.primaryEdge.id}`)
      .attr('d', (d) => bezierPath(d.source.x, d.source.y, d.target.x, d.target.y))
      .attr('fill', 'none')
      .attr('stroke', (d) => {
        const edgeKey = `${d.source.id}->${d.target.id}`
        if (activePathEdgeSet.has(edgeKey)) return activePathColor
        if (isFocus && (!isFocusVisible(d.source.id) || !isFocusVisible(d.target.id))) return theme.edgeDimmed
        return edgeColor(d.maxEvidenceScore)
      })
      .attr('stroke-width', (d) => {
        const base = edgeStrokeWidth(d.maxStrength)
        const edgeKey = `${d.source.id}->${d.target.id}`
        if (activePathEdgeSet.has(edgeKey)) return base + 3
        return base
      })
      .attr('stroke-opacity', (d) => {
        if (isTimeFiltered(d.source.id) || isTimeFiltered(d.target.id)) return 0.04
        const edgeKey = `${d.source.id}->${d.target.id}`
        if (activePathEdgeSet.has(edgeKey)) return 1.0
        if (isFocus) return focusEdgeOpacity(d)
        if (searchQuery && !matchingNodeIds.has(d.source.id) && !matchingNodeIds.has(d.target.id)) {
          return 0.1
        }
        return 0.7
      })
      .attr('stroke-dasharray', (d) => {
        const causalType = (d.primaryEdge.causalType ?? 'direct') as CausalType
        return EDGE_DASH[causalType] || 'none'
      })
      .attr('pointer-events', 'none')
      .style('animation', (d) => d.isConvergenceEdge ? 'shimmer 2s ease-in-out infinite' : 'none')

    // --- Bundle badges ---
    const bundledLinks = layout.links.filter((d) => d.isBundled)
    if (bundledLinks.length > 0) {
      const badgesG = rootG.append('g').attr('class', 'bundle-badges').attr('pointer-events', 'none')

      badgesG.selectAll('g.bundle-badge')
        .data(bundledLinks)
        .enter()
        .append('g')
        .attr('class', 'bundle-badge')
        .attr('transform', (d) => {
          const mx = (d.source.x + d.target.x) / 2
          const my = (d.source.y + d.target.y) / 2
          return `translate(${mx},${my})`
        })
        .each(function (d) {
          const g = select(this)
          const label = `\u00d7${d.edges.length}`
          g.append('rect')
            .attr('x', -14)
            .attr('y', -9)
            .attr('width', 28)
            .attr('height', 18)
            .attr('rx', 9)
            .attr('fill', '#334155')
            .attr('stroke', '#475569')
            .attr('stroke-width', 1)
          g.append('text')
            .attr('text-anchor', 'middle')
            .attr('dy', '0.35em')
            .attr('fill', '#e2e8f0')
            .attr('font-size', '10px')
            .attr('font-weight', '600')
            .text(label)
        })
    }

    // --- Precompute adjacency for hover dimming ---
    const nodeNeighbors = new Map<string, Set<string>>()
    for (const n of layout.nodes) nodeNeighbors.set(n.id, new Set())
    for (const link of layout.links) {
      nodeNeighbors.get(link.source.id)?.add(link.target.id)
      nodeNeighbors.get(link.target.id)?.add(link.source.id)
    }

    // Helper: restore all elements to resting state (respects focus mode with graduated opacity)
    function restoreResting(duration = 200) {
      const selNode = selectedNodeIdRef.current
      const selEdge = selectedEdgeIdRef.current

      svg.selectAll<SVGGElement, ForceNode>('g.node')
        .transition().duration(duration)
        .attr('opacity', (n) => {
          if (isTimeFiltered(n.id)) return 0.08
          if (isFocus) return focusNodeOpacity(n.id)
          if (searchQuery && !matchingNodeIds.has(n.id)) return 0.2
          return 1
        })
        .attr('filter', (n) => {
          if (isTimeFiltered(n.id)) return 'url(#dim-grayscale)'
          if (isFocus && !isFocusVisible(n.id)) return 'url(#dim-grayscale)'
          return 'none'
        })
        .each(function (n) {
          const isSelected = n.id === selNode
          const isFocusNode = isFocus && n.id === focusNodeId
          const defaultStroke = nodeStrokeColor(n)
          select(this).select('.node-rect')
            .transition().duration(duration)
            .attr('stroke', (isSelected || isFocusNode) ? '#0098cc' : defaultStroke)
            .attr('stroke-width', (isSelected || isFocusNode) ? 2.5 : 1.5)
        })

      svg.selectAll<SVGPathElement, ForceLink>('path.edge-line')
        .transition().duration(duration)
        .attr('stroke', (link) => {
          const edgeKey = `${link.source.id}->${link.target.id}`
          if (activePathEdgeSet.has(edgeKey)) return activePathColor
          const bothVisible = !isFocus || (isFocusVisible(link.source.id) && isFocusVisible(link.target.id))
          return bothVisible ? edgeColor(link.maxEvidenceScore) : theme.edgeDimmed
        })
        .attr('stroke-opacity', (link) => {
          if (isTimeFiltered(link.source.id) || isTimeFiltered(link.target.id)) return 0.04
          const edgeKey = `${link.source.id}->${link.target.id}`
          if (activePathEdgeSet.has(edgeKey)) return 1.0
          if (isFocus) return focusEdgeOpacity(link)
          return link.edges.some((e) => e.id === selEdge) ? 1 : 0.7
        })
        .attr('stroke-width', (link) => {
          const base = edgeStrokeWidth(link.maxStrength)
          const edgeKey = `${link.source.id}->${link.target.id}`
          if (activePathEdgeSet.has(edgeKey)) return base + 3
          return link.edges.some((e) => e.id === selEdge) ? base + 2 : base
        })
    }

    // Edge hover: highlight + dim others + tooltip
    edgesG.selectAll<SVGPathElement, ForceLink>('path.edge-hitbox')
      .on('mouseenter', (event, d) => {
        const link = d as ForceLink
        const connectedNodes = new Set([link.source.id, link.target.id])
        const edgeHoverColor = isFocus ? FOCUS_HOVER_COLOR : edgeColor(link.maxEvidenceScore)

        // Dim all non-connected nodes
        svg.selectAll<SVGGElement, ForceNode>('g.node')
          .transition().duration(150)
          .attr('opacity', (n) => connectedNodes.has(n.id) ? 1 : 0.12)
          .attr('filter', (n) => connectedNodes.has(n.id) ? 'none' : 'url(#dim-grayscale)')

        // Dim all edges except hovered
        svg.selectAll<SVGPathElement, ForceLink>('path.edge-line')
          .transition().duration(150)
          .attr('stroke', (l) => l.primaryEdge.id === link.primaryEdge.id ? edgeHoverColor : theme.collapseStroke)
          .attr('stroke-opacity', (l) => l.primaryEdge.id === link.primaryEdge.id ? 1 : 0.06)
          .attr('stroke-width', (l) => {
            const base = edgeStrokeWidth(l.maxStrength)
            return l.primaryEdge.id === link.primaryEdge.id ? base + 2 : base
          })

        // Highlight connected nodes
        const nodeHighlightColor = isFocus ? FOCUS_HOVER_COLOR : '#0098cc'
        for (const nid of connectedNodes) {
          svg.select<SVGGElement>(`.node-${CSS.escape(nid)}`)
            .select('.node-rect')
            .transition().duration(150)
            .attr('stroke', nodeHighlightColor).attr('stroke-width', 2)
        }

        // Show bias warning icon for this edge
        svg.selectAll('.bias-icon').attr('opacity', 0)
        svg.select(`.bias-icon-${CSS.escape(link.primaryEdge.id)}`)
          .transition().duration(150).attr('opacity', 1)

        // Tooltip
        if (tooltipTimerRef.current) clearTimeout(tooltipTimerRef.current)
        tooltipTimerRef.current = setTimeout(() => {
          const rect = containerRef.current?.getBoundingClientRect()
          if (!rect) return
          if (link.isBundled) {
            setTooltip({
              type: 'edge-bundle',
              x: event.clientX - rect.left,
              y: event.clientY - rect.top,
              edges: link.edges,
              primaryEdge: link.primaryEdge,
            })
          } else {
            setTooltip({
              type: 'edge',
              x: event.clientX - rect.left,
              y: event.clientY - rect.top,
              edge: link.edges[0],
            })
          }
        }, 300)
      })
      .on('mousemove', (event) => {
        const rect = containerRef.current?.getBoundingClientRect()
        if (!rect) return
        setTooltip((prev) => prev ? { ...prev, x: event.clientX - rect.left, y: event.clientY - rect.top } : null)
      })
      .on('mouseleave', () => {
        restoreResting(200)
        svg.selectAll('.bias-icon').transition().duration(200).attr('opacity', 0)
        if (tooltipTimerRef.current) clearTimeout(tooltipTimerRef.current)
        setTooltip(null)
      })

    // Edge icon overlays (bias warning) — hidden by default, shown on hover
    const edgeIconsG = rootG.append('g').attr('class', 'edge-icons')
    for (const link of layout.links) {
      const midX = (link.source.x + link.target.x) / 2
      const midY = (link.source.y + link.target.y) / 2
      const hasHighBias = (link.primaryEdge.biasWarnings ?? []).some((w) => w.severity === 'high')
      if (hasHighBias) {
        edgeIconsG.append('text')
          .attr('x', midX + 12)
          .attr('y', midY - 4)
          .attr('font-size', '12px')
          .attr('text-anchor', 'middle')
          .attr('pointer-events', 'none')
          .attr('class', `bias-icon bias-icon-${CSS.escape(link.primaryEdge.id)}`)
          .attr('opacity', 0)
          .text('\u26a0\ufe0f')
      }
    }

    // --- Nodes ---
    const nodesG = rootG.append('g').attr('class', 'nodes')

    const nodeGroups = nodesG.selectAll('g.node')
      .data(layout.nodes, (d) => (d as ForceNode).id)
      .enter()
      .append('g')
      .attr('class', (d) => `node node-${d.id}`)
      .attr('transform', (d) => {
        if (isFocus && d.id === focusNodeId) return `translate(${d.x},${d.y}) scale(1.08)`
        return `translate(${d.x},${d.y})`
      })
      .attr('cursor', (d) => isFocus && !isFocusVisible(d.id) ? 'default' : 'grab')
      .attr('pointer-events', (d) => isFocus && !isFocusVisible(d.id) ? 'none' : 'auto')
      .attr('opacity', (d) => {
        if (isTimeFiltered(d.id)) return 0.08
        if (isFocus) return focusNodeOpacity(d.id)
        if (searchQuery && !matchingNodeIds.has(d.id)) return 0.2
        return 1
      })
      .attr('filter', (d) => {
        if (isTimeFiltered(d.id)) return 'url(#dim-grayscale)'
        if (isFocus && !isFocusVisible(d.id)) return 'url(#dim-grayscale)'
        return 'none'
      })
      .on('click', (_event, d) => {
        handleNodeClick(d.id)
      })
      .on('dblclick', (_event, d) => {
        handleNodeDblClick(d.id)
      })

    // d3-drag behavior (node dragging)
    const dragBehavior = drag<SVGGElement, ForceNode>()
      .on('start', (event, d) => {
        reheat()
        d.fx = d.x
        d.fy = d.y
        select(event.sourceEvent.target.closest('g.node')).attr('cursor', 'grabbing')
      })
      .on('drag', (event, d) => {
        d.fx = event.x
        d.fy = event.y
        // Update positions immediately so edges follow the node
        d.x = event.x
        d.y = event.y
        handleSimTick()
      })
      .on('end', (event, d) => {
        d.fx = null
        d.fy = null
        select(event.sourceEvent.target.closest('g.node')).attr('cursor', 'grab')
      })

    nodeGroups.call(dragBehavior)

    // Node size
    const nodeWidth = (d: ForceNode) => {
      const base = 140 + (d.data.sensitivity ?? 0) * 40
      return d.isConvergencePoint ? base * CONVERGENCE_SCALE : base
    }
    const nodeHeight = (d: ForceNode) => {
      return d.isConvergencePoint ? 52 * CONVERGENCE_SCALE : 52
    }

    // Glow rect for critical path
    nodeGroups.filter((d) => d.data.isCriticalPath)
      .append('rect')
      .attr('class', 'node-glow')
      .attr('x', (d) => -nodeWidth(d) / 2 - 4)
      .attr('y', (d) => -nodeHeight(d) / 2 - 4)
      .attr('width', (d) => nodeWidth(d) + 8)
      .attr('height', (d) => nodeHeight(d) + 8)
      .attr('rx', 12)
      .attr('ry', 12)
      .attr('fill', 'none')
      .attr('stroke', '#0098cc')
      .attr('stroke-width', 2)
      .attr('filter', 'url(#glow-critical)')
      .attr('opacity', 0.6)

    // Main shape: diamond for AND-gate, rect for OR-gate
    nodeGroups.filter((d) => d.data.logicGate === 'and')
      .append('polygon')
      .attr('class', 'node-rect')
      .attr('points', (d) => {
        const w = nodeWidth(d) / 2, h = nodeHeight(d) / 2
        return `0,${-h} ${w},0 0,${h} ${-w},0`
      })
      .attr('fill', (d) => nodeFillColor(d))
      .attr('stroke', (d) => nodeStrokeColor(d))
      .attr('stroke-width', 1.5)
      .attr('stroke-dasharray', (d) => borderDash(d.data.claimType))

    nodeGroups.filter((d) => d.data.logicGate !== 'and')
      .append('rect')
      .attr('class', 'node-rect')
      .attr('x', (d) => -nodeWidth(d) / 2)
      .attr('y', (d) => -nodeHeight(d) / 2)
      .attr('width', (d) => nodeWidth(d))
      .attr('height', (d) => nodeHeight(d))
      .attr('rx', 8)
      .attr('ry', 8)
      .attr('fill', (d) => nodeFillColor(d))
      .attr('stroke', (d) => nodeStrokeColor(d))
      .attr('stroke-width', 1.5)
      .attr('stroke-dasharray', (d) => borderDash(d.data.claimType))

    // Focus node highlight (persistent hover-like border)
    if (isFocus && focusNodeId) {
      nodeGroups.filter((d) => d.id === focusNodeId)
        .select('.node-rect')
        .attr('stroke', '#0098cc')
        .attr('stroke-width', 2.5)
    }

    // Active path highlight ring on nodes
    if (activePathNodeSet.size > 0) {
      nodeGroups.filter((d) => activePathNodeSet.has(d.id))
        .insert('rect', ':first-child')
        .attr('x', (d) => -nodeWidth(d) / 2 - 3)
        .attr('y', (d) => -nodeHeight(d) / 2 - 3)
        .attr('width', (d) => nodeWidth(d) + 6)
        .attr('height', (d) => nodeHeight(d) + 6)
        .attr('rx', 10)
        .attr('ry', 10)
        .attr('fill', 'none')
        .attr('stroke', activePathColor)
        .attr('stroke-width', 2)
        .attr('stroke-opacity', 0.8)
        .attr('filter', 'url(#glow-critical)')
    }

    // Convergence badge
    nodeGroups.filter((d) => d.isConvergencePoint)
      .append('circle')
      .attr('cx', (d) => nodeWidth(d) / 2 - 2)
      .attr('cy', (d) => -nodeHeight(d) / 2 + 2)
      .attr('r', 8)
      .attr('fill', '#7c3aed')
      .attr('stroke', theme.convergenceStroke)
      .attr('stroke-width', 1.5)

    nodeGroups.filter((d) => d.isConvergencePoint)
      .append('text')
      .attr('x', (d) => nodeWidth(d) / 2 - 2)
      .attr('y', (d) => -nodeHeight(d) / 2 + 5.5)
      .attr('text-anchor', 'middle')
      .attr('fill', '#fff')
      .attr('font-size', '9px')
      .attr('font-weight', 'bold')
      .attr('pointer-events', 'none')
      .text((d) => d.parentIds.length.toString())

    // Compare mode: delta labels above nodes
    if (viewMode === 'compare' && compareChanges) {
      nodeGroups.filter((d) => compareChanges![d.id] != null)
        .append('text')
        .attr('x', 0)
        .attr('y', (d) => -nodeHeight(d) / 2 - 8)
        .attr('text-anchor', 'middle')
        .attr('fill', (d) => {
          const delta = compareChanges![d.id].delta
          return delta > 0 ? '#22c55e' : delta < 0 ? '#ef4444' : '#94a3b8'
        })
        .attr('font-size', (d) => Math.abs(compareChanges![d.id].delta) > 0.3 ? '13px' : '11px')
        .attr('font-weight', (d) => Math.abs(compareChanges![d.id].delta) > 0.3 ? 'bold' : 'normal')
        .text((d) => {
          const delta = compareChanges![d.id].delta
          const sign = delta > 0 ? '+' : ''
          return `${sign}${(delta * 100).toFixed(0)}%`
        })

      // Split color rect for compare mode nodes
      nodeGroups.filter((d) => compareChanges![d.id] != null)
        .append('rect')
        .attr('x', (d) => -nodeWidth(d) / 2)
        .attr('y', (d) => nodeHeight(d) / 2 - 3)
        .attr('width', (d) => nodeWidth(d) / 2)
        .attr('height', 3)
        .attr('fill', (d) => confidenceColor(compareChanges![d.id].oldBelief))
        .attr('rx', 1)

      nodeGroups.filter((d) => compareChanges![d.id] != null)
        .append('rect')
        .attr('x', 0)
        .attr('y', (d) => nodeHeight(d) / 2 - 3)
        .attr('width', (d) => nodeWidth(d) / 2)
        .attr('height', 3)
        .attr('fill', (d) => confidenceColor(compareChanges![d.id].newBelief))
        .attr('rx', 1)
    }

    // Text via foreignObject
    nodeGroups.append('foreignObject')
      .attr('x', (d) => -nodeWidth(d) / 2 + 8)
      .attr('y', (d) => -nodeHeight(d) / 2 + 4)
      .attr('width', (d) => nodeWidth(d) - 16)
      .attr('height', (d) => nodeHeight(d) - 8)
      .attr('pointer-events', 'none')
      .append('xhtml:div')
      .attr('xmlns', 'http://www.w3.org/1999/xhtml')
      .style('display', 'flex')
      .style('flex-direction', 'column')
      .style('justify-content', 'center')
      .style('height', '100%')
      .style('overflow', 'hidden')
      .html((d) => {
        const dim = searchQuery && !matchingNodeIds.has(d.id) ? 'opacity: 0.2;' : ''
        const typeColor = d.data.claimType === 'FACT' ? '#26a8d4'
          : d.data.claimType === 'ASSUMPTION' ? '#ffca28'
          : d.data.claimType === 'PREDICTION' ? '#5869b6'
          : '#94a3b8'
        const andBadge = d.data.logicGate === 'and'
          ? `<span style="display:inline-block;font-size:8px;padding:0 3px;border-radius:2px;margin-left:3px;background:#7c3aed22;color:#a78bfa;border:1px solid #7c3aed44;font-family:monospace;">AND</span>`
          : ''
        return `
          <div style="font-size: 11px; color: ${theme.nodeText}; line-height: 1.3; ${dim}">
            <span style="
              display: inline-block; font-size: 9px; padding: 0 4px;
              border-radius: 3px; margin-bottom: 2px;
              background: ${typeColor}22; color: ${typeColor}; border: 1px solid ${typeColor}44;
            ">${d.data.claimType}</span>${andBadge}
            <div style="overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;">
              ${truncateText(d.data.text, 80)}
            </div>
          </div>
        `
      })

    // --- Collapse indicator ---
    const collapsibleNodes = layout.nodes.filter((n) =>
      graph.edges.some((e) => e.sourceId === n.id),
    )

    nodeGroups.filter((d) => collapsibleNodes.some((c) => c.id === d.id))
      .append('circle')
      .attr('cx', (d) => nodeWidth(d) / 2 - 4)
      .attr('cy', (d) => nodeHeight(d) / 2 - 4)
      .attr('r', 6)
      .attr('fill', theme.collapseFill)
      .attr('stroke', theme.collapseStroke)
      .attr('stroke-width', 1)

    nodeGroups.filter((d) => collapsibleNodes.some((c) => c.id === d.id))
      .append('text')
      .attr('x', (d) => nodeWidth(d) / 2 - 4)
      .attr('y', (d) => nodeHeight(d) / 2 - 1)
      .attr('text-anchor', 'middle')
      .attr('fill', theme.collapseText)
      .attr('font-size', '9px')
      .attr('pointer-events', 'none')
      .text((d) => collapsedNodes.has(d.id) ? '+' : '\u2212')

    // --- Temporal belief badge (bottom-left of node) ---
    if (hasTemporalBelief) {
      nodeGroups.filter((d) => !isTimeFiltered(d.id))
        .each(function (d) {
          const tb = getNodeTemporalBelief(d.id)
          if (tb == null) return
          const g = select(this)
          const bx = -nodeWidth(d) / 2 + 6
          const by = nodeHeight(d) / 2 - 2
          g.append('rect')
            .attr('x', bx - 1)
            .attr('y', by - 10)
            .attr('width', 28)
            .attr('height', 12)
            .attr('rx', 3)
            .attr('fill', beliefColor(tb))
            .attr('opacity', 0.85)
            .attr('pointer-events', 'none')
          g.append('text')
            .attr('class', 'belief-badge')
            .attr('x', bx + 13)
            .attr('y', by - 1.5)
            .attr('text-anchor', 'middle')
            .attr('fill', '#fff')
            .attr('font-size', '8px')
            .attr('font-weight', '600')
            .attr('pointer-events', 'none')
            .text(`${(tb * 100).toFixed(0)}%`)
        })
    }

    // Node hover: highlight hovered + connected, dim everything else
    nodeGroups
      .on('mouseenter', (event, d) => {
        const neighbors = nodeNeighbors.get(d.id) ?? new Set<string>()
        const activeSet = new Set([d.id, ...neighbors])
        const hoverColor = isFocus ? FOCUS_HOVER_COLOR : '#0098cc'

        if (isFocus) {
          // Focus mode: layered hover with secondary color
          svg.selectAll<SVGGElement, ForceNode>('g.node')
            .transition().duration(150)
            .attr('opacity', (n) => {
              if (activeSet.has(n.id)) return 1
              if (n.id === focusNodeId) return 0.6
              return 0.08
            })
            .attr('filter', (n) => activeSet.has(n.id) || n.id === focusNodeId ? 'none' : 'url(#dim-grayscale)')

          svg.selectAll<SVGPathElement, ForceLink>('path.edge-line')
            .transition().duration(150)
            .attr('stroke', (link) => {
              const isHoveredEdge = link.source.id === d.id || link.target.id === d.id
              if (isHoveredEdge) return FOCUS_HOVER_COLOR
              if (focusDirectEdgeIds.has(link.primaryEdge.id) && !isHoveredEdge) return edgeColor(link.maxEvidenceScore)
              return theme.collapseStroke
            })
            .attr('stroke-opacity', (link) => {
              const isHoveredEdge = link.source.id === d.id || link.target.id === d.id
              if (isHoveredEdge) return 1
              if (focusDirectEdgeIds.has(link.primaryEdge.id)) return 0.5
              return 0.06
            })
            .attr('stroke-width', (link) => {
              const base = edgeStrokeWidth(link.maxStrength)
              return (link.source.id === d.id || link.target.id === d.id) ? base + 1.5 : base
            })
        } else {
          // Panorama mode: original behavior
          svg.selectAll<SVGGElement, ForceNode>('g.node')
            .transition().duration(150)
            .attr('opacity', (n) => activeSet.has(n.id) ? 1 : 0.12)
            .attr('filter', (n) => activeSet.has(n.id) ? 'none' : 'url(#dim-grayscale)')

          svg.selectAll<SVGPathElement, ForceLink>('path.edge-line')
            .transition().duration(150)
            .attr('stroke', (link) => {
              const connected = link.source.id === d.id || link.target.id === d.id
              return connected ? edgeColor(link.maxEvidenceScore) : theme.collapseStroke
            })
            .attr('stroke-opacity', (link) =>
              link.source.id === d.id || link.target.id === d.id ? 1 : 0.06)
            .attr('stroke-width', (link) => {
              const base = edgeStrokeWidth(link.maxStrength)
              return (link.source.id === d.id || link.target.id === d.id) ? base + 1.5 : base
            })
        }

        // Brighten hovered node with appropriate color
        select(event.currentTarget)
          .select('.node-rect')
          .transition().duration(150)
          .attr('stroke', hoverColor)
          .attr('stroke-width', 2.5)

        // Tooltip
        if (tooltipTimerRef.current) clearTimeout(tooltipTimerRef.current)
        tooltipTimerRef.current = setTimeout(() => {
          const rect = containerRef.current?.getBoundingClientRect()
          if (!rect) return
          const inEdges = graph.edges.filter((e) => e.targetId === d.id)
          const outEdges = graph.edges.filter((e) => e.sourceId === d.id)
          const tb = getNodeTemporalBelief(d.id) ?? undefined
          setTooltip({
            type: 'node',
            x: event.clientX - rect.left,
            y: event.clientY - rect.top,
            node: d.data,
            parentCount: inEdges.length,
            childCount: outEdges.length,
            temporalBelief: tb,
          })
        }, 300)
      })
      .on('mouseleave', () => {
        restoreResting(200)
        if (tooltipTimerRef.current) clearTimeout(tooltipTimerRef.current)
        setTooltip(null)
      })

    // --- Animate entrance (first render only) ---
    if (!hasRenderedRef.current) {
      hasRenderedRef.current = true
      nodeGroups
        .attr('opacity', 0)
        .transition()
        .duration(400)
        .attr('opacity', 1)
    }

    // --- Simulation tick updates ---
    // Update positions on each tick via a mutation observer pattern
    // We re-render when layout changes (via tick state in useForceLayout)
    // so positions are already current in the data

    // Cleanup
    return () => {
      svg.selectAll('g.graph-root').remove()
      svg.on('.zoom', null)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- callbacks use refs (stable)
  }, [layout, hasDimensions, filters.searchQuery, collapsedNodes, graph, viewMode, focusNodeId, focusVisibleIds, focusPaths, activePathIndex, compareChanges, timeFilter, cumulativeTime])

  // --- Lightweight selection styling update (no full rebuild) ---
  useEffect(() => {
    if (!svgRef.current || !layout) return
    const svg = select(svgRef.current)
    const isFocusLocal = viewMode === 'focus' && focusVisibleIds && focusVisibleIds.size > 0

    // Rebuild distance map for graduated opacity
    const focusDistLocal = new Map<string, number>()
    const focusDirectEdgeIdsLocal = new Set<string>()
    if (isFocusLocal && focusNodeId) {
      focusDistLocal.set(focusNodeId, 0)
      const queue = [focusNodeId]
      while (queue.length > 0) {
        const id = queue.shift()!
        const dist = focusDistLocal.get(id)!
        for (const link of layout.links) {
          let neighbor: string | null = null
          if (link.source.id === id) neighbor = link.target.id
          else if (link.target.id === id) neighbor = link.source.id
          if (neighbor && !focusDistLocal.has(neighbor) && focusVisibleIds!.has(neighbor)) {
            focusDistLocal.set(neighbor, dist + 1)
            queue.push(neighbor)
          }
        }
      }
      for (const link of layout.links) {
        if (link.source.id === focusNodeId || link.target.id === focusNodeId) {
          for (const e of link.edges) focusDirectEdgeIdsLocal.add(e.id)
        }
      }
    }

    const isTimeFilteredLocal = (nodeId: string) => {
      if (timeFilter == null || !cumulativeTime) return false
      return (cumulativeTime.get(nodeId) ?? 0) > timeFilter
    }

    const beliefAtTimeFnLocal = getBeliefAtTimeRef.current
    const hasTemporalBeliefLocal = beliefAtTimeFnLocal != null && timeFilter != null
    const themeLocal = getGraphTheme()

    function isFocusVisibleLocal(nodeId: string): boolean {
      if (!isFocusLocal) return true
      return focusDistLocal.get(nodeId) !== undefined
    }

    const nodeStrokeColorLocal = (d: ForceNode): string => {
      if (isFocusLocal && !isFocusVisibleLocal(d.id)) return themeLocal.collapseStroke
      if (hasTemporalBeliefLocal && !isTimeFilteredLocal(d.id)) {
        return beliefColor(beliefAtTimeFnLocal!(d.id, timeFilter!))
      }
      return confidenceColor(d.data.confidence)
    }

    function nodeOpacity(nodeId: string): number {
      if (isTimeFilteredLocal(nodeId)) return 0.08
      if (!isFocusLocal) return 1
      const d = focusDistLocal.get(nodeId)
      if (d === undefined) return 0.12
      if (d <= 1) return 1
      if (d === 2) return 0.85
      return 0.6
    }

    function edgeOpacity(link: ForceLink): number {
      if (isTimeFilteredLocal(link.source.id) || isTimeFilteredLocal(link.target.id)) return 0.04
      if (!isFocusLocal) return 0.7
      if (!focusVisibleIds!.has(link.source.id) || !focusVisibleIds!.has(link.target.id)) return 0.04
      if (focusDirectEdgeIdsLocal.has(link.primaryEdge.id)) return 0.9
      const srcDist = focusDistLocal.get(link.source.id) ?? 99
      const tgtDist = focusDistLocal.get(link.target.id) ?? 99
      const minDist = Math.min(srcDist, tgtDist)
      if (minDist <= 1) return 0.7
      if (minDist <= 2) return 0.5
      return 0.3
    }

    // Update node selection styling
    svg.selectAll<SVGGElement, ForceNode>('g.node').each(function (d) {
      const group = select(this)
      const isSelected = d.id === selectedNodeId
      const isFocusNode = isFocusLocal && d.id === focusNodeId
      const visible = isFocusVisibleLocal(d.id)

      // Update stroke on shape elements
      group.select('.node-rect')
        .attr('stroke', (isSelected || isFocusNode) ? '#0098cc' : nodeStrokeColorLocal(d))
        .attr('stroke-width', (isSelected || isFocusNode) ? 2.5 : 1.5)
        .attr('fill', isFocusLocal && !visible ? themeLocal.collapseFill : themeLocal.nodeFill)

      // Update scale
      group.attr('transform', (isSelected || isFocusNode)
        ? `translate(${d.x},${d.y}) scale(1.08)`
        : `translate(${d.x},${d.y})`)

      // Graduated opacity + greyscale filter + pointer events
      group
        .attr('opacity', nodeOpacity(d.id))
        .attr('filter', (isTimeFilteredLocal(d.id) || (isFocusLocal && !visible)) ? 'url(#dim-grayscale)' : 'none')
        .attr('pointer-events', isFocusLocal && !visible ? 'none' : 'auto')
        .attr('cursor', isFocusLocal && !visible ? 'default' : 'grab')
    })

    // Update edge selection styling
    svg.selectAll<SVGPathElement, ForceLink>('path.edge-line').each(function (d) {
      const path = select(this)
      const isSelected = d.edges.some((e) => e.id === selectedEdgeId)
      const base = edgeStrokeWidth(d.maxStrength)
      const bothVisible = !isFocusLocal || (isFocusVisibleLocal(d.source.id) && isFocusVisibleLocal(d.target.id))

      path
        .attr('stroke', bothVisible ? edgeColor(d.maxEvidenceScore) : themeLocal.edgeDimmed)
        .attr('stroke-width', isSelected ? base + 2 : base)
        .attr('stroke-opacity', isSelected ? 1 : edgeOpacity(d))
    })

    // Disable hitbox paths for non-focus edges
    svg.selectAll<SVGPathElement, ForceLink>('path.edge-hitbox').each(function (d) {
      const hitbox = select(this)
      const bothVisible = !isFocusLocal || (isFocusVisibleLocal(d.source.id) && isFocusVisibleLocal(d.target.id))
      hitbox.attr('pointer-events', bothVisible ? 'stroke' : 'none')
    })
  }, [selectedNodeId, selectedEdgeId, layout, viewMode, focusVisibleIds, focusNodeId, timeFilter, cumulativeTime])

  // --- Zoom controls ---
  const handleZoomIn = useCallback(() => {
    if (!svgRef.current || !zoomBehaviorRef.current) return
    const svg = select(svgRef.current)
    svg.transition().duration(300).call(
      zoomBehaviorRef.current.scaleBy, 1.3,
    )
  }, [])

  const handleZoomOut = useCallback(() => {
    if (!svgRef.current || !zoomBehaviorRef.current) return
    const svg = select(svgRef.current)
    svg.transition().duration(300).call(
      zoomBehaviorRef.current.scaleBy, 0.7,
    )
  }, [])

  const handleZoomReset = useCallback(() => {
    if (!svgRef.current || !zoomBehaviorRef.current) return
    const svg = select(svgRef.current)
    svg.transition().duration(500).call(
      zoomBehaviorRef.current.transform, zoomIdentity,
    )
  }, [])

  // MiniMap click-to-navigate: pan the main view to center on the given graph coordinate
  const handleMiniMapNavigate = useCallback((graphX: number, graphY: number) => {
    if (!svgRef.current || !zoomBehaviorRef.current) return
    const svg = select(svgRef.current)
    const transform = zoomIdentity.translate(widthRef.current / 2 - graphX, heightRef.current / 2 - graphY)
    svg.transition().duration(400).call(
      zoomBehaviorRef.current.transform, transform,
    )
  }, [])

  return (
    <div ref={containerRef} className="relative w-full h-full overflow-hidden bg-surface-900">
      {/* SVG canvas */}
      <svg
        ref={svgRef}
        width={width}
        height={height}
        className="block"
      >
        <style>{`
          @keyframes shimmer {
            0%, 100% { stroke-opacity: 0.7; }
            50% { stroke-opacity: 1; }
          }
          .glow-blur {
            animation: glow-pulse 2s ease-in-out infinite alternate;
          }
          @keyframes glow-pulse {
            from { stdDeviation: 3; }
            to { stdDeviation: 6; }
          }
        `}</style>
      </svg>

      {/* Tooltip */}
      {tooltip && <GraphTooltip data={tooltip} />}

      {/* MiniMap */}
      <MiniMap ref={miniMapRef} layout={layout} onNavigate={handleMiniMapNavigate} />

      {/* Zoom controls overlay */}
      <div className="absolute bottom-4 right-4 flex flex-col gap-1">
        <button
          onClick={handleZoomIn}
          className="w-8 h-8 flex items-center justify-center rounded-lg bg-surface-800 border border-surface-600 text-text-secondary hover:text-text-primary hover:bg-surface-700 transition-colors text-lg"
          aria-label="Zoom in"
        >
          +
        </button>
        <button
          onClick={handleZoomOut}
          className="w-8 h-8 flex items-center justify-center rounded-lg bg-surface-800 border border-surface-600 text-text-secondary hover:text-text-primary hover:bg-surface-700 transition-colors text-lg"
          aria-label="Zoom out"
        >
          &minus;
        </button>
        <button
          onClick={handleZoomReset}
          className="w-8 h-8 flex items-center justify-center rounded-lg bg-surface-800 border border-surface-600 text-text-secondary hover:text-text-primary hover:bg-surface-700 transition-colors text-xs"
          aria-label="Reset zoom"
        >
          1:1
        </button>
      </div>

      {/* Context menu for edge strength */}
      {contextMenu && (
        <div
          className="fixed z-50 bg-surface-800 border border-surface-600 rounded-lg shadow-xl p-3 min-w-[200px]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <label className="text-xs font-medium text-text-secondary block mb-2">
            Edge Strength
          </label>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            defaultValue={contextMenu.strength}
            onChange={(e) => {
              onEdgeStrengthChangeRef.current(contextMenu.edgeId, parseFloat(e.target.value))
            }}
            className="w-full h-1.5 rounded-full appearance-none cursor-pointer bg-surface-700
              [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4
              [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-ocean-400"
          />
          <div className="text-xs text-text-muted text-right mt-1">
            {contextMenu.strength.toFixed(2)}
          </div>
        </div>
      )}

      {/* Empty state */}
      {!layout && (
        <div className="absolute inset-0 flex items-center justify-center">
          <p className="text-text-muted text-sm">No graph data to visualize.</p>
        </div>
      )}
    </div>
  )
}
