import { useRef, useMemo, useEffect } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls, Html, Sparkles } from '@react-three/drei'
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

const GLOW_COLORS: Record<string, string> = {
  department: '#00ccff',
  category: '#ffaa00',
  supplier: '#ff4488',
  owner: '#44ff88',
  contract: '#aa66ff',
}

function layout3D(nodes: GraphNode[], links: GraphLink[], visibleTypes: Record<string, boolean>, spendThreshold: number) {
  const visible = nodes.filter(n => {
    if (!visibleTypes[n.type]) return false
    if (n.type === 'contract' && spendThreshold > 0 && (n.contract?.annualValue ?? 0) < spendThreshold) return false
    return true
  })
  const visSet = new Set(visible.map(n => n.key))
  const positions = new Map<string, THREE.Vector3>()
  for (const n of visible) {
    if (!positions.has(n.key)) {
      positions.set(n.key, new THREE.Vector3(
        (Math.random() - 0.5) * 50,
        (Math.random() - 0.5) * 50,
        (Math.random() - 0.5) * 50,
      ))
    }
  }
  const maxValue = Math.max(1, ...visible.map(n => n.value))
  const velocities = new Map<string, THREE.Vector3>()
  for (const n of visible) velocities.set(n.key, new THREE.Vector3())

  for (let iter = 0; iter < 150; iter++) {
    const alpha = 1 - iter / 150
    for (let i = 0; i < visible.length; i++) {
      for (let j = i + 1; j < visible.length; j++) {
        const a = positions.get(visible[i].key)!, b = positions.get(visible[j].key)!
        const diff = new THREE.Vector3().subVectors(b, a)
        const d2 = Math.max(0.1, diff.lengthSq())
        const force = 100 / d2 * alpha
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
      const rA = nodeRadius(l.source, maxValue) * 0.15
      const rB = nodeRadius(l.target, maxValue) * 0.15
      const target = 4 + rA + rB
      const f = (d - target) * 0.03 * alpha
      diff.normalize().multiplyScalar(f)
      velocities.get(l.source.key)!.add(diff)
      velocities.get(l.target.key)!.sub(diff)
    }
    for (const n of visible) {
      const pos = positions.get(n.key)!
      const vel = velocities.get(n.key)!
      vel.add(pos.clone().negate().multiplyScalar(0.008 * alpha))
      pos.add(vel)
      vel.multiplyScalar(0.78)
    }
  }
  return { positions, visible, visSet, maxValue }
}

function fmtK(v: number) {
  return v >= 1000000 ? `€${(v / 1000000).toFixed(1)}M` : `€${Math.round(v / 1000)}K`
}

function GlowNode({ node, position, radius, selected, highlighted, dimmed, expiring, searchMatch, onClick }: {
  node: GraphNode; position: THREE.Vector3; radius: number; selected: boolean
  highlighted: boolean; dimmed: boolean; expiring: boolean; searchMatch: boolean
  onClick: () => void
}) {
  const coreRef = useRef<THREE.Mesh>(null!)
  const glowRef = useRef<THREE.Mesh>(null!)
  const ringRef = useRef<THREE.Mesh>(null!)

  const color = GLOW_COLORS[node.type]
  const baseOpacity = dimmed ? 0.04 : 1
  const isImportant = node.type !== 'contract'
  const coreSize = isImportant ? radius * 0.12 : radius * 0.08

  useFrame(({ clock }) => {
    if (coreRef.current) {
      const pulse = 1 + Math.sin(clock.elapsedTime * 3 + position.x) * 0.15
      coreRef.current.scale.setScalar(pulse)
    }
    if (glowRef.current) {
      const mat = glowRef.current.material as THREE.MeshBasicMaterial
      mat.opacity = (dimmed ? 0.02 : selected ? 0.35 : highlighted ? 0.2 : 0.12)
        * (1 + Math.sin(clock.elapsedTime * 2) * 0.15)
    }
    if (ringRef.current) {
      ringRef.current.rotation.z = clock.elapsedTime * 0.8
      const mat = ringRef.current.material as THREE.MeshBasicMaterial
      mat.opacity = (0.4 + Math.sin(clock.elapsedTime * 3) * 0.2) * baseOpacity
    }
  })

  return (
    <group position={position}>
      {/* Outer glow sphere */}
      <mesh ref={glowRef} scale={coreSize * (selected ? 8 : 5)}>
        <sphereGeometry args={[1, 16, 16]} />
        <meshBasicMaterial color={color} transparent opacity={0.12} side={THREE.BackSide} />
      </mesh>

      {/* Core bright point */}
      <mesh
        ref={coreRef}
        onClick={(e) => { e.stopPropagation(); onClick() }}
        onPointerOver={(e) => { e.stopPropagation(); document.body.style.cursor = 'pointer' }}
        onPointerOut={() => { document.body.style.cursor = 'auto' }}
      >
        <sphereGeometry args={[coreSize, 24, 24]} />
        <meshBasicMaterial
          color={selected ? '#ffffff' : color}
          transparent
          opacity={baseOpacity}
        />
      </mesh>

      {/* Selection / search ring */}
      {(selected || searchMatch) && !dimmed && (
        <mesh ref={ringRef} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[coreSize * 3, 0.03, 8, 48]} />
          <meshBasicMaterial color={searchMatch ? '#ffffff' : color} transparent opacity={0.6} />
        </mesh>
      )}

      {/* Expiring warning ring */}
      {expiring && !dimmed && (
        <ExpiringPulse size={coreSize} />
      )}

      {/* Data label */}
      {!dimmed && (highlighted || selected || isImportant) && (
        <Html distanceFactor={28} center style={{ pointerEvents: 'none' }}>
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            marginTop: `${coreSize * 40 + 20}px`,
          }}>
            {/* Name */}
            <div style={{
              color: selected ? '#ffffff' : color,
              fontSize: selected ? '11px' : '9px',
              fontFamily: '"JetBrains Mono", "SF Mono", "Fira Code", monospace',
              fontWeight: selected ? 700 : 500,
              textShadow: `0 0 8px ${color}, 0 0 20px ${color}40`,
              whiteSpace: 'nowrap',
              textTransform: 'uppercase',
              letterSpacing: '1px',
            }}>
              {node.name.length > 20 ? node.name.slice(0, 19) + '…' : node.name}
            </div>
            {/* Value badge */}
            {(selected || isImportant) && node.value > 0 && (
              <div style={{
                marginTop: '3px',
                padding: '1px 6px',
                background: `${color}18`,
                border: `1px solid ${color}40`,
                borderRadius: '3px',
                color: selected ? '#ffffff' : color,
                fontSize: '8px',
                fontFamily: '"JetBrains Mono", monospace',
                letterSpacing: '0.5px',
                textShadow: `0 0 6px ${color}`,
              }}>
                {fmtK(node.value)}
              </div>
            )}
            {/* Extra info on selected */}
            {selected && (
              <div style={{
                marginTop: '2px',
                color: '#6a8ab0',
                fontSize: '8px',
                fontFamily: '"JetBrains Mono", monospace',
                letterSpacing: '1px',
              }}>
                {node.type.toUpperCase()} · {node.contracts.length} CONTRACTS
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
      const s = 1 + Math.sin(clock.elapsedTime * 4) * 0.3
      ref.current.scale.setScalar(s)
    }
  })
  return (
    <mesh ref={ref} rotation={[Math.PI / 2, 0, 0]}>
      <torusGeometry args={[size * 4, 0.04, 8, 48]} />
      <meshBasicMaterial color="#ff2244" transparent opacity={0.6} />
    </mesh>
  )
}

