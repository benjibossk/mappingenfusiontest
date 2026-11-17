// Zone tool helpers: cut generated content so that it stays inside a drawn polygon and gives way to
// higher-priority content. Priority (high -> low): water > roads > habitation > industrial > fields > forest.
// Shared by the "Zone" tool (main.ts) and the world generator (worldgen.ts, step 10b countryside).

import * as turf from '@turf/turf'
import type { Feature, MultiPolygon, Polygon } from 'geojson'

export type ZoneFillType = 'fields' | 'forest' | 'habitation' | 'industrial'
export const ZONE_FILL_TYPES: ZoneFillType[] = ['fields', 'forest', 'habitation', 'industrial']
/** steepest ground (rise / run) each type accepts */
export const ZONE_MAX_SLOPE: Record<ZoneFillType, number> = { fields: 0.15, forest: 1, habitation: 0.2, industrial: 0.06 }
/** lower number = higher priority (wins an overlap) */
export const ZONE_PRIORITY: Record<'water' | 'roads' | ZoneFillType, number> = { water: 0, roads: 1, habitation: 2, industrial: 3, fields: 4, forest: 5 }

export interface RoadLike { pts: number[]; half: number }
type Poly = Feature<Polygon | MultiPolygon>

/** flat X/Z pairs -> closed turf polygon (null when degenerate) */
export function flatToPoly(flat: number[]): Feature<Polygon> | null {
  if (flat.length < 6) return null
  const ring: number[][] = []
  for (let i = 0; i + 1 < flat.length; i += 2) ring.push([flat[i], flat[i + 1]])
  ring.push([...ring[0]])
  try { return turf.polygon([ring]) } catch { return null }
}

/** oriented rectangle around a segment, half-width w, extended by w at both ends */
export function segmentRect(x0: number, z0: number, x1: number, z1: number, w: number): Feature<Polygon> {
  const L = Math.hypot(x1 - x0, z1 - z0) || 1, nx = (-(z1 - z0) / L) * w, nz = ((x1 - x0) / L) * w, ex = ((x1 - x0) / L) * w, ez = ((z1 - z0) / L) * w
  return turf.polygon([[[x0 - nx - ex, z0 - nz - ez], [x1 - nx + ex, z1 - nz + ez], [x1 + nx + ex, z1 + nz + ez], [x0 + nx - ex, z0 + nz - ez], [x0 - nx - ex, z0 - nz - ez]]])
}

/** road verges as rectangles (half width + margin), only the segments that `near` accepts */
export function roadObstacles(roads: RoadLike[], margin: number, near: (x: number, z: number) => boolean = () => true): Feature<Polygon>[] {
  const out: Feature<Polygon>[] = []
  for (const rd of roads) for (let i = 0; i + 3 < rd.pts.length; i += 2)
    if (near(rd.pts[i], rd.pts[i + 1]) || near(rd.pts[i + 2], rd.pts[i + 3])) out.push(segmentRect(rd.pts[i], rd.pts[i + 1], rd.pts[i + 2], rd.pts[i + 3], rd.half + margin))
  return out
}

/** square yard around a point */
export const pointObstacle = (x: number, z: number, r: number) => segmentRect(x - 0.01, z, x + 0.01, z, r)
/** closed flat corner list -> obstacle polygon */
export const cornersObstacle = (c: number[]) => flatToPoly(c)

const bboxApart = (a: number[], b: number[]) => a[0] > b[2] || a[2] < b[0] || a[1] > b[3] || a[3] < b[1]

/** shape minus every obstacle (bbox pre-filter; degenerate clips keep the shape as is) */
export function subtract(shape: Poly | null, obst: Poly[]): Poly | null {
  if (!shape) return null
  const fb = turf.bbox(shape)
  for (const o of obst) {
    if (!shape) break
    if (bboxApart(turf.bbox(o), fb)) continue
    try { shape = turf.difference(turf.featureCollection([shape, o])) } catch { /* keep */ }
  }
  return shape
}

/** shape inside a zone polygon */
export function clipTo(shape: Poly | null, zone: Feature<Polygon> | null): Poly | null {
  if (!shape || !zone) return shape
  try { return turf.intersect(turf.featureCollection([shape, zone])) } catch { return shape }
}

const outerRings = (s: Poly) => (s.geometry.type === 'Polygon' ? [s.geometry.coordinates] : s.geometry.coordinates)
const ringArea = (r: number[][]) => { let a = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] - r[i][0]) * (r[j][1] + r[i][1]); return Math.abs(a) / 2 }

