import type { Contract } from '../data/types'
import { fmtK } from './risk'

/* ─── Shared contract-clause primitives ─── */

const DAY = 86400000

/** The date by which notice must be served, or null when it cannot be derived. */
export function noticeDeadline(c: Contract): Date | null {
  if (!c.endDate || !c.noticePeriodDays || c.noticePeriodDays <= 0) return null
  return new Date(c.endDate.getTime() - c.noticePeriodDays * DAY)
}

/**
 * Auto-renews, the notice window has already closed, and the term has not yet
 * ended — the renewal is locked in unless someone intervenes.
 * Shared with the renewal timeline so both views agree.
 */
export function isSilentRenewal(c: Contract, now = new Date()): boolean {
  if (!c.autoRenew || !c.endDate) return false
  const deadline = noticeDeadline(c)
  if (!deadline) return false
  return deadline.getTime() < now.getTime() && c.endDate.getTime() >= now.getTime()
}

export function daysBetween(a: Date, b: Date): number {
  return Math.round((a.getTime() - b.getTime()) / DAY)
}

/** Contract term length in days, or null without both dates. */
export function termLengthDays(c: Contract): number | null {
  if (!c.startDate || !c.endDate) return null
  return Math.round((c.endDate.getTime() - c.startDate.getTime()) / DAY)
}

/**
 * Best-effort payment terms in days from free text.
 * Handles "30", "NET 30", "net30", "60 dagen", "EOM+45", "30 days net".
 * Returns null when nothing defensible can be read.
 */
export function parsePaymentDays(text?: string): number | null {
  if (!text) return null
  const s = String(text).toLowerCase().trim()
  if (!s) return null

  // Immediate-payment phrasings carry no day count of their own.
  if (/\b(immediate|direct|on receipt|bij ontvangst|prepaid|vooruit)\b/.test(s)) return 0

  // Sum every number in end-of-month forms so "EOM+45" reads as 45, not 0.
  const eom = /\b(eom|end of month|einde maand|ultimo)\b/.test(s)
  const numbers = s.match(/\d+/g)
  if (!numbers) return eom ? 30 : null

  const values = numbers.map(Number).filter(n => Number.isFinite(n))
  if (values.length === 0) return null

  // A single number is the term; EOM+N adds the month.
  const n = eom ? 30 + Math.max(...values) : Math.max(...values)
  // Anything beyond a year is not a payment term — likely a stray figure.
  if (n < 0 || n > 365) return null
  return n
}

/* ─── Findings ─── */

export type TermSeverity = 'critical' | 'warning' | 'info'
export type ClauseKind =
  | 'auto-renewal' | 'notice' | 'term-length' | 'payment' | 'raw-scan' | 'status'

export interface TermFinding {
  id: string
  severity: TermSeverity
  clause: ClauseKind
  contractIds: string[]
  title: string
  detail: string
  exposure?: number
  fix: string
  actBy?: Date
}

/** Notice periods at or above this are supplier-friendly drafting. */
export const LONG_NOTICE_DAYS = 120
/** Below this, material spend cannot realistically be re-sourced in time. */
export const SHORT_NOTICE_DAYS = 30
/** Terms of this length that auto-renew are long lock-ins. */
export const LONG_TERM_DAYS = 3 * 365
/** Paying faster than this is below conventional practice. */
export const FAST_PAYMENT_DAYS = 30

const INDEXATION_WORDS = ['indexation', 'indexatie', 'index', 'cpi', 'inflation', 'inflatie', 'uplift', 'price increase', 'prijsverhoging', 'escalation']
const UNILATERAL_WORDS = ['unilateral', 'eenzijdig', "at supplier's discretion", 'sole discretion']

const SEVERITY_RANK: Record<TermSeverity, number> = { critical: 0, warning: 1, info: 2 }

function sumValue(cs: Contract[]): number {
  return cs.reduce((s, c) => s + (c.annualValue ?? 0), 0)
}

function quartileCut(values: number[], q: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * q))
  return sorted[idx]
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

