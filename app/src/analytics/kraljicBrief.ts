import type { Contract, EntityStats } from '../data/types'
import { fmtK, riskScore, riskLevel } from './risk'
import { supplierLeverage, negotiationCalendar, type SupplierLeverage, type ActionItem } from './levers'
import { savingsOpportunities, type Opportunity } from './savings'
import { findGaps, type Gap } from './gaps'
import { entityKey, contractIdFromKey } from '../graph/buildGraph'

/** True when a node key names a contract belonging to this category. */
function hasOwnContract(nodeKey: string, ownIds: Set<string>): boolean {
  const id = contractIdFromKey(nodeKey)
  return id !== null && ownIds.has(id)
}

export type Quadrant = 'non-critical' | 'leverage' | 'bottleneck' | 'strategic'

export const QUADRANTS: {
  id: Quadrant; label: string; x: 0 | 1; y: 0 | 1; color: string; stance: string
}[] = [
  { id: 'non-critical', label: 'Non-critical', x: 0, y: 0, color: '#5B6B84', stance: 'Simplify and automate — the goal is less handling cost, not a better price.' },
  { id: 'leverage', label: 'Leverage', x: 1, y: 0, color: '#2FD3E6', stance: 'Use the volume — competition exists, so make suppliers compete for it.' },
  { id: 'bottleneck', label: 'Bottleneck', x: 0, y: 1, color: '#FFB020', stance: 'Secure supply — the money is small but the exposure is not.' },
  { id: 'strategic', label: 'Strategic', x: 1, y: 1, color: '#22C55E', stance: 'Partner deliberately — big spend and hard to replace means manage the relationship, not just the price.' },
]

export function quadrantOf(spendImpact: number, supplyRisk: number): Quadrant {
  if (spendImpact >= 0.5 && supplyRisk >= 0.5) return 'strategic'
  if (spendImpact >= 0.5) return 'leverage'
  if (supplyRisk >= 0.5) return 'bottleneck'
  return 'non-critical'
}

export interface CategoryBrief {
  category: string
  spend: number
  contractCount: number
  quadrant: Quadrant
  adjusted: boolean
  /** Worst contract risk level in the category. */
  riskLevel: 'high' | 'medium' | 'low'
  singleSource: boolean
  suppliers: SupplierLeverage[]
  decisions: ActionItem[]
  gaps: Gap[]
  opportunities: Opportunity[]
  /** The quadrant stance rewritten with this category's real names and dates. */
  playbook: string[]
}

/**
 * Everything the tool already knows about one category, gathered in one place.
 * This module performs no analysis of its own — every field is engine output,
 * so the brief can never disagree with the screen it came from.
 */
export function categoryBrief(
  category: string,
  contracts: Contract[],
  stat: EntityStats,
  quadrant: Quadrant,
  adjusted: boolean,
  now = new Date()
): CategoryBrief {
  const own = contracts.filter(c => c.category === category)
  const ownIds = new Set(own.map(c => c.id))
  const supplierNames = new Set(own.map(c => c.supplier).filter(Boolean))

  const suppliers = supplierLeverage(contracts, now).filter(s => supplierNames.has(s.supplier))
  const decisions = negotiationCalendar(contracts, now).filter(i => ownIds.has(i.contractId))
  // Attribute by the nodes a gap actually names, never by substring on its id:
  // category "Telecom" would otherwise claim `gap:single-point:Telecom NL`,
  // a gap about an unrelated supplier that merely starts with the same word.
  const gaps = findGaps(contracts).filter(g =>
    g.nodeKeys.some(k => k === entityKey('category', category) ||
      hasOwnContract(k, ownIds)))
  const opportunities = savingsOpportunities(contracts, now)
    .filter(o => o.contractIds.some(id => ownIds.has(id)))

  let worst = 0
  for (const c of own) {
    const s = riskScore({
      key: c.id, type: 'contract', name: c.name, x: 0, y: 0, vx: 0, vy: 0,
      value: c.annualValue ?? 0, count: 1, contracts: [c], neighbors: new Set(), contract: c,
    })
    if (s > worst) worst = s
  }

  return {
    category,
    spend: stat.totalSpend,
    contractCount: stat.contractCount,
    quadrant,
    adjusted,
    riskLevel: riskLevel(worst),
    singleSource: supplierNames.size === 1,
    suppliers,
    decisions,
    gaps,
    opportunities,
    playbook: buildPlaybook(category, quadrant, suppliers, decisions, opportunities, supplierNames.size),
  }
}

