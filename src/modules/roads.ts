// Road network drawn on the site: control points -> smooth centre line (Catmull-Rom, constant spacing).
// Outputs: relief flattened along the road, spline shapes with a road generator (Workbench), and road
// surfaces painted at pixel precision by the bridge (/masks "roads").

import type { WaterLevels } from './water'
import { embankRoads } from './embank'
import type { Grid } from './island'
import { t } from '../i18n'
import type { ProjectEntity, ProjectShape } from '../project'
import { arcLength, profileLine } from './roadgeom'
import { ROAD_CLASSES, classOf } from './roadgraph-classes'

export type RoadType = 'asphalt' | 'asphaltLine' | 'asphaltNarrow' | 'asphalt2' | 'asphalt3' | 'cobble' | 'cobbleRough' | 'concrete' | 'concretePanel' | 'dirt' | 'dirt2' | 'forest' | 'trailDirt' | 'trailGravel' | 'trailForest' | 'motorway' | 'concreteLine' | 'concreteNarrow' | 'concretePath' | 'coal' | 'trailCoal'

//! generator: bare paths are resolved to GUIDs by the plugin (docs/GENERATORS.md)
export const ROAD_TYPES: Record<RoadType, {
  label: string
  generator: string
  half: number // half width of the core surface = RoadWidth / 2 (sent to the generator), metres
  edge: number // fade / shoulder width, metres
  core: string
  side?: string
  colour: string
}> = {
  asphalt: { label: t('road.type.asphalt'), generator: '{723C2AAE6E9AD131}Prefabs/WEGenerators/Roads/Asphalt/RG_Road_Asphalt_E_01.et', half: 6, edge: 2, core: 'Asphalt_01', side: 'Dirt_01', colour: '#3a3a3e' },
  asphaltLine: { label: t('road.type.asphaltLine'), generator: '{512AB601E1636E26}Prefabs/WEGenerators/Roads/Asphalt/RG_Road_Asphalt_E_01_DashedLine.et', half: 6, edge: 2, core: 'Asphalt_01', side: 'Dirt_01', colour: '#44444a' },
  asphaltNarrow: { label: t('road.type.asphaltNarrow'), generator: '{8E689EDC77E2A3DC}Prefabs/WEGenerators/Roads/Asphalt/RG_Road_Asphalt_E_01_Narrow.et', half: 4, edge: 2, core: 'Asphalt_01', side: 'Dirt_01', colour: '#4a4a4e' },
  asphalt2: { label: t('road.type.asphalt2'), generator: '{1E681E4ED25E5E1F}Prefabs/WEGenerators/Roads/Asphalt/RG_Road_Asphalt_E_02.et', half: 4, edge: 4, core: 'Asphalt_01', side: 'Dirt_01', colour: '#3e3e44' },
  asphalt3: { label: t('road.type.asphalt3'), generator: '{FBF452B7DEBBC974}Prefabs/WEGenerators/Roads/Asphalt/RG_Road_Asphalt_E_03.et', half: 4, edge: 2, core: 'Asphalt_01', side: 'Dirt_01', colour: '#424248' },
  cobble: { label: t('road.type.cobble'), generator: '{24948AB10942D327}Prefabs/WEGenerators/Roads/Cobblestone/RG_Road_Cobblestone_01.et', half: 4, edge: 4, core: 'Cobblestone_01_Wave', side: 'Dirt_01', colour: '#6d655a' },
  cobbleRough: { label: t('road.type.cobbleRough'), generator: '{836900316A627744}Prefabs/WEGenerators/Roads/Cobblestone/RG_Road_Cobblestone_01_rough.et', half: 4, edge: 4, core: 'Cobblestone_01_Wave', side: 'Dirt_01', colour: '#746a5c' },
  concrete: { label: t('road.type.concrete'), generator: '{82B82C5E2B744C86}Prefabs/WEGenerators/Roads/Concrete/RG_Road_Concrete_USSR_02.et', half: 3.75, edge: 2, core: 'Concrete_01', side: 'Dirt_01', colour: '#8a8a86' },
  concretePanel: { label: t('road.type.concretePanel'), generator: '{EEB3D2A6FCAADFD6}Prefabs/WEGenerators/Roads/Concrete/RG_Road_ConcretePanel_01.et', half: 1.75, edge: 2, core: 'Concrete_02', side: 'Dirt_01', colour: '#93938e' },
  dirt: { label: t('road.type.dirt'), generator: '{8E83BBD5CEC42A11}Prefabs/WEGenerators/Roads/Dirt/RG_Road_Dirt_01.et', half: 2, edge: 4, core: 'Dirt_01', colour: '#8a6f4a' },
  dirt2: { label: t('road.type.dirt2'), generator: '{E2D78F357200A53F}Prefabs/WEGenerators/Roads/Dirt/RG_Road_Dirt_02.et', half: 2.25, edge: 4, core: 'Dirt_02', colour: '#8f7550' },
  forest: { label: t('road.type.forest'), generator: '{0032466D94C588E6}Prefabs/WEGenerators/Roads/Dirt/RG_Road_Forest_01.et', half: 2.25, edge: 4, core: 'Dirt_03', colour: '#6f5a3c' },
  trailDirt: { label: t('road.type.trailDirt'), generator: '{E4FE524AD8080397}Prefabs/WEGenerators/Roads/Dirt/RG_TrailDirt_01.et', half: 0.875, edge: 2.2, core: 'Dirt_01', colour: '#9a7d55' },
  trailGravel: { label: t('road.type.trailGravel'), generator: '{F49A6A9439B063BB}Prefabs/WEGenerators/Roads/Dirt/RG_TrailGravel_01.et', half: 0.875, edge: 2.2, core: 'Dirt_02', colour: '#a39880' },
  trailForest: { label: t('road.type.trailForest'), generator: '{BA46C6FF0A547B99}Prefabs/WEGenerators/Roads/Dirt/RG_TrailForest_01.et', half: 0.875, edge: 2.2, core: 'Dirt_03', colour: '#6a5638' },
  // added from the vanilla catalogue (Prefabs/WEGenerators/Roads, docs/ROAD_NETWORK_V2.md §3.1): bare paths, GUID resolved by the plugin
  motorway: { label: t('road.type.motorway'), generator: '{723C2AAE6E9AD131}Prefabs/WEGenerators/Roads/Asphalt/RG_Road_Asphalt_E_01.et', half: 6, edge: 2, core: 'Asphalt_01', side: 'Dirt_01', colour: '#2e2e34' },
  concreteLine: { label: t('road.type.concreteLine'), generator: 'Prefabs/WEGenerators/Roads/Concrete/RG_Road_Concrete_USSR_01_dashedline.et', half: 5.5, edge: 2, core: 'Concrete_01', side: 'Dirt_01', colour: '#868682' },
  concreteNarrow: { label: t('road.type.concreteNarrow'), generator: 'Prefabs/WEGenerators/Roads/Concrete/RG_Road_Concrete_USSR_01_narrow.et', half: 2.5, edge: 2, core: 'Concrete_01', side: 'Dirt_01', colour: '#8e8e8a' },
  concretePath: { label: t('road.type.concretePath'), generator: 'Prefabs/WEGenerators/Roads/Concrete/RG_Path_Concrete_USSR_01.et', half: 1.125, edge: 2, core: 'Concrete_01', colour: '#9a9a95' },
  coal: { label: t('road.type.coal'), generator: 'Prefabs/WEGenerators/Roads/Dirt/RG_Road_Coal_01.et', half: 2.25, edge: 4, core: 'Dirt_03', colour: '#3c3833' },
  trailCoal: { label: t('road.type.trailCoal'), generator: 'Prefabs/WEGenerators/Roads/Dirt/RG_TrailCoal_01.et', half: 0.875, edge: 2.2, core: 'Dirt_03', colour: '#45403a' },
}

