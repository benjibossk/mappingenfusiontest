// Hierarchical power grid (step Roads > Power lines): EHV backbone -> HV between towns -> MV feeders
// to villages / industry -> LV along village streets, with a transformer station at every level change.
// Pure (no DOM): main.ts feeds sites, roads, industry zones and the height grid; gets lines (PG_PowerLine_*
// polylines, one pole per point), station entities (vanilla prefabs), access dirt roads and flattened pads.
//
// Vanilla assets (base game data, checked 2026-11 with game_read / layer references, GUIDs never invented):
//   EHV  PG_PowerLine_EHV_01 (130 m), start AND end pole = TransformerStation110kV_E_01_double: the
//        generator itself places the big station at both ends, so EHV-end stations are not exported again.
//   HV   PG_PowerLine_HV_02_Metal (80 m) | USSR: PG_PowerLine_HV_USSR_01 (50 m)
//   MV   PG_PowerLine_HV_01_Concrete (50 m) | USSR: PG_PowerLine_HV_03_Wooden (50 m)
//   LV   PG_PowerLine_01_WoodenSmall (35 m) | USSR: PG_PowerLine_LV_USSR_01 (40 m)
//   HV->MV  TransformerStation110kV_E_01_simple_v1 (13 x 21.5 m, 17.6 m high: fenced yard with gate)
//   MV->LV  TransformerSubstation_01 (4.1 x 4.6 m pole kiosk) | USSR: TransformerStation_USSR_02 (14.2 x 12.9 m)
//   industry  TransformerStation_E_02 (14.2 x 12.9 m) | USSR: TransformerStation_USSR_02
//   sources   DieselPowerPlant_USSR_01 (39.6 x 29.5 m, the only vanilla power plant; the Everon variant's GUID
//             is not referenced by any data we can read, so both styles use the USSR one). No vanilla thermal,
//             hydro (only Prefabs/Infrastructure/Dam/Dam_01), wind or solar plant exists.
//   EHV_Half  PG_Powerline_EHV_Half (130 m) ends on simple_v1 stations (not used: EHV_01 ends on the double).
// Planning logic and sources: docs/POWER_GRID.md

import type { Grid } from './island'
import type { ProjectEntity, ProjectShape } from '../project'
import { attachPoint, smoothPath } from './powersmooth'
import { CLEAR, PowerObstacles, clearSpans, fixPoles, followRoads, type PowerWorld } from './powerroads'
import { buildPowerCost, placePoles, routePowerLine, POWER_STYLE, type KeepOut, type PowerKind, type PowerLine, type PowerStyle } from './power'

export type StationKind = 'plant' | 'ehv' | 'hv' | 'mvlv' | 'ind'

export const STATION_PREFABS: Record<PowerStyle, Record<StationKind, { prefab: string; w: number; d: number; h: number; off?: [number, number] }>> = {
  eden: {
    plant: { prefab: '{71A6647EE336A395}Prefabs/Structures/Infrastructure/Power/DieselPowerPlant_01/DieselPowerPlant_USSR_01.et', w: 39.6, d: 29.5, h: 25.2, off: [11.3, 1.49] },
    ehv: { prefab: '{5BC1688321A0EF60}Prefabs/Structures/Infrastructure/Power/TransformerStation110kV_E_01/TransformerStation110kV_E_01_double.et', w: 26, d: 21.5, h: 17.6 },
    hv: { prefab: '{BE3D31D8919CA073}Prefabs/Structures/Infrastructure/Power/TransformerStation110kV_E_01/TransformerStation110kV_E_01_simple_v1.et', w: 13, d: 21.5, h: 17.6 },
    mvlv: { prefab: '{A54F6416C3A6A4D7}Prefabs/Structures/Infrastructure/Power/TransformerSubstation_01/TransformerSubstation_01.et', w: 4.1, d: 4.6, h: 11.2 },
    ind: { prefab: '{6AD4788522334B53}Prefabs/Structures/Infrastructure/Power/TransformerStation_E_02/TransformerStation_E_02.et', w: 14.2, d: 12.9, h: 17.3 },
  },
  ussr: {
    plant: { prefab: '{71A6647EE336A395}Prefabs/Structures/Infrastructure/Power/DieselPowerPlant_01/DieselPowerPlant_USSR_01.et', w: 39.6, d: 29.5, h: 25.2, off: [11.3, 1.49] },
    ehv: { prefab: '{5BC1688321A0EF60}Prefabs/Structures/Infrastructure/Power/TransformerStation110kV_E_01/TransformerStation110kV_E_01_double.et', w: 26, d: 21.5, h: 17.6 },
    hv: { prefab: '{BE3D31D8919CA073}Prefabs/Structures/Infrastructure/Power/TransformerStation110kV_E_01/TransformerStation110kV_E_01_simple_v1.et', w: 13, d: 21.5, h: 17.6 },
    mvlv: { prefab: '{E5CB175C37DBD3BC}Prefabs/Structures/Infrastructure/Power/TransformerStation_E_02/TransformerStation_USSR_02.et', w: 14.2, d: 12.9, h: 17.3 },
    ind: { prefab: '{E5CB175C37DBD3BC}Prefabs/Structures/Infrastructure/Power/TransformerStation_E_02/TransformerStation_USSR_02.et', w: 14.2, d: 12.9, h: 17.3 },
  },
}
/** access track to a station (same dirt road generator as roads.ts) */
export const ACCESS_ROAD_GEN = '{8E83BBD5CEC42A11}Prefabs/WEGenerators/Roads/Dirt/RG_Road_Dirt_01.et'

