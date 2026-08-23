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
  department: '#00ccff',
  category: '#ffaa00',
  supplier: '#ff4488',
  owner: '#44ff88',
  contract: '#aa66ff',
}

/* ── Custom GLSL: Energy flow shader for edges ── */
const edgeVertexShader = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`
const edgeFragmentShader = `
  uniform float uTime;
  uniform vec3 uColor;
  uniform float uOpacity;
  uniform float uHighlighted;
  varying vec2 vUv;

  void main() {
    // Animated energy pulse traveling along the edge
    float pulse = sin(vUv.x * 12.0 - uTime * 3.0) * 0.5 + 0.5;
    float pulse2 = sin(vUv.x * 20.0 - uTime * 5.0) * 0.5 + 0.5;

    // Edge glow falloff from center
    float edgeFade = 1.0 - abs(vUv.y - 0.5) * 2.0;
    edgeFade = pow(edgeFade, 1.5);

    // Combine: base glow + traveling energy pulses
    float baseBright = 0.3 + uHighlighted * 0.4;
    float energy = baseBright + pulse * 0.35 + pulse2 * 0.15;
    energy *= edgeFade;

    // Hot white core along center
    float core = smoothstep(0.35, 0.5, edgeFade) * 0.4;

    vec3 col = mix(uColor, vec3(1.0), core * uHighlighted);
    gl_FragColor = vec4(col * energy, energy * uOpacity);
  }
`

/* ── Custom GLSL: Fresnel rim-light shader for nodes ── */
const nodeVertexShader = `
  varying vec3 vNormal;
  varying vec3 vViewDir;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vNormal = normalize(normalMatrix * normal);
    vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
    vViewDir = normalize(-mvPos.xyz);
    gl_Position = projectionMatrix * mvPos;
  }