function NetworkEdge({ from, to, highlighted, dimmed, color }: {
  from: THREE.Vector3; to: THREE.Vector3; highlighted: boolean; dimmed: boolean; color: string
}) {
  const ref = useRef<THREE.Mesh>(null!)

  const geometry = useMemo(() => {
    const mid = new THREE.Vector3().addVectors(from, to).multiplyScalar(0.5)
    const dist = from.distanceTo(to)
    mid.y += dist * 0.06
    mid.x += Math.sin(from.x * 0.5) * dist * 0.03
    const curve = new THREE.QuadraticBezierCurve3(from, mid, to)
    return new THREE.TubeGeometry(curve, 24, highlighted ? 0.05 : 0.018, 6, false)
  }, [from, to, highlighted])

  useFrame(({ clock }) => {
    if (ref.current && highlighted) {
      const mat = ref.current.material as THREE.MeshBasicMaterial
      mat.opacity = 0.5 + Math.sin(clock.elapsedTime * 4) * 0.2
    }
  })

  return (
    <mesh ref={ref} geometry={geometry}>
      <meshBasicMaterial
        color={highlighted ? '#ffffff' : color}
        transparent
        opacity={dimmed ? 0.01 : highlighted ? 0.6 : 0.1}
      />
    </mesh>
  )
}

