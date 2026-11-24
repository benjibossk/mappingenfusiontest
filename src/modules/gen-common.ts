// Shared helpers for the pure site generators (military.ts, airfield.ts): seeded RNG, oriented boxes,
// terrain sampling and terrain flatten requests. No DOM, no i18n: usable from node tests.

import { sanitizeRoadLine } from './roads'
import type { Grid } from './island'
import type { ProjectEntity, ProjectShape } from '../project'

/** mulberry32, seeded by a number or a string */
export function rng(seed: number | string): () => number {
  let s = typeof seed === 'number' ? seed >>> 0 : 0
  if (typeof seed === 'string') for (let i = 0; i < seed.length; i++) s = Math.imul(s ^ seed.charCodeAt(i), 2654435761) >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** oriented box on the ground: centre, half sizes along its local X (hw) and Z (hd), yaw in degrees
 *  (Enfusion convention: local +Z = forward = (sin yaw, cos yaw) in world X/Z) */
export interface Box { x: number; z: number; hw: number; hd: number; yaw: number }

export const DEG = Math.PI / 180
export const fwd = (yawDeg: number): [number, number] => [Math.sin(yawDeg * DEG), Math.cos(yawDeg * DEG)]
export const right = (yawDeg: number): [number, number] => [Math.cos(yawDeg * DEG), -Math.sin(yawDeg * DEG)]

/** local (lx right, lz forward) → world, around (ox, oz) turned by yaw */
export function toWorld(ox: number, oz: number, yaw: number, lx: number, lz: number): [number, number] {
  const [fx, fz] = fwd(yaw), [rx, rz] = right(yaw)
  return [ox + rx * lx + fx * lz, oz + rz * lx + fz * lz]
}

export function boxCorners(b: Box): number[] {
  const out: number[] = []
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) out.push(...toWorld(b.x, b.z, b.yaw, sx * b.hw, sz * b.hd))
  return out
}

/** separating-axis test between two oriented boxes (margin added to both) */
export function boxesOverlap(a: Box, b: Box, margin = 0): boolean {
  const axes = [fwd(a.yaw), right(a.yaw), fwd(b.yaw), right(b.yaw)]
  const ca = boxCorners({ ...a, hw: a.hw + margin, hd: a.hd + margin }), cb = boxCorners(b)
  for (const [ax, az] of axes) {
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity
    for (let i = 0; i < 8; i += 2) {
      const p = ca[i] * ax + ca[i + 1] * az, q = cb[i] * ax + cb[i + 1] * az
      a0 = Math.min(a0, p); a1 = Math.max(a1, p); b0 = Math.min(b0, q); b1 = Math.max(b1, q)
    }
    if (a1 <= b0 || b1 <= a0) return false
  }
  return true
}

/** is the point inside the box (local coordinates check) */
export function inBox(b: Box, x: number, z: number, margin = 0): boolean {
  const dx = x - b.x, dz = z - b.z, [fx, fz] = fwd(b.yaw), [rx, rz] = right(b.yaw)
  return Math.abs(dx * rx + dz * rz) <= b.hw + margin && Math.abs(dx * fx + dz * fz) <= b.hd + margin
}

/** bilinear height on the grid (heights row-major, x = minX + col * step) */
export function heightAt(heights: ArrayLike<number>, g: Grid, x: number, z: number): number {
  const gx = Math.min(Math.max((x - g.minX) / g.step, 0), g.cols - 1.001), gz = Math.min(Math.max((z - g.minZ) / g.step, 0), g.rows - 1.001)
  const c = Math.floor(gx), r = Math.floor(gz), fx = gx - c, fz = gz - r, i = r * g.cols + c
  const a = heights[i] + (heights[i + 1] - heights[i]) * fx
  const b = heights[i + g.cols] + (heights[i + g.cols + 1] - heights[i + g.cols]) * fx
  return a + (b - a) * fz
}

/** Terrain request: inside the box the ground is set to a plane (h0 at the box's -Z end, h1 at +Z end,
 *  i.e. a constant grade along the box's forward axis); between the box and box+falloff it blends back
 *  to the natural ground (smoothstep). Applied in the browser with applyFlatten, like carveRoads. */
export interface FlattenRequest { box: Box; h0: number; h1: number; falloff: number }

