// Metric Atlas (altitude / slope / aspect / roughness / TPI statistics), auto-calibration of the surface
// thresholds from percentiles, and biome masks by ordered priority rules.
// Ported from giorbev's terrain_analysis.py, terrain_algorithms.py (auto_calibrate), main.py
// (auto_calibrate_params) and data/biomes/*.json (MIT, Copyright (c) giorbev). Grids are downsampled
// height grids (row 0 = south), same as heights.ts.
import type { HeightGrid } from './heights.ts'

export interface Grid { cols: number; rows: number; cell: number; h: Float32Array }
export function coarse(H: HeightGrid, maxSide = 1024): Grid {
  const k = Math.max(1, Math.ceil(Math.max(H.cols, H.rows) / maxSide))
  const cols = Math.floor((H.cols - 1) / k) + 1, rows = Math.floor((H.rows - 1) / k) + 1, h = new Float32Array(cols * rows)
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) h[r * cols + c] = H.h[r * k * H.cols + c * k]
  return { cols, rows, cell: H.cell * k, h }
}

export interface Metrics { slope: Float32Array; aspect: Float32Array; rough: Float32Array; tpi: Float32Array }
export function metrics(g: Grid): Metrics {
  const { cols, rows, cell, h } = g, n = cols * rows
  const slope = new Float32Array(n), aspect = new Float32Array(n), rough = new Float32Array(n), tpi = new Float32Array(n)
  const at = (c: number, r: number) => h[Math.min(rows - 1, Math.max(0, r)) * cols + Math.min(cols - 1, Math.max(0, c))]
  const R = Math.max(1, Math.round(100 / cell)) // TPI radius ~100 m
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const i = r * cols + c, dx = (at(c + 1, r) - at(c - 1, r)) / (2 * cell), dz = (at(c, r + 1) - at(c, r - 1)) / (2 * cell)
    slope[i] = Math.atan(Math.hypot(dx, dz)) * 180 / Math.PI
    aspect[i] = (Math.atan2(-dx, -dz) * 180 / Math.PI + 360) % 360 // direction the slope faces, 0 = north
    let mn = Infinity, mx = -Infinity
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) { const v = at(c + dc, r + dr); if (v < mn) mn = v; if (v > mx) mx = v }
    rough[i] = mx - mn
    tpi[i] = h[i] - (at(c - R, r) + at(c + R, r) + at(c, r - R) + at(c, r + R)) / 4
  }
  return { slope, aspect, rough, tpi }
}

export function percentile(a: ArrayLike<number>, p: number): number {
  const s = Float32Array.from(a).sort()
  if (!s.length) return NaN
  return s[Math.min(s.length - 1, Math.max(0, Math.round((p / 100) * (s.length - 1))))]
}

export interface Stat { min: number; p05: number; p50: number; p95: number; max: number; mean: number }
function stat(a: ArrayLike<number>): Stat {
  const s = Float32Array.from(a).sort(), n = s.length, q = (p: number) => s[Math.round(p * (n - 1))]
  let sum = 0
  for (const v of s) sum += v
  return { min: s[0], p05: q(0.05), p50: q(0.5), p95: q(0.95), max: s[n - 1], mean: sum / n }
}
export interface Atlas { alt: Stat; land: Stat | null; slope: Stat; rough: Stat; tpi: Stat; landPct: number; aspect: number[]; slopeHist: number[] }
/** giorbev's "Atlas Métrique": per-metric statistics + aspect rose (N, NE, E, SE, S, SW, W, NW) and slope classes */
export function atlas(g: Grid, m: Metrics, sea = 0): Atlas {
  const land: number[] = [], aspect = new Array(8).fill(0), slopeHist = new Array(6).fill(0) // 0-5,5-10,10-20,20-30,30-45,45+
  for (let i = 0; i < g.h.length; i++) {
    if (g.h[i] > sea) { land.push(g.h[i]); if (m.slope[i] > 2) aspect[Math.round(m.aspect[i] / 45) % 8]++ }
    const s = m.slope[i]
    slopeHist[s < 5 ? 0 : s < 10 ? 1 : s < 20 ? 2 : s < 30 ? 3 : s < 45 ? 4 : 5]++
  }
  return { alt: stat(g.h), land: land.length ? stat(land) : null, slope: stat(m.slope), rough: stat(m.rough), tpi: stat(m.tpi), landPct: (100 * land.length) / g.h.length, aspect, slopeHist }
}

