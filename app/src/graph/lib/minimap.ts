import type { Vec3 } from './cameraDirector'

export interface MinimapPoint {
  key: string
  /** Position inside the minimap box, in pixels. */
  x: number
  y: number
  color: string
  size: number
  dimmed: boolean
}

export interface MinimapProjection {
  points: MinimapPoint[]
  /** Where the camera sits, in the same pixel space. */
  camera: { x: number; y: number } | null
  /** Where the camera is looking. */
  target: { x: number; y: number } | null
}

export interface MinimapInput {
  positions: Map<string, Vec3>
  colors: Map<string, string>
  sizes?: Map<string, number>
  dimmed?: Set<string>
  cameraPos?: Vec3
  cameraTarget?: Vec3
  width: number
  height: number
  padding?: number
}

/**
 * Flatten the settled 3D layout onto the minimap's x/z plane — the plane the
 * force layout spreads across, so the map reads like a floor plan of the graph.
 */
export function projectMinimap(input: MinimapInput): MinimapProjection {
  const pad = input.padding ?? 8
  const pts = [...input.positions.entries()]
  if (pts.length === 0) return { points: [], camera: null, target: null }

  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity
  for (const [, p] of pts) {
    if (p.x < minX) minX = p.x
    if (p.x > maxX) maxX = p.x
    if (p.z < minZ) minZ = p.z
    if (p.z > maxZ) maxZ = p.z
  }
  const spanX = Math.max(maxX - minX, 1)
  const spanZ = Math.max(maxZ - minZ, 1)
  // One scale for both axes keeps the layout's proportions honest.
  const scale = Math.min((input.width - pad * 2) / spanX, (input.height - pad * 2) / spanZ)
  const offX = (input.width - spanX * scale) / 2
  const offY = (input.height - spanZ * scale) / 2

  const toBox = (p: Vec3) => ({
    x: offX + (p.x - minX) * scale,
    y: offY + (p.z - minZ) * scale,
  })

  return {
    points: pts.map(([key, p]) => ({
      key,
      ...toBox(p),
      color: input.colors.get(key) ?? '#64748B',
      size: input.sizes?.get(key) ?? 2,
      dimmed: input.dimmed?.has(key) ?? false,
    })),
    camera: input.cameraPos ? toBox(input.cameraPos) : null,
    target: input.cameraTarget ? toBox(input.cameraTarget) : null,
  }
}

/** Turn a click inside the minimap back into a world position on the x/z plane. */
export function minimapToWorld(
  click: { x: number; y: number }, input: MinimapInput
): Vec3 | null {
  const pad = input.padding ?? 8
  const pts = [...input.positions.values()]
  if (pts.length === 0) return null
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity
  let sumY = 0
  for (const p of pts) {
    if (p.x < minX) minX = p.x
    if (p.x > maxX) maxX = p.x
    if (p.z < minZ) minZ = p.z
    if (p.z > maxZ) maxZ = p.z
    sumY += p.y
  }
  const spanX = Math.max(maxX - minX, 1)
  const spanZ = Math.max(maxZ - minZ, 1)
  const scale = Math.min((input.width - pad * 2) / spanX, (input.height - pad * 2) / spanZ)
  const offX = (input.width - spanX * scale) / 2
  const offY = (input.height - spanZ * scale) / 2
  return {
    x: minX + (click.x - offX) / scale,
    y: sumY / pts.length,
    z: minZ + (click.y - offY) / scale,
  }
}

/** The nearest node to a minimap click, for click-to-navigate. */
export function nearestKey(
  click: { x: number; y: number }, projection: MinimapProjection, maxDist = 14
): string | null {
  let best: string | null = null
  let bestD = Infinity
  for (const p of projection.points) {
    const d = Math.hypot(p.x - click.x, p.y - click.y)
    if (d < bestD) { bestD = d; best = p.key }
  }
  return bestD <= maxDist ? best : null
}
