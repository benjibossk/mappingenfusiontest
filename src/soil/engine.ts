// Soil engine (docs/PLAN_GIORBEV.md Phase 3): ContractInput -> ContractOutput, pure, no DOM.
// Steps: terrain signals -> biome (computeClimate) -> material masks (rules/materials.json) ->
// per-block texture budget (limitPerBlock) -> water shapes (<= 60 points, on the ground) ->
// potential-vegetation zones (contours + simplification, tagged with a native generator).
// Every threshold lives in src/soil/rules/*.json so it can be edited without touching code.
import { CONTRACT_VERSION, budgetReport } from '../contract/schema.ts'
import type { ContractInput, ContractOutput, MaterialMask, Points, VegetationZone } from '../contract/schema.ts'
import { computeClimate, flowMoisture, CLIMATE_BIOMES, SEA } from '../biomes/climate.ts'
import { limitPerBlock } from '../modules/island.ts'
import thresholdsJson from './rules/thresholds.json' with { type: 'json' }
import materialsJson from './rules/materials.json' with { type: 'json' }
import vegetationJson from './rules/vegetation.json' with { type: 'json' }

export type Range = [number | null, number | null]
export interface Conditions { slope?: Range; altitude?: Range; moisture?: Range; curvature?: Range; waterDist?: Range }
export interface MaterialRule extends Conditions { name: string; weight?: number }
export interface VegetationRule extends Conditions { generator: string; prefab?: string }
export interface Thresholds {
  feather: number; blockCells: number; lakeMaxPoints: number; lakeSimplifyTolerance: number
  curvatureRadiusCells: number; riverMoistureBoost: number; waterMoistureFalloff: number
  vegetation: { threshold: number; simplifyTolerance: number; minAreaM2: number }
  compare: { minSameDominantPct: number; maxMeanWeightError: number; maxOverBlocks: number }
}
export interface SoilRules {
  thresholds: Thresholds
  materials: Record<string, MaterialRule[]>
  vegetation: Record<string, VegetationRule[]>
}
export const DEFAULT_RULES: SoilRules = {
  thresholds: thresholdsJson as unknown as Thresholds,
  materials: (materialsJson as unknown as { biomes: Record<string, MaterialRule[]> }).biomes,
  vegetation: (vegetationJson as unknown as { biomes: Record<string, VegetationRule[]> }).biomes,
}

export interface TerrainSignals {
  cols: number; rows: number; step: number
  slope: Float32Array // degrees
  altitude: Float32Array // m above sea level
  curvature: Float32Array // m, height minus local mean (> 0 = crest)
  moisture: Float32Array // 0..1 (flow accumulation + water proximity)
  waterDist: Float32Array // m to the nearest sea / lake / river cell
  water: Uint8Array // 1 = sea, lake or river
}

