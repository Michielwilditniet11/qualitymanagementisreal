import type { GraphNode } from '../data/types'

/* ─── Risk scoring for contract nodes ─── */

export function riskScore(node: GraphNode): number {
  if (node.type !== 'contract' || !node.contract) return 0
  const c = node.contract
  let score = 0
  if (!c.owner) score += 30
  if (!c.endDate) score += 15
  if (c.endDate) {
    const days = (c.endDate.getTime() - Date.now()) / 86400000
    if (days < 0) score += 40
    else if (days <= 30) score += 25
    else if (days <= 90) score += 15
  }
  if (!c.annualValue || c.annualValue === 0) score += 10
  return Math.min(100, score)
}

export function riskLevel(score: number): 'high' | 'medium' | 'low' {
  if (score >= 40) return 'high'
  if (score >= 20) return 'medium'
  return 'low'
}

export const RISK_COLORS = { high: '#DC2626', medium: '#D97706', low: '#059669' }

export function riskReasons(node: GraphNode): string[] {
  if (node.type !== 'contract' || !node.contract) return []
  const c = node.contract
  const reasons: string[] = []
  if (!c.owner) reasons.push('Missing contract owner')
  if (!c.endDate) reasons.push('No end date defined')
  if (c.endDate) {
    const days = (c.endDate.getTime() - Date.now()) / 86400000
    if (days < 0) reasons.push(`Expired ${Math.round(-days)}d ago`)
    else if (days <= 90) reasons.push(`Expiring in ${Math.round(days)}d`)
  }
  if (!c.annualValue || c.annualValue === 0) reasons.push('No annual value')
  return reasons
}

/* ─── Format helpers ─── */

export function fmtK(v: number) {
  return v >= 1000000 ? `€${(v / 1000000).toFixed(1)}M` : v >= 1000 ? `€${Math.round(v / 1000)}K` : `€${Math.round(v)}`
}

export function fmtDate(d?: Date) {
  return d ? d.toISOString().slice(0, 10) : '—'
}

export function daysDiff(d: Date): number {
  return Math.round((d.getTime() - Date.now()) / 86400000)
}

/* ─── Entity-level roll-up risk ─── */

/** Worst risk level among a node's contracts — used to colour entity nodes. */
export function entityRiskLevel(node: GraphNode, scoreOf: (n: GraphNode) => number = riskScore): 'high' | 'medium' | 'low' {
  if (node.type === 'contract') return riskLevel(scoreOf(node))
  let worst = 0
  for (const nb of node.neighbors) {
    if (nb.type !== 'contract') continue
    const s = scoreOf(nb)
    if (s > worst) worst = s
  }
  return riskLevel(worst)
}
