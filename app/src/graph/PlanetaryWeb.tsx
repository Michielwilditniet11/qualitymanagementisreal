import { useRef, useMemo, useEffect } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls, Stars, Html, Float } from '@react-three/drei'
import { EffectComposer, Bloom, ChromaticAberration } from '@react-three/postprocessing'
import { BlendFunction } from 'postprocessing'
import * as THREE from 'three'
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

const TYPE_EMISSIVE: Record<string, string> = {
  department: '#1a6bff',
  category: '#cc8800',
  supplier: '#cc2244',
  owner: '#22aa44',
  contract: '#7744cc',
}

const RING_COLORS: Record<string, string> = {
  department: '#4da3ff',
  category: '#ffb347',
  supplier: '#ff6b81',
  owner: '#7bd88f',
  contract: '#b48cff',
}

function layout3D(nodes: GraphNode[], links: GraphLink[], visibleTypes: Record<string, boolean>, spendThreshold: number) {
  const visible = nodes.filter(n => {
    if (!visibleTypes[n.type]) return false
    if (n.type === 'contract' && spendThreshold > 0 && (n.contract?.annualValue ?? 0) < spendThreshold) return false
    return true
  })
  const visSet = new Set(visible.map(n => n.key))

  // Force-directed layout in 3D
  const positions = new Map<string, THREE.Vector3>()
  for (const n of visible) {
    if (!positions.has(n.key)) {
      positions.set(n.key, new THREE.Vector3(
        (Math.random() - 0.5) * 40,
        (Math.random() - 0.5) * 40,
        (Math.random() - 0.5) * 40,
      ))
    }
  }

  const maxValue = Math.max(1, ...visible.map(n => n.value))

  // Run 120 iterations of force simulation
  const velocities = new Map<string, THREE.Vector3>()
  for (const n of visible) velocities.set(n.key, new THREE.Vector3())

  for (let iter = 0; iter < 120; iter++) {
    const alpha = 1 - iter / 120

    // Repulsion
    const arr = visible
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) {
        const a = positions.get(arr[i].key)!, b = positions.get(arr[j].key)!
        const diff = new THREE.Vector3().subVectors(b, a)
        const d2 = Math.max(0.1, diff.lengthSq())
        const force = 80 / d2 * alpha
        diff.normalize().multiplyScalar(force)
        velocities.get(arr[i].key)!.sub(diff)
        velocities.get(arr[j].key)!.add(diff)
      }
    }

    // Springs
    for (const l of links) {
      if (!visSet.has(l.source.key) || !visSet.has(l.target.key)) continue
      const a = positions.get(l.source.key)!, b = positions.get(l.target.key)!
      const diff = new THREE.Vector3().subVectors(b, a)
      const d = Math.max(0.01, diff.length())
      const rA = nodeRadius(l.source, maxValue) * 0.15
      const rB = nodeRadius(l.target, maxValue) * 0.15
      const target = 3 + rA + rB
      const f = (d - target) * 0.03 * alpha
      diff.normalize().multiplyScalar(f)
      velocities.get(l.source.key)!.add(diff)
      velocities.get(l.target.key)!.sub(diff)
    }

    // Centering + integrate
    for (const n of visible) {
      const pos = positions.get(n.key)!
      const vel = velocities.get(n.key)!
      vel.add(pos.clone().negate().multiplyScalar(0.01 * alpha))
      pos.add(vel)
      vel.multiplyScalar(0.8)
    }
  }

  return { positions, visible, visSet, maxValue }
}

