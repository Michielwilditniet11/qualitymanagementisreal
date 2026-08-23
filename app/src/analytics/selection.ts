import type { GraphNode, RelationType } from '../data/types'
import { relationTo } from '../graph/buildGraph'

export type ContextTier = 'core' | 'direct' | 'related'

export interface SelectionContext {
  /** Key of the selected node. */
  core: string
  /** Every node involved in the selection, by tier. */
  tiers: Map<string, ContextTier>
  /** For direct-ring nodes: how that node relates to the selection. */
  relations: Map<string, RelationType>
}

/** Second-ring contracts are capped so a large entity cannot flood the view. */
export const RELATED_CONTRACT_CAP = 8

function byValueDesc(a: GraphNode, b: GraphNode) {
  return b.value - a.value
}

/**
 * What surrounds a selected node, in three tiers.
 *
 * - `direct` are its immediate neighbours, each tagged with the relation that
 *   leads to it (select a supplier and its contracts are `contract-of`).
 * - `related` is a relevance-filtered second ring rather than a raw two-hop
 *   expansion: entities reached through the selection's contracts, or — when a
 *   contract is selected — its highest-value siblings in the same department
 *   and category.
 */
export function selectionContext(node: GraphNode): SelectionContext {
  const tiers = new Map<string, ContextTier>([[node.key, 'core']])
  const relations = new Map<string, RelationType>()

  for (const nb of node.neighbors) {
    tiers.set(nb.key, 'direct')
    relations.set(nb.key, relationTo(nb.type))
  }

  const addRelated = (n: GraphNode) => {
    if (tiers.has(n.key)) return
    tiers.set(n.key, 'related')
  }

  if (node.type === 'contract') {
    // Siblings sharing a department or category, richest first.
    const siblings = new Set<GraphNode>()
    for (const nb of node.neighbors) {
      if (nb.type !== 'department' && nb.type !== 'category') continue
      for (const peer of nb.neighbors) {
        if (peer.type === 'contract' && peer.key !== node.key) siblings.add(peer)
      }
    }
    ;[...siblings].sort(byValueDesc).slice(0, RELATED_CONTRACT_CAP).forEach(addRelated)
  } else {
    // Entities reached through this node's contracts — a supplier's owners,
    // departments and categories, for instance.
    const reached = new Set<GraphNode>()
    for (const nb of node.neighbors) {
      if (nb.type !== 'contract') continue
      for (const peer of nb.neighbors) {
        if (peer.key === node.key || peer.type === 'contract') continue
        reached.add(peer)
      }
    }
    ;[...reached].sort(byValueDesc).forEach(addRelated)

    // For entity nodes the contracts themselves are already `direct`; also pull
    // in the top contracts of an entity that links to other entities directly
    // (category↔department links exist in the graph).
    const indirectContracts = new Set<GraphNode>()
    for (const nb of node.neighbors) {
      if (nb.type === 'contract') continue
      for (const peer of nb.neighbors) {
        if (peer.type === 'contract' && !tiers.has(peer.key)) indirectContracts.add(peer)
      }
    }
    ;[...indirectContracts].sort(byValueDesc).slice(0, RELATED_CONTRACT_CAP).forEach(addRelated)
  }

  return { core: node.key, tiers, relations }
}

/** Flat set of every node in the context — for consumers that only need membership. */
export function contextKeys(ctx: SelectionContext): Set<string> {
  return new Set(ctx.tiers.keys())
}
