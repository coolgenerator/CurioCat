import type { CausalNode, CausalEdge, TemporalBeliefSample } from '../types/graph.ts'
import { parseTimeDelayDays } from './visualConstants.ts'

/**
 * DAG-aware topological depth computation using Kahn's algorithm.
 * Shared between useForceLayout (for positioning) and ClaimsBrowser (for grouping).
 */
export function computeDepths(
  nodes: CausalNode[],
  edges: CausalEdge[],
): { depths: Map<string, number>; parentIds: Map<string, string[]>; childIds: Map<string, string[]>; rootId: string } {
  const adjacency = new Map<string, string[]>()
  const reverseAdj = new Map<string, string[]>()
  const nodeSet = new Set(nodes.map((n) => n.id))

  for (const n of nodes) {
    adjacency.set(n.id, [])
    reverseAdj.set(n.id, [])
  }

  for (const edge of edges) {
    if (!nodeSet.has(edge.sourceId) || !nodeSet.has(edge.targetId)) continue
    adjacency.get(edge.sourceId)!.push(edge.targetId)
    reverseAdj.get(edge.targetId)!.push(edge.sourceId)
  }

  // Find roots (no incoming edges)
  const roots = nodes.filter((n) => (reverseAdj.get(n.id) ?? []).length === 0)
  const rootId = roots.length > 0
    ? roots[0].id
    : [...nodes].sort((a, b) => a.orderIndex - b.orderIndex)[0]?.id ?? ''

  // Kahn's algorithm for topological sort + depth assignment
  const inDegree = new Map<string, number>()
  for (const n of nodes) {
    inDegree.set(n.id, (reverseAdj.get(n.id) ?? []).length)
  }

  const depths = new Map<string, number>()
  const queue: string[] = []

  for (const n of nodes) {
    if (inDegree.get(n.id) === 0) {
      queue.push(n.id)
      depths.set(n.id, 0)
    }
  }

  while (queue.length > 0) {
    const nodeId = queue.shift()!
    const currentDepth = depths.get(nodeId) ?? 0

    for (const childId of adjacency.get(nodeId) ?? []) {
      // Depth = max(all parent depths) + 1
      const existingDepth = depths.get(childId) ?? 0
      depths.set(childId, Math.max(existingDepth, currentDepth + 1))

      const remaining = (inDegree.get(childId) ?? 1) - 1
      inDegree.set(childId, remaining)
      if (remaining === 0) {
        queue.push(childId)
      }
    }
  }

  // Handle nodes not reached (cycles or disconnected) — assign depth 0
  for (const n of nodes) {
    if (!depths.has(n.id)) {
      depths.set(n.id, 0)
    }
  }

  return {
    depths,
    parentIds: reverseAdj,
    childIds: adjacency,
    rootId,
  }
}

/**
 * Cumulative time computation using Kahn's algorithm.
 * Each node's time = max(parentTime + edgeDelay) across all incoming edges.
 * Returns Map<nodeId, cumulativeDays> where root nodes have time 0.
 */
