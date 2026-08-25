import Papa from 'papaparse'
import * as XLSX from 'xlsx'
import type { Contract, ColumnMapping, DataIssue, Dataset } from './types'
import { PLACEHOLDERS } from './completeness'

const HEADER_ALIASES: Record<string, string[]> = {
  contract_id: ['contract_id', 'contractid', 'id', 'contract no', 'contract number', 'contractnr', 'vertragsnummer'],
  contract_name: ['contract_name', 'contract', 'name', 'description', 'contract description', 'title', 'contractnaam', 'vertragsname'],
  supplier: ['supplier', 'vendor', 'supplier_name', 'vendor_name', 'leverancier', 'lieferant', 'fournisseur'],
  category: ['category', 'spend_category', 'commodity', 'categorie', 'spend category', 'kategorie', 'catégorie'],
  department: ['department', 'dept', 'business_unit', 'afdeling', 'business unit', 'cost_center', 'cost center', 'abteilung', 'département'],
  contract_owner: ['contract_owner', 'owner', 'manager', 'contract manager', 'responsible', 'contracteigenaar', 'verantwortlich', 'responsable'],
  annual_value: ['annual_value', 'value', 'amount', 'spend', 'annual spend', 'contract value', 'jaarwaarde', 'total_value', 'contract_value', 'jahreswert', 'valeur'],
  start_date: ['start_date', 'start', 'startdatum', 'effective_date', 'effective date', 'beginn', 'début'],
  end_date: ['end_date', 'end', 'expiry', 'expiry_date', 'einddatum', 'expiration', 'expiration_date', 'ablaufdatum', 'fin'],
  status: ['status', 'contract_status', 'state'],
  notice_period_days: ['renewal_notice_days', 'notice_days', 'notice period', 'opzegtermijn', 'kündigungsfrist'],
  auto_renew: ['auto_renew', 'auto_renewal', 'automatic_renewal', 'automatische_verlenging'],
  payment_terms: ['payment_terms', 'payment terms', 'betalingstermijn', 'zahlungsbedingungen'],
  currency: ['currency', 'valuta', 'währung', 'devise'],
}

export function guessMapping(headers: string[]): ColumnMapping {
  const mapping: ColumnMapping = {}
  headers.forEach((h, i) => {
    const normalized = h.trim().toLowerCase().replace(/[_\-]+/g, ' ').trim()
    for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
      if (aliases.some(a => a.replace(/[_\-]+/g, ' ') === normalized)) {
        mapping[field] = i
        return
      }
    }
  })
  return mapping
}

function parseNum(v: string | undefined | null): number | undefined {
  if (v == null || v.trim() === '') return undefined
  const cleaned = v.replace(/[€$£\s]/g, '').trim()
  // European format: 1.234,56 → 1234.56
  if (/^\d{1,3}(\.\d{3})*(,\d+)?$/.test(cleaned)) {
    return parseFloat(cleaned.replace(/\./g, '').replace(',', '.'))
  }
  // US format: 1,234.56 → 1234.56
  if (/^\d{1,3}(,\d{3})*(\.\d+)?$/.test(cleaned)) {
    return parseFloat(cleaned.replace(/,/g, ''))
  }
  const n = parseFloat(cleaned.replace(',', '.'))
  return isNaN(n) ? undefined : n
}

function parseDate(v: string | undefined | null): Date | undefined {
  if (!v || v.trim() === '') return undefined
  const s = v.trim()
  // YYYY-MM-DD
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (m) return new Date(+m[1], +m[2] - 1, +m[3])
  // DD-MM-YYYY or DD/MM/YYYY
  m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})/)
  if (m) return new Date(+m[3], +m[2] - 1, +m[1])
  const d = new Date(s)
  return isNaN(d.getTime()) ? undefined : d
}

function parseBool(v: string | undefined | null): boolean | undefined {
  if (v == null) return undefined
  const s = v.trim().toLowerCase()
  if (['yes', 'true', '1', 'ja', 'oui'].includes(s)) return true
  if (['no', 'false', '0', 'nee', 'non'].includes(s)) return false
  return undefined
}

function get(row: string[], mapping: ColumnMapping, field: string): string | undefined {
  const idx = mapping[field]
  if (idx === undefined) return undefined
  const v = row[idx]
  return v !== undefined && v.trim() !== '' ? v.trim() : undefined
}