function PlanetNode({ node, position, radius, selected, highlighted, dimmed, expiring, searchMatch, onClick }: {
  node: GraphNode; position: THREE.Vector3; radius: number; selected: boolean
  highlighted: boolean; dimmed: boolean; expiring: boolean; searchMatch: boolean
  onClick: () => void
}) {
  const meshRef = useRef<THREE.Mesh>(null!)
  const glowRef = useRef<THREE.Mesh>(null!)
  const ringRef = useRef<THREE.Mesh>(null!)

  useFrame((_, delta) => {
    if (meshRef.current) {
      meshRef.current.rotation.y += delta * 0.3
    }
    if (ringRef.current) {
      ringRef.current.rotation.x += delta * 0.15
      ringRef.current.rotation.z += delta * 0.1
    }
  })

  const color = NODE_COLORS[node.type]
  const emissive = TYPE_EMISSIVE[node.type]
  const opacity = dimmed ? 0.08 : 1

  return (
    <group position={position}>
      {/* Glow sphere */}
      <mesh ref={glowRef} scale={radius * 2.2}>
        <sphereGeometry args={[1, 16, 16]} />
        <meshBasicMaterial color={emissive} transparent opacity={opacity * 0.12} />
      </mesh>

      {/* Main planet */}
      <Float speed={1.5} rotationIntensity={0.2} floatIntensity={0.3} enabled={!dimmed}>
        <mesh
          ref={meshRef}
          onClick={(e) => { e.stopPropagation(); onClick() }}
          onPointerOver={(e) => { e.stopPropagation(); document.body.style.cursor = 'pointer' }}
          onPointerOut={() => { document.body.style.cursor = 'auto' }}
        >
          <sphereGeometry args={[radius, 32, 32]} />
          <meshStandardMaterial
            color={color}
            emissive={emissive}
            emissiveIntensity={selected ? 2.5 : highlighted ? 1.5 : 0.6}
            metalness={0.3}
            roughness={0.4}
            transparent
            opacity={opacity}
          />
        </mesh>
      </Float>

      {/* Selection ring */}
      {(selected || searchMatch) && (
        <mesh ref={ringRef} rotation={[Math.PI / 3, 0, 0]}>
          <torusGeometry args={[radius * 1.6, 0.06, 16, 64]} />
          <meshBasicMaterial color={searchMatch ? '#ffffff' : RING_COLORS[node.type]} transparent opacity={0.8} />
        </mesh>
      )}

      {/* Expiring pulse ring */}
      {expiring && !dimmed && <ExpiringRing radius={radius} />}

      {/* Label */}
      {!dimmed && (highlighted || selected || node.type !== 'contract') && (
        <Html distanceFactor={25} center style={{ pointerEvents: 'none' }}>
          <div style={{
            color: '#dfe7f5',
            fontSize: '11px',
            fontFamily: '"Segoe UI", system-ui, sans-serif',
            textShadow: '0 0 8px rgba(0,0,0,0.9), 0 0 20px rgba(0,0,0,0.7)',
            whiteSpace: 'nowrap',
            textAlign: 'center',
            marginTop: `${radius * 12 + 14}px`,
            opacity: dimmed ? 0.15 : 1,
          }}>
            {node.name.length > 24 ? node.name.slice(0, 23) + '…' : node.name}
          </div>
        </Html>
      )}
    </group>
  )
}

function ExpiringRing({ radius }: { radius: number }) {
  const ref = useRef<THREE.Mesh>(null!)
  useFrame(({ clock }) => {
    if (ref.current) {
      const s = 1 + Math.sin(clock.elapsedTime * 3) * 0.15
      ref.current.scale.setScalar(s)
      ;(ref.current.material as THREE.MeshBasicMaterial).opacity = 0.4 + Math.sin(clock.elapsedTime * 3) * 0.2
    }
  })
  return (
    <mesh ref={ref} rotation={[Math.PI / 2, 0, 0]}>
      <torusGeometry args={[radius * 2, 0.04, 8, 48]} />
      <meshBasicMaterial color="#ff4466" transparent opacity={0.5} />
    </mesh>
  )
}

function LinkLine({ from, to, highlighted, dimmed }: { from: THREE.Vector3; to: THREE.Vector3; highlighted: boolean; dimmed: boolean }) {
  const lineObj = useMemo(() => {
    const mid = new THREE.Vector3().addVectors(from, to).multiplyScalar(0.5)
    mid.y += from.distanceTo(to) * 0.12
    const curve = new THREE.QuadraticBezierCurve3(from, mid, to)
    const points = curve.getPoints(24)
    const geometry = new THREE.BufferGeometry().setFromPoints(points)
    const material = new THREE.LineBasicMaterial({
      color: highlighted ? '#ffffff' : '#3a5080',
      transparent: true,
      opacity: dimmed ? 0.02 : highlighted ? 0.6 : 0.12,
    })
    return new THREE.Line(geometry, material)
  }, [from, to, highlighted, dimmed])

  return <primitive object={lineObj} />
}

