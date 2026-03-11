import ReactMarkdown from 'react-markdown'

interface MarkdownContentProps {
  children: string
  className?: string
  /** Compact mode uses smaller text sizes for side panels */
  compact?: boolean
}

/**
 * Renders Markdown content with consistent Tailwind styling.
 * Supports headings, bold, lists, blockquotes, and inline code.
 */
export default function MarkdownContent({ children, className = '', compact = false }: MarkdownContentProps) {
  const base = compact ? 'text-[11px]' : 'text-xs'

  return (
    <div className={className}>
      <ReactMarkdown
        components={{
          h1: ({ children: c }) => (
            <h1 className={`${compact ? 'text-sm' : 'text-base'} font-bold text-text-primary mt-4 mb-2 first:mt-0`}>{c}</h1>
          ),
          h2: ({ children: c }) => (
            <h2 className={`${compact ? 'text-xs' : 'text-sm'} font-bold text-text-primary mt-3 mb-1.5 first:mt-0`}>{c}</h2>
          ),
          h3: ({ children: c }) => (
            <h3 className={`${base} font-semibold text-text-primary mt-2.5 mb-1 first:mt-0`}>{c}</h3>
          ),
          h4: ({ children: c }) => (
            <h4 className={`${base} font-semibold text-text-secondary mt-2 mb-1 first:mt-0`}>{c}</h4>
          ),
          p: ({ children: c }) => (
            <p className={`${base} text-text-secondary leading-relaxed mb-2 last:mb-0`}>{c}</p>
          ),
          strong: ({ children: c }) => (
            <strong className="font-semibold text-text-primary">{c}</strong>
          ),
          em: ({ children: c }) => (
            <em className="italic text-text-secondary">{c}</em>
          ),
          ul: ({ children: c }) => (
            <ul className="space-y-1 mb-2 last:mb-0">{c}</ul>
          ),
          ol: ({ children: c }) => (
            <ol className="space-y-1 mb-2 last:mb-0 list-decimal list-inside">{c}</ol>
          ),
          li: ({ children: c }) => (
            <li className={`${base} text-text-secondary leading-relaxed pl-3 relative before:content-['•'] before:absolute before:left-0 before:text-ocean-400`}>{c}</li>
          ),
          blockquote: ({ children: c }) => (
            <blockquote className="border-l-2 border-ocean-500/40 pl-3 my-2 italic text-text-muted">{c}</blockquote>
          ),
          code: ({ children: c }) => (
            <code className="font-mono bg-surface-700/60 rounded px-1 py-0.5 text-ocean-300">{c}</code>
          ),
          pre: ({ children: c }) => (
            <pre className={`${base} font-mono bg-surface-700/60 rounded-md p-2 my-2 text-text-secondary overflow-x-auto whitespace-pre`}>{c}</pre>
          ),
          hr: () => (
            <hr className="border-surface-600 my-3" />
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  )
}
