// Noise berms (merlons antibruit): where a big road (motorway, wide asphalt) passes the edge of a town, an earth
// bank runs along it on the side of the houses, as on European ring roads. Usual shape (DEAL / Cerema guides):
// 3-5 m high, slopes about 1:1.5, a 1-2 m crest, set a few metres past the road shoulder. Only raises the ground;
// never touches a road bed, open water or the ground right around a house. Ends ease out over ~40 m.
import type { Grid } from './island'
import { ROAD_TYPES, centreLine, type Road } from './roads'

export const BERM_ROADS = new Set(['motorway', 'asphalt', 'asphaltLine'])
export interface BermOpts { height?: number; slope?: number; crest?: number; gap?: number; townReach?: number; houseClear?: number; lanes?: number[][]; laneClear?: number }

/** raises noise berms in place; returns the number of cells raised */
export function noiseBerms(heights: number[], grid: Grid, roads: Road[], houses: { x: number; z: number }[], bedWeight?: Float32Array, wet?: Uint8Array, o: BermOpts = {}): number {
  const { cols, rows, step } = grid
  // the relief grid is coarse (8 m on a generated world): a 14 m bank covers one or two cells and turns into a
  // staircase of bumps along a slanted road (seen in the Workbench, seed 21). Slopes span >= 1.5 cells, crest >= 1
  const H = o.height ?? 4, run = Math.max(H * (o.slope ?? 1.5), 1.5 * step), crest = Math.max(o.crest ?? 2, step), gap = o.gap ?? 4
  const reachTown = o.townReach ?? 150, clear = o.houseClear ?? 10
  const base = 2 * run + crest
  if (!houses.length) return 0
  const B = 50, bucket = new Map<number, { x: number; z: number }[]>(), key = (x: number, z: number) => Math.floor(x / B) * 100003 + Math.floor(z / B)
  for (const h of houses) { const k = key(h.x, h.z); let a = bucket.get(k); if (!a) bucket.set(k, (a = [])); a.push(h) }
  const near = (x: number, z: number, d: number, f: (h: { x: number; z: number }) => boolean = () => true) => {
    const n = Math.ceil(d / B)
    for (let i = -n; i <= n; i++) for (let j = -n; j <= n; j++) {
      const a = bucket.get(key(x + i * B, z + j * B))
      if (a) for (const h of a) if (Math.hypot(h.x - x, h.z - z) < d && f(h)) return true
    }
    return false
  }
  const raise = new Float32Array(heights.length)
  for (const road of roads) {
    if (!BERM_ROADS.has(road.type) || road.bridge) continue
    const T = ROAD_TYPES[road.type]
    const off = (road.width && road.width > 0 ? road.width / 2 : T.half) + T.edge + (T.shoulder ?? 0) + gap
    const line = centreLine(road.pts, 10), m = line.length / 2
    if (m < 3) continue
    // per point and side (+1 left, -1 right): houses on that side, beyond the berm, within reach of the town
    const amp = [new Float32Array(m), new Float32Array(m)]
    const s = new Float32Array(m), street = new Uint8Array(m)
    for (let i = 1; i < m; i++) s[i] = s[i - 1] + Math.hypot(line[i * 2] - line[i * 2 - 2], line[i * 2 + 1] - line[i * 2 - 1])
    for (let i = 0; i < m; i++) {
      const a = Math.max(0, i - 1), b = Math.min(m - 1, i + 1)
      const dx = line[b * 2] - line[a * 2], dz = line[b * 2 + 1] - line[a * 2 + 1], L = Math.hypot(dx, dz) || 1
      const x = line[i * 2], z = line[i * 2 + 1]
      // a street through the town (houses right on it) is no bypass: no berm there
      if (near(x, z, off + base)) { street[i] = 1; continue }
      for (let sd = 0; sd < 2; sd++) {
        const sign = sd ? -1 : 1
        amp[sd][i] = near(x, z, reachTown, (h) => {
          const cross = (dx * (h.z - z) - dz * (h.x - x)) / L
          return cross * sign > off + base
        }) ? 1 : 0
      }
    }
    // one continuous bank: gaps under 120 m between served points are filled (a house set back, a side road
    // already skipped by the bed test), else the bank breaks into a row of bumps (seen in the Workbench, seed 21)
    for (const A of amp) {
      let last = -1
      for (let i = 0; i < m; i++) if (A[i]) { if (last >= 0 && i - last > 1 && s[i] - s[last] < 120) for (let j = last + 1; j < i; j++) if (!street[j]) A[j] = 1; last = i }
    }
    // ease the ends: amplitude falls linearly to 0 over 40 m from the last served point
    const EASE = 40
    for (const A of amp) {
      const src = A.slice()
      for (let i = 0; i < m; i++) {
        if (src[i]) continue
        let best = 0
        for (let j = i - 1; j >= 0 && s[i] - s[j] < EASE; j--) if (src[j]) { best = Math.max(best, 1 - (s[i] - s[j]) / EASE); break }
        for (let j = i + 1; j < m && s[j] - s[i] < EASE; j++) if (src[j]) { best = Math.max(best, 1 - (s[j] - s[i]) / EASE); break }
        A[i] = best
      }
    }
    const reach = off + base
    for (let i = 0; i < m - 1; i++) {
      if (!amp[0][i] && !amp[0][i + 1] && !amp[1][i] && !amp[1][i + 1]) continue
      const ax = line[i * 2], az = line[i * 2 + 1], bx = line[i * 2 + 2], bz = line[i * 2 + 3]
      const dx = bx - ax, dz = bz - az, len2 = dx * dx + dz * dz || 1, L = Math.sqrt(len2)
      const c0 = Math.max(0, Math.floor((Math.min(ax, bx) - reach) / step)), c1 = Math.min(cols - 1, Math.ceil((Math.max(ax, bx) + reach) / step))
      const r0 = Math.max(0, Math.floor((Math.min(az, bz) - reach) / step)), r1 = Math.min(rows - 1, Math.ceil((Math.max(az, bz) + reach) / step))
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
        const x = c * step, z = r * step
        const t = ((x - ax) * dx + (z - az) * dz) / len2
        if (t < 0 || t > 1) continue
        const cross = (dx * (z - az) - dz * (x - ax)) / L
        const A = cross >= 0 ? amp[0] : amp[1]
        const w = A[i] + (A[i + 1] - A[i]) * t
        if (!w) continue
        const u = Math.abs(cross) - off
        if (u <= 0 || u >= base) continue
        const lin = Math.min(1, u / run, (base - u) / run)
        const h = H * w * (0.5 - 0.5 * Math.cos(Math.PI * lin)) // rounded shoulders, no sharp edge on the grid
        const k = r * cols + c
        if (h > raise[k]) raise[k] = h
      }
    }
  }
  // a settlement lane crossing the berm band keeps its ground (lanes are not carved: it would climb the 4 m bank,
  // seed 21 TOWN_1 LANE_S6): a gap of laneClear on each side of it
  let laneCut: Uint8Array | null = null
  if (o.lanes?.length) {
    laneCut = new Uint8Array(heights.length)
    const lc = o.laneClear ?? run + 4, rc = Math.ceil(lc / step)
    for (const l of o.lanes) for (let i = 0; i + 3 < l.length; i += 2) {
      const ax = l[i], az = l[i + 1], bx = l[i + 2], bz = l[i + 3], n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 2))
      for (let q = 0; q <= n; q++) {
        const x = ax + ((bx - ax) * q) / n, z = az + ((bz - az) * q) / n, c0 = Math.round(x / step), r0 = Math.round(z / step)
        for (let r = r0 - rc; r <= r0 + rc; r++) for (let c = c0 - rc; c <= c0 + rc; c++) {
          if (r < 0 || c < 0 || r >= rows || c >= cols) continue
          if (Math.hypot(c * step - x, r * step - z) <= lc) laneCut[r * cols + c] = 1
        }
      }
    }
  }
  let n = 0
  for (let k = 0; k < heights.length; k++) {
    if (!(raise[k] > 0.05)) continue
    if (bedWeight && bedWeight[k] >= 0.99) continue // the bed itself; its side ramp may carry the berm foot
    if (wet && wet[k]) continue
    const c = k % cols, r = (k - c) / cols
    if (near(c * step, r * step, clear)) continue
    if (laneCut && laneCut[k]) continue
    heights[k] += raise[k]; n++
  }
  return n
}