function HoloGrid() {
  const ref = useRef<THREE.GridHelper>(null!)
  useFrame(({ clock }) => {
    if (ref.current) {
      ;(ref.current.material as THREE.Material).opacity = 0.025 + Math.sin(clock.elapsedTime * 0.5) * 0.008
    }
  })
  const grid = useMemo(() => {
    const g = new THREE.GridHelper(200, 60, '#0a3060', '#051830')
    ;(g.material as THREE.Material).transparent = true
    ;(g.material as THREE.Material).opacity = 0.03
    return g
  }, [])
  return <primitive ref={ref} object={grid} position={[0, -30, 0]} />
}

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
      {/* Minimal lighting — we rely on emissive/basic materials */}
      <ambientLight intensity={0.05} />
      <pointLight position={[40, 40, 40]} intensity={0.8} color="#0088ff" distance={120} />
      <pointLight position={[-30, -20, -20]} intensity={0.5} color="#004488" distance={100} />

      {/* Subtle sparkle field */}
      <Sparkles count={60} scale={80} size={0.8} speed={0.15} color="#0088ff" opacity={0.2} />

      <HoloGrid />

      {/* Edges */}
      {links.map((l, i) => {
        if (!visSet.has(l.source.key) || !visSet.has(l.target.key)) return null
        const from = positions.get(l.source.key)
        const to = positions.get(l.target.key)
        if (!from || !to) return null
        const hl = hlSet && (l.source === selected || l.target === selected)
        const dim = hlSet !== null && !hl
        const c = GLOW_COLORS[l.source.type] ?? '#0088ff'
        return <NetworkEdge key={i} from={from} to={to} highlighted={!!hl} dimmed={dim} color={c} />
      })}

      {/* Nodes */}
      {visible.map(n => {
        const pos = positions.get(n.key)
        if (!pos) return null
        const r = nodeRadius(n, maxValue)
        const isSelected = selected === n
        const isHighlighted = hlSet?.has(n.key) ?? false
        const isDimmed = hlSet !== null && !isHighlighted
        return (
          <GlowNode
            key={n.key} node={n} position={pos} radius={r}
            selected={isSelected} highlighted={isHighlighted} dimmed={isDimmed}
            expiring={expiringSet.has(n.key)} searchMatch={matchedNode === n}
            onClick={() => onSelect(n === selected ? null : n)}
          />
        )
      })}

      <OrbitControls
        enableDamping dampingFactor={0.04}
        minDistance={5} maxDistance={120}
        autoRotate autoRotateSpeed={0.2}
        zoomSpeed={0.8}
      />

      <EffectComposer multisampling={4}>
        <Bloom intensity={1.5} luminanceThreshold={0.1} luminanceSmoothing={0.9} mipmapBlur />
        <Vignette offset={0.3} darkness={0.65} blendFunction={BlendFunction.NORMAL} />
      </EffectComposer>
    </>
  )
}

