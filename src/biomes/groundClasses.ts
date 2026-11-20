// Climate-driven ground classes (docs/BENCHMARK_GIORBEV.md, section "MapGeneratorPro v8.4").
// Idea taken from giorbev's MapGeneratorPro V8.4.0 (MIT, (c) 2026 [otea] Giorbev, see NOTICE):
// six climate biomes lay out ground classes from altitude, slope, sun exposure, hollows/ridges, flow,
// wetness and coast distance. Reimplemented from the release notes, no code copied.
//
// Opt-in, standalone: nothing in the existing surface pipeline (surfaces.ts) calls this module. Pure, no
// DOM, typed arrays, so it can run in a worker. Grid convention as in climate.ts / ingameMap.ts:
// heights[row * cols + col], row increasing = +Z = north.

export type ClimateBiome = 'tempere' | 'montagnard' | 'mediterraneen' | 'boreal' | 'desertique' | 'glaciaire'
export const CLIMATE_BIOME_IDS: readonly ClimateBiome[] = ['tempere', 'montagnard', 'mediterraneen', 'boreal', 'desertique', 'glaciaire']

export interface Derivatives {
  cols: number; rows: number; step: number
  land: Uint8Array        // 1 = above sea level
  alt: Float32Array       // m above sea level
  slope: Float32Array     // degrees
  sun: Float32Array       // 0 (north face, shaded) .. 1 (south face); 0.5 = flat
  tpi: Float32Array       // m, height minus local mean: < 0 hollow, > 0 ridge
  flow: Float32Array      // 0..1, log-normalised D8 accumulation
  wet: Float32Array       // 0..1, normalised topographic wetness index ln(a / tan b)
  coast: Float32Array     // m to the nearest sea cell (Infinity when there is no sea)
}

export interface BiomeSettings {
  snowLine: number   // m, snow above (alpine, glacial, boreal)
  treeLine: number   // m, no forest above
  sandWidth: number  // m from the coast for beach / dunes
  forest: number     // 0..1 share of eligible land that gets forest
  wetland: number    // 0..1 share of land that gets marsh / bog (by wetness rank)
  rockSlope: number  // degrees, bare rock / scree above
  /** degrees, bare rock (not scree) above; default rockSlope + 8 */
  bareRock?: number
  /** 0..1 share of the forest that is coniferous (temperate); default by sun exposure */
  conifer?: number
}

export interface GroundClass { id: string; fr: string; en: string; keywords: string[] }

const C = (id: string, fr: string, en: string, ...keywords: string[]): GroundClass => ({ id, fr, en, keywords })
const SEA = C('mer', 'mer', 'sea', 'seabed', 'sea', 'underwater')
const BEACH = C('plage', 'plage', 'beach', 'beach', 'sand')
const ROCK = C('roche', 'roche', 'rock', 'cliff', 'rock')
const SCREE = C('eboulis', 'éboulis + moraine', 'scree + moraine', 'debris', 'scree', 'gravel', 'rock')
const SNOW = C('neige', 'neige', 'snow', 'snow', 'ice')
const MARSH = C('marais', 'marais', 'marsh', 'marsh', 'swamp', 'mud', 'wet')
const MEADOW = C('prairie', 'prairie', 'meadow', 'grass', 'meadow', 'field')
const BROADLEAF = C('feuillus', 'feuillus', 'broadleaf', 'forest', 'leaves', 'deciduous', 'grass')
const CONIFER = C('coniferes', 'conifères', 'conifers', 'needles', 'conifer', 'pine', 'forest')