// ---------- geometry helpers ----------
function inPoly(x: number, z: number, p: Points): boolean {
  let ins = false
  for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) {
    const xi = p[i], zi = p[i + 1], xj = p[j], zj = p[j + 1]
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) ins = !ins
  }
  return ins
}
function segDist2(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax, dz = bz - az, l = dx * dx + dz * dz
  const t = l ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l)) : 0
  const ex = ax + t * dx - px, ez = az + t * dz - pz
  return ex * ex + ez * ez
}
export function polygonArea(p: Points): number {
  let a = 0
  for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) a += p[j] * p[i + 1] - p[i] * p[j + 1]
  return a / 2
}
/** Douglas-Peucker on a closed ring of flat X/Z pairs */
export function simplifyRing(p: Points, tol: number): Points {
  const n = p.length / 2
  if (n <= 4) return p.slice()
  // split at the point farthest from point 0 so the ring becomes two open polylines
  let far = 0, fd = -1
  for (let i = 1; i < n; i++) { const d = (p[2 * i] - p[0]) ** 2 + (p[2 * i + 1] - p[1]) ** 2; if (d > fd) { fd = d; far = i } }
  const keep = new Uint8Array(n); keep[0] = 1; keep[far] = 1
  const t2 = tol * tol
  const dp = (a: number, b: number) => { // indices modulo n, a < b (b may be n meaning 0)
    const stack: [number, number][] = [[a, b]]
    while (stack.length) {
      const [s, e] = stack.pop()!
      const ei = e % n
      let md = -1, mi = -1
      for (let k = s + 1; k < e; k++) {
        const d = segDist2(p[2 * k], p[2 * k + 1], p[2 * s], p[2 * s + 1], p[2 * ei], p[2 * ei + 1])
        if (d > md) { md = d; mi = k }
      }
      if (mi >= 0 && md > t2) { keep[mi] = 1; stack.push([s, mi], [mi, e]) }
    }
  }
  dp(0, far); dp(far, n)
  const out: number[] = []
  for (let i = 0; i < n; i++) if (keep[i]) out.push(p[2 * i], p[2 * i + 1])
  return out
}
/** simplify a closed ring until it has at most maxPts points (tolerance doubles each pass) */
export function capRing(p: Points, maxPts: number, tol: number): Points {
  let out = simplifyRing(p, tol), t = Math.max(tol, 1e-3)
  for (let k = 0; out.length / 2 > maxPts && k < 40; k++) { t *= 2; out = simplifyRing(p, t) }
  if (out.length / 2 > maxPts) { // last resort: uniform decimation
    const n = out.length / 2, r: number[] = []
    for (let i = 0; i < maxPts; i++) { const k = Math.floor((i * n) / maxPts); r.push(out[2 * k], out[2 * k + 1]) }
    out = r
  }
  return out
}

// ---------- step 1: terrain signals ----------
export function terrainSignals(input: ContractInput, rules: SoilRules = DEFAULT_RULES): TerrainSignals {
  const hm = input.heightmap, { cols, rows, step, minX, minZ } = hm, h = hm.heights, N = cols * rows
  const sea = input.water.seaLevel ?? -Infinity, seaRef = input.water.seaLevel ?? 0
  const slope = new Float32Array(N), altitude = new Float32Array(N), curvature = new Float32Array(N)
  const at = (c: number, r: number) => h[Math.max(0, Math.min(rows - 1, r)) * cols + Math.max(0, Math.min(cols - 1, c))]
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const i = r * cols + c
    const gx = (at(c + 1, r) - at(c - 1, r)) / (2 * step), gz = (at(c, r + 1) - at(c, r - 1)) / (2 * step)
    slope[i] = (Math.atan(Math.hypot(gx, gz)) * 180) / Math.PI
    altitude[i] = h[i] - seaRef
  }
  // curvature via a summed-area table (local mean in a (2R+1)² window)
  const R = Math.max(1, rules.thresholds.curvatureRadiusCells | 0), sat = new Float64Array((cols + 1) * (rows + 1))
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++)
    sat[(r + 1) * (cols + 1) + c + 1] = h[r * cols + c] + sat[r * (cols + 1) + c + 1] + sat[(r + 1) * (cols + 1) + c] - sat[r * (cols + 1) + c]
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const r0 = Math.max(0, r - R), r1 = Math.min(rows, r + R + 1), c0 = Math.max(0, c - R), c1 = Math.min(cols, c + R + 1)
    const s = sat[r1 * (cols + 1) + c1] - sat[r0 * (cols + 1) + c1] - sat[r1 * (cols + 1) + c0] + sat[r0 * (cols + 1) + c0]
    curvature[r * cols + c] = h[r * cols + c] - s / ((r1 - r0) * (c1 - c0))
  }
  // water cells: sea, lake interiors, river corridors
  const water = new Uint8Array(N)
  for (let i = 0; i < N; i++) if (h[i] <= sea) water[i] = 1
  for (const lake of input.water.lakes) for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++)
    if (inPoly(minX + c * step, minZ + r * step, lake.points)) water[r * cols + c] = 1
  for (const rv of input.water.rivers) {
    const hw = Math.max(rv.width / 2, step / 2), hw2 = hw * hw
    for (let k = 0; k + 3 < rv.points.length; k += 2) {
      const ax = rv.points[k], az = rv.points[k + 1], bx = rv.points[k + 2], bz = rv.points[k + 3]
      const c0 = Math.max(0, Math.floor((Math.min(ax, bx) - hw - minX) / step)), c1 = Math.min(cols - 1, Math.ceil((Math.max(ax, bx) + hw - minX) / step))
      const r0 = Math.max(0, Math.floor((Math.min(az, bz) - hw - minZ) / step)), r1 = Math.min(rows - 1, Math.ceil((Math.max(az, bz) + hw - minZ) / step))
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++)
        if (segDist2(minX + c * step, minZ + r * step, ax, az, bx, bz) <= hw2) water[r * cols + c] = 1
    }
  }
  // chamfer distance (3-4) to water
  const waterDist = new Float32Array(N).fill(1e9)
  for (let i = 0; i < N; i++) if (water[i]) waterDist[i] = 0
  const a = step, d = step * Math.SQRT2
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const i = r * cols + c; let v = waterDist[i]
    if (c > 0) v = Math.min(v, waterDist[i - 1] + a)
    if (r > 0) { v = Math.min(v, waterDist[i - cols] + a); if (c > 0) v = Math.min(v, waterDist[i - cols - 1] + d); if (c < cols - 1) v = Math.min(v, waterDist[i - cols + 1] + d) }
    waterDist[i] = v
  }
  for (let r = rows - 1; r >= 0; r--) for (let c = cols - 1; c >= 0; c--) {
    const i = r * cols + c; let v = waterDist[i]
    if (c < cols - 1) v = Math.min(v, waterDist[i + 1] + a)
    if (r < rows - 1) { v = Math.min(v, waterDist[i + cols] + a); if (c < cols - 1) v = Math.min(v, waterDist[i + cols + 1] + d); if (c > 0) v = Math.min(v, waterDist[i + cols - 1] + d) }
    waterDist[i] = v
  }
  const flow = flowMoisture(h, cols, rows, seaRef)
  const moisture = new Float32Array(N), fall = Math.max(1, rules.thresholds.waterMoistureFalloff), boost = rules.thresholds.riverMoistureBoost
  for (let i = 0; i < N; i++) moisture[i] = Math.min(1, Math.max(flow[i], boost * Math.exp(-waterDist[i] / fall)) + (water[i] ? 1 : 0))
  return { cols, rows, step, slope, altitude, curvature, moisture, waterDist, water }
}

