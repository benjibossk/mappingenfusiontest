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
    const polys = w.f.geometry.type === 'Polygon' ? [w.f.geometry.coordinates] : w.f.geometry.coordinates
    for (const pc of polys) out.push({ ...w.src, pts: pc[0].slice(0, -1).flat() })
  }
  return out
}
