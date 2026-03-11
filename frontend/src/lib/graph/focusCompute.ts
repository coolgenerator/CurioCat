import type { CausalGraph, PathInfo } from '../../types/graph.ts'

/**
 * Bidirectional BFS from focusNodeId — returns all node IDs within maxHops.
 * Traverses both successors and predecessors.
 * Complexity: O(V + E)
 */
export function computeVisibleNodes(
  graph: CausalGraph,
  focusNodeId: string,
  maxHops: number,
): Set<string> {
  // Build adjacency maps (both directions)
  const successors = new Map<string, string[]>()
  const predecessors = new Map<string, string[]>()
  for (const edge of graph.edges) {
    let s = successors.get(edge.sourceId)
    if (!s) { s = []; successors.set(edge.sourceId, s) }
    s.push(edge.targetId)

    let p = predecessors.get(edge.targetId)
    if (!p) { p = []; predecessors.set(edge.targetId, p) }
    p.push(edge.sourceId)
  }

  // BFS
  const visited = new Set<string>([focusNodeId])
  const queue: [string, number][] = [[focusNodeId, 0]]
  let head = 0
  while (head < queue.length) {
    const [node, dist] = queue[head++]
    if (dist >= maxHops) continue
    const neighbors = [
      ...(successors.get(node) ?? []),
      ...(predecessors.get(node) ?? []),
    ]
    for (const neighbor of neighbors) {
      if (!visited.has(neighbor)) {
        visited.add(neighbor)
        queue.push([neighbor, dist + 1])
      }
    }
  }
  return visited
}

/**
 * Find top-K causal paths leading to targetId.
 *
 * Algorithm:
 * 1. Reverse BFS from target to find ancestor set — O(V+E)
 * 2. Identify root nodes (in-degree 0 within ancestor set)
 * 3. DFS from each root with pruning:
 *    - Only visit ancestors of target
 *    - Depth ≤ maxLen
 *    - Prune when running probability < current top-K minimum
 *    - Cap total candidates at 200
 */
export function findTopPaths(
  graph: CausalGraph,
  targetId: string,
  maxPaths: number = 10,
  maxLen: number = 6,
): PathInfo[] {
  // Build forward adjacency + edge strength map
  const successors = new Map<string, string[]>()
  const strengthMap = new Map<string, number>() // "sourceId->targetId" => strength
  for (const edge of graph.edges) {
    let s = successors.get(edge.sourceId)
    if (!s) { s = []; successors.set(edge.sourceId, s) }
    s.push(edge.targetId)
    // Use max strength if multiple edges between same pair
    const key = `${edge.sourceId}->${edge.targetId}`
    const existing = strengthMap.get(key)
    if (existing === undefined || edge.strength > existing) {
      strengthMap.set(key, edge.strength)
    }
  }

  // Reverse BFS from target to find all ancestors
  const predecessors = new Map<string, string[]>()
  for (const edge of graph.edges) {
    let p = predecessors.get(edge.targetId)
    if (!p) { p = []; predecessors.set(edge.targetId, p) }
    p.push(edge.sourceId)
  }

  const ancestors = new Set<string>([targetId])
  const rQueue: string[] = [targetId]
  let rHead = 0
  while (rHead < rQueue.length) {
    const node = rQueue[rHead++]
    for (const pred of (predecessors.get(node) ?? [])) {
      if (!ancestors.has(pred)) {
        ancestors.add(pred)
        rQueue.push(pred)
      }
    }
  }

  // Find root nodes (in-degree 0 within ancestor set)
  const hasIncomingInAncestors = new Set<string>()
  for (const edge of graph.edges) {
    if (ancestors.has(edge.sourceId) && ancestors.has(edge.targetId)) {
      hasIncomingInAncestors.add(edge.targetId)
    }
  }
  const roots: string[] = []
  for (const id of ancestors) {
    if (!hasIncomingInAncestors.has(id) && id !== targetId) {
      roots.push(id)
    }
  }
  // If target has no ancestors, no paths to find
  if (roots.length === 0 && ancestors.size <= 1) return []

  // Also start from target itself if it's a root (self-loop edge case: skip)
  // DFS from each root to target
  const results: PathInfo[] = []
  const MAX_CANDIDATES = 200
  let minProb = 0 // minimum probability in results once we have maxPaths

  function dfs(
    node: string,
    path: string[],
    prob: number,
    visited: Set<string>,
  ) {
    if (results.length >= MAX_CANDIDATES) return

    if (node === targetId) {
      results.push({ path: [...path], compoundProbability: prob })
      // Update pruning threshold
      if (results.length >= maxPaths) {
        results.sort((a, b) => b.compoundProbability - a.compoundProbability)
        if (results.length > maxPaths) results.length = maxPaths
        minProb = results[results.length - 1].compoundProbability
      }
      return
    }

    if (path.length >= maxLen) return

    // Prune: can't beat current minimum
    if (results.length >= maxPaths && prob <= minProb) return

    for (const next of (successors.get(node) ?? [])) {
      if (!ancestors.has(next) || visited.has(next)) continue
      const strength = strengthMap.get(`${node}->${next}`) ?? 0.5
      const nextProb = prob * strength
      // Prune early
      if (results.length >= maxPaths && nextProb <= minProb) continue

      visited.add(next)
      path.push(next)
      dfs(next, path, nextProb, visited)
      path.pop()
      visited.delete(next)

      if (results.length >= MAX_CANDIDATES) return
    }
  }

  for (const root of roots) {
    if (results.length >= MAX_CANDIDATES) break
    const visited = new Set<string>([root])
    dfs(root, [root], 1.0, visited)
  }

  // Final sort and trim
  results.sort((a, b) => b.compoundProbability - a.compoundProbability)
  return results.slice(0, maxPaths)
}
