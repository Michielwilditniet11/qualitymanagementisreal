import { useMemo, useState, useRef, useCallback } from 'react'
import { useDataStore } from '../../store/dataStore'
import { useUIStore } from '../../store/uiStore'
import { computeStatsByField } from '../../data/metrics'
import type { EntityStats } from '../../data/types'
import {
  QUADRANTS, quadrantOf, categoryBrief, supplyRiskOf, type Quadrant,
} from '../../analytics/kraljicBrief'
import {
  T, Panel, SectionLabel, Tick, EntityLink, EmptyState,
  fmtK, fmtMoney, fmtDate, urgencyColor, POSITION_COLORS,
} from '../../ui'
import { Grid3x3, RotateCcw } from 'lucide-react'

const RISK_DOT: Record<string, string> = { high: T.red, medium: T.amber, low: T.green }

interface PlotPoint {
  stat: EntityStats
  supplyRisk: number
  spendImpact: number
  adjusted: boolean
  quadrant: Quadrant
  singleSource: boolean
  riskLevel: 'high' | 'medium' | 'low'
}

export default function KraljicScreen() {
  const contracts = useDataStore(s => s.getContracts())
  const focusInCalendar = useUIStore(s => s.focusInCalendar)
  const inspectInWeb = useUIStore(s => s.inspectInWeb)
  const byCategory = useMemo(() => computeStatsByField(contracts, 'category', 'category'), [contracts])

  // Session state today; BP1 will hydrate this same shape from IndexedDB.
  const [kraljicOverrides, setOverrides] = useState<Record<string, { x: number; y: number }>>({})
  const [selected, setSelected] = useState<string | null>(null)
  const [quadFilter, setQuadFilter] = useState<Quadrant | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const dragRef = useRef<{ name: string; active: boolean }>({ name: '', active: false })

  const maxSpend = Math.max(1, ...byCategory.map(s => s.totalSpend))

  const points: PlotPoint[] = useMemo(() => byCategory.map(stat => {
    const suppliers = new Set(stat.contracts.map(c => c.supplier))
    const supplyRisk = supplyRiskOf(stat)
    // Square-root the spend axis so the long tail is not all crushed at zero.
    const spendImpact = Math.sqrt(stat.totalSpend / maxSpend)
    const o = kraljicOverrides[stat.name]
    const x = o?.x ?? spendImpact
    const y = o?.y ?? supplyRisk

    let worst: 'high' | 'medium' | 'low' = 'low'
    if (stat.expired.length || stat.missingOwner.length) worst = 'high'
    else if (stat.expiring90.length) worst = 'medium'

    return {
      stat, supplyRisk: y, spendImpact: x, adjusted: Boolean(o),
      quadrant: quadrantOf(x, y), singleSource: suppliers.size === 1, riskLevel: worst,
    }
  }), [byCategory, maxSpend, kraljicOverrides])

  const brief = useMemo(() => {
    if (!selected) return null
    const p = points.find(x => x.stat.name === selected)
    if (!p) return null
    return categoryBrief(selected, contracts, p.stat, p.quadrant, p.adjusted)
  }, [selected, points, contracts])

  const W = 620, H = 470, PAD = 54
  const toSVG = (xn: number, yn: number) => ({
    x: PAD + xn * (W - 2 * PAD), y: H - PAD - yn * (H - 2 * PAD),
  })
  const fromSVG = (sx: number, sy: number) => ({
    x: Math.max(0, Math.min(1, (sx - PAD) / (W - 2 * PAD))),
    y: Math.max(0, Math.min(1, 1 - (sy - PAD) / (H - 2 * PAD))),
  })

  const handleDown = useCallback((name: string) => (e: React.PointerEvent) => {
    dragRef.current = { name, active: true }
    ;(e.target as SVGElement).setPointerCapture(e.pointerId)
  }, [])
  const handleMove = useCallback((e: React.PointerEvent) => {
    if (!dragRef.current.active || !svgRef.current) return
    const rect = svgRef.current.getBoundingClientRect()
    const { x, y } = fromSVG((e.clientX - rect.left) / rect.width * W, (e.clientY - rect.top) / rect.height * H)
    setOverrides(o => ({ ...o, [dragRef.current.name]: { x, y } }))
  }, [])
  const handleUp = useCallback(() => { dragRef.current.active = false }, [])

  if (contracts.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center" style={{ background: T.ground }}>
        <EmptyState icon={<Grid3x3 size={22} />} title="No contracts loaded"
          hint="Import a register on the Upload tab to position your categories." />
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col min-h-0" style={{ background: T.ground }}>
      {/* Quadrant summary */}
      <div className="flex items-stretch overflow-x-auto flex-shrink-0"
        style={{ borderBottom: `1px solid ${T.hairline}` }}>
        {QUADRANTS.map(q => {
          const inQ = points.filter(p => p.quadrant === q.id)
          const value = inQ.reduce((s, p) => s + p.stat.totalSpend, 0)
          return (
            <Tick key={q.id} label={q.label.toUpperCase()}
              value={String(inQ.length)} sub={fmtK(value)} color={q.color}
              title={`${q.label}: ${q.stance}`}
              onClick={() => setQuadFilter(f => f === q.id ? null : q.id)} />
          )
        })}
        <div className="flex-1" style={{ borderRight: 'none' }} />
        {Object.keys(kraljicOverrides).length > 0 && (
          <button onClick={() => setOverrides({})}
            className="flex items-center gap-1.5 px-3 text-[9px] tracking-wider cursor-pointer"
            style={{ color: T.amber, fontFamily: T.mono }}>
            <RotateCcw size={10} /> RESET {Object.keys(kraljicOverrides).length} ADJUSTED
          </button>
        )}
      </div>

      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* ─── Matrix ─── */}
        <div className="flex-shrink-0 p-4 overflow-auto" style={{ borderRight: `1px solid ${T.hairline}` }}>
          <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} style={{ width: `${W}px`, maxWidth: '100%' }}
            onPointerMove={handleMove} onPointerUp={handleUp}>
            {QUADRANTS.map(q => {
              const a = toSVG(q.x * 0.5, q.y * 0.5 + 0.5)
              const b = toSVG(q.x * 0.5 + 0.5, q.y * 0.5)
              const dim = quadFilter !== null && quadFilter !== q.id
              return (
                <g key={q.id}>
                  <rect x={Math.min(a.x, b.x)} y={Math.min(a.y, b.y)}
                    width={Math.abs(b.x - a.x)} height={Math.abs(b.y - a.y)}
                    fill={q.color} fillOpacity={dim ? 0.02 : quadFilter === q.id ? 0.1 : 0.045}
                    style={{ cursor: 'pointer' }}
                    onClick={() => setQuadFilter(f => f === q.id ? null : q.id)} />
                  <text x={Math.min(a.x, b.x) + 8} y={Math.min(a.y, b.y) + 16}
                    fill={q.color} fontSize="9" fontFamily={T.mono}
                    opacity={dim ? 0.3 : 0.85} style={{ letterSpacing: '0.12em' }}>
                    {q.label.toUpperCase()}
                  </text>
                </g>
              )
            })}

            {/* Axes */}
            <line x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD} stroke={T.hairline} />
            <line x1={PAD} y1={H - PAD} x2={PAD} y2={PAD} stroke={T.hairline} />
            <line x1={toSVG(0.5, 0).x} y1={toSVG(0.5, 0).y} x2={toSVG(0.5, 1).x} y2={toSVG(0.5, 1).y}
              stroke={T.hairline} strokeDasharray="3 4" />
            <line x1={toSVG(0, 0.5).x} y1={toSVG(0, 0.5).y} x2={toSVG(1, 0.5).x} y2={toSVG(1, 0.5).y}
              stroke={T.hairline} strokeDasharray="3 4" />
            <text x={W / 2} y={H - 22} textAnchor="middle" fill={T.muted} fontSize="9" fontFamily={T.mono}
              style={{ letterSpacing: '0.14em' }}>SPEND IMPACT →</text>
            <text x={W / 2} y={H - 8} textAnchor="middle" fill={T.faint} fontSize="9">more money →</text>
            <text x={16} y={H / 2} textAnchor="middle" fill={T.muted} fontSize="9" fontFamily={T.mono}
              transform={`rotate(-90,16,${H / 2})`} style={{ letterSpacing: '0.14em' }}>SUPPLY RISK →</text>
            <text x={30} y={H / 2} textAnchor="middle" fill={T.faint} fontSize="9"
              transform={`rotate(-90,30,${H / 2})`}>harder to replace →</text>

            {points.map((p, idx) => {
              const { x, y } = toSVG(p.spendImpact, p.supplyRisk)
              const r = 5 + Math.sqrt(p.stat.totalSpend / maxSpend) * 13
              const dim = quadFilter !== null && quadFilter !== p.quadrant
              const isSel = selected === p.stat.name
              return (
                <g key={p.stat.name} style={{ cursor: 'grab' }}
                  opacity={dim ? 0.2 : 1}
                  onPointerDown={handleDown(p.stat.name)}
                  onClick={() => setSelected(p.stat.name)}>
                  {p.adjusted && (
                    <circle cx={x} cy={y} r={r + 5} fill="none"
                      stroke={T.amber} strokeWidth={1} strokeDasharray="2 3" opacity={0.7} />
                  )}
                  {p.singleSource && (
                    <circle cx={x} cy={y} r={r + 2.5} fill="none" stroke={T.amber} strokeWidth={1.5} />
                  )}
                  <circle cx={x} cy={y} r={r}
                    fill={RISK_DOT[p.riskLevel]} fillOpacity={isSel ? 0.9 : 0.6}
                    stroke={isSel ? '#FFFFFF' : RISK_DOT[p.riskLevel]} strokeWidth={isSel ? 2 : 1} />
                  <text x={x} y={y - r - 5 - (idx % 2) * 11} textAnchor="middle" fill={isSel ? T.text : T.dim}
                    fontSize="9" fontFamily={T.mono}>
                    {p.stat.name.length > 18 ? p.stat.name.slice(0, 17) + '…' : p.stat.name}
                  </text>
                </g>
              )
            })}
          </svg>

          <div className="flex gap-3 mt-2 flex-wrap text-[9px]" style={{ color: T.muted, fontFamily: T.mono }}>
            <span className="flex items-center gap-1">
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: T.red, display: 'inline-block' }} /> HIGH RISK
            </span>
            <span className="flex items-center gap-1">
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: T.amber, display: 'inline-block' }} /> EXPIRING
            </span>
            <span className="flex items-center gap-1">
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: T.green, display: 'inline-block' }} /> HEALTHY
            </span>
            <span>◯ RING = SINGLE SOURCE</span>
            <span>⌁ DASH = ADJUSTED</span>
            <span>SIZE = SPEND · DRAG TO REPOSITION</span>
          </div>
        </div>

        {/* ─── Category brief ─── */}
        <div className="flex-1 overflow-y-auto min-w-0 p-4">
          {!brief ? (
            <EmptyState icon={<Grid3x3 size={20} />} title="Select a category"
              hint="Click any dot to see its suppliers, open decisions, gaps and a playbook written for it." />
          ) : (
            <div className="space-y-3">
              <div>
                <div className="flex items-baseline gap-2 flex-wrap">
                  <h2 className="text-base font-bold" style={{ color: T.text }}>{brief.category}</h2>
                  <span className="text-[9px] px-1.5 py-0.5 tracking-wider"
                    style={{
                      color: QUADRANTS.find(q => q.id === brief.quadrant)!.color,
                      border: `1px solid ${QUADRANTS.find(q => q.id === brief.quadrant)!.color}`,
                      fontFamily: T.mono,
                    }}>
                    {brief.quadrant.toUpperCase().replace('-', ' ')}
                  </span>
                  {brief.adjusted && (
                    <span className="text-[9px] tracking-wider" style={{ color: T.amber, fontFamily: T.mono }}>
                      ADJUSTED
                    </span>
                  )}
                  {brief.singleSource && (
                    <span className="text-[9px] tracking-wider" style={{ color: T.amber, fontFamily: T.mono }}>
                      SINGLE SOURCE
                    </span>
                  )}
                </div>
                <div className="text-[11px] mt-1 tabular-nums" style={{ color: T.muted, fontFamily: T.mono }}>
                  {fmtMoney(brief.spend)} · {brief.contractCount} contract{brief.contractCount === 1 ? '' : 's'} · {brief.suppliers.length} supplier{brief.suppliers.length === 1 ? '' : 's'}
                </div>
              </div>

              {/* Playbook — the stance with real names in it */}
              <Panel className="p-3" style={{ borderLeft: `2px solid ${QUADRANTS.find(q => q.id === brief.quadrant)!.color}` }}>
                <SectionLabel color={QUADRANTS.find(q => q.id === brief.quadrant)!.color}>PLAYBOOK</SectionLabel>
                <div className="text-[10px] italic mt-1 mb-2" style={{ color: T.faint }}>
                  {QUADRANTS.find(q => q.id === brief.quadrant)!.stance}
                </div>
                <ul className="space-y-1.5">
                  {brief.playbook.map((line, i) => (
                    <li key={i} className="text-[11px] leading-relaxed flex gap-2" style={{ color: T.dim }}>
                      <span style={{ color: T.cyan }}>▸</span>{line}
                    </li>
                  ))}
                </ul>
              </Panel>

              {/* Suppliers */}
              {brief.suppliers.length > 0 && (
                <Panel className="p-3">
                  <SectionLabel>SUPPLIERS &amp; OUR POSITION</SectionLabel>
                  <div className="mt-2 space-y-1.5">
                    {brief.suppliers.map(s => (
                      <div key={s.supplier} className="flex items-baseline justify-between gap-2">
                        <span className="text-[11px] truncate"><EntityLink type="supplier" name={s.supplier} /></span>
                        <span className="flex items-baseline gap-2 flex-shrink-0">
                          {s.nextWindow && (
                            <span className="text-[9px] tabular-nums"
                              style={{ color: urgencyColor(s.nextWindow.daysLeft), fontFamily: T.mono }}>
                              {s.nextWindow.daysLeft}d
                            </span>
                          )}
                          <span className="text-[9px] tracking-wider"
                            style={{ color: POSITION_COLORS[s.position], fontFamily: T.mono }}>
                            {s.position.toUpperCase()}
                          </span>
                        </span>
                      </div>
                    ))}
                  </div>
                </Panel>
              )}

              {/* Open decisions */}
              {brief.decisions.length > 0 && (
                <Panel className="p-3">
                  <SectionLabel>OPEN DECISIONS</SectionLabel>
                  <div className="mt-2 space-y-1">
                    {brief.decisions.slice(0, 6).map((d, i) => (
                      <button key={d.contractId + i} onClick={() => focusInCalendar(d.contractId)}
                        className="w-full flex items-baseline gap-2 text-left cursor-pointer hover:brightness-150">
                        <span className="text-[10px] tabular-nums w-14 flex-shrink-0 font-semibold"
                          style={{ color: urgencyColor(d.daysLeft, d.missed), fontFamily: T.mono }}>
                          {d.missed ? 'missed' : `${d.daysLeft}d`}
                        </span>
                        <span className="text-[10px] truncate flex-1" style={{ color: T.dim }}>{d.contract}</span>
                        <span className="text-[9px] tabular-nums flex-shrink-0" style={{ color: T.muted, fontFamily: T.mono }}>
                          {fmtDate(d.actBy)}
                        </span>
                      </button>
                    ))}
                  </div>
                </Panel>
              )}

              {/* Gaps */}
              {brief.gaps.length > 0 && (
                <Panel className="p-3">
                  <SectionLabel color={T.magenta}>STRUCTURAL GAPS</SectionLabel>
                  <div className="mt-2 space-y-1.5">
                    {brief.gaps.map(g => (
                      <div key={g.id} className="text-[10px] leading-relaxed" style={{ color: T.dim }}>
                        <span style={{ color: T.magenta }}>▸ </span>{g.title}
                        <span className="tabular-nums ml-1" style={{ color: T.magenta, fontFamily: T.mono }}>
                          {fmtK(g.exposure)}
                        </span>
                      </div>
                    ))}
                  </div>
                </Panel>
              )}

              {/* Opportunities */}
              {brief.opportunities.length > 0 && (
                <Panel className="p-3">
                  <SectionLabel color={T.green}>SAVINGS NAMING THIS CATEGORY</SectionLabel>
                  <div className="mt-2 space-y-1.5">
                    {brief.opportunities.map(o => (
                      <div key={o.kind + o.title}>
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="text-[10px]" style={{ color: T.dim }}>{o.title}</span>
                          <span className="text-[10px] tabular-nums flex-shrink-0"
                            style={{ color: T.green, fontFamily: T.mono }}>
                            {fmtK(o.low)}–{fmtK(o.high)}
                          </span>
                        </div>
                        <div className="text-[9px] italic" style={{ color: T.faint }}>{o.assumption}</div>
                      </div>
                    ))}
                  </div>
                </Panel>
              )}

              <div className="flex gap-2 flex-wrap">
                <button onClick={() => inspectInWeb({ type: 'category', name: brief.category })}
                  className="text-[9px] tracking-wider px-2 py-1 cursor-pointer"
                  style={{ color: T.cyan, border: `1px solid ${T.hairline}`, fontFamily: T.mono }}>
                  INSPECT IN WEB →
                </button>
                {brief.decisions[0] && (
                  <button onClick={() => focusInCalendar(brief.decisions[0].contractId)}
                    className="text-[9px] tracking-wider px-2 py-1 cursor-pointer"
                    style={{ color: T.cyan, border: `1px solid ${T.hairline}`, fontFamily: T.mono }}>
                    SEE ITS RENEWALS →
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
