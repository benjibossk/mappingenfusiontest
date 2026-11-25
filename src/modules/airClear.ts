// Airfield integration: the base is built INTO the world, not drawn on top of it. Everything the app holds
// inside its footprint (fence + flattened ground + embankments + margin) is removed or adapted:
//   houses / farms / props / RP sites -> removed; field plots, forests, riparian bands -> clipped to outside;
//   hedges, fences, lanes, tracks -> cut at the footprint; through roads and power lines -> rerouted around the
//   perimeter; small streams -> rerouted around; a road and a supply line are run to the gate.
// Villages, lakes, big rivers and other big sites are NOT removable: airfieldConflicts() reports them, the
// placement is refused or moved (snapAirfield). Pure (no DOM): shared by the app (main.ts) and worldgen.ts.

import * as turf from '@turf/turf'
import type { Feature, MultiPolygon, Polygon } from 'geojson'
import { boxCorners, fwd, right, type Box } from './gen-common'
import { POWER_DEFAULTS, placePoles, type PowerLine } from './power'
import { roadHalf, type Road, type RoadType } from './roads'
import type { Site } from './network'
import { SITE_RADIUS } from './network'
import type { Placed, Square } from './settlements'
import type { Station } from './powergrid'
import type { VillageParcel } from './village'
import { WATER_TYPES, type Water } from './water'
import type { ZoneItem } from './zones'
import type { ProjectShape } from '../project'

/** footprint margin (m) beyond the site box (fence + flatten falloff) */
export const AIR_MARGIN = 10
/** an open water wider than this (m) cannot be rerouted: the airfield moves instead */
export const AIR_BIG_RIVER = 8

type Pt = [number, number]
export interface ClearArea { id: string; kind: string; pts: number[]; holes?: number[][] }
export interface ClearCampaign { fields: number[][][]; hedges: number[][][]; shapes: ProjectShape[]; crops?: string[] }
/** the world layers the clearing reads and edits IN PLACE (arrays are spliced, objects mutated) */
export interface ClearWorld {
  roads: Road[]
  lanes?: Road[]
  paths?: Road[]
  squares?: Square[]
  gardens?: { site: string; corners: number[] }[]
  settled?: Placed[]
  parcels?: VillageParcel[]
  fences?: VillageParcel[]
  sites?: Site[]
  power?: (PowerLine & { id: string })[]
  stations?: Station[]
  access?: number[][]
  areas?: ClearArea[]
  campaign?: ClearCampaign | null
  countryside?: number[][]
  riparian?: { pts: number[] }[]
  zones?: ZoneItem[]
  waters?: Water[]
}
export interface ClearReport {
  houses: number; sites: string[]; props: number; fields: number; hedges: number; forests: number
  roadsCut: number; roadsRerouted: number; accessRoad: boolean; power: number; powerRerouted: number; supply: boolean; streams: number; zones: number
}

// --- footprint -------------------------------------------------------------------------------------------

/** the airfield's site box (+ margin): from the zone record, or rebuilt from its 'area' box corners (old saves) */
export function airFootprint(zn: Pick<ZoneItem, 'boxes'> & { site?: Box }, margin = AIR_MARGIN): Box | null {
  let b = zn.site
  if (!b) {
    const c = zn.boxes.find((q) => q.role === 'area')?.corners
    if (!c || c.length < 8) return null
    const x = (c[0] + c[2] + c[4] + c[6]) / 4, z = (c[1] + c[3] + c[5] + c[7]) / 4
    // boxCorners order: corners 0->1 along the right axis (width), 1->2 along the forward axis (depth)
    const w = Math.hypot(c[2] - c[0], c[3] - c[1]), d = Math.hypot(c[4] - c[2], c[5] - c[3])
    const yaw = (Math.atan2(c[4] - c[2], c[5] - c[3]) * 180) / Math.PI
    b = { x, z, hw: w / 2, hd: d / 2, yaw }
  }
  return { ...b, hw: b.hw + margin, hd: b.hd + margin }
}

