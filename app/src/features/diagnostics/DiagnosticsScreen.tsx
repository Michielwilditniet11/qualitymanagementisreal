import { useMemo, useState } from 'react'
import { useDataStore } from '../../store/dataStore'
import { useUIStore } from '../../store/uiStore'
import { computeStatsByField, portfolioSummary, spendConcentrationCurve } from '../../data/metrics'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, AreaChart, Area,
  ScatterChart, Scatter, ZAxis, Cell,
} from 'recharts'
import type { EntityStats, Contract } from '../../data/types'
import { fmtK, riskScore } from '../../analytics/risk'
import { auditTerms, hasPaymentTermsData, parsePaymentDays, type TermFinding, type ClauseKind } from '../../analytics/terms'
import { supplierLeverage, negotiationCalendar, type SupplierLeverage } from '../../analytics/levers'
import { savingsOpportunities, savingsSummary } from '../../analytics/savings'
import { ChevronDown, ChevronRight, ExternalLink } from 'lucide-react'

function fmtMoney(v: number) { return '€' + Math.round(v).toLocaleString('en-US') }
function fmtDate(d: Date) { return d.toISOString().slice(0, 10) }
function scoreClass(s: number) { return s >= 80 ? 'bg-green-900/30 text-green-400' : s >= 55 ? 'bg-amber-900/30 text-amber-400' : 'bg-red-900/30 text-red-400' }

const SEVERITY_COLORS: Record<string, string> = { critical: '#DC2626', warning: '#D97706', info: '#0EA5E9' }
const POSITION_COLORS: Record<string, string> = { strong: '#059669', balanced: '#D97706', weak: '#DC2626' }
const KIND_COLORS: Record<string, string> = {
  'tail-consolidation': '#38BDF8',
  'category-bundling': '#A78BFA',
  'payment-harmonisation': '#34D399',
  'renewal-interception': '#FBBF24',
}

/** Urgency of an act-by date. */
function urgency(daysLeft: number, missed: boolean): string {
  if (missed) return '#DC2626'
  if (daysLeft <= 30) return '#DC2626'
  if (daysLeft <= 90) return '#D97706'
  return '#0EA5E9'
}

/* ─── Shared shells ─── */

function Section({ title, subtitle, children, right }: {
  title: string; subtitle?: string; children: React.ReactNode; right?: React.ReactNode
}) {
  return (
    <section className="mb-8">
      <div className="flex items-end justify-between gap-3 mb-3 flex-wrap">
        <div>
          <h2 className="text-base font-semibold">{title}</h2>
          {subtitle && <p className="text-xs mt-0.5" style={{ color: '#64748B' }}>{subtitle}</p>}
        </div>
        {right}
      </div>
      {children}
    </section>
  )
}

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-[#171e2e] border border-[#2a3650] rounded-xl p-4 ${className}`}>
      {children}
    </div>
  )
}

function StatTile({ value, label }: { value: string | number; label: string }) {
  return (
    <div className="bg-[#171e2e] border border-[#2a3650] rounded-xl p-4">
      <div className="text-xl font-bold tabular-nums">{value}</div>
      <div className="text-xs text-[#8fa0bd] mt-1">{label}</div>
    </div>
  )
}

/* ─── Screen ─── */