export const ROAD_COLOURS: Record<string, [number, number, number]> = {
  Asphalt_01: [62, 62, 64],
  Dirt_01: [118, 100, 72],
  Dirt_02: [128, 112, 86],
  Dirt_03: [96, 80, 58],
  Cobblestone_01_Wave: [104, 98, 88],
  Concrete_01: [138, 138, 132],
  Concrete_02: [146, 146, 140],
}

//! paved roads get verge posts, crash barriers, bend signs and priority at junctions
export const isPaved = (t: RoadType) => t.startsWith('asphalt') || t.startsWith('concrete')

export interface Road {
  id: string
  type: RoadType
  pts: number[] // control points, flat X/Z
  width?: number // road width in metres (empty = style default)
  flatten?: boolean // true: relief flattened under the road (off by default)
  bridge?: boolean // real-world bridge / tunnel (OSM): kept as a road, terrain never flattened
  auto?: boolean // made by the network generator (replaced on regeneration)
  /** bridge decks (V2): arc length spans (m, along centreLine(pts, 5)) where the road flies over a valley:
   *  the terrain under them is never carved, the grade check skips them (bridges.ts planBridge builds the deck) */
  spans?: { from: number; to: number }[]
  /** overpass (motorway.ts): the bed is raised by h metres around arc length `at` (along centreLine(pts, 5)),
   *  flat over ±flat, ramped to 0 over `len` more on each side (approach embankments of a bridge deck) */
  lift?: { at: number; h: number; flat: number; len: number }[]
  /** motorway carriageway: median crash barrier polyline (between the two carriageways, road furniture) */
  median?: number[]
}

