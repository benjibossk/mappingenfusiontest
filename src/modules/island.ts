// Procedural island: height grid (bridge POST /heightmap) + surface weights and colours (POST /masks).
// Grids are row 0 = south, west to east, like the bridge expects.
import { groundWeights, terrainShape } from './groundMasks'
import { rockMasks } from './rockMask'
import { erodeIsland, mountainBase, type ReliefMasks } from './gaeaRelief'
import { splitVariants } from './paintPriority'

export interface IslandParams {
  size: number // terrain size in metres (X = Z)
  step: number // grid step in metres
  maxHeight: number
  seaDepth: number // depth of the sea floor (positive metres)
  landRatio: number // 0..1, how much of the square is land
  roughness: number // 0..1, noise weight on the coastline and relief
  seed: number
  islands: number // number of islands (1 = one centred island)
  /** 'eroded' = ridges + stream power + thermal pass (gaeaRelief.ts); default 'classic' */
  relief?: 'classic' | 'eroded' | 'mountains'
}

export interface Grid {
  minX: number
  minZ: number
  step: number
  cols: number
  rows: number
}

export interface SurfaceGrid extends Grid {
  name: string
  weights: number[]
}

export interface Island {
  grid: Grid
  heights: number[]
  surfaces: SurfaceGrid[]
  colours: Record<string, [number, number, number]>
  /** flow / wear / deposits 0..1 per vertex (eroded relief or a Gaea import), read by computeSurfaces */
  masks?: ReliefMasks
  /** imported surface masks (Gaea import), painted over the computed surfaces */
  surfaceMasks?: { name: string; weights: Float32Array }[]
}

// approximate average colours of the vanilla surfaces used here (sRGB)
const COLOURS: Record<string, [number, number, number]> = {
  SeaBed_01: [96, 92, 78],
  BeachGrass_01: [150, 140, 105],
  Grass_01: [78, 92, 52],
  MountainGrass_01: [95, 98, 70],
  Rock_01: [110, 106, 98],
  Pebbles_01: [112, 108, 96],
  Pebbles_02: [128, 122, 108],
  Grass_03_coastal: [104, 108, 70],
  Debris_Rock_01: [118, 112, 102],
  Dirt_02: [150, 125, 95],
  Grass_02: [70, 88, 50],
}
// ground under real forests and fields (land cover, cover.ts): only used when a cover grid is given
const COVER: Record<string, [number, number, number]> = {
  ForestDeciduous_01_Base: [72, 74, 46],
  ForestConiferous_01_Base: [60, 62, 44],
  Crop_Field_01: [138, 118, 80],
  Crop_Field_02: [112, 92, 66],
  Heather_01: [112, 92, 96],
  Concrete_01: [150, 150, 146],
  Dirt_01: [140, 116, 86],
}
/** cover codes of cover.ts, in order: 1 broadleaved, 2 needleleaved, 3 mixed, 4 field, 5 shrubs, 6 built-up, 7 bare, 8 ploughed */
const COVER_OF = ['', 'ForestDeciduous_01_Base', 'ForestConiferous_01_Base', 'ForestDeciduous_01_Base', 'Crop_Field_01', 'Heather_01', 'Concrete_01', 'Dirt_01', 'Crop_Field_02']
export const SURFACE_COLOURS: Record<string, [number, number, number]> = { ...COLOURS, ...COVER }

function rng(seed: number) {
  let s = seed >>> 0 || 1
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296)
}