// ---------- step 2: biome ----------
/** per-cell biome name: the fixed input.biome, or the climate biome when biome is "auto"/"climate" */
export function cellBiomes(input: ContractInput): { names: string[]; index: Uint8Array } {
  const hm = input.heightmap
  if (input.biome !== 'auto' && input.biome !== 'climate') return { names: [input.biome], index: new Uint8Array(hm.cols * hm.rows) }
  const cl = computeClimate(hm.heights, hm.cols, hm.rows, hm.step, { seaLevel: input.water.seaLevel ?? 0 })
  const names = [...CLIMATE_BIOMES] as string[], idx = new Uint8Array(cl.biome.length)
  // sea cells keep the most common land biome so shore rules still apply
  const count = new Array(names.length).fill(0)
  for (const b of cl.biome) if (b !== SEA) count[b]++
  const fallback = count.indexOf(Math.max(...count))
  for (let i = 0; i < idx.length; i++) idx[i] = cl.biome[i] === SEA ? fallback : cl.biome[i]
  return { names, index: idx }
}

// ---------- step 3: material masks ----------
function member(v: number, rg: Range | undefined, feather: number): number {
  if (!rg) return 1
  const [lo, hi] = rg
  const span = lo !== null && hi !== null ? hi - lo : Math.abs((lo ?? hi) as number) || 1
  const w = Math.max(1e-6, feather * span)
  let m = 1
  if (lo !== null) m *= smooth((v - lo) / w + 0.5)
  if (hi !== null) m *= smooth((hi - v) / w + 0.5)
  return m
}
const smooth = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t))
export function conditionWeight(s: TerrainSignals, i: number, c: Conditions, feather: number): number {
  return member(s.slope[i], c.slope, feather) * member(s.altitude[i], c.altitude, feather) * member(s.moisture[i], c.moisture, feather)
    * member(s.curvature[i], c.curvature, feather) * member(s.waterDist[i], c.waterDist, feather)
}
const rulesFor = <T>(table: Record<string, T[]>, biome: string): T[] => table[biome] ?? table.default ?? []

