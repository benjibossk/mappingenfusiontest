// Road-anchored field layout ("Fantasy Town Generator" countryside look, kept inside the vanilla-measured
// ranges of tools/PakTools/analyses/FIELDS_SURFACES_VANILLA.md): the zone is cut recursively by straight
// lines whose frame comes from the nearest road (strips perpendicular to it) or, away from the roads, from
// the town (radial fan). The target parcel area grows with the distance from the town (small near the
// fringe, large far away), so the median stays at the Everon ~1-1.6 ha. Crops: greedy colouring of the
// adjacency graph (Tanin69/AgriFieldGenerator idea), neighbours never share a crop.

import * as turf from '@turf/turf'
import { safeIntersect } from './campaign'
import type { CoverArea } from './cover'

export type Crop = 'wheat' | 'ploughed' | 'meadow' | 'fallow' | 'rapeseed' | 'orchard'
export const CROPS: Crop[] = ['wheat', 'ploughed', 'meadow', 'fallow', 'rapeseed', 'orchard']
/** 2D view colours (FTG palette: wheat yellow, ploughed brown, meadow green) */
export const CROP_COLOURS: Record<Crop, string> = { wheat: '#d9c36a', ploughed: '#8c6a47', meadow: '#8fb35c', fallow: '#b7ae74', rapeseed: '#e3d64a', orchard: '#5f8f45' }
/** terrain surface painted under the crop (cover.ts codes): 4 Crop_Field_01, 8 Crop_Field_02, 0 = grass */
export const CROP_COVER: Record<Crop, number> = { wheat: 4, rapeseed: 4, fallow: 4, ploughed: 8, meadow: 0, orchard: 0 }

export interface RoadFieldOptions {
  zone: number[] // flat X/Z ring
  seed: number
  /** median parcel side, m (110 = Everon) */
  fieldSize: number
  /** long / short of a parcel */
  aspect: number
  /** road centre lines, flat X/Z */
  roads?: number[][]
  /** town centre: radial fan + size gradient */
  centre?: [number, number]
  /** fringe radius (smallest parcels) and outer reach (largest) around the centre, m */
  fringe?: number
  reach?: number
  /** fallback long-axis angle (deg) with neither road nor centre */
  angle?: number
}

function rng(seed: number) {
  let a = seed >>> 0 || 1
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function ringArea(r: number[][]): number {
  let s = 0
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) s += r[j][0] * r[i][1] - r[i][0] * r[j][1]
  return Math.abs(s) / 2
}
export function ringCentroid(r: number[][]): [number, number] {
  let a = 0, x = 0, z = 0
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const c = r[j][0] * r[i][1] - r[i][0] * r[j][1]
    a += c; x += (r[j][0] + r[i][0]) * c; z += (r[j][1] + r[i][1]) * c
  }
  if (Math.abs(a) < 1e-9) return [r[0][0], r[0][1]]
  return [x / (3 * a), z / (3 * a)]
}

/** nearest road segment to (x, z): its direction (rad) and distance */
export function nearestRoad(roads: number[][], x: number, z: number): { dir: number; d: number } | null {
  let best: { dir: number; d: number } | null = null
  for (const p of roads) for (let i = 0; i + 3 < p.length; i += 2) {
    const ax = p[i], az = p[i + 1], dx = p[i + 2] - ax, dz = p[i + 3] - az, L = dx * dx + dz * dz
    if (!L) continue
    const u = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L))
    const d = Math.hypot(ax + u * dx - x, az + u * dz - z)
    if (!best || d < best.d) best = { dir: Math.atan2(dz, dx), d }
  }
  return best
}

/** long-axis direction of a parcel at (x, z): perpendicular to a road within reach, else radial to the town */
export function longAxis(o: { roads?: number[][]; centre?: [number, number]; roadReach: number; angle?: number }, x: number, z: number): number {
  const r = o.roads?.length ? nearestRoad(o.roads, x, z) : null
  if (r && r.d < o.roadReach) return r.dir + Math.PI / 2
  if (o.centre) return Math.atan2(z - o.centre[1], x - o.centre[0])
  if (r) return r.dir + Math.PI / 2
  return ((o.angle ?? 0) * Math.PI) / 180
}