//! value noise, a few octaves, 0..1
export function noise2(seed: number, octaves = 5) {
  // integer hash (no lattice pattern: the old xor/& 255 hash repeated along the axes)
  const base = Math.imul(seed | 0, 0x9e3779b1)
  const at = (ix: number, iz: number) => {
    let h = base ^ Math.imul(ix | 0, 0x85ebca6b) ^ Math.imul(iz | 0, 0xc2b2ae35)
    h = Math.imul(h ^ (h >>> 16), 0x7feb352d)
    h = Math.imul(h ^ (h >>> 15), 0x846ca68b)
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296
  }
  const smooth = (t: number) => t * t * t * (t * (t * 6 - 15) + 10) // quintic: no creases at cell edges
  const one = (x: number, z: number) => {
    const ix = Math.floor(x)
    const iz = Math.floor(z)
    const fx = smooth(x - ix)
    const fz = smooth(z - iz)
    const a = at(ix, iz) + (at(ix + 1, iz) - at(ix, iz)) * fx
    const b = at(ix, iz + 1) + (at(ix + 1, iz + 1) - at(ix, iz + 1)) * fx
    return a + (b - a) * fz
  }
  return (x: number, z: number) => {
    let v = 0
    let amp = 0.5
    // each octave rotated (~37°) and offset so cell edges never line up
    let px = x, pz = z
    for (let o = 0; o < octaves; o++, amp /= 2) {
      v += one(px + o * 17.3, pz - o * 9.1) * amp
      const nx = (px * 0.8 - pz * 0.6) * 2, nz = (px * 0.6 + pz * 0.8) * 2
      px = nx; pz = nz
    }
    return v / (1 - Math.pow(0.5, octaves))
  }
}

const clamp01 = (v: number) => Math.min(Math.max(v, 0), 1)
const band = (v: number, a: number, b: number) => clamp01((v - a) / (b - a))

export function generateIsland(p: IslandParams): Island {
  const cols = Math.floor(p.size / p.step) + 1
  const grid: Grid = { minX: 0, minZ: 0, step: p.step, cols, rows: cols }
  const n = noise2(p.seed)
  // island centres in -1..1, kept apart; one island stays centred
  const count = Math.max(1, Math.round(p.islands))
  const r = rng(p.seed * 7919 + 1)
  const centres: [number, number][] = []
  for (let tries = 0; centres.length < count && tries < 2000; tries++) {
    const c: [number, number] = count === 1 ? [0, 0] : [(r() * 2 - 1) * 0.7, (r() * 2 - 1) * 0.7]
    const gap = 1.6 / Math.sqrt(count)
    if (tries > 1000 || centres.every(([x, z]) => Math.hypot(x - c[0], z - c[1]) > gap)) centres.push(c)
  }
  const scale = count === 1 ? 1 : Math.sqrt(count) * 1.35 // smaller islands, sea between them
  const heights: number[] = []
  const genMax = p.relief === 'mountains' ? mountainBase(p.maxHeight) : p.maxHeight

  for (let r = 0; r < cols; r++) {
    for (let c = 0; c < cols; c++) {
      const u = (c / (cols - 1)) * 2 - 1
      const v = (r / (cols - 1)) * 2 - 1
      // 0 at an island centre, 1 at a corner for a single island
      let d = Infinity
      for (const [cx, cz] of centres) d = Math.min(d, (Math.hypot(u - cx, v - cz) * scale) / Math.SQRT2)
      const k = n(c * p.step / 600, r * p.step / 600)
      // sea margin: land fades out over the outer 12 % so no island is cut by the map edge
      // rounded-square distance to the edge + noise, so the margin does not draw straight coasts
      const ex = Math.min(c, cols - 1 - c) / (cols - 1), ez = Math.min(r, cols - 1 - r) / (cols - 1)
      const edge = 0.3 - Math.hypot(Math.max(0, 0.3 - ex), Math.max(0, 0.3 - ez)) + (k - 0.5) * 0.12
      const margin = Math.max(0, (0.2 - edge) / 0.2) * 1.2
      const land = p.landRatio + (k - 0.5) * p.roughness - d - margin // > 0 = land
      const h = land > 0
        ? Math.pow(clamp01(land / p.landRatio), 1.3) * genMax * (0.6 + 0.8 * k * p.roughness) + 1
        : Math.max(land * p.seaDepth * 6, -p.seaDepth)
      heights.push(h)
    }
  }
  const masks = p.relief === 'eroded' || p.relief === 'mountains' ? erodeIsland(heights, cols, cols, p.step, { seed: p.seed, maxHeight: p.maxHeight, roughness: p.roughness, mountains: p.relief === 'mountains' }) : undefined
  return {
    grid,
    heights,
    surfaces: computeSurfaces(grid, heights, p.maxHeight, undefined, undefined, undefined, masks),
    colours: COLOURS,
    ...(masks ? { masks } : {}),
  }
}

