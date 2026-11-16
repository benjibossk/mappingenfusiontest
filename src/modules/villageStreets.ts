// Village streets, organic growth (docs/CITIES.md §3.3, ROADMAP_NEXT §3.2-1): a constrained
// L-system / branching walk started from the main road. Segments of 30-60 m, branches at 90° ± 20°,
// the heading turns towards the contour line when the grade passes 10 %, the walk stops on water,
// above 15 %, outside the reach, or near another street; a free end within `snap` m of another street
// is joined to it (loops). Pure, deterministic (the caller passes its rand).

import type { Line } from './settlements'

export interface StreetSeed { x: number; z: number; hx: number; hz: number; parent?: Line }
export interface StreetCtx {
  at: (x: number, z: number) => number // ground height
  wet: (x: number, z: number, margin: number) => boolean
  blocked?: (x: number, z: number) => boolean // square, buildings...
  lines: Line[] // existing streets; grown ones are NOT added here (the caller does it)
  cx: number; cz: number; reach: number
  rand: () => number
}
export interface GrowOptions {
  maxStreets: number
  segMin: number // metres
  segMax: number
  step: number // walk step, metres
  maxGrade: number // stop above (0.15)
  contourGrade: number // turn towards the contour above (0.10)
  snap: number // join another street when a free end comes this close (15)
  clear: number // minimal distance to other streets while walking
  branch: number // probability of a side branch at each segment end
  angleJitter: number // degrees around 90° for branches (20; towns 5)
  maxLen: number // longest street, metres
}
export const GROW_VILLAGE: GrowOptions = { maxStreets: 4, segMin: 30, segMax: 60, step: 10, maxGrade: 0.15, contourGrade: 0.1, snap: 15, clear: 14, branch: 0.35, angleJitter: 20, maxLen: 220 }
export const GROW_TOWN: GrowOptions = { maxStreets: 9, segMin: 40, segMax: 70, step: 10, maxGrade: 0.15, contourGrade: 0.1, snap: 15, clear: 12, branch: 0.6, angleJitter: 5, maxLen: 320 }

//! nearest point of a polyline
export function nearestOn(pts: number[], x: number, z: number): [number, number, number] {
  let best = Infinity, bx = 0, bz = 0
  for (let i = 0; i < pts.length / 2 - 1; i++) {
    const ax = pts[i * 2], az = pts[i * 2 + 1], dx = pts[i * 2 + 2] - ax, dz = pts[i * 2 + 3] - az
    const l2 = dx * dx + dz * dz
    const u = l2 > 0 ? Math.min(Math.max(((x - ax) * dx + (z - az) * dz) / l2, 0), 1) : 0
    const px = ax + dx * u, pz = az + dz * u, d = Math.hypot(x - px, z - pz)
    if (d < best) { best = d; bx = px; bz = pz }
  }
  return [bx, bz, best]
}

const rot = (x: number, z: number, deg: number): [number, number] => {
  const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a)
  return [x * c - z * s, x * s + z * c]
}

//! steepest grade along a polyline (per walk step)
export function polyGrade(pts: number[], at: (x: number, z: number) => number) {
  let g = 0
  for (let i = 0; i < pts.length / 2 - 1; i++) {
    const L = Math.hypot(pts[i * 2 + 2] - pts[i * 2], pts[i * 2 + 3] - pts[i * 2 + 1])
    if (L > 1) g = Math.max(g, Math.abs(at(pts[i * 2 + 2], pts[i * 2 + 3]) - at(pts[i * 2], pts[i * 2 + 1])) / L)
  }
  return g
}