/** Suppliers that are the only source in every category they serve. */
function singleSourceSuppliers(contracts: Contract[]): Set<string> {
  const byCategory = new Map<string, Set<string>>()
  for (const c of contracts) {
    if (!c.category) continue
    if (!byCategory.has(c.category)) byCategory.set(c.category, new Set())
    byCategory.get(c.category)!.add(c.supplier)
  }
  const solo = new Set<string>()
  for (const [, suppliers] of byCategory) {
    if (suppliers.size === 1) solo.add([...suppliers][0])
  }
  return solo
}

/* ─── Payment-terms analysis (also consumed by the savings estimator) ─── */

export interface PaymentSpread {
  supplier: string
  /** Distinct parsed day-counts across this supplier's contracts. */
  days: number[]
  best: number
  worst: number
  /** Annual value sitting on terms shorter than the best already achieved. */
  spendOnWorseTerms: number
  /** Working capital released by moving that spend to the best term. */
  workingCapital: number
}

/** True when enough of the portfolio carries readable payment terms to analyse. */
export function hasPaymentTermsData(contracts: Contract[]): boolean {
  const total = sumValue(contracts)
  if (total <= 0) return contracts.some(c => parsePaymentDays(c.paymentTerms) !== null)
  const covered = sumValue(contracts.filter(c => parsePaymentDays(c.paymentTerms) !== null))
  return covered / total >= 0.3
}

/** Suppliers whose own contracts sit on inconsistent payment terms. */
export function paymentSpreads(contracts: Contract[]): PaymentSpread[] {
  const out: PaymentSpread[] = []
  for (const [supplier, cs] of groupBySupplier(contracts)) {
    const parsed = cs
      .map(c => ({ c, days: parsePaymentDays(c.paymentTerms) }))
      .filter((x): x is { c: Contract; days: number } => x.days !== null)
    if (parsed.length < 2) continue
    const days = [...new Set(parsed.map(p => p.days))].sort((a, b) => a - b)
    if (days.length < 2) continue
    const best = days[days.length - 1]
    const worst = days[0]
    const worse = parsed.filter(p => p.days < best)
    const spendOnWorseTerms = sumValue(worse.map(p => p.c))
    // Cash released is spend × the extra days it stays in the business.
    const workingCapital = worse.reduce(
      (s, p) => s + ((p.c.annualValue ?? 0) * (best - p.days)) / 365, 0)
    out.push({ supplier, days, best, worst, spendOnWorseTerms, workingCapital })
  }
  return out.sort((a, b) => b.workingCapital - a.workingCapital)
}

/* ─── The audit ─── */

