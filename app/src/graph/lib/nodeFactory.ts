import * as THREE from 'three'
import type { LabelLevel } from './labelPolicy'

/** Cap on cached label textures before the least-recently-used are disposed. */
export const TEXTURE_CACHE_LIMIT = 400

export interface LabelStyle {
  title: string
  subtitle?: string
  bold?: boolean
  titleColor?: string
  subtitleColor?: string
}

/** The measurement surface a canvas context needs; kept minimal so it is testable. */
export interface TextMeasurer {
  measureText: (t: string) => { width: number }
}

/**
 * Longest prefix of `text` that fits `maxWidth` in the measurer's current
 * font, ellipsised when anything was dropped.
 *
 * Truncating by character count instead overruns the fixed-width label
 * texture, and because the text is centred it is then clipped at *both* ends —
 * mangling exactly the long names a focus frame most needs to show.
 */
export function fitText(c: TextMeasurer, text: string, maxWidth: number): string {
  if (c.measureText(text).width <= maxWidth) return text
  let lo = 0, hi = text.length
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    if (c.measureText(text.slice(0, mid) + '…').width <= maxWidth) lo = mid
    else hi = mid - 1
  }
  return text.slice(0, lo) + '…'
}

function styleKey(s: LabelStyle, level: LabelLevel): string {
  return [level, s.title, s.subtitle ?? '', s.bold ? 'b' : '', s.titleColor ?? '', s.subtitleColor ?? ''].join('|')
}

/**
 * Canvas label textures are expensive to build and highly repetitive, so they
 * are cached by their exact appearance and evicted least-recently-used.
 */
export class TextureCache {
  private map = new Map<string, THREE.CanvasTexture>()
  /** Counts allocations so tests can assert we are not rebuilding every frame. */
  allocations = 0

  get(style: LabelStyle, level: LabelLevel): THREE.CanvasTexture {
    const key = styleKey(style, level)
    const hit = this.map.get(key)
    if (hit) {
      // Refresh recency.
      this.map.delete(key)
      this.map.set(key, hit)
      return hit
    }
    const tex = this.build(style, level)
    this.allocations++
    this.map.set(key, tex)
    if (this.map.size > TEXTURE_CACHE_LIMIT) {
      const oldest = this.map.keys().next().value as string | undefined
      if (oldest !== undefined) {
        this.map.get(oldest)?.dispose()
        this.map.delete(oldest)
      }
    }
    return tex
  }

  get size() { return this.map.size }

  dispose() {
    for (const t of this.map.values()) t.dispose()
    this.map.clear()
  }

  private build(style: LabelStyle, level: LabelLevel): THREE.CanvasTexture {
    const twoLine = level === 'full' && Boolean(style.subtitle)
    const W = 512
    const H = twoLine ? 128 : 84
    const canvas = document.createElement('canvas')
    canvas.width = W
    canvas.height = H
    const c = canvas.getContext('2d')!
    c.clearRect(0, 0, W, H)

    const titleFont = `${style.bold ? '600 ' : ''}44px Inter, system-ui, sans-serif`
    c.font = titleFont
    // Truncate by measured width, not character count: a 23-character name at
    // 44px overruns the 512px texture and gets clipped at *both* ends, which
    // silently mangles exactly the long names a frame most needs to show.
    const text = fitText(c,style.title, W - 48)
    const titleW = c.measureText(text).width
    let subW = 0
    let sub = style.subtitle
    if (twoLine) {
      c.font = '30px Inter, system-ui, sans-serif'
      sub = fitText(c,style.subtitle!, W - 48)
      subW = c.measureText(sub).width
    }
    const plateW = Math.min(W - 8, Math.max(titleW, subW) + 40)

    c.fillStyle = 'rgba(8,12,20,0.85)'
    const x = (W - plateW) / 2
    c.beginPath()
    c.roundRect(x, 4, plateW, H - 8, 12)
    c.fill()
    c.strokeStyle = 'rgba(51,65,85,0.9)'
    c.lineWidth = 2
    c.stroke()

    c.textAlign = 'center'
    c.textBaseline = 'middle'
    c.fillStyle = style.titleColor ?? '#F1F5F9'
    c.font = titleFont
    c.fillText(text, W / 2, twoLine ? 44 : H / 2)
    if (twoLine) {
      c.fillStyle = style.subtitleColor ?? '#94A3B8'
      c.font = '30px Inter, system-ui, sans-serif'
      c.fillText(sub!, W / 2, 90)
    }

    const tex = new THREE.CanvasTexture(canvas)
    tex.userData.aspect = H / W
    return tex
  }
}

