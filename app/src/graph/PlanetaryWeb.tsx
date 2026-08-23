import { useRef, useMemo, useEffect } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls, Html } from '@react-three/drei'
import { EffectComposer, Bloom, Vignette, ChromaticAberration, Noise } from '@react-three/postprocessing'
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
  department: '#00bbff',
  category: '#ffaa00',
  supplier: '#ff3366',
  owner: '#33ff88',
  contract: '#8866ff',
}

/* ── GLSL: Energy-flow edge ── */
const edgeVert = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`
const edgeFrag = `
  uniform float uTime;
  uniform vec3 uColor;
  uniform float uOpacity;
  uniform float uHighlighted;
  varying vec2 vUv;
  void main() {
    float pulse = sin(vUv.x * 15.0 - uTime * 4.0) * 0.5 + 0.5;
    float pulse2 = sin(vUv.x * 25.0 - uTime * 6.0) * 0.5 + 0.5;
    float edgeFade = 1.0 - abs(vUv.y - 0.5) * 2.0;
    edgeFade = pow(edgeFade, 1.2);
    float energy = (0.4 + uHighlighted * 0.3) + pulse * 0.3 + pulse2 * 0.1;
    energy *= edgeFade;
    float core = smoothstep(0.3, 0.5, edgeFade) * 0.5;
    vec3 col = mix(uColor, vec3(1.0), core * (0.3 + uHighlighted * 0.5));
    gl_FragColor = vec4(col * energy, energy * uOpacity);
  }
`

/* ── GLSL: Hot-point node ── */
const nodeVert = `
  varying vec3 vNormal;
  varying vec3 vViewDir;
  void main() {
    vNormal = normalize(normalMatrix * normal);
    vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
    vViewDir = normalize(-mvPos.xyz);
    gl_Position = projectionMatrix * mvPos;
  }
`
const nodeFrag = `
  uniform vec3 uColor;
  uniform float uTime;
  uniform float uIntensity;
  uniform float uOpacity;
  varying vec3 vNormal;
  varying vec3 vViewDir;
  void main() {
    float rim = 1.0 - max(dot(vNormal, vViewDir), 0.0);
    rim = pow(rim, 2.0);
    float core = max(dot(vNormal, vViewDir), 0.0);
    core = pow(core, 2.0);
    float pulse = 1.0 + sin(uTime * 3.5) * 0.08;
    // White-hot center that fades to color at rim
    vec3 col = mix(vec3(1.0, 1.0, 1.0), uColor, rim * 0.8);
    float brightness = (core * 1.5 + rim * 0.8) * pulse * uIntensity;
    gl_FragColor = vec4(col * brightness, (core * 0.8 + rim * 0.5) * uOpacity);
  }