//! half width of the road surface, from the road's own width or its style
export const roadHalf = (r: Road) => (r.width && r.width > 0 ? r.width / 2 : ROAD_TYPES[r.type].half)

//! smooth centre line through the control points, resampled every `spacing` metres
export function centreLine(pts: number[], spacing: number): number[] {
  const n = pts.length / 2
  if (n < 2) return pts.slice()
  const P = (i: number): [number, number] => {
    const k = Math.min(Math.max(i, 0), n - 1)
    return [pts[k * 2], pts[k * 2 + 1]]
  }
  // dense Catmull-Rom
  const dense: [number, number][] = []
  for (let i = 0; i < n - 1; i++) {
    const [p0, p1, p2, p3] = [P(i - 1), P(i), P(i + 1), P(i + 2)]
    const len = Math.hypot(p2[0] - p1[0], p2[1] - p1[1])
    const steps = Math.max(2, Math.ceil(len / 2))
    for (let s = 0; s < steps; s++) {
      const t = s / steps
      const f = (a: number, b: number, c: number, d: number) =>
        b + 0.5 * t * (c - a + t * (2 * a - 5 * b + 4 * c - d + t * (3 * (b - c) + d - a)))
      dense.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])])
    }
  }
  dense.push(P(n - 1))
  // constant spacing by arc length; first and last points kept exactly (junctions)
  const out = [dense[0][0], dense[0][1]]
  let acc = 0
  for (let i = 1; i < dense.length; i++) {
    const [ax, az] = dense[i - 1], [bx, bz] = dense[i]
    const d = Math.hypot(bx - ax, bz - az)
    acc += d
    if (acc >= spacing && i < dense.length - 1) {
      out.push(bx, bz)
      acc = 0
    }
  }
  const [lx, lz] = dense[dense.length - 1]
  if (acc < spacing * 0.4 && out.length > 2) out.length -= 2
  out.push(lx, lz)
  return out
}

//! nearest control point of any road within `dist` metres (junction snapping)
export function snap(roads: Road[], x: number, z: number, dist: number): [number, number] | null {
  let best: [number, number] | null = null
  let bd = dist
  for (const r of roads)
    for (let i = 0; i < r.pts.length; i += 2) {
      const d = Math.hypot(r.pts[i] - x, r.pts[i + 1] - z)
      if (d < bd) { bd = d; best = [r.pts[i], r.pts[i + 1]] }
    }
  return best
}

