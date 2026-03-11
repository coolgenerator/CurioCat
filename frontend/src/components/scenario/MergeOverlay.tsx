import { useRef, useEffect, useMemo } from 'react'
import { select } from 'd3-selection'
import { zoom, zoomIdentity, type ZoomBehavior } from 'd3-zoom'
import { tree, hierarchy } from 'd3-hierarchy'
import 'd3-transition'
import { useResizeObserver } from '../../hooks/useResizeObserver.ts'
import type { ScenarioComparison } from '../../types/api.ts'
import type { CausalNode, CausalGraph } from '../../types/graph.ts'

interface MergeOverlayProps {
  comparison: ScenarioComparison
}

interface MergeNode {
  id: string
  text: string
  beliefA: number | null
  beliefB: number | null
  confidenceA: number
  confidenceB: number
  isDivergent: boolean
  isConvergent: boolean
}

interface TreeDatum {
  id: string
  node: MergeNode
  children: TreeDatum[]
}

export default function MergeOverlay({ comparison }: MergeOverlayProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const zoomBehaviorRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null)
  const { width, height } = useResizeObserver(containerRef)

  const divergentSet = useMemo(
    () => new Set(comparison.divergent_nodes),
    [comparison.divergent_nodes],
  )
  const convergentSet = useMemo(
    () => new Set(comparison.convergent_nodes),
    [comparison.convergent_nodes],
  )

  // Build merged node map
  const mergedNodes = useMemo(() => {
    const nodeMapA = new Map<string, CausalNode>(
      comparison.scenario_a.nodes.map((n) => [n.id, n]),
    )
    const nodeMapB = new Map<string, CausalNode>(
      comparison.scenario_b.nodes.map((n) => [n.id, n]),
    )

    const allIds = new Set([
      ...comparison.scenario_a.nodes.map((n) => n.id),
      ...comparison.scenario_b.nodes.map((n) => n.id),
    ])

    const merged: MergeNode[] = []
    for (const id of allIds) {
      const nodeA = nodeMapA.get(id)
      const nodeB = nodeMapB.get(id)
      merged.push({
        id,
        text: nodeA?.text ?? nodeB?.text ?? id,
        beliefA: nodeA?.belief ?? null,
        beliefB: nodeB?.belief ?? null,
        confidenceA: nodeA?.confidence ?? 0,
        confidenceB: nodeB?.confidence ?? 0,
        isDivergent: divergentSet.has(id),
        isConvergent: convergentSet.has(id),
      })
    }
    return merged
  }, [comparison, divergentSet, convergentSet])

  // Build tree from scenario A's structure (as the primary)
  const treeData = useMemo(() => {
    return buildMergeTree(comparison.scenario_a, mergedNodes)
  }, [comparison.scenario_a, mergedNodes])

  // D3 rendering
  useEffect(() => {
    if (!svgRef.current || !treeData || width === 0 || height === 0) return

    const svg = select(svgRef.current)
    svg.selectAll('g.merge-root').remove()

    const centerX = width / 2
    const centerY = height / 2
    const radiusExtent = Math.min(width, height) / 2 - 80

    const rootG = svg.append('g')
      .attr('class', 'merge-root')
      .attr('transform', `translate(${centerX},${centerY})`)

    // Zoom
    const zoomBehavior = zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.2, 5])
      .on('zoom', (event) => {
        rootG.attr('transform',
          `translate(${event.transform.x + centerX * (1 - event.transform.k)},${event.transform.y + centerY * (1 - event.transform.k)}) scale(${event.transform.k})`,
        )
      })
    svg.call(zoomBehavior)
    zoomBehaviorRef.current = zoomBehavior

    // Layout
    const root = hierarchy(treeData, (d) => d.children.length > 0 ? d.children : undefined)
    const treeLayout = tree<TreeDatum>()
      .size([2 * Math.PI, radiusExtent])
      .separation((a, b) => (a.parent === b.parent ? 1 : 2) / (a.depth ?? 1))
    treeLayout(root)

    // Links
    const linksG = rootG.append('g').attr('class', 'links')
    root.links().forEach((link) => {
      const sourceAngle = link.source.x ?? 0
      const sourceRadius = link.source.y ?? 0
      const targetAngle = link.target.x ?? 0
      const targetRadius = link.target.y ?? 0

      const sx = sourceRadius * Math.cos(sourceAngle - Math.PI / 2)
      const sy = sourceRadius * Math.sin(sourceAngle - Math.PI / 2)
      const tx = targetRadius * Math.cos(targetAngle - Math.PI / 2)
      const ty = targetRadius * Math.sin(targetAngle - Math.PI / 2)

      // Scenario A edge (solid)
      linksG.append('line')
        .attr('x1', sx).attr('y1', sy)
        .attr('x2', tx).attr('y2', ty)
        .attr('stroke', '#3b82f6')
        .attr('stroke-width', 1.5)
        .attr('stroke-opacity', 0.6)

      // Scenario B edge (dashed)
      linksG.append('line')
        .attr('x1', sx).attr('y1', sy)
        .attr('x2', tx).attr('y2', ty)
        .attr('stroke', '#f97316')
        .attr('stroke-width', 1.5)
        .attr('stroke-opacity', 0.4)
        .attr('stroke-dasharray', '6 4')
    })

    // Nodes
    const nodesG = rootG.append('g').attr('class', 'nodes')
    root.each((d) => {
      const angle = d.x ?? 0
      const radius = d.y ?? 0
      const x = radius * Math.cos(angle - Math.PI / 2)
      const y = radius * Math.sin(angle - Math.PI / 2)

      const mergeNode = d.data.node
      const nodeG = nodesG.append('g')
        .attr('transform', `translate(${x},${y})`)

      // Color by agreement
      let fillColor = '#475569' // neutral
      let strokeColor = '#64748b'
      if (mergeNode.isConvergent) {
        fillColor = '#22c55e20'
        strokeColor = '#22c55e'
      } else if (mergeNode.isDivergent) {
        fillColor = '#ef444420'
        strokeColor = '#ef4444'
      }

      // Node circle
      nodeG.append('circle')
        .attr('r', 20)
        .attr('fill', fillColor)
        .attr('stroke', strokeColor)
        .attr('stroke-width', 1.5)

      // Text
      nodeG.append('text')
        .attr('text-anchor', 'middle')
        .attr('dy', '0.35em')
        .attr('fill', '#f1f5f9')
        .attr('font-size', '8px')
        .text(mergeNode.text.slice(0, 20) + (mergeNode.text.length > 20 ? '...' : ''))
    })

    return () => {
      svg.selectAll('g.merge-root').remove()
      svg.on('.zoom', null)
    }
  }, [treeData, width, height])

  return (
    <div ref={containerRef} className="relative w-full h-full overflow-hidden bg-surface-900">
      <svg ref={svgRef} width={width} height={height} className="block" />

      {/* Legend */}
      <div className="absolute top-4 left-4 bg-surface-800/90 border border-surface-700 rounded-lg p-3 text-xs space-y-1.5">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full border-2 border-confidence-high bg-confidence-high/10" />
          <span className="text-text-secondary">Convergent (beliefs align)</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full border-2 border-confidence-low bg-confidence-low/10" />
          <span className="text-text-secondary">Divergent (beliefs differ)</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-6 h-0 border-t-2 border-evidence-supporting" />
          <span className="text-text-secondary">Scenario A edges</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-6 h-0 border-t-2 border-dashed border-evidence-contested" />
          <span className="text-text-secondary">Scenario B edges</span>
        </div>
      </div>

      {/* Zoom controls */}
      <div className="absolute bottom-4 right-4 flex flex-col gap-1">
        <button
          onClick={() => {
            if (!svgRef.current || !zoomBehaviorRef.current) return
            select(svgRef.current).transition().duration(300).call(
              zoomBehaviorRef.current.scaleBy, 1.3,
            )
          }}
          className="w-8 h-8 flex items-center justify-center rounded-lg bg-surface-800 border border-surface-600 text-text-secondary hover:text-text-primary hover:bg-surface-700 transition-colors text-lg"
          aria-label="Zoom in"
        >
          +
        </button>
        <button
          onClick={() => {
            if (!svgRef.current || !zoomBehaviorRef.current) return
            select(svgRef.current).transition().duration(300).call(
              zoomBehaviorRef.current.scaleBy, 0.7,
            )
          }}
          className="w-8 h-8 flex items-center justify-center rounded-lg bg-surface-800 border border-surface-600 text-text-secondary hover:text-text-primary hover:bg-surface-700 transition-colors text-lg"
          aria-label="Zoom out"
        >
          &minus;
        </button>
        <button
          onClick={() => {
            if (!svgRef.current || !zoomBehaviorRef.current) return
            select(svgRef.current).transition().duration(500).call(
              zoomBehaviorRef.current.transform, zoomIdentity,
            )
          }}
          className="w-8 h-8 flex items-center justify-center rounded-lg bg-surface-800 border border-surface-600 text-text-secondary hover:text-text-primary hover:bg-surface-700 transition-colors text-xs"
          aria-label="Reset zoom"
        >
          1:1
        </button>
      </div>
    </div>
  )
}

