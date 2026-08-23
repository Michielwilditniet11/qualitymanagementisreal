export interface Vec3 { x: number; y: number; z: number }

export interface Bounds {
  centre: Vec3
  /** Distance from the centre to the furthest point. */
  radius: number
}

export type CameraIntent =
  | { kind: 'overview' }
  | { kind: 'frameNodes'; keys: string[]; label?: string }
  | { kind: 'approach'; key: string }

export interface CameraPose {
  position: Vec3
  lookAt: Vec3
}

/** Framing multipliers per intent — named so tests reference them, not numbers. */
export const FRAMING = {
  overview: 2.4,
  frameNodes: 1.95,
  approach: 3.2,
}
/** Never fly closer than this, or further than the fog can carry. */
export const MIN_DISTANCE = 70
export const MAX_DISTANCE = 900
/** Camera sits slightly above the subject so the layout reads in depth. */
export const ELEVATION = 0.22
export const MIN_DURATION = 220
export const MAX_DURATION = 900

export function boundsOf(points: Vec3[]): Bounds | null {
  if (points.length === 0) return null
  let cx = 0, cy = 0, cz = 0
  for (const p of points) { cx += p.x; cy += p.y; cz += p.z }
  cx /= points.length; cy /= points.length; cz /= points.length
  let radius = 0
  for (const p of points) {
    const d = Math.hypot(p.x - cx, p.y - cy, p.z - cz)
    if (d > radius) radius = d
  }
  return { centre: { x: cx, y: cy, z: cz }, radius }
}

export function distanceFor(bounds: Bounds, multiplier: number): number {
  const raw = Math.max(bounds.radius, 1) * multiplier
  return Math.min(Math.max(raw, MIN_DISTANCE), MAX_DISTANCE)
}

/** Where the camera should sit to frame these bounds. */
export function poseFor(bounds: Bounds, multiplier: number, from?: Vec3): CameraPose {
  const dist = distanceFor(bounds, multiplier)
  const c = bounds.centre
  if (from) {
    // Keep the viewing angle the user already has; only change the distance.
    const dx = from.x - c.x, dy = from.y - c.y, dz = from.z - c.z
    const len = Math.hypot(dx, dy, dz)
    if (len > 1e-3) {
      return {
        position: { x: c.x + (dx / len) * dist, y: c.y + (dy / len) * dist, z: c.z + (dz / len) * dist },
        lookAt: c,
      }
    }
  }
  return {
    position: { x: c.x, y: c.y + dist * ELEVATION, z: c.z + dist },
    lookAt: c,
  }
}

/** Longer journeys take longer, within bounds — motion reads as continuous. */
export function durationFor(from: Vec3, to: Vec3): number {
  const d = Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z)
  return Math.round(Math.min(Math.max(MIN_DURATION + d * 1.1, MIN_DURATION), MAX_DURATION))
}

export interface DirectorDeps {
  /** Positions of every node currently in the scene. */
  positions: () => Map<string, Vec3>
  /** Current camera position. */
  cameraPosition: () => Vec3
  /** Move the camera. The only place this may be called. */
  moveCamera: (pose: CameraPose, durationMs: number) => void
}

export interface ExecutedIntent {
  intent: CameraIntent
  pose: CameraPose
  at: number
}

/**
 * The single owner of camera movement. Every feature asks for an intent; the
 * director resolves framing, preempts any flight in progress from wherever the
 * camera actually is, and records what it did for navigation history.
 */
export class CameraDirector {
  private deps: DirectorDeps
  private log: ExecutedIntent[] = []

  constructor(deps: DirectorDeps) {
    this.deps = deps
  }

  /** Resolve an intent to a pose, or null when there is nothing to frame. */
  resolve(intent: CameraIntent, keepAngle = true): CameraPose | null {
    const positions = this.deps.positions()
    const from = this.deps.cameraPosition()

    let points: Vec3[]
    let multiplier: number

    if (intent.kind === 'overview') {
      points = [...positions.values()]
      multiplier = FRAMING.overview
    } else if (intent.kind === 'frameNodes') {
      points = intent.keys.map(k => positions.get(k)).filter((p): p is Vec3 => Boolean(p))
      multiplier = FRAMING.frameNodes
    } else {
      const p = positions.get(intent.key)
      points = p ? [p] : []
      multiplier = FRAMING.approach
    }

    const bounds = boundsOf(points)
    if (!bounds) return null
    return poseFor(bounds, multiplier, keepAngle ? from : undefined)
  }

  /** Execute an intent. Returns the pose flown to, or null when unframeable. */
  flyTo(intent: CameraIntent, opts: { keepAngle?: boolean; instant?: boolean } = {}): CameraPose | null {
    const pose = this.resolve(intent, opts.keepAngle ?? true)
    if (!pose) return null
    const from = this.deps.cameraPosition()
    const duration = opts.instant ? 0 : durationFor(from, pose.position)
    this.deps.moveCamera(pose, duration)
    this.log.push({ intent, pose, at: this.log.length })
    return pose
  }

  history(): ExecutedIntent[] {
    return [...this.log]
  }

  lastIntent(): CameraIntent | null {
    return this.log.length ? this.log[this.log.length - 1].intent : null
  }
}
