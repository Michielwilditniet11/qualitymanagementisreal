import type { Contract } from '../data/types'
import { fmtK } from './risk'
import { noticeDeadline, paymentSpreads, type PaymentSpread } from './terms'

const DAY = 86400000

/* ─── Heuristic constants (every estimate names the one it used) ─── */

/** Cost of capital used to price released working capital. */
export const WACC = 0.08
/** Consolidating scattered tail spend into frameworks. */
export const TAIL_SAVING = { low: 0.05, high: 0.15 }
/** Bundling volume onto a lead supplier in a fragmented category. */
export const BUNDLING_SAVING = { low: 0.05, high: 0.10 }
/** Renegotiating instead of letting a term roll over. */
export const RENEGOTIATION_SAVING = { low: 0.02, high: 0.05 }

/** A renewal window this far out is actionable leverage. */
export const WINDOW_HORIZON_DAYS = 180
/** End dates further apart than this are worth co-terming. */
export const COTERM_SPREAD_DAYS = 90

export type LeverKind =
  | 'renewal-window' | 'consolidation' | 'co-terming' | 'competition'
  | 'payment-terms' | 'build-alternative'

export interface Estimate {
  low: number
  high: number
  assumption: string
}

export interface Lever {
  kind: LeverKind
  title: string
  detail: string
  estimate?: Estimate
}

export interface SupplierLeverage {
  supplier: string
  spend: number
  contractCount: number
  departments: string[]
  categories: string[]
  /** Our position against this supplier, not theirs against us. */
  position: 'strong' | 'balanced' | 'weak'
  levers: Lever[]
  nextWindow?: { contract: string; actBy: Date; daysLeft: number; value: number }
  leverageScore: number
}

function sumValue(cs: Contract[]): number {
  return cs.reduce((s, c) => s + (c.annualValue ?? 0), 0)
}

function groupBySupplier(contracts: Contract[]): Map<string, Contract[]> {
  const m = new Map<string, Contract[]>()
  for (const c of contracts) {
    if (!c.supplier) continue
    if (!m.has(c.supplier)) m.set(c.supplier, [])
    m.get(c.supplier)!.push(c)
  }
  return m
}

/** Suppliers active in each category, for competitive-tension checks. */
function suppliersByCategory(contracts: Contract[]): Map<string, Set<string>> {
  const m = new Map<string, Set<string>>()
  for (const c of contracts) {
    if (!c.category) continue
    if (!m.has(c.category)) m.set(c.category, new Set())
    m.get(c.category)!.add(c.supplier)
  }
  return m
}

/**
 * What we can actually push on with each supplier, and when that push has to
 * happen. Sorted by leverage score so the biggest opportunities lead.
 */