const local = (b: Box, x: number, z: number): Pt => {
  const [rx, rz] = right(b.yaw), [fx, fz] = fwd(b.yaw), dx = x - b.x, dz = z - b.z
  return [dx * rx + dz * rz, dx * fx + dz * fz]
}
const world = (b: Box, lx: number, lz: number): Pt => {
  const [rx, rz] = right(b.yaw), [fx, fz] = fwd(b.yaw)
  return [b.x + lx * rx + lz * fx, b.z + lx * rz + lz * fz]
}
export const inFoot = (b: Box, x: number, z: number, pad = 0) => { const [u, v] = local(b, x, z); return Math.abs(u) <= b.hw + pad && Math.abs(v) <= b.hd + pad }
const grow = (b: Box, d: number): Box => ({ ...b, hw: b.hw + d, hd: b.hd + d })
const boxPoly = (b: Box) => { const c = boxCorners(b), r: number[][] = []; for (let i = 0; i < 8; i += 2) r.push([c[i], c[i + 1]]); r.push(r[0]); return turf.polygon([r]) }

/** splits a flat polyline at the box border: runs flagged inside / outside, border points inserted */
export function splitAtBox(pts: number[], b: Box): { pts: number[]; inside: boolean }[] {
  const out: { pts: number[]; inside: boolean }[] = []
  const push = (x: number, z: number, inside: boolean) => {
    let cur = out[out.length - 1]
    if (!cur || cur.inside !== inside) {
      const last = cur?.pts.slice(-2)
      cur = { pts: last ? [...last] : [], inside }
      out.push(cur)
    }
    const n = cur.pts.length
    if (n >= 2 && Math.abs(cur.pts[n - 2] - x) < 1e-6 && Math.abs(cur.pts[n - 1] - z) < 1e-6) return
    cur.pts.push(x, z)
  }
  if (pts.length < 2) return out
  push(pts[0], pts[1], inFoot(b, pts[0], pts[1], -1e-6)) // a vertex ON the border is outside
  for (let i = 0; i + 3 < pts.length; i += 2) {
    const [ax, az] = local(b, pts[i], pts[i + 1]), [bx, bz] = local(b, pts[i + 2], pts[i + 3])
    // Liang-Barsky in the box frame
    let t0 = 0, t1 = 1
    const dx = bx - ax, dz = bz - az
    let hit = true
    for (const [p, q] of [[-dx, ax + b.hw], [dx, b.hw - ax], [-dz, az + b.hd], [dz, b.hd - az]] as Pt[]) {
      if (p === 0) { if (q < 0) { hit = false; break } continue }
      const r = q / p
      if (p < 0) { if (r > t1) { hit = false; break } if (r > t0) t0 = r } else { if (r < t0) { hit = false; break } if (r < t1) t1 = r }
    }
    const P = (t: number): Pt => [pts[i] + (pts[i + 2] - pts[i]) * t, pts[i + 1] + (pts[i + 3] - pts[i + 1]) * t]
    if (hit && t1 > t0) {
      if (t0 > 0) { const [x, z] = P(t0); push(x, z, false); push(x, z, true) }
      if (t1 < 1) { const [x, z] = P(t1); push(x, z, true); push(x, z, false) }
    }
    push(pts[i + 2], pts[i + 3], inFoot(b, pts[i + 2], pts[i + 3], -1e-6))
  }
  // a border point shared by both runs belongs to the outside one too: drop degenerate runs
  // a run inside by a rounding hair (a line already cut ON the border) is no crossing: merged with its neighbours
  const merged: { pts: number[]; inside: boolean }[] = []
  for (const r of out.filter((q) => q.pts.length >= 4)) {
    const inside = r.inside && polyLen(r.pts) > 0.5
    const last = merged[merged.length - 1]
    if (last && !last.inside && !inside) last.pts.push(...r.pts.slice(2))
    else merged.push({ pts: r.pts, inside })
  }
  return merged
}
const polyLen = (p: number[]) => { let s = 0; for (let i = 0; i + 3 < p.length; i += 2) s += Math.hypot(p[i + 2] - p[i], p[i + 3] - p[i + 1]); return s }

