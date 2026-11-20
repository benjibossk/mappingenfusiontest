// Dams (docs/DAMS.md): an earth embankment closing a valley throat on a river, a reservoir behind it and
// the river carrying on from the downstream foot.
// The vanilla game has NO large dam prefab: only GravelDam_01 (19 x 1.67 x 4.47 m gravel weir) and the
// FloodGate_01 sluice parts. So the dam body is sculpted into the relief (embankment, only raises the ground)
// a crash-barrier parapet runs along both crest edges (wall generator polylines).

import type { Grid } from './island'
import type { ProjectEntity, ProjectShape } from '../project'
import type { Water } from './water'
import type { ZoneItem } from './zones'
import { modDamPieces, modRef } from '../library/mods'
import { roadShape } from './gen-common'

/** GravelDam_01: GUID from the game data (Prefabs/Structures/Infrastructure/Waterworks/GravelDam_01) */
export const GRAVEL_DAM = { prefab: '{64E482C4598F3E45}Prefabs/Structures/Infrastructure/Waterworks/GravelDam_01/GravelDam_01.et', w: 18.99, d: 1.67, h: 4.47 }
/** flat crest length past each crest end, m (keys the wall ends into the valley sides) */
export const DAM_END = 12
/** crest parapet: Everon crash barrier wall generator (roads.ts BARRIERS.everon) */
export const DAM_PARAPET = '{3058725A52981080}Prefabs/WEGenerators/Walls/Crashbarrier/WG_CrashBarrier_E_01.et'
const DIRT_ROAD = '{8E83BBD5CEC42A11}Prefabs/WEGenerators/Roads/Dirt/RG_Road_Dirt_01.et'

export interface DamOptions {
  /** crest height above the river bed, m */
  height: number
  /** water level = crest - freeboard */
  freeboard: number
  /** longest crest accepted, m */
  maxLength: number
  /** half crest width (flat top, carries a track), m */
  crestHalf: number
  /** horizontal run per metre of drop on both faces */
  slope: number
  /** reservoir area bounds, m² */
  minArea: number
  maxArea: number
  count: number
}
export const DAM_DEFAULTS: DamOptions = { height: 12, freeboard: 2, maxLength: 360, crestHalf: 4, slope: 2.5, minArea: 20000, maxArea: 1.5e6, count: 1 }

export interface Dam {
  id: string
  /** crest axis ends (A left bank, B right bank), centre on the river */
  ax: number; az: number; bx: number; bz: number
  cx: number; cz: number
  /** unit vector downstream (perpendicular to the axis) */
  nx: number; nz: number
  bed: number
  crest: number
  level: number
  /** distance from the axis to the toe of the faces, m */
  toe: number
  /** downstream foot, where the river starts again */
  foot: [number, number]
}

const idx = (g: Grid, x: number, z: number) => {
  const c = Math.round((x - g.minX) / g.step), r = Math.round((z - g.minZ) / g.step)
  return c < 0 || r < 0 || c >= g.cols || r >= g.rows ? -1 : r * g.cols + c
}
const hAt = (h: ArrayLike<number>, g: Grid, x: number, z: number) => { const k = idx(g, x, z); return k < 0 ? -Infinity : h[k] }

/** embankment height wanted at (x, z), -Infinity outside */
export function damTarget(d: Dam, o: Pick<DamOptions, 'crestHalf' | 'slope'>, x: number, z: number) {
  const tx = d.bx - d.ax, tz = d.bz - d.az, L = Math.hypot(tx, tz) || 1
  const u = ((x - d.cx) * tx + (z - d.cz) * tz) / L, v = (x - d.cx) * d.nx + (z - d.cz) * d.nz
  // the crest runs on flat for DAM_END m past each end (the crest road and the wall), so the hillsides meet
  // the top of the wall instead of the embankment dropping away at its ends
  const ue = Math.max(0, Math.abs(u) - L / 2 - DAM_END), ve = Math.max(0, Math.abs(v) - o.crestHalf)
  // same side slope all round: beyond the crest ends the embankment rounds off into the hillsides (no 1:1 cliff)
  return d.crest - Math.hypot(ue, ve) / o.slope
}