export function computeCumulativeTime(
  nodes: CausalNode[],
  edges: CausalEdge[],
): Map<string, number> {
  const nodeSet = new Set(nodes.map((n) => n.id))
  const adjacency = new Map<string, string[]>()
  const reverseAdj = new Map<string, string[]>()

  // Edge lookup: "sourceId->targetId" → CausalEdge
  const edgeLookup = new Map<string, CausalEdge>()

  for (const n of nodes) {
    adjacency.set(n.id, [])
    reverseAdj.set(n.id, [])
  }

  for (const edge of edges) {
    if (!nodeSet.has(edge.sourceId) || !nodeSet.has(edge.targetId)) continue
    adjacency.get(edge.sourceId)!.push(edge.targetId)
    reverseAdj.get(edge.targetId)!.push(edge.sourceId)
    edgeLookup.set(`${edge.sourceId}->${edge.targetId}`, edge)
  }

  // Kahn's algorithm
  const inDegree = new Map<string, number>()
  for (const n of nodes) {
    inDegree.set(n.id, (reverseAdj.get(n.id) ?? []).length)
  }

  const cumTime = new Map<string, number>()
  const queue: string[] = []

  for (const n of nodes) {
    if (inDegree.get(n.id) === 0) {
      queue.push(n.id)
      cumTime.set(n.id, 0)
    }
  }

  while (queue.length > 0) {
    const nodeId = queue.shift()!
    const currentTime = cumTime.get(nodeId) ?? 0

    for (const childId of adjacency.get(nodeId) ?? []) {
      const edge = edgeLookup.get(`${nodeId}->${childId}`)
      const delay = edge ? parseTimeDelayDays(edge.timeDelay) : 0
      const arrivalTime = currentTime + delay

      const existing = cumTime.get(childId) ?? 0
      cumTime.set(childId, Math.max(existing, arrivalTime))

      const remaining = (inDegree.get(childId) ?? 1) - 1
      inDegree.set(childId, remaining)
      if (remaining === 0) {
        queue.push(childId)
      }
    }
  }

  // Handle unreached nodes
  for (const n of nodes) {
    if (!cumTime.has(n.id)) {
      cumTime.set(n.id, 0)
    }
  }

  return cumTime
}

/**
 * Compute decay factor for a given decay type.
 * Returns a value 0..1 representing how much of the original strength remains.
 */
export function computeDecayFactor(
  decayType: string,
  elapsed: number,
  window: number,
): number {
  if (window <= 0) return 1
  switch (decayType) {
    case 'linear':
      return Math.max(0, 1 - elapsed / window)
    case 'exponential':
      return Math.exp(-3 * elapsed / window)
    case 'accumulative':
      return Math.min(1, elapsed / window)
    case 'none':
    default:
      return 1
  }
}

/**
 * Compute temporal belief samples for every node at evenly-spaced time points.
 * Uses topological propagation with edge decay.
 */
