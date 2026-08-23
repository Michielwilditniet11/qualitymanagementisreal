import { describe, it, expect } from 'vitest'
import { parseCSVText, guessMapping, rowsToContracts } from '../data/parser'
import { SAMPLE_CSV } from '../data/sample'
import { computeStatsByField, portfolioSummary, spendConcentrationCurve } from '../data/metrics'

function loadSample() {
  const { headers, rows } = parseCSVText(SAMPLE_CSV)
  const mapping = guessMapping(headers)
  return rowsToContracts(rows, mapping).contracts
}

describe('portfolioSummary', () => {
  it('computes totals', () => {
    const contracts = loadSample()
    const s = portfolioSummary(contracts)
    expect(s.contractCount).toBe(55)
    expect(s.totalSpend).toBeGreaterThan(0)
    expect(s.suppliers).toBeGreaterThan(10)
    expect(s.dataQuality).toBeGreaterThan(50)
    expect(s.dataQuality).toBeLessThanOrEqual(100)
  })
})

describe('computeStatsByField', () => {
  it('groups by category', () => {
    const contracts = loadSample()
    const stats = computeStatsByField(contracts, 'category', 'category')
    expect(stats.length).toBeGreaterThan(10)
    const total = stats.reduce((s, st) => s + st.totalSpend, 0)
    expect(total).toBe(portfolioSummary(contracts).totalSpend)
    for (const s of stats) {
      expect(s.healthScore).toBeGreaterThanOrEqual(0)
      expect(s.healthScore).toBeLessThanOrEqual(100)
    }
  })

  it('groups by department', () => {
    const contracts = loadSample()
    const stats = computeStatsByField(contracts, 'department', 'department')
    expect(stats.length).toBeGreaterThan(3)
  })
})

describe('spendConcentrationCurve', () => {
  it('returns sorted cumulative curve ending at 1', () => {
    const contracts = loadSample()
    const curve = spendConcentrationCurve(contracts)
    expect(curve.length).toBeGreaterThan(0)
    expect(curve[curve.length - 1].cumulativeShare).toBeCloseTo(1, 2)
    for (let i = 1; i < curve.length; i++) {
      expect(curve[i].cumulativeShare).toBeGreaterThanOrEqual(curve[i - 1].cumulativeShare)
    }
  })
})
