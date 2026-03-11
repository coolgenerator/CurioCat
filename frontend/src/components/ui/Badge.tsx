import type { ClaimType } from '../../types/graph.ts'

interface BadgeProps {
  type: ClaimType
  className?: string
}

const typeStyles: Record<ClaimType, string> = {
  FACT: 'bg-ocean-500/15 text-ocean-400 border-ocean-500/30',
  ASSUMPTION: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  PREDICTION: 'bg-deep-400/15 text-deep-300 border-deep-400/30',
  OPINION: 'bg-surface-600/40 text-text-muted border-surface-500/30',
}

export default function Badge({ type, className = '' }: BadgeProps) {
  return (
    <span
      className={`
        inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium
        border
        ${typeStyles[type]}
        ${className}
      `}
    >
      {type}
    </span>
  )
}
