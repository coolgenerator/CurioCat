export interface WebSocketConnection {
  send: (data: unknown) => void
  close: () => void
}

export function connectWebSocket(
  projectId: string,
  onMessage: (data: unknown) => void,
  onError?: (error: Event) => void,
): WebSocketConnection {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const ws = new WebSocket(
    `${protocol}//${window.location.host}/ws/api/v1/ws/graph/${projectId}`
  )

  ws.onopen = () => {
    console.log(`[WS] Connected to graph ${projectId}`)
  }

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data)
      onMessage(data)
    } catch {
      onMessage(event.data)
    }
  }

  ws.onerror = (error) => {
    // Suppress error when WS is closed before connection completes (React StrictMode)
    if (ws.readyState === WebSocket.CLOSING || ws.readyState === WebSocket.CLOSED) return
    console.error('[WS] Error:', error)
    onError?.(error)
  }

  ws.onclose = () => {
    console.log(`[WS] Disconnected from graph ${projectId}`)
  }

  return {
    send: (data: unknown) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(data))
      } else {
        console.warn('[WS] Cannot send, connection not open')
      }
    },
    close: () => {
      ws.close()
    },
  }
}
