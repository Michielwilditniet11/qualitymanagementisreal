import { useRef, useMemo, useEffect, useCallback } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { Stars, Grid, QuadraticBezierLine, Html, CameraControls as DreiCameraControls } from '@react-three/drei'
import { EffectComposer, Bloom, Vignette } from '@react-three/postprocessing'
import { BlendFunction } from 'postprocessing'
import * as THREE from 'three'
import type { GraphNode, GraphLink } from '../data/types'
import { nodeRadius, TYPE_LABELS } from './buildGraph'

/* ─── Props ─── */
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

/* ─── Constants ─── */
const BG = '#020408'

const TYPE_SHAPE: Record<string, string> = {
  contract: 'sphere',
  supplier: 'hexagon',
  department: 'box',
  category: 'octahedron',
  owner: 'cone',
}

const TYPE_BASE_COLORS: Record<string, string> = {
  department: '#94A3B8',
  category: '#CBD5E1',
  supplier: '#E2E8F0',
  owner: '#F1F5F9',
  contract: '#FFFFFF',
}

const EDGE_INACTIVE = '#334155'
const EDGE_ACTIVE = '#38BDF8'

/* ─── Risk ─── */
function riskScore(node: GraphNode): number {
  if (node.type !== 'contract' || !node.contract) return 0
  const c = node.contract
  let score = 0
  if (!c.owner) score += 30
  if (!c.endDate) score += 15
  if (c.endDate) {
    const days = (c.endDate.getTime() - Date.now()) / 86400000
    if (days < 0) score += 40
    else if (days <= 30) score += 25
    else if (days <= 90) score += 15
  }
  if (!c.annualValue || c.annualValue === 0) score += 10
  return Math.min(100, score)
}

function riskLevel(score: number): 'high' | 'medium' | 'low' {
  if (score >= 40) return 'high'
  if (score >= 20) return 'medium'
  return 'low'
}

const RISK_COLORS = { high: '#FF0055', medium: '#F59E0B', low: '#10B981' }

function riskReasons(node: GraphNode): string[] {
  if (node.type !== 'contract' || !node.contract) return []
  const c = node.contract
  const reasons: string[] = []
  if (!c.owner) reasons.push('Missing contract owner')
  if (!c.endDate) reasons.push('No end date defined')
  if (c.endDate) {
    const days = (c.endDate.getTime() - Date.now()) / 86400000
    if (days < 0) reasons.push(`Expired ${Math.round(-days)}d ago`)
    else if (days <= 30) reasons.push(`Expiring in ${Math.round(days)}d`)
    else if (days <= 90) reasons.push(`Expiring in ${Math.round(days)}d`)
  }
  if (!c.annualValue || c.annualValue === 0) reasons.push('No annual value')
  return reasons
}

/* ─── Layout ─── */
function layout3D(nodes: GraphNode[], links: GraphLink[], visibleTypes: Record<string, boolean>, spendThreshold: number) {
  const visible = nodes.filter(n => {
    if (!visibleTypes[n.type]) return false
    if (n.type === 'contract' && spendThreshold > 0 && (n.contract?.annualValue ?? 0) < spendThreshold) return false
    return true
  })
  const visSet = new Set(visible.map(n => n.key))
  const positions = new Map<string, THREE.Vector3>()
  for (const n of visible) {
    positions.set(n.key, new THREE.Vector3(
      (Math.random() - 0.5) * 55,
      (Math.random() - 0.5) * 30,
      (Math.random() - 0.5) * 35,
    ))
  }
  const maxValue = Math.max(1, ...visible.map(n => n.value))
  const velocities = new Map<string, THREE.Vector3>()
  for (const n of visible) velocities.set(n.key, new THREE.Vector3())

  for (let iter = 0; iter < 220; iter++) {
    const alpha = 1 - iter / 220
    for (let i = 0; i < visible.length; i++) {
      for (let j = i + 1; j < visible.length; j++) {
        const a = positions.get(visible[i].key)!, b = positions.get(visible[j].key)!
        const diff = new THREE.Vector3().subVectors(b, a)
        const d2 = Math.max(0.1, diff.lengthSq())
        diff.normalize().multiplyScalar(100 / d2 * alpha)
        velocities.get(visible[i].key)!.sub(diff)
        velocities.get(visible[j].key)!.add(diff)
      }
    }
    for (const l of links) {
      if (!visSet.has(l.source.key) || !visSet.has(l.target.key)) continue
      const a = positions.get(l.source.key)!, b = positions.get(l.target.key)!
      const diff = new THREE.Vector3().subVectors(b, a)
      const d = Math.max(0.01, diff.length())
      const rA = nodeRadius(l.source, maxValue) * 0.06
      const rB = nodeRadius(l.target, maxValue) * 0.06
      const target = 5 + rA + rB
      diff.normalize().multiplyScalar((d - target) * 0.04 * alpha)
      velocities.get(l.source.key)!.add(diff)
      velocities.get(l.target.key)!.sub(diff)
    }
    for (const n of visible) {
      const pos = positions.get(n.key)!
      const vel = velocities.get(n.key)!
      vel.add(pos.clone().negate().multiplyScalar(0.01 * alpha))
      pos.add(vel)
      vel.multiplyScalar(0.76)
    }
  }
  return { positions, visible, visSet, maxValue }
}

