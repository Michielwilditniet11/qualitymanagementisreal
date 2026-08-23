import { useMemo } from 'react'
import { useDataStore } from '../../store/dataStore'
import { computeStatsByField, portfolioSummary, spendConcentrationCurve } from '../../data/metrics'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, AreaChart, Area } from 'recharts'
import type { EntityStats } from '../../data/types'

function fmtMoney(v: number) { return '€' + Math.round(v).toLocaleString('en-US') }
function scoreClass(s: number) { return s >= 80 ? 'bg-green-900/30 text-green-400' : s >= 55 ? 'bg-amber-900/30 text-amber-400' : 'bg-red-900/30 text-red-400' }

function StatTile({ value, label }: { value: string | number; label: string }) {
  return (
    <div className="bg-[#171e2e] border border-[#2a3650] rounded-xl p-4">
      <div className="text-xl font-bold">{value}</div>
      <div className="text-xs text-[#8fa0bd] mt-1">{label}</div>
    </div>
  )
}

function DiagCard({ stat }: { stat: EntityStats }) {
  const flags: { cls: string; text: string }[] = []
  if (stat.supplierConcentration > 0.8 && !stat.singleSource)
    flags.push({ cls: 'text-red-400', text: `High supplier concentration: ${stat.topSupplier?.name} holds ${Math.round(stat.supplierConcentration * 100)}%` })
  if (stat.singleSource)
    flags.push({ cls: 'text-amber-400', text: `Single-source: all contracts with ${stat.topSupplier?.name}` })
  if (stat.expired.length)
    flags.push({ cls: 'text-red-400', text: `${stat.expired.length} expired: ${stat.expired.map(c => c.name).join(', ')}` })
  if (stat.expiring90.length)
    flags.push({ cls: 'text-amber-400', text: `${stat.expiring90.length} expiring ≤90d: ${stat.expiring90.map(c => c.name).join(', ')}` })
  if (stat.expiring180.length)
    flags.push({ cls: 'text-amber-400', text: `${stat.expiring180.length} expiring 90–180d` })
  if (stat.missingOwner.length)
    flags.push({ cls: 'text-amber-400', text: `${stat.missingOwner.length} contract(s) without an owner` })
  if (stat.missingValue.length)
    flags.push({ cls: 'text-amber-400', text: `${stat.missingValue.length} contract(s) missing a value` })
  if (!flags.length)
    flags.push({ cls: 'text-green-400', text: 'No risk flags — portfolio looks healthy' })

  return (
    <div className="bg-[#171e2e] border border-[#2a3650] rounded-xl p-4">
      <div className="flex justify-between items-start mb-2">
        <h3 className="font-semibold text-sm">{stat.name}</h3>
        <span className={`text-xs font-bold px-2.5 py-0.5 rounded-full ${scoreClass(stat.healthScore)}`}>{stat.healthScore}</span>
      </div>
      <div className="space-y-0.5 text-xs">
        <div className="flex justify-between text-[#8fa0bd]"><span>Annual spend</span><span className="text-white">{fmtMoney(stat.totalSpend)}</span></div>
        <div className="flex justify-between text-[#8fa0bd]"><span>Contracts</span><span className="text-white">{stat.contractCount}</span></div>
        <div className="flex justify-between text-[#8fa0bd]"><span>Top supplier share</span><span className="text-white">{stat.totalSpend > 0 ? Math.round(stat.supplierConcentration * 100) + '%' : '—'}</span></div>
      </div>
      <div className="mt-2 space-y-0.5">
        {flags.map((f, i) => <div key={i} className={`text-[11px] ${f.cls}`}>{f.cls.includes('green') ? '✓' : '⚠'} {f.text}</div>)}
      </div>
    </div>
  )
}