/** raises the ground to the embankment (never lowers it) */
export function applyDam(h: number[] | Float32Array, g: Grid, d: Dam, o: Pick<DamOptions, 'crestHalf' | 'slope'>) {
  const R = Math.hypot(d.bx - d.ax, d.bz - d.az) / 2 + DAM_END + d.toe + 2 * g.step
  const c0 = Math.max(0, Math.floor((d.cx - R - g.minX) / g.step)), c1 = Math.min(g.cols - 1, Math.ceil((d.cx + R - g.minX) / g.step))
  const r0 = Math.max(0, Math.floor((d.cz - R - g.minZ) / g.step)), r1 = Math.min(g.rows - 1, Math.ceil((d.cz + R - g.minZ) / g.step))
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
    const k = r * g.cols + c, t = damTarget(d, o, g.minX + c * g.step, g.minZ + r * g.step)
    if (t > h[k]) h[k] = t
  }
}

/** 4-connected flood of the cells under `level` from a seed; null if it leaks (sea, map edge, `forbid`) or is too big */
export function floodReservoir(h: ArrayLike<number>, g: Grid, seed: number, level: number, maxCells: number, forbid: (k: number) => boolean): Uint8Array | null {
  const m = new Uint8Array(g.cols * g.rows)
  if (seed < 0 || h[seed] >= level) return null
  const st = [seed]; m[seed] = 1
  let n = 0
  while (st.length) {
    const k = st.pop()!, c = k % g.cols, r = (k - c) / g.cols
    if (++n > maxCells || h[k] <= 0.5 || forbid(k) || c === 0 || r === 0 || c === g.cols - 1 || r === g.rows - 1) return null
    for (const j of [k - 1, k + 1, k - g.cols, k + g.cols]) if (!m[j] && h[j] < level) { m[j] = 1; st.push(j) }
  }
  return m
}

/** outer outline of a cell mask (cell corners), simplified; X/Z flat */
export function maskOutline(m: Uint8Array, g: Grid, tol = g.step * 0.75): number[] {
  const W = g.cols + 1, next = new Map<number, number>()
  const on = (c: number, r: number) => c >= 0 && r >= 0 && c < g.cols && r < g.rows && m[r * g.cols + c] === 1
  for (let r = 0; r < g.rows; r++) for (let c = 0; c < g.cols; c++) {
    if (!on(c, r)) continue
    const v = (cc: number, rr: number) => rr * W + cc // corner (cc, rr) = top-left of cell (cc, rr)
    if (!on(c, r - 1)) next.set(v(c, r), v(c + 1, r))
    if (!on(c + 1, r)) next.set(v(c + 1, r), v(c + 1, r + 1))
    if (!on(c, r + 1)) next.set(v(c + 1, r + 1), v(c, r + 1))
    if (!on(c - 1, r)) next.set(v(c, r + 1), v(c, r))
  }
  let best: number[] = []
  const seen = new Set<number>()
  for (const s of next.keys()) {
    if (seen.has(s)) continue
    const loop: number[] = []
    let v = s
    while (!seen.has(v) && next.has(v)) { seen.add(v); loop.push(v); v = next.get(v)! }
    if (loop.length > best.length) best = loop
  }
  let pts = best.flatMap((v) => [g.minX + ((v % W) - 0.5) * g.step, g.minZ + (Math.floor(v / W) - 0.5) * g.step])
  // the corner loop stair-steps along the grid (a 45 deg step sits step/sqrt2 off the slant): simplify past
  // that, then Chaikin corner cutting rounds the remaining polygon corners
  pts = simplifyRing(pts, tol)
  for (let it = 0; it < 2; it++) pts = chaikin(pts)
  return pts
}

function chaikin(p: number[]): number[] {
  const n = p.length / 2, out: number[] = []
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n, ax = p[i * 2], az = p[i * 2 + 1], bx = p[j * 2], bz = p[j * 2 + 1]
    out.push(0.75 * ax + 0.25 * bx, 0.75 * az + 0.25 * bz, 0.25 * ax + 0.75 * bx, 0.25 * az + 0.75 * bz)
  }
  return out
}