/* ─── Format helpers ─── */
function fmtK(v: number) {
  return v >= 1000000 ? `€${(v / 1000000).toFixed(1)}M` : v >= 1000 ? `€${Math.round(v / 1000)}K` : `€${Math.round(v)}`
}

function fmtDate(d?: Date) {
  return d ? d.toISOString().slice(0, 10) : '—'
}

function daysDiff(d: Date): number {
  return Math.round((d.getTime() - Date.now()) / 86400000)
}

/* ─── Node geometry by type ─── */
function NodeGeometry({ type, size }: { type: string; size: number }) {
  switch (TYPE_SHAPE[type]) {
    case 'hexagon':
      return <cylinderGeometry args={[size * 0.9, size * 0.9, size * 0.3, 6]} />
    case 'box':
      return <boxGeometry args={[size * 1.2, size * 1.2, size * 1.2]} />
    case 'octahedron':
      return <octahedronGeometry args={[size * 0.85]} />
    case 'cone':
      return <coneGeometry args={[size * 0.7, size * 1.1, 8]} />
    default:
      return <sphereGeometry args={[size, 24, 24]} />
  }
}

/* ─── Risk corona / halo ─── */
function RiskCorona({ risk, size }: { risk: number; size: number }) {
  const ref = useRef<THREE.Mesh>(null!)
  const level = riskLevel(risk)
  const color = RISK_COLORS[level]

  useFrame(({ clock }) => {
    if (!ref.current) return
    if (level === 'high') {
      const pulse = 1 + Math.sin(clock.elapsedTime * 3) * 0.15
      ref.current.scale.setScalar(pulse)
      ;(ref.current.material as THREE.MeshBasicMaterial).opacity = 0.25 + Math.sin(clock.elapsedTime * 3) * 0.1
    }
  })

  if (risk < 5) return null

  return (
    <mesh ref={ref}>
      <sphereGeometry args={[size * (level === 'high' ? 2.0 : 1.6), 16, 16]} />
      <meshBasicMaterial
        color={color}
        transparent
        opacity={level === 'high' ? 0.2 : level === 'medium' ? 0.12 : 0.06}
        side={THREE.BackSide}
        depthWrite={false}
      />
    </mesh>
  )
}

/* ─── High-risk wireframe shell ─── */
function WireframeShell({ size }: { size: number }) {
  const ref = useRef<THREE.Mesh>(null!)
  useFrame(({ clock }) => {
    if (ref.current) {
      ref.current.rotation.y = clock.elapsedTime * 0.4
      ref.current.rotation.x = clock.elapsedTime * 0.15
    }
  })
  return (
    <mesh ref={ref}>
      <icosahedronGeometry args={[size * 2.2, 1]} />
      <meshBasicMaterial color="#FF0055" wireframe transparent opacity={0.15} depthWrite={false} />
    </mesh>
  )
}

