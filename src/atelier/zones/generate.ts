// Atelier zones: generate content inside a zone drawn on an EXISTING world, with the generator's own modules
// (villages: village.ts settleVillages, power: power.ts routePowerLine + powergrid.ts substations, fields:
// zonefill.ts fillFieldZone, forests: zonefill.ts forestPieces). The heights come from the Atelier's full-res
// grid through adapter.ts (zone bounding box only). Nothing here writes heights: the result is entities and
// shapes, placed on the real terrain by the Workbench (no ycm = relative to the ground).
import type { HeightGrid } from '../heights.ts'
import { cropHeights, growBox, inBox, ringBox, unionBox, type Box } from './adapter.ts'
import { nearestOnRoads, type ZoneWorld } from './world.ts'
import { settleVillages, gardenFences, type VillageParcel } from '../../modules/village.ts'
import { sampler, type Placed } from '../../modules/settlements.ts'
import { centreLine, roadHalf, type Road } from '../../modules/roads.ts'
import { WATER_TYPES } from '../../modules/water.ts'
import { pointInPoly } from '../../modules/industrial.ts'
import { routePowerLine, type PowerLine } from '../../modules/power.ts'
import { STATION_PREFABS, type Station } from '../../modules/powergrid.ts'
import { cornersObstacle, fillFieldZone, flatToPoly, forestPieces, roadObstacles, slopeShare } from '../../modules/zonefill.ts'
import type { Site } from '../../modules/network.ts'

export interface ZoneSpec {
  name: string
  ring: number[] // flat x/z, closed implicitly
  seed: number
  villages: boolean
  power: boolean
  fields: boolean
  links: boolean // dirt roads from the villages to the existing road network
  forest: boolean
  density?: number
}
export interface ZoneResult {
  placed: Placed[]
  lanes: Road[]
  links: Road[]
  parcels: VillageParcel[]
  hedges: number[][] // flat x/z polylines (garden hedges + field hedges)
  power: (PowerLine & { id: string })[]
  stations: Station[]
  fields: number[][] // flat rings (preview; crop paint not sent yet)
  forests: number[][]
  warnings: string[]
  /** height copy used: cells and step (full res unless the zone is huge) */
  heights: { cols: number; rows: number; step: number; k: number }
}

export const POWER_REACH = 3000 // m: farthest existing pole a new line goes to
const LINK_REACH = 800 // m: farthest existing road a village link road goes to

const insideRing = (ring: number[], c: number[]) => { for (let i = 0; i + 1 < c.length; i += 2) if (!pointInPoly(ring, c[i], c[i + 1])) return false; return true }
const boxOf = (c: number[]): Box => { let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity; for (let i = 0; i + 1 < c.length; i += 2) { x0 = Math.min(x0, c[i]); x1 = Math.max(x1, c[i]); z0 = Math.min(z0, c[i + 1]); z1 = Math.max(z1, c[i + 1]) } return [x0, z0, x1, z1] }
const hit = (a: Box, b: Box) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3]
const ringArea = (r: number[]) => { let a = 0; for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) a += (r[j] - r[i]) * (r[j + 1] + r[i + 1]); return Math.abs(a) / 2 }

/** box bucket index: fast "does this point / box touch an obstacle" for the cost fields */
class Boxes {
  private cell = 32; private m = new Map<string, Box[]>()
  add(b: Box) { for (let x = Math.floor(b[0] / this.cell); x <= Math.floor(b[2] / this.cell); x++) for (let z = Math.floor(b[1] / this.cell); z <= Math.floor(b[3] / this.cell); z++) { const k = x + ',' + z; const l = this.m.get(k); if (l) l.push(b); else this.m.set(k, [b]) } }
  any(b: Box) { for (let x = Math.floor(b[0] / this.cell); x <= Math.floor(b[2] / this.cell); x++) for (let z = Math.floor(b[1] / this.cell); z <= Math.floor(b[3] / this.cell); z++) for (const o of this.m.get(x + ',' + z) ?? []) if (hit(o, b)) return true; return false }
}

