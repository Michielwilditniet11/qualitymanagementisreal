import { useMemo, useState, useRef, useCallback } from 'react'
import { useDataStore } from '../../store/dataStore'
import { computeStatsByField } from '../../data/metrics'
import type { EntityStats } from '../../data/types'

function fmtMoney(v: number) { return '€' + Math.round(v).toLocaleString('en-US') }

interface PlotPoint {
  stat: EntityStats
  supplyRisk: number
  spendImpact: number
  overrideX?: number
  overrideY?: number
}

const QUADRANTS = [
  { label: 'Non-critical', x: 0, y: 0, color: 'rgba(138,163,196,0.08)', tactic: 'Simplify & automate. Reduce transaction costs; consolidate suppliers; use catalogs.' },
  { label: 'Leverage', x: 1, y: 0, color: 'rgba(77,163,255,0.08)', tactic: 'Exploit purchasing power. Aggregate volume; competitive bidding; short-term contracts.' },
  { label: 'Bottleneck', x: 0, y: 1, color: 'rgba(255,179,71,0.08)', tactic: 'Secure supply. Dual-source; hold safety stock; long-term agreements; develop alternatives.' },
  { label: 'Strategic', x: 1, y: 1, color: 'rgba(123,216,143,0.08)', tactic: 'Deep partnerships. Joint innovation; risk sharing; long-term contracts; supplier development.' },
]

