import { useMemo } from 'react'
import { useDataStore } from '../../store/dataStore'
import { portfolioSummary, computeStatsByField } from '../../data/metrics'

function fmtMoney(v: number) { return '€' + Math.round(v).toLocaleString('en-US') }

export default function ReportsScreen() {
  const contracts = useDataStore(s => s.getContracts())
  const annotations = useDataStore(s => s.annotations)
  const summary = useMemo(() => portfolioSummary(contracts), [contracts])
  const byDepartment = useMemo(() => computeStatsByField(contracts, 'department', 'department'), [contracts])
  const byCategory = useMemo(() => computeStatsByField(contracts, 'category', 'category'), [contracts])

  const now = new Date()

  const upcomingRenewals = contracts
    .filter(c => c.endDate && (c.endDate.getTime() - now.getTime()) / 86400000 > 0 && (c.endDate.getTime() - now.getTime()) / 86400000 <= 365)
    .sort((a, b) => a.endDate!.getTime() - b.endDate!.getTime())

  const topRisks = [...byCategory, ...byDepartment].filter(s => s.healthScore < 70).sort((a, b) => a.healthScore - b.healthScore).slice(0, 10)

  const exportCSV = () => {
    const header = ['ID', 'Name', 'Supplier', 'Category', 'Department', 'Owner', 'Annual Value', 'Start Date', 'End Date', 'Status', 'Notice Period', 'Auto-Renew', 'Annotation Note', 'Annotation Status']
    const rows = contracts.map(c => {
      const a = annotations[c.id]
      return [c.id, c.name, c.supplier, c.category, c.department, c.owner ?? '', c.annualValue ?? '', c.startDate?.toISOString().slice(0, 10) ?? '', c.endDate?.toISOString().slice(0, 10) ?? '', c.status ?? '', c.noticePeriodDays ?? '', c.autoRenew ?? '', a?.note ?? '', a?.status ?? ''].map(v => `"${String(v).replace(/"/g, '""')}"`)
    })
    const csv = [header.join(','), ...rows.map(r => r.join(','))].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = 'procurement-data-export.csv'; a.click()
    URL.revokeObjectURL(url)
  }

  const printReport = () => {
    const w = window.open('', '_blank')
    if (!w) return
    w.document.write(`<!DOCTYPE html><html><head><title>Procurement Report</title>
<style>
body { font-family: "Segoe UI", sans-serif; max-width: 900px; margin: 0 auto; padding: 20px; color: #1a1a2e; font-size: 13px; }
h1 { font-size: 20px; border-bottom: 2px solid #4da3ff; padding-bottom: 8px; }
h2 { font-size: 15px; margin-top: 24px; color: #2a3650; }
.grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
.stat { border: 1px solid #ddd; border-radius: 8px; padding: 10px; }
.stat .v { font-size: 18px; font-weight: 700; } .stat .l { font-size: 11px; color: #666; }
table { width: 100%; border-collapse: collapse; font-size: 11px; margin-top: 8px; }
th, td { text-align: left; padding: 5px 8px; border-bottom: 1px solid #eee; }
th { background: #f5f5f5; font-weight: 600; }
.badge { display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 10px; font-weight: 700; }
.b-ok { background: #e6f9ed; color: #2d7d46; } .b-warn { background: #fff3e0; color: #b36d00; } .b-bad { background: #fde8e8; color: #c62828; }
@media print { body { font-size: 11px; } .no-print { display: none; } }
</style></head><body>
<h1>Procurement Analytics Report</h1>
<p style="color:#666">Generated ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</p>

<h2>Executive summary</h2>
<div class="grid">
<div class="stat"><div class="v">${fmtMoney(summary.totalSpend)}</div><div class="l">Total annual spend</div></div>
<div class="stat"><div class="v">${summary.contractCount}</div><div class="l">Contracts</div></div>
<div class="stat"><div class="v">${summary.suppliers}</div><div class="l">Suppliers</div></div>
<div class="stat"><div class="v">${summary.expiring90}</div><div class="l">Expiring ≤90 days</div></div>
<div class="stat"><div class="v">${summary.expired}</div><div class="l">Expired</div></div>
<div class="stat"><div class="v">${summary.dataQuality}%</div><div class="l">Data quality</div></div>
</div>

<h2>Top risk areas</h2>
<table><thead><tr><th>Area</th><th>Type</th><th>Health</th><th>Spend</th><th>Contracts</th></tr></thead><tbody>
${topRisks.map(s => `<tr><td>${s.name}</td><td>${s.type}</td><td><span class="badge ${s.healthScore >= 55 ? 'b-warn' : 'b-bad'}">${s.healthScore}</span></td><td>${fmtMoney(s.totalSpend)}</td><td>${s.contractCount}</td></tr>`).join('')}
</tbody></table>

<h2>Department overview</h2>
${byDepartment.map(d => `
<h3 style="margin:12px 0 4px;font-size:13px">${d.name} <span class="badge ${d.healthScore >= 80 ? 'b-ok' : d.healthScore >= 55 ? 'b-warn' : 'b-bad'}">${d.healthScore}</span></h3>
<p style="color:#666;font-size:11px">${d.contractCount} contracts · ${fmtMoney(d.totalSpend)} spend · top supplier: ${d.topSupplier?.name ?? 'n/a'} (${Math.round(d.supplierConcentration * 100)}%)</p>
`).join('')}

<h2>Renewal list — next 12 months (${upcomingRenewals.length} contracts)</h2>
<table><thead><tr><th>End date</th><th>Contract</th><th>Supplier</th><th>Dept</th><th>Value</th><th>Owner</th></tr></thead><tbody>
${upcomingRenewals.map(c => `<tr><td>${c.endDate!.toISOString().slice(0, 10)}</td><td>${c.name}</td><td>${c.supplier}</td><td>${c.department}</td><td>${fmtMoney(c.annualValue ?? 0)}</td><td>${c.owner ?? '—'}</td></tr>`).join('')}
</tbody></table>

<p style="margin-top:24px;font-size:10px;color:#999">Report generated by ProcurementWeb. All data processed client-side.</p>
</body></html>`)
    w.document.close()
    w.print()
  }

  return (
    <div className="flex-1 overflow-y-auto p-6 max-w-4xl mx-auto">
      <h2 className="text-xl font-bold mb-1">Reports & export</h2>
      <p className="text-[#8fa0bd] text-sm mb-6">Generate printable reports or export enriched data.</p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
        <div className="bg-[#171e2e] border border-[#2a3650] rounded-xl p-5 cursor-pointer hover:border-[#4da3ff] transition" onClick={printReport}>
          <div className="text-2xl mb-2">📊</div>
          <h3 className="font-semibold mb-1">Full portfolio report</h3>
          <p className="text-xs text-[#8fa0bd]">Executive summary, top risks, per-department analysis, and renewal list for the next 12 months. Opens as a print-ready page.</p>
        </div>
        <div className="bg-[#171e2e] border border-[#2a3650] rounded-xl p-5 cursor-pointer hover:border-[#4da3ff] transition" onClick={exportCSV}>
          <div className="text-2xl mb-2">📁</div>
          <h3 className="font-semibold mb-1">Export enriched CSV</h3>
          <p className="text-xs text-[#8fa0bd]">Download the normalized dataset including your annotations, ready to import into Excel or share with colleagues.</p>
        </div>
      </div>

      {/* Annotation management */}
      <h3 className="font-semibold mb-3">Contract annotations</h3>
      <p className="text-xs text-[#8fa0bd] mb-3">Add notes and action statuses to individual contracts. These persist in your browser and are included in exports.</p>
      <div className="space-y-2 max-h-96 overflow-y-auto">
        {contracts.map(c => <AnnotationRow key={c.id} contract={c} />)}
      </div>
    </div>
  )
}

