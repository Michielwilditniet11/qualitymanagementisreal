import type { Contract, GraphNode, GraphLink } from '../data/types'
import { NODE_COLORS, entityKey, contractKey, contractIdFromKey } from '../graph/buildGraph'
import { fmtK } from './risk'
import type { LensId } from './lenses'
import type { BriefingItem } from './briefings'
import { generateInsights, type Insight } from './insights'
import { findGaps, type Gap } from './gaps'
import { negotiationCalendar } from './levers'

/**
 * A Focus Frame is the single staging structure behind every jump into the
 * Spider Web. It is always an *induced subgraph* — the subject nodes plus the
 * connective tissue that links them — never a set of floating dots, because
 * the relationships are the only thing the 3D view offers that a table does
 * not.
 */
export interface FocusFrame {
  /** Stable across rebuilds of the same source, so clicking again toggles. */
  id: string
  title: string
  /** The figure that makes it matter, pre-formatted. */
  figure: string
  /** Why these nodes, and what to look at — one sentence. */
  caption: string
  /** The subjects of the finding. Ringed, always labelled. */
  seedKeys: string[]
  /** The hubs and neighbours that connect the seeds. Labelled where they fit. */
  contextKeys: string[]
  /** Undirected link ids ("a|b", lexicographic) wholly inside the frame. */
  linkKeys: string[]
  /** What the line colours mean *in this frame*. */
  legend: { color: string; meaning: string }[]
  nextStep?: string
  crossLinks: { label: string; target: 'calendar' | 'diagnostics' }[]
  /** The lens that shows this frame best. */
  lens: LensId
  /** True when the context was capped; the caption says so too. */
  truncated: boolean
}

/**
 * Context is capped so a portfolio-wide finding cannot un-dim the whole graph
 * and leave nothing emphasised.
 */
export const CONTEXT_CAP = 40

export type FrameSource =
  | { kind: 'briefing'; lens: LensId; item: BriefingItem; index: number }
  | { kind: 'insight'; insight: Insight }
  | { kind: 'gap'; gap: Gap }
  | { kind: 'kpi'; metric: 'spend' | 'atRisk' | 'expiring' | 'windows' | 'gaps' }
  | { kind: 'entity'; nodeKey: string; origin?: string }
  | { kind: 'story'; step: StoryLike }

/** The slice of a story step a frame needs — kept structural to avoid a cycle. */
export interface StoryLike {
  id: string
  title: string
  narration: string
  figure?: string
  lens: LensId
  nodeKeys: string[]
}

