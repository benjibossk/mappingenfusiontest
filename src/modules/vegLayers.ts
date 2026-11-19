// Vegetation rules after the Workshop mod "Terrain Automation Tools" (gaz8157), as GENERATOR rules (no editor tool):
//  a. elevation bands (shore / lowland / midland / highland / alpine) relative to the map's height range, each with
//     its own vegetation set and density;
//  b. multi-layer biomes: canopy, understory, ground cover and rocks, each with its own density
//     ([M] FORESTS_VANILLA.md: core 265-313 trees/ha, bush belt ~95/ha on the outline vs 23-45 in the core);
//  c. forest feathering: thinner and smaller vegetation within 16-24 m of the forest edge (density profile measured
//     on Everon: 194/ha on the outline, 264 at +8 m, 292 at +16 m, core ~290);
//  d. Poisson-disk scatter (Bridson) with a slope filter, spaced for a Clark-Evans index ~1.7 like the vanilla forests
//     (1.64-1.84: a generator output, not hand placement).
// Pure module, seeded.

import { VEG } from '../data/biomes'
import type { ProjectEntity } from '../project'

export type ElevationBand = 'shore' | 'lowland' | 'midland' | 'highland' | 'alpine'
export const ELEVATION_BANDS: ElevationBand[] = ['shore', 'lowland', 'midland', 'highland', 'alpine']

/** band thresholds as a share of the land height range (0 = sea level, 1 = top); shore = absolute 0-10 m ([M] FIELDS
 *  shore band). Everon (top ~370 m): MountainGrass from 200 m (0.55) and dominant above 300 m (0.8) */
export const BAND_LIMITS = { shoreM: 10, lowland: 0.25, midland: 0.55, highland: 0.8 }

export function elevationBand(h: number, maxHeight: number): ElevationBand {
  if (h <= BAND_LIMITS.shoreM) return 'shore'
  const a = maxHeight > 0 ? h / maxHeight : 0
  if (a < BAND_LIMITS.lowland) return 'lowland'
  if (a < BAND_LIMITS.midland) return 'midland'
  if (a < BAND_LIMITS.highland) return 'highland'
  return 'alpine'
}

export interface LayerSpec {
  /** entities per hectare at full density */
  perHa: number
  /** min / max slope (rise/run) where the layer grows */
  slope: [number, number]
  prefabs: string[]
}

const BUSH = {
  hazel: VEG.hazel, hazel2: VEG.hazel2, rose: '{AED5759B653DF6D0}Prefabs/Vegetation/Bush/b_rosa_canina_1s.et',
  raspberry: '{0CA0547EB03759E1}Prefabs/Vegetation/Bush/b_rubus_idaeus_1s.et', elder: '{D6EC31A48403A52A}Prefabs/Vegetation/Bush/b_sambucus_nigra_1.et',
  sallow: '{BA785041AC632123}Prefabs/Vegetation/Bush/b_salix_cinerea_1.et', juniper: '{81EE8FAE7539DAA1}Prefabs/Vegetation/Bush/b_juniperus_communis_0.et',
  dwarfBirch: '{905290F53779597F}Prefabs/Vegetation/Bush/Betula_Nana/b_betula_nana_1.et', reed: '{938E2F2C01769971}Prefabs/Vegetation/Bush/b_phragmites_australis_1b.et',
  grass: '{F10E2D0423AC5D19}Prefabs/Vegetation/Bush/Calamagrostis_epigejos/B_Calamagrostis_epigejos_1.et',
} as const
const ROCK = {
  stone1: '{F5837A3933EFF7CF}Prefabs/Rocks/Granite/GraniteStone_01_V2.et', stone2: '{FF262A7485FF0448}Prefabs/Rocks/Granite/GraniteStone_02_V2.et',
  stone3: '{38EABAE970A94744}Prefabs/Rocks/Granite/GraniteStone_03_V2.et', surf5: '{A0BB927F0EBB5828}Prefabs/Rocks/Granite/GraniteSurfaceStone_05.et',
  rock1: '{DF692A1784D6B324}Prefabs/Rocks/Granite/GraniteRock_01_V2.et', rock2: '{D5CC7A5A32C640A3}Prefabs/Rocks/Granite/GraniteRock_02_V2.et',
  boulder1: '{ADC53C3320B368DA}Prefabs/Rocks/Granite/Granite_Boulder_01_V2.et', boulder2: '{A7606C7E96A39B5D}Prefabs/Rocks/Granite/Granite_Boulder_02_V2.et',
} as const