export interface GridSite { id: string; x: number; z: number; kind: 'town' | 'village' | 'hamlet' | 'industry'; r: number }

export interface Station {
  id: string
  kind: StationKind
  /** site it serves */
  site: string
  x: number
  z: number
  /** radians, world X/Z: local +Z (depth) axis direction = (sin yaw, cos yaw); the gate faces the access road */
  yaw: number
  w: number
  d: number
  h: number
  /** pad height after flattening */
  y: number
  prefab: string
  /** true = placed by the EHV generator as its start/end pole: not exported as an entity */
  byGenerator?: boolean
  /** mesh centre offset in the prefab's local frame (entity origin = centre - offset) */
  off?: [number, number]
}

export type GridLine = PowerLine & { id: string; from: string; to: string }

export interface GridOptions {
  style: PowerStyle
  /** 'auto' = only on maps >= 8 km with towns > 4 km apart */
  ehv: boolean | 'auto'
  hv: boolean
  mv: boolean
  lv: boolean
  /** longest MV feeder (m) */
  mvMax: number
  /** longest LV run to a hamlet (m) */
  lvMax: number
  /** power plants (sources): 'auto' = 1 per ~6 km of map side, max 3; 0 = none (towns are the sources) */
  plants: number | 'auto'
}
export const GRID_DEFAULTS: GridOptions = { style: 'eden', ehv: 'auto', hv: true, mv: true, lv: true, mvMax: 4000, lvMax: 900, plants: 'auto' }

export interface GridInput {
  heights: Float32Array | number[]
  grid: Grid
  sites: GridSite[]
  roads: number[][]
  isWater: (x: number, z: number) => boolean
  /** map side (m) */
  size: number
  /** extra no-go discs for every line and plant (airfields, military bases) */
  avoid?: KeepOut[]
  /** built world (road half widths, houses, fenced plots, bridges): road-following wooden lines, house
   *  clearance (powerroads.ts). Absent = `roads` with a 3 m half width, no buildings. */
  world?: PowerWorld
}

export interface GridPlan { lines: GridLine[]; stations: Station[]; access: number[][]; failed: number; unfed: string[] }

function hAt(h: ArrayLike<number>, g: Grid, x: number, z: number) {
  const c = Math.min(g.cols - 1, Math.max(0, Math.round((x - g.minX) / g.step)))
  const r = Math.min(g.rows - 1, Math.max(0, Math.round((z - g.minZ) / g.step)))
  return h[r * g.cols + c]
}

function nearestRoad(roads: number[][], x: number, z: number): { d: number; x: number; z: number; dir: number } {
  let best = { d: Infinity, x: NaN, z: NaN, dir: 0 }
  for (const p of roads) for (let i = 0; i + 3 < p.length; i += 2) {
    const ax = p[i], az = p[i + 1], dx = p[i + 2] - ax, dz = p[i + 3] - az
    const l = dx * dx + dz * dz
    const t = l ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l)) : 0
    const px = ax + t * dx, pz = az + t * dz, d = Math.hypot(x - px, z - pz)
    if (d < best.d) best = { d, x: px, z: pz, dir: Math.atan2(dx, dz) }
  }
  return best
}

