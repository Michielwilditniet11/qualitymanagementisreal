import type { GraphNode } from '../../data/types'
import type { ContextTier } from '../../analytics/selection'

export type LabelLevel = 'full' | 'name' | 'none'

/** Type precedence when competing for label space. */
export const TYPE_WEIGHT: Record<string, number> = {
  department: 1.0,
  category: 0.8,
  supplier: 0.6,
  owner: 0.55,
  contract: 0.3,
}

/** Context tier precedence — a selection's core always outranks the field. */
export const TIER_WEIGHT: Record<ContextTier, number> = {
  core: 100,
  direct: 50,
  related: 10,
}

/** Never place more labels than this, however much room there appears to be. */
export const MAX_LABELS = 42
/**
 * NDC depth ≥ 1 is beyond the far plane (or behind the camera after
 * projection). Perspective NDC depth is highly nonlinear — visible nodes sit
 * around 0.999 — so anything below 1 counts as readable.
 */
export const MAX_LABEL_DEPTH = 1.0

export interface ScreenNode {
  key: string
  /** Projected screen position in pixels. */
  x: number
  y: number
  /** Normalised device depth; > 1 means behind the camera. */
  depth: number
  /** Approximate on-screen radius of the node itself, in pixels. */
  radius: number
}

export interface LabelPlanInput {
  nodes: GraphNode[]
  screen: Map<string, ScreenNode>
  /** Active context tiers, or null when the whole graph is neutral. */
  tiers: Map<string, ContextTier> | null
  hoveredKey?: string | null
  selectedKey?: string | null
  /** Nodes a lens insists on labelling (e.g. top spend). */
  alwaysLabel?: Set<string>
  maxValue: number
  viewport: { width: number; height: number }
  maxLabels?: number
}

interface Rect { left: number; right: number; top: number; bottom: number }

/** Rough label footprint, used for collision before any text is rendered. */
export function labelRect(s: ScreenNode, level: LabelLevel, nameLength: number): Rect {
  const charW = 6.2
  const w = Math.min(210, Math.max(52, nameLength * charW + 22))
  const h = level === 'full' ? 34 : 20
  // Labels sit below the node, centred.
  const top = s.y + s.radius + 4
  return { left: s.x - w / 2, right: s.x + w / 2, top, bottom: top + h }
}

function intersects(a: Rect, b: Rect): boolean {
  return !(a.right < b.left || a.left > b.right || a.bottom < b.top || a.top > b.bottom)
}

/**
 * Importance drives who wins a collision. Selection and hover dominate, then
 * context tier, then spend, then node type.
 */
export function importanceOf(n: GraphNode, input: LabelPlanInput): number {
  if (n.key === input.hoveredKey) return 1e6
  if (n.key === input.selectedKey) return 5e5
  let score = 0
  const tier = input.tiers?.get(n.key)
  if (tier) score += TIER_WEIGHT[tier]
  if (input.alwaysLabel?.has(n.key)) score += 40
  score += 30 * Math.sqrt(Math.max(0, n.value) / Math.max(1, input.maxValue))
  score += 12 * (TYPE_WEIGHT[n.type] ?? 0.3)
  return score
}

/**
 * Decide which nodes may show a label, guaranteeing that no two placed labels
 * overlap on screen. Greedy by importance: the most important node claims its
 * space first and everything colliding with it is dropped.
 */
export function labelPlan(input: LabelPlanInput): Map<string, LabelLevel> {
  const out = new Map<string, LabelLevel>()
  const cap = input.maxLabels ?? MAX_LABELS
  const { width, height } = input.viewport

  const candidates = input.nodes
    .map(n => ({ n, s: input.screen.get(n.key) }))
    .filter((c): c is { n: GraphNode; s: ScreenNode } => {
      if (!c.s) return false
      if (c.s.depth >= MAX_LABEL_DEPTH) return false
      // Off-screen nodes cannot be read; allow a small margin for partials.
      if (c.s.x < -80 || c.s.x > width + 80) return false
      if (c.s.y < -60 || c.s.y > height + 60) return false
      // Outside a context, dimmed nodes never get labels.
      if (input.tiers && !input.tiers.has(c.n.key)) return false
      return true
    })
    .map(c => ({ ...c, imp: importanceOf(c.n, input) }))
    .sort((a, b) => b.imp - a.imp)

  const placed: Rect[] = []
  for (const c of candidates) {
    if (out.size >= cap) break
    // Detail level: the subject and its direct ring get the two-line label.
    const tier = input.tiers?.get(c.n.key)
    const wantsFull =
      c.n.key === input.hoveredKey ||
      c.n.key === input.selectedKey ||
      tier === 'core' || tier === 'direct'
    const level: LabelLevel = wantsFull ? 'full' : 'name'

    const rect = labelRect(c.s, level, Math.min(c.n.name.length, 30))
    if (placed.some(p => intersects(p, rect))) continue
    placed.push(rect)
    out.set(c.n.key, level)
  }

  return out
}
