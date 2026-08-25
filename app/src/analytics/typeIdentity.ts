import type { GraphNode } from '../data/types'
import { NODE_COLORS } from '../graph/buildGraph'
import type { ContextTier } from './selection'

/**
 * Who is a person, what is a live contract — decided in one place.
 *
 * Lenses own the *field*: they recolour the whole graph to answer one
 * question, and that is what they are for. But inside a selection or a Focus
 * Frame the user is asking a different question — "what kinds of things
 * surround this?" — and the lens palette actively hides the answer, painting
 * an owner, a department and a contract in the same risk red.
 *
 * So within a context, entities wear their type colour and contracts wear
 * their status. Outside it, the lens keeps full authority.
 */

export type ContractStatus = 'live' | 'expired' | 'undated'

/** Node types that stand for a real-world entity rather than an agreement. */
export const ENTITY_TYPES = ['department', 'category', 'supplier', 'owner'] as const

/** The desaturation target for a contract that is past its end date. */
const EXPIRED_MIX = '#3A465C'
/** How far an expired contract is pulled toward that grey, 0–1. */
export const EXPIRED_DESATURATION = 0.55

function hexToRgb(hex: string): [number, number, number] {
  return [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number]
}

/** Blend two hex colours; `t` is how far to move from `a` toward `b`. */
export function mixHex(a: string, b: string, t: number): string {
  const [ar, ag, ab] = hexToRgb(a)
  const [br, bg, bb] = hexToRgb(b)
  const k = Math.min(1, Math.max(0, t))
  const to = (x: number, y: number) => Math.round(x + (y - x) * k).toString(16).padStart(2, '0')
  // Lowercase to match NODE_COLORS, so colours stay comparable as strings.
  return `#${to(ar, br)}${to(ag, bg)}${to(ab, bb)}`.toLowerCase()
}

/**
 * A contract's standing, from the same rule the insights engine uses for
 * "expired but active" — one definition, so the graph and the findings panel
 * can never disagree about what counts as expired.
 */
export function contractStatus(n: GraphNode, now = new Date()): ContractStatus {
  if (n.type !== 'contract') return 'live'
  const end = n.contract?.endDate
  if (!end) return 'undated'
  return end.getTime() < now.getTime() ? 'expired' : 'live'
}

/** True when this contract auto-renews and its term has already rolled. */
export function isLockedRenewal(n: GraphNode, now = new Date()): boolean {
  if (n.type !== 'contract' || !n.contract?.autoRenew) return false
  const end = n.contract.endDate
  return Boolean(end && end.getTime() < now.getTime())
}

/**
 * The colour a node takes inside an active context.
 *
 * `null` means "the lens keeps this one" — the core node of a selection stays
 * in its lens colour so the subject still shows *why* it was selected (red
 * under risk), and anything outside the context is not this function's
 * business.
 */
export function contextColor(
  n: GraphNode, tier: ContextTier | undefined, now = new Date()
): string | null {
  if (!tier) return null
  // The subject keeps the lens's answer; its surroundings explain themselves.
  if (tier === 'core') return null

  if (n.type === 'contract') {
    const base = NODE_COLORS.contract
    return contractStatus(n, now) === 'expired'
      ? mixHex(base, EXPIRED_MIX, EXPIRED_DESATURATION)
      : base
  }
  return NODE_COLORS[n.type] ?? null
}

export type BadgeKind = 'person' | 'building' | 'tag' | 'factory'

/** The glyph that marks what kind of thing this is. Contracts get none. */
export function badgeFor(type: GraphNode['type']): BadgeKind | null {
  switch (type) {
    case 'owner': return 'person'
    case 'department': return 'building'
    case 'category': return 'tag'
    case 'supplier': return 'factory'
    // A plain sphere already means "a contract"; a badge would be noise.
    default: return null
  }
}
