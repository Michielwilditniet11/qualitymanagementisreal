import { describe, it, expect } from 'vitest'
import { buildGraph, contractKey, contractIdFromKey, entityKey } from '../graph/buildGraph'
import { rowsToContracts } from '../data/parser'
import { findGaps } from '../analytics/gaps'
import { categoryBrief, quadrantOf } from '../analytics/kraljicBrief'
import { computeStatsByField, portfolioSummary } from '../data/metrics'
import { partitionRows, timelineRows, fitWindow, decidableWithin } from '../analytics/timeline'
import type { Contract } from '../data/types'
import {
  PLACEHOLDERS, fieldPresent, fieldsPresent, contractCompleteness, registerCompleteness,
} from '../data/completeness'
import { completeness } from '../analytics/lenses'
import { savingsSummary } from '../analytics/savings'
import { icsEvents, icsText } from '../features/calendar/CalendarScreen'

function contract(p: Partial<Contract> & { id: string; name: string }): Contract {
  return {
    supplier: p.supplier ?? 'Acme', category: p.category ?? 'IT',
    department: p.department ?? 'Ops', owner: p.owner,
    annualValue: p.annualValue ?? 100_000,
    startDate: p.startDate, endDate: p.endDate,
    noticePeriodDays: p.noticePeriodDays, autoRenew: p.autoRenew,
    status: p.status, paymentTerms: p.paymentTerms,
    tags: [], raw: {}, ...p,
  }
}

/* ── Contract nodes keyed by id, not name ────────────────────────────── */

describe('contract node identity', () => {
  const sameName = [
    contract({ id: '1', name: 'Cloud hosting', supplier: 'AWS', annualValue: 100 }),
    contract({ id: '2', name: 'Cloud hosting', supplier: 'Azure', annualValue: 900 }),
  ]

  it('keeps two contracts sharing a name as two separate nodes', () => {
    const { nodes } = buildGraph(sameName, 100, 100)
    const contractNodes = nodes.filter(n => n.type === 'contract')
    expect(contractNodes).toHaveLength(2)
  })

  it('gives each of them its own contract object rather than the last one', () => {
    const { nodes } = buildGraph(sameName, 100, 100)
    const ids = nodes.filter(n => n.type === 'contract').map(n => n.contract!.id).sort()
    expect(ids).toEqual(['1', '2'])
  })

  it('does not merge their spend onto one node', () => {
    const { nodes } = buildGraph(sameName, 100, 100)
    const values = nodes.filter(n => n.type === 'contract').map(n => n.value).sort((a, b) => a - b)
    expect(values).toEqual([100, 900])
  })

  it('still shows the human name on the node', () => {
    const { nodes } = buildGraph(sameName, 100, 100)
    expect(nodes.filter(n => n.type === 'contract').every(n => n.name === 'Cloud hosting')).toBe(true)
  })

  it('lets every contract be found by the key the engines build', () => {
    const { nodes } = buildGraph(sameName, 100, 100)
    for (const c of sameName) {
      expect(nodes.find(n => n.key === contractKey(c)), c.id).toBeDefined()
    }
  })

  it('round-trips a contract key back to its id', () => {
    expect(contractIdFromKey(contractKey(sameName[0]))).toBe('1')
    expect(contractIdFromKey(entityKey('supplier', 'AWS'))).toBeNull()
  })

  it('keys entities by name, since that is their identity', () => {
    const { nodes } = buildGraph(sameName, 100, 100)
    expect(nodes.find(n => n.key === entityKey('supplier', 'AWS'))).toBeDefined()
  })
})

/* ── Duplicate contract ids ──────────────────────────────────────────── */