/* ─── Net Node ─── */
function NetNode({ node, position, selected, highlighted, dimmed, expiring, searchMatch, maxValue, onClick }: {
  node: GraphNode; position: THREE.Vector3; selected: boolean
  highlighted: boolean; dimmed: boolean; expiring: boolean; searchMatch: boolean
  maxValue: number; onClick: () => void
}) {
  const meshRef = useRef<THREE.Mesh>(null!)
  const isContract = node.type === 'contract'
  const risk = riskScore(node)
  const level = riskLevel(risk)

  const sz = isContract
    ? 0.8 + 3.0 * Math.sqrt((node.contract?.annualValue ?? 0) / Math.max(1, maxValue))
    : ({ department: 2.2, category: 1.8, supplier: 1.4, owner: 1.1 } as Record<string, number>)[node.type] || 1.2

  const baseColor = TYPE_BASE_COLORS[node.type]
  const emissiveIntensity = dimmed ? 0.05 : selected ? 1.0 : highlighted ? 0.6 : 0.3
  const opacity = dimmed ? 0.1 : 1

  useFrame(({ clock }) => {
    if (meshRef.current && !isContract) {
      meshRef.current.rotation.y = clock.elapsedTime * 0.3
    }
  })

  return (
    <group position={position}>
      {/* Risk corona */}
      {isContract && <RiskCorona risk={risk} size={sz} />}

      {/* High-risk wireframe */}
      {isContract && level === 'high' && !dimmed && <WireframeShell size={sz} />}

      {/* Core geometry */}
      <mesh
        ref={meshRef}
        onClick={(e) => { e.stopPropagation(); onClick() }}
        onPointerOver={(e) => { e.stopPropagation(); document.body.style.cursor = 'pointer' }}
        onPointerOut={() => { document.body.style.cursor = 'auto' }}
      >
        <NodeGeometry type={node.type} size={sz} />
        <meshStandardMaterial
          color={baseColor}
          emissive={isContract ? RISK_COLORS[level] : baseColor}
          emissiveIntensity={emissiveIntensity}
          transparent
          opacity={opacity}
          roughness={0.25}
          metalness={0.6}
        />
      </mesh>

      {/* Selection ring */}
      {(selected || searchMatch) && !dimmed && (
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[sz * 2.0, 0.06, 8, 48]} />
          <meshBasicMaterial color="#38BDF8" transparent opacity={0.9} />
        </mesh>
      )}

      {/* Expiring pulse ring */}
      {expiring && !dimmed && <ExpiringPulse size={sz} />}

      {/* Label */}
      {!dimmed && (highlighted || selected || !isContract) && (
        <Html distanceFactor={40} center style={{ pointerEvents: 'none' }}>
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            marginTop: `${sz * 22 + 16}px`,
          }}>
            <div style={{
              color: selected ? '#FFFFFF' : '#94A3B8',
              fontSize: selected ? '11px' : '9px',
              fontFamily: "'Inter', -apple-system, system-ui, sans-serif",
              fontWeight: selected ? 600 : 400,
              whiteSpace: 'nowrap',
              textShadow: '0 1px 6px rgba(0,0,0,0.9)',
              letterSpacing: '0.3px',
            }}>
              {node.name.length > 20 ? node.name.slice(0, 19) + '…' : node.name}
            </div>
            {node.value > 0 && (selected || !isContract) && (
              <div style={{
                color: '#64748B', fontSize: '8px',
                fontFamily: "'Inter', sans-serif",
                textShadow: '0 1px 4px rgba(0,0,0,0.8)',
              }}>
                {fmtK(node.value)}
              </div>
            )}
          </div>
        </Html>
      )}
    </group>
  )
}

function ExpiringPulse({ size }: { size: number }) {
  const ref = useRef<THREE.Mesh>(null!)
  useFrame(({ clock }) => {
    if (ref.current) {
      const t = (clock.elapsedTime * 1.2) % 1
      ref.current.scale.setScalar(1 + t * 1.5)
      ;(ref.current.material as THREE.MeshBasicMaterial).opacity = (1 - t) * 0.4
    }
  })
  return (
    <mesh ref={ref} rotation={[Math.PI / 2, 0, 0]}>
      <ringGeometry args={[size * 1.5, size * 1.8, 32]} />
      <meshBasicMaterial color="#F59E0B" transparent opacity={0.4} side={THREE.DoubleSide} depthWrite={false} />
    </mesh>
  )
}

