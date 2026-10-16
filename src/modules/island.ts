// Procedural island: height grid (bridge POST /heightmap) + surface weights and colours (POST /masks).
// Grids are row 0 = south, west to east, like the bridge expects.

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
  const at = (c: number, r: number) => heights[Math.min(Math.max(r, 0), rows - 1) * cols + Math.min(Math.max(c, 0), cols - 1)]
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
    const steep = band(slope, 0.2, 0.4)
    const nearWater = 1 - band(h, 10, 20)
    const cliff = steep * (h > -2 ? 1 : 0) * (1 - bed)
    const scree = cliff * nearWater * (1 - band(slope, 0.3, 0.5)) // foot of coastal cliffs
    const rock = cliff - scree
    let free = clamp01(1 - deepAll - bed - cliff)
    const take = (w: number) => { const t = Math.min(free, Math.max(w, 0)); free -= t; return t }
    const shore = take(band(h, -4, -2) * (1 - band(h, 0.5, 1.5)))
    const beach = take(1 - band(h, 3.5, 5))
    const coastal = take(1 - band(h, 9, 12))
    const high = band(h, maxHeight * 0.45, maxHeight * 0.7)
    const rest = free
    weights.SeaBed_01.push(deep)
    weights.Pebbles_01.push(bed)
    weights.Pebbles_02.push(shore)
    weights.Dirt_02.push(bare) // sandy look
    weights.BeachGrass_01.push(beach)
    weights.Grass_03_coastal.push(coastal)
    weights.Rock_01.push(rock)
    weights.Debris_Rock_01.push(scree)
    // real land cover takes the free ground (grass), never the coast, rock or river bed
    const covered = cover && cover[i] && h > 1 ? COVER_OF[cover[i]] : ''
    if (cover) for (const k of Object.keys(COVER)) weights[k].push(k === covered ? rest : 0)
    weights.MountainGrass_01.push(covered ? 0 : rest * high)
    weights.Grass_01.push(covered ? 0 : rest * (1 - high))
  }
  for (const k of names) weights[k] = weights[k].map((w) => (w < 1 / 255 ? 0 : w))
  const out = names.map((name) => ({ ...grid, name, weights: weights[name] }))
  limitPerBlock(out)
  return out
}

//! Blocks (blockSize metres) using more than `max` surfaces (weight > 5 %): the terrain refuses them.
export function overfullBlocks(surfaces: SurfaceGrid[], blockSize = 64, max = 5): number {
  if (!surfaces.length) return 0
  const { cols, rows, step } = surfaces[0]
  const per = Math.max(1, Math.round(blockSize / step))
  let bad = 0
  for (let br = 0; br < rows; br += per) {
    for (let bc = 0; bc < cols; bc += per) {
      let used = 0
      for (const s of surfaces) {
        let hit = false
        for (let r = br; r < Math.min(rows, br + per) && !hit; r++)
          for (let c = bc; c < Math.min(cols, bc + per); c++)
            if (s.weights[r * cols + c] > 0) { hit = true; break }
        if (hit) used++
      }
      if (used > max) bad++
    }
  }
  return bad
}

//! Keeps at most `max` surfaces per block (the strongest by total weight); the weight of the others
//! goes to the strongest kept surface of each cell. Note: the mask PNG is sampled bilinearly, so a
//! surface may still bleed a few metres into the next block.
export function limitPerBlock(surfaces: SurfaceGrid[], blockSize = 64, max = 5) {
  if (!surfaces.length) return
  const { cols, rows, step } = surfaces[0]
  const per = Math.max(1, Math.round(blockSize / step))
  const nb = Math.ceil((cols - 1) / per)
  const nbr = Math.ceil((rows - 1) / per)
  const keep: Set<number>[] = []
  for (let by = 0; by < nbr; by++) {
    for (let bx = 0; bx < nb; bx++) {
      const r0 = by * per, c0 = bx * per
      const r1 = by === nbr - 1 ? rows - 1 : r0 + per - 1, c1 = bx === nb - 1 ? cols - 1 : c0 + per - 1
      const totals = surfaces.map((s) => {
        let t = 0
        for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) t += s.weights[r * cols + c]
        return t
      })
      keep.push(new Set(totals.map((t, k) => [t, k]).filter(([t]) => t > 0).sort((a, b) => b[0] - a[0]).slice(0, max).map(([, k]) => k)))
    }
  }
  // disjoint blocks: the surface map is per texel, blocks do not share texels
  const blocksOf = (i: number, n: number) => [Math.min(Math.floor(i / per), n - 1)]
  for (let r = 0; r < rows; r++) {
    const brs = blocksOf(r, nbr)
    for (let c = 0; c < cols; c++) {
      const bcs = blocksOf(c, nb)
      const i = r * cols + c
      const allowed = (k: number) => brs.every((by) => bcs.every((bx) => keep[by * nb + bx].has(k)))
      let freed = 0, best = -1
      surfaces.forEach((s, k) => {
        if (!s.weights[i]) return
        if (allowed(k)) { if (best < 0 || s.weights[i] > surfaces[best].weights[i]) best = k }
        else { freed += s.weights[i]; s.weights[i] = 0 }
      })
      if (!freed) continue
      if (best < 0) {
        // nothing allowed everywhere here: take the strongest surface kept by all the blocks, else the first block's top
        const common = [...keep[brs[0] * nb + bcs[0]]].filter(allowed)
        best = common[0] ?? [...keep[brs[0] * nb + bcs[0]]][0]
      }
      surfaces[best].weights[i] += freed
    }
  }
}
