// P4 #19: real prefab footprints for the Atelier objects (buildings, port pieces) instead of fixed squares.
// Dimensions from library/prefabs-catalogue.json (.xob bbox, cross-checked with profile/MapGen/prefabs.txt, dims.ts).
// The local -> world rotation is the one of the layer parser (layer.ts toWorld): x' = lx·cos + lz·sin,
// z' = -lx·sin + lz·cos. Pure, no DOM.
import { dimsFootprint } from '../library/dims.ts'

export interface AtelierObject { x: number; z: number; yaw?: number; prefab?: string }

/** default half sizes when a prefab is unknown (the old drawing: 10 m house, 18 m industrial square) */
export const FALLBACK_HALF = { house: 5, industrial: 9, port: 4 } as const

/** 4 world corners (flat X/Z) of an object from its real dims, else a square of half side `fallbackHalf` */
export function objectFootprint(o: AtelierObject, fallbackHalf: number): { corners: number[]; measured: boolean } {
  const f = o.prefab ? dimsFootprint(o.prefab, { minX: -fallbackHalf, maxX: fallbackHalf, minZ: -fallbackHalf, maxZ: fallbackHalf, h: 0 }) : { minX: -fallbackHalf, maxX: fallbackHalf, minZ: -fallbackHalf, maxZ: fallbackHalf, h: 0 }
  const a = ((o.yaw ?? 0) * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a)
  const corners: number[] = []
  for (const [lx, lz] of [[f.minX, f.minZ], [f.maxX, f.minZ], [f.maxX, f.maxZ], [f.minX, f.maxZ]]) corners.push(o.x + lx * c + lz * s, o.z - lx * s + lz * c)
  return { corners, measured: !!(f as { measured?: boolean }).measured }
}

function sep(a: number[], b: number[], eps: number): boolean {
  for (const p of [a, b]) for (let i = 0; i < p.length; i += 2) {
    const ex = p[(i + 2) % p.length] - p[i], ez = p[(i + 3) % p.length] - p[i + 1], l = Math.hypot(ex, ez)
    if (l < 1e-9) continue
    const nx = -ez / l, nz = ex / l
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity
    for (let k = 0; k < a.length; k += 2) { const v = a[k] * nx + a[k + 1] * nz; a0 = Math.min(a0, v); a1 = Math.max(a1, v) }
    for (let k = 0; k < b.length; k += 2) { const v = b[k] * nx + b[k + 1] * nz; b0 = Math.min(b0, v); b1 = Math.max(b1, v) }
    if (a1 - b0 <= eps || b1 - a0 <= eps) return true
  }
  return false
}

/** pairs of objects whose real footprints overlap by more than `eps` m (grid bucketed, n log n-ish) */
export function footprintClashes(objs: { corners: number[] }[], eps = 0.5): [number, number][] {
  const cell = 40, grid = new Map<string, number[]>(), out: [number, number][] = []
  const boxes = objs.map((o) => { let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity; for (let i = 0; i < o.corners.length; i += 2) { x0 = Math.min(x0, o.corners[i]); x1 = Math.max(x1, o.corners[i]); z0 = Math.min(z0, o.corners[i + 1]); z1 = Math.max(z1, o.corners[i + 1]) } return [x0, z0, x1, z1] })
  boxes.forEach((b, i) => {
    const seen = new Set<number>()
    for (let gx = Math.floor(b[0] / cell); gx <= Math.floor(b[2] / cell); gx++) for (let gz = Math.floor(b[1] / cell); gz <= Math.floor(b[3] / cell); gz++) {
      const k = gx + ',' + gz, l = grid.get(k)
      if (l) for (const j of l) if (!seen.has(j)) {
        seen.add(j)
        const q = boxes[j]
        if (b[0] < q[2] && q[0] < b[2] && b[1] < q[3] && q[1] < b[3] && !sep(objs[i].corners, objs[j].corners, eps)) out.push([j, i])
      }
      if (l) l.push(i); else grid.set(k, [i])
    }
  })
  return out
}
