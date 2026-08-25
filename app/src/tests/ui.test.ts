import { describe, it, expect } from 'vitest'
import { nextSort, sortRows, type SortState } from '../ui/sort'
import { fmtMoney, fmtDays, fmtPct, truncate } from '../ui/format'
import { urgencyColor, healthColor, alpha, T } from '../ui/theme'

describe('sort', () => {
  const rows = [
    { n: 'b', v: 2, d: new Date('2026-02-01') },
    { n: 'a', v: 10, d: new Date('2026-01-01') },
    { n: 'c', v: undefined as number | undefined, d: new Date('2026-03-01') },
  ]
  const valueOf = (r: typeof rows[0], k: string) => (r as any)[k]

  it('sorts descending on first click and flips on the second', () => {
    let s: SortState = { key: null, dir: 'desc' }
    s = nextSort(s, 'v')
    expect(s).toEqual({ key: 'v', dir: 'desc' })
    s = nextSort(s, 'v')
    expect(s.dir).toBe('asc')
  })

  it('resets direction when a different column is clicked', () => {
    const s = nextSort({ key: 'v', dir: 'asc' }, 'n')
    expect(s).toEqual({ key: 'n', dir: 'desc' })
  })

  it('orders numbers', () => {
    const out = sortRows(rows, { key: 'v', dir: 'asc' }, valueOf)
    expect(out.map(r => r.n).slice(0, 2)).toEqual(['b', 'a'])
  })

  it('orders dates', () => {
    const out = sortRows(rows, { key: 'd', dir: 'asc' }, valueOf)
    expect(out.map(r => r.n)).toEqual(['a', 'b', 'c'])
  })

  it('orders strings', () => {
    expect(sortRows(rows, { key: 'n', dir: 'asc' }, valueOf).map(r => r.n)).toEqual(['a', 'b', 'c'])
  })

  it('keeps missing values last in both directions', () => {
    expect(sortRows(rows, { key: 'v', dir: 'asc' }, valueOf).at(-1)!.n).toBe('c')
    expect(sortRows(rows, { key: 'v', dir: 'desc' }, valueOf).at(-1)!.n).toBe('c')
  })

  it('leaves rows untouched with no sort key', () => {
    expect(sortRows(rows, { key: null, dir: 'asc' }, valueOf)).toEqual(rows)
  })

  it('does not mutate the input', () => {
    const before = rows.map(r => r.n)
    sortRows(rows, { key: 'v', dir: 'asc' }, valueOf)
    expect(rows.map(r => r.n)).toEqual(before)
  })
})

describe('format', () => {
  it('formats money with separators and an em dash for nothing', () => {
    expect(fmtMoney(1234567)).toBe('€1,234,567')
    expect(fmtMoney(undefined)).toBe('—')
    expect(fmtMoney(1000, '$')).toBe('$1,000')
  })

  it('phrases day counts as deadlines', () => {
    expect(fmtDays(45)).toBe('45d')
    expect(fmtDays(0)).toBe('today')
    expect(fmtDays(-12)).toBe('12d overdue')
  })

  it('guards percentages against a zero base', () => {
    expect(fmtPct(1, 4)).toBe('25%')
    expect(fmtPct(1, 0)).toBe('—')
  })

  it('truncates with an ellipsis', () => {
    expect(truncate('abcdef', 4)).toBe('abc…')
    expect(truncate('abc', 8)).toBe('abc')
  })
})

describe('theme', () => {
  it('escalates urgency as a deadline approaches', () => {
    expect(urgencyColor(-1)).toBe(T.red)
    expect(urgencyColor(10)).toBe(T.red)
    expect(urgencyColor(60)).toBe(T.amber)
    expect(urgencyColor(200)).toBe(T.cyan)
    expect(urgencyColor(500)).toBe(T.muted)
    expect(urgencyColor(200, true)).toBe(T.red)
  })

  it('maps health scores to bands', () => {
    expect(healthColor(90)).toBe(T.green)
    expect(healthColor(60)).toBe(T.amber)
    expect(healthColor(20)).toBe(T.red)
  })

  it('converts hex to rgba', () => {
    expect(alpha('#FF0000', 0.5)).toBe('rgba(255,0,0,0.5)')
  })
})

/* ─── Kraljic brief (UX5) ─── */

import { quadrantOf, buildPlaybook, categoryBrief, supplyRiskOf, QUADRANTS } from '../analytics/kraljicBrief'
import { computeStatsByField } from '../data/metrics'
import { supplierLeverage, negotiationCalendar } from '../analytics/levers'
import { savingsOpportunities } from '../analytics/savings'
import type { Contract } from '../data/types'

let kseq = 0
function kc(over: Partial<Contract> = {}): Contract {
  kseq++
  return {
    id: over.id ?? `k${kseq}`, name: over.name ?? `K${kseq}`,
    supplier: 'Acme', category: 'IT', department: 'Finance', owner: 'Alice',
    annualValue: 10_000, tags: [], raw: {}, ...over,
  }
}
const kDays = (n: number) => new Date(Date.now() + n * 86400000)

