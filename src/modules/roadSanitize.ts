// Road splines sent to the Workbench (RoadGeneratorEntity on a SplineShapeEntity): the generator logs
// "There are N invalid segments" on points too close together, duplicates, hairpins (backtracking point)
// and turns tighter than the road width. sanitizeRoad() removes those interior points; the end points
// are always kept (they are the junction / snap points).
import type { ProjectShape } from '../project'

/** a RoadGeneratorEntity prefab (Prefabs/WEGenerators/Roads/...) */
export const isRoadGenerator = (gen: string) => /\/WEGenerators\/Roads\//i.test(gen) || /\/RG_[^/]*\.et$/i.test(gen)

/** road width of a shape: its RoadWidth param, else a default */
export function roadWidthOf(sh: ProjectShape, def = 6): number {
  const i = sh.paramKeys?.indexOf('RoadWidth') ?? -1
  const w = i >= 0 ? Number(sh.paramValues?.[i]) : NaN
  return Number.isFinite(w) && w > 0 ? w : def
}

/** flat [x,z,...] → cleaned flat [x,z,...]; minimum spacing max(2, width/2), turns <= maxTurnDeg, radius >= width */
export function sanitizeRoad(pts: number[], width = 6, maxTurnDeg = 120): number[] {
  const P: number[][] = []
  for (let k = 0; k + 1 < pts.length; k += 2) P.push([pts[k], pts[k + 1]])
  if (P.length < 2) return pts.slice()
  const minD = Math.max(2, 0.5 * width), cosMax = Math.cos((maxTurnDeg * Math.PI) / 180)
  const dist = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1])
  // 1. spacing: drop interior points too close to the previous kept one; the last point replaces a too close interior one
  let out: number[][] = [P[0]]
  for (let i = 1; i < P.length; i++) {
    const last = i === P.length - 1
    if (dist(P[i], out[out.length - 1]) >= minD) out.push(P[i])
    else if (last) {
      if (out.length > 1) out[out.length - 1] = P[i]
      else if (dist(P[i], out[0]) > 0.01) out.push(P[i]) // a short road: keep both ends
    }
  }
  // 2. backtracking and tight turns: drop the worst interior point, repeat
  for (let guard = 0; guard < 10000 && out.length > 2; guard++) {
    let worst = -1, worstScore = 0
    for (let i = 1; i < out.length - 1; i++) {
      const a = out[i - 1], b = out[i], c = out[i + 1]
      const ux = b[0] - a[0], uz = b[1] - a[1], vx = c[0] - b[0], vz = c[1] - b[1]
      const la = Math.hypot(ux, uz), lb = Math.hypot(vx, vz)
      const cos = (ux * vx + uz * vz) / (la * lb)
      const turn = Math.acos(Math.max(-1, Math.min(1, cos)))
      let score = 0
      if (cos < cosMax) score = 10 + turn // backtracking point
      else if (turn > 1e-3) {
        const radius = Math.min(la, lb) / (2 * Math.tan(turn / 2)) // radius of the arc fitted in the corner
        if (radius < width) score = width / radius
      }
      if (score > worstScore) { worstScore = score; worst = i }
    }
    if (worst < 0) break
    out.splice(worst, 1)
  }
  return out.flatMap((q) => q)
}

/** road-generator shapes: always sent as spline (a RoadGeneratorEntity requires a SplineShapeEntity), points sanitized */
export function sanitizeRoadShape(sh: ProjectShape): ProjectShape {
  if (!isRoadGenerator(sh.generator) || sh.lift?.length) return sh
  return { ...sh, kind: 'spline', points: sanitizeRoad(sh.points, roadWidthOf(sh)).map((v) => Math.round(v * 100) / 100) }
}

/** road mesh height over the ground (m) at each spline point: the RoadEntity is a straight mesh between the points and
 *  the generators keep AdjustHeightMap off, so on a village slope (picture 120 cam 10, 13 %) the 2 m terrain cells rose
 *  through it and the street showed only as the painted Asphalt_01 mask with round grass spots. Arland's roads sit on
 *  ground flattened by the generator; here the mesh is lifted a little instead, points no more than 5 m apart */
export const ROAD_MESH_LIFT = 0.15
const ROAD_LIFT_SPACING = 5
export function liftRoadShape(sh: ProjectShape): ProjectShape {
  if (!isRoadGenerator(sh.generator) || sh.lift?.length || sh.points.length < 4) return sh
  const p = sh.points, out: number[] = []
  for (let i = 0; i + 1 < p.length; i += 2) {
    if (i) {
      const ax = p[i - 2], az = p[i - 1], n = Math.ceil(Math.hypot(p[i] - ax, p[i + 1] - az) / ROAD_LIFT_SPACING)
      for (let k = 1; k < n; k++) out.push(Math.round((ax + ((p[i] - ax) * k) / n) * 100) / 100, Math.round((az + ((p[i + 1] - az) * k) / n) * 100) / 100)
    }
    out.push(p[i], p[i + 1])
  }
  return { ...sh, points: out, lift: out.filter((_, i) => i % 2 === 0).map(() => ROAD_MESH_LIFT) }
}
