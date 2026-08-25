import { useMemo, useState, useRef, useEffect, useCallback } from 'react'
import { useDataStore } from '../../store/dataStore'
import { useUIStore } from '../../store/uiStore'
import { computeStatsByField, portfolioSummary, spendConcentrationCurve } from '../../data/metrics'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip as RTooltip, ResponsiveContainer, AreaChart, Area,
  ScatterChart, Scatter, ZAxis, Cell,
} from 'recharts'
import type { EntityStats, Contract } from '../../data/types'
import { riskScore } from '../../analytics/risk'
import { auditTerms, hasPaymentTermsData, parsePaymentDays, type TermFinding, type ClauseKind } from '../../analytics/terms'
import { supplierLeverage, negotiationCalendar, type SupplierLeverage, type ActionItem } from '../../analytics/levers'
import { savingsOpportunities, savingsSummary } from '../../analytics/savings'
import {
  T, Panel, SectionLabel, Tick, Chip, DataTable, EntityLink, EmptyState, MiniBar,
  fmtK, fmtMoney, fmtDate, urgencyColor,
  SEVERITY_COLORS, POSITION_COLORS, type Column,
} from '../../ui'
import { ChevronDown, ChevronRight, Activity } from 'lucide-react'

const KIND_COLORS: Record<string, string> = {
  'tail-consolidation': T.cyan,
  'category-bundling': T.violet,
  'payment-harmonisation': T.green,
  'renewal-interception': T.amber,
}

const SECTIONS = [
  { id: 'overview', label: 'OVERVIEW' },
  { id: 'act', label: 'ACT' },
  { id: 'savings', label: 'SAVINGS' },
  { id: 'suppliers', label: 'SUPPLIERS' },
  { id: 'audit', label: 'AUDIT' },
  { id: 'cuts', label: 'CUTS' },
  { id: 'classic', label: 'CLASSIC' },
] as const

/* ─── Screen ─── */

