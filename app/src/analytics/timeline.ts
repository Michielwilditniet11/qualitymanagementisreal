import type { Contract } from '../data/types'

export type WindowPreset = 'next12' | 'next90' | 'overdue' | 'all'

export interface TimeWindow {
  start: Date
  end: Date
}

export interface TimelineRow {
  contract: Contract
  /** Bar extent as percentages of the window, clamped to 0–100. */
  barStartPct: number
  barEndPct: number
  /** Where the notice period begins — the last day to still give notice. */
  noticeStartPct?: number
  daysUntil: number
  noticeDays?: number
  /** The notice deadline date, when a notice period is defined. */
  noticeDate?: Date
  overdue: boolean
  /** Auto-renews and the notice window has already closed. */
  silentRenewalRisk: boolean
  /** Term began before the window, so the bar is cut off on the left. */
  offScale: boolean
}

export interface MonthTick {
  /** Position as a percentage of the window. */
  pct: number
  label: string
  /** First month of a quarter — drawn with more emphasis. */
  major: boolean
}

const DAY = 86400000

function addMonths(d: Date, n: number): Date {
  const out = new Date(d)
  out.setMonth(out.getMonth() + n)
  return out
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1)
}

/** The time span a preset covers, given the contracts in play. */
export function timelineWindow(contracts: Contract[], preset: WindowPreset, now = new Date()): TimeWindow {
  const dated = contracts.filter(c => c.endDate)

  if (preset === 'next90') {
    return { start: new Date(now.getTime() - 7 * DAY), end: new Date(now.getTime() + 90 * DAY) }
  }

  if (preset === 'overdue') {
    const expired = dated.filter(c => c.endDate!.getTime() < now.getTime())
    if (expired.length === 0) return { start: addMonths(now, -1), end: now }
    const earliest = Math.min(...expired.map(c => c.endDate!.getTime()))
    return { start: new Date(earliest - 14 * DAY), end: now }
  }

  if (preset === 'all') {
    if (dated.length === 0) return { start: addMonths(now, -1), end: addMonths(now, 12) }
    const times = dated.map(c => c.endDate!.getTime())
    const starts = dated.filter(c => c.startDate).map(c => c.startDate!.getTime())
    const min = Math.min(...times, ...(starts.length ? starts : times), now.getTime())
    const max = Math.max(...times, now.getTime())
    // Pad so bars never sit flush against the edge.
    const pad = Math.max((max - min) * 0.02, 7 * DAY)
    return { start: new Date(min - pad), end: new Date(max + pad) }
  }

  // next12 (default)
  return { start: addMonths(now, -1), end: addMonths(now, 12) }
}

function pctOf(t: number, win: TimeWindow): number {
  const span = win.end.getTime() - win.start.getTime()
  if (span <= 0) return 0
  return ((t - win.start.getTime()) / span) * 100
}

function clamp(v: number): number {
  return Math.max(0, Math.min(100, v))
}

/**
 * One row per contract with an end date, positioned within the window.
 * Contracts without an end date cannot be placed on a timeline and are
 * excluded — the screen reports them separately.
 */
export function timelineRows(contracts: Contract[], win: TimeWindow, now = new Date()): TimelineRow[] {
  const rows: TimelineRow[] = []

  for (const c of contracts) {
    if (!c.endDate) continue
    const endT = c.endDate.getTime()
    const startT = c.startDate ? c.startDate.getTime() : win.start.getTime()

    // The window is defined by when contracts expire, so anything expiring
    // outside it is not this view's business.
    if (endT < win.start.getTime() || endT > win.end.getTime()) continue

    const rawEnd = pctOf(endT, win)
    const rawStart = pctOf(Math.min(startT, endT), win)

    // Measured against the injected `now`, not the wall clock, so every field
    // on a row describes the same instant.
    const daysUntil = Math.round((endT - now.getTime()) / DAY)
    const overdue = endT < now.getTime()

    let noticeStartPct: number | undefined
    let noticeDate: Date | undefined
    let silentRenewalRisk = false
    if (c.noticePeriodDays && c.noticePeriodDays > 0) {
      noticeDate = new Date(endT - c.noticePeriodDays * DAY)
      noticeStartPct = clamp(pctOf(noticeDate.getTime(), win))
      silentRenewalRisk = Boolean(c.autoRenew) && noticeDate.getTime() < now.getTime() && !overdue
    }

    rows.push({
      contract: c,
      barStartPct: clamp(rawStart),
      barEndPct: clamp(rawEnd),
      noticeStartPct,
      daysUntil,
      noticeDays: c.noticePeriodDays,
      noticeDate,
      overdue,
      silentRenewalRisk,
      // The bar is cut off at the left edge — the term began before the window.
      offScale: rawStart < 0,
    })
  }

  return rows.sort((a, b) => a.contract.endDate!.getTime() - b.contract.endDate!.getTime())
}

/** Month gridlines across the window; quarters are marked major. */
export function monthTicks(win: TimeWindow): MonthTick[] {
  const ticks: MonthTick[] = []
  let cursor = startOfMonth(win.start)
  if (cursor.getTime() < win.start.getTime()) cursor = addMonths(cursor, 1)

  const spanDays = (win.end.getTime() - win.start.getTime()) / DAY
  // Long windows get quarterly labels so the header stays readable.
  const everyN = spanDays > 1200 ? 6 : spanDays > 500 ? 3 : 1

  let i = 0
  while (cursor.getTime() <= win.end.getTime() && ticks.length < 200) {
    if (i % everyN === 0) {
      const major = cursor.getMonth() % 3 === 0
      ticks.push({
        pct: pctOf(cursor.getTime(), win),
        label: cursor.toLocaleString('en-US', { month: 'short' }) +
          (cursor.getMonth() === 0 || ticks.length === 0 ? ` ’${String(cursor.getFullYear()).slice(2)}` : ''),
        major,
      })
    }
    cursor = addMonths(cursor, 1)
    i++
  }
  return ticks
}

/** Where "today" sits in the window, as a percentage. */
export function todayPct(win: TimeWindow, now = new Date()): number {
  return pctOf(now.getTime(), win)
}

/**
 * The trailing label on a bar: days to expiry, with the notice period in
 * brackets when the contract has one.
 */
export function annotate(row: TimelineRow): string {
  if (row.overdue) return `${Math.abs(row.daysUntil)}d overdue`
  const base = `${row.daysUntil}d`
  return row.noticeDays ? `${base} (${row.noticeDays}d notice)` : base
}

/** Urgency colour, matching the Expiry lens in the web view. */
export function urgencyColor(row: TimelineRow): string {
  if (row.overdue || row.daysUntil < 30) return '#DC2626'
  if (row.daysUntil < 90) return '#D97706'
  if (row.daysUntil < 365) return '#0EA5E9'
  return '#475569'
}
