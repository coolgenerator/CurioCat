import type { InputHTMLAttributes } from 'react'

interface SliderProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'onChange'> {
  label?: string
  value: number
  min?: number
  max?: number
  step?: number
  onChange: (value: number) => void
  showValue?: boolean
}

export default function Slider({
  label,
  value,
  min = 0,
  max = 1,
  step = 0.01,
  onChange,
  showValue = true,
  className = '',
  ...props
}: SliderProps) {
  const percentage = ((value - (min ?? 0)) / ((max ?? 1) - (min ?? 0))) * 100

  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      {(label || showValue) && (
        <div className="flex items-center justify-between">
          {label && (
            <label className="text-xs font-medium text-text-secondary">
              {label}
            </label>
          )}
          {showValue && (
            <span className="text-xs text-text-muted tabular-nums">
              {value.toFixed(2)}
            </span>
          )}
        </div>
      )}
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full h-1.5 rounded-full appearance-none cursor-pointer
          bg-surface-700
          [&::-webkit-slider-thumb]:appearance-none
          [&::-webkit-slider-thumb]:w-4
          [&::-webkit-slider-thumb]:h-4
          [&::-webkit-slider-thumb]:rounded-full
          [&::-webkit-slider-thumb]:bg-ocean-400
          [&::-webkit-slider-thumb]:hover:bg-ocean-300
          [&::-webkit-slider-thumb]:transition-colors
          [&::-webkit-slider-thumb]:shadow-md
          [&::-moz-range-thumb]:w-4
          [&::-moz-range-thumb]:h-4
          [&::-moz-range-thumb]:rounded-full
          [&::-moz-range-thumb]:bg-ocean-400
          [&::-moz-range-thumb]:border-0
          [&::-moz-range-thumb]:hover:bg-ocean-300
          [&::-moz-range-thumb]:transition-colors"
        style={{
          background: `linear-gradient(to right, var(--color-ocean-500) 0%, var(--color-ocean-500) ${percentage}%, var(--color-surface-700) ${percentage}%, var(--color-surface-700) 100%)`,
        }}
        {...props}
      />
    </div>
  )
}