export function computeTemporalBeliefs(
  nodes: CausalNode[],
  edges: CausalEdge[],
  cumulativeTime: Map<string, number>,
  numSamples = 30,
): Map<string, TemporalBeliefSample[]> {
  const maxTime = Math.max(1, ...Array.from(cumulativeTime.values()))
  const nodeSet = new Set(nodes.map((n) => n.id))

  // Build adjacency
  const adjacency = new Map<string, string[]>()
  const reverseAdj = new Map<string, string[]>()
  const edgesByTarget = new Map<string, CausalEdge[]>()

  for (const n of nodes) {
    adjacency.set(n.id, [])
    reverseAdj.set(n.id, [])
    edgesByTarget.set(n.id, [])
  }

  for (const edge of edges) {
    if (!nodeSet.has(edge.sourceId) || !nodeSet.has(edge.targetId)) continue
    adjacency.get(edge.sourceId)!.push(edge.targetId)
    reverseAdj.get(edge.targetId)!.push(edge.sourceId)
    edgesByTarget.get(edge.targetId)!.push(edge)
  }

  // Topological order via Kahn's algorithm
  const inDegree = new Map<string, number>()
  for (const n of nodes) {
    inDegree.set(n.id, (reverseAdj.get(n.id) ?? []).length)
  }
  const topoOrder: string[] = []
  const queue: string[] = []
  for (const n of nodes) {
    if (inDegree.get(n.id) === 0) queue.push(n.id)
  }
  while (queue.length > 0) {
    const id = queue.shift()!
    topoOrder.push(id)
    for (const childId of adjacency.get(id) ?? []) {
      const remaining = (inDegree.get(childId) ?? 1) - 1
      inDegree.set(childId, remaining)
      if (remaining === 0) queue.push(childId)
    }
  }
  // Add any unreached nodes (cycles/disconnected)
  for (const n of nodes) {
    if (!topoOrder.includes(n.id)) topoOrder.push(n.id)
  }

  // Node lookup for confidence
  const nodeMap = new Map(nodes.map((n) => [n.id, n]))

  // Initialize result
  const result = new Map<string, TemporalBeliefSample[]>()
  for (const n of nodes) result.set(n.id, [])

  // Generate samples
  for (let i = 0; i <= numSamples; i++) {
    const T = (i / numSamples) * maxTime
    const beliefAtT = new Map<string, number>()

    for (const nodeId of topoOrder) {
      const nodeCumTime = cumulativeTime.get(nodeId) ?? 0
      // Node not yet active
      if (nodeCumTime > T) {
        beliefAtT.set(nodeId, 0)
        continue
      }

      const node = nodeMap.get(nodeId)!
      const inEdges = edgesByTarget.get(nodeId) ?? []
      const isRoot = inEdges.length === 0

      if (isRoot) {
        beliefAtT.set(nodeId, node.confidence)
        continue
      }

      // Filter to active edges
      const activeEdges: { edge: CausalEdge; effectiveStrength: number; parentBelief: number }[] = []
      for (const edge of inEdges) {
        const sourceCumTime = cumulativeTime.get(edge.sourceId) ?? 0
        const edgeDelay = parseTimeDelayDays(edge.timeDelay)
        const edgeActivationTime = sourceCumTime + edgeDelay
        if (edgeActivationTime > T) continue // edge not yet active

        const parentBelief = beliefAtT.get(edge.sourceId) ?? 0
        const elapsed = T - edgeActivationTime
        const window = parseTimeDelayDays(edge.temporalWindow) || edgeDelay || maxTime
        const decay = computeDecayFactor(edge.decayType, elapsed, window)
        const effectiveStrength = edge.strength * decay

        activeEdges.push({ edge, effectiveStrength, parentBelief })
      }

      if (activeEdges.length === 0) {
        // No active parents yet — use base confidence scaled down
        beliefAtT.set(nodeId, node.confidence * 0.1)
        continue
      }

      let belief: number
      if (node.logicGate === 'and') {
        // AND-gate: minimum of (parentBelief * effectiveStrength)
        belief = Math.min(...activeEdges.map((a) => {
          const modifier = a.edge.causalType === 'inhibiting' ? (1 - a.effectiveStrength) : a.effectiveStrength
          return a.parentBelief * modifier
        }))
      } else {
        // OR-gate: Noisy-OR = 1 - ∏(1 - parentBelief * effectiveStrength)
        let product = 1
        for (const a of activeEdges) {
          if (a.edge.causalType === 'inhibiting') {
            product *= (a.parentBelief * a.effectiveStrength)
          } else {
            product *= (1 - a.parentBelief * a.effectiveStrength)
          }
        }
        belief = 1 - product
      }

      beliefAtT.set(nodeId, Math.max(0, Math.min(1, belief)))
    }

    // Store samples
    for (const nodeId of topoOrder) {
      result.get(nodeId)!.push({ time: T, belief: beliefAtT.get(nodeId) ?? 0 })
    }
  }

  return result
}

/**
 * Interpolate belief at an arbitrary time from precomputed samples.
 * Uses binary search + linear interpolation.
 */
export function interpolateBelief(
  samples: TemporalBeliefSample[],
  time: number,
): number {
  if (samples.length === 0) return 0
  if (time <= samples[0].time) return samples[0].belief
  if (time >= samples[samples.length - 1].time) return samples[samples.length - 1].belief

  // Binary search for the interval containing time
  let lo = 0
  let hi = samples.length - 1
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1
    if (samples[mid].time <= time) lo = mid
    else hi = mid
  }

  const s0 = samples[lo]
  const s1 = samples[hi]
  const dt = s1.time - s0.time
  if (dt === 0) return s0.belief
  const t = (time - s0.time) / dt
  return s0.belief + t * (s1.belief - s0.belief)
}