export default function PlanetaryWeb(props: Props) {
  return (
    <div className="flex-1 relative overflow-hidden" style={{ background: '#010818' }}>
      <Canvas
        camera={{ position: [35, 22, 35], fov: 50, near: 0.1, far: 500 }}
        gl={{ antialias: true, alpha: false, powerPreference: 'high-performance', toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.4 } as any}
        dpr={[1, 2]}
        onPointerMissed={() => props.onSelect(null)}
      >
        <color attach="background" args={['#010818']} />
        <fog attach="fog" args={['#010818', 80, 150]} />
        <Scene {...props} />
      </Canvas>

      {/* Scanline overlay */}
      <div className="absolute inset-0 pointer-events-none" style={{
        background: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,140,255,0.012) 2px, rgba(0,140,255,0.012) 4px)',
        mixBlendMode: 'screen',
      }} />

      {/* Corner brackets */}
      <div className="absolute top-0 left-0 w-20 h-20 pointer-events-none"
        style={{ borderTop: '2px solid rgba(0,140,255,0.4)', borderLeft: '2px solid rgba(0,140,255,0.4)' }} />
      <div className="absolute top-0 right-0 w-20 h-20 pointer-events-none"
        style={{ borderTop: '2px solid rgba(0,140,255,0.4)', borderRight: '2px solid rgba(0,140,255,0.4)' }} />
      <div className="absolute bottom-0 left-0 w-20 h-20 pointer-events-none"
        style={{ borderBottom: '2px solid rgba(0,140,255,0.4)', borderLeft: '2px solid rgba(0,140,255,0.4)' }} />
      <div className="absolute bottom-0 right-0 w-20 h-20 pointer-events-none"
        style={{ borderBottom: '2px solid rgba(0,140,255,0.4)', borderRight: '2px solid rgba(0,140,255,0.4)' }} />

      {/* Top header line */}
      <div className="absolute top-3 left-24 right-24 h-px pointer-events-none"
        style={{ background: 'linear-gradient(to right, transparent, rgba(0,140,255,0.3), transparent)' }} />

      {/* HUD title block */}
      <div className="absolute top-4 left-4 pointer-events-none"
        style={{ fontFamily: '"JetBrains Mono", "SF Mono", "Fira Code", monospace' }}>
        <div style={{ color: '#00aaff', fontSize: '13px', fontWeight: 700, letterSpacing: '2px', textShadow: '0 0 10px rgba(0,170,255,0.5)' }}>
          PROCUREMENT NETWORK
        </div>
        <div style={{ color: '#00aaff', fontSize: '13px', fontWeight: 700, letterSpacing: '2px', textShadow: '0 0 10px rgba(0,170,255,0.5)' }}>
          OPERATIONAL STATUS
        </div>
        <div className="mt-1.5 space-y-0.5">
          <div style={{ color: '#4a6a90', fontSize: '9px', letterSpacing: '1px' }}>REAL-TIME DATA</div>
          <div style={{ color: '#4a6a90', fontSize: '9px', letterSpacing: '1px' }}>STATUS: ACTIVE</div>
        </div>
      </div>

      {/* Legend */}
      <div className="absolute top-28 left-4 border rounded-lg p-3 text-xs space-y-1.5"
        style={{
          background: 'rgba(1,8,24,0.85)',
          borderColor: 'rgba(0,100,200,0.25)',
          backdropFilter: 'blur(12px)',
          fontFamily: '"JetBrains Mono", "SF Mono", monospace',
        }}>
        <div style={{ color: '#0077bb', fontSize: '9px', letterSpacing: '2px', fontWeight: 700, marginBottom: '6px' }}>
          SYSTEM ENTITIES
        </div>
        {Object.entries(TYPE_LABELS).map(([t, label]) => {
          const count = props.nodes.filter(n => n.type === t).length
          return (
            <label key={t} className="flex items-center gap-2 cursor-pointer group">
              <input type="checkbox" checked={props.visibleTypes[t]} readOnly className="accent-[#00aaff]" data-type={t} />
              <span className="w-2 h-2 rounded-full inline-block" style={{
                background: GLOW_COLORS[t],
                boxShadow: `0 0 6px ${GLOW_COLORS[t]}, 0 0 14px ${GLOW_COLORS[t]}60`,
              }} />
              <span className="group-hover:text-[#88bbdd] transition" style={{ color: '#5a7a9a', fontSize: '10px' }}>{label}</span>
              <span style={{ color: '#3a5a7a', fontSize: '10px' }} className="ml-auto">{count}</span>
            </label>
          )
        })}
      </div>

      {/* Right side stats panel */}
      {props.selected === null && (
        <div className="absolute top-4 right-4 pointer-events-none"
          style={{ fontFamily: '"JetBrains Mono", "SF Mono", monospace' }}>
          <div className="space-y-2">
            {[
              { label: 'NODES', value: String(props.nodes.length) },
              { label: 'LINKS', value: String(props.links.length) },
            ].map(({ label, value }) => (
              <div key={label} className="text-right">
                <div style={{ color: '#00aaff', fontSize: '18px', fontWeight: 700, textShadow: '0 0 12px rgba(0,170,255,0.4)', letterSpacing: '1px' }}>
                  {value}
                </div>
                <div style={{ color: '#4a6a90', fontSize: '9px', letterSpacing: '2px' }}>{label}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Bottom bar */}
      <div className="absolute bottom-3 left-4 right-4 flex justify-between items-end pointer-events-none"
        style={{ fontFamily: '"JetBrains Mono", "SF Mono", monospace' }}>
        <div style={{ color: '#2a4a6a', fontSize: '9px', letterSpacing: '1.5px' }}>
          NETWORK TOPOLOGY · INTERACTIVE
        </div>
        <div style={{ color: '#2a4a6a', fontSize: '9px', letterSpacing: '1.5px' }}>
          ORBIT · ZOOM · SELECT
        </div>
      </div>
    </div>
  )
}
