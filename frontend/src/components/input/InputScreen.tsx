import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { Send, Cat, Upload, FileText, Image, X, Clock, CheckCircle2, Loader2, AlertCircle } from 'lucide-react'
import { Button, Textarea } from '../ui/index.ts'
import DemoScenarios from './DemoScenarios.tsx'
import { apiPost, apiGet } from '../../lib/api/client.ts'
import { useAnalysis } from '../../context/AnalysisContext.tsx'
import { useT } from '../../i18n/index.tsx'
import type { AnalyzeRequest, AnalyzeResponse, ProjectSummary } from '../../types/api.ts'

const ACCEPTED_FILE_TYPES = '.txt,.md,.csv,.json,.pdf,.png,.jpg,.jpeg,.webp,.gif'

interface UploadResponse {
  title: string
  text: string
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

export default function InputScreen() {
  const [title, setTitle] = useState('')
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadedFile, setUploadedFile] = useState<string | null>(null)
  const [history, setHistory] = useState<ProjectSummary[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()
  const { dispatch } = useAnalysis()
  const { t } = useT()

  // Fetch project history on mount
  useEffect(() => {
    let cancelled = false
    async function fetchHistory() {
      try {
        const result = await apiGet<{ projects: ProjectSummary[] }>('/api/v1/projects')
        if (!cancelled) setHistory(result.projects)
      } catch {
        // Silently fail
      }
    }
    void fetchHistory()
    return () => { cancelled = true }
  }, [])

  const canSubmit = text.trim().length >= 10 && title.trim().length > 0

  async function handleSubmit() {
    if (!canSubmit) return

    setLoading(true)
    try {
      const response = await apiPost<AnalyzeResponse>('/api/v1/analyze', {
        title: title.trim(),
        text: text.trim(),
      } satisfies AnalyzeRequest)

      dispatch({ type: 'START_ANALYSIS', projectId: response.project_id })
      navigate(`/analysis/${response.project_id}`)
    } catch (err) {
      const message = err instanceof Error ? err.message : t.errors.analysisFailed
      toast.error(message)
    } finally {
      setLoading(false)
    }
  }

  async function handleFileUpload(file: File) {
    setUploading(true)
    try {
      const formData = new FormData()
      formData.append('file', file)

      const res = await fetch('/api/v1/upload', {
        method: 'POST',
        body: formData,
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }))
        throw new Error(err.detail || `Upload failed: ${res.status}`)
      }

      const data: UploadResponse = await res.json()
      setTitle(data.title)
      setText(data.text)
      setUploadedFile(file.name)

      const isImage = file.type.startsWith('image/')
      toast.success(
        isImage
          ? t.toasts.imageAnalyzed.replace('{name}', file.name)
          : t.toasts.textExtracted.replace('{name}', file.name)
      )
    } catch (err) {
      const message = err instanceof Error ? err.message : t.errors.uploadFailed
      toast.error(message)
    } finally {
      setUploading(false)
    }
  }

  function handleFileInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) handleFileUpload(file)
    e.target.value = '' // Reset so same file can be re-uploaded
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    e.stopPropagation()
    const file = e.dataTransfer.files?.[0]
    if (file) handleFileUpload(file)
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault()
    e.stopPropagation()
  }

  function clearUpload() {
    setUploadedFile(null)
  }

  function handleDemoSelect(demoTitle: string, demoText: string) {
    setTitle(demoTitle)
    setText(demoText)
    setUploadedFile(null)
  }

  const isImage = uploadedFile?.match(/\.(png|jpg|jpeg|webp|gif)$/i)

  return (
    <div className="max-w-3xl mx-auto px-4 py-12 sm:py-20">
      {/* Hero */}
      <div className="text-center mb-10">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-ocean-500/10 border border-ocean-500/20 mb-4">
          <Cat className="w-8 h-8 text-ocean-400" />
        </div>
        <h1 className="text-3xl sm:text-4xl font-bold text-text-primary mb-2">
          {t.common.appName}
        </h1>
        <p className="text-text-secondary text-base italic">
          {t.common.tagline}
        </p>
        <p className="text-text-muted text-sm mt-1.5">
          {t.common.heroDescription}
        </p>
      </div>

      {/* Title input */}
      <div className="mb-3">
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t.input.titlePlaceholder}
          className="
            w-full bg-surface-800 text-text-primary
            border border-surface-700 rounded-xl
            px-4 py-3 text-sm
            placeholder:text-text-muted
            focus:outline-none focus:border-ocean-500/50 focus:ring-1 focus:ring-ocean-500/25
            transition-colors
          "
        />
      </div>

      {/* Text input with drop zone */}
      <div
        className="mb-4"
        onDrop={handleDrop}
        onDragOver={handleDragOver}
      >
        <Textarea
          value={text}
          onChange={(e) => { setText(e.target.value); setUploadedFile(null) }}
          placeholder={t.input.textPlaceholder}
          rows={8}
          className="min-h-[200px]"
        />
        <div className="flex items-center justify-between mt-2">
          <span className="text-xs text-text-muted">
            {text.length} {t.input.charCount}
            {text.length > 0 && text.length < 10 && ` ${t.input.minChars}`}
          </span>

          {/* Upload indicator */}
          {uploadedFile && (
            <span className="flex items-center gap-1.5 text-xs text-ocean-400">
              {isImage ? <Image className="w-3 h-3" /> : <FileText className="w-3 h-3" />}
              {uploadedFile}
              <button onClick={clearUpload} className="hover:text-ocean-300">
                <X className="w-3 h-3" />
              </button>
            </span>
          )}
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex gap-3 mb-2">
        <Button
          onClick={handleSubmit}
          disabled={!canSubmit}
          loading={loading}
          size="lg"
          className="flex-1"
        >
          <Send className="w-4 h-4" />
          {t.input.analyze}
        </Button>

        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPTED_FILE_TYPES}
          onChange={handleFileInputChange}
          className="hidden"
        />
        <Button
          variant="secondary"
          onClick={() => fileInputRef.current?.click()}
          loading={uploading}
          size="lg"
        >
          <Upload className="w-4 h-4" />
          {t.input.upload}
        </Button>
      </div>

      <p className="text-xs text-text-muted text-center mb-6">
        {t.input.supportedFormats}
      </p>

      {/* Demo scenarios */}
      <DemoScenarios onSelect={handleDemoSelect} />

      {/* History */}
      {history.length > 0 && (
        <div className="mt-8">
          <div className="flex items-center gap-2 mb-3">
            <Clock className="w-4 h-4 text-text-muted" />
            <h2 className="text-sm font-semibold text-text-secondary">{t.history.title}</h2>
          </div>
          <div className="space-y-2">
            {history.map((project) => (
              <button
                key={project.id}
                onClick={() => {
                  if (project.status === 'completed') {
                    navigate(`/graph/${project.id}`)
                  } else if (project.status === 'processing') {
                    navigate(`/analysis/${project.id}`)
                  }
                }}
                className="w-full text-left px-4 py-3 bg-surface-800 border border-surface-700 rounded-xl hover:border-surface-600 hover:bg-surface-800/80 transition-colors group"
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm text-text-primary group-hover:text-ocean-300 transition-colors truncate mr-3">
                    {project.title}
                  </span>
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
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
