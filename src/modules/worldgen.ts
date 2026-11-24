// "Random world": one seed -> a whole map, by chaining the existing pure generators.
// Pure orchestration (no DOM): deterministic per seed. Each stage (and each zone inside a stage) draws
// from its own sub-seed, so changing one setting (e.g. the hamlet density) does not reshuffle the rest.
// Order: island relief -> rivers / lakes -> places (score map) -> airfield -> military -> road network
// -> industrial zones (they hook onto the main roads, so after the network) -> villages v2 -> power
// lines -> forests -> surfaces. The result is loaded into the normal steps (main.ts) to be tweaked.

import { gridTopology, type PowerTopology } from './powergrid'
import { dedupeRing } from './forestEdge'
import { Sculpt } from './sculpt'
import { applyPads, layPads } from './pads'
import { WORLD } from '../data/worldParams'
import { DENSITY, scaledCount, worldCounts } from '../data/densities'
import { featheredBelt, scatterLayers } from './vegLayers'
import { buryRocks, cliffRocks, rockProfile, paintRockSurfaces, rockStamps } from './cliffRocks'
import { VEG } from '../data/biomes'
import { fr } from '../i18n'
import { computeSurfaces, settlementMask, generateIsland, limitPerBlock, overfullBlocks, type Grid, type IslandParams, type SurfaceGrid } from './island'
import { addRoundabouts, dropOrphanRings, overlapJunctions, squareRoundabout } from './roundabouts'
import { computeRivers } from './hydro'
import { carveWater, placeLakes, riverCourse, traceRivers, WATER_TYPES, type Water } from './water'
import { damFootprint, damZone, placeDams, snapRoadsToCrest } from './dam'
import { carveRoads, centreLine, isPaved, layBeds, roadHalf, roadProfile, type Road, type RoadType } from './roads'
import { clipLine, Corridors, ringOnRoad } from './roadClip'
/** hedge gap at a road: half width + this margin on each side (m) */
export const HEDGE_ROAD_MARGIN = 2.5
/** power pole foot: half width + this clearance from any carriageway (m) */
export const POLE_ROAD_CLEAR = 1.5
import { connectIslands, roadIslands } from './roadgraph'
import { findCrossings, planBridge } from './bridges'
import { streamCulverts } from './culverts'
import { buildMotorway, overpassDecks, resolveCrossings } from './motorway'
import { forestTuning, leafOf, settlementDensityMul } from '../biomes/vegetation'
import { styleTracks } from './network'
import { GENERATORS, type ProjectEntity } from '../project'
import { SITE_RADIUS, buildNetwork, insertPoint, maxGrade, nearestOn, routeLink, worstGrade, type Site, type SiteKind } from './network'
import { validate, type Issue } from './validate'
import { settleVillages, type VillageParcel } from './village'
import { parcelShareOf } from './parcelTemplates'
import { MAX_PARCEL_GRADE, meanGrade } from './gen-common'
import { pastureFences, pastureDensity, pastureStyles } from './pastures'
import { addProdForests, lotFences, makeBlocker, townLots, type FenceLot } from './worldextras'
import { generateTown } from './town'
import { makeSiteZone } from './sitezones'
import { fieldTrees } from './fieldtrees'
import { gameplayCover } from './gameplayCover'
import type { Placed, Square } from './settlements'
import type { PowerLine } from './power'
import type { LayerId } from './layers'
import { powerWorld, worldPowerGrid } from './worldpower'
import type { Station } from './powergrid'
import type { Feature, Polygon } from 'geojson'
import { generateForests } from './forestgen'
import type { CampaignResult } from './campaign'
import { cutDiscs, mergeForestPatches } from './forestMerge'
import { cutForests, riparianBands, type RiparianPatch } from './riparian'
import { countrysideZones, fillFieldZone, pointObstacle, roadObstacles } from './zonefill'
import { colourCrops, cropCover } from './fieldlayout'
import { rasterCover, type CoverArea } from './cover'
import { suggestAirfield } from './airfield'
import { suggestMilitary, type MilitaryKind } from './military'
import { suggestIndustrialSites, INDUSTRIAL_TYPES, pointInPoly } from './industrial'
import { fitPort, type VanillaTemplate } from './vanillaSites'
import { placeRpPlaces } from './rpPlaces'
import { buildHarbour, harbourIssues, harbourTier, pickHarbours, type HarbourTier } from './harbour'
import { parcelTemplate } from '../library/parcelLib'
import type { Composition } from '../library/schema'
import { lampConsumers, streetLights, type StreetLamp } from './streetLights'
import { applyZones, makeAirfield, makeIndustrial, makeMilitary, makeVanillaSite, zoneBlocked, zoneDisc, type ZoneItem } from './zones'

export interface WorldParams {
  seed: number
  /** relief style of the island (island.ts); missing = 'classic' so older seeds / replays stay the same */
  relief?: 'classic' | 'eroded' | 'mountains'
  size: number // 2048 / 4096 / 8192 m
  towns: number // density multipliers, 0..2 (1 = measured average)
  villages: number
  hamlets: number
  industry: number
  military: number
  airfield: boolean
  /** stamp real Bohemia sites: vanilla military bases / checkpoints, fuel depots, gas stations, bus stops, ports (default off) */
  vanillaSites?: boolean
  /** RP / Life places (rpPlaces.ts), default on */
  rpPlaces?: boolean
  /** villages stamp a real Bohemia house row along their main road first (village.ts template mode, default off) */
  villageTemplates?: boolean
  power: boolean
  forests: number
  /** gameplay cover rules (gameplayCover.ts): village belts, wooded strips, copses on exposed ground; default on */
  gameplayCover?: boolean
  /** isolated trees, corner clumps and hedgerow trees in the countryside (#8): 0 = none, 1 = default, 2 = dense */
  fieldTrees?: number
  roadsV2?: boolean // road network V2 finish (docs/ROAD_NETWORK_V2.md), default true
  motorway?: boolean // dual-carriageway motorway across the map (motorway.ts), default off; needs roadsV2
  dams?: boolean // earth dam + reservoir on a river throat (dam.ts), default off
  powerDistrib?: 'auto' | 'overhead' | 'underground' // power distribution inside settlements (powergrid.ts), default auto
  /** per-layer seed overrides (layers.ts); absent layer = global seed */
  layerSeeds?: Partial<Record<LayerId, number>>
  /** street lamps in the settlements (streetLights.ts), default on */
  streetLights?: boolean
  biome?: string // BiomeId (docs/BIOMES_LIBRARY.md): forests and village parcels; default Everon = unchanged
}
export const WORLD_DEFAULTS: Omit<WorldParams, 'seed'> = { size: 4096, towns: 1, villages: 1, hamlets: 1, industry: 1, military: 1, airfield: true, power: true, forests: 1 }
/** the web app's "random world" dialog defaults (main.ts worldGo with untouched controls): probes use it to
 *  reproduce exactly what the app generates and sends */
export const APP_WORLD_DEFAULTS: Omit<WorldParams, 'seed'> = { ...WORLD_DEFAULTS, fieldTrees: 1, biome: 'temperate_everon', motorway: false, dams: false, vanillaSites: true, villageTemplates: true, powerDistrib: 'auto', relief: 'eroded' }
export function appWorldParams(seed: number, over: Partial<WorldParams> = {}): WorldParams { return { ...APP_WORLD_DEFAULTS, seed, ...over } as WorldParams }

export const WORLD_STAGES = ['relief', 'water', 'sites', 'airfield', 'military', 'roads', 'industry', 'villages', 'power', 'forests', 'surfaces'] as const
export type WorldStage = (typeof WORLD_STAGES)[number]