//! Flattens the relief along the roads (in place): smooth height profile along the centre line,
//! full blend on the road, smooth fade outside. Road beds stay above the sea.
//! `water` (from carveWater): road beds stay 5 cm above the local lake / river level on the banks and
//! never fill open water (the bridges span it). `widthMul` over-widens the flat band (ARTE: 1.15).
//! Anti-submersion, cosine edge and width multiplier ported from ARTE (01_engineer.py:518-551),
//! MIT licence, Copyright (c) 2026 Icebird. See CREDITS.md.
export function carveRoads(heights: number[], grid: Grid, roads: Road[], opts: { water?: WaterLevels; widthMul?: number; legacyProfile?: boolean } = {}) {
  const water = opts.water, widthMul = opts.widthMul ?? 1.15
  const { cols, rows, step } = grid
  const at = (x: number, z: number) => {
    const gx = Math.min(Math.max(x / step, 0), cols - 1.001), gz = Math.min(Math.max(z / step, 0), rows - 1.001)
    const c = Math.floor(gx), r = Math.floor(gz), fx = gx - c, fz = gz - r
    const i = r * cols + c
    const a = heights[i] + (heights[i + 1] - heights[i]) * fx
    const b = heights[i + cols] + (heights[i + cols + 1] - heights[i + cols]) * fx
    return a + (b - a) * fz
  }
  const target = new Float32Array(heights.length).fill(NaN)
  const weight = new Float32Array(heights.length)
  const open = water ? Uint8Array.from(water.wet) : undefined // wet cells left open (bridged)
  for (const road of roads) {
    if (!road.flatten || road.bridge) continue
    const T = ROAD_TYPES[road.type]
    const line = centreLine(road.pts, step / 2)
    const m = line.length / 2
    if (m < 2) continue
    const prof = roadProfile(road, line, at, step / 2, opts.legacyProfile)
    // T junction: an end that lands on a bed already carved eases onto its height over ~60 m (no step)
    const ramp = Math.max(2, Math.round(60 / (step / 2)))
    for (const [e, dir] of [[0, 1], [m - 1, -1]]) {
      const k = Math.min(rows - 1, Math.max(0, Math.round(line[e * 2 + 1] / step))) * cols + Math.min(cols - 1, Math.max(0, Math.round(line[e * 2] / step)))
      if (!(weight[k] >= 0.99)) continue
      const d = target[k] - prof[e]
      for (let s = 0; s < Math.min(ramp, m); s++) prof[e + dir * s] += d * (1 - s / ramp)
    }
    const flat = roadHalf(road) * widthMul + T.edge + step
    const reach = flat + 3 * step
    const sl = road.spans?.length ? arcLength(line) : null
    const decks = water ? waterDecks(road, water.wet, grid) : []
    const underDeck = (x: number, z: number) => decks.some((d) => nearLine(d, x, z) < reach)
    for (let i = 0; i < m - 1; i++) {
      if (sl && road.spans!.some((sp) => sl[i + 1] > sp.from && sl[i] < sp.to)) continue // under a bridge deck
      const ax = line[i * 2], az = line[i * 2 + 1], bx = line[i * 2 + 2], bz = line[i * 2 + 3]
      const dx = bx - ax, dz = bz - az, len2 = dx * dx + dz * dz || 1
      const c0 = Math.max(0, Math.floor((Math.min(ax, bx) - reach) / step)), c1 = Math.min(cols - 1, Math.ceil((Math.max(ax, bx) + reach) / step))
      const r0 = Math.max(0, Math.floor((Math.min(az, bz) - reach) / step)), r1 = Math.min(rows - 1, Math.ceil((Math.max(az, bz) + reach) / step))
      for (let r = r0; r <= r1; r++)
        for (let c = c0; c <= c1; c++) {
          const x = c * step, z = r * step
          const t = Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / len2))
          const d = Math.hypot(x - ax - t * dx, z - az - t * dz)
          if (d >= reach) continue
          const u = d <= flat ? 1 : 1 - (d - flat) / (reach - flat)
          const w = 0.5 - 0.5 * Math.cos(Math.PI * u) // cosine ramp
          const k = r * cols + c
          // open water under a bridge deck: left to the bridge generator. Wet with no deck over it (a stream
          // the export split misses): the bed is filled across it (culvert), else the embankment gets a notch
          if (water && water.wet[k]) {
            if (underDeck(x, z)) continue
            open![k] = 0
          }
          if (w > weight[k]) {
            weight[k] = w
            let v = prof[i] + (prof[i + 1] - prof[i]) * t
            if (water && !Number.isNaN(water.level[k])) v = Math.max(v, water.level[k] + 0.05)
            target[k] = v
          }
        }
    }
  }
  layBeds(heights, { target, weight })
  if (!opts.legacyProfile) embankRoads(heights, grid, { target, weight }, open) // fill shoulders 1:2
  return { target, weight }
}
const nearLine = (p: number[], x: number, z: number) => {
  let best = Infinity
  for (let i = 0; i + 3 < p.length; i += 2) {
    const ax = p[i], az = p[i + 1], dx = p[i + 2] - ax, dz = p[i + 3] - az, L2 = dx * dx + dz * dz || 1
    const t = Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / L2))
    best = Math.min(best, Math.hypot(x - ax - t * dx, z - az - t * dz))
  }
  return best
}
//! Where the export (water.ts splitAtWater on roadShapes = centreLine(pts, 10)) will cut this road for a
//! bridge: its 10 m points that fall within the split margin (4 m) of a wet cell. Each wet run, with the dry
//! point on each side, is a deck polyline. A narrow stream slipping between two points gets no deck.
//! Errs towards "bridged" (radius + half a cell), i.e. the old open behaviour, never a fill under a deck.
export function waterDecks(road: Road, wet: Uint8Array, grid: Grid, margin = 4): number[][] {
  const { cols, rows, step } = grid
  const p = centreLine(road.pts, 10).map((v) => Math.round(v * 100) / 100), n = p.length / 2
  const rad = margin + step / 2, rc = Math.ceil(rad / step)
  const isWet = (x: number, z: number) => {
    const c0 = Math.round(x / step), r0 = Math.round(z / step)
    for (let r = Math.max(0, r0 - rc); r <= Math.min(rows - 1, r0 + rc); r++)
      for (let c = Math.max(0, c0 - rc); c <= Math.min(cols - 1, c0 + rc); c++)
        if (wet[r * cols + c] && Math.hypot(c * step - x, r * step - z) <= rad) return true
    return false
  }
  const w = Array.from({ length: n }, (_, i) => isWet(p[i * 2], p[i * 2 + 1]))
  const out: number[][] = []
  for (let i = 0; i < n; i++) {
    if (!w[i]) continue
    let j = i
    while (j + 1 < n && w[j + 1]) j++
    out.push(p.slice(Math.max(0, i - 1) * 2, (Math.min(n - 1, j + 1) + 1) * 2))
    i = j
  }
  return out
}
//! Height profile of a road bed along `line` (= centreLine(road.pts, step / 2)), the one carveRoads lays:
//! terrain averaged over ~80 m and kept above the sea; V2 (default) then holds the grade under the class design
//! grade and rounds the grade changes into vertical curves (roadgeom.ts profileLine). legacy: average only.
export function roadProfile(road: Road, line: number[], at: (x: number, z: number) => number, spacing: number, legacy = false): number[] {
  const m = line.length / 2
  const raw = Array.from({ length: m }, (_, i) => at(line[i * 2], line[i * 2 + 1]))
  if (legacy || m < 3) {
    const win = Math.max(1, Math.round(40 / spacing))
    return raw.map((_, i) => {
      let s = 0, k = 0
      for (let j = Math.max(0, i - win); j <= Math.min(m - 1, i + win); j++) { s += raw[j]; k++ }
      return Math.max(0.8, s / k)
    })
  }
  const spec = ROAD_CLASSES[classOf(road.type)]
  const y = profileLine(arcLength(line), raw, { maxGrade: spec.design, smooth: 40, curve: spec.kCrest * 4, floor: 0.8 })
  if (!road.lift?.length) return y
  // overpass approaches: arc lengths of this line scaled to the 5 m reference line the lifts are measured on
  const s = arcLength(line)
  return y.map((v, i) => {
    let up = 0
    for (const l of road.lift!) up = Math.max(up, l.h * Math.min(1, Math.max(0, 1 - (Math.abs(s[i] - l.at) - l.flat) / l.len)))
    return v + up
  })
}