/** path around the box (grown by `off`) from border point A to border point B, the shorter way, corners chamfered */
export function detour(b: Box, ax: number, az: number, bx: number, bz: number, off: number): number[] {
  const g = grow(b, off), W = g.hw, D = g.hd, P = 4 * (W + D)
  // perimeter parameter of a local point projected on the grown rectangle
  const param = (u: number, v: number): number => {
    const du = W - Math.abs(u), dv = D - Math.abs(v)
    if (du < dv) return u > 0 ? (v + D) : 2 * D + 2 * W + (D - v) // right side up / left side down
    return v > 0 ? 2 * D + (W - u) : 4 * D + 2 * W + (u + W) // top leftwards / bottom rightwards
  }
  // perimeter walk: right side (u=W) v:-D->D, top (v=D) u:W->-W, left (u=-W) v:D->-D, bottom (v=-D) u:-W->W
  const at = (s: number): Pt => {
    s = ((s % P) + P) % P
    if (s < 2 * D) return [W, -D + s]
    s -= 2 * D; if (s < 2 * W) return [W - s, D]
    s -= 2 * W; if (s < 2 * D) return [-W, D - s]
    s -= 2 * D; return [-W + s, -D]
  }
  const corners = [2 * D, 2 * D + 2 * W, 4 * D + 2 * W, 0]
  const [au, av] = local(b, ax, az), [bu, bv] = local(b, bx, bz)
  const sa = param(au, av), sb = param(bu, bv)
  const fwdLen = (((sb - sa) % P) + P) % P, dir = fwdLen <= P / 2 ? 1 : -1, len = dir > 0 ? fwdLen : P - fwdLen
  const out: number[] = []
  const add = (u: number, v: number) => { const [x, z] = world(b, u, v); out.push(Math.round(x * 100) / 100, Math.round(z * 100) / 100) }
  add(...at(sa))
  const ch = Math.min(30, W / 3, D / 3)
  const pass: number[] = []
  for (const c of corners) { const d = dir > 0 ? (((c - sa) % P) + P) % P : (((sa - c) % P) + P) % P; if (d > 1e-6 && d < len - 1e-6) pass.push(d) }
  pass.sort((x, y) => x - y)
  for (const d of pass) { if (d - ch > 0) add(...at(sa + dir * (d - ch))); if (d + ch < len) add(...at(sa + dir * (d + ch))) }
  add(...at(sb))
  return out
}

/** a polyline from A to B that stays out of the box (straight, or around it) */
function pathAround(b: Box, ax: number, az: number, bx: number, bz: number, off: number): number[] {
  const runs = splitAtBox([ax, az, bx, bz], grow(b, off / 2))
  if (!runs.some((r) => r.inside)) return [ax, az, bx, bz]
  const first = runs[0], last = runs[runs.length - 1]
  const pa = first.inside ? [ax, az] : first.pts.slice(-2), pb = last.inside ? [bx, bz] : last.pts.slice(0, 2)
  const d = detour(b, pa[0], pa[1], pb[0], pb[1], off)
  return [...(first.inside ? [] : [ax, az]), ...d, ...(last.inside ? [] : [bx, bz])]
}

// --- polygons --------------------------------------------------------------------------------------------

type Poly = Feature<Polygon | MultiPolygon>
const ringsOf = (flat: number[]) => { const r: number[][] = []; for (let i = 0; i + 1 < flat.length; i += 2) r.push([flat[i], flat[i + 1]]); if (r.length) r.push([...r[0]]); return r }
const toFlat = (ring: number[][]) => ring.slice(0, -1).flatMap((q) => [Math.round(q[0] * 100) / 100, Math.round(q[1] * 100) / 100])
const touches = (b: Box, flat: number[]) => {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity
  for (let i = 0; i + 1 < flat.length; i += 2) { x0 = Math.min(x0, flat[i]); x1 = Math.max(x1, flat[i]); z0 = Math.min(z0, flat[i + 1]); z1 = Math.max(z1, flat[i + 1]) }
  const R = Math.hypot(b.hw, b.hd)
  return !(x0 > b.x + R || x1 < b.x - R || z0 > b.z + R || z1 < b.z - R)
}
/** a flat ring (with holes) minus the box: the pieces left, each { pts, holes } (null = untouched) */
export function cutPoly(flat: number[], holes: number[][] | undefined, b: Box, minArea = 200): { pts: number[]; holes: number[][] }[] | null {
  if (flat.length < 6 || !touches(b, flat)) return null
  let inside = false
  for (let i = 0; i + 1 < flat.length && !inside; i += 2) inside = inFoot(b, flat[i], flat[i + 1], -0.5) // on the border = already cut
  if (!inside) {
    // no vertex inside: still crossed when an edge or a box corner is
    const c = boxCorners(grow(b, -0.5))
    const shape = turf.polygon([ringsOf(flat)])
    for (let i = 0; i < 8 && !inside; i += 2) inside = turf.booleanPointInPolygon([c[i], c[i + 1]], shape)
    if (!inside) inside = splitAtBox([...flat, flat[0], flat[1]], grow(b, -0.5)).some((r) => r.inside)
    if (!inside) return null
  }
  let shape: Poly | null
  try { shape = turf.polygon([ringsOf(flat), ...(holes ?? []).filter((h) => h.length >= 6).map(ringsOf)]) } catch { return [] }
  try { shape = turf.difference(turf.featureCollection([shape, boxPoly(b)])) } catch { return [] }
  if (!shape) return []
  const polys = shape.geometry.type === 'Polygon' ? [shape.geometry.coordinates] : shape.geometry.coordinates
  return polys.filter((p) => Math.abs(ringArea(p[0])) >= minArea).map((p) => ({ pts: toFlat(p[0]), holes: p.slice(1).map(toFlat) }))
}
const ringArea = (r: number[][]) => { let s = 0; for (let i = 0; i + 1 < r.length; i++) s += r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1]; return s / 2 }

