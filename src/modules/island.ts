// Procedural island: height grid (bridge POST /heightmap) + surface weights and colours (POST /masks).
// Grids are row 0 = south, west to east, like the bridge expects.
import { groundWeights, terrainShape } from './groundMasks'
import { rockMasks } from './rockMask'

export interface IslandParams {
  size: number // terrain size in metres (X = Z)
  step: number // grid step in metres
  maxHeight: number
  seaDepth: number // depth of the sea floor (positive metres)
  landRatio: number // 0..1, how much of the square is land
  roughness: number // 0..1, noise weight on the coastline and relief
  seed: number
  islands: number // number of islands (1 = one centred island)
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
  Heather_01: [112, 92, 96],
  Concrete_01: [150, 150, 146],
  Dirt_01: [140, 116, 86],
}
/** cover codes of cover.ts, in order: 1 broadleaved, 2 needleleaved, 3 mixed, 4 field, 5 shrubs, 6 built-up, 7 bare */
const COVER_OF = ['', 'ForestDeciduous_01_Base', 'ForestConiferous_01_Base', 'ForestDeciduous_01_Base', 'Crop_Field_01', 'Heather_01', 'Concrete_01', 'Dirt_01']
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
        ? Math.pow(clamp01(land / p.landRatio), 1.3) * p.maxHeight * (0.6 + 0.8 * k * p.roughness) + 1
        : Math.max(land * p.seaDepth * 6, -p.seaDepth)
      heights.push(h)
    }
  }
  return {
    grid,
    heights,
    surfaces: computeSurfaces(grid, heights, p.maxHeight),
    colours: COLOURS,
  }
}

//! Surface weights from height and slope (+ river beds). Rerun after painting or rivers.
export function computeSurfaces(grid: Grid, heights: number[], maxHeight: number, river?: Float32Array, cover?: Uint8Array): SurfaceGrid[] {
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
  const at = (c: number, r: number) => heights[Math.min(Math.max(r, 0), rows - 1) * cols + Math.min(Math.max(c, 0), cols - 1)]
  const covered0 = (i: number, h: number) => !!(cover && cover[i] && h > 1)
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
    const cliff = Math.min(1, rm.rock[i] + rm.scree[i]) * (h > -2 ? 1 : 0) * (1 - bed)
    let scree = Math.min(cliff, rm.scree[i] * (1 - bed))
    let rock = cliff - scree
    let free = clamp01(1 - deepAll - bed - cliff)
    const take = (w: number) => { const t = Math.min(free, Math.max(w, 0)); free -= t; return t }
    const shore = take(band(h, -4, -2) * (1 - band(h, 0.5, 1.5)))
    const beach = take(1 - band(h, 3.5, 5))
    // [M] shore band 0-10 m above the sea: Pebbles_02 20-30 % + BeachGrass 10-14 % (FIELDS_SURFACES_VANILLA §3)
    const lowShore = h > 0 ? 1 - band(h, 9, 11) : 0
    const pebbles = take(0.25 * lowShore * (0.6 + 0.8 * variants((c * step) / 40, (r * step) / 40)))
    const sand = take(0.12 * lowShore)
    const coastal = take(1 - band(h, 9, 12))
    // [M] MountainGrass 15 % at 200-300 m, ~42 % above 300 m on Everon (top ~370 m): relative 0.55 / 0.8 of the range
    const high = 0.15 * band(h, maxHeight * 0.5, maxHeight * 0.6) + 0.27 * band(h, maxHeight * 0.75, maxHeight * 0.85)
    const inland = band(h, 10, 16)
    const gw = groundWeights(slope, shape.tpi[i], shape.curv[i], variants((c * step) / 300, (r * step) / 300))
    // gw.rock is left to rockMasks (crests are part of its relief context); gravel only on gentle ridges
    const gravel = gw.gravel * (1 - band(slope, 0.3, 0.5))
    scree += free * inland * gravel
    const moist = covered0(i, h) ? 0 : free * inland * gw.moist
    free -= free * inland * gravel + moist
    const rest = Math.max(free, 0)
    weights.SeaBed_01.push(deep)
    weights.Pebbles_01.push(bed)
    weights.Pebbles_02.push(shore + pebbles)
    weights.Dirt_02.push(bare) // sandy look
    weights.BeachGrass_01.push(beach + sand)
    weights.Grass_03_coastal.push(coastal)
    weights.Rock_01.push(rock)
    weights.Debris_Rock_01.push(scree)
    // real land cover takes the free ground (grass), never the coast, rock or river bed
    const covered = cover && cover[i] && h > 1 ? COVER_OF[cover[i]] : ''
    weights.Grass_02.push(moist)
    const mountain = Math.min(1, high + (1 - high) * 0.15 * gw.variant * inland)
    // + heather ~20 % with the mountain grass ([M] Everon / Kolguyev uplands), only when the cover set carries Heather_01
    const heather = cover && !covered ? rest * 0.2 * band(h, maxHeight * 0.5, maxHeight * 0.75) : 0
    if (cover) for (const k of Object.keys(COVER)) weights[k].push(k === covered ? rest : k === 'Heather_01' ? heather : 0)
    weights.MountainGrass_01.push(covered ? 0 : (rest - heather) * mountain)
    weights.Grass_01.push(covered ? 0 : (rest - heather) * (1 - mountain))
  }
  for (const k of names) weights[k] = weights[k].map((w) => (w < 1 / 255 ? 0 : w))
  const out = names.map((name) => ({ ...grid, name, weights: weights[name] }))
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
      if (best < 0) best = ok.length ? ok[0] : (glue >= 0 ? glue : 0)
      surfaces[best].weights[i] += freed
    }
  }
}
