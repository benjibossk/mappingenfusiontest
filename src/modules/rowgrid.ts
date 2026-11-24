// Row / grid placement inside a drawn polygon (parking bays, gravestones, orchard trees, wrecks...)
// and a closed fence along its perimeter for the wall generator. Pure module, seeded through `rand`.
// Frame: U = row direction (along the longest edge, the nearest road or a given angle), V = across rows.

import type { ProjectShape } from '../project'
import { wallShape } from './gen-common'

export interface RoadLine { pts: number[]; half: number }
export interface Frame { ox: number; oz: number; ux: number; uz: number; vx: number; vz: number }
export interface GridPoint { x: number; z: number; yaw: number; row: number; col: number }
export interface RowGridOptions {
  dx: number // spacing along a row (m)
  dz: number // spacing between rows (m)
  margin?: number // clearance to the polygon border (default 2)
  frame?: Frame // default: frameOf(polygon, roads)
  roads?: RoadLine[] // orientation (nearest road) + keep-out (road half + 2 m)
  jitter?: number // 0..1 share of the spacing, random offset (default 0)
  yawJitter?: number // degrees (default 0)
  rand?: () => number
  ground?: (x: number, z: number) => number
  maxSlope?: number // rise / run, needs `ground`
  ok?: (x: number, z: number) => boolean // water / buildings test from the caller
  skipRow?: (row: number) => boolean // aisles
  skipCol?: (col: number) => boolean
}

export function inPoly(p: number[], x: number, z: number) {
  let c = false
  for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) {
    const xi = p[i], zi = p[i + 1], xj = p[j], zj = p[j + 1]
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c
  }
  return c
}
/** distance from (x, z) to a polyline (closed = ring) */
export function distLine(p: number[], x: number, z: number, closed = false) {
  let best = Infinity
  const n = p.length / 2
  for (let k = 0; k < (closed ? n : n - 1); k++) {
    const a = k * 2, b = ((k + 1) % n) * 2
    const ex = p[b] - p[a], ez = p[b + 1] - p[a + 1], L = ex * ex + ez * ez || 1
    const t = Math.max(0, Math.min(1, ((x - p[a]) * ex + (z - p[a + 1]) * ez) / L))
    best = Math.min(best, Math.hypot(p[a] + ex * t - x, p[a + 1] + ez * t - z))
  }
  return best
}
/** nearest point of a polyline: [x, z, distance, ux, uz] (u = segment direction) */
export function nearestPoint(p: number[], x: number, z: number): [number, number, number, number, number] {
  let best: [number, number, number, number, number] = [p[0], p[1], Infinity, 1, 0]
  for (let a = 0; a + 3 < p.length; a += 2) {
    const ex = p[a + 2] - p[a], ez = p[a + 3] - p[a + 1], L2 = ex * ex + ez * ez || 1, L = Math.sqrt(L2)
    const t = Math.max(0, Math.min(1, ((x - p[a]) * ex + (z - p[a + 1]) * ez) / L2))
    const qx = p[a] + ex * t, qz = p[a + 1] + ez * t, d = Math.hypot(qx - x, qz - z)
    if (d < best[2]) best = [qx, qz, d, ex / L, ez / L]
  }
  return best
}
export function centroid(p: number[]): [number, number] {
  let x = 0, z = 0
  for (let i = 0; i < p.length; i += 2) { x += p[i]; z += p[i + 1] }
  return [x / (p.length / 2), z / (p.length / 2)]
}
export function polyArea(p: number[]) {
  let a = 0
  for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) a += (p[j] - p[i]) * (p[j + 1] + p[i + 1])
  return Math.abs(a) / 2
}

/** frame from an angle (radians, U = (cos, sin)), V pointing away from (rx, rz) when given */
export function frameAt(ox: number, oz: number, ux: number, uz: number, awayX?: number, awayZ?: number): Frame {
  const L = Math.hypot(ux, uz) || 1
  ux /= L; uz /= L
  let vx = -uz, vz = ux
  if (awayX !== undefined && awayZ !== undefined && (ox - awayX) * vx + (oz - awayZ) * vz < 0) { vx = -vx; vz = -vz }
  return { ox, oz, ux, uz, vx, vz }
}
/** row direction: along the nearest road when one is within `reach` m of the polygon, else the longest edge */
export function frameOf(polygon: number[], roads: RoadLine[] = [], reach = 120): Frame & { road?: [number, number, number] } {
  const [cx, cz] = centroid(polygon)
  let best: [number, number, number, number, number] | null = null
  for (const r of roads) {
    if (r.pts.length < 4) continue
    const n = nearestPoint(r.pts, cx, cz)
    if (!best || n[2] < best[2]) best = n
  }
  if (best && polyEdgeDist(polygon, best[0], best[1]) < reach) {
    return { ...frameAt(cx, cz, best[3], best[4], best[0], best[1]), road: [best[0], best[1], best[2]] }
  }
  let bl = -1, ux = 1, uz = 0
  for (let i = 0, j = polygon.length - 2; i < polygon.length; j = i, i += 2) {
    const ex = polygon[i] - polygon[j], ez = polygon[i + 1] - polygon[j + 1], l = Math.hypot(ex, ez)
    if (l > bl) { bl = l; ux = ex; uz = ez }
  }
  return frameAt(cx, cz, ux, uz)
}
const polyEdgeDist = (p: number[], x: number, z: number) => (inPoly(p, x, z) ? 0 : distLine(p, x, z, true))