export function linkId(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`
}

/**
 * Resolve keys defensively. Names arriving from engines are built by string
 * concatenation, so a stray space or a case difference would otherwise turn a
 * finding into a dead click.
 */
function resolveKeys(keys: string[], nodes: GraphNode[]): string[] {
  const byKey = new Map(nodes.map(n => [n.key, n]))
  const byLoose = new Map(nodes.map(n => [`${n.type}::${n.name.trim().toLowerCase()}`, n]))
  const out: string[] = []
  const seen = new Set<string>()
  for (const k of keys) {
    let n = byKey.get(k)
    if (!n) {
      const i = k.indexOf('::')
      if (i > 0) n = byLoose.get(`${k.slice(0, i)}::${k.slice(i + 2).trim().toLowerCase()}`)
    }
    if (n && !seen.has(n.key)) { seen.add(n.key); out.push(n.key) }
  }
  return out
}

function sumValue(cs: Contract[]): number {
  return cs.reduce((s, c) => s + (c.annualValue ?? 0), 0)
}

/** A node touching several seeds is the story; rank it far above the rest. */
const SHARED_HUB_WEIGHT = 100
/** Direct neighbours outrank anything reached the long way round. */
const HOP1_BONUS = 50

/**
 * Connective closure: the members of a frame are the seeds plus the tissue
 * that connects them.
 *
 * Two hops matter, not one. The graph is effectively bipartite — entities
 * link to contracts, contracts link to entities — so a supplier's
 * *departments* sit two hops away, through its contracts. Stopping at one hop
 * would frame a supplier with its contracts and answer none of the questions
 * ("which departments would have to re-source?") the frame exists to answer.
 *
 * Ranking then decides what survives the cap: nodes adjacent to several seeds
 * first (the shared hubs that turn dots into a picture), then direct
 * neighbours, then spend.
 */
export function connectiveClosure(
  seedKeys: string[], nodes: GraphNode[], cap = CONTEXT_CAP
): { contextKeys: string[]; truncated: boolean } {
  const byKey = new Map(nodes.map(n => [n.key, n]))
  const seeds = seedKeys.map(k => byKey.get(k)).filter((n): n is GraphNode => Boolean(n))
  const seedSet = new Set(seeds.map(n => n.key))
  if (seeds.length === 0) return { contextKeys: [], truncated: false }

  // How many distinct seeds each non-seed node touches directly.
  const touches = new Map<string, number>()
  const hop1 = new Set<string>()
  for (const s of seeds) {
    for (const nb of s.neighbors) {
      if (seedSet.has(nb.key)) continue
      hop1.add(nb.key)
      touches.set(nb.key, (touches.get(nb.key) ?? 0) + 1)
    }
  }

  // Second hop, through the contracts a seed holds: this is what makes
  // "FlexForce spans HR, Ops and Finance" visible rather than implied.
  const hop2 = new Set<string>()
  for (const s of seeds) {
    for (const nb of s.neighbors) {
      if (nb.type !== 'contract' && s.type !== 'contract') continue
      for (const peer of nb.neighbors) {
        if (seedSet.has(peer.key) || hop1.has(peer.key)) continue
        hop2.add(peer.key)
      }
    }
  }

  const maxValue = Math.max(1, ...nodes.map(n => n.value))
  const ranked = [...hop1, ...hop2]
    .map(k => byKey.get(k))
    .filter((n): n is GraphNode => Boolean(n))
    .map(n => ({
      n,
      score: SHARED_HUB_WEIGHT * Math.max(0, (touches.get(n.key) ?? 0) - 1)
        + (hop1.has(n.key) ? HOP1_BONUS : 0)
        + Math.sqrt(Math.max(0, n.value) / maxValue),
    }))
    .sort((a, b) => b.score - a.score || b.n.value - a.n.value
      || b.n.neighbors.size - a.n.neighbors.size)

  return {
    contextKeys: ranked.slice(0, cap).map(r => r.n.key),
    truncated: ranked.length > cap,
  }
}

/** Every link with both ends inside the member set. */
export function linksWithin(memberKeys: Set<string>, links: GraphLink[]): string[] {
  const out = new Set<string>()
  for (const l of links) {
    if (memberKeys.has(l.source.key) && memberKeys.has(l.target.key)) {
      out.add(linkId(l.source.key, l.target.key))
    }
  }
  return [...out]
}

/** The line-colour key for whatever entity types this frame actually contains. */
function legendFor(memberKeys: string[], nodes: GraphNode[]): { color: string; meaning: string }[] {
  const byKey = new Map(nodes.map(n => [n.key, n]))
  const types = new Set(memberKeys.map(k => byKey.get(k)?.type).filter(Boolean) as string[])
  const MEANING: Record<string, string> = {
    department: 'runs through this department',
    category: 'sits in this category',
    supplier: 'bought from this supplier',
    owner: 'accountable owner',
    contract: 'the contract itself',
  }
  return [...types].map(t => ({ color: NODE_COLORS[t] ?? '#94A3B8', meaning: MEANING[t] ?? t }))
}

const KEY = entityKey

/** Seeds and framing text for each source kind. */
function seedsFor(
  source: FrameSource, nodes: GraphNode[], contracts: Contract[]
): { id: string; title: string; figure: string; caption: string; seeds: string[]
     lens: LensId; nextStep?: string; crossLinks: FocusFrame['crossLinks'] } {
  switch (source.kind) {
    case 'briefing': {
      const { item, lens, index } = source
      // Items with no keys of their own are portfolio statements. They are the
      // dead clicks of the old build; here they seed the structure they
      // describe rather than doing nothing.
      let seeds = item.nodeKeys
      let caption = `From the ${lens} lens. The subjects are ringed; everything they connect through stays lit.`
      if (seeds.length === 0) {
        const depts = [...new Set(contracts.map(c => c.department).filter(Boolean))]
        seeds = depts.map(d => KEY('department', d))
        caption = 'Every department in the register, with the categories and suppliers that link them.'
      }
      return {
        id: `briefing:${lens}:${index}`,
        title: item.label, figure: item.figure, caption,
        seeds, lens, crossLinks: [],
      }
    }
    case 'insight': {
      const i = source.insight
      return {
        id: `insight:${i.id}`,
        title: i.title,
        figure: i.valueAtRisk ? fmtK(i.valueAtRisk) : '',
        caption: i.narrative,
        seeds: i.nodeKeys,
        lens: lensForInsight(i),
        nextStep: i.action,
        crossLinks: i.category === 'expiry' || i.category === 'renewal'
          ? [{ label: 'Open in Calendar', target: 'calendar' as const }]
          : [{ label: 'Open in Diagnostics', target: 'diagnostics' as const }],
      }
    }
    case 'gap': {
      const g = source.gap
      return {
        id: `gap:${g.id}`,
        title: g.title, figure: fmtK(g.exposure), caption: g.detail,
        seeds: g.nodeKeys, lens: 'gaps',
        crossLinks: [{ label: 'Open in Diagnostics', target: 'diagnostics' as const }],
      }
    }
    case 'kpi': {
      const m = source.metric
      if (m === 'expiring') {
        const soon = contracts.filter(c => c.endDate && c.endDate.getTime() > Date.now() &&
          (c.endDate.getTime() - Date.now()) / 86400000 <= 90)
        return {
          id: 'kpi:expiring',
          title: `${soon.length} contracts expire within 90 days`,
          figure: fmtK(sumValue(soon)),
          caption: 'Each expiring contract with the department, category and supplier it would leave behind.',
          seeds: soon.map(contractKey), lens: 'expiry',
          crossLinks: [{ label: 'Open in Calendar', target: 'calendar' as const }],
        }
      }
      if (m === 'spend') {
        const top = [...contracts].sort((a, b) => (b.annualValue ?? 0) - (a.annualValue ?? 0)).slice(0, 10)
        return {
          id: 'kpi:spend',
          title: 'The ten largest contracts',
          figure: fmtK(sumValue(top)),
          caption: 'Where the money actually sits, and who it flows through.',
          seeds: top.map(contractKey), lens: 'spend', crossLinks: [],
        }
      }
      if (m === 'atRisk') {
        const critical = generateInsights(contracts).filter(i => i.severity === 'critical')
        const seeds = [...new Set(critical.flatMap(i => i.nodeKeys))]
        const flagged = new Set(critical.flatMap(i => i.nodeKeys)
          .map(contractIdFromKey).filter(Boolean) as string[])
        return {
          id: 'kpi:atRisk',
          title: `${critical.length} critical findings`,
          figure: fmtK(sumValue(contracts.filter(c => flagged.has(c.id)))),
          caption: 'Every contract and entity carrying a critical finding, with what they run through.',
          seeds, lens: 'risk',
          crossLinks: [{ label: 'Open in Diagnostics', target: 'diagnostics' as const }],
        }
      }
      if (m === 'windows') {
        const open = negotiationCalendar(contracts)
          .filter(i => i.kind === 'notice-deadline' && !i.missed)
        return {
          id: 'kpi:windows',
          title: `${open.length} notice windows still open`,
          figure: fmtK(open.reduce((s, i) => s + i.value, 0)),
          caption: 'Contracts you can still act on before the decision date passes, and who they sit with.',
          seeds: open.map(i => contractKey({ id: i.contractId })), lens: 'expiry',
          crossLinks: [{ label: 'Open in Calendar', target: 'calendar' as const }],
        }
      }
      // gaps
      const gaps = findGaps(contracts, nodes)
      return {
        id: 'kpi:gaps',
        title: `${gaps.length} structural gaps`,
        figure: fmtK(gaps.reduce((s, g) => s + g.exposure, 0)),
        caption: 'Everything the register is missing — no owner, no competition, no alternative — and what it exposes.',
        seeds: [...new Set(gaps.flatMap(g => g.nodeKeys))], lens: 'gaps',
        crossLinks: [{ label: 'Open in Diagnostics', target: 'diagnostics' as const }],
      }
    }
    case 'story': {
      const s = source.step
      return {
        id: `story:${s.id}`,
        title: s.title, figure: s.figure ?? '', caption: s.narration,
        seeds: s.nodeKeys, lens: s.lens, crossLinks: [],
      }
    }
    case 'entity':
    default: {
      const n = nodes.find(x => x.key === source.nodeKey)
      const origin = source.kind === 'entity' ? source.origin : undefined
      return {
        id: `entity:${source.nodeKey}`,
        title: n?.name ?? source.nodeKey,
        figure: n ? fmtK(n.value) : '',
        caption: origin
          ? `${origin} Everything this connects to is lit; the rest is dimmed.`
          : 'Everything this connects to is lit; the rest is dimmed.',
        seeds: [source.nodeKey], lens: 'structure', crossLinks: [],
      }
    }
  }
}

function lensForInsight(i: Insight): LensId {
  switch (i.category) {
    case 'concentration': return 'concentration'
    case 'expiry': case 'renewal': return 'expiry'
    case 'data': return 'data'
    case 'spend': return 'spend'
    default: return 'risk'
  }
}

/**
 * Build the frame. This module composes engine output — it performs no
 * analysis of its own, so a frame can never disagree with the panel that
 * produced it.
 */
export function buildFocusFrame(
  source: FrameSource,
  nodes: GraphNode[],
  links: GraphLink[],
  contracts: Contract[],
  cap = CONTEXT_CAP
): FocusFrame | null {
  const spec = seedsFor(source, nodes, contracts)
  const seedKeys = resolveKeys(spec.seeds, nodes)

  // A frame with no resolvable subject falls back to the whole portfolio
  // rather than becoming a dead click.
  if (seedKeys.length === 0) {
    const depts = nodes.filter(n => n.type === 'department').map(n => n.key)
    if (depts.length === 0) return null
    const closure = connectiveClosure(depts, nodes, cap)
    const members = new Set([...depts, ...closure.contextKeys])
    return {
      id: spec.id, title: spec.title, figure: spec.figure,
      caption: `${spec.caption} Showing the portfolio structure — the finding's own nodes are not in the current view.`.trim(),
      seedKeys: depts, contextKeys: closure.contextKeys,
      linkKeys: linksWithin(members, links),
      legend: legendFor([...members], nodes),
      nextStep: spec.nextStep, crossLinks: spec.crossLinks,
      lens: spec.lens, truncated: closure.truncated,
    }
  }

  const closure = connectiveClosure(seedKeys, nodes, cap)
  const members = new Set([...seedKeys, ...closure.contextKeys])
  const caption = closure.truncated
    ? `${spec.caption} Showing the ${closure.contextKeys.length} most connected of the surrounding nodes.`
    : spec.caption

  return {
    id: spec.id,
    title: spec.title,
    figure: spec.figure,
    caption,
    seedKeys,
    contextKeys: closure.contextKeys,
    linkKeys: linksWithin(members, links),
    legend: legendFor([...members], nodes),
    nextStep: spec.nextStep,
    crossLinks: spec.crossLinks,
    lens: spec.lens,
    truncated: closure.truncated,
  }
}

/** Membership as one set — for the renderer's dim test. */
export function frameMembers(f: FocusFrame): Set<string> {
  return new Set([...f.seedKeys, ...f.contextKeys])
}
