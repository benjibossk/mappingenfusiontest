// Pre-send checks that mirror scripts/mg-audit.mjs, run on the project in the app (before /apply):
//   bldgOverlap  two building footprints overlap
//   onRoad       a building / zone object stands on a road carriageway
//   entOutside   a zone object lies outside the map
//   shapeOnRoad  a zone's own street / fence runs along or across another road (>= 6 m inside its carriageway)
//   lampOnRoad   a street lamp stands inside a carriageway (its pole on the road)
//   lampInBuilding a street lamp stands inside a building footprint
//   looseWall    a wall / fence piece placed as a loose object (must be a wall-generator shape, wallRuns.ts)
//   heightRange  the relief spans more than the terrain's 16-bit height range (silently clipped by the engine)
// Each issue can carry a fix: drop the object, or nudge it off the road.
import { polyOverlap } from '../modules/validate'
import { pointInPoly } from '../modules/industrial'
import { isLooseWallPiece } from '../modules/wallRuns'

/** street lamp prefabs (streetLights.ts): exempt from onRoad as road furniture, checked on their own */
export const STREET_LAMP = /LampStreet_E_0[123]_(4m|6m|single)|LampIndustrial_05\.et/

export type PreKind = 'bldgOverlap' | 'onRoad' | 'entOutside' | 'shapeOnRoad' | 'heightRange' | 'lampOnRoad' | 'lampInBuilding' | 'looseWall'
export type Fix = { op: 'drop'; ref: Ref } | { op: 'move'; ref: Ref; dx: number; dz: number }
/** building index in `settled`, or entity index in zone `zone` */
export type Ref = { list: 'settled'; i: number } | { list: 'zone'; zone: number; i: number }
export interface PreIssue { kind: PreKind; id: string; x: number; z: number; value?: number; fix?: Fix }

interface Bldg { id: string; x: number; z: number; prefab: string; corners: number[]; ycm?: number }
interface Ent { id: string; x: number; z: number; prefab: string; ycm?: number }
export interface RoadLine { id: string; half: number; line: number[]; zone?: number } // centre polyline x,z,...; zone: street of that zone (its own props may line it)

// same exclusions as mg-audit: road furniture is meant to stand on / by the road
const ROADSIDE = /Sign|VergePost|CrashBarrier|Barrier|Guard|Bollard|Embankment|Probe|Bridge|Culvert|Crossing|Junction|Marking|Lamp|Pole|Decal|Road/i

function segIndex(roads: RoadLine[], cell = 32) {
  const m = new Map<string, { ax: number; az: number; bx: number; bz: number; r: RoadLine }[]>()
  for (const r of roads) for (let i = 0; i + 3 < r.line.length; i += 2) {
    const ax = r.line[i], az = r.line[i + 1], bx = r.line[i + 2], bz = r.line[i + 3], h = r.half
    for (let cx = Math.floor((Math.min(ax, bx) - h) / cell); cx <= Math.floor((Math.max(ax, bx) + h) / cell); cx++)
      for (let cz = Math.floor((Math.min(az, bz) - h) / cell); cz <= Math.floor((Math.max(az, bz) + h) / cell); cz++) {
        const k = cx + ',' + cz
        let a = m.get(k)
        if (!a) m.set(k, (a = []))
        a.push({ ax, az, bx, bz, r })
      }
  }
  return (x: number, z: number) => m.get(Math.floor(x / cell) + ',' + Math.floor(z / cell)) ?? []
}
/** nearest point of segment ab to p */
function nearest(px: number, pz: number, ax: number, az: number, bx: number, bz: number): [number, number, number] {
  const dx = bx - ax, dz = bz - az, L = dx * dx + dz * dz
  const t = L ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / L)) : 0
  const nx = ax + t * dx, nz = az + t * dz
  return [Math.hypot(px - nx, pz - nz), nx, nz]
}
/** radius of a footprint around its origin */
const radius = (b: Bldg) => {
  let r = 0
  for (let i = 0; i + 1 < b.corners.length; i += 2) r = Math.max(r, Math.hypot(b.corners[i] - b.x, b.corners[i + 1] - b.z))
  return r
}