const replace = <T>(arr: T[] | undefined, next: T[]) => { if (arr && arr !== next) arr.splice(0, arr.length, ...next) }

// --- conflicts, cost -------------------------------------------------------------------------------------

export interface AirConflict { kind: 'village' | 'lake' | 'river' | 'zone' | 'sea'; id: string }
/** what an airfield cannot be built on: villages (not farms), lakes, big rivers, other big sites, the sea */
export function airfieldConflicts(b: Box, w: Pick<ClearWorld, 'sites' | 'waters' | 'zones'>, opt: { self?: string; dry?: (x: number, z: number) => boolean } = {}): AirConflict[] {
  const out: AirConflict[] = []
  for (const s of w.sites ?? []) {
    if (s.id.startsWith('FARM_')) continue
    const [u, v] = local(b, s.x, s.z), dx = Math.max(0, Math.abs(u) - b.hw), dz = Math.max(0, Math.abs(v) - b.hd)
    if (Math.hypot(dx, dz) < SITE_RADIUS[s.kind] * (s.kind === 'hamlet' ? 0.6 : 0.8)) out.push({ kind: 'village', id: s.id })
  }
  for (const wt of w.waters ?? []) {
    const closed = WATER_TYPES[wt.type]?.closed
    if (closed) { if (cutPoly(wt.pts, undefined, b, 0)?.length !== undefined) out.push({ kind: 'lake', id: wt.id }) }
    else if (wt.width >= AIR_BIG_RIVER && splitAtBox(wt.pts, b).some((r) => r.inside)) out.push({ kind: 'river', id: wt.id })
  }
  for (const z of w.zones ?? []) {
    if (z.id === opt.self) continue
    const big = z.kind === 'military' || z.kind === 'industrial' || z.kind === 'airfield' || !!z.dam || !!z.harbour // small sites (RP places, vanilla bus stops...) are cleared instead
    if (!big) continue
    if (z.boxes.some((q) => { for (let i = 0; i + 1 < q.corners.length; i += 2) if (inFoot(b, q.corners[i], q.corners[i + 1])) return true; return false })
      || inFoot(b, z.x, z.z)) out.push({ kind: 'zone', id: z.id })
  }
  if (opt.dry) {
    let wet = 0, n = 0
    for (let v = -b.hd; v <= b.hd; v += 40) for (let u = -b.hw; u <= b.hw; u += 40) { n++; const [x, z] = world(b, u, v); if (!opt.dry(x, z)) wet++ }
    if (wet / Math.max(1, n) > 0.02) out.push({ kind: 'sea', id: 'sea' })
  }
  return out
}

/** destruction a footprint would cause (0 = virgin ground): houses, farms, road / stream / power crossings */
export function airfieldCost(b: Box, w: ClearWorld): number {
  let c = 0
  for (const p of w.settled ?? []) if (inFoot(b, p.x, p.z)) c += 1
  for (const s of w.sites ?? []) if (inFoot(b, s.x, s.z)) c += 8
  const cross = (pts: number[]) => splitAtBox(pts, b).filter((r) => r.inside).length
  for (const r of w.roads) c += cross(r.pts) * (r.type.startsWith('trail') || r.type === 'forest' ? 1 : 4)
  for (const wt of w.waters ?? []) if (!WATER_TYPES[wt.type]?.closed) c += cross(wt.pts) * 5
  for (const l of w.power ?? []) c += cross(l.path) * 2
  return c
}

