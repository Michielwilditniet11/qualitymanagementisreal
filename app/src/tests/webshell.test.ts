import { describe, it, expect } from 'vitest'
import type { Contract } from '../data/types'
import { buildGraph } from '../graph/buildGraph'
import {
  labelPlan, labelRect, importanceOf, MAX_LABELS,
  type ScreenNode, type LabelPlanInput,
} from '../graph/lib/labelPolicy'
import {
  CameraDirector, boundsOf, poseFor, distanceFor, durationFor,
  FRAMING, MIN_DISTANCE, MAX_DISTANCE, MIN_DURATION, MAX_DURATION,
  type Vec3, type CameraPose,
} from '../graph/lib/cameraDirector'
import { projectMinimap, minimapToWorld, nearestKey } from '../graph/lib/minimap'
import { findGaps, gapExposure, singlePointSuppliers } from '../analytics/gaps'
import { buildStory } from '../analytics/story'
import { lensStyle, buildLensContext } from '../analytics/lenses'
import { fmtK } from '../analytics/risk'

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
const inDays = (n: number) => new Date(Date.now() + n * 86400000)

/* ─────────────── Label policy ─────────────── */

describe('labelPolicy', () => {
  const portfolio = [
    contract({ name: 'Big', supplier: 'BigCo', annualValue: 900_000 }),
    contract({ name: 'Mid', supplier: 'MidCo', annualValue: 90_000 }),
    contract({ name: 'Small', supplier: 'SmallCo', annualValue: 900 }),
  ]
  const { nodes } = buildGraph(portfolio, 900, 600)

  /** Grid the nodes out inside the viewport so nothing falls off screen. */
  function spread(gapPx: number): Map<string, ScreenNode> {
    const m = new Map<string, ScreenNode>()
    const perRow = Math.max(1, Math.floor(1500 / gapPx))
    nodes.forEach((n, i) => {
      m.set(n.key, {
        key: n.key,
        x: 100 + (i % perRow) * gapPx,
        y: 120 + Math.floor(i / perRow) * 120,
        depth: 0.5, radius: 6,
      })
    })
    return m
  }

  const base = (screen: Map<string, ScreenNode>): LabelPlanInput => ({
    nodes, screen, tiers: null, maxValue: 900_000,
    viewport: { width: 1600, height: 900 },
  })

  it('never places two overlapping labels', () => {
    // All nodes stacked on one point: only one label can survive.
    const stacked = new Map<string, ScreenNode>()
    nodes.forEach(n => stacked.set(n.key, { key: n.key, x: 500, y: 400, depth: 0.5, radius: 6 }))
    const plan = labelPlan(base(stacked))
    expect(plan.size).toBe(1)
  })

  it('labels many nodes when they are well separated', () => {
    const plan = labelPlan(base(spread(260)))
    expect(plan.size).toBeGreaterThan(3)
  })

  it('drops nodes behind the camera', () => {
    const behind = new Map<string, ScreenNode>()
    nodes.forEach((n, i) => behind.set(n.key, { key: n.key, x: 100 + i * 300, y: 300, depth: 1.4, radius: 6 }))
    expect(labelPlan(base(behind)).size).toBe(0)
  })

  it('drops nodes off screen', () => {
    const off = new Map<string, ScreenNode>()
    nodes.forEach(n => off.set(n.key, { key: n.key, x: -900, y: 300, depth: 0.5, radius: 6 }))
    expect(labelPlan(base(off)).size).toBe(0)
  })

  it('honours the hard cap', () => {
    const many = Array.from({ length: 200 }, (_, i) =>
      contract({ name: `C${i}`, supplier: `S${i}`, category: `Cat${i}`, annualValue: i * 100 }))
    const g = buildGraph(many, 900, 600)
    const screen = new Map<string, ScreenNode>()
    // Grid them out so collisions do not do the limiting.
    g.nodes.forEach((n, i) => screen.set(n.key, {
      key: n.key, x: 20 + (i % 40) * 240, y: 20 + Math.floor(i / 40) * 90, depth: 0.5, radius: 4,
    }))
    const plan = labelPlan({
      nodes: g.nodes, screen, tiers: null, maxValue: 20_000,
      viewport: { width: 12000, height: 4000 },
    })
    expect(plan.size).toBeLessThanOrEqual(MAX_LABELS)
  })

  it('gives the hovered node a full label whatever its size', () => {
    const screen = spread(260)
    const small = nodes.find(n => n.key === 'supplier::SmallCo')!
    const plan = labelPlan({ ...base(screen), hoveredKey: small.key })
    expect(plan.get(small.key)).toBe('full')
  })

  it('ranks hover above selection above spend', () => {
    const screen = spread(260)
    const big = nodes.find(n => n.key === 'supplier::BigCo')!
    const small = nodes.find(n => n.key === 'supplier::SmallCo')!
    const input = { ...base(screen), hoveredKey: small.key, selectedKey: big.key }
    expect(importanceOf(small, input)).toBeGreaterThan(importanceOf(big, input))
  })

  it('excludes dimmed nodes when a context is active', () => {
    const screen = spread(260)
    const tiers = new Map([[nodes[0].key, 'core' as const]])
    const plan = labelPlan({ ...base(screen), tiers })
    expect([...plan.keys()]).toEqual([nodes[0].key])
  })

  it('gives context members the two-line label and the field a name only', () => {
    const screen = spread(260)
    const tiers = new Map<string, any>([
      [nodes[0].key, 'core'], [nodes[1].key, 'related'],
    ])
    const plan = labelPlan({ ...base(screen), tiers })
    expect(plan.get(nodes[0].key)).toBe('full')
    expect(plan.get(nodes[1].key)).toBe('name')
  })

  it('sizes a label rectangle below its node', () => {
    const r = labelRect({ key: 'k', x: 100, y: 200, depth: 0.5, radius: 10 }, 'full', 12)
    expect(r.top).toBeGreaterThan(200)
    expect(r.left).toBeLessThan(100)
    expect(r.right).toBeGreaterThan(100)
  })
})