export function preSendChecks(o: { width: number; height: number; settled: Bldg[]; zones: { id: string; entities: Ent[]; lines?: { id: string; pts: number[]; half: number }[] }[]; roads: RoadLine[] }): PreIssue[] {
  const out: PreIssue[] = []
  const roadAt = segIndex(o.roads)
  // building footprints: spatial hash, pairwise overlap
  const cell = 24, grid = new Map<string, number[]>()
  o.settled.forEach((b, i) => {
    const k = Math.floor(b.x / cell) + ',' + Math.floor(b.z / cell)
    let a = grid.get(k)
    if (!a) grid.set(k, (a = []))
    a.push(i)
  })
  const dropped = new Set<number>()
  o.settled.forEach((a, i) => {
    if (a.ycm != null || a.corners.length < 6) return
    const cx = Math.floor(a.x / cell), cz = Math.floor(a.z / cell)
    for (let gx = cx - 1; gx <= cx + 1; gx++) for (let gz = cz - 1; gz <= cz + 1; gz++) for (const j of grid.get(gx + ',' + gz) ?? []) {
      if (j <= i || dropped.has(j)) continue
      const b = o.settled[j]
      if (b.ycm != null || b.corners.length < 6) continue
      const hit = polyOverlap(a.corners, b.corners)
      if (hit) { dropped.add(j); out.push({ kind: 'bldgOverlap', id: a.id + ' / ' + b.id, x: hit[0], z: hit[1], fix: { op: 'drop', ref: { list: 'settled', i: j } } }) }
    }
  })
  // on a road: footprint corners or origin inside the carriageway; fix = push away along the normal
  const onRoad = (x: number, z: number, pts: number[], prefab: string, ycm: number | undefined, id: string, ref: Ref, extra: number) => {
    if (ycm != null || ROADSIDE.test(prefab) || /^(ROAD|RB|DAM|PSTA_ROAD)/.test(id)) return
    const probes: [number, number][] = [[x, z]]
    for (let i = 0; i + 1 < pts.length; i += 2) probes.push([pts[i], pts[i + 1]])
    for (const [px, pz] of probes) for (const s of roadAt(px, pz)) {
      const [d, nx, nz] = nearest(px, pz, s.ax, s.az, s.bx, s.bz)
      if (d >= s.r.half - 0.3 || (ref.list === 'zone' && s.r.zone === ref.zone)) continue
      // direction from the road axis to the object origin
      const [, ox, oz] = nearest(x, z, s.ax, s.az, s.bx, s.bz)
      let ux = x - ox, uz = z - oz, L = Math.hypot(ux, uz)
      if (L < 0.01) { ux = -(s.bz - s.az); uz = s.bx - s.ax; L = Math.hypot(ux, uz) || 1 }
      ux /= L; uz /= L
      const need = s.r.half + extra + 0.5 - Math.hypot(x - ox, z - oz)
      out.push({ kind: 'onRoad', id: id + ' / ' + s.r.id, x: nx, z: nz, value: Math.round(d * 10) / 10, fix: { op: 'move', ref, dx: ux * need, dz: uz * need } })
      return
    }
  }
  // street lamps: the pole (origin) must stand off the carriageway (fix: pushed 0.8 m past the edge) and off any footprint (fix: dropped)
  const lampCheck = (e: Ent, k: number, i: number) => {
    for (const s of roadAt(e.x, e.z)) {
      const [d] = nearest(e.x, e.z, s.ax, s.az, s.bx, s.bz)
      if (d >= s.r.half) continue
      const [, ox, oz] = nearest(e.x, e.z, s.ax, s.az, s.bx, s.bz)
      let ux = e.x - ox, uz = e.z - oz, L = Math.hypot(ux, uz)
      if (L < 0.01) { ux = -(s.bz - s.az); uz = s.bx - s.ax; L = Math.hypot(ux, uz) || 1 }
      const need = s.r.half + 0.8 - d
      out.push({ kind: 'lampOnRoad', id: e.id + ' / ' + s.r.id, x: e.x, z: e.z, value: Math.round(d * 10) / 10, fix: { op: 'move', ref: { list: 'zone', zone: k, i }, dx: (ux / L) * need, dz: (uz / L) * need } })
      return
    }
    const cx = Math.floor(e.x / cell), cz = Math.floor(e.z / cell)
    for (let gx = cx - 2; gx <= cx + 2; gx++) for (let gz = cz - 2; gz <= cz + 2; gz++) for (const j of grid.get(gx + ',' + gz) ?? []) {
      const b = o.settled[j]
      if (b.corners.length >= 6 && pointInPoly(b.corners, e.x, e.z)) { out.push({ kind: 'lampInBuilding', id: e.id + ' / ' + b.id, x: e.x, z: e.z, fix: { op: 'drop', ref: { list: 'zone', zone: k, i } } }); return }
    }
  }
  o.settled.forEach((b, i) => { if (isLooseWallPiece(b.prefab)) out.push({ kind: 'looseWall', id: b.id, x: b.x, z: b.z, fix: { op: 'drop', ref: { list: 'settled', i } } }) })
  o.settled.forEach((b, i) => { if (!dropped.has(i)) onRoad(b.x, b.z, b.corners, b.prefab, b.ycm, b.id, { list: 'settled', i }, radius(b)) })
  o.zones.forEach((zn, k) => zn.entities.forEach((e, i) => {
    if (e.x < 0 || e.z < 0 || e.x > o.width || e.z > o.height) {
      out.push({ kind: 'entOutside', id: e.id, x: Math.min(Math.max(e.x, 0), o.width), z: Math.min(Math.max(e.z, 0), o.height), fix: { op: 'drop', ref: { list: 'zone', zone: k, i } } })
      return
    }
    if (isLooseWallPiece(e.prefab)) { out.push({ kind: 'looseWall', id: e.id, x: e.x, z: e.z, fix: { op: 'drop', ref: { list: 'zone', zone: k, i } } }); return }
    if (STREET_LAMP.test(e.prefab)) { lampCheck(e, k, i); return }
    // zone props (crates, tanks...): only probe the origin, radius ~1.5 m
    onRoad(e.x, e.z, [], e.prefab, e.ycm, e.id, { list: 'zone', zone: k, i }, 1.5)
  }))
  // zone streets and fences (polylines): a run of >= 6 m inside another road's carriageway; the 15 m at each end
  // are left out (a zone street meets the road there). Seed 21: an industrial cross street and lot fence on an asphalt road.
  o.zones.forEach((zn, k) => (zn.lines ?? []).forEach((l) => {
    let tot = 0
    for (let i = 0; i + 3 < l.pts.length; i += 2) tot += Math.hypot(l.pts[i + 2] - l.pts[i], l.pts[i + 3] - l.pts[i + 1])
    let acc = 0, run = 0
    for (let i = 0; i + 3 < l.pts.length; i += 2) {
      const ax = l.pts[i], az = l.pts[i + 1], dx = l.pts[i + 2] - ax, dz = l.pts[i + 3] - az, L = Math.hypot(dx, dz)
      for (let t = 0; t < L; t += 2, acc += 2) {
        const x = ax + (dx * t) / L, z = az + (dz * t) / L
        const hit = acc > 15 && acc < tot - 15 ? roadAt(x, z).find((s) => s.r.zone !== k && nearest(x, z, s.ax, s.az, s.bx, s.bz)[0] < s.r.half + l.half - 0.3) : undefined
        run = hit ? run + 1 : 0
        if (run === 3) { out.push({ kind: 'shapeOnRoad', id: l.id + ' / ' + hit!.r.id, x, z }); return }
      }
    }
  }))
  return out
}

