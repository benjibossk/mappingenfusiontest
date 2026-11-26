// P2 #11: paint priority of the ground surfaces + noise-based surface variants (docs/MAPS4FS_STUDY.md 4.1, item 10).
// Pure, deterministic. Masks that overlap no longer depend on the order they were given in: the mask with the
// higher priority takes its weight first, the next one only gets what is left, and the computed surfaces
// (the base, priority 0) share the remainder. Variants split one surface over N materials with low-frequency
// noise (smooth bands, no per-pixel dissolve), which reads better and stays cheap.
import { noise2, type SurfaceGrid } from './island'

/** Priority of a vanilla surface when masks overlap (higher wins). Unknown names get DEFAULT_PRIORITY. */
export const SURFACE_PRIORITY: Record<string, number> = {
  Concrete_01: 90, // built-up, pads, airfields
  Asphalt_01: 88,
  Dirt_03: 80, // yards, paths
  Dirt_01: 75,
  Dirt_02: 74,
  Pebbles_01: 72, // river beds
  Rock_01: 70,
  Debris_Rock_01: 68,
  Crop_Field_01: 60,
  Crop_Field_02: 60,
  ForestDeciduous_01_Base: 50,
  ForestConiferous_01_Base: 50,
  Heather_01: 40,
  Pebbles_02: 35,
  BeachGrass_01: 30,
  SeaBed_01: 30,
  Grass_02: 20,
  Grass_03_coastal: 15,
  MountainGrass_01: 12,
  Grass_01: 10,
}
export const DEFAULT_PRIORITY = 50

export function surfacePriority(name: string, table: Record<string, number> = SURFACE_PRIORITY): number {
  return table[name] ?? DEFAULT_PRIORITY
}

export interface PriorityMask { name: string; weights: ArrayLike<number>; priority?: number }

/** Paint `masks` over `surfaces` (in place) by priority: the highest mask keeps its full weight, a lower one
 *  only the weight still free, and the existing surfaces are scaled into what remains. Ties keep input order
 *  (stable sort). Returns the surfaces (new ones are appended with the grid of the first). */
export function paintByPriority(surfaces: SurfaceGrid[], masks: PriorityMask[], onNew?: (name: string) => void): SurfaceGrid[] {
  if (!surfaces.length || !masks.length) return surfaces
  const n = surfaces[0].weights.length
  const ordered = masks
    .map((m, k) => ({ m, k, p: m.priority ?? surfacePriority(m.name) }))
    .filter((e) => e.m.weights.length === n)
    .sort((a, b) => b.p - a.p || a.k - b.k)
  if (!ordered.length) return surfaces
  // weight taken by the masks at each vertex, per surface name
  const taken = new Map<string, Float32Array>()
  const used = new Float32Array(n)
  for (const { m } of ordered) {
    let t = taken.get(m.name)
    if (!t) { t = new Float32Array(n); taken.set(m.name, t) }
    for (let i = 0; i < n; i++) {
      const w = Math.min(Math.max(m.weights[i], 0), 1)
      if (w <= 0) continue
      const got = Math.min(w, 1 - used[i])
      t[i] += got
      used[i] += got
    }
  }
  for (const name of taken.keys()) if (!surfaces.some((s) => s.name === name)) {
    const { weights: _w, name: _n, ...grid } = surfaces[0]
    surfaces.push({ ...grid, name, weights: new Array(n).fill(0) })
    onNew?.(name)
  }
  for (let i = 0; i < n; i++) {
    if (used[i] <= 0) continue
    const keep = 1 - used[i]
    for (const s of surfaces) s.weights[i] = s.weights[i] * keep + (taken.get(s.name)?.[i] ?? 0)
  }
  return surfaces
}

export interface VariantOptions { seed?: number; scale?: number; blend?: number }

/** Split surface `name` over `variants` (the first is usually the surface itself) with low-frequency noise.
 *  `scale` = noise cell in metres (default 220), `blend` = width of the soft band between two variants in
 *  noise units (default 0.15). The total weight per vertex is unchanged. In place; returns the surfaces. */
export function splitVariants(surfaces: SurfaceGrid[], name: string, variants: string[], o: VariantOptions = {}): SurfaceGrid[] {
  const src = surfaces.find((s) => s.name === name)
  if (!src || variants.length < 2) return surfaces
  const n = src.weights.length
  const targets = variants.map((v) => {
    let s = surfaces.find((x) => x.name === v)
    if (!s) { const { weights: _w, name: _n, ...grid } = src; s = { ...grid, name: v, weights: new Array(n).fill(0) }; surfaces.push(s) }
    return s
  })
  const noise = noise2(o.seed ?? 4421, 3)
  const scale = o.scale ?? 220, blend = o.blend ?? 0.15, k = variants.length
  const share = new Float32Array(k)
  const orig = src.weights.slice()
  for (let i = 0; i < n; i++) {
    const w = orig[i]
    if (w <= 0) continue
    const c = i % src.cols, r = (i - c) / src.cols
    // spread the noise (it bunches around 0.5) over 0..1 so each variant gets a fair share
    const v = Math.min(Math.max((noise((src.minX + c * src.step) / scale, (src.minZ + r * src.step) / scale) - 0.5) * 2.2 + 0.5, 0), 1) * k
    let tot = 0
    for (let j = 0; j < k; j++) {
      // tent around the band centre j + 0.5, flat inside, soft over `blend` at each edge
      const d = Math.abs(v - (j + 0.5)) - 0.5
      const sw = j === 0 && v < 0.5 ? 1 : j === k - 1 && v > k - 0.5 ? 1 : Math.min(Math.max(0.5 - d / (2 * blend * k), 0), 1)
      share[j] = sw; tot += sw
    }
    if (tot <= 0) { share.fill(0); share[Math.min(k - 1, Math.floor(v))] = 1; tot = 1 }
    src.weights[i] = 0
    for (let j = 0; j < k; j++) targets[j].weights[i] += (w * share[j]) / tot
  }
  return surfaces
}
