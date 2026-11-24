// Building pads: the ground under every placed building is flattened just under the lowest point of its
// footprint (Hexfrogger: "flatten under each building just below the lowest point", the DEM does not compensate
// the buildings). Footprint + margin flat, then a smoothstep falloff back to the natural ground. Sizes are
// relative to the building, never to the map. Overlapping pads (a village street) blend without spikes.
import type { Grid } from './island'

export const PAD = {
  margin: 1.5, // m flat around the footprint
  under: 0.1, // m: pad just under the lowest footprint point
  maxBuried: 0.3, // m: no footprint point more than this above the pad (steep lots: the pad rises)
  falloffMin: 6, falloffMax: 10, // m, smoothstep bank back to the natural ground
  groupSpan: 1.5, // m: max spread of the own levels of the pads merged into one platform
  bankGrade: 0.35,
  laneGrade: 0.15, // bank grade when a settlement lane (not carved, it drapes the relief) crosses the bank // bank grade (~19 deg, natural slope comes on top) the falloff is stretched to on a cut / fill
}

interface Pad { cx: number; cz: number; ux: number; uz: number; hw: number; hd: number; h: number; lo: number; hi: number; core: number; fall: number }

const smooth = (u: number) => { const v = Math.min(1, Math.max(0, u)); return v * v * (3 - 2 * v) }

/** bilinear height (grid origin at g.minX / g.minZ) */
function sample(h: number[], g: Grid, x: number, z: number) {
  const gx = Math.min(Math.max((x - g.minX) / g.step, 0), g.cols - 1.001), gz = Math.min(Math.max((z - g.minZ) / g.step, 0), g.rows - 1.001)
  const c = Math.floor(gx), r = Math.floor(gz), fx = gx - c, fz = gz - r, i = r * g.cols + c
  const a = h[i] + (h[i + 1] - h[i]) * fx, b = h[i + g.cols] + (h[i + g.cols + 1] - h[i + g.cols]) * fx
  return a + (b - a) * fz
}

/** oriented box of a 4-corner footprint [x, z] x 4 */
function boxOf(c: number[]) {
  const cx = (c[0] + c[2] + c[4] + c[6]) / 4, cz = (c[1] + c[3] + c[5] + c[7]) / 4
  const ex = c[2] - c[0], ez = c[3] - c[1], L = Math.hypot(ex, ez) || 1
  const ux = ex / L, uz = ez / L
  let hw = 0, hd = 0
  for (let k = 0; k < 8; k += 2) {
    const dx = c[k] - cx, dz = c[k + 1] - cz
    hw = Math.max(hw, Math.abs(dx * ux + dz * uz)); hd = Math.max(hd, Math.abs(-dx * uz + dz * ux))
  }
  return { cx, cz, ux, uz, hw, hd }
}

/** distance from (x, z) to the footprint box (0 inside) */
const boxDist = (p: Pad, x: number, z: number) => {
  const dx = x - p.cx, dz = z - p.cz
  const a = Math.max(0, Math.abs(dx * p.ux + dz * p.uz) - p.hw), b = Math.max(0, Math.abs(-dx * p.uz + dz * p.ux) - p.hd)
  return Math.hypot(a, b)
}

/** does a polyline [x, z, ...] pass within `d` of the footprint box? (sampled every 2 m) */
function laneNear(pts: number[], p: Pad, d: number) {
  for (let i = 0; i + 3 < pts.length; i += 2) {
    const ax = pts[i], az = pts[i + 1], bx = pts[i + 2], bz = pts[i + 3], n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 2))
    for (let k = 0; k <= n; k++) if (boxDist(p, ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n) < d) return true
  }
  return false
}

/** pad height of a footprint on the natural ground: just under its lowest point, but never burying any point
 *  by more than PAD.maxBuried */