export type Layer = 'canopy' | 'understory' | 'groundCover' | 'rocks'
/** per band: the vegetation set and density of each layer (open-ground scatter; canopy = trees in forest cores) */
export const BAND_LAYERS: Record<ElevationBand, Record<Layer, LayerSpec>> = {
  shore: {
    canopy: { perHa: 0, slope: [0, 0.3], prefabs: [] },
    understory: { perHa: 1.5, slope: [0, 0.25], prefabs: [BUSH.sallow, BUSH.rose] },
    groundCover: { perHa: 4, slope: [0, 0.2], prefabs: [BUSH.reed, BUSH.grass] },
    rocks: { perHa: 1, slope: [0.05, 0.7], prefabs: [ROCK.stone1, ROCK.stone2, ROCK.surf5] },
  },
  lowland: {
    canopy: { perHa: 265, slope: [0, 0.45], prefabs: [VEG.hornbeam, VEG.lime, VEG.birch] },
    understory: { perHa: 1, slope: [0, 0.35], prefabs: [BUSH.hazel, BUSH.elder, BUSH.rose] },
    groundCover: { perHa: 2, slope: [0, 0.3], prefabs: [BUSH.raspberry, BUSH.grass] },
    rocks: { perHa: 0.6, slope: [0.27, 0.7], prefabs: [ROCK.stone1, ROCK.stone2, ROCK.stone3] },
  },
  midland: {
    canopy: { perHa: 290, slope: [0, 0.55], prefabs: [VEG.spruce, VEG.pine, VEG.birch] },
    understory: { perHa: 0.8, slope: [0, 0.4], prefabs: [BUSH.hazel, BUSH.hazel2, BUSH.juniper] },
    groundCover: { perHa: 1.5, slope: [0, 0.35], prefabs: [BUSH.raspberry, BUSH.grass] },
    rocks: { perHa: 1.2, slope: [0.27, 0.8], prefabs: [ROCK.stone2, ROCK.stone3, ROCK.rock1] },
  },
  highland: {
    canopy: { perHa: 313, slope: [0, 0.6], prefabs: [VEG.spruce, VEG.spruceSw, VEG.larch] },
    understory: { perHa: 0.6, slope: [0, 0.5], prefabs: [BUSH.juniper, BUSH.dwarfBirch] },
    groundCover: { perHa: 1, slope: [0, 0.45], prefabs: [BUSH.grass] },
    rocks: { perHa: 2, slope: [0.27, 1], prefabs: [ROCK.rock1, ROCK.rock2, ROCK.boulder1] },
  },
  alpine: {
    canopy: { perHa: 120, slope: [0, 0.5], prefabs: [VEG.spruceSw, VEG.larch] },
    understory: { perHa: 0.8, slope: [0, 0.6], prefabs: [BUSH.dwarfBirch, BUSH.juniper] },
    groundCover: { perHa: 0.5, slope: [0, 0.5], prefabs: [BUSH.grass] },
    rocks: { perHa: 3, slope: [0.27, 1.2], prefabs: [ROCK.rock2, ROCK.boulder1, ROCK.boulder2] },
  },
}

/** forest layer densities per hectare by distance to the outline (m, + inside, - outside), [M] FORESTS_VANILLA Everon */
export const FOREST_PROFILE = {
  trees: [[-24, 28], [-8, 88], [0, 194], [8, 264], [16, 292], [24, 318]] as [number, number][],
  bushes: [[-24, 53], [0, 95], [8, 66], [16, 40], [24, 23]] as [number, number][],
  coreTrees: [265, 313], coreBushes: [23, 45], edgeWidth: [16, 24],
}

const interp = (tab: [number, number][], d: number) => {
  if (d <= tab[0][0]) return tab[0][1]
  for (let i = 1; i < tab.length; i++) if (d <= tab[i][0]) {
    const [a, va] = tab[i - 1], [b, vb] = tab[i]
    return va + ((vb - va) * (d - a)) / (b - a)
  }
  return tab[tab.length - 1][1]
}

/** feathering at `d` metres inside the forest edge (width 16-24 m): density factor (vs the core) and tree scale.
 *  Density follows the measured profile; scale falls to 0.7 on the outline (TAT "Global Outline Scale Curve",
 *  vanilla outline levels use 1 -> 0.78 over a few metres). */
export function featherAt(d: number, width = 24): { density: number; scale: number } {
  const core = FOREST_PROFILE.trees[FOREST_PROFILE.trees.length - 2][1]
  const k = 24 / Math.max(1, width) // the profile is measured on 24 m: squeeze it for a 16 m edge
  const density = Math.min(1, interp(FOREST_PROFILE.trees, d * k) / core)
  const t = Math.max(0, Math.min(1, d / width))
  return { density, scale: 0.7 + 0.3 * t * t * (3 - 2 * t) }
}

/** bush belt density (/ha) at `d` metres from the forest outline (+ inside): peaks on the outline */
export const bushBeltAt = (d: number) => interp(FOREST_PROFILE.bushes, d)

