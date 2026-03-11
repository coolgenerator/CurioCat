interface LoadingSpinnerProps {
  size?: 'sm' | 'md' | 'lg'
  label?: string
  className?: string
}

const sizeClasses = {
  sm: 'w-5 h-5 border-2',
  md: 'w-8 h-8 border-2',
  lg: 'w-12 h-12 border-3',
}

export default function LoadingSpinner({
  size = 'md',
  label,
  className = '',
}: LoadingSpinnerProps) {
  return (
    <div className={`flex flex-col items-center gap-3 ${className}`}>
      <div
        className={`
          ${sizeClasses[size]}
          rounded-full animate-spin
          border-ocean-400 border-t-transparent
          bg-gradient-to-r from-ocean-400/10 to-transparent
        `}
        role="status"
        aria-label={label ?? 'Loading'}
      />
      {label && (
        <p className="text-sm text-text-secondary">{label}</p>
      )}
    </div>
  )
}
