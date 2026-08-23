import { useMemo, useState } from 'react'
import { useDataStore } from '../../store/dataStore'
import type { Contract } from '../../data/types'

function fmtMoney(v?: number) { return v === undefined ? '—' : '€' + Math.round(v).toLocaleString('en-US') }
function fmtDate(d: Date) { return d.toISOString().slice(0, 10) }

interface CalendarEntry {
  contract: Contract
  actionDate: Date
  endDate: Date
  isNoticeDeadline: boolean
  overdue: boolean
  daysUntil: number
}

function buildCalendar(contracts: Contract[]): CalendarEntry[] {
  const now = new Date()
  const entries: CalendarEntry[] = []
  for (const c of contracts) {
    if (!c.endDate) continue
    const daysToEnd = Math.round((c.endDate.getTime() - now.getTime()) / 86400000)
    if (c.noticePeriodDays && c.noticePeriodDays > 0) {
      const noticeDate = new Date(c.endDate.getTime() - c.noticePeriodDays * 86400000)
      const daysToNotice = Math.round((noticeDate.getTime() - now.getTime()) / 86400000)
      entries.push({
        contract: c, actionDate: noticeDate, endDate: c.endDate,
        isNoticeDeadline: true, overdue: daysToNotice < 0, daysUntil: daysToNotice,
      })
    }
    entries.push({
      contract: c, actionDate: c.endDate, endDate: c.endDate,
      isNoticeDeadline: false, overdue: daysToEnd < 0, daysUntil: daysToEnd,
    })
  }
  return entries.sort((a, b) => a.actionDate.getTime() - b.actionDate.getTime())
}

function groupByMonth(entries: CalendarEntry[]): Map<string, CalendarEntry[]> {
  const groups = new Map<string, CalendarEntry[]>()
  for (const e of entries) {
    const key = `${e.actionDate.getFullYear()}-${String(e.actionDate.getMonth() + 1).padStart(2, '0')}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(e)
  }
  return groups
}

function toICS(entries: CalendarEntry[]): string {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//ProcurementWeb//Renewal Calendar//EN']
  for (const e of entries) {
    const d = e.actionDate
    const ds = `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`
    lines.push('BEGIN:VEVENT')
    lines.push(`DTSTART;VALUE=DATE:${ds}`)
    lines.push(`DTEND;VALUE=DATE:${ds}`)
    lines.push(`SUMMARY:${e.isNoticeDeadline ? '⚠ Notice deadline' : 'Contract expiry'}: ${e.contract.name}`)
    lines.push(`DESCRIPTION:Supplier: ${e.contract.supplier}\\nDepartment: ${e.contract.department}\\nValue: ${fmtMoney(e.contract.annualValue)}\\nEnd date: ${fmtDate(e.endDate)}`)
    lines.push(`UID:${e.contract.id}-${e.isNoticeDeadline ? 'notice' : 'end'}@procurementweb`)
    lines.push('END:VEVENT')
  }
  lines.push('END:VCALENDAR')
  return lines.join('\r\n')
}

export default function CalendarScreen() {
  const contracts = useDataStore(s => s.getContracts())
  const [filter, setFilter] = useState<'all' | 'upcoming' | 'overdue'>('upcoming')

  const allEntries = useMemo(() => buildCalendar(contracts), [contracts])

  const filtered = allEntries.filter(e => {
    if (filter === 'upcoming') return e.daysUntil >= 0 && e.daysUntil <= 365
    if (filter === 'overdue') return e.overdue
    return true
  })

  const grouped = useMemo(() => groupByMonth(filtered), [filtered])

  const exportICS = () => {
    const blob = new Blob([toICS(filtered)], { type: 'text/calendar' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = 'procurement-renewals.ics'; a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold">Renewal calendar</h2>
          <p className="text-[#8fa0bd] text-sm mt-1">Contract end dates and notice deadlines</p>
        </div>
        <div className="flex gap-2">
          <select value={filter} onChange={e => setFilter(e.target.value as any)}
            className="bg-[#171e2e] border border-[#2a3650] rounded-lg px-3 py-1.5 text-sm text-white">
            <option value="upcoming">Upcoming (12 months)</option>
            <option value="overdue">Overdue</option>
            <option value="all">All</option>
          </select>
          <button onClick={exportICS} className="bg-[#4da3ff] text-[#08101f] font-semibold px-4 py-1.5 rounded-lg text-sm hover:brightness-110">
            Export ICS
          </button>
        </div>
      </div>

      {filtered.length === 0 && <p className="text-[#8fa0bd]">No entries match the current filter.</p>}

      {[...grouped.entries()].map(([month, entries]) => (
        <div key={month} className="mb-6">
          <h3 className="text-sm font-semibold text-[#8fa0bd] mb-2 sticky top-0 bg-[#0f1420] py-1 z-10">
            {new Date(month + '-01').toLocaleString('en-US', { month: 'long', year: 'numeric' })}
          </h3>
          <div className="space-y-2">
            {entries.map((e, i) => (
              <div key={`${e.contract.id}-${e.isNoticeDeadline}-${i}`}
                className={`bg-[#171e2e] border rounded-xl p-3 flex items-center gap-4 ${e.overdue ? 'border-red-500/40' : 'border-[#2a3650]'}`}>
                <div className={`w-2 h-2 rounded-full flex-shrink-0 ${e.overdue ? 'bg-red-400' : e.daysUntil <= 30 ? 'bg-amber-400' : 'bg-green-400'}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${e.isNoticeDeadline ? 'bg-amber-900/30 text-amber-400' : 'bg-[#1d2639] text-[#8fa0bd]'}`}>
                      {e.isNoticeDeadline ? 'Notice deadline' : 'Contract end'}
                    </span>
                    <span className="font-medium text-sm truncate">{e.contract.name}</span>
                  </div>
                  <div className="text-xs text-[#8fa0bd] mt-0.5">{e.contract.supplier} · {e.contract.department} · {fmtMoney(e.contract.annualValue)}</div>
                </div>
                <div className="text-right flex-shrink-0">
                  <div className="text-sm font-medium">{fmtDate(e.actionDate)}</div>
                  <div className={`text-xs ${e.overdue ? 'text-red-400' : e.daysUntil <= 30 ? 'text-amber-400' : 'text-[#8fa0bd]'}`}>
                    {e.overdue ? `${-e.daysUntil}d overdue` : `in ${e.daysUntil}d`}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
