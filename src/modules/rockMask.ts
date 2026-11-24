// Rock / scree masks from slope AND relief context. Before, every vertex steeper than 20-40 % turned to
// bare rock, so a steep island was rock almost everywhere. Now a steep vertex is rock only when the relief
// says "cliff": a slope break (strong curvature), a crest (positive TPI), a tall local drop (cliff
// height), high altitude, or a really vertical face. Long uniform slopes keep their grass / forest floor.
// The rock share of the land is capped (the threshold rises until it fits), and scree sits only at the
// concave foot of rock faces.

import { clamp01, ramp, type TerrainShape } from './groundMasks'

export interface RockMasks {
  /** bare rock weight per vertex (0..1) */
  rock: Float32Array
  /** scree / debris weight per vertex (0..1), at cliff feet only */
  scree: Float32Array
}

export interface RockOptions {
  /** max share of the land (h > 1 m) that may be rock (default 0.025; [M] Everon bare Rock_01 1.4 %, Kolguyev 0, Arland 0.1 %) */
  maxShare?: number
}

/** slope (rise/run) of every vertex, central differences over +-k cells (k > 1 reads through small roughness) */
export function slopes(heights: ArrayLike<number>, cols: number, rows: number, step: number, k = 1): Float32Array {
  const at = (c: number, r: number) => heights[Math.min(Math.max(r, 0), rows - 1) * cols + Math.min(Math.max(c, 0), cols - 1)]
  const out = new Float32Array(cols * rows)
  for (let i = 0; i < out.length; i++) {
    const c = i % cols, r = (i - c) / cols
    out[i] = Math.hypot(at(c + k, r) - at(c - k, r), at(c, r + k) - at(c, r - k)) / (2 * k * step)
  }
  return out
}

/** sliding max / min over a line (monotonic deque, O(len)) */
function slide(get: (d: number) => number, len: number, k: number, isMax: boolean, put: (d: number, v: number) => void) {
  const q = new Int32Array(len)
  let head = 0, tail = 0, next = 0
  for (let d = 0; d < len; d++) {
    const hi = Math.min(len - 1, d + k)
    for (; next <= hi; next++) {
      const v = get(next)
      while (tail > head && (isMax ? get(q[tail - 1]) <= v : get(q[tail - 1]) >= v)) tail--
      q[tail++] = next
    }
    while (q[head] < d - k) head++
    put(d, get(q[head]))
  }
}

/** local relief: max - min height within `radius` metres (separable sliding window, O(n)) */
export function localRelief(heights: ArrayLike<number>, cols: number, rows: number, step: number, radius = 30): Float32Array {
  const k = Math.max(1, Math.round(radius / step))
  const n = cols * rows
  const mx = new Float32Array(n), mn = new Float32Array(n), mx2 = new Float32Array(n), mn2 = new Float32Array(n)
  for (let r = 0; r < rows; r++) {
    const o = r * cols
    slide((d) => heights[o + d], cols, k, true, (d, v) => { mx[o + d] = v })
    slide((d) => heights[o + d], cols, k, false, (d, v) => { mn[o + d] = v })
  }
  for (let c = 0; c < cols; c++) {
    slide((d) => mx[d * cols + c], rows, k, true, (d, v) => { mx2[d * cols + c] = v })
    slide((d) => mn[d * cols + c], rows, k, false, (d, v) => { mn2[d * cols + c] = v })
  }
  for (let i = 0; i < n; i++) mx2[i] -= mn2[i]
  return mx2
}

/** box blur (summed-area table, O(n)) */
function blur(src: Float32Array, cols: number, rows: number, k: number): Float32Array {
  const W = cols + 1
  const sat = new Float64Array(W * (rows + 1))
  for (let r = 0; r < rows; r++) {
    let line = 0
    for (let c = 0; c < cols; c++) { line += src[r * cols + c]; sat[(r + 1) * W + c + 1] = sat[r * W + c + 1] + line }
  }
  const out = new Float32Array(src.length)
  for (let r = 0; r < rows; r++) {
    const r0 = Math.max(0, r - k), r1 = Math.min(rows, r + k + 1)
    for (let c = 0; c < cols; c++) {
      const c0 = Math.max(0, c - k), c1 = Math.min(cols, c + k + 1)
      out[r * cols + c] = (sat[r1 * W + c1] - sat[r0 * W + c1] - sat[r1 * W + c0] + sat[r0 * W + c0]) / ((r1 - r0) * (c1 - c0))
    }
  }
  return out
}

const TAN35 = Math.tan((35 * Math.PI) / 180), TAN45 = 1

