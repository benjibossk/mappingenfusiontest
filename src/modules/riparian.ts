// Riparian band (ripisylve) along rivers and lake shores: reeds on the water edge, willow / sallow
// bushes behind. The width follows the ground, not a fixed buffer: it grows on flat floodplains (low
// height above the nearest water, HAND) and shrinks on steep banks, down to nothing on cliffs and gorges.
// Each bank is measured on its own (asymmetric valleys), broken into patches by noise, and stops at
// roads, bridges, fields, villages and other water. Output: closed polygons + vanilla generators.
//
// Why HAND and not absolute altitude / a global slope threshold: a slope threshold alone either kills the
// band on every river that runs in a valley (all banks are a bit steep) or lets it climb hillsides far
// above the water; the height above the river level is what says "this ground floods / stays wet".

import type { Grid } from './island'
import { centreLine } from './roads'
import { riverCourse, WATER_TYPES, type Water } from './water'
import { sampler } from './settlements'
import { ZONE_AVOID, type ProjectShape } from '../project'

/** vanilla generators (GUIDs read from the game data, FG_*_aut.et parents) */
export const RIPARIAN_GEN = {
  reed: '{49CE476916C86620}Prefabs/WEGenerators/Brushland/FG_Brushland_Phragmites.et',
  willow: '{7B7AEA8C75A2F011}Prefabs/WEGenerators/Brushland/FG_Brushland_Salix.et', // Salix cinerea bushes + Salix fragilis trees
} as const

export type RiparianKind = keyof typeof RIPARIAN_GEN
export interface RiparianPatch { id: string; kind: RiparianKind; water: string; side: -1 | 1; pts: number[] }

export interface RiparianOptions {
  seed?: number
  maxWidth?: number // m, flat floodplain (default 40)
  handMax?: number // m above the water where the band stops (default 5)
  steep?: number // bank grade (rise/run) where the band stops (default 0.45 ≈ 24°)
  cliff?: number // grade right at the water edge: no band at all (default 0.8 ≈ 39°)
  cover?: number // 0..1 share of the bank length kept (noise gaps), default 0.7
  roads?: { pts: number[]; half: number }[]
  polys?: number[][] // flat X/Z rings to keep out of (fields, villages, zones, forests…)
  points?: { x: number; z: number; r: number }[] // bridges, buildings
  /** filled with the reason each probe line stopped (gap, cliff, blocked, hand, steep, limit) */
  stats?: Record<string, number>
}

const STATION = 8 // m between stations along the bank
const PROBE = 2 // m between probes across the bank

function hash(i: number, s: number) {
  let h = (i * 374761393 + s * 668265263) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}
/** 1D value noise along the bank, ~60 m features */
function noise1(t: number, s: number) {
  const g = t / 60, i = Math.floor(g), f = g - i, u = f * f * (3 - 2 * f)
  return hash(i, s) + (hash(i + 1, s) - hash(i, s)) * u
}

function inPoly(p: number[], x: number, z: number) {
  let c = false
  for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) {
    const xi = p[i], zi = p[i + 1], xj = p[j], zj = p[j + 1]
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c
  }
  return c
}

/** obstacle raster on the height grid: 1 = keep out */
function obstacleMask(grid: Grid, heights: ArrayLike<number>, waters: Water[], o: RiparianOptions): Uint8Array {
  const { cols, rows, step, minX, minZ } = grid
  const m = new Uint8Array(cols * rows)
  for (let k = 0; k < m.length; k++) if (heights[k] <= 0.3) m[k] = 1 // sea
  const disc = (x: number, z: number, r: number) => {
    const c0 = Math.max(0, Math.floor((x - r - minX) / step)), c1 = Math.min(cols - 1, Math.ceil((x + r - minX) / step))
    const r0 = Math.max(0, Math.floor((z - r - minZ) / step)), r1 = Math.min(rows - 1, Math.ceil((z + r - minZ) / step))
    for (let rr = r0; rr <= r1; rr++) for (let cc = c0; cc <= c1; cc++) if (Math.hypot(minX + cc * step - x, minZ + rr * step - z) <= r) m[rr * cols + cc] = 1
  }
  const line = (pts: number[], half: number) => {
    for (let i = 0; i + 3 < pts.length; i += 2) {
      const ax = pts[i], az = pts[i + 1], bx = pts[i + 2], bz = pts[i + 3], n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / (step / 2)))
      for (let k = 0; k <= n; k++) disc(ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n, half)
    }
  }
  const poly = (p: number[], rim = true) => {
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity
    for (let i = 0; i + 1 < p.length; i += 2) { x0 = Math.min(x0, p[i]); x1 = Math.max(x1, p[i]); z0 = Math.min(z0, p[i + 1]); z1 = Math.max(z1, p[i + 1]) }
    const c0 = Math.max(0, Math.floor((x0 - minX) / step)), c1 = Math.min(cols - 1, Math.ceil((x1 - minX) / step))
    const r0 = Math.max(0, Math.floor((z0 - minZ) / step)), r1 = Math.min(rows - 1, Math.ceil((z1 - minZ) / step))
    for (let rr = r0; rr <= r1; rr++) for (let cc = c0; cc <= c1; cc++) if (inPoly(p, minX + cc * step, minZ + rr * step)) m[rr * cols + cc] = 1
    if (rim) line([...p, p[0], p[1]], step * 0.75) // the ring itself (thin polygons the cell centres miss)
  }
  for (const r of o.roads ?? []) line(r.pts, r.half + 3)
  for (const p of o.polys ?? []) if (p.length >= 6) poly(p)
  for (const q of o.points ?? []) disc(q.x, q.z, q.r)
  for (const w of waters) {
    if (WATER_TYPES[w.type].closed) { if (w.pts.length >= 6) poly(w.pts, false) } else if (w.pts.length >= 4) line(riverCourse(w.pts, w.width), Math.max(0.5, w.width / 2 - step / 2)) // the channel only: the raster is coarse, a full stamp would eat the banks
  }
  return m
}

