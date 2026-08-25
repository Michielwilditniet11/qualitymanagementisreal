import type { Contract } from '../data/types'
import { fmtK } from './risk'
import { hhi } from './insights'
import { noticeDeadline, paymentSpreads, hasPaymentTermsData } from './terms'
import {
  WACC, TAIL_SAVING, BUNDLING_SAVING, RENEGOTIATION_SAVING,
} from './levers'

const DAY = 86400000

export type OpportunityKind =
  | 'tail-consolidation' | 'category-bundling' | 'payment-harmonisation' | 'renewal-interception'

export interface Opportunity {
  kind: OpportunityKind
  title: string
  detail: string
  low: number
  high: number
  assumption: string
  /** Contracts this opportunity draws on — used to prevent double counting. */
  contractIds: string[]
}

function sumValue(cs: Contract[]): number {
  return cs.reduce((s, c) => s + (c.annualValue ?? 0), 0)
}

function groupBy(contracts: Contract[], field: 'supplier' | 'category'): Map<string, Contract[]> {
  const m = new Map<string, Contract[]>()
  for (const c of contracts) {
    const k = c[field]
    if (!k) continue
    if (!m.has(k)) m.set(k, [])
    m.get(k)!.push(c)
  }
  return m
}

/**
 * Where money could plausibly be recovered, as ranges with their assumptions.
 * Every figure here is a heuristic, never a quote.
 */
export function savingsOpportunities(contracts: Contract[], now = new Date()): Opportunity[] {
  const out: Opportunity[] = []
  if (contracts.length === 0) return out
  const total = sumValue(contracts)

  /* 1. Tail consolidation */
  const bySupplier = groupBy(contracts, 'supplier')
  if (total > 0 && bySupplier.size >= 5) {
    const tail = [...bySupplier.entries()].filter(([, cs]) => sumValue(cs) / total < 0.01)
    if (tail.length >= 5) {
      const tailContracts = tail.flatMap(([, cs]) => cs)
      const tailSpend = sumValue(tailContracts)
      out.push({
        kind: 'tail-consolidation',
        title: `Consolidate ${tail.length} tail suppliers`,
        detail: `${tail.length} of ${bySupplier.size} suppliers are each under 1% of spend, together ${fmtK(tailSpend)}. Each carries the same onboarding, compliance and invoicing overhead as a strategic supplier.`,
        low: tailSpend * TAIL_SAVING.low,
        high: tailSpend * TAIL_SAVING.high,
        assumption: `assumes ${Math.round(TAIL_SAVING.low * 100)}–${Math.round(TAIL_SAVING.high * 100)}% of ${fmtK(tailSpend)} tail spend`,
        contractIds: tailContracts.map(c => c.id),
      })
    }
  }

  /* 2. Category bundling where the supplier base is fragmented */
  for (const [category, cs] of groupBy(contracts, 'category')) {
    const catSuppliers = groupBy(cs, 'supplier')
    if (catSuppliers.size < 3) continue
    const index = hhi([...catSuppliers.values()].map(sumValue))
    if (index >= 0.4) continue // concentrated already — a dependency issue, not a bundling one
    const ranked = [...catSuppliers.entries()].sort((a, b) => sumValue(b[1]) - sumValue(a[1]))
    const movableContracts = ranked.slice(1).flatMap(([, x]) => x)
    const movable = sumValue(movableContracts)
    if (movable <= 0) continue
    out.push({
      kind: 'category-bundling',
      title: `Bundle ${category} across ${catSuppliers.size} suppliers`,
      detail: `${category} is split between ${catSuppliers.size} suppliers (HHI ${index.toFixed(2)}) with no one holding real volume. Moving ${fmtK(movable)} onto a lead supplier buys a volume discount.`,
      low: movable * BUNDLING_SAVING.low,
      high: movable * BUNDLING_SAVING.high,
      assumption: `assumes ${Math.round(BUNDLING_SAVING.low * 100)}–${Math.round(BUNDLING_SAVING.high * 100)}% on the ${fmtK(movable)} that would move`,
      contractIds: movableContracts.map(c => c.id),
    })
  }

  /* 3. Payment-terms harmonisation */
  if (hasPaymentTermsData(contracts)) {
    const spreads = paymentSpreads(contracts)
    const capital = spreads.reduce((s, x) => s + x.workingCapital, 0)
    if (capital > 0) {
      const ids = spreads.flatMap(s => contracts.filter(c => c.supplier === s.supplier).map(c => c.id))
      out.push({
        kind: 'payment-harmonisation',
        title: `Harmonise payment terms across ${spreads.length} supplier${spreads.length === 1 ? '' : 's'}`,
        detail: `These suppliers already accept longer terms on part of their spend. Levelling every contract up to the best term they have already agreed releases about ${fmtK(capital)} in working capital.`,
        low: capital * WACC,
        high: capital * WACC,
        assumption: `financing value of ${fmtK(capital)} released, at ${Math.round(WACC * 100)}% WACC`,
        contractIds: ids,
      })
    }
  }

  /* 4. Intercepting renewals while the window is still open */
  const intercept = contracts.filter(c => {
    const d = noticeDeadline(c)
    if (!d) return false
    const daysLeft = Math.round((d.getTime() - now.getTime()) / DAY)
    return daysLeft >= 0 && daysLeft <= 90
  })
  if (intercept.length > 0) {
    const spend = sumValue(intercept)
    out.push({
      kind: 'renewal-interception',
      title: `Renegotiate ${intercept.length} contract${intercept.length === 1 ? '' : 's'} before the window shuts`,
      detail: `${fmtK(spend)} has a notice deadline inside 90 days. Renegotiating rather than letting the term roll typically recovers inflation-linked uplift.`,
      low: spend * RENEGOTIATION_SAVING.low,
      high: spend * RENEGOTIATION_SAVING.high,
      assumption: `assumes ${Math.round(RENEGOTIATION_SAVING.low * 100)}–${Math.round(RENEGOTIATION_SAVING.high * 100)}% of ${fmtK(spend)} reaching a renewal decision`,
      contractIds: intercept.map(c => c.id),
    })
  }

  return out.sort((a, b) => b.high - a.high)
}

