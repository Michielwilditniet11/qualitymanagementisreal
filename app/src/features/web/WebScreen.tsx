import { useState, useMemo } from 'react'
import { useDataStore } from '../../store/dataStore'
import { buildGraph, NODE_COLORS } from '../../graph/buildGraph'
import PlanetaryWeb, { riskScore, riskLevel, riskReasons, RISK_COLORS, fmtK, fmtDate, daysDiff } from '../../graph/PlanetaryWeb'
import { AlertTriangle, Shield, ShieldCheck, User, Building2, Tag, DollarSign, FileText, ChevronRight } from 'lucide-react'
import type { GraphNode } from '../../data/types'
import { LENSES, lensForCategory, type LensId } from '../../analytics/lenses'
import { generateInsights, totalValueAtRisk, type Insight } from '../../analytics/insights'
import { computeCentrality, assessImpact } from '../../analytics/centrality'

export default function WebScreen() {
  const contracts = useDataStore(s => s.getContracts())
  const [selected, setSelected] = useState<GraphNode | null>(null)
  const [visibleTypes, setVisibleTypes] = useState<Record<string, boolean>>({
    department: true, category: true, supplier: true, owner: true, contract: true,
  })
  const [searchQuery, setSearchQuery] = useState('')
  const [spendThreshold, setSpendThreshold] = useState(0)
  const [highlightExpiring, setHighlightExpiring] = useState(0)
  const [lens, setLens] = useState<LensId>('structure')
  const [activeInsight, setActiveInsight] = useState<Insight | null>(null)
  const [focusNode, setFocusNode] = useState<GraphNode | null>(null)

  const { nodes, links } = useMemo(() => buildGraph(contracts, 900, 600), [contracts])
  const insights = useMemo(() => generateInsights(contracts), [contracts])

  const highlightKeys = useMemo(() => {
    if (!activeInsight) return null
    const known = new Set(nodes.map(n => n.key))
    return new Set(activeInsight.nodeKeys.filter(k => known.has(k)))
  }, [activeInsight, nodes])

  const openInsight = (i: Insight) => {
    if (activeInsight?.id === i.id) { setActiveInsight(null); return }
    setActiveInsight(i)
    setLens(lensForCategory(i.category))
    setSelected(null)
  }

  const toggleType = (t: string) => {
    setVisibleTypes(v => {
      const next = { ...v, [t]: !v[t] }
      if (selected && !next[selected.type]) setSelected(null)
      return next
    })
  }

  const handleLegendChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const type = e.target.dataset.type
    if (type) toggleType(type)
  }

  const maxSpend = Math.max(1, ...contracts.map(c => c.annualValue ?? 0))

  const navigateTo = (type: string, name: string) => {
    const n = nodes.find(nd => nd.type === type && nd.name === name)
    if (n) setSelected(n)
  }

  return (
    <div className="flex-1 flex min-h-0">
      {/* Canvas area */}
      <div className="flex-1 flex flex-col min-h-0 min-w-0 overflow-hidden" onClick={handleLegendChange as any}>
        {/* Lens selector */}
        <div className="flex items-center gap-2 px-4 py-2 border-b flex-wrap" style={{ background: '#080C14', borderColor: '#1E293B' }}>
          <span className="text-[9px] font-semibold tracking-wider mr-1" style={{ color: '#475569' }}>LENS</span>
          <div className="flex rounded-lg overflow-hidden flex-shrink-0" style={{ border: '1px solid #1E293B' }}>
            {LENSES.map(l => (
              <button
                key={l.id}
                onClick={() => setLens(l.id)}
                title={l.question}
                className="px-2.5 py-1 text-[11px] transition-colors cursor-pointer"
                style={{
                  background: lens === l.id ? '#1E293B' : 'transparent',
                  color: lens === l.id ? '#F1F5F9' : '#64748B',
                }}
              >
                {l.label}
              </button>
            ))}
          </div>
          <span className="text-[10px] ml-1" style={{ color: '#475569' }}>
            {LENSES.find(l => l.id === lens)?.question}
          </span>
        </div>

        {/* Search & controls bar */}
        <div className="flex items-center gap-3 px-4 py-2 border-b flex-wrap" style={{ background: '#0A0F1A', borderColor: '#1E293B' }}>
          <input
            type="text" placeholder="Search nodes…"
            value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
            className="rounded-lg px-3 py-1.5 text-sm w-52 text-white placeholder:text-[#475569]"
            style={{ background: '#020408', border: '1px solid #1E293B' }}
          />
          <div className="flex items-center gap-2 text-xs" style={{ color: '#64748B' }}>
            <label>Min spend:</label>
            <input type="range" min={0} max={maxSpend} step={1000} value={spendThreshold}
              onChange={e => setSpendThreshold(parseInt(e.target.value))}
              className="w-28 accent-[#38BDF8]" />
            <span className="text-white w-20 tabular-nums">{fmtK(spendThreshold)}</span>
          </div>
          <div className="flex items-center gap-2 text-xs" style={{ color: '#64748B' }}>
            <label>Expiring within:</label>
            <select value={highlightExpiring} onChange={e => setHighlightExpiring(parseInt(e.target.value))}
              className="rounded px-2 py-1 text-white"
              style={{ background: '#020408', border: '1px solid #1E293B' }}>
              <option value={0}>Off</option>
              <option value={30}>30 days</option>
              <option value={90}>90 days</option>
              <option value={180}>180 days</option>
              <option value={365}>1 year</option>
            </select>
          </div>
        </div>
        <PlanetaryWeb
          nodes={nodes} links={links}
          visibleTypes={visibleTypes} selected={selected}
          onSelect={setSelected}
          searchQuery={searchQuery}
          spendThreshold={spendThreshold}
          highlightExpiring={highlightExpiring}
          lens={lens}
          highlightKeys={highlightKeys}
          focusNode={focusNode}
          onFocus={setFocusNode}
        />
      </div>

      {/* ─── Right-side inspection drawer ─── */}
      <div className="w-80 flex-shrink-0 border-l overflow-y-auto overflow-x-hidden" style={{ background: '#060A14', borderColor: '#1E293B' }}>
        {!selected ? (
          <InsightsPanel
            nodes={nodes} links={links} contracts={contracts}
            insights={insights} active={activeInsight}
            onOpen={openInsight} onClear={() => setActiveInsight(null)}
            onSelectNode={setSelected}
          />
        ) : selected.type === 'contract' && selected.contract ? (
          <ContractDetail node={selected} onNavigate={navigateTo} />
        ) : (
          <EntityDetail node={selected} nodes={nodes} onSelect={setSelected}
            contracts={contracts} focusNode={focusNode} onFocus={setFocusNode} />
        )}
      </div>
    </div>
  )
}