/** apply fixes in place; drops last (highest index first) so indices stay valid. Returns the count applied. */
export function applyFixes(fixes: Fix[], settled: Bldg[], zones: { entities: Ent[] }[]): number {
  let n = 0
  for (const f of fixes) if (f.op === 'move') {
    const o = f.ref.list === 'settled' ? settled[f.ref.i] : zones[f.ref.zone]?.entities[f.ref.i]
    if (!o) continue
    o.x += f.dx; o.z += f.dz
    const c = (o as Partial<Bldg>).corners
    if (c) for (let i = 0; i + 1 < c.length; i += 2) { c[i] += f.dx; c[i + 1] += f.dz }
    n++
  }
  const drops = fixes.filter((f) => f.op === 'drop').map((f) => f.ref)
  const s = [...new Set(drops.filter((r) => r.list === 'settled').map((r) => r.i))].sort((a, b) => b - a)
  for (const i of s) { settled.splice(i, 1); n++ }
  const zd = new Map<number, Set<number>>()
  for (const r of drops) if (r.list === 'zone') { if (!zd.has(r.zone)) zd.set(r.zone, new Set()); zd.get(r.zone)!.add(r.i) }
  for (const [k, set] of zd) for (const i of [...set].sort((a, b) => b - a)) { zones[k]?.entities.splice(i, 1); n++ }
  return n
}