export interface ClipPlotsOptions {
  /** roads, houses, zones... the plots are cut by */
  obstacles: Poly[]
  /** plots already laid (filled in as plots are kept: no overlap between plots) */
  laid?: Feature<Polygon>[]
  /** zone the plots must stay inside */
  zone?: Feature<Polygon> | null
  /** is this point farmable (slope, water, forest...)? */
  ok: (x: number, z: number) => boolean
  minArea?: number // m², slivers dropped (2500)
  okShare?: number // share of the ring samples that must be farmable (0.75)
}
/** cut field plots by obstacles / laid plots / zone; holed or mostly unfarmable pieces dropped */
export function clipPlots(fields: number[][][], o: ClipPlotsOptions): number[][][] {
  const laid = o.laid ?? [], minArea = o.minArea ?? 2500, share = o.okShare ?? 0.75
  const kept: number[][][] = []
  for (const f of fields) {
    let shape: Poly | null
    try { shape = turf.polygon([f.map((q) => [q[0], q[1]])]) } catch { continue }
    shape = clipTo(subtract(shape, [...o.obstacles, ...laid]), o.zone ?? null)
    if (!shape) continue
    for (const pc of outerRings(shape)) {
      if (pc.length > 1) continue // an isolated house left a hole: farmyard, not a field
      const ring0 = pc[0]
      if (ringArea(ring0) < minArea) continue
      let cx = 0, cz = 0
      for (const q of ring0) { cx += q[0]; cz += q[1] }
      cx /= ring0.length; cz /= ring0.length
      let good = 0, n = 0
      for (let t = 0; t < ring0.length - 1; t++) { const q = ring0[t]; n++; if (o.ok((q[0] * 3 + cx) / 4, (q[1] * 3 + cz) / 4)) good++ }
      if (!o.ok(cx, cz) || good < n * share) continue
      kept.push(ring0)
      laid.push(turf.polygon([ring0]))
    }
  }
  return kept
}

/** hedges on the plot borders (shared borders once), `keep` share of them, never on unfarmable ground */
export function plotHedges(kept: number[][][], o: { seen?: Set<string>; rnd: () => number; ok: (x: number, z: number) => boolean; keep?: number; minLen?: number }): number[][][] {
  const seen = o.seen ?? new Set<string>(), out: number[][][] = [], keep = o.keep ?? 0.8, minLen = o.minLen ?? 12
  for (const f of kept) for (let i = 0; i + 1 < f.length; i++) {
    const a = f[i], b = f[i + 1]
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) < minLen) continue
    const id = [a, b].map((q) => `${Math.round(q[0])},${Math.round(q[1])}`).sort().join('|')
    if (seen.has(id)) continue
    seen.add(id)
    if (o.rnd() > keep || !o.ok((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)) continue
    out.push([a, b])
  }
  return out
}

/** forest pieces = zone minus the obstacles; pieces under `minArea` m² dropped; returns flat X/Z rings (outer only) */
export function forestPieces(zone: number[], obstacles: Poly[], minArea = 400): number[][] {
  let s = subtract(flatToPoly(zone), obstacles)
  if (!s) return []
  // a flat ring has no holes: a hole (house, lake in the middle) is opened by a thin cut to the edge
  for (let pass = 0; pass < 4 && s; pass++) {
    const top = turf.bbox(s)[3] + 1, cuts: Feature<Polygon>[] = []
    for (const pc of outerRings(s)) for (const hole of pc.slice(1)) cuts.push(segmentRect(hole[0][0], hole[0][1], hole[0][0], top, 0.25))
    if (!cuts.length) break
    s = subtract(s, cuts)
  }
  if (!s) return []
  const out: number[][] = []
  for (const pc of outerRings(s)) {
    const r = pc[0]
    if (ringArea(r) < minArea) continue
    out.push(r.slice(0, -1).flatMap((q) => [Math.round(q[0] * 100) / 100, Math.round(q[1] * 100) / 100]))
  }
  return out
}

/** a lower-priority flat ring cut by higher-priority obstacles: flat rings left (outer only) */
export function cutRing(flat: number[], obstacles: Poly[], minArea = 400): number[][] {
  return forestPieces(flat, obstacles, minArea)
}

/** share of the samples (about every 10 m) inside a flat ring steeper than maxSlope */
export function slopeShare(h: (x: number, z: number) => number, ring: number[], maxSlope: number, step = 10): number {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity
  for (let i = 0; i < ring.length; i += 2) { x0 = Math.min(x0, ring[i]); x1 = Math.max(x1, ring[i]); z0 = Math.min(z0, ring[i + 1]); z1 = Math.max(z1, ring[i + 1]) }
  const st = Math.max(step, Math.sqrt(((x1 - x0) * (z1 - z0)) / 4000))
  let n = 0, steep = 0
  for (let x = x0 + st / 2; x < x1; x += st) for (let z = z0 + st / 2; z < z1; z += st) {
    if (!inRing(ring, x, z)) continue
    n++
    const d = 5, gx = (h(x + d, z) - h(x - d, z)) / (2 * d), gz = (h(x, z + d) - h(x, z - d)) / (2 * d)
    if (Math.hypot(gx, gz) > maxSlope) steep++
  }
  return n ? steep / n : 0
}
function inRing(p: number[], x: number, z: number) {
  let c = false
  for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) if ((p[i + 1] > z) !== (p[j + 1] > z) && x < ((p[j] - p[i]) * (z - p[i + 1])) / (p[j + 1] - p[i + 1]) + p[i]) c = !c
  return c
}
