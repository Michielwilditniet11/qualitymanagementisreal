import { describe, it, expect } from 'vitest'
import type { Contract } from '../data/types'
import {
  parsePaymentDays, noticeDeadline, isSilentRenewal, termLengthDays,
  paymentSpreads, hasPaymentTermsData, auditTerms,
  LONG_NOTICE_DAYS, SHORT_NOTICE_DAYS, LONG_TERM_DAYS,
} from '../analytics/terms'

const NOW = new Date('2026-06-15T12:00:00Z')
const DAY = 86400000
const inDays = (n: number) => new Date(NOW.getTime() + n * DAY)

let seq = 0
function contract(over: Partial<Contract> = {}): Contract {
  seq++
  return {
    id: over.id ?? `c${seq}`,
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

const idsOf = (fs: { id: string }[]) => fs.map(f => f.id)
const has = (fs: { id: string }[], prefix: string) => idsOf(fs).some(i => i.startsWith(prefix))

describe('parsePaymentDays', () => {
  it('reads plain and NET forms', () => {
    expect(parsePaymentDays('30')).toBe(30)
    expect(parsePaymentDays('NET 30')).toBe(30)
    expect(parsePaymentDays('net30')).toBe(30)
    expect(parsePaymentDays('60 dagen')).toBe(60)
    expect(parsePaymentDays('45 days net')).toBe(45)
  })

  it('adds a month for end-of-month forms', () => {
    expect(parsePaymentDays('EOM+45')).toBe(75)
    expect(parsePaymentDays('end of month')).toBe(30)
  })

  it('treats immediate payment as zero days', () => {
    expect(parsePaymentDays('immediate')).toBe(0)
    expect(parsePaymentDays('bij ontvangst')).toBe(0)
  })

  it('returns null for anything it cannot defend', () => {
    expect(parsePaymentDays(undefined)).toBeNull()
    expect(parsePaymentDays('')).toBeNull()
    expect(parsePaymentDays('as agreed')).toBeNull()
    expect(parsePaymentDays('9999')).toBeNull()
  })
})

describe('clause primitives', () => {
  it('derives the notice deadline from end date and notice period', () => {
    const d = noticeDeadline(contract({ endDate: inDays(100), noticePeriodDays: 30 }))!
    expect(Math.round((d.getTime() - NOW.getTime()) / DAY)).toBe(70)
  })

  it('returns no deadline without a notice period', () => {
    expect(noticeDeadline(contract({ endDate: inDays(100) }))).toBeNull()
  })

  it('detects a closed notice window on an auto-renewing contract', () => {
    expect(isSilentRenewal(contract({ endDate: inDays(30), noticePeriodDays: 60, autoRenew: true }), NOW)).toBe(true)
  })

  it('does not flag while notice can still be served', () => {
    expect(isSilentRenewal(contract({ endDate: inDays(200), noticePeriodDays: 30, autoRenew: true }), NOW)).toBe(false)
  })

  it('does not flag a contract that does not auto-renew', () => {
    expect(isSilentRenewal(contract({ endDate: inDays(30), noticePeriodDays: 60, autoRenew: false }), NOW)).toBe(false)
  })

  it('does not flag an already-expired contract', () => {
    expect(isSilentRenewal(contract({ endDate: inDays(-5), noticePeriodDays: 60, autoRenew: true }), NOW)).toBe(false)
  })

  it('measures term length only with both dates', () => {
    expect(termLengthDays(contract({ startDate: inDays(-365), endDate: inDays(365) }))).toBe(730)
    expect(termLengthDays(contract({ endDate: inDays(365) }))).toBeNull()
  })
})

describe('paymentSpreads', () => {
  it('finds a supplier paid on inconsistent terms and values the gap', () => {
    const cs = [
      contract({ supplier: 'PayCo', paymentTerms: '30', annualValue: 365_000 }),
      contract({ supplier: 'PayCo', paymentTerms: '60', annualValue: 100_000 }),
    ]
    const [s] = paymentSpreads(cs)
    expect(s.supplier).toBe('PayCo')
    expect(s.best).toBe(60)
    expect(s.worst).toBe(30)
    expect(s.spendOnWorseTerms).toBe(365_000)
    // 365k over 30 extra days ≈ 30k of cash.
    expect(Math.round(s.workingCapital)).toBe(30_000)
  })

  it('stays quiet when a supplier is on consistent terms', () => {
    const cs = [
      contract({ supplier: 'Same', paymentTerms: '30' }),
      contract({ supplier: 'Same', paymentTerms: 'NET 30' }),
    ]
    expect(paymentSpreads(cs)).toHaveLength(0)
  })

  it('ignores suppliers with only one readable term', () => {
    const cs = [
      contract({ supplier: 'One', paymentTerms: '30' }),
      contract({ supplier: 'One', paymentTerms: 'as agreed' }),
    ]
    expect(paymentSpreads(cs)).toHaveLength(0)
  })
})

describe('hasPaymentTermsData', () => {
  it('is false when the field is absent from the register', () => {
    expect(hasPaymentTermsData([contract(), contract()])).toBe(false)
  })

  it('is true once most spend carries readable terms', () => {
    expect(hasPaymentTermsData([
      contract({ paymentTerms: '30', annualValue: 100_000 }),
      contract({ paymentTerms: '60', annualValue: 100_000 }),
    ])).toBe(true)
  })

  it('is false when only a sliver of spend has terms', () => {
    expect(hasPaymentTermsData([
      contract({ paymentTerms: '30', annualValue: 1_000 }),
      contract({ annualValue: 500_000 }),
    ])).toBe(false)
  })
})

describe('auditTerms', () => {
  it('returns nothing for an empty register', () => {
    expect(auditTerms([], NOW)).toEqual([])
  })

  it('flags auto-renewal with no notice period as critical', () => {
    const f = auditTerms([contract({ autoRenew: true, endDate: inDays(100) })], NOW)
    const hit = f.find(x => x.id === 'evergreen-no-notice')!
    expect(hit.severity).toBe('critical')
  })

  it('does not flag evergreen when the notice period is known', () => {
    const f = auditTerms([contract({ autoRenew: true, noticePeriodDays: 60, endDate: inDays(300) })], NOW)
    expect(has(f, 'evergreen-no-notice')).toBe(false)
  })

  it('flags a closed notice window', () => {
    const f = auditTerms([contract({ autoRenew: true, noticePeriodDays: 60, endDate: inDays(30) })], NOW)
    expect(has(f, 'notice-window-closed')).toBe(true)
  })

  it('flags supplier-friendly notice periods', () => {
    const f = auditTerms([contract({ noticePeriodDays: LONG_NOTICE_DAYS, endDate: inDays(400) })], NOW)
    expect(has(f, 'long-notice')).toBe(true)
  })

  it('escalates a long notice period on a single-source supplier', () => {
    const f = auditTerms([
      contract({ supplier: 'Only', category: 'Niche', noticePeriodDays: 180, endDate: inDays(400) }),
    ], NOW)
    expect(f.find(x => x.id.startsWith('long-notice'))!.severity).toBe('critical')
  })

  it('does not flag a conventional notice period', () => {
    const f = auditTerms([contract({ noticePeriodDays: 90, endDate: inDays(400) })], NOW)
    expect(has(f, 'long-notice')).toBe(false)
  })

  it('flags short notice only on top-quartile spend', () => {
    const cs = [
      contract({ name: 'Big', noticePeriodDays: SHORT_NOTICE_DAYS, endDate: inDays(300), annualValue: 900_000 }),
      contract({ name: 'Small', noticePeriodDays: SHORT_NOTICE_DAYS, endDate: inDays(300), annualValue: 1_000 }),
      contract({ annualValue: 2_000 }),
      contract({ annualValue: 3_000 }),
    ]
    const f = auditTerms(cs, NOW)
    const titles = f.filter(x => x.id.startsWith('short-notice')).map(x => x.title).join()
    expect(titles).toContain('Big')
    expect(titles).not.toContain('Small')
  })

  it('flags long auto-renewing terms', () => {
    const f = auditTerms([contract({
      autoRenew: true, noticePeriodDays: 60,
      startDate: new Date(NOW.getTime() - LONG_TERM_DAYS * DAY), endDate: inDays(400),
    })], NOW)
    expect(has(f, 'long-term')).toBe(true)
  })

  it('does not flag a long term that does not auto-renew', () => {
    const f = auditTerms([contract({
      autoRenew: false,
      startDate: new Date(NOW.getTime() - LONG_TERM_DAYS * DAY), endDate: inDays(400),
    })], NOW)
    expect(has(f, 'long-term')).toBe(false)
  })

  it('flags a payment-terms spread with the harmonisation fix', () => {
    const f = auditTerms([
      contract({ supplier: 'PayCo', paymentTerms: '30', annualValue: 200_000 }),
      contract({ supplier: 'PayCo', paymentTerms: '60', annualValue: 200_000 }),
    ], NOW)
    const hit = f.find(x => x.id.startsWith('payment-spread'))!
    expect(hit.fix).toContain('60-day')
  })

  it('flags paying faster than the conventional floor', () => {
    const f = auditTerms([contract({ paymentTerms: '14', annualValue: 100_000 })], NOW)
    expect(has(f, 'fast-payment')).toBe(true)
  })

  it('does not flag conventional payment terms', () => {
    const f = auditTerms([contract({ paymentTerms: '60', annualValue: 100_000 })], NOW)
    expect(has(f, 'fast-payment')).toBe(false)
  })

  it('reports indexation keywords found in unmapped columns as info only', () => {
    const f = auditTerms([contract({ raw: { remarks: 'Annual CPI indexation applies' } })], NOW)
    const hit = f.find(x => x.id === 'raw-scan:indexation')!
    expect(hit.severity).toBe('info')
    expect(hit.detail).toContain('remarks')
    expect(hit.detail).toContain('not a reading of the agreement')
  })

  it('reports unilateral-change keywords separately', () => {
    const f = auditTerms([contract({ raw: { clause: "changes at supplier's discretion" } })], NOW)
    expect(has(f, 'raw-scan:unilateral')).toBe(true)
  })

  it('does not fire the scan on unrelated text', () => {
    const f = auditTerms([contract({ raw: { remarks: 'standard delivery schedule' } })], NOW)
    expect(has(f, 'raw-scan')).toBe(false)
  })

  it('flags a contract marked active but past its end date', () => {
    const f = auditTerms([contract({ status: 'Active', endDate: inDays(-30) })], NOW)
    expect(has(f, 'status-active-expired')).toBe(true)
  })

  it('flags a contract marked closed but still running', () => {
    const f = auditTerms([contract({ status: 'Expired', endDate: inDays(90) })], NOW)
    expect(has(f, 'status-expired-future')).toBe(true)
  })

  it('does not flag a consistent status', () => {
    const f = auditTerms([contract({ status: 'Active', endDate: inDays(90) })], NOW)
    expect(has(f, 'status-')).toBe(false)
  })

  it('ranks critical findings first', () => {
    const cs = [
      contract({ autoRenew: true, endDate: inDays(100) }),
      contract({ paymentTerms: '14', annualValue: 50_000 }),
      contract({ raw: { note: 'CPI uplift' } }),
    ]
    const ranks = auditTerms(cs, NOW).map(f => ['critical', 'warning', 'info'].indexOf(f.severity))
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b))
  })

  it('stays silent on payment analytics when the field is absent', () => {
    const f = auditTerms([contract(), contract({ supplier: 'B' })], NOW)
    expect(f.some(x => x.clause === 'payment')).toBe(false)
  })
})
