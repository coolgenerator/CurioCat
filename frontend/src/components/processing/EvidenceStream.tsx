import { AnimatePresence, motion } from 'framer-motion'
import { ExternalLink } from 'lucide-react'
import { Progress } from '../ui/index.ts'
import { useT } from '../../i18n/index.tsx'
import type { StreamedEdge, StreamedEvidence } from '../../types/api.ts'

interface EvidenceStreamProps {
  edges: StreamedEdge[]
}

function flattenEvidences(edges: StreamedEdge[]): (StreamedEvidence & { edgeKey: string })[] {
  const result: (StreamedEvidence & { edgeKey: string })[] = []
  for (const edge of edges) {
    if (!edge.evidences) continue
    const edgeKey = `${edge.source_text}→${edge.target_text}`
    for (const ev of edge.evidences) {
      result.push({ ...ev, edgeKey })
    }
  }
  return result
}

export default function EvidenceStream({ edges }: EvidenceStreamProps) {
  const { t } = useT()
  const evidences = flattenEvidences(edges)

  return (
    <div>
      <h3 className="text-sm font-medium text-text-secondary mb-3">
        {t.processing.tabs.evidence}
        {evidences.length > 0 && (
          <span className="ml-2 text-xs text-text-muted">({evidences.length})</span>
        )}
      </h3>

      {evidences.length === 0 && (
        <div className="text-center py-8">
          <p className="text-sm text-text-muted">
            {t.processing.evidenceStream.empty}
          </p>
        </div>
      )}

      <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
        <AnimatePresence mode="popLayout">
          {evidences.map((ev, i) => (
            <motion.div
              key={`${ev.source_url}-${i}`}
              initial={{ opacity: 0, y: 20, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.3, ease: 'easeOut' }}
              className="bg-surface-800 border border-surface-700 rounded-lg p-3"
            >
              {/* Title + link */}
              <div className="flex items-start justify-between gap-2 mb-1.5">
                <p className="text-sm text-text-primary font-medium leading-relaxed line-clamp-1 flex-1">
                  {ev.source_title || ev.source_url}
                </p>
                <div className="flex items-center gap-1.5 shrink-0">
                  {/* Supporting / Contradicting badge */}
                  <span
                    className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium border ${
                      ev.evidence_type === 'supporting'
                        ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                        : 'bg-rose-500/15 text-rose-400 border-rose-500/30'
                    }`}
                  >
                    {ev.evidence_type === 'supporting'
                      ? t.evidence.supporting
                      : t.evidence.contradicting}
                  </span>
                  {ev.source_url && (
                    <a
                      href={ev.source_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-text-muted hover:text-ocean-400 transition-colors"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  )}
                </div>
              </div>

              {/* Snippet */}
              {ev.snippet && (
                <p className="text-xs text-text-secondary mb-2 leading-relaxed line-clamp-3">
                  {ev.snippet}
                </p>
              )}

              {/* Relevance bar */}
              <div className="flex items-center gap-2">
                <span className="text-xs text-text-muted">{t.evidence.relevance}</span>
                <Progress
                  value={ev.relevance_score * 100}
                  size="sm"
                  className="flex-1 max-w-[120px]"
                />
                <span className="text-xs text-text-muted tabular-nums">
                  {Math.round(ev.relevance_score * 100)}%
                </span>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  )
}
