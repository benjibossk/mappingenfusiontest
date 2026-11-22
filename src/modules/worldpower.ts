// Random world (worldgen.ts step 9): the hierarchical power planner (powergrid.ts: plants, EHV/HV mesh,
// MV feeders, LV, vanilla transformer stations) fed from the world's sites, roads and zones, the same way
// the Roads tab button does it in main.ts. planGrid has no randomness: same seed -> same world -> same grid.
import type { Grid } from './island'
import { SITE_RADIUS, type Site } from './network'
import type { ZoneItem } from './zones'
import { planGrid, type PowerDistrib, type GridLine, type GridSite, type Station } from './powergrid'
import type { PowerStyle } from './power'
import { centreLine, roadHalf, type Road } from './roads'
import type { Disc, PowerWorld } from './powerroads'
import { dimsFootprint } from '../library/dims'
import { footprintOf } from './industrial'

/** built world for the power planner: road half widths, houses + zone buildings, fenced plots, and no-pole
 *  discs on every bridge deck / overpass (spans, lifts, OSM bridges) */
export function powerWorld(roads: Road[], buildings: number[][], lots: number[][] = [], zones: ZoneItem[] = []): PowerWorld {
  const noPole: Disc[] = []
  for (const r of roads) {
    if (r.pts.length < 4) continue
    const half = roadHalf(r)
    const runs: [number, number][] = [...(r.spans ?? []).map((q) => [q.from, q.to] as [number, number]), ...(r.lift ?? []).map((q) => [q.at - q.flat - q.len * 0.5, q.at + q.flat + q.len * 0.5] as [number, number])]
    if (r.bridge) runs.push([0, Infinity])
    if (!runs.length) continue
    const c = centreLine(r.pts, 5)
    let s = 0
    for (let i = 0; i + 1 < c.length; i += 2) {
      if (i) s += Math.hypot(c[i] - c[i - 2], c[i + 1] - c[i - 1])
      if (runs.some(([a, b]) => s >= a - 5 && s <= b + 5)) noPole.push({ x: c[i], z: c[i + 1], r: half + 6 })
    }
  }
  const zb = zones.flatMap((z) => z.boxes.filter((b) => b.corners.length >= 8).map((b) => b.corners))
  // the buildings of vanilla compositions (RP places, library parcels: one 'area' box only): their real footprint,
  // else a line crosses them (seed 21 live audit: POWER_LV_10 through the RP_DEPOT cow shed, 70 m long)
  const fallback = { minX: 0, maxX: 0, minZ: 0, maxZ: 0, h: 0 }
  for (const z of zones) for (const e of z.entities) {
    if (!/Structures\/(Agriculture|Houses|Industrial|Commercial|Military|Infrastructure\/(Garages|Warehouses))/i.test(e.prefab)) continue
    const f = dimsFootprint(e.prefab, fallback)
    if (f.h < 2.5 || (f.maxX - f.minX) * (f.maxZ - f.minZ) < 12) continue
    zb.push(footprintOf(f, e.x, e.z, e.yaw ?? 0))
  }
  return { roads: roads.filter((r) => r.pts.length >= 4).map((r) => ({ pts: centreLine(r.pts, 8), half: roadHalf(r) })), buildings: [...buildings, ...zb], lots, noPole }
}

export interface WorldPower { lines: GridLine[]; stations: Station[]; access: number[][]; failed: number; unfed: string[]; entrances?: { site: string; x: number; z: number; ug: boolean }[] }

/** airfields / military bases: discs no line or plant may cross (main.ts generatePower, same rule) */
export function zoneAvoid(zones: ZoneItem[]) {
  return zones.filter((z) => z.kind === 'airfield' || z.kind === 'military').map((z) => {
    let r = 60
    for (const b of z.boxes) for (let i = 0; i + 1 < b.corners.length; i += 2) r = Math.max(r, Math.hypot(b.corners[i] - z.x, b.corners[i + 1] - z.z))
    return { x: z.x, z: z.z, r: r + 30 }
  })
}

/** Plan the grid of a generated world. Flattens the station pads in `heights` (in place). */
export function worldPowerGrid(heights: number[] | Float32Array, g: Grid, sites: Site[], zones: ZoneItem[], roads: number[][],
  isWater: (x: number, z: number) => boolean, size: number, style: PowerStyle = 'eden', world?: PowerWorld, distrib: PowerDistrib = 'auto'): WorldPower {
  const gs: GridSite[] = [
    ...sites.map((q) => ({ id: q.id, x: q.x, z: q.z, kind: q.kind as GridSite['kind'], r: SITE_RADIUS[q.kind] })),
    ...zones.filter((z) => z.kind === 'industrial').map((z) => ({ id: z.id, x: z.x, z: z.z, kind: 'industry' as const, r: 100 })),
  ]
  return planGrid({ heights, grid: g, sites: gs, roads, isWater, size, avoid: zoneAvoid(zones), world }, { style, distrib })
}
