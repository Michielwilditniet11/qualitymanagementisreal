export type SortDir = 'asc' | 'desc'

export interface SortState {
  key: string | null
  dir: SortDir
}

/** Clicking a column: first click sorts, clicking the same one flips. */
export function nextSort(current: SortState, key: string, defaultDir: SortDir = 'desc'): SortState {
  if (current.key !== key) return { key, dir: defaultDir }
  return { key, dir: current.dir === 'asc' ? 'desc' : 'asc' }
}

/**
 * Sort rows by an extracted value. Undefined and null sort last in both
 * directions — a missing figure is never "the smallest", it is unknown.
 */
export function sortRows<T>(
  rows: T[], state: SortState, valueOf: (row: T, key: string) => unknown
): T[] {
  if (!state.key) return rows
  const key = state.key
  const sign = state.dir === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => {
    const va = valueOf(a, key)
    const vb = valueOf(b, key)
    const aMissing = va === undefined || va === null || va === ''
    const bMissing = vb === undefined || vb === null || vb === ''
    if (aMissing && bMissing) return 0
    if (aMissing) return 1
    if (bMissing) return -1
    if (va instanceof Date && vb instanceof Date) return (va.getTime() - vb.getTime()) * sign
    if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * sign
    return String(va).localeCompare(String(vb)) * sign
  })
}