export type Rand = () => number
export function mulberry(seed: number): Rand {
  let s = seed >>> 0
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}

/** Poisson-disk radius that gives `perHa` points per hectare with a Clark-Evans index ~`ce` (1.7 = vanilla forests).
 *  CE = mean NN distance x 2 sqrt(lambda); a Bridson sample's mean NN is ~1.15 r */
export function poissonRadius(perHa: number, ce = 1.7): number {
  const lambda = perHa / 10000
  return ce / (2 * Math.sqrt(lambda)) / 1.15
}

//! Bridson Poisson-disk sampling in a box, kept where `accept(x, z)` (slope filter, polygon, water...)
export function poissonDisk(box: { minX: number; minZ: number; maxX: number; maxZ: number }, r: number, rand: Rand,
  accept: (x: number, z: number) => boolean = () => true, maxPts = 200000): number[] {
  const cell = r / Math.SQRT2, W = box.maxX - box.minX, H = box.maxZ - box.minZ
  const gw = Math.max(1, Math.ceil(W / cell)), gh = Math.max(1, Math.ceil(H / cell))
  if (gw * gh > 4e7) return []
  const grid = new Int32Array(gw * gh).fill(-1)
  const pts: number[] = [], active: number[] = [], out: number[] = []
  const add = (x: number, z: number) => {
    const i = pts.length / 2
    pts.push(x, z); active.push(i)
    grid[Math.floor((z - box.minZ) / cell) * gw + Math.floor((x - box.minX) / cell)] = i
    if (accept(x, z)) out.push(x, z)
  }
  const far = (x: number, z: number) => {
    const gx = Math.floor((x - box.minX) / cell), gz = Math.floor((z - box.minZ) / cell)
    for (let j = Math.max(0, gz - 2); j <= Math.min(gh - 1, gz + 2); j++) for (let i = Math.max(0, gx - 2); i <= Math.min(gw - 1, gx + 2); i++) {
      const k = grid[j * gw + i]
      if (k >= 0 && Math.hypot(pts[k * 2] - x, pts[k * 2 + 1] - z) < r) return false
    }
    return true
  }
  add(box.minX + rand() * W, box.minZ + rand() * H)
  while (active.length && out.length / 2 < maxPts) {
    const ai = Math.floor(rand() * active.length), k = active[ai]
    const px = pts[k * 2], pz = pts[k * 2 + 1]
    let found = false
    for (let t = 0; t < 30; t++) {
      const a = rand() * Math.PI * 2, d = r * (1 + rand())
      const x = px + Math.cos(a) * d, z = pz + Math.sin(a) * d
      if (x < box.minX || z < box.minZ || x >= box.maxX || z >= box.maxZ || !far(x, z)) continue
      add(x, z); found = true; break
    }
    if (!found) { active[ai] = active[active.length - 1]; active.pop() }
  }
  return out
}

/** Clark-Evans aggregation index of a point set in an area (m²): 1 random, > 1 regular, < 1 clustered */
export function clarkEvans(pts: number[], area: number): number {
  const n = pts.length / 2
  if (n < 2 || area <= 0) return 0
  // grid hash for the nearest neighbour
  const cell = Math.sqrt(area / n) * 2, map = new Map<string, number[]>()
  for (let i = 0; i < n; i++) { const key = `${Math.floor(pts[i * 2] / cell)},${Math.floor(pts[i * 2 + 1] / cell)}`; (map.get(key) ?? map.set(key, []).get(key)!).push(i) }
  let sum = 0
  for (let i = 0; i < n; i++) {
    const x = pts[i * 2], z = pts[i * 2 + 1], gx = Math.floor(x / cell), gz = Math.floor(z / cell)
    let best = Infinity
    for (let ring = 1; ring <= 3 && !isFinite(best); ring++)
      for (let j = gz - ring; j <= gz + ring; j++) for (let k = gx - ring; k <= gx + ring; k++)
        for (const o of map.get(`${k},${j}`) ?? []) if (o !== i) best = Math.min(best, Math.hypot(pts[o * 2] - x, pts[o * 2 + 1] - z))
    sum += isFinite(best) ? best : 0
  }
  return (sum / n) * 2 * Math.sqrt(n / area)
}

export interface ScatterOptions {
  box: { minX: number; minZ: number; maxX: number; maxZ: number }
  heightAt: (x: number, z: number) => number
  slopeAt: (x: number, z: number) => number
  maxHeight: number
  /** free open ground (not water, road, house, field, forest) */
  ok: (x: number, z: number) => boolean
  seed: number
  layers?: Layer[] // default understory + rocks
  /** density multiplier (slider) */
  density?: number
  prefix?: string
  /** hard cap of entities (Workbench budget) */
  max?: number
}