export interface WorldArea extends CoverArea { id: string; tall?: 'low' | 'mid' | 'high'; stage?: 'mature' | 'juvenile' | 'thinned' | 'clearcut'; logs?: { x: number; z: number; yaw: number }[] } // stage/logs: production forest (worldextras.ts)
export interface WorldResult {
  /** countryside around the villages (Tanin AgriFieldGenerator method): plots + hedges */
  campaign?: CampaignResult
  /** countryside polygons (one per settlement) the plots were laid in, Zone-tool style */
  countryside?: number[][]
  params: WorldParams
  island: IslandParams
  grid: Grid
  heights: number[]
  waters: Water[]
  sites: Site[]
  roads: Road[]
  zones: ZoneItem[]
  settlement: { placed: Placed[]; lanes: Road[]; paths: Road[]; squares: Square[]; tried?: number; housed?: number; parcels?: VillageParcel[]; fences?: VillageParcel[] }
  power: (PowerLine & { id: string })[]
  /** transformer stations / plants and their access tracks (powergrid.ts), with p.power */
  powerStations?: Station[]
  powerAccess?: number[][]
  areas: WorldArea[]
  surfaces: SurfaceGrid[]
  /** who feeds whom (powergrid.topology.json, POWERGRID_LOGIC.md §6) */
  powerTopology?: PowerTopology
  issues: Issue[]
  overfull: number
  /** V2 valley bridges (decks + piers) for the roads' `spans`; the river crossings stay with splitAtWater at export */
  bridges?: ProjectEntity[]
  /** riparian band (reeds + willows) along the rivers and lake shores (riparian.ts) */
  riparian?: RiparianPatch[]
  /** street lamps (streetLights.ts), also sent as the STREETLIGHTS zone: ids kept for a future power topology */
  streetLights?: StreetLamp[]
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

/** footprints (4 corners) that get a building pad: the placed houses + the buildings of the industrial and
 *  military zones (lots, areas and paved boxes excluded; the vanilla sites are already levelled as a whole) */
export function buildingFootprints(placed: { corners: number[] }[], zones: ZoneItem[]): number[][] {
  const out = placed.filter((q) => q.corners.length === 8).map((q) => q.corners)
  for (const z of zones) {
    if (z.kind !== 'industrial' && z.kind !== 'military') continue
    for (const b of z.boxes) if (b.corners.length === 8 && !/^(area|lot|pave)$/.test(b.role)) out.push(b.corners)
  }
  return out
}

/** same chain as main.ts recompose(): water carving, zone platforms, road beds, then the runoff */
export function composeHeights(base: number[], g: Grid, waters: Water[], zones: ZoneItem[], roads: Road[], pads?: number[][], lanes: number[][] = []) {
  const h = base.slice()
  const wl = waters.length ? carveWater(h, g, waters) : undefined
  applyZones(h, g, zones)
  const pf = pads?.length ? applyPads(h, g, pads, lanes) : null // building pads (pads.ts)
  const beds = roads.length ? carveRoads(h, g, roads, { water: wl }) : null
  if (pf) layPads(h, pf, beds?.weight) // again over the bed ramps and embankments: only the carriageway keeps the road
  const auto = waters.some((w) => w.auto)
  const sim = computeRivers(h, g.cols, g.rows, g.step, { rain: WORLD.water.rain, windAngle: 0, threshold: auto ? riverThreshold(g.step) : WORLD.water.threshold, depth: auto ? 0 : 4 })
  if (beds && !auto) { layBeds(h, beds); if (pf) layPads(h, pf, beds.weight) }
  return { heights: h, sim, wet: wl?.wet }
}

/** stretches of a road (arc length along centreLine(pts, 20), worstGrade's measure) within a river's half width
 *  + 4 m, the gap splitAtWater cuts at export (worstGrade adds its 20 m abutment margin around each) */
export function riverSpans(pts: number[], waters: Water[]): { from: number; to: number }[] {
  const courses = waters.filter((w) => !WATER_TYPES[w.type].closed && w.pts.length >= 4).map((w) => ({ c: riverCourse(w.pts, w.width), half: w.width / 2 + 4 }))
  if (!courses.length) return []
  const wet = (x: number, z: number) => courses.some(({ c, half }) => {
    for (let i = 0; i + 3 < c.length; i += 2) {
      const ax = c[i], az = c[i + 1], dx = c[i + 2] - ax, dz = c[i + 3] - az, L2 = dx * dx + dz * dz || 1
      const t = Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / L2))
      if (Math.hypot(x - ax - dx * t, z - az - dz * t) < half) return true
    }
    return false
  })
  const line = centreLine(pts, 20), out: { from: number; to: number }[] = []
  let acc = 0
  for (let i = 2; i + 1 < line.length; i += 2) {
    const d = Math.hypot(line[i] - line[i - 2], line[i + 1] - line[i - 1])
    if (wet((line[i] + line[i - 2]) / 2, (line[i + 1] + line[i - 1]) / 2)) out.push({ from: acc, to: acc + d })
    acc += d
  }
  return out
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
function polyAreaM2(pts: number[]) { let a = 0; for (let i = 0; i < pts.length; i += 2) { const j = (i + 2) % pts.length; a += pts[i] * pts[j + 1] - pts[j] * pts[i + 1] } return Math.abs(a) / 2 }
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
    // the whole farmyard (house, barns, fenced yards ~ 60 m across) on gentle ground, not just its centre
    if (meanGrade(Array.from({ length: 16 }, (_, k) => (k % 2 ? qz + Math.sin((k >> 1) * 0.785) * 55 : qx + Math.cos((k >> 1) * 0.785) * 55)), at, 8) > MAX_PARCEL_GRADE) continue
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
  const wc = worldCounts(p, landKm2) // densities per km² of land (data/densities.ts)
  const want: Record<SiteKind, number> = { town: wc.town, village: wc.village, hamlet: wc.hamlet }
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
  // per-layer seed overrides (layers.ts): a layer with an override draws its sub-seeds from it, others from the global seed (unchanged output)
  const ss = (layer: LayerId, stage: string, k = 0) => subSeed(Math.floor(p.layerSeeds?.[layer] ?? 0) || seed, stage, k)
  // 1. relief
  await step('relief')
  const isl: IslandParams = {
    size: p.size, step: Math.max(4, p.size / 512), maxHeight: p.relief === 'mountains' ? Math.max(340, WORLD.island.maxHeight(p.size) * 2.2) : WORLD.island.maxHeight(p.size), seaDepth: WORLD.island.seaDepth,
    landRatio: WORLD.island.landRatio, roughness: WORLD.island.roughness, seed: ss('relief', 'island'), islands: 1, relief: p.relief ?? 'classic',
  }
  const island = generateIsland(isl)
  // the relief the page builds from this island (main.ts applyWorld -> tGen -> Sculpt.compose: 32 m macro + its own
  // detail noise) is what is drawn and sent: place everything on that one, not on the raw island (seed 21 live:
  // 32 % of land cells up to 9 m off, rocks buried, slopes / shores judged on another terrain)
  { const sc = new Sculpt(island.grid.cols, island.grid.step, isl.maxHeight, isl.seed, island.heights, 32, isl.relief !== 'classic'); sc.seaDepth = isl.seaDepth; island.heights = sc.compose().slice() }
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
  const lk = placeLakes(base, filled, g, traced, { minArea: W.lakeMinArea, sourceShare: W.lakeSourceShare, depth: W.riverDepth, seed: ss('water', 'lakes'), maxLakes })
  // dams (dam.ts, docs/DAMS.md): an embankment sculpted into the relief at a valley throat, its reservoir upstream
  const dm = p.dams ? (() => {
    const nat = lakeMask(g, lk.lakes.map((w, i) => ({ ...w, id: `L${i}` })), 0)
    return placeDams(base, g, lk.rivers, { count: Math.max(1, Math.round(p.size / 4096)) }, (k) => nat[k] === 1)
  })() : null
  const lakes = [...lk.lakes, ...(dm?.lakes ?? [])]
  const waters: Water[] = [
    ...lakes.map((w, i) => ({ ...w, id: `WATER_LAKE_${i + 1}` })),
    ...(dm?.rivers ?? lk.rivers).map((w, i) => ({ ...w, id: `WATER_RIVER_${i + 1}`, auto: true, carve: false })),
  ]
  let zones: ZoneItem[] = dm ? dm.dams.map((d) => damZone(d)) : []
  let roads: Road[] = []
  let cur = composeHeights(base, g, waters, zones, roads)
  // 3. places
  await step('sites')
  // one water mask for every placement: sea, carved wet cells (rivers, lake middles), lake outlines + shore margin
  const lakes0 = lakeMask(g, waters)
  if (dm) damFootprint(base, g, dm.dams).forEach((v, k) => { if (v) lakes0[k] = 1 }) // the embankment is an obstacle for roads and placement (crest ends left open)
  const wetAt = (i: number) => lakes0[i] === 1 || (cur.wet?.[i] ?? 0) === 1 || cur.heights[i] <= 0.5
  let sites = placeWorldSites(lakeAsSea(cur.heights, lakes0), g, cur.sim.river, p, p.layerSeeds?.settlements ?? seed, cur.wet)
  // a zone whose objects or footprint corners fall in the lake mask is refused
  const zoneWet = (z: ZoneItem) => {
    const lw = (x: number, zz: number) => { const c = Math.round((x - g.minX) / g.step), r = Math.round((zz - g.minZ) / g.step); return c >= 0 && r >= 0 && c < g.cols && r < g.rows && lakes0[r * g.cols + c] === 1 }
    return lw(z.x, z.z) || z.entities.some((e) => lw(e.x, e.z)) || z.boxes.some((b) => { for (let i = 0; i + 1 < b.corners.length; i += 2) if (lw(b.corners[i], b.corners[i + 1])) return true; return false })
      || z.roads.some((r) => { for (let i = 0; i + 1 < r.pts.length; i += 2) if (lw(r.pts[i], r.pts[i + 1])) return true; return false })
  }
  const siteDiscs = (extra: number) => sites.map((s) => ({ x: s.x, z: s.z, r: SITE_RADIUS[s.kind] + extra }))
  // 4. airfield: the flattest long strip, away from the places
  await step('airfield')
  const access: Site[] = zones.filter((z) => z.access).map((z) => ({ id: `ACCESS_${z.id}`, x: z.access![0], z: z.access![1], kind: 'hamlet' as const })) // gates the road network must reach (not settled); dam crests first
  if (p.airfield && p.size >= WORLD.airfield.minMapKm * 1000) {
    const size = WORLD.airfield.sizeFor(p.size)
    const s = suggestAirfield(lakeAsSea(cur.heights, lakes0), g, { size, seaLevel: 0, keepOut: siteDiscs(WORLD.airfield.keepOutM), count: 1 })[0]
    if (s) {
      const a = makeAirfield(cur.heights, g, { id: 'AIR_1', size, x: s.x, z: s.z, yaw: s.yaw, seed: ss('settlements', 'airfield') })
      const ok = !zoneWet(a) // no dry ground: no airfield
      if (ok) zones.push(a)
      if (ok && a.access) access.push({ id: 'ACCESS_AIR_1', x: a.access[0], z: a.access[1], kind: 'hamlet' })
    }
  }
  // 5. military: the main base near the airfield, outposts on high ground
  await step('military')
  const nMil = worldCounts(p, landKm2).military // [M] 0.1 bases / km² of land, spacing 800-950 m (keepOut)
  for (let k = 0; k < nMil; k++) {
    const keep = [...siteDiscs(WORLD.military.keepOutM), ...zones.map((z) => { const d = zoneDisc(z); return { ...d, r: d.r + 150 } })]
    // the main base needs a big flat ground: on a small or steep island fall back to an outpost, then a checkpoint
    const mh = lakeAsSea(cur.heights, lakes0)
    const mil = (kind: MilitaryKind) => suggestMilitary(mh, g, { kind, seaLevel: 0, keepOut: keep, count: 8 })
    let kind: MilitaryKind = k === 0 ? 'main' : 'outpost', list = mil(kind)
    if (!list.length && kind === 'main') list = mil((kind = 'outpost'))
    if (!list.length && p.vanillaSites && k === 0) { // vanilla on: the first site must be a real base, not a 13-object checkpoint (a 4 km map
      // rarely has a flat spot 700 m past every place); retry closer to the places before giving up to a checkpoint
      const near = [...siteDiscs(WORLD.military.keepOutM / 4), ...zones.map((z) => { const d = zoneDisc(z); return { ...d, r: d.r + 50 } })]
      for (const kk of ['main', 'outpost'] as MilitaryKind[]) { list = suggestMilitary(mh, g, { kind: kk, seaLevel: 0, keepOut: near, count: 8 }); if (list.length) { kind = kk; break } }
    }
    if (!list.length) list = mil((kind = 'checkpoint'))
    const air = zones.find((z) => z.kind === 'airfield')
    const r = mulberry(ss('settlements', 'military', k))
    let pick = list[Math.floor(r() * Math.min(3, list.length))]
    if (kind === 'main' && air) pick = list.find((q) => Math.hypot(q.x - air.x, q.z - air.z) < WORLD.military.nearAirfieldM(p.size)) ?? pick
    if (!pick) break
    const m = makeMilitary(cur.heights, g, { id: `MIL_${k + 1}`, kind, x: pick.x, z: pick.z, yaw: pick.yaw, seed: ss('settlements', 'military', k), vanilla: p.vanillaSites })
    if (zoneWet(m)) continue // no dry ground for it: skipped
    zones.push(m)
    if (m.access) access.push({ id: `ACCESS_MIL_${k + 1}`, x: m.access[0], z: m.access[1], kind: 'hamlet' })
  }
  cur = composeHeights(base, g, waters, zones, roads)
  // 6. road network (places + zone gates)
  await step('roads')
  const net = { sites: sites.length, spacing: 300, maxSlope: WORLD.roads.maxSlope, seed: ss('roads', 'roads'), main: WORLD.roads.main as RoadType, minor: WORLD.roads.minor as RoadType, lane: WORLD.roads.lane as RoadType,
    loops: Math.round(WORLD.roads.loopsPerKm2 * landKm2), loopDetour: WORLD.roads.loopDetour, loopMaxM: WORLD.roads.loopMaxM, loopType: WORLD.roads.loopType as RoadType, v2: p.roadsV2 !== false, mountains: p.relief === 'mountains',
    // no road through a base / airfield / stamped site (pre-send: 18 base objects on a road crossing MIL_1, seed 42); the disc stops 2 cells short of the gate
    avoid: zones.filter((z) => z.kind === 'military' || z.kind === 'airfield' || z.sub?.startsWith('vanilla:')).map((z) => { const d = zoneDisc(z), ga = z.access ? Math.hypot(z.access[0] - d.x, z.access[1] - d.z) - 2 * g.step : Infinity; return { x: d.x, z: d.z, r: Math.min(d.r * 0.8, ga) } }).filter((d) => d.r > g.step) }
  const rid = roadIdMaker()
  const linked = [...sites, ...access.filter((a) => a.x > g.minX && a.z > g.minZ && a.x < g.minX + (g.cols - 1) * g.step && a.z < g.minZ + (g.rows - 1) * g.step)]
  const ri = WORLD_STAGES.indexOf('roads')
  roads = linked.length >= 2 ? buildNetwork(lakeAsSea(cur.heights, lakes0), g, cur.sim.river, linked, { ...net, progress: (f) => cb.progress?.('roads', ri, WORLD_STAGES.length, 0.85 * f) }, []) : []
  // farmsteads: [M] Everon 197 lone buildings (1-2) and 136 km of dirt + 74 km of paths for 344 km: a dirt track
  // leaves the network for each farm, which adds the T junctions a tree of places lacks
  if (roads.length) {
    const farms = placeFarms(lakeAsSea(cur.heights, lakes0), g, roads, sites, zones, worldCounts(p, landKm2).farms, ss('settlements', 'farms'))
    const anchor = sites.find((s) => roads.some((r) => r.pts.some((v, i) => i % 2 === 0 && Math.hypot(v - s.x, r.pts[i + 1] - s.z) < SITE_RADIUS[s.kind])))
    if (farms.length && anchor) {
      const more = buildNetwork(lakeAsSea(cur.heights, lakes0), g, cur.sim.river, [anchor, ...farms], { ...net, loops: 0, lane: WORLD.farms.track as RoadType }, roads)
      roads.push(...more)
      const reached = farms.filter((f) => more.some((r) => Math.hypot(r.pts[0] - f.x, r.pts[1] - f.z) < SITE_RADIUS.hamlet))
      sites = [...sites, ...reached]
    }
  }
  for (const r of roads) if (!r.auto) { r.auto = true; r.id = rid(r.type) }
  roads = addRoundabouts(roads, { places: sites.map((s) => ({ x: s.x, z: s.z, r: SITE_RADIUS[s.kind] })) }).roads // P3 #15: rings at busy junctions
  if (dm) snapRoadsToCrest(roads, dm.dams) // the access road runs onto the crest track, not into the wall's end
  cur = composeHeights(base, g, waters, zones, roads)
  const steep = new Set(validate({ roads, sites, settled: [], refusedGaps: [], heights: cur.heights, grid: g }).filter((i) => i.kind === 'steepRoad').map((i) => i.id))
  // mountains: the dip where a paved road meets a river is not its grade (the export splits the road there and
  // bridges the gap, splitAtWater): measured without it, a town link is not downgraded to dirt for its ford
  // (seed 21: the only village-town asphalt went dirt at 13 % on a stream, the town fell off the paved network)
  // (a dip steeper than 1.6 x the limit is a gorge, not a ford: the usual downgrade then)
  const fordOnly = (r: Road) => p.relief === 'mountains' && isPaved(r.type) && worstGrade(r.pts, cur.heights, g, r.spans).grade <= maxGrade(r.type) * 1.6 &&
    worstGrade(r.pts, cur.heights, g, [...(r.spans ?? []), ...riverSpans(r.pts, waters)]).grade <= maxGrade(r.type)
  for (const r of roads) if (steep.has(r.id) && fordOnly(r)) steep.delete(r.id)
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
    for (const r of roads) if (still.has(r.id) && fordOnly(r)) still.delete(r.id)
    if (still.size) { roads = roads.filter((r) => !still.has(r.id)); cur = composeHeights(base, g, waters, zones, roads) }
  }
  // a ring whose branches were dropped as too steep goes too
  { const n0 = roads.length; roads = dropOrphanRings(roads); if (roads.length < n0) cur = composeHeights(base, g, waters, zones, roads) }
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
    // (c) optional motorway: built on the carved relief, other roads lifted over it or cut back (no level crossing)
    if (p.motorway) {
      const mw = buildMotorway(lakeAsSea(cur.heights, lakes0), g, cur.sim.river, sites, roads, { maxSlope: WORLD.roads.maxSlope })
      if (mw) { roads.push(...mw.made); cur = composeHeights(base, g, waters, zones, roads) }
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
        if ((r.spans ?? []).some((sp) => c.to > sp.from - 20 && c.from < sp.to + 20)) return // an overpass deck already there
        const a: [number, number] = [line[c.i0 * 2], line[c.i0 * 2 + 1]], b: [number, number] = [line[c.i1 * 2], line[c.i1 * 2 + 1]]
        const plan = planBridge(`${r.id}_V${k}`, a, b, Math.max(y[c.i0], y[c.i1]), roadHalf(r), atB, { dirt: !isPaved(r.type) })
        if (plan.tooHigh || Math.abs(y[c.i0] - y[c.i1]) > 1) return // too high for two piers, or a sloping deck: keep the fill
        kept.push({ from: c.from, to: c.to })
        bridgesOut.push(...plan.entities)
      })
      if (kept.length) { r.spans = [...(r.spans ?? []), ...kept].sort((a, b) => a.from - b.from); any = true }
    }
    if (p.motorway) bridgesOut.push(...overpassDecks(roads, atB))
    if (any) cur = composeHeights(base, g, waters, zones, roads)
  }
  // #15: short decks where a road crosses a narrow stream (not a water polygon: no export gap there)
  if (roads.length) {
    const ch = cur.heights, atC = (x: number, z: number) => ch[Math.min(g.rows - 1, Math.max(0, Math.round((z - g.minZ) / g.step))) * g.cols + Math.min(g.cols - 1, Math.max(0, Math.round((x - g.minX) / g.step)))]
    bridgesOut.push(...streamCulverts(roads, cur.sim.river, g, atC).entities)
  }
  // a place no road reaches is dropped (the checker would flag it)
  const isolated = new Set(validate({ roads, sites, settled: [], refusedGaps: [], heights: cur.heights, grid: g }).filter((i) => i.kind === 'isolated').map((i) => i.id))
  sites = sites.filter((s) => !isolated.has(s.id))
  // 7. industrial zones: near the towns, along a main road
  await step('industry')
  const towns = sites.filter((s) => s.kind === 'town').concat(sites.filter((s) => s.kind === 'village'))
  const nInd = worldCounts(p, landKm2).industry // [M] per km² of land (data/densities.ts)
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
  // several zones per town on big maps: the towns are visited in turn (spacing via the 200 m zone keep-out)
  for (let k = 0, ti = 0; k < nInd && ti < towns.length * 3; ti++) {
    const t = towns[ti % towns.length], r = mulberry(ss('settlements', 'industry', k))
    const type = INDUSTRIAL_TYPES[Math.floor(r() * 3)] // factory / depot / quarry ... the first three read best near a town
    const D = WORLD.industry.searchM
    const list = suggestIndustrialSites(hAt, mainRoads.length ? mainRoads : roads, {
      type, size: WORLD.industry.size, n: 3, isWater,
      bounds: { minX: Math.max(g.minX, t.x - D), minZ: Math.max(g.minZ, t.z - D), maxX: Math.min(g.minX + (g.cols - 1) * g.step, t.x + D), maxZ: Math.min(g.minZ + (g.rows - 1) * g.step, t.z + D) },
      villages: [...siteDiscs(60), ...zones.map(zoneDisc)],
    })
    const s = list.find((q) => !zones.some((z) => { const d = zoneDisc(z); return Math.hypot(d.x - q.x, d.z - q.z) < d.r + 200 }))
    if (!s) continue
    const zn = makeIndustrial(cur.heights, g, roads, { id: `IND_${k + 1}`, type, x: s.x, z: s.z, seed: ss('settlements', 'industry', k), size: WORLD.industry.size })
    if (!zn.entities.length || zoneWet(zn) || discWet(g, wetAt, zn.x, zn.z, zoneDisc(zn).r * 0.5)) continue
    zones.push(zn)
    k++
  }
  function placeVanillaWorldSites() {
    const wc = worldCounts(p, landKm2)
    const paved = roads.filter((r) => isPaved(r.type) && r.pts.length >= 4)
    const anyRoad = roads.filter((r) => r.pts.length >= 4)
    // coast length (km): land cells with a sea neighbour x the cell size
    let coast = 0
    for (let r = 1; r < g.rows - 1; r++) for (let c = 1; c < g.cols - 1; c++) {
      const i = r * g.cols + c
      if (cur.heights[i] > 0.5 && (cur.heights[i - 1] <= 0 || cur.heights[i + 1] <= 0 || cur.heights[i - g.cols] <= 0 || cur.heights[i + g.cols] <= 0)) coast++
    }
    // the harbour's terrain sculpt (applyHarbour: apron, dredged basin, shore straightening) reaches past its pieces:
    // at 0.6 x radius it tilted half of a vanilla military base next to it (seed 21 live, MIL_1: 10 m vs 17 m)
    const HARBOUR_SCULPT_MARGIN = 30
    const nPorts = scaledCount(DENSITY.portsPerKmCoast, (coast * g.step) / 1000)
    const free = (x: number, z: number, r: number, sameSub: string, gap: number) =>
      !sites.some((s) => Math.hypot(s.x - x, s.z - z) < SITE_RADIUS[s.kind] * 0.6 + r) &&
      !zones.some((zn) => { const d = zoneDisc(zn); return Math.hypot(d.x - x, d.z - z) < d.r + r + (zn.sub?.startsWith(sameSub) ? gap : 10) })
    const allRoadLines = () => [...roads.map((r) => r.pts), ...zones.flatMap((zn) => zn.roads.map((r) => r.pts))]
    const put = (type: string, n: number, list: Road[], setback: number, gap: number, r0: number, near?: (x: number, z: number) => boolean) => {
      const rnd = mulberry(ss('settlements', 'vanilla-' + type))
      for (let k = 0, tries = 0; k < n && list.length && tries < n * 60 + 60; tries++) {
        const rd = list[Math.floor(rnd() * list.length)]
        const i = Math.floor(rnd() * (rd.pts.length / 2 - 1)) * 2
        const ax = rd.pts[i], az = rd.pts[i + 1], dx = rd.pts[i + 2] - ax, dz = rd.pts[i + 3] - az, len = Math.hypot(dx, dz)
        if (len < 1) continue
        const side = rnd() < 0.5 ? 1 : -1, nx = (-dz / len) * side, nz = (dx / len) * side, t = rnd()
        const off = roadHalf(rd) + setback
        const x = ax + dx * t + nx * off, z = az + dz * t + nz * off
        if (isWater(x, z) || (near && !near(x, z)) || !free(x, z, r0, 'vanilla:' + type, gap)) continue
        let sx = x, sz = z, syaw = (Math.atan2(-nx, -nz) * 180) / Math.PI, tpl: VanillaTemplate | undefined, fit0: ReturnType<typeof fitPort> = null, compo: Composition | undefined, tier0: HarbourTier = 'fishing'
        if (type === 'port') { // sea side to the sea, breakwaters / piers in the water, sheds ashore, no road through the footprint
          // a whole vanilla harbour from the parcel library (harbour.ts): exact pieces, heights, chaining
          const near0 = sites.reduce<Site | null>((b, s) => (!b || Math.hypot(s.x - x, s.z - z) < Math.hypot(b.x - x, b.z - z) ? s : b), null)
          tier0 = harbourTier(near0 && Math.hypot(near0.x - x, near0.z - z) < 1500 ? near0.kind : undefined)
          // the world's biome first (Everon / Arland / Kolguyev sets), large ports (> 200 m) for a town; every
          // candidate is tried here (seed 21: one pick per try only ever fitted Arland 3292). Up to 30 % of the sea
          // parts may start ashore and 60 % of the land parts at sea: the harbour's own terrain samples re-shape (straighten) the shore
          const lines = allRoadLines(), pads = [...roads.map((r) => (isPaved(r.type) ? 40 : 8)), ...zones.flatMap((zn) => zn.roads.map(() => 8))]
          let fit: ReturnType<typeof fitPort> = null
          compo = undefined; tpl = undefined
          for (const c of pickHarbours(tier0, ss('settlements', 'vanilla-port', k + tries), { biome: p.biome, maxR: tier0 === 'port' ? 360 : 200 })) {
            const t = parcelTemplate(c), f = fitPort(t, hAt, x, z, lines, { roadPads: pads, minWater: 0.7, minLand: 0.4, seaAxis: [0, 1] })
            if (f && free(f.x, f.z, t.radius + HARBOUR_SCULPT_MARGIN, 'vanilla:' + type, gap)) { fit = f; compo = c; tpl = t; break }
          }
          if (!tpl || !fit) continue
          sx = fit.x; sz = fit.z; syaw = fit.yaw; fit0 = fit
        }
        const zn = makeVanillaSite(cur.heights, g, { id: `VAN_${type.toUpperCase()}_${k + 1}`, type, x: sx, z: sz, yaw: syaw, seed: ss('settlements', 'vanilla-' + type, k), template: tpl })
        if (!zn || (type !== 'port' && zoneWet(zn))) continue
        if (type === 'port') { // the vanilla harbour itself, every object at its height; terrain sculpted from its samples
          const hb = buildHarbour({ id: zn.id, tier: tier0, x: sx, z: sz, yaw: syaw, compo: compo!, roads: allRoadLines(), avoid: zones.map(zoneDisc) })
          zn.harbour = hb.plan; zn.entities = hb.entities; zn.roads.push(...hb.roads); zn.boxes.push(...hb.boxes)
          zn.warnings.push(`harbour ${tier0} ${compo!.name}${fit0 && !fit0.deep ? ' (shallow before dredging)' : ''}`)
        }
        zn.sub = `vanilla:${type}:${zn.sub?.slice(8) ?? ''}`
        zones.push(zn)
        k++
      }
    }
    const nearPlace = (R: number) => (x: number, z: number) => sites.some((s) => Math.hypot(s.x - x, s.z - z) < SITE_RADIUS[s.kind] + R)
    // [M] SITES_VANILLA: fuel depot 22 m from the axis (spacing 300-800 m), gas station 13-15 m on a main asphalt road,
    // bus stop at the roadside of a place, port 30-80 m from a dirt road on the coast
    put('fuel_depot', wc.fuelDepots, paved.length ? paved : anyRoad, 16, 300, 15)
    put('gas_station', wc.gasStations, paved.length ? paved : anyRoad, 9, 400, 12)
    put('bus_stop', wc.busStops, anyRoad, 2.5, 250, 4, nearPlace(150))
    const coastal = (x: number, z: number) => { for (let a = 0; a < 8; a++) { const q = (a / 8) * Math.PI * 2; if (hAt(x + Math.cos(q) * 90, z + Math.sin(q) * 90) <= 0) return true } return false }
    // harbour: quay >= 40 m and apron >= 25 m off any road (HARBOURS_EVERON.md: main road 50-60 m behind the quay)
    put('port', nPorts, anyRoad, 80, 350, 20, coastal)
  }
  // 7b. vanilla sites (option): fuel depots, gas stations, bus stops, ports stamped from the Bohemia templates
  // at the measured densities (data/densities.ts), beside a road at the measured setback, +Z facing the road
  if (p.vanillaSites) placeVanillaWorldSites()
  // 7c. RP places (rpPlaces.ts): police, clinic, town hall, bank, market, shops, garages, car lots, bus stops, sawmills, mines,
  // delivery depots, fuel: vanilla buildings stamped before the villages so the lots build around them; off with rpPlaces: false
  if (p.rpPlaces !== false) zones.push(...placeRpPlaces({ heights: cur.heights, g, sites, zones, roads, isWater, seed: ss('settlements', 'rp'), landKm2, biome: p.biome }))
  cur = composeHeights(base, g, waters, zones, roads)
  // 8. villages v2
  await step('villages')
  const allRoads = [...roads, ...zones.flatMap((z) => z.roads)]
  // one pass per kind (towns first: they get the room), each with its own street count / fill ([M] sizes per class)
  const settlement: WorldResult['settlement'] = { placed: [], lanes: [], paths: [], squares: [] }
  const builtLots: FenceLot[] = []
  for (const kind of ['town', 'village', 'hamlet', 'farm'] as const) {
    const ks = sites.filter((s) => (kind === 'farm' ? s.id.startsWith('FARM_') : s.kind === kind && !s.id.startsWith('FARM_')))
    if (kind === 'town') {
      // "vraie ville" (town.ts) on a 300 m disc; a site it cannot lay out (water, slope, cramped) falls back to settleVillages
      const left: Site[] = []
      for (const s of ks.splice(0)) {
        const ring: number[] = []
        for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2; ring.push(s.x + Math.cos(a) * 300, s.z + Math.sin(a) * 300) }
        const tr = generateTown(ring, allRoads, waters, cur.heights, g, { seed: ss('settlements', 'town-' + s.id), density: WORLD.villages.town.density, blocked: zoneBlocked(zones), prefix: s.id }, settlement.placed)
        if (tr.placed.length - settlement.placed.length < 30) { left.push(s); continue }
        settlement.placed = tr.placed
        // a road crossing the town square: the square becomes a real roundabout (one round ring, roads and lanes clipped)
        for (const sq of tr.squares) {
          const rb = squareRoundabout(roads, tr.lanes, sq.x, sq.z, sq.r + 4, `RB_${s.id}`)
          if (!rb) continue
          roads = [...rb.roads, rb.ring]
          allRoads.splice(0, allRoads.length, ...roads, ...zones.flatMap((z) => z.roads))
          tr.lanes = rb.lanes
        }
        settlement.lanes.push(...tr.lanes); settlement.squares.push(...tr.squares)
        // parking / church blocks dressed by the site generators (same as the Town zone tool): bays, cemetery round the church
        const lines = [...allRoads, ...tr.lanes].filter((r) => r.pts.length >= 4).map((r) => ({ pts: centreLine(r.pts, 4), half: roadHalf(r) }))
        const ground = (x: number, z: number) => hAt(x, z)
        // no cemetery / parking object on a road crossing the block (pre-send: 21 graves on ROAD_TERRE_2, seed 42)
        const segD = (q: number[], x: number, z: number) => { let b = Infinity; for (let i = 2; i < q.length; i += 2) { const ax = q[i - 2], az = q[i - 1], dx = q[i] - ax, dz = q[i + 1] - az, L = dx * dx + dz * dz, t = L ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L)) : 0; b = Math.min(b, Math.hypot(x - ax - t * dx, z - az - t * dz)) } return b }
        const offRoad = (x: number, z: number) => !lines.some((l) => segD(l.pts, x, z) < l.half + 1.5)
        const okAt = (x: number, z: number) => !isWater(x, z) && offRoad(x, z) && !tr.placed.some((q) => Math.abs(q.x - x) < 30 && Math.abs(q.z - z) < 30 && pointInPoly(q.corners, x, z))
        tr.blocks.forEach((bl, bi) => {
          if (bl.type !== 'parking' && bl.type !== 'church') return
          const zn = makeSiteZone(bl.type === 'church' ? 'cemetery' : 'parking', bl.inset, { id: `${s.id}_SITE_${bi + 1}`, seed: ss('settlements', 'townsite-' + s.id, bi), roads: lines, ground, ok: okAt })
          if (zn.entities.length || zn.shapes.length) zones.push(zn)
        })
      }
      ks.push(...left)
      if (!ks.length) continue
    }
    if (!ks.length) continue
    const V = WORLD.villages[kind]
    const vr = settleVillages(ks, allRoads, waters, cur.heights, g, { seed: ss('settlements', 'villages-' + kind), density: V.density * settlementDensityMul(p.biome), maxStreets: V.maxStreets, dropScale: WORLD.villages.dropScale, variant: 'auto', blocked: zoneBlocked(zones), biome: p.biome, template: p.villageTemplates && kind !== 'farm', parcels: p.villageTemplates, parcelShare: parcelShareOf(p.biome), farmyards: kind === 'farm' }, settlement.placed)
    settlement.placed = vr.placed
    settlement.tried = (settlement.tried ?? 0) + (vr.tried ?? 0); settlement.housed = (settlement.housed ?? 0) + (vr.housed ?? 0)
    settlement.lanes.push(...vr.lanes); settlement.paths.push(...vr.paths); settlement.squares.push(...vr.squares)
    if (vr.parcels) (settlement.parcels ??= []).push(...vr.parcels)
    builtLots.push(...vr.lots)
  }
  // fences / low walls along the built village and hamlet plots (biome worlds already have their parcels' fences)
  if (!p.biome || p.biome === 'temperate_everon') {
    const kinds = new Map(sites.map((s) => [s.id, s.kind]))
    builtLots.push(...townLots(settlement.placed, (id) => kinds.get(id) === 'town'))
  }
  if ((!p.biome || p.biome === 'temperate_everon') && builtLots.length) {
    const kinds = new Map(sites.map((s) => [s.id, s.kind]))
    const blocked = makeBlocker(settlement.placed.map((q) => q.corners), [...allRoads, ...settlement.lanes].filter((r) => r.pts.length >= 4).map((r) => ({ pts: r.pts, half: roadHalf(r) })))
    const fp = lotFences(builtLots, { seed: ss('settlements', 'fences'), kindOf: (id) => kinds.get(id), blocked })
    if (fp.length) settlement.fences = fp
  }
  // building pads: ground flattened under every house and industrial / military building (pads.ts)
  const padFoot = buildingFootprints(settlement.placed, zones)
  if (padFoot.length) cur = composeHeights(base, g, waters, zones, roads, padFoot, settlement.lanes.map((l) => l.pts))
  // 9. power grid: hierarchical planner (worldpower.ts -> powergrid.ts), stations + access tracks, pads flattened
  await step('power')
  const pw = p.power ? worldPowerGrid(cur.heights, g, sites, zones, allRoads.map((r) => r.pts), isLakeOrSea, p.size, 'eden', powerWorld([...allRoads, ...settlement.lanes], settlement.placed.map((q) => q.corners), builtLots.filter((l) => l.used).map((l) => l.corners), zones), p.powerDistrib ?? 'auto') : null
  const power: (PowerLine & { id: string })[] = pw?.lines ?? []
  // 10. forests (none over a zone)
  await step('forests')
  const discs = zones.map(zoneDisc)
  const rawAreas: WorldArea[] = p.forests > 0
    ? generateForests(cur.heights, g, { seed: ss('forests', 'forests'), cover: Math.min(0.9, WORLD.vegetation.forestCover * p.forests), sites, biome: p.biome })
      .filter((f) => { for (let i = 0; i + 1 < f.pts.length; i += 2) if (discs.some((d) => Math.hypot(f.pts[i] - d.x, f.pts[i + 1] - d.z) < d.r + 30)) return false; return true })
      .map((f, k) => ({ id: `FOREST_GEN_${k + 1}`, kind: 'forest' as const, leaf: f.leaf, pts: f.pts }))
    : []
  // overlapping forest patches: same species = merged into one wood, else the later one is cut (no criss-crossing outlines)
  const areas: WorldArea[] = cutDiscs(mergeForestPatches(rawAreas), discs).map((a, k) => ({ ...a, id: `FOREST_GEN_${k + 1}` }))
  // 10b. countryside: plots + hedges (campaign.ts, Tanin AgriFieldGenerator method) on the open, gentle
  // ground around each settlement; never in a forest, a lake, a zone or the settlement core
  // 10a. production forests on part of the large conifer / mixed woods, tracks linked to the road network
  // forest / field tracks are graded like real ones (<= 15 %, short pitches 18 %): seed 21 mountains had a production
  // spine straight up a 107 % flank, field tracks at 22-29 %. A steep one is re-routed in switchbacks (network.ts
  // router at 15 %), else kept only under 18 %, else dropped. Field tracks are never re-routed (their plots are cut
  // along them): only dropped.
  const TRACK_GRADE = 0.15, TRACK_PITCH = 0.18
  const trackGrade = (pts: number[]) => worstGrade(pts, cur.heights, g).grade
  const carved = new WeakSet<number[]>() // re-routed tracks: their bed is carved like a road's
  const tameTrack = (pts: number[], reroute = true): number[] | null => {
    const g0 = trackGrade(pts)
    if (g0 <= TRACK_GRADE) return pts
    if (reroute) {
      const r = routeLink(cur.heights, g, cur.sim.river, [pts[0], pts[1]], [pts[pts.length - 2], pts[pts.length - 1]], 'dirt', WORLD.roads.maxSlope, TRACK_GRADE, true)
      if (r) {
        // a switchback track is cut into the flank (bed carved, hairpin platforms): graded on that bed
        const t = cur.heights.slice()
        carveRoads(t, g, [{ id: 'track', type: 'dirt', pts: r, flatten: true }])
        const gr = worstGrade(r, t, g).grade
        if (gr <= TRACK_PITCH && gr < g0) { carved.add(r); return r }
      }
    }
    return g0 <= TRACK_PITCH ? pts : null
  }
  const prod = addProdForests(areas, { seed: ss('forests', 'prodforest'), roads: allRoads.map((r) => r.pts), ground: (x, z) => hAt(x, z), fix: (pts) => tameTrack(pts),
    blocked: (x, z) => discs.some((d) => Math.hypot(x - d.x, z - d.z) < d.r + 10) || settlement.placed.some((b) => Math.abs(b.x - x) < 14 && Math.abs(b.z - z) < 14) })
  for (const tr of prod.tracks) if (carved.has(tr.pts)) (tr as Road).flatten = true
  if (prod.count) { areas.splice(0, areas.length, ...(prod.areas as WorldArea[])); roads.push(...prod.tracks); allRoads.push(...prod.tracks) }
  if (prod.tracks.some((tr) => carved.has(tr.pts))) {
    const recompose = () => { cur = composeHeights(base, g, waters, zones, roads, padFoot, settlement.lanes.map((l) => l.pts)) } // switchback beds cut in (pads kept)
    recompose()
    // last check on the composed ground (other beds, pads and banks overlap the trial carve): still too steep = dropped
    const bad = new Set(prod.tracks.filter((tr) => trackGrade(tr.pts) > TRACK_PITCH + 0.02).map((tr) => tr.id))
    if (bad.size) {
      for (const list of [roads, allRoads]) list.splice(0, list.length, ...list.filter((r) => !bad.has(r.id)))
      if (prod.tracks.some((tr) => bad.has(tr.id) && carved.has(tr.pts))) recompose()
    }
  }
  const forestRings = [...areas.map((a) => a.pts), ...prod.outlines]
  const topH = cur.heights.reduce((a, b) => Math.max(a, b), 0)
  const camp: CampaignResult = { fields: [], hedges: [], shapes: [] }
  // field groves are low-ground woods: broadleaf in Everon, mixed in the conifer biomes (#7)
  // low-ground probe 0.1: below Everon's broad threshold (0.15 since 46cec76; 0.2 had silently turned them mixed)
  const groveLeaf = leafOf(0.05, forestTuning(p.biome).needleShift)
  const seen = new Set<string>(), laid: Feature<Polygon>[] = [], countryside: number[][] = []
  const fieldSite: { x: number; z: number; f: number; r: number }[] = [] // the town of each plot (crop colouring)
  sites.forEach((s, k) => {
    const R = SITE_RADIUS[s.kind], ring = R * (s.kind === 'town' ? 2.6 : 2.4) + (s.kind === 'hamlet' ? 420 : 260) // hamlets: a farm needs its fields too
    const ok = (x: number, z: number) => {
      if (isLakeOrSea(x, z) || Math.hypot(x - s.x, z - s.z) < R * 1.05) return false
      if (discs.some((d) => Math.hypot(x - d.x, z - d.z) < d.r + 20)) return false
      if (sites.some((q) => q !== s && Math.hypot(x - q.x, z - q.z) < SITE_RADIUS[q.kind] * 1.05)) return false
      const d = g.step * 2, gx = (hAt(x + d, z) - hAt(x - d, z)) / (2 * d), gz = (hAt(x, z + d) - hAt(x, z - d)) / (2 * d)
      if (Math.hypot(gx, gz) > 0.15 || hAt(x, z) > topH * 0.6) return false
      return !forestRings.some((p) => pointInPoly(p, x, z))
    }
    // the countryside polygon follows the open farmable land around the site (like a zone drawn by hand),
    // then exactly the Zone tool's "Champs" pipeline fills it (zonefill.ts fillFieldZone)
    const zs = countrysideZones(s.x, s.z, R * 1.1, ring, ok)
    if (!zs.length) return
    countryside.push(...zs)
    const near = (x: number, z: number) => Math.hypot(x - s.x, z - s.z) < ring + 60
    const obst = [...roadObstacles(allRoads.map((rd) => ({ pts: rd.pts, half: roadHalf(rd) })), 3, near), // radius from the footprint: a 20 m farmhouse reaches past 14 m (pre-send seeds 21 / 42: farmhouses on field tracks)
      ...settlement.placed.filter((b) => near(b.x, b.z)).map((b) => { const c = (b as { corners?: number[] }).corners; let r = 14; if (c) for (let i = 0; i < c.length; i += 2) r = Math.max(r, Math.hypot(c[i] - b.x, c[i + 1] - b.z) + 7); return pointObstacle(b.x, b.z, r) }),
      // site zones (cemetery, parking, vanilla stamps): no field track through them (pre-send: 21 cemetery objects on tracks, seed 42)
      ...zones.filter((zn) => zn.kind === 'site' && zn.entities.length && near(zn.x, zn.z)).map((zn) => { const d = zoneDisc(zn); return pointObstacle(d.x, d.z, d.r + 4) })]
    zs.forEach((zone, zi) => {
      const id = zi ? `${k + 1}_${zi + 1}` : `${k + 1}`
      const r = fillFieldZone({ zone, seed: ss('fields', 'fields' + k, zi), prefix: `FIELD_${id}_`, angle: ss('fields', 'field' + k) % 90, ok, obstacles: obst, laid, seen, roads: allRoads.map((rd) => rd.pts), hedgeSeed: ss('fields', 'hedges' + k, zi), centre: [s.x, s.z], fringe: R * 1.1, reach: ring })
      camp.fields.push(...r.fields)
      fieldSite.push(...r.fields.map(() => ({ x: s.x, z: s.z, f: R * 1.1, r: ring })))
      for (const h of r.hedges) {
        camp.hedges.push(h)
        camp.shapes.push({ id: `FIELD_${id}_Hedge_${camp.shapes.length}`, kind: 'polyline', closed: false, points: h.flatMap((q) => [Math.round(q[0] * 100) / 100, Math.round(q[1] * 100) / 100]), generator: GENERATORS.hedgeCorylus })
      }
      // no grove in a treeless biome (desert): its forests are off too
      if (Math.min(0.9, WORLD.vegetation.forestCover * p.forests) * forestTuning(p.biome).coverMul >= 0.03) r.groves.forEach((pts, j) => areas.push({ id: `FOREST_GROVE_${id}_${j + 1}`, kind: 'forest', leaf: groveLeaf, pts }))
      const blk = [...settlement.placed.map((q) => q.corners), ...(pw?.stations ?? []).map((st) => footprintCorners(st))]
      const trackHits = (l: number[], m: number) => {
        for (let i = 0; i + 1 < l.length; i += 2) for (const c of blk) if (polyNear(c, l[i], l[i + 1], m)) return true
        return false
      }
      for (const [j, pts] of r.tracks.entries()) {
        // an end landing on a roundabout ring becomes one of its control points (the junction is shared, not a near miss)
        for (const e of [0, pts.length - 2]) for (const ring of roads) {
          if (!ring.id.startsWith('RB_')) continue
          const [qx, qz] = nearestOn(ring.pts, pts[e], pts[e + 1])
          if (Math.hypot(qx - pts[e], qz - pts[e + 1]) > 2.5) continue
          pts[e] = qx; pts[e + 1] = qz; insertPoint(ring, qx, qz); break
        }
        // a field track never runs through a house or a power station (they are placed before the countryside;
        // seed 21 audit: SET_VILLAGE_1_H25 on ROAD_FIELD_2_3_1, PSTA_MVLV_7 on ROAD_FIELD_7_1): the track is dropped
        if (trackHits(centreLine(pts, 4), 3.5)) continue
        if (!tameTrack(pts, false)) continue // steeper than a field track can be (seed 42 mountains: 29 %)
        const tr: Road = { id: `ROAD_FIELD_${id}_${j + 1}`, type: 'dirt', pts, auto: true }
        roads.push(tr); allRoads.push(tr) // later sites' plots are cut by the track too
      }
    })
  })
  // hedges and groves off every road / track, once ALL of them exist (seed 21 live check: FIELD_7_Hedge_281 across
  // ROAD_ASPHALTE_ETROITE and PSTA_ROAD_7, FOREST_GROVE_7_1 on the road edge): the power access tracks (PSTA_ROAD_*)
  // and the field tracks of later sites were never seen by the plots laid before them
  const corridorsNow = () => new Corridors([...roads, ...settlement.lanes, ...zones.flatMap((z) => z.roads), ...(pw?.access ?? []).map((pts, i): Road => ({ id: `PSTA_ROAD_${i + 1}`, type: 'dirt', pts }))]
    .filter((rd) => rd.pts.length >= 4).map((rd) => ({ id: rd.id, pts: centreLine(rd.pts, 4), half: roadHalf(rd) })))
  let vegRoads = corridorsNow()
  const clipVegetation = () => {
    vegRoads = corridorsNow()
    const hedges: number[][][] = [], shapes: CampaignResult['shapes'] = []
    camp.hedges.forEach((h, i) => {
      const sh = camp.shapes[i], parts = clipLine(h, vegRoads, HEDGE_ROAD_MARGIN)
      parts.forEach((q, j) => {
        hedges.push(q)
        shapes.push({ ...sh, id: j ? `${sh.id}_${String.fromCharCode(96 + j)}` : sh.id, points: q.flatMap((v) => [Math.round(v[0] * 100) / 100, Math.round(v[1] * 100) / 100]) })
      })
    })
    camp.hedges = hedges; camp.shapes = shapes
    for (const zn of zones) if (zn.sub === 'fieldtrees') zn.entities = zn.entities.filter((e) => !vegRoads.hit(e.x, e.z, 2))
    for (let i = areas.length - 1; i >= 0; i--) if (areas[i].id.startsWith('FOREST_GROVE_') && ringOnRoad(areas[i].pts, vegRoads, 2)) areas.splice(i, 1)
  }
  clipVegetation()
  // crops over the whole countryside at once: plots of two zones / sites can touch (fieldlayout.ts)
  if (camp.fields.length) camp.crops = colourCrops(camp.fields, { seed: ss('fields', 'crops'), centre: (x, z) => {
    let best = Infinity
    for (const q of fieldSite) best = Math.min(best, (Math.hypot(x - q.x, z - q.z) - q.f) / Math.max(1, q.r - q.f))
    return best
  } })
  // 10c. riparian band along rivers / lake shores: width from the height above the water + the bank grade
  const riparian = riparianBands(cur.heights, g, waters, {
    seed: ss('forests', 'riparian'), roads: allRoads.map((r) => ({ pts: r.pts, half: roadHalf(r) })),
    polys: [...camp.fields.map((f) => f.flat()), ...areas.filter((a) => a.kind !== 'forest').map((a) => a.pts)], // forests: the band takes their edge (cut below)
    bank: 4, maxWidth: 46, handMax: 5.5, // carved banks: HAND from the bank top; a little wider than drawn rivers
    points: [...sites.map((q) => ({ x: q.x, z: q.z, r: SITE_RADIUS[q.kind] })), ...discs.map((d) => ({ x: d.x, z: d.z, r: d.r + 10 })), ...bridgesOut.map((b) => ({ x: b.x, z: b.z, r: 20 })), ...settlement.placed.map((b) => ({ x: b.x, z: b.z, r: 12 }))],
  })
  { const cut = cutForests(areas, riparian); areas.splice(0, areas.length, ...cut) }
  // 10c-bis. gameplay cover (gameplayCover.ts, GAMEPLAY_MAPPING.md): village belts with one open side, wooded strips
  // from the massifs to bare villages, copses where the open ground is > 200 m from cover (1-2 armour plains kept)
  if ((p.gameplayCover ?? true) && Math.min(0.9, WORLD.vegetation.forestCover * p.forests) * forestTuning(p.biome).coverMul >= 0.03) {
    const other = areas.filter((a) => a.kind !== 'forest').map((a) => a.pts)
    const gc = gameplayCover({ heights: cur.heights, grid: g, forests: areas.filter((a) => a.kind === 'forest').map((a) => a.pts), houses: settlement.placed,
      sites: sites.map((s) => ({ x: s.x, z: s.z, kind: s.kind, r: SITE_RADIUS[s.kind] })),
      roads: [...allRoads, ...settlement.lanes].filter((rd) => rd.pts.length >= 4).map((rd) => ({ pts: centreLine(rd.pts, 4), half: roadHalf(rd) })),
      blocked: (x, z) => isLakeOrSea(x, z) || discs.some((d) => Math.hypot(x - d.x, z - d.z) < d.r + 10) || sites.some((s) => Math.hypot(x - s.x, z - s.z) < SITE_RADIUS[s.kind])
        || settlement.placed.some((b) => Math.abs(b.x - x) < 18 && Math.abs(b.z - z) < 18) || other.some((q) => pointInPoly(q, x, z))
        || (pw?.stations ?? []).some((st) => Math.hypot(st.x - x, st.z - z) < 30),
      avoid: camp.fields.map((f) => ({ x: f.reduce((a, q) => a + q[0], 0) / f.length, z: f.reduce((a, q) => a + q[1], 0) / f.length })),
      seed: ss('forests', 'gameplay') })
    // the cover is cut by the woods already there (a belt crossing a small field grove: two overlapping outlines)
    const gp: WorldArea[] = []
    ;([['BELT', gc.belts], ['STRIP', gc.strips], ['COPSE', gc.copses]] as const).forEach(([tag, list]) => list.forEach((pts, j) => gp.push({ id: `FOREST_GP_${tag}_${j + 1}`, kind: 'forest', leaf: groveLeaf, pts })))
    areas.push(...cutForests(gp, areas.filter((a) => a.kind === 'forest').map((a) => ({ pts: a.pts })) as never))
  }
  // 10d. trees of the open countryside: isolated field trees, corner clumps, hedgerow trees (fieldtrees.ts),
  // one 'site' zone of single vanilla tree entities (drawn, saved and sent like any zone)
  const ftd = (p.fieldTrees ?? 1) * Math.min(1, forestTuning(p.biome).coverMul)
  if (camp.fields.length && ftd > 0 && Math.min(0.9, WORLD.vegetation.forestCover * Math.max(p.forests, 0.5)) * forestTuning(p.biome).coverMul >= 0.03) {
    // smoothed centre lines (as laid) of the roads and the village / town lanes (pre-send seed 42: 3 field trees on a road)
    const rp = [...allRoads, ...settlement.lanes].filter((rd) => rd.pts.length >= 4).map((rd) => ({ pts: centreLine(rd.pts, 4), half: roadHalf(rd) + 3 }))
    const nearRoad = (x: number, z: number) => rp.some((rd) => { for (let i = 0; i + 3 < rd.pts.length; i += 2) {
      const ax = rd.pts[i], az = rd.pts[i + 1], dx = rd.pts[i + 2] - ax, dz = rd.pts[i + 3] - az, L = dx * dx + dz * dz
      if (Math.abs(x - ax) > 400 && Math.abs(x - rd.pts[i + 2]) > 400) continue
      const t = L ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L)) : 0
      if (Math.hypot(x - ax - dx * t, z - az - dz * t) < rd.half) return true
    } return false })
    const ents = fieldTrees({ fields: camp.fields, hedges: camp.hedges, seed: ss('forests', 'fieldtrees'), density: ftd, biome: p.biome, prefix: 'TREE_FIELD_',
      ok: (x, z) => !isLakeOrSea(x, z) && !settlement.placed.some((b) => Math.abs(b.x - x) < 12 && Math.abs(b.z - z) < 12) && !areas.some((a) => a.kind === 'forest' && pointInPoly(a.pts, x, z)) && !nearRoad(x, z) && !vegRoads.hit(x, z, 3) })
    if (ents.length) {
      let cx = 0, cz = 0
      for (const t of ents) { cx += t.x / ents.length; cz += t.z / ents.length }
      zones.push({ id: 'TREES_FIELD', kind: 'site', sub: 'fieldtrees', x: cx, z: cz, yaw: 0, seed: ss('forests', 'fieldtrees'), shapes: [], entities: ents, flat: [], plat: [], roads: [], warnings: [],
        boxes: ents.map((t) => ({ corners: [t.x - 2, t.z - 2, t.x + 2, t.z - 2, t.x + 2, t.z + 2, t.x - 2, t.z + 2], role: 'tree', h: 0.1 })) })
    }
  }
  // TAT-like vegetation layers (vegLayers.ts): elevation-banded understory + rocks on open ground (Poisson-disk,
  // slope filter, CE ~1.7), and a feathered bush belt round the small woods that get no native edge bands
  if (p.forests > 0) {
    const sl = (x: number, z: number) => (Math.hypot(hAt(x + 4, z) - hAt(x - 4, z), hAt(x, z + 4) - hAt(x, z - 4)) / 16)
    const houseNear = (x: number, z: number) => settlement.placed.some((b) => Math.abs(b.x - x) < 15 && Math.abs(b.z - z) < 15)
    const inForest = (x: number, z: number) => areas.some((a) => (a.kind === 'forest' || a.kind === 'field') && pointInPoly(a.pts, x, z))
    // no bush / rock on a carriageway (pre-send check flagged ~100 belt bushes on roads, seed 42): 2 m cells within half + 2.5 m (1.5: a belt bush 0.7 m on a prod track, seed 21)
    const onRoadCells = new Set<number>()
    // + the power stations' access tracks (dirt, 2 m half; 4th live send: BELT_4_B2 on PSTA_ROAD_1)
    for (const r of [...allRoads, ...settlement.lanes, ...(pw?.access ?? []).map((pts, i): Road => ({ id: `PSTA_ROAD_${i + 1}`, type: 'dirt', pts }))]) {
      if (r.pts.length < 4) continue
      const c0 = centreLine(r.pts, 2), R = roadHalf(r) + 2.5, n = Math.ceil(R / 2)
      // both ends run 1.75 m further later (overlapJunctions, step below): extend them here too
      const ext = (x: number, z: number, px: number, pz: number) => { const L = Math.hypot(x - px, z - pz) || 1; return [x + ((x - px) / L) * 2, z + ((z - pz) / L) * 2] }
      const k = c0.length
      const c = k >= 4 ? [...ext(c0[0], c0[1], c0[2], c0[3]), ...c0, ...ext(c0[k - 2], c0[k - 1], c0[k - 4], c0[k - 3])] : c0
      for (let i = 0; i < c.length; i += 2) {
        const cx = Math.floor(c[i] / 2), cz = Math.floor(c[i + 1] / 2)
        for (let dx = -n; dx <= n; dx++) for (let dz = -n; dz <= n; dz++) if (Math.hypot(dx * 2, dz * 2) <= R + 1) onRoadCells.add((cx + dx) * 100003 + (cz + dz))
      }
    }
    const onRoad = (x: number, z: number) => onRoadCells.has(Math.floor(x / 2) * 100003 + Math.floor(z / 2))
    const okOpen = (x: number, z: number) => !isLakeOrSea(x, z) && !onRoad(x, z) && !houseNear(x, z) && !inForest(x, z) && !zones.some((zn) => { const d = zoneDisc(zn); return Math.hypot(d.x - x, d.z - z) < d.r })
    const span = (g.cols - 1) * g.step
    const scat = scatterLayers({ box: { minX: g.minX, minZ: g.minZ, maxX: g.minX + span, maxZ: g.minZ + span }, heightAt: hAt, slopeAt: sl, maxHeight: isl.maxHeight,
      ok: okOpen, seed: ss('forests', 'scatter'), density: Math.min(1.5, p.forests), prefix: 'SCAT_', max: Math.round(250 * landKm2) })
    const segDist = (pts: number[], x: number, z: number) => { let b = Infinity; for (let i = 0; i < pts.length; i += 2) { const j = (i + 2) % pts.length
      const ax = pts[i], az = pts[i + 1], dx = pts[j] - ax, dz = pts[j + 1] - az, L = dx * dx + dz * dz, t = L ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L)) : 0
      b = Math.min(b, Math.hypot(x - ax - dx * t, z - az - dz * t)) } return b }
    areas.filter((a) => a.kind === 'forest' && polyAreaM2(a.pts) < 6000).slice(0, 400).forEach((a, k) => {
      scat.push(...featheredBelt({ pts: a.pts, seed: ss('forests', 'belt', k), prefix: `BELT_${k + 1}_`, max: 300,
        ok: (x, z) => !isLakeOrSea(x, z) && !onRoad(x, z) && !houseNear(x, z), inside: (x, z) => pointInPoly(a.pts, x, z), distToOutline: (x, z) => segDist(a.pts, x, z),
        trees: a.leaf === 'needle' ? [VEG.spruce, VEG.pine] : [VEG.hornbeam, VEG.birch], bushes: [VEG.hazel, VEG.hazel2] }))
    })
    if (scat.length) zones.push({ id: 'VEG_SCATTER', kind: 'site', sub: 'scatter', x: g.minX + span / 2, z: g.minZ + span / 2, yaw: 0, seed: ss('forests', 'scatter'), shapes: [], entities: scat, flat: [], plat: [], roads: [], warnings: [],
      boxes: scat.map((t) => ({ corners: [t.x - 1, t.z - 1, t.x + 1, t.z - 1, t.x + 1, t.z + 1, t.x - 1, t.z + 1], role: 'tree', h: 0.1 })) })
    // rocks / cliffs / scree / field stones on the steepest ranks of the island (cliffRocks.ts, ROCKS_VANILLA.md), 8 m clear of roads, houses, zones and water
    const nearRoad = (x: number, z: number) => onRoad(x, z) || onRoad(x + 8, z) || onRoad(x - 8, z) || onRoad(x, z + 8) || onRoad(x, z - 8)
    // bilinear ground for the burial depth (hAt is the nearest vertex: up to ~3 m off on a steep 8 m cell)
    const gAt = (x: number, z: number) => {
      const fx = Math.min(Math.max((x - g.minX) / g.step, 0), g.cols - 1.001), fz = Math.min(Math.max((z - g.minZ) / g.step, 0), g.rows - 1.001)
      const c = Math.floor(fx), r = Math.floor(fz), u = fx - c, v = fz - r, H = cur.heights, i = r * g.cols + c
      return (H[i] * (1 - u) + H[i + 1] * u) * (1 - v) + (H[i + g.cols] * (1 - u) + H[i + g.cols + 1] * u) * v
    }
    const forestR = rasterCover(g, areas.filter((a) => a.kind === 'forest'))
    const inWood = (x: number, z: number) => { if (!forestR) return false; const c = Math.round((x - g.minX) / g.step), r = Math.round((z - g.minZ) / g.step); const v = forestR[r * g.cols + c]; return v >= 1 && v <= 3 }
    buryRocks(scat, gAt)
    // site / industry / military footprints only: the map-wide scatter layers (VEG_SCATTER, field trees...) are a
    // zone too and their disc covers the whole island (that is why this placed 0 rocks before)
    const discs = zones.map(zoneDisc).filter((d) => d.r < 600)
    const cliffs = cliffRocks({ box: { minX: g.minX, minZ: g.minZ, maxX: g.minX + span, maxZ: g.minZ + span }, heightAt: hAt, groundAt: gAt, forest: inWood, seed: ss('forests', 'cliffs'), spacing: rockProfile(p.biome).spacing, density: rockProfile(p.biome).density, rockQ: rockProfile(p.biome).rockQ, max: Math.round(rockProfile(p.biome).perKm2 * landKm2),
      ok: (x, z) => !isLakeOrSea(x, z) && !nearRoad(x, z) && !houseNear(x, z) && !discs.some((d) => Math.hypot(d.x - x, d.z - z) < d.r + 8) })
    if (cliffs.length) zones.push({ id: 'CLIFF_ROCKS', kind: 'site', sub: 'cliffs', x: g.minX + span / 2, z: g.minZ + span / 2, yaw: 0, seed: ss('forests', 'cliffs'), shapes: [], entities: cliffs, flat: [], plat: [], roads: [], warnings: [],
      boxes: cliffs.map((t) => ({ corners: [t.x - 3, t.z - 3, t.x + 3, t.z - 3, t.x + 3, t.z + 3, t.x - 3, t.z + 3], role: 'rock', h: 2 })) })
  }
  // 10c. pasture / paddock fences along the country roads near farms and villages (pastures.ts), outside the
  // settlement discs, forests, fields' trees and zones
  {
    const DISC: Record<string, number> = { town: 300, village: 170, hamlet: 80 }
    const treeCells = new Set<number>()
    for (const zn of zones) if (zn.sub === 'scatter' || zn.sub === 'fieldtrees') for (const e of zn.entities) treeCells.add(Math.floor(e.x / 3) * 100003 + Math.floor(e.z / 3))
    const nearTree = (x: number, z: number) => { const cx = Math.floor(x / 3), cz = Math.floor(z / 3); for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) if (treeCells.has((cx + dx) * 100003 + cz + dz)) return true; return false }
    const siteZones = zones.filter((zn) => zn.sub !== 'scatter' && zn.sub !== 'fieldtrees').map(zoneDisc)
    const gentle = (x: number, z: number) => Math.hypot(hAt(x + 5, z) - hAt(x - 5, z), hAt(x, z + 5) - hAt(x, z - 5)) / 10 < 0.3
    const inWood = (x: number, z: number) => areas.some((a) => a.kind === 'forest' && pointInPoly(a.pts, x, z))
    const lines = [...allRoads, ...settlement.lanes].filter((r) => r.pts.length >= 4).map((r) => ({ pts: r.pts, half: roadHalf(r) }))
    const pf = pastureFences({ seed: ss('settlements', 'pastures'), roads: allRoads.filter((r) => r.pts.length >= 4).map((r) => ({ pts: r.pts, half: roadHalf(r) })), buildings: settlement.placed, density: pastureDensity(p.biome), styles: pastureStyles(p.biome),
      ok: (x, z) => !isLakeOrSea(x, z) && gentle(x, z) && !sites.some((s) => Math.hypot(x - s.x, z - s.z) < (DISC[s.kind] ?? 40) * 0.6) && !siteZones.some((d) => Math.hypot(d.x - x, d.z - z) < d.r + 10) && !inWood(x, z) && !nearTree(x, z),
      blocked: makeBlocker(settlement.placed.map((q) => q.corners), lines) })
    if (pf.length) settlement.fences = [...(settlement.fences ?? []), ...pf]
  }
  // tracks and trails through the woods take the forest styles (and open-ground trails gravel); the late
  // tracks (fields, production forests) may not cross the motorway either: cut back there
  styleTracks(roads, (x, z) => forestRings.some((p) => pointInPoly(p, x, z)))
  if (p.motorway && roads.some((r) => r.id === 'MW_A')) resolveCrossings(roads, roads.filter((r) => r.id.startsWith('MW_')), { cutOnly: true })
  { const keep = new Set(dropOrphanRings(roads)); for (let k = roads.length - 1; k >= 0; k--) if (!keep.has(roads[k])) roads.splice(k, 1) }
  // every road / lane end on another road runs 1.75 m into it: overlapping meshes, no hole at the junction
  { const all = [...roads, ...settlement.lanes]; overlapJunctions(roads, all); overlapJunctions(settlement.lanes, all) }
  // the junction overlaps above lengthen road ends by 1.75 m (seed 42: a hedge end on ROAD_ASPHALTE_ETROITE_1): clip again
  clipVegetation()
  // pole feet off every carriageway: half width + POLE_ROAD_CLEAR (seed 21 live: PSTA_POLE_10, POWER_LV_18 on a dirt
  // track); the shape points are the poles (perPoint export), so what is checked here is what Workbench builds
  for (const l of power) for (let i = 0; i + 1 < l.poles.length; i += 2) {
    if ((pw?.stations ?? []).some((st) => Math.hypot(st.x - l.poles[i], st.z - l.poles[i + 1]) < Math.max(st.w, st.d) / 2 + 3)) continue // a cable slot on its station
    for (let k = 0; k < 8; k++) { const h = vegRoads.hit(l.poles[i], l.poles[i + 1], POLE_ROAD_CLEAR); if (!h) break; l.poles[i] += h.ux * (h.need + 0.2); l.poles[i + 1] += h.uz * (h.need + 0.2) }
  }
  // last word on the vegetation scatter: the roads moved since (cuts, junction overlaps, late tracks), so a bush or
  // tree within the carriageway + 1 m of a final road or lane goes (pre-send seed 21: a belt bush 0.7 m on a prod track)
  {
    const cells = new Map<number, { pts: number[]; h: number }[]>()
    for (const r of [...roads, ...settlement.lanes, ...zones.flatMap((z) => z.roads)]) {
      if (r.pts.length < 4) continue
      const l = { pts: centreLine(r.pts, 4), h: roadHalf(r) + 1 }
      const seen = new Set<number>()
      for (let i = 0; i < l.pts.length; i += 2) { const k = Math.floor(l.pts[i] / 20) * 100003 + Math.floor(l.pts[i + 1] / 20); if (!seen.has(k)) { seen.add(k); (cells.get(k) ?? cells.set(k, []).get(k)!).push(l) } }
    }
    const hit = (x: number, z: number) => {
      const cx = Math.floor(x / 20), cz = Math.floor(z / 20)
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) for (const l of cells.get((cx + dx) * 100003 + cz + dz) ?? []) {
        const p = l.pts
        for (let i = 2; i < p.length; i += 2) { const ax = p[i - 2], az = p[i - 1], ex = p[i] - ax, ez = p[i + 1] - az, L = ex * ex + ez * ez, u = L ? Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / L)) : 0; if (Math.hypot(x - ax - u * ex, z - az - u * ez) < l.h) return true }
      }
      return false
    }
    for (const zn of zones) if (zn.sub === 'scatter' || zn.sub === 'fieldtrees') {
      const keep = zn.entities.map((e) => !hit(e.x, e.z))
      if (keep.every(Boolean)) continue
      if (zn.boxes && zn.boxes.length === zn.entities.length) zn.boxes = zn.boxes.filter((_, i) => keep[i])
      zn.entities = zn.entities.filter((_, i) => keep[i])
    }
  }
  // 10d. street lamps along the settlement streets (streetLights.ts), last: the roads, lanes, fences, poles and
  // every zone object are final; lamps keep clear of them
  const lamps: StreetLamp[] = []
  if (p.streetLights !== false) {
    const objs = new Map<number, [number, number][]>()
    const put = (x: number, z: number) => { const k = Math.floor(x / 8) * 100003 + Math.floor(z / 8); (objs.get(k) ?? objs.set(k, []).get(k)!).push([x, z]) }
    for (const zn of zones) for (const e of zn.entities) put(e.x, e.z)
    const wallPts = (pts: number[]) => { for (let i = 0; i + 3 < pts.length; i += 2) { const n = Math.max(1, Math.ceil(Math.hypot(pts[i + 2] - pts[i], pts[i + 3] - pts[i + 1]) / 1.5)); for (let k = 0; k <= n; k++) put(pts[i] + ((pts[i + 2] - pts[i]) * k) / n, pts[i + 1] + ((pts[i + 3] - pts[i + 1]) * k) / n) } }
    for (const fp of settlement.fences ?? []) for (const f of fp.fences) wallPts(f.pts)
    for (const zn of zones) for (const sh of zn.shapes) if (sh.kind === 'polyline' && !/RG_Road/i.test(sh.generator)) wallPts(sh.points)
    for (const fp of settlement.parcels ?? []) for (const a of fp.items) put(a.x, a.z)
    const near = (x: number, z: number, r: number) => { const cx = Math.floor(x / 8), cz = Math.floor(z / 8); for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) for (const q of objs.get((cx + dx) * 100003 + cz + dz) ?? []) if (Math.hypot(q[0] - x, q[1] - z) < r) return true; return false }
    lamps.push(...streetLights({
      roads: [...roads, ...settlement.lanes, ...zones.flatMap((z) => z.roads)].filter((r) => r.pts.length >= 4),
      sites: sites.filter((s) => !s.id.startsWith('FARM_')),
      buildings: settlement.placed.map((q) => ({ corners: q.corners, x: q.x, z: q.z, site: q.site })),
      footprints: zones.flatMap((z) => z.sub === 'scatter' || z.sub === 'fieldtrees' ? [] : z.boxes.map((b) => b.corners)),
      poles: power.flatMap((l) => l.poles),
      blocked: (x, z) => isLakeOrSea(x, z) || near(x, z, 1.5),
      seed: ss('settlements', 'lamps'), biome: p.biome,
    }))
    if (lamps.length) zones.push({ id: 'STREETLIGHTS', kind: 'site', sub: 'streetlights', x: g.minX + ((g.cols - 1) * g.step) / 2, z: g.minZ + ((g.cols - 1) * g.step) / 2, yaw: 0, seed: ss('settlements', 'lamps'), shapes: [], flat: [], plat: [], roads: [], warnings: [],
      entities: lamps.map((l) => ({ id: l.id, prefab: l.prefab, x: l.x, z: l.z, yaw: l.yaw })),
      boxes: lamps.map((l) => ({ corners: [l.x - 0.4, l.z - 0.4, l.x + 0.4, l.z - 0.4, l.x + 0.4, l.z + 0.4, l.x - 0.4, l.z + 0.4], role: 'lamp', h: 5 })) })
  }
  // 11. surfaces (5 per block at most)
  await step('surfaces')
  const settleM = settlementMask(g, settlement.placed.map((q) => q.corners))
  let surfaces = computeSurfaces(g, cur.heights, isl.maxHeight, cur.sim.river, rasterCover(g, [...areas.filter((a) => !a.id.startsWith('FOREST_GP_')), ...cropCover(camp)]) /* gameplay copses / belts: trees on grass, like vanilla hedge woods */, settleM)
  // the rocky ground the vanilla rocks sit in: scree halo + bare rock at cliffs (cliffRocks.ts paintRockSurfaces)
  const rockZone = zones.find((zn) => zn.id === 'CLIFF_ROCKS')
  if (rockZone) paintRockSurfaces(surfaces, rockStamps(rockZone.entities), undefined, settleM)
  if (overfullBlocks(surfaces)) limitPerBlock(surfaces)
  const issues = validate({ roads, sites, settled: settlement.placed, power, refusedGaps: [], heights: cur.heights, grid: g })
  // the Workbench drops outline points closer than 0.5 m to the previous one (seed 21 report: 55 forest outlines
  // with lost points): merge them here so what is sent is what is built
  for (const a of areas) a.pts = dedupeRing(a.pts, 0.75)
  // last word for the small dressed zones (RP places, town sites): roads and lanes laid after them (villages, field
  // tracks, re-snapped roads) may cross them; their props on a carriageway are dropped, their walls cut there
  // (seed 42 pre-send: RP_SELL_POINT_2 on SET_VILLAGE_2_LANE_2, TOWN_1_SITE_2 wall and object on ROAD_TERRE_2)
  {
    const net = [...roads, ...settlement.lanes].filter((r) => r.pts.length >= 4).map((r) => ({ l: centreLine(r.pts, 4), h: roadHalf(r) }))
    const on = (x: number, z: number, m: number) => net.some((q) => lineDist(q.l, x, z) < q.h + m)
    for (const zn of zones) {
      if (!/^RP_|^VAN_BUS_STOP_|_SITE_[0-9]+$/.test(zn.id)) continue
      zn.entities = zn.entities.filter((e) => !on(e.x, e.z, 1))
      zn.shapes = zn.shapes.flatMap((sh) => {
        if (sh.kind !== 'polyline' || sh.closed || /RG_Road/i.test(sh.generator)) return [sh]
        const P = sh.points
        let hit = false
        for (let i = 0; i + 3 < P.length && !hit; i += 2) for (let k = 0; k <= 8; k++) if (on(P[i] + ((P[i + 2] - P[i]) * k) / 8, P[i + 1] + ((P[i + 3] - P[i + 1]) * k) / 8, 1)) { hit = true; break }
        if (!hit) return [sh]
        // walk the wall every <= 2 m, keep the off-road runs (original corners kept)
        const parts: number[][] = [[]]
        const push = (x: number, z: number) => { if (on(x, z, 1)) { if (parts[parts.length - 1].length) parts.push([]) } else parts[parts.length - 1].push(Math.round(x * 100) / 100, Math.round(z * 100) / 100) }
        push(P[0], P[1])
        for (let i = 0; i + 3 < P.length; i += 2) {
          const n = Math.max(1, Math.ceil(Math.hypot(P[i + 2] - P[i], P[i + 3] - P[i + 1]) / 2))
          for (let k = 1; k <= n; k++) { const x = P[i] + ((P[i + 2] - P[i]) * k) / n, z = P[i + 1] + ((P[i + 3] - P[i + 1]) * k) / n; if (k === n || on(x, z, 1) || on(P[i] + ((P[i + 2] - P[i]) * (k + 1)) / n, P[i + 1] + ((P[i + 3] - P[i + 1]) * (k + 1)) / n, 1) || on(P[i] + ((P[i + 2] - P[i]) * (k - 1)) / n, P[i + 1] + ((P[i + 3] - P[i + 1]) * (k - 1)) / n, 1)) push(x, z) }
        }
        return parts.filter((q) => q.length >= 4).map((q, k) => ({ ...sh, id: k ? `${sh.id}_${k}` : sh.id, points: q }))
      })
    }
  }
  // harbour land props left on a slope the harbour sculpt did not level (seed 21: shed props 13-22 m under a hillside
  // behind the apron): dropped on the final relief; deck, breakwater and sea pieces are kept
  for (const zn of zones) {
    if (!zn.harbour) continue
    const bad = new Set(harbourIssues(zn.entities, hAt).filter((i) => i.kind === 'sunk' || i.kind === 'floating' || i.kind === 'inWater').map((i) => i.id))
    zn.entities = zn.entities.filter((e) => !bad.has(e.id) || /PierConcrete_01_(20m|10m_end|corner_90)|Breakwater/i.test(e.prefab))
  }
  return { params: p, island: isl, grid: g, heights: cur.heights, waters, sites, roads, zones, settlement, power, ...(pw && { powerStations: pw.stations, powerAccess: pw.access, powerTopology: withLamps(gridTopology(pw), lamps) }), areas, surfaces, issues, overfull: overfullBlocks(surfaces), ...(camp.fields.length && { campaign: camp, countryside }), ...(bridgesOut.length && { bridges: bridgesOut }), ...(riparian.length && { riparian }), ...(lamps.length && { streetLights: lamps }) }
}

