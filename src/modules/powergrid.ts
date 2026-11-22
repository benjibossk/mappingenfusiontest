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
//   LV   PG_PowerLine_01_WoodenSmall (prefab 35 m, sent 45 m) | USSR: PG_PowerLine_LV_USSR_01 (40 m)
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
import { sanitizeRoadLine } from './roads'
import { CLEAR, PowerObstacles, clearSpans, fixPoles, followRoads, segDist, type PowerWorld } from './powerroads'
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

export interface GridSite { id: string; x: number; z: number; kind: 'town' | 'village' | 'hamlet' | 'industry'; r: number; farm?: boolean }
/** an isolated farm (worldgen FARM_*): one short LV drop, never its own MV feeder */
export const isFarm = (s: GridSite) => s.kind === 'hamlet' && (s.farm === true || s.id.startsWith('FARM_'))

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
  /** longest LV drop to an isolated farm (m), from an LV pole or a pole transformer on an MV line */
  farmMax: number
  /** longest LV run to a hamlet (m) */
  lvMax: number
  /** power plants (sources): 'auto' = 1 per ~6 km of map side, max 3; 0 = none (towns are the sources) */
  plants: number | 'auto'
  /** distribution inside settlements: 'auto' = towns and big villages underground (no pole past the
   *  entrance), hamlets and small villages one short overhead street run; 'overhead' everywhere; 'underground' everywhere */
  distrib: PowerDistrib
  /** auto: a village with more buildings than this is served underground */
  ugMin: number
}
export type PowerDistrib = 'auto' | 'overhead' | 'underground'
/** longest LV drop to a farm before an MV spur + pole transformer is preferred (POWERGRID_LOGIC.md) */
const FARM_LV = 300
/** LV star (POWERGRID_LOGIC §4): feeder radius cap and village radius per extra feeder */
const LV_STAR_R = 450, LV_STAR_STEP = 60
export const GRID_DEFAULTS: GridOptions = { style: 'eden', ehv: 'auto', hv: true, mv: true, lv: true, mvMax: 4000, lvMax: 900, farmMax: 600, plants: 'auto', distrib: 'auto', ugMin: 25 }

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

/** where a settlement's supply ends: its transformer at the entrance (or the entrance pole of a hamlet);
 *  `ug` = beyond it the distribution is underground (nothing placed) */