function simplifyRing(p: number[], tol: number): number[] {
  const n = p.length / 2
  if (n < 8) return p
  const keep = new Uint8Array(n); keep[0] = 1; keep[n >> 1] = 1
  const dp = (a: number, b: number) => {
    let md = 0, mi = -1
    for (let i = a + 1; i < b; i++) {
      const ax = p[a * 2], az = p[a * 2 + 1], bx = p[(b % n) * 2], bz = p[(b % n) * 2 + 1]
      const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz) || 1
      const d = Math.abs((p[i * 2] - ax) * dz - (p[i * 2 + 1] - az) * dx) / L
      if (d > md) { md = d; mi = i }
    }
    if (md > tol && mi > 0) { keep[mi] = 1; dp(a, mi); dp(mi, b) }
  }
  dp(0, n >> 1); dp(n >> 1, n)
  const out: number[] = []
  for (let i = 0; i < n; i++) if (keep[i]) out.push(p[i * 2], p[i * 2 + 1])
  return out
}

function densify(p: number[], s: number) {
  const out: number[] = []
  for (let i = 0; i + 3 < p.length; i += 2) {
    const L = Math.hypot(p[i + 2] - p[i], p[i + 3] - p[i + 1]), n = Math.max(1, Math.ceil(L / s))
    for (let k = 0; k < n; k++) out.push(p[i] + ((p[i + 2] - p[i]) * k) / n, p[i + 1] + ((p[i + 3] - p[i + 1]) * k) / n)
  }
  if (p.length >= 2) out.push(p[p.length - 2], p[p.length - 1])
  return out
}

export function pointInPoly(pts: number[], x: number, z: number) {
  let ins = false
  for (let i = 0, j = pts.length - 2; i < pts.length; j = i, i += 2)
    if ((pts[i + 1] > z) !== (pts[j + 1] > z) && x < ((pts[j] - pts[i]) * (z - pts[i + 1])) / (pts[j + 1] - pts[i + 1]) + pts[i]) ins = !ins
  return ins
}

export interface DamResult { dams: Dam[]; lakes: Omit<Water, 'id'>[]; rivers: Omit<Water, 'id'>[]; masks: Uint8Array[] }

/**
 * Finds valley throats on the rivers (upstream first), closes them with an embankment (applied to `h` in place),
 * floods the reservoir upstream up to crest - freeboard and cuts the rivers: the dammed one ends in the lake and
 * starts again at the downstream foot. `blocked(k)` = cells the reservoir must not reach (existing lakes...).
 */
export function placeDams(h: number[] | Float32Array, g: Grid, rivers: Omit<Water, 'id'>[], o: Partial<DamOptions> = {}, blocked: (k: number) => boolean = () => false): DamResult {
  // no throat holds the full height: try lower dams (down to ~5 m)
  const H0 = o.height ?? DAM_DEFAULTS.height
  let res = placeDamsAt(h, g, rivers, o, blocked)
  for (const f of [0.7, 0.45]) if (!res.dams.length) res = placeDamsAt(h, g, rivers, { ...o, height: Math.round(H0 * f) }, blocked)
  return res
}

