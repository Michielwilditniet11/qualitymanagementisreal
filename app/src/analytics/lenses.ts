import type { GraphNode } from '../data/types'
import { NODE_COLORS } from '../graph/buildGraph'
import { riskScore, riskLevel, entityRiskLevel, RISK_COLORS, daysDiff } from './risk'

export type LensId = 'structure' | 'spend' | 'risk' | 'expiry' | 'concentration' | 'data'

export interface LensDef {
  id: LensId
  label: string
  question: string
  /** Colour scale entries shown in the legend for this lens. */
  scale: { color: string; label: string }[]
}

export const LENSES: LensDef[] = [
  {
    id: 'structure', label: 'Structure', question: 'What is connected?',
    scale: [], // legend falls back to node-type list
  },
  {
    id: 'spend', label: 'Spend', question: 'Where is the money?',
    scale: [
      { color: '#0EA5E9', label: 'Top spend' },
      { color: '#0369A1', label: 'Mid' },
      { color: '#1E3A5F', label: 'Low / none' },
    ],
  },
  {
    id: 'risk', label: 'Risk', question: 'Where am I exposed?',
    scale: [
      { color: RISK_COLORS.high, label: 'High risk' },
      { color: RISK_COLORS.medium, label: 'Medium' },
      { color: RISK_COLORS.low, label: 'Low' },
    ],
  },
  {
    id: 'expiry', label: 'Expiry', question: 'What is about to lapse?',
    scale: [
      { color: '#DC2626', label: 'Expired / <30d' },
      { color: '#D97706', label: '<90d' },
      { color: '#0EA5E9', label: '<1 year' },
      { color: '#334155', label: 'No date' },
    ],
  },
  {
    id: 'concentration', label: 'Concentration', question: 'Who am I locked into?',
    scale: [
      { color: '#C026D3', label: 'Systemic supplier' },
      { color: '#7E22CE', label: 'Multi-department' },
      { color: '#3730A3', label: 'Contained' },
    ],
  },
  {
    id: 'data', label: 'Data', question: 'Can I trust this data?',
    scale: [
      { color: '#DC2626', label: 'Fields missing' },
      { color: '#D97706', label: 'Partial' },
      { color: '#475569', label: 'Complete' },
    ],
  },
]

export interface LensContext {
  maxValue: number
  totalSpend: number
  /** Node keys of the top-10 spend nodes — always labelled in the Spend lens. */
  topSpendKeys: Set<string>
}

export interface LensStyle {
  color: string
  sizeMult: number
  ring?: string
  labelAlways?: boolean
}

export function buildLensContext(nodes: GraphNode[]): LensContext {
  const maxValue = Math.max(1, ...nodes.map(n => n.value))
  const totalSpend = nodes
    .filter(n => n.type === 'contract')
    .reduce((s, n) => s + (n.contract?.annualValue ?? 0), 0)
  const topSpendKeys = new Set(
    [...nodes].sort((a, b) => b.value - a.value).slice(0, 10).map(n => n.key)
  )
  return { maxValue, totalSpend, topSpendKeys }
}

/** Linear blend between two hex colours; t clamped to 0–1. */
function mix(a: string, b: string, t: number): string {
  const k = Math.max(0, Math.min(1, t))
  const pa = [1, 3, 5].map(i => parseInt(a.slice(i, i + 2), 16))
  const pb = [1, 3, 5].map(i => parseInt(b.slice(i, i + 2), 16))
  const out = pa.map((v, i) => Math.round(v + (pb[i] - v) * k))
  return '#' + out.map(v => v.toString(16).padStart(2, '0')).join('')
}

/** Fraction of the six key fields populated on a contract. */
export function completeness(node: GraphNode): number {
  if (node.type !== 'contract' || !node.contract) {
    if (node.contracts.length === 0) return 1
    return node.contracts.reduce((s, c) => {
      let f = 0
      if (c.supplier) f++
      if (c.category) f++
      if (c.department) f++
      if (c.owner) f++
      if (c.annualValue !== undefined) f++
      if (c.endDate) f++
      return s + f / 6
    }, 0) / node.contracts.length
  }
  const c = node.contract
  let filled = 0
  if (c.supplier) filled++
  if (c.category) filled++
  if (c.department) filled++
  if (c.owner) filled++
  if (c.annualValue !== undefined) filled++
  if (c.endDate) filled++
  return filled / 6
}

