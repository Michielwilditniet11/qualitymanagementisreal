import type { Contract } from '../data/types'
import { fmtK, daysDiff } from './risk'
import { entityKey, contractKey, contractIdFromKey } from '../graph/buildGraph'
import { registerCompleteness } from '../data/completeness'

export type InsightSeverity = 'critical' | 'warning' | 'info'
export type InsightCategory =
  | 'concentration' | 'expiry' | 'renewal' | 'stakeholder' | 'data' | 'spend'

export interface Insight {
  id: string
  severity: InsightSeverity
  category: InsightCategory
  title: string
  narrative: string
  valueAtRisk?: number
  nodeKeys: string[]
  action?: string
}

const SEVERITY_RANK: Record<InsightSeverity, number> = { critical: 0, warning: 1, info: 2 }

function keyOf(type: 'department' | 'category' | 'supplier' | 'owner', name: string) {
  return entityKey(type, name)
}

function sumValue(contracts: Contract[]): number {
  return contracts.reduce((s, c) => s + (c.annualValue ?? 0), 0)
}

function groupBy(contracts: Contract[], field: 'supplier' | 'category' | 'department' | 'owner') {
  const m = new Map<string, Contract[]>()
  for (const c of contracts) {
    const k = c[field]
    if (!k) continue
    if (!m.has(k)) m.set(k, [])
    m.get(k)!.push(c)
  }
  return m
}

/** Herfindahl–Hirschman index over a set of spend values (0 = fragmented, 1 = monopoly). */
export function hhi(values: number[]): number {
  const total = values.reduce((s, v) => s + v, 0)
  if (total <= 0) return 0
  return values.reduce((s, v) => s + (v / total) ** 2, 0)
}

/* ─── Detectors ─── */

/** 1. Suppliers serving many departments or a large slice of total spend. */
export function detectSystemicSuppliers(contracts: Contract[]): Insight[] {
  const total = sumValue(contracts)
  const out: Insight[] = []
  for (const [supplier, cs] of groupBy(contracts, 'supplier')) {
    const spend = sumValue(cs)
    const depts = new Set(cs.map(c => c.department).filter(Boolean))
    const share = total > 0 ? spend / total : 0
    if (depts.size < 3 && share < 0.15) continue
    out.push({
      id: `systemic-supplier:${supplier}`,
      severity: share >= 0.25 || depts.size >= 5 ? 'critical' : 'warning',
      category: 'concentration',
      title: `${supplier} is a systemic dependency`,
      narrative: `${supplier} holds ${cs.length} contract${cs.length === 1 ? '' : 's'} worth ${fmtK(spend)} (${Math.round(share * 100)}% of total spend) across ${depts.size} department${depts.size === 1 ? '' : 's'}.`,
      valueAtRisk: spend,
      nodeKeys: [keyOf('supplier', supplier), ...cs.map(contractKey)],
      action: 'Review continuity plans and consider a secondary source.',
    })
  }
  return out
}

/** 2. Categories served by exactly one supplier. */
export function detectSingleSourceCategories(contracts: Contract[]): Insight[] {
  const out: Insight[] = []
  const byCat = groupBy(contracts, 'category')
  const spends = [...byCat.values()].map(sumValue).sort((a, b) => a - b)
  const median = spends.length ? spends[Math.floor(spends.length / 2)] : 0
  for (const [category, cs] of byCat) {
    const suppliers = new Set(cs.map(c => c.supplier).filter(Boolean))
    if (suppliers.size !== 1) continue
    const spend = sumValue(cs)
    if (cs.length <= 1 && spend < median) continue
    const supplier = [...suppliers][0]
    out.push({
      id: `single-source:${category}`,
      severity: spend >= median ? 'warning' : 'info',
      category: 'concentration',
      title: `${category} is single-sourced`,
      narrative: `All ${cs.length} contract${cs.length === 1 ? '' : 's'} in ${category} (${fmtK(spend)}) sit with ${supplier}. There is no alternative supplier in this category.`,
      valueAtRisk: spend,
      nodeKeys: [keyOf('category', category), keyOf('supplier', supplier)],
      action: 'Run a market test to establish a fallback supplier.',
    })
  }
  return out
}