export interface Entrance { site: string; x: number; z: number; ug: boolean }
export interface GridPlan { lines: GridLine[]; stations: Station[]; access: number[][]; failed: number; unfed: string[]; entrances: Entrance[]; /** farm id -> how it is fed */ farms?: Record<string, 'lv' | 'pole-trafo'> }

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
    // nor on a village lane / any smoothed carriageway (input.roads are the raw main roads only; seed 21 audit: PSTA_MVLV_5 on SET_VILLAGE_1_LANE_3)
    if (ctx.ob && [[x, z], ...fp].some(([px, pz]) => ctx.ob!.roadEdge(px, pz) < 3)) continue
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
    // straight access track to the nearest road point it can reach without crossing a house (seed 21 live audit:
    // a town house on PSTA_ROAD_3 and a 5.7 m terrain step where the track was carved through its pad)
    const gate = () => [st.x + Math.sin(st.yaw) * (st.d / 2 + 2), st.z + Math.cos(st.yaw) * (st.d / 2 + 2)]
    const pick = (gx: number, gz: number) => {
      const clearTo = (x: number, z: number) => { if (!ob) return true; const L = Math.hypot(x - gx, z - gz); for (let t = 0; t <= L; t += 2) { const k = L ? t / L : 0; if (ob.bldDist(gx + (x - gx) * k, gz + (z - gz) * k, 6) < 6) return false } return true }
      const cands: { d: number; x: number; z: number }[] = []
      for (const pl of roads) for (let i = 0; i + 1 < pl.length; i += 2) { const d = Math.hypot(pl[i] - gx, pl[i + 1] - gz); if (d < 400) cands.push({ d, x: pl[i], z: pl[i + 1] }) }
      const rd = nearestRoad(roads, gx, gz)
      if (Number.isFinite(rd.x) && rd.d < 400) cands.unshift({ d: rd.d, x: rd.x, z: rd.z })
      cands.sort((a, b) => a.d - b.d)
      return cands.slice(0, 40).find((c) => clearTo(c.x, c.z))
    }
    let [gx, gz] = gate()
    let to = pick(gx, gz)
    // the door / dock side (+z of the prefab, where the gate is) faces the track's road end (seed 21 live: the track
    // reached a transformer's side, its doors turned away): 180 deg keeps the same footprint, 90 deg only on a
    // near-square one (TransformerSubstation_01 4.1 x 4.6), so the checked placement stays valid
    if (to && !dims.off) {
      const want = Math.atan2(to.x - st.x, to.z - st.z), off = (a: number) => Math.abs(Math.atan2(Math.sin(want - a), Math.cos(want - a)))
      const turns = Math.abs(st.w - st.d) < 1.5 ? [0, Math.PI / 2, Math.PI, -Math.PI / 2] : [0, Math.PI]
      const best = turns.reduce((b, t) => (off(st.yaw + t) < off(st.yaw + b) - 1e-6 ? t : b), 0)
      if (best) { st.yaw += best; [gx, gz] = gate(); to = pick(gx, gz) ?? to }
    }
    flattenPad(h, g, st)
    stations.push(st)
    if (to) access.push([gx, gz, to.x, to.z])
    return st
  }
  // the end pole of a station line: WALL_POLE m out of the cable slot along its lead, beside that wall. On the slot
  // itself it stood in the wall, and the per-point generator (one pole per shape point) or fixPoles pushed it out
  // in front of the doors (seed 21 live, TransformerStation_E_02)
  const WALL_POLE = 3
  const wallPole = (e: { at: [number, number]; lead: [number, number] | null }): [number, number] => {
    if (!e.lead) return e.at
    const dx = e.lead[0] - e.at[0], dz = e.lead[1] - e.at[1], L = Math.hypot(dx, dz)
    return L > WALL_POLE ? [e.at[0] + (dx / L) * WALL_POLE, e.at[1] + (dz / L) * WALL_POLE] : e.lead
  }
  const lvReach = (st: Station, s: { x: number; z: number }) => Math.hypot(st.x - s.x, st.z - s.z) <= opt.lvMax && ob.roadPath(st.x, st.z, s.x, s.z) !== null
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
      if (A.lead) path = [...wallPole(A), ...path]
      if (B.lead) path = [...path, ...wallPole(B)]
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
    if (A.lead) path = [...wallPole(A), ...path]
    if (B.lead) path = [...path, ...wallPole(B)]
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
    const targets = sites.filter((s) => !isFarm(s) && (s.kind !== 'hamlet' || opt.lv))
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
      // (reachable along the roads without a huge detour: an LV line hugs the road, vanilla 87 % of poles
      // within 10 m of one; seed 7 HAMLET_2 sat 850 m from a kiosk but 2.5 km away by road)
      if (bt.kind === 'hamlet' && [...trafo.values()].some((q) => lvReach(q, bt!))) continue
      const kind: StationKind = bt.kind === 'industry' ? 'ind' : 'mvlv'
      const pref = Math.atan2(bn.x - bt.x, bn.z - bt.z)
      const st = addStation(kind, bt, [bt.r * 0.75, bt.r * 0.9, bt.r * 1.05, bt.r * 1.25], pref)
      if (!st) { unfed.push(bt.id); continue }
      if (!route('mv', bn, st, '')) { unfed.push(bt.id); continue }
      trafo.set(bt.id, st)
      nodes.push(st)
    }
  }

  // 3. LV. Distribution model: the supply of each settlement ends at its entrance (the MV->LV transformer
  //    on its edge, facing the feeder, or for a hamlet the last pole of its LV run, on the road it arrives
  //    by). Past it: underground (towns, big villages - nothing placed) or one short overhead street run
  //    along the main street (small villages, hamlets) - never one drop per house.
  const entrances: Entrance[] = []
  const nb = (s: GridSite) => { let n = 0; for (const b of input.world?.buildings ?? []) if (b.length >= 2 && Math.hypot(b[0] - s.x, b[1] - s.z) < s.r) n++; return n }
  const ug = (s: GridSite) => opt.distrib === 'underground' || (opt.distrib === 'auto' && (s.kind === 'town' || (s.kind === 'village' && nb(s) > opt.ugMin)))
  const verge = (x: number, z: number): [number, number] => { // on the verge beside the road, clear of the houses
    const rd = nearestRoad(roads, x, z)
    if (!Number.isFinite(rd.x) || rd.d >= 30) return [x, z]
    const cand: [number, number][] = [8, -8, 6, -6, 11, -11].map((o) => [rd.x + Math.cos(rd.dir) * o, rd.z - Math.sin(rd.dir) * o])
    return cand.find(([cx, cz]) => ob.bldDist(cx, cz, 4) >= 3) ?? cand[0]
  }
  /** entrance of `s` seen from (fx, fz): the road point on its edge closest to the source */
  const entranceOf = (s: GridSite, fx: number, fz: number): [number, number] => {
    let bx = NaN, bz = NaN, bd = Infinity
    for (const p of roads) for (let i = 0; i + 1 < p.length; i += 2) {
      const dc = Math.hypot(p[i] - s.x, p[i + 1] - s.z)
      if (dc < s.r * 0.7 || dc > s.r * 1.2) continue
      const d = Math.hypot(p[i] - fx, p[i + 1] - fz)
      if (d < bd) { bd = d; bx = p[i]; bz = p[i + 1] }
    }
    if (!Number.isFinite(bx)) { const a = Math.atan2(fx - s.x, fz - s.z); bx = s.x + Math.sin(a) * s.r * 0.9; bz = s.z + Math.cos(a) * s.r * 0.9 }
    return verge(bx, bz)
  }
  for (const s of sites) { const st = trafo.get(s.id); if (st && s.kind !== 'industry') entrances.push({ site: s.id, x: st.x, z: st.z, ug: ug(s) }) }
  if (opt.lv) {
    for (const s of sites) {
      const st = trafo.get(s.id)
      if (!st || s.kind === 'industry' || ug(s)) continue
      // overhead: 'auto' = one short run down the main street (to <= 0.6 r past the centre), 'overhead' = two runs to the far side
      // POWERGRID_LOGIC §4: LV star, 1 to 4 feeders by village size, none longer than LV_STAR_R from the kiosk
      const star = Math.max(1, Math.min(4, Math.round(s.r / LV_STAR_STEP)))
      if (star > 1 && opt.distrib !== 'overhead') {
        // one feeder per angular sector around the kiosk, to the farthest road point of the sector
        const best: ([number, number, number] | null)[] = new Array(star).fill(null)
        for (const p of roads) for (let i = 0; i + 1 < p.length; i += 2) {
          const x = p[i], z = p[i + 1], dc = Math.hypot(x - s.x, z - s.z), dk = Math.hypot(x - st.x, z - st.z)
          if (dc > s.r * 0.85 || dk > LV_STAR_R || dk < s.r * 0.4) continue
          const k = Math.floor(((Math.atan2(z - st.z, x - st.x) + Math.PI) / (2 * Math.PI)) * star) % star
          if (!best[k] || dk > best[k]![2]) best[k] = [x, z, dk]
        }
        const picked = best.filter((b): b is [number, number, number] => !!b).map((b) => verge(b[0], b[1]))
        if (picked.length > 1) { for (const e of picked) route('lv', st, e, s.id); continue }
      }
      const runs = opt.distrib === 'overhead' ? 2 : 1, reach = opt.distrib === 'overhead' ? 0.85 : 0.6
      const ends: [number, number][] = []
      for (const p of roads) for (let i = 0; i + 1 < p.length; i += 2) {
        const x = p[i], z = p[i + 1]
        if (Math.hypot(x - s.x, z - s.z) > s.r * reach) continue
        ends.push([x, z])
      }
      ends.sort((a, b) => Math.hypot(b[0] - st.x, b[1] - st.z) - Math.hypot(a[0] - st.x, a[1] - st.z))
      const picked: [number, number][] = []
      for (const e of ends) {
        if (picked.length >= runs) break
        if (Math.hypot(e[0] - st.x, e[1] - st.z) < s.r * 0.6) break
        if (picked.some((q) => Math.hypot(q[0] - e[0], q[1] - e[1]) < s.r * 0.8)) continue
        picked.push(verge(e[0], e[1]))
      }
      if (!picked.length) picked.push([s.x + (s.x - st.x) * 0.3, s.z + (s.z - st.z) * 0.3])
      for (const e of picked) route('lv', st, e, s.id)
    }
    for (const s of sites) {
      if (s.kind !== 'hamlet' || isFarm(s)) continue
      if (trafo.has(s.id)) continue // own kiosk: LV from it above
      let bs: Station | null = null, bd = Infinity
      for (const st of trafo.values()) { const d = Math.hypot(st.x - s.x, st.z - s.z); if (d < bd && lvReach(st, s)) { bd = d; bs = st } }
      if (!bs || bd > opt.lvMax) { if (opt.mv && !unfed.includes(s.id)) unfed.push(s.id); continue }
      const u = ug(s), gate = entranceOf(s, bs.x, bs.z)
      // underground: the run stops at the entrance pole; overhead: on along the main street to the centre
      const l = route('lv', bs, u ? gate : verge(s.x, s.z), s.id)
      if (!l) { unfed.push(s.id); continue }
      let ex = l.poles[l.poles.length - 2], ez = l.poles[l.poles.length - 1]
      if (!u) for (let i = 0; i + 1 < l.poles.length; i += 2) if (Math.hypot(l.poles[i] - s.x, l.poles[i + 1] - s.z) <= s.r * 1.3) { ex = l.poles[i]; ez = l.poles[i + 1]; break }
      entrances.push({ site: s.id, x: ex, z: ez, ug: u })
    }
  }
  // 4. isolated farms: one short straight LV drop from the nearest LV pole; failing that a pole-mounted
  //    transformer (TransformerSubstation_01) beside the nearest MV pole, and the drop from it
  const farms: Record<string, 'lv' | 'pole-trafo'> = {}
  if (opt.lv) {
    const sp = POWER_STYLE[style].lv.spacing
    const dry = (x0: number, z0: number, x1: number, z1: number) => {
      const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 10))
      for (let k = 0; k <= n; k++) if (input.isWater(x0 + ((x1 - x0) * k) / n, z0 + ((z1 - z0) * k) / n)) return false
      return true
    }
    const nearestPole = (kind: PowerKind, x: number, z: number) => {
      let bx = NaN, bz = NaN, bd = Infinity
      for (const l of lines) if (l.kind === kind) for (let i = 0; i + 1 < l.poles.length; i += 2) {
        const d = Math.hypot(l.poles[i] - x, l.poles[i + 1] - z)
        if (d < bd && dry(l.poles[i], l.poles[i + 1], x, z)) { bd = d; bx = l.poles[i]; bz = l.poles[i + 1] }
      }
      return { x: bx, z: bz, d: bd }
    }
    for (const s of sites) {
      if (!isFarm(s)) continue
      // the drop runs along the road to the point nearest the farm, then the last span(s) to its yard
      const rd = nearestRoad(roads, s.x, s.z), onRoad = Number.isFinite(rd.x) && rd.d < opt.farmMax
      const [rx, rz] = onRoad ? verge(rd.x, rd.z) : verge(s.x, s.z)
      const yard = onRoad ? Math.max(0, rd.d - 15) : 0
      const fx = onRoad && yard > 15 ? rd.x + ((s.x - rd.x) / rd.d) * yard : rx, fz = onRoad && yard > 15 ? rd.z + ((s.z - rd.z) / rd.d) * yard : rz
      let src = nearestPole('lv', rx, rz), how: 'lv' | 'pole-trafo' = 'lv', from = 'LV'
      // POWERGRID_LOGIC: a farm under FARM_LV m from LV hangs on it, farther it takes an MV spur + pole transformer
      // (falls back to the long LV drop when no MV line is near enough)
      if (!(src.d <= FARM_LV) && opt.mv) {
        const m = nearestPole('mv', rx, rz)
        if (m.d <= opt.farmMax && m.d < src.d) {
          const dims = STATION_PREFABS.eden.mvlv // pole kiosk in both styles: a farm never gets a fenced yard
          let a = Math.atan2(rx - m.x, rz - m.z), tx = m.x + Math.sin(a) * 6, tz = m.z + Math.cos(a) * 6
          // the kiosk off the carriageway (5th live send: PSTA_POLE_8 1.7 m from an asphalt road): turn round the MV pole
          for (let k = 1; k <= 8 && ob.roadEdge(tx, tz) < 2.5; k++) { const b = a + ((k % 2 ? 1 : -1) * Math.ceil(k / 2) * Math.PI) / 4; const x = m.x + Math.sin(b) * 6, z = m.z + Math.cos(b) * 6; if (ob.roadEdge(x, z) >= 2.5) { a = b; tx = x; tz = z } }
          const st: Station = { id: `PSTA_POLE_${++nid}`, kind: 'mvlv', site: s.id, x: tx, z: tz, yaw: a, w: dims.w, d: dims.d, h: dims.h, y: hAt(h, g, tx, tz), prefab: dims.prefab }
          stations.push(st)
          src = { x: tx, z: tz, d: Math.hypot(rx - tx, rz - tz) }; how = 'pole-trafo'; from = st.id
        }
      }
      if (!(src.d <= opt.farmMax)) { unfed.push(s.id); continue }
      // along the road when one links both ends within 1.6x the straight distance, else straight across
      const alongFrom = (sx: number, sz: number, d: number) => {
        const a = d < sp * 0.5 ? null : followRoads(ob, sx, sz, rx, rz, sp, true)
        let al = 0
        if (a) for (let i = 0; i + 3 < a.length; i += 2) al += Math.hypot(a[i + 2] - a[i], a[i + 3] - a[i + 1])
        return a && al <= Math.max(d * 2.2, opt.farmMax * 1.5) ? a : null
      }
      // a pole transformer drop leaves the MV line straight to the farm: along the road it would double the MV corridor
      let along = how === 'pole-trafo' ? null : alongFrom(src.x, src.z, src.d)
      // a long drop with no road from the nearest pole: try the next LV poles (up to 8, within farmMax) for one the
      // roads link to the farm, so the run follows the road instead of crossing the fields (vanilla: 87 % of the
      // distribution poles stand within 10 m of a road, scripts/bench)
      if (!along && how === 'lv' && src.d > 2 * sp) {
        const cand: { x: number; z: number; d: number }[] = []
        for (const l of lines) if (l.kind === 'lv') for (let i = 0; i + 1 < l.poles.length; i += 2) {
          const d = Math.hypot(l.poles[i] - rx, l.poles[i + 1] - rz)
          if (d <= opt.farmMax && d > src.d) cand.push({ x: l.poles[i], z: l.poles[i + 1], d })
        }
        cand.sort((a, b) => a.d - b.d)
        for (const c of cand.slice(0, 8)) { const a = alongFrom(c.x, c.z, c.d); if (a) { src = c; along = a; break } }
      }
      // still no road path: the LV cost field (roads cheap) routes it, the straight drop stays the last resort
      const routed = !along && how === 'lv' && src.d > 2 * sp ? routePowerLine(h, g, src.x, src.z, rx, rz, { kind: 'lv', spacing: sp, cost: cost('lv'), isWater: input.isWater }) : null
      const head = along ? [src.x, src.z, ...along] : routed ? routed.path : [src.x, src.z, rx, rz]
      const path = fx !== rx || fz !== rz ? [...head, fx, fz] : head
      const poles = path.length <= 4 && src.d < sp * 0.5 ? path : fixPoles(ob, clearSpans(ob, fixPoles(ob, placePoles(path, sp)), sp))
      // the last pole (village entrance / farm yard) is never moved by fixPoles: off a house when one is that close
      // (seed 21 live audit: POWER_LV_9 end pole inside a house AABB)
      { const n = poles.length - 2
        if (bld && ob.bldDist(poles[n], poles[n + 1], 3) < 2.5) for (const r of [2, 4, 6, 8]) {
          let done = false
          for (let a = 0; a < 8 && !done; a++) { const x = poles[n] + Math.cos(a * Math.PI / 4) * r, z = poles[n + 1] + Math.sin(a * Math.PI / 4) * r; if (ob.poleOk(x, z)) { poles[n] = x; poles[n + 1] = z; done = true } }
          if (done) break
        } }
      let length = 0
      for (let i = 0; i + 3 < poles.length; i += 2) length += Math.hypot(poles[i + 2] - poles[i], poles[i + 3] - poles[i + 1])
      lines.push({ kind: 'lv', spacing: sp, path: poles, poles, length, style, id: `POWER_LV_${++lid}`, from, to: s.id })
      entrances.push({ site: s.id, x: fx, z: fz, ug: false })
      farms[s.id] = how
    }
  }
  // an LV run crossing an underground-served settlement goes underground there: its poles inside are
  // dropped and the line is split into its overhead pieces
  const ugDisc = sites.filter((s) => s.kind !== 'industry' && ug(s)).map((s) => ({ x: s.x, z: s.z, r: s.r * 0.75 }))
  if (ugDisc.length) for (let k = lines.length - 1; k >= 0; k--) {
    const l = lines[k]
    if (l.kind !== 'lv') continue
    const runs: number[][] = []
    let cur: number[] = []
    for (let i = 0; i + 1 < l.poles.length; i += 2) {
      const x = l.poles[i], z = l.poles[i + 1]
      if (ugDisc.some((d) => Math.hypot(x - d.x, z - d.z) < d.r)) { if (cur.length) runs.push(cur); cur = [] } else cur.push(x, z)
    }
    if (cur.length) runs.push(cur)
    if (runs.length === 1 && runs[0].length === l.poles.length) continue
    const parts = runs.filter((r) => r.length >= 4).map((r, j) => {
      let length = 0
      for (let i = 0; i + 3 < r.length; i += 2) length += Math.hypot(r[i + 2] - r[i], r[i + 3] - r[i + 1])
      return { ...l, path: r, poles: r, length, id: j ? `${l.id}_${j + 1}` : l.id }
    })
    lines.splice(k, 1, ...parts)
  }
  // 5. one corridor per road stretch: an LV run alongside an MV / HV line (< 25 m over >= 60 m) is dropped there;
  //    the part past the shared stretch is fed by a pole-mounted transformer on the nearest MV pole instead
  //    (seed 21: concrete MV and wooden LV side by side along the same road)
  if (opt.lv) {
    const kiosk = STATION_PREFABS.eden.mvlv
    const nearHigh = (x: number, z: number) => higherDist(lines, x, z) < PARALLEL_D
    for (let k = lines.length - 1; k >= 0; k--) {
      const l = lines[k]
      if (l.kind !== 'lv') continue
      const P = l.poles, n = P.length / 2
      const near = Array.from({ length: n }, (_, i) => nearHigh(P[i * 2], P[i * 2 + 1]))
      // shared stretches: runs of near poles whose spans add up to >= 60 m
      const cut = new Array<boolean>(n).fill(false)
      for (let i = 0; i < n;) {
        if (!near[i]) { i++; continue }
        let j = i, L = 0
        while (j + 1 < n && near[j + 1]) { L += Math.hypot(P[j * 2 + 2] - P[j * 2], P[j * 2 + 3] - P[j * 2 + 1]); j++ }
        if (L >= PARALLEL_MIN) for (let q = i; q <= j; q++) cut[q] = true
        i = j + 1
      }
      if (!cut.some(Boolean)) continue
      const parts: GridLine[] = []
      let cur: number[] = [], fedFromStart = true, part = 0
      const flush = () => {
        if (cur.length >= 4) {
          let pts = cur
          if (!fedFromStart) {
            // feed: pole kiosk beside the MV pole nearest the first pole of the piece
            const m = nearestPoleOf(lines, pts[0], pts[1])
            if (m) {
              const a = Math.atan2(pts[0] - m.x, pts[1] - m.z), tx = m.x + Math.sin(a) * 6, tz = m.z + Math.cos(a) * 6
              stations.push({ id: `PSTA_POLE_${++nid}`, kind: 'mvlv', site: l.to, x: tx, z: tz, yaw: a, w: kiosk.w, d: kiosk.d, h: kiosk.h, y: hAt(h, g, tx, tz), prefab: kiosk.prefab })
              pts = [tx, tz, ...pts]
            }
          }
          let length = 0
          for (let i = 0; i + 3 < pts.length; i += 2) length += Math.hypot(pts[i + 2] - pts[i], pts[i + 3] - pts[i + 1])
          parts.push({ ...l, path: pts, poles: pts, length, id: part ? `${l.id}_C${part + 1}` : l.id })
          part++
        }
        cur = []
      }
      for (let i = 0; i < n; i++) {
        if (cut[i]) { if (cur.length) flush(); fedFromStart = false; continue }
        cur.push(P[i * 2], P[i * 2 + 1])
      }
      flush()
      lines.splice(k, 1, ...parts)
    }
  }
  return { lines, stations, access, failed, unfed, entrances, farms }
}

