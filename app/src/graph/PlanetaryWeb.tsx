import { useRef, useEffect, useMemo } from 'react'
import ForceGraph3DImport from '3d-force-graph'
const ForceGraph3D = ForceGraph3DImport as any
import * as THREE from 'three'
import type { GraphNode } from '../data/types'
import { NODE_COLORS, TYPE_LABELS } from './buildGraph'
import { riskScore, riskLevel, RISK_COLORS, fmtK } from '../analytics/risk'
import { lensStyle, buildLensContext, LENSES, type LensId } from '../analytics/lenses'
import { egoNetwork } from '../analytics/centrality'

/* ─── Props ─── */
interface Props {
  nodes: GraphNode[]
  links: { source: GraphNode; target: GraphNode }[]
  visibleTypes: Record<string, boolean>
  selected: GraphNode | null
  onSelect: (n: GraphNode | null) => void
  searchQuery: string
  spendThreshold: number
  highlightExpiring: number
  lens: LensId
  /** Nodes pinned by an insight; everything else dims. */
  highlightKeys?: Set<string> | null
  /** Node whose ego network is isolated; everything outside it dims hard. */
  focusNode?: GraphNode | null
  onFocus?: (n: GraphNode | null) => void
}

/* ─── Constants ─── */
const BG = '#080C14'

interface FGNode {
  id: string
  graphNode: GraphNode
  type: string
  name: string
  /** Size before the active lens applies its multiplier. */
  baseVal: number
  val: number
  color: string
  riskLvl: 'high' | 'medium' | 'low'
  ring?: string
  labelAlways?: boolean
  /** Risk glow only reads as signal in lenses that are about risk. */
  showRiskGlow?: boolean
}

interface FGLink {
  source: string
  target: string
}

function makeNodeObject(n: FGNode, selected: GraphNode | null, highlightSet: Set<string> | null, expiringSet: Set<string>): THREE.Object3D {
  const isDim = highlightSet && !highlightSet.has(n.id)
  const group = new THREE.Group()

  if (isDim) {
    const geo = new THREE.SphereGeometry(Math.cbrt(n.val) * 0.8, 8, 8)
    const mat = new THREE.MeshLambertMaterial({ color: '#1F2937', transparent: true, opacity: 0.15 })
    group.add(new THREE.Mesh(geo, mat))
    return group
  }

  // Number label sprite
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 64
  const ctx = canvas.getContext('2d')!
  ctx.clearRect(0, 0, 128, 64)
  ctx.fillStyle = '#FFFFFF'
  ctx.font = 'bold 36px Inter, system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(String(n.graphNode.contracts.length), 64, 32)
  const texture = new THREE.CanvasTexture(canvas)
  const spriteMat = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false })
  const sprite = new THREE.Sprite(spriteMat)
  const r = Math.cbrt(n.val)
  sprite.scale.set(r * 5, r * 2.5, 1)
  group.add(sprite)

  // High-risk glow
  if (n.showRiskGlow && n.type === 'contract' && n.riskLvl === 'high') {
    const glowGeo = new THREE.SphereGeometry(r * 2.5, 16, 16)
    const glowMat = new THREE.MeshBasicMaterial({ color: '#DC2626', transparent: true, opacity: 0.12, side: THREE.BackSide })
    group.add(new THREE.Mesh(glowGeo, glowMat))
  }

  // Lens-driven emphasis ring
  if (n.ring) {
    const lensRingGeo = new THREE.RingGeometry(r * 2.6, r * 3.1, 32)
    const lensRingMat = new THREE.MeshBasicMaterial({ color: n.ring, transparent: true, opacity: 0.55, side: THREE.DoubleSide })
    group.add(new THREE.Mesh(lensRingGeo, lensRingMat))
  }

  // Expiring ring
  if (expiringSet.has(n.id)) {
    const ringGeo = new THREE.RingGeometry(r * 2, r * 2.5, 32)
    const ringMat = new THREE.MeshBasicMaterial({ color: '#D97706', transparent: true, opacity: 0.5, side: THREE.DoubleSide })
    group.add(new THREE.Mesh(ringGeo, ringMat))
  }

  // Selection ring
  if (selected && selected.key === n.id) {
    const selGeo = new THREE.RingGeometry(r * 2.2, r * 2.8, 32)
    const selMat = new THREE.MeshBasicMaterial({ color: '#60A5FA', transparent: true, opacity: 0.8, side: THREE.DoubleSide })
    group.add(new THREE.Mesh(selGeo, selMat))
  }

  // Name label below
  if (!isDim && (selected?.key === n.id || n.labelAlways || (highlightSet?.has(n.id)) || n.type !== 'contract')) {
    const lCanvas = document.createElement('canvas')
    lCanvas.width = 256
    lCanvas.height = 48
    const lCtx = lCanvas.getContext('2d')!
    lCtx.clearRect(0, 0, 256, 48)
    lCtx.fillStyle = selected?.key === n.id ? '#FFFFFF' : '#9CA3AF'
    lCtx.font = `${selected?.key === n.id ? 'bold ' : ''}18px Inter, system-ui, sans-serif`
    lCtx.textAlign = 'center'
    lCtx.textBaseline = 'middle'
    const label = n.name.length > 24 ? n.name.slice(0, 23) + '…' : n.name
    lCtx.fillText(label, 128, 20)
    if (n.graphNode.value > 0) {
      lCtx.fillStyle = '#6B7280'
      lCtx.font = '13px Inter, system-ui, sans-serif'
      lCtx.fillText(fmtK(n.graphNode.value), 128, 40)
    }
    const lTex = new THREE.CanvasTexture(lCanvas)
    const lSpriteMat = new THREE.SpriteMaterial({ map: lTex, transparent: true, depthWrite: false })
    const lSprite = new THREE.Sprite(lSpriteMat)
    lSprite.scale.set(r * 8, r * 1.5, 1)
    lSprite.position.y = -(r * 2.5)
    group.add(lSprite)
  }

  return group
}