/** road beds computed by carveRoads, as (target height, blend weight) per cell */
export interface RoadBeds { target: Float32Array; weight: Float32Array }
//! lays road beds (from carveRoads) on the relief again, e.g. after the runoff dug its channels across them
export function layBeds(heights: number[], b: RoadBeds) {
  for (let k = 0; k < heights.length; k++)
    if (b.weight[k] > 0) heights[k] = heights[k] + (b.target[k] - heights[k]) * b.weight[k]
}

//! spline shapes for the Workbench (points every ~25 m: few, regular points as the wiki advises)
export function roadShapes(roads: Road[]): ProjectShape[] {
  return roads.filter((r) => r.pts.length >= 4).map((r) => ({
    id: r.id,
    kind: 'spline',
    closed: false,
    points: centreLine(r.pts, 10).map((v) => Math.round(v * 100) / 100),
    generator: ROAD_TYPES[r.type].generator,
    // the site already shapes the relief: the generator must not reshape it again
    // width always sent: the generated road and the painted surface stay the same width
    paramKeys: ['AdjustHeightMap', 'RoadWidth'],
    paramValues: ['0', String(roadHalf(r) * 2)],
  }))
}

//! road bands for the bridge masks / satellite
export function roadMasks(roads: Road[]) {
  return roads.filter((r) => r.pts.length >= 4).map((r) => {
    const T = ROAD_TYPES[r.type]
    return { points: centreLine(r.pts, 4), half: roadHalf(r), edge: T.edge, core: T.core, side: T.side }
  })
}

// --- road furniture: verge posts and crash barriers as generator shapes beside the road ---

export const FURNITURE = {
  vergePost: '{8A50BD01BB937725}Prefabs/WEGenerators/Roads/VergePosts/PG_StoneVergePost_01.et',
}

export const BARRIERS = {
  modern: '{D6BDCB7A8BDCB610}Prefabs/WEGenerators/Walls/Crashbarrier/WG_CrashBarrier_01A.et',
  modernB: '{BAE9FF9A3718393E}Prefabs/WEGenerators/Walls/Crashbarrier/WG_CrashBarrier_01B.et',
  everon: '{3058725A52981080}Prefabs/WEGenerators/Walls/Crashbarrier/WG_CrashBarrier_E_01.et',
  rusty: '{15A66991B89461AB}Prefabs/WEGenerators/Walls/Crashbarrier/WG_CrashBarrier_E_01_rusty.et',
}