interface Bank { line: number[]; half: number; closed: boolean; id: string; level?: number }

/** riparian patches for every river / lake of `waters` (pure: same input -> same output) */
export function riparianBands(heights: ArrayLike<number>, grid: Grid, waters: Water[], o: RiparianOptions = {}): RiparianPatch[] {
  const maxW = o.maxWidth ?? 40, handMax = o.handMax ?? 5, steep = o.steep ?? 0.45, cliff = o.cliff ?? 0.8, cover = o.cover ?? 0.7, seed = o.seed ?? 1
  const at = sampler(heights, grid)
  const mask = obstacleMask(grid, heights, waters, o)
  const { cols, rows, step, minX, minZ } = grid
  const x1 = minX + (cols - 1) * step, z1 = minZ + (rows - 1) * step
  const blocked = (x: number, z: number) => {
    if (x < minX + 4 || z < minZ + 4 || x > x1 - 4 || z > z1 - 4) return true
    const c = Math.round((x - minX) / step), r = Math.round((z - minZ) / step)
    return mask[r * cols + c] === 1
  }
  const banks: Bank[] = []
  for (const w of waters) {
    if (WATER_TYPES[w.type].closed) {
      if (w.type === 'pool' || w.pts.length < 6) continue
      // lake level = lowest shore height (the water generator sits at the outline)
      let lv = Infinity
      for (let i = 0; i + 1 < w.pts.length; i += 2) lv = Math.min(lv, at(w.pts[i], w.pts[i + 1]))
      banks.push({ id: w.id, line: centreLine([...w.pts, w.pts[0], w.pts[1]], STATION), half: 0.5, closed: true, level: lv })
    } else if (w.pts.length >= 4) banks.push({ id: w.id, line: centreLine(riverCourse(w.pts, w.width), STATION), half: w.width / 2, closed: false })
  }
  const out: RiparianPatch[] = []
  banks.forEach((b, bi) => {
    const L = b.line, n = L.length / 2
    if (n < 3) return
    // ring orientation: for lakes, side +1 must point outwards
    let area = 0
    if (b.closed) for (let i = 0, j = L.length - 2; i < L.length; j = i, i += 2) area += (L[j] - L[i]) * (L[j + 1] + L[i + 1])
    const sides: (-1 | 1)[] = b.closed ? [area > 0 ? -1 : 1] : [-1, 1]
    for (const side of sides) {
      const ns = seed * 31 + bi * 7 + (side > 0 ? 3 : 0)
      const wid = new Float32Array(n), reed = new Float32Array(n), nx = new Float32Array(n), nz = new Float32Array(n)
      let arc = 0
      for (let k = 0; k < n; k++) {
        const a = Math.max(0, k - 1), c = Math.min(n - 1, k + 1)
        const dx = L[c * 2] - L[a * 2], dz = L[c * 2 + 1] - L[a * 2 + 1], d = Math.hypot(dx, dz) || 1
        // left normal (-dz, dx) * side
        nx[k] = (-dz / d) * side; nz[k] = (dx / d) * side
        if (k) arc += Math.hypot(L[k * 2] - L[k * 2 - 2], L[k * 2 + 1] - L[k * 2 - 1])
        // patches: noise gaps, plus a slow per-bank width factor (asymmetric valleys stay asymmetric)
        const st = (k: string) => { if (o.stats) o.stats[k] = (o.stats[k] ?? 0) + 1 }
        if (noise1(arc, ns) > cover + 0.15) { st('gap'); continue }
        const x0 = L[k * 2], z0 = L[k * 2 + 1]
        const ex = x0 + nx[k] * (b.half + 1), ez = z0 + nz[k] * (b.half + 1)
        const level = b.level ?? Math.min(at(x0 + nx[k] * b.half, z0 + nz[k] * b.half), at(x0 - nx[k] * b.half, z0 - nz[k] * b.half))
        const edgeGrade = Math.abs(at(ex + nx[k] * 4, ez + nz[k] * 4) - at(ex, ez)) / 4
        if (edgeGrade > cliff) { st('cliff'); continue } // cliff / gorge wall: nothing
        // inner side of a bend: never wider than the bend radius (the offset line would fold over the water)
        let lim = maxW * (0.55 + 0.45 * noise1(arc * 0.5 + 500, ns + 1))
        if (k > 0 && k < n - 1) {
          const t1 = Math.atan2(L[k * 2 + 1] - L[k * 2 - 1], L[k * 2] - L[k * 2 - 2]), t2 = Math.atan2(L[k * 2 + 3] - L[k * 2 + 1], L[k * 2 + 2] - L[k * 2])
          let dt = t2 - t1
          if (dt > Math.PI) dt -= 2 * Math.PI
          if (dt < -Math.PI) dt += 2 * Math.PI
          const inner = dt * side > 0 // turning towards this side
          if (inner && Math.abs(dt) > 1e-3) lim = Math.min(lim, 0.6 * (STATION / Math.abs(dt)) - b.half)
        }
        let w = 0, prev = at(ex, ez), why = 'limit'
        for (let d = PROBE; d <= lim; d += PROBE) {
          const px = ex + nx[k] * d, pz = ez + nz[k] * d
          if (blocked(px, pz)) { why = 'blocked'; break }
          const h = at(px, pz)
          if (h - level > handMax) { why = 'hand'; break }
          if (Math.abs(h - prev) / PROBE > steep) { why = 'steep'; break }
          prev = h; w = d
        }
        if (blocked(ex, ez)) { w = 0; why = 'edge' }
        st(why)
        wid[k] = w
        // reeds: the wettest strip, only where the edge is nearly flat
        reed[k] = edgeGrade < 0.25 ? Math.min(w, 3 + 0.15 * w) : 0
      }
      // smooth (no saw-tooth outline), then cut into runs
      const sm = new Float32Array(n)
      for (let k = 0; k < n; k++) {
        if (!wid[k]) continue
        let s = 0, c = 0
        for (let j = Math.max(0, k - 1); j <= Math.min(n - 1, k + 1); j++) if (wid[j]) { s += wid[j]; c++ }
        sm[k] = Math.min(wid[k], s / c)
      }
      const emit = (kind: RiparianKind, inner: (k: number) => number, outer: (k: number) => number, minW: number) => {
        let k = 0
        while (k < n) {
          if (outer(k) - inner(k) < minW) { k++; continue }
          let e = k
          while (e + 1 < n && outer(e + 1) - inner(e + 1) >= minW) e++
          if (e - k >= 2) {
            const pts: number[] = []
            const off = (j: number, d: number) => pts.push(Math.round((L[j * 2] + nx[j] * (b.half + 1 + d)) * 100) / 100, Math.round((L[j * 2 + 1] + nz[j] * (b.half + 1 + d)) * 100) / 100)
            for (let j = k; j <= e; j++) off(j, inner(j))
            for (let j = e; j >= k; j--) off(j, outer(j))
            out.push({ id: `RIPA_${b.id}_${kind}_${side > 0 ? 'R' : 'L'}_${out.length + 1}`, kind, water: b.id, side, pts })
          }
          k = e + 1
        }
      }
      emit('reed', () => 0, (k) => Math.min(reed[k], sm[k]), 2)
      emit('willow', (k) => Math.min(reed[k], sm[k]), (k) => sm[k], 4)
    }
  })
  return out
}

/** Workbench shapes: one area generator per patch, clear of roads / rivers / lakes / power lines / objects */
export function riparianShapes(patches: RiparianPatch[]): ProjectShape[] {
  return patches.map((p) => ({ id: p.id, kind: 'polyline', closed: true, points: p.pts, generator: RIPARIAN_GEN[p.kind], avoid: { ...ZONE_AVOID, objects: true } }))
}

/** band width (m) measured at one station, for diagnostics / tests: largest patch extent near (x, z) */
export function patchArea(p: RiparianPatch) {
  let a = 0
  for (let i = 0, j = p.pts.length - 2; i < p.pts.length; j = i, i += 2) a += (p.pts[j] - p.pts[i]) * (p.pts[j + 1] + p.pts[i + 1])
  return Math.abs(a) / 2
}
