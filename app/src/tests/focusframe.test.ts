import { describe, it, expect } from 'vitest'
import { buildGraph } from '../graph/buildGraph'
import {
  buildFocusFrame, connectiveClosure, linksWithin, linkId, frameMembers,
  CONTEXT_CAP,
} from '../analytics/focusFrame'
import { lensBriefing } from '../analytics/briefings'
import { generateInsights } from '../analytics/insights'
import { findGaps } from '../analytics/gaps'
import type { LensId } from '../analytics/lenses'
import type { Contract } from '../data/types'
import { fitText } from '../graph/lib/nodeFactory'

function contract(p: Partial<Contract> & { name: string }): Contract {
  return {
    id: p.name, name: p.name,
    supplier: p.supplier ?? 'Acme',
    category: p.category ?? 'IT',
    department: p.department ?? 'Ops',
    owner: p.owner, annualValue: p.annualValue ?? 100_000,
    startDate: p.startDate, endDate: p.endDate,
    noticePeriodDays: p.noticePeriodDays, autoRenew: p.autoRenew,
    status: p.status, paymentTerms: p.paymentTerms,
    tags: [], raw: p.raw ?? {},
  }
}

/** Two contracts in one department: the department is their shared hub. */
const PAIR = [
  contract({ name: 'A', department: 'IT', category: 'Software', supplier: 'S1', owner: 'Ann' }),
  contract({ name: 'B', department: 'IT', category: 'Hardware', supplier: 'S2', owner: 'Bo' }),
]

const ALL_LENSES: LensId[] = [
  'structure', 'spend', 'risk', 'expiry', 'concentration', 'gaps', 'data',
]

/** A register broad enough that every lens finds something. */
function sampleRegister(): Contract[] {
  const now = Date.now()
  const day = 86400000
  return [
    contract({ name: 'SAP support', department: 'IT', category: 'Software', supplier: 'SoftServe', owner: 'Ann', annualValue: 400_000, endDate: new Date(now + 20 * day), noticePeriodDays: 90, autoRenew: true }),
    contract({ name: 'Laptops', department: 'IT', category: 'Hardware', supplier: 'TechLease', owner: 'Ann', annualValue: 240_000, endDate: new Date(now + 60 * day) }),
    contract({ name: 'Staffing NL', department: 'HR', category: 'Staffing', supplier: 'FlexForce', annualValue: 300_000, endDate: new Date(now + 400 * day) }),
    contract({ name: 'Staffing DE', department: 'Ops', category: 'Staffing', supplier: 'FlexForce', annualValue: 200_000, endDate: new Date(now + 500 * day) }),
    contract({ name: 'Staffing FR', department: 'Finance', category: 'Staffing', supplier: 'FlexForce', annualValue: 195_000 }),
    // A notice window still open, so the expiry lens has something to name.
    contract({ name: 'Energy', department: 'Facilities', category: 'Energy', supplier: 'GreenEnergy', owner: 'Cy', annualValue: 520_000, endDate: new Date(now + 200 * day), noticePeriodDays: 30, autoRenew: true }),
    contract({ name: 'Cleaning', department: 'Facilities', category: 'Services', supplier: 'CleanCo', annualValue: 40_000 }),
    contract({ name: 'Print', department: 'Marketing', category: 'Print', supplier: 'PrintPlus', annualValue: 15_000 }),
  ]
}