//! barrier per road. 01A and 01B are the same rail: 01A ends with rounded caps, 01B with ends sloping
//! into the ground (safer road terminals, checked in the Workbench). Our runs are isolated stretches,
//! so wide roads (>= 12 m) and USSR concrete use 01B; Everon asphalt the Everon rail; narrow or old
//! roads the rusty one.
export function barrierFor(r: Road): string {
  if (roadHalf(r) * 2 >= 12) return BARRIERS.modernB
  if (r.type === 'asphaltNarrow' || r.type === 'concretePanel') return BARRIERS.rusty
  if (r.type.startsWith('concrete')) return BARRIERS.modernB
  return BARRIERS.everon
}

//! same polyline walked the other way (the rusty barrier model faces the opposite side)
function reversePts(pts: number[]): number[] {
  const out: number[] = []
  for (let k = pts.length - 2; k >= 0; k -= 2) out.push(pts[k], pts[k + 1])
  return out
}

//! parallel line at `d` metres (positive = left of the travel direction)
export function offsetLine(line: number[], d: number): number[] {
  const n = line.length / 2, out: number[] = []
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1)
    let tx = line[b * 2] - line[a * 2], tz = line[b * 2 + 1] - line[a * 2 + 1]
    const l = Math.hypot(tx, tz) || 1
    tx /= l; tz /= l
    out.push(line[i * 2] - tz * d, line[i * 2 + 1] + tx * d)
  }
  return out
}

//! junction points: road ends and points shared by several roads
function junctions(roads: Road[]): [number, number][] {
  const seen = new Map<string, number>()
  for (const r of roads)
    for (let i = 0; i < r.pts.length; i += 2) {
      const k = `${r.pts[i]},${r.pts[i + 1]}`
      seen.set(k, (seen.get(k) ?? 0) + 1)
    }
  return [...seen].filter(([, c]) => c > 1).map(([k]) => k.split(',').map(Number) as [number, number])
}

//! runs of consecutive points where keep(i) is true, at least `minLen` metres long
//! Stretches of `line` where keep(i) holds, at least minLen metres. Holes shorter than `gap` metres
//! between two kept stretches are bridged (when bridge(i) allows it) so a barrier doesn't come in pieces
function runs(line: number[], keep: (i: number) => boolean, minLen: number, gap = 0, bridge: (i: number) => boolean = () => true): number[][] {
  const n = line.length / 2
  const on = Array.from({ length: n }, (_, i) => keep(i))
  if (gap > 0) {
    let last = -1
    for (let i = 0; i < n; i++) {
      if (!on[i]) continue
      if (last >= 0 && i - last > 1) {
        let d = 0, ok = true
        for (let k = last + 1; k <= i; k++) {
          d += Math.hypot(line[k * 2] - line[k * 2 - 2], line[k * 2 + 1] - line[k * 2 - 1])
          if (k < i && !bridge(k)) ok = false
        }
        if (ok && d <= gap) for (let k = last + 1; k < i; k++) on[k] = true
      }
      last = i
    }
  }
  const out: number[][] = []
  let cur: number[] = []
  const flush = () => {
    let len = 0
    for (let i = 2; i < cur.length; i += 2) len += Math.hypot(cur[i] - cur[i - 2], cur[i + 1] - cur[i - 1])
    if (len >= minLen) out.push(cur)
    cur = []
  }
  for (let i = 0; i < line.length / 2; i++) {
    if (on[i]) cur.push(line[i * 2], line[i * 2 + 1])
    else flush()
  }
  flush()
  return out
}

