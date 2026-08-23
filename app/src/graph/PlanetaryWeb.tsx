import { useRef, useMemo, useEffect } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls, Html } from '@react-three/drei'
import { EffectComposer, Bloom, Vignette } from '@react-three/postprocessing'
import { BlendFunction } from 'postprocessing'
import * as THREE from 'three'
import type { GraphNode, GraphLink } from '../data/types'
import { nodeRadius, TYPE_LABELS } from './buildGraph'

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

const NODE_COLORS: Record<string, string> = {
  department: '#4da3ff',
  category: '#f5a623',
  supplier: '#e74c6f',
  owner: '#50c878',
  contract: '#a78bfa',
}

function riskScore(node: GraphNode): number {
  if (node.type !== 'contract' || !node.contract) return 0
  const c = node.contract
  let score = 0
  if (!c.owner) score += 30
  if (!c.endDate) score += 15
  if (c.endDate) {
    const days = (c.endDate.getTime() - Date.now()) / 86400000
    if (days < 0) score += 40
    else if (days < 30) score += 25
    else if (days < 90) score += 15
  }
  if (!c.annualValue || c.annualValue === 0) score += 10
  if (c.autoRenew === undefined) score += 5
  return Math.min(100, score)
}

function riskColor(score: number): string {
  if (score >= 40) return '#ef4444'
  if (score >= 20) return '#f59e0b'
  return '#22c55e'
}

/* ── Layout ── */
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
      (Math.random() - 0.5) * 50,
      (Math.random() - 0.5) * 30,
      (Math.random() - 0.5) * 30,
    ))
  }
  const maxValue = Math.max(1, ...visible.map(n => n.value))
  const velocities = new Map<string, THREE.Vector3>()
  for (const n of visible) velocities.set(n.key, new THREE.Vector3())

  for (let iter = 0; iter < 200; iter++) {
    const alpha = 1 - iter / 200
    for (let i = 0; i < visible.length; i++) {
      for (let j = i + 1; j < visible.length; j++) {
        const a = positions.get(visible[i].key)!, b = positions.get(visible[j].key)!
        const diff = new THREE.Vector3().subVectors(b, a)
        const d2 = Math.max(0.1, diff.lengthSq())
        const force = 90 / d2 * alpha
        diff.normalize().multiplyScalar(force)
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
      const target = 4 + rA + rB
      const f = (d - target) * 0.04 * alpha
      diff.normalize().multiplyScalar(f)
      velocities.get(l.source.key)!.add(diff)
      velocities.get(l.target.key)!.sub(diff)
    }
    for (const n of visible) {
      const pos = positions.get(n.key)!
      const vel = velocities.get(n.key)!
      vel.add(pos.clone().negate().multiplyScalar(0.012 * alpha))
      pos.add(vel)
      vel.multiplyScalar(0.78)
    }
  }
  return { positions, visible, visSet, maxValue }
}

function fmtK(v: number) {
  return v >= 1000000 ? `€${(v / 1000000).toFixed(1)}M` : `€${Math.round(v / 1000)}K`
}

