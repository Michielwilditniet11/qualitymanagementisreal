import { useMemo, useState } from 'react'
import { useDataStore } from '../../store/dataStore'
import type { Contract } from '../../data/types'
import {
  timelineWindow, timelineRows, monthTicks, todayPct, annotate, urgencyColor,
  type WindowPreset, type TimelineRow,
} from '../../analytics/timeline'
import { fmtK } from '../../analytics/risk'
import { AlertTriangle, RefreshCw } from 'lucide-react'

function fmtMoney(v?: number) { return v === undefined ? '—' : '€' + Math.round(v).toLocaleString('en-US') }
function fmtDate(d?: Date) { return d ? d.toISOString().slice(0, 10) : '—' }

type GroupBy = 'none' | 'department' | 'category'

const PRESETS: { id: WindowPreset; label: string }[] = [
  { id: 'next12', label: 'Next 12 months' },
  { id: 'next90', label: 'Next 90 days' },
  { id: 'overdue', label: 'Overdue' },
  { id: 'all', label: 'All' },
]

/* ─── ICS export (unchanged semantics: end dates plus notice deadlines) ─── */

function toICS(rows: TimelineRow[]): string {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//ProcurementWeb//Renewal Calendar//EN']
  const event = (d: Date, summary: string, c: Contract, uid: string) => {
    const ds = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
    lines.push('BEGIN:VEVENT')
    lines.push(`DTSTART;VALUE=DATE:${ds}`)
    lines.push(`DTEND;VALUE=DATE:${ds}`)
    lines.push(`SUMMARY:${summary}: ${c.name}`)
    lines.push(`DESCRIPTION:Supplier: ${c.supplier}\\nDepartment: ${c.department}\\nValue: ${fmtMoney(c.annualValue)}\\nEnd date: ${fmtDate(c.endDate)}`)
    lines.push(`UID:${uid}@procurementweb`)
    lines.push('END:VEVENT')
  }
  for (const r of rows) {
    if (r.noticeDate) event(r.noticeDate, '⚠ Notice deadline', r.contract, `${r.contract.id}-notice`)
    event(r.contract.endDate!, 'Contract expiry', r.contract, `${r.contract.id}-end`)
  }
  lines.push('END:VCALENDAR')
  return lines.join('\r\n')
}

/* ─── Screen ─── */