//! Surface weights from height and slope (+ river beds). Rerun after painting or rivers.
//! 0..1 "inside a village" weight per vertex: 1 within the lot (house + 15 m yard, FIELDS_SURFACES_VANILLA §3) plus a
//! `margin` (default 25 m), fading to 0 over `fade` m beyond. Measured from each footprint's bounding circle.
export const SETTLE_YARD_M = 15, SETTLE_MARGIN_M = 25
export function settlementMask(grid: Grid, footprints: number[][], margin = SETTLE_MARGIN_M, fade = 10): Float32Array {
  const { cols, rows, step, minX, minZ } = grid
  const m = new Float32Array(cols * rows)
  for (const c of footprints) {
    let x = 0, z = 0
    const k = c.length / 2
    for (let i = 0; i < c.length; i += 2) { x += c[i] / k; z += c[i + 1] / k }
    let rad = 0
    for (let i = 0; i < c.length; i += 2) rad = Math.max(rad, Math.hypot(c[i] - x, c[i + 1] - z))
    const r0 = rad + SETTLE_YARD_M + margin, r1 = r0 + fade
    const c0 = Math.max(0, Math.floor((x - r1 - minX) / step)), c1 = Math.min(cols - 1, Math.ceil((x + r1 - minX) / step))
    const q0 = Math.max(0, Math.floor((z - r1 - minZ) / step)), q1 = Math.min(rows - 1, Math.ceil((z + r1 - minZ) / step))
    for (let q = q0; q <= q1; q++) for (let cc = c0; cc <= c1; cc++) {
      const d = Math.hypot(minX + cc * step - x, minZ + q * step - z)
      if (d >= r1) continue
      const w = d <= r0 ? 1 : 1 - (d - r0) / fade
      const i = q * cols + cc
      if (w > m[i]) m[i] = w
    }
  }
  return m
}

/** beach / pebbles fade out from this distance to open water (m, gone at x2.5); coastal grass from COAST_GRASS_M */
export const COAST_BEACH_M = 25
export const COAST_GRASS_M = 60
/** per vertex: distance (m) to the nearest vertex lower than `below` (chamfer 3-4, both passes); Infinity when none */
export function waterDistance(heights: ArrayLike<number>, cols: number, rows: number, step: number, below: number): Float32Array {
  const N = cols * rows, d = new Float32Array(N).fill(Infinity), D = step * Math.SQRT2
  for (let i = 0; i < N; i++) if (heights[i] < below) d[i] = 0
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const i = r * cols + c
    if (c > 0) d[i] = Math.min(d[i], d[i - 1] + step)
    if (r > 0) { d[i] = Math.min(d[i], d[i - cols] + step); if (c > 0) d[i] = Math.min(d[i], d[i - cols - 1] + D); if (c + 1 < cols) d[i] = Math.min(d[i], d[i - cols + 1] + D) }
  }
  for (let r = rows - 1; r >= 0; r--) for (let c = cols - 1; c >= 0; c--) {
    const i = r * cols + c
    if (c + 1 < cols) d[i] = Math.min(d[i], d[i + 1] + step)
    if (r + 1 < rows) { d[i] = Math.min(d[i], d[i + cols] + step); if (c + 1 < cols) d[i] = Math.min(d[i], d[i + cols + 1] + D); if (c > 0) d[i] = Math.min(d[i], d[i + cols - 1] + D) }
  }
  return d
}