export function padHeight(h: number[], g: Grid, b: ReturnType<typeof boxOf>) {
  const r = padRange(h, g, b)
  return Math.max(r.lo - PAD.under, r.hi - PAD.maxBuried)
}
/** lowest / highest natural ground over a footprint (5 x 5 samples) */
function padRange(h: number[], g: Grid, b: ReturnType<typeof boxOf>) {
  let lo = Infinity, hi = -Infinity
  const n = 4
  for (let i = 0; i <= n; i++) for (let j = 0; j <= n; j++) {
    const s = (i / n) * 2 - 1, t = (j / n) * 2 - 1
    const v = sample(h, g, b.cx + b.ux * b.hw * s - b.uz * b.hd * t, b.cz + b.uz * b.hw * s + b.ux * b.hd * t)
    lo = Math.min(lo, v); hi = Math.max(hi, v)
  }
  return { lo, hi }
}

/** flattens the pads of the footprints (flat [x, z] x 4 each) in place, all from the same ground */
export function applyPads(heights: number[], g: Grid, footprints: number[][], lanes: number[][] = []): PadField | null {
  const pads: Pad[] = []
  for (const c of footprints) {
    if (c.length < 8) continue
    const b = boxOf(c)
    if (!(b.hw > 0.2 && b.hd > 0.2)) continue
    // the flat core covers every grid node the footprint interpolates from (a diagonal cell); the bank is
    // relative to the building, but spans at least two cells (a one-cell bank is a cliff on a coarse grid)
    const core = Math.max(PAD.margin, g.step * 1.42)
    const fall = Math.max(2 * g.step, Math.min(PAD.falloffMax, Math.max(PAD.falloffMin, Math.max(b.hw, b.hd))))
    const rg = padRange(heights, g, b)
    pads.push({ ...b, h: 0, lo: rg.lo, hi: rg.hi, core, fall })
  }
  if (!pads.length) return null
  // pads whose flat cores touch (houses side by side in a street) share one level: one platform, no step
  // between two neighbours. Level of a group = the same rule over all its footprints
  const parent = pads.map((_, i) => i)
  const find = (i: number): number => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i] } return i }
  const rad = pads.map((p) => Math.hypot(p.hw, p.hd) + p.core)
  const order = pads.map((_, i) => i).sort((a, b) => pads[a].cx - pads[b].cx)
  const rmax = Math.max(...rad)
  // a group only spans PAD.groupSpan of own levels: a street climbing a slope is a series of terraces, not
  // one platform at the mean level (a 12 m fill at its low end, seed 21 TOWN_1)
  const ownLv = pads.map((p) => Math.max(p.lo - PAD.under, p.hi - PAD.maxBuried))
  const gLo = ownLv.slice(), gHi = ownLv.slice()
  for (let a = 0; a < order.length; a++) for (let b = a + 1; b < order.length; b++) {
    const i = order[a], j = order[b], P = pads[i], Q = pads[j]
    if (Q.cx - P.cx > rad[i] + rmax) break
    if (Math.hypot(Q.cx - P.cx, Q.cz - P.cz) >= rad[i] + rad[j]) continue
    const ri = find(i), rj = find(j)
    if (ri === rj) continue
    const lo = Math.min(gLo[ri], gLo[rj]), hi = Math.max(gHi[ri], gHi[rj])
    if (hi - lo > PAD.groupSpan) continue
    parent[ri] = rj; gLo[rj] = lo; gHi[rj] = hi
  }
  // group level: the footprint-weighted mean of the members' own levels (a street on a slope is cut on the
  // high side and filled on the low side, not lifted to its highest house)
  const sum = new Map<number, number>(), area = new Map<number, number>()
  pads.forEach((p, i) => {
    const r = find(i), a = p.hw * p.hd, own = Math.max(p.lo - PAD.under, p.hi - PAD.maxBuried)
    sum.set(r, (sum.get(r) ?? 0) + own * a); area.set(r, (area.get(r) ?? 0) + a)
  })
  pads.forEach((p, i) => {
    const r = find(i)
    p.h = sum.get(r)! / area.get(r)!
    // the bank is long enough for its cut / fill to stay gentle (smoothstep peak = 1.5 x drop / length)
    let drop = Math.max(Math.abs(p.h - p.lo), Math.abs(p.hi - p.h))
    // and the natural ground where the bank starts (edge of the flat core): a group level can sit well off it
    for (let a = 0; a < 16; a++) {
      const q = (a / 16) * Math.PI * 2, ex = Math.cos(q), ez = Math.sin(q)
      const m = Math.min(Math.abs(ex) > 1e-6 ? (p.hw + p.core) / Math.abs(ex) : Infinity, Math.abs(ez) > 1e-6 ? (p.hd + p.core) / Math.abs(ez) : Infinity)
      const x = p.cx + (p.ux * ex - p.uz * ez) * m, z = p.cz + (p.uz * ex + p.ux * ez) * m
      drop = Math.max(drop, Math.abs(p.h - sample(heights, g, x, z)))
    }
    p.fall = Math.max(p.fall, (1.5 * drop) / PAD.bankGrade)
    // a lane over the bank climbs it: stretched to PAD.laneGrade (seed 21 TOWN_1 LANE_S6, 12 m in 8 m)
    const laneFall = Math.max(p.fall, (1.5 * drop) / PAD.laneGrade)
    if (laneFall > p.fall && lanes.some((l) => laneNear(l, p, p.core + laneFall))) p.fall = laneFall
  })
  // per node: inside a flat core the level of its group; in the banks, a weighted blend of the pad levels,
  // mixed with the ground by the strongest weight
  const W = new Float32Array(heights.length), S = new Float32Array(heights.length), SW = new Float32Array(heights.length)
  const foot = new Uint8Array(heights.length)
  const own = new Float32Array(heights.length).fill(NaN), ownD = new Float32Array(heights.length).fill(Infinity)
  for (const p of pads) {
    const R = Math.max(p.hw, p.hd) + p.core + p.fall
    const c0 = Math.max(0, Math.floor((p.cx - R - g.minX) / g.step)), c1 = Math.min(g.cols - 1, Math.ceil((p.cx + R - g.minX) / g.step))
    const r0 = Math.max(0, Math.floor((p.cz - R - g.minZ) / g.step)), r1 = Math.min(g.rows - 1, Math.ceil((p.cz + R - g.minZ) / g.step))
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
      const k = r * g.cols + c
      if (heights[k] <= 0) continue // the sea stays the sea
      const d = boxDist(p, g.minX + c * g.step, g.minZ + r * g.step)
      if (d <= PAD.margin) foot[k] = 1 // a node the building itself stands on
      if (d <= p.core) { if (d < ownD[k]) { ownD[k] = d; own[k] = p.h } continue }
      const w = 1 - smooth((d - p.core) / p.fall)
      if (w <= 0) continue
      W[k] = Math.max(W[k], w); S[k] += w * p.h; SW[k] += w
    }
  }
  const field: PadField = { own, foot, W, level: S.map((v, k) => (SW[k] > 0 ? v / SW[k] : 0)) }
  layPads(heights, field)
  return field
}