function Scene({ nodes, links, visibleTypes, selected, onSelect, searchQuery, spendThreshold, highlightExpiring }: Props) {
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

  const searchMatch = searchQuery.trim().toLowerCase()
  const matchedNode = searchMatch ? visible.find(n => n.name.toLowerCase().includes(searchMatch)) : null

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
      {/* Ambient space lighting */}
      <ambientLight intensity={0.15} />
      <pointLight position={[30, 30, 30]} intensity={1.5} color="#4da3ff" />
      <pointLight position={[-30, -10, -20]} intensity={0.8} color="#ff6b81" />
      <pointLight position={[0, 40, 0]} intensity={0.6} color="#ffffff" />

      {/* Starfield */}
      <Stars radius={100} depth={80} count={6000} factor={4} saturation={0.2} fade speed={0.5} />

      {/* Links */}
      {links.map((l, i) => {
        if (!visSet.has(l.source.key) || !visSet.has(l.target.key)) return null
        const from = positions.get(l.source.key)
        const to = positions.get(l.target.key)
        if (!from || !to) return null
        const hl = hlSet && (l.source === selected || l.target === selected)
        const dim = hlSet !== null && !hl
        return <LinkLine key={i} from={from} to={to} highlighted={!!hl} dimmed={dim} />
      })}

      {/* Planet nodes */}
      {visible.map(n => {
        const pos = positions.get(n.key)
        if (!pos) return null
        const r = nodeRadius(n, maxValue) * 0.15
        const isSelected = selected === n
        const isHighlighted = hlSet?.has(n.key) ?? false
        const isDimmed = hlSet !== null && !isHighlighted
        return (
          <PlanetNode
            key={n.key}
            node={n}
            position={pos}
            radius={r}
            selected={isSelected}
            highlighted={isHighlighted}
            dimmed={isDimmed}
            expiring={expiringSet.has(n.key)}
            searchMatch={matchedNode === n}
            onClick={() => onSelect(n === selected ? null : n)}
          />
        )
      })}

      <OrbitControls
        enableDamping
        dampingFactor={0.05}
        minDistance={5}
        maxDistance={100}
        autoRotate
        autoRotateSpeed={0.3}
      />

      {/* Post-processing */}
      <EffectComposer>
        <Bloom
          intensity={0.8}
          luminanceThreshold={0.2}
          luminanceSmoothing={0.9}
          mipmapBlur
        />
        <ChromaticAberration
          blendFunction={BlendFunction.NORMAL}
          offset={new THREE.Vector2(0.0004, 0.0004) as any}
        />
      </EffectComposer>
    </>
  )
}

export default function PlanetaryWeb(props: Props) {
  return (
    <div className="flex-1 relative" style={{ background: '#030810' }}>
      <Canvas
        camera={{ position: [30, 20, 30], fov: 55, near: 0.1, far: 500 }}
        gl={{ antialias: true, alpha: false, powerPreference: 'high-performance' }}
        dpr={[1, 2]}
        onPointerMissed={() => props.onSelect(null)}
      >
        <color attach="background" args={['#030810']} />
        <fog attach="fog" args={['#030810', 60, 120]} />
        <Scene {...props} />
      </Canvas>

      {/* Legend overlay */}
      <div className="absolute top-3 left-3 bg-[rgba(3,8,16,0.85)] backdrop-blur-md border border-[#1a2540] rounded-xl p-3 text-xs space-y-1">
        {Object.entries(TYPE_LABELS).map(([t, label]) => {
          const count = props.nodes.filter(n => n.type === t).length
          return (
            <label key={t} className="flex items-center gap-2 text-[#8fa0bd] cursor-pointer">
              <input type="checkbox" checked={props.visibleTypes[t]} readOnly className="accent-[#4da3ff]" data-type={t} />
              <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: NODE_COLORS[t], boxShadow: `0 0 6px ${NODE_COLORS[t]}` }} />
              {label} ({count})
            </label>
          )
        })}
      </div>

      {/* Controls hint */}
      <div className="absolute bottom-3 left-3 text-[11px] text-[#4a6080]">
        Orbit: drag · Zoom: scroll · Click planet for details · Auto-rotating
      </div>
    </div>
  )
}
