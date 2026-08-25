import { describe, it, expect } from 'vitest'
import type { Contract } from '../data/types'
import {
  timelineWindow, timelineRows, monthTicks, todayPct, annotate, urgencyColor,
} from '../analytics/timeline'

const NOW = new Date('2026-06-15T12:00:00Z')
const DAY = 86400000

let seq = 0
function contract(over: Partial<Contract> = {}): Contract {
  seq++
  return {
    id: `c${seq}`,
    name: over.name ?? `Contract ${seq}`,
    supplier: 'Acme',
    category: 'IT',
    department: 'Finance',
    owner: 'Alice',
    annualValue: 10_000,
    tags: [],
    raw: {},
    ...over,
  }
}

function inDays(n: number): Date {
  return new Date(NOW.getTime() + n * DAY)
}

describe('timelineWindow', () => {
  it('spans a month back and a year forward by default', () => {
    const w = timelineWindow([], 'next12', NOW)
    expect(w.start.getTime()).toBeLessThan(NOW.getTime())
    expect(w.end.getTime()).toBeGreaterThan(NOW.getTime() + 300 * DAY)
  })

  it('covers roughly 90 days ahead for the short preset', () => {
    const w = timelineWindow([], 'next90', NOW)
    const days = (w.end.getTime() - w.start.getTime()) / DAY
    expect(days).toBeGreaterThan(90)
    expect(days).toBeLessThan(105)
  })

  it('ends at today for the overdue preset and reaches the oldest expiry', () => {
    const cs = [contract({ endDate: inDays(-200) }), contract({ endDate: inDays(-10) })]
    const w = timelineWindow(cs, 'overdue', NOW)
    expect(w.end.getTime()).toBe(NOW.getTime())
    expect(w.start.getTime()).toBeLessThan(inDays(-200).getTime())
  })

  it('falls back to a sane window when nothing is overdue', () => {
    const w = timelineWindow([contract({ endDate: inDays(100) })], 'overdue', NOW)
    expect(w.end.getTime()).toBe(NOW.getTime())
    expect(w.start.getTime()).toBeLessThan(w.end.getTime())
  })

  it('spans every contract for the all preset', () => {
    const cs = [
      contract({ startDate: inDays(-500), endDate: inDays(-300) }),
      contract({ endDate: inDays(900) }),
    ]
    const w = timelineWindow(cs, 'all', NOW)
    expect(w.start.getTime()).toBeLessThan(inDays(-500).getTime())
    expect(w.end.getTime()).toBeGreaterThan(inDays(900).getTime())
  })

  it('handles an empty portfolio without producing an inverted window', () => {
    for (const p of ['next12', 'next90', 'overdue', 'all'] as const) {
      const w = timelineWindow([], p, NOW)
      expect(w.end.getTime()).toBeGreaterThan(w.start.getTime())
    }
  })
})

