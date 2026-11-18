// Climate biomes (docs/PLAN_GIORBEV.md, Phase 3 "Biomes climatiques"): height grid -> temperature,
// rainfall, moisture -> BiomeId per cell. Pure, no DOM, typed arrays, no per-cell allocation, so it can
// run in a Web Worker on 8192² grids (use `downsample` to work on a coarser grid).
//
// Climate class -> BiomeId mapping (first match wins; P = effective rainfall mm/yr, T = mean °C):
//   sea (h <= seaLevel)             -> SEA (255, no biome)
//   T < 0                           -> winter_tundra
//   T < 6                           -> nordic_kolguyev     (boreal / cold uplands)
//   T >= 22 and P >= 1500           -> tropical
//   P < 250                         -> desert
//   T >= 14 and P < 700             -> mediterranean_dry
//   T < 10                          -> woodland_arland     (cool temperate)
//   otherwise                       -> temperate_everon
//
// Moisture is a D8 flow accumulation (log-normalised 0..1); hydro.ts's computeRivers carves heights and
// needs river params, so it is not reused. Moisture raises effective rainfall by up to +60 %.

import type { BiomeId } from '../data/biomes.ts'

/** index -> BiomeId for ClimateResult.biome */
export const CLIMATE_BIOMES: readonly BiomeId[] = ['temperate_everon', 'woodland_arland', 'nordic_kolguyev', 'mediterranean_dry', 'desert', 'winter_tundra', 'tropical']
export const SEA = 255
const B_TEMP = 0, B_WOOD = 1, B_NORD = 2, B_MED = 3, B_DES = 4, B_WIN = 5, B_TROP = 6

export interface ClimateParams {
  seaLevel?: number // m, default 0
  /** sea-level mean temperature °C; when absent derived from latitude */
  baseTemperature?: number
  latitude?: number // degrees, default 45
  lapseRate?: number // °C per km, default 6.5
  /** direction the wind blows TOWARD, degrees: 0 = +X, 90 = +Z (row index increasing) */
  windDirection?: number
  baseRainfall?: number // mm/yr over the sea, default 800
  orographic?: number // rain multiplier per unit of upslope grade, default 25
  /** fraction of the air moisture that falls as rain per km over flat land, default 0.08 */
  depletionPerKm?: number
  /** compute on a grid coarser by this integer factor (>= 1), default 1 */
  downsample?: number
}

export interface ClimateResult {
  cols: number; rows: number; step: number // of the (possibly downsampled) output grid
  temperature: Float32Array // °C
  rainfall: Float32Array // mm/yr, effective (moisture included)
  moisture: Float32Array // 0..1
  biome: Uint8Array // index into CLIMATE_BIOMES, or SEA
}

export function latitudeTemperature(lat: number): number {
  const a = Math.abs(lat) * Math.PI / 180
  return -15 + 42 * Math.cos(a) * Math.cos(a) // ~27 °C equator, ~5 °C at 65°, -15 at the pole
}

function downsampleGrid(h: ArrayLike<number>, cols: number, rows: number, f: number): [Float32Array, number, number] {
  const c2 = Math.max(1, Math.floor(cols / f)), r2 = Math.max(1, Math.floor(rows / f))
  const out = new Float32Array(c2 * r2), inv = 1 / (f * f)
  for (let r = 0; r < r2; r++) for (let c = 0; c < c2; c++) {
    let s = 0
    for (let y = 0; y < f; y++) { const row = (r * f + y) * cols + c * f; for (let x = 0; x < f; x++) s += h[row + x] }
    out[r * c2 + c] = s * inv
  }
  return [out, c2, r2]
}

/** D8 flow accumulation, log-normalised to 0..1. Cells at/below sea level are sinks. */
export function flowMoisture(h: ArrayLike<number>, cols: number, rows: number, seaLevel = 0): Float32Array {
  const n = cols * rows
  const order = new Uint32Array(n)
  for (let i = 0; i < n; i++) order[i] = i
  const hf = h instanceof Float32Array ? h : Float32Array.from(h as ArrayLike<number>)
  order.sort((a, b) => hf[b] - hf[a]) // highest first
  const acc = new Float32Array(n).fill(1)
  let max = 1
  for (let k = 0; k < n; k++) {
    const i = order[k], hi = hf[i]
    if (hi <= seaLevel) continue
    const r = (i / cols) | 0, c = i - r * cols
    let best = -1, drop = 0
    for (let dr = -1; dr <= 1; dr++) {
      const rr = r + dr; if (rr < 0 || rr >= rows) continue
      for (let dc = -1; dc <= 1; dc++) {
        const cc = c + dc; if ((dr | dc) === 0 || cc < 0 || cc >= cols) continue
        const j = rr * cols + cc, d = (hi - hf[j]) * (dr && dc ? 0.7071 : 1)
        if (d > drop) { drop = d; best = j }
      }
    }
    if (best >= 0) { acc[best] += acc[i]; if (acc[best] > max) max = acc[best] }
  }
  const lm = Math.log(max) || 1
  for (let i = 0; i < n; i++) acc[i] = hf[i] <= seaLevel ? 1 : Math.log(acc[i]) / lm
  return acc
}

