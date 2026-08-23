import { useRef, useEffect, useCallback, useState } from 'react'
import type { GraphNode, GraphLink } from '../data/types'
import { NODE_COLORS, nodeRadius, TYPE_LABELS } from './buildGraph'

interface Props {
  nodes: GraphNode[]
  links: GraphLink[]
  visibleTypes: Record<string, boolean>
  selected: GraphNode | null
  onSelect: (n: GraphNode | null) => void
  searchQuery: string
  spendThreshold: number
  highlightExpiring: number
}

export default function ForceCanvas({ nodes, links, visibleTypes, selected, onSelect, searchQuery, spendThreshold, highlightExpiring }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const viewRef = useRef({ x: 0, y: 0, k: 1 })
  const dragRef = useRef<{ node: GraphNode | null; panning: boolean; last: { x: number; y: number } | null; moved: boolean }>({ node: null, panning: false, last: null, moved: false })
  const alphaRef = useRef(1)
  const animRef = useRef(0)
  const [, setTick] = useState(0)

  const maxValue = Math.max(1, ...nodes.map(n => n.value))

  const now = Date.now()
  const expiringSet = new Set<string>()
  if (highlightExpiring > 0) {
    for (const n of nodes) {
      if (n.type === 'contract' && n.contract?.endDate) {
        const d = (n.contract.endDate.getTime() - now) / 86400000
        if (d > 0 && d <= highlightExpiring) expiringSet.add(n.key)
      }
    }
  }

  const searchMatch = searchQuery.trim().toLowerCase()
  const matchedNode = searchMatch ? nodes.find(n => n.name.toLowerCase().includes(searchMatch) && visibleTypes[n.type]) : null

  const visibleNodes = nodes.filter(n => {
    if (!visibleTypes[n.type]) return false
    if (n.type === 'contract' && spendThreshold > 0 && (n.contract?.annualValue ?? 0) < spendThreshold) return false
    return true
  })
  const visibleSet = new Set(visibleNodes.map(n => n.key))

  const simulate = useCallback(() => {
    if (alphaRef.current < 0.005 || visibleNodes.length === 0) return
    const W = canvasRef.current?.clientWidth ?? 900
    const H = canvasRef.current?.clientHeight ?? 600
    for (let i = 0; i < visibleNodes.length; i++) {
      for (let j = i + 1; j < visibleNodes.length; j++) {
        const a = visibleNodes[i], b = visibleNodes[j]
        let dx = b.x - a.x, dy = b.y - a.y
        let d2 = dx * dx + dy * dy
        if (d2 < 1) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; d2 = 1 }
        const f = 1800 / d2 * alphaRef.current
        const d = Math.sqrt(d2)
        dx /= d; dy /= d
        a.vx -= dx * f; a.vy -= dy * f; b.vx += dx * f; b.vy += dy * f
      }
    }
    for (const l of links) {
      if (!visibleSet.has(l.source.key) || !visibleSet.has(l.target.key)) continue
      const dx = l.target.x - l.source.x, dy = l.target.y - l.source.y
      const d = Math.max(1, Math.hypot(dx, dy))
      const target = 70 + nodeRadius(l.source, maxValue) + nodeRadius(l.target, maxValue)
      const f = (d - target) * 0.02 * alphaRef.current
      const fx = dx / d * f, fy = dy / d * f
      l.source.vx += fx; l.source.vy += fy; l.target.vx -= fx; l.target.vy -= fy
    }
    for (const n of visibleNodes) {
      n.vx += (W / 2 - n.x) * 0.002 * alphaRef.current
      n.vy += (H / 2 - n.y) * 0.002 * alphaRef.current
      if (n !== dragRef.current.node) { n.x += n.vx; n.y += n.vy }
      n.vx *= 0.85; n.vy *= 0.85
    }
    alphaRef.current *= 0.995
  }, [visibleNodes, links, maxValue, visibleSet])

  useEffect(() => {
    alphaRef.current = 1
  }, [nodes])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!

    function draw() {
      simulate()
      const dpr = devicePixelRatio
      canvas!.width = canvas!.clientWidth * dpr
      canvas!.height = canvas!.clientHeight * dpr
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, canvas!.clientWidth, canvas!.clientHeight)
      const v = viewRef.current
      ctx.save()
      ctx.translate(v.x, v.y)
      ctx.scale(v.k, v.k)

      const hl = selected ? new Set([selected.key, ...[...selected.neighbors].map(n => n.key)]) : null

      for (const l of links) {
        if (!visibleSet.has(l.source.key) || !visibleSet.has(l.target.key)) continue
        const on = hl && (l.source === selected || l.target === selected)
        ctx.strokeStyle = on ? 'rgba(255,255,255,0.55)' : (hl ? 'rgba(80,100,140,0.10)' : 'rgba(120,145,190,0.22)')
        ctx.lineWidth = on ? 1.8 : 1
        ctx.beginPath(); ctx.moveTo(l.source.x, l.source.y); ctx.lineTo(l.target.x, l.target.y); ctx.stroke()
      }

      for (const n of visibleNodes) {
        const r = nodeRadius(n, maxValue)
        const dim = hl && !hl.has(n.key)
        ctx.globalAlpha = dim ? 0.18 : 1

        const isExpiring = expiringSet.has(n.key)
        const isSearchMatch = matchedNode === n

        if (isSearchMatch) {
          ctx.fillStyle = '#fff'
          ctx.beginPath(); ctx.arc(n.x, n.y, r + 5, 0, Math.PI * 2); ctx.fill()
        }
        if (isExpiring) {
          ctx.fillStyle = 'rgba(255,107,129,0.35)'
          ctx.beginPath(); ctx.arc(n.x, n.y, r + 4, 0, Math.PI * 2); ctx.fill()
        }

        ctx.fillStyle = NODE_COLORS[n.type]
        ctx.beginPath(); ctx.arc(n.x, n.y, r, 0, Math.PI * 2); ctx.fill()

        if (n === selected) {
          ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.5; ctx.stroke()
        }

        if (!dim && (n.type !== 'contract' || v.k > 1.2 || n === selected || (hl && hl.has(n.key)))) {
          ctx.fillStyle = '#dfe7f5'
          ctx.font = `${Math.round(11 / Math.max(v.k, 0.5))}px "Segoe UI", system-ui, sans-serif`
          ctx.textAlign = 'center'
          const label = n.name.length > 28 ? n.name.slice(0, 27) + '…' : n.name
          ctx.fillText(label, n.x, n.y + r + 13)
        }
        ctx.globalAlpha = 1
      }
      ctx.restore()
      animRef.current = requestAnimationFrame(draw)
    }
    animRef.current = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(animRef.current)
  }, [visibleNodes, links, selected, simulate, maxValue, visibleSet, expiringSet, matchedNode])

  // Center on search match
  useEffect(() => {
    if (matchedNode) {
      const canvas = canvasRef.current
      if (!canvas) return
      const v = viewRef.current
      v.x = canvas.clientWidth / 2 - matchedNode.x * v.k
      v.y = canvas.clientHeight / 2 - matchedNode.y * v.k
      onSelect(matchedNode)
    }
  }, [matchedNode, onSelect])

  function toWorld(e: React.PointerEvent | PointerEvent): { x: number; y: number } {
    const rect = canvasRef.current!.getBoundingClientRect()
    const v = viewRef.current
    return { x: (e.clientX - rect.left - v.x) / v.k, y: (e.clientY - rect.top - v.y) / v.k }
  }

  function pick(p: { x: number; y: number }): GraphNode | null {
    for (let i = visibleNodes.length - 1; i >= 0; i--) {
      const n = visibleNodes[i]
      if (Math.hypot(n.x - p.x, n.y - p.y) < nodeRadius(n, maxValue) + 4) return n
    }
    return null
  }

  function onPointerDown(e: React.PointerEvent) {
    canvasRef.current?.setPointerCapture(e.pointerId)
    const p = toWorld(e)
    const node = pick(p)
    dragRef.current = { node, panning: !node, last: { x: e.clientX, y: e.clientY }, moved: false }
    canvasRef.current!.style.cursor = 'grabbing'
  }
  function onPointerMove(e: React.PointerEvent) {
    const d = dragRef.current
    if (!d.last) return
    const dx = e.clientX - d.last.x, dy = e.clientY - d.last.y
    if (Math.abs(dx) + Math.abs(dy) > 2) d.moved = true
    if (d.node) {
      const p = toWorld(e)
      d.node.x = p.x; d.node.y = p.y
      alphaRef.current = Math.max(alphaRef.current, 0.3)
    } else if (d.panning) {
      viewRef.current.x += dx; viewRef.current.y += dy
    }
    d.last = { x: e.clientX, y: e.clientY }
  }
  function onPointerUp(e: React.PointerEvent) {
    if (!dragRef.current.moved) {
      const n = pick(toWorld(e))
      onSelect(n === selected ? null : n)
    }
    dragRef.current = { node: null, panning: false, last: null, moved: false }
    canvasRef.current!.style.cursor = 'grab'
  }
  function onWheel(e: React.WheelEvent) {
    e.preventDefault()
    const rect = canvasRef.current!.getBoundingClientRect()
    const mx = e.clientX - rect.left, my = e.clientY - rect.top
    const v = viewRef.current
    const k2 = Math.min(4, Math.max(0.2, v.k * (e.deltaY < 0 ? 1.12 : 0.89)))
    v.x = mx - (mx - v.x) * k2 / v.k
    v.y = my - (my - v.y) * k2 / v.k
    v.k = k2
    setTick(t => t + 1)
  }

  function fitToView() {
    if (visibleNodes.length === 0) return
    const canvas = canvasRef.current
    if (!canvas) return
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const n of visibleNodes) {
      const r = nodeRadius(n, maxValue)
      if (n.x - r < minX) minX = n.x - r
      if (n.y - r < minY) minY = n.y - r
      if (n.x + r > maxX) maxX = n.x + r
      if (n.y + r > maxY) maxY = n.y + r
    }
    const pad = 60
    const w = maxX - minX + pad * 2
    const h = maxY - minY + pad * 2
    const k = Math.min(canvas.clientWidth / w, canvas.clientHeight / h, 2)
    viewRef.current = {
      x: canvas.clientWidth / 2 - (minX + maxX) / 2 * k,
      y: canvas.clientHeight / 2 - (minY + maxY) / 2 * k,
      k,
    }
    setTick(t => t + 1)
  }

  function reLayout() {
    const W = canvasRef.current?.clientWidth ?? 900
    const H = canvasRef.current?.clientHeight ?? 600
    for (const n of nodes) {
      n.x = W / 2 + (Math.random() - 0.5) * W * 0.7
      n.y = H / 2 + (Math.random() - 0.5) * H * 0.7
      n.vx = 0; n.vy = 0
    }
    alphaRef.current = 1
    viewRef.current = { x: 0, y: 0, k: 1 }
  }

  function exportPNG() {
    const canvas = canvasRef.current
    if (!canvas) return
    const link = document.createElement('a')
    link.download = 'procurement-web.png'
    link.href = canvas.toDataURL('image/png')
    link.click()
  }

  return (
    <div className="flex-1 flex flex-col relative">
      <canvas
        ref={canvasRef}
        className="flex-1 cursor-grab"
        style={{ touchAction: 'none' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onWheel={onWheel}
      />
      {/* Legend */}
      <div className="absolute top-3 left-3 bg-[rgba(23,30,46,0.92)] border border-[#2a3650] rounded-xl p-3 text-xs space-y-1">
        {Object.entries(TYPE_LABELS).map(([t, label]) => {
          const count = nodes.filter(n => n.type === t).length
          return (
            <label key={t} className="flex items-center gap-2 text-[#8fa0bd] cursor-pointer">
              <input type="checkbox" checked={visibleTypes[t]} onChange={() => {}} className="accent-[#4da3ff]" data-type={t} />
              <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: NODE_COLORS[t] }} />
              {label} ({count})
            </label>
          )
        })}
      </div>
      {/* Controls */}
      <div className="absolute top-3 right-3 flex flex-col gap-2">
        <button onClick={fitToView} className="bg-[#1d2639] border border-[#2a3650] text-[#8fa0bd] px-3 py-1.5 rounded-lg text-xs hover:text-white">Fit view</button>
        <button onClick={reLayout} className="bg-[#1d2639] border border-[#2a3650] text-[#8fa0bd] px-3 py-1.5 rounded-lg text-xs hover:text-white">Re-layout</button>
        <button onClick={exportPNG} className="bg-[#1d2639] border border-[#2a3650] text-[#8fa0bd] px-3 py-1.5 rounded-lg text-xs hover:text-white">Export PNG</button>
      </div>
      <div className="absolute bottom-3 left-3 text-[11px] text-[#8fa0bd]">
        Drag nodes · drag background to pan · scroll to zoom · click for details
      </div>
    </div>
  )
}