/* ── Node ── */
function NetNode({ node, position, radius, selected, highlighted, dimmed, expiring, searchMatch, onClick }: {
  node: GraphNode; position: THREE.Vector3; radius: number; selected: boolean
  highlighted: boolean; dimmed: boolean; expiring: boolean; searchMatch: boolean
  onClick: () => void
}) {
  const glowRef = useRef<THREE.Mesh>(null!)
  const ringRef = useRef<THREE.Mesh>(null!)

  const isContract = node.type === 'contract'
  const risk = riskScore(node)
  const baseColor = isContract ? riskColor(risk) : NODE_COLORS[node.type]
  const isImportant = !isContract

  // Size encodes spend: bigger node = bigger spend
  const spendScale = isContract
    ? 0.3 + 0.7 * Math.sqrt((node.contract?.annualValue ?? 0) / 300000)
    : 1
  const sz = (isImportant ? radius * 0.06 : radius * 0.04) * spendScale
  const baseOpacity = dimmed ? 0.08 : 1

  useFrame(({ clock }) => {
    if (glowRef.current) {
      const mat = glowRef.current.material as THREE.MeshBasicMaterial
      mat.opacity = (dimmed ? 0.02 : selected ? 0.3 : highlighted ? 0.18 : 0.1)
      glowRef.current.scale.setScalar(sz * (selected ? 4 : 2.5))
    }
    if (ringRef.current) {
      ringRef.current.rotation.z = clock.elapsedTime * 0.8
    }
  })

  return (
    <group position={position}>
      {/* Soft glow */}
      <mesh ref={glowRef}>
        <sphereGeometry args={[1, 12, 12]} />
        <meshBasicMaterial color={baseColor} transparent opacity={0.1} side={THREE.BackSide} />
      </mesh>

      {/* Core sphere */}
      <mesh
        onClick={(e) => { e.stopPropagation(); onClick() }}
        onPointerOver={(e) => { e.stopPropagation(); document.body.style.cursor = 'pointer' }}
        onPointerOut={() => { document.body.style.cursor = 'auto' }}
      >
        <sphereGeometry args={[sz, 20, 20]} />
        <meshStandardMaterial
          color={baseColor}
          emissive={baseColor}
          emissiveIntensity={dimmed ? 0.1 : selected ? 1.2 : 0.6}
          transparent
          opacity={baseOpacity}
          roughness={0.3}
          metalness={0.5}
        />
      </mesh>

      {/* Risk ring for high-risk contracts */}
      {isContract && risk >= 40 && !dimmed && (
        <mesh ref={ringRef} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[sz * 2.2, 0.04, 8, 32]} />
          <meshBasicMaterial color="#ef4444" transparent opacity={0.7} />
        </mesh>
      )}

      {/* Selection ring */}
      {(selected || searchMatch) && !dimmed && (
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[sz * 2.5, 0.03, 8, 48]} />
          <meshBasicMaterial color="#ffffff" transparent opacity={0.8} />
        </mesh>
      )}

      {/* Expiring pulse */}
      {expiring && !dimmed && <ExpiringPulse size={sz} />}

      {/* Label */}
      {!dimmed && (highlighted || selected || isImportant) && (
        <Html distanceFactor={35} center style={{ pointerEvents: 'none' }}>
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
            marginTop: `${sz * 50 + 10}px`, marginLeft: `${sz * 20}px`,
          }}>
            <div style={{
              color: selected ? '#ffffff' : '#b0c4de',
              fontSize: selected ? '11px' : '9px',
              fontFamily: "'Inter', -apple-system, sans-serif",
              fontWeight: selected ? 600 : 400,
              whiteSpace: 'nowrap',
              textShadow: '0 1px 4px rgba(0,0,0,0.8)',
            }}>
              {node.name.length > 22 ? node.name.slice(0, 21) + '…' : node.name}
            </div>
            {(selected || isImportant) && node.value > 0 && (
              <div style={{
                color: '#8ba5c0', fontSize: '8px',
                fontFamily: "'Inter', sans-serif",
                textShadow: '0 1px 3px rgba(0,0,0,0.6)',
              }}>
                {fmtK(node.value)} · {node.contracts.length} contracts
              </div>
            )}
            {selected && isContract && risk > 0 && (
              <div style={{
                display: 'inline-flex', alignItems: 'center', gap: '4px',
                marginTop: '2px', padding: '1px 6px', borderRadius: '3px',
                background: risk >= 40 ? 'rgba(239,68,68,0.2)' : risk >= 20 ? 'rgba(245,158,11,0.2)' : 'rgba(34,197,94,0.2)',
                border: `1px solid ${riskColor(risk)}40`,
              }}>
                <div style={{ width: '5px', height: '5px', borderRadius: '50%', background: riskColor(risk) }} />
                <span style={{ color: riskColor(risk), fontSize: '7px', fontFamily: "'Inter', sans-serif", fontWeight: 600 }}>
                  RISK {risk}
                </span>
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
      const t = (clock.elapsedTime * 1.5) % 1
      const scale = 1 + t * 2
      ref.current.scale.setScalar(scale)
      ;(ref.current.material as THREE.MeshBasicMaterial).opacity = (1 - t) * 0.5
    }
  })
  return (
    <mesh ref={ref} rotation={[Math.PI / 2, 0, 0]}>
      <ringGeometry args={[size * 1.8, size * 2.2, 32]} />
      <meshBasicMaterial color="#f59e0b" transparent opacity={0.5} side={THREE.DoubleSide} />
    </mesh>
  )
}