/** grow streets from the seeds; returns polylines (flat X/Z, first point on the parent street) */
export function growStreets(ctx: StreetCtx, seeds: StreetSeed[], o: GrowOptions): number[][] {
  const out: number[][] = []
  const grown: Line[] = []
  const queue = seeds.slice()
  const all = () => [...ctx.lines, ...grown]
  let guard = 0
  while (queue.length && out.length < o.maxStreets && guard++ < 200) {
    const s = queue.shift()!
    const pts = [s.x, s.z]
    let x = s.x, z = s.z, hx = s.hx, hz = s.hz, h = ctx.at(x, z), len = 0
    const branchAt: [number, number, number, number][] = []
    let segLeft = o.segMin + ctx.rand() * (o.segMax - o.segMin)
    let snapped = false
    while (len < o.maxLen) {
      // heading: keep it, or turn towards the contour when the slope ahead is too steep
      let pick: [number, number] | null = null, pickG = Infinity
      for (const off of [0, 10, -10, 20, -20, 35, -35, 50, -50]) {
        const [dx, dz] = rot(hx, hz, off)
        const nh = ctx.at(x + dx * o.step, z + dz * o.step), g = Math.abs(nh - h) / o.step
        if (off === 0 && g <= o.contourGrade) { pick = [dx, dz]; pickG = g; break }
        if (g < pickG - 0.01) { pick = [dx, dz]; pickG = g }
      }
      if (!pick || pickG > o.maxGrade) break
      const [jx, jz] = rot(pick[0], pick[1], (ctx.rand() - 0.5) * 6)
      const nx = x + jx * o.step, nz = z + jz * o.step
      if (ctx.wet(nx, nz, 8) || Math.hypot(nx - ctx.cx, nz - ctx.cz) > ctx.reach) break
      if (ctx.blocked?.(nx, nz)) break
      // other streets: join when close (loop), refuse when crossing too close to the start
      let near: [number, number, number] | null = null
      for (const l of all()) {
        if (l === s.parent && len < 25) continue
        if (nx < l.minX - 30 || nx > l.maxX + 30 || nz < l.minZ - 30 || nz > l.maxZ + 30) continue
        const n = nearestOn(l.pts, nx, nz)
        const d = n[2] - l.half
        if (d < o.clear && (!near || d < near[2])) near = [n[0], n[1], d]
      }
      if (near) {
        if (len >= 25 && near[2] < o.snap && Math.hypot(near[0] - x, near[1] - z) < o.snap + o.step) {
          const gj = Math.abs(ctx.at(near[0], near[1]) - h) / Math.max(1, Math.hypot(near[0] - x, near[1] - z))
          if (gj <= o.maxGrade && !ctx.wet(near[0], near[1], 4)) { pts.push(near[0], near[1]); snapped = true }
        }
        break
      }
      pts.push(nx, nz)
      len += o.step
      x = nx; z = nz; hx = jx; hz = jz; h = ctx.at(x, z)
      segLeft -= o.step
      if (segLeft <= 0) {
        segLeft = o.segMin + ctx.rand() * (o.segMax - o.segMin)
        if (ctx.rand() < o.branch) branchAt.push([x, z, hx, hz])
        // segment end: small change of direction (L-system "+/-" rule)
        const [tx, tz] = rot(hx, hz, (ctx.rand() - 0.5) * 2 * o.angleJitter)
        hx = tx; hz = tz
      }
    }
    if (pts.length < 8 && !(snapped && pts.length >= 6)) continue // shorter than ~30 m
    out.push(pts)
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity
    for (let i = 0; i < pts.length; i += 2) { minX = Math.min(minX, pts[i]); maxX = Math.max(maxX, pts[i]); minZ = Math.min(minZ, pts[i + 1]); maxZ = Math.max(maxZ, pts[i + 1]) }
    const line: Line = { pts, half: 2.5, minX, minZ, maxX, maxZ }
    grown.push(line)
    for (const [bx, bz, dx, dz] of branchAt) {
      const side = ctx.rand() < 0.5 ? 1 : -1
      const [rx, rz] = rot(dx, dz, side * (90 + (ctx.rand() - 0.5) * 2 * o.angleJitter))
      queue.push({ x: bx, z: bz, hx: rx, hz: rz, parent: line })
    }
  }
  return out
}

