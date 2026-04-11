import { useState, useCallback, useEffect, useRef } from 'react'
import {
  X, Shield, Loader2, ChevronDown, ChevronRight, ArrowLeft,
  Sparkles, Tag, MessageSquare, Trash2, User, Bot,
  AlertTriangle, TrendingUp, ListChecks, Siren, Activity,
} from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import { useT } from '../../i18n/index.tsx'
import type { ApiAdviseResult, ApiPerspectiveSuggestion } from '../../types/api.ts'

interface Props {
  projectId: string
  onClose: () => void
  onAdvise: (userContext: string, perspectiveTags: string[]) => Promise<ApiAdviseResult | null>
  onAdviseStream: (
    userContext: string,
    perspectiveTags: string[],
    onToken: (text: string) => void,
    onComplete: () => void,
    onError: (msg: string) => void,
  ) => () => void
  onSuggestPerspectives: () => Promise<{ suggestions: ApiPerspectiveSuggestion[] } | null>
  operationLoading: string | null
}

type Severity = 'critical' | 'high' | 'medium' | 'low'

const SEVERITY_COLORS: Record<Severity, string> = {
  critical: 'bg-red-500/15 text-red-400 border-red-500/30',
  high: 'bg-orange-500/15 text-orange-400 border-orange-500/30',
  medium: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30',
  low: 'bg-green-500/15 text-green-400 border-green-500/30',
}

const PRIORITY_COLORS: Record<string, string> = {
  immediate: 'bg-red-500/15 text-red-400',
  'short-term': 'bg-orange-500/15 text-orange-400',
  'medium-term': 'bg-yellow-500/15 text-yellow-400',
  'long-term': 'bg-blue-500/15 text-blue-400',
}

const SIGNAL_COLORS: Record<string, string> = {
  leading: 'bg-emerald-500/15 text-emerald-400',
  coincident: 'bg-blue-500/15 text-blue-400',
  lagging: 'bg-purple-500/15 text-purple-400',
}

function SeverityBadge({ severity }: { severity: Severity }) {
  const { t } = useT()
  return (
    <span className={`inline-flex items-center px-2 py-0.5 text-[10px] font-medium rounded-full border ${SEVERITY_COLORS[severity]}`}>
      {t.advisor.severity[severity]}
    </span>
  )
}

function CollapsibleSection({
  title,
  icon: Icon,
  count,
  defaultOpen,
  children,
}: {
  title: string
  icon: React.ComponentType<{ className?: string }>
  count: number
  defaultOpen?: boolean
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen ?? false)
  return (
    <div className="border border-surface-600 rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-3 py-2 text-sm font-medium text-text-primary hover:bg-surface-700 transition-colors"
      >
        {open ? <ChevronDown className="w-3.5 h-3.5 text-text-muted shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 text-text-muted shrink-0" />}
        <Icon className="w-3.5 h-3.5 text-ocean-400 shrink-0" />
        <span className="flex-1 text-left">{title}</span>
        <span className="text-[10px] text-text-muted bg-surface-600 px-1.5 py-0.5 rounded-full">{count}</span>
      </button>
      {open && <div className="px-3 pb-3 space-y-2">{children}</div>}
    </div>
  )
}

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  tags?: string[]
}

interface SessionInfo {
  id: string
  title: string
  message_count: number
  created_at: string | null
}