import type { Contract } from '../../data/types'

function AnnotationRow({ contract: c }: { contract: Contract }) {
  const annotation = useDataStore(s => s.getAnnotation(c.id))
  const setAnnotation = useDataStore(s => s.setAnnotation)

  return (
    <div className="bg-[#171e2e] border border-[#2a3650] rounded-lg p-3 flex items-center gap-3">
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate">{c.name}</div>
        <div className="text-xs text-[#8fa0bd]">{c.supplier} · {c.department}</div>
      </div>
      <select
        value={annotation?.status ?? ''}
        onChange={e => setAnnotation({ contractId: c.id, note: annotation?.note ?? '', status: e.target.value as any })}
        className="bg-[#0f1420] border border-[#2a3650] rounded px-2 py-1 text-xs text-white w-28"
      >
        <option value="">No status</option>
        <option value="ok">OK</option>
        <option value="review">Review</option>
        <option value="renegotiate">Renegotiate</option>
        <option value="terminate">Terminate</option>
      </select>
      <input
        type="text" placeholder="Add note…"
        value={annotation?.note ?? ''}
        onChange={e => setAnnotation({ contractId: c.id, note: e.target.value, status: annotation?.status ?? '' })}
        className="bg-[#0f1420] border border-[#2a3650] rounded px-2 py-1 text-xs text-white w-40"
      />
    </div>
  )
}