/** village sites spread over the zone (farthest-point sampling): 1 per ~40 ha, at most 4 */
export function zoneSites(ring: number[], tag: string, seed: number): Site[] {
  const area = ringArea(ring), n = Math.max(1, Math.min(4, Math.round(area / 400_000))), [x0, z0, x1, z1] = ringBox(ring)
  const cand: [number, number][] = [], st = Math.max(10, Math.sqrt(area) / 20)
  for (let x = x0 + st / 2; x < x1; x += st) for (let z = z0 + st / 2; z < z1; z += st) if (pointInPoly(ring, x, z)) cand.push([x, z])
  if (!cand.length) return []
  let cx = 0, cz = 0; for (const [x, z] of cand) { cx += x; cz += z }
  cx /= cand.length; cz /= cand.length
  // first site: the candidate closest to the centroid (a concave zone's centroid can lie outside)
  const pick: [number, number][] = [cand.reduce((b, p) => (Math.hypot(p[0] - cx, p[1] - cz) < Math.hypot(b[0] - cx, b[1] - cz) ? p : b))]
  while (pick.length < n) pick.push(cand.reduce((b, p) => { const d = (q: [number, number]) => Math.min(...pick.map((s) => Math.hypot(q[0] - s[0], q[1] - s[1]))); return d(p) > d(b) ? p : b }))
  const kind = area / n > 250_000 ? 'village' : area / n > 40_000 ? 'village' : 'hamlet'
  void seed
  return pick.map(([x, z], i) => ({ id: `${tag}V${i + 1}`, x, z, kind }))
}

