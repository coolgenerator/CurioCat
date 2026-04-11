import { useState, useCallback, useRef } from 'react'
import { X, Upload, FileText, BarChart3, Image, Loader2 } from 'lucide-react'
import { useT } from '../../i18n/index.tsx'

type InputMode = 'text' | 'csv' | 'screenshot'

interface EnrichPanelProps {
  onClose: () => void
  onEnrichText: (text: string, context?: string) => Promise<unknown>
  onEnrichCSV: (file: File, question?: string, dataType?: string) => Promise<unknown>
  onEnrichScreenshot: (file: File, question?: string) => Promise<unknown>
  operationLoading: string | null
}

export default function EnrichPanel({
  onClose,
  onEnrichText,
  onEnrichCSV,
  onEnrichScreenshot,
  operationLoading,
}: EnrichPanelProps) {
  const { t } = useT()
  const [mode, setMode] = useState<InputMode>('text')
  const [text, setText] = useState('')
  const [context, setContext] = useState('')
  const [question, setQuestion] = useState('')
  const [dataType, setDataType] = useState('time_series')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const isLoading = operationLoading === 'enrich'

  const handleSubmitText = useCallback(async () => {
    if (!text.trim() || text.trim().length < 10) return
    await onEnrichText(text.trim(), context.trim() || undefined)
    setText('')
    setContext('')
  }, [text, context, onEnrichText])

  const handleSubmitFile = useCallback(async () => {
    if (!selectedFile) return
    if (mode === 'csv') {
      await onEnrichCSV(selectedFile, question.trim() || undefined, dataType)
    } else {
      await onEnrichScreenshot(selectedFile, question.trim() || undefined)
    }
    setSelectedFile(null)
    setQuestion('')
  }, [selectedFile, mode, question, dataType, onEnrichCSV, onEnrichScreenshot])

  const handleFileDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (file) setSelectedFile(file)
  }, [])

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) setSelectedFile(file)
  }, [])

  const tabs: { key: InputMode; label: string; icon: typeof FileText }[] = [
    { key: 'text', label: t.enrich?.textTab ?? 'Text', icon: FileText },
    { key: 'csv', label: t.enrich?.csvTab ?? 'Data', icon: BarChart3 },
    { key: 'screenshot', label: t.enrich?.screenshotTab ?? 'Screenshot', icon: Image },
  ]

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-surface-700">
        <h3 className="text-sm font-semibold text-text-primary">
          {t.enrich?.title ?? 'Enrich Graph'}
        </h3>
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-surface-700 text-text-muted hover:text-text-primary transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Tab selector */}
      <div className="flex border-b border-surface-700">
        {tabs.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => { setMode(key); setSelectedFile(null) }}
            className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 text-xs font-medium transition-colors ${
              mode === key
                ? 'text-ocean-400 border-b-2 border-ocean-400 bg-ocean-500/5'
                : 'text-text-muted hover:text-text-primary hover:bg-surface-700/50'
            }`}
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {mode === 'text' && (
          <>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={t.enrich?.textPlaceholder ?? 'Add supplementary text...'}
              className="w-full h-32 px-3 py-2 text-sm bg-surface-800 border border-surface-600 rounded-lg text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-ocean-500 resize-none"
              disabled={isLoading}
            />
            <textarea
              value={context}
              onChange={(e) => setContext(e.target.value)}
              placeholder={t.enrich?.contextPlaceholder ?? 'Additional context (optional)...'}
              className="w-full h-16 px-3 py-2 text-sm bg-surface-800 border border-surface-600 rounded-lg text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-ocean-500 resize-none"
              disabled={isLoading}
            />
            <button
              onClick={handleSubmitText}
              disabled={isLoading || !text.trim() || text.trim().length < 10}
              className="w-full flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium bg-ocean-600 hover:bg-ocean-500 disabled:bg-surface-700 disabled:text-text-muted text-white rounded-lg transition-colors"
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {t.enrich?.enriching ?? 'Enriching...'}
                </>
              ) : (
                t.enrich?.submit ?? 'Enrich'
              )}
            </button>
          </>
        )}

        {(mode === 'csv' || mode === 'screenshot') && (
          <>
            {/* File drop zone */}
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleFileDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`flex flex-col items-center justify-center gap-2 p-6 border-2 border-dashed rounded-lg cursor-pointer transition-colors ${
                selectedFile
                  ? 'border-ocean-500/50 bg-ocean-500/5'
                  : 'border-surface-600 hover:border-surface-500 bg-surface-800'
              }`}
            >
              <Upload className="w-6 h-6 text-text-muted" />
              {selectedFile ? (
                <span className="text-sm text-ocean-400 truncate max-w-full">
                  {selectedFile.name}
                </span>
              ) : (
                <>
                  <span className="text-xs text-text-muted">
                    {t.enrich?.dropFile ?? 'Drop a file here or click to browse'}
                  </span>
                  <span className="text-xs text-text-muted/60">
                    {mode === 'csv'
                      ? (t.enrich?.csvHint ?? 'CSV or Excel file with numeric columns')
                      : (t.enrich?.screenshotHint ?? 'PNG, JPG, or WebP screenshot')
                    }
                  </span>
                </>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept={mode === 'csv' ? '.csv,.xlsx,.xls' : 'image/*'}
                onChange={handleFileSelect}
                className="hidden"
              />
            </div>

            {/* Question input */}
            <input
              type="text"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder={t.enrich?.questionPlaceholder ?? 'What causal relationships should we look for?'}
              className="w-full px-3 py-2 text-sm bg-surface-800 border border-surface-600 rounded-lg text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-ocean-500"
              disabled={isLoading}
            />

            {/* Data type selector (CSV only) */}
            {mode === 'csv' && (
              <div className="flex gap-2">
                <button
                  onClick={() => setDataType('time_series')}
                  className={`flex-1 px-3 py-1.5 text-xs rounded-lg border transition-colors ${
                    dataType === 'time_series'
                      ? 'text-ocean-400 bg-ocean-500/15 border-ocean-500/30'
                      : 'text-text-muted bg-surface-800 border-surface-600 hover:border-surface-500'
                  }`}
                >
                  Time Series
                </button>
                <button
                  onClick={() => setDataType('cross_section')}
                  className={`flex-1 px-3 py-1.5 text-xs rounded-lg border transition-colors ${
                    dataType === 'cross_section'
                      ? 'text-ocean-400 bg-ocean-500/15 border-ocean-500/30'
                      : 'text-text-muted bg-surface-800 border-surface-600 hover:border-surface-500'
                  }`}
                >
                  Cross-Section
                </button>
              </div>
            )}

            {/* Submit */}
            <button
              onClick={handleSubmitFile}
              disabled={isLoading || !selectedFile}
              className="w-full flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium bg-ocean-600 hover:bg-ocean-500 disabled:bg-surface-700 disabled:text-text-muted text-white rounded-lg transition-colors"
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {t.enrich?.enriching ?? 'Enriching...'}
                </>
              ) : (
                t.enrich?.analyzeAndMerge ?? 'Analyze & Merge'
              )}
            </button>
          </>
        )}
      </div>
    </div>
  )
}