function placeDamsAt(h: number[] | Float32Array, g: Grid, rivers: Omit<Water, 'id'>[], o: Partial<DamOptions>, blocked: (k: number) => boolean): DamResult {
  const O = { ...DAM_DEFAULTS, ...o }
  // traced rivers carry few vertices (one every few hundred metres): resample every cell
  rivers = rivers.map((w) => ({ ...w, pts: densify(w.pts, g.step) }))
  const res: DamResult = { dams: [], lakes: [], rivers: rivers.slice(), masks: [] }
  type Cand = { ri: number; j: number; w: number; d: Dam }
  const cands: Cand[] = []
  for (let ri = 0; ri < rivers.length; ri++) {
    const p = rivers[ri].pts, n = p.length / 2
    for (let j = Math.max(1, Math.floor(n * 0.25)); j < Math.min(n - 1, Math.ceil(n * 0.85)); j++) {
      const x = p[j * 2], z = p[j * 2 + 1]
      let nx = p[j * 2 + 2] - p[j * 2 - 2], nz = p[j * 2 + 3] - p[j * 2 - 1]
      const nl = Math.hypot(nx, nz) || 1; nx /= nl; nz /= nl
      const bed = hAt(h, g, x, z)
      if (!(bed > 2)) continue
      const crest = bed + O.height
      const ray = (sx: number, sz: number) => {
        for (let s = g.step / 2; s <= O.maxLength; s += g.step / 2) if (hAt(h, g, x + sx * s, z + sz * s) >= crest) return s
        return -1
      }
      const dl = ray(-nz, nx), dr = ray(nz, -nx)
      if (dl < 0 || dr < 0 || dl + dr > O.maxLength) continue
      const ax = x - nz * dl, az = z + nx * dl, bx = x + nz * dr, bz = z - nx * dr
      const d: Dam = { id: '', ax, az, bx, bz, cx: (ax + bx) / 2, cz: (az + bz) / 2, nx, nz, bed, crest, level: crest - O.freeboard, toe: O.crestHalf + O.height * O.slope, foot: [x, z] }
      cands.push({ ri, j, w: dl + dr, d })
    }
  }
  cands.sort((a, b) => a.w - b.w)
  const taken = new Set<number>()
  for (const cd of cands) {
    if (res.dams.length >= O.count) break
    if (taken.has(cd.ri)) continue
    if (res.dams.some((q) => Math.hypot(q.cx - cd.d.cx, q.cz - cd.d.cz) < 1500)) continue
    const d = cd.d
    const trial = Array.from(h)
    applyDam(trial, g, d, O)
    // seed: first river point upstream beyond the toe; foot: first point downstream beyond it
    const p = res.rivers[cd.ri].pts, n = p.length / 2
    const v = (i: number) => (p[i * 2] - d.cx) * d.nx + (p[i * 2 + 1] - d.cz) * d.nz
    let su = cd.j; while (su > 0 && v(su) > -(d.toe + g.step)) su--
    let sd = cd.j; while (sd < n - 1 && v(sd) < d.toe + g.step) sd++
    if (v(su) > -(d.toe + g.step) || v(sd) < d.toe + g.step) continue
    const footK = idx(g, p[sd * 2], p[sd * 2 + 1])
    const m = floodReservoir(trial, g, idx(g, p[su * 2], p[su * 2 + 1]), d.level, O.maxArea / (g.step * g.step), (k) => k === footK || blocked(k))
    if (!m) continue
    let area = 0, down = 0
    for (let k = 0; k < m.length; k++) if (m[k]) {
      area++
      const c = k % g.cols, r = (k - c) / g.cols
      if ((g.minX + c * g.step - d.cx) * d.nx + (g.minZ + r * g.step - d.cz) * d.nz > 0 && Math.hypot(g.minX + c * g.step - d.cx, g.minZ + r * g.step - d.cz) < 3 * d.toe) down++
    }
    if (area * g.step * g.step < O.minArea || down > 0) continue
    for (let k = 0; k < h.length; k++) h[k] = trial[k]
    d.id = `DAM_${res.dams.length + 1}`
    d.foot = [p[sd * 2], p[sd * 2 + 1]]
    // keep the shore off the embankment: water stops where the upstream face is 2 m under the level, so the
    // lake carving (water.ts) never bites into the dam body (thin ridge with teeth on the water side)
    for (let k = 0; k < m.length; k++) if (m[k]) {
      const c = k % g.cols, r = (k - c) / g.cols
      if (damTarget(d, O, g.minX + c * g.step, g.minZ + r * g.step) > d.level - 2) m[k] = 0
    }
    const outline = maskOutline(m, g)
    res.dams.push(d); res.masks.push(m)
    res.lakes.push({ type: 'lake', pts: outline, width: 0, depth: 2, auto: true, level: d.level })
    taken.add(cd.ri)
    // the dammed river: upstream part up to the lake, downstream part from the foot
    const r0 = res.rivers[cd.ri]
    const pieces: Omit<Water, 'id'>[] = []
    let up = 0; while (up < su && !m[idx(g, p[up * 2], p[up * 2 + 1])]) up++
    if (up >= 2) pieces.push({ ...r0, pts: p.slice(0, up * 2) })
    if (n - sd >= 2) pieces.push({ ...r0, pts: p.slice(sd * 2) })
    // the other rivers lose their points in the reservoir
    const cut = (w: Omit<Water, 'id'>) => {
      const out: Omit<Water, 'id'>[] = []
      let cur: number[] = []
      for (let i = 0; i + 1 < w.pts.length; i += 2) {
        if (m[idx(g, w.pts[i], w.pts[i + 1])]) { if (cur.length >= 4) out.push({ ...w, pts: cur }); cur = [] } else cur.push(w.pts[i], w.pts[i + 1])
      }
      if (cur.length >= 4) out.push({ ...w, pts: cur })
      return out
    }
    res.rivers = res.rivers.flatMap((w, i) => (i === cd.ri ? pieces : cut(w)))
    // indices moved: forget the remaining candidates' river index (one dam per pass is the common case)
    break
  }
  return res
}

