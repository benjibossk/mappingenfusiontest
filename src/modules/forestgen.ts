// Forests for a fictive island (no real place to read them from): woods grow on dry land of moderate
// slope, away from the places, in blobs picked by a seeded value noise. Each blob becomes one closed
// forest area (convex hull of a compact group of cells), the same shape the real-place import gives.

import { forestTuning, leafOf } from '../biomes/vegetation'
import type { Grid } from './island'
import { SITE_RADIUS, type Site } from './network'

export interface GenForest { leaf: 'broad' | 'needle' | 'mixed'; pts: number[] }
export interface ForestOptions { seed: number; cover: number /* 0..1, share of the suitable land */ ; sites: Site[]; biome?: string /* BiomeId, default Everon = unchanged */ }

function hash(x: number, y: number, s: number) {
  let n = (x * 374761393 + y * 668265263 + s * 2147483647) | 0
  n = Math.imul(n ^ (n >>> 13), 1274126177)
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296
}
function noise(x: number, y: number, s: number) {
  const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy)
  const a = hash(xi, yi, s), b = hash(xi + 1, yi, s), c = hash(xi, yi + 1, s), d = hash(xi + 1, yi + 1, s)
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v
}

function hull(p: [number, number][]): [number, number][] {
  p.sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const cross = (o: number[], a: number[], b: number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const lo: [number, number][] = [], up: [number, number][] = []
  for (const q of p) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q) }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q) }
  return lo.slice(0, -1).concat(up.slice(0, -1))
}

/** placement preference of a cell: mid heights and slopes, valleys (concave cells) more than ridges.
 *  a = relative altitude 0..1, slope = rise/run, concavity = mean corner height - centre height (m) */
export function forestBias(a: number, slope: number, concavity: number): number {
  return (a > 0.15 && a < 0.75 ? 0.06 : -0.06) + Math.min(slope, 0.4) * 0.15 + Math.max(-0.04, Math.min(0.04, concavity * 0.01))
}

/** steepest slope (rise/run) a wood grows on: steeper is scree / bare rock */
export const FOREST_MAX_SLOPE = 0.7 // ~35 deg: managed and natural woods stand on 30-40 deg flanks
/** can a wood grow on this cell? Not on very steep cells, nor on the exposed rocky ridges just under the
 *  tree line (strongly convex cell: centre well above its corners). a / treeLine relative 0..1 */
export function forestCellOk(a: number, slope: number, concavity: number, treeLine = 1): boolean {
  if (slope > FOREST_MAX_SLOPE) return false
  if (a > treeLine) return false
  if (a > treeLine - 0.12 && concavity < -1.5) return false // rocky crest
  return true
}

export function generateForests(h: ArrayLike<number>, g: Grid, o: ForestOptions): GenForest[] {
  const C = 48 // m, forest cell
  const nc = Math.floor(((g.cols - 1) * g.step) / C), nr = Math.floor(((g.rows - 1) * g.step) / C)
  const at = (x: number, z: number) => {
    const c = Math.min(g.cols - 1, Math.max(0, Math.round((x - g.minX) / g.step))), r = Math.min(g.rows - 1, Math.max(0, Math.round((z - g.minZ) / g.step)))
    return h[r * g.cols + c]
  }
  let top = 1
  for (let i = 0; i < h.length; i++) if (h[i] > top) top = h[i]
  const ok = new Uint8Array(nc * nr), alt = new Float32Array(nc * nr)
  const tune = forestTuning(o.biome)
  const cover = o.cover * tune.coverMul
  if (cover < 0.03) return [] // (desert) no forest at all
  const thr = 1 - Math.min(0.95, Math.max(0.05, cover))
  for (let r = 0; r < nr; r++)
    for (let c = 0; c < nc; c++) {
      const x = g.minX + (c + 0.5) * C, z = g.minZ + (r + 0.5) * C
      // the whole cell must be dry
      const hs = [at(x, z), at(x - C / 2, z - C / 2), at(x + C / 2, z - C / 2), at(x - C / 2, z + C / 2), at(x + C / 2, z + C / 2)]
      if (Math.min(...hs) < 3) continue
      // corners are C * sqrt2 apart: dividing the range by C read a 25 deg flank as 34 deg and kept woods off every
      // mountain flank steeper than ~21 deg (seen on the mountains relief, seed 21)
      const slope = (Math.max(...hs) - Math.min(...hs)) / (C * Math.SQRT2)
      if (o.sites.some((s) => Math.hypot(s.x - x, s.z - z) < SITE_RADIUS[s.kind] + 60)) continue
      const n = noise(x / 420, z / 420, o.seed) * 0.7 + noise(x / 130, z / 130, o.seed + 7) * 0.3
      // a bit more wood on the slopes and mid heights, less on the coast and the summits
      const a = hs[0] / top
      const cv = (hs[1] + hs[2] + hs[3] + hs[4]) / 4 - hs[0]
      if (!forestCellOk(a, slope, cv, tune.treeLine)) continue // steep / rocky cells, bare summits above the tree line
      const bias = forestBias(a, slope, cv)
      if (n + bias < thr) continue
      ok[r * nc + c] = 1
      alt[r * nc + c] = a
    }
  // compact groups of at most ~60 cells (14 ha) so each convex hull stays close to its cells; a group stays
  // in one altitude band so a wood climbing a hill turns broadleaf -> mixed -> conifer on the way up
  const band = (k: number) => leafOf(alt[k], tune.needleShift)
  const seen = new Uint8Array(nc * nr), out: GenForest[] = []
  for (let i = 0; i < ok.length; i++) {
    if (!ok[i] || seen[i]) continue
    const group: number[] = [], q = [i], b0 = band(i)
    seen[i] = 1
    while (q.length && group.length < 60) {
      const k = q.shift()!
      group.push(k)
      const c = k % nc, r = (k - c) / nc
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const cc = c + dc, rr = r + dr, j = rr * nc + cc
        if (cc < 0 || rr < 0 || cc >= nc || rr >= nr || !ok[j] || seen[j] || band(j) !== b0) continue
        seen[j] = 1; q.push(j)
      }
    }
    for (const k of q) seen[k] = 0 // not taken: free for the next group
    if (group.length < 3) continue // ~0.7 ha: vanilla massifs p10 0.6-0.7 ha, median 1.6-2.8 ha
    const pts: [number, number][] = []
    for (const k of group) {
      const c = k % nc, r = (k - c) / nc
      for (const [dx, dz] of [[0.1, 0.1], [0.9, 0.1], [0.1, 0.9], [0.9, 0.9]]) pts.push([g.minX + (c + dx) * C, g.minZ + (r + dz) * C])
    }
    out.push({ leaf: b0, pts: hull(pts).flat() })
  }
  return out
}
