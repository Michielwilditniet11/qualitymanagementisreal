import type { GraphNode } from '../data/types'

export interface CentralityScore {
  key: string
  name: string
  type: GraphNode['type']
  /** Number of direct connections. */
  degree: number
  /** Spend flowing through this node. */
  weightedDegree: number
  /** How many distinct departments this node touches. */
  departmentReach: number
  /** Normalised 0–100 "how systemic is this node" score. */
  systemicScore: number
}

/**
 * Count distinct departments reachable from a node within two hops.
 * Departments are reached either directly (entity↔department links) or
 * through the contracts attached to the node.
 */
export function departmentReach(node: GraphNode): number {
  const depts = new Set<string>()
  if (node.type === 'department') depts.add(node.name)
  for (const c of node.contracts) {
    if (c.department) depts.add(c.department)
  }
  for (const nb of node.neighbors) {
    if (nb.type === 'department') depts.add(nb.name)
  }
  return depts.size
}

/**
 * Rank nodes of a given type by how systemic they are: a blend of spend share,
 * department reach and raw connectivity. Used to surface key stakeholders.
 */
export function computeCentrality(
  nodes: GraphNode[],
  type?: GraphNode['type']
): CentralityScore[] {
  const pool = type ? nodes.filter(n => n.type === type) : nodes
  if (pool.length === 0) return []

  const maxSpend = Math.max(1, ...pool.map(n => n.value))
  const maxDegree = Math.max(1, ...pool.map(n => n.neighbors.size))
  const maxReach = Math.max(1, ...pool.map(n => departmentReach(n)))

  return pool
    .map(n => {
      const degree = n.neighbors.size
      const reach = departmentReach(n)
      const systemicScore = Math.round(
        100 * (0.5 * (n.value / maxSpend) + 0.3 * (reach / maxReach) + 0.2 * (degree / maxDegree))
      )
      return {
        key: n.key,
        name: n.name,
        type: n.type,
        degree,
        weightedDegree: n.value,
        departmentReach: reach,
        systemicScore,
      }
    })
    .sort((a, b) => b.systemicScore - a.systemicScore)
}

/**
 * All nodes within `hops` of the given node, including the node itself.
 * Powers focus mode and blast-radius analysis.
 */
export function egoNetwork(node: GraphNode, hops = 1): Set<string> {
  const seen = new Set<string>([node.key])
  let frontier: GraphNode[] = [node]
  for (let h = 0; h < hops; h++) {
    const next: GraphNode[] = []
    for (const n of frontier) {
      for (const nb of n.neighbors) {
        if (seen.has(nb.key)) continue
        seen.add(nb.key)
        next.push(nb)
      }
    }
    frontier = next
    if (frontier.length === 0) break
  }
  return seen
}

export interface ImpactAssessment {
  contractCount: number
  annualValue: number
  departments: string[]
  categories: string[]
  /** Share of total portfolio spend this node represents. */
  spendShare: number
}

/** "What breaks if we lose this node" — used in the inspection drawer. */
export function assessImpact(node: GraphNode, totalPortfolioSpend: number): ImpactAssessment {
  const departments = new Set<string>()
  const categories = new Set<string>()
  let annualValue = 0
  for (const c of node.contracts) {
    if (c.department) departments.add(c.department)
    if (c.category) categories.add(c.category)
    annualValue += c.annualValue ?? 0
  }
  return {
    contractCount: node.contracts.length,
    annualValue,
    departments: [...departments].sort(),
    categories: [...categories].sort(),
    spendShare: totalPortfolioSpend > 0 ? annualValue / totalPortfolioSpend : 0,
  }
}
