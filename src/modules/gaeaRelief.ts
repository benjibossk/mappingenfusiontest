// "Gaea-like" relief passes for the procedural island (plan in docs/GAEA_STUDY.md, steps 1, 2, 4, 5).
// Original implementation, no third-party code:
//   1. ridged multifractal (Musgrave-style weighting) added on the land, sharper crests;
//   2. stream power fluvial erosion (streamPower.ts) for dendritic valleys;
//   4. thermal pass: material above the talus angle slides to lower neighbours (scree at the foot);
//   5. flow / wear / deposits masks, 0..1 per vertex, read by computeSurfaces.
import { noise2 } from './island'
import { streamPowerErode } from './streamPower'
import { dropletErode } from './droplets'

export interface ReliefMasks {
  flow: Float32Array
  wear: Float32Array
  deposits: Float32Array
}

/** ridged multifractal, 0..1: crests where the base noise crosses its mid value */
export function ridged(seed: number, octaves = 5) {
  const layers = Array.from({ length: octaves }, (_, o) => noise2(seed + 101 * (o + 1), 1))
  return (x: number, z: number) => {
    let v = 0, amp = 0.5, weight = 1, norm = 0, px = x, pz = z
    for (let o = 0; o < octaves; o++, amp *= 0.5) {
      let s = 1 - Math.abs(layers[o](px, pz) * 2 - 1)
      s *= s * weight
      weight = Math.min(1, Math.max(0, s * 2))
      v += s * amp
      norm += amp
      const nx = (px * 0.8 - pz * 0.6) * 2.03, nz = (px * 0.6 + pz * 0.8) * 2.03
      px = nx; pz = nz
    }
    return v / norm
  }
}

export interface ThermalOptions {
  /** talus angle in degrees: steeper slopes shed material. Default 34. */
  talusDeg?: number
  /** iterations. Default 12. */
  iterations?: number
  /** share of the excess moved per iteration (0..0.5). Default 0.4. */
  rate?: number
  /** cells at or below this height do not move. Default 0. */
  sea?: number
}

const NX = [1, -1, 0, 0, 1, 1, -1, -1]
const NZ = [0, 0, 1, -1, 1, -1, 1, -1]
const ND = [1, 1, 1, 1, Math.SQRT2, Math.SQRT2, Math.SQRT2, Math.SQRT2]

/** Thermal weathering in place (Jacobi update, no direction bias). Returns per-cell height removed and added. */
export function thermalErode(heights: number[] | Float32Array, cols: number, rows: number, step: number, opts: ThermalOptions = {}) {
  const N = cols * rows
  const talus = Math.tan(((opts.talusDeg ?? 34) * Math.PI) / 180) * step
  const iters = Math.max(0, Math.floor(opts.iterations ?? 12))
  const rate = Math.min(0.5, Math.max(0, opts.rate ?? 0.4))
  const sea = opts.sea ?? 0
  const removed = new Float32Array(N), added = new Float32Array(N)
  const delta = new Float32Array(N)
  const ex = new Float32Array(8)
  for (let it = 0; it < iters; it++) {
    delta.fill(0)
    let moved = 0
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const i = r * cols + c, h = heights[i]
      if (h <= sea) continue
      let sum = 0, maxEx = 0
      for (let k = 0; k < 8; k++) {
        const cc = c + NX[k], rr = r + NZ[k]
        ex[k] = 0
        if (cc < 0 || rr < 0 || cc >= cols || rr >= rows) continue
        const d = h - heights[rr * cols + cc] - talus * ND[k]
        if (d > 0) { ex[k] = d; sum += d; if (d > maxEx) maxEx = d }
      }
      if (sum <= 0) continue
      // move enough to bring the steepest neighbour back towards the talus, spread by excess share;
      // /8 keeps the Jacobi step stable when several cells shed onto the same one
      const out = (rate * maxEx) / 2
      for (let k = 0; k < 8; k++) if (ex[k] > 0) delta[(r + NZ[k]) * cols + c + NX[k]] += (out * ex[k]) / sum
      delta[i] -= out
      moved += out
    }
    for (let i = 0; i < N; i++) {
      const d = delta[i]
      if (d === 0) continue
      heights[i] += d
      if (d < 0) removed[i] -= d
      else added[i] += d
    }
    if (moved < 1e-3) break
  }
  return { removed, added }
}

function normalize(a: Float32Array): Float32Array {
  // 99th percentile scale so one outlier does not flatten the whole mask
  const s = Array.from(a).filter((v) => v > 0).sort((x, y) => x - y)
  const top = s.length ? s[Math.floor(s.length * 0.99)] || s[s.length - 1] : 0
  if (top > 0) for (let i = 0; i < a.length; i++) a[i] = Math.min(1, a[i] / top)
  return a
}