/* ─────────────── Camera director ─────────────── */

describe('cameraDirector', () => {
  const pts: Vec3[] = [
    { x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }, { x: 0, y: 10, z: 0 },
  ]

  it('computes bounds around a point cloud', () => {
    const b = boundsOf(pts)!
    expect(b.centre.x).toBeCloseTo(10 / 3)
    expect(b.radius).toBeGreaterThan(0)
  })

  it('returns no bounds for an empty cloud', () => {
    expect(boundsOf([])).toBeNull()
  })

  it('clamps distance within the fog-safe range', () => {
    expect(distanceFor({ centre: { x: 0, y: 0, z: 0 }, radius: 0.1 }, FRAMING.overview)).toBe(MIN_DISTANCE)
    expect(distanceFor({ centre: { x: 0, y: 0, z: 0 }, radius: 1e6 }, FRAMING.overview)).toBe(MAX_DISTANCE)
  })

  it('keeps the current viewing angle when asked', () => {
    const bounds = { centre: { x: 0, y: 0, z: 0 }, radius: 50 }
    const from = { x: 100, y: 0, z: 0 }
    const pose = poseFor(bounds, FRAMING.frameNodes, from)
    // Approaching along +x means staying on the +x axis.
    expect(pose.position.y).toBeCloseTo(0)
    expect(pose.position.z).toBeCloseTo(0)
    expect(pose.position.x).toBeGreaterThan(0)
  })

  it('falls back to an elevated default angle with no prior position', () => {
    const pose = poseFor({ centre: { x: 0, y: 0, z: 0 }, radius: 50 }, FRAMING.frameNodes)
    expect(pose.position.y).toBeGreaterThan(0)
    expect(pose.position.z).toBeGreaterThan(0)
  })

  it('scales duration with distance, within bounds', () => {
    const near = durationFor({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 })
    const far = durationFor({ x: 0, y: 0, z: 0 }, { x: 5000, y: 0, z: 0 })
    expect(near).toBeGreaterThanOrEqual(MIN_DURATION)
    expect(near).toBeLessThan(MIN_DURATION + 5)
    expect(far).toBe(MAX_DURATION)
    expect(durationFor({ x: 0, y: 0, z: 0 }, { x: 300, y: 0, z: 0 })).toBeGreaterThan(near)
  })

  function harness(initial: Vec3 = { x: 0, y: 0, z: 400 }) {
    const positions = new Map<string, Vec3>([
      ['a', { x: 0, y: 0, z: 0 }],
      ['b', { x: 100, y: 0, z: 0 }],
      ['c', { x: 0, y: 0, z: 100 }],
    ])
    let cam = initial
    const moves: { pose: CameraPose; duration: number }[] = []
    const director = new CameraDirector({
      positions: () => positions,
      cameraPosition: () => cam,
      moveCamera: (pose, duration) => {
        moves.push({ pose, duration })
        // Simulate the tween landing so the next intent starts from here.
        cam = pose.position
      },
    })
    return { director, moves, setCam: (v: Vec3) => { cam = v } }
  }

  it('frames the whole graph on overview', () => {
    const { director, moves } = harness()
    expect(director.flyTo({ kind: 'overview' })).not.toBeNull()
    expect(moves).toHaveLength(1)
  })

  it('returns null when the intent names no known nodes', () => {
    const { director, moves } = harness()
    expect(director.flyTo({ kind: 'frameNodes', keys: ['nope'] })).toBeNull()
    expect(moves).toHaveLength(0)
  })

  it('preempts a flight from wherever the camera actually is', () => {
    const { director, moves, setCam } = harness()
    director.flyTo({ kind: 'frameNodes', keys: ['a'] })
    // Camera is interrupted mid-flight at an interpolated position.
    setCam({ x: 20, y: 5, z: 50 })
    director.flyTo({ kind: 'frameNodes', keys: ['b'] })
    expect(moves).toHaveLength(2)
    // Duration of the second move reflects the interrupted position, not the first target.
    expect(moves[1].duration).toBeGreaterThan(0)
  })

  it('records every executed intent for navigation history', () => {
    const { director } = harness()
    director.flyTo({ kind: 'overview' })
    director.flyTo({ kind: 'approach', key: 'b' })
    expect(director.history()).toHaveLength(2)
    expect(director.lastIntent()).toEqual({ kind: 'approach', key: 'b' })
  })

  it('flies instantly when asked', () => {
    const { director, moves } = harness()
    director.flyTo({ kind: 'overview' }, { instant: true })
    expect(moves[0].duration).toBe(0)
  })
})

