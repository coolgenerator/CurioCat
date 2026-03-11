import { useRef, useEffect, type TextareaHTMLAttributes } from 'react'

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  autoResize?: boolean
}

export default function Textarea({
  autoResize = true,
  className = '',
  value,
  onChange,
  ...props
}: TextareaProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (autoResize && textareaRef.current) {
      const el = textareaRef.current
      el.style.height = 'auto'
      el.style.height = `${el.scrollHeight}px`
    }
  }, [value, autoResize])

  return (
    <textarea
      ref={textareaRef}
      value={value}
      onChange={onChange}
      className={`
        w-full bg-surface-800 text-text-primary
        border border-surface-700 rounded-xl
        px-4 py-3 text-sm
        placeholder:text-text-muted
        focus:outline-none focus:border-ocean-500/50 focus:ring-1 focus:ring-ocean-500/25
        resize-none transition-colors
        ${className}
      `}
      {...props}
    />
  )
}