export function auditTerms(contracts: Contract[], now = new Date()): TermFinding[] {
  const findings: TermFinding[] = []
  if (contracts.length === 0) return findings

  const values = contracts.map(c => c.annualValue ?? 0).filter(v => v > 0)
  const topQuartile = quartileCut(values, 0.75)
  const solo = singleSourceSuppliers(contracts)

  /* 1. Evergreen with no derivable decision date */
  const evergreenBlind = contracts.filter(c => c.autoRenew && !c.noticePeriodDays)
  if (evergreenBlind.length > 0) {
    findings.push({
      id: 'evergreen-no-notice',
      severity: 'critical',
      clause: 'auto-renewal',
      contractIds: evergreenBlind.map(c => c.id),
      title: `${evergreenBlind.length} auto-renewing contract${evergreenBlind.length === 1 ? '' : 's'} with no notice period recorded`,
      detail: `${fmtK(sumValue(evergreenBlind))} renews automatically and the register cannot say by when notice must be served. The decision date is unknown, not distant.`,
      exposure: sumValue(evergreenBlind),
      fix: 'Read the notice period off the signed agreement and record it.',
    })
  }

  /* 2. Notice window already closed */
  const closed = contracts.filter(c => isSilentRenewal(c, now))
  if (closed.length > 0) {
    findings.push({
      id: 'notice-window-closed',
      severity: 'critical',
      clause: 'auto-renewal',
      contractIds: closed.map(c => c.id),
      title: `${closed.length} contract${closed.length === 1 ? '' : 's'} past the point of no return`,
      detail: `${fmtK(sumValue(closed))} will roll into a new term — the notice deadline has passed while the contract is still running.`,
      exposure: sumValue(closed),
      fix: 'Confirm the new term and diarise the next notice date immediately.',
    })
  }

  /* 3. Supplier-friendly notice periods */
  for (const c of contracts) {
    if (!c.noticePeriodDays || c.noticePeriodDays < LONG_NOTICE_DAYS) continue
    const isSolo = solo.has(c.supplier)
    findings.push({
      id: `long-notice:${c.id}`,
      severity: isSolo ? 'critical' : 'warning',
      clause: 'notice',
      contractIds: [c.id],
      title: `${c.name} demands ${c.noticePeriodDays} days' notice`,
      detail: `A ${c.noticePeriodDays}-day notice period on ${fmtK(c.annualValue ?? 0)} is supplier-friendly drafting${isSolo ? `, and ${c.supplier} is the only source in ${c.category}, so switching cost compounds` : ''}.`,
      exposure: c.annualValue,
      fix: 'Negotiate the notice period down to 60–90 days at the next renewal.',
      actBy: noticeDeadline(c) ?? undefined,
    })
  }

  /* 4. Short-fuse notice on material spend */
  for (const c of contracts) {
    if (!c.noticePeriodDays || c.noticePeriodDays > SHORT_NOTICE_DAYS) continue
    if ((c.annualValue ?? 0) < topQuartile || topQuartile <= 0) continue
    findings.push({
      id: `short-notice:${c.id}`,
      severity: 'warning',
      clause: 'notice',
      contractIds: [c.id],
      title: `${c.name} leaves only ${c.noticePeriodDays} days to react`,
      detail: `${fmtK(c.annualValue ?? 0)} is top-quartile spend, but ${c.noticePeriodDays} days is not enough to run a credible alternative before the term rolls.`,
      exposure: c.annualValue,
      fix: 'Start the market test 6 months out rather than relying on the notice window.',
      actBy: noticeDeadline(c) ?? undefined,
    })
  }

  /* 5. Long auto-renewing terms */
  for (const c of contracts) {
    const term = termLengthDays(c)
    if (!c.autoRenew || term === null || term < LONG_TERM_DAYS) continue
    findings.push({
      id: `long-term:${c.id}`,
      severity: 'warning',
      clause: 'term-length',
      contractIds: [c.id],
      title: `${c.name} is a ${Math.round(term / 365)}-year term that renews itself`,
      detail: `${fmtK(c.annualValue ?? 0)} on a ${Math.round(term / 365)}-year term with auto-renewal — pricing is locked well beyond a normal review cycle.`,
      exposure: c.annualValue,
      fix: 'Add a benchmarking or price-review clause before agreeing another term.',
      actBy: noticeDeadline(c) ?? undefined,
    })
  }

  /* 6. Payment-terms spread within one supplier */
  for (const s of paymentSpreads(contracts)) {
    findings.push({
      id: `payment-spread:${s.supplier}`,
      severity: 'warning',
      clause: 'payment',
      contractIds: contracts.filter(c => c.supplier === s.supplier).map(c => c.id),
      title: `${s.supplier} is paid on ${s.days.length} different terms`,
      detail: `Terms range from ${s.worst} to ${s.best} days. ${s.supplier} already accepts ${s.best} days, so harmonising the rest needs no concession — it releases about ${fmtK(s.workingCapital)} in working capital.`,
      exposure: s.spendOnWorseTerms,
      fix: `Harmonise every ${s.supplier} contract to ${s.best}-day terms.`,
    })
  }

  /* 7. Paying faster than convention */
  const fast = contracts.filter(c => {
    const d = parsePaymentDays(c.paymentTerms)
    return d !== null && d < FAST_PAYMENT_DAYS && (c.annualValue ?? 0) > 0
  })
  if (fast.length > 0) {
    findings.push({
      id: 'fast-payment',
      severity: 'warning',
      clause: 'payment',
      contractIds: fast.map(c => c.id),
      title: `${fast.length} contract${fast.length === 1 ? '' : 's'} paid faster than 30 days`,
      detail: `${fmtK(sumValue(fast))} settles below the conventional 30-day floor, financing the supplier at our expense.`,
      exposure: sumValue(fast),
      fix: 'Move to 30–60 day terms unless an early-payment discount justifies the speed.',
    })
  }

  /* 8. Keyword pointers in unmapped source columns */
  const scanHits = new Map<string, { contracts: Contract[]; columns: Set<string> }>()
  for (const c of contracts) {
    for (const [col, val] of Object.entries(c.raw ?? {})) {
      if (!val) continue
      const text = String(val).toLowerCase()
      const kind = INDEXATION_WORDS.some(w => text.includes(w)) ? 'indexation'
        : UNILATERAL_WORDS.some(w => text.includes(w)) ? 'unilateral'
        : null
      if (!kind) continue
      if (!scanHits.has(kind)) scanHits.set(kind, { contracts: [], columns: new Set() })
      const hit = scanHits.get(kind)!
      if (!hit.contracts.includes(c)) hit.contracts.push(c)
      hit.columns.add(col)
    }
  }
  for (const [kind, hit] of scanHits) {
    findings.push({
      id: `raw-scan:${kind}`,
      severity: 'info',
      clause: 'raw-scan',
      contractIds: hit.contracts.map(c => c.id),
      title: kind === 'indexation'
        ? `Possible price-indexation language in ${hit.contracts.length} contract${hit.contracts.length === 1 ? '' : 's'}`
        : `Possible unilateral-change language in ${hit.contracts.length} contract${hit.contracts.length === 1 ? '' : 's'}`,
      detail: `Found in source column${hit.columns.size === 1 ? '' : 's'} ${[...hit.columns].join(', ')}. This is a text match on imported data, not a reading of the agreement.`,
      exposure: sumValue(hit.contracts),
      fix: 'Review the clause in the signed agreement to confirm.',
    })
  }

  /* 9. Register contradicts itself */
  const activeButExpired = contracts.filter(c =>
    c.endDate && c.endDate.getTime() < now.getTime() &&
    /^(active|actief|aktiv|live|current)$/i.test((c.status ?? '').trim()))
  if (activeButExpired.length > 0) {
    findings.push({
      id: 'status-active-expired',
      severity: 'critical',
      clause: 'status',
      contractIds: activeButExpired.map(c => c.id),
      title: `${activeButExpired.length} contract${activeButExpired.length === 1 ? '' : 's'} marked active but past their end date`,
      detail: `${fmtK(sumValue(activeButExpired))} is either being bought without a valid agreement, or the register is stale. Both need answering.`,
      exposure: sumValue(activeButExpired),
      fix: 'Confirm whether these are live, then renew them or close them off.',
    })
  }

  const expiredButFuture = contracts.filter(c =>
    c.endDate && c.endDate.getTime() >= now.getTime() &&
    /^(expired|terminated|ended|beëindigd|verlopen|cancelled|canceled)$/i.test((c.status ?? '').trim()))
  if (expiredButFuture.length > 0) {
    findings.push({
      id: 'status-expired-future',
      severity: 'warning',
      clause: 'status',
      contractIds: expiredButFuture.map(c => c.id),
      title: `${expiredButFuture.length} contract${expiredButFuture.length === 1 ? '' : 's'} marked closed but still running`,
      detail: `${fmtK(sumValue(expiredButFuture))} carries an end date in the future while the status says the contract is over.`,
      exposure: sumValue(expiredButFuture),
      fix: 'Correct the status or the end date so renewals are not missed.',
    })
  }

  return findings.sort((a, b) => {
    const s = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]
    if (s !== 0) return s
    return (b.exposure ?? 0) - (a.exposure ?? 0)
  })
}
