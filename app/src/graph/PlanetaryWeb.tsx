import { useRef, useEffect, useMemo, useState, useCallback } from 'react'
import ForceGraph3DImport from '3d-force-graph'
const ForceGraph3D = ForceGraph3DImport as any
import * as THREE from 'three'
import type { GraphNode, GraphLink, RelationType } from '../data/types'
import { NODE_COLORS, TYPE_LABELS, RELATION_LABELS } from './buildGraph'
import { riskScore, riskLevel, RISK_COLORS, fmtK } from '../analytics/risk'
import { lensStyle, buildLensContext, LENSES, type LensId } from '../analytics/lenses'
import { egoNetwork } from '../analytics/centrality'
import { selectionContext, type ContextTier } from '../analytics/selection'
import { linkId, frameMembers, type FocusFrame } from '../analytics/focusFrame'
import type { Gap } from '../analytics/gaps'
import { labelPlan, type ScreenNode, type LabelLevel } from './lib/labelPolicy'
import {
  CameraDirector, type CameraIntent, type Vec3,
} from './lib/cameraDirector'
import {
  TextureCache, buildNodeVisual, applyLabel, applyRadius, type NodeVisual,
} from './lib/nodeFactory'
import { projectMinimap, nearestKey, type MinimapProjection } from './lib/minimap'
import { Crosshair, Maximize2, RefreshCw, Focus } from 'lucide-react'

/** Hex → rgba() so link and node colours can carry a tier's opacity. */
function rgba(hex: string, alpha: number): string {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16))
  return `rgba(${r},${g},${b},${alpha})`
}

/* ─── Tuning constants ─── */
const BG = '#04070E'
/** Labels re-plan at this rate; 60fps planning is wasted work. */
export const LABEL_PLAN_HZ = 6
/** Dimmed nodes keep this much presence so the whole stays an orientation aid. */
export const DIM_OPACITY = 0.3
/**
 * A frame is a deliberate act of attention, so its dim goes far deeper than a
 * selection's: the frame must read as *the* picture, not as a highlight.
 */
export const FRAME_DIM_OPACITY = 0.07
/**
 * Below this the camera has not visibly responded, and the click reads as a
 * no-op — so the seeds pulse instead. No activation may ever be silent.
 */
export const CAMERA_NOOP_DISTANCE = 24
export const PULSE_MS = 620
const MINIMAP_SIZE = 168

export interface WebHandle {
  fit: () => void
  frame: (keys: string[]) => void
  relayout: () => void
}

interface Props {
  nodes: GraphNode[]
  links: GraphLink[]
  visibleTypes: Record<string, boolean>
  selected: GraphNode | null
  onSelect: (n: GraphNode | null) => void
  searchQuery: string
  spendThreshold: number
  highlightExpiring: number
  lens: LensId
  highlightKeys?: Set<string> | null
  /**
   * The active Focus Frame — the induced subgraph behind every jump into the
   * web. Supersedes `highlightKeys`, which remains for story mode.
   */
  focusFrame?: FocusFrame | null
  focusNode?: GraphNode | null
  onFocus?: (n: GraphNode | null) => void
  /** Structural gaps, rendered as phantom nodes under the Gaps lens. */
  gaps?: Gap[]
  /** Nodes removed from the scene by dashboard filters (department, risk). */
  hiddenKeys?: Set<string>
  /** Dim everything outside the context to near-black for presenting. */
  spotlight?: boolean
  /** Hide the HUD panels — used by story mode. */
  chromeless?: boolean
  onReady?: (handle: WebHandle) => void
  onHover?: (n: GraphNode | null) => void
}

interface FGNode {
  id: string
  graphNode: GraphNode
  type: string
  name: string
  baseVal: number
  val: number
  color: string
  riskLvl: 'high' | 'medium' | 'low'
  ring?: string
  labelAlways?: boolean
  showRiskGlow?: boolean
}

interface FGLink {
  source: string
  target: string
  relation: RelationType
  sType: string
  tType: string
}

