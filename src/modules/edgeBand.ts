// Island coast for maps made from a picture: the land is shrunk into an island with the SAME coast the random
// island generator draws (island.ts generateIsland: sea margin over the outer 20 % of the map, rounded-square
// distance to the edge + low-frequency noise, land fading with pow(land, 1.3) to a ~1 m beach, sea shelf
// land * seaDepth * 6 down to the sea floor). The 6 % ramp of Sculpt.compose left picture 120 a raised block with a
// sheer wall, and a first 150-300 m smoothstep band (round 19) still read as a straight uniform ramp.
// Content (roads, objects) is cut where that coast put the ground under the sea; areas are kept inside coastRect().

import { noise2 } from './island'
import type { Project, ProjectShape } from '../project'

/** land share of the generator's default island (worldParams landRatio): the coast sits where margin = ISLAND_LAND */
export const ISLAND_LAND = 0.6
/** generator constants (island.ts): rounded corner radius, margin width, noise amplitude (map fractions) */
export const MARGIN_CORNER = 0.3, MARGIN_WIDTH = 0.2, MARGIN_NOISE = 0.12
/** ground under this (m) inside the margin is sea: content there is cut */
export const SEA_CUT = 0.5

/** generator noise for a map seed (same call as generateIsland) */
export const coastNoise = (seed: number) => noise2(seed)

/** sea margin of island.ts at grid cell (c, r): 0 inland, up to 1.2 at the map edge */
export function islandMargin(c: number, r: number, cols: number, rows: number, k: number): number {
  const ex = Math.min(c, cols - 1 - c) / (cols - 1), ez = Math.min(r, rows - 1 - r) / (rows - 1)
  const edge = MARGIN_CORNER - Math.hypot(Math.max(0, MARGIN_CORNER - ex), Math.max(0, MARGIN_CORNER - ez)) + (k - 0.5) * MARGIN_NOISE
  return Math.max(0, (MARGIN_WIDTH - edge) / MARGIN_WIDTH) * 1.2
}

/** one height through the generator's coast: land scaled by pow(land / L, 1.3) toward a 1 m beach, sea shelf below */
export function coastHeight(h: number, margin: number, seaDepth: number): number {
  if (margin <= 0) return h
  const land = ISLAND_LAND - margin
  if (land > 0) {
    const f = Math.pow(Math.min(1, land / ISLAND_LAND), 1.3)
    return h > 1 ? 1 + (h - 1) * f : h
  }
  return Math.min(h, Math.max(land * seaDepth * 6, -seaDepth))
}

/** applies the island coast to a square grid of heights (in place) */
export function applyIslandCoast(heights: { [i: number]: number }, cols: number, rows: number, step: number, seed: number, seaDepth: number) {
  const n = coastNoise(seed)
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const m = islandMargin(c, r, cols, rows, n((c * step) / 600, (r * step) / 600))
    if (m > 0) heights[r * cols + c] = coastHeight(heights[r * cols + c], m, seaDepth)
  }
  return heights
}

/** areas (forests, zones) stay inside this rectangle: the coast at its nominal place (margin = ISLAND_LAND, no noise) */
export function coastRect(minX: number, minZ: number, size: number): [number, number, number, number] {
  const m = MARGIN_WIDTH * (1 - ISLAND_LAND / 1.2) * size
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

/** open line cut where `sea(x, z)` (sampled every `stepM` m): one run per stretch on land, runs < minLen dropped */
export function cutLineAtSea(pts: number[], sea: (x: number, z: number) => boolean, stepM = 4, minLen = 30): number[][] {
  const runs: number[][] = []
  let cur: number[] = []
  let lx: number | null = null, lz: number | null = null // last land sample since the last kept point
  const end = () => { if (cur.length >= 4) runs.push(cur); cur = [] }
  for (let i = 0; i + 1 < pts.length; i += 2) {
    const x = pts[i], z = pts[i + 1]
    if (i > 0) {
      const px = pts[i - 2], pz = pts[i - 1], n = Math.max(1, Math.ceil(Math.hypot(x - px, z - pz) / stepM))
      for (let k = 1; k < n; k++) {
        const qx = px + ((x - px) * k) / n, qz = pz + ((z - pz) * k) / n
        if (sea(qx, qz)) { if (lx !== null && (cur[cur.length - 2] !== lx || cur[cur.length - 1] !== lz)) cur.push(lx, lz!); end(); lx = lz = null } else { if (!cur.length) cur.push(qx, qz); lx = qx; lz = qz }
      }
    }
    if (sea(x, z)) { if (lx !== null && cur.length && (cur[cur.length - 2] !== lx || cur[cur.length - 1] !== lz)) cur.push(lx, lz!); end(); lx = lz = null } else { cur.push(x, z); lx = lz = null }
  }
  end()
  const len = (p: number[]) => { let L = 0; for (let i = 0; i + 3 < p.length; i += 2) L += Math.hypot(p[i + 2] - p[i], p[i + 3] - p[i + 1]); return L }
  return runs.filter((p) => len(p) >= minLen)
}

/** the project kept on the island: lines cut where the coast put the ground under the sea (roads stop on the
 *  shore), objects there dropped, areas clipped to `R`; water shapes kept (rivers reach the sea) */
export function keepOnIsland(p: Project, sea: (x: number, z: number) => boolean, R: Rect): Project {
  const shapes: ProjectShape[] = []
  for (const s of p.shapes) {
    if (isWater(s)) { shapes.push(s); continue }
    let ok = true
    for (let i = 0; i + 1 < s.points.length; i += 2) if (sea(s.points[i], s.points[i + 1]) || (s.closed && !inside(R, s.points[i], s.points[i + 1]))) { ok = false; break }
    if (ok && !s.closed) for (const run of cutLineAtSea(s.points, sea, 4, 0)) if (run.length !== s.points.length) { ok = false; break }
    if (ok) { shapes.push(s); continue }
    if (s.lift || s.junctions || s.perPoint) {
      // per-point data (water lift, poles, junctions): keep the original points on land, no new point
      const runs: number[][] = [[]]
      for (let i = 0; i + 1 < s.points.length; i += 2) {
        if (!sea(s.points[i], s.points[i + 1]) && (!s.closed || inside(R, s.points[i], s.points[i + 1]))) runs[runs.length - 1].push(i / 2)
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
    } else cutLineAtSea(s.points, sea).forEach((pts, k, all) => shapes.push({ ...s, id: all.length > 1 ? `${s.id}_C${k + 1}` : s.id, points: pts }))
  }
  return { ...p, shapes, entities: p.entities?.filter((e) => !sea(e.x, e.z)) }
}
