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
import { carveWater, placeLakes, traceRivers, WATER_TYPES, type Water } from './water'
import { carveRoads, centreLine, isPaved, layBeds, roadHalf, roadProfile, type Road, type RoadType } from './roads'
import { connectIslands, roadIslands } from './roadgraph'
import { findCrossings, planBridge } from './bridges'
import { GENERATORS, type ProjectEntity } from '../project'
import { SITE_RADIUS, buildNetwork, maxGrade, routeLink, worstGrade, type Site, type SiteKind } from './network'
import { validate, type Issue } from './validate'
import { settleVillages, type VillageParcel } from './village'
import type { Placed, Square } from './settlements'
import { routePowerLine, type PowerKind, type PowerLine } from './power'
import type { Feature, Polygon } from 'geojson'
import { generateForests } from './forestgen'
import { generateCampaign, type CampaignResult } from './campaign'
import { mergeForestPatches } from './forestMerge'
import { clipPlots, plotHedges, pointObstacle, roadObstacles } from './zonefill'
import { rasterCover, type CoverArea } from './cover'
import { suggestAirfield } from './airfield'
import { suggestMilitary, type MilitaryKind } from './military'
import { suggestIndustrialSites, INDUSTRIAL_TYPES, pointInPoly } from './industrial'
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
  roadsV2?: boolean // road network V2 finish (docs/ROAD_NETWORK_V2.md), default true
  biome?: string // BiomeId (docs/BIOMES_LIBRARY.md): forests and village parcels; default Everon = unchanged
}
export const WORLD_DEFAULTS: Omit<WorldParams, 'seed'> = { size: 4096, towns: 1, villages: 1, hamlets: 1, industry: 1, military: 1, airfield: true, power: true, forests: 1 }

export const WORLD_STAGES = ['relief', 'water', 'sites', 'airfield', 'military', 'roads', 'industry', 'villages', 'power', 'forests', 'surfaces'] as const
export type WorldStage = (typeof WORLD_STAGES)[number]

export interface WorldArea extends CoverArea { id: string }
export interface WorldResult {
  /** countryside around the villages (Tanin AgriFieldGenerator method): plots + hedges */
  campaign?: CampaignResult
  params: WorldParams
  island: IslandParams
  grid: Grid
  heights: number[]
  waters: Water[]
  sites: Site[]
  roads: Road[]
  zones: ZoneItem[]
  settlement: { placed: Placed[]; lanes: Road[]; paths: Road[]; squares: Square[]; tried?: number; housed?: number; parcels?: VillageParcel[] }
  power: (PowerLine & { id: string })[]
  areas: WorldArea[]
  surfaces: SurfaceGrid[]
  issues: Issue[]
  overfull: number
  /** V2 valley bridges (decks + piers) for the roads' `spans`; the river crossings stay with splitAtWater at export */
  bridges?: ProjectEntity[]
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
  const sim = computeRivers(h, g.cols, g.rows, g.step, { rain: WORLD.water.rain, windAngle: 0, threshold: auto ? riverThreshold(g.step) : WORLD.water.threshold, depth: auto ? 0 : 4 })
  if (beds && !auto) layBeds(h, beds)
  return { heights: h, sim, wet: wl?.wet }
}

/** river threshold in grid cells for the generated world: a catchment area, whatever the grid step */
export const riverThreshold = (step: number) => Math.round((WORLD.water.catchmentKm2 * 1e6) / (step * step))

const WORLD_BRIDGE = { clear: 6, minLen: 20 } // valley bridge: bed > 6 m over the ground on >= 20 m

function roadIdMaker() {
  const used = new Set<string>()
  return (type: RoadType) => {
    const slug = fr[('road.type.' + type) as keyof typeof fr].normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '')
    for (let n = 1; ; n++) { const id = `ROAD_${slug}_${n}`; if (!used.has(id)) { used.add(id); return id } }
  }
}

/** routePowerLine on a window of the grid around both ends (cost fields are per line: the full 512² grid
 *  made the power step the slowest one at 8 km). Same result as long as the route stays inside the window. */