/** 3. Departments with a large share of spend expiring inside 90 days. */
export function detectExpiryCliffs(contracts: Contract[]): Insight[] {
  const out: Insight[] = []
  for (const [department, cs] of groupBy(contracts, 'department')) {
    const total = sumValue(cs)
    if (total <= 0) continue
    const expiring = cs.filter(c => c.endDate && daysDiff(c.endDate) > 0 && daysDiff(c.endDate) <= 90)
    if (expiring.length === 0) continue
    const atRisk = sumValue(expiring)
    const share = atRisk / total
    if (share < 0.3) continue
    out.push({
      id: `expiry-cliff:${department}`,
      severity: share >= 0.5 ? 'critical' : 'warning',
      category: 'expiry',
      title: `${department} faces an expiry cliff`,
      narrative: `${Math.round(share * 100)}% of ${department}'s spend (${fmtK(atRisk)} across ${expiring.length} contract${expiring.length === 1 ? '' : 's'}) expires within 90 days.`,
      valueAtRisk: atRisk,
      nodeKeys: [keyOf('department', department), ...expiring.map(contractKey)],
      action: 'Start renewal negotiations now to preserve leverage.',
    })
  }
  return out
}

/** 4. Auto-renewing contracts whose notice deadline is imminent. */
export function detectSilentRenewals(contracts: Contract[]): Insight[] {
  const at = contracts.filter(c => {
    if (!c.autoRenew || !c.endDate || !c.noticePeriodDays) return false
    const daysToNotice = daysDiff(c.endDate) - c.noticePeriodDays
    return daysToNotice <= 30 && daysDiff(c.endDate) > 0
  })
  if (at.length === 0) return []
  const spend = sumValue(at)
  return [{
    id: 'silent-renewal',
    severity: 'critical',
    category: 'renewal',
    title: `${at.length} contract${at.length === 1 ? '' : 's'} about to auto-renew`,
    narrative: `${fmtK(spend)} of spend will roll over automatically unless notice is served within 30 days. Once the notice window closes the term is locked for another cycle.`,
    valueAtRisk: spend,
    nodeKeys: at.map(contractKey),
    action: 'Decide renew-or-exit before the notice deadline.',
  }]
}

/** 5. Owners carrying a disproportionate share of the portfolio. */
export function detectOwnerOverload(contracts: Contract[]): Insight[] {
  const total = sumValue(contracts)
  const owned = contracts.filter(c => c.owner)
  const out: Insight[] = []
  for (const [owner, cs] of groupBy(owned, 'owner')) {
    const spend = sumValue(cs)
    const share = total > 0 ? spend / total : 0
    const overloaded = cs.length >= 10 || share >= 0.2
    if (!overloaded) continue
    const depts = new Set(cs.map(c => c.department).filter(Boolean))
    out.push({
      id: `owner-overload:${owner}`,
      severity: share >= 0.35 || cs.length >= 20 ? 'critical' : 'warning',
      category: 'stakeholder',
      title: `${owner} is a key-person risk`,
      narrative: `${owner} owns ${cs.length} contracts worth ${fmtK(spend)} (${Math.round(share * 100)}% of the portfolio) across ${depts.size} department${depts.size === 1 ? '' : 's'}.`,
      valueAtRisk: spend,
      nodeKeys: [keyOf('owner', owner), ...cs.map(contractKey)],
      action: 'Spread ownership or document a deputy for continuity.',
    })
  }
  return out
}

/** 6. Contracts with no accountable owner, rolled up per department. */
export function detectOrphanSpend(contracts: Contract[]): Insight[] {
  const orphans = contracts.filter(c => !c.owner)
  if (orphans.length === 0) return []
  const spend = sumValue(orphans)
  const byDept = groupBy(orphans, 'department')
  const worst = [...byDept.entries()].sort((a, b) => sumValue(b[1]) - sumValue(a[1]))[0]
  const share = sumValue(contracts) > 0 ? spend / sumValue(contracts) : 0
  return [{
    id: 'orphan-spend',
    severity: share >= 0.15 ? 'critical' : 'warning',
    category: 'stakeholder',
    title: `${orphans.length} contract${orphans.length === 1 ? '' : 's'} have no owner`,
    narrative: `${fmtK(spend)} of spend (${Math.round(share * 100)}%) has nobody accountable${worst ? `, concentrated in ${worst[0]}` : ''}. Unowned contracts renew and lapse unnoticed.`,
    valueAtRisk: spend,
    nodeKeys: orphans.map(contractKey),
    action: 'Assign an owner to every contract above the materiality threshold.',
  }]
}

/** 7. Long tail of tiny suppliers — consolidation opportunity. */
export function detectTailSpend(contracts: Contract[]): Insight[] {
  const total = sumValue(contracts)
  if (total <= 0) return []
  const bySupplier = groupBy(contracts, 'supplier')
  if (bySupplier.size < 5) return []
  const tail = [...bySupplier.entries()].filter(([, cs]) => sumValue(cs) / total < 0.01)
  if (tail.length < 5) return []
  const tailSpend = tail.reduce((s, [, cs]) => s + sumValue(cs), 0)
  return [{
    id: 'tail-spend',
    severity: 'info',
    category: 'spend',
    title: `${tail.length} tail suppliers to consolidate`,
    narrative: `${tail.length} of ${bySupplier.size} suppliers each account for under 1% of spend, together ${fmtK(tailSpend)}. Each one carries the same onboarding, compliance and payment overhead as a strategic supplier.`,
    valueAtRisk: tailSpend,
    nodeKeys: tail.map(([s]) => keyOf('supplier', s)),
    action: 'Consolidate into framework agreements to cut administrative cost.',
  }]
}

