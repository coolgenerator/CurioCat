import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useResizablePanel } from '../../hooks/useResizablePanel.ts'
import { useT } from '../../i18n/index.tsx'

interface ResizablePanelProps {
  side: 'left' | 'right'
  defaultWidth: number
  minWidth: number
  maxWidth: number
  storageKey?: string
  children: React.ReactNode
}

export default function ResizablePanel({
  side,
  defaultWidth,
  minWidth,
  maxWidth,
  storageKey,
  children,
}: ResizablePanelProps) {
  const { t } = useT()
  const { collapsed, isDragging, toggle, dragHandleProps, panelStyle } = useResizablePanel({
    side,
    defaultWidth,
    minWidth,
    maxWidth,
    storageKey,
  })

  const CollapseIcon = side === 'left'
    ? (collapsed ? ChevronRight : ChevronLeft)
    : (collapsed ? ChevronLeft : ChevronRight)

  return (
    <div className="relative shrink-0 h-full" style={panelStyle}>
      {/* Panel content */}
      {!collapsed && (
        <div className="w-full h-full overflow-y-auto overflow-x-hidden">
          {children}
        </div>
      )}

      {/* Drag handle */}
      {!collapsed && (
        <div
          {...dragHandleProps}
          className={`drag-handle ${isDragging ? 'drag-handle--active' : ''}`}
        />
      )}

      {/* Collapse/expand chevron button */}
      <button
        onClick={toggle}
        className={`absolute top-1/2 -translate-y-1/2 z-20 flex items-center justify-center w-5 h-8 rounded-md bg-surface-700 border border-surface-600 text-text-muted hover:text-text-primary hover:bg-surface-600 transition-colors ${
          collapsed
            ? 'left-1/2 -translate-x-1/2'
            : side === 'left' ? '-right-2.5' : '-left-2.5'
        }`}
        title={collapsed ? t.panels?.expand ?? 'Expand panel' : t.panels?.collapse ?? 'Collapse panel'}
      >
        <CollapseIcon className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}
