import { AnimatePresence, motion } from 'framer-motion'
import { Badge, Progress } from '../ui/index.ts'
import { useT } from '../../i18n/index.tsx'
import type { ExtractedClaim } from '../../types/api.ts'

interface ClaimStreamProps {
  claims: ExtractedClaim[]
}

export default function ClaimStream({ claims }: ClaimStreamProps) {
  const { t } = useT()

  return (
    <div>
      <h3 className="text-sm font-medium text-text-secondary mb-3">
        {t.processing.claimStream.title}
        {claims.length > 0 && (
          <span className="ml-2 text-xs text-text-muted">({claims.length})</span>
        )}
      </h3>

      {claims.length === 0 && (
        <div className="text-center py-8">
          <p className="text-sm text-text-muted">
            {t.processing.claimStream.empty}
          </p>
        </div>
      )}

      <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
        <AnimatePresence mode="popLayout">
          {claims.map((claim) => (
            <motion.div
              key={claim.id}
              initial={{ opacity: 0, y: 20, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.3, ease: 'easeOut' }}
              className="bg-surface-800 border border-surface-700 rounded-lg p-3"
            >
              <div className="flex items-start justify-between gap-2 mb-2">
                <p className="text-sm text-text-primary flex-1 leading-relaxed">
                  {claim.text}
                </p>
                <div className="flex items-center gap-1 shrink-0">
                  {claim.layer != null && claim.layer > 0 && (
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-ocean-500/15 text-ocean-400 border border-ocean-500/25">
                      {t.processing.claimStream.discoveredLayer} {claim.layer}
                    </span>
                  )}
                  <Badge type={claim.claimType} className="shrink-0" />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-text-muted">{t.processing.claimStream.confidence}</span>
                <Progress
                  value={claim.confidence * 100}
                  size="sm"
                  className="flex-1 max-w-[120px]"
                />
                <span className="text-xs text-text-muted tabular-nums">
                  {Math.round(claim.confidence * 100)}%
                </span>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  )
}