/** slope (rise / run) at (x, z), central differences over 4 m */
export function slopeAt(g: (x: number, z: number) => number, x: number, z: number, d = 4) {
  return Math.hypot(g(x + d, z) - g(x - d, z), g(x, z + d) - g(x, z - d)) / (2 * d)
}
/** frame whose rows follow the contour lines (U perpendicular to the ground gradient) */
export function contourFrame(polygon: number[], g: (x: number, z: number) => number, fallback?: Frame): Frame {
  const [cx, cz] = centroid(polygon), d = 15
  const gx = g(cx + d, cz) - g(cx - d, cz), gz = g(cx, cz + d) - g(cx, cz - d)
  if (Math.hypot(gx, gz) / (2 * d) < 0.02) return fallback ?? frameOf(polygon)
  return frameAt(cx, cz, -gz, gx)
}

/** grid points inside `polygon`; yaw (degrees, Enfusion: 0 = +Z, clockwise) faces +V */
export function rowGrid(polygon: number[], o: RowGridOptions): GridPoint[] {
  const f = o.frame ?? frameOf(polygon, o.roads)
  const rand = o.rand ?? Math.random, margin = o.margin ?? 2, jit = o.jitter ?? 0
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity
  for (let i = 0; i < polygon.length; i += 2) {
    const ax = polygon[i] - f.ox, az = polygon[i + 1] - f.oz, u = ax * f.ux + az * f.uz, v = ax * f.vx + az * f.vz
    u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v)
  }
  const baseYaw = (Math.atan2(f.vx, f.vz) * 180) / Math.PI
  const out: GridPoint[] = []
  const nr = Math.floor((v1 - v0 - 2 * margin) / o.dz), nc = Math.floor((u1 - u0 - 2 * margin) / o.dx)
  for (let row = 0; row <= nr; row++) {
    if (o.skipRow?.(row)) continue
    for (let col = 0; col <= nc; col++) {
      if (o.skipCol?.(col)) continue
      let u = u0 + margin + col * o.dx, v = v0 + margin + row * o.dz
      if (jit) { u += (rand() - 0.5) * jit * o.dx; v += (rand() - 0.5) * jit * o.dz }
      const x = f.ox + f.ux * u + f.vx * v, z = f.oz + f.uz * u + f.vz * v
      if (!inPoly(polygon, x, z) || distLine(polygon, x, z, true) < margin) continue
      if (o.roads?.some((r) => r.pts.length >= 4 && distLine(r.pts, x, z) < r.half + 2)) continue
      if (o.ground && o.maxSlope !== undefined && slopeAt(o.ground, x, z) > o.maxSlope) continue
      if (o.ok && !o.ok(x, z)) continue
      const yaw = baseYaw + (o.yawJitter ? (rand() - 0.5) * 2 * o.yawJitter : 0)
      out.push({ x, z, yaw: Math.round((((yaw % 360) + 360) % 360) * 10) / 10, row, col })
    }
  }
  return out
}

/** polygon pulled `inset` m towards its centroid (keeps the fence off the drawn line, inside the zone) */
export function insetRing(polygon: number[], inset: number): number[] {
  const [cx, cz] = centroid(polygon), out: number[] = []
  for (let i = 0; i < polygon.length; i += 2) {
    const dx = cx - polygon[i], dz = cz - polygon[i + 1], L = Math.hypot(dx, dz) || 1, k = Math.min(inset, L * 0.5) / L
    out.push(polygon[i] + dx * k, polygon[i + 1] + dz * k)
  }
  return out
}
/** closed fence polyline (wall generator) round the polygon; `openNear` leaves the edge nearest that point open
 *  (an open polyline from one end of the gap round to the other, as the industrial lots do) */
