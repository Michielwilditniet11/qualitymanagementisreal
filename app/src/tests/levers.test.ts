import { describe, it, expect } from 'vitest'
import type { Contract } from '../data/types'
import {
  supplierLeverage, negotiationCalendar,
  WINDOW_HORIZON_DAYS, COTERM_SPREAD_DAYS,
} from '../analytics/levers'
import { savingsOpportunities, savingsSummary } from '../analytics/savings'

const NOW = new Date('2026-06-15T12:00:00Z')
const DAY = 86400000
const inDays = (n: number) => new Date(NOW.getTime() + n * DAY)

let seq = 0
function contract(over: Partial<Contract> = {}): Contract {
  seq++
  return {
    id: over.id ?? `c${seq}`,
    name: over.name ?? `Contract ${seq}`,
    supplier: 'Acme',
    category: 'IT',
    department: 'Finance',
    owner: 'Alice',
    annualValue: 10_000,
    tags: [],
    raw: {},
    ...over,
  }
}

const leverKinds = (l: { levers: { kind: string }[] }) => l.levers.map(x => x.kind)

describe('supplierLeverage', () => {
  it('opens a renewal-window lever inside the horizon', () => {
    const cs = [contract({ supplier: 'S', endDate: inDays(120), noticePeriodDays: 60 })]
    const [s] = supplierLeverage(cs, NOW)
    expect(leverKinds(s)).toContain('renewal-window')
    expect(s.nextWindow!.daysLeft).toBe(60)
  })

  it('does not open one when the deadline is beyond the horizon', () => {
    const cs = [contract({ supplier: 'S', endDate: inDays(500), noticePeriodDays: 30 })]
    const [s] = supplierLeverage(cs, NOW)
    expect(leverKinds(s)).not.toContain('renewal-window')
    expect(s.nextWindow).toBeUndefined()
  })

  it('does not open one when the deadline has already passed', () => {
    const cs = [contract({ supplier: 'S', endDate: inDays(10), noticePeriodDays: 60 })]
    const [s] = supplierLeverage(cs, NOW)
    expect(leverKinds(s)).not.toContain('renewal-window')
  })

  it('picks the largest contract as the anchor window', () => {
    const cs = [
      contract({ supplier: 'S', name: 'Small', annualValue: 1_000, endDate: inDays(100), noticePeriodDays: 30 }),
      contract({ supplier: 'S', name: 'Big', annualValue: 900_000, endDate: inDays(120), noticePeriodDays: 30 }),
    ]
    const [s] = supplierLeverage(cs, NOW)
    expect(s.nextWindow!.contract).toBe('Big')
  })

  it('offers consolidation once a supplier holds several agreements', () => {
    const cs = [contract({ supplier: 'S' }), contract({ supplier: 'S' })]
    expect(leverKinds(supplierLeverage(cs, NOW)[0])).toContain('consolidation')
  })

  it('does not offer consolidation for a single agreement', () => {
    expect(leverKinds(supplierLeverage([contract({ supplier: 'S' })], NOW)[0]))
      .not.toContain('consolidation')
  })

  it('offers co-terming only when end dates are far apart', () => {
    const wide = [
      contract({ supplier: 'S', endDate: inDays(30) }),
      contract({ supplier: 'S', endDate: inDays(30 + COTERM_SPREAD_DAYS + 10) }),
    ]
    const tight = [
      contract({ supplier: 'T', endDate: inDays(30) }),
      contract({ supplier: 'T', endDate: inDays(40) }),
    ]
    expect(leverKinds(supplierLeverage(wide, NOW)[0])).toContain('co-terming')
    expect(leverKinds(supplierLeverage(tight, NOW)[0])).not.toContain('co-terming')
  })

  it('names competing suppliers already in the category', () => {
    const cs = [
      contract({ supplier: 'A', category: 'Cloud' }),
      contract({ supplier: 'B', category: 'Cloud' }),
    ]
    const a = supplierLeverage(cs, NOW).find(s => s.supplier === 'A')!
    expect(leverKinds(a)).toContain('competition')
    expect(a.levers.find(l => l.kind === 'competition')!.detail).toContain('B')
  })

  it('tells the truth when there is no alternative to point at', () => {
    const cs = [contract({ supplier: 'Only', category: 'Niche' })]
    const s = supplierLeverage(cs, NOW)[0]
    expect(leverKinds(s)).toContain('build-alternative')
    expect(s.position).toBe('weak')
  })

  it('rates an open window with a live alternative as a strong position', () => {
    const cs = [
      contract({ supplier: 'A', category: 'Cloud', endDate: inDays(100), noticePeriodDays: 30 }),
      contract({ supplier: 'B', category: 'Cloud' }),
    ]
    expect(supplierLeverage(cs, NOW).find(s => s.supplier === 'A')!.position).toBe('strong')
  })

  it('rates a contested supplier with no open window as balanced', () => {
    const cs = [
      contract({ supplier: 'A', category: 'Cloud', endDate: inDays(900) }),
      contract({ supplier: 'B', category: 'Cloud' }),
    ]
    expect(supplierLeverage(cs, NOW).find(s => s.supplier === 'A')!.position).toBe('balanced')
  })

  it('adds a payment-terms lever when the supplier already accepts better', () => {
    const cs = [
      contract({ supplier: 'P', paymentTerms: '30', annualValue: 200_000 }),
      contract({ supplier: 'P', paymentTerms: '60', annualValue: 200_000 }),
    ]
    const s = supplierLeverage(cs, NOW)[0]
    expect(leverKinds(s)).toContain('payment-terms')
    expect(s.levers.find(l => l.kind === 'payment-terms')!.estimate!.assumption).toContain('WACC')
  })

  it('gives every estimate a stated assumption', () => {
    const cs = [
      contract({ supplier: 'S', endDate: inDays(100), noticePeriodDays: 30, annualValue: 500_000 }),
      contract({ supplier: 'S', endDate: inDays(400), annualValue: 100_000 }),
    ]
    for (const s of supplierLeverage(cs, NOW)) {
      for (const l of s.levers) {
        if (l.estimate) expect(l.estimate.assumption.length).toBeGreaterThan(10)
      }
    }
  })

  it('ranks the bigger, more actionable supplier first', () => {
    const cs = [
      contract({ supplier: 'Tiny', annualValue: 1_000, category: 'X' }),
      contract({ supplier: 'Whale', annualValue: 900_000, category: 'Y', endDate: inDays(100), noticePeriodDays: 30 }),
      contract({ supplier: 'Rival', annualValue: 50_000, category: 'Y' }),
    ]
    expect(supplierLeverage(cs, NOW)[0].supplier).toBe('Whale')
  })

  it('keeps the horizon constant honest', () => {
    const justInside = [contract({ supplier: 'S', endDate: inDays(WINDOW_HORIZON_DAYS + 30), noticePeriodDays: 30 })]
    expect(leverKinds(supplierLeverage(justInside, NOW)[0])).toContain('renewal-window')
  })
})