export interface ErodedOptions {
  seed: number
  maxHeight: number
  roughness: number
  /** ridge weight 0..1. Default 0.45. */
  ridges?: number
  /** stream power erodibility. Default 1.2e-5 (8 m grid). */
  k?: number
  iterations?: number
  dt?: number
  talusDeg?: number
  /** uplift (m per unit time) during the stream power. Default 0 (hills), 4e-3 x dt-scaled for mountains. */
  uplift?: number
  /** drops per land cell for the gully pass (droplets.ts). Default 0.7, 0 = off. */
  droplets?: number
  /** 'mountains': the interior is lifted so the top reaches maxHeight (base relief built on <= 160 m) */
  mountains?: boolean
}

/** The whole eroded pipeline on a classic island height grid (land > 0), in place. */
/** base relief height of a 'mountains' island before its interior is lifted (island.ts builds on it) */
export const mountainBase = (maxHeight: number) => Math.min(maxHeight, 160)

export function erodeIsland(heights: number[], cols: number, rows: number, step: number, o: ErodedOptions): ReliefMasks {
  const N = cols * rows
  const base = o.mountains ? mountainBase(o.maxHeight) : o.maxHeight
  // 0. mountains: lift the high interior (lowlands, coasts and their towns stay as in 'eroded')
  if (o.mountains && o.maxHeight > base) {
    const lift = o.maxHeight - base, mn = noise2(o.seed * 13 + 5, 2), add = new Float32Array(N)
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const i = r * cols + c, h = heights[i]
      if (h <= 1) continue
      const t = Math.min(1, Math.max(0, (h / base - 0.3) / 0.7))
      // a massif noise so the lift makes several summits, not one dome
      const m = 0.35 + 0.9 * mn((c * step) / 2200, (r * step) / 2200)
      add[i] = lift * t * t * (3 - 2 * t) * m
    }
    // whatever the massif noise drew under the top, the summit reaches maxHeight (the ridges then add ~15-25 %)
    let best = 0.4 // at most x2.5
    for (let i = 0; i < N; i++) if (add[i] > 0) best = Math.max(best, add[i] / Math.max(1, o.maxHeight * 0.9 - heights[i]))
    for (let i = 0; i < N; i++) if (add[i] > 0) heights[i] += add[i] / best
  }
  const top = o.maxHeight
  // 1. ridges, warped by a low-frequency noise, stronger inland and up high (coasts keep their shape)
  const rid = ridged(o.seed * 31 + 7, 5)
  const warp = noise2(o.seed * 17 + 3, 2)
  const wr = o.ridges ?? (o.mountains ? 0.6 : 0.45)
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const i = r * cols + c, h = heights[i]
    if (h <= 1) continue
    const x = (c * step) / 900, z = (r * step) / 900
    const wx = x + (warp(x * 0.7, z * 0.7) - 0.5) * 0.8, wz = z + (warp(z * 0.7 + 5, x * 0.7) - 0.5) * 0.8
    const up = Math.min(1, h / (top * 0.35))
    const g = rid(wx, wz)
    heights[i] = h * (1 - wr * up) + h * wr * up * (0.35 + 1.3 * g)
  }
  // 2. stream power: valleys from the drained area (outlets = sea and border). K scaled on the relief:
  //    the same channel steepness on a 140 m or a 400 m island (K A^m dt / L ~ constant incision share)
  const relief = Math.max(60, top)
  const sp = streamPowerErode(heights, { cols, rows, step }, {
    sea: 0, k: o.k ?? K_SP * (relief / 140), m: 0.5, dt: o.dt ?? DT_SP, iterations: o.iterations ?? IT_SP,
    uplift: o.uplift ?? (o.mountains ? UPLIFT_SP : 0),
  })
  // 3. droplets: fine parallel gullies down the flanks
  const dr = (o.droplets ?? DROPS) > 0
    ? dropletErode(heights, cols, rows, step, { seed: o.seed * 7 + 11, density: o.droplets ?? DROPS, sea: 0, ...DROP_OPTS })
    : undefined
  // 4. thermal: soften only (high talus, few passes) so the gullies survive; scree at the foot
  const th = thermalErode(heights, cols, rows, step, { talusDeg: o.talusDeg ?? TALUS, iterations: TH_IT, rate: 0.3, sea: 0 })
  // 5. masks
  const wear = new Float32Array(N), deposits = new Float32Array(N)
  normalize(th.removed); normalize(th.added)
  if (dr) { normalize(dr.wear); normalize(dr.deposits) }
  for (let i = 0; i < N; i++) {
    wear[i] = sp.wear[i] + th.removed[i] + (dr ? dr.wear[i] : 0)
    deposits[i] = sp.deposits[i] + th.added[i] + (dr ? dr.deposits[i] : 0)
  }
  return { flow: sp.flow, wear: normalize(wear), deposits: normalize(deposits) }
}

// tuned on seed 21 (4 km, 8 m cells), Playwright close-ups in the 3D view
const K_SP = 1.2e-5, DT_SP = 2500, IT_SP = 12, UPLIFT_SP = 0
const DROPS = 1.5
const DROP_OPTS = { minSlope: 0.01, capacity: 8, erosion: 0.5, deposition: 0.05, maxCut: 1.5, radius: 1.6, inertia: 0.3, maxSteps: 64, startSlope: 0.1 }
const TALUS = 42, TH_IT = 4