/** footprint corners sampled on a 3 x 3 pattern (+ margin) */
function footprint(x: number, z: number, yaw: number, w: number, d: number, m = 4): [number, number][] {
  const s = Math.sin(yaw), c = Math.cos(yaw), out: [number, number][] = []
  for (const u of [-1, 0, 1]) for (const v of [-1, 0, 1]) {
    const lx = u * (w / 2 + m), lz = v * (d / 2 + m)
    out.push([x + lx * c + lz * s, z - lx * s + lz * c])
  }
  return out
}

/** height spread over the pad: the flatness criterion (metres) */
export function padRelief(h: ArrayLike<number>, g: Grid, st: Pick<Station, 'x' | 'z' | 'yaw' | 'w' | 'd'>) {
  let lo = Infinity, hi = -Infinity
  for (const [x, z] of footprint(st.x, st.z, st.yaw, st.w, st.d, 0)) { const y = hAt(h, g, x, z); lo = Math.min(lo, y); hi = Math.max(hi, y) }
  return hi - lo
}

/** Flatten the pad (rectangle + 6 m margin, then a 12 m blend) to its mean height, in place. */
export function flattenPad(h: Float32Array | number[], g: Grid, st: Station) {
  const margin = 6, blend = 12
  const s = Math.sin(st.yaw), c = Math.cos(st.yaw)
  const R = Math.hypot(st.w, st.d) / 2 + margin + blend
  const c0 = Math.max(0, Math.floor((st.x - R - g.minX) / g.step)), c1 = Math.min(g.cols - 1, Math.ceil((st.x + R - g.minX) / g.step))
  const r0 = Math.max(0, Math.floor((st.z - R - g.minZ) / g.step)), r1 = Math.min(g.rows - 1, Math.ceil((st.z + R - g.minZ) / g.step))
  for (let r = r0; r <= r1; r++) for (let col = c0; col <= c1; col++) {
    const x = g.minX + col * g.step - st.x, z = g.minZ + r * g.step - st.z
    const lx = x * c - z * s, lz = x * s + z * c // local
    const ex = Math.max(0, Math.abs(lx) - st.w / 2 - margin), ez = Math.max(0, Math.abs(lz) - st.d / 2 - margin)
    const e = Math.hypot(ex, ez)
    if (e >= blend) continue
    const k = r * g.cols + col, t = e / blend, wgt = 1 - t * t * (3 - 2 * t)
    h[k] = h[k] * (1 - wgt) + st.y * wgt
  }
}

interface PlaceCtx { input: GridInput; stations: Station[]; keep: (KeepOut & { id: string })[]; ob?: PowerObstacles }

/** Best spot for a station: on rings around `cx,cz`, flat, dry, out of the other sites, near a road,
 *  biased toward `prefer` (radians, optional). Yaw turns the gate (+Z face) to the nearest road. */
function placeStation(ctx: PlaceCtx, cx: number, cz: number, rings: number[], dims: { w: number; d: number }, prefer: number | null, ownSite: string): { x: number; z: number; yaw: number; relief: number } | null {
  const { input } = ctx
  const g = input.grid, h = input.heights
  let best: { x: number; z: number; yaw: number; relief: number } | null = null, bs = Infinity
  const half = Math.hypot(dims.w, dims.d) / 2
  for (const R of rings) for (let k = 0; k < 24; k++) {
    const a = (k / 24) * Math.PI * 2
    const x = cx + Math.sin(a) * R, z = cz + Math.cos(a) * R
    if (x - half < g.minX || z - half < g.minZ || x + half > g.minX + (g.cols - 1) * g.step || z + half > g.minZ + (g.rows - 1) * g.step) continue
    if (ctx.keep.some((q) => q.id !== ownSite && Math.hypot(x - q.x, z - q.z) < q.r + half)) continue
    if (ctx.stations.some((s) => Math.hypot(x - s.x, z - s.z) < half + Math.hypot(s.w, s.d) / 2 + 15)) continue
    const rd = nearestRoad(input.roads, x, z)
    if (rd.d < half + 6) continue // not on the road
    const yaw = Number.isFinite(rd.x) ? Math.atan2(rd.x - x, rd.z - z) : a + Math.PI
    const fp = footprint(x, z, yaw, dims.w, dims.d)
    if (fp.some(([px, pz]) => input.isWater(px, pz))) continue
    if (ctx.ob && (ctx.ob.bldDist(x, z, half + 4) < half + 3 || fp.some(([px, pz]) => ctx.ob!.inLot(px, pz)))) continue // never on a house or a plot
    const relief = padRelief(h, g, { x, z, yaw, w: dims.w + 8, d: dims.d + 8 })
    if (relief > 8) continue
    let score = relief * 4 + (Number.isFinite(rd.d) ? Math.max(0, rd.d - 30) / 15 : 30) + R / 200
    if (prefer !== null) { let da = Math.abs(a - prefer) % (2 * Math.PI); if (da > Math.PI) da = 2 * Math.PI - da; score += da * 6 }
    if (score < bs) { bs = score; best = { x, z, yaw, relief } }
  }
  return best
}