export default function DiagnosticsScreen() {
  const contracts = useDataStore(s => s.getContracts())
  const focusInCalendar = useUIStore(s => s.focusInCalendar)
  const [active, setActive] = useState<string>('overview')
  const scrollRef = useRef<HTMLDivElement>(null)
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({})

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

  const counts: Record<string, number | undefined> = {
    act: calendar.length, savings: opportunities.length,
    suppliers: leverage.length, audit: findings.length,
  }

  const jump = useCallback((id: string) => {
    sectionRefs.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    setActive(id)
  }, [])

  /* Scroll-spy: whichever section owns the top of the viewport is active. */
  useEffect(() => {
    const root = scrollRef.current
    if (!root) return
    const onScroll = () => {
      let current = SECTIONS[0].id as string
      for (const s of SECTIONS) {
        const el = sectionRefs.current[s.id]
        if (el && el.getBoundingClientRect().top - root.getBoundingClientRect().top <= 80) current = s.id
      }
      setActive(current)
    }
    root.addEventListener('scroll', onScroll, { passive: true })
    return () => root.removeEventListener('scroll', onScroll)
  }, [contracts])

  if (contracts.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center" style={{ background: T.ground }}>
        <EmptyState icon={<Activity size={22} />} title="No contracts loaded"
          hint="Import a register on the Upload tab to run diagnostics." />
      </div>
    )
  }

  return (
    <div className="flex-1 flex min-h-0" style={{ background: T.ground }}>
      {/* ─── Sub-nav rail ─── */}
      <nav className="flex-shrink-0 hidden xl:flex flex-col py-3 gap-0.5"
        style={{ width: '132px', borderRight: `1px solid ${T.hairline}` }}>
        {SECTIONS.map(s => (
          <button key={s.id} onClick={() => jump(s.id)}
            className="px-3 py-1 text-left text-[10px] tracking-[0.14em] cursor-pointer transition-colors flex items-baseline justify-between gap-1"
            style={{
              fontFamily: T.mono,
              color: active === s.id ? T.cyan : T.muted,
              borderLeft: `2px solid ${active === s.id ? T.cyan : 'transparent'}`,
              background: active === s.id ? T.panel : 'transparent',
            }}>
            {s.label}
            {counts[s.id] !== undefined && (
              <span className="tabular-nums" style={{ fontSize: '9px', opacity: 0.7 }}>{counts[s.id]}</span>
            )}
          </button>
        ))}
      </nav>

      <div ref={scrollRef} className="flex-1 overflow-y-auto overflow-x-hidden min-w-0">
        {/* Collapsed nav for narrow screens */}
        <div className="xl:hidden flex gap-1 px-4 py-2 flex-wrap sticky top-0 z-20"
          style={{ background: T.ground, borderBottom: `1px solid ${T.hairline}` }}>
          {SECTIONS.map(s => (
            <Chip key={s.id} label={s.label} onClick={() => jump(s.id)}
              active={active === s.id} hue={active === s.id ? T.cyan : undefined} />
          ))}
        </div>

        <div className="p-4">
          {/* ═══ OVERVIEW ═══ */}
          <section ref={el => { sectionRefs.current.overview = el }} className="mb-8 scroll-mt-4">
            <div className="flex items-stretch overflow-x-auto mb-4"
              style={{ border: `1px solid ${T.hairline}` }}>
              <Tick label="ADDRESSABLE" value={`${fmtK(savings.low)}–${fmtK(savings.high)}`}
                color={T.green} onClick={() => jump('savings')} />
              <Tick label="OPEN WINDOWS" value={String(openWindows)} color={T.cyan} onClick={() => jump('act')} />
              <Tick label="CRITICAL TERMS" value={String(criticalCount)}
                color={criticalCount ? T.red : T.green} onClick={() => jump('audit')} />
              <Tick label="NEXT ACT-BY"
                value={nextAction ? `${nextAction.daysLeft}d` : '—'}
                sub={nextAction ? nextAction.contract.slice(0, 20) : undefined}
                color={nextAction ? urgencyColor(nextAction.daysLeft) : T.muted}
                onClick={() => jump('act')} />
              <div className="flex-1" style={{ borderRight: 'none' }} />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              <Module title="Next five decisions" onOpen={() => jump('act')}>
                {calendar.length === 0
                  ? <EmptyState title="Nothing due in the next 12 months" />
                  : (
                    <div className="space-y-1">
                      {calendar.filter(i => !i.missed).slice(0, 5).map((i, n) => (
                        <button key={i.contractId + n} onClick={() => focusInCalendar(i.contractId)}
                          className="w-full flex items-baseline gap-2 px-2 py-1 text-left cursor-pointer hover:bg-[#0B1322]">
                          <span className="text-[10px] tabular-nums flex-shrink-0 w-10 font-semibold"
                            style={{ color: urgencyColor(i.daysLeft), fontFamily: T.mono }}>{i.daysLeft}d</span>
                          <span className="text-[11px] truncate flex-1" style={{ color: T.dim }}>{i.contract}</span>
                          <span className="text-[10px] tabular-nums flex-shrink-0"
                            style={{ color: T.muted, fontFamily: T.mono }}>{fmtK(i.value)}</span>
                        </button>
                      ))}
                    </div>
                  )}
              </Module>

              <Module title="Savings by kind" onOpen={() => jump('savings')}>
                {opportunities.length === 0
                  ? <EmptyState title="No opportunities detected" />
                  : (
                    <div className="space-y-2">
                      {opportunities.slice(0, 3).map(o => (
                        <MiniBar key={o.kind + o.title} label={o.title}
                          value={`${fmtK(o.low)}–${fmtK(o.high)}`}
                          pct={savings.high > 0 ? (o.high / savings.high) * 100 : 0}
                          color={KIND_COLORS[o.kind] ?? T.cyan} />
                      ))}
                    </div>
                  )}
              </Module>

              <Module title="Where we have leverage" onOpen={() => jump('suppliers')}>
                <div className="grid grid-cols-2 gap-2">
                  {leverage.slice(0, 4).map(s => (
                    <div key={s.supplier} className="p-2" style={{ background: T.ground, border: `1px solid ${T.hairline}` }}>
                      <div className="flex items-baseline justify-between gap-1">
                        <span className="text-[10px] truncate" style={{ color: T.dim }}>{s.supplier}</span>
                        <span className="text-[8px] tracking-wider flex-shrink-0"
                          style={{ color: POSITION_COLORS[s.position], fontFamily: T.mono }}>
                          {s.position.toUpperCase()}
                        </span>
                      </div>
                      <div className="text-[10px] tabular-nums mt-0.5" style={{ color: T.muted, fontFamily: T.mono }}>
                        {fmtK(s.spend)}
                        {s.nextWindow && <span style={{ color: urgencyColor(s.nextWindow.daysLeft) }}> · {s.nextWindow.daysLeft}d</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </Module>

              <Module title="Contract terms pulse" onOpen={() => jump('audit')}>
                <div className="flex gap-4 mb-2">
                  {(['critical', 'warning', 'info'] as const).map(sev => (
                    <div key={sev}>
                      <div className="text-[18px] font-bold tabular-nums"
                        style={{ color: SEVERITY_COLORS[sev], fontFamily: T.mono }}>
                        {findings.filter(f => f.severity === sev).length}
                      </div>
                      <SectionLabel>{sev}</SectionLabel>
                    </div>
                  ))}
                </div>
                {findings[0] && (
                  <div className="text-[10px] leading-relaxed pt-2" style={{ color: T.muted, borderTop: `1px solid ${T.hairline}` }}>
                    <span style={{ color: SEVERITY_COLORS[findings[0].severity] }}>▸ </span>
                    {findings[0].title}
                  </div>
                )}
              </Module>
            </div>
          </section>

          {/* ═══ ACT ═══ */}
          <section ref={el => { sectionRefs.current.act = el }} className="mb-8 scroll-mt-4">
            <Head title="What to act on"
              subtitle="Every decision date in the next 12 months. Notice deadlines are separate events — that is when the decision has to be made." />
            <Panel>
              <ActTable calendar={calendar} onFocus={focusInCalendar} />
            </Panel>
          </section>

          {/* ═══ SAVINGS ═══ */}
          <section ref={el => { sectionRefs.current.savings = el }} className="mb-8 scroll-mt-4">
            <Head title="Where the money could come from"
              subtitle="Heuristic ranges, not quotes. Each carries the assumption it was built on." />
            {opportunities.length === 0 ? (
              <Panel><EmptyState title="No consolidation or renegotiation opportunities detected" /></Panel>
            ) : (
              <Panel className="p-4">
                <div className="space-y-3">
                  {opportunities.map(o => (
                    <div key={o.kind + o.title}>
                      <MiniBar label={o.title} value={`${fmtK(o.low)}–${fmtK(o.high)}`}
                        pct={savings.high > 0 ? (o.high / savings.high) * 100 : 0}
                        color={KIND_COLORS[o.kind] ?? T.cyan} />
                      <div className="text-[10px] mt-1" style={{ color: T.muted }}>{o.detail}</div>
                      <div className="text-[9px] mt-0.5 italic" style={{ color: T.faint }}>{o.assumption}</div>
                    </div>
                  ))}
                </div>
                <div className="mt-3 pt-2 flex items-baseline justify-between" style={{ borderTop: `1px solid ${T.hairline}` }}>
                  <span className="text-[10px]" style={{ color: T.muted }}>
                    Total, counting each contract once at its best applicable rate
                  </span>
                  <span className="text-sm font-bold tabular-nums" style={{ color: T.green, fontFamily: T.mono }}>
                    {fmtK(savings.low)}–{fmtK(savings.high)}
                  </span>
                </div>
              </Panel>
            )}
          </section>

          {/* ═══ SUPPLIERS ═══ */}
          <section ref={el => { sectionRefs.current.suppliers = el }} className="mb-8 scroll-mt-4">
            <SupplierBoard leverage={leverage} />
          </section>

          {/* ═══ AUDIT ═══ */}
          <section ref={el => { sectionRefs.current.audit = el }} className="mb-8 scroll-mt-4">
            <TermsAudit findings={findings} contracts={contracts} />
          </section>

          {/* ═══ CUTS ═══ */}
          <section ref={el => { sectionRefs.current.cuts = el }} className="mb-8 scroll-mt-4">
            <Head title="Cuts of the portfolio" subtitle="Where spend sits, what is risky, and when the load lands." />
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              <RiskSpendScatter contracts={contracts} />
              <RenewalLoad contracts={contracts} />
            </div>
            <div className="mt-3"><Heatmap contracts={contracts} /></div>
            {paymentData ? (
              <div className="mt-3"><PaymentHistogram contracts={contracts} /></div>
            ) : (
              <Panel className="mt-3 p-4">
                <SectionLabel>PAYMENT TERMS</SectionLabel>
                <p className="text-xs mt-1" style={{ color: T.muted }}>
                  Not enough payment-terms data to analyse — map a payment terms column on import
                  to unlock working-capital analysis.
                </p>
              </Panel>
            )}
          </section>

          {/* ═══ CLASSIC ═══ */}
          <section ref={el => { sectionRefs.current.classic = el }} className="scroll-mt-4">
            <ClassicViews summary={summary} byCategory={byCategory}
              byDepartment={byDepartment} concentration={concentration} />
          </section>
        </div>
      </div>
    </div>
  )
}

/* ─── Shells ─── */

function Head({ title, subtitle, right }: { title: string; subtitle?: string; right?: React.ReactNode }) {
  return (
    <div className="flex items-end justify-between gap-3 mb-2 flex-wrap">
      <div>
        <h2 className="text-sm font-semibold" style={{ color: T.text }}>{title}</h2>
        {subtitle && <p className="text-[11px] mt-0.5 max-w-3xl" style={{ color: T.muted }}>{subtitle}</p>}
      </div>
      {right}
    </div>
  )
}

function Module({ title, children, onOpen }: {
  title: string; children: React.ReactNode; onOpen: () => void
}) {
  return (
    <Panel className="p-3">
      <div className="flex items-center justify-between mb-2">
        <SectionLabel>{title}</SectionLabel>
        <button onClick={onOpen} className="text-[9px] tracking-wider cursor-pointer hover:brightness-150"
          style={{ color: T.cyan, fontFamily: T.mono }}>OPEN →</button>
      </div>
      {children}
    </Panel>
  )
}

/* ─── Act table ─── */

function ActTable({ calendar, onFocus }: {
  calendar: ActionItem[]; onFocus: (contractId: string) => void
}) {
  const [filter, setFilter] = useState<'all' | 'missed' | 'notice' | 'expiry'>('all')
  const [limit, setLimit] = useState(25)
  const [expanded, setExpanded] = useState<string | null>(null)

  const rows = useMemo(() => calendar.filter(i =>
    filter === 'all' ? true
      : filter === 'missed' ? i.missed
        : filter === 'notice' ? i.kind === 'notice-deadline'
          : i.kind === 'expiry'), [calendar, filter])

  const shown = rows.slice(0, limit)
  const key = (i: ActionItem) => `${i.contractId}:${i.kind}`

  const columns: Column<ActionItem>[] = [
    {
      key: 'actBy', header: 'Act by', sortValue: i => i.actBy, width: '92px',
      render: i => <span className="tabular-nums">{fmtDate(i.actBy)}</span>,
    },
    {
      key: 'left', header: 'Left', sortValue: i => i.daysLeft, width: '64px',
      render: i => (
        <span className="tabular-nums font-semibold" style={{ color: urgencyColor(i.daysLeft, i.missed) }}>
          {i.missed ? 'missed' : `${i.daysLeft}d`}
        </span>
      ),
    },
    {
      key: 'contract', header: 'Contract', sortValue: i => i.contract,
      render: i => <span style={{ color: T.text }}>{i.contract}</span>,
    },
    {
      key: 'supplier', header: 'Supplier', sortValue: i => i.supplier, width: '160px',
      render: i => <EntityLink type="supplier" name={i.supplier} />,
    },
    {
      key: 'value', header: 'Value', sortValue: i => i.value, width: '84px', align: 'right',
      render: i => <span className="tabular-nums">{fmtK(i.value)}</span>,
    },
    {
      key: 'kind', header: 'Type', sortValue: i => i.kind, width: '80px',
      render: i => (
        <span className="text-[9px] tracking-wider"
          style={{ color: i.kind === 'notice-deadline' ? T.amber : T.muted }}>
          {i.kind === 'notice-deadline' ? 'NOTICE' : 'EXPIRY'}
        </span>
      ),
    },
  ]

  return (
    <>
      <div className="flex gap-1 p-2 flex-wrap" style={{ borderBottom: `1px solid ${T.hairline}` }}>
        {([['all', 'ALL'], ['missed', 'MISSED'], ['notice', 'NOTICE'], ['expiry', 'EXPIRY']] as const).map(([v, l]) => (
          <Chip key={v} label={l} onClick={() => setFilter(v)} active={filter === v}
            hue={filter === v ? T.cyan : undefined} />
        ))}
        <div className="flex-1" />
        <span className="text-[9px] tracking-wider self-center" style={{ color: T.muted, fontFamily: T.mono }}>
          {rows.length} ITEMS
        </span>
      </div>
      <DataTable rows={shown} columns={columns} rowKey={key}
        initialSort={{ key: 'actBy', dir: 'asc' }}
        expandedKey={expanded}
        onRowClick={i => setExpanded(x => x === key(i) ? null : key(i))}
        renderExpanded={i => (
          <div className="flex items-center justify-between gap-3">
            <span className="text-[11px]" style={{ color: T.dim }}>{i.action}</span>
            <button onClick={e => { e.stopPropagation(); onFocus(i.contractId) }}
              className="text-[9px] tracking-wider px-2 py-0.5 cursor-pointer flex-shrink-0"
              style={{ color: T.cyan, border: `1px solid ${T.hairline}`, fontFamily: T.mono }}>
              SEE ON TIMELINE →
            </button>
          </div>
        )}
        emptyLabel="Nothing matches this filter" />
      {rows.length > limit && (
        <button onClick={() => setLimit(l => l + 40)}
          className="w-full py-1.5 text-[9px] tracking-wider cursor-pointer"
          style={{ color: T.cyan, borderTop: `1px solid ${T.hairline}`, fontFamily: T.mono }}>
          SHOW MORE — {rows.length - limit} REMAINING
        </button>
      )}
    </>
  )
}

/* ─── Supplier leverage board ─── */

function SupplierBoard({ leverage }: { leverage: SupplierLeverage[] }) {
  const [sort, setSort] = useState<'leverage' | 'spend' | 'window'>('leverage')
  const [position, setPosition] = useState<'all' | 'strong' | 'balanced' | 'weak'>('all')
  const [open, setOpen] = useState<string | null>(null)

  const rows = useMemo(() => {
    let l = position === 'all' ? [...leverage] : leverage.filter(s => s.position === position)
    if (sort === 'spend') l = l.sort((a, b) => b.spend - a.spend)
    else if (sort === 'window') l = l.sort((a, b) => {
      if (!a.nextWindow && !b.nextWindow) return b.spend - a.spend
      if (!a.nextWindow) return 1
      if (!b.nextWindow) return -1
      return a.nextWindow.daysLeft - b.nextWindow.daysLeft
    })
    else l = l.sort((a, b) => b.leverageScore - a.leverageScore)
    return l
  }, [leverage, sort, position])

  return (
    <>
      <Head title="Supplier leverage"
        subtitle="Our position against each supplier, and the levers available before the next window closes."
        right={
          <div className="flex gap-1 flex-wrap">
            {(['all', 'strong', 'balanced', 'weak'] as const).map(p => (
              <Chip key={p} label={p.toUpperCase()} onClick={() => setPosition(p)}
                active={position === p}
                hue={position === p ? (p === 'all' ? T.cyan : POSITION_COLORS[p]) : undefined} />
            ))}
            <span className="w-2" />
            {(['leverage', 'spend', 'window'] as const).map(s => (
              <Chip key={s} label={`SORT ${s.toUpperCase()}`} onClick={() => setSort(s)}
                active={sort === s} hue={sort === s ? T.cyan : undefined} />
            ))}
          </div>
        } />
      {rows.length === 0 ? (
        <Panel><EmptyState title="No suppliers in this position" /></Panel>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {rows.slice(0, 10).map(s => {
            const isOpen = open === s.supplier
            return (
              <Panel key={s.supplier} className="p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-[12px] font-semibold truncate" style={{ color: T.text }}>
                      <EntityLink type="supplier" name={s.supplier} color={T.text} />
                    </div>
                    <div className="text-[10px] mt-0.5 tabular-nums" style={{ color: T.muted, fontFamily: T.mono }}>
                      {fmtK(s.spend)} · {s.contractCount} contract{s.contractCount === 1 ? '' : 's'} · {s.departments.length} dept{s.departments.length === 1 ? '' : 's'}
                    </div>
                  </div>
                  <span className="text-[8px] font-semibold px-1.5 py-0.5 tracking-wider flex-shrink-0"
                    style={{
                      background: `${POSITION_COLORS[s.position]}18`,
                      color: POSITION_COLORS[s.position], fontFamily: T.mono,
                    }}>
                    {s.position.toUpperCase()}
                  </span>
                </div>

                {s.nextWindow && (
                  <div className="mt-2 px-2 py-1 flex items-center justify-between gap-2"
                    style={{ background: T.ground }}>
                    <span className="text-[10px] truncate" style={{ color: T.dim }}>{s.nextWindow.contract}</span>
                    <span className="text-[10px] font-semibold tabular-nums whitespace-nowrap"
                      style={{ color: urgencyColor(s.nextWindow.daysLeft), fontFamily: T.mono }}>
                      ACT IN {s.nextWindow.daysLeft}D
                    </span>
                  </div>
                )}

                <div className="flex flex-wrap gap-1 mt-2">
                  {s.levers.map(l => (
                    <span key={l.kind} className="text-[9px] px-1.5 py-0.5 tracking-wider"
                      style={{ background: T.ground, border: `1px solid ${T.hairline}`, color: T.muted, fontFamily: T.mono }}>
                      {l.kind.replace(/-/g, ' ').toUpperCase()}
                    </span>
                  ))}
                </div>

                <button onClick={() => setOpen(isOpen ? null : s.supplier)}
                  className="mt-2 text-[10px] cursor-pointer inline-flex items-center gap-1 hover:brightness-150"
                  style={{ color: T.muted, fontFamily: T.mono }}>
                  {isOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                  {isOpen ? 'HIDE LEVERS' : `${s.levers.length} LEVER${s.levers.length === 1 ? '' : 'S'}`}
                </button>

                {isOpen && (
                  <div className="mt-2 space-y-2 pt-2" style={{ borderTop: `1px solid ${T.hairline}` }}>
                    {s.levers.map(l => (
                      <div key={l.kind}>
                        <div className="text-[11px] font-medium" style={{ color: T.text }}>{l.title}</div>
                        <div className="text-[10px] mt-0.5" style={{ color: T.muted }}>{l.detail}</div>
                        {l.estimate && (
                          <div className="text-[9px] mt-0.5" style={{ color: T.green, fontFamily: T.mono }}>
                            {fmtK(l.estimate.low)}–{fmtK(l.estimate.high)}
                            <span className="italic ml-1" style={{ color: T.faint }}>· {l.estimate.assumption}</span>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </Panel>
            )
          })}
        </div>
      )}
    </>
  )
}

/* ─── Terms audit ─── */

const CLAUSE_LABELS: Record<ClauseKind, string> = {
  'auto-renewal': 'AUTO-RENEWAL',
  'notice': 'NOTICE',
  'term-length': 'TERM',
  'payment': 'PAYMENT',
  'raw-scan': 'SOURCE SCAN',
  'status': 'STATUS',
}

function TermsAudit({ findings, contracts }: { findings: TermFinding[]; contracts: Contract[] }) {
  const [clause, setClause] = useState<ClauseKind | 'all'>('all')
  const [severity, setSeverity] = useState<'all' | 'critical' | 'warning' | 'info'>('all')
  const [expanded, setExpanded] = useState<string | null>(null)

  const kinds = useMemo(() => [...new Set(findings.map(f => f.clause))] as ClauseKind[], [findings])
  const rows = useMemo(() => findings.filter(f =>
    (clause === 'all' || f.clause === clause) &&
    (severity === 'all' || f.severity === severity)), [findings, clause, severity])

  const columns: Column<TermFinding>[] = [
    {
      key: 'severity', header: '', width: '18px', sortValue: f => ({ critical: 0, warning: 1, info: 2 })[f.severity],
      render: f => (
        <span style={{
          width: '7px', height: '7px', display: 'inline-block',
          borderRadius: f.severity === 'critical' ? '1px' : '50%',
          background: SEVERITY_COLORS[f.severity],
        }} />
      ),
    },
    {
      key: 'clause', header: 'Clause', width: '110px', sortValue: f => f.clause,
      render: f => (
        <span className="text-[9px] tracking-wider" style={{ color: T.muted }}>
          {CLAUSE_LABELS[f.clause]}
        </span>
      ),
    },
    {
      key: 'title', header: 'Finding', sortValue: f => f.title,
      render: f => <span style={{ color: T.text }}>{f.title}</span>,
    },
    {
      key: 'exposure', header: 'Exposure', width: '90px', align: 'right', sortValue: f => f.exposure,
      render: f => f.exposure ? (
        <span className="tabular-nums" style={{ color: SEVERITY_COLORS[f.severity] }}>{fmtK(f.exposure)}</span>
      ) : <span style={{ color: T.faint }}>—</span>,
    },
    {
      key: 'actBy', header: 'Act by', width: '92px', sortValue: f => f.actBy,
      render: f => f.actBy
        ? <span className="tabular-nums">{fmtDate(f.actBy)}</span>
        : <span style={{ color: T.faint }}>—</span>,
    },
  ]

  return (
    <>
      <Head title="Terms & conditions audit"
        subtitle={`${findings.length} finding${findings.length === 1 ? '' : 's'} across ${contracts.length} contracts.`}
        right={
          <div className="flex gap-1 flex-wrap">
            {(['all', 'critical', 'warning', 'info'] as const).map(s => (
              <Chip key={s} label={s.toUpperCase()} onClick={() => setSeverity(s)} active={severity === s}
                hue={severity === s ? (s === 'all' ? T.cyan : SEVERITY_COLORS[s]) : undefined} />
            ))}
          </div>
        } />
      <div className="flex gap-1 mb-2 flex-wrap">
        <Chip label="ALL CLAUSES" onClick={() => setClause('all')} active={clause === 'all'}
          hue={clause === 'all' ? T.cyan : undefined} />
        {kinds.map(k => (
          <Chip key={k} label={CLAUSE_LABELS[k]} onClick={() => setClause(k)} active={clause === k}
            hue={clause === k ? T.cyan : undefined} />
        ))}
      </div>
      <Panel>
        <DataTable rows={rows} columns={columns} rowKey={f => f.id}
          initialSort={{ key: 'severity', dir: 'asc' }}
          expandedKey={expanded}
          onRowClick={f => setExpanded(x => x === f.id ? null : f.id)}
          renderExpanded={f => (
            <div>
              <div className="text-[11px] leading-relaxed" style={{ color: T.dim }}>{f.detail}</div>
              <div className="text-[10px] mt-1.5 flex items-start gap-1.5" style={{ color: T.cyan }}>
                <span style={{ color: T.faint }}>FIX:</span>{f.fix}
              </div>
              {f.clause === 'raw-scan' && (
                <div className="text-[9px] mt-1 italic" style={{ color: T.faint }}>
                  Text match on imported data — review the agreement to confirm.
                </div>
              )}
            </div>
          )}
          emptyLabel="No findings match these filters" />
      </Panel>
    </>
  )
}
/* Helpers retained for the collapsed classic views. */
function scoreClass(s: number) {
  return s >= 80 ? 'bg-green-900/30 text-green-400'
    : s >= 55 ? 'bg-amber-900/30 text-amber-400'
      : 'bg-red-900/30 text-red-400'
}

function StatTile({ value, label }: { value: string | number; label: string }) {
  return (
    <Panel className="p-3">
      <div className="text-lg font-bold tabular-nums" style={{ color: T.text, fontFamily: T.mono }}>{value}</div>
      <div className="text-[10px] mt-0.5" style={{ color: T.muted }}>{label}</div>
    </Panel>
  )
}

/* ─── Charts and classic views ─── */

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
    <Panel className="p-4">
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
          <RTooltip
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
    </Panel>
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
    <Panel className="p-4">
      <h3 className="text-sm font-semibold mb-1">Renewal load by quarter</h3>
      <p className="text-[10px] mb-2" style={{ color: '#64748B' }}>
        {data.length === 0 ? 'No expiries in the next two years.' : 'Value reaching its end date, next two years.'}
      </p>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={data} margin={{ top: 5, right: 10, bottom: 5, left: 5 }}>
          <XAxis dataKey="quarter" tick={{ fill: '#8fa0bd', fontSize: 10 }} />
          <YAxis tickFormatter={v => `€${(v / 1000).toFixed(0)}k`} tick={{ fill: '#8fa0bd', fontSize: 10 }} />
          <RTooltip formatter={(v) => fmtMoney(Number(v))}
            contentStyle={{ background: '#1d2639', border: '1px solid #2a3650', borderRadius: 8, fontSize: 12 }} />
          <Bar dataKey="spend" fill="#38BDF8" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </Panel>
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
    <Panel className="p-4">
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
    </Panel>
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
    <Panel className="p-4">
      <h3 className="text-sm font-semibold mb-1">Payment terms distribution</h3>
      <p className="text-[10px] mb-2" style={{ color: '#64748B' }}>
        Spend-weighted average: <span style={{ color: '#34D399' }}>{Math.round(weightedAvg)} days</span>
      </p>
      <ResponsiveContainer width="100%" height={180}>
        <BarChart data={data} margin={{ top: 5, right: 10, bottom: 5, left: 5 }}>
          <XAxis dataKey="bucket" tick={{ fill: '#8fa0bd', fontSize: 10 }} />
          <YAxis allowDecimals={false} tick={{ fill: '#8fa0bd', fontSize: 10 }} />
          <RTooltip contentStyle={{ background: '#1d2639', border: '1px solid #2a3650', borderRadius: 8, fontSize: 12 }} />
          <Bar dataKey="count" fill="#34D399" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </Panel>
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
            <Panel className="p-4">
              <h3 className="text-sm font-semibold mb-3">Spend by department</h3>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={spendByDept} layout="vertical">
                  <XAxis type="number" tickFormatter={v => `€${(v / 1000).toFixed(0)}k`} tick={{ fill: '#8fa0bd', fontSize: 10 }} />
                  <YAxis type="category" dataKey="name" width={100} tick={{ fill: '#8fa0bd', fontSize: 10 }} />
                  <RTooltip formatter={(v) => fmtMoney(Number(v))} contentStyle={{ background: '#1d2639', border: '1px solid #2a3650', borderRadius: 8, fontSize: 12 }} />
                  <Bar dataKey="spend" fill="#4da3ff" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </Panel>
            <Panel className="p-4">
              <h3 className="text-sm font-semibold mb-3">Spend by category (top 12)</h3>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={spendByCat} layout="vertical">
                  <XAxis type="number" tickFormatter={v => `€${(v / 1000).toFixed(0)}k`} tick={{ fill: '#8fa0bd', fontSize: 10 }} />
                  <YAxis type="category" dataKey="name" width={100} tick={{ fill: '#8fa0bd', fontSize: 10 }} />
                  <RTooltip formatter={(v) => fmtMoney(Number(v))} contentStyle={{ background: '#1d2639', border: '1px solid #2a3650', borderRadius: 8, fontSize: 12 }} />
                  <Bar dataKey="spend" fill="#ffb347" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </Panel>
            <Panel className="p-4">
              <h3 className="text-sm font-semibold mb-3">Supplier spend concentration</h3>
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={concData}>
                  <XAxis dataKey="x" tick={{ fill: '#8fa0bd', fontSize: 10 }} />
                  <YAxis tick={{ fill: '#8fa0bd', fontSize: 10 }} tickFormatter={v => `${v}%`} domain={[0, 100]} />
                  <RTooltip formatter={(v) => `${v}%`} labelFormatter={(l) => concData[Number(l) - 1]?.name ?? ''} contentStyle={{ background: '#1d2639', border: '1px solid #2a3650', borderRadius: 8, fontSize: 12 }} />
                  <Area type="monotone" dataKey="y" stroke="#ff6b81" fill="rgba(255,107,129,0.15)" />
                </AreaChart>
              </ResponsiveContainer>
            </Panel>
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