export default function DiagnosticsScreen() {
  const contracts = useDataStore(s => s.getContracts())
  const summary = useMemo(() => portfolioSummary(contracts), [contracts])
  const byCategory = useMemo(() => computeStatsByField(contracts, 'category', 'category'), [contracts])
  const byDepartment = useMemo(() => computeStatsByField(contracts, 'department', 'department'), [contracts])
  const concentration = useMemo(() => spendConcentrationCurve(contracts), [contracts])

  const spendByDept = byDepartment.map(d => ({ name: d.name.length > 15 ? d.name.slice(0, 14) + '…' : d.name, spend: d.totalSpend }))
  const spendByCat = byCategory.slice(0, 12).map(c => ({ name: c.name.length > 15 ? c.name.slice(0, 14) + '…' : c.name, spend: c.totalSpend }))
  const concData = concentration.map((c, i) => ({ x: i + 1, y: Math.round(c.cumulativeShare * 100), name: c.supplier }))

  return (
    <div className="flex-1 overflow-y-auto p-6">
      {/* Summary tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3 mb-6">
        <StatTile value={fmtMoney(summary.totalSpend)} label="Total annual spend" />
        <StatTile value={summary.contractCount} label="Contracts" />
        <StatTile value={summary.suppliers} label="Suppliers" />
        <StatTile value={summary.expiring90} label="Expiring ≤90 days" />
        <StatTile value={summary.expired} label="Expired" />
        <StatTile value={`${summary.dataQuality}%`} label="Data quality" />
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-8">
        <div className="bg-[#171e2e] border border-[#2a3650] rounded-xl p-4">
          <h3 className="text-sm font-semibold mb-3">Spend by department</h3>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={spendByDept} layout="vertical">
              <XAxis type="number" tickFormatter={v => `€${(v / 1000).toFixed(0)}k`} tick={{ fill: '#8fa0bd', fontSize: 10 }} />
              <YAxis type="category" dataKey="name" width={100} tick={{ fill: '#8fa0bd', fontSize: 10 }} />
              <Tooltip formatter={(v) => fmtMoney(Number(v))} contentStyle={{ background: '#1d2639', border: '1px solid #2a3650', borderRadius: 8, fontSize: 12 }} />
              <Bar dataKey="spend" fill="#4da3ff" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="bg-[#171e2e] border border-[#2a3650] rounded-xl p-4">
          <h3 className="text-sm font-semibold mb-3">Spend by category (top 12)</h3>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={spendByCat} layout="vertical">
              <XAxis type="number" tickFormatter={v => `€${(v / 1000).toFixed(0)}k`} tick={{ fill: '#8fa0bd', fontSize: 10 }} />
              <YAxis type="category" dataKey="name" width={100} tick={{ fill: '#8fa0bd', fontSize: 10 }} />
              <Tooltip formatter={(v) => fmtMoney(Number(v))} contentStyle={{ background: '#1d2639', border: '1px solid #2a3650', borderRadius: 8, fontSize: 12 }} />
              <Bar dataKey="spend" fill="#ffb347" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="bg-[#171e2e] border border-[#2a3650] rounded-xl p-4">
          <h3 className="text-sm font-semibold mb-3">Supplier spend concentration</h3>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={concData}>
              <XAxis dataKey="x" tick={{ fill: '#8fa0bd', fontSize: 10 }} label={{ value: 'Suppliers (ranked)', position: 'insideBottom', offset: -2, fill: '#8fa0bd', fontSize: 10 }} />
              <YAxis tick={{ fill: '#8fa0bd', fontSize: 10 }} tickFormatter={v => `${v}%`} domain={[0, 100]} />
              <Tooltip formatter={(v) => `${v}%`} labelFormatter={(l) => concData[Number(l) - 1]?.name ?? ''} contentStyle={{ background: '#1d2639', border: '1px solid #2a3650', borderRadius: 8, fontSize: 12 }} />
              <Area type="monotone" dataKey="y" stroke="#ff6b81" fill="rgba(255,107,129,0.15)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Per-category diagnostics */}
      <h2 className="text-base font-semibold mb-3">Diagnostic per category</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 mb-8">
        {byCategory.map(s => <DiagCard key={s.name} stat={s} />)}
      </div>

      {/* Per-department diagnostics */}
      <h2 className="text-base font-semibold mb-3">Diagnostic per department</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {byDepartment.map(s => <DiagCard key={s.name} stat={s} />)}
      </div>
    </div>
  )
}
