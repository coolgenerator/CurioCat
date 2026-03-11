import { useEffect, useRef, useState, useCallback } from 'react'
import { connectWebSocket, type WebSocketConnection } from '../lib/api/websocket.ts'
import { useAnalysis } from '../context/AnalysisContext.tsx'
import type { CausalGraph } from '../types/graph.ts'

interface GraphUpdateMessage {
  type: 'graph_update' | 'edge_update' | 'ping' | 'pong'
  graph?: CausalGraph
  edge_id?: string
  strength?: number
}

function isGraphUpdateMessage(data: unknown): data is GraphUpdateMessage {
  if (typeof data !== 'object' || data === null) return false
  const msg = data as Record<string, unknown>
  return typeof msg.type === 'string'
}

export function useGraphWebSocket(projectId: string | null) {
  const { dispatch } = useAnalysis()
  const [connected, setConnected] = useState(false)
  const connectionRef = useRef<WebSocketConnection | null>(null)
  const reconnectAttempts = useRef(0)
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const disposedRef = useRef(false)

  const MAX_RECONNECT_ATTEMPTS = 3

  const cleanup = useCallback(() => {
    disposedRef.current = true
    if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current)
      heartbeatRef.current = null
    }
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current)
      reconnectTimeoutRef.current = null
    }
    if (connectionRef.current) {
      connectionRef.current.close()
      connectionRef.current = null
    }
    setConnected(false)
  }, [])

  const connect = useCallback(() => {
    if (!projectId) return

    cleanup()
    disposedRef.current = false

    const handleMessage = (data: unknown) => {
      if (!isGraphUpdateMessage(data)) return

      switch (data.type) {
        case 'graph_update':
          if (data.graph) {
            dispatch({ type: 'SET_GRAPH', graph: data.graph })
          }
          break

        case 'edge_update':
          if (data.edge_id && data.strength !== undefined) {
            dispatch({
              type: 'UPDATE_EDGE_STRENGTH',
              edgeId: data.edge_id,
              strength: data.strength,
            })
          }
          break

        case 'pong':
          // Heartbeat acknowledged
          break
      }
    }

    const handleError = () => {
      if (disposedRef.current) return
      setConnected(false)

      if (reconnectAttempts.current < MAX_RECONNECT_ATTEMPTS) {
        reconnectAttempts.current += 1
        const delay = Math.min(1000 * Math.pow(2, reconnectAttempts.current), 10000)
        reconnectTimeoutRef.current = setTimeout(() => {
          if (!disposedRef.current) connect()
        }, delay)
      }
    }

    const ws = connectWebSocket(projectId, handleMessage, handleError)
    connectionRef.current = ws
    setConnected(true)
    reconnectAttempts.current = 0

    // Start heartbeat: send ping every 30s
    heartbeatRef.current = setInterval(() => {
      if (connectionRef.current) {
        connectionRef.current.send({ type: 'ping' })
      }
    }, 30000)
  }, [projectId, dispatch, cleanup])

  useEffect(() => {
    if (projectId) {
      connect()
    }

    return cleanup
  }, [projectId, connect, cleanup])

  const sendEdgeUpdate = useCallback((edgeId: string, strength: number) => {
    if (connectionRef.current) {
      connectionRef.current.send({
        type: 'edge_update',
        edge_id: edgeId,
        strength,
      })
    }
  }, [])

  const close = useCallback(() => {
    cleanup()
  }, [cleanup])

  return { connected, sendEdgeUpdate, close }
}
