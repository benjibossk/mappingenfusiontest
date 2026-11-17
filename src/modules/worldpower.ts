// Random world (worldgen.ts step 9): the hierarchical power planner (powergrid.ts: plants, EHV/HV mesh,
// MV feeders, LV, vanilla transformer stations) fed from the world's sites, roads and zones, the same way
// the Roads tab button does it in main.ts. planGrid has no randomness: same seed -> same world -> same grid.
import type { Grid } from './island'
import { SITE_RADIUS, type Site } from './network'
import type { ZoneItem } from './zones'
import { planGrid, type GridLine, type GridSite, type Station } from './powergrid'
import type { PowerStyle } from './power'

export interface WorldPower { lines: GridLine[]; stations: Station[]; access: number[][]; failed: number; unfed: string[] }

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
  isWater: (x: number, z: number) => boolean, size: number, style: PowerStyle = 'eden'): WorldPower {
  const gs: GridSite[] = [
    ...sites.map((q) => ({ id: q.id, x: q.x, z: q.z, kind: q.kind as GridSite['kind'], r: SITE_RADIUS[q.kind] })),
    ...zones.filter((z) => z.kind === 'industrial').map((z) => ({ id: z.id, x: z.x, z: z.z, kind: 'industry' as const, r: 100 })),
  ]
  return planGrid({ heights, grid: g, sites: gs, roads, isWater, size, avoid: zoneAvoid(zones) }, { style })
}
