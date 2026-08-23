import { describe, it, expect } from 'vitest'
import type { Contract } from '../data/types'
import {
  hhi,
  generateInsights,
  totalValueAtRisk,
  detectSystemicSuppliers,
  detectSingleSourceCategories,
  detectExpiryCliffs,
  detectSilentRenewals,
  detectOwnerOverload,
  detectOrphanSpend,
  detectTailSpend,
  detectConcentration,
  detectExpiredActive,
  detectDataConfidence,
} from '../analytics/insights'

let seq = 0

function contract(over: Partial<Contract> = {}): Contract {
  seq++
  return {
    id: `c${seq}`,
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

function inDays(n: number): Date {
  return new Date(Date.now() + n * 86400000)
}

describe('hhi', () => {
  it('returns 1 for a monopoly and ~0 for a fragmented market', () => {
    expect(hhi([100])).toBe(1)
    expect(hhi([25, 25, 25, 25])).toBeCloseTo(0.25)
    expect(hhi([])).toBe(0)
    expect(hhi([0, 0])).toBe(0)
  })
})

describe('detectSystemicSuppliers', () => {
  it('flags a supplier spanning three or more departments', () => {
    const cs = [
      contract({ supplier: 'BigCo', department: 'Finance' }),
      contract({ supplier: 'BigCo', department: 'HR' }),
      contract({ supplier: 'BigCo', department: 'Legal' }),
    ]
    const out = detectSystemicSuppliers(cs)
    expect(out).toHaveLength(1)
    expect(out[0].title).toContain('BigCo')
    expect(out[0].nodeKeys).toContain('supplier::BigCo')
  })

  it('ignores a small supplier confined to one department', () => {
    const cs = [
      contract({ supplier: 'Small', department: 'Finance', annualValue: 1 }),
      contract({ supplier: 'Other', department: 'HR', annualValue: 100_000 }),
    ]
    const out = detectSystemicSuppliers(cs).filter(i => i.title.includes('Small'))
    expect(out).toHaveLength(0)
  })
})

describe('detectSingleSourceCategories', () => {
  it('flags a category served by exactly one supplier', () => {
    const cs = [
      contract({ category: 'Cloud', supplier: 'OnlyOne' }),
      contract({ category: 'Cloud', supplier: 'OnlyOne' }),
    ]
    const out = detectSingleSourceCategories(cs)
    expect(out).toHaveLength(1)
    expect(out[0].narrative).toContain('OnlyOne')
  })

  it('does not flag a category with competing suppliers', () => {
    const cs = [
      contract({ category: 'Cloud', supplier: 'A' }),
      contract({ category: 'Cloud', supplier: 'B' }),
    ]
    expect(detectSingleSourceCategories(cs)).toHaveLength(0)
  })
})

describe('detectExpiryCliffs', () => {
  it('flags a department with most of its spend expiring inside 90 days', () => {
    const cs = [
      contract({ department: 'Ops', annualValue: 90_000, endDate: inDays(45) }),
      contract({ department: 'Ops', annualValue: 10_000, endDate: inDays(900) }),
    ]
    const out = detectExpiryCliffs(cs)
    expect(out).toHaveLength(1)
    expect(out[0].severity).toBe('critical')
    expect(out[0].valueAtRisk).toBe(90_000)
  })

  it('stays quiet when expiries are far out', () => {
    const cs = [contract({ department: 'Ops', endDate: inDays(700) })]
    expect(detectExpiryCliffs(cs)).toHaveLength(0)
  })
})

describe('detectSilentRenewals', () => {
  it('flags an auto-renew contract whose notice window is closing', () => {
    const cs = [contract({ autoRenew: true, noticePeriodDays: 60, endDate: inDays(70) })]
    const out = detectSilentRenewals(cs)
    expect(out).toHaveLength(1)
    expect(out[0].severity).toBe('critical')
  })

  it('ignores auto-renew contracts with a distant notice deadline', () => {
    const cs = [contract({ autoRenew: true, noticePeriodDays: 30, endDate: inDays(400) })]
    expect(detectSilentRenewals(cs)).toHaveLength(0)
  })
})

describe('detectOwnerOverload', () => {
  it('flags an owner holding a large share of spend', () => {
    const cs = [
      contract({ owner: 'Bob', annualValue: 500_000 }),
      contract({ owner: 'Carol', annualValue: 10_000 }),
    ]
    const out = detectOwnerOverload(cs)
    expect(out.map(i => i.title).join()).toContain('Bob')
    expect(out.map(i => i.title).join()).not.toContain('Carol')
  })

  it('stays quiet when ownership is evenly spread', () => {
    const cs = Array.from({ length: 10 }, (_, i) =>
      contract({ owner: `Owner${i}`, annualValue: 10_000 })
    )
    expect(detectOwnerOverload(cs)).toHaveLength(0)
  })
})

describe('detectOrphanSpend', () => {
  it('flags contracts with no owner', () => {
    const cs = [contract({ owner: undefined, annualValue: 50_000 }), contract()]
    const out = detectOrphanSpend(cs)
    expect(out).toHaveLength(1)
    expect(out[0].valueAtRisk).toBe(50_000)
  })

  it('stays quiet when every contract has an owner', () => {
    expect(detectOrphanSpend([contract(), contract()])).toHaveLength(0)
  })
})

describe('detectTailSpend', () => {
  it('flags a long tail of sub-1% suppliers', () => {
    const cs = [
      contract({ supplier: 'Whale', annualValue: 10_000_000 }),
      ...Array.from({ length: 6 }, (_, i) => contract({ supplier: `Tiny${i}`, annualValue: 100 })),
    ]
    const out = detectTailSpend(cs)
    expect(out).toHaveLength(1)
    expect(out[0].title).toContain('6 tail suppliers')
  })

  it('stays quiet for a small supplier base', () => {
    expect(detectTailSpend([contract(), contract({ supplier: 'B' })])).toHaveLength(0)
  })
})

describe('detectConcentration', () => {
  it('flags a category where one supplier dominates a multi-supplier field', () => {
    const cs = [
      contract({ category: 'Travel', supplier: 'Dominant', annualValue: 900_000 }),
      contract({ category: 'Travel', supplier: 'Minor', annualValue: 10_000 }),
    ]
    const out = detectConcentration(cs)
    expect(out).toHaveLength(1)
    expect(out[0].narrative).toContain('Dominant')
  })

  it('stays quiet when volume is balanced', () => {
    const cs = [
      contract({ category: 'Travel', supplier: 'A', annualValue: 100_000 }),
      contract({ category: 'Travel', supplier: 'B', annualValue: 100_000 }),
      contract({ category: 'Travel', supplier: 'C', annualValue: 100_000 }),
    ]
    expect(detectConcentration(cs)).toHaveLength(0)
  })
})

describe('detectExpiredActive', () => {
  it('flags contracts past their end date', () => {
    const out = detectExpiredActive([contract({ endDate: inDays(-40), annualValue: 20_000 })])
    expect(out).toHaveLength(1)
    expect(out[0].valueAtRisk).toBe(20_000)
  })

  it('stays quiet for live contracts', () => {
    expect(detectExpiredActive([contract({ endDate: inDays(100) })])).toHaveLength(0)
  })
})

describe('detectDataConfidence', () => {
  it('flags a sparsely populated register', () => {
    const cs = [
      { id: 'x', name: 'Bare', supplier: '', category: '', department: '', tags: [], raw: {} } as Contract,
    ]
    const out = detectDataConfidence(cs)
    expect(out).toHaveLength(1)
    expect(out[0].title).toContain('%')
  })

  it('stays quiet when every field is filled', () => {
    const cs = [contract({ endDate: inDays(200) })]
    expect(detectDataConfidence(cs)).toHaveLength(0)
  })
})

describe('generateInsights', () => {
  it('returns nothing for an empty portfolio', () => {
    expect(generateInsights([])).toEqual([])
  })

  it('ranks critical findings before warnings and info', () => {
    const cs = [
      contract({ endDate: inDays(-10) }),                       // critical: expired
      contract({ supplier: 'Solo', category: 'Niche' }),        // single-source
      contract({ owner: undefined }),                           // orphan
    ]
    const out = generateInsights(cs)
    expect(out.length).toBeGreaterThan(0)
    const ranks = out.map(i => ['critical', 'warning', 'info'].indexOf(i.severity))
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b))
  })

  it('sums value at risk across distinct critical findings', () => {
    const cs = [contract({ endDate: inDays(-10), annualValue: 30_000 })]
    const out = generateInsights(cs)
    expect(totalValueAtRisk(out)).toBeGreaterThan(0)
  })
})
