// Counts what a generated world puts inside its lake outlines (sites, zone objects, roads, power poles, houses).
import { pointInPoly } from '../../src/modules/industrial.ts'
import { WATER_TYPES } from '../../src/modules/water.ts'
import type { WorldResult } from '../../src/modules/worldgen.ts'

export function lakeHits(w: WorldResult) {
  const lakes = w.waters.filter((x) => WATER_TYPES[x.type].closed).map((x) => x.pts)
  const inLake = (x: number, z: number) => lakes.some((p) => pointInPoly(p, x, z))
  const pts = (p: number[]) => { let n = 0; for (let i = 0; i + 1 < p.length; i += 2) if (inLake(p[i], p[i + 1])) n++; return n }
  const h = {
    sites: w.sites.filter((s) => inLake(s.x, s.z)).length,
    zones: w.zones.filter((z) => inLake(z.x, z.z) || z.entities.some((e) => inLake(e.x, e.z))).length,
    roads: w.roads.filter((r) => !r.bridge && pts(r.pts) > 0).length + w.zones.reduce((n, z) => n + z.roads.filter((r) => pts(r.pts) > 0).length, 0),
    power: w.power.reduce((n, l) => n + pts(l.poles), 0),
    houses: w.settlement.placed.filter((q) => inLake(q.x, q.z)).length,
  }
  return { ...h, total: h.sites + h.zones + h.roads + h.power + h.houses, lakes: lakes.length }
}
