import { describe, it, expect } from 'vitest'
import type { Contract } from '../data/types'
import { buildGraph } from '../graph/buildGraph'
import { computeCentrality, egoNetwork, assessImpact, departmentReach } from '../analytics/centrality'
import { lensStyle, buildLensContext, completeness, lensForCategory, LENSES } from '../analytics/lenses'

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

const portfolio: Contract[] = [
  contract({ name: 'A', supplier: 'BigCo', department: 'Finance', category: 'IT', annualValue: 500_000 }),
  contract({ name: 'B', supplier: 'BigCo', department: 'HR', category: 'People', annualValue: 300_000 }),
  contract({ name: 'C', supplier: 'BigCo', department: 'Legal', category: 'Legal', annualValue: 200_000 }),
  contract({ name: 'D', supplier: 'Tiny', department: 'Finance', category: 'IT', annualValue: 1_000 }),
]

const { nodes } = buildGraph(portfolio, 900, 600)
const nodeByKey = (k: string) => nodes.find(n => n.key === k)!

describe('departmentReach', () => {
  it('counts every department a supplier touches', () => {
    expect(departmentReach(nodeByKey('supplier::BigCo'))).toBe(3)
  })

  it('counts one for a contained supplier', () => {
    expect(departmentReach(nodeByKey('supplier::Tiny'))).toBe(1)
  })
})

describe('computeCentrality', () => {
  it('ranks the systemic supplier above the contained one', () => {
    const ranked = computeCentrality(nodes, 'supplier')
    expect(ranked[0].name).toBe('BigCo')
    expect(ranked[0].systemicScore).toBeGreaterThan(ranked[1].systemicScore)
  })

  it('returns an empty list when no nodes match the type', () => {
    expect(computeCentrality([], 'supplier')).toEqual([])
  })
})

describe('egoNetwork', () => {
  it('includes the node itself and its direct neighbours at one hop', () => {
    const ego = egoNetwork(nodeByKey('supplier::Tiny'), 1)
    expect(ego.has('supplier::Tiny')).toBe(true)
    expect(ego.has('contract::D')).toBe(true)
    expect(ego.has('contract::A')).toBe(false)
  })

  it('reaches further at two hops', () => {
    const one = egoNetwork(nodeByKey('supplier::Tiny'), 1)
    const two = egoNetwork(nodeByKey('supplier::Tiny'), 2)
    expect(two.size).toBeGreaterThan(one.size)
    expect(two.has('department::Finance')).toBe(true)
  })
})

describe('assessImpact', () => {
  it('totals the blast radius of losing a supplier', () => {
    const impact = assessImpact(nodeByKey('supplier::BigCo'), 1_001_000)
    expect(impact.contractCount).toBe(3)
    expect(impact.annualValue).toBe(1_000_000)
    expect(impact.departments).toEqual(['Finance', 'HR', 'Legal'])
    expect(impact.spendShare).toBeCloseTo(0.999, 2)
  })

  it('handles a zero-spend portfolio without dividing by zero', () => {
    expect(assessImpact(nodeByKey('supplier::Tiny'), 0).spendShare).toBe(0)
  })
})

describe('completeness', () => {
  it('reports a fully populated contract as complete', () => {
    const full = buildGraph([contract({ name: 'Full', endDate: new Date() })], 10, 10)
    expect(completeness(full.nodes.find(n => n.key === 'contract::Full')!)).toBe(1)
  })

  it('reports a sparse contract as incomplete', () => {
    const bare = buildGraph(
      [{ id: 'z', name: 'Bare', supplier: '', category: '', department: '', tags: [], raw: {} }],
      10, 10
    )
    expect(completeness(bare.nodes.find(n => n.key === 'contract::Bare')!)).toBeLessThan(0.5)
  })
})

describe('lensStyle', () => {
  const ctx = buildLensContext(nodes)

  it('gives every lens a colour for every node', () => {
    for (const lens of LENSES) {
      for (const n of nodes) {
        const style = lensStyle(n, lens.id, ctx)
        expect(style.color).toMatch(/^#[0-9a-fA-F]{6}$/)
        expect(style.sizeMult).toBeGreaterThan(0)
      }
    }
  })

  it('colours high-spend nodes more brightly than low-spend ones under the spend lens', () => {
    const big = lensStyle(nodeByKey('supplier::BigCo'), 'spend', ctx)
    const small = lensStyle(nodeByKey('supplier::Tiny'), 'spend', ctx)
    expect(big.color).not.toBe(small.color)
    expect(big.sizeMult).toBeGreaterThan(small.sizeMult)
  })

  it('marks the systemic supplier under the concentration lens', () => {
    const big = lensStyle(nodeByKey('supplier::BigCo'), 'concentration', ctx)
    const small = lensStyle(nodeByKey('supplier::Tiny'), 'concentration', ctx)
    expect(big.color).toBe('#C026D3')
    expect(big.labelAlways).toBe(true)
    expect(small.color).not.toBe('#C026D3')
  })

  it('falls back to type colours under the structure lens', () => {
    expect(lensStyle(nodeByKey('department::Finance'), 'structure', ctx).color).toBe('#4da3ff')
  })
})

describe('lensForCategory', () => {
  it('maps insight categories to the lens that shows them', () => {
    expect(lensForCategory('concentration')).toBe('concentration')
    expect(lensForCategory('renewal')).toBe('expiry')
    expect(lensForCategory('data')).toBe('data')
    expect(lensForCategory('nonsense')).toBe('structure')
  })
})