export default function KraljicScreen() {
  const contracts = useDataStore(s => s.getContracts())
  const byCategory = useMemo(() => computeStatsByField(contracts, 'category', 'category'), [contracts])
  const [overrides, setOverrides] = useState<Record<string, { x: number; y: number }>>({})
  const [selectedPoint, setSelectedPoint] = useState<PlotPoint | null>(null)
  const [hoveredQuadrant, setHoveredQuadrant] = useState<number | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const dragRef = useRef<{ name: string; active: boolean }>({ name: '', active: false })

  const maxSpend = Math.max(1, ...byCategory.map(s => s.totalSpend))
  const uniqueSuppliers = new Set(contracts.map(c => c.supplier)).size

  const points: PlotPoint[] = useMemo(() => byCategory.map(stat => {
    const supplyRisk = Math.min(1,
      (stat.supplierConcentration * 0.5) +
      (stat.singleSource ? 0.3 : 0) +
      (1 - Math.min(1, (new Set(stat.contracts.map(c => c.supplier)).size) / Math.max(1, uniqueSuppliers * 0.3))) * 0.2
    )
    const spendImpact = stat.totalSpend / maxSpend
    const override = overrides[stat.name]
    return { stat, supplyRisk, spendImpact, overrideX: override?.x, overrideY: override?.y }
  }), [byCategory, maxSpend, uniqueSuppliers, overrides])

  const W = 600, H = 500, PAD = 60

  function toSVG(xNorm: number, yNorm: number) {
    return { x: PAD + xNorm * (W - 2 * PAD), y: H - PAD - yNorm * (H - 2 * PAD) }
  }
  function fromSVG(sx: number, sy: number) {
    return { x: Math.max(0, Math.min(1, (sx - PAD) / (W - 2 * PAD))), y: Math.max(0, Math.min(1, 1 - (sy - PAD) / (H - 2 * PAD))) }
  }

  const handlePointerDown = useCallback((name: string) => (e: React.PointerEvent) => {
    dragRef.current = { name, active: true };
    (e.target as SVGElement).setPointerCapture(e.pointerId)
  }, [])

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragRef.current.active || !svgRef.current) return
    const rect = svgRef.current.getBoundingClientRect()
    const sx = (e.clientX - rect.left) / rect.width * W
    const sy = (e.clientY - rect.top) / rect.height * H
    const { x, y } = fromSVG(sx, sy)
    setOverrides(o => ({ ...o, [dragRef.current.name]: { x, y } }))
  }, [])

  const handlePointerUp = useCallback(() => { dragRef.current.active = false }, [])

  const getQuadrant = (p: PlotPoint) => {
    const x = p.overrideX ?? p.spendImpact
    const y = p.overrideY ?? p.supplyRisk
    if (x >= 0.5 && y >= 0.5) return 3 // Strategic
    if (x >= 0.5 && y < 0.5) return 1 // Leverage
    if (x < 0.5 && y >= 0.5) return 2 // Bottleneck
    return 0 // Non-critical
  }

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <h2 className="text-xl font-bold mb-1">Kraljic matrix</h2>
      <p className="text-[#8fa0bd] text-sm mb-6">Categories positioned by supply risk vs spend impact. Drag any dot to override its position.</p>

      <div className="flex gap-6 flex-wrap">
        <div className="bg-[#171e2e] border border-[#2a3650] rounded-xl p-4">
          <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} className="w-full max-w-[600px]"
            onPointerMove={handlePointerMove} onPointerUp={handlePointerUp}>
            {/* Quadrant backgrounds */}
            {QUADRANTS.map((q, i) => {
              const { x: x1, y: y1 } = toSVG(q.x * 0.5, q.y * 0.5 + 0.5)
              const { x: x2, y: y2 } = toSVG(q.x * 0.5 + 0.5, q.y * 0.5)
              return <rect key={i} x={Math.min(x1, x2)} y={Math.min(y1, y2)} width={Math.abs(x2 - x1)} height={Math.abs(y2 - y1)}
                fill={hoveredQuadrant === i ? q.color.replace('0.08', '0.16') : q.color}
                onMouseEnter={() => setHoveredQuadrant(i)} onMouseLeave={() => setHoveredQuadrant(null)} />
            })}
            {/* Quadrant labels */}
            {QUADRANTS.map((q, i) => {
              const { x, y } = toSVG(q.x * 0.5 + 0.25, q.y * 0.5 + 0.25)
              return <text key={i} x={x} y={y} textAnchor="middle" fill="#8fa0bd" fontSize="12" fontWeight="600" opacity="0.5">{q.label}</text>
            })}
            {/* Axes */}
            <line x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD} stroke="#2a3650" />
            <line x1={PAD} y1={H - PAD} x2={PAD} y2={PAD} stroke="#2a3650" />
            <text x={W / 2} y={H - 10} textAnchor="middle" fill="#8fa0bd" fontSize="11">Spend impact →</text>
            <text x={15} y={H / 2} textAnchor="middle" fill="#8fa0bd" fontSize="11" transform={`rotate(-90,15,${H / 2})`}>Supply risk →</text>
            {/* Midlines */}
            <line x1={toSVG(0.5, 0).x} y1={toSVG(0.5, 0).y} x2={toSVG(0.5, 1).x} y2={toSVG(0.5, 1).y} stroke="#2a3650" strokeDasharray="4" />
            <line x1={toSVG(0, 0.5).x} y1={toSVG(0, 0.5).y} x2={toSVG(1, 0.5).x} y2={toSVG(1, 0.5).y} stroke="#2a3650" strokeDasharray="4" />
            {/* Points */}
            {points.map(p => {
              const px = p.overrideX ?? p.spendImpact
              const py = p.overrideY ?? p.supplyRisk
              const { x, y } = toSVG(px, py)
              const r = 6 + Math.sqrt(p.stat.totalSpend / maxSpend) * 12
              const isOverridden = p.overrideX !== undefined
              return (
                <g key={p.stat.name} style={{ cursor: 'grab' }}
                  onPointerDown={handlePointerDown(p.stat.name)}
                  onClick={() => setSelectedPoint(p)}>
                  <circle cx={x} cy={y} r={r} fill={isOverridden ? '#7bd88f' : '#ffb347'} fillOpacity={0.7}
                    stroke={selectedPoint?.stat.name === p.stat.name ? '#fff' : 'none'} strokeWidth={2} />
                  <text x={x} y={y - r - 4} textAnchor="middle" fill="#dfe7f5" fontSize="9">{p.stat.name.length > 18 ? p.stat.name.slice(0, 17) + '…' : p.stat.name}</text>
                </g>
              )
            })}
          </svg>
        </div>

        {/* Detail panel */}
        <div className="flex-1 min-w-[260px] space-y-4">
          {hoveredQuadrant !== null && (
            <div className="bg-[#171e2e] border border-[#2a3650] rounded-xl p-4">
              <h3 className="font-semibold text-sm mb-1">{QUADRANTS[hoveredQuadrant].label}</h3>
              <p className="text-xs text-[#8fa0bd]">{QUADRANTS[hoveredQuadrant].tactic}</p>
            </div>
          )}
          {selectedPoint && (
            <div className="bg-[#171e2e] border border-[#2a3650] rounded-xl p-4">
              <h3 className="font-semibold text-sm mb-2">{selectedPoint.stat.name}</h3>
              <div className="text-xs space-y-1 text-[#8fa0bd]">
                <div className="flex justify-between"><span>Annual spend</span><span className="text-white">{fmtMoney(selectedPoint.stat.totalSpend)}</span></div>
                <div className="flex justify-between"><span>Contracts</span><span className="text-white">{selectedPoint.stat.contractCount}</span></div>
                <div className="flex justify-between"><span>Top supplier share</span><span className="text-white">{Math.round(selectedPoint.stat.supplierConcentration * 100)}%</span></div>
                <div className="flex justify-between"><span>Supply risk (computed)</span><span className="text-white">{Math.round(selectedPoint.supplyRisk * 100)}%</span></div>
                <div className="flex justify-between"><span>Spend impact (computed)</span><span className="text-white">{Math.round(selectedPoint.spendImpact * 100)}%</span></div>
                <div className="flex justify-between"><span>Quadrant</span><span className="text-white">{QUADRANTS[getQuadrant(selectedPoint)].label}</span></div>
                <div className="flex justify-between"><span>Health score</span><span className="text-white">{selectedPoint.stat.healthScore}</span></div>
              </div>
              {selectedPoint.overrideX !== undefined && (
                <button onClick={() => { setOverrides(o => { const n = { ...o }; delete n[selectedPoint.stat.name]; return n }) }}
                  className="mt-2 text-xs text-[#4da3ff] hover:underline">Reset to computed position</button>
              )}
            </div>
          )}
          <div className="bg-[#171e2e] border border-[#2a3650] rounded-xl p-4">
            <h3 className="font-semibold text-sm mb-2">Quadrant summary</h3>
            {QUADRANTS.map((q, qi) => {
              const count = points.filter(p => getQuadrant(p) === qi).length
              return (
                <div key={qi} className="text-xs flex justify-between py-1 text-[#8fa0bd]">
                  <span>{q.label}</span><span className="text-white">{count} categories</span>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
