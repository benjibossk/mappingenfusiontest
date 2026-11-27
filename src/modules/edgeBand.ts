// Island edge band: every map ends in the sea like Arland, with natural shores, never a raised block with a sheer
// wall at the terrain edge (picture 120 round 17: the relief kept its height until the last 150 m then dropped 100 m).
// Over a band of EDGE_BAND_* metres the relief falls with a smoothstep to EDGE_FLOOR at the map edge; the band width
// wobbles with a low-frequency noise so the shore is no straight square line. Content (roads, forests, objects,
// villages) stays inside contentRect(): the band is shore, beach / rock and sea only. Water shapes are kept (rivers
// run to their mouth at the sea).

import { noise2 } from './island'
import type { Project, ProjectShape } from '../project'

/** band width = EDGE_BAND_FRAC of the map side, clamped to [EDGE_BAND_MIN, EDGE_BAND_MAX] metres */
export const EDGE_BAND_FRAC = 0.1
export const EDGE_BAND_MIN = 150
export const EDGE_BAND_MAX = 300
/** relative wobble of the band width (low-frequency noise, period ~EDGE_NOISE_PERIOD m) */
export const EDGE_NOISE = 0.3
export const EDGE_NOISE_PERIOD = 700
/** terrain height at the very map edge (m, under the sea level 0) */
export const EDGE_FLOOR = -18

export const edgeBandWidth = (size: number) => Math.min(EDGE_BAND_MAX, Math.max(EDGE_BAND_MIN, size * EDGE_BAND_FRAC))

/** height lowered by the edge band: `d` = distance to the nearest map edge (m), `x`/`z` for the noise */
export function edgeBandHeight(h: number, d: number, W: number, wob: number): number {
  const w = W * (1 + EDGE_NOISE * (2 * wob - 1))
  if (d >= w) return h
  const t = Math.max(0, d / w), s = t * t * (3 - 2 * t)
  const floor = Math.min(EDGE_FLOOR, h) // a deeper sea bed stays as deep
  return floor + (h - floor) * s
}

/** applies the band to a square grid of heights (in place); returns it */
export function applyEdgeBand(heights: ArrayLike<number> & { [i: number]: number }, cols: number, rows: number, step: number, seed = 1): typeof heights {
  const size = (Math.min(cols, rows) - 1) * step, W = edgeBandWidth(size), nz = noise2(seed * 53 + 11, 2)
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const d = Math.min(c, r, cols - 1 - c, rows - 1 - r) * step
    if (d >= W * (1 + EDGE_NOISE)) continue
    const i = r * cols + c
    heights[i] = edgeBandHeight(heights[i], d, W, nz((c * step) / EDGE_NOISE_PERIOD, (r * step) / EDGE_NOISE_PERIOD))
  }
  return heights
}

/** where content may go: the map minus the widest band [x0, z0, x1, z1] */
export function contentRect(minX: number, minZ: number, size: number): [number, number, number, number] {
  const m = edgeBandWidth(size) * (1 + EDGE_NOISE)
  return [minX + m, minZ + m, minX + size - m, minZ + size - m]
}

type Rect = [number, number, number, number]
const inside = (R: Rect, x: number, z: number) => x >= R[0] && x <= R[2] && z >= R[1] && z <= R[3]

/** open polyline cut to the rectangle: one run per stretch inside (Liang-Barsky per segment), runs < minLen dropped */
export function clipLineToRect(pts: number[], R: Rect, minLen = 30): number[][] {
  const runs: number[][] = []
  let cur: number[] = []
  const push = (x: number, z: number) => { const n = cur.length; if (n < 2 || Math.hypot(cur[n - 2] - x, cur[n - 1] - z) > 1e-6) cur.push(x, z) }
  const end = () => { if (cur.length >= 4) runs.push(cur); cur = [] }
  for (let i = 0; i + 3 < pts.length; i += 2) {
    const x0 = pts[i], z0 = pts[i + 1], dx = pts[i + 2] - x0, dz = pts[i + 3] - z0
    let t0 = 0, t1 = 1, ok = true
    for (const [p, q] of [[-dx, x0 - R[0]], [dx, R[2] - x0], [-dz, z0 - R[1]], [dz, R[3] - z0]]) {
      if (p === 0) { if (q < 0) ok = false; continue }
      const t = q / p
      if (p < 0) t0 = Math.max(t0, t); else t1 = Math.min(t1, t)
    }
    if (!ok || t0 > t1) { end(); continue }
    if (t0 > 0) end()
    push(x0 + dx * t0, z0 + dz * t0); push(x0 + dx * t1, z0 + dz * t1)
    if (t1 < 1) end()
  }
  end()
  const len = (p: number[]) => { let L = 0; for (let i = 0; i + 3 < p.length; i += 2) L += Math.hypot(p[i + 2] - p[i], p[i + 3] - p[i + 1]); return L }
  return runs.filter((p) => len(p) >= minLen)
}

