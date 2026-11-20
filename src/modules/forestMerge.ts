// Overlapping forest patches: same species = merged into one wood, otherwise the later patch is cut
// by the earlier one. No criss-crossing outlines, one generator per wood (used by worldgen + the Forests step).
import * as turf from '@turf/turf'
import type { Feature, MultiPolygon, Polygon } from 'geojson'

export function mergeForestPatches<T extends { leaf?: string; pts: number[] }>(patches: T[]): T[] {
  const toF = (pts: number[]) => { const r: number[][] = []; for (let i = 0; i + 1 < pts.length; i += 2) r.push([pts[i], pts[i + 1]]); r.push([pts[0], pts[1]]); return turf.polygon([r]) }
  const woods: { f: Feature<Polygon | MultiPolygon>; src: T }[] = []
  for (const a of patches) {
    if (a.pts.length < 6) continue
    let f: Feature<Polygon | MultiPolygon> = toF(a.pts), gone = false
    for (let i = woods.length - 1; i >= 0; i--) {
      try {
        if (!turf.booleanIntersects(f, woods[i].f)) continue
        if (woods[i].src.leaf === a.leaf) { const u = turf.union(turf.featureCollection([f, woods[i].f])); if (u) { f = u; woods.splice(i, 1) } }
        else { const d = turf.difference(turf.featureCollection([f, woods[i].f])); if (!d) { gone = true; break } f = d }
      } catch { /* degenerate geometry: keep apart */ }
    }
    if (!gone) woods.push({ f, src: a })
  }
  const out: T[] = []
  for (const w of woods) {
    w.f = noHoles(w.f)
    const polys = w.f.geometry.type === 'Polygon' ? [w.f.geometry.coordinates] : w.f.geometry.coordinates
    for (const pc of polys) out.push({ ...w.src, pts: pc[0].slice(0, -1).flat() })
  }
  return out
}

/** an area is one outer ring: a hole (a wood of another species inside, a union around a gap) would be dropped
 *  and the outline drawn over what it held. Each hole is opened by a 1 m slit cut north to the outline. */
function noHoles(f: Feature<Polygon | MultiPolygon>): Feature<Polygon | MultiPolygon> {
  for (let it = 0; it < 12; it++) {
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates
    const hole = polys.find((pc) => pc.length > 1)?.[1]
    if (!hole) return f
    let cx = 0, cz = 0, top = -Infinity
    for (const [x, z] of hole) { cx += x; cz += z }
    cx /= hole.length; cz /= hole.length
    for (const pc of polys) for (const [, z] of pc[0]) top = Math.max(top, z)
    const slit = turf.polygon([[[cx - 0.5, cz], [cx + 0.5, cz], [cx + 0.5, top + 1], [cx - 0.5, top + 1], [cx - 0.5, cz]]])
    try { const d = turf.difference(turf.featureCollection([f, slit])); if (!d) return f; f = d } catch { return f }
  }
  return f
}
