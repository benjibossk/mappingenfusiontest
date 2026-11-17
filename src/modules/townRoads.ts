// Town generator helpers: existing roads crossing the town become part of its street network.
// - roadSeeds: Voronoi seed PAIRS mirrored across each road inside the zone, so the bisector between
//   the two cells of a pair (= a cell edge) lies on the road;
// - snapToRoads: graph vertices close to a road are moved onto its centre line;
// - roadEdge: a cell edge whose both ends and midpoint are on the same road IS that road
//   (no new lane drawn, cheap for the main-street search, houses face it with its own setback).
// Pure, no UI.

import type { Line } from './settlements'
import { lineDist } from './settlements'
import { nearestOn } from './villageStreets'

export const ROAD_SEED_STEP = 64 // m between seed pairs along a road
export const ROAD_SEED_OFF = 32 // m from the road to each seed of a pair
export const ROAD_SNAP = 12 // m: vertices closer than this to a road go onto it

/** Seed pairs [x, z] mirrored across the roads, only where both seeds are usable. */
export function roadSeeds(roads: Line[], ok: (x: number, z: number) => boolean, avoid: number[][]): number[][] {
  const out: number[][] = []
  const far = (x: number, z: number) => [...avoid, ...out].every((s) => Math.hypot(s[0] - x, s[1] - z) > ROAD_SEED_OFF * 1.4)
  for (const l of roads) {
    const p = l.pts
    let carry = ROAD_SEED_STEP / 2
    for (let i = 0; i + 3 < p.length; i += 2) {
      const ax = p[i], az = p[i + 1], dx = p[i + 2] - ax, dz = p[i + 3] - az, L = Math.hypot(dx, dz)
      if (L < 1e-6) continue
      const ux = dx / L, uz = dz / L
      let t = carry
      for (; t < L; t += ROAD_SEED_STEP) {
        const x = ax + ux * t, z = az + uz * t
        const off = ROAD_SEED_OFF + l.half
        const a = [x - uz * off, z + ux * off], b = [x + uz * off, z - ux * off]
        if (ok(a[0], a[1]) && ok(b[0], b[1]) && far(a[0], a[1]) && far(b[0], b[1])) out.push(a, b)
      }
      carry = t - L // distance still to walk on the next segments
    }
  }
  return out
}

/** Moves the vertices (flat x,z array) within ROAD_SNAP of a road onto it; returns the snapped vertex ids -> road index. */
export function snapToRoads(V: number[], roads: Line[]): Map<number, number> {
  const on = new Map<number, number>()
  for (let i = 0; i < V.length; i += 2) {
    let best = -1, bd = ROAD_SNAP, bx = 0, bz = 0
    roads.forEach((l, ri) => {
      if (V[i] < l.minX - ROAD_SNAP || V[i] > l.maxX + ROAD_SNAP || V[i + 1] < l.minZ - ROAD_SNAP || V[i + 1] > l.maxZ + ROAD_SNAP) return
      const [px, pz, d] = nearestOn(l.pts, V[i], V[i + 1])
      if (d < bd) { bd = d; best = ri; bx = px; bz = pz }
    })
    if (best >= 0) { V[i] = bx; V[i + 1] = bz; on.set(i / 2, best) }
  }
  return on
}

/** Road index when the edge a-b runs along that road (both ends snapped to it, midpoint on it), else -1. */
export function roadEdge(on: Map<number, number>, roads: Line[], ax: number, az: number, bx: number, bz: number, a: number, b: number): number {
  const ra = on.get(a), rb = on.get(b)
  if (ra === undefined || ra !== rb) return -1
  const l = roads[ra]
  return lineDist(l.pts, (ax + bx) / 2, (az + bz) / 2) < Math.max(3, l.half) ? ra : -1
}