// --- clearing --------------------------------------------------------------------------------------------

const THROUGH: Partial<Record<RoadType, true>> = { asphalt: true, asphaltLine: true, asphaltNarrow: true, asphalt2: true, asphalt3: true, cobble: true, cobbleRough: true, concrete: true, concreteLine: true, concreteNarrow: true, dirt: true, dirt2: true, motorway: true }
const stripArc = (r: Road): Road => { const { spans: _s, lift: _l, median: _m, ...rest } = r as Road & { lift?: unknown; median?: unknown }; void _s; void _l; void _m; return rest as Road }

/** a polyline cut / rerouted around the box: through runs detoured when `reroute`, other inside runs dropped */
function clipLine(pts: number[], b: Box, reroute: boolean, off: number, minLen = 15): { parts: number[][]; rerouted: boolean; cut: boolean } {
  const runs = splitAtBox(pts, b)
  if (!runs.some((r) => r.inside)) return { parts: [pts], rerouted: false, cut: false }
  const parts: number[][] = []
  let cur: number[] | null = null, rerouted = false
  for (let k = 0; k < runs.length; k++) {
    const r = runs[k]
    if (!r.inside) { cur = cur ? [...cur, ...r.pts.slice(2)] : r.pts.slice(); continue }
    const through = reroute && k > 0 && k < runs.length - 1 && cur
    if (through) {
      const a = cur!.slice(-2), e = runs[k + 1].pts.slice(0, 2)
      cur = [...cur!.slice(0, -2), ...detour(b, a[0], a[1], e[0], e[1], off)]
      runs[k + 1] = { ...runs[k + 1], pts: [0, 0, ...runs[k + 1].pts.slice(2)] } // its border point is replaced by the detour end
      rerouted = true
    } else { if (cur) parts.push(cur); cur = null }
  }
  if (cur) parts.push(cur)
  return { parts: parts.filter((p) => p.length >= 4 && polyLen(p) >= minLen), rerouted, cut: true }
}

/** removes / adapts everything of `w` inside the airfield footprint. Mutates `w` in place. */
/** drops the other zones' entities and the settled buildings standing on road `r` (half width + 0.5 m) */
function clearAlong(w: ClearWorld, self: string, r: Road, rep: ClearReport) {
  const lim = roadHalf(r) + 0.5
  if (w.zones) for (const z of w.zones) if (z.id !== self) {
    const keep = z.entities.filter((e) => lineDist(r.pts, e.x, e.z) >= lim)
    if (keep.length !== z.entities.length) { z.entities = keep; rep.zones++ }
  }
  if (w.settled) replace(w.settled, w.settled.filter((q) => lineDist(r.pts, q.x, q.z) >= lim))
}