/** Departments touched by this node's contracts. */
function deptCount(node: GraphNode): number {
  const d = new Set<string>()
  for (const c of node.contracts) if (c.department) d.add(c.department)
  return d.size
}

/** Worst (soonest) days-to-expiry across a node's contracts; null if no dates. */
function soonestExpiry(node: GraphNode): number | null {
  let soonest: number | null = null
  const list = node.type === 'contract' && node.contract ? [node.contract] : node.contracts
  for (const c of list) {
    if (!c.endDate) continue
    const d = daysDiff(c.endDate)
    if (soonest === null || d < soonest) soonest = d
  }
  return soonest
}

export function lensStyle(node: GraphNode, lens: LensId, ctx: LensContext): LensStyle {
  switch (lens) {
    case 'spend': {
      const t = Math.sqrt(node.value / ctx.maxValue)
      return {
        color: mix('#1E3A5F', '#38BDF8', t),
        sizeMult: 0.7 + 1.3 * t,
        labelAlways: ctx.topSpendKeys.has(node.key),
      }
    }

    case 'risk': {
      const lvl = node.type === 'contract' ? riskLevel(riskScore(node)) : entityRiskLevel(node)
      return {
        color: RISK_COLORS[lvl],
        sizeMult: lvl === 'high' ? 1.35 : 1,
        ring: lvl === 'high' ? RISK_COLORS.high : undefined,
      }
    }

    case 'expiry': {
      const d = soonestExpiry(node)
      if (d === null) return { color: '#334155', sizeMult: 0.85 }
      if (d < 30) return { color: '#DC2626', sizeMult: 1.3, ring: '#DC2626' }
      if (d < 90) return { color: '#D97706', sizeMult: 1.15, ring: '#D97706' }
      if (d < 365) return { color: '#0EA5E9', sizeMult: 1 }
      return { color: '#1E3A5F', sizeMult: 0.9 }
    }

    case 'concentration': {
      if (node.type !== 'supplier') {
        return { color: '#1E293B', sizeMult: 0.8 }
      }
      const depts = deptCount(node)
      const share = ctx.totalSpend > 0 ? node.value / ctx.totalSpend : 0
      const systemic = depts >= 3 || share >= 0.15
      const suppliersInCategory = new Set<string>()
      for (const nb of node.neighbors) {
        if (nb.type === 'category') {
          for (const c of nb.contracts) suppliersInCategory.add(c.supplier)
        }
      }
      const soleSource = suppliersInCategory.size === 1
      return {
        color: systemic ? '#C026D3' : depts >= 2 ? '#7E22CE' : '#3730A3',
        sizeMult: systemic ? 1.4 : 1,
        ring: soleSource ? '#F59E0B' : undefined,
        labelAlways: systemic,
      }
    }

    case 'data': {
      const c = completeness(node)
      if (c >= 0.99) return { color: '#475569', sizeMult: 0.85 }
      if (c >= 0.8) return { color: '#D97706', sizeMult: 1 }
      return { color: '#DC2626', sizeMult: 1.2, ring: '#DC2626' }
    }

    case 'structure':
    default: {
      const isHighRisk = node.type === 'contract' && riskLevel(riskScore(node)) === 'high'
      return {
        color: isHighRisk ? RISK_COLORS.high : NODE_COLORS[node.type] || '#E4E4E7',
        sizeMult: 1,
      }
    }
  }
}

/** Which lens best answers a given insight category. */
export function lensForCategory(category: string): LensId {
  switch (category) {
    case 'concentration': return 'concentration'
    case 'expiry':
    case 'renewal': return 'expiry'
    case 'spend': return 'spend'
    case 'data': return 'data'
    case 'stakeholder': return 'structure'
    default: return 'structure'
  }
}