/** water at least this far from the land is open water (sea, wide lake), not a river */
export const OPEN_WATER_M = 40
/** per vertex: distance (m) to the bank of open water (vertices under `below` more than OPEN_WATER_M from the land) */
export function openWaterDistance(heights: ArrayLike<number>, cols: number, rows: number, step: number, below: number): Float32Array {
  const N = cols * rows, inv = new Float32Array(N)
  for (let i = 0; i < N; i++) inv[i] = heights[i] < below ? 1 : -1
  const toLand = waterDistance(inv, cols, rows, step, 0)
  const core = new Float32Array(N)
  for (let i = 0; i < N; i++) core[i] = toLand[i] > OPEN_WATER_M ? -1 : 1
  const d = waterDistance(core, cols, rows, step, 0)
  for (let i = 0; i < N; i++) d[i] = Math.max(0, d[i] - OPEN_WATER_M)
  return d
}

//! `settle` (settlementMask): no bare Rock_01 in and around the villages; that ground goes to a grass / dirt blend.
export function computeSurfaces(grid: Grid, heights: number[], maxHeight: number, river?: Float32Array, cover?: Uint8Array, settle?: Float32Array, masks?: ReliefMasks, inland?: Uint8Array): SurfaceGrid[] {
  const { cols, rows, step } = grid
  const names = Object.keys(COLOURS).concat(cover ? Object.keys(COVER) : [])
  const weights: Record<string, number[]> = Object.fromEntries(names.map((k) => [k, []]))
  // bare patches in the seabed: the algae surface everywhere looks like a carpet
  const patches = noise2(7331, 3)
  // P2 #10/#11: ridges -> rock/gravel, hollows -> moist grass, low-frequency grass variants
  const shape = terrainShape(heights, cols, rows, step)
  const variants = noise2(9157, 2)
  // rock from slope AND relief context, capped share; scree at cliff feet only (rockMask.ts)
  const rm = rockMasks(heights, cols, rows, step, maxHeight, shape)
  // beach / coastal grass only along open water: their height bands (+1..+4 m, < 12 m) alone painted every low
  // inland plain as a beach (map from a picture: rivers and lakes at the sea level, the whole valley beach-brown).
  // Arland: a narrow bank strip, grass beyond. Distance to ground under -0.5 m (sea, lakes, river beds).
  // the sea Sculpt.compose forces on the last 6 % of the map (edge ramp) is not water a coast is measured from: its
  // coastal grass made a light band along the whole edge (picture 120 east edge, round 9). A real sea reaching the
  // edge still has its shore further in
  const edgeN = Math.ceil(0.07 * Math.max(1, cols - 1))
  // `inland` water (rivers, river swelling lakes) has no coast: picture 119 round 11, its 100-200 m wide river and
  // lake counted as open water and painted their low banks as a 30-60 m beach (BeachGrass 56-67 %, Pebbles_02 7-24 %
  // of the bank 0-30 m), brown in game. Arland: grass to the edge, a narrow pebble line
  const inl = inland && inland.length === heights.length ? inland : undefined
  const hd = heights.map((h, i) => { const c = i % cols, r = (i - c) / cols; return (h < -0.5 && Math.min(c, r, cols - 1 - c, rows - 1 - r) < edgeN) || inl?.[i] ? 1 : h })
  const toInland = inl ? waterDistance(Array.from(inl, (v) => (v ? -1 : 1)), cols, rows, step, 0) : undefined
  const toWater = waterDistance(hd, cols, rows, step, -0.5)
  // pebbles / sand / beach grass only on open water (sea, wide lakes): river and pond banks of a map from a picture
  // (all at the sea level) were a pink-grey shingle band (Pebbles_02 ~10 % of the land on picture 120); Arland's
  // inland banks are grass. Open = water more than OPEN_WATER_M from the land, its own bank measured back from there.
  const toOpen = openWaterDistance(inl ? heights.map((h, i) => (inl[i] ? 1 : h)) : heights, cols, rows, step, -0.5) // (beach: open-ness needs the whole sea; the ramp is cut by fakeCoast)
  const at = (c: number, r: number) => heights[Math.min(Math.max(r, 0), rows - 1) * cols + Math.min(Math.max(c, 0), cols - 1)]
  const covered0 = (i: number, h: number) => !!(cover && cover[i] && h > 1)
  const coverShare = (c: number, r: number) => {
    const m = new Map<string, number>()
    let tot = 0
    for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) {
      const rr = r + dr, cc = c + dc
      if (rr < 0 || rr >= rows || cc < 0 || cc >= cols) continue
      const w = (3 - Math.abs(dr)) * (3 - Math.abs(dc))
      tot += w
      const j = rr * cols + cc, k = cover![j] && heights[j] > 1 ? COVER_OF[cover![j]] : ''
      if (k) m.set(k, (m.get(k) ?? 0) + w)
    }
    for (const [k, v] of m) m.set(k, v / tot)
    return m
  }
  for (let i = 0; i < heights.length; i++) {
    const c = i % cols, r = (i - c) / cols
    const h = heights[i]
    const slope = Math.hypot(at(c + 1, r) - at(c - 1, r), at(c, r + 1) - at(c, r - 1)) / (2 * step)
    // coast, after the plan in docs/ARCHITECTURE.md "Côtes": seabed < -3, shore -3..+1, beach +1..+4,
    // back-beach +4..+10, cliffs where steep near the water
    const deepAll = 1 - band(h, -4, -2)
    // a weight under ~50 % does not show through the seabed in the Workbench: sand wins at the heart of
    // each patch (75 %) and fades out over a wide border
    const bare = deepAll * 0.75 * band(patches((c * step) / 45, (r * step) / 45), 0.52, 0.75)
    const deep = deepAll - bare
    const bed = river ? Math.min(river[i], 1 - deepAll) : 0
    // the map-edge sea ramp (Sculpt.compose: the last 6 % of the map forced down to the sea floor) is no cliff: a
    // straight grey Rock_01 band ran along the whole edge slope (picture 120, x 2350-2400). Coastal grass there
    const edgeRamp = band(Math.min(c, r, cols - 1 - c, rows - 1 - r) / Math.max(1, cols - 1), 0.07, 0.1)
    const cliff = Math.min(1, rm.rock[i] + rm.scree[i]) * (h > -2 ? 1 : 0) * (1 - bed) * edgeRamp
    let scree = Math.min(cliff, rm.scree[i] * (1 - bed))
    let rock = cliff - scree
    // village banks: the rock weight becomes 75 % grass (free ground) + 25 % dirt
    const sv = settle ? settle[i] : 0
    const villageDirt = rock * sv * 0.25
    let free = clamp01(1 - deepAll - bed - cliff + rock * sv * 0.75)
    rock -= rock * sv
    const take = (w: number) => { const t = Math.min(free, Math.max(w, 0)); free -= t; return t }
    // dry low ground (a picture map lies at 0-1.5 m over whole plains) is shingle only on the water's edge
    // the map-edge ramp above the sea is no coast either: beach / coastal grass made a light band along the whole
    // edge slope (picture 120, x 2350-2400, round 9). A real shore there is gentle; the ramp is steep: plain grass
    const fakeCoast = h > 0 ? (1 - edgeRamp) * band(slope, 0.08, 0.15) : 0
    const shore0 = take(band(h, -4, -2) * (1 - band(h, 0.5, 1.5)) * (h > -0.5 ? 1 - band(toWater[i], 4, 10) : 1) * (1 - fakeCoast))
    // that strip is mostly sand, a few pebbles (beach sand above the water, sandy bed under it): all shingle, the
    // shallow shelf (-2.5..-0.5 m, 90-100 % Pebbles_02) showed as a line of dark rocks along the whole gentle south
    // coast of picture 120 (round 11)
    const sandShare = 1 - 0.3 * (0.6 + 0.8 * variants((c * step) / 40, (r * step) / 40))
    const dryShore = h > -0.5 ? shore0 * sandShare : 0, wetSand = h > -0.5 ? 0 : shore0 * sandShare
    const shore = shore0 - dryShore - wetSand
    const nearBank = (1 - band(toOpen[i], COAST_BEACH_M, COAST_BEACH_M * 2.5)) * (1 - fakeCoast), nearCoast = (1 - band(toWater[i], COAST_GRASS_M, COAST_GRASS_M * 2.5)) * (1 - fakeCoast)
    const beach = take((1 - band(h, 3.5, 5)) * nearBank)
    // [M] shore band 0-10 m above the sea: Pebbles_02 20-30 % + BeachGrass 10-14 % (FIELDS_SURFACES_VANILLA §3)
    const lowShore = h > 0 ? (1 - band(h, 9, 11)) * nearBank : 0
    const pebbles = take(0.25 * lowShore * (0.6 + 0.8 * variants((c * step) / 40, (r * step) / 40)))
    const sand = take(0.12 * lowShore)
    const pebbleLine = toInland && h > -0.5 ? take(0.5 * (1 - band(toInland[i], 2, 6))) : 0
    const coastal = take((1 - band(h, 9, 12)) * nearCoast)
    // [M] MountainGrass 15 % at 200-300 m, ~42 % above 300 m on Everon (top ~370 m): relative 0.55 / 0.8 of the range
    const high = 0.15 * band(h, maxHeight * 0.5, maxHeight * 0.6) + 0.27 * band(h, maxHeight * 0.75, maxHeight * 0.85)
    const inland = band(h, 10, 16)
    const gw = groundWeights(slope, shape.tpi[i], shape.curv[i], variants((c * step) / 300, (r * step) / 300))
    // gw.rock is left to rockMasks (crests are part of its relief context); gravel only on gentle ridges
    // relief masks (gaeaRelief.ts / Gaea import): deposit cones -> scree, drained lines -> moist grass
    const mk = masks && masks.flow.length === heights.length ? masks : null
    // worn ground stays grass (wear covers every flank of an eroded relief); deposits give scree only where they
    // settle: the gentle, concave ground of the deposit cones and ravine mouths, not the slope above
    const cone = mk ? band(mk.deposits[i], 0.2, 0.7) * (1 - band(slope, 0.25, 0.45)) * band(-shape.tpi[i], -0.5, 1) : 0
    const gravel = Math.min(1, gw.gravel * (1 - band(slope, 0.3, 0.5)) + 0.5 * cone)
    scree += free * inland * gravel
    const moist = covered0(i, h) ? 0 : free * inland * (mk ? Math.min(1 - gravel, gw.moist + 0.5 * band(mk.flow[i], 0.55, 0.85)) : gw.moist)
    free -= free * inland * gravel + moist
    const rest = Math.max(free, 0)
    weights.SeaBed_01.push(deep)
    weights.Pebbles_01.push(bed)
    weights.Pebbles_02.push(shore + pebbles + pebbleLine)
    weights.Dirt_02.push(bare + villageDirt + wetSand) // sandy look
    weights.BeachGrass_01.push(beach + sand + dryShore)
    weights.Grass_03_coastal.push(coastal)
    weights.Rock_01.push(rock)
    weights.Debris_Rock_01.push(scree)
    // real land cover takes the free ground (grass), never the coast, rock or river bed
    weights.Grass_02.push(moist)
    const mountain = Math.min(1, high + (1 - high) * 0.15 * gw.variant * inland)
    // + heather ~20 % with the mountain grass ([M] Everon / Kolguyev uplands), only when the cover set carries Heather_01
    // soft cover edges: share of each cover kind over a 5x5 tent kernel (~16 m ramp at 8 m), not a hard
    // cell-by-cell switch (forest floor / field edges looked cut with a knife; vanilla fades 10-20 m)
    const share = cover && h > 1 ? coverShare(c, r) : null
    let used = 0
    if (share) for (const v of share.values()) used += v
    const open = rest * (1 - used)
    const heath = cover ? open * 0.2 * band(h, maxHeight * 0.5, maxHeight * 0.75) : 0
    if (cover) for (const k of Object.keys(COVER)) weights[k].push(rest * (share?.get(k) ?? 0) + (k === 'Heather_01' ? heath : 0))
    weights.MountainGrass_01.push((open - heath) * mountain)
    // open land is not one grass: Arland mixes Grass_03 30 % + Grass_02 8 % + scree-grass + heather in 50-300 m patches
    // (FIELDS_SURFACES_VANILLA §1/§4). Picture 120: the biome grass alone was 75 % of the land, one beige sheet.
    // Meadow (Grass_02) patches from low-frequency noise, soft edges, up to 55 % at their heart
    const lush = cover ? 0.55 * band(variants((c * step) / 110 + 37, (r * step) / 110 + 11), 0.42, 0.72) : 0
    weights.Grass_02[weights.Grass_02.length - 1] += (open - heath) * (1 - mountain) * lush
    weights.Grass_01.push((open - heath) * (1 - mountain) * (1 - lush))
  }
  for (const k of names) weights[k] = weights[k].map((w) => (w < 1 / 255 ? 0 : w))
  const out = names.map((name) => ({ ...grid, name, weights: weights[name] }))
  // P2 #11 / MAPS4FS item 10: bare ground broken up into two dirt tones by low-frequency noise
  if (cover) splitVariants(out, 'Dirt_01', ['Dirt_01', 'Dirt_02'], { seed: 5113, scale: 160 })
  limitPerBlock(out)
  return out
}