describe('negotiationCalendar', () => {
  it('sorts by act-by date', () => {
    const cs = [
      contract({ name: 'Later', endDate: inDays(300) }),
      contract({ name: 'Sooner', endDate: inDays(30) }),
    ]
    const items = negotiationCalendar(cs, NOW)
    expect(items[0].contract).toBe('Sooner')
  })

  it('lists the notice deadline as its own decision point', () => {
    const cs = [contract({ endDate: inDays(200), noticePeriodDays: 90 })]
    const kinds = negotiationCalendar(cs, NOW).map(i => i.kind)
    expect(kinds).toContain('notice-deadline')
    expect(kinds).toContain('expiry')
  })

  it('flags a missed window on a live auto-renewing contract', () => {
    const cs = [contract({ endDate: inDays(30), noticePeriodDays: 60, autoRenew: true })]
    const missed = negotiationCalendar(cs, NOW).find(i => i.kind === 'notice-deadline')!
    expect(missed.missed).toBe(true)
    expect(missed.action).toContain('closed')
  })

  it('omits a passed deadline when the contract does not auto-renew', () => {
    const cs = [contract({ endDate: inDays(30), noticePeriodDays: 60, autoRenew: false })]
    expect(negotiationCalendar(cs, NOW).some(i => i.kind === 'notice-deadline')).toBe(false)
  })

  it('ignores contracts beyond the horizon', () => {
    expect(negotiationCalendar([contract({ endDate: inDays(900) })], NOW)).toHaveLength(0)
  })

  it('skips contracts with no end date', () => {
    expect(negotiationCalendar([contract({ endDate: undefined })], NOW)).toHaveLength(0)
  })
})

