import { useState, useCallback, useEffect } from 'react'
import { apiPost, apiGet, apiDelete, ApiError } from '../lib/api/client.ts'
import { useAnalysis, type ScenarioState } from '../context/AnalysisContext.tsx'
import { transformApiGraph } from './useGraphOperations.ts'
import type { ForkRequest, ScenarioComparison } from '../types/api.ts'
import type { BeliefChange, CausalGraph } from '../types/graph.ts'

interface ForkParams {
  name: string
  description?: string
  edgeOverrides: Record<string, number>
  injectedEvents: string[]
}

export interface ImpactNode {
  id: string
  text: string
  oldBelief: number
  newBelief: number
  delta: number
}

export interface ScenarioImpact {
  scenarioId: string
  scenarioName: string
  affectedCount: number
  topIncreased: ImpactNode[]
  topDecreased: ImpactNode[]
  narrative: string | null
  keyInsights: string[]
  conclusion: string | null
}

interface ApiScenarioResponse {
  id: string
  project_id: string
  name: string
  description: string | null
  parent_scenario_id: string | null
  narrative: string | null
  key_insights: string[]
  conclusion: string | null
  edge_change_reasons: Array<{
    edge_id: string
    reason: string
    old_strength: number
    new_strength: number
  }>
}

interface ApiForkWithGraphResponse {
  scenario: ApiScenarioResponse
  graph: Record<string, unknown>
  narrative: string | null
  key_insights: string[]
  conclusion: string | null
  edge_change_reasons: Array<{
    edge_id: string
    reason: string
    old_strength: number
    new_strength: number
  }>
}