export function supplierLeverage(contracts: Contract[], now = new Date()): SupplierLeverage[] {
  const byCategory = suppliersByCategory(contracts)
  const spreads = new Map<string, PaymentSpread>(
    paymentSpreads(contracts).map(s => [s.supplier, s])
  )
  const portfolioSpend = sumValue(contracts)
  const out: SupplierLeverage[] = []

  for (const [supplier, cs] of groupBySupplier(contracts)) {
    const spend = sumValue(cs)
    const departments = [...new Set(cs.map(c => c.department).filter(Boolean))].sort()
    const categories = [...new Set(cs.map(c => c.category).filter(Boolean))].sort()
    const levers: Lever[] = []

    // Which of this supplier's categories have a credible alternative already.
    const rivals = new Set<string>()
    for (const cat of categories) {
      for (const s of byCategory.get(cat) ?? []) if (s !== supplier) rivals.add(s)
    }
    const contested = categories.filter(cat => (byCategory.get(cat)?.size ?? 0) > 1)
    const soleSourceCategories = categories.filter(cat => (byCategory.get(cat)?.size ?? 0) === 1)

    /* Renewal window — the anchor lever. */
    const windows = cs
      .map(c => ({ c, deadline: noticeDeadline(c) }))
      .filter((x): x is { c: Contract; deadline: Date } => x.deadline !== null)
      .map(x => ({ ...x, daysLeft: Math.round((x.deadline.getTime() - now.getTime()) / DAY) }))
      .filter(x => x.daysLeft >= 0 && x.daysLeft <= WINDOW_HORIZON_DAYS)
      .sort((a, b) => (b.c.annualValue ?? 0) - (a.c.annualValue ?? 0))

    const anchor = windows[0]
    let nextWindow: SupplierLeverage['nextWindow']
    if (anchor) {
      nextWindow = {
        contract: anchor.c.name,
        actBy: anchor.deadline,
        daysLeft: anchor.daysLeft,
        value: anchor.c.annualValue ?? 0,
      }
      levers.push({
        kind: 'renewal-window',
        title: `Renewal window open for ${anchor.daysLeft} more days`,
        detail: `${anchor.c.name} (${fmtK(anchor.c.annualValue ?? 0)}) must be noticed by ${anchor.deadline.toISOString().slice(0, 10)}. Leverage peaks before that date and collapses after it.`,
        estimate: {
          low: (anchor.c.annualValue ?? 0) * RENEGOTIATION_SAVING.low,
          high: (anchor.c.annualValue ?? 0) * RENEGOTIATION_SAVING.high,
          assumption: `assumes renegotiation recovers ${Math.round(RENEGOTIATION_SAVING.low * 100)}–${Math.round(RENEGOTIATION_SAVING.high * 100)}% versus rolling over`,
        },
      })
    }

    /* Consolidation across multiple agreements. */
    if (cs.length >= 2) {
      const sorted = [...cs].sort((a, b) => (b.annualValue ?? 0) - (a.annualValue ?? 0))
      const movable = sumValue(sorted.slice(1))
      levers.push({
        kind: 'consolidation',
        title: `${cs.length} separate agreements to bundle`,
        detail: `${fmtK(spend)} sits across ${cs.length} contracts${departments.length > 1 ? ` in ${departments.length} departments` : ''}, each negotiated alone. One agreement negotiates the whole volume.`,
        estimate: {
          low: movable * BUNDLING_SAVING.low,
          high: movable * BUNDLING_SAVING.high,
          assumption: `assumes ${Math.round(BUNDLING_SAVING.low * 100)}–${Math.round(BUNDLING_SAVING.high * 100)}% on the ${fmtK(movable)} outside the largest contract`,
        },
      })
    }

    /* Co-terming scattered end dates. */
    const ends = cs.map(c => c.endDate).filter((d): d is Date => Boolean(d))
    if (ends.length >= 2) {
      const min = Math.min(...ends.map(d => d.getTime()))
      const max = Math.max(...ends.map(d => d.getTime()))
      const spreadDays = Math.round((max - min) / DAY)
      if (spreadDays > COTERM_SPREAD_DAYS) {
        levers.push({
          kind: 'co-terming',
          title: `End dates ${spreadDays} days apart`,
          detail: `Aligning the shorter contracts to ${new Date(max).toISOString().slice(0, 10)} turns ${cs.length} small renewals into one negotiation with the full volume behind it.`,
        })
      }
    }

    /* Competitive tension, or its absence. */
    if (contested.length > 0) {
      levers.push({
        kind: 'competition',
        title: `${rivals.size} alternative supplier${rivals.size === 1 ? '' : 's'} already in play`,
        detail: `${supplier} can be benchmarked against ${[...rivals].slice(0, 3).join(', ')}${rivals.size > 3 ? ` and ${rivals.size - 3} more` : ''} in ${contested.join(', ')}.`,
      })
    }
    if (soleSourceCategories.length > 0) {
      levers.push({
        kind: 'build-alternative',
        title: `Sole source in ${soleSourceCategories.join(', ')}`,
        detail: `There is no alternative to point at, so price pressure has nothing behind it. The lever here is qualifying a second supplier before the next renewal, not the renewal itself.`,
      })
    }

    /* Payment terms this supplier already accepts elsewhere. */
    const spread = spreads.get(supplier)
    if (spread) {
      levers.push({
        kind: 'payment-terms',
        title: `Harmonise to ${spread.best}-day terms`,
        detail: `${supplier} already accepts ${spread.best} days on part of this spend while ${fmtK(spread.spendOnWorseTerms)} still pays in ${spread.worst}. Levelling up costs no negotiating capital.`,
        estimate: {
          low: spread.workingCapital * WACC,
          high: spread.workingCapital * WACC,
          assumption: `financing value of ${fmtK(spread.workingCapital)} released, at ${Math.round(WACC * 100)}% WACC`,
        },
      })
    }

    /* Position: an open window plus a credible alternative is strength. */
    const hasWindow = Boolean(anchor)
    const hasAlternative = contested.length > 0
    const position: SupplierLeverage['position'] =
      soleSourceCategories.length > 0 && !hasAlternative ? 'weak'
        : hasWindow && hasAlternative ? 'strong'
          : 'balanced'

    const spendShare = portfolioSpend > 0 ? spend / portfolioSpend : 0
    const leverageScore = Math.round(100 * Math.min(1,
      0.45 * spendShare * 3 +
      0.30 * (hasWindow ? 1 : 0) +
      0.15 * (hasAlternative ? 1 : 0) +
      0.10 * Math.min(1, cs.length / 4)
    ))

    out.push({
      supplier, spend, contractCount: cs.length, departments, categories,
      position, levers, nextWindow, leverageScore,
    })
  }

  return out.sort((a, b) => b.leverageScore - a.leverageScore || b.spend - a.spend)
}