describe('timelineRows', () => {
  const win = timelineWindow([], 'next12', NOW)

  it('excludes contracts with no end date', () => {
    const rows = timelineRows([contract({ endDate: undefined })], win, NOW)
    expect(rows).toHaveLength(0)
  })

  it('clamps bars to the window', () => {
    const rows = timelineRows([
      contract({ startDate: inDays(-900), endDate: inDays(200) }),
    ], win, NOW)
    expect(rows[0].barStartPct).toBe(0)
    expect(rows[0].barEndPct).toBeGreaterThan(0)
    expect(rows[0].barEndPct).toBeLessThanOrEqual(100)
    expect(rows[0].offScale).toBe(true)
  })

  it('drops contracts entirely outside the window', () => {
    const rows = timelineRows([contract({ endDate: inDays(2000) })], win, NOW)
    expect(rows).toHaveLength(0)
  })

  it('positions the notice segment before the bar end', () => {
    const rows = timelineRows([
      contract({ endDate: inDays(200), noticePeriodDays: 90 }),
    ], win, NOW)
    expect(rows[0].noticeStartPct).toBeDefined()
    expect(rows[0].noticeStartPct!).toBeLessThan(rows[0].barEndPct)
    expect(rows[0].noticeDate!.getTime()).toBeLessThan(rows[0].contract.endDate!.getTime())
  })

  it('leaves the notice segment undefined without a notice period', () => {
    const rows = timelineRows([contract({ endDate: inDays(200) })], win, NOW)
    expect(rows[0].noticeStartPct).toBeUndefined()
    expect(rows[0].noticeDays).toBeUndefined()
  })

  it('marks overdue contracts', () => {
    const rows = timelineRows([contract({ endDate: inDays(-20) })], win, NOW)
    expect(rows[0].overdue).toBe(true)
    expect(rows[0].daysUntil).toBeLessThan(0)
  })

  it('flags silent renewal when auto-renew and the notice window has closed', () => {
    const rows = timelineRows([
      contract({ endDate: inDays(30), noticePeriodDays: 60, autoRenew: true }),
    ], win, NOW)
    expect(rows[0].silentRenewalRisk).toBe(true)
  })

  it('does not flag silent renewal while notice can still be given', () => {
    const rows = timelineRows([
      contract({ endDate: inDays(200), noticePeriodDays: 30, autoRenew: true }),
    ], win, NOW)
    expect(rows[0].silentRenewalRisk).toBe(false)
  })

  it('does not flag silent renewal without auto-renew', () => {
    const rows = timelineRows([
      contract({ endDate: inDays(30), noticePeriodDays: 60, autoRenew: false }),
    ], win, NOW)
    expect(rows[0].silentRenewalRisk).toBe(false)
  })

  it('sorts soonest expiry first', () => {
    const rows = timelineRows([
      contract({ name: 'Late', endDate: inDays(300) }),
      contract({ name: 'Soon', endDate: inDays(10) }),
      contract({ name: 'Mid', endDate: inDays(100) }),
    ], win, NOW)
    expect(rows.map(r => r.contract.name)).toEqual(['Soon', 'Mid', 'Late'])
  })
})

describe('monthTicks', () => {
  it('produces monthly ticks across a one-year window', () => {
    const ticks = monthTicks(timelineWindow([], 'next12', NOW))
    expect(ticks.length).toBeGreaterThanOrEqual(12)
    for (const t of ticks) {
      expect(t.pct).toBeGreaterThanOrEqual(0)
      expect(t.pct).toBeLessThanOrEqual(100)
    }
  })

  it('thins out labels on a very long window', () => {
    const long = { start: new Date('2010-01-01'), end: new Date('2030-01-01') }
    const ticks = monthTicks(long)
    expect(ticks.length).toBeLessThan(60)
  })

  it('marks quarter starts as major', () => {
    const ticks = monthTicks(timelineWindow([], 'next12', NOW))
    expect(ticks.some(t => t.major)).toBe(true)
  })
})

describe('todayPct', () => {
  it('places today inside the default window', () => {
    const p = todayPct(timelineWindow([], 'next12', NOW), NOW)
    expect(p).toBeGreaterThan(0)
    expect(p).toBeLessThan(100)
  })
})

describe('annotate', () => {
  const win = timelineWindow([], 'next12', NOW)
  const rowFor = (over: Partial<Contract>) => timelineRows([contract(over)], win, NOW)[0]

  it('shows days and the notice period in brackets', () => {
    expect(annotate(rowFor({ endDate: inDays(45), noticePeriodDays: 90 }))).toBe('45d (90d notice)')
  })

  it('shows days alone when there is no notice period', () => {
    expect(annotate(rowFor({ endDate: inDays(45) }))).toBe('45d')
  })

  it('reports overdue contracts in days past', () => {
    expect(annotate(rowFor({ endDate: inDays(-12) }))).toBe('12d overdue')
  })
})

