// Checks run before sending to the Workbench: things that build fine but look wrong or break in game.
// Each issue has a position so the map can point at it.

import type { Grid } from './island'
import { SITE_RADIUS, maxGrade, worstGrade, type Site } from './network'
import type { Road } from './roads'
import type { Placed } from './settlements'

export interface Issue { kind: 'noBridge' | 'steepRoad' | 'isolated' | 'buildingWet'; x: number; z: number; id: string; value?: number }

// grade limits per road type: maxGrade() in network.ts, the same the auto network routes with

export function validate(o: {
  roads: Road[]
  sites: Site[]
  settled: Placed[]
  refusedGaps: { id: string; from: [number, number]; to: [number, number] }[]
  heights: ArrayLike<number>
  grid: Grid
}): Issue[] {
  const { cols, rows, step } = o.grid
  const at = (x: number, z: number) => {
    const c = Math.min(cols - 1, Math.max(0, Math.round(x / step))), r = Math.min(rows - 1, Math.max(0, Math.round(z / step)))
    return o.heights[r * cols + c]
  }
  const out: Issue[] = []
  for (const g of o.refusedGaps) out.push({ kind: 'noBridge', id: g.id, x: (g.from[0] + g.to[0]) / 2, z: (g.from[1] + g.to[1]) / 2 })
  // grade over 20 m steps, the same measure the auto network routes with (network.ts)
  for (const r of o.roads) {
    if (r.pts.length < 4) continue
    const w = worstGrade(r.pts, o.heights, o.grid, r.spans)
    if (w.grade > maxGrade(r.type)) out.push({ kind: 'steepRoad', id: r.id, x: w.x, z: w.z, value: Math.round(w.grade * 100) })
  }

  // a place no road reaches
  for (const s of o.sites) {
    const reach = SITE_RADIUS[s.kind] * 1.5
    const served = o.roads.some((r) => {
      for (let i = 0; i + 1 < r.pts.length; i += 2) if (Math.hypot(r.pts[i] - s.x, r.pts[i + 1] - s.z) < reach) return true
      return false
    })
    if (!served) out.push({ kind: 'isolated', id: s.id, x: s.x, z: s.z })
  }
  for (const b of o.settled) if (b.ycm === undefined && at(b.x, b.z) < 0.5) // piers (ycm) stand over the water on purpose
    out.push({ kind: 'buildingWet', id: b.id, x: b.x, z: b.z })
  return out
}