export function materialMasks(input: ContractInput, s: TerrainSignals, biomes: { names: string[]; index: Uint8Array }, rules: SoilRules = DEFAULT_RULES): MaterialMask[] {
  const { minX, minZ, step, cols, rows } = input.heightmap, N = cols * rows, f = rules.thresholds.feather
  const byName = new Map<string, Float32Array>()
  const get = (n: string) => { let a = byName.get(n); if (!a) byName.set(n, (a = new Float32Array(N))); return a }
  const perBiome = biomes.names.map((b) => rulesFor(rules.materials, b))
  for (let i = 0; i < N; i++) {
    const list = perBiome[biomes.index[i]]
    let sum = 0
    for (const r of list) sum += (r.weight ?? 1) * conditionWeight(s, i, r, f)
    if (sum <= 0) { if (list[0]) get(list[0].name)[i] = 1; continue }
    for (const r of list) { const w = ((r.weight ?? 1) * conditionWeight(s, i, r, f)) / sum; if (w > 0) get(r.name)[i] += w }
  }
  return [...byName.entries()].map(([name, w]) => ({ name, minX, minZ, step, cols, rows, weights: Array.from(w, (x) => Math.min(1, x)) }))
}

// ---------- step 4: texture budget ----------
function renormalize(masks: MaterialMask[]) {
  const N = masks[0]?.weights.length ?? 0
  for (let i = 0; i < N; i++) {
    let s = 0
    for (const m of masks) s += m.weights[i]
    if (s > 0) for (const m of masks) m.weights[i] /= s
  }
}
/** keep at most maxMaterials (heaviest), then at most maxPerBlock per block; returns the surviving masks */
export function arbitrateBudget(masks: MaterialMask[], budget: ContractInput['budget'], blockCells: number): MaterialMask[] {
  const total = (m: MaterialMask) => m.weights.reduce((a, b) => a + b, 0)
  let kept = masks.filter((m) => total(m) > 0).sort((a, b) => total(b) - total(a) || (a.name < b.name ? -1 : 1)).slice(0, budget.maxMaterials)
  renormalize(kept)
  if (kept.length) limitPerBlock(kept, blockCells * kept[0].step, budget.maxPerBlock)
  kept = kept.filter((m) => total(m) > 0)
  renormalize(kept)
  return kept
}

// ---------- step 5: water ----------
export interface WaterShape { kind: 'lake'; level: number; /** flat X/Y/Z triplets, Y = terrain height (on the ground) */ points: number[] }
export function sampleHeight(hm: ContractInput['heightmap'], x: number, z: number): number {
  const fx = Math.max(0, Math.min(hm.cols - 1, (x - hm.minX) / hm.step)), fz = Math.max(0, Math.min(hm.rows - 1, (z - hm.minZ) / hm.step))
  const c = Math.min(hm.cols - 2, Math.floor(fx)), r = Math.min(hm.rows - 2, Math.floor(fz))
  if (c < 0 || r < 0) return hm.heights[0]
  const tx = fx - c, tz = fz - r, H = hm.heights, k = r * hm.cols + c
  return (H[k] * (1 - tx) + H[k + 1] * tx) * (1 - tz) + (H[k + hm.cols] * (1 - tx) + H[k + hm.cols + 1] * tx) * tz
}
export function waterShapes(input: ContractInput, rules: SoilRules = DEFAULT_RULES): WaterShape[] {
  const t = rules.thresholds
  return input.water.lakes.map((l) => {
    const ring = capRing(l.points, t.lakeMaxPoints, t.lakeSimplifyTolerance), pts: number[] = []
    for (let i = 0; i < ring.length; i += 2) pts.push(ring[i], sampleHeight(input.heightmap, ring[i], ring[i + 1]), ring[i + 1])
    return { kind: 'lake', level: l.level, points: pts }
  })
}