describe('duplicate contract ids', () => {
  const rows = [
    ['C001', 'First', '100'],
    ['C001', 'Second', '200'],
    ['C001', 'Third', '300'],
  ]
  const mapping = { contract_id: 0, contract_name: 1, annual_value: 2 }

  it('still reports the duplicate to the user', () => {
    const { issues } = rowsToContracts(rows, mapping)
    expect(issues.filter((i: { kind: string }) => i.kind === 'duplicate')).toHaveLength(2)
  })

  it('stores unique ids so the rows cannot collide', () => {
    const { contracts } = rowsToContracts(rows, mapping)
    expect(new Set(contracts.map((c: Contract) => c.id)).size).toBe(3)
  })

  it('leaves the first occurrence id untouched', () => {
    const { contracts } = rowsToContracts(rows, mapping)
    expect(contracts[0].id).toBe('C001')
  })

  it('keeps every row as its own graph node', () => {
    const { contracts } = rowsToContracts(rows, mapping)
    const { nodes } = buildGraph(contracts, 100, 100)
    expect(nodes.filter(n => n.type === 'contract')).toHaveLength(3)
  })
})

/* ── findGaps without a graph ────────────────────────────────────────── */

describe('findGaps with no graph', () => {
  const register = [
    contract({ id: 'a', name: 'A', owner: undefined, annualValue: 150_000,
      endDate: new Date(Date.now() + 30 * 86400000) }),
    contract({ id: 'b', name: 'B', owner: 'Bo', supplier: 'Other', category: 'Facilities' }),
  ]

  it('populates nodeKeys when no nodes are supplied', () => {
    for (const g of findGaps(register)) {
      expect(g.nodeKeys.length, g.id).toBeGreaterThan(0)
    }
  })

  it('never reports a count of zero beside a real exposure', () => {
    for (const g of findGaps(register)) {
      if (g.exposure > 0) expect(g.contractCount, g.id).toBeGreaterThan(0)
    }
  })

  it('still narrows to the graph when nodes are supplied', () => {
    const { nodes } = buildGraph([register[1]], 100, 100)
    const orphan = findGaps(register, nodes).find(g => g.kind === 'no-owner')
    // Contract A is not in this graph, so its key is filtered out...
    expect(orphan?.nodeKeys ?? []).toHaveLength(0)
    // ...but the gap still knows how many contracts it covers.
    expect(orphan?.contractCount).toBe(1)
  })
})

/* ── Kraljic attribution ─────────────────────────────────────────────── */

describe('category brief attribution', () => {
  // "Telecom" the category vs "Telecom NL" the supplier — the substring trap.
  const register = [
    contract({ id: 't1', name: 'Lines', category: 'Telecom', supplier: 'Telecom NL',
      department: 'IT', annualValue: 400_000, owner: 'Ann' }),
    contract({ id: 't2', name: 'Mobile', category: 'Telecom', supplier: 'Telecom NL',
      department: 'HR', annualValue: 300_000, owner: 'Ann' }),
    contract({ id: 'o1', name: 'Desks', category: 'Facilities', supplier: 'DeskCo',
      department: 'Ops', annualValue: 50_000, owner: 'Bo' }),
  ]
  const stats = computeStatsByField(register, 'category', 'category')
  const telecom = stats.find(s => s.name === 'Telecom')!

  it('does not claim a supplier gap that merely shares a word with the category', () => {
    const brief = categoryBrief('Telecom', register, telecom, quadrantOf(0.9, 0.9), false)
    const singlePoint = brief.gaps.filter(g => g.kind === 'single-point')
    // The supplier gap is about Telecom NL, and its contracts are in this
    // category, so it may appear — but only via the contracts it names.
    for (const g of singlePoint) {
      expect(g.nodeKeys.some(k => {
        const id = contractIdFromKey(k)
        return id === 't1' || id === 't2'
      })).toBe(true)
    }
  })

  it('excludes gaps belonging to another category entirely', () => {
    const brief = categoryBrief('Telecom', register, telecom, quadrantOf(0.9, 0.9), false)
    expect(brief.gaps.some(g => g.id.includes('Facilities'))).toBe(false)
  })

  it('finds the category own no-competition gap', () => {
    const brief = categoryBrief('Telecom', register, telecom, quadrantOf(0.9, 0.9), false)
    expect(brief.gaps.some(g => g.id === 'gap:no-competition:Telecom')).toBe(true)
  })

  it('attributes opportunities by contract id, not title text', () => {
    const brief = categoryBrief('Telecom', register, telecom, quadrantOf(0.9, 0.9), false)
    for (const o of brief.opportunities) {
      expect(o.contractIds.some(id => id === 't1' || id === 't2')).toBe(true)
    }
  })
})