/**
 * Orographic rainfall: air parcels sweep along the wind, recharge over sea, rain out on upslopes
 * (windward wet) and lose moisture, so lee slopes and inland cells are drier (rain shadow, distance to
 * sea). Scan order guarantees the upwind sample (interpolated in the previous line) is already done.
 */
export function orographicRain(h: ArrayLike<number>, cols: number, rows: number, step: number, seaLevel: number,
  windDeg: number, base: number, oro: number, depKm: number): Float32Array {
  const n = cols * rows, rain = new Float32Array(n), q = new Float32Array(n)
  const a = windDeg * Math.PI / 180, wx = Math.cos(a), wz = Math.sin(a)
  const xMajor = Math.abs(wx) >= Math.abs(wz)
  const lines = xMajor ? cols : rows, len = xMajor ? rows : cols
  const s = xMajor ? Math.sign(wx) || 1 : Math.sign(wz) || 1
  const slope = xMajor ? wz / Math.abs(wx) : wx / Math.abs(wz) // lateral offset per line
  const dist = step * Math.sqrt(1 + slope * slope) // metres travelled between lines
  const dep = Math.min(1, depKm * dist / 1000)
  for (let li = 0; li < lines; li++) {
    const L = s > 0 ? li : lines - 1 - li, P = L - s
    for (let k = 0; k < len; k++) {
      const i = xMajor ? k * cols + L : L * cols + k
      const hi = h[i]
      if (hi <= seaLevel || li === 0) { q[i] = 1; rain[i] = base; continue }
      // upwind sample in the previous line, linear between two cells
      let u = k - slope; if (u < 0) u = 0; else if (u > len - 1) u = len - 1
      const u0 = u | 0, u1 = u0 < len - 1 ? u0 + 1 : u0, t = u - u0
      const j0 = xMajor ? u0 * cols + P : P * cols + u0, j1 = xMajor ? u1 * cols + P : P * cols + u1
      const qu = q[j0] * (1 - t) + q[j1] * t
      const hu = Math.max(seaLevel, h[j0] * (1 - t) + h[j1] * t)
      const grade = (hi - hu) / dist
      let f = dep * (1 + oro * Math.max(0, grade)) // upslope: forced rain-out
      if (grade < 0) f *= Math.max(0.1, 1 + oro * 0.5 * grade) // downslope: descending dry air
      if (f > 0.9) f = 0.9
      const fall = qu * f
      q[i] = qu - fall
      rain[i] = base * qu * (1 + oro * Math.max(0, grade)) * (grade < 0 ? Math.max(0.15, 1 + oro * grade) : 1)
    }
  }
  return rain
}

export function classify(T: number, P: number): number {
  if (T < 0) return B_WIN
  if (T < 6) return B_NORD
  if (T >= 22 && P >= 1500) return B_TROP
  if (P < 250) return B_DES
  if (T >= 14 && P < 700) return B_MED
  if (T < 10) return B_WOOD
  return B_TEMP
}

export function computeClimate(heights: ArrayLike<number>, cols: number, rows: number, step: number, p: ClimateParams = {}): ClimateResult {
  const f = Math.max(1, Math.floor(p.downsample ?? 1))
  let h: ArrayLike<number> = heights
  if (f > 1) { const d = downsampleGrid(heights, cols, rows, f); h = d[0]; cols = d[1]; rows = d[2]; step *= f }
  const n = cols * rows, sea = p.seaLevel ?? 0
  const T0 = p.baseTemperature ?? latitudeTemperature(p.latitude ?? 45)
  const lapse = (p.lapseRate ?? 6.5) / 1000
  const rain = orographicRain(h, cols, rows, step, sea, p.windDirection ?? 0, p.baseRainfall ?? 800, p.orographic ?? 25, p.depletionPerKm ?? 0.08)
  const moisture = flowMoisture(h, cols, rows, sea)
  const temperature = new Float32Array(n), biome = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    const hi = h[i]
    const T = T0 - lapse * Math.max(0, hi - sea)
    temperature[i] = T
    if (hi <= sea) { biome[i] = SEA; continue }
    const P = rain[i] * (1 + 0.6 * moisture[i])
    rain[i] = P
    biome[i] = classify(T, P)
  }
  return { cols, rows, step, temperature, rainfall: rain, moisture, biome }
}

export const biomeAt = (r: ClimateResult, i: number): BiomeId | null => r.biome[i] === SEA ? null : CLIMATE_BIOMES[r.biome[i]]