export function fencePerimeter(polygon: number[], generator: string, id: string, o: { inset?: number; openNear?: [number, number]; panel?: number; minPanel?: number } = {}): ProjectShape {
  const ring = insetRing(polygon, o.inset ?? 0.5)
  if (!o.openNear) return wallShape(id, fencePosts(ring, true, o.panel, o.minPanel), generator, true)
  const n = ring.length / 2
  let bk = 0, bd = Infinity
  for (let k = 0; k < n; k++) {
    const a = ring.slice(k * 2, k * 2 + 2).concat(ring.slice(((k + 1) % n) * 2, ((k + 1) % n) * 2 + 2))
    const d = distLine(a, o.openNear[0], o.openNear[1])
    if (d < bd) { bd = d; bk = k }
  }
  const pts: number[] = []
  for (let s = 1; s <= n; s++) { const k = (bk + s) % n; pts.push(ring[k * 2], ring[k * 2 + 1]) }
  return wallShape(id, fencePosts(pts, false, o.panel, o.minPanel), generator, false)
}
/** shape-grammar post plan: a post at the start and at every corner, full panels of `panel` m between, the last
 *  gap of each side closed by a shorter panel (>= minPanel; a shorter rest is spread over the side instead of
 *  overshooting). Returned as polyline vertices, so the wall generator puts a post on each and follows the slope. */
export function fencePosts(pts: number[], closed: boolean, panel = 4, minPanel = 2): number[] {
  const n = pts.length / 2, out: number[] = []
  const sides = closed ? n : n - 1
  for (let k = 0; k < sides; k++) {
    const ax = pts[k * 2], az = pts[k * 2 + 1], b = ((k + 1) % n) * 2, bx = pts[b], bz = pts[b + 1]
    const L = Math.hypot(bx - ax, bz - az)
    out.push(ax, az)
    const full = Math.floor(L / panel + 1e-6), rest = L - full * panel
    const at: number[] = [] // distances of the inner posts along the side
    for (let i = 1; i <= full; i++) at.push(i * panel)
    if (rest < 1e-3) at.pop() // exact fit: the last post is the corner
    else if (rest < minPanel && full > 0) { at.pop(); at.push((full - 1) * panel + (panel + rest) / 2) } // split last panel + rest in two
    for (const d of at) if (d > 1e-3 && d < L - 1e-3) out.push(ax + ((bx - ax) * d) / L, az + ((bz - az) * d) / L)
  }
  if (!closed) out.push(pts[(n - 1) * 2], pts[(n - 1) * 2 + 1])
  return out
}
/** oriented rectangle corners (flat X/Z) centred on (x, z), w along U = yaw+90°, d along the yaw */
export function rectAt(x: number, z: number, yawDeg: number, w: number, d: number): number[] {
  const r = (yawDeg * Math.PI) / 180, fx = Math.sin(r), fz = Math.cos(r), rx = fz, rz = -fx, hw = w / 2, hd = d / 2
  return [x - rx * hw - fx * hd, z - rz * hw - fz * hd, x + rx * hw - fx * hd, z + rz * hw - fz * hd, x + rx * hw + fx * hd, z + rz * hw + fz * hd, x - rx * hw + fx * hd, z - rz * hw + fz * hd]
}

//! a crash barrier only stands along a road: keeps the runs of the barrier polyline whose posts are within
//! `reach` m of a road edge (half-width + reach from its centreline), each run its own open shape, runs under
//! `minLen` dropped, posts within gap[2] of (gap[0], gap[1]) left out (the entrance). Seed 21 TOWN_1_SITE_8_barrier ran 31 posts along the lot edge down a slope, no road.
export function roadsideRuns(shape: ProjectShape, roads: RoadLine[], reach = 6, minLen = 8, gap?: [number, number, number]): ProjectShape[] {
  const p = shape.closed ? shape.points.concat(shape.points.slice(0, 2)) : shape.points
  const near = (x: number, z: number) => !(gap && Math.hypot(x - gap[0], z - gap[1]) < gap[2]) && roads.some((r) => r.pts.length >= 4 && distLine(r.pts, x, z) - r.half <= reach)
  const runs: number[][] = []
  let cur: number[] = []
  for (let i = 0; i + 1 < p.length; i += 2) {
    if (near(p[i], p[i + 1])) cur.push(p[i], p[i + 1])
    else { if (cur.length) runs.push(cur); cur = [] }
  }
  if (cur.length) runs.push(cur)
  // a closed ring whose first and last runs touch the seam: one run
  if (shape.closed && runs.length > 1 && near(p[0], p[1]) && near(p[p.length - 2], p[p.length - 1])) runs[0] = runs.pop()!.slice(0, -2).concat(runs[0])
  const len = (r: number[]) => { let s = 0; for (let i = 2; i < r.length; i += 2) s += Math.hypot(r[i] - r[i - 2], r[i + 1] - r[i - 1]); return s }
  return runs.filter((r) => r.length >= 4 && len(r) >= minLen).map((r, i) => ({ ...shape, id: i ? `${shape.id}${i + 1}` : shape.id, closed: false, points: r }))
}
