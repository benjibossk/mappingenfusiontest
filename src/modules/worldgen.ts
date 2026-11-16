// "Random world": one seed -> a whole map, by chaining the existing pure generators.
// Pure orchestration (no DOM): deterministic per seed. Each stage (and each zone inside a stage) draws
// from its own sub-seed, so changing one setting (e.g. the hamlet density) does not reshuffle the rest.
// Order: island relief -> rivers / lakes -> places (score map) -> airfield -> military -> road network
// -> industrial zones (they hook onto the main roads, so after the network) -> villages v2 -> power
// lines -> forests -> surfaces. The result is loaded into the normal steps (main.ts) to be tweaked.

import { WORLD } from '../data/worldParams'
import { fr } from '../i18n'
import { computeSurfaces, generateIsland, limitPerBlock, overfullBlocks, type Grid, type IslandParams, type SurfaceGrid } from './island'
import { computeRivers } from './hydro'
import { carveWater, placeLakes, traceRivers, type Water } from './water'
import { carveRoads, layBeds, type Road, type RoadType } from './roads'
import { SITE_RADIUS, buildNetwork, type Site, type SiteKind } from './network'
import { validate, type Issue } from './validate'
import { settleVillages } from './village'
import type { Placed, Square } from './settlements'
import { routePowerLine, type PowerKind, type PowerLine } from './power'
import { generateForests } from './forestgen'
import { rasterCover, type CoverArea } from './cover'
import { suggestAirfield } from './airfield'
import { suggestMilitary, type MilitaryKind } from './military'
import { suggestIndustrialSites, INDUSTRIAL_TYPES } from './industrial'
import { applyZones, makeAirfield, makeIndustrial, makeMilitary, zoneBlocked, zoneDisc, type ZoneItem } from './zones'

export interface WorldParams {
  seed: number
  size: number // 2048 / 4096 / 8192 m
  towns: number // density multipliers, 0..2 (1 = measured average)
  villages: number
  hamlets: number
  industry: number
  military: number
  airfield: boolean
  power: boolean
  forests: number
}
export const WORLD_DEFAULTS: Omit<WorldParams, 'seed'> = { size: 4096, towns: 1, villages: 1, hamlets: 1, industry: 1, military: 1, airfield: true, power: true, forests: 1 }

export const WORLD_STAGES = ['relief', 'water', 'sites', 'airfield', 'military', 'roads', 'industry', 'villages', 'power', 'forests', 'surfaces'] as const
export type WorldStage = (typeof WORLD_STAGES)[number]

export interface WorldArea extends CoverArea { id: string }
export interface WorldResult {
  params: WorldParams
  island: IslandParams
  grid: Grid
  heights: number[]
  waters: Water[]
  sites: Site[]
  roads: Road[]
  zones: ZoneItem[]
  settlement: { placed: Placed[]; lanes: Road[]; paths: Road[]; squares: Square[] }
  power: (PowerLine & { id: string })[]
  areas: WorldArea[]
  surfaces: SurfaceGrid[]
  issues: Issue[]
  overfull: number
}

/** 32-bit hash of the seed and a stage name (+ index): the sub-seed of one stage / zone */
export function subSeed(seed: number, stage: string, k = 0): number {
  let h = 2166136261 ^ (seed | 0)
  const s = `${stage}#${k}`
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  h = Math.imul(h ^ (h >>> 15), 2246822507)
  return ((h ^ (h >>> 13)) >>> 0) % 1000000 + 1
}
function rand01(seed: number, a: number, b: number) {
  let n = (a * 374761393 + b * 668265263 + seed * 2147483647) | 0
  n = Math.imul(n ^ (n >>> 13), 1274126177)
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296
}
function mulberry(seed: number) {
  let a = seed >>> 0
  return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}

export class Cancelled extends Error { constructor() { super('cancelled') } }

/** same chain as main.ts recompose(): water carving, zone platforms, road beds, then the runoff */
export function composeHeights(base: number[], g: Grid, waters: Water[], zones: ZoneItem[], roads: Road[]) {
  const h = base.slice()
  const wl = waters.length ? carveWater(h, g, waters) : undefined
  applyZones(h, g, zones)
  const beds = roads.length ? carveRoads(h, g, roads, { water: wl }) : null
  const auto = waters.some((w) => w.auto)
  const sim = computeRivers(h, g.cols, g.rows, g.step, { rain: WORLD.water.rain, windAngle: 0, threshold: WORLD.water.threshold, depth: auto ? 0 : 4 })
  if (beds && !auto) layBeds(h, beds)
  return { heights: h, sim }
}