`

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
    if (!positions.has(n.key)) {
      positions.set(n.key, new THREE.Vector3(
        (Math.random() - 0.5) * 50,
        (Math.random() - 0.5) * 50,
        (Math.random() - 0.5) * 30,
      ))
    }
  }
  const maxValue = Math.max(1, ...visible.map(n => n.value))
  const velocities = new Map<string, THREE.Vector3>()
  for (const n of visible) velocities.set(n.key, new THREE.Vector3())

  for (let iter = 0; iter < 180; iter++) {
    const alpha = 1 - iter / 180
    for (let i = 0; i < visible.length; i++) {
      for (let j = i + 1; j < visible.length; j++) {
        const a = positions.get(visible[i].key)!, b = positions.get(visible[j].key)!
        const diff = new THREE.Vector3().subVectors(b, a)
        const d2 = Math.max(0.1, diff.lengthSq())
        const force = 80 / d2 * alpha
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
      const rA = nodeRadius(l.source, maxValue) * 0.08
      const rB = nodeRadius(l.target, maxValue) * 0.08
      const target = 3 + rA + rB
      const f = (d - target) * 0.04 * alpha
      diff.normalize().multiplyScalar(f)
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

function fmtK(v: number) {
  return v >= 1000000 ? `€${(v / 1000000).toFixed(1)}M` : `€${Math.round(v / 1000)}K`
}

/* ── Node component: tiny white-hot point with glow halo ── */
function NetNode({ node, position, radius, selected, highlighted, dimmed, expiring, searchMatch, onClick }: {
  node: GraphNode; position: THREE.Vector3; radius: number; selected: boolean
  highlighted: boolean; dimmed: boolean; expiring: boolean; searchMatch: boolean
  onClick: () => void
}) {
  const shaderRef = useRef<THREE.ShaderMaterial>(null!)
  const glowRef = useRef<THREE.Mesh>(null!)

  const colorHex = GLOW_COLORS[node.type]
  const color = new THREE.Color(colorHex)
  const baseOpacity = dimmed ? 0.03 : 1
  const isImportant = node.type !== 'contract'
  const sz = isImportant ? radius * 0.045 : radius * 0.025

  const uniforms = useMemo(() => ({
    uColor: { value: color },
    uTime: { value: 0 },
    uIntensity: { value: 1.0 },
    uOpacity: { value: baseOpacity },
  }), [])

  useFrame(({ clock }) => {
    if (shaderRef.current) {
      shaderRef.current.uniforms.uTime.value = clock.elapsedTime + position.x
      shaderRef.current.uniforms.uIntensity.value = dimmed ? 0.15 : selected ? 2.0 : highlighted ? 1.5 : 1.0
      shaderRef.current.uniforms.uOpacity.value = baseOpacity
    }
    if (glowRef.current) {
      const pulse = 1 + Math.sin(clock.elapsedTime * 2.5 + position.x) * 0.12
      const mat = glowRef.current.material as THREE.MeshBasicMaterial
      mat.opacity = (dimmed ? 0.01 : selected ? 0.4 : highlighted ? 0.25 : 0.15) * pulse
      glowRef.current.scale.setScalar(sz * (selected ? 5 : 3) * pulse)
    }
  })

  return (
    <group position={position}>
      {/* Glow halo */}
      <mesh ref={glowRef}>
        <sphereGeometry args={[1, 12, 12]} />
        <meshBasicMaterial color={colorHex} transparent opacity={0.15} side={THREE.BackSide} />
      </mesh>

      {/* Core point */}
      <mesh
        onClick={(e) => { e.stopPropagation(); onClick() }}
        onPointerOver={(e) => { e.stopPropagation(); document.body.style.cursor = 'pointer' }}
        onPointerOut={() => { document.body.style.cursor = 'auto' }}
      >
        <sphereGeometry args={[sz, 16, 16]} />
        <shaderMaterial
          ref={shaderRef}
          vertexShader={nodeVert}
          fragmentShader={nodeFrag}
          uniforms={uniforms}
          transparent
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>

      {/* Selection ring */}
      {(selected || searchMatch) && !dimmed && (
        <SelectionRing size={sz} color={searchMatch ? '#ffffff' : colorHex} />
      )}

      {/* Expiring pulse */}
      {expiring && !dimmed && <ExpiringPulse size={sz} />}

      {/* Label — always show for non-contract, positioned right next to node */}
      {!dimmed && (highlighted || selected || isImportant) && (
        <Html distanceFactor={30} center style={{ pointerEvents: 'none' }}>
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
            marginTop: `${sz * 60 + 14}px`, marginLeft: `${sz * 30}px`,
          }}>
            <div style={{
              color: selected ? '#ffffff' : '#c0d8f0',
              fontSize: selected ? '10px' : '8px',
              fontFamily: '"JetBrains Mono", "SF Mono", "Fira Code", monospace',
              fontWeight: selected ? 700 : 500,
              textShadow: `0 0 6px ${colorHex}, 0 0 16px rgba(0,0,0,0.8)`,
              whiteSpace: 'nowrap', textTransform: 'uppercase', letterSpacing: '0.8px',
            }}>
              {node.name.length > 18 ? node.name.slice(0, 17) + '…' : node.name}
            </div>
            {(selected || isImportant) && node.value > 0 && (
              <div style={{
                color: colorHex, fontSize: '7px',
                fontFamily: '"JetBrains Mono", monospace', letterSpacing: '0.5px',
                textShadow: `0 0 4px ${colorHex}`,
              }}>
                {fmtK(node.value)}
              </div>
            )}
            {selected && (
              <div style={{
                color: '#5a7a9a', fontSize: '7px',
                fontFamily: '"JetBrains Mono", monospace', letterSpacing: '1px',
              }}>
                {node.contracts.length} CONTRACTS
              </div>
            )}
          </div>
        </Html>
      )}
    </group>
  )
}

function SelectionRing({ size, color }: { size: number; color: string }) {
  const ref = useRef<THREE.Group>(null!)
  useFrame(({ clock }) => {
    if (ref.current) {
      ref.current.rotation.z = clock.elapsedTime * 1.5
      ref.current.rotation.x = Math.sin(clock.elapsedTime * 0.6) * 0.4 + Math.PI / 3
    }
  })
  return (
    <group ref={ref}>
      <mesh>
        <torusGeometry args={[size * 3, 0.025, 8, 48]} />
        <meshBasicMaterial color={color} transparent opacity={0.8} />
      </mesh>
      <mesh rotation={[0.5, 0.3, 0]}>
        <torusGeometry args={[size * 4, 0.015, 8, 48]} />
        <meshBasicMaterial color={color} transparent opacity={0.4} />
      </mesh>
    </group>
  )
}

function ExpiringPulse({ size }: { size: number }) {
  const ref = useRef<THREE.Group>(null!)
  useFrame(({ clock }) => {
    if (ref.current) {
      const s = 1 + Math.sin(clock.elapsedTime * 4) * 0.3
      ref.current.scale.setScalar(s)
      ref.current.rotation.z = clock.elapsedTime * 2
    }
  })
  return (
    <group ref={ref}>
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[size * 4, 0.03, 8, 48]} />
        <meshBasicMaterial color="#ff2244" transparent opacity={0.7} />
      </mesh>
    </group>
  )
}

/* ── Edge with GLSL energy shader ── */
function ArcEdge({ from, to, highlighted, dimmed, color, index }: {
  from: THREE.Vector3; to: THREE.Vector3; highlighted: boolean; dimmed: boolean; color: string; index: number
}) {
  const shaderRef = useRef<THREE.ShaderMaterial>(null!)

  const { geometry, uniforms } = useMemo(() => {
    const mid = new THREE.Vector3().addVectors(from, to).multiplyScalar(0.5)
    const dist = from.distanceTo(to)
    // Curved arcs with variation
    const arcHeight = dist * 0.12 * (0.8 + Math.sin(index * 1.7) * 0.4)
    mid.y += arcHeight * Math.cos(index * 0.9)
    mid.x += arcHeight * Math.sin(index * 1.3) * 0.5
    mid.z += arcHeight * Math.sin(index * 0.7) * 0.3
    const curve = new THREE.QuadraticBezierCurve3(from, mid, to)
    const thickness = highlighted ? 0.04 : 0.012
    const geo = new THREE.TubeGeometry(curve, 28, thickness, 6, false)
    return {
      geometry: geo,
      uniforms: {
        uTime: { value: 0 },
        uColor: { value: new THREE.Color(color) },
        uOpacity: { value: dimmed ? 0.015 : highlighted ? 1.0 : 0.35 },
        uHighlighted: { value: highlighted ? 1.0 : 0.0 },
      },
    }
  }, [from, to, highlighted, color, dimmed, index])

  useFrame(({ clock }) => {
    if (shaderRef.current) {
      shaderRef.current.uniforms.uTime.value = clock.elapsedTime + index * 0.3
    }
  })

  return (
    <mesh geometry={geometry}>
      <shaderMaterial
        ref={shaderRef}
        vertexShader={edgeVert}
        fragmentShader={edgeFrag}
        uniforms={uniforms}
        transparent
        blending={THREE.AdditiveBlending}
        depthWrite={false}
        side={THREE.DoubleSide}
      />
    </mesh>
  )
}

/* ── Particle trails flowing along edges ── */
function EdgeParticles({ links, positions, visSet, hlSet }: {
  links: GraphLink[]; positions: Map<string, THREE.Vector3>
  visSet: Set<string>; hlSet: Set<string> | null
}) {
  const PER_EDGE = 4
  const ref = useRef<THREE.Points>(null!)

  const { posArray, colArray, progressArr, edgeCurves } = useMemo(() => {
    const visLinks = links.filter(l => visSet.has(l.source.key) && visSet.has(l.target.key))
    const count = visLinks.length * PER_EDGE
    const pos = new Float32Array(count * 3)
    const col = new Float32Array(count * 3)
    const prog = new Float32Array(count)
    const curves: THREE.QuadraticBezierCurve3[] = []

    for (let i = 0; i < visLinks.length; i++) {
      const l = visLinks[i]
      const from = positions.get(l.source.key)!
      const to = positions.get(l.target.key)!
      const mid = new THREE.Vector3().addVectors(from, to).multiplyScalar(0.5)
      const dist = from.distanceTo(to)
      const arcH = dist * 0.12 * (0.8 + Math.sin(i * 1.7) * 0.4)
      mid.y += arcH * Math.cos(i * 0.9)
      mid.x += arcH * Math.sin(i * 1.3) * 0.5
      mid.z += arcH * Math.sin(i * 0.7) * 0.3
      curves.push(new THREE.QuadraticBezierCurve3(from, mid, to))

      const c = new THREE.Color(GLOW_COLORS[l.source.type] ?? '#0088ff')
      for (let p = 0; p < PER_EDGE; p++) {
        const idx = i * PER_EDGE + p
        prog[idx] = p / PER_EDGE
        col[idx * 3] = c.r; col[idx * 3 + 1] = c.g; col[idx * 3 + 2] = c.b
      }
    }
    return { posArray: pos, colArray: col, progressArr: prog, edgeCurves: curves }
  }, [links, positions, visSet])

  useFrame(({ clock }) => {
    if (!ref.current) return
    const attr = ref.current.geometry.getAttribute('position') as THREE.BufferAttribute
    if (!attr) return
    const posArr = attr.array as Float32Array
    const dt = clock.elapsedTime
    const tmp = new THREE.Vector3()
    for (let i = 0; i < edgeCurves.length; i++) {
      const curve = edgeCurves[i]
      for (let p = 0; p < PER_EDGE; p++) {
        const idx = i * PER_EDGE + p
        const t = (progressArr[idx] + dt * 0.2) % 1.0
        curve.getPoint(t, tmp)
        posArr[idx * 3] = tmp.x; posArr[idx * 3 + 1] = tmp.y; posArr[idx * 3 + 2] = tmp.z
      }
    }
    attr.needsUpdate = true
  })

  const dim = hlSet !== null

  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[posArray, 3]} />
        <bufferAttribute attach="attributes-color" args={[colArray, 3]} />
      </bufferGeometry>
      <pointsMaterial
        size={dim ? 0.06 : 0.18}
        vertexColors transparent
        opacity={dim ? 0.08 : 0.7}
        blending={THREE.AdditiveBlending}
        depthWrite={false} sizeAttenuation
      />
    </points>
  )
}

/* ── Ambient dust ── */
function AmbientDust() {
  const ref = useRef<THREE.Points>(null!)
  const COUNT = 300
  const { posArray } = useMemo(() => {
    const pos = new Float32Array(COUNT * 3)
    for (let i = 0; i < COUNT; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 140
      pos[i * 3 + 1] = (Math.random() - 0.5) * 140
      pos[i * 3 + 2] = (Math.random() - 0.5) * 100
    }
    return { posArray: pos }
  }, [])

  useFrame(({ clock }) => {
    if (ref.current) {
      ref.current.rotation.y = clock.elapsedTime * 0.015
    }
  })

  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[posArray, 3]} />
      </bufferGeometry>
      <pointsMaterial
        size={0.08} color="#1155aa"
        transparent opacity={0.35}
        blending={THREE.AdditiveBlending}
        depthWrite={false} sizeAttenuation
      />
    </points>
  )
}

/* ── Grid ── */
function HoloGrid() {
  const ref = useRef<THREE.GridHelper>(null!)
  useFrame(({ clock }) => {
    if (ref.current) {
      ;(ref.current.material as THREE.Material).opacity = 0.025 + Math.sin(clock.elapsedTime * 0.4) * 0.008
    }
  })
  const grid = useMemo(() => {
    const g = new THREE.GridHelper(180, 50, '#0a2850', '#04152a')
    ;(g.material as THREE.Material).transparent = true
    ;(g.material as THREE.Material).opacity = 0.03
    return g
  }, [])
  return <primitive ref={ref} object={grid} position={[0, -28, 0]} />
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
        camera.position.set(pos.x + 12, pos.y + 6, pos.z + 12)
        camera.lookAt(pos)
        onSelect(matchedNode)
      }
    }
  }, [matchedNode, positions, camera, onSelect])

  return (
    <>
      <ambientLight intensity={0.02} />
      <pointLight position={[50, 50, 40]} intensity={0.4} color="#0066cc" distance={150} />
      <pointLight position={[-40, -20, -30]} intensity={0.3} color="#003355" distance={120} />

      <AmbientDust />
      <HoloGrid />

      <EdgeParticles links={links} positions={positions} visSet={visSet} hlSet={hlSet} />

      {links.map((l, i) => {
        if (!visSet.has(l.source.key) || !visSet.has(l.target.key)) return null
        const from = positions.get(l.source.key)
        const to = positions.get(l.target.key)
        if (!from || !to) return null
        const hl = hlSet && (l.source === selected || l.target === selected)
        const dim = hlSet !== null && !hl
        const c = GLOW_COLORS[l.source.type] ?? '#0088ff'
        return <ArcEdge key={i} from={from} to={to} highlighted={!!hl} dimmed={dim} color={c} index={i} />
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
        enableDamping dampingFactor={0.05}
        minDistance={5} maxDistance={100}
        autoRotate autoRotateSpeed={0.15}
        zoomSpeed={0.8}
      />

      <EffectComposer multisampling={4}>
        <Bloom intensity={2.5} luminanceThreshold={0.05} luminanceSmoothing={0.95} mipmapBlur />
        <ChromaticAberration
          blendFunction={BlendFunction.NORMAL}
          offset={new THREE.Vector2(0.0004, 0.0004) as any}
        />
        <Vignette offset={0.2} darkness={0.65} blendFunction={BlendFunction.NORMAL} />
        <Noise blendFunction={BlendFunction.SOFT_LIGHT} opacity={0.05} />
      </EffectComposer>
    </>
  )
}

export default function PlanetaryWeb(props: Props) {
  const totalSpend = props.nodes
    .filter(n => n.type === 'contract')
    .reduce((s, n) => s + (n.contract?.annualValue ?? 0), 0)
  const supplierCount = props.nodes.filter(n => n.type === 'supplier').length
  const deptCount = props.nodes.filter(n => n.type === 'department').length

  return (
    <div className="flex-1 relative overflow-hidden" style={{ background: '#010a18' }}>
      <Canvas
        camera={{ position: [30, 18, 30], fov: 52, near: 0.1, far: 400 }}
        gl={{ antialias: true, alpha: false, powerPreference: 'high-performance', toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.5 } as any}
        dpr={[1, 2]}
        onPointerMissed={() => props.onSelect(null)}
      >
        <color attach="background" args={['#010a18']} />
        <fog attach="fog" args={['#010a18', 70, 140]} />
        <Scene {...props} />
      </Canvas>

      {/* Scanlines */}
      <div className="absolute inset-0 pointer-events-none" style={{
        background: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,120,255,0.01) 2px, rgba(0,120,255,0.01) 4px)',
        mixBlendMode: 'screen',
      }} />

      {/* Corner brackets */}
      {[[0,0,'tl'],[0,1,'tr'],[1,0,'bl'],[1,1,'br']].map(([v,h,k]) => (
        <div key={k as string} className="absolute w-16 h-16 pointer-events-none" style={{
          top: v === 0 ? 0 : undefined, bottom: v === 1 ? 0 : undefined,
          left: h === 0 ? 0 : undefined, right: h === 1 ? 0 : undefined,
          borderTop: v === 0 ? '2px solid rgba(0,140,255,0.45)' : undefined,
          borderBottom: v === 1 ? '2px solid rgba(0,140,255,0.45)' : undefined,
          borderLeft: h === 0 ? '2px solid rgba(0,140,255,0.45)' : undefined,
          borderRight: h === 1 ? '2px solid rgba(0,140,255,0.45)' : undefined,
        }} />
      ))}

      {/* Top line */}
      <div className="absolute top-2.5 left-20 right-20 h-px pointer-events-none"
        style={{ background: 'linear-gradient(to right, transparent, rgba(0,140,255,0.3), transparent)' }} />

      {/* ─── HUD: Title ─── */}
      <div className="absolute top-3 left-4 pointer-events-none" style={{ fontFamily: '"JetBrains Mono", "SF Mono", monospace' }}>
        <div style={{ color: '#e0f0ff', fontSize: '16px', fontWeight: 700, letterSpacing: '4px', textShadow: '0 0 12px rgba(0,170,255,0.5)' }}>
          GLOBAL NETWORK ANALYSIS
        </div>
        <div style={{ color: '#3a6a90', fontSize: '9px', letterSpacing: '1.5px', marginTop: '2px' }}>
          PROCUREMENT INTELLIGENCE · REAL-TIME SYNC
        </div>
      </div>

      {/* ─── HUD: Connection Matrix panel (top-left under title) ─── */}
      <div className="absolute top-16 left-4 border rounded p-2.5 pointer-events-none"
        style={{
          background: 'rgba(1,10,24,0.85)', borderColor: 'rgba(0,100,200,0.25)',
          fontFamily: '"JetBrains Mono", monospace', minWidth: '180px',
        }}>
        <div style={{ color: '#00aaff', fontSize: '10px', fontWeight: 700, letterSpacing: '1.5px', marginBottom: '6px' }}>
          CONNECTION MATRIX v7.2
        </div>
        {Object.entries(TYPE_LABELS).map(([t, label]) => {
          const count = props.nodes.filter(n => n.type === t).length
          return (
            <label key={t} className="flex items-center gap-2 cursor-pointer group" style={{ marginBottom: '3px' }}>
              <input type="checkbox" checked={props.visibleTypes[t]} readOnly className="accent-[#00aaff]" data-type={t}
                style={{ width: '12px', height: '12px' }} />
              <span style={{
                width: '8px', height: '8px', borderRadius: '50%', display: 'inline-block',
                background: GLOW_COLORS[t],
                boxShadow: `0 0 4px ${GLOW_COLORS[t]}, 0 0 10px ${GLOW_COLORS[t]}50`,
              }} />
              <span className="group-hover:text-[#88bbdd] transition"
                style={{ color: '#6a8aaa', fontSize: '9px', flex: 1 }}>{label}</span>
              <span style={{ color: GLOW_COLORS[t], fontSize: '9px', fontWeight: 600 }}>{count}</span>
            </label>
          )
        })}
      </div>

      {/* ─── HUD: Stats panel (top-right) ─── */}
      <div className="absolute top-3 right-4 pointer-events-none"
        style={{ fontFamily: '"JetBrains Mono", monospace', textAlign: 'right' }}>
        <div className="space-y-1">
          {[
            { label: 'NODES', value: String(props.nodes.length), color: '#00aaff' },
            { label: 'CONNECTIONS', value: String(props.links.length), color: '#00aaff' },
          ].map(({ label, value, color }) => (
            <div key={label}>
              <span style={{ color, fontSize: '18px', fontWeight: 700, textShadow: `0 0 12px ${color}50`, letterSpacing: '1px' }}>
                {value}
              </span>
              <span style={{ color: '#3a5a7a', fontSize: '8px', letterSpacing: '1.5px', marginLeft: '6px' }}>{label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ─── HUD: Bottom-left panel ─── */}
      <div className="absolute bottom-3 left-4 border rounded p-2.5 pointer-events-none"
        style={{
          background: 'rgba(1,10,24,0.85)', borderColor: 'rgba(0,100,200,0.2)',
          fontFamily: '"JetBrains Mono", monospace', minWidth: '200px',
        }}>
        <div style={{ color: '#00aaff', fontSize: '9px', fontWeight: 700, letterSpacing: '1.5px', marginBottom: '4px' }}>
          NETWORK METRICS
        </div>
        <div style={{ color: '#4a7a9a', fontSize: '8px', letterSpacing: '1px', lineHeight: '16px' }}>
          <div>TOTAL SPEND: <span style={{ color: '#00ddff' }}>{fmtK(totalSpend)}</span></div>
          <div>SUPPLIERS: <span style={{ color: '#ff3366' }}>{supplierCount}</span></div>
          <div>DEPARTMENTS: <span style={{ color: '#00bbff' }}>{deptCount}</span></div>
          <div>CORRELATION DENSITY: <span style={{ color: '#33ff88' }}>
            {props.nodes.length > 0 ? Math.round(props.links.length / props.nodes.length * 100) / 100 : 0}
          </span></div>
        </div>
      </div>

      {/* ─── HUD: Bottom-right panel ─── */}
      <div className="absolute bottom-3 right-4 pointer-events-none"
        style={{ fontFamily: '"JetBrains Mono", monospace', textAlign: 'right' }}>
        <div style={{ color: '#2a4a6a', fontSize: '8px', letterSpacing: '1.5px', lineHeight: '14px' }}>
          <div>ORBIT · ZOOM · SELECT</div>
          <div>3D NETWORK TOPOLOGY</div>
        </div>
      </div>
    </div>
  )
}