/** ZoneItem for the map, the 3D view and the export: GravelDam_01 pieces along the crest + a dirt track on it.
 *  With the Minus Building Pack enabled (library/mods.ts, off by default) the crest gets its concrete dam
 *  slices instead: Dam_01 (local X -20..0) + Dam_02 (0..20) share a pivot at road level, so one pair = a 40 m
 *  module; mesh bbox Z -17..+6.5 (long sloping face on -Z = downstream, so local +Z points upstream). */
export function damZone(d: Dam, o: Partial<DamOptions> = {}, mods?: string[]): ZoneItem {
  const O = { ...DAM_DEFAULTS, ...o }
  const tx = d.bx - d.ax, tz = d.bz - d.az, L = Math.hypot(tx, tz) || 1, ux = tx / L, uz = tz / L
  const ends = DAM_END // the crest runs into the hillsides
  const len = L + 2 * ends
  const entities: ProjectEntity[] = []
  const yaw = (Math.atan2(uz, ux) * 180) / Math.PI
  const mod = modDamPieces(mods)
  if (mod) {
    const W = mod[0].d[0] + mod[1].d[0], m = Math.max(1, Math.ceil(len / W))
    for (let i = 0; i < m; i++) {
      const s = -len / 2 + (i + 0.5) * (len / m)
      for (const [k, r] of mod.entries()) entities.push({ id: `${d.id}_CONC_${i + 1}_${k + 1}`, prefab: modRef(r), x: d.cx + ux * s, z: d.cz + uz * s, yaw, ycm: Math.round(d.crest * 100) })
    }
  }
  // vanilla crest: a parapet (Everon crash barrier wall generator) on both edges, 0.6 m in from the crest edge so
  // it stands on the flat top. GravelDam_01 is a sloping weir wedge, not a wall: sunk to the crest and yawed on
  // a single point each, it showed as isolated tilted stones (seed 21 Workbench check)
  const parapets: ProjectShape[] = []
  if (!mod) for (const side of [-1, 1]) {
    const e = side * (O.crestHalf - 0.6), ox = d.nx * e, oz = d.nz * e
    const a: [number, number] = [d.ax - ux * ends + ox, d.az - uz * ends + oz], b: [number, number] = [d.bx + ux * ends + ox, d.bz + uz * ends + oz]
    const pts: number[] = []
    const k = Math.max(1, Math.ceil(len / 10))
    for (let j = 0; j <= k; j++) pts.push(a[0] + ((b[0] - a[0]) * j) / k, a[1] + ((b[1] - a[1]) * j) / k)
    parapets.push({ id: `${d.id}_PARAPET_${side < 0 ? 'UP' : 'DOWN'}`, kind: 'polyline', closed: false, points: pts.map((v) => Math.round(v * 100) / 100), generator: DAM_PARAPET })
  }
  // spline with AdjustHeightMap 0 like every road (roadShape): a bare 2-point polyline let the road generator reshape
  // the crest itself (seed 21 live audit: the whole crest built 2.2 m above the sent 20.9 m)
  const road: ProjectShape = roadShape(`${d.id}_CREST`, [d.ax - ux * ends, d.az - uz * ends, d.bx + ux * ends, d.bz + uz * ends], DIRT_ROAD, 4)
  const half = (w: number, hd: number, cx: number, cz: number) => [
    cx - ux * w - d.nx * hd, cz - uz * w - d.nz * hd, cx + ux * w - d.nx * hd, cz + uz * w - d.nz * hd,
    cx + ux * w + d.nx * hd, cz + uz * w + d.nz * hd, cx - ux * w + d.nx * hd, cz - uz * w + d.nz * hd,
  ]
  return {
    id: d.id, kind: 'site', sub: 'dam', x: d.cx, z: d.cz, yaw: Math.atan2(uz, ux), seed: 0,
    boxes: [{ corners: half(len / 2, O.crestHalf, d.cx, d.cz), role: 'dam', h: 0.1 }],
    shapes: [road, ...parapets], entities, flat: [], plat: [], roads: [], warnings: [],
    // the embankment itself: applyZones (zones.ts) sculpts it into every recompose, so the heightmap sent to
    // the Workbench holds the dam and its reservoir basin (main.ts rebuilds the relief from the island)
    dam: { d, crestHalf: O.crestHalf, slope: O.slope },
    access: [d.bx + ux * ends, d.bz + uz * ends],
  }
}

