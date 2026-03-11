import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { GitBranch, CheckCircle2, Loader2, AlertCircle, Search, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import { apiGet, apiDelete } from '../../lib/api/client.ts'
import { useT } from '../../i18n/index.tsx'
import type { ProjectSummary } from '../../types/api.ts'

function timeAgo(dateStr: string): string {
  const now = Date.now()
  const then = new Date(dateStr).getTime()
  const seconds = Math.floor((now - then) / 1000)
  if (seconds < 60) return '<1m'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  return `${days}d`
}

export default function GraphListScreen() {
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('')
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const navigate = useNavigate()
  const { t } = useT()

  useEffect(() => {
    let cancelled = false
    async function fetchProjects() {
      try {
        const result = await apiGet<{ projects: ProjectSummary[] }>('/api/v1/projects')
        if (!cancelled) setProjects(result.projects)
      } catch {
        // Silently fail
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void fetchProjects()
    return () => { cancelled = true }
  }, [])

  const handleDelete = useCallback(async (projectId: string) => {
    setDeleting(true)
    try {
      await apiDelete(`/api/v1/projects/${projectId}`)
      setProjects(prev => prev.filter(p => p.id !== projectId))
      toast.success(t.graphList.deleted)
    } catch {
      toast.error(t.graphList.deleteFailed)
    } finally {
      setDeleting(false)
      setConfirmId(null)
    }
  }, [t])

  const filtered = filter.trim()
    ? projects.filter(p => p.title.toLowerCase().includes(filter.toLowerCase()))
    : projects

  return (
    <div className="max-w-3xl mx-auto px-4 py-12 sm:py-16">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-ocean-500/10 border border-ocean-500/20">
          <GitBranch className="w-5 h-5 text-ocean-400" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-text-primary">{t.graphList.title}</h1>
          <p className="text-sm text-text-muted">{t.graphList.subtitle}</p>
        </div>
      </div>

      {/* Search */}
      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={t.graphList.search}
          className="
            w-full bg-surface-800 text-text-primary
            border border-surface-700 rounded-xl
            pl-9 pr-4 py-2.5 text-sm
            placeholder:text-text-muted
            focus:outline-none focus:border-ocean-500/50 focus:ring-1 focus:ring-ocean-500/25
            transition-colors
          "
        />
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-6 h-6 text-ocean-400 animate-spin" />
        </div>
      )}

      {/* Empty */}
      {!loading && projects.length === 0 && (
        <div className="text-center py-16">
          <GitBranch className="w-10 h-10 text-text-muted/30 mx-auto mb-3" />
          <p className="text-sm text-text-muted">{t.graphList.empty}</p>
        </div>
      )}

      {/* List */}
      {!loading && filtered.length > 0 && (
        <div className="space-y-2">
          {filtered.map((project) => {
            const isClickable = project.status === 'completed' || project.status === 'processing'
            const isConfirming = confirmId === project.id
            return (
              <div
                key={project.id}
                className={`relative px-4 py-3 bg-surface-800 border rounded-xl transition-colors ${
                  isConfirming
                    ? 'border-confidence-low/50'
                    : 'border-surface-700'
                }`}
              >
                {/* Confirm delete overlay */}
                {isConfirming && (
                  <div className="absolute inset-0 bg-surface-800/95 rounded-xl flex items-center justify-center gap-3 z-10">
                    <span className="text-sm text-text-secondary">{t.graphList.confirmDelete}</span>
                    <button
                      onClick={() => handleDelete(project.id)}
                      disabled={deleting}
                      className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-confidence-low/15 text-confidence-low border border-confidence-low/30 rounded-lg hover:bg-confidence-low/25 transition-colors"
                    >
                      {deleting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                      {t.graphList.confirmYes}
                    </button>
                    <button
                      onClick={() => setConfirmId(null)}
                      className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-text-secondary border border-surface-600 rounded-lg hover:bg-surface-700 transition-colors"
                    >
                      <X className="w-3 h-3" />
                      {t.graphList.confirmNo}
                    </button>
                  </div>
                )}

                <div className="flex items-center justify-between">
                  <button
                    onClick={() => {
                      if (project.status === 'completed') {
                        navigate(`/graph/${project.id}`)
                      } else if (project.status === 'processing') {
                        navigate(`/analysis/${project.id}`)
                      }
                    }}
                    disabled={!isClickable}
                    className={`flex-1 text-left truncate mr-3 ${
                      isClickable ? 'cursor-pointer group' : 'opacity-60 cursor-not-allowed'
                    }`}
                  >
                    <span className={`text-sm text-text-primary ${isClickable ? 'group-hover:text-ocean-300 transition-colors' : ''}`}>
                      {project.title}
                    </span>
                  </button>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs text-text-muted">{timeAgo(project.created_at)}</span>
                    {project.status === 'completed' && (
                      <span className="flex items-center gap-1 text-xs text-confidence-high">
                        <CheckCircle2 className="w-3 h-3" />
                        {t.history.status.completed}
                      </span>
                    )}
                    {project.status === 'processing' && (
                      <span className="flex items-center gap-1 text-xs text-ocean-400">
                        <Loader2 className="w-3 h-3 animate-spin" />
                        {t.history.status.processing}
                      </span>
                    )}
                    {project.status === 'failed' && (
                      <span className="flex items-center gap-1 text-xs text-confidence-low">
                        <AlertCircle className="w-3 h-3" />
                        {t.history.status.failed}
                      </span>
                    )}
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        setConfirmId(project.id)
                      }}
                      className="p-1 rounded-md text-text-muted/40 hover:text-confidence-low hover:bg-surface-700 transition-colors"
                      aria-label="Delete"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* No results from filter */}
      {!loading && projects.length > 0 && filtered.length === 0 && (
        <div className="text-center py-12">
          <p className="text-sm text-text-muted">{t.graphList.noResults}</p>
        </div>
      )}
    </div>
  )
}
