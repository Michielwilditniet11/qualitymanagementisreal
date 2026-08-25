/**
 * The single source of formatting. fmtK/fmtDate/daysDiff already live in
 * analytics/risk (the engines use them); this module re-exports them and adds
 * the display-only variants, so no screen declares its own again.
 */
export { fmtK, fmtDate, daysDiff } from '../analytics/risk'

/** Full currency figure with thousands separators — tables and detail rows. */
export function fmtMoney(v?: number, symbol = '€'): string {
  if (v === undefined || v === null || Number.isNaN(v)) return '—'
  return symbol + Math.round(v).toLocaleString('en-US')
}

/** Signed day count, phrased for a deadline. */
export function fmtDays(days: number): string {
  if (days < 0) return `${Math.abs(days)}d overdue`
  if (days === 0) return 'today'
  return `${days}d`
}

/** Compact percentage; returns an em dash when the base is zero. */
export function fmtPct(part: number, whole: number): string {
  if (!whole) return '—'
  return `${Math.round((part / whole) * 100)}%`
}

/** Truncate to a character budget with an ellipsis. */
export function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s
}