/** the lines a zone lays itself: its streets (half width) and its fence / wall polylines (0.3 m) */
export function zoneLines(zn: { roads: { id: string; pts: number[]; width?: number }[]; shapes: { id: string; kind?: string; points?: number[]; closed?: boolean }[] }, half: (r: never) => number): { id: string; pts: number[]; half: number }[] {
  const roadIds = new Set(zn.roads.map((r) => r.id))
  return [
    ...zn.roads.filter((r) => r.pts.length >= 4).map((r) => ({ id: r.id, pts: r.pts, half: half(r as never) })),
    ...zn.shapes.filter((s) => s.kind === 'polyline' && /fence|wall/i.test(s.id) && !roadIds.has(s.id) && (s.points?.length ?? 0) >= 4)
      .map((s) => ({ id: s.id, pts: s.closed ? [...s.points!, s.points![0], s.points![1]] : s.points!, half: 0.3 })),
  ]
}

/** Enfusion terrain heights are u16 * heightScale + heightOffset: 65535 steps. Default "Height scale"
 *  of the Create terrain dialog is 0.03125 m (~2048 m available). */
export const DEFAULT_HEIGHT_SCALE = 0.03125

/** Relief vs the terrain's available height range. `range` (absolute min / max in m) when the target
 *  terrain is known, else only the span is checked against 65535 * `scale`. One issue, at the
 *  highest point, value = metres over the range. */
export function heightRangeCheck(heights: ArrayLike<number>, grid: { cols: number; step: number; minX?: number; minZ?: number }, scale = DEFAULT_HEIGHT_SCALE, range?: { min: number; max: number }): PreIssue[] {
  let lo = Infinity, hi = -Infinity, at = 0
  for (let i = 0; i < heights.length; i++) { const h = heights[i]; if (h < lo) lo = h; if (h > hi) { hi = h; at = i } }
  if (!(hi >= lo)) return []
  let over = hi - lo - 65535 * scale
  if (range) over = Math.max(over, range.min - lo, hi - range.max)
  if (over <= 0) return []
  const x = (grid.minX ?? 0) + (at % grid.cols) * grid.step, z = (grid.minZ ?? 0) + Math.floor(at / grid.cols) * grid.step
  return [{ kind: 'heightRange', id: `${Math.round(lo)}..${Math.round(hi)} m`, x, z, value: Math.round(over) }]
}