function roadIdMaker() {
  const used = new Set<string>()
  return (type: RoadType) => {
    const slug = fr[('road.type.' + type) as keyof typeof fr].normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '')
    for (let n = 1; ; n++) { const id = `ROAD_${slug}_${n}`; if (!used.has(id)) { used.add(id); return id } }
  }
}

/** places on a score map: flat, low, near water / coast, away from the edge; spacing per kind */
export function placeWorldSites(h: ArrayLike<number>, g: Grid, river: Float32Array | undefined, p: WorldParams, seed: number): Site[] {
  const S = WORLD.sites
  let land = 0, top = 1
  for (let i = 0; i < h.length; i++) { if (h[i] > 0.5) land++; top = Math.max(top, h[i]) }
  const landKm2 = (land * g.step * g.step) / 1e6
  const localities = landKm2 * S.perKm2
  const want: Record<SiteKind, number> = {
    town: Math.max(p.towns > 0 ? 1 : 0, Math.round(localities * S.townShare * p.towns)),
    village: Math.round(localities * (1 - S.townShare) * p.villages),
    hamlet: Math.round(localities * S.hamletsPerLocality * p.hamlets),
  }
  const stride = Math.max(1, Math.round(50 / g.step)), edge = Math.round(S.edgeM / g.step)
  const at = (c: number, r: number) => h[Math.min(g.rows - 1, Math.max(0, r)) * g.cols + Math.min(g.cols - 1, Math.max(0, c))]
  const cand: { x: number; z: number; slope: number; base: number; c: number; r: number }[] = []
  const WR = Math.round(S.waterBonusM / g.step)
  for (let r = edge; r < g.rows - edge; r += stride) for (let c = edge; c < g.cols - edge; c += stride) {
    const y = at(c, r)
    if (y <= 2 || y > top * S.maxAltFrac) continue
    const k = Math.max(1, Math.round(20 / g.step))
    const slope = Math.max(Math.abs(at(c + k, r) - at(c - k, r)), Math.abs(at(c, r + k) - at(c, r - k))) / (2 * k * g.step)
    if (slope > S.maxSlope.hamlet) continue
    let water = 0
    for (let a = 0; a < 12; a++) {
      const ang = (a / 12) * Math.PI * 2
      for (const f of [0.3, 0.6, 1]) {
        const j = Math.round(r + Math.sin(ang) * WR * f) * g.cols + Math.round(c + Math.cos(ang) * WR * f)
        if (h[j] <= 0 || (river && river[j] > 0)) { water += 1 / f; break }
      }
    }
    cand.push({ x: g.minX + c * g.step, z: g.minZ + r * g.step, slope, c, r, base: (1 - slope / S.maxSlope.hamlet) * 2 + Math.min(water, 6) * 0.3 - y / top })
  }
  const dry = (x: number, z: number, R: number) => {
    for (let a = 0; a < 16; a++) for (const f of [0.35, 0.7, 1]) {
      const c = Math.round((x + Math.cos((a / 16) * Math.PI * 2) * R * f - g.minX) / g.step), r = Math.round((z + Math.sin((a / 16) * Math.PI * 2) * R * f - g.minZ) / g.step)
      if (c < 0 || r < 0 || c >= g.cols || r >= g.rows || h[r * g.cols + c] <= 0.5) return false
    }
    return true
  }
  const out: Site[] = []
  for (const kind of ['town', 'village', 'hamlet'] as SiteKind[]) {
    const ks = subSeed(seed, 'site-' + kind)
    // each kind has its own jitter: the towns stay put when the hamlet slider moves
    const list = cand.filter((q) => q.slope <= S.maxSlope[kind]).map((q) => ({ q, s: q.base + rand01(ks, q.c, q.r) * 1.2 })).sort((a, b) => b.s - a.s)
    let n = 0
    for (const { q } of list) {
      if (n >= want[kind]) break
      if (out.some((o) => { const d = Math.hypot(o.x - q.x, o.z - q.z); return d < S.minAny + SITE_RADIUS[o.kind] + SITE_RADIUS[kind] || (o.kind === kind && d < S.minDist[kind]) })) continue
      if (!dry(q.x, q.z, SITE_RADIUS[kind])) continue
      n++
      out.push({ id: `${kind.toUpperCase()}_${n}`, x: q.x, z: q.z, kind })
    }
  }
  return out
}