export function generateZone(H: HeightGrid, world: ZoneWorld, spec: ZoneSpec): ZoneResult {
  const ring = spec.ring, tag = spec.name, box = ringBox(ring), warnings: string[] = []
  const zg = cropHeights(H, growBox(box, 64))
  const ground = sampler(zg.heights, zg.grid)
  const res: ZoneResult = { placed: [], lanes: [], links: [], parcels: [], hedges: [], power: [], stations: [], fields: [], forests: [], warnings, heights: { cols: zg.grid.cols, rows: zg.grid.rows, step: zg.grid.step, k: zg.k } }
  const lakes = world.waters.filter((w) => WATER_TYPES[w.type].closed).map((w) => w.pts)
  const wet = (x: number, z: number) => lakes.some((p) => pointInPoly(p, x, z))
  const taken = new Boxes()
  for (const f of world.footprints) taken.add(growBox(boxOf(f), 2))

  // 1. villages (houses, yards, streets, garden hedges): blocked by every existing building / wall. The village
  // streets grow from a road (village.ts): a site with no road within 40 m first gets a spine, the link road to
  // the nearest existing road (end point snapped ON it) carried on through the site, or a main street across it.
  let sites: Site[] = []
  const yards: number[][] = [] // village lots + back gardens: no field / forest on them
  if (spec.villages) {
    if (slopeShare(ground, ring, 0.2) > 0.6) warnings.push('steep')
    sites = zoneSites(ring, tag, spec.seed)
    const [bx0, bz0, bx1, bz1] = box, axis: [number, number] = bx1 - bx0 >= bz1 - bz0 ? [1, 0] : [0, 1]
    const free = (x: number, z: number) => !wet(x, z) && !taken.any([x - 3, z - 3, x + 3, z + 3])
    /** from (x, z) along d while inside the zone and free, every 10 m, at most len */
    const run = (x: number, z: number, d: [number, number], len: number) => { const out: number[] = []; for (let t = 10; t <= len; t += 10) { const px = x + d[0] * t, pz = z + d[1] * t; if (!pointInPoly(ring, px, pz) || !free(px, pz)) break; out.push(px, pz) } return out }
    sites.forEach((st, i) => {
      const best = nearestOnRoads(world.roads, st.x, st.z)
      if (best[2] < 40) return
      if (spec.links && best[2] <= LINK_REACH) {
        const L = best[2], n = Math.max(1, Math.ceil(L / 20)), pts: number[] = []
        for (let k = 0; k <= n; k++) pts.push(best[0] + (st.x - best[0]) * k / n, best[1] + (st.z - best[1]) * k / n)
        let ok = true
        for (let k = 2; k + 1 < pts.length; k += 2) if (!free(pts[k], pts[k + 1])) { ok = false; break }
        if (ok) {
          pts[0] = best[0]; pts[1] = best[1] // exactly on the existing road
          pts.push(...run(st.x, st.z, [(st.x - best[0]) / L, (st.z - best[1]) / L], 160))
          res.links.push({ id: `${tag}_LINK_${i + 1}`, type: 'dirt', pts }); return
        }
      }
      const back = run(st.x, st.z, [-axis[0], -axis[1]], 160), fwd = run(st.x, st.z, axis, 160), pts: number[] = []
      for (let k = back.length - 2; k >= 0; k -= 2) pts.push(back[k], back[k + 1])
      pts.push(st.x, st.z, ...fwd)
      if (pts.length >= 6) res.links.push({ id: `${tag}_MAIN_${i + 1}`, type: 'dirt', pts })
      else warnings.push('nostreet')
    })
    let reach = 0
    for (let i = 0; i < ring.length; i += 2) for (const st of sites) reach = Math.max(reach, Math.hypot(ring[i] - st.x, ring[i + 1] - st.z) / Math.max(1, sites.length))
    const blocked = world.footprints.map((f) => growBox(boxOf(f), 1))
    const v = settleVillages(sites, [...world.roads, ...res.links], world.waters, zg.heights, zg.grid, { seed: spec.seed, density: spec.density ?? 1, variant: 'auto', maxSlope: 0.2, dropScale: 1.4, polygon: ring, reach: Math.max(80, reach), blocked })
    // safety net: a building outside the zone or on an existing footprint never leaves the Atelier
    res.placed = v.placed.filter((q) => insideRing(ring, q.corners) && !taken.any(boxOf(q.corners)))
    const keptSites = new Set(res.placed.map((q) => q.site))
    res.lanes = v.lanes.filter((l) => keptSites.has(l.id.split('_')[1] ?? ''))
    res.links = res.links.filter((l) => keptSites.has(`${tag}V${l.id.split('_').pop()}`))
    for (const l of [...v.lots, ...v.gardens]) if (keptSites.has(l.site)) yards.push(l.corners)
    res.parcels = (v.parcels ?? []).filter((p) => keptSites.has(p.site))
    for (const g of gardenFences(v)) if (g.pts.length >= 4 && insideRing(ring, g.pts)) res.hedges.push(g.pts)
    sites = sites.filter((st) => keptSites.has(st.id))
    for (const q of res.placed) taken.add(growBox(boxOf(q.corners), 1))
  }
  const allRoads: Road[] = [...world.roads, ...res.lanes, ...res.links]

  // 3. power: a substation per village, LV between villages, MV to the nearest existing pole
  if (spec.power && sites.length) {
    const roadLines = allRoads.filter((r) => r.pts.length >= 4).map((r) => ({ pts: r.pts.length > 4 ? centreLine(r.pts, 4) : r.pts, half: roadHalf(r) }))
    const onRoad = (x: number, z: number, m: number) => roadLines.some((r) => nearestOnRoads([r], x, z)[2] < r.half + m)
    const P = STATION_PREFABS.eden.mvlv, stationBoxes: Box[] = []
    sites.forEach((s, i) => {
      const hs = res.placed.filter((q) => q.site === s.id)
      let cx = s.x, cz = s.z
      if (hs.length) { cx = hs.reduce((a, q) => a + q.x, 0) / hs.length; cz = hs.reduce((a, q) => a + q.z, 0) / hs.length }
      for (let r = 0; r <= 120; r += 4) {
        let done = false
        for (let a = 0; a < 16 && !done; a++) {
          const x = cx + r * Math.cos(a * Math.PI / 8), z = cz + r * Math.sin(a * Math.PI / 8), b: Box = [x - 4, z - 4, x + 4, z + 4]
          if (!pointInPoly(ring, x, z) || wet(x, z) || taken.any(b) || onRoad(x, z, 4)) continue
          stationBoxes.push(b); res.stations.push({ id: `${tag}_PSTA_${i + 1}`, kind: 'mvlv', site: s.id, x, z, yaw: 0, w: P.w, d: P.d, h: P.h, y: ground(x, z), prefab: P.prefab }); done = true
        }
        if (done) break
      }
    })
    if (res.stations.length < sites.length) warnings.push('station')
    const near = (x: number, z: number) => stationBoxes.some((b) => inBox(growBox(b, 6), x, z)) // a line leaves its own pad
    const route = (ax: number, az: number, bx: number, bz: number, kind: 'lv' | 'mv') => {
      const rb = growBox(unionBox([ax, az, ax, az], [bx, bz, bx, bz]), 200)
      const g = cropHeights(H, rb, 1_500_000, 4) // routing only: 4 m cells are plenty (poles are put on the ground by the Workbench)
      return routePowerLine(g.heights, g.grid, ax, az, bx, bz, { kind, roads: roadLines.map((r) => r.pts), isWater: wet, block: (x, z) => !near(x, z) && taken.any([x - 3, z - 3, x + 3, z + 3]) })
    }
    for (let i = 1; i < res.stations.length; i++) {
      const a = res.stations[i], b = res.stations.slice(0, i).reduce((p, q) => (Math.hypot(q.x - a.x, q.z - a.z) < Math.hypot(p.x - a.x, p.z - a.z) ? q : p))
      const l = route(a.x, a.z, b.x, b.z, 'lv')
      if (l) res.power.push({ ...l, id: `${tag}_PWR_LV_${i}` }); else warnings.push('route')
    }
    if (res.stations.length) {
      const st = res.stations[0]
      let bi = -1, bd = POWER_REACH
      for (let i = 0; i + 1 < world.power.length; i += 2) { const d = Math.hypot(world.power[i] - st.x, world.power[i + 1] - st.z); if (d < bd) { bd = d; bi = i } }
      if (bi >= 0) {
        const l = route(st.x, st.z, world.power[bi], world.power[bi + 1], 'mv')
        if (l) res.power.push({ ...l, id: `${tag}_PWR_MV_1` }); else warnings.push('route')
      } else warnings.push('nogrid')
    }
    for (const b of stationBoxes) taken.add(b)
  }

  // 4. fields (and their hedges, dirt tracks) in what the villages left
  const obstacles = [
    ...roadObstacles(allRoads.filter((r) => r.pts.length >= 4).map((r) => ({ pts: r.pts, half: roadHalf(r) })), 4, (x, z) => inBox(growBox(box, 50), x, z)),
    ...[...world.footprints, ...res.placed.map((q) => q.corners), ...yards].map(cornersObstacle).filter((p) => !!p),
    ...lakes.map(flatToPoly).filter((p) => !!p),
    ...roadObstacles(res.power.map((l) => ({ pts: l.path, half: 8 })), 0), // cleared power corridor
  ] as NonNullable<ReturnType<typeof flatToPoly>>[]
  if (spec.fields) {
    const f = fillFieldZone({ zone: ring, seed: spec.seed, prefix: `${tag}_F`, hedgeSeed: spec.seed + 7, obstacles, ok: (x, z) => !wet(x, z) && pointInPoly(ring, x, z) && Math.abs(ground(x + 5, z) - ground(x - 5, z)) < 1.5 && Math.abs(ground(x, z + 5) - ground(x, z - 5)) < 1.5, roads: allRoads.filter((r) => r.pts.length >= 4).map((r) => r.pts) })
    res.fields = f.fields.map((p) => p.slice(0, -1).flat())
    for (const h of f.hedges) res.hedges.push(h.flat())
    f.tracks.forEach((pts, j) => res.links.push({ id: `${tag}_TRACK_${j + 1}`, type: 'dirt', pts }))
  }
  // 5. forest pieces: the zone minus everything above (and the fields)
  if (spec.forest) {
    const fieldPolys = res.fields.map(flatToPoly).filter((p) => !!p) as NonNullable<ReturnType<typeof flatToPoly>>[]
    res.forests = forestPieces(ring, [...obstacles, ...fieldPolys], 2000)
  }
  return res
}