export interface SavingsSummary {
  low: number
  high: number
  byKind: { kind: OpportunityKind; title: string; low: number; high: number }[]
}

/**
 * Portfolio total. A contract appearing in several opportunities is counted
 * once at the highest rate that applies to it, so the headline can never
 * exceed what the portfolio is worth.
 */
export function savingsSummary(opps: Opportunity[], contracts: Contract[]): SavingsSummary {
  const valueById = new Map(contracts.map(c => [c.id, c.annualValue ?? 0]))
  const bestRate = new Map<string, { low: number; high: number }>()

  for (const o of opps) {
    const base = o.contractIds.reduce((s, id) => s + (valueById.get(id) ?? 0), 0)
    if (base <= 0) continue
    const lowRate = o.low / base
    const highRate = o.high / base
    for (const id of o.contractIds) {
      const cur = bestRate.get(id)
      // Take the best low and the best high independently. Carrying the
      // winning opportunity's floor along with its ceiling could push the
      // headline low *below* what a single opportunity already guarantees —
      // a range that contradicts its own components.
      bestRate.set(id, cur
        ? { low: Math.max(cur.low, lowRate), high: Math.max(cur.high, highRate) }
        : { low: lowRate, high: highRate })
    }
  }

  let low = 0
  let high = 0
  for (const [id, rate] of bestRate) {
    const v = valueById.get(id) ?? 0
    low += v * rate.low
    high += v * rate.high
  }

  return {
    low,
    high,
    byKind: opps.map(o => ({ kind: o.kind, title: o.title, low: o.low, high: o.high })),
  }
}
