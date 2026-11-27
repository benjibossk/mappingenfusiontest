// Atelier zones: what already stands in the world (read from the .layer files by the Atelier) turned into the
// generator's inputs: roads (Road), lakes / rivers (Water), building / wall footprints (blocked boxes), and the
// existing power network (pole / line points a new line may connect to). Only what lies near the zone is kept.
import type { LayerObjects, WaterBody } from '../formats/layer.ts'
import { objectFootprint, FALLBACK_HALF } from '../footprints.ts'
import type { Road, RoadType } from '../../modules/roads.ts'
import type { Water } from '../../modules/water.ts'
import { inBox, type Box } from './adapter.ts'

export interface ZoneWorld {
  roads: Road[]
  waters: Water[]
  /** footprints of existing buildings / walls / port pieces (4 corners, flat x/z) */
  footprints: number[][]
  /** existing power poles / line points, flat x/z */
  power: number[]
}
export const EMPTY_WORLD: ZoneWorld = { roads: [], waters: [], footprints: [], power: [] }

const ROAD_OF: Record<string, { type: RoadType; width: number }> = { asphalt: { type: 'asphalt', width: 7 }, concrete: { type: 'concrete', width: 6 }, dirt: { type: 'dirt', width: 4 } }

/** polyline bounding box overlaps the box (a road may cross the zone with no vertex inside) */
const near = (box: Box, xs: number[], zs: number[]) => Math.min(...xs) <= box[2] && Math.max(...xs) >= box[0] && Math.min(...zs) <= box[3] && Math.max(...zs) >= box[1]

/** existing content near `box` (world metres) as generator inputs */
/** `skip(layerFile)` true = ignore that layer's objects (the zone's own previous output when it is generated again) */
export function zoneWorld(objects: LayerObjects | null, bodies: WaterBody[], power: number[], box: Box, skip: (layer: string | undefined) => boolean = () => false): ZoneWorld {
  const out: ZoneWorld = { roads: [], waters: [], footprints: [], power: [] }
  if (objects) {
    objects.roads.forEach((r, i) => {
      if (skip(r.layer) || r.pts.length < 2 || !near(box, r.pts.map((p) => p[0]), r.pts.map((p) => p[1]))) return
      const t = ROAD_OF[r.type] ?? ROAD_OF.dirt
      out.roads.push({ id: `EXIST_ROAD_${i}`, type: t.type, width: t.width, pts: r.pts.flat() })
    })
    const fp = (o: { x: number; z: number; yaw?: number; prefab?: string; layer?: string }, half: number) => { if (!skip(o.layer) && inBox(box, o.x, o.z)) out.footprints.push(objectFootprint(o, half).corners) }
    for (const b of objects.buildings) fp(b, b.type === 'industrial' ? FALLBACK_HALF.industrial : FALLBACK_HALF.house)
    for (const w of objects.walls) fp(w, 1.5)
    for (const p of objects.port) fp(p, FALLBACK_HALF.port)
  }
  bodies.forEach((b, i) => {
    if (!near(box, b.x, b.z)) return
    const pts = b.x.flatMap((x, k) => [x, b.z[k]])
    out.waters.push(b.kind === 'lake' ? { id: `EXIST_LAKE_${i}`, type: 'lake', pts, width: 0, depth: 2 } : { id: `EXIST_RIVER_${i}`, type: 'river', pts, width: b.width ?? 6, depth: 1 })
  })
  for (let i = 0; i + 1 < power.length; i += 2) if (inBox(box, power[i], power[i + 1])) out.power.push(power[i], power[i + 1])
  return out
}

/** closest point on a polyline set: [x, z, distance, road index] */
export function nearestOnRoads(roads: { pts: number[] }[], x: number, z: number): [number, number, number, number] {
  let best: [number, number, number, number] = [x, z, Infinity, -1]
  roads.forEach((r, ri) => {
    for (let i = 0; i + 3 < r.pts.length; i += 2) {
      const ax = r.pts[i], az = r.pts[i + 1], dx = r.pts[i + 2] - ax, dz = r.pts[i + 3] - az, l = dx * dx + dz * dz
      const t = l ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l)) : 0
      const px = ax + t * dx, pz = az + t * dz, d = Math.hypot(x - px, z - pz)
      if (d < best[2]) best = [px, pz, d, ri]
    }
  })
  return best
}