/** Classes per biome, in mask import order (first = bottom layer). */
export const BIOME_CLASSES: Record<ClimateBiome, GroundClass[]> = {
  tempere: [SEA, BEACH, MEADOW, BROADLEAF, CONIFER, MARSH, ROCK, SCREE],
  montagnard: [SEA, MEADOW, C('alpage', 'alpage', 'alpine meadow', 'alpine', 'grass', 'meadow'), BROADLEAF, CONIFER, SCREE, ROCK, SNOW],
  mediterraneen: [SEA, BEACH, C('herbe_seche', 'herbe sèche', 'dry grass', 'dry', 'grass'), C('garrigue', 'garrigue', 'garrigue', 'garrigue', 'dry', 'soil'),
    C('maquis', 'maquis', 'maquis', 'maquis', 'shrub', 'forest'), C('pins', 'pins', 'pines', 'pine', 'needles', 'forest'), ROCK],
  boreal: [SEA, BEACH, C('lande', 'lande', 'heath', 'heath', 'moss', 'grass'), CONIFER, C('tourbiere', 'tourbière', 'peat bog', 'peat', 'bog', 'moss', 'mud'),
    C('toundra', 'toundra', 'tundra', 'tundra', 'moss'), ROCK, SNOW],
  desertique: [SEA, C('sable', 'sable', 'sand', 'sand', 'dune', 'desert'), C('reg', 'reg', 'gravel plain', 'gravel', 'desert', 'soil'),
    C('sebkha', 'sebkha', 'salt flat', 'salt', 'flat', 'dry'), C('oasis', 'oasis', 'oasis', 'oasis', 'grass'), ROCK],
  glaciaire: [SEA, C('toundra', 'toundra', 'tundra', 'tundra', 'moss'), SCREE, ROCK, SNOW, C('glace', 'glace', 'ice', 'ice', 'glacier', 'snow')],
}

export const DEFAULT_SETTINGS: Record<ClimateBiome, BiomeSettings> = {
  // temperate calibrated on Everon (PakTools/analyses/FIELDS_SURFACES_VANILLA.md, share of land): forest floor 13 %,
  // of which coniferous 72 %; rock + scree 21 % (bare Rock_01 1.4 %); shore 2 %; no marsh material. Slopes: autoCalibrate.
  tempere: { snowLine: 1e9, treeLine: 1e9, sandWidth: 25, forest: 0.13, wetland: 0.01, rockSlope: 30, conifer: 0.72 },
  montagnard: { snowLine: 2400, treeLine: 1900, sandWidth: 0, forest: 0.45, wetland: 0.02, rockSlope: 35 },
  mediterraneen: { snowLine: 1e9, treeLine: 1e9, sandWidth: 30, forest: 0.3, wetland: 0, rockSlope: 32 },
  boreal: { snowLine: 1500, treeLine: 800, sandWidth: 15, forest: 0.55, wetland: 0.12, rockSlope: 35 },
  desertique: { snowLine: 1e9, treeLine: 1e9, sandWidth: 0, forest: 0, wetland: 0.01, rockSlope: 25 },
  glaciaire: { snowLine: 300, treeLine: 0, sandWidth: 0, forest: 0, wetland: 0, rockSlope: 30 },
}

