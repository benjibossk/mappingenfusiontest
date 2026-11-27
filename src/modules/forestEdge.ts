// Progressive forest edges (lisières) for the Workbench export: each forest polygon is split into a dense
// core (the forest generator) and an outer ring of 1-2 bands with sparser vanilla generators: a shrub
// mantle (brushland) on the outside, a pioneer / sparse tree band between it and the core. A negative
// buffer gives the core; the ring is cut where the forest touches another forest (no edge inside a
// wood). All pieces are closed polygons that tile the original (area conserved, no overlap).

import * as turf from '@turf/turf'
import type { Feature, MultiPolygon, Polygon } from 'geojson'
import { flatToPoly, forestPieces } from './zonefill'
import { FOREST_AVOID, type ProjectShape } from '../project'

/** vanilla generators (GUIDs read from the game data, parents of Prefabs/WEGenerators/Brushland/FG_*_aut.et) */
export const EDGE_GEN = {
  brush: '{EBD3B60C5329E2BF}Prefabs/WEGenerators/Brushland/FG_Brushland_Sparse.et', // hazel, birch, dog rose, raspberry
  sorbus: '{6EBA659B6191CA08}Prefabs/WEGenerators/Brushland/FG_Brushland_Sorbus_Sparse.et', // rowan + hazel + birch
  birch: '{9F334D92867197FA}Prefabs/WEGenerators/Brushland/FG_Pioneer_Birch1.et', // pioneer birches
  picea: '{B270CEB8DA60414D}Prefabs/WEGenerators/Brushland/FG_Brushland_Picea_Sparse.et', // conifer-edge shrubs
} as const

export type Leaf = 'broad' | 'needle' | 'mixed'
/** [outer mantle, inner band] per leaf type */
export const EDGE_BANDS: Record<Leaf, [string, string]> = {
  broad: [EDGE_GEN.brush, EDGE_GEN.birch],
  mixed: [EDGE_GEN.sorbus, EDGE_GEN.birch],
  needle: [EDGE_GEN.picea, EDGE_GEN.birch],
}

export interface EdgeForest { id: string; pts: number[]; leaf?: Leaf; generator: string; noEdge?: boolean }
export interface EdgePiece { id: string; forest: string; band: 0 | 1 | 2; pts: number[]; generator: string } // band 0 = core

export interface EdgeOptions {
  width?: number // m, total edge depth on a big forest (default 24; vanilla density reaches 90 % of the core 16-24 m in, bushes peak on the outline)
  minArea?: number // m², forests smaller than this keep no edge (default 6000)
  twoBands?: number // m, from this depth on the ring is split in 2 bands (default 14)
  touch?: number // m, gap under which two forests count as touching (default 3)
}

type Poly = Feature<Polygon | MultiPolygon>
const K = 1 / 111320 // metres <-> degrees at the equator: turf.buffer works in metres around (0, 0)
const scale = (f: Poly, k: number): Poly => { const g = turf.clone(f); turf.coordEach(g, (c) => { c[0] *= k; c[1] *= k }); return g }
/** planar inset / outset by d metres (negative = inward) */
export function bufferM(f: Poly, d: number): Poly | null {
  const b = turf.buffer(scale(f, K), d, { units: 'meters', steps: 4 })
  return b && b.geometry ? scale(b as Poly, 1 / K) : null
}

export const flatArea = (p: number[]) => { let a = 0; for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) a += (p[j] - p[i]) * (p[j + 1] + p[i + 1]); return Math.abs(a) / 2 }
const bbox = (p: number[]) => { let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity; for (let i = 0; i + 1 < p.length; i += 2) { x0 = Math.min(x0, p[i]); x1 = Math.max(x1, p[i]); z0 = Math.min(z0, p[i + 1]); z1 = Math.max(z1, p[i + 1]) } return [x0, z0, x1, z1] }

