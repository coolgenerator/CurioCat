export interface SSEEvent {
  type: string
  data: unknown
}

const PIPELINE_EVENTS = [
  'claim_extraction',
  'causal_inference',
  'bias_audit',
  'evidence_grounding',
  'evidence_search',
  'discovery',
  'sensitivity_analysis',
  'graph_construction',
  'dag_construction',
  'belief_propagation',
  'progress',
  'stage_update',
]

export function connectSSE(
  url: string,
  onEvent: (event: SSEEvent) => void,
  onError?: (error: Event) => void,
  onComplete?: () => void,
): () => void {
  const source = new EventSource(url)

  // Listen for generic message events
  source.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data)
      onEvent({ type: 'message', data })
    } catch {
      onEvent({ type: 'message', data: event.data })
    }
  }

  // Listen for named pipeline events
  for (const eventName of PIPELINE_EVENTS) {
    source.addEventListener(eventName, (event) => {
      try {
        const data = JSON.parse((event as MessageEvent).data)
        onEvent({ type: eventName, data })
      } catch {
        onEvent({ type: eventName, data: (event as MessageEvent).data })
      }
    })
  }

  // Listen for completion
  source.addEventListener('complete', (event) => {
    try {
      const data = JSON.parse((event as MessageEvent).data)
      onEvent({ type: 'complete', data })
    } catch {
      onEvent({ type: 'complete', data: (event as MessageEvent).data })
    }
    source.close()
    onComplete?.()
  })

  // Listen for error events from the server
  source.addEventListener('error_event', (event) => {
    try {
      const data = JSON.parse((event as MessageEvent).data)
      onEvent({ type: 'error', data })
    } catch {
      onEvent({ type: 'error', data: (event as MessageEvent).data })
    }
  })

  // Handle connection errors
  source.onerror = (error) => {
    if (source.readyState === EventSource.CLOSED) {
      onComplete?.()
    } else {
      onError?.(error)
    }
  }

  // Return cleanup function
  return () => {
    source.close()
  }
}
