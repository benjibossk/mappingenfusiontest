// "Gaea-like" relief passes for the procedural island (plan in docs/GAEA_STUDY.md, steps 1, 2, 4, 5).
// Original implementation, no third-party code:
//   1. ridged multifractal (Musgrave-style weighting) added on the land, sharper crests;
//   2. stream power fluvial erosion (streamPower.ts) for dendritic valleys;
//   4. thermal pass: material above the talus angle slides to lower neighbours (scree at the foot);
//   5. flow / wear / deposits masks, 0..1 per vertex, read by computeSurfaces.
import { noise2 } from './island'
import { streamPowerErode } from './streamPower'

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
}

/** The whole eroded pipeline on a classic island height grid (land > 0), in place. */
export function erodeIsland(heights: number[], cols: number, rows: number, step: number, o: ErodedOptions): ReliefMasks {
  const N = cols * rows
  // 1. ridges, warped by a low-frequency noise, stronger inland and up high (coasts keep their shape)
  const rid = ridged(o.seed * 31 + 7, 5)
  const warp = noise2(o.seed * 17 + 3, 2)
  const wr = o.ridges ?? 0.45
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const i = r * cols + c, h = heights[i]
    if (h <= 1) continue
    const x = (c * step) / 900, z = (r * step) / 900
    const wx = x + (warp(x * 0.7, z * 0.7) - 0.5) * 0.8, wz = z + (warp(z * 0.7 + 5, x * 0.7) - 0.5) * 0.8
    const up = Math.min(1, h / (o.maxHeight * 0.35))
    const g = rid(wx, wz)
    heights[i] = h * (1 - wr * up) + h * wr * up * (0.35 + 1.3 * g)
  }
  // 2. stream power: valleys from the drained area (outlets = sea and border)
  const sp = streamPowerErode(heights, { cols, rows, step }, {
    sea: 0, k: o.k ?? 1.2e-5, m: 0.5, dt: o.dt ?? 2000, iterations: o.iterations ?? 8,
  })
  // 4. thermal: talus slopes, scree at the foot
  const th = thermalErode(heights, cols, rows, step, { talusDeg: o.talusDeg ?? 34, iterations: 12, sea: 0 })
  // 5. masks
  const wear = new Float32Array(N), deposits = new Float32Array(N)
  normalize(th.removed); normalize(th.added)
  for (let i = 0; i < N; i++) {
    wear[i] = sp.wear[i] + th.removed[i]
    deposits[i] = sp.deposits[i] + th.added[i]
  }
  return { flow: sp.flow, wear: normalize(wear), deposits: normalize(deposits) }
}
