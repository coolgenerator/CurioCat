import { useState, useEffect, useRef } from 'react'
import { useT } from '../../i18n/index.tsx'
import type { ExtractedClaim, StreamedEdge } from '../../types/api.ts'
import ClaimStream from './ClaimStream.tsx'
import EdgeStream from './EdgeStream.tsx'
import EvidenceStream from './EvidenceStream.tsx'

interface PipelineStreamProps {
  claims: ExtractedClaim[]
  edges: StreamedEdge[]
}

type TabKey = 'claims' | 'edges' | 'evidence'

export default function PipelineStream({ claims, edges }: PipelineStreamProps) {
  const { t } = useT()
  const [activeTab, setActiveTab] = useState<TabKey>('claims')
  const userSwitchedRef = useRef(false)
  const prevEdgeLenRef = useRef(0)
  const prevEvidenceLenRef = useRef(0)

  const evidenceCount = edges.reduce(
    (sum, e) => sum + (e.evidences?.length ?? 0),
    0,
  )

  // Auto-switch to most recently updated tab
  useEffect(() => {
    if (userSwitchedRef.current) return

    if (edges.length > 0 && prevEdgeLenRef.current === 0) {
      setActiveTab('edges')
    }
    prevEdgeLenRef.current = edges.length
  }, [edges.length])

  useEffect(() => {
    if (userSwitchedRef.current) return

    if (evidenceCount > 0 && prevEvidenceLenRef.current === 0) {
      setActiveTab('evidence')
    }
    prevEvidenceLenRef.current = evidenceCount
  }, [evidenceCount])

  function handleTabClick(key: TabKey) {
    userSwitchedRef.current = true
    setActiveTab(key)
  }

  const tabs: { key: TabKey; label: string; count: number }[] = [
    { key: 'claims', label: t.processing.tabs.claims, count: claims.length },
    { key: 'edges', label: t.processing.tabs.causalLinks, count: edges.length },
    { key: 'evidence', label: t.processing.tabs.evidence, count: evidenceCount },
  ]

  return (
    <div>
      {/* Tab bar */}
      <div className="flex border-b border-surface-700 mb-3">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => handleTabClick(tab.key)}
            className={`
              relative px-3 py-2 text-sm font-medium transition-colors
              ${
                activeTab === tab.key
                  ? 'text-ocean-400'
                  : 'text-text-muted hover:text-text-secondary'
              }
            `}
          >
            {tab.label}
            {tab.count > 0 && (
              <span
                className={`ml-1.5 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-medium ${
                  activeTab === tab.key
                    ? 'bg-ocean-500/20 text-ocean-400'
                    : 'bg-surface-600 text-text-muted'
                }`}
              >
                {tab.count}
              </span>
            )}
            {/* Active indicator */}
            {activeTab === tab.key && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-ocean-400 rounded-t" />
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'claims' && <ClaimStream claims={claims} />}
      {activeTab === 'edges' && <EdgeStream edges={edges} />}
      {activeTab === 'evidence' && <EvidenceStream edges={edges} />}
    </div>
  )
}
