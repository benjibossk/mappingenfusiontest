// Forests kept out of the water: the ForestGenerator fills its whole polygon, so a forest drawn (or generated)
// across a river or a lake grew trees in the river bed. Each forest polygon is cut by the river corridor
// (traced width / 2 + margin) and the lakes (+ margin) before it is sent; holes are split away (a forest shape
// sent to the Workbench is a single ring).
import * as turf from '@turf/turf'
import type { Feature, MultiPolygon, Polygon, Position } from 'geojson'

export interface WaterCut {
  /** flat X/Z points (river: course; lake: ring) */
  pts: number[]
  /** river width, metres (lakes: 0) */
  width: number
  closed: boolean
}
type Poly = Feature<Polygon | MultiPolygon>
interface Piece { poly: Poly; bb: [number, number, number, number] }

const ring = (p: number[]): Position[] => {
  const r: Position[] = []
  for (let i = 0; i + 1 < p.length; i += 2) r.push([p[i], p[i + 1]])
  if (r.length && (r[0][0] !== r[r.length - 1][0] || r[0][1] !== r[r.length - 1][1])) r.push([r[0][0], r[0][1]])
  return r
}
const flat = (r: Position[]) => r.slice(0, -1).flatMap((q) => [q[0], q[1]])
const bbox = (p: number[]): [number, number, number, number] => {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity
  for (let i = 0; i + 1 < p.length; i += 2) { x0 = Math.min(x0, p[i]); x1 = Math.max(x1, p[i]); z0 = Math.min(z0, p[i + 1]); z1 = Math.max(z1, p[i + 1]) }
  return [x0, z0, x1, z1]
}
const overlap = (a: number[], b: number[]) => a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3]
const ringArea = (r: Position[]) => { let a = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] - r[i][0]) * (r[j][1] + r[i][1]); return Math.abs(a) / 2 }

/** a band of half-width `half` along a polyline: one quad per segment + an octagon at each vertex, merged */
function band(p: number[], half: number, closed: boolean): Poly | null {
  const parts: Feature<Polygon>[] = []
  const n = p.length / 2
  const segs = closed ? n : n - 1
  for (let i = 0; i < segs; i++) {
    const j = (i + 1) % n
    const ax = p[i * 2], az = p[i * 2 + 1], bx = p[j * 2], bz = p[j * 2 + 1]
    const L = Math.hypot(bx - ax, bz - az)
    if (L < 1e-6) continue
    const nx = (-(bz - az) / L) * half, nz = ((bx - ax) / L) * half
    parts.push(turf.polygon([[[ax + nx, az + nz], [bx + nx, bz + nz], [bx - nx, bz - nz], [ax - nx, az - nz], [ax + nx, az + nz]]]))
  }
  for (let i = 0; i < n; i++) {
    const cx = p[i * 2], cz = p[i * 2 + 1], o: Position[] = []
    for (let k = 0; k < 8; k++) o.push([cx + Math.cos((k * Math.PI) / 4) * half, cz + Math.sin((k * Math.PI) / 4) * half])
    o.push(o[0])
    parts.push(turf.polygon([o]))
  }
  if (!parts.length) return null
  if (parts.length === 1) return parts[0]
  try { return turf.union(turf.featureCollection(parts)) } catch { return null }
}

/** water areas the forests must keep out of: river corridors (width / 2 + margin) and lakes (+ margin) */
export function waterCorridor(waters: WaterCut[], margin = 4): Piece[] {
  const out: Piece[] = []
  for (const w of waters) {
    if (w.pts.length < 4) continue
    const half = w.closed ? margin : w.width / 2 + margin
    const parts: Poly[] = []
    const b = band(w.pts, half, w.closed)
    if (b) parts.push(b)
    if (w.closed && w.pts.length >= 6) parts.push(turf.polygon([ring(w.pts)]))
    let poly: Poly | null = parts[0] ?? null
    if (parts.length > 1) { try { poly = turf.union(turf.featureCollection(parts)) } catch { poly = parts[0] } }
    if (!poly) continue
    const bb = bbox(w.pts)
    out.push({ poly, bb: [bb[0] - half, bb[1] - half, bb[2] + half, bb[3] + half] })
  }
  return out
}

/** a polygon with holes -> single rings: cut through each hole until none is left */
export function splitHoles(rings: Position[][], depth = 0): Position[][] {
  if (rings.length <= 1 || depth > 12) return [rings[0]]
  const hole = rings[1]
  let cx = 0
  for (const q of hole) cx += q[0]
  cx /= hole.length
  const [x0, z0, x1, z1] = bbox(flat(rings[0]))
  const poly = turf.polygon(rings)
  const out: Position[][] = []
  for (const box of [[x0 - 1, z0 - 1, cx, z1 + 1], [cx, z0 - 1, x1 + 1, z1 + 1]]) {
    let got: Poly | null = null
    try { got = turf.intersect(turf.featureCollection([poly, turf.bboxPolygon(box as [number, number, number, number])])) } catch { got = null }
    if (!got) continue
    const polys = got.geometry.type === 'Polygon' ? [got.geometry.coordinates] : got.geometry.coordinates
    for (const pr of polys) out.push(...splitHoles(pr, depth + 1))
  }
  return out
}

/** forest polygons (with optional holes) minus the water corridor: single-ring pieces of at least `minArea` m²
 *  (a forest left whole keeps its object; a cut one gives `<id>_W<k>` pieces) */
export function clipForestsToWater<T extends { id?: string; pts: number[]; holes?: number[][] }>(forests: T[], waters: WaterCut[], o: { margin?: number; minArea?: number } = {}): T[] {
  const corr = waterCorridor(waters, o.margin ?? 4), minArea = o.minArea ?? 400
  const out: T[] = []
  for (const f of forests) {
    if (f.pts.length < 6) { out.push(f); continue }
    const bb = bbox(f.pts)
    const hit = corr.filter((c) => overlap(c.bb, bb))
    if (!hit.length && !f.holes?.length) { out.push(f); continue }
    let poly: Poly | null
    try { poly = turf.polygon([ring(f.pts), ...(f.holes ?? []).filter((h) => h.length >= 6).map(ring)]) } catch { out.push(f); continue }
    for (const c of hit) {
      if (!poly) break
      try { poly = turf.difference(turf.featureCollection([poly, c.poly])) } catch { /* keep the uncut shape */ }
    }
    if (!poly) continue
    const polys = poly.geometry.type === 'Polygon' ? [poly.geometry.coordinates] : poly.geometry.coordinates
    const pieces = polys.flatMap((pr) => splitHoles(pr)).filter((r) => r && r.length >= 4 && ringArea(r) >= minArea)
    const whole = pieces.length === 1 && !hit.length
    pieces.forEach((r, k) => out.push({ ...f, ...(f.id && !whole && pieces.length > 1 ? { id: `${f.id}_W${k + 1}` } : {}), pts: flat(r), holes: undefined }))
  }
  return out
}