/* ── Calendar decidable window ───────────────────────────────────────── */

describe('decidable window', () => {
  const day = 86400000
  const now = new Date('2026-06-01T00:00:00Z')

  it('measures the decision date, not the end date', () => {
    const register = [
      // Notice deadline lands inside 90 days.
      contract({ id: 'near', name: 'Near', endDate: new Date(now.getTime() + 100 * day),
        noticePeriodDays: 30 }),
      // Notice deadline lands well beyond 90 days.
      contract({ id: 'far', name: 'Far', endDate: new Date(now.getTime() + 300 * day),
        noticePeriodDays: 30 }),
    ]
    const rows = timelineRows(register, fitWindow(register, now), now)
    const parts = partitionRows(rows, now)
    // 'near' ends in 100 days with 30 days' notice, so its decision date is
    // 70 days out; 'far' ends in 300 days, so its decision date is 270 days out.
    const within90 = decidableWithin(parts.decidable, 90, now)
    expect(within90.map(r => r.contract.id)).toEqual(['near'])
  })
})

/* ── Completeness must not count parser placeholders ─────────────────── */

describe('completeness honesty', () => {
  it('does not count a parser placeholder as a populated field', () => {
    const blank = contract({
      id: 'x', name: 'X',
      supplier: PLACEHOLDERS.supplier,
      category: PLACEHOLDERS.category,
      department: PLACEHOLDERS.department,
      owner: undefined, annualValue: undefined, endDate: undefined,
    })
    expect(fieldsPresent(blank)).toBe(0)
    expect(contractCompleteness(blank)).toBe(0)
  })

  it('counts a real value in the same field', () => {
    const real = contract({ id: 'y', name: 'Y', supplier: 'Acme',
      owner: undefined, annualValue: undefined, endDate: undefined,
      category: PLACEHOLDERS.category, department: PLACEHOLDERS.department })
    expect(fieldPresent(real, 'supplier')).toBe(true)
    expect(fieldPresent(real, 'category')).toBe(false)
  })

  it('reports a placeholder-only register as low quality, not high', () => {
    const rows = [['C1', 'Only a name', '']]
    const { contracts } = rowsToContracts(rows, { contract_id: 0, contract_name: 1 })
    // Three fields are placeholders, three are genuinely absent.
    expect(registerCompleteness(contracts)).toBe(0)
    expect(portfolioSummary(contracts).dataQuality).toBe(0)
  })

  it('agrees across the summary, the insight and the lens', () => {
    const rows = [['C1', 'A', 'Acme'], ['C2', 'B', '']]
    const { contracts } = rowsToContracts(rows, { contract_id: 0, contract_name: 1, supplier: 2 })
    const pct = Math.round(registerCompleteness(contracts) * 100)
    expect(portfolioSummary(contracts).dataQuality).toBe(pct)
    const { nodes } = buildGraph(contracts, 10, 10)
    const contractNodes = nodes.filter(n => n.type === 'contract')
    const lensAvg = contractNodes.reduce((s, n) => s + completeness(n), 0) / contractNodes.length
    expect(Math.round(lensAvg * 100)).toBe(pct)
  })

  it('treats whitespace as absent', () => {
    expect(fieldPresent(contract({ id: 'w', name: 'W', supplier: '   ' }), 'supplier')).toBe(false)
  })
})

/* ── metrics takes an injected clock ─────────────────────────────────── */

