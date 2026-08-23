import type { Contract, GraphNode } from '../data/types'
import { fmtK } from './risk'
import { generateInsights, totalValueAtRisk } from './insights'
import { computeCentrality, assessImpact } from './centrality'
import { negotiationCalendar } from './levers'
import { savingsOpportunities, savingsSummary } from './savings'
import { findGaps, gapExposure } from './gaps'
import type { LensId } from './lenses'

export interface StoryStep {
  id: string
  title: string
  /** Two or three sentences, built from engine output — no new arithmetic. */
  narration: string
  /** The single number this step turns on. */
  figure?: string
  lens: LensId
  nodeKeys: string[]
  /** How the camera should frame this step. */
  camera: 'overview' | 'frame'
  source: string
}

function sumValue(cs: Contract[]): number {
  return cs.reduce((s, c) => s + (c.annualValue ?? 0), 0)
}

/**
 * A walk-through of the portfolio's challenges, composed from the same engines
 * the panels use. Steps with nothing to say drop out, so a healthy portfolio
 * tells a short story rather than a padded one.
 */
export function buildStory(contracts: Contract[], nodes: GraphNode[]): StoryStep[] {
  const steps: StoryStep[] = []
  if (contracts.length === 0) return steps

  const totalSpend = sumValue(contracts)
  const insights = generateInsights(contracts)
  const atRisk = totalValueAtRisk(insights, contracts)
  const calendar = negotiationCalendar(contracts)
  const gaps = findGaps(contracts, nodes)
  const opportunities = savingsOpportunities(contracts)
  const savings = savingsSummary(opportunities, contracts)

  const suppliers = new Set(contracts.map(c => c.supplier).filter(Boolean)).size
  const departments = new Set(contracts.map(c => c.department).filter(Boolean)).size

  /* 1. The portfolio */
  steps.push({
    id: 'portfolio',
    title: 'The portfolio',
    narration: `${contracts.length} contracts worth ${fmtK(totalSpend)} a year, spread across ${suppliers} suppliers and ${departments} departments. Every node here is one of those; every line is a relationship the organisation depends on.`,
    figure: fmtK(totalSpend),
    lens: 'structure',
    nodeKeys: [],
    camera: 'overview',
    source: 'portfolio totals',
  })

  /* 2. Where the money is */
  const topSpend = computeCentrality(nodes, 'supplier').slice(0, 5)
  if (topSpend.length > 0) {
    const topFive = topSpend.reduce((s, x) => s + x.weightedDegree, 0)
    const share = totalSpend > 0 ? Math.round((topFive / totalSpend) * 100) : 0
    steps.push({
      id: 'spend',
      title: 'Where the money goes',
      narration: `The five largest suppliers carry ${fmtK(topFive)} between them — ${share}% of annual spend. Brightness and size now track spend, so the concentration is visible as shape rather than as a table.`,
      figure: `${share}% in five suppliers`,
      lens: 'spend',
      nodeKeys: topSpend.map(s => s.key),
      camera: 'frame',
      source: 'centrality · spend share',
    })
  }

  /* 3. Who we depend on */
  const systemic = computeCentrality(nodes, 'supplier')[0]
  if (systemic) {
    const node = nodes.find(n => n.key === systemic.key)
    const impact = node ? assessImpact(node, totalSpend) : null
    if (impact && impact.contractCount > 0) {
      steps.push({
        id: 'dependency',
        title: `Our dependency on ${systemic.name}`,
        narration: `${systemic.name} holds ${impact.contractCount} contract${impact.contractCount === 1 ? '' : 's'} worth ${fmtK(impact.annualValue)} across ${impact.departments.length} department${impact.departments.length === 1 ? '' : 's'}: ${impact.departments.join(', ')}. If they fail, that is what has to be re-sourced at once.`,
        figure: `${Math.round(impact.spendShare * 100)}% of portfolio`,
        lens: 'concentration',
        nodeKeys: [systemic.key, ...(node ? [...node.neighbors].map(n => n.key) : [])],
        camera: 'frame',
        source: 'centrality · impact assessment',
      })
    }
  }

  /* 4. What is at risk */
  if (atRisk > 0) {
    const critical = insights.filter(i => i.severity === 'critical')
    steps.push({
      id: 'risk',
      title: 'What is exposed',
      narration: `${fmtK(atRisk)} sits on contracts flagged by ${critical.length} critical finding${critical.length === 1 ? '' : 's'}${critical[0] ? `, led by: ${critical[0].title.toLowerCase()}` : ''}. Red nodes are the contracts carrying that exposure.`,
      figure: fmtK(atRisk),
      lens: 'risk',
      nodeKeys: critical.flatMap(i => i.nodeKeys).slice(0, 40),
      camera: 'frame',
      source: 'insights · value at risk',
    })
  }

  /* 5. What expires next */
  const next = calendar.filter(i => !i.missed)[0]
  const missed = calendar.filter(i => i.missed)
  if (next || missed.length > 0) {
    const narration = missed.length > 0
      ? `${missed.length} notice window${missed.length === 1 ? ' has' : 's have'} already closed, locking ${fmtK(sumValue(missed.map(m => contracts.find(c => c.id === m.contractId)).filter((c): c is Contract => Boolean(c))))} into another term.${next ? ` The next decision is ${next.contract} in ${next.daysLeft} days.` : ''}`
      : `The next decision is ${next.contract} with ${next.supplier}, ${next.daysLeft} days away, worth ${fmtK(next.value)}. Leverage peaks before that date and collapses after it.`
    steps.push({
      id: 'expiry',
      title: 'What lands next',
      narration,
      figure: next ? `${next.daysLeft} days` : `${missed.length} missed`,
      lens: 'expiry',
      nodeKeys: calendar.slice(0, 15)
        .map(i => contracts.find(c => c.id === i.contractId))
        .filter((c): c is Contract => Boolean(c))
        .map(c => `contract::${c.name}`),
      camera: 'frame',
      source: 'negotiation calendar',
    })
  }

  /* 6. What is missing */
  if (gaps.length > 0) {
    const exposure = gapExposure(gaps, contracts)
    steps.push({
      id: 'gaps',
      title: 'What is missing',
      narration: `${gaps.length} structural gap${gaps.length === 1 ? '' : 's'} touch ${fmtK(exposure)}: ${gaps.slice(0, 2).map(g => g.title.toLowerCase()).join('; ')}. The hollow nodes and dashed lines mark what should be here and is not.`,
      figure: fmtK(exposure),
      lens: 'gaps',
      nodeKeys: gaps.flatMap(g => g.nodeKeys).slice(0, 40),
      camera: 'frame',
      source: 'gap finder',
    })
  }

  /* 7. What we would do */
  const actions = calendar.filter(i => !i.missed).slice(0, 3)
  if (actions.length > 0 || savings.high > 0) {
    const list = actions.map(a => `${a.contract} (${a.daysLeft}d)`).join(', ')
    steps.push({
      id: 'actions',
      title: 'What to do about it',
      narration: `${savings.high > 0 ? `An estimated ${fmtK(savings.low)}–${fmtK(savings.high)} is addressable through consolidation and renegotiation. ` : ''}${actions.length > 0 ? `The next three moves: ${list}.` : ''} Each is a date, not an aspiration.`,
      figure: savings.high > 0 ? `${fmtK(savings.low)}–${fmtK(savings.high)}` : undefined,
      lens: 'expiry',
      nodeKeys: actions
        .map(a => contracts.find(c => c.id === a.contractId))
        .filter((c): c is Contract => Boolean(c))
        .map(c => `contract::${c.name}`),
      camera: 'frame',
      source: 'savings estimator · negotiation calendar',
    })
  }

  return steps
}
