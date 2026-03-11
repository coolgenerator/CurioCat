import { AnimatePresence, motion } from 'framer-motion'
import { ArrowRight, AlertTriangle } from 'lucide-react'
import { Progress } from '../ui/index.ts'
import { useT } from '../../i18n/index.tsx'
import type { StreamedEdge } from '../../types/api.ts'

interface EdgeStreamProps {
  edges: StreamedEdge[]
}

const causalTypeColors: Record<string, string> = {
  direct: 'bg-ocean-500/15 text-ocean-400 border-ocean-500/30',
  indirect: 'bg-deep-400/15 text-deep-300 border-deep-400/30',
  probabilistic: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  enabling: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  inhibiting: 'bg-rose-500/15 text-rose-400 border-rose-500/30',
  triggering: 'bg-violet-500/15 text-violet-400 border-violet-500/30',
}

export default function EdgeStream({ edges }: EdgeStreamProps) {
  const { t } = useT()

  return (
    <div>
      <h3 className="text-sm font-medium text-text-secondary mb-3">
        {t.processing.tabs.causalLinks}
        {edges.length > 0 && (
          <span className="ml-2 text-xs text-text-muted">({edges.length})</span>
        )}
      </h3>

      {edges.length === 0 && (
        <div className="text-center py-8">
          <p className="text-sm text-text-muted">
            {t.processing.edgeStream.empty}
          </p>
        </div>
      )}

      <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
        <AnimatePresence mode="popLayout">
          {edges.map((edge, i) => (
            <motion.div
              key={`${edge.source_text}-${edge.target_text}-${i}`}
              initial={{ opacity: 0, y: 20, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.3, ease: 'easeOut' }}
              className="bg-surface-800 border border-surface-700 rounded-lg p-3"
            >
              {/* Source → Target */}
              <div className="flex items-center gap-2 mb-2">
                <p className="text-sm text-text-primary flex-1 leading-relaxed line-clamp-2">
                  {edge.source_text}
                </p>
                <ArrowRight className="w-4 h-4 text-text-muted shrink-0" />
                <p className="text-sm text-text-primary flex-1 leading-relaxed line-clamp-2">
                  {edge.target_text}
                </p>
              </div>

              {/* Mechanism */}
              {edge.mechanism && (
                <p className="text-xs text-text-muted mb-2 italic line-clamp-2">
                  {edge.mechanism}
                </p>
              )}

              {/* Metadata row */}
              <div className="flex items-center gap-2 flex-wrap">
                {/* Causal type badge */}
                <span
                  className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium border ${
                    causalTypeColors[edge.causal_type] ?? causalTypeColors.direct
                  }`}
                >
                  {edge.causal_type}
                </span>

                {/* Strength bar */}
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-text-muted">{t.evidence.strength}</span>
                  <Progress
                    value={edge.strength * 100}
                    size="sm"
                    className="w-16"
                  />
                  <span className="text-xs text-text-muted tabular-nums">
                    {Math.round(edge.strength * 100)}%
                  </span>
                </div>

                {/* Evidence score (if grounded) */}
                {edge.evidence_score != null && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-text-muted">{t.evidence.evidenceScore}</span>
                    <Progress
                      value={edge.evidence_score * 100}
                      size="sm"
                      className="w-16"
                    />
                    <span className="text-xs text-text-muted tabular-nums">
                      {Math.round(edge.evidence_score * 100)}%
                    </span>
                  </div>
                )}

                {/* Bias warnings */}
                {edge.bias_warnings && edge.bias_warnings.length > 0 && (
                  <div className="flex items-center gap-1">
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                    <span className="text-xs text-amber-400">
                      {edge.bias_warnings.length} {t.causalTypes.biasWarnings.toLowerCase()}
                    </span>
                  </div>
                )}
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  )
}
