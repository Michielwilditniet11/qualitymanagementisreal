import { describe, it, expect } from 'vitest'
import { buildGraph, contractKey, contractIdFromKey, entityKey } from '../graph/buildGraph'
import { rowsToContracts } from '../data/parser'
import { findGaps } from '../analytics/gaps'
import { categoryBrief, quadrantOf } from '../analytics/kraljicBrief'
import { computeStatsByField } from '../data/metrics'
import { partitionRows, timelineRows, fitWindow, decidableWithin } from '../analytics/timeline'
import type { Contract } from '../data/types'

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
