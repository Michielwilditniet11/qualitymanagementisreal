import { describe, it, expect } from 'vitest'
import { nextSort, sortRows, type SortState } from '../ui/sort'
import { fmtMoney, fmtDays, fmtPct, truncate } from '../ui/format'
import { urgencyColor, healthColor, alpha, T } from '../ui/theme'

describe('sort', () => {
  const rows = [
    { n: 'b', v: 2, d: new Date('2026-02-01') },
    { n: 'a', v: 10, d: new Date('2026-01-01') },
    { n: 'c', v: undefined as number | undefined, d: new Date('2026-03-01') },
  ]
  const valueOf = (r: typeof rows[0], k: string) => (r as any)[k]

  it('sorts descending on first click and flips on the second', () => {
    let s: SortState = { key: null, dir: 'desc' }
    s = nextSort(s, 'v')
    expect(s).toEqual({ key: 'v', dir: 'desc' })
    s = nextSort(s, 'v')
    expect(s.dir).toBe('asc')
  })

  it('resets direction when a different column is clicked', () => {
    const s = nextSort({ key: 'v', dir: 'asc' }, 'n')
    expect(s).toEqual({ key: 'n', dir: 'desc' })
  })

  it('orders numbers', () => {
    const out = sortRows(rows, { key: 'v', dir: 'asc' }, valueOf)
    expect(out.map(r => r.n).slice(0, 2)).toEqual(['b', 'a'])
  })

  it('orders dates', () => {
    const out = sortRows(rows, { key: 'd', dir: 'asc' }, valueOf)
    expect(out.map(r => r.n)).toEqual(['a', 'b', 'c'])
  })

  it('orders strings', () => {
    expect(sortRows(rows, { key: 'n', dir: 'asc' }, valueOf).map(r => r.n)).toEqual(['a', 'b', 'c'])
  })

  it('keeps missing values last in both directions', () => {
    expect(sortRows(rows, { key: 'v', dir: 'asc' }, valueOf).at(-1)!.n).toBe('c')
    expect(sortRows(rows, { key: 'v', dir: 'desc' }, valueOf).at(-1)!.n).toBe('c')
  })

  it('leaves rows untouched with no sort key', () => {
    expect(sortRows(rows, { key: null, dir: 'asc' }, valueOf)).toEqual(rows)
  })

  it('does not mutate the input', () => {
    const before = rows.map(r => r.n)
    sortRows(rows, { key: 'v', dir: 'asc' }, valueOf)
    expect(rows.map(r => r.n)).toEqual(before)
  })
})

describe('format', () => {
  it('formats money with separators and an em dash for nothing', () => {
    expect(fmtMoney(1234567)).toBe('€1,234,567')
    expect(fmtMoney(undefined)).toBe('—')
    expect(fmtMoney(1000, '$')).toBe('$1,000')
  })

  it('phrases day counts as deadlines', () => {
    expect(fmtDays(45)).toBe('45d')
    expect(fmtDays(0)).toBe('today')
    expect(fmtDays(-12)).toBe('12d overdue')
  })

  it('guards percentages against a zero base', () => {
    expect(fmtPct(1, 4)).toBe('25%')
    expect(fmtPct(1, 0)).toBe('—')
  })

  it('truncates with an ellipsis', () => {
    expect(truncate('abcdef', 4)).toBe('abc…')
    expect(truncate('abc', 8)).toBe('abc')
  })
})

describe('theme', () => {
  it('escalates urgency as a deadline approaches', () => {
    expect(urgencyColor(-1)).toBe(T.red)
    expect(urgencyColor(10)).toBe(T.red)
    expect(urgencyColor(60)).toBe(T.amber)
    expect(urgencyColor(200)).toBe(T.cyan)
    expect(urgencyColor(500)).toBe(T.muted)
    expect(urgencyColor(200, true)).toBe(T.red)
  })

  it('maps health scores to bands', () => {
    expect(healthColor(90)).toBe(T.green)
    expect(healthColor(60)).toBe(T.amber)
    expect(healthColor(20)).toBe(T.red)
  })

  it('converts hex to rgba', () => {
    expect(alpha('#FF0000', 0.5)).toBe('rgba(255,0,0,0.5)')
  })
})
