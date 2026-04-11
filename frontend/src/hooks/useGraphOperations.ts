import { useCallback, useState } from 'react'
import { toast } from 'sonner'
import { apiPost, apiGet } from '../lib/api/client.ts'
import { useAnalysis } from '../context/AnalysisContext.tsx'
import { useT } from '../i18n/index.tsx'
import { computeVisibleNodes, findTopPaths } from '../lib/graph/focusCompute.ts'
import type {
  ApiGraphOperationResult,
  ApiChallengeResult,
  ApiWhatIfResult,
  ApiAdviseResult,
  ApiSuggestPerspectivesResult,
  WhatIfModification,
} from '../types/api.ts'
import type { BeliefChange, CausalGraph, CausalType, ConditionType } from '../types/graph.ts'

// Transform API snake_case graph to camelCase CausalGraph
export function transformApiGraph(api: Record<string, unknown>): CausalGraph {
  const nodes = (api.claims as Array<Record<string, unknown>>)?.map((n) => ({
    id: n.id as string,
    text: n.text as string,
    claimType: n.claim_type as CausalGraph['nodes'][0]['claimType'],
    confidence: n.confidence as number,
    belief: (n.belief as number) ?? null,
    sensitivity: (n.sensitivity as number) ?? null,
    isCriticalPath: (n.is_critical_path as boolean) ?? false,
    isConvergencePoint: (n.is_convergence_point as boolean) ?? false,
    orderIndex: n.order_index as number,
    logicGate: (n.logic_gate as 'or' | 'and') ?? 'or',
    sourceSentence: (n.source_sentence as string) ?? null,
    beliefLow: (n.belief_low as number) ?? null,
    beliefHigh: (n.belief_high as number) ?? null,
  })) ?? []

  const edges = (api.edges as Array<Record<string, unknown>>)?.map((e) => ({
    id: e.id as string,
    sourceId: e.source_claim_id as string,
    targetId: e.target_claim_id as string,
    mechanism: e.mechanism as string,
    strength: e.strength as number,
    timeDelay: (e.time_delay as string) ?? null,
    conditions: (e.conditions as string[]) ?? null,
    reversible: e.reversible as boolean,
    evidenceScore: e.evidence_score as number,
    sensitivity: (e.sensitivity as number) ?? null,
    causalType: ((e.causal_type as string) ?? 'direct') as CausalType,
    conditionType: ((e.condition_type as string) ?? 'contributing') as ConditionType,
    temporalWindow: (e.temporal_window as string) ?? null,
    decayType: (e.decay_type as string) ?? 'none',
    biasWarnings: (e.bias_warnings as Array<{ type: string; explanation: string; severity: 'low' | 'medium' | 'high' }>) ?? [],
    consensusLevel: (e.consensus_level as string) ?? 'insufficient',
    isFeedback: (e.is_feedback as boolean) ?? false,
    evidences: ((e.evidences as Array<Record<string, unknown>>) ?? []).map((ev) => ({
      id: ev.id as string,
      evidenceType: ev.evidence_type as 'supporting' | 'contradicting',
      sourceUrl: ev.source_url as string,
      sourceTitle: ev.source_title as string,
      sourceType: ev.source_type as string,
      snippet: ev.snippet as string,
      relevanceScore: ev.relevance_score as number,
      credibilityScore: ev.credibility_score as number,
      sourceTier: (ev.source_tier as number) ?? 4,
    })),
  })) ?? []

  return {
    projectId: api.project_id as string,
    nodes,
    edges,
    criticalPath: (api.critical_path as string[]) ?? [],
    hasTemporal: (api.has_temporal as boolean) ?? true,
  }
}

function transformBeliefChanges(
  api: Record<string, { old_belief: number; new_belief: number; delta: number }>
): Record<string, BeliefChange> {
  const result: Record<string, BeliefChange> = {}
  for (const [id, change] of Object.entries(api)) {
    result[id] = {
      oldBelief: change.old_belief,
      newBelief: change.new_belief,
      delta: change.delta,
    }
  }
  return result
}

