import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { AlertCircle, ArrowRight, Cat, Loader2 } from 'lucide-react'
import { apiGet } from '../../lib/api/client.ts'
import { useSSEStream } from '../../hooks/useSSEStream.ts'
import { useAnalysis } from '../../context/AnalysisContext.tsx'
import { useT } from '../../i18n/index.tsx'
import type { ProjectStatus } from '../../types/api.ts'
import StageTimeline from './StageTimeline.tsx'
import PipelineStream from './PipelineStream.tsx'
import { Button } from '../ui/index.ts'

export default function ProcessingScreen() {
  const { projectId } = useParams<{ projectId: string }>()
  const navigate = useNavigate()
  const { state, dispatch } = useAnalysis()
  const [statusChecked, setStatusChecked] = useState(false)
  const { t } = useT()

  // Sync projectId from URL to context
  useEffect(() => {
    if (projectId && state.projectId !== projectId) {
      dispatch({ type: 'SET_PROJECT_ID', projectId })
    }
  }, [projectId, state.projectId, dispatch])

  // Check project status on mount — redirect to graph if already completed
  useEffect(() => {
    if (!projectId) return

    let cancelled = false

    async function checkStatus() {
      try {
        const status = await apiGet<ProjectStatus>(`/api/v1/status/${projectId}`)
        if (cancelled) return
        if (status.status === 'completed') {
          navigate(`/graph/${projectId}`, { replace: true })
          return
        }
        // Stale interrupted analysis with data in DB — go straight to graph
        if (status.status === 'processing' && (status.claim_count ?? 0) > 0) {
          navigate(`/graph/${projectId}`, { replace: true })
          return
        }
      } catch {
        // Status check failed — proceed with SSE stream
      }
      if (!cancelled) setStatusChecked(true)
    }

    void checkStatus()
    return () => { cancelled = true }
  }, [projectId, navigate])

  // Only connect SSE after status check confirms project is still processing
  const { stages, claims, edges, isComplete, error } = useSSEStream(
    statusChecked ? (projectId ?? null) : null
  )

  // Sync SSE stages with analysis context
  useEffect(() => {
    for (const stage of stages) {
      dispatch({ type: 'UPDATE_STAGE', stage })
    }
  }, [stages, dispatch])

  // Handle completion
  useEffect(() => {
    if (isComplete && projectId) {
      dispatch({ type: 'UPDATE_STAGE', stage: {
        stage: 'complete',
        status: 'completed',
        progress: 100,
        data: null,
        timestamp: new Date().toISOString(),
      }})
    }
  }, [isComplete, projectId, dispatch])

  function handleViewGraph() {
    if (projectId) {
      navigate(`/graph/${projectId}`)
    }
  }

  if (!projectId) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <p className="text-text-muted">{t.processing.noProject}</p>
      </div>
    )
  }

  if (!statusChecked) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-6 h-6 text-ocean-400 animate-spin" />
      </div>
    )
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="text-center mb-8">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-ocean-500/10 border border-ocean-500/20 mb-3">
          <Cat className="w-6 h-6 text-ocean-400 animate-pulse" />
        </div>
        <h1 className="text-2xl font-bold text-text-primary mb-1">
          {t.processing.analyzing}
        </h1>
        <p className="text-sm text-text-secondary">
          {isComplete
            ? t.processing.complete
            : t.processing.inProgress}
        </p>
      </div>

      {/* Error state */}
      {error && (
        <div className="mb-6 p-4 bg-confidence-low/10 border border-confidence-low/20 rounded-xl flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-confidence-low shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-confidence-low">{t.processing.error}</p>
            <p className="text-sm text-text-secondary mt-0.5">{error}</p>
          </div>
        </div>
      )}

      {/* Main content grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Stage Timeline */}
        <div className="lg:col-span-1">
          <div className="bg-surface-800 border border-surface-700 rounded-xl p-4 sticky top-20">
            <StageTimeline stages={stages} />
          </div>
        </div>

        {/* Right: Pipeline Stream (tabbed) */}
        <div className="lg:col-span-2">
          <div className="bg-surface-800 border border-surface-700 rounded-xl p-4">
            <PipelineStream claims={claims} edges={edges} />
          </div>
        </div>
      </div>

      {/* Completion CTA */}
      {isComplete && (
        <div className="mt-8 text-center">
          <Button onClick={handleViewGraph} size="lg">
            {t.processing.viewGraph}
            <ArrowRight className="w-4 h-4" />
          </Button>
        </div>
      )}
    </div>
  )
}
