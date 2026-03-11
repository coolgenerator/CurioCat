/**
 * Visual mapping constants for the causal graph.
 * Pure data — no React or D3 dependencies.
 */

import type { CausalType, ConditionType, LogicGate } from '../types/graph.ts'

// --- Edge dash patterns by causal type ---

export const EDGE_DASH: Record<CausalType, string> = {
  direct: 'none',
  indirect: '8 5',
  probabilistic: '8 5',
  enabling: '2 4',
  inhibiting: 'none',
  triggering: 'none',
}

// --- Edge stroke width from strength ---

export function edgeStrokeWidth(strength: number): number {
  return 1 + strength * 4  // 1px at 0.0, 5px at 1.0
}

// --- Edge color from evidence score ---

export function evidenceToColor(score: number): string {
  if (score >= 0.75) return '#3b82f6'   // blue — strong
  if (score >= 0.5) return '#22c55e'     // green — good
  if (score >= 0.25) return '#f97316'    // orange — weak
  return '#ef4444'                        // red — poor
}

// --- Causal type metadata ---

export const CAUSAL_TYPE_META: Record<CausalType, { label: string; icon: string; description: string }> = {
  direct:        { label: 'Direct',        icon: '→',  description: 'Directly produces the effect through a clear mechanism' },
  indirect:      { label: 'Indirect',      icon: '⇢',  description: 'Leads to the effect through intermediary steps' },
  probabilistic: { label: 'Probabilistic', icon: '⊸',  description: 'Increases the probability but does not guarantee' },
  enabling:      { label: 'Enabling',      icon: '⊜',  description: 'Creates conditions that allow the effect to happen' },
  inhibiting:    { label: 'Inhibiting',    icon: '⊣',  description: 'Suppresses or prevents the effect' },
  triggering:    { label: 'Triggering',    icon: '⚡',  description: 'Final catalyst that initiates a primed effect' },
}

// --- Logic gate metadata ---

export const LOGIC_GATE_META: Record<LogicGate, { label: string; description: string }> = {
  or:  { label: 'OR',  description: 'Any parent can activate this node (Noisy-OR)' },
  and: { label: 'AND', description: 'All parents must be active for this node to activate' },
}

// --- Condition type labels ---

export const CONDITION_TYPE_LABELS: Record<ConditionType, string> = {
  sufficient:   'Sufficient — alone enough to produce the effect',
  necessary:    'Necessary — effect cannot occur without this',
  contributing: 'Contributing — increases likelihood but not required',
}

// --- Bias severity colors ---

export const BIAS_SEVERITY_COLORS: Record<string, string> = {
  low: '#f59e0b',     // amber
  medium: '#f97316',  // orange
  high: '#ef4444',    // red
}

// --- Source tier labels ---

export const SOURCE_TIER_LABELS: Record<number, string> = {
  1: 'Peer-Reviewed',
  2: 'Institutional/Gov',
  3: 'Quality News',
  4: 'General',
  5: 'Forum',
  6: 'Social Media',
}

// --- Time delay significance ---

export function isSignificantTimeDelay(timeDelay: string | null): boolean {
  if (!timeDelay) return false
  const lower = timeDelay.toLowerCase()
  return /month|year|week|decade/.test(lower)
}

/** Parse a natural-language time delay into approximate days. Returns 0 if unparseable. */
export function parseTimeDelayDays(timeDelay: string | null): number {
  if (!timeDelay) return 0
  const lower = timeDelay.toLowerCase()
  const num = parseFloat(lower.match(/[\d.]+/)?.[0] ?? '1')
  if (/year/.test(lower)) return num * 365
  if (/decade/.test(lower)) return num * 3650
  if (/month/.test(lower)) return num * 30
  if (/week/.test(lower)) return num * 7
  if (/day/.test(lower)) return num
  if (/hour/.test(lower)) return num / 24
  if (/immediate|instant/.test(lower)) return 0
  return 0
}

/** Short label for edge time delay: "2w", "3mo", "1y" etc. Returns null if trivial. */
export function formatTimeDelayShort(timeDelay: string | null): string | null {
  const days = parseTimeDelayDays(timeDelay)
  if (days <= 0) return null
  if (days < 1) return '<1d'
  if (days < 7) return `${Math.round(days)}d`
  if (days < 30) return `${Math.round(days / 7)}w`
  if (days < 365) return `${Math.round(days / 30)}mo`
  return `${+(days / 365).toFixed(1)}y`
}