export function rowsToContracts(dataRows: string[][], mapping: ColumnMapping): { contracts: Contract[]; issues: DataIssue[] } {
  const issues: DataIssue[] = []
  const seenIds = new Set<string>()
  const contracts: Contract[] = []

  for (let i = 0; i < dataRows.length; i++) {
    const row = dataRows[i]
    const rowNum = i + 2 // 1-based + header

    const rawId = get(row, mapping, 'contract_id')
    let id = rawId || `AUTO-${i + 1}`
    // Ids key graph nodes, React lists and the annotation store, so a repeat
    // would make two contracts share a row, a node and a note. Report the
    // duplicate, then disambiguate what we actually store.
    if (seenIds.has(id)) {
      let n = 2
      while (seenIds.has(`${id}#${n}`)) n++
      const unique = `${id}#${n}`
      if (rawId) {
        issues.push({
          row: rowNum, field: 'contract_id', kind: 'duplicate',
          detail: `Duplicate ID ${rawId} — stored as ${unique} so the rows stay separate`,
        })
      }
      id = unique
    }
    seenIds.add(id)

    const name = get(row, mapping, 'contract_name') || `Contract ${i + 1}`
    const supplier = get(row, mapping, 'supplier') || PLACEHOLDERS.supplier
    const category = get(row, mapping, 'category') || PLACEHOLDERS.category
    const department = get(row, mapping, 'department') || PLACEHOLDERS.department
    const owner = get(row, mapping, 'contract_owner')
    const currency = get(row, mapping, 'currency')
    const status = get(row, mapping, 'status')
    const paymentTerms = get(row, mapping, 'payment_terms')

    if (!owner) issues.push({ row: rowNum, field: 'contract_owner', kind: 'missing', detail: 'No contract owner' })

    const valueRaw = get(row, mapping, 'annual_value')
    const annualValue = parseNum(valueRaw)
    if (valueRaw && annualValue === undefined) issues.push({ row: rowNum, field: 'annual_value', kind: 'unparseable', detail: `Cannot parse: ${valueRaw}` })
    if (!valueRaw) issues.push({ row: rowNum, field: 'annual_value', kind: 'missing', detail: 'No annual value' })

    const startRaw = get(row, mapping, 'start_date')
    const startDate = parseDate(startRaw)
    if (startRaw && !startDate) issues.push({ row: rowNum, field: 'start_date', kind: 'unparseable', detail: `Cannot parse: ${startRaw}` })

    const endRaw = get(row, mapping, 'end_date')
    const endDate = parseDate(endRaw)
    if (endRaw && !endDate) issues.push({ row: rowNum, field: 'end_date', kind: 'unparseable', detail: `Cannot parse: ${endRaw}` })
    if (!endRaw) issues.push({ row: rowNum, field: 'end_date', kind: 'missing', detail: 'No end date' })

    const noticePeriodDays = parseNum(get(row, mapping, 'notice_period_days'))
    const autoRenew = parseBool(get(row, mapping, 'auto_renew'))

    const raw: Record<string, string> = {}
    row.forEach((v, ci) => { raw[`col_${ci}`] = v })

    contracts.push({ id, name, supplier, category, department, owner, annualValue, currency, startDate, endDate, noticePeriodDays, autoRenew, status, paymentTerms, tags: [], raw })
  }
  return { contracts, issues }
}

export function parseCSVText(text: string): { headers: string[]; rows: string[][] } {
  const result = Papa.parse<string[]>(text, { header: false, skipEmptyLines: true })
  if (result.data.length === 0) throw new Error('File has no data')
  return { headers: result.data[0], rows: result.data.slice(1) }
}

export function parseXLSXBuffer(buffer: ArrayBuffer): { headers: string[]; rows: string[][] } {
  const wb = XLSX.read(buffer, { type: 'array' })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const data: string[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })
  if (data.length === 0) throw new Error('Spreadsheet has no data')
  return { headers: data[0].map(String), rows: data.slice(1).map(r => r.map(String)) }
}

export function parseFile(file: File): Promise<{ headers: string[]; rows: string[][] }> {
  return new Promise((resolve, reject) => {
    const ext = file.name.split('.').pop()?.toLowerCase()
    if (ext === 'csv' || ext === 'tsv' || ext === 'txt') {
      const reader = new FileReader()
      reader.onload = () => {
        try { resolve(parseCSVText(reader.result as string)) }
        catch (e) { reject(e) }
      }
      reader.onerror = () => reject(new Error('Failed to read file'))
      reader.readAsText(file)
    } else if (ext === 'xlsx' || ext === 'xls') {
      const reader = new FileReader()
      reader.onload = () => {
        try { resolve(parseXLSXBuffer(reader.result as ArrayBuffer)) }
        catch (e) { reject(e) }
      }
      reader.onerror = () => reject(new Error('Failed to read file'))
      reader.readAsArrayBuffer(file)
    } else {
      reject(new Error(`Unsupported file type: .${ext}`))
    }
  })
}

export function buildDataset(_headers: string[], rows: string[][], mapping: ColumnMapping, sourceName: string): Dataset {
  const { contracts, issues } = rowsToContracts(rows, mapping)
  return { contracts, importedAt: new Date(), sourceName, mapping, issues }
}

export const TARGET_FIELDS = Object.keys(HEADER_ALIASES)
export const FIELD_LABELS: Record<string, string> = {
  contract_id: 'Contract ID',
  contract_name: 'Contract name',
  supplier: 'Supplier',
  category: 'Category',
  department: 'Department',
  contract_owner: 'Contract owner',
  annual_value: 'Annual value',
  start_date: 'Start date',
  end_date: 'End date',
  status: 'Status',
  notice_period_days: 'Notice period (days)',
  auto_renew: 'Auto-renew',
  payment_terms: 'Payment terms',
  currency: 'Currency',
}
