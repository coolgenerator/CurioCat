import { Component, type ReactNode, type ErrorInfo } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { useT } from '../../i18n/index.tsx'
import Button from './Button.tsx'

interface ErrorBoundaryProps {
  children: ReactNode
  fallback?: ReactNode
}

interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
}

export default class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('[ErrorBoundary] Caught error:', error, errorInfo)
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null })
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback
      }

      return <ErrorFallback error={this.state.error} onRetry={this.handleRetry} />
    }

    return this.props.children
  }
}

function ErrorFallback({ error, onRetry }: { error: Error | null; onRetry: () => void }) {
  const { t } = useT()

  return (
    <div className="flex items-center justify-center min-h-[300px] p-8">
      <div className="text-center max-w-md">
        <div className="flex justify-center mb-4">
          <div className="p-3 rounded-full bg-confidence-low/15">
            <AlertTriangle className="w-8 h-8 text-confidence-low" />
          </div>
        </div>
        <h2 className="text-lg font-semibold text-text-primary mb-2">
          {t.errors.generic}
        </h2>
        <p className="text-sm text-text-secondary mb-4">
          {t.errors.unexpected}
        </p>
        {error && (
          <p className="text-xs text-text-muted mb-4 bg-surface-800 rounded-lg p-3 text-left font-mono break-all">
            {error.message}
          </p>
        )}
        <Button
          variant="secondary"
          size="sm"
          onClick={onRetry}
        >
          <RefreshCw className="w-4 h-4" />
          {t.errors.tryAgain}
        </Button>
      </div>
    </div>
  )
}