export function useGraphOperations(projectId: string | null) {
  const { state, dispatch } = useAnalysis()
  const { t } = useT()
  const [error, setError] = useState<string | null>(null)

  const expand = useCallback(async (nodeId: string, reasoning?: string) => {
    if (!projectId) return
    dispatch({ type: 'SET_OPERATION_LOADING', operation: 'expand' })
    setError(null)
    try {
      const result = await apiPost<ApiGraphOperationResult>(
        `/api/v1/graph/${projectId}/expand`,
        { node_id: nodeId, user_reasoning: reasoning || undefined }
      )
      const graph = transformApiGraph(result.graph)
      dispatch({ type: 'MERGE_GRAPH_UPDATE', graph })
      if (result.converged_edges.length > 0) {
        toast.success(t.operations.convergenceFound)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Expand failed'
      setError(msg)
      toast.error(msg)
      dispatch({ type: 'SET_OPERATION_LOADING', operation: null })
    }
  }, [projectId, dispatch, t])

  const traceBack = useCallback(async (nodeId: string, reasoning?: string) => {
    if (!projectId) return
    dispatch({ type: 'SET_OPERATION_LOADING', operation: 'trace-back' })
    setError(null)
    try {
      const result = await apiPost<ApiGraphOperationResult>(
        `/api/v1/graph/${projectId}/trace-back`,
        { node_id: nodeId, user_reasoning: reasoning || undefined }
      )
      const graph = transformApiGraph(result.graph)
      dispatch({ type: 'MERGE_GRAPH_UPDATE', graph })
      if (result.converged_edges.length > 0) {
        toast.success(t.operations.convergenceFound)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Trace back failed'
      setError(msg)
      toast.error(msg)
      dispatch({ type: 'SET_OPERATION_LOADING', operation: null })
    }
  }, [projectId, dispatch, t])

  const challenge = useCallback(async (edgeId: string, reasoning?: string) => {
    if (!projectId) return
    dispatch({ type: 'SET_OPERATION_LOADING', operation: 'challenge' })
    setError(null)
    try {
      const result = await apiPost<ApiChallengeResult>(
        `/api/v1/graph/${projectId}/challenge`,
        { edge_id: edgeId, user_reasoning: reasoning || undefined }
      )
      const graph = transformApiGraph(result.graph)
      dispatch({ type: 'MERGE_GRAPH_UPDATE', graph })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Challenge failed'
      setError(msg)
      toast.error(msg)
      dispatch({ type: 'SET_OPERATION_LOADING', operation: null })
    }
  }, [projectId, dispatch])

  const whatIf = useCallback(async (modifications: WhatIfModification[]) => {
    if (!projectId || !state.graph) return
    dispatch({ type: 'SET_OPERATION_LOADING', operation: 'what-if' })
    setError(null)
    try {
      const result = await apiPost<ApiWhatIfResult>(
        `/api/v1/graph/${projectId}/what-if`,
        { modifications }
      )
      const modifiedGraph = transformApiGraph(result.modified_graph)
      const changes = transformBeliefChanges(
        result.changes as Record<string, { old_belief: number; new_belief: number; delta: number }>
      )
      dispatch({ type: 'SET_COMPARE', baseline: state.graph, changes })
      // Store modified graph for potential apply
      dispatch({ type: 'SET_OPERATION_LOADING', operation: null })
      return { modifiedGraph, changes }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'What-if failed'
      setError(msg)
      toast.error(msg)
      dispatch({ type: 'SET_OPERATION_LOADING', operation: null })
      return null
    }
  }, [projectId, state.graph, dispatch])

  const focus = useCallback((nodeId: string, maxHops: number = 2) => {
    if (!state.graph) return
    const visibleIds = computeVisibleNodes(state.graph, nodeId, maxHops)
    const paths = findTopPaths(state.graph, nodeId)
    dispatch({
      type: 'SET_FOCUS',
      nodeId,
      visibleIds,
      paths,
    })
  }, [state.graph, dispatch])

  const clearFocus = useCallback(() => {
    dispatch({ type: 'CLEAR_FOCUS' })
  }, [dispatch])

  const clearCompare = useCallback(() => {
    dispatch({ type: 'CLEAR_COMPARE' })
  }, [dispatch])

  const applyCompare = useCallback((modifiedGraph: CausalGraph) => {
    dispatch({ type: 'MERGE_GRAPH_UPDATE', graph: modifiedGraph })
    dispatch({ type: 'CLEAR_COMPARE' })
  }, [dispatch])

  const suggestPerspectives = useCallback(async (): Promise<ApiSuggestPerspectivesResult | null> => {
    if (!projectId) return null
    try {
      return await apiGet<ApiSuggestPerspectivesResult>(
        `/api/v1/graph/${projectId}/suggest-perspectives`
      )
    } catch {
      return null
    }
  }, [projectId])

  const advise = useCallback(async (userContext: string, perspectiveTags: string[]): Promise<ApiAdviseResult | null> => {
    if (!projectId) return null
    dispatch({ type: 'SET_OPERATION_LOADING', operation: 'advise' })
    setError(null)
    try {
      const result = await apiPost<ApiAdviseResult>(
        `/api/v1/graph/${projectId}/advise`,
        { user_context: userContext, perspective_tags: perspectiveTags }
      )
      dispatch({ type: 'SET_OPERATION_LOADING', operation: null })
      return result
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Advise failed'
      setError(msg)
      toast.error(msg)
      dispatch({ type: 'SET_OPERATION_LOADING', operation: null })
      return null
    }
  }, [projectId, dispatch])

  const adviseStream = useCallback((
    userContext: string,
    perspectiveTags: string[],
    onToken: (text: string) => void,
    onComplete: () => void,
    onError: (msg: string) => void,
  ): (() => void) => {
    if (!projectId) return () => {}
    dispatch({ type: 'SET_OPERATION_LOADING', operation: 'advise' })

    // POST the request body, then read the SSE stream from the response
    const abortController = new AbortController()

    fetch(`/api/v1/graph/${projectId}/advise/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_context: userContext, perspective_tags: perspectiveTags }),
      signal: abortController.signal,
    })
      .then(async (res) => {
        if (!res.ok || !res.body) throw new Error(`API error: ${res.status}`)
        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''

        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })

          // Parse SSE events from buffer
          const lines = buffer.split('\n')
          buffer = lines.pop() ?? ''

          for (const line of lines) {
            if (line.startsWith('data:')) {
              const data = line.slice(5).trim()
              if (!data) continue
              try {
                const parsed = JSON.parse(data)
                if (parsed.text) onToken(parsed.text)
                if (parsed.status === 'done') {
                  dispatch({ type: 'SET_OPERATION_LOADING', operation: null })
                  onComplete()
                  return
                }
                if (parsed.message) {
                  dispatch({ type: 'SET_OPERATION_LOADING', operation: null })
                  onError(parsed.message)
                  return
                }
              } catch { /* skip malformed JSON */ }
            }
          }
        }
        dispatch({ type: 'SET_OPERATION_LOADING', operation: null })
        onComplete()
      })
      .catch((err) => {
        if (err.name !== 'AbortError') {
          dispatch({ type: 'SET_OPERATION_LOADING', operation: null })
          onError(err.message)
        }
      })

    return () => abortController.abort()
  }, [projectId, dispatch])

  return {
    expand,
    traceBack,
    challenge,
    whatIf,
    focus,
    clearFocus,
    clearCompare,
    applyCompare,
    suggestPerspectives,
    advise,
    adviseStream,
    error,
  }
}
