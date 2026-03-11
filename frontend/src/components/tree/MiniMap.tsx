import { useRef, useEffect, useCallback, useImperativeHandle, forwardRef } from 'react'
import type { ForceLayoutResult } from '../../hooks/useForceLayout.ts'

export interface MiniMapHandle {
  redraw: () => void
}

interface MiniMapProps {
  layout: ForceLayoutResult | null
  onNavigate?: (graphX: number, graphY: number) => void
}

const MINIMAP_WIDTH = 160
const MINIMAP_HEIGHT = 120
const PADDING = 10
const MARGIN = 50

/** Stored coordinate mapping so click events can reverse canvas→graph coords. */
interface CoordMapping {
  minX: number
  minY: number
  scale: number
  offsetX: number
  offsetY: number
}

function computeMapping(layout: ForceLayoutResult): CoordMapping {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (const node of layout.nodes) {
    if (node.x < minX) minX = node.x
    if (node.x > maxX) maxX = node.x
    if (node.y < minY) minY = node.y
    if (node.y > maxY) maxY = node.y
  }
  minX -= MARGIN; maxX += MARGIN; minY -= MARGIN; maxY += MARGIN
  const rangeX = maxX - minX || 1
  const rangeY = maxY - minY || 1
  const drawW = MINIMAP_WIDTH - PADDING * 2
  const drawH = MINIMAP_HEIGHT - PADDING * 2
  const scale = Math.min(drawW / rangeX, drawH / rangeY)
  const offsetX = PADDING + (drawW - rangeX * scale) / 2
  const offsetY = PADDING + (drawH - rangeY * scale) / 2
  return { minX, minY, scale, offsetX, offsetY }
}

function getMinimapTheme() {
  const s = getComputedStyle(document.documentElement)
  return {
    bg: s.getPropertyValue('--graph-minimap-bg').trim() || 'rgba(17, 24, 39, 0.85)',
    edge: s.getPropertyValue('--graph-minimap-edge').trim() || 'rgba(71, 85, 105, 0.4)',
    node: s.getPropertyValue('--graph-minimap-node').trim() || '#64748b',
  }
}

function drawMiniMap(
  canvas: HTMLCanvasElement,
  layout: ForceLayoutResult,
  mapping: CoordMapping,
) {
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  const dpr = window.devicePixelRatio || 1
  canvas.width = MINIMAP_WIDTH * dpr
  canvas.height = MINIMAP_HEIGHT * dpr
  ctx.scale(dpr, dpr)

  const { minX, minY, scale, offsetX, offsetY } = mapping
  const toX = (x: number) => offsetX + (x - minX) * scale
  const toY = (y: number) => offsetY + (y - minY) * scale

  const mt = getMinimapTheme()

  // Background
  ctx.fillStyle = mt.bg
  ctx.fillRect(0, 0, MINIMAP_WIDTH, MINIMAP_HEIGHT)

  // Edges
  ctx.strokeStyle = mt.edge
  ctx.lineWidth = 0.5
  for (const link of layout.links) {
    ctx.beginPath()
    ctx.moveTo(toX(link.source.x), toY(link.source.y))
    ctx.lineTo(toX(link.target.x), toY(link.target.y))
    ctx.stroke()
  }

  // Nodes
  for (const node of layout.nodes) {
    ctx.beginPath()
    const r = node.isConvergencePoint ? 3.5 : node.data.isCriticalPath ? 3 : 2
    ctx.arc(toX(node.x), toY(node.y), r, 0, Math.PI * 2)
    ctx.fillStyle = node.isConvergencePoint ? '#7c3aed' : node.data.isCriticalPath ? '#0098cc' : mt.node
    ctx.fill()
  }
}

const MiniMap = forwardRef<MiniMapHandle, MiniMapProps>(function MiniMap({ layout, onNavigate }, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rafRef = useRef<number | null>(null)
  const layoutRef = useRef(layout)
  const mappingRef = useRef<CoordMapping | null>(null)
  layoutRef.current = layout

  const redraw = useCallback(() => {
    // Throttle to one rAF
    if (rafRef.current) return
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null
      const canvas = canvasRef.current
      const l = layoutRef.current
      if (!canvas || !l || l.nodes.length === 0) return
      const mapping = computeMapping(l)
      mappingRef.current = mapping
      drawMiniMap(canvas, l, mapping)
    })
  }, [])

  useImperativeHandle(ref, () => ({ redraw }), [redraw])

  // Initial draw + redraw when layout topology changes
  useEffect(() => {
    if (!canvasRef.current || !layout || layout.nodes.length === 0) return
    const mapping = computeMapping(layout)
    mappingRef.current = mapping
    drawMiniMap(canvasRef.current, layout, mapping)
  }, [layout])

  // Cleanup rAF
  useEffect(() => {
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }
  }, [])

  // Click handler: convert canvas coords → graph coords → navigate
  const handleClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!onNavigate || !mappingRef.current) return
    const canvas = e.currentTarget
    const rect = canvas.getBoundingClientRect()
    const canvasX = e.clientX - rect.left
    const canvasY = e.clientY - rect.top

    const { minX, minY, scale, offsetX, offsetY } = mappingRef.current
    const graphX = (canvasX - offsetX) / scale + minX
    const graphY = (canvasY - offsetY) / scale + minY

    onNavigate(graphX, graphY)
  }, [onNavigate])

  if (!layout || layout.nodes.length === 0) return null

  return (
    <div className="absolute bottom-14 left-4 rounded-lg border border-surface-600 overflow-hidden shadow-xl">
      <canvas
        ref={canvasRef}
        width={MINIMAP_WIDTH}
        height={MINIMAP_HEIGHT}
        style={{ width: MINIMAP_WIDTH, height: MINIMAP_HEIGHT }}
        className="cursor-crosshair"
        aria-label="Minimap"
        onClick={handleClick}
      />
    </div>
  )
})

export default MiniMap