/**
 * The quadrant's stance, instantiated with the names, figures and dates this
 * category actually has — a tactic you can act on rather than a textbook line.
 */
export function buildPlaybook(
  category: string,
  quadrant: Quadrant,
  suppliers: SupplierLeverage[],
  decisions: ActionItem[],
  opportunities: Opportunity[],
  supplierCount: number
): string[] {
  const out: string[] = []
  const soonest = decisions.filter(d => !d.missed).sort((a, b) => a.daysLeft - b.daysLeft)[0]
  const names = suppliers.map(s => s.supplier)
  const top = suppliers[0]

  switch (quadrant) {
    case 'leverage': {
      out.push(supplierCount > 1
        ? `Aggregate volume across ${names.slice(0, 3).join(' and ')} — competition already exists here, so run them against each other.`
        : `${names[0] ?? 'The incumbent'} holds all of ${category}. Qualify a second supplier so the volume has somewhere else to go.`)
      const bundling = opportunities.find(o => o.kind === 'category-bundling')
      if (bundling) out.push(`Bundling is worth an estimated ${fmtK(bundling.low)}–${fmtK(bundling.high)} (${bundling.assumption}).`)
      break
    }
    case 'strategic': {
      if (top) out.push(`${top.supplier} carries ${fmtK(top.spend)} across ${top.departments.length} department${top.departments.length === 1 ? '' : 's'} — treat this as a relationship to manage, not a price to squeeze.`)
      out.push(supplierCount === 1
        ? `Single-sourced, so the first move is reducing switching cost: dual-source, or contract for continuity guarantees.`
        : `Consolidate onto the strongest partner and contract for joint improvement rather than annual haggling.`)
      break
    }
    case 'bottleneck': {
      out.push(`Small spend, hard to replace. Secure continuity first — a longer term or a qualified alternative is worth more here than a discount.`)
      if (supplierCount === 1 && names[0]) out.push(`${names[0]} is the only source; a second qualified supplier is the whole strategy.`)
      break
    }
    case 'non-critical':
    default: {
      out.push(`Low value and easy to replace. Reduce handling cost — catalogue it, consolidate the suppliers, and stop spending negotiation time here.`)
      const tail = opportunities.find(o => o.kind === 'tail-consolidation')
      if (tail) out.push(`Tail consolidation across the portfolio is worth an estimated ${fmtK(tail.low)}–${fmtK(tail.high)}.`)
      break
    }
  }

  if (soonest) {
    out.push(`Act before ${soonest.actBy.toISOString().slice(0, 10)} — ${soonest.contract} (${fmtK(soonest.value)}) reaches its decision date in ${soonest.daysLeft} days.`)
  } else if (decisions.some(d => d.missed)) {
    out.push(`Every window in ${category} has already closed — diarise the next one now.`)
  }

  return out
}

/**
 * How hard this category would be to re-source, 0–1.
 *
 * The naive blend (concentration + a single-source bonus + a supplier-count
 * term) saturated at 1 for every one-supplier category, pinning most of the
 * portfolio to the top edge and destroying the axis. This spreads the middle:
 * supplier count dominates, concentration modulates, and the notice burden
 * captures how long an exit actually takes.
 */
export function supplyRiskOf(stat: EntityStats): number {
  const suppliers = new Set(stat.contracts.map(c => c.supplier).filter(Boolean)).size || 1
  // 1 supplier → 1.0, 2 → 0.5, 3 → 0.33, 4+ → tapering.
  const scarcity = 1 / suppliers
  // How much of the category one supplier already holds.
  const concentration = stat.supplierConcentration
  // Long notice periods mean a slow exit even when alternatives exist.
  const notices = stat.contracts.map(c => c.noticePeriodDays ?? 0).filter(n => n > 0)
  const avgNotice = notices.length ? notices.reduce((s, n) => s + n, 0) / notices.length : 0
  const noticeBurden = Math.min(1, avgNotice / 180)

  return Math.min(1, 0.55 * scarcity + 0.25 * concentration + 0.20 * noticeBurden)
}