const SEVERITY_COLORS: Record<string, string> = {
  critical: '#DC2626', warning: '#D97706', info: '#0EA5E9',
}

function InsightsPanel({ nodes, links, contracts, insights, active, onOpen, onClear, onSelectNode }: {
  nodes: GraphNode[]
  links: { source: GraphNode; target: GraphNode }[]
  contracts: any[]
  insights: Insight[]
  active: Insight | null
  onOpen: (i: Insight) => void
  onClear: () => void
  onSelectNode: (n: GraphNode) => void
}) {
  const totalSpend = contracts.reduce((s: number, c: any) => s + (c.annualValue ?? 0), 0)
  const atRisk = useMemo(() => totalValueAtRisk(insights), [insights])

  const topSuppliers = useMemo(() => computeCentrality(nodes, 'supplier').slice(0, 5), [nodes])
  const topOwners = useMemo(() => computeCentrality(nodes, 'owner').slice(0, 5), [nodes])

  const counts = useMemo(() => ({
    critical: insights.filter(i => i.severity === 'critical').length,
    warning: insights.filter(i => i.severity === 'warning').length,
    info: insights.filter(i => i.severity === 'info').length,
  }), [insights])

  return (
    <div className="p-4">
      <h2 className="font-semibold text-sm mb-1 text-white">What needs attention</h2>
      <p className="text-xs mb-3" style={{ color: '#64748B' }}>
        {insights.length === 0
          ? 'No material findings in this portfolio.'
          : 'Click a finding to highlight it in the web.'}
      </p>

      <div className="space-y-2 mb-4">
        <StatRow icon={<DollarSign size={13} />} label="Total spend" value={fmtK(totalSpend)} />
        <StatRow icon={<AlertTriangle size={13} />} label="Value at risk" value={fmtK(atRisk)} />
        <StatRow icon={<FileText size={13} />} label="Nodes" value={String(nodes.length)} />
        <StatRow icon={<ChevronRight size={13} />} label="Connections" value={String(links.length)} />
      </div>

      {active && (
        <button onClick={onClear}
          className="w-full mb-3 text-[10px] py-1.5 rounded-lg cursor-pointer transition-colors hover:text-white"
          style={{ background: '#0F172A', border: '1px solid #1E293B', color: '#94A3B8' }}>
          Clear highlight
        </button>
      )}

      {insights.length > 0 && (
        <>
          <div className="flex items-center gap-2 mb-2">
            <div className="text-[9px] uppercase tracking-wider" style={{ color: '#475569' }}>Findings</div>
            <div className="flex gap-1.5">
              {(['critical', 'warning', 'info'] as const).map(s => counts[s] > 0 && (
                <span key={s} className="text-[9px] px-1.5 rounded-full font-semibold"
                  style={{ background: `${SEVERITY_COLORS[s]}18`, color: SEVERITY_COLORS[s] }}>
                  {counts[s]}
                </span>
              ))}
            </div>
          </div>

          <div className="space-y-1.5 mb-4">
            {insights.map(i => {
              const color = SEVERITY_COLORS[i.severity]
              const isActive = active?.id === i.id
              return (
                <button key={i.id} onClick={() => onOpen(i)}
                  className="w-full text-left rounded-lg p-2.5 cursor-pointer transition-colors"
                  style={{
                    background: isActive ? '#0F172A' : '#0A0F1A',
                    border: `1px solid ${isActive ? color : '#1E293B'}`,
                  }}>
                  <div className="flex items-start gap-2">
                    <div style={{
                      width: '6px', height: '6px', borderRadius: i.severity === 'critical' ? '1px' : '50%',
                      background: color, flexShrink: 0, marginTop: '4px',
                    }} />
                    <div className="flex-1 min-w-0">
                      <div className="text-[11px] font-medium text-white leading-snug">{i.title}</div>
                      <div className="text-[10px] mt-1 leading-relaxed" style={{ color: '#94A3B8' }}>{i.narrative}</div>
                      {i.valueAtRisk !== undefined && (
                        <span className="inline-block text-[9px] mt-1.5 px-1.5 py-0.5 rounded font-semibold tabular-nums"
                          style={{ background: `${color}15`, color }}>
                          {fmtK(i.valueAtRisk)}
                        </span>
                      )}
                      {isActive && i.action && (
                        <div className="text-[9px] mt-1.5 pt-1.5 italic" style={{ color: '#64748B', borderTop: '1px solid #1E293B' }}>
                          {i.action}
                        </div>
                      )}
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        </>
      )}

      <StakeholderCard title="Key suppliers" icon={<Building2 size={11} />}
        rows={topSuppliers} nodes={nodes} onSelectNode={onSelectNode} />
      <StakeholderCard title="Contract owners" icon={<User size={11} />}
        rows={topOwners} nodes={nodes} onSelectNode={onSelectNode} />
    </div>
  )
}

function StakeholderCard({ title, icon, rows, nodes, onSelectNode }: {
  title: string
  icon: React.ReactNode
  rows: { key: string; name: string; weightedDegree: number; departmentReach: number; systemicScore: number }[]
  nodes: GraphNode[]
  onSelectNode: (n: GraphNode) => void
}) {
  if (rows.length === 0) return null
  const totalSpend = nodes.filter(n => n.type === 'contract').reduce((s, n) => s + (n.contract?.annualValue ?? 0), 0)
  return (
    <div className="mb-3">
      <div className="flex items-center gap-1.5 mb-1.5">
        <span style={{ color: '#475569' }}>{icon}</span>
        <div className="text-[9px] uppercase tracking-wider" style={{ color: '#475569' }}>{title}</div>
      </div>
      <div className="space-y-1">
        {rows.map(r => {
          const node = nodes.find(n => n.key === r.key)
          const impact = node ? assessImpact(node, totalSpend) : null
          return (
            <button key={r.key} onClick={() => node && onSelectNode(node)}
              className="w-full text-left rounded-lg p-2 cursor-pointer hover:border-[#334155] transition-colors"
              style={{ background: '#0A0F1A', border: '1px solid #1E293B' }}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] font-medium text-white truncate">{r.name}</span>
                <span className="text-[10px] tabular-nums flex-shrink-0" style={{ color: '#38BDF8' }}>
                  {fmtK(r.weightedDegree)}
                </span>
              </div>
              <div className="text-[9px] mt-0.5" style={{ color: '#64748B' }}>
                {impact ? `${impact.contractCount} contract${impact.contractCount === 1 ? '' : 's'} · ` : ''}
                {r.departmentReach} dept{r.departmentReach === 1 ? '' : 's'}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function ContractDetail({ node, onNavigate }: { node: GraphNode; onNavigate: (type: string, name: string) => void }) {
  const c = node.contract!
  const risk = riskScore(node)
  const level = riskLevel(risk)
  const reasons = riskReasons(node)

  return (
    <div className="p-4">
      <div className="mb-3">
        <h2 className="font-semibold text-sm text-white leading-tight">{c.name}</h2>
        <div className="flex items-center gap-2 mt-1.5">
          <RiskBadge level={level} score={risk} />
          {c.status && (
            <span className="text-[9px] px-1.5 py-0.5 rounded" style={{ background: '#1E293B', color: '#94A3B8' }}>
              {c.status}
            </span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 mb-3">
        <MetricCard label="Annual Value" value={fmtK(c.annualValue ?? 0)} color="#38BDF8" />
        <MetricCard label="Days to Expiry"
          value={c.endDate ? (() => { const d = daysDiff(c.endDate!); return d < 0 ? `−${-d}d` : `${d}d` })() : '—'}
          color={c.endDate && daysDiff(c.endDate) < 30 ? '#FF0055' : c.endDate && daysDiff(c.endDate) < 90 ? '#F59E0B' : '#10B981'} />
      </div>

      <div className="space-y-0 mb-3">
        <DetailRow label="Start" value={fmtDate(c.startDate)} />
        <DetailRow label="End" value={fmtDate(c.endDate)} />
        <DetailRow label="Notice period" value={c.noticePeriodDays ? `${c.noticePeriodDays} days` : '—'} />
        <DetailRow label="Auto-renew" value={c.autoRenew === true ? 'Yes' : c.autoRenew === false ? 'No' : '—'} />
      </div>

      <div className="space-y-1.5 mb-3">
        <ChipLink icon={<Building2 size={11} />} label="Supplier" value={c.supplier} onClick={() => onNavigate('supplier', c.supplier)} />
        <ChipLink icon={<Tag size={11} />} label="Category" value={c.category} onClick={() => onNavigate('category', c.category)} />
        <ChipLink icon={<Building2 size={11} />} label="Department" value={c.department} onClick={() => onNavigate('department', c.department)} />
        <ChipLink icon={<User size={11} />} label="Owner" value={c.owner || '⚠ No owner'} onClick={c.owner ? () => onNavigate('owner', c.owner!) : undefined}
          warn={!c.owner} />
      </div>

      {reasons.length > 0 && (
        <div className="rounded-lg p-2.5 mt-3" style={{ background: `${RISK_COLORS[level]}08`, border: `1px solid ${RISK_COLORS[level]}20` }}>
          <div className="flex items-center gap-1.5 mb-1.5">
            <AlertTriangle size={11} color={RISK_COLORS[level]} />
            <span className="text-[9px] font-semibold tracking-wider" style={{ color: RISK_COLORS[level] }}>RISK FACTORS</span>
          </div>
          <div className="space-y-1">
            {reasons.map((r, i) => (
              <div key={i} className="text-[10px] flex items-start gap-1.5" style={{ color: '#94A3B8' }}>
                <span style={{ color: RISK_COLORS[level] }}>•</span>{r}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function EntityDetail({ node, nodes, onSelect, contracts, focusNode, onFocus }: {
  node: GraphNode; nodes: GraphNode[]
  onSelect: (n: GraphNode) => void
  contracts: any[]
  focusNode: GraphNode | null
  onFocus: (n: GraphNode | null) => void
}) {
  const totalSpend = contracts.reduce((s: number, c: any) => s + (c.annualValue ?? 0), 0)
  const impact = assessImpact(node, totalSpend)
  const isFocused = focusNode?.key === node.key

  return (
    <div className="p-4">
      <div className="mb-3">
        <div className="text-[9px] uppercase tracking-wider mb-0.5" style={{ color: NODE_COLORS[node.type] }}>
          {node.type}
        </div>
        <h2 className="font-semibold text-sm text-white">{node.name}</h2>
      </div>

      <button onClick={() => onFocus(isFocused ? null : node)}
        className="w-full mb-3 text-[10px] py-1.5 rounded-lg cursor-pointer transition-colors hover:text-white"
        style={{
          background: isFocused ? '#1E293B' : '#0F172A',
          border: `1px solid ${isFocused ? '#38BDF8' : '#1E293B'}`,
          color: isFocused ? '#38BDF8' : '#94A3B8',
        }}>
        {isFocused ? 'Exit focus' : 'Focus on this node'}
      </button>

      <div className="grid grid-cols-2 gap-2 mb-3">
        <MetricCard label="Total Spend" value={fmtK(node.value)} color="#38BDF8" />
        <MetricCard label="Contracts" value={String(node.contracts.length)} color="#94A3B8" />
      </div>

      {impact.contractCount > 0 && (
        <div className="rounded-lg p-2.5 mb-3" style={{ background: '#0A0F1A', border: '1px solid #1E293B' }}>
          <div className="flex items-center gap-1.5 mb-1.5">
            <AlertTriangle size={11} color="#D97706" />
            <span className="text-[9px] font-semibold tracking-wider" style={{ color: '#D97706' }}>
              IMPACT IF LOST
            </span>
          </div>
          <div className="text-[10px] leading-relaxed" style={{ color: '#94A3B8' }}>
            {impact.contractCount} contract{impact.contractCount === 1 ? '' : 's'} worth{' '}
            <span className="font-semibold" style={{ color: '#E2E8F0' }}>{fmtK(impact.annualValue)}</span>
            {' '}({Math.round(impact.spendShare * 100)}% of portfolio) would need replacing.
          </div>
          {impact.departments.length > 0 && (
            <div className="mt-1.5">
              <div className="text-[8px] uppercase tracking-wider mb-1" style={{ color: '#475569' }}>
                Departments affected ({impact.departments.length})
              </div>
              <div className="flex flex-wrap gap-1">
                {impact.departments.map(d => (
                  <span key={d} className="text-[9px] px-1.5 py-0.5 rounded"
                    style={{ background: '#0F172A', border: '1px solid #1E293B', color: '#94A3B8' }}>
                    {d}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {['department', 'category', 'supplier', 'owner'].map(t => {
        if (t === node.type) return null
        const items = [...node.neighbors].filter(n => n.type === t)
        if (items.length === 0) return null
        return (
          <div key={t} className="mb-3">
            <div className="text-[9px] uppercase tracking-wider mb-1" style={{ color: '#475569' }}>{t}s</div>
            <div className="flex flex-wrap gap-1">
              {items.map(n => (
                <button key={n.key}
                  className="text-[10px] px-2 py-0.5 rounded-full cursor-pointer hover:text-[#E2E8F0] hover:border-[#38BDF8] transition-colors"
                  style={{ background: '#0F172A', border: '1px solid #1E293B', color: '#94A3B8' }}
                  onClick={() => onSelect(n)}>
                  {n.name}
                </button>
              ))}
            </div>
          </div>
        )
      })}

      <div>
        <div className="text-[9px] uppercase tracking-wider mb-1.5" style={{ color: '#475569' }}>
          Contracts ({node.contracts.length})
        </div>
        <div className="space-y-1">
          {node.contracts.slice(0, 25).map(c => {
            const cn = nodes.find(n => n.type === 'contract' && n.contract?.id === c.id)
            const risk = cn ? riskScore(cn) : 0
            const level = riskLevel(risk)
            return (
              <button key={c.id}
                className="w-full text-left rounded-lg p-2 cursor-pointer hover:border-[#334155] transition-colors"
                style={{ background: '#0A0F1A', border: '1px solid #1E293B' }}
                onClick={() => { if (cn) onSelect(cn) }}>
                <div className="flex items-start justify-between">
                  <div className="text-[10px] font-medium text-white leading-tight">{c.name}</div>
                  <div style={{ width: '5px', height: '5px', borderRadius: '50%', background: RISK_COLORS[level], flexShrink: 0, marginTop: '3px' }} />
                </div>
                <div className="text-[9px] mt-0.5" style={{ color: '#64748B' }}>
                  {c.supplier} · {fmtK(c.annualValue ?? 0)}
                </div>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function RiskBadge({ level, score }: { level: string; score: number }) {
  const color = RISK_COLORS[level as keyof typeof RISK_COLORS]
  const Icon = level === 'high' ? AlertTriangle : level === 'medium' ? Shield : ShieldCheck
  return (
    <div className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded"
      style={{ background: `${color}15`, border: `1px solid ${color}30` }}>
      <Icon size={10} color={color} />
      <span className="text-[9px] font-semibold" style={{ color }}>{level.toUpperCase()} · {score}</span>
    </div>
  )
}

function MetricCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="rounded-lg p-2" style={{ background: '#0A0F1A', border: '1px solid #1E293B' }}>
      <div className="text-[8px] uppercase tracking-wider mb-0.5" style={{ color: '#475569' }}>{label}</div>
      <div className="text-sm font-semibold tabular-nums" style={{ color }}>{value}</div>
    </div>
  )
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between py-1.5" style={{ borderBottom: '1px solid #0F172A' }}>
      <span className="text-[10px]" style={{ color: '#64748B' }}>{label}</span>
      <span className="text-[10px] text-white">{value}</span>
    </div>
  )
}

function StatRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 py-1.5" style={{ borderBottom: '1px solid #0F172A' }}>
      <span style={{ color: '#475569' }}>{icon}</span>
      <span className="flex-1 text-[10px]" style={{ color: '#64748B' }}>{label}</span>
      <span className="text-[11px] font-semibold text-white tabular-nums">{value}</span>
    </div>
  )
}

function ChipLink({ icon, label, value, onClick, warn }: {
  icon: React.ReactNode; label: string; value: string; onClick?: () => void; warn?: boolean
}) {
  return (
    <div className="flex items-center gap-2">
      <span style={{ color: '#475569' }}>{icon}</span>
      <span className="text-[9px]" style={{ color: '#64748B' }}>{label}:</span>
      {onClick ? (
        <button className="text-[10px] cursor-pointer hover:underline transition-colors"
          style={{ color: warn ? '#F59E0B' : '#38BDF8' }} onClick={onClick}>
          {value}
        </button>
      ) : (
        <span className="text-[10px]" style={{ color: warn ? '#F59E0B' : '#94A3B8' }}>{value}</span>
      )}
    </div>
  )
}