// --- Helper to build a tree from graph + merged nodes ---

function buildMergeTree(graph: CausalGraph, mergedNodes: MergeNode[]): TreeDatum {
  const nodeMap = new Map(mergedNodes.map((n) => [n.id, n]))

  // Find root
  const incomingTargets = new Set(graph.edges.map((e) => e.targetId))
  let rootId = graph.nodes.find((n) => !incomingTargets.has(n.id))?.id
  if (!rootId && graph.nodes.length > 0) {
    rootId = graph.nodes[0].id
  }
  if (!rootId) {
    const fallbackNode: MergeNode = {
      id: 'empty',
      text: 'Empty',
      beliefA: null,
      beliefB: null,
      confidenceA: 0,
      confidenceB: 0,
      isDivergent: false,
      isConvergent: false,
    }
    return { id: 'empty', node: fallbackNode, children: [] }
  }

  // Adjacency
  const adjacency = new Map<string, string[]>()
  for (const edge of graph.edges) {
    const children = adjacency.get(edge.sourceId) ?? []
    children.push(edge.targetId)
    adjacency.set(edge.sourceId, children)
  }

  const visited = new Set<string>()

  function build(nodeId: string): TreeDatum | null {
    if (visited.has(nodeId)) return null
    visited.add(nodeId)

    const node = nodeMap.get(nodeId)
    if (!node) return null

    const childIds = adjacency.get(nodeId) ?? []
    const children: TreeDatum[] = []
    for (const childId of childIds) {
      const child = build(childId)
      if (child) children.push(child)
    }

    return { id: nodeId, node, children }
  }

  return build(rootId) ?? {
    id: rootId,
    node: nodeMap.get(rootId) ?? {
      id: rootId,
      text: rootId,
      beliefA: null,
      beliefB: null,
      confidenceA: 0,
      confidenceB: 0,
      isDivergent: false,
      isConvergent: false,
    },
    children: [],
  }
}
