import type { Contract, EntityStats } from './types'
import { registerCompleteness } from './completeness'

/**
 * Every figure here takes the instant it is measured against. A module-level
 * `new Date()` froze "today" at import, so a dashboard left open past midnight
 * drifted out of agreement with the Web and Calendar, which recompute live.
 */
function daysDiff(d: Date, now: Date): number {
  return Math.round((d.getTime() - now.getTime()) / 86400000)
}

function computeEntityStats(
  name: string,
  type: EntityStats['type'],
  contracts: Contract[],
  now: Date,
  totalPortfolioSpend: number
): EntityStats {
  const totalSpend = contracts.reduce((s, c) => s + (c.annualValue ?? 0), 0)
  const spendShare = totalPortfolioSpend > 0 ? totalSpend / totalPortfolioSpend : 0

  const suppliers = new Map<string, number>()
  for (const c of contracts) {
    suppliers.set(c.supplier, (suppliers.get(c.supplier) ?? 0) + (c.annualValue ?? 0))
  }

  let topSupplier: EntityStats['topSupplier']
  let maxSpend = 0
  for (const [sup, spend] of suppliers) {
    if (spend > maxSpend) {
      maxSpend = spend
      topSupplier = { name: sup, spend, share: totalSpend > 0 ? spend / totalSpend : 0 }
    }
  }

  const supplierConcentration = topSupplier?.share ?? 0
  const singleSource = suppliers.size === 1 && contracts.length > 1

  const expiring90 = contracts.filter(c => c.endDate && daysDiff(c.endDate, now) > 0 && daysDiff(c.endDate, now) <= 90)
  const expiring180 = contracts.filter(c => c.endDate && daysDiff(c.endDate, now) > 90 && daysDiff(c.endDate, now) <= 180)
  const expired = contracts.filter(c => c.endDate && daysDiff(c.endDate, now) < 0)
  const missingOwner = contracts.filter(c => !c.owner)
  const missingValue = contracts.filter(c => c.annualValue === undefined)

  let risk = 0
  risk += supplierConcentration > 0.8 ? 30 : supplierConcentration > 0.6 ? 15 : 0
  risk += singleSource ? 10 : 0
  risk += Math.min(25, expiring90.length * 10)
  risk += Math.min(20, expired.length * 10)
  risk += Math.min(15, missingOwner.length * 5)
  risk += Math.min(10, missingValue.length * 5)
  // silent renewal risk
  const silentRenewal = contracts.filter(c => {
    if (!c.autoRenew || !c.endDate || !c.noticePeriodDays) return false
    const noticeDate = daysDiff(c.endDate, now) - c.noticePeriodDays
    return noticeDate <= 30 && daysDiff(c.endDate, now) > 0
  })
  risk += Math.min(15, silentRenewal.length * 8)

  const healthScore = Math.max(0, 100 - risk)

  return {
    name, type, contracts, totalSpend, spendShare, contractCount: contracts.length,
    expiring90, expiring180, expired, missingOwner, missingValue,
    supplierConcentration, topSupplier, singleSource, healthScore,
  }
}

export function computeStatsByField(
  contracts: Contract[],
  field: 'category' | 'department' | 'supplier' | 'owner',
  type: EntityStats['type'],
  now = new Date()
): EntityStats[] {
  const totalSpend = contracts.reduce((s, c) => s + (c.annualValue ?? 0), 0)
  const groups = new Map<string, Contract[]>()
  for (const c of contracts) {
    const key = field === 'owner' ? (c.owner ?? '(no owner)') : (c as any)[field] as string
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(c)
  }
  return [...groups.entries()]
    .map(([name, cs]) => computeEntityStats(name, type, cs, now, totalSpend))
    .sort((a, b) => b.totalSpend - a.totalSpend)
}

export function portfolioSummary(contracts: Contract[], now = new Date()) {
  const totalSpend = contracts.reduce((s, c) => s + (c.annualValue ?? 0), 0)
  const suppliers = new Set(contracts.map(c => c.supplier)).size
  const departments = new Set(contracts.map(c => c.department)).size
  const categories = new Set(contracts.map(c => c.category)).size
  const owners = new Set(contracts.filter(c => c.owner).map(c => c.owner)).size
  const expiring90 = contracts.filter(c => c.endDate && daysDiff(c.endDate, now) > 0 && daysDiff(c.endDate, now) <= 90).length
  const expired = contracts.filter(c => c.endDate && daysDiff(c.endDate, now) < 0).length
  const missingOwner = contracts.filter(c => !c.owner).length
  const missingValue = contracts.filter(c => c.annualValue === undefined).length
  const avgValue = contracts.filter(c => c.annualValue !== undefined).length > 0
    ? totalSpend / contracts.filter(c => c.annualValue !== undefined).length
    : 0
  const dataQuality = Math.round(registerCompleteness(contracts) * 100)
  return { totalSpend, suppliers, departments, categories, owners, expiring90, expired, missingOwner, missingValue, avgValue, dataQuality, contractCount: contracts.length }
}

export function spendConcentrationCurve(contracts: Contract[]): { supplier: string; cumulativeShare: number }[] {
  const map = new Map<string, number>()
  for (const c of contracts) map.set(c.supplier, (map.get(c.supplier) ?? 0) + (c.annualValue ?? 0))
  const sorted = [...map.entries()].sort((a, b) => b[1] - a[1])
  const total = sorted.reduce((s, [, v]) => s + v, 0)
  let cum = 0
  return sorted.map(([supplier, v]) => { cum += v; return { supplier, cumulativeShare: total > 0 ? cum / total : 0 } })
}