// ---------------------------------------------------------------- derivatives
export function computeDerivatives(heights: ArrayLike<number>, cols: number, rows: number, step: number, seaLevel = 0, tpiRadius = 150): Derivatives {
  const n = cols * rows
  const land = new Uint8Array(n), alt = new Float32Array(n), slope = new Float32Array(n), sun = new Float32Array(n)
  const tpi = new Float32Array(n), flow = new Float32Array(n), wet = new Float32Array(n), coast = new Float32Array(n)
  const H = (c: number, r: number) => heights[Math.min(rows - 1, Math.max(0, r)) * cols + Math.min(cols - 1, Math.max(0, c))]
  const tanB = new Float32Array(n)
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const i = r * cols + c, h = heights[i]
    land[i] = h > seaLevel ? 1 : 0; alt[i] = h - seaLevel
    const gx = (H(c + 1, r) - H(c - 1, r)) / (2 * step), gz = (H(c, r + 1) - H(c, r - 1)) / (2 * step)
    const g = Math.hypot(gx, gz); tanB[i] = g
    slope[i] = Math.atan(g) * 180 / Math.PI
    // south-facing (terrain rises toward +Z north) => surface normal points south => sunny
    sun[i] = Math.min(1, Math.max(0, 0.5 + 0.5 * gz / Math.sqrt(1 + g * g) * 2))
  }
  // TPI: box mean via integral image
  const R = Math.max(1, Math.round(tpiRadius / step)), I = new Float64Array((cols + 1) * (rows + 1))
  for (let r = 0; r < rows; r++) { let s = 0; for (let c = 0; c < cols; c++) { s += heights[r * cols + c]; I[(r + 1) * (cols + 1) + c + 1] = I[r * (cols + 1) + c + 1] + s } }
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const r0 = Math.max(0, r - R), r1 = Math.min(rows, r + R + 1), c0 = Math.max(0, c - R), c1 = Math.min(cols, c + R + 1)
    const s = I[r1 * (cols + 1) + c1] - I[r0 * (cols + 1) + c1] - I[r1 * (cols + 1) + c0] + I[r0 * (cols + 1) + c0]
    tpi[r * cols + c] = heights[r * cols + c] - s / ((r1 - r0) * (c1 - c0))
  }
  // D8 flow accumulation: process cells from highest to lowest
  const order = new Uint32Array(n); for (let i = 0; i < n; i++) order[i] = i
  order.sort((a, b) => heights[b] - heights[a])
  const acc = new Float32Array(n).fill(1)
  for (let k = 0; k < n; k++) {
    const i = order[k], r = (i / cols) | 0, c = i - r * cols
    let best = -1, drop = 0
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      if (!dr && !dc) continue
      const rr = r + dr, cc = c + dc; if (rr < 0 || cc < 0 || rr >= rows || cc >= cols) continue
      const j = rr * cols + cc, d = (heights[i] - heights[j]) / (dr && dc ? Math.SQRT2 : 1)
      if (d > drop) { drop = d; best = j }
    }
    if (best >= 0) acc[best] += acc[i]
  }
  const lmax = Math.log(n + 1)
  let wmin = Infinity, wmax = -Infinity
  for (let i = 0; i < n; i++) {
    flow[i] = Math.log(acc[i] + 1) / lmax
    wet[i] = Math.log(acc[i] * step / Math.max(tanB[i], 0.001))
    if (wet[i] < wmin) wmin = wet[i]; if (wet[i] > wmax) wmax = wet[i]
  }
  const wr = wmax - wmin || 1
  for (let i = 0; i < n; i++) wet[i] = (wet[i] - wmin) / wr
  // coast distance: two-pass chamfer from sea cells
  for (let i = 0; i < n; i++) coast[i] = land[i] ? Infinity : 0
  const d1 = step, d2 = step * Math.SQRT2
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const i = r * cols + c; let v = coast[i]
    if (c > 0) v = Math.min(v, coast[i - 1] + d1)
    if (r > 0) { v = Math.min(v, coast[i - cols] + d1); if (c > 0) v = Math.min(v, coast[i - cols - 1] + d2); if (c < cols - 1) v = Math.min(v, coast[i - cols + 1] + d2) }
    coast[i] = v
  }
  for (let r = rows - 1; r >= 0; r--) for (let c = cols - 1; c >= 0; c--) {
    const i = r * cols + c; let v = coast[i]
    if (c < cols - 1) v = Math.min(v, coast[i + 1] + d1)
    if (r < rows - 1) { v = Math.min(v, coast[i + cols] + d1); if (c < cols - 1) v = Math.min(v, coast[i + cols + 1] + d2); if (c > 0) v = Math.min(v, coast[i + cols - 1] + d2) }
    coast[i] = v
  }
  return { cols, rows, step, land, alt, slope, sun, tpi, flow, wet, coast }
}

function landQuantile(d: Derivatives, arr: Float32Array, q: number): number {
  const v: number[] = []
  for (let i = 0; i < arr.length; i++) if (d.land[i]) v.push(arr[i])
  if (!v.length) return 0
  v.sort((a, b) => a - b)
  return v[Math.min(v.length - 1, Math.max(0, Math.floor(q * (v.length - 1))))]
}