const PARALLEL_D = 25, PARALLEL_MIN = 60
const HIGH = new Set(['mv', 'hv', 'ehv'])
function higherDist(lines: { kind: string; poles: number[] }[], x: number, z: number): number {
  let b = Infinity
  for (const l of lines) if (HIGH.has(l.kind)) for (let i = 0; i + 3 < l.poles.length; i += 2) b = Math.min(b, segDist(x, z, l.poles[i], l.poles[i + 1], l.poles[i + 2], l.poles[i + 3]))
  return b
}
function nearestPoleOf(lines: { kind: string; poles: number[] }[], x: number, z: number) {
  let r: { x: number; z: number } | null = null, b = Infinity
  for (const l of lines) if (l.kind === 'mv') for (let i = 0; i + 1 < l.poles.length; i += 2) { const d = Math.hypot(l.poles[i] - x, l.poles[i + 1] - z); if (d < b) { b = d; r = { x: l.poles[i], z: l.poles[i + 1] } } }
  return b < 80 ? r : null
}
/** metres of LV span running within `d` m of a line of another voltage (both span ends near it): the
 *  "parallel lines of different voltage" check of the pre-send and the bench */
export function parallelOverlap(lines: { kind: string; poles: number[] }[], d = PARALLEL_D): number {
  let L = 0
  for (const l of lines) if (l.kind === 'lv') for (let i = 0; i + 3 < l.poles.length; i += 2) {
    if (higherDist(lines, l.poles[i], l.poles[i + 1]) < d && higherDist(lines, l.poles[i + 2], l.poles[i + 3]) < d) L += Math.hypot(l.poles[i + 2] - l.poles[i], l.poles[i + 3] - l.poles[i + 1])
  }
  return L
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
  // same spline params as roads.ts roadShapes: 2-point tracks up to 180 m with the generator's own heightmap
  // adjustment were sent before (seed 21 crash right after "invalid segments on the road")
  return access.map((pts, i) => ({ id: `${prefix}_${i + 1}`, kind: 'spline', closed: false, points: sanitizeRoadLine(pts, 3), generator: ACCESS_ROAD_GEN,
    paramKeys: ['AdjustHeightMap', 'RoadWidth', 'AdjustHeightMapPriority'], paramValues: ['0', '4', '5'] }))
}