/** cells covered by the embankment (raised above the natural ground `base`), for the road router to treat as
 *  water: roads go round the dam instead of running into its face. Cells within `keepR` m of a crest end stay
 *  open so the network can still reach the crest track (damZone access). */
export function damFootprint(base: ArrayLike<number>, g: Grid, dams: Dam[], o: Partial<DamOptions> = {}, keepR = 16): Uint8Array {
  const O = { ...DAM_DEFAULTS, ...o }
  const m = new Uint8Array(g.cols * g.rows)
  for (const d of dams) {
    const tx = d.bx - d.ax, tz = d.bz - d.az, L = Math.hypot(tx, tz) || 1, ux = tx / L, uz = tz / L
    const ends = [[d.ax - ux * DAM_END, d.az - uz * DAM_END], [d.bx + ux * DAM_END, d.bz + uz * DAM_END]]
    const R = L / 2 + DAM_END + O.crestHalf + (d.crest - d.bed) * O.slope + g.step
    const c0 = Math.max(0, Math.floor((d.cx - R - g.minX) / g.step)), c1 = Math.min(g.cols - 1, Math.ceil((d.cx + R - g.minX) / g.step))
    const r0 = Math.max(0, Math.floor((d.cz - R - g.minZ) / g.step)), r1 = Math.min(g.rows - 1, Math.ceil((d.cz + R - g.minZ) / g.step))
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
      const x = g.minX + c * g.step, z = g.minZ + r * g.step, k = r * g.cols + c
      if (damTarget(d, O, x, z) <= base[k] + 0.25) continue
      if (ends.some(([ex, ez]) => Math.hypot(x - ex, z - ez) < keepR)) continue
      m[k] = 1
    }
  }
  return m
}

/** a road ending near a crest end is carried onto the crest track (no dead end against the wall's end) */
export function snapRoadsToCrest<R extends { pts: number[] }>(roads: R[], dams: Dam[], reach = 60): R[] {
  for (const d of dams) {
    const tx = d.bx - d.ax, tz = d.bz - d.az, L = Math.hypot(tx, tz) || 1, ux = tx / L, uz = tz / L
    const ends = [[d.ax - ux * DAM_END, d.az - uz * DAM_END], [d.bx + ux * DAM_END, d.bz + uz * DAM_END]]
    for (const r of roads) {
      const p = r.pts, n = p.length
      if (n < 4) continue
      for (const [ex, ez] of ends) {
        const d1 = Math.hypot(p[n - 2] - ex, p[n - 1] - ez), d0 = Math.hypot(p[0] - ex, p[1] - ez)
        if (d1 < reach && d1 <= d0) { if (d1 > 0.5) p.push(ex, ez) } else if (d0 < reach && d0 > 0.5) p.unshift(ex, ez)
      }
    }
  }
  return roads
}