export default function PlanetaryWeb(props: Props) {
  const {
    nodes, links, visibleTypes, selected, onSelect, searchQuery, spendThreshold,
    highlightExpiring, lens, highlightKeys, focusFrame, focusNode, onFocus, gaps,
    hiddenKeys, spotlight, chromeless, onReady, onHover,
  } = props

  const containerRef = useRef<HTMLDivElement>(null)
  const graphRef = useRef<any>(null)
  const directorRef = useRef<CameraDirector | null>(null)
  const visualsRef = useRef(new Map<string, NodeVisual>())
  const textureCacheRef = useRef(new TextureCache())
  const phantomsRef = useRef<{ obj: THREE.Object3D; anchorKey: string; line: THREE.Line }[]>([])
  const [hovered, setHovered] = useState<GraphNode | null>(null)
  const [minimap, setMinimap] = useState<MinimapProjection | null>(null)
  const settledRef = useRef(false)
  /** Seed emphasis pulse — the feedback that makes a frame click undeniable. */
  const pulseRef = useRef<{ until: number; keys: Set<string> } | null>(null)

  const selectedRef = useRef(selected); selectedRef.current = selected
  const hoveredRef = useRef<GraphNode | null>(null); hoveredRef.current = hovered
  const onSelectRef = useRef(onSelect); onSelectRef.current = onSelect
  const onFocusRef = useRef(onFocus); onFocusRef.current = onFocus
  const lastClickRef = useRef<{ key: string | null; at: number }>({ key: null, at: 0 })

  const maxValue = useMemo(() => Math.max(1, ...nodes.map(n => n.value)), [nodes])
  const gapKeys = useMemo(
    () => new Set((gaps ?? []).flatMap(g => g.nodeKeys)), [gaps])
  const lensCtx = useMemo(() => buildLensContext(nodes, gapKeys), [nodes, gapKeys])

  const { fgNodes, fgLinks } = useMemo(() => {
    const visibleNodes = nodes.filter(n => {
      if (!visibleTypes[n.type]) return false
      if (hiddenKeys?.has(n.key)) return false
      if (n.type === 'contract' && spendThreshold > 0 && (n.contract?.annualValue ?? 0) < spendThreshold) return false
      return true
    })
    const visKeys = new Set(visibleNodes.map(n => n.key))

    const fgNodes: FGNode[] = visibleNodes.map(n => {
      const baseVal = n.type === 'contract'
        ? 3 + 12 * Math.sqrt((n.contract?.annualValue ?? 0) / maxValue)
        : ({ department: 10, category: 8, supplier: 6, owner: 5 } as Record<string, number>)[n.type] || 6
      return {
        id: n.key, graphNode: n, type: n.type, name: n.name,
        baseVal, val: baseVal,
        color: NODE_COLORS[n.type] || '#E4E4E7',
        riskLvl: riskLevel(riskScore(n)),
      }
    })

    const fgLinks: FGLink[] = []
    const seen = new Set<string>()
    for (const l of links) {
      if (!visKeys.has(l.source.key) || !visKeys.has(l.target.key)) continue
      const k = l.source.key < l.target.key ? `${l.source.key}|${l.target.key}` : `${l.target.key}|${l.source.key}`
      if (seen.has(k)) continue
      seen.add(k)
      fgLinks.push({
        source: l.source.key, target: l.target.key,
        relation: l.relation, sType: l.source.type, tType: l.target.type,
      })
    }
    return { fgNodes, fgLinks }
  }, [nodes, links, visibleTypes, spendThreshold, maxValue, hiddenKeys])

  const fgNodeIndex = useMemo(
    () => new Map(fgNodes.map(n => [n.id, n])), [fgNodes])

  /** Links inside the active frame, by undirected id. */
  const frameLinks = useMemo(
    () => new Set(focusFrame?.linkKeys ?? []), [focusFrame])
  const frameLinksRef = useRef(frameLinks); frameLinksRef.current = frameLinks
  const frameSeeds = useMemo(
    () => new Set(focusFrame?.seedKeys ?? []), [focusFrame])
  const frameSeedsRef = useRef(frameSeeds); frameSeedsRef.current = frameSeeds

  /* Context tiers: focus > frame > insight highlight > selection. */
  const { tierMap, relations } = useMemo((): {
    tierMap: Map<string, ContextTier> | null
    relations: Map<string, RelationType>
  } => {
    const selCtx = selected ? selectionContext(selected) : null
    if (focusNode) {
      const m = new Map<string, ContextTier>()
      for (const k of egoNetwork(focusNode, 2)) m.set(k, 'direct')
      for (const nb of focusNode.neighbors) m.set(nb.key, 'direct')
      m.set(focusNode.key, 'core')
      if (selCtx) for (const [k, t] of selCtx.tiers) if (m.has(k) && t !== 'related') m.set(k, t)
      return { tierMap: m, relations: selCtx?.relations ?? new Map() }
    }
    if (focusFrame) {
      // Seeds are the subjects — they get the core treatment (ring, bold
      // label, top of the label plan). Context is the connective tissue.
      const m = new Map<string, ContextTier>()
      for (const k of focusFrame.contextKeys) m.set(k, 'direct')
      for (const k of focusFrame.seedKeys) m.set(k, 'core')
      // A selection made inside a frame keeps its own relation labels.
      const rel = selCtx && m.has(selCtx.core) ? selCtx.relations : new Map<string, RelationType>()
      return { tierMap: m, relations: rel }
    }
    if (highlightKeys && highlightKeys.size > 0) {
      const m = new Map<string, ContextTier>()
      for (const k of highlightKeys) m.set(k, 'direct')
      if (selCtx) for (const [k, t] of selCtx.tiers) m.set(k, t)
      return { tierMap: m, relations: selCtx?.relations ?? new Map() }
    }
    if (!selCtx) return { tierMap: null, relations: new Map() }
    return { tierMap: selCtx.tiers, relations: selCtx.relations }
  }, [selected, highlightKeys, focusNode, focusFrame])

  const tierMapRef = useRef(tierMap); tierMapRef.current = tierMap
  const relationsRef = useRef(relations); relationsRef.current = relations

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
  const expiringSetRef = useRef(expiringSet); expiringSetRef.current = expiringSet

  /* ─── Node visuals: built once per node, mutated thereafter ─── */

  const visualFor = useCallback((n: FGNode): THREE.Object3D => {
    const existing = visualsRef.current.get(n.id)
    if (existing) return existing.group
    const v = buildNodeVisual(String(n.graphNode.contracts.length))
    visualsRef.current.set(n.id, v)
    return v.group
  }, [])

  /** Push current colour/size/label state into the existing objects. */
  const paint = useCallback(() => {
    const tm = tierMapRef.current
    const rel = relationsRef.current
    const exp = expiringSetRef.current
    const sel = selectedRef.current
    const hov = hoveredRef.current
    const cache = textureCacheRef.current

    for (const [key, v] of visualsRef.current) {
      const n = fgNodeIndex.get(key)
      if (!n) { v.group.visible = false; continue }
      v.group.visible = true

      const tier = tm ? tm.get(key) : undefined
      const dimmed = tm !== null && tier === undefined
      const isCore = tier === 'core' || sel?.key === key
      const isHovered = hov?.key === key
      const r = Math.cbrt(Math.max(n.val, 0.001))

      applyRadius(v, r)
      // Hover lifts the node without touching geometry. A pulsing seed owns
      // its own scale until the pulse ends, so the two never fight.
      if (!pulseRef.current?.keys.has(key)) {
        v.group.scale.setScalar(isHovered ? 1.15 : 1)
      }

      v.countMat.opacity = dimmed ? 0.12 : tier === 'related' ? 0.5 : 1

      // Rings: selection > hover > lens emphasis > expiry.
      const ringColor =
        isCore ? '#60A5FA'
          : isHovered ? '#93C5FD'
            : n.ring ? n.ring
              : exp.has(key) ? '#D97706'
                : null
      if (ringColor && !dimmed) {
        v.ring.visible = true
        if (v.applied.ringColor !== ringColor) {
          v.ringMat.color.set(ringColor)
          v.applied.ringColor = ringColor
        }
        v.ringMat.opacity = isCore ? 0.85 : isHovered ? 0.7 : 0.5
      } else {
        v.ring.visible = false
      }

      const glowOn = Boolean(n.showRiskGlow) && n.type === 'contract' && n.riskLvl === 'high' && !dimmed
      v.glow.visible = glowOn
      v.glowMat.opacity = glowOn ? 0.14 : 0

      // Labels are placed by the policy loop; style is set here.
      if (dimmed) {
        v.label.visible = false
        continue
      }
      const relation = rel.get(key)
      const value = n.graphNode.value > 0 ? fmtK(n.graphNode.value) : undefined
      const subtitle = tier === 'direct' && relation
        ? [RELATION_LABELS[relation], value].filter(Boolean).join(' · ')
        : value
      v.group.userData.labelStyle = {
        title: n.name,
        subtitle,
        bold: isCore,
        titleColor: isCore ? '#FFFFFF' : tier === 'related' ? 'rgba(226,232,240,0.7)' : '#E2E8F0',
        subtitleColor: tier === 'direct' && relation ? (NODE_COLORS[n.type] || '#94A3B8') : 'rgba(148,163,184,0.85)',
      }
      v.group.userData.labelScale = isCore ? 1.15 : tier === 'related' ? 0.8 : 1
      v.group.userData.cache = cache
    }
  }, [fgNodeIndex])

  /* ─── Init once ─── */
  useEffect(() => {
    if (!containerRef.current) return
    const el = containerRef.current

    const graph = ForceGraph3D()(el)
      .backgroundColor(BG)
      .showNavInfo(false)
      .nodeRelSize(1.5)
      .nodeVal('val')
      .nodeLabel('')
      .nodeColor((n: any) => {
        const tm = tierMapRef.current
        if (hoveredRef.current?.key === n.id) return '#FFFFFF'
        if (!tm) return n.color
        const tier = tm.get(n.id)
        // A frame dims harder than a selection: it is the whole picture.
        if (!tier) return rgba('#1F2937', frameLinksRef.current.size > 0 ? FRAME_DIM_OPACITY : DIM_OPACITY)
        return tier === 'related' ? rgba(n.color, 0.6) : n.color
      })
      .nodeOpacity(0.92)
      .nodeThreeObjectExtend(true)
      .nodeThreeObject((n: any) => visualFor(n as FGNode))
      .linkColor((l: any) => {
        const tm = tierMapRef.current
        const sId = typeof l.source === 'object' ? l.source.id : l.source
        const tId = typeof l.target === 'object' ? l.target.id : l.target
        const hov = hoveredRef.current
        // Hovering brightens the node's own connections in their type colours.
        if (hov && (sId === hov.key || tId === hov.key)) {
          const leadsTo = sId === hov.key ? l.tType : l.sType
          return rgba(NODE_COLORS[leadsTo] || '#94A3B8', 0.95)
        }
        const fl = frameLinksRef.current
        if (fl.size > 0) {
          // Inside a frame, every member link is drawn at full strength in the
          // colour of the entity it leads to — the relationships *are* the point.
          if (!fl.has(linkId(sId, tId))) return 'rgba(31,41,55,0.05)'
          const seeds = frameSeedsRef.current
          const leadsTo = seeds.has(sId) ? l.tType : seeds.has(tId) ? l.sType : l.tType
          return rgba(NODE_COLORS[leadsTo] || '#94A3B8', 0.95)
        }
        if (!tm) {
          // Neutral state still carries the colour language, faintly.
          return rgba(NODE_COLORS[l.tType] || '#64748B', 0.22)
        }
        const sTier = tm.get(sId)
        const tTier = tm.get(tId)
        if (!sTier || !tTier) return 'rgba(31,41,55,0.1)'
        const leadsTo = sTier === 'core' ? l.tType : tTier === 'core' ? l.sType : l.tType
        const hue = NODE_COLORS[leadsTo] || '#94A3B8'
        const touchesCore = sTier === 'core' || tTier === 'core'
        return rgba(hue, touchesCore ? 0.95 : 0.3)
      })
      .linkWidth((l: any) => {
        const tm = tierMapRef.current
        const sId = typeof l.source === 'object' ? l.source.id : l.source
        const tId = typeof l.target === 'object' ? l.target.id : l.target
        const hov = hoveredRef.current
        if (hov && (sId === hov.key || tId === hov.key)) return 1.1
        const fl = frameLinksRef.current
        if (fl.size > 0) {
          if (!fl.has(linkId(sId, tId))) return 0.25
          const seeds = frameSeedsRef.current
          return seeds.has(sId) || seeds.has(tId) ? 2.0 : 1.2
        }
        if (!tm) return 0.4
        const sTier = tm.get(sId)
        const tTier = tm.get(tId)
        if (!sTier || !tTier) return 0.4
        return sTier === 'core' || tTier === 'core' ? 0.9 : 0.45
      })
      .linkOpacity(0.85)
      .onNodeHover((n: any) => {
        const gn = (n?.graphNode ?? null) as GraphNode | null
        if (hoveredRef.current?.key === gn?.key) return
        hoveredRef.current = gn
        setHovered(gn)
        onHover?.(gn)
        el.style.cursor = gn ? 'pointer' : 'default'
        graph.nodeColor(graph.nodeColor())
        graph.linkColor(graph.linkColor())
        graph.linkWidth(graph.linkWidth())
      })
      .onNodeClick((n: any) => {
        if (!n) return
        const gn = n.graphNode as GraphNode
        const now = performance.now()
        if (lastClickRef.current.key === gn.key && now - lastClickRef.current.at < 400) {
          lastClickRef.current = { key: null, at: 0 }
          onFocusRef.current?.(gn)
          onSelectRef.current(gn)
          return
        }
        lastClickRef.current = { key: gn.key, at: now }
        onSelectRef.current(selectedRef.current === gn ? null : gn)
      })
      .onBackgroundClick(() => {
        onSelectRef.current(null)
        onFocusRef.current?.(null)
      })
      .d3VelocityDecay(0.3)
      .d3AlphaDecay(0.02)
      .cooldownTime(5000)

    const scene = graph.scene()
    // Fog set well beyond the camera's clamped range so framing never fades out.
    scene.fog = new THREE.Fog(BG, 700, 2600)
    scene.children.filter((c: any) => c.isLight).forEach((l: any) => scene.remove(l))
    scene.add(new THREE.AmbientLight('#E5E7EB', 0.45))
    const dir1 = new THREE.DirectionalLight('#F0F0F0', 0.6)
    dir1.position.set(60, 80, 40)
    scene.add(dir1)
    const dir2 = new THREE.DirectionalLight('#D4D4D8', 0.3)
    dir2.position.set(-30, 40, -20)
    scene.add(dir2)

    graphRef.current = graph
    // Debug handle for tests and performance inspection.
    ;(window as any).__web = {
      graph, visuals: visualsRef.current, textures: textureCacheRef.current,
    }

    // Every camera move in the app goes through this one director.
    directorRef.current = new CameraDirector({
      positions: () => {
        const m = new Map<string, Vec3>()
        for (const n of graph.graphData().nodes as any[]) {
          if (n.x !== undefined) m.set(n.id, { x: n.x, y: n.y, z: n.z })
        }
        return m
      },
      cameraPosition: () => {
        const c = graph.cameraPosition()
        return { x: c.x, y: c.y, z: c.z }
      },
      moveCamera: (pose, duration) => {
        // Vestibular safety: fly instantly when the OS asks for reduced motion.
        const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
        graph.cameraPosition(pose.position, pose.lookAt, reduced ? 0 : duration)
      },
    })

    return () => {
      textureCacheRef.current.dispose()
      visualsRef.current.clear()
      graph._destructor()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  /* ─── Data ─── */
  useEffect(() => {
    if (!graphRef.current) return
    // Drop visuals for nodes that no longer exist so the cache cannot grow forever.
    const live = new Set(fgNodes.map(n => n.id))
    for (const key of [...visualsRef.current.keys()]) {
      if (!live.has(key)) visualsRef.current.delete(key)
    }
    settledRef.current = false
    graphRef.current.graphData({ nodes: fgNodes, links: fgLinks })
  }, [fgNodes, fgLinks])

  /* ─── Lens styling, then repaint ─── */
  useEffect(() => {
    for (const n of fgNodes) {
      const style = lensStyle(n.graphNode, lens, lensCtx)
      n.color = style.color
      n.val = n.baseVal * style.sizeMult
      n.ring = style.ring
      n.labelAlways = style.labelAlways
      n.showRiskGlow = lens === 'structure' || lens === 'risk'
    }
    paint()
    if (!graphRef.current) return
    graphRef.current.nodeColor(graphRef.current.nodeColor())
    graphRef.current.nodeVal(graphRef.current.nodeVal())
  }, [lens, lensCtx, fgNodes, paint])

  useEffect(() => {
    paint()
    if (!graphRef.current) return
    graphRef.current.nodeColor(graphRef.current.nodeColor())
    graphRef.current.linkColor(graphRef.current.linkColor())
    graphRef.current.linkWidth(graphRef.current.linkWidth())
  }, [tierMap, selected, expiringSet, hovered, frameLinks, paint])

  /* ─── Phantom nodes for structural gaps ─── */
  useEffect(() => {
    const graph = graphRef.current
    if (!graph) return
    const scene = graph.scene()
    for (const p of phantomsRef.current) {
      scene.remove(p.obj)
      scene.remove(p.line)
    }
    phantomsRef.current = []
    if (lens !== 'gaps' || !gaps) return

    for (const gap of gaps) {
      if (!gap.phantom) continue
      const group = new THREE.Group()
      // Hollow ring reads as "a node belongs here and is absent".
      const shell = new THREE.Mesh(
        new THREE.SphereGeometry(4.5, 16, 16),
        new THREE.MeshBasicMaterial({
          color: '#F472B6', transparent: true, opacity: 0.18, wireframe: true,
        })
      )
      group.add(shell)

      const canvas = document.createElement('canvas')
      canvas.width = 512; canvas.height = 84
      const c = canvas.getContext('2d')!
      c.fillStyle = 'rgba(8,12,20,0.85)'
      c.beginPath(); c.roundRect(90, 4, 332, 76, 12); c.fill()
      c.strokeStyle = '#831843'; c.lineWidth = 3; c.setLineDash([8, 6]); c.stroke()
      c.fillStyle = '#F9A8D4'
      c.font = '600 40px Inter, system-ui, sans-serif'
      c.textAlign = 'center'; c.textBaseline = 'middle'
      c.fillText(gap.phantom.label, 256, 42)
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
        map: new THREE.CanvasTexture(canvas), transparent: true,
        depthWrite: false, sizeAttenuation: false,
      }))
      sprite.scale.set(0.2, 0.2 * (84 / 512), 1)
      sprite.center.set(0.5, -0.3)
      group.add(sprite)

      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
        new THREE.LineDashedMaterial({ color: '#F472B6', dashSize: 4, gapSize: 4, transparent: true, opacity: 0.6 })
      )
      scene.add(group)
      scene.add(line)
      phantomsRef.current.push({ obj: group, anchorKey: gap.phantom.anchorKey, line })
    }
  }, [lens, gaps])

  /* ─── Per-frame: label planning, phantom anchoring, minimap ─── */
  useEffect(() => {
    let raf = 0
    let lastPlan = 0
    const interval = 1000 / LABEL_PLAN_HZ
    const v3 = new THREE.Vector3()

    const tick = (t: number) => {
      raf = requestAnimationFrame(tick)
      const graph = graphRef.current
      if (!graph) return
      const gd = graph.graphData()
      if (!gd?.nodes?.length) return

      // Anchor phantoms to their host node every frame — they are overlay
      // objects, deliberately outside the force simulation.
      if (phantomsRef.current.length > 0) {
        for (const p of phantomsRef.current) {
          const anchor = gd.nodes.find((n: any) => n.id === p.anchorKey)
          if (!anchor || anchor.x === undefined) { p.obj.visible = false; p.line.visible = false; continue }
          p.obj.visible = true; p.line.visible = true
          p.obj.position.set(anchor.x + 34, anchor.y + 22, anchor.z)
          const pos = p.line.geometry.attributes.position as THREE.BufferAttribute
          pos.setXYZ(0, anchor.x, anchor.y, anchor.z)
          pos.setXYZ(1, p.obj.position.x, p.obj.position.y, p.obj.position.z)
          pos.needsUpdate = true
          p.line.computeLineDistances()
        }
      }

      // Seed pulse runs every frame, not at planning cadence — it has to be
      // smooth to read as a response to the click.
      const pulse = pulseRef.current
      if (pulse) {
        const remain = pulse.until - t
        if (remain <= 0) {
          for (const k of pulse.keys) visualsRef.current.get(k)?.group.scale.setScalar(1)
          pulseRef.current = null
        } else {
          const p = remain / PULSE_MS
          const s = 1 + 0.5 * p * Math.sin((1 - p) * Math.PI * 2)
          for (const k of pulse.keys) visualsRef.current.get(k)?.group.scale.setScalar(s)
        }
      }

      if (t - lastPlan < interval) return
      lastPlan = t

      // Visuals are created lazily by the engine, after React's effects have
      // run — so styling is (re)applied here, at the planning cadence.
      paint()

      const camera = graph.camera()
      const canvas = graph.renderer().domElement
      const width = canvas.clientWidth || 1
      const height = canvas.clientHeight || 1

      // First settle → frame the whole graph once, with no visible jump.
      if (!settledRef.current) {
        const first = gd.nodes[0]
        if (first && (first.x !== 0 || first.y !== 0 || first.z !== 0)) {
          settledRef.current = true
          directorRef.current?.flyTo({ kind: 'overview' }, { keepAngle: false })
        }
      }

      const screen = new Map<string, ScreenNode>()
      for (const n of gd.nodes as any[]) {
        if (n.x === undefined) continue
        v3.set(n.x, n.y, n.z).project(camera)
        screen.set(n.id, {
          key: n.id,
          x: (v3.x * 0.5 + 0.5) * width,
          y: (-v3.y * 0.5 + 0.5) * height,
          depth: v3.z,
          radius: Math.cbrt(Math.max(n.val ?? 1, 0.001)) * 3,
        })
      }

      const plan = labelPlan({
        nodes: fgNodes.map(n => n.graphNode),
        screen,
        tiers: tierMapRef.current,
        hoveredKey: hoveredRef.current?.key ?? null,
        selectedKey: selectedRef.current?.key ?? null,
        // Frame seeds are pinned: they outrank the field for label space, so
        // the subjects of a finding are always named on arrival.
        alwaysLabel: new Set([
          ...fgNodes.filter(n => n.labelAlways).map(n => n.id),
          ...frameSeedsRef.current,
        ]),
        maxValue,
        viewport: { width, height },
      })

      ;(window as any).__web.planSize = plan.size
      ;(window as any).__web.screenSample = [...screen.values()][0]
      const cache = textureCacheRef.current
      for (const [key, v] of visualsRef.current) {
        const level: LabelLevel = plan.get(key) ?? 'none'
        const style = v.group.userData.labelStyle
        if (!style || level === 'none') { v.label.visible = false; continue }
        applyLabel(v, cache, style, level, v.group.userData.labelScale ?? 1)
      }

      // Minimap follows the same cadence.
      const positions = new Map<string, Vec3>()
      const colors = new Map<string, string>()
      const dimmed = new Set<string>()
      const tm = tierMapRef.current
      for (const n of gd.nodes as any[]) {
        if (n.x === undefined) continue
        positions.set(n.id, { x: n.x, y: n.y, z: n.z })
        colors.set(n.id, n.color)
        if (tm && !tm.has(n.id)) dimmed.add(n.id)
      }
      const cam = graph.cameraPosition()
      setMinimap(projectMinimap({
        positions, colors, dimmed,
        cameraPos: { x: cam.x, y: cam.y, z: cam.z },
        cameraTarget: selectedRef.current ? positions.get(selectedRef.current.key) : undefined,
        width: MINIMAP_SIZE, height: MINIMAP_SIZE,
      }))
    }

    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [fgNodes, maxValue, paint])

  /* ─── Freeze the layout once settled so the learned map stops drifting ─── */
  useEffect(() => {
    const graph = graphRef.current
    if (!graph) return
    const timer = setTimeout(() => {
      for (const n of graph.graphData().nodes as any[]) {
        if (n.x === undefined) continue
        n.fx = n.x; n.fy = n.y; n.fz = n.z
      }
    }, 5200)
    return () => clearTimeout(timer)
  }, [fgNodes])

  const relayout = useCallback(() => {
    const graph = graphRef.current
    if (!graph) return
    for (const n of graph.graphData().nodes as any[]) {
      n.fx = undefined; n.fy = undefined; n.fz = undefined
    }
    settledRef.current = false
    graph.d3ReheatSimulation()
  }, [])

  /* ─── Camera intents ─── */
  const fly = useCallback((intent: CameraIntent, keepAngle = true) => {
    directorRef.current?.flyTo(intent, { keepAngle })
  }, [])

  useEffect(() => {
    onReady?.({
      fit: () => fly({ kind: 'overview' }, false),
      frame: (keys: string[]) => fly({ kind: 'frameNodes', keys }),
      relayout,
    })
  }, [onReady, fly, relayout])

  useEffect(() => {
    if (!focusNode) return
    fly({ kind: 'frameNodes', keys: [...egoNetwork(focusNode, 2)] })
  }, [focusNode, fly])

  useEffect(() => {
    if (!highlightKeys || highlightKeys.size === 0) return
    fly({ kind: 'frameNodes', keys: [...highlightKeys] })
  }, [highlightKeys, fly])

  /**
   * Staging a frame. The camera flies to the members, but a frame whose pose
   * is already on screen would otherwise produce a click with no visible
   * response — so the seeds always pulse. Every activation is felt.
   */
  useEffect(() => {
    if (!focusFrame) { pulseRef.current = null; return }
    const director = directorRef.current
    const graph = graphRef.current
    if (!director || !graph) return

    const keys = [...frameMembers(focusFrame)]
    const from = graph.cameraPosition()
    const pose = director.resolve({ kind: 'frameNodes', keys })
    const moved = pose
      ? Math.hypot(pose.position.x - from.x, pose.position.y - from.y, pose.position.z - from.z)
      : 0
    if (pose && moved >= CAMERA_NOOP_DISTANCE) {
      director.flyTo({ kind: 'frameNodes', keys })
    }
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (!reduced) {
      pulseRef.current = {
        until: performance.now() + PULSE_MS,
        keys: new Set(focusFrame.seedKeys),
      }
    }
    ;(window as any).__web.lastFrame = {
      id: focusFrame.id, moved: Math.round(moved),
      seeds: focusFrame.seedKeys.length, links: focusFrame.linkKeys.length,
    }
  }, [focusFrame])

  useEffect(() => {
    if (!selected || focusNode) return
    fly({ kind: 'frameNodes', keys: [selected.key, ...[...selected.neighbors].map(n => n.key)] })
  }, [selected, focusNode, fly])

  const searchTerm = searchQuery.trim().toLowerCase()
  useEffect(() => {
    if (!graphRef.current || !searchTerm) return
    const matched = graphRef.current.graphData().nodes.find(
      (n: any) => n.name.toLowerCase().includes(searchTerm))
    if (matched) onSelect(matched.graphNode)
  }, [searchTerm]) // eslint-disable-line react-hooks/exhaustive-deps

  /* ─── Keyboard ─── */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target && (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA')) return
      if (e.key === 'Escape') {
        if (focusNode) onFocusRef.current?.(null)
        // A frame is released by the screen that owns it, one layer at a time.
        else if (!focusFrame) onSelectRef.current(null)
      } else if (e.key === 'f' || e.key === 'F') {
        fly({ kind: 'overview' }, false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [focusNode, focusFrame, fly])

  /* ─── Resize ─── */
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

  /* ─── HUD data ─── */
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
    [nodes])

  const onMinimapClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!minimap) return
    const rect = e.currentTarget.getBoundingClientRect()
    const click = { x: e.clientX - rect.left, y: e.clientY - rect.top }
    const key = nearestKey(click, minimap)
    if (key) {
      const gn = fgNodeIndex.get(key)?.graphNode
      if (gn) onSelect(gn)
    }
  }

  return (
    <div className="flex-1 relative overflow-hidden min-w-0" style={{ background: BG }}>
      <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />

      {/* Spotlight vignette — presentation emphasis, pointer-transparent. */}
      {spotlight && (
        <div className="absolute inset-0" style={{
          pointerEvents: 'none',
          background: 'radial-gradient(ellipse at center, rgba(8,12,20,0) 26%, rgba(8,12,20,0.55) 58%, rgba(4,7,14,0.92) 100%)',
        }} />
      )}

      {/* Hover readout — one place, always in the same corner. */}
      {hovered && (
        <div className="absolute bottom-3 left-1/2 rounded-lg px-3 py-1.5"
          style={{
            transform: 'translateX(-50%)', background: 'rgba(4,7,14,0.96)',
            border: `1px solid ${NODE_COLORS[hovered.type] ?? '#334155'}`,
            backdropFilter: 'blur(12px)', pointerEvents: 'none', maxWidth: '420px',
          }}>
          <div className="flex items-baseline gap-2">
            <span className="text-[11px] font-semibold text-white truncate">{hovered.name}</span>
            <span className="text-[9px] uppercase tracking-wider" style={{ color: NODE_COLORS[hovered.type] }}>
              {hovered.type}
            </span>
          </div>
          <div className="text-[10px]" style={{ color: '#94A3B8' }}>
            {fmtK(hovered.value)} · {hovered.contracts.length} contract{hovered.contracts.length === 1 ? '' : 's'} · {hovered.neighbors.size} link{hovered.neighbors.size === 1 ? '' : 's'}
          </div>
        </div>
      )}

      {!chromeless && (
        <>
          {/* Risk summary */}
          <div className="absolute top-3 right-3 rounded-lg p-3"
            style={{ background: 'rgba(4,7,14,0.92)', border: '1px solid #16233A', backdropFilter: 'blur(12px)', minWidth: '170px', pointerEvents: 'none' }}>
            <div className="text-[10px] font-semibold tracking-wider mb-2" style={{ color: '#6B7280' }}>RISK OVERVIEW</div>
            {[
              { label: 'High risk', count: riskStats.high, color: RISK_COLORS.high },
              { label: 'Medium risk', count: riskStats.medium, color: RISK_COLORS.medium },
              { label: 'Low risk', count: riskStats.low, color: RISK_COLORS.low },
            ].map(({ label, count, color }) => (
              <div key={label} className="flex items-center gap-2 mb-1">
                <div style={{ width: '6px', height: '6px', borderRadius: label === 'High risk' ? '1px' : '50%', background: color }} />
                <span className="flex-1 text-[10px]" style={{ color: '#9CA3AF' }}>{label}</span>
                <span className="text-[11px] font-bold tabular-nums" style={{ color }}>{count}</span>
              </div>
            ))}
            <div className="mt-2 pt-2" style={{ borderTop: '1px solid #1F2937' }}>
              <div className="flex justify-between text-[9px]">
                <span style={{ color: '#6B7280' }}>Spend at risk</span>
                <span className="font-bold" style={{ color: RISK_COLORS.high }}>{fmtK(riskStats.totalAtRisk)}</span>
              </div>
              <div className="flex justify-between text-[9px] mt-0.5">
                <span style={{ color: '#6B7280' }}>Orphan contracts</span>
                <span className="font-bold" style={{ color: RISK_COLORS.medium }}>{riskStats.orphan}</span>
              </div>
              <div className="flex justify-between text-[9px] mt-0.5">
                <span style={{ color: '#6B7280' }}>Total spend</span>
                <span className="font-bold" style={{ color: '#E5E7EB' }}>{fmtK(totalSpend)}</span>
              </div>
            </div>
          </div>

          {/* Legend */}
          <div className="absolute top-3 left-3 rounded-lg p-3"
            style={{ background: 'rgba(4,7,14,0.92)', border: '1px solid #16233A', backdropFilter: 'blur(12px)' }}>
            <div className="text-[10px] font-semibold tracking-wider mb-0.5" style={{ color: '#6B7280' }}>
              {lensDef.label.toUpperCase()} LENS
            </div>
            <div className="text-[9px] mb-2" style={{ color: '#4B5563' }}>{lensDef.question}</div>
            {lensDef.scale.length > 0 && (
              <div className="mb-2 pb-2" style={{ borderBottom: '1px solid #1F2937' }}>
                {lensDef.scale.map(s => (
                  <div key={s.label} className="flex items-center gap-2 mb-1">
                    <div style={{ width: '8px', height: '8px', borderRadius: '2px', background: s.color }} />
                    <span className="text-[10px]" style={{ color: '#9CA3AF' }}>{s.label}</span>
                  </div>
                ))}
              </div>
            )}
            <div className="text-[10px] font-semibold tracking-wider mb-2" style={{ color: '#6B7280' }}>NODE TYPES</div>
            {Object.entries(TYPE_LABELS).map(([t, label]) => {
              const count = nodes.filter(n => n.type === t).length
              return (
                <label key={t} className="flex items-center gap-2 cursor-pointer mb-1">
                  <input type="checkbox" checked={visibleTypes[t]} readOnly data-type={t}
                    className="accent-[#60A5FA]" style={{ width: '11px', height: '11px' }} />
                  <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: NODE_COLORS[t] }} />
                  <span className="flex-1 text-[10px]" style={{ color: '#9CA3AF' }}>{label}</span>
                  <span className="text-[10px] tabular-nums font-semibold" style={{ color: '#6B7280' }}>{count}</span>
                </label>
              )
            })}
          </div>

          {/* Camera controls */}
          <div className="absolute top-3 left-1/2 flex gap-1 rounded-lg p-1"
            style={{ transform: 'translateX(-50%)', background: 'rgba(4,7,14,0.92)', border: '1px solid #16233A', backdropFilter: 'blur(12px)' }}>
            <ControlButton title="Fit everything (F)" onClick={() => fly({ kind: 'overview' }, false)}>
              <Maximize2 size={12} />
            </ControlButton>
            <ControlButton title="Frame selection" onClick={() => {
              if (selected) fly({ kind: 'frameNodes', keys: [selected.key, ...[...selected.neighbors].map(n => n.key)] })
            }} disabled={!selected}>
              <Crosshair size={12} />
            </ControlButton>
            <ControlButton title="Re-run layout" onClick={relayout}>
              <RefreshCw size={12} />
            </ControlButton>
            {focusNode && (
              <ControlButton title="Exit focus (Esc)" onClick={() => onFocus?.(null)} active>
                <Focus size={12} />
              </ControlButton>
            )}
          </div>

          {/* Focus banner */}
          {focusNode && (
            <div className="absolute left-1/2 rounded-lg px-3 py-1 flex items-center gap-2"
              style={{
                top: '46px', transform: 'translateX(-50%)', background: 'rgba(4,7,14,0.94)',
                border: '1px solid #334155', backdropFilter: 'blur(12px)',
              }}>
              <span className="text-[10px]" style={{ color: '#94A3B8' }}>
                Focused on <span style={{ color: '#F1F5F9', fontWeight: 600 }}>{focusNode.name}</span>
              </span>
            </div>
          )}

          {/* Minimap */}
          <div className="absolute bottom-3 right-3 rounded-lg overflow-hidden cursor-crosshair"
            style={{
              width: MINIMAP_SIZE, height: MINIMAP_SIZE,
              background: 'rgba(4,7,14,0.94)', border: '1px solid #16233A', backdropFilter: 'blur(12px)',
            }}
            onClick={onMinimapClick}
            title="Click to jump">
            <svg width={MINIMAP_SIZE} height={MINIMAP_SIZE}>
              {minimap?.points.map(p => (
                <circle key={p.key} cx={p.x} cy={p.y} r={p.dimmed ? 1 : 2}
                  fill={p.color} opacity={p.dimmed ? 0.25 : 0.9} />
              ))}
              {minimap?.target && (
                <circle cx={minimap.target.x} cy={minimap.target.y} r={5}
                  fill="none" stroke="#60A5FA" strokeWidth={1.5} />
              )}
            </svg>
            <div className="absolute bottom-0 left-0 right-0 px-1.5 py-0.5 text-[8px] tracking-wider"
              style={{ background: 'rgba(8,12,20,0.8)', color: '#475569' }}>
              {nodes.length} NODES · {links.length} LINKS
            </div>
          </div>

          {/* The frame card occupies this corner while one is staged. */}
          {!focusFrame && (
            <div className="absolute bottom-3 left-3" style={{ pointerEvents: 'none' }}>
              <span className="text-[9px]" style={{ color: '#374151' }}>
                Hover · Click to inspect · Double-click to focus · F to fit · Esc to clear
              </span>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function ControlButton({ children, title, onClick, disabled, active }: {
  children: React.ReactNode; title: string; onClick: () => void
  disabled?: boolean; active?: boolean
}) {
  return (
    <button title={title} onClick={onClick} disabled={disabled}
      className="p-1.5 rounded transition-colors"
      style={{
        color: disabled ? '#334155' : active ? '#38BDF8' : '#94A3B8',
        background: active ? '#1E293B' : 'transparent',
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}>
      {children}
    </button>
  )
}

export { riskScore, riskLevel, riskReasons, RISK_COLORS, fmtK, fmtDate, daysDiff } from '../analytics/risk'