describe('urgencyColor', () => {
  // Window must be built from the contract itself, or a far-future expiry
  // falls outside it and produces no row.
  const rowFor = (days: number) => {
    const cs = [contract({ endDate: inDays(days) })]
    return timelineRows(cs, timelineWindow(cs, 'all', NOW), NOW)[0]
  }

  it('escalates as expiry approaches', () => {
    expect(urgencyColor(rowFor(-5))).toBe('#DC2626')
    expect(urgencyColor(rowFor(10))).toBe('#DC2626')
    expect(urgencyColor(rowFor(60))).toBe('#D97706')
    expect(urgencyColor(rowFor(200))).toBe('#0EA5E9')
    expect(urgencyColor(rowFor(500))).toBe('#475569')
  })
})

/* ─── Zoom, pan, density, partition (UX2) ─── */

import {
  fitWindow, zoomWindow, panWindow, monthDensity, partitionRows, decisionPoints,
  MIN_WINDOW_DAYS, MAX_WINDOW_DAYS,
} from '../analytics/timeline'

describe('fitWindow', () => {
  it('hugs the data instead of spanning empty years', () => {
    const cs = [contract({ endDate: inDays(30) }), contract({ endDate: inDays(90) })]
    const w = fitWindow(cs, NOW)
    const days = (w.end.getTime() - w.start.getTime()) / DAY
    expect(days).toBeLessThan(200)
    expect(w.start.getTime()).toBeLessThanOrEqual(NOW.getTime())
  })

  it('never collapses below the minimum window', () => {
    const cs = [contract({ endDate: inDays(1) })]
    const w = fitWindow(cs, NOW)
    expect((w.end.getTime() - w.start.getTime()) / DAY).toBeGreaterThanOrEqual(MIN_WINDOW_DAYS)
  })

  it('falls back sensibly with no dated contracts', () => {
    const w = fitWindow([contract({ endDate: undefined })], NOW)
    expect(w.end.getTime()).toBeGreaterThan(w.start.getTime())
  })
})

describe('zoomWindow', () => {
  const base = { start: new Date('2026-01-01'), end: new Date('2027-01-01') }

  it('shrinks and grows the span', () => {
    expect(zoomWindow(base, 0.5).end.getTime() - zoomWindow(base, 0.5).start.getTime())
      .toBeLessThan(base.end.getTime() - base.start.getTime())
    expect(zoomWindow(base, 2).end.getTime() - zoomWindow(base, 2).start.getTime())
      .toBeGreaterThan(base.end.getTime() - base.start.getTime())
  })

  it('keeps the focus date under the cursor', () => {
    const span = base.end.getTime() - base.start.getTime()
    const focusTime = base.start.getTime() + span * 0.25
    const z = zoomWindow(base, 0.5, 0.25)
    const newSpan = z.end.getTime() - z.start.getTime()
    const newFocusPct = (focusTime - z.start.getTime()) / newSpan
    expect(newFocusPct).toBeCloseTo(0.25, 5)
  })

  it('clamps to the min and max window', () => {
    const tiny = zoomWindow(base, 0.0001)
    expect((tiny.end.getTime() - tiny.start.getTime()) / DAY).toBeCloseTo(MIN_WINDOW_DAYS, 0)
    const huge = zoomWindow(base, 10000)
    expect((huge.end.getTime() - huge.start.getTime()) / DAY).toBeCloseTo(MAX_WINDOW_DAYS, 0)
  })
})

describe('panWindow', () => {
  it('slides without changing the span', () => {
    const base = { start: new Date('2026-01-01'), end: new Date('2027-01-01') }
    const p = panWindow(base, 0.5)
    expect(p.end.getTime() - p.start.getTime()).toBe(base.end.getTime() - base.start.getTime())
    expect(p.start.getTime()).toBeGreaterThan(base.start.getTime())
  })
})