//! Furniture only where the road is dangerous (paved roads):
//! - crash barrier on a side where the ground drops more than `drop` metres next to the road;
//! - verge posts on the OUTER side of sharp bends (> 25° over 60 m) and on smaller drops (> 1.2 m).
//! Gaps near junctions. heightAt: terrain height (after carving).
export function roadFurniture(roads: Road[], heightAt: (x: number, z: number) => number, drop = 1.8, postDrop = 0.9): ProjectShape[] {
  const shapes: ProjectShape[] = []
  const junc = junctions(roads)
  const nearJunction = (x: number, z: number, r: number) => junc.some(([jx, jz]) => Math.hypot(jx - x, jz - z) < r)
  const round = (a: number[]) => a.map((v) => Math.round(v * 100) / 100)
  roads.forEach((road) => {
    // motorway median: one continuous double-sided rail between the carriageways
    if (road.median && road.median.length >= 4) shapes.push({ id: `${road.id}_MEDIAN`, kind: 'polyline', closed: false, points: round(road.median), generator: BARRIERS.modernB })
    if (!isPaved(road.type) || road.pts.length < 4) return
    const line = centreLine(road.pts, 10)
    const n = line.length / 2
    const head = (k: number) => {
      const a = Math.min(Math.max(k, 0), n - 2)
      return Math.atan2(line[a * 2 + 2] - line[a * 2], line[a * 2 + 3] - line[a * 2 + 1])
    }
    // signed turn over ±30 m (> 0 = right turn), spread a bit so posts cover the whole bend
    const turn = Array.from({ length: n }, (_, k) => {
      const t = head(k + 3) - head(k - 3)
      return Math.atan2(Math.sin(t), Math.cos(t))
    })
    const bend = turn.map((_, k) => {
      let best = 0
      for (let j = Math.max(0, k - 3); j <= Math.min(n - 1, k + 3); j++) if (Math.abs(turn[j]) > Math.abs(best)) best = turn[j]
      return best
    })
    const sharp = (25 * Math.PI) / 180
    for (const side of [1, -1]) {
      const posts = offsetLine(line, side * (roadHalf(road) + 1.2))
      const barrier = offsetLine(line, side * (roadHalf(road) + 0.8))
      // drop beside the road, measured at 6 m and 15 m from the edge (steep slope or cliff further away)
      const near = offsetLine(line, side * (roadHalf(road) + 6))
      const far = offsetLine(line, side * (roadHalf(road) + 15))
      const fall = (i: number) => {
        const h = heightAt(line[i * 2], line[i * 2 + 1])
        return Math.max(h - heightAt(near[i * 2], near[i * 2 + 1]), (h - heightAt(far[i * 2], far[i * 2 + 1])) * 0.5)
      }
      const free = (i: number) => !nearJunction(line[i * 2], line[i * 2 + 1], 20)
      // left side (+1) is the outer side of a right turn
      const outerBend = (i: number) => Math.abs(bend[i]) > sharp && Math.sign(bend[i]) === side
      const tag = side > 0 ? 'L' : 'R'
      runs(barrier, (i) => free(i) && fall(i) > drop, 30, 80, free).forEach((pts, k) =>
        shapes.push({ id: `${road.id}_BAR_${tag}${k}`, kind: 'polyline', closed: false, points: round(barrierFor(road) === BARRIERS.rusty ? reversePts(pts) : pts), generator: barrierFor(road) }))
      runs(posts, (i) => free(i) && fall(i) <= drop && (outerBend(i) || fall(i) > postDrop), 30, 25, (i) => free(i) && fall(i) <= drop).forEach((pts, k) =>
        shapes.push({ id: `${road.id}_POST_${tag}${k}`, kind: 'polyline', closed: false, points: round(pts), generator: FURNITURE.vergePost }))
    }
  })
  return shapes
}

// --- signs (right-hand traffic): bare paths, the plugin resolves the GUIDs ---
const SIGN = (n: string) => `Prefabs/Structures/Signs/Warnings/${n}_pole.et`

//! Signs: "junction" on the main road before each crossing, "give way" on the minor road at the
//! crossing, "bend" before sharp asphalt curves. Each sign stands on the right of the lane it faces.
const CHEVRON = {
  left: '{F54738CD001CB336}Prefabs/Structures/Signs/Warnings/SignDangerCurve_01_left.et',
  right: '{CD18971542C21223}Prefabs/Structures/Signs/Warnings/SignDangerCurve_01_right.et',
}