export default function StrategicAdvisorPanel({ projectId, onClose, onAdvise, onAdviseStream, onSuggestPerspectives, operationLoading }: Props) {
  const { t } = useT()
  // Session management
  const [sessions, setSessions] = useState<SessionInfo[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [sessionsLoading, setSessionsLoading] = useState(true)

  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [inputText, setInputText] = useState('')
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set())
  const [result, setResult] = useState<ApiAdviseResult | null>(null)
  const cancelStreamRef = useRef<(() => void) | null>(null)
  const chatContainerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // Dynamic perspective suggestions
  const [suggestions, setSuggestions] = useState<ApiPerspectiveSuggestion[]>([])
  const [suggestionsLoading, setSuggestionsLoading] = useState(false)

  const isLoading = operationLoading === 'advise'
  const isFirstMessage = messages.length === 0

  // Load sessions list on mount
  useEffect(() => {
    if (!projectId) return
    let cancelled = false
    async function loadSessions() {
      setSessionsLoading(true)
      try {
        const res = await fetch(`/api/v1/graph/${projectId}/advisor-sessions`)
        if (!res.ok) return
        const data = await res.json()
        if (!cancelled) setSessions(data)
      } catch { /* ignore */ }
      if (!cancelled) setSessionsLoading(false)
    }
    void loadSessions()
    return () => { cancelled = true }
  }, [projectId])

  // Load messages when active session changes
  useEffect(() => {
    if (!projectId || !activeSessionId) {
      setMessages([])
      return
    }
    let cancelled = false
    async function loadMessages() {
      try {
        const res = await fetch(`/api/v1/graph/${projectId}/advisor-sessions/${activeSessionId}/messages`)
        if (!res.ok) return
        const data = await res.json()
        if (!cancelled && Array.isArray(data)) {
          setMessages(data.map((m: { role: string; content: string; tags?: string[] }) => ({
            role: m.role as 'user' | 'assistant',
            content: m.content,
            tags: m.tags ?? undefined,
          })))
        }
      } catch { /* ignore */ }
    }
    void loadMessages()
    return () => { cancelled = true }
  }, [projectId, activeSessionId])

  // Create a new session and enter it
  const handleNewSession = useCallback(async () => {
    if (!projectId) return
    try {
      const res = await fetch(`/api/v1/graph/${projectId}/advisor-sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'New conversation' }),
      })
      if (!res.ok) return
      const data = await res.json()
      const newSession: SessionInfo = {
        id: data.id,
        title: data.title,
        message_count: 0,
        created_at: new Date().toISOString(),
      }
      setSessions(prev => [newSession, ...prev])
      setActiveSessionId(data.id)
    } catch { /* ignore */ }
  }, [projectId])

  // Delete a session
  const handleDeleteSession = useCallback(async (sessionId: string) => {
    if (!projectId) return
    try {
      await fetch(`/api/v1/graph/${projectId}/advisor-sessions/${sessionId}`, { method: 'DELETE' })
      setSessions(prev => prev.filter(s => s.id !== sessionId))
      if (activeSessionId === sessionId) {
        setActiveSessionId(null)
        setMessages([])
      }
    } catch { /* ignore */ }
  }, [projectId, activeSessionId])

  // Auto-fetch suggestions when panel opens
  useEffect(() => {
    let cancelled = false
    async function fetchSuggestions() {
      setSuggestionsLoading(true)
      const res = await onSuggestPerspectives()
      if (!cancelled && res?.suggestions) {
        setSuggestions(res.suggestions)
      }
      if (!cancelled) setSuggestionsLoading(false)
    }
    void fetchSuggestions()
    return () => { cancelled = true }
  }, [onSuggestPerspectives])

  const toggleTag = useCallback((label: string) => {
    setSelectedTags(prev => {
      const next = new Set(prev)
      if (next.has(label)) next.delete(label)
      else next.add(label)
      return next
    })
  }, [])

  const scrollToBottom = useCallback(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight
    }
  }, [])

  // Persist a message to the backend via session
  const saveMessage = useCallback((role: string, content: string, tags?: string[]) => {
    if (!projectId || !activeSessionId || !content) return
    fetch(`/api/v1/graph/${projectId}/advisor-sessions/${activeSessionId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role, content, tags }),
    }).then(() => {
      // Update session title and count in the list
      if (role === 'user') {
        setSessions(prev => prev.map(s =>
          s.id === activeSessionId
            ? { ...s, title: s.title === 'New conversation' ? content.slice(0, 80) : s.title, message_count: s.message_count + 1 }
            : s
        ))
      }
    }).catch(() => { /* silent */ })
  }, [projectId, activeSessionId])

  // Ref to accumulate assistant response for persistence
  const assistantBufferRef = useRef('')

  const handleSend = useCallback(async () => {
    const text = inputText.trim()
    if (text.length < 10 || isLoading) return

    const tags = Array.from(selectedTags)

    // Auto-create session if none active
    let sessionId = activeSessionId
    if (!sessionId) {
      try {
        const res = await fetch(`/api/v1/graph/${projectId}/advisor-sessions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: text.slice(0, 80) }),
        })
        if (res.ok) {
          const data = await res.json()
          sessionId = data.id
          setActiveSessionId(sessionId)
          setSessions(prev => [{ id: data.id, title: data.title, message_count: 0, created_at: new Date().toISOString() }, ...prev])
        }
      } catch { /* ignore */ }
    }

    // Add user message and save to DB
    setMessages(prev => [...prev, { role: 'user', content: text, tags }])
    setInputText('')

    // Save user message (uses updated activeSessionId via closure)
    if (sessionId) {
      fetch(`/api/v1/graph/${projectId}/advisor-sessions/${sessionId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'user', content: text, tags }),
      }).catch(() => {})
    }

    // Add placeholder assistant message
    assistantBufferRef.current = ''
    setMessages(prev => [...prev, { role: 'assistant', content: '' }])

    setTimeout(scrollToBottom, 50)

    const finalSessionId = sessionId
    const cancel = onAdviseStream(
      text,
      tags,
      (token) => {
        assistantBufferRef.current += token
        setMessages(prev => {
          const updated = [...prev]
          const last = updated[updated.length - 1]
          if (last?.role === 'assistant') {
            updated[updated.length - 1] = { ...last, content: assistantBufferRef.current }
          }
          return updated
        })
        scrollToBottom()
      },
      () => {
        // Streaming done — save full assistant response to DB
        if (finalSessionId) {
          fetch(`/api/v1/graph/${projectId}/advisor-sessions/${finalSessionId}/messages`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ role: 'assistant', content: assistantBufferRef.current }),
          }).catch(() => {})
        }
      },
      (msg) => {
        assistantBufferRef.current += `\n\n**Error:** ${msg}`
        setMessages(prev => {
          const updated = [...prev]
          const last = updated[updated.length - 1]
          if (last?.role === 'assistant') {
            updated[updated.length - 1] = { ...last, content: assistantBufferRef.current }
          }
          return updated
        })
      },
      finalSessionId ?? undefined,
    )
    cancelStreamRef.current = cancel
  }, [inputText, selectedTags, isLoading, activeSessionId, projectId, onAdviseStream, scrollToBottom])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }, [handleSend])

  // Cleanup stream on unmount
  useEffect(() => {
    return () => { cancelStreamRef.current?.() }
  }, [])

  // --- Session list view (no active session) ---
  if (!activeSessionId) {
    return (
      <div className="flex flex-col h-full bg-surface-800">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-surface-700">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-ocean-400" />
            <h2 className="text-sm font-semibold text-text-primary">{t.advisor.title}</h2>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-surface-700 text-text-muted hover:text-text-primary transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
          {/* New chat button */}
          <button
            onClick={handleNewSession}
            className="w-full flex items-center gap-2 px-3 py-2.5 text-sm rounded-lg border border-dashed border-ocean-500/40 text-ocean-400 hover:bg-ocean-500/10 transition-colors"
          >
            <Sparkles className="w-4 h-4" />
            New Conversation
          </button>

          {/* Perspective tags for new conversations */}
          {!suggestionsLoading && suggestions.length > 0 && (
            <div className="pt-2">
              <div className="flex items-center gap-1.5 mb-1.5">
                <Tag className="w-3 h-3 text-text-muted" />
                <label className="text-xs font-medium text-text-secondary">{t.advisor.perspectiveLabel}</label>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {suggestions.map((s) => {
                  const selected = selectedTags.has(s.label)
                  return (
                    <button
                      key={s.label}
                      onClick={() => toggleTag(s.label)}
                      title={s.description}
                      className={`flex items-center gap-1 px-2 py-1 text-xs rounded-lg border transition-colors ${
                        selected
                          ? 'text-ocean-400 bg-ocean-500/15 border-ocean-500/30'
                          : 'text-text-muted hover:text-text-secondary bg-surface-700 hover:bg-surface-600 border-surface-600'
                      }`}
                    >
                      <Tag className="w-3 h-3" />
                      {s.label}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* Session history */}
          {sessionsLoading ? (
            <div className="flex items-center gap-2 py-4">
              <Loader2 className="w-4 h-4 text-text-muted animate-spin" />
              <span className="text-xs text-text-muted">Loading conversations...</span>
            </div>
          ) : sessions.length > 0 && (
            <div className="pt-3">
              <h3 className="text-xs font-medium text-text-muted mb-2">Previous Conversations</h3>
              <div className="space-y-1">
                {sessions.map((s) => (
                  <div key={s.id} className="group flex items-center gap-2 p-2 rounded-lg hover:bg-surface-700/60 border border-transparent hover:border-surface-600/50 transition-all cursor-pointer"
                    onClick={() => setActiveSessionId(s.id)}
                  >
                    <div className="shrink-0 w-8 h-8 rounded-lg bg-surface-700 flex items-center justify-center">
                      <MessageSquare className="w-3.5 h-3.5 text-ocean-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-text-secondary group-hover:text-text-primary truncate transition-colors">{s.title}</div>
                      <div className="text-[10px] text-text-muted mt-0.5">
                        {s.message_count} messages
                      </div>
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDeleteSession(s.id) }}
                      className="p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-surface-600 text-text-muted hover:text-red-400 transition-all"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Quick start input */}
        <div className="px-3 py-3 border-t border-surface-700">
          <div className="flex gap-2">
            <textarea
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={t.advisor.contextPlaceholder}
              rows={2}
              className="flex-1 px-3 py-2 text-sm bg-surface-700 border border-surface-600 rounded-lg text-text-primary placeholder-text-muted focus:outline-none focus:border-ocean-500 transition-colors resize-none"
            />
            <button
              onClick={handleSend}
              disabled={inputText.trim().length < 10 || isLoading}
              className="px-3 py-2 rounded-lg bg-ocean-500 text-white hover:bg-ocean-400 disabled:opacity-50 disabled:cursor-not-allowed transition-colors self-end"
            >
              <Shield className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    )
  }

  // --- Active session chat view ---
  return (
    <div className="flex flex-col h-full bg-surface-800">
      {/* Header with back button */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-surface-700">
        <div className="flex items-center gap-2">
          <button
            onClick={() => { cancelStreamRef.current?.(); setActiveSessionId(null) }}
            className="p-1 rounded hover:bg-surface-700 text-text-muted hover:text-text-primary transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <Shield className="w-4 h-4 text-ocean-400" />
          <h2 className="text-sm font-semibold text-text-primary truncate max-w-[200px]">
            {sessions.find(s => s.id === activeSessionId)?.title || t.advisor.title}
          </h2>
        </div>
        <button onClick={onClose} className="p-1 rounded hover:bg-surface-700 text-text-muted hover:text-text-primary transition-colors">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Chat messages */}
      <div ref={chatContainerRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        {messages.length === 0 && (
          <p className="text-xs text-text-muted text-center py-8">Start a conversation by typing below.</p>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`flex gap-2.5 ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
            {/* Avatar */}
            <div className={`shrink-0 w-7 h-7 rounded-full flex items-center justify-center mt-0.5 ${
              msg.role === 'user' ? 'bg-ocean-500/20' : 'bg-emerald-500/20'
            }`}>
              {msg.role === 'user'
                ? <User className="w-3.5 h-3.5 text-ocean-400" />
                : <Bot className="w-3.5 h-3.5 text-emerald-400" />
              }
            </div>

            {/* Message bubble */}
            <div className={`max-w-[85%] rounded-xl px-3.5 py-2.5 text-sm ${
              msg.role === 'user'
                ? 'bg-ocean-500/15 text-text-primary border border-ocean-500/20'
                : 'bg-surface-700/80 text-text-secondary border border-surface-600/50'
            }`}>
              {msg.role === 'user' && msg.tags && msg.tags.length > 0 && (
                <div className="flex flex-wrap gap-1 mb-2">
                  {msg.tags.map(tag => (
                    <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded-full bg-ocean-500/10 text-ocean-400 border border-ocean-500/20">
                      {tag}
                    </span>
                  ))}
                </div>
              )}
              {msg.role === 'assistant' ? (
                <div className="advisor-markdown">
                  <ReactMarkdown
                    components={{
                      h2: ({ children }) => <h2 className="text-sm font-semibold text-text-primary mt-3 mb-1.5 first:mt-0">{children}</h2>,
                      h3: ({ children }) => <h3 className="text-xs font-semibold text-text-primary mt-2 mb-1">{children}</h3>,
                      p: ({ children }) => <p className="text-sm text-text-secondary leading-relaxed mb-2 last:mb-0">{children}</p>,
                      ul: ({ children }) => <ul className="text-sm text-text-secondary space-y-1 mb-2 pl-4 list-disc">{children}</ul>,
                      ol: ({ children }) => <ol className="text-sm text-text-secondary space-y-1 mb-2 pl-4 list-decimal">{children}</ol>,
                      li: ({ children }) => <li className="leading-relaxed">{children}</li>,
                      strong: ({ children }) => <strong className="font-semibold text-text-primary">{children}</strong>,
                      em: ({ children }) => <em className="text-ocean-300">{children}</em>,
                      code: ({ children }) => <code className="text-xs bg-surface-600 px-1.5 py-0.5 rounded text-emerald-300">{children}</code>,
                      blockquote: ({ children }) => <blockquote className="border-l-2 border-ocean-500/40 pl-3 my-2 text-text-muted italic">{children}</blockquote>,
                      table: ({ children }) => <div className="overflow-x-auto my-2"><table className="text-xs w-full border-collapse">{children}</table></div>,
                      th: ({ children }) => <th className="border border-surface-600 px-2 py-1 bg-surface-600/50 text-text-primary text-left font-medium">{children}</th>,
                      td: ({ children }) => <td className="border border-surface-600 px-2 py-1 text-text-secondary">{children}</td>,
                      hr: () => <hr className="border-surface-600 my-3" />,
                    }}
                  >
                    {msg.content}
                  </ReactMarkdown>
                  {isLoading && i === messages.length - 1 && (
                    <span className="inline-block w-2 h-4 bg-ocean-400 animate-pulse ml-0.5 rounded-sm" />
                  )}
                </div>
              ) : (
                <div className="whitespace-pre-wrap leading-relaxed">{msg.content}</div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Input area */}
      <div className="px-3 py-3 border-t border-surface-700">
        <div className="flex gap-2">
          <textarea
            ref={inputRef}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask a follow-up question..."
            rows={2}
            className="flex-1 px-3 py-2 text-sm bg-surface-700 border border-surface-600 rounded-lg text-text-primary placeholder-text-muted focus:outline-none focus:border-ocean-500 transition-colors resize-none"
          />
          <button
            onClick={handleSend}
            disabled={inputText.trim().length < 10 || isLoading}
            className="px-3 py-2 rounded-lg bg-ocean-500 text-white hover:bg-ocean-400 disabled:opacity-50 disabled:cursor-not-allowed transition-colors self-end"
          >
            {isLoading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Shield className="w-4 h-4" />
            )}
          </button>
        </div>
      </div>
    </div>
  )

  // --- Results Phase (legacy, for non-streaming fallback) ---
  // Unreachable in chat mode but kept for type safety
  if (!result) return null
  const { impact_assessment, predictions, recommended_actions, escalation_scenarios, key_indicators } = result

  return (
    <div className="flex flex-col h-full bg-surface-800">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-surface-700">
        <div className="flex items-center gap-2">
          <button onClick={handleNewAnalysis} className="p-1 rounded hover:bg-surface-700 text-text-muted hover:text-text-primary transition-colors">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <Shield className="w-4 h-4 text-ocean-400" />
          <h2 className="text-sm font-semibold text-text-primary">{t.advisor.title}</h2>
        </div>
        <div className="flex items-center gap-2">
          <SeverityBadge severity={impact_assessment.overall_severity as Severity} />
          <button onClick={onClose} className="p-1 rounded hover:bg-surface-700 text-text-muted hover:text-text-primary transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Scrollable results */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {/* Executive summary */}
        <div className="p-3 bg-surface-700/50 rounded-lg border border-surface-600">
          <p className="text-xs text-text-secondary leading-relaxed">{impact_assessment.summary}</p>
        </div>

        {/* Impact Assessment */}
        <CollapsibleSection
          title={t.advisor.sections.impact}
          icon={AlertTriangle}
          count={impact_assessment.direct_impacts.length + impact_assessment.indirect_impacts.length}
          defaultOpen
        >
          {impact_assessment.direct_impacts.length > 0 && (
            <div className="space-y-2">
              <p className="text-[10px] font-medium text-text-muted uppercase tracking-wider">{t.advisor.directImpacts}</p>
              {impact_assessment.direct_impacts.map((item, i) => (
                <div key={i} className="p-2 bg-surface-700/50 rounded border border-surface-600 space-y-1">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-xs text-text-primary leading-relaxed flex-1">{item.impact_description}</p>
                    <SeverityBadge severity={item.severity} />
                  </div>
                  <p className="text-[10px] text-text-muted italic">&ldquo;{item.claim_text}&rdquo;</p>
                  <p className="text-[10px] text-text-muted">{t.advisor.timeline}: {item.timeline}</p>
                </div>
              ))}
            </div>
          )}
          {impact_assessment.indirect_impacts.length > 0 && (
            <div className="space-y-2 mt-2">
              <p className="text-[10px] font-medium text-text-muted uppercase tracking-wider">{t.advisor.indirectImpacts}</p>
              {impact_assessment.indirect_impacts.map((item, i) => (
                <div key={i} className="p-2 bg-surface-700/50 rounded border border-surface-600 space-y-1">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-xs text-text-primary leading-relaxed flex-1">{item.impact_description}</p>
                    <SeverityBadge severity={item.severity} />
                  </div>
                  <p className="text-[10px] text-text-muted italic">{item.causal_chain}</p>
                  <p className="text-[10px] text-text-muted">{t.advisor.timeline}: {item.timeline}</p>
                </div>
              ))}
            </div>
          )}
        </CollapsibleSection>

        {/* Predictions */}
        <CollapsibleSection
          title={t.advisor.sections.predictions}
          icon={TrendingUp}
          count={predictions.length}
        >
          {predictions.map((item, i) => (
            <div key={i} className="p-2 bg-surface-700/50 rounded border border-surface-600 space-y-1.5">
              <p className="text-xs text-text-primary leading-relaxed">{item.prediction}</p>
              <div className="flex items-center gap-2">
                <div className="flex-1 h-1.5 bg-surface-600 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-ocean-400 rounded-full transition-all"
                    style={{ width: `${item.probability * 100}%` }}
                  />
                </div>
                <span className="text-[10px] text-text-muted tabular-nums w-8 text-right">{(item.probability * 100).toFixed(0)}%</span>
              </div>
              <p className="text-[10px] text-text-muted">{item.timeframe} &middot; {item.confidence_note}</p>
            </div>
          ))}
        </CollapsibleSection>

        {/* Recommended Actions */}
        <CollapsibleSection
          title={t.advisor.sections.actions}
          icon={ListChecks}
          count={recommended_actions.length}
        >
          {recommended_actions.map((item, i) => (
            <div key={i} className="p-2 bg-surface-700/50 rounded border border-surface-600 space-y-1">
              <div className="flex items-start justify-between gap-2">
                <p className="text-xs text-text-primary leading-relaxed flex-1">{item.action}</p>
                <span className={`inline-flex items-center px-2 py-0.5 text-[10px] font-medium rounded-full ${PRIORITY_COLORS[item.priority] ?? PRIORITY_COLORS['long-term']}`}>
                  {t.advisor.priority[item.priority as keyof typeof t.advisor.priority]}
                </span>
              </div>
              <p className="text-[10px] text-text-muted">{item.timeframe} &middot; {item.rationale}</p>
            </div>
          ))}
        </CollapsibleSection>

        {/* Escalation Scenarios */}
        <CollapsibleSection
          title={t.advisor.sections.escalation}
          icon={Siren}
          count={escalation_scenarios.length}
        >
          {escalation_scenarios.map((item, i) => (
            <div key={i} className="p-2 bg-surface-700/50 rounded border border-surface-600 space-y-1.5">
              <div className="flex items-start justify-between gap-2">
                <p className="text-xs font-medium text-text-primary">{item.scenario_name}</p>
                <SeverityBadge severity={item.severity as Severity} />
              </div>
              <p className="text-[10px] text-text-muted"><strong>{t.advisor.trigger}:</strong> {item.trigger}</p>
              <p className="text-[10px] text-text-muted italic">{item.causal_chain}</p>
              <p className="text-xs text-text-secondary">{item.impact_on_user}</p>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-text-muted">{t.advisor.probability}: {(item.probability * 100).toFixed(0)}%</span>
              </div>
              {item.contingency_actions.length > 0 && (
                <div className="mt-1 space-y-0.5">
                  <p className="text-[10px] font-medium text-text-muted">{t.advisor.contingency}:</p>
                  {item.contingency_actions.map((action, j) => (
                    <p key={j} className="text-[10px] text-text-secondary pl-2">- {action}</p>
                  ))}
                </div>
              )}
            </div>
          ))}
        </CollapsibleSection>

        {/* Key Indicators */}
        <CollapsibleSection
          title={t.advisor.sections.indicators}
          icon={Activity}
          count={key_indicators.length}
        >
          {key_indicators.map((item, i) => (
            <div key={i} className="p-2 bg-surface-700/50 rounded border border-surface-600 space-y-1">
              <div className="flex items-start justify-between gap-2">
                <p className="text-xs text-text-primary leading-relaxed flex-1">{item.indicator}</p>
                <span className={`inline-flex items-center px-2 py-0.5 text-[10px] font-medium rounded-full ${SIGNAL_COLORS[item.signal_type] ?? SIGNAL_COLORS.coincident}`}>
                  {t.advisor.signalType[item.signal_type as keyof typeof t.advisor.signalType]}
                </span>
              </div>
              <p className="text-[10px] text-text-muted">{t.advisor.threshold}: {item.threshold}</p>
              <p className="text-[10px] text-text-muted">{t.advisor.dataSource}: {item.data_source}</p>
            </div>
          ))}
        </CollapsibleSection>
      </div>
    </div>
  )
}