/** station footprint corners (x, z centre, yaw radians, w x d) */
function footprintCorners(st: { x: number; z: number; yaw: number; w: number; d: number }): number[] {
  const c = Math.cos(st.yaw), n = Math.sin(st.yaw), out: number[] = []
  for (const [u, v] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { const lx = (u * st.w) / 2, lz = (v * st.d) / 2; out.push(st.x + lx * c + lz * n, st.z - lx * n + lz * c) }
  return out
}
/** (x, z) inside the polygon or within m of its edges */
function polyNear(c: number[], x: number, z: number, m: number): boolean {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity
  for (let i = 0; i + 1 < c.length; i += 2) { x0 = Math.min(x0, c[i]); x1 = Math.max(x1, c[i]); z0 = Math.min(z0, c[i + 1]); z1 = Math.max(z1, c[i + 1]) }
  if (x < x0 - m || x > x1 + m || z < z0 - m || z > z1 + m) return false
  let o = false
  for (let i = 0, j = c.length - 2; i < c.length; j = i, i += 2) {
    if ((c[i + 1] > z) !== (c[j + 1] > z) && x < ((c[j] - c[i]) * (z - c[i + 1])) / (c[j + 1] - c[i + 1]) + c[i]) o = !o
    const ax = c[j], az = c[j + 1], dx = c[i] - ax, dz = c[i + 1] - az, L = dx * dx + dz * dz
    const t = L ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L)) : 0
    if (Math.hypot(x - ax - dx * t, z - az - dz * t) < m) return true
  }
  return o
}

/** distance from (x, z) to a polyline x,z,... */
function lineDist(p: number[], x: number, z: number): number {
  let m = Infinity
  for (let i = 0; i + 3 < p.length; i += 2) {
    const ax = p[i], az = p[i + 1], dx = p[i + 2] - ax, dz = p[i + 3] - az, L = dx * dx + dz * dz
    const t = L ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L)) : 0
    m = Math.min(m, Math.hypot(x - ax - dx * t, z - az - dz * t))
  }
  return m
}

/** street lamps of each consumer site in the power topology (entity names as sent: zone STREETLIGHTS prefix) */
function withLamps<T extends { consumers: { siteId: string; transformer: string | null }[] }>(t: T, lamps: StreetLamp[]): T {
  const by = new Map(lampConsumers(lamps).map((c) => [c.siteId, c.lamps.map((id) => 'STREETLIGHTS_' + id)]))
  return { ...t, consumers: t.consumers.map((c) => (by.has(c.siteId) ? { ...c, lamps: by.get(c.siteId)! } : c)) }
}