/** Auto-calibrate the settings from the heightmap (altitude / slope distribution of the land). */
export function autoCalibrate(biome: ClimateBiome, d: Derivatives): BiomeSettings {
  const s = { ...DEFAULT_SETTINGS[biome] }
  const top = landQuantile(d, d.alt, 0.98), steep = landQuantile(d, d.slope, 0.95)
  s.rockSlope = Math.round(Math.max(20, Math.min(s.rockSlope, steep)))
  if (biome === 'tempere') { // Everon shares (see DEFAULT_SETTINGS)
    s.rockSlope = Math.round(Math.max(8, landQuantile(d, d.slope, 1 - TEMPERATE_SCREE)) * 10) / 10
    s.bareRock = Math.round(Math.max(s.rockSlope + 1, landQuantile(d, d.slope, 1 - TEMPERATE_BARE)) * 10) / 10
  }
  if (biome === 'montagnard') { s.snowLine = Math.round(landQuantile(d, d.alt, 0.92)); s.treeLine = Math.round(landQuantile(d, d.alt, 0.75)) }
  else if (biome === 'boreal') { s.snowLine = Math.round(Math.max(top + 1, landQuantile(d, d.alt, 0.97))); s.treeLine = Math.round(landQuantile(d, d.alt, 0.8)) }
  else if (biome === 'glaciaire') { s.snowLine = Math.round(landQuantile(d, d.alt, 0.35)) }
  return s
}

const TEMPERATE_SCREE = 0.21, TEMPERATE_BARE = 0.014

/** Exclusion value in the class grid: cell kept as is (zone B of the exclusion mask). */
export const EXCLUDED = 255

/**
 * Classify every cell into an index of BIOME_CLASSES[biome] (0 = sea), or EXCLUDED where exclude[i] != 0.
 */
