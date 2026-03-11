import { useCallback } from 'react'
import { X, FileJson, FileText, Globe, Download } from 'lucide-react'
import { toast } from 'sonner'
import { useT } from '../../i18n/index.tsx'
import type { Translations } from '../../i18n/index.tsx'
import type { CausalGraph } from '../../types/graph.ts'

interface ExportPanelProps {
  graph: CausalGraph
  onClose: () => void
}

function downloadFile(filename: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.download = filename
  link.href = url
  link.click()
  URL.revokeObjectURL(url)
}

export default function ExportPanel({ graph, onClose }: ExportPanelProps) {
  const { t } = useT()

  const handleExportJSON = useCallback(() => {
    const data = JSON.stringify(graph, null, 2)
    downloadFile(
      `curiocat-graph-${graph.projectId}.json`,
      data,
      'application/json',
    )
    toast.success(t.toasts.exported.json)
  }, [graph, t])

  const handleExportMarkdown = useCallback(() => {
    const md = generateMarkdown(graph, t)
    downloadFile(
      `curiocat-report-${graph.projectId}.md`,
      md,
      'text/markdown',
    )
    toast.success(t.toasts.exported.markdown)
  }, [graph, t])

  const handleExportHTML = useCallback(() => {
    const html = generateInteractiveHTML(graph, t)
    downloadFile(
      `curiocat-graph-${graph.projectId}.html`,
      html,
      'text/html',
    )
    toast.success(t.toasts.exported.html)
  }, [graph, t])

  return (
    <div className="w-full bg-surface-800 border-l border-surface-700 h-full overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-surface-700">
        <div className="flex items-center gap-2">
          <Download className="w-4 h-4 text-ocean-400" />
          <h3 className="text-sm font-semibold text-text-primary">{t.export.title}</h3>
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded-md hover:bg-surface-700 text-text-muted hover:text-text-primary transition-colors"
          aria-label="Close panel"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="p-4 space-y-3">
        {/* JSON export */}
        <button
          onClick={handleExportJSON}
          className="w-full flex items-center gap-3 p-3 bg-surface-700/50 hover:bg-surface-700 rounded-lg border border-surface-600 transition-colors text-left group"
        >
          <div className="p-2 rounded-lg bg-ocean-500/15 text-ocean-400 group-hover:bg-ocean-500/25 transition-colors">
            <FileJson className="w-5 h-5" />
          </div>
          <div>
            <span className="text-sm font-medium text-text-primary block">{t.export.json}</span>
            <span className="text-xs text-text-muted">{t.export.jsonDesc}</span>
          </div>
        </button>

        {/* Markdown export */}
        <button
          onClick={handleExportMarkdown}
          className="w-full flex items-center gap-3 p-3 bg-surface-700/50 hover:bg-surface-700 rounded-lg border border-surface-600 transition-colors text-left group"
        >
          <div className="p-2 rounded-lg bg-deep-400/15 text-deep-300 group-hover:bg-deep-400/25 transition-colors">
            <FileText className="w-5 h-5" />
          </div>
          <div>
            <span className="text-sm font-medium text-text-primary block">{t.export.markdown}</span>
            <span className="text-xs text-text-muted">{t.export.markdownDesc}</span>
          </div>
        </button>

        {/* Interactive HTML export */}
        <button
          onClick={handleExportHTML}
          className="w-full flex items-center gap-3 p-3 bg-surface-700/50 hover:bg-surface-700 rounded-lg border border-surface-600 transition-colors text-left group"
        >
          <div className="p-2 rounded-lg bg-amber-500/15 text-amber-400 group-hover:bg-amber-500/25 transition-colors">
            <Globe className="w-5 h-5" />
          </div>
          <div>
            <span className="text-sm font-medium text-text-primary block">{t.export.html}</span>
            <span className="text-xs text-text-muted">{t.export.htmlDesc}</span>
          </div>
        </button>

        {/* Stats */}
        <div className="mt-4 pt-4 border-t border-surface-700">
          <p className="text-xs text-text-muted mb-2">{t.export.summary}</p>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="bg-surface-700/30 rounded-lg p-2">
              <span className="text-text-muted block">{t.export.nodesLabel}</span>
              <span className="text-text-primary font-medium">{graph.nodes.length}</span>
            </div>
            <div className="bg-surface-700/30 rounded-lg p-2">
              <span className="text-text-muted block">{t.export.edgesLabel}</span>
              <span className="text-text-primary font-medium">{graph.edges.length}</span>
            </div>
            <div className="bg-surface-700/30 rounded-lg p-2">
              <span className="text-text-muted block">{t.export.criticalPathLabel}</span>
              <span className="text-text-primary font-medium">{graph.criticalPath.length}</span>
            </div>
            <div className="bg-surface-700/30 rounded-lg p-2">
              <span className="text-text-muted block">{t.export.evidenceLabel}</span>
              <span className="text-text-primary font-medium">
                {graph.edges.reduce((acc, e) => acc + e.evidences.length, 0)}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// --- Markdown generation ---

function generateMarkdown(graph: CausalGraph, t: Translations): string {
  const lines: string[] = []
  const e = t.export

  lines.push(`# ${e.reportTitle}`)
  lines.push(``)
  lines.push(`**${e.projectId}:** ${graph.projectId}`)
  lines.push(`**${e.generated}:** ${new Date().toISOString()}`)
  lines.push(``)

  // Summary
  lines.push(`## ${e.summaryHeading}`)
  lines.push(``)
  lines.push(`- **${graph.nodes.length}** ${e.claimsIdentified}`)
  lines.push(`- **${graph.edges.length}** ${e.causalRelationships}`)
  lines.push(`- **${graph.criticalPath.length}** ${e.nodesInCriticalPath}`)
  lines.push(`- **${graph.edges.reduce((acc, ed) => acc + ed.evidences.length, 0)}** ${e.piecesOfEvidence}`)
  lines.push(``)

  // Claims
  lines.push(`## ${e.claimsHeading}`)
  lines.push(``)
  for (const node of graph.nodes) {
    const cpMarker = node.isCriticalPath ? ` **(${e.criticalPathLabel})**` : ''
    lines.push(`### ${node.text}${cpMarker}`)
    lines.push(``)
    lines.push(`- **${e.type}:** ${node.claimType}`)
    lines.push(`- **${e.confidence}:** ${(node.confidence * 100).toFixed(0)}%`)
    if (node.belief !== null) {
      lines.push(`- **${e.beliefLabel}:** ${node.belief.toFixed(2)}`)
    }
    if (node.sensitivity !== null) {
      lines.push(`- **${e.sensitivityLabel}:** ${node.sensitivity.toFixed(2)}`)
    }
    lines.push(``)
  }

  // Edges
  lines.push(`## ${e.causalRelationshipsHeading}`)
  lines.push(``)
  lines.push(`| ${e.source} | ${e.target} | ${e.mechanismCol} | ${e.strengthCol} | ${e.evidenceScoreCol} |`)
  lines.push(`| --- | --- | --- | --- | --- |`)
  for (const edge of graph.edges) {
    const source = graph.nodes.find((n) => n.id === edge.sourceId)
    const target = graph.nodes.find((n) => n.id === edge.targetId)
    lines.push(
      `| ${source?.text.slice(0, 40) ?? edge.sourceId} | ${target?.text.slice(0, 40) ?? edge.targetId} | ${edge.mechanism.slice(0, 40)} | ${edge.strength.toFixed(2)} | ${edge.evidenceScore.toFixed(2)} |`,
    )
  }
  lines.push(``)

  // Evidence
  const allEvidence = graph.edges.flatMap((ed) =>
    ed.evidences.map((ev) => ({ ...ev, edgeId: ed.id })),
  )
  if (allEvidence.length > 0) {
    lines.push(`## ${e.evidenceHeading}`)
    lines.push(``)
    for (const ev of allEvidence) {
      lines.push(`### ${ev.sourceTitle}`)
      lines.push(``)
      lines.push(`- **${e.type}:** ${ev.evidenceType}`)
      lines.push(`- **${e.source}:** [${ev.sourceTitle}](${ev.sourceUrl})`)
      lines.push(`- **${e.relevanceLabel}:** ${(ev.relevanceScore * 100).toFixed(0)}%`)
      lines.push(`- **${e.credibilityLabel}:** ${(ev.credibilityScore * 100).toFixed(0)}%`)
      lines.push(``)
      lines.push(`> ${ev.snippet}`)
      lines.push(``)
    }
  }

  // Critical Path
  if (graph.criticalPath.length > 0) {
    lines.push(`## ${e.criticalPathHeading}`)
    lines.push(``)
    for (let i = 0; i < graph.criticalPath.length; i++) {
      const nodeId = graph.criticalPath[i]
      const node = graph.nodes.find((n) => n.id === nodeId)
      lines.push(`${i + 1}. ${node?.text ?? nodeId}`)
    }
    lines.push(``)
  }

  return lines.join('\n')
}

// --- Interactive HTML generation ---

function generateInteractiveHTML(graph: CausalGraph, t: Translations): string {
  const jsonData = JSON.stringify(graph, null, 2)
  const e = t.export

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${e.htmlTitle}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Inter', system-ui, -apple-system, sans-serif;
      background: #0a0e1a; color: #f1f5f9;
      padding: 2rem; line-height: 1.6;
    }
    h1 { color: #26a8d4; margin-bottom: 1rem; font-size: 1.5rem; }
    h2 { color: #94a3b8; margin: 1.5rem 0 0.75rem; font-size: 1.1rem; border-bottom: 1px solid #1e293b; padding-bottom: 0.5rem; }
    .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 1rem; margin: 1rem 0; }
    .stat { background: #111827; border: 1px solid #1e293b; border-radius: 8px; padding: 1rem; }
    .stat-label { font-size: 0.75rem; color: #64748b; }
    .stat-value { font-size: 1.25rem; font-weight: 600; color: #26a8d4; }
    table { width: 100%; border-collapse: collapse; margin: 1rem 0; }
    th { text-align: left; padding: 0.5rem; font-size: 0.75rem; color: #64748b; border-bottom: 1px solid #1e293b; }
    td { padding: 0.5rem; font-size: 0.85rem; border-bottom: 1px solid #1e293b22; }
    .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 0.7rem; font-weight: 500; }
    .badge-fact { background: #0098cc22; color: #26a8d4; border: 1px solid #0098cc44; }
    .badge-assumption { background: #ffc10722; color: #ffca28; border: 1px solid #ffc10744; }
    .badge-prediction { background: #5869b622; color: #8894cb; border: 1px solid #5869b644; }
    .badge-opinion { background: #47556922; color: #94a3b8; border: 1px solid #47556944; }
    .critical { color: #22c55e; font-weight: 500; }
    .bar { height: 6px; border-radius: 3px; background: #1e293b; overflow: hidden; }
    .bar-fill { height: 100%; border-radius: 3px; background: linear-gradient(to right, #007aa3, #26a8d4); }
    a { color: #26a8d4; text-decoration: none; }
    a:hover { text-decoration: underline; }
    .evidence-card { background: #111827; border: 1px solid #1e293b; border-radius: 8px; padding: 1rem; margin: 0.5rem 0; }
    .json-toggle { cursor: pointer; color: #26a8d4; font-size: 0.85rem; margin-top: 2rem; }
    #json-data { display: none; background: #111827; border: 1px solid #1e293b; border-radius: 8px; padding: 1rem; margin-top: 0.5rem; overflow-x: auto; font-family: monospace; font-size: 0.75rem; color: #94a3b8; white-space: pre; max-height: 400px; }
  </style>
</head>
<body>
  <h1>${e.htmlHeading}</h1>
  <p style="color: #64748b; font-size: 0.85rem;">${e.htmlProject}: ${graph.projectId} | ${e.generated}: ${new Date().toISOString()}</p>

  <div class="stats">
    <div class="stat"><div class="stat-label">${e.htmlClaims}</div><div class="stat-value">${graph.nodes.length}</div></div>
    <div class="stat"><div class="stat-label">${e.htmlCausalLinks}</div><div class="stat-value">${graph.edges.length}</div></div>
    <div class="stat"><div class="stat-label">${e.criticalPathLabel}</div><div class="stat-value">${graph.criticalPath.length}</div></div>
    <div class="stat"><div class="stat-label">${e.evidenceLabel}</div><div class="stat-value">${graph.edges.reduce((a, ed) => a + ed.evidences.length, 0)}</div></div>
  </div>

  <h2>${e.htmlClaims}</h2>
  <table>
    <thead><tr><th>${e.htmlClaim}</th><th>${e.type}</th><th>${e.confidence}</th><th>${e.htmlCritical}</th></tr></thead>
    <tbody>
      ${graph.nodes.map((n) => `<tr>
        <td>${escapeHtml(n.text)}</td>
        <td><span class="badge badge-${n.claimType.toLowerCase()}">${n.claimType}</span></td>
        <td><div class="bar"><div class="bar-fill" style="width:${(n.confidence * 100).toFixed(0)}%"></div></div> ${(n.confidence * 100).toFixed(0)}%</td>
        <td>${n.isCriticalPath ? `<span class="critical">${e.htmlYes}</span>` : '-'}</td>
      </tr>`).join('\n')}
    </tbody>
  </table>

  <h2>${e.htmlCausalLinks}</h2>
  <table>
    <thead><tr><th>${e.source}</th><th>${e.target}</th><th>${e.mechanismCol}</th><th>${e.strengthCol}</th></tr></thead>
    <tbody>
      ${graph.edges.map((ed) => {
    const src = graph.nodes.find((n) => n.id === ed.sourceId)
    const tgt = graph.nodes.find((n) => n.id === ed.targetId)
    return `<tr>
        <td>${escapeHtml((src?.text ?? ed.sourceId).slice(0, 50))}</td>
        <td>${escapeHtml((tgt?.text ?? ed.targetId).slice(0, 50))}</td>
        <td>${escapeHtml(ed.mechanism.slice(0, 60))}</td>
        <td>${ed.strength.toFixed(2)}</td>
      </tr>`
  }).join('\n')}
    </tbody>
  </table>

  <p class="json-toggle" onclick="var el=document.getElementById('json-data');el.style.display=el.style.display==='none'?'block':'none';">
    ${e.toggleJson}
  </p>
  <pre id="json-data">${escapeHtml(jsonData)}</pre>
</body>
</html>`
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}