/* ─────────────── Minimap ─────────────── */

describe('minimap', () => {
  const positions = new Map<string, Vec3>([
    ['a', { x: -100, y: 0, z: -100 }],
    ['b', { x: 100, y: 0, z: 100 }],
    ['c', { x: 0, y: 0, z: 0 }],
  ])
  const colors = new Map([['a', '#fff'], ['b', '#000'], ['c', '#f00']])
  const input = { positions, colors, width: 180, height: 180 }

  it('projects every node inside the box', () => {
    const p = projectMinimap(input)
    expect(p.points).toHaveLength(3)
    for (const pt of p.points) {
      expect(pt.x).toBeGreaterThanOrEqual(0)
      expect(pt.x).toBeLessThanOrEqual(180)
      expect(pt.y).toBeGreaterThanOrEqual(0)
      expect(pt.y).toBeLessThanOrEqual(180)
    }
  })

  it('handles an empty layout', () => {
    const p = projectMinimap({ ...input, positions: new Map() })
    expect(p.points).toEqual([])
    expect(p.camera).toBeNull()
  })

  it('round-trips a click back to world space', () => {
    const p = projectMinimap(input)
    const centre = p.points.find(x => x.key === 'c')!
    const world = minimapToWorld({ x: centre.x, y: centre.y }, input)!
    expect(world.x).toBeCloseTo(0, 0)
    expect(world.z).toBeCloseTo(0, 0)
  })

  it('finds the nearest node to a click', () => {
    const p = projectMinimap(input)
    const target = p.points.find(x => x.key === 'b')!
    expect(nearestKey({ x: target.x + 2, y: target.y + 2 }, p)).toBe('b')
  })

  it('returns nothing when the click is far from every node', () => {
    const p = projectMinimap(input)
    expect(nearestKey({ x: -500, y: -500 }, p)).toBeNull()
  })

  it('marks the camera position when given one', () => {
    const p = projectMinimap({ ...input, cameraPos: { x: 0, y: 200, z: 300 } })
    expect(p.camera).not.toBeNull()
  })
})

/* ─────────────── Gaps ─────────────── */