//! Blocks (blockSize metres) using more than `max` surfaces: the terrain refuses them. The mask is
//! upscaled bilinearly, so a vertex also paints the blocks it touches: a block counts the surfaces of
//! its own cells and of the vertex ring just outside it (same footprint as limitPerBlock).
export function overfullBlocks(surfaces: SurfaceGrid[], blockSize = 64, max = 5): number {
  if (!surfaces.length) return 0
  const { cols, rows, step } = surfaces[0]
  const per = Math.max(1, Math.round(blockSize / step))
  const nb = Math.ceil((cols - 1) / per), nbr = Math.ceil((rows - 1) / per)
  let bad = 0
  for (let by = 0; by < nbr; by++) {
    for (let bx = 0; bx < nb; bx++) {
      const r0 = Math.max(0, by * per - 1), r1 = Math.min(rows - 1, (by + 1) * per)
      const c0 = Math.max(0, bx * per - 1), c1 = Math.min(cols - 1, (bx + 1) * per)
      let used = 0
      for (const s of surfaces) {
        let hit = false
        for (let r = r0; r <= r1 && !hit; r++)
          for (let c = c0; c <= c1; c++)
            if (s.weights[r * cols + c] > 0) { hit = true; break }
        if (hit) used++
      }
      if (used > max) bad++
    }
  }
  return bad
}