type Ring = number[][]

/** pieces of `ring` on each side of the line through (px, pz) with direction `a` */
function cut(ring: Ring, px: number, pz: number, a: number): Ring[][] {
  const B = 1e5, ux = Math.cos(a), uz = Math.sin(a), nx = -uz, nz = ux
  const poly = turf.polygon([ring])
  const side = (s: number) => {
    const c = [[px - ux * B, pz - uz * B], [px + ux * B, pz + uz * B], [px + ux * B + s * nx * B, pz + uz * B + s * nz * B], [px - ux * B + s * nx * B, pz - uz * B + s * nz * B]]
    c.push(c[0])
    const r = safeIntersect(c, poly)
    if (!r) return []
    const ps = r.geometry.type === 'Polygon' ? [r.geometry.coordinates] : r.geometry.coordinates
    return ps.map((q) => q[0] as Ring)
  }
  return [side(1), side(-1)]
}

/** recursive road / radial strip subdivision of one zone ring; closed [x, z] rings out */
export function roadFieldLayout(o: RoadFieldOptions): Ring[] {
  const rand = rng(o.seed)
  const ring: Ring = []
  for (let i = 0; i + 1 < o.zone.length; i += 2) ring.push([o.zone[i], o.zone[i + 1]])
  if (ring.length < 3) return []
  ring.push(ring[0].slice())
  const A0 = o.fieldSize * o.fieldSize, roadReach = o.fieldSize * 2.2
  // only the roads near the zone (the world passes the whole network)
  let bx0 = Infinity, bz0 = Infinity, bx1 = -Infinity, bz1 = -Infinity
  for (const q of ring) { bx0 = Math.min(bx0, q[0]); bx1 = Math.max(bx1, q[0]); bz0 = Math.min(bz0, q[1]); bz1 = Math.max(bz1, q[1]) }
  const m = roadReach * 2
  const roads = (o.roads ?? []).filter((p) => { for (let i = 0; i + 1 < p.length; i += 2) if (p[i] > bx0 - m && p[i] < bx1 + m && p[i + 1] > bz0 - m && p[i + 1] < bz1 + m) return true; return false })
  const fringe = o.fringe ?? 0, reach = Math.max(fringe + 1, o.reach ?? fringe + 1)
  // size gradient: target x0.6 at the fringe .. x6.35 at the outer reach (final plots ~0.6 .. 3 ha) (vanilla p10 0.6 ha .. p90 5.7 ha)
  const target = (x: number, z: number) => {
    if (!o.centre) return A0
    const t = Math.max(0, Math.min(1, (Math.hypot(x - o.centre[0], z - o.centre[1]) - fringe) / (reach - fringe)))
    return A0 * (0.6 + 5.75 * t) // pieces stop between ~0.5 and 1 x target, then roads / houses cut them
  }
  const out: Ring[] = []
  const stack: { r: Ring; depth: number; asp: number }[] = [{ r: ring, depth: 0, asp: o.aspect }]
  while (stack.length) {
    const { r, depth, asp } = stack.pop()!
    const A = ringArea(r)
    const [cx, cz] = ringCentroid(r)
    const T = target(cx, cz)
    if (depth > 40 || A <= T * (0.7 + 0.6 * rand()) || A < A0 * 0.3) { out.push(r); continue }
    const la = longAxis({ roads, centre: o.centre, roadReach, angle: o.angle }, cx, cz)
    const ux = Math.cos(la), uz = Math.sin(la)
    let l0 = Infinity, l1 = -Infinity, w0 = Infinity, w1 = -Infinity
    for (const q of r) {
      const l = q[0] * ux + q[1] * uz, w = -q[0] * uz + q[1] * ux
      l0 = Math.min(l0, l); l1 = Math.max(l1, l); w0 = Math.min(w0, w); w1 = Math.max(w1, w)
    }
    const L = l1 - l0, W = w1 - w0
    // the long side runs along `la`: cut across it when the piece is too long, else split the width into strips
    const across = L > asp * W
    const f = 0.36 + 0.28 * rand(), jit = (rand() - 0.5) * 0.14 // ~ +-4 deg: irregular quadrilaterals
    let px: number, pz: number, a: number
    if (across) { const l = l0 + f * L, w = (w0 + w1) / 2; px = l * ux - w * uz; pz = l * uz + w * ux; a = la + Math.PI / 2 + jit }
    else { const w = w0 + f * W, l = (l0 + l1) / 2; px = l * ux - w * uz; pz = l * uz + w * ux; a = la + jit }
    const [s1, s2] = cut(r, px, pz, a)
    const parts = [...s1, ...s2].filter((p) => ringArea(p) > 1)
    if (parts.length < 2) { out.push(r); continue }
    // a few narrow strips (FTG) : aspect up to ~2.8 (vanilla p90)
    for (const p of parts) stack.push({ r: p, depth: depth + 1, asp: rand() < 0.12 ? 2.6 : o.aspect })
  }
  return out
}

