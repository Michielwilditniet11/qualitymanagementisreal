import type { Contract } from './types'

/**
 * The parser substitutes these when a column is blank or unmapped, so the rest
 * of the app always has a string to group and label by. They are *not* data:
 * counting them as populated is how a register with three mapped columns
 * reports high confidence, which is precisely the claim the tool must never
 * make on its own behalf.
 *
 * Exported so the parser and the completeness check cannot drift apart.
 */
export const PLACEHOLDERS: Record<string, string> = {
  supplier: 'Unknown supplier',
  category: 'Uncategorized',
  department: 'Unassigned',
}

/** The six fields every other figure depends on. */
export const KEY_FIELDS = [
  'supplier', 'category', 'department', 'owner', 'annualValue', 'endDate',
] as const

export type KeyField = typeof KEY_FIELDS[number]

/** Is this field genuinely populated — a real value, not a stand-in? */
export function fieldPresent(c: Contract, field: KeyField): boolean {
  if (field === 'annualValue') return c.annualValue !== undefined
  if (field === 'endDate') return Boolean(c.endDate)
  const v = (c as unknown as Record<string, unknown>)[field]
  if (typeof v !== 'string' || v.trim() === '') return false
  const placeholder = PLACEHOLDERS[field]
  return placeholder === undefined || v !== placeholder
}

/** How many of the six key fields this contract really has, 0–6. */
export function fieldsPresent(c: Contract): number {
  let n = 0
  for (const f of KEY_FIELDS) if (fieldPresent(c, f)) n++
  return n
}

/** One contract's completeness, 0–1. */
export function contractCompleteness(c: Contract): number {
  return fieldsPresent(c) / KEY_FIELDS.length
}

/** Share of key fields populated across a register, 0–1. Empty reads as 1. */
export function registerCompleteness(contracts: Contract[]): number {
  if (contracts.length === 0) return 1
  const total = contracts.length * KEY_FIELDS.length
  let filled = 0
  for (const c of contracts) filled += fieldsPresent(c)
  return filled / total
}