export function clearAirfield(w: ClearWorld, zn: ZoneItem & { site?: Box }, o: { accessType?: RoadType } = {}): ClearReport {
  const rep: ClearReport = { houses: 0, sites: [], props: 0, fields: 0, hedges: 0, forests: 0, roadsCut: 0, roadsRerouted: 0, accessRoad: false, power: 0, powerRerouted: 0, supply: false, streams: 0, zones: 0 }
  const b = airFootprint(zn)
  if (!b) return rep
  const own = (id: string) => id.startsWith(zn.id + '_')
  // farms and hamlets on the footprint: the whole place goes (its buildings, lanes, parcels)
  const goneSites = new Set((w.sites ?? []).filter((s) => inFoot(b, s.x, s.z) && (s.id.startsWith('FARM_') || s.kind === 'hamlet')).map((s) => s.id))
  rep.sites = [...goneSites]
  replace(w.sites, (w.sites ?? []).filter((s) => !goneSites.has(s.id)))
  // buildings, squares, gardens, parcel props
  const hit = (c: number[]) => { for (let i = 0; i + 1 < c.length; i += 2) if (inFoot(b, c[i], c[i + 1])) return true; return false }
  const keepB = (w.settled ?? []).filter((p) => !(goneSites.has(p.site) || inFoot(b, p.x, p.z) || hit(p.corners)))
  rep.houses = (w.settled?.length ?? 0) - keepB.length
  replace(w.settled, keepB)
  replace(w.squares, (w.squares ?? []).filter((s) => !goneSites.has(s.site) && !inFoot(b, s.x, s.z, s.r)))
  replace(w.gardens, (w.gardens ?? []).filter((g) => !goneSites.has(g.site) && !hit(g.corners)))
  for (const list of [w.parcels, w.fences]) {
    if (!list) continue
    const parcels: VillageParcel[] = []
    for (const p of list) {
      if (goneSites.has(p.site)) continue
      const items = p.items.filter((it) => !inFoot(b, it.x, it.z, 2))
      rep.props += p.items.length - items.length
      const fences = p.fences.flatMap((f) => clipLine(f.pts, b, false, 0, 2).parts.map((pts) => ({ ...f, pts })))
      if (items.length || fences.length) parcels.push({ ...p, items, fences })
    }
    replace(list, parcels)
  }
  // roads: through roads around the perimeter, others cut at the footprint; lanes / paths of gone places dropped
  const roadsOut: Road[] = [], detoured: Road[] = []
  for (const r of w.roads) {
    if (own(r.id)) { roadsOut.push(r); continue }
    const c = clipLine(r.pts, b, !!THROUGH[r.type], 25)
    if (!c.cut) { roadsOut.push(r); continue }
    if (c.rerouted) rep.roadsRerouted++; else rep.roadsCut++
    c.parts.forEach((pts, k) => { const nr = { ...stripArc(r), id: k ? `${r.id}_${k + 1}` : r.id, pts }; roadsOut.push(nr); if (c.rerouted) detoured.push(nr) })
  }
  replace(w.roads, roadsOut)
  for (const list of [w.lanes, w.paths]) {
    if (!list) continue
    const out: Road[] = []
    for (const r of list) {
      if ([...goneSites].some((s) => r.id.includes(s))) { rep.roadsCut++; continue }
      const c = clipLine(r.pts, b, false, 0)
      if (c.cut) rep.roadsCut++
      c.parts.forEach((pts, k) => out.push(c.cut ? { ...stripArc(r), id: k ? `${r.id}_${k + 1}` : r.id, pts } : r))
    }
    replace(list, out)
  }
  // power: stations inside go, lines through are rerouted around (poles re-spread), lines ending inside cut
  const goneSt = new Set((w.stations ?? []).filter((s) => inFoot(b, s.x, s.z, 5)).map((s) => s.id))
  replace(w.stations, (w.stations ?? []).filter((s) => !goneSt.has(s.id)))
  replace(w.access, (w.access ?? []).flatMap((a) => clipLine(a, b, false, 0).parts))
  const lines: (PowerLine & { id: string })[] = []
  for (const l of w.power ?? []) {
    const c = clipLine(l.path, b, true, 40, 20)
    if (!c.cut) { lines.push(l); continue }
    if (c.rerouted) rep.powerRerouted++; else rep.power++
    const sp = l.spacing ?? POWER_DEFAULTS[l.kind].spacing
    c.parts.forEach((path, k) => lines.push({ ...l, id: k ? `${l.id}_${k + 1}` : l.id, path, poles: placePoles(path, sp), length: Math.round(polyLen(path)) }))
  }
  replace(w.power, lines)
  // streams: small rivers run around the footprint (a ditch along the perimeter)
  if (w.waters) {
    const out: Water[] = []
    for (const wt of w.waters) {
      const closed = WATER_TYPES[wt.type]?.closed
      if (closed) { out.push(wt); continue }
      const c = clipLine(wt.pts, b, true, 15, 10)
      if (!c.cut) { out.push(wt); continue }
      rep.streams++
      c.parts.forEach((pts, k) => out.push({ ...wt, id: k ? `${wt.id}_${k + 1}` : wt.id, pts }))
    }
    replace(w.waters, out)
  }
  // forests, field plots, countryside, riparian bands: clipped to outside the footprint
  if (w.areas) {
    // woods: cleared over the airfield and the inner embankment only, the outer slopes stay wooded (no bare band)
    const bw = grow(b, -Math.max(0, (zn.embank ?? 0) - 30))
    const out: ClearArea[] = []
    for (const a of w.areas) {
      const pieces = cutPoly(a.pts, a.holes, a.kind === 'forest' ? bw : b)
      if (!pieces) { out.push(a); continue }
      rep.forests++
      pieces.forEach((p, k) => out.push({ ...a, id: k ? `${a.id}_${k + 1}` : a.id, pts: p.pts, ...(p.holes.length ? { holes: p.holes } : { holes: undefined }) }))
    }
    replace(w.areas, out.map((a) => { if (!a.holes) delete a.holes; return a }))
  }
  if (w.campaign) {
    const cp = w.campaign, fields: number[][][] = [], crops: string[] = []
    cp.fields.forEach((ring, i) => {
      const flat = ring.flatMap((q) => [q[0], q[1]])
      const closedRing = ring.length > 2 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]
      const pieces = cutPoly(closedRing ? flat.slice(0, -2) : flat, undefined, b, 400)
      if (!pieces) { fields.push(ring); if (cp.crops) crops.push(cp.crops[i]); return }
      rep.fields++
      for (const p of pieces) {
        const r: number[][] = []; for (let k = 0; k + 1 < p.pts.length; k += 2) r.push([p.pts[k], p.pts[k + 1]])
        if (closedRing) r.push([...r[0]])
        fields.push(r); if (cp.crops) crops.push(cp.crops[i])
      }
    })
    cp.fields = fields; if (cp.crops) cp.crops = crops
    const hedges: number[][][] = []
    for (const h of cp.hedges) {
      const c = clipLine(h.flatMap((q) => [q[0], q[1]]), b, false, 0, 5)
      if (c.cut) rep.hedges++
      for (const p of c.parts) { const r: number[][] = []; for (let k = 0; k + 1 < p.length; k += 2) r.push([p[k], p[k + 1]]); hedges.push(r) }
    }
    cp.hedges = hedges
    cp.shapes = clipShapes(cp.shapes, b)
  }
  replace(w.countryside, (w.countryside ?? []).flatMap((c) => { const p = cutPoly(c, undefined, b, 400); return p ? p.map((q) => q.pts) : [c] }))
  if (w.riparian) replace(w.riparian, w.riparian.flatMap((r) => { const p = cutPoly(r.pts, undefined, b, 50); return p ? p.map((q) => ({ ...r, pts: q.pts })) : [r] }))
  // other zones: RP sites, scattered trees, parcels, street lamps... their pieces inside go
  if (w.zones) {
    const out: ZoneItem[] = []
    for (const z of w.zones) {
      if (z.id === zn.id || z.kind === 'military' || z.kind === 'industrial' || z.kind === 'airfield') { out.push(z); continue }
      // a compact site (RP place, vanilla composition, cemetery...) whose centre is on the footprint goes whole;
      // map-wide layers (scattered trees, cliffs, street lamps) only lose their pieces inside
      let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity
      for (const e of z.entities) { x0 = Math.min(x0, e.x); x1 = Math.max(x1, e.x); z0 = Math.min(z0, e.z); z1 = Math.max(z1, e.z) }
      const compact = z.kind === 'site' && (!z.entities.length || Math.max(x1 - x0, z1 - z0) < 400) && inFoot(b, z.x, z.z)
      if (compact) { rep.zones++; continue }
      const ents = z.entities.filter((e) => !inFoot(b, e.x, e.z, 2))
      const boxes = z.boxes.filter((q) => !hit(q.corners))
      const shapes = clipShapes(z.shapes, b)
      const roads = z.roads.flatMap((r) => clipLine(r.pts, b, false, 0).parts.map((pts, k) => ({ ...stripArc(r), id: k ? `${r.id}_${k + 1}` : r.id, pts })))
      if (ents.length !== z.entities.length || boxes.length !== z.boxes.length || shapes.length !== z.shapes.length) rep.zones++
      if (!ents.length && !shapes.length && z.entities.length + z.shapes.length > 0) continue
      out.push({ ...z, entities: ents, boxes, shapes, roads })
    }
    replace(w.zones, out)
  }
  // a detour is new geometry laid over what the world holds: scattered trees, belt bushes, props on its carriageway
  // go (seed 3 + large military airfield: 4 BELT_2 hazels on the ROAD_ASPHALTE_1 detour, 'on-road' audit)
  for (const r of detoured) clearAlong(w, zn.id, r, rep)
  // access road to the gate: from the nearest road outside the footprint, never across it
  if (zn.access) {
    const [gx, gz] = zn.access
    const served = w.roads.some((r) => { for (let i = 0; i + 1 < r.pts.length; i += 2) if (Math.hypot(r.pts[i] - gx, r.pts[i + 1] - gz) < 40) return true; return false })
    if (!served) {
      let best: { x: number; z: number; d: number } | null = null
      for (const r of w.roads) {
        if (own(r.id) || r.type.startsWith('trail')) continue
        for (let i = 0; i + 1 < r.pts.length; i += 2) {
          const x = r.pts[i], z = r.pts[i + 1]
          if (inFoot(b, x, z, 20)) continue
          const d = Math.hypot(x - gx, z - gz)
          if (d < 3000 && (!best || d < best.d)) best = { x, z, d }
        }
      }
      if (best) {
        // start just outside the gate, away from the footprint
        const [u, v] = local(b, gx, gz), out = Math.abs(u) / b.hw > Math.abs(v) / b.hd ? world(b, Math.sign(u) * (b.hw + 25), v) : world(b, u, Math.sign(v) * (b.hd + 25))
        const pts = [gx, gz, ...pathAround(b, out[0], out[1], best.x, best.z, 30)]
        const acc: Road = { id: `${zn.id}_ACCESS`, type: o.accessType ?? 'asphaltNarrow', pts: pts.map((q) => Math.round(q * 100) / 100), auto: true }
        w.roads.push(acc)
        rep.accessRoad = true
        // the access is laid last, over what the world already holds: scattered field trees, groves, props on its
        // carriageway go (seed 3 + large airfield: TREE_FIELD_2 on AIR_1_ACCESS, 'on-road' audit)
        clearAlong(w, zn.id, acc, rep)
      }
    }
    // supply: a distribution line from the nearest pole outside to the gate
    if (w.power && !w.power.some((l) => own(l.id))) {
      let best: { x: number; z: number; d: number } | null = null
      for (const l of w.power) {
        if (l.kind === 'ehv') continue
        for (let i = 0; i + 1 < l.poles.length; i += 2) {
          const x = l.poles[i], z = l.poles[i + 1]
          if (inFoot(b, x, z, 20)) continue
          const d = Math.hypot(x - gx, z - gz)
          if (d < 2500 && (!best || d < best.d)) best = { x, z, d }
        }
      }
      if (best) {
        const path = pathAround(b, best.x, best.z, gx, gz, 45).map((q) => Math.round(q * 100) / 100)
        const sp = POWER_DEFAULTS.mv.spacing
        w.power.push({ id: `${zn.id}_POWER`, kind: 'mv', spacing: sp, path, poles: placePoles(path, sp), length: Math.round(polyLen(path)) })
        rep.supply = true
      }
    }
  }
  return rep
}

