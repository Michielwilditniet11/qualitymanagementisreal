import type { Contract, GraphNode } from '../data/types'
import { fmtK, daysDiff } from './risk'
import { entityKey, contractKey, contractIdFromKey } from '../graph/buildGraph'

export type GapKind =
  | 'no-owner' | 'no-competition' | 'single-point' | 'missing-data' | 'expiring-unplanned'

export interface Gap {
  id: string
  kind: GapKind
  title: string
  detail: string
  /** Spend exposed by the absence. */
  exposure: number
  /**
   * How many contracts the gap covers. Held explicitly rather than inferred
   * from nodeKeys, which is a graph concern: a caller with no graph would
   * otherwise read a count of zero beside a real exposure figure.
   */
  contractCount: number
  /** Real nodes involved. */
  nodeKeys: string[]
  /**
   * A node that does not exist but should — rendered as a hollow phantom
   * anchored to `anchorKey`.
   */
  phantom?: { label: string; anchorKey: string }
}

/** A category with fewer suppliers than this has no competitive tension. */
export const MIN_SUPPLIERS_FOR_COMPETITION = 2
/** Data holes below this share of spend are noise, not a structural gap. */
export const MISSING_DATA_SHARE = 0.05

const GAP_RANK: Record<GapKind, number> = {
  'no-owner': 0,
  'single-point': 1,
  'no-competition': 2,
  'expiring-unplanned': 3,
  'missing-data': 4,
}

function sumValue(cs: Contract[]): number {
  return cs.reduce((s, c) => s + (c.annualValue ?? 0), 0)
}

function key(type: 'department' | 'category' | 'supplier' | 'owner', name: string) { return entityKey(type, name) }

/**
 * Suppliers whose removal would disconnect spend: they are the only supplier
 * serving some department in some category. An articulation point in the
 * sourcing structure, not merely a big supplier.
 */
export function singlePointSuppliers(contracts: Contract[]): Map<string, Contract[]> {
  // (department, category) → suppliers serving it
  const cell = new Map<string, Set<string>>()
  for (const c of contracts) {
    if (!c.department || !c.category) continue
    const k = `${c.department}|${c.category}`
    if (!cell.has(k)) cell.set(k, new Set())
    cell.get(k)!.add(c.supplier)
  }
  const soloCells = new Set([...cell.entries()].filter(([, s]) => s.size === 1).map(([k]) => k))

  const out = new Map<string, Contract[]>()
  for (const c of contracts) {
    if (!c.department || !c.category) continue
    if (!soloCells.has(`${c.department}|${c.category}`)) continue
    if (!out.has(c.supplier)) out.set(c.supplier, [])
    out.get(c.supplier)!.push(c)
  }
  return out
}

/**
 * What is absent from the portfolio's structure. Unlike risk findings, these
 * describe things that should exist and do not — the shapes a network view is
 * uniquely able to show.
 */