export function classifyGround(biome: ClimateBiome, d: Derivatives, s: BiomeSettings = DEFAULT_SETTINGS[biome], exclude?: ArrayLike<number>): Uint8Array {
  const cls = BIOME_CLASSES[biome], idx = (id: string) => cls.findIndex(c => c.id === id)
  const n = d.cols * d.rows, out = new Uint8Array(n)
  const wetT = s.wetland > 0 ? landQuantile(d, d.wet, 1 - s.wetland) : Infinity
  // forest score: shaded, sheltered (hollow-ish), not too steep; threshold so `forest` of the land qualifies
  const fscore = new Float32Array(n)
  // rock / scree / beach cells cannot be forest: excluded from the ranking so `forest` is a share of the whole land
  for (let i = 0; i < n; i++) fscore[i] = d.slope[i] >= s.rockSlope || (d.coast[i] <= s.sandWidth && d.alt[i] < 4) ? -Infinity
    : (1 - d.sun[i]) * 0.6 + Math.max(-1, Math.min(1, -d.tpi[i] / 20)) * 0.25 + d.flow[i] * 0.15
  const forestT = s.forest > 0 ? landQuantile(d, fscore, 1 - s.forest) : Infinity
  const conT = s.conifer != null && s.forest > 0 ? landQuantile(d, fscore, 1 - s.forest * s.conifer) : NaN
  const bare = s.bareRock ?? s.rockSlope + 8
  const I = Object.fromEntries(cls.map((c, k) => [c.id, k])) as Record<string, number>
  for (let i = 0; i < n; i++) {
    if (exclude && exclude[i]) { out[i] = EXCLUDED; continue }
    if (!d.land[i]) { out[i] = 0; continue }
    const a = d.alt[i], sl = d.slope[i], sun = d.sun[i], tpi = d.tpi[i], w = d.wet[i]
    const isWet = w >= wetT && sl < 4, isForest = fscore[i] >= forestT && a < s.treeLine && sl < s.rockSlope
    const nearCoast = d.coast[i] <= s.sandWidth && a < 4
    let k = -1
    switch (biome) {
      case 'tempere':
        k = sl >= bare ? I.roche : sl >= s.rockSlope ? I.eboulis : nearCoast ? I.plage : isWet ? I.marais
          : isForest ? ((Number.isNaN(conT) ? sun < 0.4 || tpi > 10 : fscore[i] >= conT) ? I.coniferes : I.feuillus) : I.prairie
        break
      case 'montagnard':
        k = a >= s.snowLine && sl < s.rockSlope + 10 ? I.neige : sl >= s.rockSlope + 8 ? I.roche : sl >= s.rockSlope || (a >= s.treeLine && tpi > 15) ? I.eboulis
          : a >= s.treeLine ? I.alpage : isForest ? (a >= s.treeLine * 0.75 || sun < 0.45 ? I.coniferes : I.feuillus) : I.prairie
        break
      case 'mediterraneen':
        k = sl >= s.rockSlope ? I.roche : nearCoast ? I.plage : isForest ? (sun < 0.5 ? I.pins : I.maquis)
          : sun > 0.55 && tpi > 0 ? I.garrigue : sl > 12 ? I.maquis : I.herbe_seche
        break
      case 'boreal':
        k = a >= s.snowLine ? I.neige : sl >= s.rockSlope ? I.roche : nearCoast ? I.plage : isWet ? I.tourbiere : a >= s.treeLine ? I.toundra
          : isForest ? I.coniferes : I.lande
        break
      case 'desertique':
        k = sl >= s.rockSlope ? I.roche : isWet && d.flow[i] > 0.5 ? I.oasis : sl < 1.5 && tpi < -2 ? I.sebkha : tpi > 3 || sl > 8 ? I.reg : I.sable
        break
      case 'glaciaire':
        k = sl >= s.rockSlope + 10 ? I.roche : a >= s.snowLine ? (tpi < 0 && sl < 15 ? I.glace : I.neige) : sl >= s.rockSlope || tpi > 10 ? I.eboulis : I.toundra
        break
    }
    out[i] = k >= 0 ? k : idx(cls[cls.length - 1].id)
  }
  return out
}

// ---------------------------------------------------------------- textures, merge, budget, export
export interface TextureAssignment { classIndex: number; texture: string | null /* null = missing in project */ }

/** Automatic proposal: first project texture whose name contains one of the class keywords; overrides win. */
export function proposeTextures(biome: ClimateBiome, projectTextures: readonly string[], overrides: Record<string, string | null> = {}): TextureAssignment[] {
  return BIOME_CLASSES[biome].map((c, k) => {
    if (c.id in overrides) return { classIndex: k, texture: overrides[c.id] }
    for (const kw of c.keywords) {
      const t = projectTextures.find(p => p.toLowerCase().includes(kw))
      if (t) return { classIndex: k, texture: t }
    }
    return { classIndex: k, texture: null }
  })
}

export interface MaskLayer { order: number; classIndices: number[]; texture: string | null; share: number; file: string }

/** Remap class grid -> layer grid (classes sharing a texture merged), each layer one mask. */
export function mergeByTexture(biome: ClimateBiome, classes: Uint8Array, assign: TextureAssignment[]): { layers: MaskLayer[]; layerGrid: Uint8Array } {
  const cls = BIOME_CLASSES[biome], layers: MaskLayer[] = [], toLayer = new Int16Array(cls.length).fill(-1)
  for (const a of assign) {
    let L = a.texture ? layers.findIndex(l => l.texture === a.texture) : -1
    if (L < 0) { L = layers.length; layers.push({ order: L + 1, classIndices: [], texture: a.texture, share: 0, file: '' }) }
    layers[L].classIndices.push(a.classIndex); toLayer[a.classIndex] = L
  }
  const grid = new Uint8Array(classes.length), count = new Float64Array(layers.length)
  let tot = 0
  for (let i = 0; i < classes.length; i++) {
    const v = classes[i]; if (v === EXCLUDED) { grid[i] = EXCLUDED; continue }
    const L = toLayer[v]; grid[i] = L; count[L]++; tot++
  }
  for (const l of layers) {
    l.share = tot ? count[l.order - 1] / tot : 0
    const name = l.classIndices.map(k => cls[k].id).join('+')
    const tex = l.texture ? (l.texture.split(/[\\/]/).pop() ?? l.texture).replace(/\.\w+$/, '') : 'manquant'
    l.file = `${String(l.order).padStart(2, '0')}_${name}__${tex}.png`
  }
  return { layers, layerGrid: grid }
}

