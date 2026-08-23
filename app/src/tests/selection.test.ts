import { describe, it, expect } from 'vitest'
import type { Contract } from '../data/types'
import { buildGraph, relationTo } from '../graph/buildGraph'
import { selectionContext, contextKeys, RELATED_CONTRACT_CAP } from '../analytics/selection'

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
  contract({ name: 'A', supplier: 'BigCo', owner: 'Alice', department: 'Finance', category: 'IT', annualValue: 500_000 }),
  contract({ name: 'B', supplier: 'BigCo', owner: 'Bob', department: 'HR', category: 'People', annualValue: 300_000 }),
  contract({ name: 'C', supplier: 'Tiny', owner: 'Alice', department: 'Finance', category: 'IT', annualValue: 50_000 }),
]
const { nodes, links } = buildGraph(portfolio, 900, 600)
const at = (k: string) => nodes.find(n => n.key === k)!

describe('relationTo', () => {
  it('names the relation after the entity it leads to', () => {
    expect(relationTo('supplier')).toBe('supplies')
    expect(relationTo('owner')).toBe('owned-by')
    expect(relationTo('category')).toBe('in-category')
    expect(relationTo('department')).toBe('in-department')
    expect(relationTo('contract')).toBe('contract-of')
  })
})

describe('buildGraph link relations', () => {
  it('tags every link with a relation', () => {
    expect(links.length).toBeGreaterThan(0)
    for (const l of links) expect(l.relation).toBeTruthy()
  })

  it('names a contract-to-owner link after the owner', () => {
    const l = links.find(x =>
      (x.source.key === 'contract::A' && x.target.key === 'owner::Alice') ||
      (x.target.key === 'contract::A' && x.source.key === 'owner::Alice'))!
    expect(l.relation).toBe('owned-by')
  })
})

describe('selectionContext', () => {
  it('marks the selected node as core', () => {
    const ctx = selectionContext(at('supplier::BigCo'))
    expect(ctx.core).toBe('supplier::BigCo')
    expect(ctx.tiers.get('supplier::BigCo')).toBe('core')
  })

  it('tags direct neighbours with the relation leading to them', () => {
    const ctx = selectionContext(at('contract::A'))
    expect(ctx.tiers.get('supplier::BigCo')).toBe('direct')
    expect(ctx.relations.get('supplier::BigCo')).toBe('supplies')
    expect(ctx.relations.get('owner::Alice')).toBe('owned-by')
    expect(ctx.relations.get('department::Finance')).toBe('in-department')
    expect(ctx.relations.get('category::IT')).toBe('in-category')
  })

  it('tags a supplier\'s contracts as direct contract-of', () => {
    const ctx = selectionContext(at('supplier::BigCo'))
    expect(ctx.tiers.get('contract::A')).toBe('direct')
    expect(ctx.relations.get('contract::A')).toBe('contract-of')
  })

  it('reaches owners through a supplier\'s contracts as related', () => {
    const ctx = selectionContext(at('supplier::BigCo'))
    // BigCo has no direct link to owners; they sit behind contracts A and B.
    expect(ctx.tiers.get('owner::Alice')).toBe('related')
    expect(ctx.tiers.get('owner::Bob')).toBe('related')
  })

  it('surfaces sibling contracts when a contract is selected', () => {
    const ctx = selectionContext(at('contract::A'))
    // C shares both Finance and IT with A.
    expect(ctx.tiers.get('contract::C')).toBe('related')
    // B shares neither.
    expect(ctx.tiers.get('contract::B')).toBeUndefined()
  })

  it('never downgrades a direct neighbour to related', () => {
    const ctx = selectionContext(at('contract::A'))
    for (const [key, tier] of ctx.tiers) {
      if (ctx.relations.has(key)) expect(tier).toBe('direct')
    }
  })

  it('caps sibling contracts so a large department cannot flood the view', () => {
    const big: Contract[] = Array.from({ length: 30 }, (_, i) =>
      contract({ name: `Big ${i}`, department: 'Ops', category: 'Bulk', annualValue: i * 1000 })
    )
    const g = buildGraph(big, 900, 600)
    const ctx = selectionContext(g.nodes.find(n => n.key === 'contract::Big 0')!)
    const relatedContracts = [...ctx.tiers.entries()]
      .filter(([k, t]) => t === 'related' && k.startsWith('contract::'))
    expect(relatedContracts.length).toBeLessThanOrEqual(RELATED_CONTRACT_CAP)
  })

  it('prefers the highest-value siblings when capping', () => {
    const many: Contract[] = Array.from({ length: 20 }, (_, i) =>
      contract({ name: `V${i}`, department: 'Ops', category: 'Bulk', annualValue: i * 1000 })
    )
    const g = buildGraph(many, 900, 600)
    const ctx = selectionContext(g.nodes.find(n => n.key === 'contract::V0')!)
    // V19 is the most valuable sibling and must survive the cap; V1 the least.
    expect(ctx.tiers.get('contract::V19')).toBe('related')
    expect(ctx.tiers.get('contract::V1')).toBeUndefined()
  })

  it('handles an isolated node without throwing', () => {
    const solo = buildGraph([contract({ name: 'Solo' })], 900, 600)
    const ctx = selectionContext(solo.nodes.find(n => n.key === 'owner::Alice')!)
    expect(ctx.tiers.get('owner::Alice')).toBe('core')
    expect(contextKeys(ctx).size).toBeGreaterThan(0)
  })
})

describe('contextKeys', () => {
  it('flattens every tier into one membership set', () => {
    const ctx = selectionContext(at('supplier::BigCo'))
    const keys = contextKeys(ctx)
    expect(keys.has('supplier::BigCo')).toBe(true)
    expect(keys.has('contract::A')).toBe(true)
    expect(keys.size).toBe(ctx.tiers.size)
  })
})
