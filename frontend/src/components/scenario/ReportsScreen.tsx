import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { FileText, ChevronDown, ChevronUp, Activity, Lightbulb, Loader2, GitBranch, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { apiGet, apiPost } from '../../lib/api/client.ts'
import { useT } from '../../i18n/index.tsx'
import MarkdownContent from '../ui/MarkdownContent.tsx'

interface ReportItem {
  id: string
  project_id: string
  project_title: string
  name: string
  description: string | null
  narrative: string | null
  key_insights: string[]
  conclusion: string | null
  edge_change_reasons: Array<{
    edge_id: string
    reason: string
    old_strength: number
    new_strength: number
  }>
  created_at: string | null
}

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

export default function ReportsScreen() {
  const [reports, setReports] = useState<ReportItem[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [regeneratingId, setRegeneratingId] = useState<string | null>(null)
  const navigate = useNavigate()
  const { t } = useT()

  useEffect(() => {
    let cancelled = false
    async function fetchReports() {
      try {
        const result = await apiGet<{ reports: ReportItem[] }>('/api/v1/reports')
        if (!cancelled) setReports(result.reports)
      } catch {
        // Silently fail
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void fetchReports()
    return () => { cancelled = true }
  }, [])

  const handleToggle = useCallback((id: string) => {
    setExpandedId((prev) => (prev === id ? null : id))
  }, [])

  const handleRegenerate = useCallback(async (id: string) => {
    setRegeneratingId(id)
    try {
      const result = await apiPost<ReportItem>(
        `/api/v1/scenario/${id}/regenerate`,
        {},
      )
      setReports((prev) =>
        prev.map((r) =>
          r.id === id
            ? { ...r, narrative: result.narrative, key_insights: result.key_insights, conclusion: result.conclusion, edge_change_reasons: result.edge_change_reasons }
            : r,
        ),
      )
      toast.success(t.scenario.reportGenerated)
    } catch {
      toast.error(t.errors.generic)
    } finally {
      setRegeneratingId(null)
    }
  }, [t])

  return (
    <div className="max-w-3xl mx-auto px-4 py-12 sm:py-16">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-ocean-500/10 border border-ocean-500/20">
          <FileText className="w-5 h-5 text-ocean-400" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-text-primary">{t.reports.title}</h1>
          <p className="text-sm text-text-muted">{t.reports.subtitle}</p>
        </div>
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-6 h-6 text-ocean-400 animate-spin" />
        </div>
      )}

      {/* Empty */}
      {!loading && reports.length === 0 && (
        <div className="text-center py-16">
          <FileText className="w-10 h-10 text-text-muted/30 mx-auto mb-3" />
          <p className="text-sm text-text-muted">{t.reports.empty}</p>
          <p className="text-xs text-text-muted mt-1">{t.reports.emptyHint}</p>
        </div>
      )}

      {/* Report List */}
      {!loading && reports.length > 0 && (
        <div className="space-y-3">
          {reports.map((report) => {
            const isExpanded = expandedId === report.id
            return (
              <div
                key={report.id}
                className="bg-surface-800 border border-surface-700 rounded-xl overflow-hidden"
              >
                {/* Card header — always visible */}
                <button
                  onClick={() => handleToggle(report.id)}
                  className="w-full text-left px-4 py-3 hover:bg-surface-750 transition-colors"
                >
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2 min-w-0">
                      <FileText className="w-3.5 h-3.5 text-ocean-400 shrink-0" />
                      <span className="text-sm font-medium text-text-primary truncate">
                        {report.name}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0 ml-2">
                      {report.created_at && (
                        <span className="text-xs text-text-muted">{timeAgo(report.created_at)}</span>
                      )}
                      {isExpanded
                        ? <ChevronUp className="w-3.5 h-3.5 text-text-muted" />
                        : <ChevronDown className="w-3.5 h-3.5 text-text-muted" />}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        navigate(`/graph/${report.project_id}`)
                      }}
                      className="flex items-center gap-1 text-[10px] text-ocean-400 hover:text-ocean-300 transition-colors"
                    >
                      <GitBranch className="w-3 h-3" />
                      {report.project_title}
                    </button>
                    {report.description && (
                      <span className="text-[10px] text-text-muted truncate">
                        — {report.description}
                      </span>
                    )}
                  </div>
                  {!isExpanded && report.conclusion && (
                    <p className="text-xs text-text-muted mt-1.5 line-clamp-2">
                      {report.conclusion}
                    </p>
                  )}
                </button>

                {/* Expanded content */}
                {isExpanded && (
                  <div className="px-4 pb-4 space-y-3 border-t border-surface-700 pt-3">
                    {/* Conclusion */}
                    {report.conclusion && (
                      <div className="bg-surface-700/40 rounded-lg p-3">
                        <div className="flex items-center gap-1.5 mb-1.5">
                          <Activity className="w-3.5 h-3.5 text-ocean-400" />
                          <span className="text-xs font-semibold text-text-primary">
                            {t.scenario.conclusion}
                          </span>
                        </div>
                        <MarkdownContent>{report.conclusion}</MarkdownContent>
                      </div>
                    )}

                    {/* Key Insights */}
                    {report.key_insights.length > 0 && (
                      <div>
                        <div className="flex items-center gap-1.5 mb-2">
                          <Lightbulb className="w-3.5 h-3.5 text-amber-400" />
                          <span className="text-xs font-semibold text-text-primary">
                            {t.scenario.keyInsights}
                          </span>
                        </div>
                        <ul className="space-y-1.5">
                          {report.key_insights.map((insight, i) => (
                            <li key={i} className="text-xs text-text-secondary leading-relaxed pl-3 relative before:content-['•'] before:absolute before:left-0 before:text-ocean-400">
                              <MarkdownContent>{insight}</MarkdownContent>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Detailed Analysis */}
                    {report.narrative && (
                      <div>
                        <div className="flex items-center gap-1.5 mb-2">
                          <FileText className="w-3.5 h-3.5 text-text-muted" />
                          <span className="text-xs font-semibold text-text-primary">
                            {t.scenario.detailedAnalysis}
                          </span>
                        </div>
                        <MarkdownContent>{report.narrative}</MarkdownContent>
                      </div>
                    )}

                    {/* Edge change reasons */}
                    {report.edge_change_reasons.length > 0 && (
                      <div>
                        <span className="text-[10px] font-semibold text-text-muted block mb-1.5">
                          {t.reports.edgeChanges} ({report.edge_change_reasons.length})
                        </span>
                        <div className="space-y-1">
                          {report.edge_change_reasons.map((ec, i) => (
                            <div key={i} className="flex items-start gap-2 text-[10px]">
                              <span className="font-mono text-text-muted shrink-0">
                                {ec.old_strength.toFixed(2)} → {ec.new_strength.toFixed(2)}
                              </span>
                              <span className="text-text-secondary">{ec.reason}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Regenerate */}
                    <button
                      onClick={() => handleRegenerate(report.id)}
                      disabled={regeneratingId === report.id}
                      className="flex items-center gap-1.5 text-[10px] text-text-muted hover:text-ocean-400 transition-colors pt-1"
                    >
                      <RefreshCw className={`w-3 h-3 ${regeneratingId === report.id ? 'animate-spin' : ''}`} />
                      {t.scenario.regenerateReport}
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
