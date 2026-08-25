import type { Contract } from '../data/types'
import { noticeDeadline, isSilentRenewal } from './terms'

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
  /** No start date recorded — the bar's left edge is not real. */
  unknownStart: boolean
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
    const deadline = noticeDeadline(c)
    if (deadline) {
      noticeDate = deadline
      noticeStartPct = clamp(pctOf(deadline.getTime(), win))
    }
    const silentRenewalRisk = isSilentRenewal(c, now)

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
      unknownStart: !c.startDate,
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

/* ─── Zoom, pan and density (UX2) ─── */

/** Smallest window the user can zoom to — a fortnight reads as a fortnight. */
export const MIN_WINDOW_DAYS = 14
export const MAX_WINDOW_DAYS = 365 * 10

/**
 * A window that hugs the data: from just before the first relevant expiry to
 * just after the last, with padding — never years of empty axis.
 */
export function fitWindow(contracts: Contract[], now = new Date(), padPct = 0.06): TimeWindow {
  const dated = contracts.filter(c => c.endDate)
  if (dated.length === 0) return { start: addMonths(now, -1), end: addMonths(now, 12) }
  const times = dated.map(c => c.endDate!.getTime())
  let min = Math.min(...times, now.getTime())
  let max = Math.max(...times, now.getTime())
  if (max - min < MIN_WINDOW_DAYS * DAY) {
    const mid = (min + max) / 2
    min = mid - (MIN_WINDOW_DAYS / 2) * DAY
    max = mid + (MIN_WINDOW_DAYS / 2) * DAY
  }
  const pad = (max - min) * padPct
  return { start: new Date(min - pad), end: new Date(max + pad) }
}

/**
 * Zoom about a focus point given as a fraction of the current window, so the
 * date under the cursor stays under the cursor.
 */
export function zoomWindow(win: TimeWindow, factor: number, focusPct = 0.5): TimeWindow {
  const span = win.end.getTime() - win.start.getTime()
  const focus = win.start.getTime() + span * Math.max(0, Math.min(1, focusPct))
  let next = span * factor
  next = Math.max(MIN_WINDOW_DAYS * DAY, Math.min(MAX_WINDOW_DAYS * DAY, next))
  const ratio = next / span
  return {
    start: new Date(focus - (focus - win.start.getTime()) * ratio),
    end: new Date(focus + (win.end.getTime() - focus) * ratio),
  }
}

/** Slide the window by a fraction of its own span. */
export function panWindow(win: TimeWindow, deltaPct: number): TimeWindow {
  const span = win.end.getTime() - win.start.getTime()
  const shift = span * deltaPct
  return { start: new Date(win.start.getTime() + shift), end: new Date(win.end.getTime() + shift) }
}

export interface MonthBucket {
  label: string
  startPct: number
  widthPct: number
  value: number
  count: number
  /** Soonest days-until among the bucket's contracts, for colouring. */
  soonestDays: number
  start: Date
  end: Date
}

/** Expiring value per month across the window — the density header. */
export function monthDensity(rows: TimelineRow[], win: TimeWindow): MonthBucket[] {
  const span = win.end.getTime() - win.start.getTime()
  if (span <= 0) return []
  const buckets = new Map<string, MonthBucket>()
  for (const r of rows) {
    const d = r.contract.endDate!
    const key = `${d.getFullYear()}-${d.getMonth()}`
    let b = buckets.get(key)
    if (!b) {
      const start = new Date(d.getFullYear(), d.getMonth(), 1)
      const end = new Date(d.getFullYear(), d.getMonth() + 1, 1)
      b = {
        label: start.toLocaleString('en-US', { month: 'short' }) + ` ’${String(start.getFullYear()).slice(2)}`,
        startPct: ((start.getTime() - win.start.getTime()) / span) * 100,
        widthPct: ((end.getTime() - start.getTime()) / span) * 100,
        value: 0, count: 0, soonestDays: Infinity, start, end,
      }
      buckets.set(key, b)
    }
    b.value += r.contract.annualValue ?? 0
    b.count++
    if (r.daysUntil < b.soonestDays) b.soonestDays = r.daysUntil
  }
  return [...buckets.values()].sort((a, b) => a.start.getTime() - b.start.getTime())
}

export interface PartitionedRows {
  /** Notice window still open — a decision is possible. */
  decidable: TimelineRow[]
  /** Future expiries with no open notice window. */
  upcoming: TimelineRow[]
  /** Already past their end date. */
  overdue: TimelineRow[]
}

/**
 * Lead with what can still be decided. Sorting purely by end date buries the
 * actionable future beneath a wall of expired contracts.
 */
export function partitionRows(rows: TimelineRow[], now = new Date()): PartitionedRows {
  const decidable: TimelineRow[] = []
  const upcoming: TimelineRow[] = []
  const overdue: TimelineRow[] = []
  for (const r of rows) {
    if (r.overdue) overdue.push(r)
    else if (r.noticeDate && r.noticeDate.getTime() >= now.getTime() && !r.silentRenewalRisk) decidable.push(r)
    else upcoming.push(r)
  }
  const byNotice = (a: TimelineRow, b: TimelineRow) =>
    (a.noticeDate?.getTime() ?? a.contract.endDate!.getTime()) -
    (b.noticeDate?.getTime() ?? b.contract.endDate!.getTime())
  const byEnd = (a: TimelineRow, b: TimelineRow) =>
    a.contract.endDate!.getTime() - b.contract.endDate!.getTime()
  return {
    decidable: decidable.sort(byNotice),
    upcoming: upcoming.sort(byEnd),
    overdue: overdue.sort((a, b) => b.contract.endDate!.getTime() - a.contract.endDate!.getTime()),
  }
}

/** Decision points — the notice deadlines that belong in their own lane. */
export interface DecisionPoint {
  row: TimelineRow
  pct: number
  missed: boolean
}

export function decisionPoints(rows: TimelineRow[], win: TimeWindow, now = new Date()): DecisionPoint[] {
  const span = win.end.getTime() - win.start.getTime()
  if (span <= 0) return []
  const out: DecisionPoint[] = []
  for (const r of rows) {
    if (!r.noticeDate) continue
    const t = r.noticeDate.getTime()
    if (t < win.start.getTime() || t > win.end.getTime()) continue
    out.push({
      row: r,
      pct: ((t - win.start.getTime()) / span) * 100,
      missed: t < now.getTime(),
    })
  }
  return out.sort((a, b) => a.pct - b.pct)
}
