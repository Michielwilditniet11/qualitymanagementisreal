import { useState, useMemo, useCallback } from 'react'
import { useDataStore } from '../../store/dataStore'
import { buildGraph, NODE_COLORS } from '../../graph/buildGraph'
import ForceCanvas from '../../graph/ForceCanvas'
import type { GraphNode } from '../../data/types'

function fmtMoney(v?: number) {
  return v === undefined ? '—' : '€' + Math.round(v).toLocaleString('en-US')
}

function daysDiff(d: Date): number {
  return Math.round((d.getTime() - Date.now()) / 86400000)
}

export default function WebScreen() {
  const contracts = useDataStore(s => s.getContracts())
  const [selected, setSelected] = useState<GraphNode | null>(null)
  const [visibleTypes, setVisibleTypes] = useState<Record<string, boolean>>({
    department: true, category: true, supplier: true, owner: true, contract: true,
  })
  const [searchQuery, setSearchQuery] = useState('')
  const [spendThreshold, setSpendThreshold] = useState(0)
  const [highlightExpiring, setHighlightExpiring] = useState(0)

  const { nodes, links } = useMemo(() => buildGraph(contracts, 900, 600), [contracts])

  const toggleType = useCallback((t: string) => {
    setVisibleTypes(v => {
      const next = { ...v, [t]: !v[t] }
      if (selected && !next[selected.type]) setSelected(null)
      return next
    })
  }, [selected])

  const handleLegendChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const type = e.target.dataset.type
    if (type) toggleType(type)
  }, [toggleType])

  const maxSpend = Math.max(1, ...contracts.map(c => c.annualValue ?? 0))

  return (
    <div className="flex-1 flex min-h-0">
      {/* Canvas area */}
      <div className="flex-1 flex flex-col min-h-0" onClick={handleLegendChange as any}>
        {/* Search & controls bar */}
        <div className="flex items-center gap-3 px-4 py-2 bg-[#171e2e] border-b border-[#2a3650]">
          <input
            type="text" placeholder="Search nodes…"
            value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
            className="bg-[#0f1420] border border-[#2a3650] rounded-lg px-3 py-1.5 text-sm w-52 text-white placeholder:text-[#8fa0bd]"
          />
          <div className="flex items-center gap-2 text-xs text-[#8fa0bd]">
            <label>Min spend:</label>
            <input type="range" min={0} max={maxSpend} step={1000} value={spendThreshold}
              onChange={e => setSpendThreshold(parseInt(e.target.value))}
              className="w-28 accent-[#4da3ff]" />
            <span className="text-white w-20">{fmtMoney(spendThreshold)}</span>
          </div>
          <div className="flex items-center gap-2 text-xs text-[#8fa0bd]">
            <label>Expiring within:</label>
            <select value={highlightExpiring} onChange={e => setHighlightExpiring(parseInt(e.target.value))}
              className="bg-[#0f1420] border border-[#2a3650] rounded px-2 py-1 text-white">
              <option value={0}>Off</option>
              <option value={30}>30 days</option>
              <option value={90}>90 days</option>
              <option value={180}>180 days</option>
              <option value={365}>1 year</option>
            </select>
          </div>
        </div>
        <ForceCanvas
          nodes={nodes} links={links}
          visibleTypes={visibleTypes} selected={selected}
          onSelect={setSelected}
          searchQuery={searchQuery}
          spendThreshold={spendThreshold}
          highlightExpiring={highlightExpiring}
        />
      </div>

      {/* Side panel */}
      <div className="w-80 bg-[#171e2e] border-l border-[#2a3650] p-4 overflow-y-auto">
        {!selected ? (
          <div>
            <h2 className="font-semibold mb-2">Network</h2>
            <p className="text-[#8fa0bd] text-sm">Click any node to inspect its connections, spend and risk profile.</p>
            <div className="mt-4 text-xs text-[#8fa0bd] space-y-1">
              <div>Nodes: {nodes.length}</div>
              <div>Links: {links.length}</div>
              <div>Total spend: {fmtMoney(contracts.reduce((s, c) => s + (c.annualValue ?? 0), 0))}</div>
            </div>
          </div>
        ) : selected.type === 'contract' && selected.contract ? (
          <div>
            <h2 className="font-semibold mb-1" style={{ color: NODE_COLORS.contract }}>{selected.name}</h2>
            <div className="space-y-0.5 text-sm">
              <Row k="Supplier" v={selected.contract.supplier} />
              <Row k="Category" v={selected.contract.category} />
              <Row k="Department" v={selected.contract.department} />
              <Row k="Owner" v={selected.contract.owner || '⚠ no owner'} />
              <Row k="Annual value" v={fmtMoney(selected.contract.annualValue)} />
              <Row k="Start" v={selected.contract.startDate?.toISOString().slice(0, 10) ?? '—'} />
              <Row k="End" v={selected.contract.endDate?.toISOString().slice(0, 10) ?? '—'} />
              <Row k="Status" v={selected.contract.status ?? '—'} />
              <Row k="Notice period" v={selected.contract.noticePeriodDays ? `${selected.contract.noticePeriodDays} days` : '—'} />
              <Row k="Auto-renew" v={selected.contract.autoRenew === true ? 'Yes' : selected.contract.autoRenew === false ? 'No' : '—'} />
              {selected.contract.endDate && (
                <Row k="Days to expiry" v={(() => {
                  const d = daysDiff(selected.contract.endDate!)
                  return d < 0 ? `Expired ${-d}d ago` : `${d}d`
                })()} />
              )}
            </div>
          </div>
        ) : (
          <div>
            <h2 className="font-semibold mb-1" style={{ color: NODE_COLORS[selected.type] }}>{selected.name}</h2>
            <div className="text-xs text-[#8fa0bd] mb-2">{selected.type}</div>
            <div className="space-y-0.5 text-sm">
              <Row k="Linked contracts" v={String(selected.contracts.length)} />
              <Row k="Total annual spend" v={fmtMoney(selected.value)} />
            </div>
            {/* Grouped neighbors */}
            {['department', 'category', 'supplier', 'owner'].map(t => {
              const items = [...selected.neighbors].filter(n => n.type === t && t !== 'contract')
              if (items.length === 0) return null
              return (
                <div key={t} className="mt-3">
                  <div className="text-xs text-[#8fa0bd] mb-1">{t.charAt(0).toUpperCase() + t.slice(1)}s:</div>
                  <div className="flex flex-wrap gap-1">
                    {items.map(n => (
                      <span key={n.key} className="bg-[#1d2639] border border-[#2a3650] text-[#8fa0bd] text-[11px] px-2 py-0.5 rounded-full cursor-pointer hover:text-white"
                        onClick={() => setSelected(n)}>{n.name}</span>
                    ))}
                  </div>
                </div>
              )
            })}
            {/* Contract list */}
            <div className="mt-3">
              <div className="text-xs text-[#8fa0bd] mb-1">Contracts:</div>
              <div className="space-y-1">
                {selected.contracts.slice(0, 20).map(c => (
                  <div key={c.id} className="text-xs bg-[#0f1420] rounded p-1.5 cursor-pointer hover:bg-[#1d2639]"
                    onClick={() => { const cn = nodes.find(n => n.type === 'contract' && n.contract?.id === c.id); if (cn) setSelected(cn) }}>
                    <div className="font-medium">{c.name}</div>
                    <div className="text-[#8fa0bd]">{c.supplier} · {fmtMoney(c.annualValue)}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between py-1 border-b border-[#2a3650]/50">
      <span className="text-[#8fa0bd]">{k}</span>
      <span>{v}</span>
    </div>
  )
}