function routePowerWindow(h: ArrayLike<number>, g: Grid, ax: number, az: number, bx: number, bz: number, o: Parameters<typeof routePowerLine>[6]) {
  const m = Math.max(400, Math.hypot(bx - ax, bz - az) * 0.5)
  const c0 = Math.max(0, Math.floor((Math.min(ax, bx) - m - g.minX) / g.step)), c1 = Math.min(g.cols - 1, Math.ceil((Math.max(ax, bx) + m - g.minX) / g.step))
  const r0 = Math.max(0, Math.floor((Math.min(az, bz) - m - g.minZ) / g.step)), r1 = Math.min(g.rows - 1, Math.ceil((Math.max(az, bz) + m - g.minZ) / g.step))
  const cols = c1 - c0 + 1, rows = r1 - r0 + 1
  const sub = new Float32Array(cols * rows)
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) sub[r * cols + c] = h[(r + r0) * g.cols + c + c0]
  const w: Grid = { ...g, minX: g.minX + c0 * g.step, minZ: g.minZ + r0 * g.step, cols, rows }
  const x0 = w.minX - 200, z0 = w.minZ - 200, x1 = w.minX + cols * g.step + 200, z1 = w.minZ + rows * g.step + 200
  const inBox = (p: number[]) => { for (let i = 0; i + 1 < p.length; i += 2) if (p[i] > x0 && p[i] < x1 && p[i + 1] > z0 && p[i + 1] < z1) return true; return false }
  const roads = o.roads?.filter(inBox), keepOut = o.keepOut?.filter((q) => q.x + q.r > x0 && q.x - q.r < x1 && q.z + q.r > z0 && q.z - q.r < z1)
  return routePowerLine(sub, w, ax, az, bx, bz, { ...o, roads, keepOut })
}

/** lake shore margin (m): nothing is built or routed closer to a lake outline than this */
export const LAKE_MARGIN_M = 35

/** cells inside a lake outline, or within `margin` m of it (the carved wet cells are only the deep middle) */
export function lakeMask(g: Grid, waters: Water[], margin = LAKE_MARGIN_M): Uint8Array {
  const m = new Uint8Array(g.cols * g.rows)
  for (const w of waters) {
    if (!WATER_TYPES[w.type].closed || w.pts.length < 6) continue
    const p = w.pts
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity
    for (let i = 0; i + 1 < p.length; i += 2) { x0 = Math.min(x0, p[i]); x1 = Math.max(x1, p[i]); z0 = Math.min(z0, p[i + 1]); z1 = Math.max(z1, p[i + 1]) }
    const c0 = Math.max(0, Math.floor((x0 - margin - g.minX) / g.step)), c1 = Math.min(g.cols - 1, Math.ceil((x1 + margin - g.minX) / g.step))
    const r0 = Math.max(0, Math.floor((z0 - margin - g.minZ) / g.step)), r1 = Math.min(g.rows - 1, Math.ceil((z1 + margin - g.minZ) / g.step))
    const n = p.length / 2
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
      const k = r * g.cols + c
      if (m[k]) continue
      const x = g.minX + c * g.step, z = g.minZ + r * g.step
      if (pointInPoly(p, x, z)) { m[k] = 1; continue }
      for (let i = 0, j = n - 1; i < n; j = i++) {
        const ax = p[j * 2], az = p[j * 2 + 1], dx = p[i * 2] - ax, dz = p[i * 2 + 1] - az
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)))
        if (Math.hypot(x - ax - t * dx, z - az - t * dz) < margin) { m[k] = 1; break }
      }
    }
  }
  return m
}

/** heights with the lake mask sunk under the sea: every placement / router that keeps off the sea keeps off the lakes */
function lakeAsSea(h: number[], mask: Uint8Array): number[] {
  const o = h.slice()
  for (let i = 0; i < o.length; i++) if (mask[i]) o[i] = -1
  return o
}

/** a footprint disc touches the water mask (sea, lakes + margin, river cells) */
function discWet(g: Grid, wet: (i: number) => boolean, x: number, z: number, R: number) {
  for (let a = 0; a < 16; a++) for (const f of [0, 0.35, 0.7, 1]) {
    const c = Math.round((x + Math.cos((a / 16) * Math.PI * 2) * R * f - g.minX) / g.step), r = Math.round((z + Math.sin((a / 16) * Math.PI * 2) * R * f - g.minZ) / g.step)
    if (c < 0 || r < 0 || c >= g.cols || r >= g.rows || wet(r * g.cols + c)) return true
  }
  return false
}