export function findGaps(contracts: Contract[], nodes: GraphNode[] = []): Gap[] {
  const gaps: Gap[] = []
  if (contracts.length === 0) return gaps
  // `nodes` narrows gaps to what the graph can actually show. Callers with no
  // graph (the Calendar, the Kraljic brief) pass none, and filtering against
  // an empty set would silently strip every key — leaving a gap that knows
  // its own exposure but claims to touch nothing. No nodes means no filter.
  const known = nodes.length > 0 ? new Set(nodes.map(n => n.key)) : null
  const inGraph = (k: string) => known === null || known.has(k)
  const total = sumValue(contracts)

  /* Contracts with nobody accountable. */
  const orphans = contracts.filter(c => !c.owner)
  if (orphans.length > 0) {
    const byDept = new Map<string, Contract[]>()
    for (const c of orphans) {
      const d = c.department || '(unassigned)'
      if (!byDept.has(d)) byDept.set(d, [])
      byDept.get(d)!.push(c)
    }
    const worst = [...byDept.entries()].sort((a, b) => sumValue(b[1]) - sumValue(a[1]))[0]
    gaps.push({
      id: 'gap:no-owner',
      kind: 'no-owner',
      title: `${orphans.length} contract${orphans.length === 1 ? '' : 's'} have no owner`,
      detail: `${fmtK(sumValue(orphans))} answers to nobody${worst ? `, mostly in ${worst[0]}` : ''}. Nothing in the register will chase these renewals.`,
      exposure: sumValue(orphans),
      contractCount: orphans.length,
      nodeKeys: orphans.map(contractKey).filter(inGraph),
      phantom: worst ? { label: 'No owner', anchorKey: key('department', worst[0]) } : undefined,
    })
  }

  /* Categories with no alternative supplier. */
  const byCategory = new Map<string, Contract[]>()
  for (const c of contracts) {
    if (!c.category) continue
    if (!byCategory.has(c.category)) byCategory.set(c.category, [])
    byCategory.get(c.category)!.push(c)
  }
  for (const [category, cs] of byCategory) {
    const suppliers = new Set(cs.map(c => c.supplier).filter(Boolean))
    if (suppliers.size >= MIN_SUPPLIERS_FOR_COMPETITION) continue
    const spend = sumValue(cs)
    if (spend <= 0) continue
    gaps.push({
      id: `gap:no-competition:${category}`,
      kind: 'no-competition',
      title: `${category} has no second supplier`,
      detail: `${fmtK(spend)} sits with ${[...suppliers][0]} and nobody else. There is no alternative to price against and none to fall back on.`,
      exposure: spend,
      contractCount: cs.length,
      nodeKeys: [key('category', category), key('supplier', [...suppliers][0])].filter(inGraph),
      phantom: { label: '2nd supplier?', anchorKey: key('category', category) },
    })
  }

  /* Suppliers holding a department-category cell alone. */
  for (const [supplier, cs] of singlePointSuppliers(contracts)) {
    const cells = new Set(cs.map(c => `${c.department} · ${c.category}`))
    const spend = sumValue(cs)
    // Only material single points are worth a gap entry.
    if (total > 0 && spend / total < 0.02) continue
    gaps.push({
      id: `gap:single-point:${supplier}`,
      kind: 'single-point',
      title: `${supplier} is a single point of failure`,
      detail: `${supplier} is the only supplier serving ${[...cells].slice(0, 3).join(', ')}${cells.size > 3 ? ` and ${cells.size - 3} more` : ''}. Losing them stops ${fmtK(spend)} of activity with no substitute in the register.`,
      exposure: spend,
      contractCount: cs.length,
      nodeKeys: [key('supplier', supplier), ...cs.map(contractKey)].filter(inGraph),
    })
  }

  /* Spend expiring soon with no successor lined up. */
  const expiring = contracts.filter(c =>
    c.endDate && daysDiff(c.endDate) > 0 && daysDiff(c.endDate) <= 90)
  const unplanned = expiring.filter(c => {
    // A successor is a contract in the same category and department running later.
    return !contracts.some(o =>
      o.id !== c.id &&
      o.category === c.category && o.department === c.department &&
      o.endDate && c.endDate && o.endDate.getTime() > c.endDate.getTime())
  })
  if (unplanned.length > 0) {
    gaps.push({
      id: 'gap:expiring-unplanned',
      kind: 'expiring-unplanned',
      title: `${unplanned.length} expiring contract${unplanned.length === 1 ? '' : 's'} with no successor`,
      detail: `${fmtK(sumValue(unplanned))} lapses within 90 days and nothing in the register covers the same category and department afterwards.`,
      exposure: sumValue(unplanned),
      contractCount: unplanned.length,
      nodeKeys: unplanned.map(contractKey).filter(inGraph),
    })
  }

  /* Holes large enough to distort every other number. */
  const noValue = contracts.filter(c => c.annualValue === undefined)
  const noEnd = contracts.filter(c => !c.endDate)
  const holes = [...new Set([...noValue, ...noEnd])]
  if (holes.length > 0 && holes.length / contracts.length >= MISSING_DATA_SHARE) {
    gaps.push({
      id: 'gap:missing-data',
      kind: 'missing-data',
      title: `${holes.length} contract${holes.length === 1 ? '' : 's'} missing value or end date`,
      detail: `${noValue.length} without a value and ${noEnd.length} without an end date. Every total on every screen understates reality by an unknown margin.`,
      exposure: sumValue(holes),
      contractCount: holes.length,
      nodeKeys: holes.map(contractKey).filter(inGraph),
    })
  }

  return gaps.sort((a, b) =>
    GAP_RANK[a.kind] - GAP_RANK[b.kind] || b.exposure - a.exposure)
}

/** Total spend touched by structural gaps, each contract counted once. */
export function gapExposure(gaps: Gap[], contracts: Contract[]): number {
  const flagged = new Set<string>()
  for (const g of gaps) {
    for (const k of g.nodeKeys) {
      const id = contractIdFromKey(k)
      if (id) flagged.add(id)
    }
  }
  return contracts
    .filter(c => flagged.has(c.id))
    .reduce((s, c) => s + (c.annualValue ?? 0), 0)
}