export function planeAt(f: FlattenRequest, x: number, z: number): number {
  const [fx, fz] = fwd(f.box.yaw)
  const t = Math.min(Math.max(((x - f.box.x) * fx + (z - f.box.z) * fz) / (2 * f.box.hd) + 0.5, 0), 1)
  return f.h0 + (f.h1 - f.h0) * t
}

/** applies the requests in place; returns the earthwork volume in m³ (sum of |dh| × cell area) */
export function applyFlatten(heights: number[] | Float32Array, g: Grid, reqs: FlattenRequest[]): number {
  let vol = 0
  for (const f of reqs) {
    const b = f.box, R = Math.hypot(b.hw, b.hd) + f.falloff
    const c0 = Math.max(0, Math.floor((b.x - R - g.minX) / g.step)), c1 = Math.min(g.cols - 1, Math.ceil((b.x + R - g.minX) / g.step))
    const r0 = Math.max(0, Math.floor((b.z - R - g.minZ) / g.step)), r1 = Math.min(g.rows - 1, Math.ceil((b.z + R - g.minZ) / g.step))
    const [fx, fz] = fwd(b.yaw), [rx, rz] = right(b.yaw)
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
      const x = g.minX + c * g.step, z = g.minZ + r * g.step, dx = x - b.x, dz = z - b.z
      const ox = Math.max(0, Math.abs(dx * rx + dz * rz) - b.hw), oz = Math.max(0, Math.abs(dx * fx + dz * fz) - b.hd)
      const d = Math.hypot(ox, oz)
      if (d > f.falloff) continue
      const t = f.falloff > 0 ? d / f.falloff : 0, w = d === 0 ? 1 : 1 - t * t * (3 - 2 * t)
      const i = r * g.cols + c, target = planeAt(f, x, z), dh = (target - heights[i]) * w
      heights[i] += dh
      vol += Math.abs(dh) * g.step * g.step
    }
  }
  return vol
}

/** earthwork (m³) the request would need, without touching the heights; samples every `s` metres */
export function earthwork(heights: ArrayLike<number>, g: Grid, f: FlattenRequest, s = g.step): number {
  let vol = 0
  for (let lz = -f.box.hd; lz <= f.box.hd; lz += s) for (let lx = -f.box.hw; lx <= f.box.hw; lx += s) {
    const [x, z] = toWorld(f.box.x, f.box.z, f.box.yaw, lx, lz)
    vol += Math.abs(heightAt(heights, g, x, z) - planeAt(f, x, z)) * s * s
  }
  return vol
}

/** least-squares best grade along the box's forward axis, clamped to ±maxGrade: returns [h0, h1] */
export function bestPlane(heights: ArrayLike<number>, g: Grid, box: Box, maxGrade: number, s = Math.max(g.step, 4)): [number, number] {
  let n = 0, st = 0, sh = 0, stt = 0, sth = 0
  for (let lz = -box.hd; lz <= box.hd; lz += s) for (let lx = -box.hw; lx <= box.hw; lx += s) {
    const [x, z] = toWorld(box.x, box.z, box.yaw, lx, lz), h = heightAt(heights, g, x, z)
    n++; st += lz; sh += h; stt += lz * lz; sth += lz * h
  }
  const den = n * stt - st * st
  let k = den > 0 ? (n * sth - st * sh) / den : 0 // dh/dm along forward
  k = Math.min(Math.max(k, -maxGrade), maxGrade)
  const mean = sh / n - k * (st / n)
  return [mean - k * box.hd, mean + k * box.hd]
}

/** max slope (rise/run) found by sampling a disc */
export function maxSlope(heights: ArrayLike<number>, g: Grid, x: number, z: number, r: number, s = Math.max(g.step, 8)): number {
  let m = 0
  for (let dz = -r; dz <= r; dz += s) for (let dx = -r; dx <= r; dx += s) {
    if (dx * dx + dz * dz > r * r) continue
    const h = heightAt(heights, g, x + dx, z + dz)
    m = Math.max(m, Math.abs(heightAt(heights, g, x + dx + s, z + dz) - h) / s, Math.abs(heightAt(heights, g, x + dx, z + dz + s) - h) / s)
  }
  return m
}

/** steepest mean slope (rise/run) allowed under a parcel, a field or a farmyard: ~12 deg */
export const MAX_PARCEL_GRADE = Math.tan((12 * Math.PI) / 180)