/** farmstead spots: flat dry land 200-900 m off the roads, away from places and zones, spaced out (random order) */
function placeFarms(h: ArrayLike<number>, g: Grid, roads: Road[], sites: Site[], zones: ZoneItem[], want: number, seed: number): Site[] {
  const F = WORLD.farms
  if (want <= 0) return []
  const r = mulberry(seed)
  const pts: number[] = []
  for (const rd of roads) for (let i = 2; i + 1 < rd.pts.length; i += 2) {
    const n = Math.ceil(Math.hypot(rd.pts[i] - rd.pts[i - 2], rd.pts[i + 1] - rd.pts[i - 1]) / 40)
    for (let k = 0; k < n; k++) pts.push(rd.pts[i - 2] + ((rd.pts[i] - rd.pts[i - 2]) * k) / n, rd.pts[i - 1] + ((rd.pts[i + 1] - rd.pts[i - 1]) * k) / n)
  }
  const at = (x: number, z: number) => h[Math.min(g.rows - 1, Math.max(0, Math.round((z - g.minZ) / g.step))) * g.cols + Math.min(g.cols - 1, Math.max(0, Math.round((x - g.minX) / g.step)))]
  const discs = zones.map(zoneDisc)
  const cand: { x: number; z: number; k: number }[] = []
  const edge = WORLD.sites.edgeM, W = (g.cols - 1) * g.step, H = (g.rows - 1) * g.step
  for (let z = g.minZ + edge; z < g.minZ + H - edge; z += F.gridM) for (let x = g.minX + edge; x < g.minX + W - edge; x += F.gridM) {
    const qx = x + (r() - 0.5) * F.gridM, qz = z + (r() - 0.5) * F.gridM, y = at(qx, qz)
    if (y <= 3) continue
    const sl = Math.max(Math.abs(at(qx + 20, qz) - at(qx - 20, qz)), Math.abs(at(qx, qz + 20) - at(qx, qz - 20))) / 40
    if (sl > F.maxSlope) continue
    let dry = true
    for (let a = 0; a < 8 && dry; a++) if (at(qx + Math.cos(a * 0.785) * 60, qz + Math.sin(a * 0.785) * 60) <= 1) dry = false
    if (!dry) continue
    if (sites.some((s) => Math.hypot(s.x - qx, s.z - qz) < SITE_RADIUS[s.kind] + F.siteGapM)) continue
    if (discs.some((d) => Math.hypot(d.x - qx, d.z - qz) < d.r + 120)) continue
    let dr = Infinity
    for (let i = 0; i + 1 < pts.length; i += 2) { const d = Math.hypot(pts[i] - qx, pts[i + 1] - qz); if (d < dr) dr = d }
    if (dr < F.roadM[0] || dr > F.roadM[1]) continue
    cand.push({ x: qx, z: qz, k: r() })
  }
  cand.sort((a, b) => a.k - b.k)
  const out: Site[] = []
  for (const q of cand) {
    if (out.length >= want) break
    if (out.some((o) => Math.hypot(o.x - q.x, o.z - q.z) < F.spacingM)) continue
    out.push({ id: `FARM_${out.length + 1}`, x: q.x, z: q.z, kind: 'hamlet' })
  }
  return out
}

