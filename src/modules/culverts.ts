// PLAN_RESTANT #15: short bridges where a road crosses a small stream.
// The narrow streams of the hydro raster (strength below STREAM.narrow, one or two grid cells) are not water
// polygons, so splitAtWater leaves no gap there and nothing marked the crossing. Vanilla has no culvert
// prefab (only DrainChannel decals): the crossing gets the shortest vanilla deck by road width through
// planBridge (BridgeConcrete_E_01_small 13 m x 4.6 m for tracks / narrow roads, ConcreteBridge_01 Narrow
// 13 m or Wide 26 m otherwise), laid level with the road bed (which stays filled across the stream).
import { centreLine, roadHalf, type Road } from './roads'
import { arcLength } from './roadgeom'
import { planBridge, STREAM } from './bridges'
import type { Grid } from './island'
import type { ProjectEntity } from '../project'

export interface Culvert { id: string; road: string; x: number; z: number; width: number; prefabs: string[] }

//! Road crossings of narrow streams: river strength in [minStrength, STREAM.narrow). heightAt: road bed height
//! (carved terrain). A crossing inside a valley bridge span or near another culvert (< 15 m) is skipped.
export function streamCulverts(roads: Road[], river: ArrayLike<number> | undefined, g: Grid, heightAt: (x: number, z: number) => number, o: { minStrength?: number } = {}): { entities: ProjectEntity[]; culverts: Culvert[] } {
  const entities: ProjectEntity[] = [], culverts: Culvert[] = []
  if (!river) return { entities, culverts }
  const minS = o.minStrength ?? 0.05
  const strength = (x: number, z: number) => {
    const c = Math.round((x - g.minX) / g.step), r = Math.round((z - g.minZ) / g.step)
    return c < 0 || r < 0 || c >= g.cols || r >= g.rows ? 0 : river[r * g.cols + c]
  }
  const stream = (x: number, z: number) => { const s = strength(x, z); return s >= minS && s < STREAM.narrow }
  for (const road of roads) {
    if (road.pts.length < 4 || road.bridge) continue
    const line = centreLine(road.pts, 2), n = line.length / 2
    if (n < 3) continue
    const arc = arcLength(line)
    // spans are measured along centreLine(pts, 5): same arc length, close enough at 2 m sampling
    const inSpan = (s: number) => (road.spans ?? []).some((sp) => s > sp.from - 10 && s < sp.to + 10)
    let i = 0
    while (i < n) {
      if (!stream(line[i * 2], line[i * 2 + 1])) { i++; continue }
      let j = i
      while (j + 1 < n && stream(line[j * 2 + 2], line[j * 2 + 3])) j++
      // the bed of a road starting / ending in the stream is not a crossing
      const a = Math.max(0, i - 1), b = Math.min(n - 1, j + 1)
      const mx = (line[a * 2] + line[b * 2]) / 2, mz = (line[a * 2 + 1] + line[b * 2 + 1]) / 2
      const width = arc[b] - arc[a]
      i = j + 1
      if (a === 0 || b === n - 1 || width > 40 || inSpan((arc[a] + arc[b]) / 2)) continue
      if (culverts.some((c) => Math.hypot(c.x - mx, c.z - mz) < 15)) continue
      // the run of stream cells overstates the bed by about one grid cell (nearest-cell lookup): span = run - step
      const span = Math.max(3, width - g.step), ux = (line[b * 2] - line[a * 2]) / (width || 1), uz = (line[b * 2 + 1] - line[a * 2 + 1]) / (width || 1)
      const pa: [number, number] = [mx - (ux * span) / 2, mz - (uz * span) / 2], pb: [number, number] = [mx + (ux * span) / 2, mz + (uz * span) / 2]
      const top = Math.max(heightAt(pa[0], pa[1]), heightAt(pb[0], pb[1])) + 0.05
      const id = `${road.id}_CULVERT${culverts.length}`
      const plan = planBridge(id, pa, pb, top, roadHalf(road), heightAt, { over: 3 })
      entities.push(...plan.entities)
      culverts.push({ id, road: road.id, x: Math.round(mx * 100) / 100, z: Math.round(mz * 100) / 100, width: Math.round(span * 10) / 10, prefabs: plan.pieces })
    }
  }
  return { entities, culverts }
}
