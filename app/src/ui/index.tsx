import { useState, useRef, Fragment, type ReactNode, type CSSProperties } from 'react'
import { T } from './theme'
import { useUIStore } from '../store/uiStore'
import { nextSort, sortRows, type SortState } from './sort'
import { NODE_COLORS } from '../graph/buildGraph'
import { X, ChevronUp, ChevronDown, ExternalLink } from 'lucide-react'

export * from './theme'
export * from './format'
export * from './sort'

/* ─── Surfaces ─── */

export function Panel({ children, className = '', style, raised }: {
  children: ReactNode; className?: string; style?: CSSProperties; raised?: boolean
}) {
  return (
    <div className={`rounded-sm ${className}`}
      style={{
        background: raised ? T.panelRaised : T.panel,
        border: `1px solid ${T.hairline}`,
        ...style,
      }}>
      {children}
    </div>
  )
}

export function SectionLabel({ children, color = T.muted }: { children: ReactNode; color?: string }) {
  return (
    <div className="text-[9px] tracking-[0.18em] uppercase" style={{ color, fontFamily: T.mono }}>
      {children}
    </div>
  )
}

/** Ticker cell — the terminal's headline figure. */
export function Tick({ label, value, sub, color = T.text, onClick, title }: {
  label: string; value: string; sub?: string; color?: string
  onClick?: () => void; title?: string
}) {
  const Cmp: any = onClick ? 'button' : 'div'
  return (
    <Cmp onClick={onClick} aria-label={title ?? label}
      className={`px-3.5 py-1.5 text-left flex-shrink-0 transition-colors ${onClick ? 'cursor-pointer hover:bg-[#0B1322]' : ''}`}
      style={{ borderRight: `1px solid ${T.hairline}`, fontFamily: T.mono }}>
      <span className="text-[8px] tracking-[0.18em] block" style={{ color: T.muted }}>{label}</span>
      <span className="text-[13px] font-bold tabular-nums leading-tight" style={{ color }}>
        {value}
        {sub && <span className="text-[9px] font-normal ml-1" style={{ color: T.muted }}>{sub}</span>}
      </span>
    </Cmp>
  )
}

/** Removable state chip. */
export function Chip({ label, onClear, hue, onClick, active }: {
  label: string; onClear?: () => void; hue?: string
  onClick?: () => void; active?: boolean
}) {
  const color = hue ?? T.muted
  return (
    <button onClick={onClear ?? onClick}
      className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[9px] tracking-wider cursor-pointer group transition-colors"
      style={{
        fontFamily: T.mono, color: active ? T.ground : color,
        border: `1px solid ${color}`,
        background: active ? color : T.panel,
      }}>
      {label}
      {onClear && <X size={8} className="opacity-50 group-hover:opacity-100" />}
    </button>
  )
}

/** A native select disguised as a terminal control. */
export function TerminalSelect({ label, value, options, onChange }: {
  label: string; value: string
  options: { value: string; label: string }[]
  onChange: (v: string) => void
}) {
  return (
    <div className="relative flex-shrink-0">
      <select value={value} onChange={e => onChange(e.target.value)}
        className="absolute inset-0 opacity-0 cursor-pointer w-full"
        aria-label={label}>
        <option value="" disabled hidden>{label}</option>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <div className="px-2 py-0.5 text-[10px] tracking-wider pointer-events-none whitespace-nowrap"
        style={{ fontFamily: T.mono, color: T.muted, border: `1px solid ${T.hairline}`, background: T.ground }}>
        {label} ▾
      </div>
    </div>
  )
}

/** Terminal text input. */
export function TerminalInput({ value, onChange, placeholder, width = '9rem' }: {
  value: string; onChange: (v: string) => void; placeholder: string; width?: string
}) {
  return (
    <input type="text" placeholder={placeholder} value={value}
      onChange={e => onChange(e.target.value)} aria-label={placeholder}
      className="px-2 py-0.5 text-[10px] tracking-wider"
      style={{
        fontFamily: T.mono, background: T.ground, color: T.text,
        border: `1px solid ${T.hairline}`, outline: 'none', width,
      }} />
  )
}

/* ─── Tooltip ─── */

/**
 * Hover card replacing native `title` attributes, which are slow, unstyled
 * and inaccessible to keyboard users.
 */
export function Tooltip({ children, content, side = 'top', className = '', style }: {
  children: ReactNode; content: ReactNode; side?: 'top' | 'bottom'
  /** Applied to the wrapper, so a tooltipped element can itself be
   *  absolutely positioned by its parent without the wrapper stealing the
   *  containing block. */
  className?: string; style?: CSSProperties
}) {
  const [open, setOpen] = useState(false)
  return (
    <span className={`inline-flex ${className || 'relative'}`} style={style}
      onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)} onBlur={() => setOpen(false)}>
      {children}
      {open && (
        <span className="absolute z-50 px-2 py-1 rounded-sm pointer-events-none whitespace-nowrap"
          style={{
            [side === 'top' ? 'bottom' : 'top']: 'calc(100% + 6px)',
            left: '50%', transform: 'translateX(-50%)',
            background: 'rgba(4,7,14,0.97)', border: `1px solid ${T.hairlineBright}`,
            fontFamily: T.mono, fontSize: '10px', color: T.dim,
            boxShadow: '0 4px 16px rgba(0,0,0,0.6)',
          }}>
          {content}
        </span>
      )}
    </span>
  )
}

/* ─── Entity link ─── */

