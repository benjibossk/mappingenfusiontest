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

/**
 * Forests never cover a zone (sawmill, base, depot...). The old test only looked at the outline points, so a
 * forest that swallowed a whole zone kept it (seed 21 live: trees through RP_SAWMILL_1 and MIL_1). Each disc
 * (r + margin) is cut out; a cut that would leave a hole (one ring only per forest) is opened to the nearest
 * edge by a `lane` m clearing, the way a yard in a wood keeps its track. Biggest remaining piece kept.
 */
export function cutDiscs<T extends { pts: number[] }>(patches: T[], discs: { x: number; z: number; r: number }[], margin = 15, lane = 16): T[] {
  const out: T[] = []
  for (const a of patches) {
    const ring: number[][] = []
    for (let i = 0; i + 1 < a.pts.length; i += 2) ring.push([a.pts[i], a.pts[i + 1]])
    if (ring.length < 3) continue
    ring.push(ring[0])
    let f: Feature<Polygon | MultiPolygon> | null = turf.polygon([ring])
    for (const d of discs) {
      if (!f) break
      const R = d.r + margin
      const bb = turf.bbox(f)
      if (d.x + R < bb[0] || d.x - R > bb[2] || d.z + R < bb[1] || d.z - R > bb[3]) continue
      const c: number[][] = []
      for (let k = 0; k <= 24; k++) { const t = (k / 24) * Math.PI * 2; c.push([d.x + Math.cos(t) * R, d.z + Math.sin(t) * R]) }
      c[24] = c[0]
      let cutter: Feature<Polygon | MultiPolygon> = turf.polygon([c])
      // hole? -> add a lane from the disc to the nearest outline point
      if (turf.booleanPointInPolygon([d.x, d.z], f)) {
        let bx = 0, bz = 0, bd = Infinity
        const outer = (f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates).flatMap((p) => p[0])
        for (const [x, z] of outer) { const q = Math.hypot(x - d.x, z - d.z); if (q < bd) { bd = q; bx = x; bz = z } }
        const ux = (bx - d.x) / (bd || 1), uz = (bz - d.z) / (bd || 1), L = bd + 10, h = lane / 2
        const laneP = turf.polygon([[[d.x - uz * h, d.z + ux * h], [d.x - uz * h + ux * L, d.z + ux * h + uz * L], [d.x + uz * h + ux * L, d.z - ux * h + uz * L], [d.x + uz * h, d.z - ux * h], [d.x - uz * h, d.z + ux * h]]])
        cutter = (turf.union(turf.featureCollection([cutter as Feature<Polygon>, laneP])) ?? cutter) as Feature<Polygon | MultiPolygon>
      }
      f = turf.difference(turf.featureCollection([f as Feature<Polygon>, cutter as Feature<Polygon>])) as Feature<Polygon | MultiPolygon> | null
    }
    if (!f) continue
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates
    let best: number[][] | null = null, ba = 0
    for (const p of polys) { let ar = 0; for (let i = 0; i + 1 < p[0].length; i++) ar += p[0][i][0] * p[0][i + 1][1] - p[0][i + 1][0] * p[0][i][1]; ar = Math.abs(ar); if (ar > ba) { ba = ar; best = p[0] } }
    if (!best || best.length < 4) continue
    out.push({ ...a, pts: best.slice(0, -1).flat() })
  }
  return out
}
