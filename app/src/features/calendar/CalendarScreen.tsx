import { useMemo, useState, useRef, useCallback, useEffect } from 'react'
import { useDataStore } from '../../store/dataStore'
import { useUIStore } from '../../store/uiStore'
import type { Contract } from '../../data/types'
import {
  timelineRows, monthTicks, todayPct, annotate,
  fitWindow, zoomWindow, panWindow, monthDensity, partitionRows, decisionPoints,
  decidableWithin,
  type TimeWindow, type TimelineRow,
} from '../../analytics/timeline'
import { findGaps } from '../../analytics/gaps'
import {
  T, Tick, Chip, TerminalSelect, TerminalInput, Tooltip, EntityLink,
  EmptyState, SectionLabel, urgencyColor, fmtK, fmtMoney, fmtDate,
} from '../../ui'
import { AlertTriangle, RefreshCw, ZoomIn, ZoomOut, Maximize2, Calendar as CalIcon, ChevronDown, ChevronRight } from 'lucide-react'

type GroupBy = 'none' | 'department' | 'category' | 'supplier' | 'owner'

const RAIL_W = 208
const ANNOT_W = 118
const ROW_H = 30

/* ─── ICS ─── */

/**
 * RFC 5545 TEXT escaping. A contract named "Cleaning, HQ; phase 2" would
 * otherwise be truncated or rejected, because comma and semicolon are value
 * separators in the format.
 */
export function icsText(v: unknown): string {
  return String(v ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n')
}

const icsDate = (d: Date) =>
  `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`

export function icsEvents(rows: TimelineRow[]): string {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//ProcurementWeb//Renewal Calendar//EN']
  const event = (d: Date, summary: string, c: Contract, uid: string) => {
    // For DATE values DTEND is exclusive, so DTSTART == DTEND is a
    // zero-length event that Google Calendar and Outlook discard.
    const end = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)
    lines.push('BEGIN:VEVENT', `DTSTART;VALUE=DATE:${icsDate(d)}`, `DTEND;VALUE=DATE:${icsDate(end)}`,
      `SUMMARY:${icsText(`${summary}: ${c.name}`)}`,
      `DESCRIPTION:${icsText(`Supplier: ${c.supplier}`)}\\n${icsText(`Department: ${c.department}`)}\\n${icsText(`Value: ${fmtMoney(c.annualValue)}`)}\\n${icsText(`End date: ${fmtDate(c.endDate)}`)}`,
      `UID:${icsText(uid)}@procurementweb`, 'END:VEVENT')
  }
  for (const r of rows) {
    if (r.noticeDate) event(r.noticeDate, '⚠ Notice deadline', r.contract, `${r.contract.id}-notice`)
    event(r.contract.endDate!, 'Contract expiry', r.contract, `${r.contract.id}-end`)
  }
  lines.push('END:VCALENDAR')
  return lines.join('\r\n')
}

