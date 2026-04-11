const BASE_URL = ''

export class ApiError extends Error {
  status: number
  body: string

  constructor(status: number, body: string) {
    super(`API Error ${status}: ${body}`)
    this.status = status
    this.body = body
    this.name = 'ApiError'
  }
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.text()
    throw new ApiError(res.status, body)
  }
  return res.json() as Promise<T>
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return handleResponse<T>(res)
}

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'GET',
    headers: { 'Accept': 'application/json' },
  })
  return handleResponse<T>(res)
}

export async function apiPatch<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return handleResponse<T>(res)
}

export async function apiDelete<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'DELETE',
    headers: { 'Accept': 'application/json' },
  })
  return handleResponse<T>(res)
}

export async function apiPostForm<T>(path: string, form: FormData): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    body: form,
  })
  return handleResponse<T>(res)
}

// ── Three-Layer Causal Analysis ──

export interface CausalEvidence {
  source_label: string
  target_label: string
  layer: number
  algorithm: string
  edge_type: string
  confidence: number
  p_value: number | null
  effect_size: number | null
  lag: number | null
  reason: string | null
}

export interface FusedEdge {
  source_label: string
  target_label: string
  verdict: 'confirmed' | 'supported' | 'hypothesized' | 'conflicted'
  confidence_tier: 'high' | 'medium' | 'low' | 'unverified'
  fused_confidence: number
  best_p_value: number | null
  best_lag: number | null
  evidence: CausalEvidence[]
}

export interface CausalAnalysisResult {
  edges: FusedEdge[]
  data_quality: string
  layers_used: number[]
  summary: string | null
  metrics_saved?: number
}

export async function analyzeText(data: { question: string; context?: string; project_id?: string }) {
  return apiPost<CausalAnalysisResult>('/api/v1/causal/analyze/text', data)
}

export async function analyzeCSV(file: File, options?: {
  question?: string; project_id?: string; data_type?: string; max_lag?: number; alpha?: number
}) {
  const form = new FormData()
  form.append('file', file)
  if (options?.question) form.append('question', options.question)
  if (options?.project_id) form.append('project_id', options.project_id)
  if (options?.data_type) form.append('data_type', options.data_type)
  if (options?.max_lag) form.append('max_lag', String(options.max_lag))
  if (options?.alpha) form.append('alpha', String(options.alpha))
  return apiPostForm<CausalAnalysisResult>('/api/v1/causal/analyze/csv', form)
}

export async function analyzeScreenshot(file: File, options?: { question?: string; project_id?: string }) {
  const form = new FormData()
  form.append('file', file)
  if (options?.question) form.append('question', options.question)
  if (options?.project_id) form.append('project_id', options.project_id)
  return apiPostForm<CausalAnalysisResult>('/api/v1/causal/analyze/screenshot', form)
}

// ── Event Timeline ──

export interface TimelineEvent {
  id: string
  title: string
  description: string | null
  event_type: string
  event_date: string
  source: string
  project_id: string | null
  affected_metrics: string[] | null
  evidence_ids: string[] | null
  created_at: string
}

export async function createEvent(data: {
  title: string; description?: string; event_type: string; event_date: string; project_id?: string; affected_metrics?: string[]
}) {
  return apiPost<TimelineEvent>('/api/v1/events', data)
}

export async function listEvents(projectId?: string) {
  const qs = projectId ? `?project_id=${projectId}` : ''
  return apiGet<TimelineEvent[]>(`/api/v1/events${qs}`)
}

export async function deleteEvent(id: string) {
  return apiDelete<void>(`/api/v1/events/${id}`)
}