`
const nodeFragmentShader = `
  uniform vec3 uColor;
  uniform float uTime;
  uniform float uSelected;
  uniform float uOpacity;
  varying vec3 vNormal;
  varying vec3 vViewDir;
  varying vec2 vUv;

  void main() {
    // Fresnel rim glow
    float rim = 1.0 - max(dot(vNormal, vViewDir), 0.0);
    rim = pow(rim, 2.5);

    // Inner core brightness
    float core = max(dot(vNormal, vViewDir), 0.0);
    core = pow(core, 3.0) * 0.6;

    // Pulse animation
    float pulse = 1.0 + sin(uTime * 3.0) * 0.1;

    // Combine: bright center + glowing rim
    float brightness = (core + rim * 1.2) * pulse;
    brightness = brightness * (0.8 + uSelected * 0.6);

    vec3 rimColor = mix(uColor, vec3(1.0), 0.3);
    vec3 col = mix(uColor * core, rimColor, rim);
    col += vec3(1.0) * core * 0.3; // white hot center

    gl_FragColor = vec4(col * brightness, (0.4 + rim * 0.6 + core * 0.4) * uOpacity);
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

/* ── Fresnel-lit node with glow layers ── */
function GlowNode({ node, position, radius, selected, highlighted, dimmed, expiring, searchMatch, onClick }: {
  node: GraphNode; position: THREE.Vector3; radius: number; selected: boolean
  highlighted: boolean; dimmed: boolean; expiring: boolean; searchMatch: boolean
  onClick: () => void
}) {
  const shaderRef = useRef<THREE.ShaderMaterial>(null!)
  const outerRef = useRef<THREE.Mesh>(null!)
  const ringRef = useRef<THREE.Mesh>(null!)
  const ring2Ref = useRef<THREE.Mesh>(null!)

  const color = new THREE.Color(GLOW_COLORS[node.type])
  const baseOpacity = dimmed ? 0.04 : 1
  const isImportant = node.type !== 'contract'
  const coreSize = isImportant ? radius * 0.06 : radius * 0.035
  const colorHex = GLOW_COLORS[node.type]

  const uniforms = useMemo(() => ({
    uColor: { value: color },
    uTime: { value: 0 },
    uSelected: { value: selected ? 1.0 : 0.0 },
    uOpacity: { value: baseOpacity },
  }), [])

  useFrame(({ clock }) => {
    if (shaderRef.current) {
      shaderRef.current.uniforms.uTime.value = clock.elapsedTime + position.x * 0.5
      shaderRef.current.uniforms.uSelected.value = selected ? 1.0 : highlighted ? 0.6 : 0.0
      shaderRef.current.uniforms.uOpacity.value = baseOpacity
    }
    if (outerRef.current) {
      const mat = outerRef.current.material as THREE.MeshBasicMaterial
      const pulse = 1 + Math.sin(clock.elapsedTime * 2 + position.x) * 0.15
      mat.opacity = (dimmed ? 0.015 : selected ? 0.25 : highlighted ? 0.15 : 0.08) * pulse
      outerRef.current.scale.setScalar(coreSize * (selected ? 6 : 3.5) * pulse)
    }
    if (ringRef.current) {
      ringRef.current.rotation.z = clock.elapsedTime * 1.2
      ringRef.current.rotation.x = Math.sin(clock.elapsedTime * 0.5) * 0.3 + Math.PI / 3
    }
    if (ring2Ref.current) {
      ring2Ref.current.rotation.z = -clock.elapsedTime * 0.8
      ring2Ref.current.rotation.x = Math.cos(clock.elapsedTime * 0.7) * 0.4 + Math.PI / 4
    }
  })

  return (
    <group position={position}>
      {/* Volumetric outer glow */}
      <mesh ref={outerRef}>
        <sphereGeometry args={[1, 16, 16]} />
        <meshBasicMaterial color={colorHex} transparent opacity={0.08} side={THREE.BackSide} />
      </mesh>

      {/* Fresnel-lit core sphere */}
      <mesh
        onClick={(e) => { e.stopPropagation(); onClick() }}
        onPointerOver={(e) => { e.stopPropagation(); document.body.style.cursor = 'pointer' }}
        onPointerOut={() => { document.body.style.cursor = 'auto' }}
      >
        <sphereGeometry args={[coreSize, 32, 32]} />
        <shaderMaterial
          ref={shaderRef}
          vertexShader={nodeVertexShader}
          fragmentShader={nodeFragmentShader}
          uniforms={uniforms}
          transparent
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>

      {/* Selection double rings */}
      {(selected || searchMatch) && !dimmed && (
        <>
          <mesh ref={ringRef}>
            <torusGeometry args={[coreSize * 3.5, 0.035, 12, 64]} />
            <meshBasicMaterial color={searchMatch ? '#ffffff' : colorHex} transparent opacity={0.7} />
          </mesh>
          <mesh ref={ring2Ref}>
            <torusGeometry args={[coreSize * 4.5, 0.02, 12, 64]} />
            <meshBasicMaterial color={searchMatch ? '#ffffff' : colorHex} transparent opacity={0.35} />
          </mesh>
        </>
      )}

      {/* Wireframe icosahedron shell for important nodes */}
      {isImportant && !dimmed && (
        <mesh rotation={[0.3, 0.5, 0]}>
          <icosahedronGeometry args={[coreSize * 3, 1]} />
          <meshBasicMaterial color={colorHex} transparent opacity={selected ? 0.15 : 0.05} wireframe />
        </mesh>
      )}

      {/* Expiring warning */}
      {expiring && !dimmed && <ExpiringPulse size={coreSize} />}

      {/* Data label */}
      {!dimmed && (highlighted || selected || isImportant) && (
        <Html distanceFactor={28} center style={{ pointerEvents: 'none' }}>
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            marginTop: `${coreSize * 80 + 18}px`,
          }}>
            <div style={{
              color: selected ? '#ffffff' : colorHex,
              fontSize: selected ? '11px' : '9px',
              fontFamily: '"JetBrains Mono", "SF Mono", "Fira Code", monospace',
              fontWeight: selected ? 700 : 500,
              textShadow: `0 0 8px ${colorHex}, 0 0 20px ${colorHex}40`,
              whiteSpace: 'nowrap', textTransform: 'uppercase', letterSpacing: '1px',
            }}>
              {node.name.length > 20 ? node.name.slice(0, 19) + '…' : node.name}
            </div>
            {(selected || isImportant) && node.value > 0 && (
              <div style={{
                marginTop: '3px', padding: '1px 6px',
                background: `${colorHex}18`, border: `1px solid ${colorHex}40`, borderRadius: '3px',
                color: selected ? '#ffffff' : colorHex,
                fontSize: '8px', fontFamily: '"JetBrains Mono", monospace',
                letterSpacing: '0.5px', textShadow: `0 0 6px ${colorHex}`,
              }}>
                {fmtK(node.value)}
              </div>
            )}
            {selected && (
              <div style={{
                marginTop: '2px', color: '#6a8ab0', fontSize: '8px',
                fontFamily: '"JetBrains Mono", monospace', letterSpacing: '1px',
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
        <torusGeometry args={[size * 4, 0.04, 8, 48]} />
        <meshBasicMaterial color="#ff2244" transparent opacity={0.7} />
      </mesh>
      <mesh rotation={[Math.PI / 2, 0, Math.PI / 6]}>
        <torusGeometry args={[size * 5, 0.025, 8, 48]} />
        <meshBasicMaterial color="#ff4466" transparent opacity={0.35} />
      </mesh>
    </group>
  )
}

/* ── Energy-flow edge with GLSL shader ── */
function EnergyEdge({ from, to, highlighted, dimmed, color }: {
  from: THREE.Vector3; to: THREE.Vector3; highlighted: boolean; dimmed: boolean; color: string
}) {
  const shaderRef = useRef<THREE.ShaderMaterial>(null!)

  const { geometry, uniforms } = useMemo(() => {
    const mid = new THREE.Vector3().addVectors(from, to).multiplyScalar(0.5)
    const dist = from.distanceTo(to)
    mid.y += dist * 0.06
    mid.x += Math.sin(from.x * 0.5) * dist * 0.03
    const curve = new THREE.QuadraticBezierCurve3(from, mid, to)
    const geo = new THREE.TubeGeometry(curve, 32, highlighted ? 0.06 : 0.025, 8, false)
    return {
      geometry: geo,
      uniforms: {
        uTime: { value: 0 },
        uColor: { value: new THREE.Color(color) },
        uOpacity: { value: dimmed ? 0.02 : highlighted ? 0.9 : 0.3 },
        uHighlighted: { value: highlighted ? 1.0 : 0.0 },
      },
    }
  }, [from, to, highlighted, color, dimmed])

  useFrame(({ clock }) => {
    if (shaderRef.current) {
      shaderRef.current.uniforms.uTime.value = clock.elapsedTime
    }
  })

  return (
    <mesh geometry={geometry}>
      <shaderMaterial
        ref={shaderRef}
        vertexShader={edgeVertexShader}
        fragmentShader={edgeFragmentShader}
        uniforms={uniforms}
        transparent
        blending={THREE.AdditiveBlending}
        depthWrite={false}
        side={THREE.DoubleSide}
      />
    </mesh>
  )
}

/* ── Particle trails: dots flowing along edges ── */
function EdgeParticles({ links, positions, visSet, hlSet }: {
  links: GraphLink[]; positions: Map<string, THREE.Vector3>
  visSet: Set<string>
  hlSet: Set<string> | null
}) {
  const PARTICLES_PER_EDGE = 3
  const ref = useRef<THREE.Points>(null!)

  const { posArray, colArray, progressArr, edgeCurves } = useMemo(() => {
    const visLinks = links.filter(l => visSet.has(l.source.key) && visSet.has(l.target.key))
    const count = visLinks.length * PARTICLES_PER_EDGE
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
      mid.y += dist * 0.06
      mid.x += Math.sin(from.x * 0.5) * dist * 0.03
      curves.push(new THREE.QuadraticBezierCurve3(from, mid, to))

      const c = new THREE.Color(GLOW_COLORS[l.source.type] ?? '#0088ff')
      for (let p = 0; p < PARTICLES_PER_EDGE; p++) {
        const idx = i * PARTICLES_PER_EDGE + p
        prog[idx] = p / PARTICLES_PER_EDGE
        col[idx * 3] = c.r
        col[idx * 3 + 1] = c.g
        col[idx * 3 + 2] = c.b
      }
    }

    return {
      posArray: pos,
      colArray: col,
      progressArr: prog,
      edgeCurves: curves,
    }
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
      for (let p = 0; p < PARTICLES_PER_EDGE; p++) {
        const idx = i * PARTICLES_PER_EDGE + p
        const t = (progressArr[idx] + dt * 0.15) % 1.0
        curve.getPoint(t, tmp)
        posArr[idx * 3] = tmp.x
        posArr[idx * 3 + 1] = tmp.y
        posArr[idx * 3 + 2] = tmp.z
      }
    }
    attr.needsUpdate = true
  })

  const dimAll = hlSet !== null

  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[posArray, 3]} />
        <bufferAttribute attach="attributes-color" args={[colArray, 3]} />
      </bufferGeometry>
      <pointsMaterial
        size={dimAll ? 0.08 : 0.15}
        vertexColors
        transparent
        opacity={dimAll ? 0.1 : 0.6}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
        sizeAttenuation
      />
    </points>
  )
}

/* ── Ambient floating particle field ── */
function AmbientField() {
  const ref = useRef<THREE.Points>(null!)
  const COUNT = 200
  const { posArray } = useMemo(() => {
    const pos = new Float32Array(COUNT * 3)
    for (let i = 0; i < COUNT; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 120
      pos[i * 3 + 1] = (Math.random() - 0.5) * 120
      pos[i * 3 + 2] = (Math.random() - 0.5) * 120
    }
    return { posArray: pos }
  }, [])

  useFrame(({ clock }) => {
    if (ref.current) {
      ref.current.rotation.y = clock.elapsedTime * 0.02
      ref.current.rotation.x = Math.sin(clock.elapsedTime * 0.01) * 0.1
    }
  })

  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[posArray, 3]} />
      </bufferGeometry>
      <pointsMaterial
        size={0.12}
        color="#1166aa"
        transparent
        opacity={0.4}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
        sizeAttenuation
      />
    </points>
  )
}