/** core + bands of every forest; a forest without room for an edge comes back whole (band 0) */
export function forestEdges(forests: EdgeForest[], o: EdgeOptions = {}): EdgePiece[] {
  const W = o.width ?? 24, minA = o.minArea ?? 6000, two = o.twoBands ?? 14, touch = o.touch ?? 3
  const boxes = forests.map((f) => bbox(f.pts)), out: EdgePiece[] = []
  forests.forEach((f, i) => {
    const whole = () => out.push({ id: f.id, forest: f.id, band: 0, pts: f.pts, generator: f.generator })
    const A = f.pts.length >= 6 ? flatToPoly(f.pts) : null, area = flatArea(f.pts)
    if (!A || f.noEdge || area < minA) return whole()
    const d = Math.min(W, Math.sqrt(area) / 8)
    if (d < 6) return whole()
    const b = boxes[i], m = d + touch
    const near: Poly[] = []
    forests.forEach((g, j) => {
      if (j === i || g.pts.length < 6) return
      const c = boxes[j]
      if (c[0] > b[2] + m || c[2] < b[0] - m || c[1] > b[3] + m || c[3] < b[1] - m) return
      // contact zone = this forest within `touch` m of the other one (a road between two woods is not a contact)
      const gp = flatToPoly(g.pts), gb = gp && bufferM(gp, touch)
      let contact: ReturnType<typeof turf.intersect> | null | false | undefined = null
      try { contact = gb && turf.intersect(turf.featureCollection([A, gb as Feature<Polygon>])) } catch { contact = null }
      const zone = contact && bufferM(contact as Poly, d + 1)
      if (zone) near.push(zone)
    })
    const widths = d >= two ? [d * 0.45, d] : [d]
    const insets = widths.map((w) => bufferM(A, -w))
    if (!insets[insets.length - 1]) return whole() // too thin: no core left
    const bands: number[][][] = []
    let prev: Poly | null = null
    for (let k = 0; k < widths.length; k++) {
      const ins = insets[k]!
      // band k = (A or previous inset) minus this inset minus the touching zone
      const outer = k === 0 ? f.pts : null
      const pieces = outer ? forestPieces(outer, [ins, ...near], 20) : (prev ? ringPieces(prev, ins, near) : [])
      bands.push(pieces)
      prev = ins
    }
    const ringPolys = bands.flat().map(flatToPoly).filter((p): p is Feature<Polygon> => !!p)
    const core = forestPieces(f.pts, ringPolys, 20)
    const [g0, g1] = EDGE_BANDS[f.leaf ?? 'mixed']
    core.forEach((pts, k) => out.push({ id: core.length > 1 ? `${f.id}_C${k + 1}` : f.id, forest: f.id, band: 0, pts, generator: f.generator }))
    bands.forEach((ps, k) => ps.forEach((pts, n) => out.push({ id: `${f.id}_E${k + 1}_${n + 1}`, forest: f.id, band: (k + 1) as 1 | 2, pts, generator: widths.length === 1 ? g1 : k === 0 ? g0 : g1 })))
  })
  return out
}

/** prev minus inset minus near, as flat rings (prev may be a multipolygon) */
function ringPieces(prev: Poly, ins: Poly, near: Poly[]): number[][] {
  const g = prev.geometry, polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates, res: number[][] = []
  for (const pc of polys) res.push(...forestPieces(pc[0].slice(0, -1).flatMap((q) => [q[0], q[1]]), [ins, ...near], 20))
  return res
}

/** pieces -> closed area shapes with the forest obstacle avoidance */
export const forestEdgeShapes = (pieces: EdgePiece[]): ProjectShape[] =>
  // points closer than 0.5 m merged here: the Workbench drops them anyway (seed 21 report: 55 outlines with lost points)
  pieces.map((p) => ({ id: p.id, kind: 'polyline', closed: true, points: dedupeRing(p.pts, 0.5), generator: p.generator, avoid: FOREST_AVOID }))

/** closed ring x,z,...: drop points closer than `min` metres to the previous kept one (and the last to the first) */
export function dedupeRing(pts: number[], min: number): number[] {
  const out: number[] = []
  for (let i = 0; i + 1 < pts.length; i += 2) {
    const n = out.length
    if (n && Math.hypot(pts[i] - out[n - 2], pts[i + 1] - out[n - 1]) < min) continue
    out.push(pts[i], pts[i + 1])
  }
  while (out.length > 6 && Math.hypot(out[0] - out[out.length - 2], out[1] - out[out.length - 1]) < min) out.splice(-2, 2)
  return out.length >= 6 ? out : pts
}

export interface FloorOptions {
  inset?: number // m, forest floor starts this far inside the outline (default 25)
  minArea?: number // m², forests smaller than this get no forest floor at all (default 20000 = 2 ha)
}
/** where the forest-floor ground goes, like vanilla Everon (Giorbev's study): only under the CORE of large forests
 *  (about half of the wooded area), the outline inset by ~25 m; edges, small groves and copses stay on the
 *  surrounding grass (Grass_03 / Grass_02). Never wider than the forest itself, so never floor without trees.
 *  Returns copies of the areas with the inset outer rings (a forest pinched in two gives two pieces). */
export function forestFloorAreas<T extends { id: string; pts: number[] }>(forests: T[], o: FloorOptions = {}): T[] {
  const ins = o.inset ?? 25, minA = o.minArea ?? 20000, out: T[] = []
  for (const f of forests) {
    if (f.pts.length < 6 || flatArea(f.pts) < minA) continue
    const A = flatToPoly(f.pts)
    let b: Poly | null = null
    try { b = A && bufferM(A, -ins) } catch { b = null }
    if (!b) continue
    const polys = b.geometry.type === 'Polygon' ? [b.geometry.coordinates] : b.geometry.coordinates
    polys.forEach((pc, k) => {
      const pts = pc[0].slice(0, -1).flatMap((q) => [q[0], q[1]])
      if (pts.length >= 6 && flatArea(pts) >= 100) out.push({ ...f, id: polys.length > 1 ? `${f.id}_F${k + 1}` : f.id, pts })
    })
  }
  return out
}