/** closed ring clipped to the rectangle (Sutherland-Hodgman; a convex clip keeps one ring) */
export function clipRingToRect(pts: number[], R: Rect): number[] {
  let poly: number[][] = []
  for (let i = 0; i + 1 < pts.length; i += 2) poly.push([pts[i], pts[i + 1]])
  const edges: [(p: number[]) => boolean, (a: number[], b: number[]) => number[]][] = [
    [(p) => p[0] >= R[0], (a, b) => { const t = (R[0] - a[0]) / (b[0] - a[0]); return [R[0], a[1] + t * (b[1] - a[1])] }],
    [(p) => p[0] <= R[2], (a, b) => { const t = (R[2] - a[0]) / (b[0] - a[0]); return [R[2], a[1] + t * (b[1] - a[1])] }],
    [(p) => p[1] >= R[1], (a, b) => { const t = (R[1] - a[1]) / (b[1] - a[1]); return [a[0] + t * (b[0] - a[0]), R[1]] }],
    [(p) => p[1] <= R[3], (a, b) => { const t = (R[3] - a[1]) / (b[1] - a[1]); return [a[0] + t * (b[0] - a[0]), R[3]] }],
  ]
  for (const [ins, cut] of edges) {
    const out: number[][] = []
    for (let i = 0; i < poly.length; i++) {
      const a = poly[(i + poly.length - 1) % poly.length], b = poly[i]
      if (ins(b)) { if (!ins(a)) out.push(cut(a, b)); out.push(b) } else if (ins(a)) out.push(cut(a, b))
    }
    poly = out
    if (!poly.length) return []
  }
  return poly.flat()
}

const isWater = (s: ProjectShape) => s.id.startsWith('WATER_') || /WEGenerators\/Water\//i.test(s.generator)

/** the project with nothing in the edge band but water: lines cut (roads stop at the band), areas clipped, objects
 *  outside dropped */
export function keepOffEdgeBand(p: Project, R: Rect): Project {
  const shapes: ProjectShape[] = []
  for (const s of p.shapes) {
    if (isWater(s)) { shapes.push(s); continue }
    let allIn = true
    for (let i = 0; i + 1 < s.points.length; i += 2) if (!inside(R, s.points[i], s.points[i + 1])) { allIn = false; break }
    if (allIn) { shapes.push(s); continue }
    if (s.lift || s.junctions || s.perPoint) {
      // per-point data (water lift, poles, junctions): keep the original points inside, no new point
      const runs: number[][] = [[]]
      for (let i = 0; i + 1 < s.points.length; i += 2) {
        if (inside(R, s.points[i], s.points[i + 1])) runs[runs.length - 1].push(i / 2)
        else if (runs[runs.length - 1].length) runs.push([])
      }
      runs.filter((ix) => ix.length >= (s.closed ? 3 : 2)).forEach((ix, k, all) => shapes.push({
        ...s, id: all.length > 1 ? `${s.id}_C${k + 1}` : s.id, points: ix.flatMap((j) => [s.points[2 * j], s.points[2 * j + 1]]),
        lift: s.lift && ix.map((j) => s.lift![j]), junctions: s.junctions?.filter((j) => ix.includes(j)).map((j) => ix.indexOf(j)),
        powerSource: s.powerSource && ix[0] === 0,
      }))
      continue
    }
    if (s.closed) {
      const ring = clipRingToRect(s.points, R)
      if (ring.length >= 6) shapes.push({ ...s, points: ring })
    } else clipLineToRect(s.points, R).forEach((pts, k, all) => shapes.push({ ...s, id: all.length > 1 ? `${s.id}_C${k + 1}` : s.id, points: pts }))
  }
  return { ...p, shapes, entities: p.entities?.filter((e) => inside(R, e.x, e.z)) }
}