/** Prim on a complete graph, returns edges [i, j] */
function mst(n: number, w: (i: number, j: number) => number): [number, number][] {
  if (n < 2) return []
  const inT = new Uint8Array(n), best = new Float64Array(n).fill(Infinity), from = new Int32Array(n).fill(-1)
  const out: [number, number][] = []
  inT[0] = 1
  for (let j = 1; j < n; j++) { best[j] = w(0, j); from[j] = 0 }
  for (let it = 1; it < n; it++) {
    let m = -1
    for (let j = 0; j < n; j++) if (!inT[j] && (m < 0 || best[j] < best[m])) m = j
    inT[m] = 1; out.push([from[m], m])
    for (let j = 0; j < n; j++) if (!inT[j]) { const v = w(m, j); if (v < best[j]) { best[j] = v; from[j] = m } }
  }
  return out
}

/** Candidate plant sites on a coarse lattice: flat, dry, 80-600 m from water (cooling), near industry
 *  and roads, >= 350 m outside every settlement, spread over the map (farthest-point picking). */
function sitePlants(input: GridInput, n: number, sites: GridSite[], placed: Station[]): GridSite[] {
  if (n <= 0) return []
  const { grid: g, heights: h } = input
  const W = (g.cols - 1) * g.step, H = (g.rows - 1) * g.step, step = Math.max(150, Math.min(W, H) / 40)
  const cand: { x: number; z: number; s: number }[] = []
  for (let z = g.minZ + 300; z < g.minZ + H - 300; z += step) for (let x = g.minX + 300; x < g.minX + W - 300; x += step) {
    if (input.isWater(x, z)) continue
    if (sites.some((q) => q.kind !== 'industry' && Math.hypot(q.x - x, q.z - z) < q.r + 350)) continue
    if (placed.some((q) => Math.hypot(q.x - x, q.z - z) < 300)) continue
    if (input.avoid?.some((q) => Math.hypot(q.x - x, q.z - z) < q.r + 150)) continue
    if (padRelief(h, g, { x, z, yaw: 0, w: 70, d: 60 }) > 6) continue
    let wd = Infinity
    for (let k = 0; k < 16 && wd > 600; k++) for (const r of [80, 200, 400, 600]) {
      const a = (k / 16) * Math.PI * 2
      if (input.isWater(x + Math.sin(a) * r, z + Math.cos(a) * r)) { wd = Math.min(wd, r); break }
    }
    const ind = Math.min(Infinity, ...sites.filter((q) => q.kind === 'industry').map((q) => Math.hypot(q.x - x, q.z - z)))
    const rd = nearestRoad(input.roads, x, z).d
    if (rd > 600) continue
    const s = (wd <= 600 ? 3 : 0) + (ind < 1500 ? 2 : 0) + (rd < 200 ? 1 : 0) - padRelief(h, g, { x, z, yaw: 0, w: 70, d: 60 }) / 3
    cand.push({ x, z, s })
  }
  cand.sort((a, b) => b.s - a.s)
  const out: GridSite[] = []
  const spread = Math.min(W, H) / (n + 1)
  for (const c of cand) {
    if (out.length >= n) break
    if (out.some((q) => Math.hypot(q.x - c.x, q.z - c.z) < spread)) continue
    out.push({ id: `PLANT_${out.length + 1}`, x: c.x, z: c.z, kind: 'industry', r: 0 })
  }
  return out
}