/* ─── Edges ─── */
function GraphEdges({ links, positions, visSet, hlSet, selected }: {
  links: GraphLink[]; positions: Map<string, THREE.Vector3>
  visSet: Set<string>; hlSet: Set<string> | null; selected: GraphNode | null
}) {
  return (
    <>
      {links.map((l, i) => {
        if (!visSet.has(l.source.key) || !visSet.has(l.target.key)) return null
        const from = positions.get(l.source.key)
        const to = positions.get(l.target.key)
        if (!from || !to) return null

        const isActive = hlSet && (l.source === selected || l.target === selected)
        const isDim = hlSet !== null && !isActive

        const mid = new THREE.Vector3().addVectors(from, to).multiplyScalar(0.5)
        mid.y += from.distanceTo(to) * 0.06

        return (
          <QuadraticBezierLine
            key={i}
            start={from}
            mid={mid}
            end={to}
            color={isActive ? EDGE_ACTIVE : EDGE_INACTIVE}
            lineWidth={isActive ? 2.2 : 0.8}
            transparent
            opacity={isDim ? 0.03 : isActive ? 0.9 : 0.18}
            depthWrite={false}
          />
        )
      })}
    </>
  )
}

/* ─── Camera controller ─── */
function CameraRig({ target }: { target: THREE.Vector3 | null }) {
  const ref = useRef<any>(null!)

  useEffect(() => {
    if (target && ref.current && ref.current.setLookAt) {
      ref.current.setLookAt(
        target.x + 12, target.y + 6, target.z + 12,
        target.x, target.y, target.z,
        true,
      )
    }
  }, [target])

  return (
    <DreiCameraControls
      ref={ref}
      minDistance={6}
      maxDistance={100}
      dollySpeed={0.5}
      smoothTime={0.4}
    />
  )
}

/* ─── Scene ─── */
function Scene(props: Props & { onCameraTarget: (v: THREE.Vector3 | null) => void; cameraTarget: THREE.Vector3 | null }) {
  const { nodes, links, visibleTypes, selected, onSelect, searchQuery, spendThreshold, highlightExpiring, onCameraTarget, cameraTarget } = props
  const { positions, visible, visSet, maxValue } = useMemo(
    () => layout3D(nodes, links, visibleTypes, spendThreshold),
    [nodes, links, visibleTypes, spendThreshold]
  )

  const now = Date.now()
  const expiringSet = useMemo(() => {
    const s = new Set<string>()
    if (highlightExpiring > 0) {
      for (const n of nodes) {
        if (n.type === 'contract' && n.contract?.endDate) {
          const d = (n.contract.endDate.getTime() - now) / 86400000
          if (d > 0 && d <= highlightExpiring) s.add(n.key)
        }
      }
    }
    return s
  }, [nodes, highlightExpiring, now])

  const searchTerm = searchQuery.trim().toLowerCase()
  const matchedNode = searchTerm ? visible.find(n => n.name.toLowerCase().includes(searchTerm)) : null

  const hlSet = useMemo(() => {
    if (!selected) return null
    const s = new Set([selected.key])
    for (const nb of selected.neighbors) s.add(nb.key)
    return s
  }, [selected])

  useEffect(() => {
    if (matchedNode) {
      const pos = positions.get(matchedNode.key)
      if (pos) {
        onCameraTarget(pos)
        onSelect(matchedNode)
      }
    }
  }, [matchedNode])

  const handleNodeClick = useCallback((n: GraphNode) => {
    if (n === selected) {
      onSelect(null)
      onCameraTarget(null)
    } else {
      onSelect(n)
      const pos = positions.get(n.key)
      if (pos) onCameraTarget(pos)
    }
  }, [selected, positions, onSelect, onCameraTarget])

  return (
    <>
      {/* Lighting */}
      <ambientLight intensity={0.08} />
      <directionalLight position={[40, 50, 30]} intensity={0.35} color="#E0E8F0" />
      <pointLight position={[-30, 20, -20]} intensity={0.15} color="#38BDF8" distance={100} />
      <pointLight position={[20, -10, 30]} intensity={0.1} color="#64748B" distance={80} />

      {/* Stars */}
      <Stars radius={120} depth={60} count={800} factor={2} saturation={0} fade speed={0.3} />

      {/* Coordinate grid */}
      <Grid
        position={[0, -18, 0]}
        args={[160, 160]}
        cellSize={4}
        cellThickness={0.3}
        cellColor="#0F172A"
        sectionSize={20}
        sectionThickness={0.5}
        sectionColor="#1E293B"
        fadeDistance={80}
        fadeStrength={1.5}
        infiniteGrid
      />

      {/* Edges */}
      <GraphEdges links={links} positions={positions} visSet={visSet} hlSet={hlSet} selected={selected} />

      {/* Nodes */}
      {visible.map(n => {
        const pos = positions.get(n.key)
        if (!pos) return null
        const isSel = selected === n
        const isHl = hlSet?.has(n.key) ?? false
        const isDim = hlSet !== null && !isHl
        return (
          <NetNode
            key={n.key} node={n} position={pos}
            selected={isSel} highlighted={isHl} dimmed={isDim}
            expiring={expiringSet.has(n.key)} searchMatch={matchedNode === n}
            maxValue={maxValue}
            onClick={() => handleNodeClick(n)}
          />
        )
      })}

      <CameraRig target={cameraTarget} />

      <EffectComposer multisampling={4}>
        <Bloom intensity={0.45} luminanceThreshold={0.88} luminanceSmoothing={0.9} mipmapBlur />
        <Vignette offset={0.3} darkness={0.5} blendFunction={BlendFunction.NORMAL} />
      </EffectComposer>
    </>
  )
}