export async function generateWorld(p: WorldParams, cb: { progress?: (stage: WorldStage, i: number, n: number) => void; cancelled?: () => boolean } = {}): Promise<WorldResult> {
  const N = WORLD_STAGES.length
  const step = async (s: WorldStage) => {
    if (cb.cancelled?.()) throw new Cancelled()
    cb.progress?.(s, WORLD_STAGES.indexOf(s), N)
    await new Promise((r) => setTimeout(r, 0)) // let the page paint the progress
    if (cb.cancelled?.()) throw new Cancelled()
  }
  const seed = Math.floor(p.seed) || 1
  // 1. relief
  await step('relief')
  const isl: IslandParams = {
    size: p.size, step: Math.max(4, p.size / 512), maxHeight: WORLD.island.maxHeight(p.size), seaDepth: WORLD.island.seaDepth,
    landRatio: WORLD.island.landRatio, roughness: WORLD.island.roughness, seed: subSeed(seed, 'island'), islands: 1,
  }
  const island = generateIsland(isl)
  const g = island.grid, base = island.heights
  // 2. rivers + lakes (same as the Water step's "Generate")
  await step('water')
  const live = base.slice()
  const sim0 = computeRivers(live, g.cols, g.rows, g.step, { rain: WORLD.water.rain, windAngle: 0, threshold: WORLD.water.threshold, depth: 4 })
  const traced = traceRivers(live, g, sim0.flow, sim0.down, WORLD.water.threshold, WORLD.water.riverDepth)
  const { filled } = computeRivers(base.slice(), g.cols, g.rows, g.step, { rain: 1, windAngle: 0, threshold: 1e9, depth: 0 })
  const lk = placeLakes(base, filled, g, traced, { minArea: WORLD.water.lakeMinArea, sourceShare: WORLD.water.lakeSourceShare, depth: WORLD.water.riverDepth, seed: subSeed(seed, 'lakes') })
  const waters: Water[] = [
    ...lk.lakes.map((w, i) => ({ ...w, id: `WATER_LAKE_${i + 1}` })),
    ...lk.rivers.map((w, i) => ({ ...w, id: `WATER_RIVER_${i + 1}`, auto: true, carve: false })),
  ]
  let zones: ZoneItem[] = []
  let roads: Road[] = []
  let cur = composeHeights(base, g, waters, zones, roads)
  // 3. places
  await step('sites')
  let sites = placeWorldSites(cur.heights, g, cur.sim.river, p, seed)
  const siteDiscs = (extra: number) => sites.map((s) => ({ x: s.x, z: s.z, r: SITE_RADIUS[s.kind] + extra }))
  // 4. airfield: the flattest long strip, away from the places
  await step('airfield')
  const access: Site[] = [] // gates the road network must reach (not settled)
  if (p.airfield && p.size >= WORLD.airfield.minMapKm * 1000) {
    const size = WORLD.airfield.sizeFor(p.size)
    const s = suggestAirfield(cur.heights, g, { size, seaLevel: 0, keepOut: siteDiscs(WORLD.airfield.keepOutM), count: 1 })[0]
    if (s) {
      const a = makeAirfield(cur.heights, g, { id: 'AIR_1', size, x: s.x, z: s.z, yaw: s.yaw, seed: subSeed(seed, 'airfield') })
      zones.push(a)
      if (a.access) access.push({ id: 'ACCESS_AIR_1', x: a.access[0], z: a.access[1], kind: 'hamlet' })
    }
  }
  // 5. military: the main base near the airfield, outposts on high ground
  await step('military')
  const nMil = Math.min(4, Math.round(p.military * WORLD.military.perMap4km * (p.size / 4096) ** 2))
  for (let k = 0; k < nMil; k++) {
    const keep = [...siteDiscs(WORLD.military.keepOutM), ...zones.map((z) => { const d = zoneDisc(z); return { ...d, r: d.r + 150 } })]
    // the main base needs a big flat ground: on a small or steep island fall back to an outpost, then a checkpoint
    let kind: MilitaryKind = k === 0 ? 'main' : 'outpost', list = suggestMilitary(cur.heights, g, { kind, seaLevel: 0, keepOut: keep, count: 8 })
    if (!list.length && kind === 'main') list = suggestMilitary(cur.heights, g, { kind: (kind = 'outpost'), seaLevel: 0, keepOut: keep, count: 8 })
    if (!list.length) list = suggestMilitary(cur.heights, g, { kind: (kind = 'checkpoint'), seaLevel: 0, keepOut: keep, count: 8 })
    const air = zones.find((z) => z.kind === 'airfield')
    const r = mulberry(subSeed(seed, 'military', k))
    let pick = list[Math.floor(r() * Math.min(3, list.length))]
    if (kind === 'main' && air) pick = list.find((q) => Math.hypot(q.x - air.x, q.z - air.z) < WORLD.military.nearAirfieldM(p.size)) ?? pick
    if (!pick) break
    const m = makeMilitary(cur.heights, g, { id: `MIL_${k + 1}`, kind, x: pick.x, z: pick.z, yaw: pick.yaw, seed: subSeed(seed, 'military', k) })
    zones.push(m)
    if (m.access) access.push({ id: `ACCESS_MIL_${k + 1}`, x: m.access[0], z: m.access[1], kind: 'hamlet' })
  }
  cur = composeHeights(base, g, waters, zones, roads)
  // 6. road network (places + zone gates)
  await step('roads')
  const net = { sites: sites.length, spacing: 300, maxSlope: WORLD.roads.maxSlope, seed: subSeed(seed, 'roads'), main: WORLD.roads.main as RoadType, minor: WORLD.roads.minor as RoadType, lane: WORLD.roads.lane as RoadType }
  const rid = roadIdMaker()
  const linked = [...sites, ...access.filter((a) => a.x > g.minX && a.z > g.minZ && a.x < g.minX + (g.cols - 1) * g.step && a.z < g.minZ + (g.rows - 1) * g.step)]
  roads = linked.length >= 2 ? buildNetwork(cur.heights, g, cur.sim.river, linked, net, []) : []
  for (const r of roads) { r.auto = true; r.id = rid(r.type) }
  cur = composeHeights(base, g, waters, zones, roads)
  const steep = new Set(validate({ roads, sites, settled: [], refusedGaps: [], heights: cur.heights, grid: g }).filter((i) => i.kind === 'steepRoad').map((i) => i.id))
  if (steep.size) { roads = roads.filter((r) => !steep.has(r.id)); cur = composeHeights(base, g, waters, zones, roads) }
  // a place no road reaches is dropped (the checker would flag it)
  const isolated = new Set(validate({ roads, sites, settled: [], refusedGaps: [], heights: cur.heights, grid: g }).filter((i) => i.kind === 'isolated').map((i) => i.id))
  sites = sites.filter((s) => !isolated.has(s.id))
  // 7. industrial zones: near the towns, along a main road
  await step('industry')
  const towns = sites.filter((s) => s.kind === 'town').concat(sites.filter((s) => s.kind === 'village'))
  const nInd = Math.min(WORLD.industry.maxZones, Math.round(p.industry * WORLD.industry.perTown * Math.max(1, sites.filter((s) => s.kind === 'town').length)))
  const isWater = (x: number, z: number) => {
    const c = Math.round((x - g.minX) / g.step), r = Math.round((z - g.minZ) / g.step)
    return (cur.heights[r * g.cols + c] ?? 0) <= 0.5
  }
  const hAt = (x: number, z: number) => {
    const c = Math.min(g.cols - 1, Math.max(0, Math.round((x - g.minX) / g.step))), r = Math.min(g.rows - 1, Math.max(0, Math.round((z - g.minZ) / g.step)))
    return cur.heights[r * g.cols + c]
  }
  const mainRoads = roads.filter((r) => r.type === net.main || r.type === net.minor)
  for (let k = 0, ti = 0; k < nInd && ti < towns.length; ti++) {
    const t = towns[ti], r = mulberry(subSeed(seed, 'industry', k))
    const type = INDUSTRIAL_TYPES[Math.floor(r() * 3)] // factory / depot / quarry ... the first three read best near a town
    const D = WORLD.industry.searchM
    const list = suggestIndustrialSites(hAt, mainRoads.length ? mainRoads : roads, {
      type, size: WORLD.industry.size, n: 3, isWater,
      bounds: { minX: Math.max(g.minX, t.x - D), minZ: Math.max(g.minZ, t.z - D), maxX: Math.min(g.minX + (g.cols - 1) * g.step, t.x + D), maxZ: Math.min(g.minZ + (g.rows - 1) * g.step, t.z + D) },
      villages: [...siteDiscs(60), ...zones.map(zoneDisc)],
    })
    const s = list.find((q) => !zones.some((z) => { const d = zoneDisc(z); return Math.hypot(d.x - q.x, d.z - q.z) < d.r + 200 }))
    if (!s) continue
    const zn = makeIndustrial(cur.heights, g, roads, { id: `IND_${k + 1}`, type, x: s.x, z: s.z, seed: subSeed(seed, 'industry', k), size: WORLD.industry.size })
    if (!zn.entities.length) continue
    zones.push(zn)
    k++
  }
  cur = composeHeights(base, g, waters, zones, roads)
  // 8. villages v2
  await step('villages')
  const allRoads = [...roads, ...zones.flatMap((z) => z.roads)]
  const vr = settleVillages(sites, allRoads, waters, cur.heights, g, { seed: subSeed(seed, 'villages'), density: 1, variant: 'auto', blocked: zoneBlocked(zones) })
  const settlement = { placed: vr.placed, lanes: vr.lanes, paths: vr.paths, squares: vr.squares }
  // 9. power lines: HV tree between towns and villages, LV to the hamlets along the roads
  await step('power')
  const power: (PowerLine & { id: string })[] = []
  if (p.power) {
    const h = cur.heights
    const keepOut = (except: Site[]) => sites.filter((q) => !except.includes(q)).map((q) => ({ x: q.x, z: q.z, r: SITE_RADIUS[q.kind] * 0.6 })).concat(zones.map(zoneDisc))
    const pid = (kind: PowerKind) => { for (let n = 1; ; n++) if (!power.some((l) => l.id === `POWER_${kind.toUpperCase()}_${n}`)) return `POWER_${kind.toUpperCase()}_${n}` }
    const hubs = sites.filter((s) => s.kind !== 'hamlet')
    if (hubs.length >= 2) {
      const inT = [hubs[0]], out = hubs.slice(1)
      while (out.length) {
        let bi = 0, bj = 0, bd = Infinity
        inT.forEach((a, i) => out.forEach((b, j) => { const d = Math.hypot(a.x - b.x, a.z - b.z); if (d < bd) { bd = d; bi = i; bj = j } }))
        const a = inT[bi], b = out.splice(bj, 1)[0]
        inT.push(b)
        const l = routePowerLine(h, g, a.x, a.z, b.x, b.z, { kind: 'hv', isWater, keepOut: keepOut([a, b]) })
        if (l) power.push({ ...l, id: pid('hv') })
      }
    }
    const roadPts = allRoads.map((r) => r.pts)
    for (const v of sites) {
      if (hubs.length >= 2 && hubs.includes(v)) continue
      let bx = NaN, bz = NaN, bd = Infinity
      for (const l of power) for (let i = 0; i + 1 < l.poles.length; i += 2) {
        const d = Math.hypot(l.poles[i] - v.x, l.poles[i + 1] - v.z)
        if (d < bd) { bd = d; bx = l.poles[i]; bz = l.poles[i + 1] }
      }
      if (!Number.isFinite(bx) || bd > WORLD.power.lvMax || bd < SITE_RADIUS[v.kind] * 0.5) continue
      const l = routePowerLine(h, g, bx, bz, v.x, v.z, { kind: 'lv', isWater, roads: roadPts, keepOut: keepOut([v]) })
      if (l) power.push({ ...l, id: pid('lv') })
    }
  }
  // 10. forests (none over a zone)
  await step('forests')
  const discs = zones.map(zoneDisc)
  const areas: WorldArea[] = p.forests > 0
    ? generateForests(cur.heights, g, { seed: subSeed(seed, 'forests'), cover: Math.min(0.9, WORLD.vegetation.forestCover * p.forests), sites })
      .filter((f) => { for (let i = 0; i + 1 < f.pts.length; i += 2) if (discs.some((d) => Math.hypot(f.pts[i] - d.x, f.pts[i + 1] - d.z) < d.r + 30)) return false; return true })
      .map((f, k) => ({ id: `FOREST_GEN_${k + 1}`, kind: 'forest' as const, leaf: f.leaf, pts: f.pts }))
    : []
  // 11. surfaces (5 per block at most)
  await step('surfaces')
  let surfaces = computeSurfaces(g, cur.heights, isl.maxHeight, cur.sim.river, rasterCover(g, areas))
  if (overfullBlocks(surfaces)) limitPerBlock(surfaces)
  const issues = validate({ roads, sites, settled: settlement.placed, refusedGaps: [], heights: cur.heights, grid: g })
  return { params: p, island: isl, grid: g, heights: cur.heights, waters, sites, roads, zones, settlement, power, areas, surfaces, issues, overfull: overfullBlocks(surfaces) }
}