export function roadSigns(roads: Road[], driveLeft = false): ProjectEntity[] {
  const out: ProjectEntity[] = []
  const rank = (r: Road) => (isPaved(r.type) ? 3 : r.type.startsWith('trail') ? 1 : 2)
  // place a sign `back` metres before point i of `line`, for traffic moving in direction dir (+1/-1)
  const place = (id: string, prefab: string, line: number[], i: number, dir: number, back: number, side: number) => {
    const n = line.length / 2
    let k = i, d = 0
    while (d < back && k - dir >= 0 && k - dir < n) {
      d += Math.hypot(line[(k - dir) * 2] - line[k * 2], line[(k - dir) * 2 + 1] - line[k * 2 + 1])
      k -= dir
    }
    const a = Math.min(Math.max(k, 0), n - 1)
    // travel direction over ±10 m around the sign (a single segment can be zero-length at line ends)
    const p0 = Math.min(Math.max(a - 2, 0), n - 1), p1 = Math.min(Math.max(a + 2, 0), n - 1)
    let tx = (line[p1 * 2] - line[p0 * 2]) * dir, tz = (line[p1 * 2 + 1] - line[p0 * 2 + 1]) * dir
    const l = Math.hypot(tx, tz) || 1
    tx /= l; tz /= l
    // right of travel = (tz, -tx), left for left-hand traffic; sign face turned towards the driver
    const sd = driveLeft ? -side : side
    const x = line[a * 2] + tz * sd, z = line[a * 2 + 1] - tx * sd
    // at yaw 0 the plate faces -Z (checked in the Workbench: a road heading 13.5° east of north
    // needs angleY 13.5). Yaw a turns -Z to (-sin a, -cos a) = (-tx, -tz), towards the driver
    const yaw = (Math.atan2(tx, tz) * 180) / Math.PI
    out.push({ id, prefab, x: Math.round(x * 100) / 100, z: Math.round(z * 100) / 100, yaw: Math.round(yaw) })
  }
  const lines = roads.map((r) => centreLine(r.pts, 5))
  roads.forEach((road, ri) => {
    const line = lines[ri]
    const side = roadHalf(road) + 1.5
    // junctions: control points shared with another road
    for (let p = 0; p < road.pts.length; p += 2) {
      const [jx, jz] = [road.pts[p], road.pts[p + 1]]
      const other = roads.find((o, oi) => oi !== ri && o.pts.some((v, k) => k % 2 === 0 && v === jx && o.pts[k + 1] === jz))
      if (!other) continue
      let i = 0, bd = Infinity
      for (let k = 0; k < line.length / 2; k++) {
        const d = Math.hypot(line[k * 2] - jx, line[k * 2 + 1] - jz)
        if (d < bd) { bd = d; i = k }
      }
      const minor = rank(road) < rank(other) || (rank(road) === rank(other) && ri > roads.indexOf(other))
      for (const dir of [1, -1]) {
        // only directions that actually arrive at the junction (not starting from it)
        if ((dir === 1 && i === 0) || (dir === -1 && i === line.length / 2 - 1)) continue
        if (minor) place(`${road.id}_GIVEWAY_${p}_${dir}`, SIGN('SignGiveWay_01'), line, i, dir, 12, side)
        else place(`${road.id}_JUNC_${p}_${dir}`, SIGN('SignJunctionMain_01'), line, i, dir, 70, side)
      }
    }
    // sharp bends on asphalt: heading change > 45° over 60 m
    if (!isPaved(road.type)) return
    const n = line.length / 2, span = 6 // 6 x 5 m on each side = 60 m
    const head = (k: number) => Math.atan2(line[Math.min(k + 1, n - 1) * 2] - line[k * 2], line[Math.min(k + 1, n - 1) * 2 + 1] - line[k * 2 + 1])
    let last = -Infinity
    for (let k = span; k < n - span; k++) {
      let turn = head(k + span) - head(k - span)
      turn = Math.atan2(Math.sin(turn), Math.cos(turn))
      if (Math.abs(turn) < Math.PI / 4 || k - last < 30) continue
      last = k
      // turn > 0: heading angle grows = turning towards +X from +Z = right for a driver going +dir
      const forward = turn > 0 ? 'SignBendRight_01' : 'SignBendLeft_01'
      const backward = turn > 0 ? 'SignBendLeft_01' : 'SignBendRight_01'
      place(`${road.id}_BEND_${k}_f`, SIGN(forward), line, k, 1, 80, side)
      place(`${road.id}_BEND_${k}_b`, SIGN(backward), line, k, -1, 80, side)
      // chevron boards: one row of 3 on the outside of the bend (before, at, after the apex),
      // facing traffic in the line's own direction, arrows towards the turn.
      // place() mirrors the side for left-hand traffic; the outside of a bend must not move
      const keep = driveLeft ? -1 : 1
      const right = turn > 0
      const outer = (right ? -1 : 1) * (roadHalf(road) + 2) * keep
      const step = 3 // 3 x 5 m = 15 m between boards
      for (const [i, back] of [[k, step * 5], [k, 0], [Math.min(k + step, n - 1), 0]])
        place(`${road.id}_CHEV_${k}_${i}_${back}`, right ? CHEVRON.right : CHEVRON.left, line, i, 1, back, outer)
    }
  })
  return out
}