/** shapes clipped to outside the box (open lines cut, closed outlines dropped when touched) */
function clipShapes(shapes: ProjectShape[], b: Box): ProjectShape[] {
  const out: ProjectShape[] = []
  for (const s of shapes) {
    if (s.closed || s.lift) {
      let any = false
      for (let i = 0; i + 1 < s.points.length; i += 2) if (inFoot(b, s.points[i], s.points[i + 1])) { any = true; break }
      if (!any) out.push(s)
      continue
    }
    const c = clipLine(s.points, b, false, 0, 3)
    c.parts.forEach((pts, k) => out.push(c.cut ? { ...s, id: k ? `${s.id}_${k + 1}` : s.id, points: pts } : s))
  }
  return out
}

/** nearest spot (rings of `step` m, up to `maxR`) where `ok` accepts the airfield; null = none */
export function snapAirfield(x: number, z: number, ok: (x: number, z: number) => { yaw: number } | null, step = 100, maxR = 2500): { x: number; z: number; yaw: number; moved: number } | null {
  const here = ok(x, z)
  if (here) return { x, z, yaw: here.yaw, moved: 0 }
  for (let r = step; r <= maxR; r += step) {
    const n = Math.max(8, Math.round((2 * Math.PI * r) / step))
    for (let k = 0; k < n; k++) {
      const a = (k / n) * 2 * Math.PI, px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r
      const q = ok(px, pz)
      if (q) return { x: Math.round(px), z: Math.round(pz), yaw: q.yaw, moved: r }
    }
  }
  return null
}

/** distance from (x, z) to a polyline */
function lineDist(pts: readonly number[], x: number, z: number): number {
  let best = Infinity
  for (let i = 0; i + 3 < pts.length; i += 2) {
    const ax = pts[i], az = pts[i + 1], dx = pts[i + 2] - ax, dz = pts[i + 3] - az, L = dx * dx + dz * dz || 1
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L))
    best = Math.min(best, Math.hypot(ax + dx * t - x, az + dz * t - z))
  }
  return best
}