/* ─── Exported wrapper ─── */
export default function PlanetaryWeb(props: Props) {
  const { nodes, onSelect } = props
  const camTargetRef = useRef<THREE.Vector3 | null>(null)

  const handleCameraTarget = useCallback((v: THREE.Vector3 | null) => {
    camTargetRef.current = v
  }, [])

  /* ─── Risk stats ─── */
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

  const totalSpend = useMemo(() =>
    nodes.filter(n => n.type === 'contract').reduce((s, n) => s + (n.contract?.annualValue ?? 0), 0),
    [nodes]
  )

  return (
    <div className="flex-1 relative overflow-hidden" style={{ background: BG }}>
      <Canvas
        camera={{ position: [35, 22, 35], fov: 48, near: 0.1, far: 400 }}
        gl={{ antialias: true, alpha: false, powerPreference: 'high-performance', toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.1 } as any}
        dpr={[1, 2]}
        onPointerMissed={() => onSelect(null)}
      >
        <color attach="background" args={[BG]} />
        <fog attach="fog" args={[BG, 70, 150]} />
        <Scene {...props} onCameraTarget={handleCameraTarget} cameraTarget={camTargetRef.current} />
      </Canvas>

      {/* ─── HUD: Top-right risk summary ─── */}
      <div className="absolute top-3 right-3 rounded-lg p-3"
        style={{ background: 'rgba(2,4,8,0.85)', border: '1px solid rgba(56,189,248,0.12)', backdropFilter: 'blur(12px)', minWidth: '170px', pointerEvents: 'none' }}>
        <div className="text-[10px] font-semibold tracking-wider mb-2" style={{ color: '#64748B', fontFamily: "'Inter', sans-serif" }}>
          RISK OVERVIEW
        </div>
        {[
          { label: 'High risk', count: riskStats.high, color: RISK_COLORS.high },
          { label: 'Medium risk', count: riskStats.medium, color: RISK_COLORS.medium },
          { label: 'Low risk', count: riskStats.low, color: RISK_COLORS.low },
        ].map(({ label, count, color }) => (
          <div key={label} className="flex items-center gap-2 mb-1">
            <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: color, boxShadow: `0 0 6px ${color}40` }} />
            <span className="flex-1 text-[10px]" style={{ color: '#94A3B8', fontFamily: "'Inter', sans-serif" }}>{label}</span>
            <span className="text-[11px] font-semibold tabular-nums" style={{ color, fontFamily: "'Inter', sans-serif" }}>{count}</span>
          </div>
        ))}
        <div className="mt-2 pt-2" style={{ borderTop: '1px solid rgba(148,163,184,0.08)' }}>
          <div className="flex justify-between text-[9px]" style={{ fontFamily: "'Inter', sans-serif" }}>
            <span style={{ color: '#475569' }}>Spend at risk</span>
            <span className="font-semibold" style={{ color: '#FF0055' }}>{fmtK(riskStats.totalAtRisk)}</span>
          </div>
          <div className="flex justify-between text-[9px] mt-0.5" style={{ fontFamily: "'Inter', sans-serif" }}>
            <span style={{ color: '#475569' }}>Orphan contracts</span>
            <span className="font-semibold" style={{ color: '#F59E0B' }}>{riskStats.orphan}</span>
          </div>
          <div className="flex justify-between text-[9px] mt-0.5" style={{ fontFamily: "'Inter', sans-serif" }}>
            <span style={{ color: '#475569' }}>Total spend</span>
            <span className="font-semibold" style={{ color: '#E2E8F0' }}>{fmtK(totalSpend)}</span>
          </div>
        </div>
      </div>

      {/* ─── HUD: Top-left legend ─── */}
      <div className="absolute top-3 left-3 rounded-lg p-3"
        style={{ background: 'rgba(2,4,8,0.85)', border: '1px solid rgba(56,189,248,0.08)', backdropFilter: 'blur(12px)' }}>
        <div className="text-[10px] font-semibold tracking-wider mb-2" style={{ color: '#64748B', fontFamily: "'Inter', sans-serif" }}>
          NODE TYPES
        </div>
        {Object.entries(TYPE_LABELS).map(([t, label]) => {
          const count = nodes.filter(n => n.type === t).length
          return (
            <label key={t} className="flex items-center gap-2 cursor-pointer mb-1">
              <input type="checkbox" checked={props.visibleTypes[t]} readOnly data-type={t}
                className="accent-[#38BDF8]" style={{ width: '11px', height: '11px' }} />
              <span style={{
                width: '7px', height: '7px', display: 'inline-block',
                background: TYPE_BASE_COLORS[t],
                borderRadius: t === 'contract' ? '50%' : t === 'department' ? '2px' : t === 'category' ? '1px' : '50%',
                transform: t === 'category' ? 'rotate(45deg) scale(0.8)' : undefined,
              }} />
              <span className="flex-1 text-[10px]" style={{ color: '#94A3B8', fontFamily: "'Inter', sans-serif" }}>{label}</span>
              <span className="text-[10px] tabular-nums" style={{ color: '#475569', fontFamily: "'Inter', sans-serif" }}>{count}</span>
            </label>
          )
        })}

        {/* Spend scale */}
        <div className="mt-2 pt-2" style={{ borderTop: '1px solid rgba(148,163,184,0.08)' }}>
          <div className="text-[8px] tracking-wider mb-1.5" style={{ color: '#475569', fontFamily: "'Inter', sans-serif" }}>
            SPEND SCALE
          </div>
          <div className="flex items-end gap-1.5">
            {[4, 7, 11, 16].map((s, i) => (
              <div key={i} className="flex flex-col items-center gap-0.5">
                <div style={{ width: s, height: s, borderRadius: '50%', background: '#E2E8F0', opacity: 0.7 }} />
              </div>
            ))}
            <span className="text-[7px] ml-1" style={{ color: '#475569', fontFamily: "'Inter', sans-serif" }}>
              Low → High
            </span>
          </div>
        </div>

        {/* Risk encoding */}
        <div className="mt-2 pt-2" style={{ borderTop: '1px solid rgba(148,163,184,0.08)' }}>
          <div className="text-[8px] tracking-wider mb-1" style={{ color: '#475569', fontFamily: "'Inter', sans-serif" }}>
            RISK ENCODING
          </div>
          <div className="flex items-center gap-3">
            {[
              { color: RISK_COLORS.high, label: 'High' },
              { color: RISK_COLORS.medium, label: 'Med' },
              { color: RISK_COLORS.low, label: 'Low' },
            ].map(({ color, label }) => (
              <div key={label} className="flex items-center gap-1">
                <div style={{ width: '5px', height: '5px', borderRadius: '50%', background: color, boxShadow: `0 0 4px ${color}60` }} />
                <span className="text-[7px]" style={{ color: '#64748B', fontFamily: "'Inter', sans-serif" }}>{label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ─── HUD: Bottom-right controls hint ─── */}
      <div className="absolute bottom-3 right-3" style={{ pointerEvents: 'none' }}>
        <span className="text-[9px]" style={{ color: '#334155', fontFamily: "'Inter', sans-serif" }}>
          Orbit · Zoom · Click to inspect
        </span>
      </div>
    </div>
  )
}

/* ─── Export risk utilities for WebScreen ─── */
export { riskScore, riskLevel, riskReasons, RISK_COLORS, fmtK, fmtDate, daysDiff }
