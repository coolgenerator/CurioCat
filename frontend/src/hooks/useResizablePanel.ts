import { useState, useCallback, useRef, useEffect } from 'react'

interface UseResizablePanelOptions {
  side: 'left' | 'right'
  defaultWidth: number
  minWidth: number
  maxWidth: number
  storageKey?: string
}

interface UseResizablePanelReturn {
  width: number
  collapsed: boolean
  isDragging: boolean
  toggle: () => void
  dragHandleProps: {
    onMouseDown: (e: React.MouseEvent) => void
    style: React.CSSProperties
  }
  panelStyle: React.CSSProperties
}

function loadWidth(key: string | undefined, fallback: number): number {
  if (!key) return fallback
  try {
    const stored = localStorage.getItem(key)
    if (stored !== null) return Number(stored)
  } catch { /* ignore */ }
  return fallback
}

export function useResizablePanel(options: UseResizablePanelOptions): UseResizablePanelReturn {
  const { side, defaultWidth, minWidth, maxWidth, storageKey } = options

  const [width, setWidth] = useState(() => loadWidth(storageKey, defaultWidth))
  const [collapsed, setCollapsed] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const widthBeforeCollapse = useRef(width)
  const startX = useRef(0)
  const startWidth = useRef(0)

  // Persist width to localStorage on drag end
  const persistWidth = useCallback((w: number) => {
    if (storageKey) {
      try { localStorage.setItem(storageKey, String(w)) } catch { /* ignore */ }
    }
  }, [storageKey])

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    startX.current = e.clientX
    startWidth.current = width
    setIsDragging(true)
  }, [width])

  useEffect(() => {
    if (!isDragging) return

    const onMouseMove = (e: MouseEvent) => {
      const delta = e.clientX - startX.current
      // Left panel: dragging handle right = wider; right panel: dragging left = wider
      const directedDelta = side === 'left' ? delta : -delta
      const newWidth = Math.min(maxWidth, Math.max(minWidth, startWidth.current + directedDelta))
      setWidth(newWidth)
    }

    const onMouseUp = (e: MouseEvent) => {
      setIsDragging(false)
      const delta = e.clientX - startX.current
      const directedDelta = side === 'left' ? delta : -delta
      const finalWidth = Math.min(maxWidth, Math.max(minWidth, startWidth.current + directedDelta))
      persistWidth(finalWidth)
    }

    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)

    return () => {
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }
  }, [isDragging, side, minWidth, maxWidth, persistWidth])

  const toggle = useCallback(() => {
    setCollapsed((prev) => {
      if (!prev) {
        // Collapsing — store current width
        widthBeforeCollapse.current = width
        return true
      }
      // Expanding — restore previous width
      setWidth(widthBeforeCollapse.current)
      return false
    })
  }, [width])

  const collapsedWidth = 24
  const panelStyle: React.CSSProperties = collapsed
    ? { width: collapsedWidth, minWidth: collapsedWidth, transition: 'width 0.2s ease' }
    : { width, minWidth: width, transition: isDragging ? 'none' : 'width 0.2s ease' }

  const handleStyle: React.CSSProperties = {
    position: 'absolute' as const,
    top: 0,
    bottom: 0,
    width: 4,
    cursor: 'col-resize',
    zIndex: 10,
    ...(side === 'left' ? { right: -2 } : { left: -2 }),
  }

  return {
    width,
    collapsed,
    isDragging,
    toggle,
    dragHandleProps: { onMouseDown, style: handleStyle },
    panelStyle,
  }
}