export default function CalendarScreen() {
  const contracts = useDataStore(s => s.getContracts())
  const [preset, setPreset] = useState<WindowPreset>('next12')
  const [groupBy, setGroupBy] = useState<GroupBy>('none')
  const [expanded, setExpanded] = useState<string | null>(null)

  const window_ = useMemo(() => timelineWindow(contracts, preset), [contracts, preset])
  const rows = useMemo(() => timelineRows(contracts, window_), [contracts, window_])
  const ticks = useMemo(() => monthTicks(window_), [window_])
  const nowPct = useMemo(() => todayPct(window_), [window_])

  const undated = useMemo(() => contracts.filter(c => !c.endDate), [contracts])

  const groups = useMemo(() => {
    if (groupBy === 'none') return [{ name: '', rows }]
    const m = new Map<string, TimelineRow[]>()
    for (const r of rows) {
      const k = (groupBy === 'department' ? r.contract.department : r.contract.category) || '(unassigned)'
      if (!m.has(k)) m.set(k, [])
      m.get(k)!.push(r)
    }
    return [...m.entries()]
      .map(([name, rs]) => ({ name, rows: rs }))
      .sort((a, b) =>
        b.rows.reduce((s, r) => s + (r.contract.annualValue ?? 0), 0) -
        a.rows.reduce((s, r) => s + (r.contract.annualValue ?? 0), 0))
  }, [rows, groupBy])

  const exportICS = () => {
    const blob = new Blob([toICS(rows)], { type: 'text/calendar' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = 'procurement-renewals.ics'; a.click()
    URL.revokeObjectURL(url)
  }

  const totalExpiring = rows.reduce((s, r) => s + (r.contract.annualValue ?? 0), 0)

  return (
    <div className="flex-1 flex flex-col min-h-0 min-w-0">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 px-6 py-3 border-b flex-wrap"
        style={{ borderColor: '#1E293B' }}>
        <div>
          <h2 className="text-lg font-bold">Renewal timeline</h2>
          <p className="text-xs mt-0.5" style={{ color: '#64748B' }}>
            {rows.length} contract{rows.length === 1 ? '' : 's'} expiring in view · {fmtK(totalExpiring)}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex rounded-lg overflow-hidden" style={{ border: '1px solid #1E293B' }}>
            {PRESETS.map(p => (
              <button key={p.id} onClick={() => setPreset(p.id)}
                className="px-2.5 py-1 text-[11px] cursor-pointer transition-colors"
                style={{
                  background: preset === p.id ? '#1E293B' : 'transparent',
                  color: preset === p.id ? '#F1F5F9' : '#64748B',
                }}>
                {p.label}
              </button>
            ))}
          </div>
          <select value={groupBy} onChange={e => setGroupBy(e.target.value as GroupBy)}
            className="rounded-lg px-2 py-1 text-[11px] text-white"
            style={{ background: '#0A0F1A', border: '1px solid #1E293B' }}>
            <option value="none">No grouping</option>
            <option value="department">By department</option>
            <option value="category">By category</option>
          </select>
          <button onClick={exportICS}
            className="font-semibold px-3 py-1 rounded-lg text-[11px] cursor-pointer hover:brightness-110"
            style={{ background: '#4da3ff', color: '#08101f' }}>
            Export ICS
          </button>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-sm" style={{ color: '#64748B' }}>
            No contracts expire in this window.
          </p>
        </div>
      ) : (
        <div className="flex-1 overflow-auto min-h-0">
          <div style={{ minWidth: '760px' }}>
            {/* Month axis */}
            <div className="sticky top-0 z-20 flex" style={{ background: '#0f1420', borderBottom: '1px solid #1E293B' }}>
              <div className="flex-shrink-0" style={{ width: RAIL_W }} />
              <div className="relative flex-1 h-7" style={{ marginRight: ANNOT_W }}>
                {ticks.map((t, i) => (
                  <div key={i} className="absolute top-0 bottom-0 flex items-end pb-1"
                    style={{ left: `${t.pct}%` }}>
                    <span className="text-[9px] pl-1 whitespace-nowrap"
                      style={{ color: t.major ? '#94A3B8' : '#475569' }}>
                      {t.label}
                    </span>
                  </div>
                ))}
                {nowPct >= 0 && nowPct <= 100 && (
                  <div className="absolute top-0 bottom-0 flex items-start"
                    style={{ left: `${nowPct}%` }}>
                    <span className="text-[8px] font-semibold px-1 rounded-b -translate-x-1/2 whitespace-nowrap"
                      style={{ background: '#38BDF8', color: '#04121F' }}>
                      today
                    </span>
                  </div>
                )}
              </div>
            </div>

            {groups.map(g => (
              <div key={g.name || 'all'}>
                {g.name && (
                  <div className="flex items-center gap-2 px-6 py-1.5 sticky z-10"
                    style={{ top: '28px', background: '#0B1120', borderBottom: '1px solid #1E293B' }}>
                    <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: '#94A3B8' }}>
                      {g.name}
                    </span>
                    <span className="text-[10px]" style={{ color: '#475569' }}>
                      {g.rows.length} · {fmtK(g.rows.reduce((s, r) => s + (r.contract.annualValue ?? 0), 0))}
                    </span>
                  </div>
                )}
                {g.rows.map(r => (
                  <TimelineBar key={r.contract.id} row={r} nowPct={nowPct}
                    ticks={ticks}
                    expanded={expanded === r.contract.id}
                    onToggle={() => setExpanded(expanded === r.contract.id ? null : r.contract.id)} />
                ))}
              </div>
            ))}

            {undated.length > 0 && (
              <div className="mx-6 my-4 rounded-lg p-3" style={{ background: '#0A0F1A', border: '1px solid #1E293B' }}>
                <div className="flex items-center gap-2">
                  <AlertTriangle size={12} color="#D97706" />
                  <span className="text-[11px] font-semibold" style={{ color: '#D97706' }}>
                    {undated.length} contract{undated.length === 1 ? '' : 's'} without an end date
                  </span>
                  <span className="text-[10px]" style={{ color: '#64748B' }}>
                    · {fmtK(undated.reduce((s, c) => s + (c.annualValue ?? 0), 0))} · cannot be placed on a timeline
                  </span>
                </div>
                <div className="flex flex-wrap gap-1 mt-2">
                  {undated.slice(0, 20).map(c => (
                    <span key={c.id} className="text-[9px] px-1.5 py-0.5 rounded"
                      style={{ background: '#0F172A', border: '1px solid #1E293B', color: '#94A3B8' }}>
                      {c.name}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

const RAIL_W = '210px'
/** Right gutter so a bar ending at 100% still has room for its annotation. */
const ANNOT_W = '120px'

function TimelineBar({ row, nowPct, ticks, expanded, onToggle }: {
  row: TimelineRow
  nowPct: number
  ticks: { pct: number; major: boolean }[]
  expanded: boolean
  onToggle: () => void
}) {
  const c = row.contract
  const color = urgencyColor(row)
  const width = Math.max(row.barEndPct - row.barStartPct, 0.4)
  const noticeLeft = row.noticeStartPct
  const noticeWidth = noticeLeft !== undefined ? Math.max(row.barEndPct - noticeLeft, 0) : 0
  const flipAnnotation = row.barEndPct > 82

  return (
    <div>
      <button onClick={onToggle}
        className="w-full flex items-stretch text-left cursor-pointer hover:bg-[#0F172A] transition-colors"
        style={{ borderBottom: '1px solid #0F172A' }}
        title={`${c.name}\n${c.supplier} · ${c.department}\nEnds ${fmtDate(c.endDate)}${row.noticeDate ? `\nNotice by ${fmtDate(row.noticeDate)}` : ''}\n${fmtMoney(c.annualValue)}`}>
        {/* Left rail */}
        <div className="flex-shrink-0 px-3 py-1.5 overflow-hidden" style={{ width: RAIL_W }}>
          <div className="text-[11px] text-white truncate leading-tight">{c.name}</div>
          <div className="text-[9px] truncate" style={{ color: '#64748B' }}>
            {c.supplier} · {fmtK(c.annualValue ?? 0)}
          </div>
        </div>

        {/* Track — right gutter matches the axis so gridlines stay aligned */}
        <div className="relative flex-1 my-1.5" style={{ minHeight: '22px', marginRight: ANNOT_W }}>
          {/* Gridlines */}
          {ticks.map((t, i) => (
            <div key={i} className="absolute top-0 bottom-0"
              style={{ left: `${t.pct}%`, width: '1px', background: t.major ? '#1E293B' : '#131C2B' }} />
          ))}
          {/* Today */}
          {nowPct >= 0 && nowPct <= 100 && (
            <div className="absolute top-0 bottom-0"
              style={{ left: `${nowPct}%`, width: '1px', background: 'rgba(56,189,248,0.55)' }} />
          )}

          {/* Term bar */}
          <div className="absolute rounded-sm"
            style={{
              left: `${row.barStartPct}%`, width: `${width}%`,
              top: '5px', height: '12px',
              background: `${color}55`,
              borderLeft: row.offScale ? 'none' : `1px solid ${color}`,
              borderRight: `2px solid ${color}`,
            }} />

          {/* Notice window — the tail you must act before */}
          {noticeLeft !== undefined && noticeWidth > 0 && (
            <div className="absolute"
              style={{
                left: `${noticeLeft}%`, width: `${noticeWidth}%`,
                top: '5px', height: '12px',
                background: `repeating-linear-gradient(45deg, ${color}90 0 3px, transparent 3px 6px)`,
              }} />
          )}

          {/* Notice deadline marker */}
          {noticeLeft !== undefined && (
            <div className="absolute"
              style={{
                left: `${noticeLeft}%`, top: '7px',
                width: '8px', height: '8px',
                marginLeft: '-4px',
                background: row.silentRenewalRisk ? '#DC2626' : color,
                transform: 'rotate(45deg)',
              }} />
          )}

          {/* Annotation sits at the bar end, flipping inside when close to the
              right edge so it never runs off the track. */}
          <div className="absolute flex items-center gap-1 whitespace-nowrap"
            style={{
              left: `${row.barEndPct}%`, top: '3px',
              transform: flipAnnotation ? 'translateX(-100%)' : 'none',
              paddingLeft: flipAnnotation ? 0 : '8px',
              paddingRight: flipAnnotation ? '8px' : 0,
            }}>
            {row.silentRenewalRisk && <RefreshCw size={10} color="#DC2626" />}
            <span className="text-[10px] tabular-nums" style={{ color }}>
              {annotate(row)}
            </span>
          </div>
        </div>
      </button>

      {expanded && (
        <div className="flex" style={{ background: '#0A0F1A', borderBottom: '1px solid #1E293B' }}>
          <div className="flex-shrink-0" style={{ width: RAIL_W }} />
          <div className="flex-1 px-3 py-2 grid grid-cols-4 gap-3">
            <Detail label="Start" value={fmtDate(c.startDate)} />
            <Detail label="End" value={fmtDate(c.endDate)} />
            <Detail label="Notice by" value={row.noticeDate ? fmtDate(row.noticeDate) : '—'} />
            <Detail label="Auto-renew" value={c.autoRenew === true ? 'Yes' : c.autoRenew === false ? 'No' : '—'} />
            <Detail label="Department" value={c.department || '—'} />
            <Detail label="Category" value={c.category || '—'} />
            <Detail label="Owner" value={c.owner || '⚠ none'} warn={!c.owner} />
            <Detail label="Annual value" value={fmtMoney(c.annualValue)} />
            {row.silentRenewalRisk && (
              <div className="col-span-4 text-[10px] flex items-center gap-1.5" style={{ color: '#DC2626' }}>
                <RefreshCw size={10} />
                Notice window has closed — this contract renews automatically.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function Detail({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div>
      <div className="text-[8px] uppercase tracking-wider" style={{ color: '#475569' }}>{label}</div>
      <div className="text-[10px]" style={{ color: warn ? '#D97706' : '#CBD5E1' }}>{value}</div>
    </div>
  )
}