//! Keeps at most `max` surfaces per block (blockSize metres). Each block keeps its strongest surfaces
//! (by total weight); a cell only keeps the surfaces allowed by every block its vertex paints (its own
//! and, at the borders, the neighbours: the mask PNG is upscaled bilinearly), and the weight removed
//! goes to the strongest allowed surface of that cell, so the blend stays per cell (no hard seam).
//! Where neighbouring blocks share no surface at all, a common "glue" surface (the one that weighs
//! the most in those cells) takes one of the slots of every block involved, grown until no such
//! cell is left: the result is guaranteed, deterministic and needs no retry pass.
export function limitPerBlock(surfaces: SurfaceGrid[], blockSize = 64, max = 4) {
  const n = surfaces.length
  if (!n || max < 1) return
  const { cols, rows, step } = surfaces[0]
  const per = Math.max(1, Math.round(blockSize / step))
  const nb = Math.ceil((cols - 1) / per)
  const nbr = Math.ceil((rows - 1) / per)
  const blockOf = (i: number, nBlocks: number) => Math.max(0, Math.min(Math.floor(i / per), nBlocks - 1))
  // blocks painted by vertex i along one axis: its own and the neighbours of i - 1 / i + 1
  const span = (i: number, nBlocks: number): [number, number] => [blockOf(i - 1, nBlocks), blockOf(i + 1, nBlocks)]
  const ranked: number[][] = []
  for (let by = 0; by < nbr; by++) {
    for (let bx = 0; bx < nb; bx++) {
      const r0 = by * per, c0 = bx * per
      const r1 = by === nbr - 1 ? rows - 1 : r0 + per - 1, c1 = bx === nb - 1 ? cols - 1 : c0 + per - 1
      const totals = surfaces.map((s) => {
        let t = 0
        for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) t += s.weights[r * cols + c]
        return t
      })
      ranked.push(totals.map((t, k) => [t, k]).filter(([t]) => t > 0).sort((a, b) => b[0] - a[0] || a[1] - b[1]).map(([, k]) => k))
    }
  }
  const keep = ranked.map((list) => new Set(list.slice(0, max)))
  const glued = new Uint8Array(nb * nbr)
  let glue = -1
  const allowedAt = (r: number, c: number) => {
    const [ra, rb] = span(r, nbr), [ca, cb] = span(c, nb)
    const ok: number[] = []
    for (let k = 0; k < n; k++) {
      let all = true
      for (let by = ra; by <= rb && all; by++) for (let bx = ca; bx <= cb; bx++) if (!keep[by * nb + bx].has(k)) { all = false; break }
      if (all) ok.push(k)
    }
    return ok
  }
  for (let round = 0; round <= nb * nbr; round++) {
    // cells with weight whose blocks share no kept surface
    const conflicts: number[] = []
    for (let r = 0; r < rows; r++) {
      const [ra, rb] = span(r, nbr)
      for (let c = 0; c < cols; c++) {
        const [ca, cb] = span(c, nb)
        if (ra === rb && ca === cb) continue
        if (!allowedAt(r, c).length) conflicts.push(r * cols + c)
      }
    }
    if (!conflicts.length) break
    if (glue < 0) {
      const w = new Array(n).fill(0)
      for (const i of conflicts) for (let k = 0; k < n; k++) w[k] += surfaces[k].weights[i]
      // not the sea bed: glued into a coastal land block it filled whole seam cells of grass with SeaBed_01,
      // near-black hard bands across the coast slopes (seed 21, x 3392). A land glue under water is hidden.
      const sea = surfaces.findIndex((s) => s.name === 'SeaBed_01')
      if (sea >= 0 && w.some((v, k) => k !== sea && v > 0)) w[sea] = -1
      glue = w.indexOf(Math.max(...w))
    }
    for (const i of conflicts) {
      const c = i % cols, r = (i - c) / cols
      const [ra, rb] = span(r, nbr), [ca, cb] = span(c, nb)
      for (let by = ra; by <= rb; by++) for (let bx = ca; bx <= cb; bx++) {
        const b = by * nb + bx
        if (glued[b]) continue
        glued[b] = 1
        keep[b] = new Set([glue, ...ranked[b].filter((k) => k !== glue).slice(0, max - 1)])
      }
    }
  }
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c
      const ok = allowedAt(r, c)
      let freed = 0, best = -1
      for (let k = 0; k < n; k++) {
        const v = surfaces[k].weights[i]
        if (!v) continue
        if (ok.includes(k)) { if (best < 0 || v > surfaces[best].weights[i]) best = k }
        else { freed += v; surfaces[k].weights[i] = 0 }
      }
      if (!freed) continue
      // none of the cell's own surfaces is allowed: take the allowed surface that dominates its
      // neighbourhood (was ok[0] = the first grid, SeaBed_01: black seabed seams across the land
      // along block lines, seen on seed 21 at x 3392)
      if (best < 0 && ok.length) {
        let bw = -1
        // never the sea bed on ground that had none (it renders near black on land)
        const dry = ok.filter((k) => surfaces[k].name !== 'SeaBed_01')
        for (const k of dry.length ? dry : ok) {
          let t = 0
          for (let dr = -3; dr <= 3; dr++) for (let dc = -3; dc <= 3; dc++) {
            const rr = r + dr, cc = c + dc
            if (rr >= 0 && rr < rows && cc >= 0 && cc < cols) t += surfaces[k].weights[rr * cols + cc] / (1 + Math.abs(dr) + Math.abs(dc))
          }
          if (t > bw) { bw = t; best = k }
        }
      }
      if (best < 0) best = glue >= 0 ? glue : 0
      surfaces[best].weights[i] += freed
    }
  }
}