function downloadICS(rows: TimelineRow[], name: string) {
  const blob = new Blob([icsEvents(rows)], { type: 'text/calendar' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = name; a.click()
  URL.revokeObjectURL(url)
}

/* ─── Screen ─── */

export default function CalendarScreen() {
  const contracts = useDataStore(s => s.getContracts())
  const pendingFocus = useUIStore(s => s.pendingCalendarFocus)
  const clearPendingFocus = useUIStore(s => s.clearPendingCalendarFocus)

  const [window_, setWindow] = useState<TimeWindow>(() => fitWindow(contracts))
  const [groupBy, setGroupBy] = useState<GroupBy>('none')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [showOverdue, setShowOverdue] = useState(false)
  const [search, setSearch] = useState('')
  const [dept, setDept] = useState('')
  const [supplier, setSupplier] = useState('')
  const [minValue, setMinValue] = useState(0)
  const [focusRow, setFocusRow] = useState(0)
  const trackRef = useRef<HTMLDivElement>(null)

  // Re-fit when the dataset changes underneath.
  useEffect(() => { setWindow(fitWindow(contracts)) }, [contracts])

  const departments = useMemo(
    () => [...new Set(contracts.map(c => c.department).filter(Boolean))].sort(), [contracts])
  const suppliers = useMemo(
    () => [...new Set(contracts.map(c => c.supplier).filter(Boolean))].sort(), [contracts])
  const maxSpend = useMemo(
    () => Math.max(1, ...contracts.map(c => c.annualValue ?? 0)), [contracts])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return contracts.filter(c => {
      if (dept && c.department !== dept) return false
      if (supplier && c.supplier !== supplier) return false
      if (minValue > 0 && (c.annualValue ?? 0) < minValue) return false
      if (q && !(`${c.name} ${c.supplier} ${c.category} ${c.department}`.toLowerCase().includes(q))) return false
      return true
    })
  }, [contracts, dept, supplier, minValue, search])

  const rows = useMemo(() => timelineRows(filtered, window_), [filtered, window_])
  const ticks = useMemo(() => monthTicks(window_), [window_])
  const nowPct = useMemo(() => todayPct(window_), [window_])
  const density = useMemo(() => monthDensity(rows, window_), [rows, window_])
  const parts = useMemo(() => partitionRows(rows), [rows])
  const points = useMemo(() => decisionPoints(rows, window_), [rows, window_])
  const undated = useMemo(() => filtered.filter(c => !c.endDate), [filtered])
  const gaps = useMemo(() => findGaps(contracts), [contracts])

  const unplanned = gaps.find(g => g.kind === 'expiring-unplanned')
  const missedValue = parts.overdue.reduce((s, r) => s + (r.contract.annualValue ?? 0), 0)
  // The tile is labelled "<=90D", so its count and its money must both be
  // the 90-day set — not the count of one window beside the value of another.
  // Measured on the decision date, which is what "decidable" means here.
  const decidable90 = decidableWithin(parts.decidable, 90)
  const decidableValue = decidable90.reduce((s, r) => s + (r.contract.annualValue ?? 0), 0)
  const silent = rows.filter(r => r.silentRenewalRisk)
  const next = parts.decidable[0]

  /* Ordered visible rows — decidable first, then upcoming, overdue behind a band. */
  const visible = useMemo(() => {
    const base = [...parts.decidable, ...parts.upcoming]
    return showOverdue ? [...base, ...parts.overdue] : base
  }, [parts, showOverdue])

  const groups = useMemo(() => {
    if (groupBy === 'none') return [{ name: '', rows: visible }]
    const m = new Map<string, TimelineRow[]>()
    for (const r of visible) {
      const k = (groupBy === 'department' ? r.contract.department
        : groupBy === 'category' ? r.contract.category
          : groupBy === 'supplier' ? r.contract.supplier
            : r.contract.owner) || '(unassigned)'
      if (!m.has(k)) m.set(k, [])
      m.get(k)!.push(r)
    }
    return [...m.entries()].map(([name, rs]) => ({ name, rows: rs }))
      .sort((a, b) =>
        b.rows.reduce((s, r) => s + (r.contract.annualValue ?? 0), 0) -
        a.rows.reduce((s, r) => s + (r.contract.annualValue ?? 0), 0))
  }, [visible, groupBy])

  /* Arriving from another tab with a contract to look at. */
  useEffect(() => {
    if (!pendingFocus) return
    const hit = rows.find(r => r.contract.id === pendingFocus)
    if (hit) {
      setExpanded(hit.contract.id)
      if (hit.overdue) setShowOverdue(true)
    }
    clearPendingFocus()
  }, [pendingFocus, rows, clearPendingFocus])

  /* Zoom & pan */
  const zoom = useCallback((factor: number, focusPct = 0.5) => {
    setWindow(w => zoomWindow(w, factor, focusPct))
  }, [])
  /**
   * Registered manually rather than via onWheel, because React attaches
   * `wheel` to its root container as a *passive* listener — inside which
   * preventDefault() silently does nothing, so the page scrolled while the
   * timeline zoomed and the browser logged a warning on every tick.
   */
  useEffect(() => {
    const el = trackRef.current
    if (!el) return
    const handler = (e: WheelEvent) => {
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      zoom(e.deltaY > 0 ? 1.25 : 0.8, (e.clientX - rect.left) / rect.width)
    }
    el.addEventListener('wheel', handler, { passive: false })
    return () => el.removeEventListener('wheel', handler)
  }, [zoom])

  const dragRef = useRef<{ x: number; active: boolean }>({ x: 0, active: false })
  const onPointerDown = (e: React.PointerEvent) => {
    dragRef.current = { x: e.clientX, active: true }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current.active || !trackRef.current) return
    const dx = e.clientX - dragRef.current.x
    if (Math.abs(dx) < 2) return
    dragRef.current.x = e.clientX
    setWindow(w => panWindow(w, -dx / trackRef.current!.getBoundingClientRect().width))
  }
  const onPointerUp = () => { dragRef.current.active = false }

  /* Keyboard */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      if (el && ['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName)) return
      if (e.key === 'ArrowDown') { e.preventDefault(); setFocusRow(i => Math.min(i + 1, visible.length - 1)) }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setFocusRow(i => Math.max(i - 1, 0)) }
      else if (e.key === 'Enter') {
        const r = visible[focusRow]
        if (r) setExpanded(x => x === r.contract.id ? null : r.contract.id)
      }
      else if (e.key === '+' || e.key === '=') zoom(0.8)
      else if (e.key === '-') zoom(1.25)
      else if (e.key === 'f' || e.key === 'F') setWindow(fitWindow(contracts))
      else if (e.altKey && e.key === 'ArrowLeft') setWindow(w => panWindow(w, -0.2))
      else if (e.altKey && e.key === 'ArrowRight') setWindow(w => panWindow(w, 0.2))
      else if (e.key === 'g') {
        const order: GroupBy[] = ['none', 'department', 'category', 'supplier', 'owner']
        setGroupBy(g => order[(order.indexOf(g) + 1) % order.length])
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [visible, focusRow, zoom, contracts])

  const chips: { label: string; onClear: () => void; hue?: string }[] = []
  if (search) chips.push({ label: `FIND "${search.toUpperCase()}"`, onClear: () => setSearch('') })
  if (dept) chips.push({ label: `DEPT ${dept.toUpperCase()}`, onClear: () => setDept('') })
  if (supplier) chips.push({ label: `SUPPLIER ${supplier.toUpperCase()}`, onClear: () => setSupplier('') })
  if (minValue > 0) chips.push({ label: `MIN ${fmtK(minValue)}`, onClear: () => setMinValue(0) })
  if (groupBy !== 'none') chips.push({ label: `GROUP ${groupBy.toUpperCase()}`, onClear: () => setGroupBy('none'), hue: T.cyan })

  if (contracts.length === 0) {
    return <div className="flex-1 flex items-center justify-center" style={{ background: T.ground }}>
      <EmptyState icon={<CalIcon size={22} />} title="No contracts loaded"
        hint="Import a register on the Upload tab to see the renewal timeline." />
    </div>
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 min-w-0" style={{ background: T.ground }}>
      {/* ─── Cockpit strip ─── */}
      <div className="flex items-stretch overflow-x-auto flex-shrink-0"
        style={{ borderBottom: `1px solid ${T.hairline}` }}>
        <Tick label="DECIDABLE ≤90D"
          value={String(decidable90.length)}
          sub={fmtK(decidableValue)} color={T.cyan}
          onClick={() => { setShowOverdue(false); setWindow(fitWindow(contracts)) }} />
        <Tick label="NEXT ACT-BY"
          value={next?.noticeDate ? fmtDate(next.noticeDate) : '—'}
          sub={next ? next.contract.name.slice(0, 18) : undefined}
          color={next ? urgencyColor(Math.round((next.noticeDate!.getTime() - Date.now()) / 86400000)) : T.muted}
          onClick={() => next && setExpanded(next.contract.id)} />
        <Tick label="MISSED WINDOWS" value={String(silent.length)}
          sub={fmtK(silent.reduce((s, r) => s + (r.contract.annualValue ?? 0), 0))}
          color={silent.length ? T.red : T.green} />
        <Tick label="EXPIRED" value={String(parts.overdue.length)} sub={fmtK(missedValue)}
          color={T.red} onClick={() => setShowOverdue(v => !v)} />
        <Tick label="NO SUCCESSOR" value={unplanned ? String(unplanned.contractCount) : '0'}
          sub={unplanned ? fmtK(unplanned.exposure) : undefined} color={T.magenta} />
        <div className="flex-1" style={{ borderRight: 'none' }} />
        <button onClick={() => downloadICS(rows, 'procurement-renewals.ics')}
          className="flex items-center gap-1.5 px-4 text-[10px] font-semibold tracking-widest cursor-pointer flex-shrink-0 hover:brightness-125"
          style={{ color: T.ground, background: T.cyan, fontFamily: T.mono }}>
          EXPORT ICS
        </button>
      </div>

      {/* ─── Command bar ─── */}
      <div className="flex items-center gap-2 px-3 py-1.5 flex-wrap flex-shrink-0"
        style={{ background: T.panel, borderBottom: `1px solid ${T.hairline}` }}>
        <TerminalInput value={search} onChange={setSearch} placeholder="FIND CONTRACT…" width="10rem" />
        <TerminalSelect label={dept ? `DEPT: ${dept}` : 'DEPT: ALL'} value={dept}
          onChange={setDept}
          options={[{ value: '', label: 'All departments' }, ...departments.map(d => ({ value: d, label: d }))]} />
        <TerminalSelect label={supplier ? `SUPPLIER: ${supplier.slice(0, 12)}` : 'SUPPLIER: ALL'} value={supplier}
          onChange={setSupplier}
          options={[{ value: '', label: 'All suppliers' }, ...suppliers.map(s => ({ value: s, label: s }))]} />
        <TerminalSelect label={`GROUP: ${groupBy.toUpperCase()}`} value={groupBy}
          onChange={v => setGroupBy(v as GroupBy)}
          options={[
            { value: 'none', label: 'No grouping' }, { value: 'department', label: 'By department' },
            { value: 'category', label: 'By category' }, { value: 'supplier', label: 'By supplier' },
            { value: 'owner', label: 'By owner' },
          ]} />
        <div className="flex items-center gap-1.5 text-[10px]" style={{ color: T.muted, fontFamily: T.mono }}>
          <span>MIN</span>
          <input type="range" min={0} max={maxSpend} step={1000} value={minValue}
            aria-label="Minimum annual value"
            onChange={e => setMinValue(parseInt(e.target.value))} className="w-20 accent-[#2FD3E6]" />
          <span className="tabular-nums w-14" style={{ color: minValue > 0 ? T.amber : T.muted }}>{fmtK(minValue)}</span>
        </div>

        <div className="flex-1" />

        <div className="flex items-center gap-0.5">
          <IconBtn label="Zoom in (+)" onClick={() => zoom(0.8)}><ZoomIn size={12} /></IconBtn>
          <IconBtn label="Zoom out (−)" onClick={() => zoom(1.25)}><ZoomOut size={12} /></IconBtn>
          <IconBtn label="Fit to data (F)" onClick={() => setWindow(fitWindow(contracts))}><Maximize2 size={12} /></IconBtn>
        </div>
      </div>

      {/* ─── Active chips ─── */}
      {chips.length > 0 && (
        <div className="flex items-center gap-1.5 px-3 py-1 flex-wrap flex-shrink-0"
          style={{ borderBottom: `1px solid ${T.hairline}` }}>
          {chips.map(c => <Chip key={c.label} label={c.label} onClear={c.onClear} hue={c.hue} />)}
        </div>
      )}

      {rows.length === 0 ? (
        <EmptyState title="Nothing expires in this window"
          hint="Zoom out, clear the filters, or press F to fit the whole register." />
      ) : (
        <div className="flex-1 overflow-auto min-h-0">
          <div style={{ minWidth: '840px' }}>

            {/* ─── Density header ─── */}
            <div className="flex items-stretch sticky top-0 z-20"
              style={{ background: T.ground, borderBottom: `1px solid ${T.hairline}` }}>
              <div className="flex-shrink-0 flex items-end px-3 pb-1" style={{ width: RAIL_W }}>
                <SectionLabel>EXPIRING VALUE / MONTH</SectionLabel>
              </div>
              <div className="relative flex-1 h-12" style={{ marginRight: ANNOT_W }}>
                {density.map(b => {
                  const maxV = Math.max(...density.map(x => x.value), 1)
                  const h = Math.max(3, (b.value / maxV) * 34)
                  const col = urgencyColor(b.soonestDays)
                  return (
                    <Tooltip key={b.label}
                      className="absolute"
                      style={{
                        left: `${b.startPct}%`, width: `calc(${b.widthPct}% - 2px)`,
                        bottom: 0, height: `${h}px`,
                      }}
                      content={<>{b.label} · {b.count} contract{b.count === 1 ? '' : 's'} · {fmtMoney(b.value)}</>}>
                      <button
                        aria-label={`Zoom to ${b.label}`}
                        onClick={() => setWindow({ start: b.start, end: b.end })}
                        className="w-full h-full cursor-pointer hover:brightness-150"
                        style={{ background: col, opacity: 0.8 }} />
                    </Tooltip>
                  )
                })}
                {/* Month axis */}
                {ticks.map((t, i) => (
                  <div key={i} className="absolute top-0 flex items-start"
                    style={{ left: `${t.pct}%` }}>
                    <span className="text-[8px] pl-1 whitespace-nowrap tracking-wider"
                      style={{ color: t.major ? T.muted : T.faint, fontFamily: T.mono }}>{t.label}</span>
                  </div>
                ))}
                {nowPct >= 0 && nowPct <= 100 && (
                  <div className="absolute top-0 bottom-0" style={{ left: `${nowPct}%` }}>
                    <span className="text-[8px] font-bold px-1 -translate-x-1/2 inline-block whitespace-nowrap"
                      style={{ background: T.cyan, color: T.ground, fontFamily: T.mono }}>TODAY</span>
                  </div>
                )}
              </div>
            </div>

            {/* ─── Decision lane ─── */}
            {points.length > 0 && (
              <div className="flex items-stretch" style={{ borderBottom: `1px solid ${T.hairline}` }}>
                <div className="flex-shrink-0 flex items-center px-3 py-2" style={{ width: RAIL_W }}>
                  <SectionLabel color={T.amber}>DECISION POINTS</SectionLabel>
                </div>
                <div className="relative flex-1" style={{ marginRight: ANNOT_W, height: '30px' }}>
                  {points.map((p, i) => {
                    const col = p.missed ? T.red : urgencyColor(
                      Math.round((p.row.noticeDate!.getTime() - Date.now()) / 86400000))
                    return (
                      <Tooltip key={p.row.contract.id + i}
                        className="absolute"
                        style={{
                          left: `${p.pct}%`, top: `${7 + (i % 2) * 9}px`,
                          width: '11px', height: '11px', marginLeft: '-5.5px',
                        }}
                        content={<>{p.row.contract.name} · {p.row.contract.supplier} · notice by {fmtDate(p.row.noticeDate)} · {fmtMoney(p.row.contract.annualValue)}</>}>
                        <button
                          aria-label={`Notice deadline for ${p.row.contract.name}`}
                          onClick={() => setExpanded(x => x === p.row.contract.id ? null : p.row.contract.id)}
                          className="w-full h-full cursor-pointer hover:brightness-150"
                          style={{
                            background: p.missed ? 'transparent' : col,
                            border: `2px solid ${col}`,
                            transform: 'rotate(45deg)',
                          }} />
                      </Tooltip>
                    )
                  })}
                </div>
              </div>
            )}

            {/* ─── Rows ─── */}
            <div ref={trackRef}
              onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}>
              {groups.map(g => (
                <div key={g.name || 'all'}>
                  {g.name && (
                    <div className="flex items-center gap-2 px-3 py-1"
                      style={{ background: T.panelRaised, borderBottom: `1px solid ${T.hairline}` }}>
                      <span className="text-[10px] font-semibold tracking-wider" style={{ color: T.dim, fontFamily: T.mono }}>
                        {g.name.toUpperCase()}
                      </span>
                      <span className="text-[9px] tabular-nums" style={{ color: T.muted, fontFamily: T.mono }}>
                        {g.rows.length} · {fmtK(g.rows.reduce((s, r) => s + (r.contract.annualValue ?? 0), 0))}
                      </span>
                    </div>
                  )}
                  {g.rows.map(r => (
                    <Row key={r.contract.id} row={r} ticks={ticks} nowPct={nowPct}
                      expanded={expanded === r.contract.id}
                      focused={visible[focusRow]?.contract.id === r.contract.id}
                      onToggle={() => setExpanded(x => x === r.contract.id ? null : r.contract.id)} />
                  ))}
                </div>
              ))}

              {/* Overdue band — collapsed by default so it cannot drown the future. */}
              {parts.overdue.length > 0 && (
                <button onClick={() => setShowOverdue(v => !v)}
                  className="w-full flex items-center gap-2 px-3 py-2 cursor-pointer hover:brightness-125"
                  style={{ background: 'rgba(255,77,77,0.07)', borderTop: `1px solid ${T.hairline}`, borderBottom: `1px solid ${T.hairline}` }}>
                  {showOverdue ? <ChevronDown size={12} color={T.red} /> : <ChevronRight size={12} color={T.red} />}
                  <span className="text-[10px] font-semibold tracking-wider" style={{ color: T.red, fontFamily: T.mono }}>
                    {parts.overdue.length} EXPIRED · {fmtK(missedValue)}
                  </span>
                  <span className="text-[9px]" style={{ color: T.muted, fontFamily: T.mono }}>
                    {showOverdue ? 'hide' : 'already past their end date — expand to review'}
                  </span>
                </button>
              )}
            </div>

            {/* Contracts that cannot be placed on a timeline at all. */}
            {undated.length > 0 && (
              <div className="mx-3 my-3 p-3 rounded-sm" style={{ background: T.panel, border: `1px solid ${T.hairline}` }}>
                <div className="flex items-center gap-2">
                  <AlertTriangle size={12} color={T.amber} />
                  <span className="text-[10px] font-semibold tracking-wider" style={{ color: T.amber, fontFamily: T.mono }}>
                    {undated.length} WITHOUT AN END DATE · {fmtK(undated.reduce((s, c) => s + (c.annualValue ?? 0), 0))}
                  </span>
                  <span className="text-[9px]" style={{ color: T.muted }}>cannot be placed on a timeline</span>
                </div>
                <div className="flex flex-wrap gap-1 mt-2">
                  {undated.slice(0, 24).map(c => (
                    <span key={c.id} className="text-[9px] px-1.5 py-0.5"
                      style={{ background: T.ground, border: `1px solid ${T.hairline}`, color: T.muted, fontFamily: T.mono }}>
                      {c.name}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="px-3 py-1 flex-shrink-0 text-[9px] tracking-wider"
        style={{ color: T.faint, fontFamily: T.mono, borderTop: `1px solid ${T.hairline}` }}>
        SCROLL TO ZOOM · DRAG TO PAN · ↑↓ ROW · ENTER EXPAND · G GROUP · F FIT
      </div>
    </div>
  )
}

function IconBtn({ children, label, onClick }: { children: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <Tooltip content={label}>
      <button onClick={onClick} aria-label={label}
        className="p-1 cursor-pointer transition-colors hover:brightness-150"
        style={{ color: T.muted }}>
        {children}
      </button>
    </Tooltip>
  )
}

/* ─── One timeline row ─── */

function Row({ row, ticks, nowPct, expanded, focused, onToggle }: {
  row: TimelineRow
  ticks: { pct: number; major: boolean }[]
  nowPct: number
  expanded: boolean
  focused: boolean
  onToggle: () => void
}) {
  const c = row.contract
  const color = urgencyColor(row.daysUntil, row.overdue)
  const width = Math.max(row.barEndPct - row.barStartPct, 0.4)
  const noticeLeft = row.noticeStartPct
  const noticeWidth = noticeLeft !== undefined ? Math.max(row.barEndPct - noticeLeft, 0) : 0
  const flip = row.barEndPct > 80

  return (
    <div>
      <div
        role="button" tabIndex={0} onClick={onToggle}
        onKeyDown={e => { if (e.key === 'Enter') onToggle() }}
        className="w-full flex items-stretch text-left cursor-pointer transition-colors hover:bg-[#0B1322]"
        style={{
          borderBottom: `1px solid ${T.panel}`,
          background: expanded ? T.panelRaised : focused ? 'rgba(47,211,230,0.06)' : 'transparent',
          borderLeft: focused ? `2px solid ${T.cyan}` : '2px solid transparent',
        }}>
        {/* Rail */}
        <div className="flex-shrink-0 px-3 py-1.5 overflow-hidden" style={{ width: RAIL_W - 2 }}>
          <div className="text-[11px] truncate leading-tight" style={{ color: T.text }}>{c.name}</div>
          <div className="text-[9px] truncate" style={{ color: T.muted, fontFamily: T.mono }}>
            {c.supplier} · {fmtK(c.annualValue ?? 0)}
          </div>
        </div>

        {/* Track */}
        <div className="relative flex-1 my-1.5" style={{ minHeight: `${ROW_H - 12}px`, marginRight: ANNOT_W }}>
          {ticks.map((t, i) => (
            <div key={i} className="absolute top-0 bottom-0"
              style={{ left: `${t.pct}%`, width: '1px', background: t.major ? T.hairline : '#0C1523' }} />
          ))}
          {nowPct >= 0 && nowPct <= 100 && (
            <div className="absolute top-0 bottom-0"
              style={{ left: `${nowPct}%`, width: '1px', background: 'rgba(47,211,230,0.5)' }} />
          )}

          {/* Term bar. An unknown start fades in from the left instead of
              pretending the term began at the window edge. */}
          <div className="absolute"
            style={{
              left: `${row.barStartPct}%`, width: `${width}%`,
              top: '4px', height: '8px',
              background: row.unknownStart
                ? `linear-gradient(90deg, transparent 0%, ${color}55 22%, ${color}55 100%)`
                : `${color}55`,
              borderLeft: row.unknownStart || row.offScale ? 'none' : `1px solid ${color}`,
              borderRight: `2px solid ${color}`,
            }} />

          {noticeLeft !== undefined && noticeWidth > 0 && (
            <div className="absolute"
              style={{
                left: `${noticeLeft}%`, width: `${noticeWidth}%`, top: '4px', height: '8px',
                background: `repeating-linear-gradient(45deg, ${color}95 0 3px, transparent 3px 6px)`,
              }} />
          )}

          {/* The decision mark, drawn above everything. */}
          {noticeLeft !== undefined && (
            <div className="absolute"
              style={{
                left: `${noticeLeft}%`, top: '3px', width: '10px', height: '10px', marginLeft: '-5px',
                background: row.silentRenewalRisk ? 'transparent' : color,
                border: `2px solid ${row.silentRenewalRisk ? T.red : color}`,
                transform: 'rotate(45deg)', zIndex: 2,
              }} />
          )}

          <div className="absolute flex items-center gap-1 whitespace-nowrap"
            style={{
              left: `${row.barEndPct}%`, top: '1px',
              transform: flip ? 'translateX(-100%)' : 'none',
              paddingLeft: flip ? 0 : '9px', paddingRight: flip ? '9px' : 0,
            }}>
            {row.silentRenewalRisk && <RefreshCw size={9} color={T.red} />}
            <span className="text-[10px] tabular-nums" style={{ color, fontFamily: T.mono }}>
              {annotate(row)}
            </span>
          </div>
        </div>
      </div>

      {expanded && (
        <div className="flex" style={{ background: T.panelRaised, borderBottom: `1px solid ${T.hairline}` }}>
          <div className="flex-shrink-0" style={{ width: RAIL_W }} />
          <div className="flex-1 px-3 py-2">
            <div className="grid grid-cols-4 gap-3 mb-2">
              <Detail label="Start" value={row.unknownStart ? 'not recorded' : fmtDate(c.startDate)} warn={row.unknownStart} />
              <Detail label="End" value={fmtDate(c.endDate)} />
              <Detail label="Notice by" value={row.noticeDate ? fmtDate(row.noticeDate) : '—'} />
              <Detail label="Auto-renew" value={c.autoRenew === true ? 'Yes' : c.autoRenew === false ? 'No' : '—'} />
              <Detail label="Annual value" value={fmtMoney(c.annualValue)} />
              <div>
                <SectionLabel>Supplier</SectionLabel>
                <div className="text-[10px] mt-0.5"><EntityLink type="supplier" name={c.supplier} /></div>
              </div>
              <div>
                <SectionLabel>Department</SectionLabel>
                <div className="text-[10px] mt-0.5"><EntityLink type="department" name={c.department} /></div>
              </div>
              <div>
                <SectionLabel>Owner</SectionLabel>
                <div className="text-[10px] mt-0.5">
                  {c.owner ? <EntityLink type="owner" name={c.owner} />
                    : <span style={{ color: T.amber }}>⚠ none</span>}
                </div>
              </div>
            </div>
            {row.silentRenewalRisk && (
              <div className="text-[10px] flex items-center gap-1.5 mb-2" style={{ color: T.red }}>
                <RefreshCw size={10} /> Notice window has closed — this contract renews automatically.
              </div>
            )}
            <button onClick={e => { e.stopPropagation(); downloadICS([row], `${c.name.replace(/\W+/g, '-')}.ics`) }}
              className="text-[9px] px-2 py-0.5 tracking-wider cursor-pointer"
              style={{ fontFamily: T.mono, color: T.cyan, border: `1px solid ${T.hairline}` }}>
              ADD THIS TO CALENDAR
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function Detail({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div>
      <SectionLabel>{label}</SectionLabel>
      <div className="text-[10px] mt-0.5 tabular-nums"
        style={{ color: warn ? T.amber : T.dim, fontFamily: T.mono }}>{value}</div>
    </div>
  )
}