export function useScenario(projectId: string | null) {
  const { state, dispatch } = useAnalysis()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const scenarios = state.scenarios

  // Load scenarios from backend on mount when projectId is available
  useEffect(() => {
    if (!projectId) return

    let cancelled = false

    async function loadScenarios() {
      try {
        const result = await apiGet<{ scenarios: ApiScenarioResponse[] }>(
          `/api/v1/scenarios/${projectId}`,
        )
        if (cancelled) return
        if (result.scenarios.length > 0) {
          const loaded: ScenarioState[] = result.scenarios.map((s) => ({
            id: s.id,
            name: s.name,
            description: s.description ?? undefined,
            graph: null,
            narrative: s.narrative ?? undefined,
            keyInsights: s.key_insights ?? [],
            conclusion: s.conclusion ?? undefined,
            edgeChangeReasons: s.edge_change_reasons ?? [],
          }))
          dispatch({ type: 'LOAD_SCENARIOS', scenarios: loaded })
        }
      } catch {
        // Silently fail — scenarios will just be empty
      }
    }

    void loadScenarios()
    return () => { cancelled = true }
  }, [projectId, dispatch])

  const forkScenario = useCallback(async (params: ForkParams): Promise<ScenarioImpact | null> => {
    if (!projectId) {
      setError('No project ID')
      return null
    }

    setLoading(true)
    setError(null)

    try {
      const request: ForkRequest = {
        project_id: projectId,
        name: params.name,
        description: params.description,
        edge_overrides: params.edgeOverrides,
        injected_events: params.injectedEvents,
      }

      const result = await apiPost<ApiForkWithGraphResponse>(
        '/api/v1/fork',
        request,
      )

      const scenarioGraph = transformApiGraph(result.graph)
      const scenario: ScenarioState = {
        id: result.scenario.id,
        name: result.scenario.name,
        description: result.scenario.description ?? undefined,
        graph: scenarioGraph,
      }

      dispatch({ type: 'ADD_SCENARIO', scenario })

      // Compute impact analysis: belief deltas between current graph and scenario graph
      const baseGraph = state.graph
      if (baseGraph && scenarioGraph) {
        const impactNodes: ImpactNode[] = []
        const scenarioNodeMap = new Map(scenarioGraph.nodes.map((n) => [n.id, n]))
        const baseNodeMap = new Map(baseGraph.nodes.map((n) => [n.id, n]))
        for (const baseNode of baseGraph.nodes) {
          const scenarioNode = scenarioNodeMap.get(baseNode.id)
          if (!scenarioNode) continue
          const oldBelief = baseNode.belief ?? baseNode.confidence
          const newBelief = scenarioNode.belief ?? scenarioNode.confidence
          const delta = newBelief - oldBelief
          if (Math.abs(delta) > 0.005) {
            impactNodes.push({
              id: baseNode.id,
              text: baseNode.text,
              oldBelief,
              newBelief,
              delta,
            })
          }
        }

        // Sort by absolute delta
        impactNodes.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))

        return {
          scenarioId: scenario.id,
          scenarioName: scenario.name,
          affectedCount: impactNodes.length,
          topIncreased: impactNodes.filter((n) => n.delta > 0).slice(0, 5),
          topDecreased: impactNodes.filter((n) => n.delta < 0).slice(0, 5),
          narrative: result.narrative ?? null,
          keyInsights: result.key_insights ?? [],
          conclusion: result.conclusion ?? null,
        }
      }

      return null
    } catch (err) {
      const message = err instanceof ApiError
        ? `Fork failed: ${err.body}`
        : err instanceof Error
          ? err.message
          : 'Failed to create scenario fork'
      setError(message)
      return null
    } finally {
      setLoading(false)
    }
  }, [projectId, state.graph, dispatch])

  const compareScenarios = useCallback(async (
    scenarioAId: string,
    scenarioBId: string,
  ): Promise<ScenarioComparison | null> => {
    setLoading(true)
    setError(null)

    try {
      const comparison = await apiGet<ScenarioComparison>(
        `/api/v1/compare?scenario_a_id=${encodeURIComponent(scenarioAId)}&scenario_b_id=${encodeURIComponent(scenarioBId)}`,
      )
      return comparison
    } catch (err) {
      const message = err instanceof ApiError
        ? `Comparison failed: ${err.body}`
        : err instanceof Error
          ? err.message
          : 'Failed to compare scenarios'
      setError(message)
      return null
    } finally {
      setLoading(false)
    }
  }, [])

  const loadScenarioReport = useCallback(async (scenarioId: string): Promise<ScenarioImpact | null> => {
    setLoading(true)
    setError(null)

    try {
      const result = await apiGet<ApiForkWithGraphResponse>(
        `/api/v1/scenario/${scenarioId}/report`,
      )

      const scenarioGraph = transformApiGraph(result.graph)
      const baseGraph = state.graph

      if (baseGraph && scenarioGraph) {
        const impactNodes: ImpactNode[] = []
        const scenarioNodeMap = new Map(scenarioGraph.nodes.map((n) => [n.id, n]))
        for (const baseNode of baseGraph.nodes) {
          const scenarioNode = scenarioNodeMap.get(baseNode.id)
          if (!scenarioNode) continue
          const oldBelief = baseNode.belief ?? baseNode.confidence
          const newBelief = scenarioNode.belief ?? scenarioNode.confidence
          const delta = newBelief - oldBelief
          if (Math.abs(delta) > 0.005) {
            impactNodes.push({
              id: baseNode.id,
              text: baseNode.text,
              oldBelief,
              newBelief,
              delta,
            })
          }
        }
        impactNodes.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))

        return {
          scenarioId: result.scenario.id,
          scenarioName: result.scenario.name,
          affectedCount: impactNodes.length,
          topIncreased: impactNodes.filter((n) => n.delta > 0).slice(0, 5),
          topDecreased: impactNodes.filter((n) => n.delta < 0).slice(0, 5),
          narrative: result.narrative ?? null,
          keyInsights: result.key_insights ?? [],
          conclusion: result.conclusion ?? null,
        }
      }

      return null
    } catch (err) {
      const message = err instanceof ApiError
        ? `Load report failed: ${err.body}`
        : err instanceof Error
          ? err.message
          : 'Failed to load scenario report'
      setError(message)
      return null
    } finally {
      setLoading(false)
    }
  }, [state.graph])

  const regenerateReport = useCallback(async (scenarioId: string): Promise<boolean> => {
    setLoading(true)
    setError(null)

    try {
      const result = await apiPost<ApiScenarioResponse>(
        `/api/v1/scenario/${scenarioId}/regenerate`,
        {},
      )

      // Update the scenario in local state with the new report fields
      const updated: ScenarioState = {
        id: result.id,
        name: result.name,
        description: result.description ?? undefined,
        graph: null,
        narrative: result.narrative ?? undefined,
        keyInsights: result.key_insights ?? [],
        conclusion: result.conclusion ?? undefined,
        edgeChangeReasons: result.edge_change_reasons ?? [],
      }
      dispatch({ type: 'REMOVE_SCENARIO', scenarioId })
      dispatch({ type: 'ADD_SCENARIO', scenario: updated })
      return true
    } catch (err) {
      const message = err instanceof ApiError
        ? `Regenerate failed: ${err.body}`
        : err instanceof Error
          ? err.message
          : 'Failed to regenerate report'
      setError(message)
      return false
    } finally {
      setLoading(false)
    }
  }, [dispatch])

  const deleteScenario = useCallback(async (scenarioId: string) => {
    try {
      await apiDelete(`/api/v1/scenarios/${scenarioId}`)
    } catch {
      // Best-effort — remove from local state regardless
    }
    dispatch({ type: 'REMOVE_SCENARIO', scenarioId })
  }, [dispatch])

  return { scenarios, forkScenario, deleteScenario, compareScenarios, loadScenarioReport, regenerateReport, loading, error }
}