// ---------- step 6: potential vegetation zones ----------
/** outer contours of a binary grid (marching squares on cell boundaries), world X/Z rings */
export function traceContours(mask: Uint8Array, cols: number, rows: number, minX: number, minZ: number, step: number): Points[] {
  // directed boundary edges between corner vertices (vertex grid (cols+1)x(rows+1), corners at cell centre ± step/2)
  const V = cols + 1, next = new Map<number, number[]>()
  const on = (c: number, r: number) => c >= 0 && r >= 0 && c < cols && r < rows && mask[r * cols + c] === 1
  const add = (a: number, b: number) => { const l = next.get(a); if (l) l.push(b); else next.set(a, [b]) }
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    if (!on(c, r)) continue
    const v00 = r * V + c, v10 = v00 + 1, v01 = v00 + V, v11 = v01 + 1
    if (!on(c, r - 1)) add(v10, v00) // keeps the filled cell on the same side for every edge
    if (!on(c + 1, r)) add(v11, v10)
    if (!on(c, r + 1)) add(v01, v11)
    if (!on(c - 1, r)) add(v00, v01)
  }
  const rings: Points[] = []
  for (const start of [...next.keys()].sort((a, b) => a - b)) {
    while (next.get(start)?.length) {
      const ring: number[] = []
      let v = start
      do {
        const l = next.get(v)!; const w = l.pop()!
        if (!l.length) next.delete(v)
        ring.push(minX + ((v % V) - 0.5) * step, minZ + (Math.floor(v / V) - 0.5) * step)
        v = w
      } while (v !== start && next.has(v))
      if (ring.length >= 6) rings.push(ring)
    }
  }
  return rings
}
export function vegetationZones(input: ContractInput, s: TerrainSignals, biomes: { names: string[]; index: Uint8Array }, rules: SoilRules = DEFAULT_RULES): VegetationZone[] {
  const { minX, minZ, step, cols, rows } = input.heightmap, N = cols * rows, t = rules.thresholds, out: VegetationZone[] = []
  const perBiome = biomes.names.map((b) => rulesFor(rules.vegetation, b))
  const gens = new Map<string, VegetationRule>()
  for (const list of perBiome) for (const r of list) if (!gens.has(r.generator)) gens.set(r.generator, r)
  // first matching rule claims a cell, so zones of different generators never overlap
  const owner = new Int16Array(N).fill(-1), keys = [...gens.keys()]
  for (let i = 0; i < N; i++) {
    if (s.water[i]) continue
    for (const r of perBiome[biomes.index[i]]) if (conditionWeight(s, i, r, t.feather) >= t.vegetation.threshold) { owner[i] = keys.indexOf(r.generator); break }
  }
  keys.forEach((g, k) => {
    const m = new Uint8Array(N)
    for (let i = 0; i < N; i++) if (owner[i] === k) m[i] = 1
    for (const ring of traceContours(m, cols, rows, minX, minZ, step)) {
      if (polygonArea(ring) >= 0) continue // outer rings are negative here (Z down); holes are dropped (outer outlines only)
      const simp = simplifyRing(ring, t.vegetation.simplifyTolerance)
      if (simp.length < 6 || Math.abs(polygonArea(simp)) < t.vegetation.minAreaM2) continue
      const z: VegetationZone = { points: simp, generator: g }
      const pf = gens.get(g)!.prefab
      if (pf) z.prefab = pf
      out.push(z)
    }
  })
  return out
}

// ---------- pipeline ----------
export interface SoilDetails { signals: TerrainSignals; biomes: string[]; water: WaterShape[]; output: ContractOutput }
export function runSoilEngineDetailed(input: ContractInput, rules: SoilRules = DEFAULT_RULES): SoilDetails {
  const signals = terrainSignals(input, rules)
  const biomes = cellBiomes(input)
  const masks = arbitrateBudget(materialMasks(input, signals, biomes, rules), input.budget, rules.thresholds.blockCells)
  const vegetation = vegetationZones(input, signals, biomes, rules)
  const budget = budgetReport(masks, input.budget, rules.thresholds.blockCells)
  const used = new Set<number>(biomes.index)
  return { signals, biomes: biomes.names.filter((_, k) => used.has(k)), water: waterShapes(input, rules), output: { version: CONTRACT_VERSION, masks, vegetation, budget } }
}
export function runSoilEngine(input: ContractInput, rules: SoilRules = DEFAULT_RULES): ContractOutput {
  return runSoilEngineDetailed(input, rules).output
}