/* ── Edge ── */
function Edge({ from, to, highlighted, dimmed, color, index }: {
  from: THREE.Vector3; to: THREE.Vector3; highlighted: boolean; dimmed: boolean; color: string; index: number
}) {
  const { geometry } = useMemo(() => {
    const mid = new THREE.Vector3().addVectors(from, to).multiplyScalar(0.5)
    const dist = from.distanceTo(to)
    const arcH = dist * 0.08 * (0.6 + Math.sin(index * 1.7) * 0.3)
    mid.y += arcH * Math.cos(index * 0.9)
    const curve = new THREE.QuadraticBezierCurve3(from, mid, to)
    const thickness = highlighted ? 0.035 : 0.008
    return { geometry: new THREE.TubeGeometry(curve, 20, thickness, 4, false) }
  }, [from, to, highlighted, index])

  return (
    <mesh geometry={geometry}>
      <meshBasicMaterial
        color={color}
        transparent
        opacity={dimmed ? 0.03 : highlighted ? 0.6 : 0.15}
        blending={THREE.NormalBlending}
        depthWrite={false}
      />
    </mesh>
  )
}

/* ── Subtle grid ── */
function SubtleGrid() {
  const grid = useMemo(() => {
    const g = new THREE.GridHelper(120, 30, '#1a2a40', '#0d1825')
    ;(g.material as THREE.Material).transparent = true
    ;(g.material as THREE.Material).opacity = 0.08
    return g
  }, [])
  return <primitive object={grid} position={[0, -22, 0]} />
}

/* ── Scene ── */
function Scene(props: Props) {
  const { nodes, links, visibleTypes, selected, onSelect, searchQuery, spendThreshold, highlightExpiring } = props
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

  const { camera } = useThree()
  useEffect(() => {
    if (matchedNode) {
      const pos = positions.get(matchedNode.key)
      if (pos) {
        camera.position.set(pos.x + 15, pos.y + 8, pos.z + 15)
        camera.lookAt(pos)
        onSelect(matchedNode)
      }
    }
  }, [matchedNode, positions, camera, onSelect])

  return (
    <>
      <ambientLight intensity={0.15} />
      <directionalLight position={[30, 40, 20]} intensity={0.4} color="#e0e8f0" />
      <pointLight position={[-20, 10, -15]} intensity={0.2} color="#4488cc" distance={80} />

      <SubtleGrid />

      {links.map((l, i) => {
        if (!visSet.has(l.source.key) || !visSet.has(l.target.key)) return null
        const from = positions.get(l.source.key)
        const to = positions.get(l.target.key)
        if (!from || !to) return null
        const hl = hlSet && (l.source === selected || l.target === selected)
        const dim = hlSet !== null && !hl
        const c = NODE_COLORS[l.source.type] ?? '#4488aa'
        return <Edge key={i} from={from} to={to} highlighted={!!hl} dimmed={dim} color={c} index={i} />
      })}

      {visible.map(n => {
        const pos = positions.get(n.key)
        if (!pos) return null
        const r = nodeRadius(n, maxValue)
        const isSel = selected === n
        const isHl = hlSet?.has(n.key) ?? false
        const isDim = hlSet !== null && !isHl
        return (
          <NetNode
            key={n.key} node={n} position={pos} radius={r}
            selected={isSel} highlighted={isHl} dimmed={isDim}
            expiring={expiringSet.has(n.key)} searchMatch={matchedNode === n}
            onClick={() => onSelect(n === selected ? null : n)}
          />
        )
      })}

      <OrbitControls
        enableDamping dampingFactor={0.08}
        minDistance={8} maxDistance={90}
        autoRotate autoRotateSpeed={0.08}
        zoomSpeed={0.8}
      />

      <EffectComposer multisampling={4}>
        <Bloom intensity={0.8} luminanceThreshold={0.4} luminanceSmoothing={0.9} mipmapBlur />
        <Vignette offset={0.25} darkness={0.45} blendFunction={BlendFunction.NORMAL} />
      </EffectComposer>
    </>
  )
}