describe('monthDensity', () => {
  it('buckets expiring value by month', () => {
    const cs = [
      contract({ endDate: new Date('2026-08-10'), annualValue: 100 }),
      contract({ endDate: new Date('2026-08-20'), annualValue: 200 }),
      contract({ endDate: new Date('2026-09-05'), annualValue: 50 }),
    ]
    const win = fitWindow(cs, NOW)
    const d = monthDensity(timelineRows(cs, win, NOW), win)
    expect(d).toHaveLength(2)
    expect(d[0].value).toBe(300)
    expect(d[0].count).toBe(2)
    expect(d[1].value).toBe(50)
  })

  it('is empty when nothing is in range', () => {
    expect(monthDensity([], fitWindow([], NOW))).toEqual([])
  })
})

describe('partitionRows', () => {
  it('separates decidable, upcoming and overdue', () => {
    const cs = [
      contract({ name: 'Decidable', endDate: inDays(200), noticePeriodDays: 30 }),
      contract({ name: 'Upcoming', endDate: inDays(150) }),
      contract({ name: 'Expired', endDate: inDays(-20) }),
    ]
    const win = fitWindow(cs, NOW)
    const p = partitionRows(timelineRows(cs, win, NOW), NOW)
    expect(p.decidable.map(r => r.contract.name)).toEqual(['Decidable'])
    expect(p.upcoming.map(r => r.contract.name)).toEqual(['Upcoming'])
    expect(p.overdue.map(r => r.contract.name)).toEqual(['Expired'])
  })

  it('treats a closed notice window as no longer decidable', () => {
    const cs = [contract({ endDate: inDays(20), noticePeriodDays: 60, autoRenew: true })]
    const win = fitWindow(cs, NOW)
    const p = partitionRows(timelineRows(cs, win, NOW), NOW)
    expect(p.decidable).toHaveLength(0)
    expect(p.upcoming).toHaveLength(1)
  })

  it('orders decidable rows by act-by date', () => {
    const cs = [
      contract({ name: 'Later', endDate: inDays(300), noticePeriodDays: 30 }),
      contract({ name: 'Sooner', endDate: inDays(100), noticePeriodDays: 30 }),
    ]
    const win = fitWindow(cs, NOW)
    const p = partitionRows(timelineRows(cs, win, NOW), NOW)
    expect(p.decidable.map(r => r.contract.name)).toEqual(['Sooner', 'Later'])
  })
})

describe('decisionPoints', () => {
  it('emits one point per notice deadline inside the window', () => {
    const cs = [
      contract({ endDate: inDays(200), noticePeriodDays: 30 }),
      contract({ endDate: inDays(150) }),
    ]
    const win = fitWindow(cs, NOW)
    const pts = decisionPoints(timelineRows(cs, win, NOW), win, NOW)
    expect(pts).toHaveLength(1)
    expect(pts[0].pct).toBeGreaterThanOrEqual(0)
    expect(pts[0].pct).toBeLessThanOrEqual(100)
  })

  it('marks a passed deadline as missed', () => {
    const cs = [contract({ endDate: inDays(20), noticePeriodDays: 60, autoRenew: true })]
    // The deadline sits 40 days in the past, so the window must reach back
    // past it — a fitted window would legitimately exclude the point.
    const win = { start: inDays(-90), end: inDays(90) }
    const pts = decisionPoints(timelineRows(cs, win, NOW), win, NOW)
    expect(pts[0].missed).toBe(true)
  })

  it('omits deadlines that fall outside the window', () => {
    const cs = [contract({ endDate: inDays(20), noticePeriodDays: 60, autoRenew: true })]
    const win = fitWindow(cs, NOW)
    expect(decisionPoints(timelineRows(cs, win, NOW), win, NOW)).toHaveLength(0)
  })
})

describe('unknownStart', () => {
  it('flags rows whose term start is not recorded', () => {
    const cs = [contract({ endDate: inDays(100) }), contract({ endDate: inDays(100), startDate: inDays(-100) })]
    const win = fitWindow(cs, NOW)
    const rows = timelineRows(cs, win, NOW)
    expect(rows.some(r => r.unknownStart)).toBe(true)
    expect(rows.some(r => !r.unknownStart)).toBe(true)
  })
})
