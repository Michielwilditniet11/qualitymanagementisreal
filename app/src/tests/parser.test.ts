import { describe, it, expect } from 'vitest'
import { parseCSVText, guessMapping, rowsToContracts } from '../data/parser'
import { SAMPLE_CSV } from '../data/sample'

describe('parseCSVText', () => {
  it('parses sample CSV', () => {
    const { headers, rows } = parseCSVText(SAMPLE_CSV)
    expect(headers.length).toBeGreaterThan(5)
    expect(rows.length).toBe(55)
  })

  it('handles semicolon delimiter', () => {
    const { headers, rows } = parseCSVText('a;b;c\n1;2;3\n4;5;6')
    expect(headers).toEqual(['a', 'b', 'c'])
    expect(rows.length).toBe(2)
  })

  it('handles quoted fields', () => {
    const { rows } = parseCSVText('a,b\n"hello, world","test"\n')
    expect(rows[0][0]).toBe('hello, world')
  })
})

describe('guessMapping', () => {
  it('maps known headers', () => {
    const m = guessMapping(['contract_id', 'supplier', 'annual_value', 'extra_col'])
    expect(m.contract_id).toBe(0)
    expect(m.supplier).toBe(1)
    expect(m.annual_value).toBe(2)
    expect(m['extra_col']).toBeUndefined()
  })

  it('maps Dutch headers', () => {
    const m = guessMapping(['leverancier', 'afdeling', 'jaarwaarde'])
    expect(m.supplier).toBe(0)
    expect(m.department).toBe(1)
    expect(m.annual_value).toBe(2)
  })
})

describe('rowsToContracts', () => {
  it('converts sample data', () => {
    const { headers, rows } = parseCSVText(SAMPLE_CSV)
    const mapping = guessMapping(headers)
    const { contracts, issues } = rowsToContracts(rows, mapping)
    expect(contracts.length).toBe(55)
    expect(contracts[0].supplier).toBe('TechLease BV')
    expect(contracts[0].annualValue).toBe(240000)
    expect(issues.length).toBeGreaterThan(0) // some contracts have missing owners
  })

  it('flags missing owners', () => {
    const { headers, rows } = parseCSVText(SAMPLE_CSV)
    const mapping = guessMapping(headers)
    const { issues } = rowsToContracts(rows, mapping)
    const missingOwners = issues.filter(i => i.field === 'contract_owner' && i.kind === 'missing')
    expect(missingOwners.length).toBeGreaterThan(0)
  })

  it('parses European number format', () => {
    const { contracts } = rowsToContracts([['C1', 'Test', 'Sup', 'Cat', 'Dept', 'Owner', '1.234,56', '2024-01-01', '2025-12-31', 'Active', '', '']], {
      contract_id: 0, contract_name: 1, supplier: 2, category: 3, department: 4, contract_owner: 5, annual_value: 6, start_date: 7, end_date: 8, status: 9
    })
    expect(contracts[0].annualValue).toBeCloseTo(1234.56)
  })
})
