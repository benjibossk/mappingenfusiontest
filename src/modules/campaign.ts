// Countryside module — field plots + hedges over a zone.
// Approach inspired by Tanin69/AgriFieldGenerator (MIT, © 2024 Didier ALAIN): seeds,
// Voronoi clipped by the zone, borders between plots. Own implementation here; additions:
// real hedges (PrefabGenerator on the borders), output in the mapgen.json pivot format.

import { Delaunay } from 'd3-delaunay'
import * as turf from '@turf/turf'
import type { Feature, Polygon, MultiPolygon, LineString } from 'geojson'
import { GENERATORS, type ProjectShape } from '../project'

export interface CampaignOptions {
  /** closed zone, flat world X/Z pairs */
  zone: number[]
  /** taille moyenne d'une parcelle, m */
  fieldSize: number
  /** 0..1: random offset of the seeds within their cell */
  jitter: number
  /** grid angle, degrees */
  angle: number
  /** probability that a border between two plots carries a hedge */
  hedgeChance: number
  /** minimum length of a hedge segment, m */
  minHedge: number
  seed: number
  /** false = eau / hors terrain : pas de parcelle ni de haie */
  isLand?: (x: number, z: number) => boolean
  hedgeGenerator?: string
  prefix?: string
}

export interface CampaignResult {
  fields: number[][][]   // [x, z][] rings per plot (preview, masks later)
  hedges: number[][][]   // polylignes [x, z][]
  shapes: ProjectShape[]
}

// deterministic PRNG: same seed → same countryside
function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function pairsToRing(flat: number[]): [number, number][] {
  const ring: [number, number][] = []
  for (let i = 0; i + 1 < flat.length; i += 2) ring.push([flat[i], flat[i + 1]])
  ring.push([...ring[0]] as [number, number])
  return ring
}

const key = (p: number[]) => `${p[0].toFixed(3)},${p[1].toFixed(3)}`

export function generateCampaign(o: CampaignOptions): CampaignResult {
  const rand = mulberry32(o.seed)
  const land = o.isLand ?? (() => true)
  const zone = turf.polygon([pairsToRing(o.zone)])
  const [minX, minZ, maxX, maxZ] = turf.bbox(zone)

  // 1. seeds: rotated grid + jitter, kept inside the zone
  const seeds: [number, number][] = []
  const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2
  const r = Math.hypot(maxX - minX, maxZ - minZ) / 2
  const a = (o.angle * Math.PI) / 180, cos = Math.cos(a), sin = Math.sin(a)
  for (let u = -r; u <= r; u += o.fieldSize) {
    for (let v = -r; v <= r; v += o.fieldSize) {
      const du = u + (rand() - 0.5) * o.jitter * o.fieldSize
      const dv = v + (rand() - 0.5) * o.jitter * o.fieldSize
      const p: [number, number] = [cx + du * cos - dv * sin, cz + du * sin + dv * cos]
      if (turf.booleanPointInPolygon(p, zone) && land(p[0], p[1])) seeds.push(p)
    }
  }
  if (seeds.length < 2) return { fields: [], hedges: [], shapes: [] }

  // 2. Voronoi clipped by the zone
  const delaunay = Delaunay.from(seeds)
  const voronoi = delaunay.voronoi([minX - 1, minZ - 1, maxX + 1, maxZ + 1])
  const fields: number[][][] = []
  for (let i = 0; i < seeds.length; i++) {
    const cell = voronoi.cellPolygon(i)
    if (!cell) continue
    const clipped = turf.intersect(turf.featureCollection([turf.polygon([cell as number[][]]), zone])) as
      Feature<Polygon | MultiPolygon> | null
    if (!clipped) continue
    const polys = clipped.geometry.type === 'Polygon' ? [clipped.geometry.coordinates] : clipped.geometry.coordinates
    for (const p of polys) fields.push(p[0])
  }

  // 3. shared borders between neighbours → hedges (one roll per border), clipped by the zone
  const outline = turf.polygonToLine(zone) as Feature<LineString>
  const hedges: number[][][] = []
  for (let i = 0; i < seeds.length; i++) {
    const ci = voronoi.cellPolygon(i)
    if (!ci) continue
    const vi = new Set(ci.map(key))
    for (const j of delaunay.neighbors(i)) {
      if (j <= i || rand() >= o.hedgeChance) continue
      const cj = voronoi.cellPolygon(j)
      if (!cj) continue
      const shared = cj.filter((p) => vi.has(key(p)))
      const ends = [...new Map(shared.map((p) => [key(p), p])).values()]
      if (ends.length !== 2) continue

      const edge = turf.lineString(ends as number[][])
      const pieces = turf.lineSplit(edge, outline).features
      for (const piece of pieces.length ? pieces : [edge]) {
        const pts = piece.geometry.coordinates
        // planar midpoint: turf.midpoint is geodesic and treats X/Z as lon/lat
        const a0 = pts[0], a1 = pts[pts.length - 1]
        const mid = [(a0[0] + a1[0]) / 2, (a0[1] + a1[1]) / 2]
        if (!turf.booleanPointInPolygon(mid, zone)) continue
        if (Math.hypot(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]) < o.minHedge) continue
        if (!land(a0[0], a0[1]) || !land(a1[0], a1[1]) || !land(mid[0], mid[1])) continue
        hedges.push(pts)
      }
    }
  }

  // 4. pivot format: one open polyline + PrefabGenerator per hedge
  const prefix = o.prefix ?? 'CAMP'
  const generator = o.hedgeGenerator ?? GENERATORS.hedgeCorylus
  const shapes: ProjectShape[] = hedges.map((h, n) => ({
    id: `${prefix}_Hedge_${n}`,
    kind: 'polyline',
    closed: false,
    points: h.flatMap((p) => [round(p[0]), round(p[1])]),
    generator,
  }))

  return { fields, hedges, shapes }
}

const round = (v: number) => Math.round(v * 100) / 100
