import { useState, type ReactNode } from 'react'

interface TooltipProps {
  content: string
  children: ReactNode
  position?: 'top' | 'bottom' | 'left' | 'right'
  maxWidth?: number
}

const positionClasses = {
  top: 'bottom-full left-1/2 -translate-x-1/2 mb-2',
  bottom: 'top-full left-1/2 -translate-x-1/2 mt-2',
  left: 'right-full top-1/2 -translate-y-1/2 mr-2',
  right: 'left-full top-1/2 -translate-y-1/2 ml-2',
}

export default function Tooltip({
  content,
  children,
  position = 'top',
  maxWidth,
}: TooltipProps) {
  const [visible, setVisible] = useState(false)

  return (
    <div
      className="relative inline-flex"
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
    >
      {children}
      {visible && (
        <div
          className={`
            absolute z-50 px-2.5 py-1.5 text-xs font-medium
            text-text-primary bg-surface-700 border border-surface-600
            rounded-lg shadow-lg pointer-events-none
            ${maxWidth ? 'whitespace-normal' : 'whitespace-nowrap'}
            ${positionClasses[position]}
          `}
          style={maxWidth ? { maxWidth } : undefined}
          role="tooltip"
        >
          {content}
        </div>
      )}
    </div>
  )
}
