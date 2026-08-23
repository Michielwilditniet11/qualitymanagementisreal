import type { Contract, GraphNode, GraphLink } from '../data/types'

export const NODE_COLORS: Record<string, string> = {
  department: '#4da3ff',
  category: '#ffb347',
  supplier: '#ff6b81',
  owner: '#7bd88f',
  contract: '#b48cff',
}

export const TYPE_LABELS: Record<string, string> = {
  department: 'Departments',
  category: 'Categories',
  supplier: 'Suppliers',
  owner: 'Contract owners',
  contract: 'Contracts',
}

export function buildGraph(contracts: Contract[], w: number, h: number): { nodes: GraphNode[]; links: GraphLink[] } {
  const nodeById = new Map<string, GraphNode>()
  const linkSet = new Set<string>()
  const links: GraphLink[] = []

  function getNode(type: GraphNode['type'], name: string): GraphNode {
    const key = `${type}::${name}`
    let n = nodeById.get(key)
    if (!n) {
      n = {
        key, type, name,
        x: w / 2 + (Math.random() - 0.5) * w * 0.7,
        y: h / 2 + (Math.random() - 0.5) * h * 0.7,
        vx: 0, vy: 0, value: 0, count: 0,
        contracts: [], neighbors: new Set(),
      }
      nodeById.set(key, n)
    }
    return n
  }

  function addLink(a: GraphNode, b: GraphNode) {
    const k = a.key < b.key ? `${a.key}|${b.key}` : `${b.key}|${a.key}`
    if (linkSet.has(k)) return
    linkSet.add(k)
    links.push({ source: a, target: b })
    a.neighbors.add(b)
    b.neighbors.add(a)
  }

  for (const c of contracts) {
    const nc = getNode('contract', c.name)
    nc.contract = c
    const nd = getNode('department', c.department)
    const ncat = getNode('category', c.category)
    const ns = getNode('supplier', c.supplier)

    addLink(nc, nd); addLink(nc, ncat); addLink(nc, ns); addLink(ncat, nd)

    if (c.owner) {
      const no = getNode('owner', c.owner)
      addLink(nc, no); addLink(no, nd)
      no.value += c.annualValue ?? 0; no.count++; no.contracts.push(c)
    }

    for (const n of [nc, nd, ncat, ns]) {
      n.value += c.annualValue ?? 0; n.count++; n.contracts.push(c)
    }
  }

  return { nodes: [...nodeById.values()], links }
}

export function nodeRadius(n: GraphNode, maxValue: number): number {
  const base = { department: 14, category: 11, supplier: 9, owner: 9, contract: 6 }[n.type]
  return base + 10 * Math.sqrt(n.value / Math.max(1, maxValue))
}