/** Plan the whole grid. Flattens the station pads in `input.heights` (like the zones do). */
export function planGrid(input: GridInput, o: Partial<GridOptions> = {}): GridPlan {
  const opt = { ...GRID_DEFAULTS, ...o }
  const { heights: h, grid: g, roads } = input
  const style = opt.style
  const lines: GridLine[] = [], stations: Station[] = [], access: number[][] = [], unfed: string[] = []
  let failed = 0
  const sites = input.sites
  const keep = sites.map((s) => ({ id: s.id, x: s.x, z: s.z, r: s.kind === 'industry' ? s.r * 0.6 : s.r * 0.6 }))
  const ctx: PlaceCtx = { input, stations, keep }
  // heavy lines never cross a village centre; LV runs inside villages
  const centreOut: KeepOut[] = [...sites.filter((s) => s.kind !== 'industry').map((s) => ({ x: s.x, z: s.z, r: s.r * 0.5 })), ...(input.avoid ?? [])]
  // HV / EHV stay out of the villages and towns themselves (stations sit outside, at r + 40 m)
  const townOut: KeepOut[] = [...sites.filter((s) => s.kind !== 'industry').map((s) => ({ x: s.x, z: s.z, r: s.r * 0.9 })), ...(input.avoid ?? [])]
  const ob = new PowerObstacles(input.world ?? { roads: roads.map((pts) => ({ pts, half: 3 })) })
  ctx.ob = ob
  const bld = ob.hasBuildings || (input.world?.lots?.length ?? 0) > 0
  // wooden-pole lines follow the streets: LV, and the USSR MV (HV_03_Wooden)
  const follows = (k: PowerKind) => k === 'lv' || (k === 'mv' && style === 'ussr')
  const blockFor = (k: PowerKind) => {
    if (!bld) return undefined
    if (k === 'lv') return (x: number, z: number) => ob.bldDist(x, z, 1) === 0
    const r = CLEAR[k] + g.step * 0.5
    return (x: number, z: number) => ob.bldDist(x, z, r) < r || ob.inLot(x, z)
  }
  const loose = new Map<PowerKind, Float32Array>()
  const costLoose = (k: PowerKind) => { // retry field: houses forbidden, without their clearance (dense villages)
    let c = loose.get(k)
    if (!c) { c = buildPowerCost(h, g, { kind: k, isWater: input.isWater, roads: k === 'mv' || k === 'lv' ? roads : undefined, keepOut: k === 'lv' ? input.avoid : k === 'mv' ? centreOut : townOut, block: (x, z) => ob.bldDist(x, z, 1) === 0 }); loose.set(k, c) }
    return c
  }
  const costs = new Map<PowerKind, Float32Array>()
  const cost = (k: PowerKind) => {
    let c = costs.get(k)
    if (!c) { c = buildPowerCost(h, g, { kind: k, isWater: input.isWater, roads: k === 'mv' || k === 'lv' ? roads : undefined, keepOut: k === 'lv' ? input.avoid : k === 'mv' ? centreOut : townOut, block: blockFor(k) }); costs.set(k, c) }
    return c
  }
  let nid = 0
  const addStation = (kind: StationKind, site: GridSite, rings: number[], prefer: number | null, byGenerator = false): Station | null => {
    const dims = STATION_PREFABS[style][kind]
    const p = placeStation(ctx, site.x, site.z, rings, dims, prefer, site.id)
    if (!p) return null
    let y = 0
    for (const [x, z] of footprint(p.x, p.z, p.yaw, dims.w, dims.d, 0)) y += hAt(h, g, x, z) / 9
    const st: Station = { id: `PSTA_${kind.toUpperCase()}_${++nid}`, kind, site: site.id, x: p.x, z: p.z, yaw: p.yaw, w: dims.w, d: dims.d, h: dims.h, y, prefab: dims.prefab, byGenerator, ...(dims.off && { off: dims.off }) }
    flattenPad(h, g, st)
    stations.push(st)
    const rd = nearestRoad(roads, st.x, st.z)
    if (Number.isFinite(rd.x) && rd.d < 400) {
      const gx = st.x + Math.sin(st.yaw) * (st.d / 2 + 2), gz = st.z + Math.cos(st.yaw) * (st.d / 2 + 2)
      access.push([gx, gz, rd.x, rd.z])
    }
    return st
  }
  let lid = 0
  const fans = new Map<Station, number>() // lines already hung on each station (lead fan-out)
  const route = (kind: PowerKind, a: Station, b: Station | [number, number], tag: string): GridLine | null => {
    const bx = Array.isArray(b) ? b[0] : b.x, bz = Array.isArray(b) ? b[1] : b.z
    const spacing = POWER_STYLE[style][kind].spacing
    // ends: the station's real cable slots (powersmooth.ts STATION_ATTACH) + a lead point out of the yard;
    // EHV ends are the generator's own stations (centre)
    const lead = Math.max(12, Math.min(30, spacing * 0.4))
    const fan = (s: Station) => { const k = fans.get(s) ?? 0; fans.set(s, k + 1); return k }
    const A = kind === 'ehv' && a.byGenerator ? { at: [a.x, a.z] as [number, number], lead: null } : attachPoint(a, bx, bz, lead, fan(a))
    const B = Array.isArray(b) ? { at: b, lead: null } : kind === 'ehv' && b.byGenerator ? { at: [b.x, b.z] as [number, number], lead: null } : attachPoint(b, (A.lead ?? A.at)[0], (A.lead ?? A.at)[1], lead, fan(b))
    const [ax, az] = A.lead ?? A.at, [ex, ez] = B.lead ?? B.at
    const along = follows(kind) ? followRoads(ob, ax, az, ex, ez, spacing, Array.isArray(b)) : null
    if (along) {
      let path = along
      if (A.lead) path = [...A.at, ...path]
      if (B.lead) path = [...path, ...B.at]
      const poles = (bld ? clearSpans(ob, fixPoles(ob, placePoles(path, spacing)), spacing) : fixPoles(ob, placePoles(path, spacing)))
      let length = 0
      for (let i = 0; i + 3 < poles.length; i += 2) length += Math.hypot(poles[i + 2] - poles[i], poles[i + 3] - poles[i + 1])
      const it: GridLine = { kind, spacing, path: poles, poles, length, style, id: `POWER_${kind.toUpperCase()}_${++lid}`, from: a.id, to: Array.isArray(b) ? tag : b.id }
      lines.push(it)
      return it
    }
    let cf = cost(kind)
    let l = routePowerLine(h, g, ax, az, ex, ez, { kind, spacing, cost: cf, isWater: input.isWater })
    if (!l && bld) { cf = costLoose(kind); l = routePowerLine(h, g, ax, az, ex, ez, { kind, spacing, cost: cf, isWater: input.isWater }) }
    if (!l && bld) { cf = buildPowerCost(h, g, { kind, isWater: input.isWater, roads: kind === 'mv' || kind === 'lv' ? roads : undefined, keepOut: kind === 'lv' ? input.avoid : kind === 'mv' ? centreOut : townOut }); l = routePowerLine(h, g, ax, az, ex, ez, { kind, spacing, cost: cf, isWater: input.isWater }) } // last resort: as before (the validator flags it)
    if (!l) { failed++; return null }
    const clr = bld ? Math.min(CLEAR[kind], kind === 'lv' ? 1 : CLEAR[kind]) : 0
    // smoothing: no span under 45 % of the pole spacing, no near-straight kinks (the A* zigzag)
    const ok = (x0: number, z0: number, x1: number, z1: number) => {
      const n = Math.ceil(Math.hypot(x1 - x0, z1 - z0) / (g.step * 0.5))
      for (let k = 1; k < n; k++) {
        const x = x0 + ((x1 - x0) * k) / n, z = z0 + ((z1 - z0) * k) / n
        const c = Math.min(g.cols - 1, Math.max(0, Math.round((x - g.minX) / g.step))), r = Math.min(g.rows - 1, Math.max(0, Math.round((z - g.minZ) / g.step)))
        if (cf[r * g.cols + c] === Infinity) return false
      }
      return !clr || ob.spanBld(x0, z0, x1, z1, clr) >= clr
    }
    let path = smoothPath(l.path, spacing * 0.45, ok)
    if (A.lead) path = [...A.at, ...path]
    if (B.lead) path = [...path, ...B.at]
    let length = 0
    for (let i = 0; i + 3 < path.length; i += 2) length += Math.hypot(path[i + 2] - path[i], path[i + 3] - path[i + 1])
    const poles = (bld ? clearSpans(ob, fixPoles(ob, placePoles(path, spacing)), spacing) : fixPoles(ob, placePoles(path, spacing)))
    const it: GridLine = { ...l, path: poles, poles, length, style, id: `POWER_${kind.toUpperCase()}_${++lid}`, from: a.id, to: Array.isArray(b) ? tag : b.id }
    lines.push(it)
    return it
  }

  // 1. sources and transmission. Hubs = towns (+ the most remote villages while < 2), each with an
  //    HV->MV station on its edge. Plants (DieselPowerPlant) are sited on flat dry land close to water
  //    (cooling), industry and a road, away from villages and from each other; each has a step-up yard.
  const towns = sites.filter((s) => s.kind === 'town')
  const hubs = [...towns]
  const vil = sites.filter((s) => s.kind === 'village')
  while (hubs.length < 2 && vil.length > hubs.length) {
    let bi = -1, bd = -1
    for (const v of vil) if (!hubs.includes(v)) {
      const d = hubs.length ? Math.min(...hubs.map((q) => Math.hypot(q.x - v.x, q.z - v.z))) : Math.hypot(v.x, v.z)
      if (d > bd) { bd = d; bi = vil.indexOf(v) }
    }
    if (bi < 0) break
    hubs.push(vil[bi])
  }
  const nPlants = opt.plants === 'auto' ? Math.max(1, Math.min(3, Math.round(input.size / 6000))) : opt.plants
  const plantSites = sitePlants(input, nPlants, sites, stations)
  const ehvOn = opt.ehv === true || (opt.ehv === 'auto' && input.size >= 8000)
  const cxm = g.minX + ((g.cols - 1) * g.step) / 2, czm = g.minZ + ((g.rows - 1) * g.step) / 2
  const nodes: Station[] = [], isPlant = new Set<Station>()
  for (const ps of plantSites) {
    const pl = addStation('plant', ps, [0], null)
    if (!pl) continue
    // step-up yard beside the plant, on the side facing the map interior
    const yard = addStation('hv', { ...ps, r: 0 }, [45, 70, 95], Math.atan2(cxm - ps.x, czm - ps.z))
    if (yard) { nodes.push(yard); isPlant.add(yard) }
  }
  const hubSt = new Map<string, Station>()
  for (const hb of hubs) {
    const toward = Math.atan2(cxm - hb.x, czm - hb.z) // grid side: out of town toward the map interior
    const st = addStation('hv', hb, [hb.r + 40, hb.r + 80, hb.r + 140, hb.r + 220], toward)
    if (st) { hubSt.set(hb.id, st); nodes.push(st) } else unfed.push(hb.id)
  }
  // transmission mesh: MST + one extra link from every dead end to its nearest non-neighbour (N-1
  // redundancy, closed loops like real synthetic grids); plant-to-plant or long (> 4 km) links are EHV
  const dist = (a: number, b: number) => Math.hypot(nodes[a].x - nodes[b].x, nodes[a].z - nodes[b].z)
  const edges = mst(nodes.length, dist)
  if (nodes.length >= 3) {
    const deg = new Array(nodes.length).fill(0)
    for (const [a, b] of edges) { deg[a]++; deg[b]++ }
    const has = (a: number, b: number) => edges.some(([p, q]) => (p === a && q === b) || (p === b && q === a))
    for (let a = 0; a < nodes.length; a++) if (deg[a] === 1) {
      let bb = -1
      for (let b = 0; b < nodes.length; b++) if (b !== a && !has(a, b) && (bb < 0 || dist(a, b) < dist(a, bb))) bb = b
      if (bb >= 0) { edges.push([a, bb]); deg[a]++; deg[bb]++ }
    }
  }
  const bays = new Map<Station, number>()
  for (const [a, b] of edges) {
    const A = nodes[a], B = nodes[b]
    const ehv = ehvOn && ((isPlant.has(A) && isPlant.has(B)) || dist(a, b) > 4000)
    if (!ehv) { if (opt.hv) route('hv', A, B, ''); continue }
    // EHV_01 places a TransformerStation110kV_E_01_double at both ends itself: one bay per line, set
    // 60 m out of the yard and 45 m apart so several lines never stack two stations
    const bay = (S: Station, T: Station): Station | null => {
      const k = bays.get(S) ?? 0
      bays.set(S, k + 1)
      const a0 = Math.atan2(T.x - S.x, T.z - S.z) + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.45
      const site: GridSite = { id: S.site, x: S.x, z: S.z, kind: 'industry', r: 0 }
      return addStation('ehv', site, [60, 90, 120], a0, true)
    }
    const ba = bay(A, B), bb = bay(B, A)
    if (!ba || !bb) { failed++; continue }
    route('ehv', ba, bb, '')
  }
  const hs = nodes

  // 2. MV feeders: tree grown from the hub stations; each village / town / industry gets its own
  //    MV->LV transformer at its edge, facing the feeder; hamlets close to a transformer get LV only.
  const trafo = new Map<string, Station>()
  if (opt.mv && hs.length) {
    const rank = { town: 0, village: 0, industry: 0, hamlet: 1 }
    const targets = sites.filter((s) => s.kind !== 'hamlet' || opt.lv)
    const nodes: Station[] = [...hs]
    const todo = new Set(targets)
    while (todo.size) {
      let bt: GridSite | null = null, bn: Station | null = null, bc = Infinity
      for (const t of todo) for (const n of nodes) {
        const d = Math.hypot(t.x - n.x, t.z - n.z)
        const mx = (t.x + n.x) / 2, mz = (t.z + n.z) / 2
        const c = d * (nearestRoad(roads, mx, mz).d < 60 ? 0.85 : 1) + rank[t.kind] * 1e6 // road bonus; villages before hamlets
        if (c < bc) { bc = c; bt = t; bn = n }
      }
      if (!bt || !bn) break
      todo.delete(bt)
      if (bc % 1e6 > opt.mvMax) { unfed.push(bt.id); continue }
      // a hamlet close to a village transformer is fed by LV (step 3), a remote one gets its own kiosk
      if (bt.kind === 'hamlet' && [...trafo.values()].some((q) => Math.hypot(q.x - bt!.x, q.z - bt!.z) <= opt.lvMax)) continue
      const kind: StationKind = bt.kind === 'industry' ? 'ind' : 'mvlv'
      const pref = Math.atan2(bn.x - bt.x, bn.z - bt.z)
      const st = addStation(kind, bt, [bt.r * 0.75, bt.r * 0.9, bt.r * 1.05, bt.r * 1.25], pref)
      if (!st) { unfed.push(bt.id); continue }
      if (!route('mv', bn, st, '')) { unfed.push(bt.id); continue }
      trafo.set(bt.id, st)
      nodes.push(st)
    }
  }

  // 3. LV: from each village transformer along its streets (two runs to the far side), hamlets from
  //    the nearest transformer within lvMax
  if (opt.lv) {
    for (const s of sites) {
      const st = trafo.get(s.id)
      if (!st || s.kind === 'industry' || s.kind === 'hamlet') continue
      const ends: [number, number][] = []
      for (const p of roads) for (let i = 0; i + 1 < p.length; i += 2) {
        const x = p[i], z = p[i + 1]
        if (Math.hypot(x - s.x, z - s.z) > s.r * 0.85) continue
        ends.push([x, z])
      }
      ends.sort((a, b) => Math.hypot(b[0] - st.x, b[1] - st.z) - Math.hypot(a[0] - st.x, a[1] - st.z))
      const picked: [number, number][] = []
      for (const e of ends) {
        if (picked.length >= 2) break
        if (Math.hypot(e[0] - st.x, e[1] - st.z) < s.r * 0.6) break
        if (picked.some((q) => Math.hypot(q[0] - e[0], q[1] - e[1]) < s.r * 0.8)) continue
        // offset off the road axis so the poles stand on the verge
        const rd = nearestRoad(roads, e[0], e[1])
        picked.push([e[0] + Math.cos(rd.dir) * 8, e[1] - Math.sin(rd.dir) * 8])
      }
      if (!picked.length) picked.push([s.x + (s.x - st.x) * 0.5, s.z + (s.z - st.z) * 0.5])
      for (const e of picked) route('lv', st, e, s.id)
    }
    for (const s of sites) {
      if (s.kind !== 'hamlet') continue
      if (trafo.has(s.id)) continue // own kiosk: LV from it above
      let bs: Station | null = null, bd = Infinity
      for (const st of trafo.values()) { const d = Math.hypot(st.x - s.x, st.z - s.z); if (d < bd) { bd = d; bs = st } }
      if (!bs || bd > opt.lvMax) { if (opt.mv && !unfed.includes(s.id)) unfed.push(s.id); continue }
      if (!route('lv', bs, [s.x, s.z], s.id)) unfed.push(s.id)
    }
  }
  return { lines, stations, access, failed, unfed }
}

/** station entities for the export (EHV-end stations are made by their generator) */
export function stationEntities(stations: Station[]): ProjectEntity[] {
  return stations.filter((s) => !s.byGenerator).map((s) => {
    const [ox, oz] = s.off ?? [0, 0], c = Math.cos(s.yaw), n = Math.sin(s.yaw)
    return { id: s.id, prefab: s.prefab, x: s.x - (ox * c + oz * n), z: s.z - (-ox * n + oz * c), yaw: (-s.yaw * 180) / Math.PI }
  })
}
/** access tracks as dirt road shapes */
export function accessShapes(access: number[][], prefix = 'PSTA_ROAD'): ProjectShape[] {
  return access.map((pts, i) => ({ id: `${prefix}_${i + 1}`, kind: 'polyline', closed: false, points: pts, generator: ACCESS_ROAD_GEN }))
}