//! Rock and scree weights for the whole grid. `shape` is terrainShape(heights, ...) (TPI + curvature).
export function rockMasks(heights: ArrayLike<number>, cols: number, rows: number, step: number, maxHeight: number,
  shape: TerrainShape, opts: RockOptions = {}): RockMasks {
  const maxShare = opts.maxShare ?? 0.025
  const n = cols * rows
  // the slope of the face, not of its 8 m roughness (eroded relief: ravine walls and droplet grooves read
  // 35-45 deg cell to cell on a 25 deg flank, which painted whole flanks as rock)
  const slope = slopes(heights, cols, rows, step, Math.max(1, Math.round(12 / step)))
  const relief = localRelief(heights, cols, rows, step, 30)
  const score = new Float32Array(n)
  let land = 0
  for (let i = 0; i < n; i++) {
    const h = heights[i]
    if (h <= -2) continue
    if (h > 1) land++
    // [M] FIELDS_SURFACES_VANILLA §3 (Everon): Rock_01 only above 35 deg (19 % of the pixels at 35-45 deg, 45 % beyond 45)
    const steep = 0.19 * ramp(slope[i], TAN35, TAN35 + 0.08) + 0.26 * ramp(slope[i], TAN45 - 0.06, TAN45 + 0.06)
    if (steep <= 0) continue
    // relief context, each 0..1
    const crest = ramp(shape.tpi[i], 1, 8) * ramp(shape.curv[i], 0, -0.01)
    const brk = ramp(Math.abs(shape.curv[i]), 0.004, 0.02) // slope break: edge / foot of a face
    const tall = ramp(relief[i], 20, 45) * ramp(slope[i], 0.5, 0.9) // a real cliff height, not a 5 m bank
    const alpine = ramp(h, maxHeight * 0.6, maxHeight * 0.85)
    const vertical = ramp(slope[i], 1.0, 1.6)
    const ctx = Math.max(crest, brk, tall, alpine, vertical)
    score[i] = steep * (0.5 + 0.5 * ctx) // the relief context still decides where in the band the rock shows
  }
  // cap: on a steep island nearly every vertex scores 1, so rank the candidates by how "cliffy" they are
  // (slope, local drop, crest) and keep only the top of the list until the share fits
  const rock = new Float32Array(n)
  const key = new Float32Array(n)
  for (let i = 0; i < n; i++) key[i] = score[i] * (slope[i] + relief[i] / 40 + Math.max(0, shape.tpi[i]) / 10 + Math.abs(shape.curv[i]) * 50)
  let sum = 0
  for (let i = 0; i < n; i++) if (heights[i] > 1) sum += score[i]
  let q = 0
  if (land > 0 && sum > maxShare * land) {
    // quantile from a histogram of the keys (no sort on millions of vertices)
    let top = 0
    for (let i = 0; i < n; i++) if (heights[i] > 1 && key[i] > top) top = key[i]
    const B = 4096, hist = new Float64Array(B)
    for (let i = 0; i < n; i++) if (heights[i] > 1 && score[i] > 0) hist[Math.min(B - 1, Math.floor((key[i] / top) * B))]++
    let acc = 0, b = B - 1
    for (; b > 0 && acc + hist[b] < maxShare * land; b--) acc += hist[b]
    q = Math.max(1e-6, (b / B) * top)
  }
  for (let i = 0; i < n; i++) rock[i] = q > 0 ? score[i] * ramp(key[i], q * 0.9, q * 1.1) : score[i]
  // scree: below rock faces, on the concave, gentler ground
  const near = blur(rock, cols, rows, Math.max(1, Math.round(16 / step)))
  const scree = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    if (heights[i] <= -2) continue
    // foot = below the local mean (negative TPI, not the plateau edge above the face), not itself steep
    const foot = Math.max(ramp(-shape.tpi[i], 0, 3), ramp(shape.curv[i], 0, 0.004)) * (1 - ramp(slope[i], 0.35, 0.6)) * ramp(-shape.tpi[i], -1, 0.5)
    // only at the foot of the rock faces: a plain grassy flank keeps its grass, however steep (before, 13-33 %
    // scree on every slope over 10 deg left the flanks of a 300 m mountain grey from top to bottom)
    scree[i] = Math.min(1 - rock[i], clamp01(foot * ramp(near[i], 0.05, 0.3)))
  }
  return { rock, scree }
}

/** rock share of the land (h > 1 m), from a rock weight array */
export function rockShare(heights: ArrayLike<number>, rock: ArrayLike<number>): number {
  let s = 0, m = 0
  for (let i = 0; i < heights.length; i++) if (heights[i] > 1) { s += rock[i]; m++ }
  return m ? s / m : 0
}