export default function PlanetaryWeb(props: Props) {
  const totalSpend = props.nodes
    .filter(n => n.type === 'contract')
    .reduce((s, n) => s + (n.contract?.annualValue ?? 0), 0)

  const riskCounts = useMemo(() => {
    let high = 0, medium = 0, low = 0
    for (const n of props.nodes) {
      if (n.type !== 'contract') continue
      const r = riskScore(n)
      if (r >= 40) high++
      else if (r >= 20) medium++
      else low++
    }
    return { high, medium, low }
  }, [props.nodes])

  return (
    <div className="flex-1 relative overflow-hidden" style={{ background: '#0a1020' }}>
      <Canvas
        camera={{ position: [30, 18, 30], fov: 50, near: 0.1, far: 300 }}
        gl={{ antialias: true, alpha: false, powerPreference: 'high-performance', toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.2 } as any}
        dpr={[1, 2]}
        onPointerMissed={() => props.onSelect(null)}
      >
        <color attach="background" args={['#0a1020']} />
        <fog attach="fog" args={['#0a1020', 60, 120]} />
        <Scene {...props} />
      </Canvas>

      {/* ─── Legend: Node types ─── */}
      <div className="absolute top-3 left-3 rounded-lg p-3 pointer-events-none"
        style={{ background: 'rgba(10,16,32,0.9)', border: '1px solid rgba(255,255,255,0.08)', backdropFilter: 'blur(8px)' }}>
        <div style={{ color: '#8ba5c0', fontSize: '10px', fontWeight: 600, letterSpacing: '0.5px', marginBottom: '8px', fontFamily: "'Inter', sans-serif" }}>
          NODE TYPES
        </div>
        {Object.entries(TYPE_LABELS).map(([t, label]) => {
          const count = props.nodes.filter(n => n.type === t).length
          return (
            <label key={t} className="flex items-center gap-2 cursor-pointer" style={{ marginBottom: '4px' }}>
              <input type="checkbox" checked={props.visibleTypes[t]} readOnly className="accent-[#4da3ff]" data-type={t}
                style={{ width: '11px', height: '11px' }} />
              <span style={{
                width: '7px', height: '7px', borderRadius: '50%', display: 'inline-block',
                background: NODE_COLORS[t],
              }} />
              <span style={{ color: '#7a94b0', fontSize: '10px', flex: 1, fontFamily: "'Inter', sans-serif" }}>{label}</span>
              <span style={{ color: '#4a6a8a', fontSize: '10px', fontFamily: "'Inter', sans-serif" }}>{count}</span>
            </label>
          )
        })}
      </div>

      {/* ─── Risk summary ─── */}
      <div className="absolute top-3 right-3 rounded-lg p-3 pointer-events-none"
        style={{ background: 'rgba(10,16,32,0.9)', border: '1px solid rgba(255,255,255,0.08)', backdropFilter: 'blur(8px)', minWidth: '140px' }}>
        <div style={{ color: '#8ba5c0', fontSize: '10px', fontWeight: 600, letterSpacing: '0.5px', marginBottom: '8px', fontFamily: "'Inter', sans-serif" }}>
          RISK OVERVIEW
        </div>
        {[
          { label: 'High risk', count: riskCounts.high, color: '#ef4444' },
          { label: 'Medium risk', count: riskCounts.medium, color: '#f59e0b' },
          { label: 'Low risk', count: riskCounts.low, color: '#22c55e' },
        ].map(({ label, count, color }) => (
          <div key={label} className="flex items-center gap-2" style={{ marginBottom: '3px' }}>
            <div style={{ width: '7px', height: '7px', borderRadius: '50%', background: color }} />
            <span style={{ color: '#7a94b0', fontSize: '10px', flex: 1, fontFamily: "'Inter', sans-serif" }}>{label}</span>
            <span style={{ color, fontSize: '11px', fontWeight: 600, fontFamily: "'Inter', sans-serif" }}>{count}</span>
          </div>
        ))}
        <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', marginTop: '6px', paddingTop: '6px' }}>
          <div className="flex justify-between" style={{ fontFamily: "'Inter', sans-serif" }}>
            <span style={{ color: '#5a7a9a', fontSize: '9px' }}>Total spend</span>
            <span style={{ color: '#b0c4de', fontSize: '10px', fontWeight: 600 }}>{fmtK(totalSpend)}</span>
          </div>
        </div>
      </div>

      {/* ─── Size legend ─── */}
      <div className="absolute bottom-3 left-3 rounded-lg px-3 py-2 pointer-events-none"
        style={{ background: 'rgba(10,16,32,0.9)', border: '1px solid rgba(255,255,255,0.08)', backdropFilter: 'blur(8px)' }}>
        <div style={{ color: '#5a7a9a', fontSize: '8px', fontFamily: "'Inter', sans-serif", letterSpacing: '0.5px' }}>
          NODE SIZE = SPEND · COLOR = RISK LEVEL
        </div>
      </div>

      {/* ─── Controls hint ─── */}
      <div className="absolute bottom-3 right-3 pointer-events-none"
        style={{ color: '#3a5070', fontSize: '9px', fontFamily: "'Inter', sans-serif" }}>
        Orbit · Zoom · Click to inspect
      </div>
    </div>
  )
}