/** distance from (x, z) to the boundary of a closed ring */
function distToRing(r: Ring, x: number, z: number): number {
  let d = Infinity
  for (let i = 0; i + 1 < r.length; i++) {
    const a = r[i], b = r[i + 1], dx = b[0] - a[0], dz = b[1] - a[1], L = dx * dx + dz * dz || 1
    const u = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / L))
    d = Math.min(d, Math.hypot(a[0] + u * dx - x, a[1] + u * dz - z))
  }
  return d
}

function bbox(r: Ring): [number, number, number, number] {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity
  for (const q of r) { x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); z0 = Math.min(z0, q[1]); z1 = Math.max(z1, q[1]) }
  return [x0, z0, x1, z1]
}

/** samples every `step` m along the ring boundary */
export function boundarySamples(r: Ring, step = 4): number[][] {
  const out: number[][] = []
  for (let i = 0; i + 1 < r.length; i++) {
    const a = r[i], b = r[i + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.floor(L / step))
    for (let k = 0; k < n; k++) { const t = (k + 0.5) / n; out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]) }
  }
  return out
}

/** neighbours: plots sharing >= ~8 m of border (samples of one within `tol` m of the other) */
export function plotAdjacency(fields: Ring[], tol = 2): number[][] {
  const bb = fields.map(bbox), adj: number[][] = fields.map(() => [])
  const samples = fields.map((f) => boundarySamples(f))
  for (let i = 0; i < fields.length; i++) for (let j = i + 1; j < fields.length; j++) {
    const a = bb[i], b = bb[j]
    if (a[0] > b[2] + tol || b[0] > a[2] + tol || a[1] > b[3] + tol || b[1] > a[3] + tol) continue
    let n = 0
    for (const s of samples[i]) if (s[0] >= b[0] - tol && s[0] <= b[2] + tol && s[1] >= b[1] - tol && s[1] <= b[3] + tol && distToRing(fields[j], s[0], s[1]) < tol && ++n >= 2) break
    if (n >= 2) { adj[i].push(j); adj[j].push(i) }
  }
  return adj
}

/** greedy colouring (largest degree first), random preference among the 3 main crops; fallow / rapeseed only
 *  when the three are taken around; orchards / meadows near the town (garden fringe). */
export function colourCrops(fields: Ring[], o: { seed: number; centre?: (x: number, z: number) => number }): Crop[] {
  const rand = rng(o.seed * 7 + 3), adj = plotAdjacency(fields)
  const order = fields.map((_, i) => i).sort((a, b) => adj[b].length - adj[a].length || a - b)
  const crops: (Crop | undefined)[] = fields.map(() => undefined)
  for (const i of order) {
    const used = new Set(adj[i].map((j) => crops[j]).filter(Boolean))
    const [cx, cz] = ringCentroid(fields[i]), near = o.centre ? o.centre(cx, cz) : 1
    const r = rand()
    const pref: Crop[] = near < 0.12 ? (r < 0.5 ? ['orchard', 'meadow', 'ploughed', 'wheat'] : ['meadow', 'orchard', 'wheat', 'ploughed'])
      : r < 0.5 ? ['wheat', 'ploughed', 'meadow'] : r < 0.62 ? ['ploughed', 'wheat', 'meadow'] : ['meadow', 'wheat', 'ploughed']
    crops[i] = [...pref, ...CROPS].find((c) => !used.has(c)) ?? pref[0]
  }
  return crops as Crop[]
}