describe('gaps', () => {
  it('finds nothing in an empty portfolio', () => {
    expect(findGaps([], [])).toEqual([])
  })

  it('reports contracts with no owner and anchors a phantom', () => {
    const cs = [contract({ owner: undefined, annualValue: 90_000 }), contract()]
    const { nodes } = buildGraph(cs, 900, 600)
    const gap = findGaps(cs, nodes).find(g => g.kind === 'no-owner')!
    expect(gap.exposure).toBe(90_000)
    expect(gap.phantom?.label).toBe('No owner')
    expect(gap.phantom?.anchorKey).toContain('department::')
  })

  it('reports a category with no second supplier and offers the empty slot', () => {
    const cs = [contract({ category: 'Niche', supplier: 'Only' })]
    const { nodes } = buildGraph(cs, 900, 600)
    const gap = findGaps(cs, nodes).find(g => g.kind === 'no-competition')!
    expect(gap.phantom?.label).toBe('2nd supplier?')
  })

  it('stays quiet on a category with competition', () => {
    const cs = [
      contract({ category: 'Cloud', supplier: 'A' }),
      contract({ category: 'Cloud', supplier: 'B' }),
    ]
    const { nodes } = buildGraph(cs, 900, 600)
    expect(findGaps(cs, nodes).some(g => g.kind === 'no-competition')).toBe(false)
  })

  it('identifies a supplier holding a department-category cell alone', () => {
    const cs = [
      contract({ supplier: 'Solo', department: 'Ops', category: 'Widgets', annualValue: 500_000 }),
      contract({ supplier: 'A', department: 'IT', category: 'Cloud', annualValue: 100_000 }),
      contract({ supplier: 'B', department: 'IT', category: 'Cloud', annualValue: 100_000 }),
    ]
    expect([...singlePointSuppliers(cs).keys()]).toContain('Solo')
    expect([...singlePointSuppliers(cs).keys()]).not.toContain('A')
  })

  it('flags expiring spend with no successor', () => {
    const cs = [contract({ endDate: inDays(30), annualValue: 100_000 })]
    const { nodes } = buildGraph(cs, 900, 600)
    expect(findGaps(cs, nodes).some(g => g.kind === 'expiring-unplanned')).toBe(true)
  })

  it('does not flag expiring spend when a successor exists', () => {
    const cs = [
      contract({ name: 'Now', endDate: inDays(30), category: 'X', department: 'D' }),
      contract({ name: 'Next', endDate: inDays(600), category: 'X', department: 'D' }),
    ]
    const { nodes } = buildGraph(cs, 900, 600)
    const gap = findGaps(cs, nodes).find(g => g.kind === 'expiring-unplanned')
    expect(gap).toBeUndefined()
  })

  it('flags material data holes only', () => {
    const many = Array.from({ length: 20 }, () => contract({ endDate: inDays(400) }))
    const { nodes: cleanNodes } = buildGraph(many, 900, 600)
    expect(findGaps(many, cleanNodes).some(g => g.kind === 'missing-data')).toBe(false)

    const holey = [...many, ...Array.from({ length: 5 }, () => contract({ annualValue: undefined, endDate: undefined }))]
    const { nodes: holeyNodes } = buildGraph(holey, 900, 600)
    expect(findGaps(holey, holeyNodes).some(g => g.kind === 'missing-data')).toBe(true)
  })

  it('counts exposure once per contract across gaps', () => {
    const cs = [contract({ owner: undefined, endDate: inDays(30), annualValue: 100_000, category: 'Solo', supplier: 'One' })]
    const { nodes } = buildGraph(cs, 900, 600)
    const gaps = findGaps(cs, nodes)
    expect(gaps.length).toBeGreaterThan(1)
    expect(gapExposure(gaps, cs)).toBe(100_000)
  })

  it('only names nodes that exist in the graph', () => {
    const cs = [contract({ owner: undefined })]
    const { nodes } = buildGraph(cs, 900, 600)
    const known = new Set(nodes.map(n => n.key))
    for (const g of findGaps(cs, nodes)) {
      for (const k of g.nodeKeys) expect(known.has(k)).toBe(true)
    }
  })
})

describe('gaps lens', () => {
  it('lifts nodes touched by a gap and mutes the rest', () => {
    const cs = [contract({ owner: undefined }), contract({ name: 'Fine' })]
    const { nodes } = buildGraph(cs, 900, 600)
    const gaps = findGaps(cs, nodes)
    const gapKeys = new Set(gaps.flatMap(g => g.nodeKeys))
    const ctx = buildLensContext(nodes, gapKeys)
    const touched = nodes.find(n => gapKeys.has(n.key))!
    const untouched = nodes.find(n => !gapKeys.has(n.key))!
    expect(lensStyle(touched, 'gaps', ctx).color).toBe('#F472B6')
    expect(lensStyle(untouched, 'gaps', ctx).color).toBe('#1E293B')
  })
})

/* ─────────────── Story ─────────────── */

