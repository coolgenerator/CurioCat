import { useMemo, useCallback } from 'react'
import type { CausalGraph, TemporalBeliefSample } from '../types/graph.ts'
import { computeTemporalBeliefs, interpolateBelief } from '../lib/graphUtils.ts'

export function useTemporalBeliefs(
  graph: CausalGraph | null,
  cumulativeTime: Map<string, number>,
) {
  const temporalBeliefs = useMemo(() => {
    if (!graph) return new Map<string, TemporalBeliefSample[]>()
    return computeTemporalBeliefs(graph.nodes, graph.edges, cumulativeTime)
  }, [graph, cumulativeTime])

  const getBeliefAtTime = useCallback(
    (nodeId: string, time: number): number => {
      const samples = temporalBeliefs.get(nodeId)
      if (!samples) return 0
      return interpolateBelief(samples, time)
    },
    [temporalBeliefs],
  )

  const getSamples = useCallback(
    (nodeId: string): TemporalBeliefSample[] => {
      return temporalBeliefs.get(nodeId) ?? []
    },
    [temporalBeliefs],
  )

  return { temporalBeliefs, getBeliefAtTime, getSamples }
}