describe('savingsOpportunities', () => {
  it('returns nothing for an empty portfolio', () => {
    expect(savingsOpportunities([], NOW)).toEqual([])
  })

  it('finds tail consolidation', () => {
    const cs = [
      contract({ supplier: 'Whale', annualValue: 10_000_000 }),
      ...Array.from({ length: 6 }, (_, i) => contract({ supplier: `Tiny${i}`, annualValue: 100 })),
    ]
    expect(savingsOpportunities(cs, NOW).some(o => o.kind === 'tail-consolidation')).toBe(true)
  })

  it('finds bundling in a fragmented category', () => {
    const cs = Array.from({ length: 4 }, (_, i) =>
      contract({ supplier: `S${i}`, category: 'Travel', annualValue: 100_000 }))
    expect(savingsOpportunities(cs, NOW).some(o => o.kind === 'category-bundling')).toBe(true)
  })

  it('does not offer bundling where one supplier already dominates', () => {
    const cs = [
      contract({ supplier: 'Boss', category: 'Travel', annualValue: 1_000_000 }),
      contract({ supplier: 'A', category: 'Travel', annualValue: 1_000 }),
      contract({ supplier: 'B', category: 'Travel', annualValue: 1_000 }),
    ]
    expect(savingsOpportunities(cs, NOW).some(o => o.kind === 'category-bundling')).toBe(false)
  })

  it('skips payment harmonisation when the field is absent', () => {
    const cs = [contract({ supplier: 'A' }), contract({ supplier: 'A' })]
    expect(savingsOpportunities(cs, NOW).some(o => o.kind === 'payment-harmonisation')).toBe(false)
  })

  it('offers renewal interception inside 90 days', () => {
    const cs = [contract({ endDate: inDays(100), noticePeriodDays: 30, annualValue: 500_000 })]
    expect(savingsOpportunities(cs, NOW).some(o => o.kind === 'renewal-interception')).toBe(true)
  })

  it('states an assumption on every opportunity', () => {
    const cs = [
      contract({ supplier: 'Whale', annualValue: 10_000_000, endDate: inDays(100), noticePeriodDays: 30 }),
      ...Array.from({ length: 6 }, (_, i) => contract({ supplier: `Tiny${i}`, annualValue: 100 })),
    ]
    for (const o of savingsOpportunities(cs, NOW)) {
      expect(o.assumption.length).toBeGreaterThan(10)
      expect(o.high).toBeGreaterThanOrEqual(o.low)
    }
  })
})

describe('savingsSummary', () => {
  it('is zero when there is nothing to find', () => {
    expect(savingsSummary([], []).high).toBe(0)
  })

  it('counts a contract once even when several opportunities claim it', () => {
    // One contract that is both an interception candidate and in a fragmented category.
    const cs = [
      contract({ id: 'x', supplier: 'A', category: 'Travel', annualValue: 300_000, endDate: inDays(100), noticePeriodDays: 30 }),
      contract({ id: 'y', supplier: 'B', category: 'Travel', annualValue: 300_000 }),
      contract({ id: 'z', supplier: 'C', category: 'Travel', annualValue: 300_000 }),
    ]
    const opps = savingsOpportunities(cs, NOW)
    const naive = opps.reduce((s, o) => s + o.high, 0)
    const summary = savingsSummary(opps, cs)
    expect(summary.high).toBeLessThanOrEqual(naive)
  })

  it('never claims more than the portfolio is worth', () => {
    const cs = [
      contract({ supplier: 'Whale', annualValue: 1_000_000, category: 'A', endDate: inDays(60), noticePeriodDays: 30, paymentTerms: '30' }),
      contract({ supplier: 'Whale', annualValue: 500_000, category: 'A', paymentTerms: '90' }),
      ...Array.from({ length: 8 }, (_, i) =>
        contract({ supplier: `T${i}`, category: 'A', annualValue: 500, endDate: inDays(50), noticePeriodDays: 10 })),
    ]
    const totalSpend = cs.reduce((s, c) => s + (c.annualValue ?? 0), 0)
    const summary = savingsSummary(savingsOpportunities(cs, NOW), cs)
    expect(summary.high).toBeLessThanOrEqual(totalSpend)
    expect(summary.low).toBeLessThanOrEqual(summary.high)
  })

  it('reports each opportunity in the by-kind breakdown', () => {
    const cs = Array.from({ length: 4 }, (_, i) =>
      contract({ supplier: `S${i}`, category: 'Travel', annualValue: 100_000 }))
    const opps = savingsOpportunities(cs, NOW)
    expect(savingsSummary(opps, cs).byKind).toHaveLength(opps.length)
  })
})