describe('connectiveClosure', () => {
  it('finds the hub two seeds share', () => {
    const { nodes } = buildGraph(PAIR, 100, 100)
    const seeds = ['contract::A', 'contract::B']
    const { contextKeys } = connectiveClosure(seeds, nodes)
    expect(contextKeys).toContain('department::IT')
  })

  it('ranks shared hubs above nodes touching a single seed', () => {
    const { nodes } = buildGraph(PAIR, 100, 100)
    const { contextKeys } = connectiveClosure(['contract::A', 'contract::B'], nodes)
    // The shared department outranks each contract's private supplier.
    expect(contextKeys).toContain('supplier::S1')
    expect(contextKeys.indexOf('department::IT'))
      .toBeLessThan(contextKeys.indexOf('supplier::S1'))
  })

  it('reaches the departments an entity serves, two hops out', () => {
    const { nodes } = buildGraph([
      contract({ name: 'A', department: 'HR', supplier: 'Flex' }),
      contract({ name: 'B', department: 'Ops', supplier: 'Flex' }),
    ], 100, 100)
    const { contextKeys } = connectiveClosure(['supplier::Flex'], nodes)
    // One hop would stop at the contracts and answer nothing.
    expect(contextKeys).toContain('department::HR')
    expect(contextKeys).toContain('department::Ops')
  })

  it('gives a lone seed its own neighbourhood, so the frame still has links', () => {
    const { nodes } = buildGraph(PAIR, 100, 100)
    const { contextKeys } = connectiveClosure(['contract::A'], nodes)
    expect(contextKeys).toContain('supplier::S1')
    expect(contextKeys).toContain('department::IT')
  })

  it('rescues a seed that shares nothing with the others', () => {
    const cs = [
      ...PAIR,
      contract({ name: 'Z', department: 'Legal', category: 'Advice', supplier: 'S9' }),
    ]
    const { nodes } = buildGraph(cs, 100, 100)
    const { contextKeys } = connectiveClosure(
      ['contract::A', 'contract::B', 'contract::Z'], nodes)
    // Z would otherwise float unconnected.
    expect(contextKeys).toContain('department::Legal')
  })

  it('caps the context and reports truncation', () => {
    const many = Array.from({ length: 60 }, (_, i) =>
      contract({ name: `C${i}`, department: 'IT', category: `Cat${i}`, supplier: `Sup${i}` }))
    const { nodes } = buildGraph(many, 100, 100)
    const seeds = many.map(c => `contract::${c.name}`)
    const { contextKeys, truncated } = connectiveClosure(seeds, nodes, 10)
    expect(contextKeys).toHaveLength(10)
    expect(truncated).toBe(true)
    // The shared department is the most-touched node, so it survives the cap.
    expect(contextKeys).toContain('department::IT')
  })

  it('returns nothing for seeds that do not exist', () => {
    const { nodes } = buildGraph(PAIR, 100, 100)
    expect(connectiveClosure(['contract::nope'], nodes).contextKeys).toEqual([])
  })
})

describe('linksWithin', () => {
  it('collects only links with both ends inside the member set', () => {
    const { nodes, links } = buildGraph(PAIR, 100, 100)
    const members = new Set(['contract::A', 'department::IT'])
    const within = linksWithin(members, links)
    expect(within).toContain(linkId('contract::A', 'department::IT'))
    expect(within.some(k => k.includes('supplier::S1'))).toBe(false)
    expect(nodes.length).toBeGreaterThan(0)
  })

  it('deduplicates undirected links', () => {
    const { links } = buildGraph(PAIR, 100, 100)
    const all = linksWithin(new Set(links.flatMap(l => [l.source.key, l.target.key])), links)
    expect(new Set(all).size).toBe(all.length)
  })
})