/** 8. Categories with a highly concentrated supplier base (HHI). */
export function detectConcentration(contracts: Contract[]): Insight[] {
  const out: Insight[] = []
  for (const [category, cs] of groupBy(contracts, 'category')) {
    const bySupplier = groupBy(cs, 'supplier')
    if (bySupplier.size < 2) continue // single-source is reported separately
    const index = hhi([...bySupplier.values()].map(sumValue))
    if (index <= 0.5) continue
    const spend = sumValue(cs)
    const top = [...bySupplier.entries()].sort((a, b) => sumValue(b[1]) - sumValue(a[1]))[0]
    out.push({
      id: `concentration:${category}`,
      severity: index >= 0.75 ? 'warning' : 'info',
      category: 'concentration',
      title: `${category} spend is concentrated`,
      narrative: `${category} has ${bySupplier.size} suppliers but an HHI of ${index.toFixed(2)} — ${top[0]} alone takes ${Math.round((sumValue(top[1]) / spend) * 100)}% of ${fmtK(spend)}.`,
      valueAtRisk: spend,
      nodeKeys: [keyOf('category', category), keyOf('supplier', top[0])],
      action: 'Rebalance volume across the existing supplier base.',
    })
  }
  return out
}

/** 9. Contracts past their end date but still in the register. */
export function detectExpiredActive(contracts: Contract[]): Insight[] {
  const expired = contracts.filter(c => c.endDate && daysDiff(c.endDate) < 0)
  if (expired.length === 0) return []
  const spend = sumValue(expired)
  return [{
    id: 'expired-active',
    severity: 'critical',
    category: 'expiry',
    title: `${expired.length} contract${expired.length === 1 ? '' : 's'} already expired`,
    narrative: `${fmtK(spend)} of spend sits on contracts past their end date. Either the register is stale or the organisation is buying without a valid agreement.`,
    valueAtRisk: spend,
    nodeKeys: expired.map(contractKey),
    action: 'Confirm whether these are still live and close or renew them.',
  }]
}

/** 10. Field completeness — how much the numbers above can be trusted. */
export function detectDataConfidence(contracts: Contract[]): Insight[] {
  if (contracts.length === 0) return []
  const pct = Math.round(registerCompleteness(contracts) * 100)
  if (pct >= 90) return []
  const missingValue = contracts.filter(c => c.annualValue === undefined)
  return [{
    id: 'data-confidence',
    severity: pct < 70 ? 'warning' : 'info',
    category: 'data',
    title: `Data completeness is ${pct}%`,
    narrative: `${100 - pct}% of key fields are blank across ${contracts.length} contracts${missingValue.length ? `, including ${missingValue.length} with no annual value` : ''}. Spend and risk figures understate reality by an unknown margin.`,
    nodeKeys: missingValue.map(contractKey),
    action: 'Close the gaps before using these figures in board reporting.',
  }]
}

/* ─── Engine ─── */

export function generateInsights(contracts: Contract[]): Insight[] {
  if (contracts.length === 0) return []
  const all = [
    ...detectSystemicSuppliers(contracts),
    ...detectSingleSourceCategories(contracts),
    ...detectExpiryCliffs(contracts),
    ...detectSilentRenewals(contracts),
    ...detectOwnerOverload(contracts),
    ...detectOrphanSpend(contracts),
    ...detectTailSpend(contracts),
    ...detectConcentration(contracts),
    ...detectExpiredActive(contracts),
    ...detectDataConfidence(contracts),
  ]
  return all.sort((a, b) => {
    const s = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]
    if (s !== 0) return s
    return (b.valueAtRisk ?? 0) - (a.valueAtRisk ?? 0)
  })
}

/**
 * Total exposure flagged by critical findings. Counts each contract once even
 * when several findings flag it, so the headline figure cannot exceed spend.
 */
export function totalValueAtRisk(insights: Insight[], contracts: Contract[]): number {
  const flagged = new Set<string>()
  for (const i of insights) {
    if (i.severity !== 'critical') continue
    for (const k of i.nodeKeys) {
      const id = contractIdFromKey(k)
      if (id) flagged.add(id)
    }
  }
  if (flagged.size === 0) return 0
  const counted = new Set<string>()
  let total = 0
  for (const c of contracts) {
    if (!flagged.has(c.id) || counted.has(c.id)) continue
    counted.add(c.id)
    total += c.annualValue ?? 0
  }
  return total
}