// ---- topology (POWERGRID_LOGIC.md §6): who feeds whom, for a future Bohemia grid system ------------------------
export type TopoNodeKind = 'plant' | 'ehvYard' | 'hvmv' | 'mvlv' | 'poleTrafo' | 'junction' | 'consumer'
export interface PowerTopology {
  nodes: { id: string; kind: TopoNodeKind; x: number; z: number; prefab?: string; entityName: string; powerSource: boolean; siteId?: string }[]
  edges: { id: string; level: 'EHV' | 'HV' | 'MV' | 'LV'; from: string; to: string; generatorEntity: string }[]
  feeders: { id: string; substation: string; edges: string[]; transformers: string[] }[]
  consumers: { siteId: string; transformer: string | null }[]
}
const TOPO_KIND: Record<StationKind, TopoNodeKind> = { plant: 'plant', ehv: 'ehvYard', hv: 'hvmv', mvlv: 'mvlv', ind: 'mvlv' }
/** directed graph source -> feeder -> transformer -> consumers of a plan; names = the exported entity names
 *  (stations PSTA_*, lines POWER_*), stable for a given seed */
export function gridTopology(plan: Pick<GridPlan, 'lines' | 'stations'>): PowerTopology {
  const nodes: PowerTopology['nodes'] = [], byId = new Map<string, PowerTopology['nodes'][number]>()
  const add = (n: PowerTopology['nodes'][number]) => { if (!byId.has(n.id)) { byId.set(n.id, n); nodes.push(n) } return n.id }
  for (const s of plan.stations) add({ id: s.id, kind: s.id.startsWith('PSTA_POLE') ? 'poleTrafo' : TOPO_KIND[s.kind], x: s.x, z: s.z, prefab: s.prefab, entityName: s.id, powerSource: s.kind === 'plant', siteId: s.site })
  const stationIds = new Set(plan.stations.map((s) => s.id))
  const nearestNode = (x: number, z: number) => { let b: string | null = null, bd = 12; for (const n of nodes) { const d = Math.hypot(n.x - x, n.z - z); if (d < bd) { bd = d; b = n.id } } return b }
  const edges: PowerTopology['edges'] = []
  for (const l of plan.lines) {
    const P = l.poles, n = P.length
    if (n < 4) continue
    const from = stationIds.has(l.from) ? l.from : nearestNode(P[0], P[1]) ?? add({ id: `JCT_${l.id}_A`, kind: 'junction', x: P[0], z: P[1], entityName: `JCT_${l.id}_A`, powerSource: false })
    const to = stationIds.has(l.to) ? l.to : add({ id: `SITE_${l.to}`, kind: 'consumer', x: P[n - 2], z: P[n - 1], entityName: `SITE_${l.to}`, powerSource: false, siteId: l.to })
    edges.push({ id: l.id, level: l.kind.toUpperCase() as 'EHV', from, to, generatorEntity: l.id })
  }
  // feeders: each MV edge leaving an HV/MV yard or a plant, followed downstream through the transformers it reaches
  const out = new Map<string, string[]>()
  for (const e of edges) (out.get(e.from) ?? out.set(e.from, []).get(e.from)!).push(e.id)
  const edge = new Map(edges.map((e) => [e.id, e]))
  const feeders: PowerTopology['feeders'] = []
  for (const e of edges) {
    if (e.level !== 'MV') continue
    const src = byId.get(e.from)
    if (!src || (src.kind !== 'hvmv' && src.kind !== 'plant')) continue
    const seen = new Set<string>(), tr = new Set<string>(), q = [e.id]
    while (q.length) {
      const id = q.pop()!
      if (seen.has(id)) continue
      seen.add(id)
      const t = byId.get(edge.get(id)!.to)
      if (t && (t.kind === 'mvlv' || t.kind === 'poleTrafo')) tr.add(t.id)
      if (edge.get(id)!.level === 'MV') for (const nx of out.get(edge.get(id)!.to) ?? []) if (edge.get(nx)!.level === 'MV') q.push(nx)
    }
    feeders.push({ id: `FEEDER_${feeders.length + 1}`, substation: src.id, edges: [...seen], transformers: [...tr] })
  }
  // consumers: the site of each transformer, and each site an LV edge ends at (fed by the edge's source transformer)
  const consumers = new Map<string, string | null>()
  for (const s of plan.stations) if ((s.kind === 'mvlv' || s.kind === 'ind') && s.site && !consumers.has(s.site)) consumers.set(s.site, s.id)
  for (const e of edges) { const t = byId.get(e.to); if (t?.kind === 'consumer' && t.siteId && !consumers.get(t.siteId)) consumers.set(t.siteId, byId.get(e.from)?.kind === 'junction' ? null : e.from) }
  return { nodes, edges, feeders, consumers: [...consumers].map(([siteId, transformer]) => ({ siteId, transformer })) }
}
