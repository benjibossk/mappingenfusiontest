// Real data adapted for gameplay and performance: a real place is not copied as is.
// - forests: woods closer than `gap` are welded into one forest (fewer generators, readable cover),
//   small woods left alone are dropped, outlines smoothed
// - roads: short dead pieces of minor roads (parking aisles, driveways, bits of path) are dropped
// - buildings: dense town centres are thinned (at most `perCell` buildings per 40 m square) and the
//   total is capped, the largest buildings are kept first
// Positions are local metres; turf works in degrees, so they are mapped near the equator
// (1° = 111.32 km both ways there, the distortion over a Reforger map is negligible).

import * as turf from '@turf/turf'
import type { Feature, MultiPolygon, Polygon } from 'geojson'
import type { OsmResult } from './osm'

export interface AdaptOptions {
  gap: number // m, woods closer than this become one forest
  minForest: number // m², after welding
  minRoad: number // m, minor road pieces shorter than this are dropped
  perCell: number // buildings per 40 m square
  maxBuildings: number
}
export const ADAPT_DEFAULTS: AdaptOptions = { gap: 25, minForest: 20000, minRoad: 40, perCell: 3, maxBuildings: 2500 }

const DEG = 111320
const MINOR = new Set(['asphaltNarrow', 'dirt', 'trailDirt', 'trailGravel'])

export function adaptForGame(o: OsmResult, a: AdaptOptions = ADAPT_DEFAULTS) {
  const before = { forests: o.forests.length, roads: o.roads.length, buildings: o.buildings.length }
  o.forests = weldForests(o.forests, a)
  o.roads = o.roads.filter((r) => !MINOR.has(r.type) || length(r.pts) >= a.minRoad)
  o.buildings = thinBuildings(o.buildings, a)
  return { before, after: { forests: o.forests.length, roads: o.roads.length, buildings: o.buildings.length } }
}

const length = (p: number[]) => { let l = 0; for (let k = 2; k < p.length; k += 2) l += Math.hypot(p[k] - p[k - 2], p[k + 1] - p[k - 1]); return l }
const area = (p: number[]) => { let s = 0; for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) s += (p[j] + p[i]) * (p[j + 1] - p[i + 1]); return Math.abs(s / 2) }
const toPoly = (p: number[]) => {
  const ring: [number, number][] = []
  for (let k = 0; k < p.length; k += 2) ring.push([p[k] / DEG, p[k + 1] / DEG])
  ring.push(ring[0])
  return turf.polygon([ring])
}
function inside(p: number[], x: number, z: number) {
  let r = false
  for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) {
    if (p[i + 1] > z !== p[j + 1] > z && x < p[i] + ((z - p[i + 1]) * (p[j] - p[i])) / (p[j + 1] - p[i + 1])) r = !r
  }
  return r
}

type Forest = OsmResult['forests'][number]
function weldForests(fs: Forest[], a: AdaptOptions): Forest[] {
  if (fs.length < 2 || a.gap <= 0) return fs.filter((f) => area(f.pts) >= a.minForest)
  const grown: Feature<Polygon | MultiPolygon>[] = []
  for (const f of fs) {
    if (f.pts.length < 6) continue
    try { const b = turf.buffer(toPoly(f.pts), a.gap / 2, { units: 'meters' }); if (b) grown.push(b) } catch { /* broken ring */ }
  }
  let merged: Feature<Polygon | MultiPolygon> | null = grown[0] ?? null
  if (grown.length > 1) merged = turf.union(turf.featureCollection(grown))
  if (!merged) return []
  const shrunk = turf.buffer(merged, -a.gap / 2, { units: 'meters' })
  if (!shrunk) return []
  const g = shrunk.geometry
  const outers = (g.type === 'Polygon' ? [g.coordinates] : g.coordinates).map((p) => p[0])
  const out: Forest[] = []
  for (const r of outers) {
    const s = turf.simplify(turf.polygon([r]), { tolerance: 6 / DEG }).geometry.coordinates[0]
    const pts: number[] = []
    for (const [x, z] of s.slice(0, -1)) pts.push(Math.round(x * DEG * 10) / 10, Math.round(z * DEG * 10) / 10)
    if (pts.length < 6 || area(pts) < a.minForest) continue
    // leaf type and height of the largest wood inside (its middle point: corners get rounded off)
    let best: Forest | null = null, bestA = 0
    for (const f of fs) {
      const fa = area(f.pts)
      let cx = 0, cz = 0
      for (let k = 0; k < f.pts.length; k += 2) { cx += f.pts[k]; cz += f.pts[k + 1] }
      const n = f.pts.length / 2
      if (fa > bestA && inside(pts, cx / n, cz / n)) { best = f; bestA = fa }
    }
    out.push({ pts, leaf: best?.leaf ?? 'mixed', ...(best?.tall ? { tall: best.tall } : {}) })
  }
  return out
}

function thinBuildings(bs: number[][], a: AdaptOptions): number[][] {
  const withArea = bs.map((p) => ({ p, a: area(p), x: 0, z: 0 }))
  for (const b of withArea) {
    for (let k = 0; k < b.p.length; k += 2) { b.x += b.p[k]; b.z += b.p[k + 1] }
    b.x /= b.p.length / 2; b.z /= b.p.length / 2
  }
  withArea.sort((u, v) => v.a - u.a)
  const cells = new Map<string, number>()
  const out: number[][] = []
  for (const b of withArea) {
    if (out.length >= a.maxBuildings) break
    const key = `${Math.floor(b.x / 40)},${Math.floor(b.z / 40)}`
    const n = cells.get(key) ?? 0
    if (n >= a.perCell) continue
    cells.set(key, n + 1)
    out.push(b.p)
  }
  return out
}
