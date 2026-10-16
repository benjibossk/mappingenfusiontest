// Checks run before sending to the Workbench: things that build fine but look wrong or break in game.
// Each issue has a position so the map can point at it.

import type { Grid } from './island'
import { SITE_RADIUS, type Site } from './network'
import { centreLine, type Road, type RoadType } from './roads'
import type { Placed } from './settlements'

export interface Issue { kind: 'noBridge' | 'steepRoad' | 'isolated' | 'buildingWet'; x: number; z: number; id: string; value?: number }

// steepest grade a vehicle copes with, by road family
const MAX_GRADE: Partial<Record<RoadType, number>> = { dirt: 0.2, dirt2: 0.2, forest: 0.22, trailDirt: 0.3, trailGravel: 0.3, trailForest: 0.3 }
const DEFAULT_GRADE = 0.12

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
  // grade over 20 m steps (the grid is coarse: shorter steps only measure noise)
  for (const r of o.roads) {
    if (r.pts.length < 4) continue
    const line = centreLine(r.pts, 20)
    let worst = 0, wx = 0, wz = 0
    for (let i = 2; i + 1 < line.length; i += 2) {
      const d = Math.hypot(line[i] - line[i - 2], line[i + 1] - line[i - 1])
      if (d < 1) continue
      const g = Math.abs(at(line[i], line[i + 1]) - at(line[i - 2], line[i - 1])) / d
      if (g > worst) { worst = g; wx = (line[i] + line[i - 2]) / 2; wz = (line[i + 1] + line[i - 1]) / 2 }
    }
    if (worst > (MAX_GRADE[r.type] ?? DEFAULT_GRADE)) out.push({ kind: 'steepRoad', id: r.id, x: wx, z: wz, value: Math.round(worst * 100) })
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
  for (const b of o.settled) if (at(b.x, b.z) < 0.5) out.push({ kind: 'buildingWet', id: b.id, x: b.x, z: b.z })
  return out
}