/* ── Grid ── */
function HoloGrid() {
  const ref = useRef<THREE.GridHelper>(null!)
  useFrame(({ clock }) => {
    if (ref.current) {
      ;(ref.current.material as THREE.Material).opacity = 0.03 + Math.sin(clock.elapsedTime * 0.5) * 0.01
    }
  })
  const grid = useMemo(() => {
    const g = new THREE.GridHelper(200, 60, '#0a3060', '#051830')
    ;(g.material as THREE.Material).transparent = true
    ;(g.material as THREE.Material).opacity = 0.035
    return g
  }, [])
  return <primitive ref={ref} object={grid} position={[0, -30, 0]} />
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
      <ambientLight intensity={0.03} />
      <pointLight position={[50, 50, 50]} intensity={0.6} color="#0066cc" distance={150} />
      <pointLight position={[-40, -30, -30]} intensity={0.4} color="#003366" distance={120} />
      <pointLight position={[0, 60, 0]} intensity={0.3} color="#0088ff" distance={100} />

      <AmbientField />
      <HoloGrid />

      {/* Particle trails along edges */}
      <EdgeParticles links={links} positions={positions} visSet={visSet} hlSet={hlSet} />

      {/* Energy-flow edges */}
      {links.map((l, i) => {
        if (!visSet.has(l.source.key) || !visSet.has(l.target.key)) return null
        const from = positions.get(l.source.key)
        const to = positions.get(l.target.key)
        if (!from || !to) return null
        const hl = hlSet && (l.source === selected || l.target === selected)
        const dim = hlSet !== null && !hl
        const c = GLOW_COLORS[l.source.type] ?? '#0088ff'
        return <EnergyEdge key={i} from={from} to={to} highlighted={!!hl} dimmed={dim} color={c} />
      })}

      {/* Fresnel-lit nodes */}
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
        <Bloom intensity={2.0} luminanceThreshold={0.08} luminanceSmoothing={0.9} mipmapBlur />
        <ChromaticAberration
          blendFunction={BlendFunction.NORMAL}
          offset={new THREE.Vector2(0.0005, 0.0005) as any}
        />
        <Vignette offset={0.25} darkness={0.7} blendFunction={BlendFunction.NORMAL} />
        <Noise blendFunction={BlendFunction.SOFT_LIGHT} opacity={0.06} />
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
        <fog attach="fog" args={['#010818', 80, 160]} />
        <Scene {...props} />
      </Canvas>

      {/* Scanline overlay */}
      <div className="absolute inset-0 pointer-events-none" style={{
        background: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,140,255,0.012) 2px, rgba(0,140,255,0.012) 4px)',
        mixBlendMode: 'screen',
      }} />

      {/* Corner brackets */}
      {[
        { t: 0, l: 0, bt: true, bl: true },
        { t: 0, r: 0, bt: true, br: true },
        { b: 0, l: 0, bb: true, bl: true },
        { b: 0, r: 0, bb: true, br: true },
      ].map((c, i) => (
        <div key={i} className="absolute w-20 h-20 pointer-events-none" style={{
          top: c.t ?? undefined, bottom: (c as any).b ?? undefined,
          left: c.l ?? undefined, right: c.r ?? undefined,
          borderTop: c.bt ? '2px solid rgba(0,140,255,0.5)' : undefined,
          borderBottom: (c as any).bb ? '2px solid rgba(0,140,255,0.5)' : undefined,
          borderLeft: c.bl ? '2px solid rgba(0,140,255,0.5)' : undefined,
          borderRight: c.br ? '2px solid rgba(0,140,255,0.5)' : undefined,
        }} />
      ))}

      {/* Horizontal scan lines at top and bottom */}
      <div className="absolute top-3 left-24 right-24 h-px pointer-events-none"
        style={{ background: 'linear-gradient(to right, transparent, rgba(0,140,255,0.35), transparent)' }} />
      <div className="absolute bottom-8 left-24 right-24 h-px pointer-events-none"
        style={{ background: 'linear-gradient(to right, transparent, rgba(0,140,255,0.2), transparent)' }} />

      {/* HUD title block */}
      <div className="absolute top-4 left-4 pointer-events-none"
        style={{ fontFamily: '"JetBrains Mono", "SF Mono", "Fira Code", monospace' }}>
        <div style={{ color: '#00aaff', fontSize: '14px', fontWeight: 700, letterSpacing: '3px', textShadow: '0 0 12px rgba(0,170,255,0.6)' }}>
          PROCUREMENT NETWORK
        </div>
        <div style={{ color: '#00aaff', fontSize: '14px', fontWeight: 700, letterSpacing: '3px', textShadow: '0 0 12px rgba(0,170,255,0.6)' }}>
          OPERATIONAL STATUS
        </div>
        <div className="mt-2 space-y-0.5">
          <div style={{ color: '#4a6a90', fontSize: '9px', letterSpacing: '1.5px' }}>REAL-TIME DATA</div>
          <div style={{ color: '#4a6a90', fontSize: '9px', letterSpacing: '1.5px' }}>STATUS: ACTIVE</div>
        </div>
      </div>

      {/* Legend */}
      <div className="absolute top-32 left-4 border rounded-lg p-3 text-xs space-y-1.5"
        style={{
          background: 'rgba(1,8,24,0.88)', borderColor: 'rgba(0,100,200,0.3)',
          backdropFilter: 'blur(12px)', fontFamily: '"JetBrains Mono", "SF Mono", monospace',
          boxShadow: '0 0 20px rgba(0,80,180,0.1)',
        }}>
        <div style={{ color: '#0077bb', fontSize: '9px', letterSpacing: '2px', fontWeight: 700, marginBottom: '6px' }}>
          SYSTEM ENTITIES
        </div>
        {Object.entries(TYPE_LABELS).map(([t, label]) => {
          const count = props.nodes.filter(n => n.type === t).length
          return (
            <label key={t} className="flex items-center gap-2 cursor-pointer group">
              <input type="checkbox" checked={props.visibleTypes[t]} readOnly className="accent-[#00aaff]" data-type={t} />
              <span className="w-2.5 h-2.5 rounded-full inline-block" style={{
                background: GLOW_COLORS[t],
                boxShadow: `0 0 6px ${GLOW_COLORS[t]}, 0 0 16px ${GLOW_COLORS[t]}60`,
              }} />
              <span className="group-hover:text-[#88bbdd] transition" style={{ color: '#5a7a9a', fontSize: '10px' }}>{label}</span>
              <span style={{ color: '#3a5a7a', fontSize: '10px' }} className="ml-auto">{count}</span>
            </label>
          )
        })}
      </div>

      {/* Stats panel */}
      {props.selected === null && (
        <div className="absolute top-4 right-4 pointer-events-none"
          style={{ fontFamily: '"JetBrains Mono", "SF Mono", monospace' }}>
          <div className="space-y-3">
            {[
              { label: 'NODES', value: String(props.nodes.length) },
              { label: 'LINKS', value: String(props.links.length) },
            ].map(({ label, value }) => (
              <div key={label} className="text-right">
                <div style={{
                  color: '#00aaff', fontSize: '20px', fontWeight: 700,
                  textShadow: '0 0 15px rgba(0,170,255,0.5)', letterSpacing: '1px',
                }}>
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