/* ─── Portfolio action queue ─── */

export interface ActionItem {
  contractId: string
  contract: string
  supplier: string
  department: string
  actBy: Date
  daysLeft: number
  value: number
  action: string
  kind: 'notice-deadline' | 'expiry'
  /** Already past the point where notice could change anything. */
  missed: boolean
}

/**
 * Every decision date in the next year, soonest first — the list a procurement
 * lead works top to bottom. Notice deadlines rank as their own events because
 * they, not the end date, are when the decision must be made.
 */
export function negotiationCalendar(
  contracts: Contract[], now = new Date(), horizonDays = 365
): ActionItem[] {
  const items: ActionItem[] = []
  const horizon = now.getTime() + horizonDays * DAY

  for (const c of contracts) {
    if (!c.endDate) continue
    const base = {
      contractId: c.id,
      contract: c.name,
      supplier: c.supplier,
      department: c.department,
      value: c.annualValue ?? 0,
    }

    const deadline = noticeDeadline(c)
    if (deadline && deadline.getTime() <= horizon) {
      const daysLeft = Math.round((deadline.getTime() - now.getTime()) / DAY)
      const stillRunning = c.endDate.getTime() >= now.getTime()
      // A passed deadline only matters while the contract is still live.
      if (daysLeft >= 0 || (stillRunning && c.autoRenew)) {
        items.push({
          ...base,
          actBy: deadline,
          daysLeft,
          kind: 'notice-deadline',
          missed: daysLeft < 0,
          action: daysLeft < 0
            ? `Notice window closed — confirm the new term and diarise the next one`
            : `Serve notice or renegotiate before ${deadline.toISOString().slice(0, 10)}`,
        })
      }
    }

    const daysToEnd = Math.round((c.endDate.getTime() - now.getTime()) / DAY)
    if (daysToEnd >= 0 && c.endDate.getTime() <= horizon) {
      items.push({
        ...base,
        actBy: c.endDate,
        daysLeft: daysToEnd,
        kind: 'expiry',
        missed: false,
        action: c.autoRenew ? 'Term rolls over — market-test now' : 'Contract ends — market-test or replace',
      })
    }
  }

  return items.sort((a, b) => a.actBy.getTime() - b.actBy.getTime() || b.value - a.value)
}