export default function DiagnosticsScreen() {
  const contracts = useDataStore(s => s.getContracts())
  const inspectInWeb = useUIStore(s => s.inspectInWeb)

  const summary = useMemo(() => portfolioSummary(contracts), [contracts])
  const byCategory = useMemo(() => computeStatsByField(contracts, 'category', 'category'), [contracts])
  const byDepartment = useMemo(() => computeStatsByField(contracts, 'department', 'department'), [contracts])
  const concentration = useMemo(() => spendConcentrationCurve(contracts), [contracts])

  const findings = useMemo(() => auditTerms(contracts), [contracts])
  const leverage = useMemo(() => supplierLeverage(contracts), [contracts])
  const calendar = useMemo(() => negotiationCalendar(contracts), [contracts])
  const opportunities = useMemo(() => savingsOpportunities(contracts), [contracts])
  const savings = useMemo(() => savingsSummary(opportunities, contracts), [opportunities, contracts])
  const paymentData = useMemo(() => hasPaymentTermsData(contracts), [contracts])

  const criticalCount = findings.filter(f => f.severity === 'critical').length
  const openWindows = calendar.filter(i => i.kind === 'notice-deadline' && !i.missed).length
  const nextAction = calendar.find(i => !i.missed)

  if (contracts.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-sm" style={{ color: '#64748B' }}>Import contracts to run diagnostics.</p>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto overflow-x-hidden p-6">
      {/* ─── Action strip ─── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-8">
        <Card>
          <div className="text-[9px] uppercase tracking-wider" style={{ color: '#475569' }}>Addressable savings</div>
          <div className="text-xl font-bold tabular-nums" style={{ color: '#34D399' }}>
            {fmtK(savings.low)}–{fmtK(savings.high)}
          </div>
          <div className="text-[9px] mt-0.5" style={{ color: '#64748B' }}>estimated range, see assumptions</div>
        </Card>
        <Card>
          <div className="text-[9px] uppercase tracking-wider" style={{ color: '#475569' }}>Open negotiation windows</div>
          <div className="text-xl font-bold tabular-nums" style={{ color: '#38BDF8' }}>{openWindows}</div>
          <div className="text-[9px] mt-0.5" style={{ color: '#64748B' }}>notice deadlines still in reach</div>
        </Card>
        <Card>
          <div className="text-[9px] uppercase tracking-wider" style={{ color: '#475569' }}>Critical term findings</div>
          <div className="text-xl font-bold tabular-nums" style={{ color: criticalCount ? '#DC2626' : '#059669' }}>
            {criticalCount}
          </div>
          <div className="text-[9px] mt-0.5" style={{ color: '#64748B' }}>clauses working against us</div>
        </Card>
        <Card>
          <div className="text-[9px] uppercase tracking-wider" style={{ color: '#475569' }}>Next act-by date</div>
          <div className="text-xl font-bold tabular-nums" style={{ color: nextAction ? urgency(nextAction.daysLeft, false) : '#64748B' }}>
            {nextAction ? `${nextAction.daysLeft}d` : '—'}
          </div>
          <div className="text-[9px] mt-0.5 truncate" style={{ color: '#64748B' }}>
            {nextAction ? nextAction.contract : 'nothing in the next year'}
          </div>
        </Card>
      </div>

      {/* ─── Negotiation calendar ─── */}
      <Section title="What to act on"
        subtitle="Every decision date in the next 12 months, soonest first. Notice deadlines are listed separately because that is when the decision actually has to be made.">
        {calendar.length === 0 ? (
          <Card><p className="text-xs" style={{ color: '#64748B' }}>No decision dates fall in the next 12 months.</p></Card>
        ) : (
          <Card className="!p-0 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr style={{ background: '#0F172A' }}>
                    {['Act by', 'Left', 'Contract', 'Supplier', 'Value', 'Action'].map(h => (
                      <th key={h} className="text-left px-3 py-2 text-[9px] uppercase tracking-wider font-semibold"
                        style={{ color: '#475569' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {calendar.slice(0, 40).map((i, n) => {
                    const c = urgency(i.daysLeft, i.missed)
                    return (
                      <tr key={`${i.contractId}-${i.kind}-${n}`} style={{ borderTop: '1px solid #0F172A' }}>
                        <td className="px-3 py-1.5 tabular-nums whitespace-nowrap" style={{ color: '#CBD5E1' }}>{fmtDate(i.actBy)}</td>
                        <td className="px-3 py-1.5 tabular-nums whitespace-nowrap font-semibold" style={{ color: c }}>
                          {i.missed ? 'missed' : `${i.daysLeft}d`}
                        </td>
                        <td className="px-3 py-1.5 text-white max-w-[220px] truncate">{i.contract}</td>
                        <td className="px-3 py-1.5">
                          <button onClick={() => inspectInWeb({ type: 'supplier', name: i.supplier })}
                            className="cursor-pointer hover:underline inline-flex items-center gap-1"
                            style={{ color: '#38BDF8' }}>
                            {i.supplier}<ExternalLink size={9} />
                          </button>
                        </td>
                        <td className="px-3 py-1.5 tabular-nums whitespace-nowrap" style={{ color: '#CBD5E1' }}>{fmtK(i.value)}</td>
                        <td className="px-3 py-1.5" style={{ color: '#94A3B8' }}>{i.action}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            {calendar.length > 40 && (
              <div className="px-3 py-1.5 text-[10px]" style={{ color: '#475569', borderTop: '1px solid #0F172A' }}>
                Showing the 40 soonest of {calendar.length} decision dates.
              </div>
            )}
          </Card>
        )}
      </Section>

      {/* ─── Savings ─── */}
      <Section title="Where the money could come from"
        subtitle="Heuristic ranges, not quotes. Each bar carries the assumption it was built on.">
        {opportunities.length === 0 ? (
          <Card><p className="text-xs" style={{ color: '#64748B' }}>No consolidation or renegotiation opportunities detected.</p></Card>
        ) : (
          <Card>
            <div className="space-y-2.5">
              {opportunities.map(o => {
                const pct = savings.high > 0 ? (o.high / savings.high) * 100 : 0
                return (
                  <div key={o.kind + o.title}>
                    <div className="flex items-baseline justify-between gap-3 mb-1">
                      <span className="text-xs text-white">{o.title}</span>
                      <span className="text-xs tabular-nums whitespace-nowrap font-semibold"
                        style={{ color: KIND_COLORS[o.kind] }}>
                        {fmtK(o.low)}–{fmtK(o.high)}
                      </span>
                    </div>
                    <div className="h-2 rounded-sm overflow-hidden" style={{ background: '#0F172A' }}>
                      <div className="h-full rounded-sm" style={{ width: `${Math.max(pct, 1)}%`, background: KIND_COLORS[o.kind] }} />
                    </div>
                    <div className="text-[10px] mt-1" style={{ color: '#64748B' }}>{o.detail}</div>
                    <div className="text-[9px] mt-0.5 italic" style={{ color: '#475569' }}>{o.assumption}</div>
                  </div>
                )
              })}
            </div>
            <div className="mt-3 pt-2 flex items-baseline justify-between" style={{ borderTop: '1px solid #2a3650' }}>
              <span className="text-[10px]" style={{ color: '#64748B' }}>
                Total, counting each contract once at its best applicable rate
              </span>
              <span className="text-sm font-bold tabular-nums" style={{ color: '#34D399' }}>
                {fmtK(savings.low)}–{fmtK(savings.high)}
              </span>
            </div>
          </Card>
        )}
      </Section>

      {/* ─── Supplier leverage ─── */}
      <SupplierBoard leverage={leverage} onInspect={s => inspectInWeb({ type: 'supplier', name: s })} />

      {/* ─── T&C audit ─── */}
      <TermsAudit findings={findings} contracts={contracts} />

      {/* ─── Sharper cuts ─── */}
      <Section title="Cuts of the portfolio" subtitle="Where spend sits, what is risky, and when the load lands.">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <RiskSpendScatter contracts={contracts} />
          <RenewalLoad contracts={contracts} />
        </div>
        <div className="mt-4">
          <Heatmap contracts={contracts} />
        </div>
        {paymentData ? (
          <div className="mt-4"><PaymentHistogram contracts={contracts} /></div>
        ) : (
          <Card className="mt-4">
            <div className="text-sm font-semibold mb-1">Payment terms</div>
            <p className="text-xs" style={{ color: '#64748B' }}>
              Not enough payment-terms data to analyse — map a payment terms column on import
              to unlock working-capital analysis.
            </p>
          </Card>
        )}
      </Section>

      {/* ─── Classic views ─── */}
      <ClassicViews
        summary={summary} byCategory={byCategory} byDepartment={byDepartment}
        concentration={concentration}
      />
    </div>
  )
}

/* ─── Supplier leverage board ─── */

function SupplierBoard({ leverage, onInspect }: {
  leverage: SupplierLeverage[]; onInspect: (supplier: string) => void
}) {
  const [sort, setSort] = useState<'leverage' | 'spend' | 'window'>('leverage')
  const [open, setOpen] = useState<string | null>(null)

  const sorted = useMemo(() => {
    const l = [...leverage]
    if (sort === 'spend') return l.sort((a, b) => b.spend - a.spend)
    if (sort === 'window') {
      return l.sort((a, b) => {
        if (!a.nextWindow && !b.nextWindow) return b.spend - a.spend
        if (!a.nextWindow) return 1
        if (!b.nextWindow) return -1
        return a.nextWindow.daysLeft - b.nextWindow.daysLeft
      })
    }
    return l.sort((a, b) => b.leverageScore - a.leverageScore)
  }, [leverage, sort])

  return (
    <Section title="Supplier leverage"
      subtitle="Our position against each supplier, and the levers available before the next window closes."
      right={
        <select value={sort} onChange={e => setSort(e.target.value as any)}
          className="rounded-lg px-2 py-1 text-[11px] text-white"
          style={{ background: '#0A0F1A', border: '1px solid #2a3650' }}>
          <option value="leverage">Sort: leverage</option>
          <option value="spend">Sort: spend</option>
          <option value="window">Sort: next window</option>
        </select>
      }>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {sorted.slice(0, 10).map(s => {
          const isOpen = open === s.supplier
          return (
            <Card key={s.supplier}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <button onClick={() => onInspect(s.supplier)}
                    className="text-sm font-semibold text-white truncate cursor-pointer hover:underline inline-flex items-center gap-1">
                    {s.supplier}<ExternalLink size={10} />
                  </button>
                  <div className="text-[10px] mt-0.5" style={{ color: '#64748B' }}>
                    {fmtK(s.spend)} · {s.contractCount} contract{s.contractCount === 1 ? '' : 's'} · {s.departments.length} dept{s.departments.length === 1 ? '' : 's'}
                  </div>
                </div>
                <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded uppercase tracking-wider flex-shrink-0"
                  style={{ background: `${POSITION_COLORS[s.position]}18`, color: POSITION_COLORS[s.position] }}>
                  {s.position}
                </span>
              </div>

              {s.nextWindow && (
                <div className="mt-2 rounded-lg px-2 py-1.5 flex items-center justify-between gap-2"
                  style={{ background: '#0F172A' }}>
                  <span className="text-[10px] truncate" style={{ color: '#94A3B8' }}>
                    {s.nextWindow.contract}
                  </span>
                  <span className="text-[10px] font-semibold tabular-nums whitespace-nowrap"
                    style={{ color: urgency(s.nextWindow.daysLeft, false) }}>
                    act in {s.nextWindow.daysLeft}d
                  </span>
                </div>
              )}

              <div className="flex flex-wrap gap-1 mt-2">
                {s.levers.map(l => (
                  <span key={l.kind} className="text-[9px] px-1.5 py-0.5 rounded-full"
                    style={{ background: '#0F172A', border: '1px solid #2a3650', color: '#94A3B8' }}>
                    {l.kind.replace(/-/g, ' ')}
                  </span>
                ))}
              </div>

              <button onClick={() => setOpen(isOpen ? null : s.supplier)}
                className="mt-2 text-[10px] cursor-pointer inline-flex items-center gap-1 hover:text-white"
                style={{ color: '#64748B' }}>
                {isOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                {isOpen ? 'Hide levers' : `${s.levers.length} lever${s.levers.length === 1 ? '' : 's'}`}
              </button>

              {isOpen && (
                <div className="mt-2 space-y-2 pt-2" style={{ borderTop: '1px solid #2a3650' }}>
                  {s.levers.map(l => (
                    <div key={l.kind}>
                      <div className="text-[11px] font-medium text-white">{l.title}</div>
                      <div className="text-[10px] mt-0.5" style={{ color: '#94A3B8' }}>{l.detail}</div>
                      {l.estimate && (
                        <div className="text-[9px] mt-0.5" style={{ color: '#34D399' }}>
                          {fmtK(l.estimate.low)}–{fmtK(l.estimate.high)}
                          <span className="italic ml-1" style={{ color: '#475569' }}>· {l.estimate.assumption}</span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </Card>
          )
        })}
      </div>
    </Section>
  )
}

/* ─── Terms audit table ─── */

const CLAUSE_LABELS: Record<ClauseKind, string> = {
  'auto-renewal': 'Auto-renewal',
  'notice': 'Notice',
  'term-length': 'Term length',
  'payment': 'Payment',
  'raw-scan': 'Source scan',
  'status': 'Status',
}

function TermsAudit({ findings, contracts }: { findings: TermFinding[]; contracts: Contract[] }) {
  const [filter, setFilter] = useState<ClauseKind | 'all'>('all')
  const kinds = useMemo(
    () => [...new Set(findings.map(f => f.clause))] as ClauseKind[],
    [findings])
  const shown = filter === 'all' ? findings : findings.filter(f => f.clause === filter)

  return (
    <Section title="Terms & conditions audit"
      subtitle={`${findings.length} finding${findings.length === 1 ? '' : 's'} across ${contracts.length} contracts.`}
      right={
        <div className="flex gap-1 flex-wrap">
          {(['all', ...kinds] as const).map(k => (
            <button key={k} onClick={() => setFilter(k as any)}
              className="text-[10px] px-2 py-0.5 rounded-full cursor-pointer transition-colors"
              style={{
                background: filter === k ? '#1E293B' : 'transparent',
                border: '1px solid #2a3650',
                color: filter === k ? '#F1F5F9' : '#64748B',
              }}>
              {k === 'all' ? 'All' : CLAUSE_LABELS[k as ClauseKind]}
            </button>
          ))}
        </div>
      }>
      {shown.length === 0 ? (
        <Card><p className="text-xs" style={{ color: '#64748B' }}>No findings in this category.</p></Card>
      ) : (
        <div className="space-y-2">
          {shown.map(f => (
            <Card key={f.id} className={f.clause === 'raw-scan' ? 'border-dashed' : ''}>
              <div className="flex items-start gap-2.5">
                <div className="flex-shrink-0 mt-1" style={{
                  width: '7px', height: '7px',
                  borderRadius: f.severity === 'critical' ? '1px' : '50%',
                  background: SEVERITY_COLORS[f.severity],
                }} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline justify-between gap-3 flex-wrap">
                    <span className="text-xs font-medium text-white">{f.title}</span>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {f.actBy && (
                        <span className="text-[9px] tabular-nums" style={{ color: '#64748B' }}>
                          act by {fmtDate(f.actBy)}
                        </span>
                      )}
                      {f.exposure !== undefined && f.exposure > 0 && (
                        <span className="text-[10px] px-1.5 rounded font-semibold tabular-nums"
                          style={{ background: `${SEVERITY_COLORS[f.severity]}15`, color: SEVERITY_COLORS[f.severity] }}>
                          {fmtK(f.exposure)}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="text-[11px] mt-1" style={{ color: '#94A3B8' }}>{f.detail}</div>
                  <div className="text-[10px] mt-1 flex items-start gap-1.5" style={{ color: '#38BDF8' }}>
                    <span style={{ color: '#475569' }}>Fix:</span>{f.fix}
                  </div>
                  {f.clause === 'raw-scan' && (
                    <div className="text-[9px] mt-1 italic" style={{ color: '#475569' }}>
                      Text match on imported data — review manually.
                    </div>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </Section>
  )
}

/* ─── Cuts ─── */

function RiskSpendScatter({ contracts }: { contracts: Contract[] }) {
  const data = useMemo(() => contracts
    .filter(c => (c.annualValue ?? 0) > 0)
    .map(c => {
      const score = riskScore({
        key: c.id, type: 'contract', name: c.name, x: 0, y: 0, vx: 0, vy: 0,
        value: c.annualValue ?? 0, count: 1, contracts: [c], neighbors: new Set(), contract: c,
      })
      return { x: score, y: c.annualValue ?? 0, name: c.name, score }
    }), [contracts])

  return (
    <Card>
      <h3 className="text-sm font-semibold mb-1">Risk against spend</h3>
      <p className="text-[10px] mb-2" style={{ color: '#64748B' }}>
        The top-right corner is what keeps you up at night: large and exposed.
      </p>
      <ResponsiveContainer width="100%" height={220}>
        <ScatterChart margin={{ top: 5, right: 10, bottom: 15, left: 5 }}>
          <XAxis type="number" dataKey="x" domain={[0, 100]} name="Risk"
            tick={{ fill: '#8fa0bd', fontSize: 10 }}
            label={{ value: 'Risk score', position: 'insideBottom', offset: -8, fill: '#64748B', fontSize: 10 }} />
          <YAxis type="number" dataKey="y" scale="log" domain={['auto', 'auto']}
            tickFormatter={v => `€${(v / 1000).toFixed(0)}k`} tick={{ fill: '#8fa0bd', fontSize: 10 }} />
          <ZAxis range={[40, 40]} />
          <Tooltip
            cursor={{ strokeDasharray: '3 3', stroke: '#334155' }}
            formatter={(v: any, n: any) => n === 'y' ? fmtMoney(Number(v)) : v}
            labelFormatter={() => ''}
            content={({ payload }) => {
              const p = payload?.[0]?.payload
              if (!p) return null
              return (
                <div style={{ background: '#1d2639', border: '1px solid #2a3650', borderRadius: 8, padding: '6px 10px', fontSize: 11 }}>
                  <div style={{ color: '#E5E7EB' }}>{p.name}</div>
                  <div style={{ color: '#9CA3AF', fontSize: 10 }}>risk {p.score} · {fmtMoney(p.y)}</div>
                </div>
              )
            }} />
          <Scatter data={data}>
            {data.map((d, i) => (
              <Cell key={i} fill={d.score >= 40 ? '#DC2626' : d.score >= 20 ? '#D97706' : '#059669'} fillOpacity={0.75} />
            ))}
          </Scatter>
        </ScatterChart>
      </ResponsiveContainer>
    </Card>
  )
}

function RenewalLoad({ contracts }: { contracts: Contract[] }) {
  const data = useMemo(() => {
    const now = new Date()
    const buckets = new Map<string, number>()
    for (const c of contracts) {
      if (!c.endDate) continue
      const months = (c.endDate.getFullYear() - now.getFullYear()) * 12 + (c.endDate.getMonth() - now.getMonth())
      if (months < 0 || months > 23) continue
      const q = `Q${Math.floor(c.endDate.getMonth() / 3) + 1} ’${String(c.endDate.getFullYear()).slice(2)}`
      buckets.set(q, (buckets.get(q) ?? 0) + (c.annualValue ?? 0))
    }
    return [...buckets.entries()]
      .map(([quarter, spend]) => ({ quarter, spend }))
      .sort((a, b) => {
        const parse = (s: string) => {
          const [q, y] = s.split(' ')
          return Number('20' + y.replace('’', '')) * 10 + Number(q[1])
        }
        return parse(a.quarter) - parse(b.quarter)
      })
  }, [contracts])

  return (
    <Card>
      <h3 className="text-sm font-semibold mb-1">Renewal load by quarter</h3>
      <p className="text-[10px] mb-2" style={{ color: '#64748B' }}>
        {data.length === 0 ? 'No expiries in the next two years.' : 'Value reaching its end date, next two years.'}
      </p>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={data} margin={{ top: 5, right: 10, bottom: 5, left: 5 }}>
          <XAxis dataKey="quarter" tick={{ fill: '#8fa0bd', fontSize: 10 }} />
          <YAxis tickFormatter={v => `€${(v / 1000).toFixed(0)}k`} tick={{ fill: '#8fa0bd', fontSize: 10 }} />
          <Tooltip formatter={(v) => fmtMoney(Number(v))}
            contentStyle={{ background: '#1d2639', border: '1px solid #2a3650', borderRadius: 8, fontSize: 12 }} />
          <Bar dataKey="spend" fill="#38BDF8" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </Card>
  )
}

function Heatmap({ contracts }: { contracts: Contract[] }) {
  const { depts, cats, cells, max } = useMemo(() => {
    const grid = new Map<string, number>()
    const deptTotals = new Map<string, number>()
    const catTotals = new Map<string, number>()
    for (const c of contracts) {
      const d = c.department || '(none)'
      const k = c.category || '(none)'
      const v = c.annualValue ?? 0
      grid.set(`${d}|${k}`, (grid.get(`${d}|${k}`) ?? 0) + v)
      deptTotals.set(d, (deptTotals.get(d) ?? 0) + v)
      catTotals.set(k, (catTotals.get(k) ?? 0) + v)
    }
    const depts = [...deptTotals.entries()].sort((a, b) => b[1] - a[1]).map(([d]) => d)
    const cats = [...catTotals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14).map(([c]) => c)
    return { depts, cats, cells: grid, max: Math.max(1, ...grid.values()) }
  }, [contracts])

  return (
    <Card>
      <h3 className="text-sm font-semibold mb-1">Department against category</h3>
      <p className="text-[10px] mb-2" style={{ color: '#64748B' }}>
        Who buys what. Shading is log-scaled so small cells stay visible.
      </p>
      <div className="overflow-x-auto">
        <table className="text-[10px]" style={{ borderCollapse: 'separate', borderSpacing: '2px' }}>
          <thead>
            <tr>
              <th />
              {cats.map(c => (
                <th key={c} className="font-normal align-bottom px-1"
                  style={{ color: '#64748B', height: '78px' }}>
                  <div style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)', whiteSpace: 'nowrap' }}>
                    {c.length > 14 ? c.slice(0, 13) + '…' : c}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {depts.map(d => (
              <tr key={d}>
                <td className="pr-2 whitespace-nowrap text-right" style={{ color: '#94A3B8' }}>
                  {d.length > 18 ? d.slice(0, 17) + '…' : d}
                </td>
                {cats.map(c => {
                  const v = cells.get(`${d}|${c}`) ?? 0
                  const t = v > 0 ? Math.log10(v + 1) / Math.log10(max + 1) : 0
                  return (
                    <td key={c} title={v > 0 ? `${d} · ${c}: ${fmtMoney(v)}` : `${d} · ${c}: —`}
                      className="text-center tabular-nums"
                      style={{
                        width: '46px', height: '26px', borderRadius: '3px',
                        background: v > 0 ? `rgba(56,189,248,${0.08 + t * 0.72})` : '#0D1421',
                        color: t > 0.55 ? '#04121F' : '#64748B',
                      }}>
                      {v > 0 ? fmtK(v).replace('€', '') : ''}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

function PaymentHistogram({ contracts }: { contracts: Contract[] }) {
  const { data, weightedAvg } = useMemo(() => {
    const buckets = new Map<string, number>()
    let spendSum = 0
    let weighted = 0
    for (const c of contracts) {
      const d = parsePaymentDays(c.paymentTerms)
      if (d === null) continue
      const label = d <= 14 ? '≤14' : d <= 30 ? '15–30' : d <= 45 ? '31–45' : d <= 60 ? '46–60' : d <= 90 ? '61–90' : '90+'
      buckets.set(label, (buckets.get(label) ?? 0) + 1)
      const v = c.annualValue ?? 0
      spendSum += v
      weighted += v * d
    }
    const order = ['≤14', '15–30', '31–45', '46–60', '61–90', '90+']
    return {
      data: order.filter(o => buckets.has(o)).map(o => ({ bucket: o, count: buckets.get(o)! })),
      weightedAvg: spendSum > 0 ? weighted / spendSum : 0,
    }
  }, [contracts])

  return (
    <Card>
      <h3 className="text-sm font-semibold mb-1">Payment terms distribution</h3>
      <p className="text-[10px] mb-2" style={{ color: '#64748B' }}>
        Spend-weighted average: <span style={{ color: '#34D399' }}>{Math.round(weightedAvg)} days</span>
      </p>
      <ResponsiveContainer width="100%" height={180}>
        <BarChart data={data} margin={{ top: 5, right: 10, bottom: 5, left: 5 }}>
          <XAxis dataKey="bucket" tick={{ fill: '#8fa0bd', fontSize: 10 }} />
          <YAxis allowDecimals={false} tick={{ fill: '#8fa0bd', fontSize: 10 }} />
          <Tooltip contentStyle={{ background: '#1d2639', border: '1px solid #2a3650', borderRadius: 8, fontSize: 12 }} />
          <Bar dataKey="count" fill="#34D399" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </Card>
  )
}

/* ─── Classic views (the original diagnostics, collapsed) ─── */

function DiagCard({ stat }: { stat: EntityStats }) {
  const flags: { cls: string; text: string }[] = []
  if (stat.supplierConcentration > 0.8 && !stat.singleSource)
    flags.push({ cls: 'text-red-400', text: `High supplier concentration: ${stat.topSupplier?.name} holds ${Math.round(stat.supplierConcentration * 100)}%` })
  if (stat.singleSource)
    flags.push({ cls: 'text-amber-400', text: `Single-source: all contracts with ${stat.topSupplier?.name}` })
  if (stat.expired.length)
    flags.push({ cls: 'text-red-400', text: `${stat.expired.length} expired` })
  if (stat.expiring90.length)
    flags.push({ cls: 'text-amber-400', text: `${stat.expiring90.length} expiring ≤90d` })
  if (stat.missingOwner.length)
    flags.push({ cls: 'text-amber-400', text: `${stat.missingOwner.length} contract(s) without an owner` })
  if (!flags.length)
    flags.push({ cls: 'text-green-400', text: 'No risk flags' })

  return (
    <div className="bg-[#171e2e] border border-[#2a3650] rounded-xl p-3">
      <div className="flex justify-between items-start mb-1.5">
        <h3 className="font-semibold text-xs">{stat.name}</h3>
        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${scoreClass(stat.healthScore)}`}>{stat.healthScore}</span>
      </div>
      <div className="text-[10px] flex justify-between" style={{ color: '#8fa0bd' }}>
        <span>{fmtMoney(stat.totalSpend)}</span><span>{stat.contractCount} contracts</span>
      </div>
      <div className="mt-1.5 space-y-0.5">
        {flags.map((f, i) => <div key={i} className={`text-[10px] ${f.cls}`}>{f.cls.includes('green') ? '✓' : '⚠'} {f.text}</div>)}
      </div>
    </div>
  )
}

function ClassicViews({ summary, byCategory, byDepartment, concentration }: {
  summary: ReturnType<typeof portfolioSummary>
  byCategory: EntityStats[]
  byDepartment: EntityStats[]
  concentration: { supplier: string; cumulativeShare: number }[]
}) {
  const [open, setOpen] = useState(false)
  const spendByDept = byDepartment.map(d => ({ name: d.name.length > 15 ? d.name.slice(0, 14) + '…' : d.name, spend: d.totalSpend }))
  const spendByCat = byCategory.slice(0, 12).map(c => ({ name: c.name.length > 15 ? c.name.slice(0, 14) + '…' : c.name, spend: c.totalSpend }))
  const concData = concentration.map((c, i) => ({ x: i + 1, y: Math.round(c.cumulativeShare * 100), name: c.supplier }))

  return (
    <section className="mb-4">
      <button onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 text-sm font-semibold cursor-pointer hover:text-white mb-3"
        style={{ color: '#94A3B8' }}>
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        Classic views
      </button>

      {open && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-4">
            <StatTile value={fmtMoney(summary.totalSpend)} label="Total annual spend" />
            <StatTile value={summary.contractCount} label="Contracts" />
            <StatTile value={summary.suppliers} label="Suppliers" />
            <StatTile value={summary.expiring90} label="Expiring ≤90 days" />
            <StatTile value={summary.expired} label="Expired" />
            <StatTile value={`${summary.dataQuality}%`} label="Data quality" />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
            <Card>
              <h3 className="text-sm font-semibold mb-3">Spend by department</h3>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={spendByDept} layout="vertical">
                  <XAxis type="number" tickFormatter={v => `€${(v / 1000).toFixed(0)}k`} tick={{ fill: '#8fa0bd', fontSize: 10 }} />
                  <YAxis type="category" dataKey="name" width={100} tick={{ fill: '#8fa0bd', fontSize: 10 }} />
                  <Tooltip formatter={(v) => fmtMoney(Number(v))} contentStyle={{ background: '#1d2639', border: '1px solid #2a3650', borderRadius: 8, fontSize: 12 }} />
                  <Bar dataKey="spend" fill="#4da3ff" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </Card>
            <Card>
              <h3 className="text-sm font-semibold mb-3">Spend by category (top 12)</h3>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={spendByCat} layout="vertical">
                  <XAxis type="number" tickFormatter={v => `€${(v / 1000).toFixed(0)}k`} tick={{ fill: '#8fa0bd', fontSize: 10 }} />
                  <YAxis type="category" dataKey="name" width={100} tick={{ fill: '#8fa0bd', fontSize: 10 }} />
                  <Tooltip formatter={(v) => fmtMoney(Number(v))} contentStyle={{ background: '#1d2639', border: '1px solid #2a3650', borderRadius: 8, fontSize: 12 }} />
                  <Bar dataKey="spend" fill="#ffb347" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </Card>
            <Card>
              <h3 className="text-sm font-semibold mb-3">Supplier spend concentration</h3>
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={concData}>
                  <XAxis dataKey="x" tick={{ fill: '#8fa0bd', fontSize: 10 }} />
                  <YAxis tick={{ fill: '#8fa0bd', fontSize: 10 }} tickFormatter={v => `${v}%`} domain={[0, 100]} />
                  <Tooltip formatter={(v) => `${v}%`} labelFormatter={(l) => concData[Number(l) - 1]?.name ?? ''} contentStyle={{ background: '#1d2639', border: '1px solid #2a3650', borderRadius: 8, fontSize: 12 }} />
                  <Area type="monotone" dataKey="y" stroke="#ff6b81" fill="rgba(255,107,129,0.15)" />
                </AreaChart>
              </ResponsiveContainer>
            </Card>
          </div>

          <h3 className="text-sm font-semibold mb-2">Per category</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-2 mb-5">
            {byCategory.map(s => <DiagCard key={s.name} stat={s} />)}
          </div>
          <h3 className="text-sm font-semibold mb-2">Per department</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-2">
            {byDepartment.map(s => <DiagCard key={s.name} stat={s} />)}
          </div>
        </>
      )}
    </section>
  )
}
