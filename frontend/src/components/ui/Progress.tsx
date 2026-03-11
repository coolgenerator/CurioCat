interface ProgressProps {
  value: number
  max?: number
  className?: string
  size?: 'sm' | 'md'
  animated?: boolean
}

export default function Progress({
  value,
  max = 100,
  className = '',
  size = 'md',
  animated = true,
}: ProgressProps) {
  const percentage = Math.min(100, Math.max(0, (value / max) * 100))
  const heightClass = size === 'sm' ? 'h-1' : 'h-2'

  return (
    <div
      className={`w-full ${heightClass} bg-surface-700 rounded-full overflow-hidden ${className}`}
      role="progressbar"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={max}
    >
      <div
        className={`h-full rounded-full bg-gradient-to-r from-ocean-600 to-ocean-400 ${
          animated ? 'transition-all duration-500 ease-out' : ''
        }`}
        style={{ width: `${percentage}%` }}
      />
    </div>
  )
}