/** Any entity name, anywhere, jumps into the Spider Web with it selected. */
export function EntityLink({ type, name, color, showIcon = true }: {
  type: 'supplier' | 'category' | 'department' | 'owner' | 'contract'
  name: string; color?: string; showIcon?: boolean
}) {
  const inspectInWeb = useUIStore(s => s.inspectInWeb)
  const hue = color ?? NODE_COLORS[type] ?? T.cyan
  return (
    <button onClick={e => { e.stopPropagation(); inspectInWeb({ type, name }) }}
      title={`Inspect ${name} in the Spider Web`}
      className="inline-flex items-center gap-1 cursor-pointer hover:underline max-w-full"
      style={{ color: hue }}>
      <span style={{
        width: '5px', height: '5px', borderRadius: '50%',
        background: hue, flexShrink: 0, display: 'inline-block',
      }} />
      <span className="truncate">{name}</span>
      {showIcon && <ExternalLink size={9} className="flex-shrink-0 opacity-60" />}
    </button>
  )
}

/* ─── Empty state ─── */

export function EmptyState({ title, hint, icon }: {
  title: string; hint?: string; icon?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center py-10 px-6 text-center">
      {icon && <div style={{ color: T.faint }} className="mb-2">{icon}</div>}
      <div className="text-xs" style={{ color: T.dim }}>{title}</div>
      {hint && <div className="text-[10px] mt-1 max-w-xs" style={{ color: T.muted }}>{hint}</div>}
    </div>
  )
}

/* ─── Mini bar ─── */

export function MiniBar({ label, value, pct, color, sub }: {
  label: string; value: string; pct: number; color: string; sub?: string
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 mb-1">
        <span className="text-[11px]" style={{ color: T.text }}>{label}</span>
        <span className="text-[11px] tabular-nums whitespace-nowrap font-semibold"
          style={{ color, fontFamily: T.mono }}>{value}</span>
      </div>
      <div className="h-1.5 overflow-hidden" style={{ background: T.ground }}>
        <div className="h-full" style={{ width: `${Math.max(Math.min(pct, 100), 1)}%`, background: color }} />
      </div>
      {sub && <div className="text-[9px] mt-1" style={{ color: T.muted }}>{sub}</div>}
    </div>
  )
}

/* ─── Data table ─── */

export interface Column<T> {
  key: string
  header: string
  /** Value used for sorting; omit for non-sortable columns. */
  sortValue?: (row: T) => unknown
  render: (row: T) => ReactNode
  width?: string
  align?: 'left' | 'right'
}

/**
 * The one table style in the product: sticky mono header, sortable columns,
 * keyboard row focus, optional expansion.
 */
export function DataTable<T>({
  rows, columns, rowKey, onRowClick, expandedKey, renderExpanded,
  initialSort, maxHeight, emptyLabel = 'Nothing to show',
}: {
  rows: T[]
  columns: Column<T>[]
  rowKey: (row: T) => string
  onRowClick?: (row: T) => void
  expandedKey?: string | null
  renderExpanded?: (row: T) => ReactNode
  initialSort?: SortState
  maxHeight?: string
  emptyLabel?: string
}) {
  const [sort, setSort] = useState<SortState>(initialSort ?? { key: null, dir: 'desc' })
  const colByKey = useRef(new Map<string, Column<T>>())
  colByKey.current = new Map(columns.map(c => [c.key, c]))

  const sorted = sortRows(rows, sort, (row, key) => {
    const col = colByKey.current.get(key)
    return col?.sortValue ? col.sortValue(row) : undefined
  })

  if (rows.length === 0) return <EmptyState title={emptyLabel} />

  return (
    <div className="overflow-auto" style={{ maxHeight }}>
      <table className="w-full" style={{ fontFamily: T.mono, borderCollapse: 'collapse' }}>
        <thead className="sticky top-0 z-10">
          <tr style={{ background: T.ground }}>
            {columns.map(c => {
              const sortable = Boolean(c.sortValue)
              const active = sort.key === c.key
              return (
                <th key={c.key}
                  className={`text-[8px] tracking-[0.16em] uppercase font-semibold px-2.5 py-1.5 whitespace-nowrap ${sortable ? 'cursor-pointer' : ''}`}
                  style={{
                    color: active ? T.cyan : T.muted,
                    textAlign: c.align ?? 'left',
                    width: c.width,
                    borderBottom: `1px solid ${T.hairline}`,
                  }}
                  onClick={sortable ? () => setSort(s => nextSort(s, c.key)) : undefined}>
                  <span className="inline-flex items-center gap-1">
                    {c.header}
                    {active && (sort.dir === 'asc' ? <ChevronUp size={9} /> : <ChevronDown size={9} />)}
                  </span>
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.map(row => {
            const key = rowKey(row)
            const expanded = expandedKey === key
            return (
              <Fragment key={key}>
                <tr
                  tabIndex={onRowClick ? 0 : undefined}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  onKeyDown={onRowClick ? e => {
                    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onRowClick(row) }
                  } : undefined}
                  className={onRowClick ? 'cursor-pointer' : ''}
                  style={{
                    borderTop: `1px solid ${T.panel}`,
                    background: expanded ? T.panelRaised : 'transparent',
                  }}>
                  {columns.map(c => (
                    <td key={c.key} className="px-2.5 py-1.5 text-[11px]"
                      style={{ textAlign: c.align ?? 'left', color: T.dim }}>
                      {c.render(row)}
                    </td>
                  ))}
                </tr>
                {expanded && renderExpanded && (
                  <tr style={{ background: T.panelRaised }}>
                    <td colSpan={columns.length} className="px-3 py-2">
                      {renderExpanded(row)}
                    </td>
                  </tr>
                )}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