describe('metrics clock', () => {
  const day = 86400000
  const base = new Date('2026-06-01T00:00:00Z')
  const register = [contract({ id: 'e', name: 'E', endDate: new Date(base.getTime() + 30 * day) })]

  it('measures against the instant it is given', () => {
    expect(portfolioSummary(register, base).expiring90).toBe(1)
    expect(portfolioSummary(register, base).expired).toBe(0)
  })

  it('sees the same contract as expired once the clock passes it', () => {
    const later = new Date(base.getTime() + 60 * day)
    expect(portfolioSummary(register, later).expired).toBe(1)
    expect(portfolioSummary(register, later).expiring90).toBe(0)
  })

  it('threads the clock into per-entity stats too', () => {
    const later = new Date(base.getTime() + 60 * day)
    expect(computeStatsByField(register, 'department', 'department', base)[0].expired).toHaveLength(0)
    expect(computeStatsByField(register, 'department', 'department', later)[0].expired).toHaveLength(1)
  })
})

/* ── Savings range cannot contradict its own components ──────────────── */

describe('savings summary range', () => {
  it('never reports a low below what one opportunity alone guarantees', () => {
    const contracts = [contract({ id: 'c1', name: 'C1', annualValue: 100_000 })]
    const opps = [
      { kind: 'payment-terms', title: 'p', low: 12_000, high: 12_000,
        contractIds: ['c1'], assumption: '' },
      { kind: 'tail-consolidation', title: 't', low: 5_000, high: 15_000,
        contractIds: ['c1'], assumption: '' },
    ] as unknown as Parameters<typeof savingsSummary>[0]
    const s = savingsSummary(opps, contracts)
    // The payment opportunity alone guarantees 12k, so the floor cannot be 5k.
    expect(s.low).toBeGreaterThanOrEqual(12_000)
    expect(s.high).toBeGreaterThanOrEqual(s.low)
  })

  it('still counts each contract once, never exceeding its value', () => {
    const contracts = [contract({ id: 'c1', name: 'C1', annualValue: 100_000 })]
    const opps = [
      { kind: 'a', title: 'a', low: 10_000, high: 20_000, contractIds: ['c1'], assumption: '' },
      { kind: 'b', title: 'b', low: 30_000, high: 40_000, contractIds: ['c1'], assumption: '' },
    ] as unknown as Parameters<typeof savingsSummary>[0]
    expect(savingsSummary(opps, contracts).high).toBeLessThanOrEqual(100_000)
  })
})

/* ── ICS export conforms to RFC 5545 ─────────────────────────────────── */

describe('ICS export', () => {
  const day = 86400000
  const now = new Date('2026-06-01T00:00:00Z')
  const awkward = contract({
    id: 'c1', name: 'Cleaning, HQ; phase 2', supplier: 'Clean\\Co',
    endDate: new Date(now.getTime() + 100 * day), noticePeriodDays: 30,
  })
  const ics = () => icsEvents(timelineRows([awkward], fitWindow([awkward], now), now))

  it('escapes the separators that would truncate a value', () => {
    expect(icsText('a, b')).toBe('a\\, b')
    expect(icsText('a; b')).toBe('a\\; b')
    expect(icsText('a\\b')).toBe('a\\\\b')
    expect(icsText('a\nb')).toBe('a\\nb')
  })

  it('escapes a comma and semicolon in a real contract name', () => {
    const summary = ics().split('\r\n').find(l => l.startsWith('SUMMARY') && l.includes('Cleaning'))!
    expect(summary).toContain('Cleaning\\, HQ\\; phase 2')
  })

  it('escapes a backslash before anything else, so it is not doubled twice', () => {
    expect(ics()).toContain('Clean\\\\Co')
  })

  it('gives every event a non-zero duration', () => {
    // For DATE values DTEND is exclusive; DTSTART == DTEND is discarded by
    // Google Calendar and Outlook.
    const blocks = ics().split('BEGIN:VEVENT').slice(1)
    expect(blocks.length).toBeGreaterThan(0)
    for (const b of blocks) {
      const start = /DTSTART;VALUE=DATE:(\d{8})/.exec(b)![1]
      const end = /DTEND;VALUE=DATE:(\d{8})/.exec(b)![1]
      expect(end, b.slice(0, 60)).not.toBe(start)
      expect(Number(end)).toBeGreaterThan(Number(start))
    }
  })

  it('still emits one event per expiry and one per notice deadline', () => {
    expect(ics().split('BEGIN:VEVENT').length - 1).toBe(2)
  })
})