/** hedgerows on the plot borders: every border once (T-junctions included, unlike the vertex-matched
 *  plotHedges), `keep` share of the edges, never on unfarmable ground. `seen` carries the laid segments
 *  across zones ("h:x0,z0,x1,z1"). */
export function borderHedges(fields: Ring[], o: { rnd: () => number; ok: (x: number, z: number) => boolean; keep?: number; minLen?: number; seen?: Set<string> }): number[][][] {
  const keep = o.keep ?? 0.92, minLen = o.minLen ?? 15, C = 50
  const grid = new Map<string, number[][]>()
  const add = (s: number[]) => {
    const x0 = Math.floor(Math.min(s[0], s[2]) / C) - 1, x1 = Math.floor(Math.max(s[0], s[2]) / C) + 1
    const z0 = Math.floor(Math.min(s[1], s[3]) / C) - 1, z1 = Math.floor(Math.max(s[1], s[3]) / C) + 1
    for (let i = x0; i <= x1; i++) for (let j = z0; j <= z1; j++) { const k = i + ',' + j; let c = grid.get(k); if (!c) grid.set(k, (c = [])); c.push(s) }
  }
  for (const k of o.seen ?? []) if (k.startsWith('h:')) add(k.slice(2).split(',').map(Number))
  const covered = (x: number, z: number) => (grid.get(Math.floor(x / C) + ',' + Math.floor(z / C)) ?? []).some((s) => {
    const dx = s[2] - s[0], dz = s[3] - s[1], L = dx * dx + dz * dz || 1
    const u = Math.max(0, Math.min(1, ((x - s[0]) * dx + (z - s[1]) * dz) / L))
    return Math.hypot(s[0] + u * dx - x, s[1] + u * dz - z) < 3
  })
  const out: number[][][] = []
  for (const f of fields) for (let i = 0; i + 1 < f.length; i++) {
    const a = f[i], b = f[i + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1])
    if (L < minLen) continue
    const roll = o.rnd() < keep
    const n = Math.max(2, Math.ceil(L / 5))
    let run: number | null = null
    const flush = (t1: number) => {
      if (run === null) return
      const t0 = run; run = null
      if ((t1 - t0) * L < minLen) return
      const p = [a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0], q = [a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1]
      const s = [p[0], p[1], q[0], q[1]]
      add(s); o.seen?.add('h:' + s.map((v) => v.toFixed(2)).join(','))
      if (roll) out.push([p, q]) // the border is claimed even when not kept: its neighbour's copy must not roll again
    }
    for (let k = 0; k <= n; k++) {
      const t = k / n, x = a[0] + (b[0] - a[0]) * t, z = a[1] + (b[1] - a[1]) * t
      const free = !covered(x, z) && o.ok(x, z)
      if (free && run === null) run = t
      if (!free) flush(t)
    }
    flush(1)
  }
  return out
}

/** crop surfaces (cover.ts areas) of the generated plots: wheat / rapeseed / fallow Crop_Field_01, ploughed
 *  Crop_Field_02, meadows and orchards stay grass */
export function cropCover(c: { fields: number[][][]; crops?: string[] }): CoverArea[] {
  const out: CoverArea[] = []
  c.fields.forEach((f, i) => {
    const code = CROP_COVER[(c.crops?.[i] ?? 'wheat') as Crop] ?? 4
    if (code) out.push({ kind: 'field', code, pts: f.flat() })
  })
  return out
}
