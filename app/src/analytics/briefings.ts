import type { Contract, GraphNode } from '../data/types'
import { fmtK, riskScore, daysDiff } from './risk'
import { computeCentrality } from './centrality'
import { negotiationCalendar } from './levers'
import { findGaps } from './gaps'
import { completeness, type LensId } from './lenses'
import { contractKey } from '../graph/buildGraph'

export interface BriefingItem {
  /** What was found, in one clause. */
  label: string
  /** The figure that makes it matter. */
  figure: string
  /** Nodes to frame when this item is clicked. */
  nodeKeys: string[]
}

export interface LensBriefing {
  lens: LensId
  question: string
  /** How to read the colours, in words. */
  scaleNote: string
  /** The top three things this lens finds in *this* dataset. */
  items: BriefingItem[]
  /** Headline count for the lens tab badge; undefined when not countable. */
  badge?: number
}


function sumValue(cs: Contract[]): number {
  return cs.reduce((s, c) => s + (c.annualValue ?? 0), 0)
}

/**
 * What each lens actually found here — the value shown rather than asserted.
 * Every item is engine output; this module performs no analysis of its own.
 */
export function lensBriefing(
  lens: LensId, contracts: Contract[], nodes: GraphNode[], now = new Date()
): LensBriefing {
  const contractNodes = nodes.filter(n => n.type === 'contract')

  switch (lens) {
    case 'spend': {
      const top = computeCentrality(nodes, 'supplier').slice(0, 3)
      return {
        lens, question: 'Where is the money?',
        scaleNote: 'Brighter and larger means more annual spend.',
        items: top.map(s => ({
          label: s.name,
          figure: fmtK(s.weightedDegree),
          nodeKeys: [s.key],
        })),
        badge: new Set(contracts.map(c => c.supplier).filter(Boolean)).size,
      }
    }

    case 'risk': {
      const scored = contractNodes
        .map(n => ({ n, score: riskScore(n) }))
        .filter(x => x.score >= 40)
        .sort((a, b) => (b.n.contract?.annualValue ?? 0) - (a.n.contract?.annualValue ?? 0))
      return {
        lens, question: 'Where am I exposed?',
        scaleNote: 'Red is high risk, amber medium, green low.',
        items: scored.slice(0, 3).map(x => ({
          label: x.n.name,
          figure: `risk ${x.score} · ${fmtK(x.n.contract?.annualValue ?? 0)}`,
          nodeKeys: [x.n.key],
        })),
        badge: scored.length,
      }
    }

    case 'expiry': {
      const cal = negotiationCalendar(contracts, now)
        .filter(i => i.kind === 'notice-deadline' && !i.missed)
      return {
        lens, question: 'What is about to lapse?',
        scaleNote: 'Red under 30 days, amber under 90, blue within the year.',
        items: cal.slice(0, 3).map(i => ({
          label: `${i.contract} — act by ${i.actBy.toISOString().slice(0, 10)}`,
          figure: `${i.daysLeft}d · ${fmtK(i.value)}`,
          nodeKeys: [contractKey({ id: i.contractId })],
        })),
        badge: cal.length,
      }
    }

    case 'concentration': {
      const total = sumValue(contracts)
      const systemic = computeCentrality(nodes, 'supplier')
        .filter(s => s.departmentReach >= 3 || (total > 0 && s.weightedDegree / total >= 0.15))
      return {
        lens, question: 'Who am I locked into?',
        scaleNote: 'Magenta is systemic, purple multi-department, amber ring means sole source.',
        items: systemic.slice(0, 3).map(s => ({
          label: `${s.name} — ${s.departmentReach} department${s.departmentReach === 1 ? '' : 's'}`,
          figure: fmtK(s.weightedDegree),
          nodeKeys: [s.key],
        })),
        badge: systemic.length,
      }
    }

    case 'gaps': {
      const gaps = findGaps(contracts, nodes)
      return {
        lens, question: 'What is missing?',
        scaleNote: 'Pink nodes are touched by a gap; hollow phantoms mark what should exist.',
        items: gaps.slice(0, 3).map(g => ({
          label: g.title,
          figure: fmtK(g.exposure),
          nodeKeys: g.nodeKeys,
        })),
        badge: gaps.length,
      }
    }

    case 'data': {
      const worst = contractNodes
        .map(n => ({ n, c: completeness(n) }))
        .filter(x => x.c < 1)
        .sort((a, b) => a.c - b.c)
      return {
        lens, question: 'Can I trust this data?',
        scaleNote: 'Red means fields are missing, amber partial, grey complete.',
        items: worst.slice(0, 3).map(x => ({
          label: x.n.name,
          figure: `${Math.round(x.c * 100)}% complete`,
          nodeKeys: [x.n.key],
        })),
        badge: worst.length,
      }
    }

    case 'structure':
    default: {
      const departments = new Set(contracts.map(c => c.department).filter(Boolean))
      const expiringSoon = contracts.filter(
        c => c.endDate && daysDiff(c.endDate) > 0 && daysDiff(c.endDate) <= 90)
      const busiest = computeCentrality(nodes, 'department')[0]
      const items: BriefingItem[] = []
      if (busiest) {
        items.push({
          label: `${busiest.name} is the largest department`,
          figure: fmtK(busiest.weightedDegree),
          nodeKeys: [busiest.key],
        })
      }
      items.push({
        label: `${contracts.length} contracts across ${departments.size} departments`,
        figure: fmtK(sumValue(contracts)),
        nodeKeys: [],
      })
      if (expiringSoon.length > 0) {
        items.push({
          label: `${expiringSoon.length} expiring within 90 days`,
          figure: fmtK(sumValue(expiringSoon)),
          nodeKeys: expiringSoon.map(contractKey),
        })
      }
      return {
        lens, question: 'What is connected?',
        scaleNote: 'Nodes are coloured by type; lines take the colour of what they lead to.',
        items: items.slice(0, 3),
      }
    }
  }
}

/** Badge counts for every lens tab, so the tabs advertise where the signal is. */
export function lensBadges(
  contracts: Contract[], nodes: GraphNode[], now = new Date()
): Record<string, number | undefined> {
  const out: Record<string, number | undefined> = {}
  for (const lens of ['structure', 'spend', 'risk', 'expiry', 'concentration', 'gaps', 'data'] as LensId[]) {
    out[lens] = lensBriefing(lens, contracts, nodes, now).badge
  }
  return out
}
