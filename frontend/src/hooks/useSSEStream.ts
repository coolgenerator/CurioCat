import { useState, useEffect, useRef, useCallback } from 'react'
import { connectSSE } from '../lib/api/sse.ts'
import type { PipelineStage, ExtractedClaim, StreamedEdge } from '../types/api.ts'
import type { ClaimType } from '../types/graph.ts'

// All known pipeline stage event names
const PIPELINE_STAGE_EVENTS = new Set([
  'claim_extraction',
  'causal_inference',
  'bias_audit',
  'evidence_grounding',
  'evidence_search',
  'discovery',
  'dag_construction',
  'belief_propagation',
  'sensitivity_analysis',
  'graph_construction',
  'stage_update',
  'progress',
])

interface SSEStreamState {
  stages: PipelineStage[]
  claims: ExtractedClaim[]
  edges: StreamedEdge[]
  isComplete: boolean
  error: string | null
}

export function useSSEStream(projectId: string | null): SSEStreamState {
  const [stages, setStages] = useState<PipelineStage[]>([])
  const [claims, setClaims] = useState<ExtractedClaim[]>([])
  const [edges, setEdges] = useState<StreamedEdge[]>([])
  const [isComplete, setIsComplete] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const cleanupRef = useRef<(() => void) | null>(null)

  const updateStage = useCallback(
    (stageName: string, data: Record<string, unknown>) => {
      const layer = (data.layer as number) ?? 0
      const stageKey =
        layer > 0 ? `${stageName}_L${layer}` : stageName
      const stage: PipelineStage = {
        stage: stageKey,
        status: (data.status as string) ?? '',
        progress: (data.progress as number) ?? 0,
        data: (data.data as Record<string, unknown>) ?? null,
        timestamp:
          (data.timestamp as string) ?? new Date().toISOString(),
        layer,
      }
      setStages((prev) => {
        const idx = prev.findIndex((s) => s.stage === stage.stage)
        if (idx >= 0) {
          const updated = [...prev]
          updated[idx] = stage
          return updated
        }
        return [...prev, stage]
      })
    },
    [],
  )

  const handleEvent = useCallback(
    (event: { type: string; data: unknown }) => {
      const data = event.data as Record<string, unknown>

      // --- Pipeline stage events: update the stage timeline ---
      if (PIPELINE_STAGE_EVENTS.has(event.type)) {
        // The stage name is either in data.stage (for generic events)
        // or is the event type itself (for named SSE events)
        const stageName = (data.stage as string) ?? event.type
        updateStage(stageName, data)
      }

      // --- Additional per-event handling ---
      switch (event.type) {
        case 'claim_extraction': {
          // Also extract claims payload if present
          if (data.claims && Array.isArray(data.claims)) {
            const newClaims = (
              data.claims as Record<string, unknown>[]
            ).map((c, i) => ({
              id: (c.id as string) ?? `claim-${Date.now()}-${i}`,
              text: (c.text as string) ?? '',
              claimType: (c.claim_type as ClaimType) ?? 'OPINION',
              confidence: (c.confidence as number) ?? 0.5,
              layer: (c.layer as number) ?? 0,
            }))
            setClaims((prev) => [...prev, ...newClaims])
          }
          break
        }

        case 'discovery': {
          // Discovery may also carry new claims
          if (data.claims && Array.isArray(data.claims)) {
            const discoveredClaims = (
              data.claims as Record<string, unknown>[]
            ).map((c, i) => ({
              id:
                (c.id as string) ??
                `discovered-${Date.now()}-${i}`,
              text: (c.text as string) ?? '',
              claimType: (c.claim_type as ClaimType) ?? 'FACT',
              confidence: (c.confidence as number) ?? 0.5,
              layer: (data.layer as number) ?? 1,
            }))
            setClaims((prev) => [...prev, ...discoveredClaims])
          }
          break
        }

        case 'causal_inference': {
          // Bulk edges from completed event
          if (data.edges && Array.isArray(data.edges)) {
            setEdges((prev) => [...prev, ...(data.edges as StreamedEdge[])])
          }
          break
        }

        case 'bias_audit': {
          // Updated edges with bias warnings — merge into existing edges
          if (data.edges && Array.isArray(data.edges)) {
            const auditedEdges = data.edges as StreamedEdge[]
            setEdges((prev) => {
              const updated = [...prev]
              for (const edge of auditedEdges) {
                const idx = updated.findIndex(
                  (e) =>
                    e.source_text === edge.source_text &&
                    e.target_text === edge.target_text,
                )
                if (idx >= 0) {
                  updated[idx] = edge
                } else {
                  updated.push(edge)
                }
              }
              return updated
            })
          }
          break
        }

        case 'evidence_grounding': {
          // Per-edge progress event carries one edge at a time
          if (data.edge) {
            setEdges((prev) => {
              const edge = data.edge as StreamedEdge
              const idx = prev.findIndex(
                (e) =>
                  e.source_text === edge.source_text &&
                  e.target_text === edge.target_text,
              )
              if (idx >= 0) {
                const updated = [...prev]
                updated[idx] = edge
                return updated
              }
              return [...prev, edge]
            })
          }
          // Bulk edges from completed event — merge into existing
          if (data.edges && Array.isArray(data.edges)) {
            const groundedEdges = data.edges as StreamedEdge[]
            setEdges((prev) => {
              const updated = [...prev]
              for (const edge of groundedEdges) {
                const idx = updated.findIndex(
                  (e) =>
                    e.source_text === edge.source_text &&
                    e.target_text === edge.target_text,
                )
                if (idx >= 0) {
                  updated[idx] = edge
                } else {
                  updated.push(edge)
                }
              }
              return updated
            })
          }
          break
        }

        case 'complete': {
          setIsComplete(true)
          break
        }

        case 'error': {
          setError(
            (data.message as string) ??
              'An error occurred during analysis',
          )
          break
        }

        case 'message': {
          // Handle generic messages that might contain stage data
          if (data.stage) {
            updateStage(data.stage as string, data)
          }
          break
        }
      }
    },
    [updateStage],
  )

  useEffect(() => {
    if (!projectId) return

    // Reset state
    setStages([])
    setClaims([])
    setEdges([])
    setIsComplete(false)
    setError(null)

    const cleanup = connectSSE(
      `/api/v1/analyze/${projectId}/stream`,
      handleEvent,
      () => {
        setError('Connection lost. Please refresh the page.')
      },
      () => {
        setIsComplete(true)
      },
    )

    cleanupRef.current = cleanup

    return () => {
      cleanup()
      cleanupRef.current = null
    }
  }, [projectId, handleEvent])

  return { stages, claims, edges, isComplete, error }
}
