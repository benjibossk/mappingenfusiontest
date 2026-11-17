// 3D view comfort: quality presets (tree draw distance, far tree points, pixel ratio) remembered per browser,
// and the forest tint drawn on the ground drape when the tree layer is hidden.
export type Quality = 'low' | 'medium' | 'high'
export interface QualityPreset { treeNear: number; pointsFar: number; pixelRatio: number }
const KEY = 'rm.v3d.quality'

/** tree mesh range (m), far limit of the tree points (m, 0 = whole map) and the pixel ratio cap */
export function qualityPreset(q: Quality, dpr = 1): QualityPreset {
  if (q === 'low') return { treeNear: 1200, pointsFar: 6000, pixelRatio: 1 }
  if (q === 'medium') return { treeNear: 2000, pointsFar: 12000, pixelRatio: Math.min(1.25, dpr) }
  return { treeNear: 3000, pointsFar: 0, pixelRatio: Math.min(2, dpr) }
}

export function loadQuality(): Quality | null {
  try { const v = localStorage.getItem(KEY); return v === 'low' || v === 'medium' || v === 'high' ? v : null } catch { return null }
}
export function saveQuality(q: Quality): void { try { localStorage.setItem(KEY, q) } catch { /* private window */ } }

/** canvas transform that maps world X/Z (metres) onto a square drape of `size` px covering (x0, z0, side), north up */
export function drapeTransform(size: number, x0: number, z0: number, side: number): [number, number, number, number, number, number] {
  const k = size / side
  return [k, 0, 0, -k, -x0 * k, (z0 + side) * k]
}

type Ctx = Pick<CanvasRenderingContext2D, 'setTransform' | 'beginPath' | 'moveTo' | 'lineTo' | 'closePath' | 'fill' | 'stroke'> & { fillStyle: unknown; strokeStyle: unknown; lineWidth: number }
/** subtle green fill + darker outline for every forest ring; returns the number of rings drawn */
export function drawForestTint(g: Ctx, size: number, x0: number, z0: number, side: number, forests: { pts: number[] }[]): number {
  const t = drapeTransform(size, x0, z0, side)
  g.setTransform(t[0], t[1], t[2], t[3], t[4], t[5])
  g.lineWidth = Math.max(1.5, 1.2 / t[0])
  let n = 0
  for (const f of forests) {
    const p = f.pts
    if (p.length < 6) continue
    g.beginPath(); g.moveTo(p[0], p[1])
    for (let i = 2; i + 1 < p.length; i += 2) g.lineTo(p[i], p[i + 1])
    g.closePath()
    g.fillStyle = 'rgba(38,92,34,0.30)'; g.fill()
    g.strokeStyle = 'rgba(24,60,22,0.75)'; g.stroke()
    n++
  }
  g.setTransform(1, 0, 0, 1, 0, 0)
  return n
}