describe('quadrantOf', () => {
  it('places each corner correctly', () => {
    expect(quadrantOf(0.9, 0.9)).toBe('strategic')
    expect(quadrantOf(0.9, 0.1)).toBe('leverage')
    expect(quadrantOf(0.1, 0.9)).toBe('bottleneck')
    expect(quadrantOf(0.1, 0.1)).toBe('non-critical')
  })

  it('treats the midpoint as the upper quadrant', () => {
    expect(quadrantOf(0.5, 0.5)).toBe('strategic')
  })
})

describe('buildPlaybook', () => {
  const cs = [
    kc({ name: 'A', supplier: 'PackRight', category: 'Packaging', annualValue: 260_000, endDate: kDays(120), noticePeriodDays: 30 }),
    kc({ name: 'B', supplier: 'PrintPro', category: 'Packaging', annualValue: 90_000, endDate: kDays(400) }),
  ]
  const sup = supplierLeverage(cs)
  const dec = negotiationCalendar(cs)
  const opp = savingsOpportunities(cs)

  it('names real suppliers in a leverage playbook', () => {
    const lines = buildPlaybook('Packaging', 'leverage', sup, dec, opp, 2).join(' ')
    expect(lines).toMatch(/PackRight|PrintPro/)
  })

  it('names the act-by date when a decision is open', () => {
    const lines = buildPlaybook('Packaging', 'leverage', sup, dec, opp, 2).join(' ')
    expect(lines).toMatch(/Act before \d{4}-\d{2}-\d{2}/)
  })

  it('says the strategy is a second supplier when sole-sourced', () => {
    const lines = buildPlaybook('Niche', 'bottleneck', sup.slice(0, 1), [], [], 1).join(' ')
    expect(lines).toContain('only source')
  })

  it('produces guidance for every quadrant', () => {
    for (const q of QUADRANTS) {
      expect(buildPlaybook('Packaging', q.id, sup, dec, opp, 2).length).toBeGreaterThan(0)
    }
  })

  it('survives a category with no suppliers or decisions', () => {
    expect(() => buildPlaybook('Empty', 'leverage', [], [], [], 0)).not.toThrow()
  })
})

describe('categoryBrief', () => {
  const cs = [
    kc({ name: 'P1', supplier: 'PackRight', category: 'Packaging', department: 'Ops', annualValue: 260_000, endDate: kDays(120), noticePeriodDays: 30 }),
    kc({ name: 'P2', supplier: 'PrintPro', category: 'Packaging', department: 'Ops', annualValue: 90_000, endDate: kDays(400) }),
    kc({ name: 'X1', supplier: 'Other', category: 'Cloud', department: 'IT', annualValue: 50_000, endDate: kDays(300) }),
  ]
  const stats = computeStatsByField(cs, 'category', 'category')
  const packaging = stats.find(s => s.name === 'Packaging')!

  it('reports only this category, with engine figures', () => {
    const b = categoryBrief('Packaging', cs, packaging, 'leverage', false)
    expect(b.spend).toBe(packaging.totalSpend)
    expect(b.contractCount).toBe(2)
    expect(b.suppliers.map(s => s.supplier).sort()).toEqual(['PackRight', 'PrintPro'])
  })

  it('lists only decisions belonging to the category', () => {
    const b = categoryBrief('Packaging', cs, packaging, 'leverage', false)
    for (const d of b.decisions) expect(['P1', 'P2']).toContain(d.contract)
  })

  it('marks a single-source category', () => {
    const cloud = stats.find(s => s.name === 'Cloud')!
    expect(categoryBrief('Cloud', cs, cloud, 'bottleneck', false).singleSource).toBe(true)
  })

  it('carries the adjusted flag through', () => {
    expect(categoryBrief('Packaging', cs, packaging, 'strategic', true).adjusted).toBe(true)
  })

  it('never invents a supplier the category does not have', () => {
    const b = categoryBrief('Packaging', cs, packaging, 'leverage', false)
    expect(b.suppliers.some(s => s.supplier === 'Other')).toBe(false)
  })
})

describe('supplyRiskOf', () => {
  const stat = (suppliers: string[], notice = 0) => {
    const cs = suppliers.map((sp, i) => kc({ supplier: sp, category: 'X', noticePeriodDays: notice || undefined, annualValue: 1000 * (i + 1) }))
    return computeStatsByField(cs, 'category', 'category')[0]
  }

  it('rates a sole source far above a competitive category', () => {
    const solo = supplyRiskOf(stat(['A']))
    const four = supplyRiskOf(stat(['A', 'B', 'C', 'D']))
    expect(solo).toBeGreaterThan(four)
    expect(solo - four).toBeGreaterThan(0.3)
  })

  it('spreads the middle instead of saturating', () => {
    // The old formula pinned every one- and two-supplier category to ~1.
    const two = supplyRiskOf(stat(['A', 'B']))
    const three = supplyRiskOf(stat(['A', 'B', 'C']))
    expect(two).toBeLessThan(1)
    expect(two).toBeGreaterThan(three)
  })

  it('stays within 0 and 1', () => {
    for (const s of [stat(['A']), stat(['A', 'B'], 365), stat(['A', 'B', 'C', 'D', 'E'])]) {
      const v = supplyRiskOf(s)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(1)
    }
  })

  it('raises risk when exit takes a long notice period', () => {
    expect(supplyRiskOf(stat(['A', 'B', 'C'], 180)))
      .toBeGreaterThan(supplyRiskOf(stat(['A', 'B', 'C'], 0)))
  })
})