/** pad levels per grid node: `own` flat core level (NaN outside), `W` / `level` bank weight and blended level */
export interface PadField { own: Float32Array; foot?: Uint8Array; W: Float32Array; level: Float32Array }
//! lays the pads on the relief (again, e.g. after the road beds and their embankments). `bed` (road bed
//! weights): the carriageway core (>= 0.99) keeps the road, the flat cores win elsewhere, the banks fade by the bed ramp
export function layPads(heights: number[], f: PadField, bed?: Float32Array) {
  for (let k = 0; k < heights.length; k++) {
    const keep = bed ? Math.min(1, bed[k]) : 0
    if (keep >= 0.99) continue
    if (!Number.isNaN(f.own[k])) heights[k] = f.own[k] // the flat core wins over the bed ramp
    else if (f.W[k] > 0) heights[k] += (f.level[k] - heights[k]) * f.W[k] * (1 - keep)
  }
}

//! settlement lanes are not carved (they drape the relief): where a pad bank, a road ramp or a fill makes them
//! climb faster than `maxGrade`, the ground along the lane is reshaped (fill or cut) to the nearest profile of
//! that grade between its anchors: the ground under the buildings and the carriageways are never moved.
//! Seed 21 TOWN_1 LANE_S6 climbed 12 m in 8 m up to the plateau of the houses.
export function gradeLanes(heights: number[], g: Grid, lanes: number[][], f?: PadField | null, bed?: Float32Array, maxGrade = 0.1) {
  // the nodes a building stands on and the carriageways never move; the rest of a flat core (its margin) may
  const fixed = (k: number) => heights[k] <= 0 || (!!f && (f.foot ? f.foot[k] === 1 : !Number.isNaN(f.own[k]))) || (!!bed && bed[k] >= 0.99)
  for (let pass = 0; pass < 6; pass++) for (const l of lanes) {
    if (l.length < 4) continue
    const xs: number[] = [], zs: number[] = [], s: number[] = []
    for (let i = 0; i + 3 < l.length; i += 2) {
      const ax = l[i], az = l[i + 1], bx = l[i + 2], bz = l[i + 3], n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 2))
      for (let k = i ? 1 : 0; k <= n; k++) {
        const x = ax + ((bx - ax) * k) / n, z = az + ((bz - az) * k) / n
        s.push(xs.length ? s[s.length - 1] + Math.hypot(x - xs[xs.length - 1], z - zs[zs.length - 1]) : 0); xs.push(x); zs.push(z)
      }
    }
    const m = xs.length, H = xs.map((x, i) => sample(heights, g, x, zs[i]))
    // a sample is an anchor when its nearest grid node cannot move (under a building, on a carriageway)
    const anchor = xs.map((x, i) => {
      const k = Math.round((zs[i] - g.minZ) / g.step) * g.cols + Math.round((x - g.minX) / g.step)
      return k >= 0 && k < heights.length && fixed(k)
    })
    // envelopes of the anchors: a free point stays within maxGrade of every anchor
    const up = new Array(m).fill(Infinity), lo = new Array(m).fill(-Infinity)
    let a = -1
    for (let i = 0; i < m; i++) { if (anchor[i]) a = i; if (a >= 0) { up[i] = Math.min(up[i], H[a] + maxGrade * (s[i] - s[a])); lo[i] = Math.max(lo[i], H[a] - maxGrade * (s[i] - s[a])) } }
    a = -1
    for (let i = m - 1; i >= 0; i--) { if (anchor[i]) a = i; if (a >= 0) { up[i] = Math.min(up[i], H[a] + maxGrade * (s[a] - s[i])); lo[i] = Math.max(lo[i], H[a] - maxGrade * (s[a] - s[i])) } }
    const T = H.map((h, i) => Math.min(up[i], Math.max(lo[i], h)))
    // within the band the ground may still be steep locally: grade-limited both ways on the free points
    for (let i = 1; i < m; i++) if (!anchor[i]) { const d = maxGrade * (s[i] - s[i - 1]); T[i] = Math.min(T[i - 1] + d, Math.max(T[i - 1] - d, T[i])) }
    for (let i = m - 2; i >= 0; i--) if (!anchor[i]) { const d = maxGrade * (s[i + 1] - s[i]); T[i] = Math.min(T[i + 1] + d, Math.max(T[i + 1] - d, T[i])) }
    // two anchors too steep for maxGrade (a road junction just under a pad): the straight ramp between them,
    // the gentlest there is
    let prev = -1
    for (let i = 0; i < m; i++) {
      if (!anchor[i]) continue
      if (prev >= 0 && i - prev > 1 && Math.abs(H[i] - H[prev]) > maxGrade * (s[i] - s[prev]))
        for (let j = prev + 1; j < i; j++) T[j] = H[prev] + ((H[i] - H[prev]) * (s[j] - s[prev])) / (s[i] - s[prev])
      prev = i
    }
    const R = 14, best = new Map<number, [number, number]>()
    for (let i = 0; i < m; i++) {
      const c0 = Math.floor((xs[i] - R - g.minX) / g.step), r0 = Math.floor((zs[i] - R - g.minZ) / g.step), n = Math.ceil((2 * R) / g.step) + 1
      for (let r = r0; r <= r0 + n; r++) for (let c = c0; c <= c0 + n; c++) {
        if (r < 0 || c < 0 || r >= g.rows || c >= g.cols) continue
        const d = Math.hypot(g.minX + c * g.step - xs[i], g.minZ + r * g.step - zs[i]), k = r * g.cols + c
        if (d > R) continue
        const b = best.get(k); if (!b || d < b[0]) best.set(k, [d, T[i]])
      }
    }
    for (const [k, [d, t]] of best) {
      if (fixed(k)) continue
      const w = d <= 7 ? 1 : 1 - smooth((d - 7) / (R - 7))
      heights[k] += (t - heights[k]) * w
    }
  }
}