/**
 * Per-block budget: in every block of `blockCells`^2 cells, keep at most `budget` layers (the most present);
 * the others are reassigned to the most present kept layer of that block. Returns the number of cells changed.
 */
export function enforceBlockBudget(grid: Uint8Array, cols: number, rows: number, blockCells: number, budget: number): number {
  let changed = 0
  const counts = new Map<number, number>()
  for (let br = 0; br < rows; br += blockCells) for (let bc = 0; bc < cols; bc += blockCells) {
    counts.clear()
    const r1 = Math.min(rows, br + blockCells), c1 = Math.min(cols, bc + blockCells)
    for (let r = br; r < r1; r++) for (let c = bc; c < c1; c++) { const v = grid[r * cols + c]; if (v !== EXCLUDED) counts.set(v, (counts.get(v) ?? 0) + 1) }
    if (counts.size <= budget) continue
    const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]), keep = new Set(ranked.slice(0, budget).map(e => e[0])), fill = ranked[0][0]
    for (let r = br; r < r1; r++) for (let c = bc; c < c1; c++) { const i = r * cols + c, v = grid[i]; if (v !== EXCLUDED && !keep.has(v)) { grid[i] = fill; changed++ } }
  }
  return changed
}

/** Recompute layer shares after the budget pass. */
export function layerShares(grid: Uint8Array, layers: MaskLayer[]): void {
  const count = new Float64Array(layers.length); let tot = 0
  for (let i = 0; i < grid.length; i++) if (grid[i] !== EXCLUDED) { count[grid[i]]++; tot++ }
  layers.forEach((l, k) => { l.share = tot ? count[k] / tot : 0 })
}

/** One binary mask (0/255) per layer, in import order. */
export function layerMask(grid: Uint8Array, layer: number): Uint8Array {
  const m = new Uint8Array(grid.length)
  for (let i = 0; i < grid.length; i++) if (grid[i] === layer) m[i] = 255
  return m
}

/** Text of 00_LISEZMOI_import.txt (FR + EN). */
export function importReadme(biome: ClimateBiome, layers: MaskLayer[]): string {
  const cls = BIOME_CLASSES[biome], pct = (x: number) => (x * 100).toFixed(1) + ' %'
  const line = (l: MaskLayer, en: boolean) => `${l.file}  ${l.classIndices.map(k => en ? cls[k].en : cls[k].fr).join(' + ')}  ${l.texture ?? (en ? 'MISSING' : 'MANQUANT')}  ${pct(l.share)}`
  const missing = layers.filter(l => !l.texture)
  const fr = [`Biome : ${biome}`, 'Ordre d\'import (du premier au dernier) :', ...layers.map(l => line(l, false)), '',
    missing.length ? 'Classes manquantes : ajoutez une texture au projet, importez le masque correspondant, puis assignez-la dans le Terrain Tool.' : 'Aucune classe manquante.']
  const en = [`Biome: ${biome}`, 'Import order (first to last):', ...layers.map(l => line(l, true)), '',
    missing.length ? 'Missing classes: add a texture to the project, import the matching mask, then assign it in the Terrain Tool.' : 'No missing class.']
  return ['=== FR ===', ...fr, '', '=== EN ===', ...en, ''].join('\n')
}