// ---------------------------------------------------------------- auto-calibration
export interface Calib { coastal: number; prairie: number; midland: number; alpages: number; debris: number; rock: number; cliff: number }
/** thresholds from percentiles of the land altitudes and the slopes (his auto_calibrate / auto_calibrate_params) */
export function autoCalibrate(g: Grid, m: Metrics, sea = 0): Calib {
  const land = g.h.filter((v) => v > sea), L = land.length ? land : g.h
  const r1 = (v: number) => Math.round(v * 10) / 10
  return {
    coastal: r1(percentile(L, 10)), prairie: r1(percentile(L, 30)), midland: r1(percentile(L, 66)), alpages: r1(percentile(L, 80)),
    debris: r1(percentile(m.slope, 65)), rock: r1(percentile(m.slope, 85)), cliff: r1(percentile(m.slope, 95)),
  }
}

// ---------------------------------------------------------------- biome rules → masks
export interface Rule { tex: string; priority: number; altMin?: number; altMax?: number; slopeMin?: number; slopeMax?: number }
type Json = Record<string, unknown>
/** rules of a biome preset: explicit (altitude_* in metres, or normalised 0-1 of the height range) or by role */
export function biomeRules(b: Json, c: Calib, H: { min: number; max: number }): Rule[] {
  const tex = (b.textures ?? {}) as Record<string, Json>, out: Rule[] = []
  const norm = (v: unknown) => typeof v === 'number' ? H.min + v * (H.max - H.min) : undefined
  const num = (v: unknown) => typeof v === 'number' ? v : undefined
  const explicit = Object.values(tex).some((v) => 'priority' in v)
  if (explicit) {
    for (const [name, v] of Object.entries(tex)) out.push({
      tex: name.replace(/\.emat$/, ''), priority: Number(v.priority ?? 0),
      altMin: num(v.altitude_min_meters) ?? norm(v.altitude_min), altMax: num(v.altitude_max_meters) ?? norm(v.altitude_max),
      slopeMin: num(v.slope_min), slopeMax: num(v.slope_max),
    })
  } else {
    // role presets (temperate / arid / tropical): his role order, thresholds from the calibration
    const ROLE: [RegExp, number, Partial<Rule>][] = [
      [/^seabed$/, 11, { altMax: 0 }], [/^rock$/, 10, { slopeMin: c.rock }], [/^debris$/, 8, { slopeMin: c.debris, slopeMax: c.rock }],
      [/^coastal/, 7, { altMin: 0, altMax: c.coastal, slopeMax: 20 }], [/^grass_lowland$|^grass_standard$/, 5, { altMax: c.prairie }],
      [/^grass_midland$|^grass_dense_zones$/, 4, { altMax: c.midland }], [/^highland_crest$/, 3, { altMin: c.alpages, slopeMin: c.debris * 0.6 }],
      [/^grass_highland$|^highland_dense$/, 2, {}],
    ]
    for (const [role, v] of Object.entries(tex)) {
      const hit = ROLE.find(([re]) => re.test(role)); if (!hit || typeof v.default !== 'string') continue
      if (out.some((r) => r.priority === hit[1])) continue
      out.push({ tex: v.default.replace(/\.emat$/, ''), priority: hit[1], ...hit[2] })
    }
  }
  return out.sort((a, b) => b.priority - a.priority)
}

/** ordered subtraction: each cell takes the highest-priority rule it satisfies (index into rules), else -1 */
export function classify(g: Grid, m: Metrics, rules: Rule[]): Int8Array {
  const out = new Int8Array(g.h.length).fill(-1)
  for (let i = 0; i < g.h.length; i++) {
    const h = g.h[i], s = m.slope[i]
    for (let k = 0; k < rules.length; k++) {
      const r = rules[k]
      if ((r.altMin === undefined || h >= r.altMin) && (r.altMax === undefined || h < r.altMax) && (r.slopeMin === undefined || s >= r.slopeMin) && (r.slopeMax === undefined || s < r.slopeMax)) { out[i] = k; break }
    }
  }
  return out
}