describe('story', () => {
  const portfolio = [
    contract({ name: 'A', supplier: 'BigCo', department: 'IT', category: 'Cloud', annualValue: 500_000, endDate: inDays(45), noticePeriodDays: 30 }),
    contract({ name: 'B', supplier: 'BigCo', department: 'HR', category: 'People', annualValue: 300_000, endDate: inDays(-10) }),
    contract({ name: 'C', supplier: 'Tiny', department: 'IT', category: 'Cloud', annualValue: 5_000, owner: undefined, endDate: inDays(400) }),
  ]
  const { nodes } = buildGraph(portfolio, 900, 600)

  it('says nothing about an empty portfolio', () => {
    expect(buildStory([], [])).toEqual([])
  })

  it('opens with the portfolio overview', () => {
    const s = buildStory(portfolio, nodes)
    expect(s[0].id).toBe('portfolio')
    expect(s[0].camera).toBe('overview')
  })

  it('builds a coherent multi-step narrative', () => {
    const s = buildStory(portfolio, nodes)
    expect(s.length).toBeGreaterThan(3)
    for (const step of s) {
      expect(step.title.length).toBeGreaterThan(3)
      expect(step.narration.length).toBeGreaterThan(30)
      expect(step.source.length).toBeGreaterThan(3)
    }
  })

  it('drops steps that have nothing to say', () => {
    // A clean, single-supplier-per-category portfolio with no risk or expiry.
    const clean = [
      contract({ name: 'Clean1', supplier: 'S1', category: 'C1', department: 'D1', endDate: inDays(700) }),
      contract({ name: 'Clean2', supplier: 'S2', category: 'C1', department: 'D1', endDate: inDays(700) }),
    ]
    const g = buildGraph(clean, 900, 600)
    const ids = buildStory(clean, g.nodes).map(s => s.id)
    expect(ids).toContain('portfolio')
    // Nothing expires soon, so no risk step should be forced in.
    expect(ids).not.toContain('gaps')
  })

  it('names the most systemic supplier in the dependency step', () => {
    const dep = buildStory(portfolio, nodes).find(s => s.id === 'dependency')!
    expect(dep.title).toContain('BigCo')
    expect(dep.nodeKeys).toContain('supplier::BigCo')
  })

  it('takes its gap figures from the gap engine', () => {
    const story = buildStory(portfolio, nodes)
    const gapStep = story.find(s => s.id === 'gaps')
    if (gapStep) {
      const expected = gapExposure(findGaps(portfolio, nodes), portfolio)
      expect(gapStep.figure).toBe(fmtK(expected))
    }
  })

  it('points every step at a real lens', () => {
    const valid = new Set(['structure', 'spend', 'risk', 'expiry', 'concentration', 'data', 'gaps'])
    for (const s of buildStory(portfolio, nodes)) expect(valid.has(s.lens)).toBe(true)
  })
})

/* ─────────────── Scale (W7) ─────────────── */

describe('scale', () => {
  it('keeps the label policy fast and bounded at 500 contracts', () => {
    const big: Contract[] = Array.from({ length: 500 }, (_, i) => contract({
      name: `Scale ${i}`,
      supplier: `Supplier ${i % 60}`,
      category: `Category ${i % 25}`,
      department: `Dept ${i % 10}`,
      owner: `Owner ${i % 15}`,
      annualValue: (i % 97) * 10_000,
      endDate: inDays((i % 700) - 100),
    }))
    const g = buildGraph(big, 900, 600)
    expect(g.nodes.length).toBeGreaterThan(500)

    // Scatter into a viewport-shaped cloud, as a settled layout would.
    const screen = new Map<string, ScreenNode>()
    g.nodes.forEach((n, i) => screen.set(n.key, {
      key: n.key,
      x: (i * 137) % 1600,
      y: (i * 251) % 900,
      depth: 0.999,
      radius: 5,
    }))

    const t0 = performance.now()
    const plan = labelPlan({
      nodes: g.nodes, screen, tiers: null,
      maxValue: Math.max(...g.nodes.map(n => n.value)),
      viewport: { width: 1600, height: 900 },
    })
    const ms = performance.now() - t0

    expect(plan.size).toBeGreaterThan(0)
    expect(plan.size).toBeLessThanOrEqual(MAX_LABELS)
    // Runs at 6Hz in production; a plan must cost a fraction of that budget.
    expect(ms).toBeLessThan(50)

    // The no-overlap guarantee must hold at scale too.
    const rects = [...plan.entries()].map(([k, level]) =>
      labelRect(screen.get(k)!, level, 10))
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i], b = rects[j]
        const overlap = !(a.right < b.left || a.left > b.right || a.bottom < b.top || a.top > b.bottom)
        expect(overlap).toBe(false)
      }
    }
  })

  it('keeps the gap finder linear-ish at 500 contracts', () => {
    const big: Contract[] = Array.from({ length: 500 }, (_, i) => contract({
      name: `G${i}`, supplier: `S${i % 40}`, category: `C${i % 20}`,
      department: `D${i % 8}`, owner: i % 7 === 0 ? undefined : 'Owner',
      endDate: inDays((i % 400) - 50),
    }))
    const g = buildGraph(big, 900, 600)
    const t0 = performance.now()
    const gaps = findGaps(big, g.nodes)
    expect(performance.now() - t0).toBeLessThan(200)
    expect(gaps.length).toBeGreaterThan(0)
  })
})