export interface NodeVisual {
  group: THREE.Group
  label: THREE.Sprite
  labelMat: THREE.SpriteMaterial
  count: THREE.Sprite
  countMat: THREE.SpriteMaterial
  ring: THREE.Mesh
  ringMat: THREE.MeshBasicMaterial
  glow: THREE.Mesh
  glowMat: THREE.MeshBasicMaterial
  /** Appearance currently applied, so updates can skip no-op work. */
  applied: { labelKey?: string; ringColor?: string }
}

/** Base label size in NDC-ish units; sprites are screen-size-locked. */
export const LABEL_BASE = 0.2

/**
 * Build a node's visual once. Everything that can change later — colour,
 * opacity, visibility, label texture — is reachable on the returned handles and
 * mutated in place, so no frame ever rebuilds geometry.
 */
export function buildNodeVisual(countText: string): NodeVisual {
  const group = new THREE.Group()

  const countCanvas = document.createElement('canvas')
  countCanvas.width = 128
  countCanvas.height = 64
  const cc = countCanvas.getContext('2d')!
  cc.fillStyle = '#FFFFFF'
  cc.font = 'bold 36px Inter, system-ui, sans-serif'
  cc.textAlign = 'center'
  cc.textBaseline = 'middle'
  cc.fillText(countText, 64, 32)
  const countMat = new THREE.SpriteMaterial({
    map: new THREE.CanvasTexture(countCanvas), transparent: true, depthWrite: false,
  })
  const count = new THREE.Sprite(countMat)
  group.add(count)

  const glowMat = new THREE.MeshBasicMaterial({
    color: '#DC2626', transparent: true, opacity: 0, side: THREE.BackSide, depthWrite: false,
  })
  const glow = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 12), glowMat)
  glow.visible = false
  group.add(glow)

  const ringMat = new THREE.MeshBasicMaterial({
    color: '#60A5FA', transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false,
  })
  const ring = new THREE.Mesh(new THREE.RingGeometry(1, 1.2, 28), ringMat)
  ring.visible = false
  group.add(ring)

  const labelMat = new THREE.SpriteMaterial({
    transparent: true, depthWrite: false, sizeAttenuation: false,
  })
  const label = new THREE.Sprite(labelMat)
  label.center.set(0.5, 1.3)
  label.visible = false
  group.add(label)

  return {
    group, label, labelMat, count, countMat, ring, ringMat, glow, glowMat,
    applied: {},
  }
}

/** Point the label sprite at a (possibly cached) texture and size it. */
export function applyLabel(
  v: NodeVisual, cache: TextureCache, style: LabelStyle, level: LabelLevel, scale: number
) {
  if (level === 'none') {
    v.label.visible = false
    return
  }
  const key = styleKey(style, level)
  if (v.applied.labelKey !== key) {
    const tex = cache.get(style, level)
    v.labelMat.map = tex
    v.labelMat.needsUpdate = true
    const aspect = (tex.userData.aspect as number) ?? 0.25
    v.label.scale.set(LABEL_BASE * scale, LABEL_BASE * scale * aspect, 1)
    v.applied.labelKey = key
  }
  v.label.visible = true
}

/** Resize the parts that track node radius, without touching geometry. */
export function applyRadius(v: NodeVisual, r: number) {
  v.count.scale.set(r * 5, r * 2.5, 1)
  v.glow.scale.setScalar(r * 2.5)
  v.ring.scale.setScalar(r * 2.6)
}