/* ─── Exported wrapper ─── */
export default function PlanetaryWeb(props: Props) {
  const { nodes, links, visibleTypes, selected, onSelect, searchQuery, spendThreshold, highlightExpiring, lens, highlightKeys, focusNode, onFocus } = props
  const containerRef = useRef<HTMLDivElement>(null)
  const graphRef = useRef<any>(null)
  const selectedRef = useRef(selected)
  selectedRef.current = selected
  const onSelectRef = useRef(onSelect)
  onSelectRef.current = onSelect
  const onFocusRef = useRef(onFocus)
  onFocusRef.current = onFocus
  const lastClickRef = useRef<{ key: string | null; at: number }>({ key: null, at: 0 })

  const maxValue = useMemo(() => Math.max(1, ...nodes.map(n => n.value)), [nodes])
  const lensCtx = useMemo(() => buildLensContext(nodes), [nodes])

  const { fgNodes, fgLinks } = useMemo(() => {
    const visibleNodes = nodes.filter(n => {
      if (!visibleTypes[n.type]) return false
      if (n.type === 'contract' && spendThreshold > 0 && (n.contract?.annualValue ?? 0) < spendThreshold) return false
      return true
    })
    const visKeys = new Set(visibleNodes.map(n => n.key))

    const fgNodes: FGNode[] = visibleNodes.map(n => {
      const lvl = riskLevel(riskScore(n))
      const baseVal = n.type === 'contract'
        ? 3 + 12 * Math.sqrt((n.contract?.annualValue ?? 0) / maxValue)
        : ({ department: 10, category: 8, supplier: 6, owner: 5 } as Record<string, number>)[n.type] || 6
      return {
        id: n.key,
        graphNode: n,
        type: n.type,
        name: n.name,
        baseVal,
        val: baseVal,
        color: NODE_COLORS[n.type] || '#E4E4E7',
        riskLvl: lvl,
      }
    })

    const fgLinks: FGLink[] = []
    const seen = new Set<string>()
    for (const l of links) {
      if (!visKeys.has(l.source.key) || !visKeys.has(l.target.key)) continue
      const k = l.source.key < l.target.key ? `${l.source.key}|${l.target.key}` : `${l.target.key}|${l.source.key}`
      if (seen.has(k)) continue
      seen.add(k)
      fgLinks.push({ source: l.source.key, target: l.target.key })
    }

    return { fgNodes, fgLinks }
  }, [nodes, links, visibleTypes, spendThreshold, maxValue])

  // Precedence: focus isolates its ego network and overrides everything else.
  // Otherwise an insight's highlight wins over selection-neighbourhood
  // highlighting; when both are active the selection is added on top.
  const highlightSet = useMemo(() => {
    if (focusNode) {
      const s = egoNetwork(focusNode, 2)
      if (selected) s.add(selected.key)
      return s
    }
    if (highlightKeys && highlightKeys.size > 0) {
      const s = new Set(highlightKeys)
      if (selected) {
        s.add(selected.key)
        for (const nb of selected.neighbors) s.add(nb.key)
      }
      return s
    }
    if (!selected) return null
    const s = new Set([selected.key])
    for (const nb of selected.neighbors) s.add(nb.key)
    return s
  }, [selected, highlightKeys, focusNode])

  const highlightSetRef = useRef(highlightSet)
  highlightSetRef.current = highlightSet

  const expiringSet = useMemo(() => {
    const s = new Set<string>()
    if (highlightExpiring > 0) {
      for (const n of nodes) {
        if (n.type === 'contract' && n.contract?.endDate) {
          const d = (n.contract.endDate.getTime() - Date.now()) / 86400000
          if (d > 0 && d <= highlightExpiring) s.add(n.key)
        }
      }
    }
    return s
  }, [nodes, highlightExpiring])

  const expiringSetRef = useRef(expiringSet)
  expiringSetRef.current = expiringSet

  const searchTerm = searchQuery.trim().toLowerCase()

  // Initialize graph once
  useEffect(() => {
    if (!containerRef.current) return
    const el = containerRef.current

    const graph = ForceGraph3D()(el)
      .backgroundColor(BG)
      .showNavInfo(false)
      .nodeRelSize(1.5)
      .nodeVal('val')
      .nodeLabel((n: any) => `<div style="background:rgba(8,12,20,0.95);padding:6px 10px;border-radius:6px;border:1px solid #1F2937;font-family:Inter,system-ui,sans-serif;font-size:11px;color:#E5E7EB;pointer-events:none;max-width:240px;">
        <div style="font-weight:600;margin-bottom:2px;">${n.name}</div>
        <div style="color:#9CA3AF;font-size:9px;">${n.type} · ${fmtK(n.graphNode.value)}</div>
      </div>`)
      .nodeColor((n: any) => {
        const hs = highlightSetRef.current
        if (hs && !hs.has(n.id)) return '#1F2937'
        return n.color
      })
      .nodeOpacity(0.92)
      .nodeThreeObjectExtend(true)
      .nodeThreeObject((n: any) => makeNodeObject(n, selectedRef.current, highlightSetRef.current, expiringSetRef.current))
      .linkColor((l: any) => {
        const hs = highlightSetRef.current
        const sel = selectedRef.current
        if (!hs) return 'rgba(100,116,139,0.35)'
        const sId = typeof l.source === 'object' ? l.source.id : l.source
        const tId = typeof l.target === 'object' ? l.target.id : l.target
        if (sel && (sId === sel.key || tId === sel.key)) return '#60A5FA'
        if (hs.has(sId) && hs.has(tId)) return 'rgba(148,163,184,0.45)'
        return 'rgba(31,41,55,0.12)'
      })
      .linkWidth(0.5)
      .linkOpacity(0.8)
      .onNodeClick((n: any) => {
        if (!n) return
        const gn = n.graphNode as GraphNode

        // Second click on the same node inside the double-click window focuses it.
        const now = performance.now()
        if (lastClickRef.current.key === gn.key && now - lastClickRef.current.at < 400) {
          lastClickRef.current = { key: null, at: 0 }
          onFocusRef.current?.(gn)
          onSelectRef.current(gn)
          return
        }
        lastClickRef.current = { key: gn.key, at: now }

        if (selectedRef.current === gn) {
          onSelectRef.current(null)
        } else {
          onSelectRef.current(gn)
          graph.cameraPosition(
            { x: n.x + 50, y: n.y + 25, z: n.z + 50 },
            { x: n.x, y: n.y, z: n.z },
            800
          )
        }
      })
      .onBackgroundClick(() => {
        onSelectRef.current(null)
        onFocusRef.current?.(null)
      })
      .d3VelocityDecay(0.3)
      .d3AlphaDecay(0.02)
      .cooldownTime(5000)

    // Grid floor
    const gridHelper = new THREE.GridHelper(400, 40, '#1F2937', '#111827')
    gridHelper.position.y = -80
    graph.scene().add(gridHelper)

    // Better lighting
    const scene = graph.scene()
    scene.fog = new THREE.Fog(BG, 600, 2200)
    const existing = scene.children.filter((c: any) => c.isLight)
    existing.forEach((l: any) => scene.remove(l))
    scene.add(new THREE.AmbientLight('#E5E7EB', 0.4))
    const dir1 = new THREE.DirectionalLight('#F0F0F0', 0.6)
    dir1.position.set(60, 80, 40)
    scene.add(dir1)
    const dir2 = new THREE.DirectionalLight('#D4D4D8', 0.3)
    dir2.position.set(-30, 40, -20)
    scene.add(dir2)

    graphRef.current = graph

    return () => { graph._destructor() }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Update data on changes
  useEffect(() => {
    if (!graphRef.current) return
    graphRef.current.graphData({ nodes: fgNodes, links: fgLinks })
    // Poll for node positions to stabilize then zoom
    let attempts = 0
    const poll = setInterval(() => {
      attempts++
      const gd = graphRef.current?.graphData()
      if (!gd?.nodes?.length) return
      const first = gd.nodes[0]
      // Nodes start at 0,0,0 — wait until they have non-zero positions
      if (first.x === 0 && first.y === 0 && first.z === 0 && attempts < 50) return
      clearInterval(poll)
      // Center nodes
      let cx = 0, cy = 0, cz = 0
      for (const n of gd.nodes) { cx += n.x || 0; cy += n.y || 0; cz += n.z || 0 }
      cx /= gd.nodes.length; cy /= gd.nodes.length; cz /= gd.nodes.length
      let maxR = 0
      for (const n of gd.nodes) {
        const d = Math.sqrt(((n.x||0) - cx) ** 2 + ((n.y||0) - cy) ** 2 + ((n.z||0) - cz) ** 2)
        if (d > maxR) maxR = d
      }
      const dist = Math.min(Math.max(maxR * 2.5, 150), 900)
      graphRef.current?.cameraPosition(
        { x: cx, y: cy + dist * 0.3, z: cz + dist },
        { x: cx, y: cy, z: cz },
        600
      )
    }, 100)
    return () => clearInterval(poll)
  }, [fgNodes, fgLinks])

  // Apply the active lens by mutating existing node objects, so the force
  // layout keeps the positions it has already settled on.
  useEffect(() => {
    for (const n of fgNodes) {
      const style = lensStyle(n.graphNode, lens, lensCtx)
      n.color = style.color
      n.val = n.baseVal * style.sizeMult
      n.ring = style.ring
      n.labelAlways = style.labelAlways
      n.showRiskGlow = lens === 'structure' || lens === 'risk'
    }
    if (!graphRef.current) return
    graphRef.current.nodeColor(graphRef.current.nodeColor())
    graphRef.current.nodeVal(graphRef.current.nodeVal())
    graphRef.current.nodeThreeObject(graphRef.current.nodeThreeObject())
  }, [lens, lensCtx, fgNodes])

  // Refresh visuals on selection/highlight change
  useEffect(() => {
    if (!graphRef.current) return
    graphRef.current.nodeColor(graphRef.current.nodeColor())
    graphRef.current.nodeThreeObject(graphRef.current.nodeThreeObject())
    graphRef.current.linkColor(graphRef.current.linkColor())
  }, [highlightSet, selected, expiringSet])

  // Ease the camera onto a focused node's ego network
  useEffect(() => {
    if (!graphRef.current || !focusNode) return
    const ego = egoNetwork(focusNode, 2)
    const gd = graphRef.current.graphData()
    const targets = gd.nodes.filter((n: any) => ego.has(n.id) && n.x !== undefined)
    if (targets.length === 0) return
    let cx = 0, cy = 0, cz = 0
    for (const n of targets) { cx += n.x; cy += n.y; cz += n.z }
    cx /= targets.length; cy /= targets.length; cz /= targets.length
    let maxR = 0
    for (const n of targets) {
      const d = Math.sqrt((n.x - cx) ** 2 + (n.y - cy) ** 2 + (n.z - cz) ** 2)
      if (d > maxR) maxR = d
    }
    const dist = Math.min(Math.max(maxR * 2, 110), 900)
    graphRef.current.cameraPosition(
      { x: cx, y: cy + dist * 0.25, z: cz + dist },
      { x: cx, y: cy, z: cz },
      800
    )
  }, [focusNode])

  // Esc leaves focus mode
  useEffect(() => {
    if (!focusNode) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onFocusRef.current?.(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [focusNode])

  // Frame the nodes an insight points at
  useEffect(() => {
    if (!graphRef.current || !highlightKeys || highlightKeys.size === 0) return
    const gd = graphRef.current.graphData()
    const targets = gd.nodes.filter((n: any) => highlightKeys.has(n.id) && n.x !== undefined)
    if (targets.length === 0) return
    let cx = 0, cy = 0, cz = 0
    for (const n of targets) { cx += n.x; cy += n.y; cz += n.z }
    cx /= targets.length; cy /= targets.length; cz /= targets.length
    let maxR = 0
    for (const n of targets) {
      const d = Math.sqrt((n.x - cx) ** 2 + (n.y - cy) ** 2 + (n.z - cz) ** 2)
      if (d > maxR) maxR = d
    }
    // Keep the framing inside the fog range, or the subject fades to background.
    const dist = Math.min(Math.max(maxR * 2.2, 120), 900)
    graphRef.current.cameraPosition(
      { x: cx, y: cy + dist * 0.25, z: cz + dist },
      { x: cx, y: cy, z: cz },
      900
    )
  }, [highlightKeys])

  // Search fly-to
  useEffect(() => {
    if (!graphRef.current || !searchTerm) return
    const gd = graphRef.current.graphData()
    const matched = gd.nodes.find((n: any) => n.name.toLowerCase().includes(searchTerm))
    if (matched && matched.x !== undefined) {
      onSelect(matched.graphNode)
      graphRef.current.cameraPosition(
        { x: matched.x + 50, y: matched.y + 25, z: matched.z + 50 },
        { x: matched.x, y: matched.y, z: matched.z },
        800
      )
    }
  }, [searchTerm]) // eslint-disable-line react-hooks/exhaustive-deps

  // Resize
  useEffect(() => {
    if (!graphRef.current || !containerRef.current) return
    const ro = new ResizeObserver(entries => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect
        graphRef.current?.width(width).height(height)
      }
    })
    ro.observe(containerRef.current)
    return () => ro.disconnect()
  }, [])

  // Risk stats
  const riskStats = useMemo(() => {
    let high = 0, medium = 0, low = 0, totalAtRisk = 0, orphan = 0
    for (const n of nodes) {
      if (n.type !== 'contract') continue
      const r = riskScore(n)
      if (r >= 40) { high++; totalAtRisk += n.contract?.annualValue ?? 0 }
      else if (r >= 20) { medium++; totalAtRisk += n.contract?.annualValue ?? 0 }
      else low++
      if (!n.contract?.owner) orphan++
    }
    return { high, medium, low, totalAtRisk, orphan }
  }, [nodes])

  const lensDef = LENSES.find(l => l.id === lens) ?? LENSES[0]

  const totalSpend = useMemo(() =>
    nodes.filter(n => n.type === 'contract').reduce((s, n) => s + (n.contract?.annualValue ?? 0), 0),
    [nodes]
  )

  return (
    <div className="flex-1 relative overflow-hidden min-w-0" style={{ background: BG }}>
      {/* Absolute so the renderer's own pixel width never feeds back into the flex layout. */}
      <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />

      {/* ─── HUD: Top-right risk summary ─── */}
      <div className="absolute top-3 right-3 rounded-lg p-3"
        style={{ background: 'rgba(8,12,20,0.9)', border: '1px solid #1F2937', backdropFilter: 'blur(12px)', minWidth: '170px', pointerEvents: 'none' }}>
        <div className="text-[10px] font-semibold tracking-wider mb-2" style={{ color: '#6B7280', fontFamily: "'Inter', sans-serif" }}>
          RISK OVERVIEW
        </div>
        {[
          { label: 'High risk', count: riskStats.high, color: RISK_COLORS.high },
          { label: 'Medium risk', count: riskStats.medium, color: RISK_COLORS.medium },
          { label: 'Low risk', count: riskStats.low, color: RISK_COLORS.low },
        ].map(({ label, count, color }) => (
          <div key={label} className="flex items-center gap-2 mb-1">
            <div style={{ width: '6px', height: '6px', borderRadius: label === 'High risk' ? '1px' : '50%', background: color }} />
            <span className="flex-1 text-[10px]" style={{ color: '#9CA3AF', fontFamily: "'Inter', sans-serif" }}>{label}</span>
            <span className="text-[11px] font-bold tabular-nums" style={{ color, fontFamily: "'Inter', sans-serif" }}>{count}</span>
          </div>
        ))}
        <div className="mt-2 pt-2" style={{ borderTop: '1px solid #1F2937' }}>
          <div className="flex justify-between text-[9px]" style={{ fontFamily: "'Inter', sans-serif" }}>
            <span style={{ color: '#6B7280' }}>Spend at risk</span>
            <span className="font-bold" style={{ color: RISK_COLORS.high }}>{fmtK(riskStats.totalAtRisk)}</span>
          </div>
          <div className="flex justify-between text-[9px] mt-0.5" style={{ fontFamily: "'Inter', sans-serif" }}>
            <span style={{ color: '#6B7280' }}>Orphan contracts</span>
            <span className="font-bold" style={{ color: RISK_COLORS.medium }}>{riskStats.orphan}</span>
          </div>
          <div className="flex justify-between text-[9px] mt-0.5" style={{ fontFamily: "'Inter', sans-serif" }}>
            <span style={{ color: '#6B7280' }}>Total spend</span>
            <span className="font-bold" style={{ color: '#E5E7EB' }}>{fmtK(totalSpend)}</span>
          </div>
        </div>
      </div>

      {/* ─── HUD: Top-left legend ─── */}
      <div className="absolute top-3 left-3 rounded-lg p-3"
        style={{ background: 'rgba(8,12,20,0.9)', border: '1px solid #1F2937', backdropFilter: 'blur(12px)' }}>
        <div className="text-[10px] font-semibold tracking-wider mb-0.5" style={{ color: '#6B7280', fontFamily: "'Inter', sans-serif" }}>
          {lensDef.label.toUpperCase()} LENS
        </div>
        <div className="text-[9px] mb-2" style={{ color: '#4B5563', fontFamily: "'Inter', sans-serif" }}>
          {lensDef.question}
        </div>

        {lensDef.scale.length > 0 && (
          <div className="mb-2 pb-2" style={{ borderBottom: '1px solid #1F2937' }}>
            {lensDef.scale.map(s => (
              <div key={s.label} className="flex items-center gap-2 mb-1">
                <div style={{ width: '8px', height: '8px', borderRadius: '2px', background: s.color }} />
                <span className="text-[10px]" style={{ color: '#9CA3AF', fontFamily: "'Inter', sans-serif" }}>{s.label}</span>
              </div>
            ))}
          </div>
        )}

        <div className="text-[10px] font-semibold tracking-wider mb-2" style={{ color: '#6B7280', fontFamily: "'Inter', sans-serif" }}>
          NODE TYPES
        </div>
        {Object.entries(TYPE_LABELS).map(([t, label]) => {
          const count = nodes.filter(n => n.type === t).length
          return (
            <label key={t} className="flex items-center gap-2 cursor-pointer mb-1">
              <input type="checkbox" checked={visibleTypes[t]} readOnly data-type={t}
                className="accent-[#60A5FA]" style={{ width: '11px', height: '11px' }} />
              <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: NODE_COLORS[t] }} />
              <span className="flex-1 text-[10px]" style={{ color: '#9CA3AF', fontFamily: "'Inter', sans-serif" }}>{label}</span>
              <span className="text-[10px] tabular-nums font-semibold" style={{ color: '#6B7280', fontFamily: "'Inter', sans-serif" }}>{count}</span>
            </label>
          )
        })}
        <div className="mt-2 pt-2" style={{ borderTop: '1px solid #1F2937' }}>
          <div className="text-[8px] tracking-wider mb-1" style={{ color: '#6B7280', fontFamily: "'Inter', sans-serif" }}>
            NUMBER = LINKED CONTRACTS
          </div>
          <div className="text-[8px] tracking-wider" style={{ color: '#6B7280', fontFamily: "'Inter', sans-serif" }}>
            SIZE = SPEND VOLUME
          </div>
        </div>
      </div>

      {/* ─── HUD: Focus banner ─── */}
      {focusNode && (
        <div className="absolute left-1/2 top-3 rounded-lg px-3 py-1.5 flex items-center gap-2"
          style={{
            transform: 'translateX(-50%)', background: 'rgba(8,12,20,0.92)',
            border: '1px solid #334155', backdropFilter: 'blur(12px)',
          }}>
          <span className="text-[10px]" style={{ color: '#94A3B8', fontFamily: "'Inter', sans-serif" }}>
            Focused on <span style={{ color: '#F1F5F9', fontWeight: 600 }}>{focusNode.name}</span>
          </span>
          <button onClick={() => onFocus?.(null)}
            className="text-[9px] px-1.5 py-0.5 rounded cursor-pointer hover:text-white"
            style={{ background: '#1E293B', color: '#94A3B8', fontFamily: "'Inter', sans-serif" }}>
            Exit · Esc
          </button>
        </div>
      )}

      {/* ─── HUD: Bottom info ─── */}
      <div className="absolute bottom-3 left-3" style={{ pointerEvents: 'none' }}>
        <span className="text-[9px] font-medium" style={{ color: '#374151', fontFamily: "'Inter', sans-serif" }}>
          {nodes.length} nodes · {links.length} connections
        </span>
      </div>
      <div className="absolute bottom-3 right-3" style={{ pointerEvents: 'none' }}>
        <span className="text-[9px]" style={{ color: '#374151', fontFamily: "'Inter', sans-serif" }}>
          Orbit · Zoom · Click to inspect · Double-click to focus
        </span>
      </div>
    </div>
  )
}

export { riskScore, riskLevel, riskReasons, RISK_COLORS, fmtK, fmtDate, daysDiff } from '../analytics/risk'