//! Mean slope (rise/run) over a polygon [x0, z0, x1, z1, ...], sampled every `s` metres inside it.
//! `at(x, z)` is the ground height. The slope at each sample is measured over +-s, so a parcel
//! laid across a steep flank reads steep even when a single point (its centre) happens to be flat.
export function meanGrade(poly: ArrayLike<number>, at: (x: number, z: number) => number, s = 4): number {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity
  for (let i = 0; i + 1 < poly.length; i += 2) { x0 = Math.min(x0, poly[i]); x1 = Math.max(x1, poly[i]); z0 = Math.min(z0, poly[i + 1]); z1 = Math.max(z1, poly[i + 1]) }
  if (!(x1 > x0) || !(z1 > z0)) return 0
  const d = Math.max(1, Math.min(s, (x1 - x0) / 3, (z1 - z0) / 3))
  const grade = (x: number, z: number) => Math.hypot(at(x + s, z) - at(x - s, z), at(x, z + s) - at(x, z - s)) / (2 * s)
  let sum = 0, n = 0
  for (let z = z0 + d / 2; z < z1; z += d) for (let x = x0 + d / 2; x < x1; x += d) {
    let o = false
    for (let i = 0, j = poly.length - 2; i + 1 < poly.length; j = i, i += 2) {
      const xi = poly[i], zi = poly[i + 1], xj = poly[j], zj = poly[j + 1]
      if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) o = !o
    }
    if (o) { sum += grade(x, z); n++ }
  }
  return n ? sum / n : grade((x0 + x1) / 2, (z0 + z1) / 2)
}

/** a placed object of a generated site, with its footprint (for overlap tests and previews) */
export interface SitePlacement { role: string; prefab: string; box: Box }

export const toEntity = (p: SitePlacement, id: string): ProjectEntity => ({ id, prefab: p.prefab, x: round(p.box.x), z: round(p.box.z), yaw: round(((p.box.yaw % 360) + 360) % 360) })
export const round = (v: number) => Math.round(v * 100) / 100

/** wall / fence generator along a polyline (same format as power lines / road furniture) */
export const wallShape = (id: string, points: number[], generator: string, closed = false): ProjectShape =>
  ({ id, kind: 'polyline', closed, points: points.map(round), generator })

/** road generator spline with an explicit width (same params as roads.ts roadShapes) */
export const roadShape = (id: string, points: number[], generator: string, width: number): ProjectShape =>
  ({ id, kind: 'spline', closed: false, points: sanitizeRoadLine(points.map(round), 3), generator, paramKeys: ['AdjustHeightMap', 'RoadWidth'], paramValues: ['0', String(width)] })

/** keep-out disc (villages, other sites) */
export interface Disc { x: number; z: number; r: number }

/** simple SVG preview of boxes and shapes (tests / docs) */
export function svgPreview(boxes: { box: Box; fill: string }[], lines: { pts: number[]; stroke: string; width: number }[], size = 800): string {
  const xs: number[] = [], zs: number[] = []
  for (const b of boxes) { const c = boxCorners(b.box); for (let i = 0; i < 8; i += 2) { xs.push(c[i]); zs.push(c[i + 1]) } }
  for (const l of lines) for (let i = 0; i < l.pts.length; i += 2) { xs.push(l.pts[i]); zs.push(l.pts[i + 1]) }
  const x0 = Math.min(...xs) - 20, x1 = Math.max(...xs) + 20, z0 = Math.min(...zs) - 20, z1 = Math.max(...zs) + 20
  const k = size / Math.max(x1 - x0, z1 - z0), P = (x: number, z: number) => `${((x - x0) * k).toFixed(1)},${((z1 - z) * k).toFixed(1)}`
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" style="background:#cfd8c0">`
  for (const l of lines) { const p: string[] = []; for (let i = 0; i < l.pts.length; i += 2) p.push(P(l.pts[i], l.pts[i + 1])); s += `<polyline points="${p.join(' ')}" fill="none" stroke="${l.stroke}" stroke-width="${Math.max(1, l.width * k)}" stroke-linejoin="round"/>` }
  for (const b of boxes) { const c = boxCorners(b.box), p: string[] = []; for (let i = 0; i < 8; i += 2) p.push(P(c[i], c[i + 1])); s += `<polygon points="${p.join(' ')}" fill="${b.fill}" stroke="#222" stroke-width="0.5"/>` }
  return s + `<text x="6" y="16" font-size="12">${Math.round(x1 - x0)} m</text></svg>`
}