describe('buildFocusFrame', () => {
  const register = sampleRegister()
  const { nodes, links } = buildGraph(register, 100, 100)

  /* This is the regression test for the dead briefing chips: every item of
     every lens must produce a frame that actually shows relationships. */
  it('every briefing item of every lens yields a frame with links', () => {
    for (const lens of ALL_LENSES) {
      const briefing = lensBriefing(lens, register, nodes)
      expect(briefing.items.length).toBeGreaterThan(0)
      briefing.items.forEach((item, index) => {
        const f = buildFocusFrame({ kind: 'briefing', lens, item, index }, nodes, links, register)
        expect(f, `${lens}[${index}] produced no frame`).not.toBeNull()
        expect(f!.seedKeys.length, `${lens}[${index}] has no seeds`).toBeGreaterThan(0)
        expect(f!.linkKeys.length, `${lens}[${index}] has no links`).toBeGreaterThan(0)
        expect(f!.caption.length).toBeGreaterThan(0)
      })
    }
  })

  it('the portfolio-statement briefing item is no longer a dead click', () => {
    const briefing = lensBriefing('structure', register, nodes)
    const item = briefing.items.find(i => i.nodeKeys.length === 0)
    expect(item, 'expected a keyless portfolio item').toBeDefined()
    const f = buildFocusFrame(
      { kind: 'briefing', lens: 'structure', item: item!, index: 1 }, nodes, links, register)!
    expect(f.seedKeys.length).toBeGreaterThan(1)
    expect(f.linkKeys.length).toBeGreaterThan(0)
  })

  it('frames every insight with relationships intact', () => {
    const insights = generateInsights(register)
    expect(insights.length).toBeGreaterThan(0)
    for (const insight of insights) {
      const f = buildFocusFrame({ kind: 'insight', insight }, nodes, links, register)!
      expect(f).not.toBeNull()
      expect(f.linkKeys.length, `${insight.id} has no links`).toBeGreaterThan(0)
      expect(f.id).toBe(`insight:${insight.id}`)
    }
  })

  it('frames every gap', () => {
    const gaps = findGaps(register, nodes)
    for (const gap of gaps) {
      const f = buildFocusFrame({ kind: 'gap', gap }, nodes, links, register)!
      expect(f.lens).toBe('gaps')
      expect(f.linkKeys.length).toBeGreaterThan(0)
    }
  })

  it('resolves keys that differ only by surrounding space or case', () => {
    const f = buildFocusFrame(
      { kind: 'briefing', lens: 'structure', index: 0,
        item: { label: 'x', figure: 'y', nodeKeys: ['department::  it  '] } },
      nodes, links, register)!
    expect(f.seedKeys).toEqual(['department::IT'])
  })

  it('falls back to the portfolio rather than producing a dead frame', () => {
    const f = buildFocusFrame(
      { kind: 'briefing', lens: 'structure', index: 0,
        item: { label: 'x', figure: 'y', nodeKeys: ['supplier::does-not-exist'] } },
      nodes, links, register)!
    expect(f.seedKeys.length).toBeGreaterThan(0)
    expect(f.linkKeys.length).toBeGreaterThan(0)
    expect(f.caption).toMatch(/not in the current view/)
  })

  it('never lets a frame exceed the cap', () => {
    const insights = generateInsights(register)
    for (const insight of insights) {
      const f = buildFocusFrame({ kind: 'insight', insight }, nodes, links, register, 5)!
      expect(f.contextKeys.length).toBeLessThanOrEqual(5)
    }
  })

  it('says so in the caption when the context is capped', () => {
    const insight = generateInsights(register)
      .find(i => i.nodeKeys.length > 3)
    if (!insight) return
    const f = buildFocusFrame({ kind: 'insight', insight }, nodes, links, register, 2)!
    if (f.truncated) expect(f.caption).toMatch(/most connected/)
  })

  it('carries a legend covering the types actually in the frame', () => {
    const f = buildFocusFrame({ kind: 'entity', nodeKey: 'supplier::FlexForce' }, nodes, links, register)!
    const meanings = f.legend.map(l => l.meaning)
    expect(meanings.some(m => /department/.test(m))).toBe(true)
    expect(f.legend.every(l => /^#[0-9A-Fa-f]{6}$/.test(l.color))).toBe(true)
  })

  it('frames an entity with its neighbourhood', () => {
    const f = buildFocusFrame({ kind: 'entity', nodeKey: 'supplier::FlexForce' }, nodes, links, register)!
    expect(f.seedKeys).toEqual(['supplier::FlexForce'])
    // FlexForce serves three departments — they must all be in the frame.
    const members = frameMembers(f)
    expect(members.has('department::HR')).toBe(true)
    expect(members.has('department::Ops')).toBe(true)
    expect(members.has('department::Finance')).toBe(true)
  })

  it('carries the origin into the caption when arriving from another tab', () => {
    const f = buildFocusFrame(
      { kind: 'entity', nodeKey: 'supplier::FlexForce', origin: 'From Diagnostics.' },
      nodes, links, register)!
    expect(f.caption).toMatch(/^From Diagnostics\./)
  })

  it('frames the expiring KPI as contracts plus what they leave behind', () => {
    const f = buildFocusFrame({ kind: 'kpi', metric: 'expiring' }, nodes, links, register)!
    expect(f.lens).toBe('expiry')
    expect(f.seedKeys.length).toBeGreaterThan(0)
    expect(f.crossLinks.some(c => c.target === 'calendar')).toBe(true)
  })

  it('is stable: the same source rebuilds to the same id', () => {
    const insight = generateInsights(register)[0]
    const a = buildFocusFrame({ kind: 'insight', insight }, nodes, links, register)!
    const b = buildFocusFrame({ kind: 'insight', insight }, nodes, links, register)!
    expect(a.id).toBe(b.id)
  })

  it('defaults the cap to CONTEXT_CAP', () => {
    expect(CONTEXT_CAP).toBeGreaterThan(0)
    const f = buildFocusFrame({ kind: 'kpi', metric: 'spend' }, nodes, links, register)!
    expect(f.contextKeys.length).toBeLessThanOrEqual(CONTEXT_CAP)
  })
})

describe('fitText', () => {
  /** A stand-in for a canvas context: every character is 10 units wide. */
  const measurer = { measureText: (t: string) => ({ width: t.length * 10 }) }

  it('leaves text that already fits alone', () => {
    expect(fitText(measurer, 'short', 100)).toBe('short')
  })

  it('ellipsises text that overruns, and the result fits', () => {
    const out = fitText(measurer, 'a very long contract name indeed', 100)
    expect(out.endsWith('…')).toBe(true)
    expect(measurer.measureText(out).width).toBeLessThanOrEqual(100)
  })

  it('keeps as much of the name as will fit', () => {
    // 100 units = 10 chars, of which one is the ellipsis.
    expect(fitText(measurer, 'abcdefghijklmnop', 100)).toBe('abcdefghi…')
  })

  it('never returns something wider than the budget, even when tiny', () => {
    const out = fitText(measurer, 'abcdef', 5)
    expect(measurer.measureText(out).width).toBeLessThanOrEqual(10)
  })

  it('handles an empty string', () => {
    expect(fitText(measurer, '', 100)).toBe('')
  })
})