//! open-ground scatter: per layer, a Poisson-disk set at the densest band rate, then thinned to each point's band
//! density and filtered on the band's slope range; prefab from the band's set. Rocks rise with the slope.
export function scatterLayers(o: ScatterOptions): ProjectEntity[] {
  const out: ProjectEntity[] = []
  const layers = o.layers ?? ['understory', 'rocks']
  const mul = o.density ?? 1
  layers.forEach((layer, li) => {
    const top = Math.max(...ELEVATION_BANDS.map((b) => BAND_LAYERS[b][layer].perHa)) * mul
    if (top <= 0) return
    const rand = mulberry(o.seed * 31 + li * 7919 + 1)
    const pts = poissonDisk(o.box, poissonRadius(top), rand, o.ok)
    for (let i = 0; i < pts.length && out.length < (o.max ?? 20000); i += 2) {
      const x = pts[i], z = pts[i + 1], h = o.heightAt(x, z), s = o.slopeAt(x, z)
      if (h <= 0.5) continue
      const spec = BAND_LAYERS[elevationBand(h, o.maxHeight)][layer]
      if (!spec.prefabs.length || s < spec.slope[0] || s > spec.slope[1]) continue
      // rocks: more on steeper ground (scree band 15-35 deg), the rest at the band rate
      const w = layer === 'rocks' ? Math.min(1, 0.3 + (s - spec.slope[0]) / 0.4) : 1
      if (rand() > (spec.perHa * mul * w) / top) continue
      out.push({ id: `${o.prefix ?? 'SCAT_'}${layer.toUpperCase()}_${out.length + 1}`, prefab: spec.prefabs[Math.floor(rand() * spec.prefabs.length)], x: Math.round(x * 100) / 100, z: Math.round(z * 100) / 100, yaw: Math.round(rand() * 360), role: 'clutter' })
    }
  })
  return out
}

//! bush belt + feathered edge trees around small woods that get no native edge bands (forestEdge minArea):
//! bushes follow the measured outline peak (95/ha), trees thin out over the edge width; Poisson-spaced.
export function featheredBelt(o: { pts: number[]; width?: number; seed: number; ok: (x: number, z: number) => boolean; inside: (x: number, z: number) => boolean;
  distToOutline: (x: number, z: number) => number; trees: string[]; bushes: string[]; prefix: string; max?: number }): ProjectEntity[] {
  const w = o.width ?? 24
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity
  for (let i = 0; i < o.pts.length; i += 2) { minX = Math.min(minX, o.pts[i]); maxX = Math.max(maxX, o.pts[i]); minZ = Math.min(minZ, o.pts[i + 1]); maxZ = Math.max(maxZ, o.pts[i + 1]) }
  const box = { minX: minX - 24, minZ: minZ - 24, maxX: maxX + 24, maxZ: maxZ + 24 }
  const rand = mulberry(o.seed)
  const out: ProjectEntity[] = []
  const peak = FOREST_PROFILE.bushes[1][1]
  const pts = poissonDisk(box, poissonRadius(peak), rand, o.ok)
  for (let i = 0; i < pts.length && out.length < (o.max ?? 4000); i += 2) {
    const x = pts[i], z = pts[i + 1], d = o.distToOutline(x, z) * (o.inside(x, z) ? 1 : -1)
    if (d < -24 || d > w) continue
    if (rand() > bushBeltAt(d) / peak) continue
    out.push({ id: `${o.prefix}B${out.length + 1}`, prefab: o.bushes[Math.floor(rand() * o.bushes.length)], x: Math.round(x * 100) / 100, z: Math.round(z * 100) / 100, yaw: Math.round(rand() * 360), role: 'clutter' })
  }
  // outer trees of the edge: thinned by featherAt; the smallest (outline) ones become bushes (no entity scale in the contract)
  if (o.trees.length) {
    const tp = poissonDisk(box, poissonRadius(FOREST_PROFILE.coreTrees[0] * 0.5), rand, o.ok)
    for (let i = 0; i < tp.length && out.length < (o.max ?? 4000); i += 2) {
      const x = tp[i], z = tp[i + 1]
      if (!o.inside(x, z)) continue
      const d = o.distToOutline(x, z)
      if (d > w) continue
      const f = featherAt(d, w)
      if (rand() > f.density * 0.5) continue
      const small = f.scale < 0.8
      out.push({ id: `${o.prefix}T${out.length + 1}`, prefab: small ? o.bushes[Math.floor(rand() * o.bushes.length)] : o.trees[Math.floor(rand() * o.trees.length)], x: Math.round(x * 100) / 100, z: Math.round(z * 100) / 100, yaw: Math.round(rand() * 360) })
    }
  }
  return out
}