/** places on a score map: flat, low, near water / coast, away from the edge; spacing per kind */
export function placeWorldSites(h: ArrayLike<number>, g: Grid, river: Float32Array | undefined, p: WorldParams, seed: number, wet?: Uint8Array): Site[] {
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
      // sea, and lakes / rivers (wet cells): a place must not sit in the water
      if (c < 0 || r < 0 || c >= g.cols || r >= g.rows || h[r * g.cols + c] <= 0.5 || (wet && wet[r * g.cols + c])) return false
    }
    return true
  }
  const out: Site[] = []
  for (const kind of ['town', 'village', 'hamlet'] as SiteKind[]) {
    const ks = subSeed(seed, 'site-' + kind)
    // each kind has its own jitter: the towns stay put when the hamlet slider moves
    // houses need flat lots over the whole footprint, not only at the centre: mean grade on two rings
    const R = SITE_RADIUS[kind] / g.step, k2 = Math.max(1, Math.round(20 / g.step))
    const spread = (q: { c: number; r: number }) => {
      let t = 0, n = 0
      for (const f of [0.45, 0.9]) for (let a = 0; a < 8; a++) {
        const c = Math.round(q.c + Math.cos(a * 0.785) * R * f), r = Math.round(q.r + Math.sin(a * 0.785) * R * f)
        t += Math.max(Math.abs(at(c + k2, r) - at(c - k2, r)), Math.abs(at(c, r + k2) - at(c, r - k2))) / (2 * k2 * g.step); n++
      }
      return t / n
    }
    const list = cand.filter((q) => q.slope <= S.maxSlope[kind]).map((q) => {
      const sp = kind === 'hamlet' ? q.slope : spread(q)
      return { q, sp, s: q.base + rand01(ks, q.c, q.r) * 1.2 - (sp / S.maxSlope[kind]) * S.spreadWeight }
    }).filter((x) => x.sp <= S.maxSlope[kind] * 1.3).sort((a, b) => b.s - a.s)
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

export async function generateWorld(p: WorldParams, cb: { progress?: (stage: WorldStage, i: number, n: number, f?: number) => void; cancelled?: () => boolean } = {}): Promise<WorldResult> {
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
  // [M] real maps carry a few streams fed by a real catchment, not one per gully: the threshold is a catchment
  // area (km²) turned into grid cells, courses shorter than minLen are dropped, and only the longest ones are kept
  // (tributaries are traced after the course they join, so cutting the list never orphans one)
  const W = WORLD.water
  let landCells = 0
  for (let i = 0; i < base.length; i++) if (base[i] > 0.5) landCells++
  const landKm2 = (landCells * g.step * g.step) / 1e6
  const thr = riverThreshold(g.step)
  const sim0 = computeRivers(live, g.cols, g.rows, g.step, { rain: W.rain, windAngle: 0, threshold: thr, depth: 4 })
  const maxCourses = Math.max(W.minCourses, Math.round(landKm2 * W.coursesPerKm2))
  const traced = traceRivers(live, g, sim0.flow, sim0.down, thr, W.riverDepth, W.minLenM).slice(0, maxCourses)
  const { filled } = computeRivers(base.slice(), g.cols, g.rows, g.step, { rain: 1, windAngle: 0, threshold: 1e9, depth: 0 })
  const maxLakes = Math.max(1, Math.round(landKm2 * W.lakesPerKm2)) // biggest pits first
  const lk = placeLakes(base, filled, g, traced, { minArea: W.lakeMinArea, sourceShare: W.lakeSourceShare, depth: W.riverDepth, seed: subSeed(seed, 'lakes'), maxLakes })
  const lakes = lk.lakes
  const waters: Water[] = [
    ...lakes.map((w, i) => ({ ...w, id: `WATER_LAKE_${i + 1}` })),
    ...lk.rivers.map((w, i) => ({ ...w, id: `WATER_RIVER_${i + 1}`, auto: true, carve: false })),
  ]
  let zones: ZoneItem[] = []
  let roads: Road[] = []
  let cur = composeHeights(base, g, waters, zones, roads)
  // 3. places
  await step('sites')
  // one water mask for every placement: sea, carved wet cells (rivers, lake middles), lake outlines + shore margin
  const lakes0 = lakeMask(g, waters)
  const wetAt = (i: number) => lakes0[i] === 1 || (cur.wet?.[i] ?? 0) === 1 || cur.heights[i] <= 0.5
  let sites = placeWorldSites(lakeAsSea(cur.heights, lakes0), g, cur.sim.river, p, seed, cur.wet)
  // a zone whose objects or footprint corners fall in the lake mask is refused
  const zoneWet = (z: ZoneItem) => {
    const lw = (x: number, zz: number) => { const c = Math.round((x - g.minX) / g.step), r = Math.round((zz - g.minZ) / g.step); return c >= 0 && r >= 0 && c < g.cols && r < g.rows && lakes0[r * g.cols + c] === 1 }
    return lw(z.x, z.z) || z.entities.some((e) => lw(e.x, e.z)) || z.boxes.some((b) => { for (let i = 0; i + 1 < b.corners.length; i += 2) if (lw(b.corners[i], b.corners[i + 1])) return true; return false })
      || z.roads.some((r) => { for (let i = 0; i + 1 < r.pts.length; i += 2) if (lw(r.pts[i], r.pts[i + 1])) return true; return false })
  }
  const siteDiscs = (extra: number) => sites.map((s) => ({ x: s.x, z: s.z, r: SITE_RADIUS[s.kind] + extra }))
  // 4. airfield: the flattest long strip, away from the places
  await step('airfield')
  const access: Site[] = [] // gates the road network must reach (not settled)
  if (p.airfield && p.size >= WORLD.airfield.minMapKm * 1000) {
    const size = WORLD.airfield.sizeFor(p.size)
    const s = suggestAirfield(lakeAsSea(cur.heights, lakes0), g, { size, seaLevel: 0, keepOut: siteDiscs(WORLD.airfield.keepOutM), count: 1 })[0]
    if (s) {
      const a = makeAirfield(cur.heights, g, { id: 'AIR_1', size, x: s.x, z: s.z, yaw: s.yaw, seed: subSeed(seed, 'airfield') })
      const ok = !zoneWet(a) // no dry ground: no airfield
      if (ok) zones.push(a)
      if (ok && a.access) access.push({ id: 'ACCESS_AIR_1', x: a.access[0], z: a.access[1], kind: 'hamlet' })
    }
  }
  // 5. military: the main base near the airfield, outposts on high ground
  await step('military')
  const nMil = Math.min(4, Math.round(p.military * WORLD.military.perMap4km * (p.size / 4096) ** 2))
  for (let k = 0; k < nMil; k++) {
    const keep = [...siteDiscs(WORLD.military.keepOutM), ...zones.map((z) => { const d = zoneDisc(z); return { ...d, r: d.r + 150 } })]
    // the main base needs a big flat ground: on a small or steep island fall back to an outpost, then a checkpoint
    const mh = lakeAsSea(cur.heights, lakes0)
    const mil = (kind: MilitaryKind) => suggestMilitary(mh, g, { kind, seaLevel: 0, keepOut: keep, count: 8 })
    let kind: MilitaryKind = k === 0 ? 'main' : 'outpost', list = mil(kind)
    if (!list.length && kind === 'main') list = mil((kind = 'outpost'))
    if (!list.length) list = mil((kind = 'checkpoint'))
    const air = zones.find((z) => z.kind === 'airfield')
    const r = mulberry(subSeed(seed, 'military', k))
    let pick = list[Math.floor(r() * Math.min(3, list.length))]
    if (kind === 'main' && air) pick = list.find((q) => Math.hypot(q.x - air.x, q.z - air.z) < WORLD.military.nearAirfieldM(p.size)) ?? pick
    if (!pick) break
    const m = makeMilitary(cur.heights, g, { id: `MIL_${k + 1}`, kind, x: pick.x, z: pick.z, yaw: pick.yaw, seed: subSeed(seed, 'military', k) })
    if (zoneWet(m)) continue // no dry ground for it: skipped
    zones.push(m)
    if (m.access) access.push({ id: `ACCESS_MIL_${k + 1}`, x: m.access[0], z: m.access[1], kind: 'hamlet' })
  }
  cur = composeHeights(base, g, waters, zones, roads)
  // 6. road network (places + zone gates)
  await step('roads')
  const net = { sites: sites.length, spacing: 300, maxSlope: WORLD.roads.maxSlope, seed: subSeed(seed, 'roads'), main: WORLD.roads.main as RoadType, minor: WORLD.roads.minor as RoadType, lane: WORLD.roads.lane as RoadType,
    loops: Math.round(WORLD.roads.loopsPerKm2 * landKm2), loopDetour: WORLD.roads.loopDetour, loopMaxM: WORLD.roads.loopMaxM, loopType: WORLD.roads.loopType as RoadType, v2: p.roadsV2 !== false }
  const rid = roadIdMaker()
  const linked = [...sites, ...access.filter((a) => a.x > g.minX && a.z > g.minZ && a.x < g.minX + (g.cols - 1) * g.step && a.z < g.minZ + (g.rows - 1) * g.step)]
  const ri = WORLD_STAGES.indexOf('roads')
  roads = linked.length >= 2 ? buildNetwork(lakeAsSea(cur.heights, lakes0), g, cur.sim.river, linked, { ...net, progress: (f) => cb.progress?.('roads', ri, WORLD_STAGES.length, 0.85 * f) }, []) : []
  // farmsteads: [M] Everon 197 lone buildings (1-2) and 136 km of dirt + 74 km of paths for 344 km: a dirt track
  // leaves the network for each farm, which adds the T junctions a tree of places lacks
  if (roads.length) {
    const farms = placeFarms(lakeAsSea(cur.heights, lakes0), g, roads, sites, zones, Math.round(WORLD.farms.perKm2 * landKm2 * p.hamlets), subSeed(seed, 'farms'))
    const anchor = sites.find((s) => roads.some((r) => r.pts.some((v, i) => i % 2 === 0 && Math.hypot(v - s.x, r.pts[i + 1] - s.z) < SITE_RADIUS[s.kind])))
    if (farms.length && anchor) {
      const more = buildNetwork(lakeAsSea(cur.heights, lakes0), g, cur.sim.river, [anchor, ...farms], { ...net, loops: 0, lane: WORLD.farms.track as RoadType }, roads)
      roads.push(...more)
      const reached = farms.filter((f) => more.some((r) => Math.hypot(r.pts[0] - f.x, r.pts[1] - f.z) < SITE_RADIUS.hamlet))
      sites = [...sites, ...reached]
    }
  }
  for (const r of roads) if (!r.auto) { r.auto = true; r.id = rid(r.type) }
  cur = composeHeights(base, g, waters, zones, roads)
  const steep = new Set(validate({ roads, sites, settled: [], refusedGaps: [], heights: cur.heights, grid: g }).filter((i) => i.kind === 'steepRoad').map((i) => i.id))
  // a road the carving left too steep for its type is first downgraded (dirt road, then dirt trail: steeper
  // limits), dropped only when even a trail cannot climb it, so the tree is not cut for one junction bump
  if (steep.size) {
    for (const r of roads) if (steep.has(r.id)) {
      const g0 = worstGrade(r.pts, cur.heights, g).grade
      const t = (['dirt', 'trailDirt'] as RoadType[]).find((x) => maxGrade(x) > maxGrade(r.type) && maxGrade(x) >= g0 + 0.01)
      if (t) { r.type = t; steep.delete(r.id) }
    }
    roads = roads.filter((r) => !steep.has(r.id))
    cur = composeHeights(base, g, waters, zones, roads)
    const still = new Set(validate({ roads, sites, settled: [], refusedGaps: [], heights: cur.heights, grid: g }).filter((i) => i.kind === 'steepRoad').map((i) => i.id))
    if (still.size) { roads = roads.filter((r) => !still.has(r.id)); cur = composeHeights(base, g, waters, zones, roads) }
  }
  // V2: (a) every piece of road joined to the network; (b) valley bridges where the bed would sit on a high fill
  const bridgesOut: ProjectEntity[] = []
  if (p.roadsV2 !== false && roads.length) {
    if (roadIslands(roads).length > 1) {
      const links = connectIslands(roads, { maxDist: 1500, type: 'trailDirt', idPrefix: 'ROAD_LINK', route: (a, b) => routeLink(lakeAsSea(cur.heights, lakes0), g, cur.sim.river, a, b, 'trailDirt', WORLD.roads.maxSlope) })
      for (const l of links) { l.id = rid(l.type) }
      if (links.length) {
        const test = composeHeights(base, g, waters, zones, [...roads, ...links]).heights
        const okLinks = links.filter((l) => worstGrade(l.pts, test, g).grade <= maxGrade(l.type)&& l.pts.length > 4) // a straight fallback (no route found) is refused; rivers are bridged at export
        if (okLinks.length) { roads.push(...okLinks); cur = composeHeights(base, g, waters, zones, roads) }
      }
    }
    const bare = composeHeights(base, g, waters, zones, []).heights
    const atB = (x: number, z: number) => bare[Math.min(g.rows - 1, Math.max(0, Math.round((z - g.minZ) / g.step))) * g.cols + Math.min(g.cols - 1, Math.max(0, Math.round((x - g.minX) / g.step)))]
    let any = false
    for (const r of roads) {
      if (r.pts.length < 4 || r.bridge) continue
      const line = centreLine(r.pts, 5), m = line.length / 2
      const ground = Array.from({ length: m }, (_, i) => atB(line[i * 2], line[i * 2 + 1]))
      const y = roadProfile(r, line, atB, 5)
      const spans = findCrossings(line, y, ground, { clear: WORLD_BRIDGE.clear, minLen: WORLD_BRIDGE.minLen, wet: (x, z) => atB(x, z) <= 0.5 })
        .filter((c) => c.kind === 'valley' && c.i0 > 0 && c.i1 < m - 1)
      const kept: { from: number; to: number }[] = []
      spans.forEach((c, k) => {
        const a: [number, number] = [line[c.i0 * 2], line[c.i0 * 2 + 1]], b: [number, number] = [line[c.i1 * 2], line[c.i1 * 2 + 1]]
        const plan = planBridge(`${r.id}_V${k}`, a, b, Math.max(y[c.i0], y[c.i1]), roadHalf(r), atB, { dirt: !isPaved(r.type) })
        if (plan.tooHigh || Math.abs(y[c.i0] - y[c.i1]) > 1) return // too high for two piers, or a sloping deck: keep the fill
        kept.push({ from: c.from, to: c.to })
        bridgesOut.push(...plan.entities)
      })
      if (kept.length) { r.spans = kept; any = true }
    }
    if (any) cur = composeHeights(base, g, waters, zones, roads)
  }
  // a place no road reaches is dropped (the checker would flag it)
  const isolated = new Set(validate({ roads, sites, settled: [], refusedGaps: [], heights: cur.heights, grid: g }).filter((i) => i.kind === 'isolated').map((i) => i.id))
  sites = sites.filter((s) => !isolated.has(s.id))
  // 7. industrial zones: near the towns, along a main road
  await step('industry')
  const towns = sites.filter((s) => s.kind === 'town').concat(sites.filter((s) => s.kind === 'village'))
  const nInd = Math.min(WORLD.industry.maxZones, Math.round(p.industry * WORLD.industry.perTown * Math.max(1, sites.filter((s) => s.kind === 'town').length)))
  const isWater = (x: number, z: number) => {
    const c = Math.round((x - g.minX) / g.step), r = Math.round((z - g.minZ) / g.step)
    return c < 0 || r < 0 || c >= g.cols || r >= g.rows || wetAt(r * g.cols + c)
  }
  // power lines may span a river, never a lake (sea / lake mask only)
  const isLakeOrSea = (x: number, z: number) => {
    const c = Math.round((x - g.minX) / g.step), r = Math.round((z - g.minZ) / g.step)
    return c < 0 || r < 0 || c >= g.cols || r >= g.rows || lakes0[r * g.cols + c] === 1 || cur.heights[r * g.cols + c] <= 0.5
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
    if (!zn.entities.length || zoneWet(zn) || discWet(g, wetAt, zn.x, zn.z, zoneDisc(zn).r * 0.5)) continue
    zones.push(zn)
    k++
  }
  cur = composeHeights(base, g, waters, zones, roads)
  // 8. villages v2
  await step('villages')
  const allRoads = [...roads, ...zones.flatMap((z) => z.roads)]
  // one pass per kind (towns first: they get the room), each with its own street count / fill ([M] sizes per class)
  const settlement: WorldResult['settlement'] = { placed: [], lanes: [], paths: [], squares: [] }
  for (const kind of ['town', 'village', 'hamlet', 'farm'] as const) {
    const ks = sites.filter((s) => (kind === 'farm' ? s.id.startsWith('FARM_') : s.kind === kind && !s.id.startsWith('FARM_')))
    if (!ks.length) continue
    const V = WORLD.villages[kind]
    const vr = settleVillages(ks, allRoads, waters, cur.heights, g, { seed: subSeed(seed, 'villages-' + kind), density: V.density, maxStreets: V.maxStreets, dropScale: WORLD.villages.dropScale, variant: 'auto', blocked: zoneBlocked(zones), biome: p.biome }, settlement.placed)
    settlement.placed = vr.placed
    settlement.tried = (settlement.tried ?? 0) + (vr.tried ?? 0); settlement.housed = (settlement.housed ?? 0) + (vr.housed ?? 0)
    settlement.lanes.push(...vr.lanes); settlement.paths.push(...vr.paths); settlement.squares.push(...vr.squares)
    if (vr.parcels) (settlement.parcels ??= []).push(...vr.parcels)
  }
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
        const l = routePowerWindow(h, g, a.x, a.z, b.x, b.z, { kind: 'hv', isWater: isLakeOrSea, keepOut: keepOut([a, b]) })
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
      const l = routePowerWindow(h, g, bx, bz, v.x, v.z, { kind: 'lv', isWater: isLakeOrSea, roads: roadPts, keepOut: keepOut([v]) })
      if (l) power.push({ ...l, id: pid('lv') })
    }
  }
  // 10. forests (none over a zone)
  await step('forests')
  const discs = zones.map(zoneDisc)
  const rawAreas: WorldArea[] = p.forests > 0
    ? generateForests(cur.heights, g, { seed: subSeed(seed, 'forests'), cover: Math.min(0.9, WORLD.vegetation.forestCover * p.forests), sites, biome: p.biome })
      .filter((f) => { for (let i = 0; i + 1 < f.pts.length; i += 2) if (discs.some((d) => Math.hypot(f.pts[i] - d.x, f.pts[i + 1] - d.z) < d.r + 30)) return false; return true })
      .map((f, k) => ({ id: `FOREST_GEN_${k + 1}`, kind: 'forest' as const, leaf: f.leaf, pts: f.pts }))
    : []
  // overlapping forest patches: same species = merged into one wood, else the later one is cut (no criss-crossing outlines)
  const areas: WorldArea[] = mergeForestPatches(rawAreas).map((a, k) => ({ ...a, id: `FOREST_GEN_${k + 1}` }))
  // 10b. countryside: plots + hedges (campaign.ts, Tanin AgriFieldGenerator method) on the open, gentle
  // ground around each settlement; never in a forest, a lake, a zone or the settlement core
  const forestRings = areas.map((a) => a.pts)
  const topH = cur.heights.reduce((a, b) => Math.max(a, b), 0)
  const camp: CampaignResult = { fields: [], hedges: [], shapes: [] }
  const seen = new Set<string>(), laid: Feature<Polygon>[] = []
  sites.forEach((s, k) => {
    const R = SITE_RADIUS[s.kind], ring = R * (s.kind === 'town' ? 2.6 : 3.2), zone: number[] = []
    for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; zone.push(s.x + Math.cos(a) * ring, s.z + Math.sin(a) * ring) }
    const ok = (x: number, z: number) => {
      if (isLakeOrSea(x, z) || Math.hypot(x - s.x, z - s.z) < R * 1.05) return false
      if (discs.some((d) => Math.hypot(x - d.x, z - d.z) < d.r + 20)) return false
      if (sites.some((q) => q !== s && Math.hypot(x - q.x, z - q.z) < SITE_RADIUS[q.kind] * 1.05)) return false
      const d = g.step * 2, gx = (hAt(x + d, z) - hAt(x - d, z)) / (2 * d), gz = (hAt(x, z + d) - hAt(x, z - d)) / (2 * d)
      if (Math.hypot(gx, gz) > 0.15 || hAt(x, z) > topH * 0.6) return false
      return !forestRings.some((p) => pointInPoly(p, x, z))
    }
    const r = generateCampaign({ zone, fieldSize: s.kind === 'hamlet' ? 110 : 150, jitter: 0.5, angle: (subSeed(seed, 'field' + k) % 90), hedgeChance: 0.95, minHedge: 12, seed: subSeed(seed, 'fields' + k), isLand: ok, prefix: `FIELD_${k + 1}_` })
    // cut the plots by the roads (+3 m verge), the houses (+14 m yard) and the plots already laid:
    // roads then run along a plot border (where the hedge goes), never across a field (zonefill.ts)
    const near = (x: number, z: number) => Math.hypot(x - s.x, z - s.z) < ring + 60
    const obst = [...roadObstacles(allRoads.map((rd) => ({ pts: rd.pts, half: roadHalf(rd) })), 3, near), ...settlement.placed.filter((b) => near(b.x, b.z)).map((b) => pointObstacle(b.x, b.z, 14))]
    const kept = clipPlots(r.fields, { obstacles: obst, laid, ok })
    camp.fields.push(...kept)
    let hs = subSeed(seed, 'hedges' + k) || 1
    const rnd = () => ((hs = (hs * 16807) % 2147483647) / 2147483647)
    for (const h of plotHedges(kept, { seen, rnd, ok })) {
      camp.hedges.push(h)
      camp.shapes.push({ id: `FIELD_${k + 1}_Hedge_${camp.shapes.length}`, kind: 'polyline', closed: false, points: h.flatMap((q) => [Math.round(q[0] * 100) / 100, Math.round(q[1] * 100) / 100]), generator: GENERATORS.hedgeCorylus })
    }
  })
  // 11. surfaces (5 per block at most)
  await step('surfaces')
  let surfaces = computeSurfaces(g, cur.heights, isl.maxHeight, cur.sim.river, rasterCover(g, areas))
  if (overfullBlocks(surfaces)) limitPerBlock(surfaces)
  const issues = validate({ roads, sites, settled: settlement.placed, refusedGaps: [], heights: cur.heights, grid: g })
  return { params: p, island: isl, grid: g, heights: cur.heights, waters, sites, roads, zones, settlement, power, areas, surfaces, issues, overfull: overfullBlocks(surfaces), ...(camp.fields.length && { campaign: camp }), ...(bridgesOut.length && { bridges: bridgesOut }) }
}
