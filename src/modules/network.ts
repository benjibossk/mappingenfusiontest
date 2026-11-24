// Automatic road network on the island grid.
// 1. sites: flat land, near water, spaced out (best score first)
// 2. growth: the biggest sites are joined first (asphalt), then every other site is linked to the
//    nearest part of the network (dirt); a link that reaches an existing road makes a T junction
// 3. each link is routed with A* over the heights: slope costs, sea is forbidden, rivers are crossed
//    rarely, cells already on a road are cheaper so roads share corridors instead of running side by side
import type { Grid } from './island'
import { carveRoads, centreLine, type Road, type RoadType } from './roads'
import { weldRoads } from './roadgraph'
import { rMinOf } from './roadgraph-classes'
import { smoothRoad } from './roadgeom'
import { riverCrossCost } from './bridges'

export type SiteKind = 'town' | 'village' | 'hamlet'
export interface Site { id: string; x: number; z: number; kind: SiteKind }
//! settlement footprint radius (m), also the distance under which a road already serves it
export const SITE_RADIUS: Record<SiteKind, number> = { town: 250, village: 120, hamlet: 50 }
// steepest grade a vehicle copes with, by road family (shared with the pre-send check in validate.ts)
const MAX_GRADE: Partial<Record<RoadType, number>> = { dirt: 0.2, dirt2: 0.2, forest: 0.22, trailDirt: 0.3, trailGravel: 0.3, trailForest: 0.3, coal: 0.2, trailCoal: 0.3, concretePath: 0.3, motorway: 0.06 }
// trial carves of the router: no hairpin platforms (they would shift the routes it already validated)
const NOPIN = { pins: false }
export const maxGrade = (t: RoadType) => MAX_GRADE[t] ?? 0.12
/** grade a road is laid under when the relief allows it (mountain pass design): paved 10 %, tracks 15 %,
 *  trails their hard limit. The network router tries this first, maxGrade only as a fallback. */
export const comfortGrade = (t: RoadType) => Math.min(maxGrade(t), maxGrade(t) >= 0.25 ? maxGrade(t) : maxGrade(t) > 0.12 ? 0.15 : 0.1)
/** steepest grade along a road, over 20 m steps (the grid is coarse: shorter steps only measure noise).
 *  The pre-send check (validate.ts) uses this same measure. */
export function worstGrade(pts: number[], h: ArrayLike<number>, g: Grid, spans?: { from: number; to: number }[]): { grade: number; x: number; z: number } {
  const at = (x: number, z: number) => {
    const c = Math.min(g.cols - 1, Math.max(0, Math.round((x - g.minX) / g.step))), r = Math.min(g.rows - 1, Math.max(0, Math.round((z - g.minZ) / g.step)))
    return h[r * g.cols + c]
  }
  const line = centreLine(pts, 20)
  let grade = 0, x = 0, z = 0, acc = 0
  for (let i = 2; i + 1 < line.length; i += 2) {
    const d = Math.hypot(line[i] - line[i - 2], line[i + 1] - line[i - 1])
    acc += d
    // bridge decks (Road.spans, with 20 m of margin: the abutment step) are not on the ground
    if (spans?.some((sp) => acc > sp.from - 20 && acc - d < sp.to + 20)) continue
    if (d < 1) continue
    const gr = Math.abs(at(line[i], line[i + 1]) - at(line[i - 2], line[i - 1])) / d
    if (gr > grade) { grade = gr; x = (line[i] + line[i - 2]) / 2; z = (line[i + 1] + line[i - 1]) / 2 }
  }
  return { grade, x, z }
}
/** steepest grade of the road bed once carved: carveRoads lays the road on the terrain profile averaged over
 *  ~80 m (cut through the bumps, fill the dips), so the bed is gentler than the raw ground under it.
 *  Same 20 m measure as worstGrade, on that smoothed profile. */
export function bedGrade(pts: number[], h: ArrayLike<number>, g: Grid): number {
  const { cols, rows, step } = g
  const at = (x: number, z: number) => {
    const gx = Math.min(Math.max((x - g.minX) / step, 0), cols - 1.001), gz = Math.min(Math.max((z - g.minZ) / step, 0), rows - 1.001)
    const c = Math.floor(gx), r = Math.floor(gz), fx = gx - c, fz = gz - r, i = r * cols + c
    const a = h[i] + (h[i + 1] - h[i]) * fx, b = h[i + cols] + (h[i + cols + 1] - h[i + cols]) * fx
    return a + (b - a) * fz
  }
  const line = centreLine(pts, step / 2), m = line.length / 2
  if (m < 2) return 0
  const raw = Array.from({ length: m }, (_, i) => at(line[i * 2], line[i * 2 + 1]))
  const win = Math.max(1, Math.round(40 / (step / 2)))
  const pre = new Float64Array(m + 1)
  for (let i = 0; i < m; i++) pre[i + 1] = pre[i] + raw[i]
  const prof = raw.map((_, i) => {
    const a = Math.max(0, i - win), b = Math.min(m - 1, i + win)
    return Math.max(0.8, (pre[b + 1] - pre[a]) / (b - a + 1))
  })
  const k = Math.max(1, Math.round(20 / (step / 2)))
  let worst = 0
  for (let i = k; i < m; i++) {
    const d = Math.hypot(line[i * 2] - line[(i - k) * 2], line[i * 2 + 1] - line[(i - k) * 2 + 1])
    if (d > 5) worst = Math.max(worst, Math.abs(prof[i] - prof[i - k]) / d)
  }
  return worst
}
const ORDER: Record<SiteKind, number> = { town: 0, village: 1, hamlet: 2 }
export interface NetworkParams {
  progress?: (f: number) => void // 0..1 while the tree then the loops are routed (the busy bar)
  sites: number // how many places to link
  spacing: number // minimum distance between two sites (m)
  maxSlope: number // comfortable slope, in % (above: very expensive)
  main: RoadType // town <-> town
  minor: RoadType // village -> network
  lane: RoadType // hamlet -> network
  seed: number
  /** optional second pass: up to this many extra links (dirt by default) close a loop between two places whose
   *  road distance is more than `loopDetour` x their straight distance (a real network is a mesh, not a tree) */
  loops?: number
  loopDetour?: number // default 1.8
  loopMaxM?: number // longest straight distance tried (default 2 000 m)
  loopType?: RoadType // default p.minor
  /** Road network V2 finish (default true): roads that cross get a shared point (X junction) and corners are
   *  rounded into line + arc fillets (radius >= class Rmin when there is room), junction points kept exactly.
   *  A fillet is kept only when the carved road stays under its grade limit. false = the old output. */
  v2?: boolean
  /** 'mountains' relief: the pass router also runs when the usual search kept the wanted class but climbs steeper
   *  than its comfortable grade (lacets instead of a straight 12 % ramp), and a paved link tries lacets up to its
   *  hard limit before falling back to dirt (towns stay on the paved network). Off = the gentle maps unchanged. */
  mountains?: boolean
  /** zone footprints (bases, airfields, vanilla sites) no road may cross; a road still reaches its gate (the goal) */
  avoid?: { x: number; z: number; r: number }[]
}

const DIRS = [
  [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1],
  [2, 1], [2, -1], [-2, 1], [-2, -1], [1, 2], [1, -2], [-1, 2], [-1, -2], // knight moves: smoother angles
]

function rng(seed: number) {
  let s = seed >>> 0 || 1
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296)
}

//! slope (rise / run) at a cell, from its neighbours
function slopeAt(h: number[], g: Grid, c: number, r: number) {
  const at = (cc: number, rr: number) => h[Math.min(g.rows - 1, Math.max(0, rr)) * g.cols + Math.min(g.cols - 1, Math.max(0, cc))]
  const dx = (at(c + 1, r) - at(c - 1, r)) / (2 * g.step), dz = (at(c, r + 1) - at(c, r - 1)) / (2 * g.step)
  return Math.hypot(dx, dz)
}

export function pickSites(h: number[], g: Grid, river: Float32Array | undefined, p: NetworkParams): Site[] {
  const rand = rng(p.seed)
  const cand: { c: number; r: number; score: number }[] = []
  const stride = Math.max(1, Math.round(50 / g.step)) // one candidate every ~50 m
  for (let r = 2; r < g.rows - 2; r += stride)
    for (let c = 2; c < g.cols - 2; c += stride) {
      const i = r * g.cols + c
      if (h[i] <= 1.5) continue // sea and beach
      const s = slopeAt(h, g, c, r)
      if (s > 0.25) continue
      // water nearby (river or coast) within ~300 m is attractive, but not right on it
      let water = 0
      const R = Math.round(300 / g.step)
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * Math.PI * 2
        for (const f of [0.3, 0.6, 1]) {
          const cc = Math.round(c + Math.cos(a) * R * f), rr = Math.round(r + Math.sin(a) * R * f)
          if (cc < 0 || rr < 0 || cc >= g.cols || rr >= g.rows) continue
          const j = rr * g.cols + cc
          if (h[j] <= 0 || (river && river[j] > 0)) { water += 1 / f; break }
        }
      }
      const score = (1 - s / 0.25) * 2 + Math.min(water, 6) * 0.3 - h[i] / 400 + rand() * 0.8
      cand.push({ c, r, score })
    }
  cand.sort((a, b) => b.score - a.score)
  const out: Site[] = []
  for (const k of cand) {
    const x = g.minX + k.c * g.step, z = g.minZ + k.r * g.step
    if (out.some((s) => Math.hypot(s.x - x, s.z - z) < p.spacing)) continue
    out.push({ id: '', x, z, kind: 'hamlet' })
    if (out.length >= p.sites) break
  }
  // best sites become towns (~15 %), then villages (~35 %), the rest hamlets
  const towns = Math.max(1, Math.round(out.length * 0.15)), villages = Math.round(out.length * 0.35)
  out.forEach((s, i) => (s.kind = i < towns ? 'town' : i < towns + villages ? 'village' : 'hamlet'))
  // a place must sit wholly on dry land: shrink it (town -> village -> hamlet) until its radius is dry, else drop it
  const wet = (s: Site) => {
    const R = SITE_RADIUS[s.kind]
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2
      for (const f of [0.35, 0.7, 1]) {
        const c = Math.round((s.x + Math.cos(a) * R * f - g.minX) / g.step), r = Math.round((s.z + Math.sin(a) * R * f - g.minZ) / g.step)
        if (c < 0 || r < 0 || c >= g.cols || r >= g.rows || h[r * g.cols + c] <= 0.5) return true
      }
    }
    return false
  }
  const SMALLER: Record<SiteKind, SiteKind | null> = { town: 'village', village: 'hamlet', hamlet: null }
  for (let i = out.length - 1; i >= 0; i--) {
    let k: SiteKind | null = out[i].kind
    while (k && wet({ ...out[i], kind: k })) k = SMALLER[k]
    if (k) out[i].kind = k; else out.splice(i, 1)
  }
  if (out.length && !out.some((s) => s.kind === 'town')) out[0].kind = 'town'
  const count: Record<string, number> = {}
  out.forEach((s) => (s.id = `${s.kind.toUpperCase()}_${(count[s.kind] = (count[s.kind] ?? 0) + 1)}`))
  return out
}

// binary heap of cell indices keyed by cost
class Heap {
  private a: number[] = []
  private k: number[] = []
  get size() { return this.a.length }
  push(i: number, key: number) {
    const a = this.a, k = this.k
    let n = a.length
    a.push(i); k.push(key)
    while (n > 0) {
      const p = (n - 1) >> 1
      if (k[p] <= key) break
      a[n] = a[p]; k[n] = k[p]; n = p
    }
    a[n] = i; k[n] = key
  }
  pop() {
    const a = this.a, k = this.k
    const top = a[0], li = a.pop()!, lk = k.pop()!
    if (a.length) {
      let n = 0
      for (;;) {
        let m = n * 2 + 1
        if (m >= a.length) break
        if (m + 1 < a.length && k[m + 1] < k[m]) m++
        if (k[m] >= lk) break
        a[n] = a[m]; k[n] = k[m]; n = m
      }
      a[n] = li; k[n] = lk
    }
    return top
  }
}

// the 16 move directions sorted by heading, so neighbours in this list differ by ~22-27 degrees
const HEAD = DIRS.map(([dc, dr]) => Math.atan2(dr, dc))
const DIR_ORDER = DIRS.map((_, k) => k).sort((a, b) => HEAD[a] - HEAD[b])
const RANK = DIR_ORDER.map((_, k) => DIR_ORDER.indexOf(k))

// mountain-pass move set (ROAD_MOUNTAIN): the 16 moves plus (3,1), (4,1), (3,2) families = 40 headings
// (~8-14 degrees apart). On a uniform 40 % flank the 16 moves only offer 0, 18 or 28 % grades; (4,1) climbs it
// at 9.7 % and (3,1) at 12.6 %, so a 10 % asphalt traverse exists. A step may turn by up to 27.5 degrees.
const FINE: number[][] = (() => {
  const out = DIRS.map((d) => d.slice())
  for (const [a, b] of [[3, 1], [4, 1], [3, 2]]) for (const [x, y] of [[a, b], [b, a]]) for (const sx of [1, -1]) for (const sy of [1, -1]) out.push([x * sx, y * sy])
  return out
})()
const turnOk = (dirs: number[][], lim: number) => {
  const hd = dirs.map(([dc, dr]) => Math.atan2(dr, dc))
  return dirs.map((_, a) => dirs.map((__, b) => Math.abs(Math.atan2(Math.sin(hd[b] - hd[a]), Math.cos(hd[b] - hd[a]))) <= lim))
}
const FINE_TURN = turnOk(FINE, (27.5 * Math.PI) / 180)

// hairpin of the fine router: legs 2 * PIN_CELLS cells apart (4 cells of 8 m = radius 16 m on the centre line)
const PIN_CELLS = 4, PIN_LEG = 6
//! the cells of a hairpin's half circle from (c, r) heading (ux, uz), turning towards (nx, nz), ends excluded:
//! centre PIN_CELLS / 2 aside, the arc bulges forward by the radius
function pinArc(c: number, r: number, ux: number, uz: number, nx: number, nz: number): [number, number][] {
  const R = PIN_CELLS / 2, ox = c + nx * R, oz = r + nz * R, out: [number, number][] = []
  for (let k = 1; k < 6; k++) {
    const t = (Math.PI * k) / 6
    out.push([Math.round(ox - nx * R * Math.cos(t) + ux * R * Math.sin(t)), Math.round(oz - nz * R * Math.cos(t) + uz * R * Math.sin(t))])
  }
  return out
}

//! A* from `from` to any cell of `goal`; returns the cell path or null.
//! The state is (cell, heading): a step may turn by one heading notch at most (~25 degrees), which
//! keeps hairpins wide enough for the road generator; cliffs beside the road and the coast cost extra.
//! fine: the 40-heading mountain move set (long moves check every cell they pass over)
function route(h: number[], g: Grid, river: Float32Array | undefined, onRoad: Uint8Array, from: number, goal: Set<number>, goalXY: [number, number], maxSlope: number, hardGrade = Infinity, block?: Uint8Array, fine = false, pinCost = 120): number[] | null {
  const MV = fine ? FINE : DIRS
  const n = g.cols * g.rows, D = MV.length
  const cost = new Float32Array(n * D).fill(Infinity)
  const prev = new Int32Array(n * D).fill(-1)
  const pinAt = new Int8Array(fine ? n * D : 0) // state reached by a hairpin: its side (+1 / -1)
  const heap = new Heap()
  const gc = (goalXY[0] - g.minX) / g.step, gr = (goalXY[1] - g.minZ) / g.step
  const heur = (i: number) => Math.hypot((i % g.cols) - gc, Math.floor(i / g.cols) - gr) * g.step * 0.3
  const at = (c: number, r: number) => h[Math.min(g.rows - 1, Math.max(0, r)) * g.cols + Math.min(g.cols - 1, Math.max(0, c))]
  // the first step may go any direction
  for (let d = 0; d < D; d++) {
    cost[from * D + d] = 0
    heap.push(from * D + d, heur(from))
  }
  while (heap.size) {
    const st = heap.pop()
    const i = Math.floor(st / D), d0 = st % D
    if (goal.has(i)) {
      const path = [i]
      for (let s1 = st, k = prev[st]; k >= 0; s1 = k, k = prev[k]) {
        const ci = Math.floor(k / D)
        if (fine && pinAt[s1]) { // the half circle of the hairpin, walked backwards
          const c0 = ci % g.cols, r0 = (ci - c0) / g.cols, [ux0, uz0] = MV[k % D], ul = Math.hypot(ux0, uz0)
          const ux = ux0 / ul, uz = uz0 / ul, nx = -uz * pinAt[s1], nz = ux * pinAt[s1]
          const pc = Math.round(c0 + nx * PIN_CELLS), pr = Math.round(r0 + nz * PIN_CELLS), dn = s1 % D
          const leg: number[] = []
          for (let k = 0; k <= PIN_LEG; k++) leg.push((pr + MV[dn][1] * k) * g.cols + pc + MV[dn][0] * k)
          for (const q of leg.reverse()) if (q !== path[path.length - 1]) path.push(q)
          for (const [ax, az] of pinArc(c0, r0, ux, uz, nx, nz).reverse()) { const q = az * g.cols + ax; if (q !== path[path.length - 1]) path.push(q) }
        }
        if (ci !== path[path.length - 1]) path.push(ci)
      }
      return path.reverse()
    }
    const c = i % g.cols, r = (i - c) / g.cols
    const start = cost[st] === 0 && i === from
    // fine mode: a hairpin (lacet) as one move. The road turns back on a half circle of PIN_R to a leg 2 PIN_R
    // aside, up or down the flank. Its rise is spread over the arc (and the carved bed spreads it further over
    // the legs); it may be steeper than a leg, as on a real pass the turn is laid on a cut / fill platform.
    if (fine && !start) for (const sd of [1, -1]) {
      const [ux0, uz0] = MV[d0], ul = Math.hypot(ux0, uz0), ux = ux0 / ul, uz = uz0 / ul
      const nx = -uz * sd, nz = ux * sd
      const pc = Math.round(c + nx * PIN_CELLS), pr = Math.round(r + nz * PIN_CELLS)
      if (pc < 1 || pr < 1 || pc >= g.cols - 1 || pr >= g.rows - 1) continue
      const pj = pr * g.cols + pc
      const arc = Math.PI * PIN_CELLS * g.step / 2
      const gr = Math.abs(h[pj] - h[i]) / arc
      if (gr > hardGrade * 2.5 || gr < hardGrade * 0.5) continue // a hairpin only where a straight climb would not do
      let bad = false
      for (const [ax, az] of pinArc(c, r, ux, uz, nx, nz)) {
        const q = az * g.cols + ax
        if (ax < 1 || az < 1 || ax >= g.cols - 1 || az >= g.rows - 1 || h[q] <= 0.3 || (block && block[q] && !block[i]) || (river && river[q] > 0)) { bad = true; break }
      }
      if (bad) continue
      let dn = 0, best = -2
      for (let k = 0; k < D; k++) { const [a, b] = MV[k], dot = -(a * ux + b * uz) / Math.hypot(a, b); if (dot > best) { best = dot; dn = k } }
      // then the next leg, PIN_LEG straight moves (no hairpin right after a hairpin), each under the limit
      let lc = pc, lr = pr, legW = 0
      for (let k = 0; k < PIN_LEG && !bad; k++) {
        const nc2 = lc + MV[dn][0], nr2 = lr + MV[dn][1]
        if (nc2 < 1 || nr2 < 1 || nc2 >= g.cols - 1 || nr2 >= g.rows - 1) { bad = true; break }
        const a = lr * g.cols + lc, b = nr2 * g.cols + nc2, run = Math.hypot(MV[dn][0], MV[dn][1]) * g.step
        const sg = Math.abs(h[b] - h[a]) / run
        if (h[b] <= 0.3 || sg > hardGrade || (block && block[b] && !goal.has(b)) || (river && river[b] > 0) || onRoad[b]) { bad = true; break }
        const q2 = sg / (maxSlope / 100)
        legW += run * (1 + q2 * q2 * 3 + (q2 > 1 ? (q2 - 1) * 20 : 0))
        lc = nc2; lr = nr2
      }
      if (bad) continue
      const j = lr * g.cols + lc
      const g2 = gr / (maxSlope / 100)
      // pinCost: the fixed price of a lacet (120 = winding preferred; 30 on a mountain relief, where a pass climbs in lacets)
      const w = arc * (1 + g2 * g2 * 3) + pinCost + arc * Math.max(0, gr / hardGrade - 1) * 20 + legW // platform cut / fill
      const sj = j * D + dn, nc = cost[st] + w
      if (nc < cost[sj]) { cost[sj] = nc; prev[sj] = st; pinAt[sj] = sd; heap.push(sj, nc + heur(j)) }
    }
    for (let d = 0; d < D; d++) {
      let turn: number
      if (fine) {
        turn = d === d0 ? 0 : 1
        if (!start && !FINE_TURN[d0][d]) continue
      } else {
        turn = Math.abs(RANK[d] - RANK[d0])
        turn = Math.min(turn, D - turn)
        if (!start && turn > 1) continue
      }
      const [dc, dr] = MV[d]
      const cc = c + dc, rr = r + dr
      if (cc < 1 || rr < 1 || cc >= g.cols - 1 || rr >= g.rows - 1) continue
      const j = rr * g.cols + cc
      if (h[j] <= 0.3) continue // sea (and the waterline)
      if (block && block[j] && !goal.has(j) && !block[i]) continue // zone footprint (military base, airfield...): enter only at its goal cell
      const run = Math.hypot(dc, dr) * g.step
      if (Math.abs(h[j] - h[i]) / run > hardGrade) continue // steeper than the check allows for this road type
      const span = Math.max(Math.abs(dc), Math.abs(dr))
      if (span > 2) { // a long move: no sea, zone or cliff step on the cells it passes over
        let bad = false, hp = h[i]
        for (let k = 1; k < span && !bad; k++) {
          const fx = c + (dc * k) / span, fz = r + (dr * k) / span, x0 = Math.floor(fx), z0 = Math.floor(fz), tx = fx - x0, tz = fz - z0
          const hq = (at(x0, z0) * (1 - tx) + at(x0 + 1, z0) * tx) * (1 - tz) + (at(x0, z0 + 1) * (1 - tx) + at(x0 + 1, z0 + 1) * tx) * tz
          const q = Math.round(fz) * g.cols + Math.round(fx)
          if (h[q] <= 0.3 || (block && block[q] && !block[i]) || Math.abs(hq - hp) / (run / span) > hardGrade * 1.5) bad = true
          hp = hq
        }
        if (bad || Math.abs(h[j] - hp) / (run / span) > hardGrade * 1.5) continue
      }
      const grade = Math.abs(h[j] - h[i]) / run / (maxSlope / 100)
      let w = run * (1 + grade * grade * 3 + (grade > 1 ? (grade - 1) * 20 : 0))
      // cross slope: terrain falling sideways = cliff edge or a bench cut into the hill
      const gx = (at(cc + 1, rr) - at(cc - 1, rr)) / (2 * g.step), gz = (at(cc, rr + 1) - at(cc, rr - 1)) / (2 * g.step)
      const side = Math.abs(gx * -dr + gz * dc) / Math.hypot(dc, dr)
      w += run * (side / 0.2) ** 2 * 2
      if (h[j] < 4) w += run * 2 // keep off the shoreline
      if (turn) w += 4
      if (river && river[j] > 0 && !(river[i] > 0)) w += riverCrossCost(river[j]) // future bridge: short over a stream, long over a river
      if (onRoad[j]) w *= 0.35 // share existing roads
      const sj = j * D + d
      const nc = cost[st] + w
      if (nc < cost[sj]) {
        cost[sj] = nc
        prev[sj] = st
        if (fine) pinAt[sj] = 0
        heap.push(sj, nc + heur(j))
      }
    }
  }
  return null
}

//! drops control points where the line turns harder than `maxDeg` (the road generator rejects them)
function easeCorners(pts: number[], maxDeg: number): number[] {
  const out = pts.slice()
  const lim = (maxDeg * Math.PI) / 180
  for (let changed = true; changed && out.length > 4; ) {
    changed = false
    for (let k = 2; k + 2 < out.length; k += 2) {
      const a = Math.atan2(out[k + 1] - out[k - 1], out[k] - out[k - 2])
      const b = Math.atan2(out[k + 3] - out[k + 1], out[k + 2] - out[k])
      if (Math.abs(Math.atan2(Math.sin(b - a), Math.cos(b - a))) > lim) {
        out.splice(k, 2)
        changed = true
        break
      }
    }
  }
  return out
}

//! Ramer-Douglas-Peucker on flat X/Z points
function simplify(pts: number[], tol: number): number[] {
  const n = pts.length / 2
  if (n < 3) return pts
  const keep = new Uint8Array(n)
  keep[0] = keep[n - 1] = 1
  const stack: [number, number][] = [[0, n - 1]]
  while (stack.length) {
    const [a, b] = stack.pop()!
    const ax = pts[a * 2], az = pts[a * 2 + 1], bx = pts[b * 2], bz = pts[b * 2 + 1]
    const L = Math.hypot(bx - ax, bz - az) || 1
    let best = -1, bd = tol
    for (let k = a + 1; k < b; k++) {
      const d = Math.abs((bx - ax) * (az - pts[k * 2 + 1]) - (ax - pts[k * 2]) * (bz - az)) / L
      if (d > bd) { bd = d; best = k }
    }
    if (best > 0) { keep[best] = 1; stack.push([a, best], [best, b]) }
  }
  const out: number[] = []
  for (let k = 0; k < n; k++) if (keep[k]) out.push(pts[k * 2], pts[k * 2 + 1])
  return out
}

export function buildNetwork(h: number[], g: Grid, river: Float32Array | undefined, sites: Site[], p: NetworkParams, existing: Road[] = []): Road[] {
  if (sites.length < 2) return []
  const cellOf = (x: number, z: number) =>
    Math.min(g.rows - 1, Math.max(0, Math.round((z - g.minZ) / g.step))) * g.cols + Math.min(g.cols - 1, Math.max(0, Math.round((x - g.minX) / g.step)))
  const xyOf = (i: number): [number, number] => [g.minX + (i % g.cols) * g.step, g.minZ + Math.floor(i / g.cols) * g.step]
  const onRoad = new Uint8Array(g.cols * g.rows)
  let block: Uint8Array | undefined
  if (p.avoid?.length) {
    block = new Uint8Array(g.cols * g.rows)
    for (const d of p.avoid) {
      const R = Math.ceil(d.r / g.step), c0 = Math.round((d.x - g.minX) / g.step), r0 = Math.round((d.z - g.minZ) / g.step)
      for (let r = Math.max(0, r0 - R); r <= Math.min(g.rows - 1, r0 + R); r++) for (let c = Math.max(0, c0 - R); c <= Math.min(g.cols - 1, c0 + R); c++)
        if (Math.hypot(c - c0, r - r0) * g.step <= d.r) block[r * g.cols + c] = 1
    }
  }
  const roads: Road[] = []
  const lacets = new Set<Road>() // links routed by the fine mountain router (hairpins kept by the V2 finish)
  const keep = new Set<string>() // control points that must survive the fillets (a place checks it is served)
  // cell -> [road, index of the control point that sits on it] for T junctions
  const owner = new Map<number, Road>()
  const mark = (road: Road, cells: number[]) => cells.forEach((i) => { onRoad[i] = 1; if (!owner.has(i)) owner.set(i, road) })
  // existing (hand-drawn) roads are part of the network too
  for (const r of existing) {
    const cells: number[] = []
    for (let k = 2; k + 1 < r.pts.length; k += 2) {
      const [ax, az, bx, bz] = [r.pts[k - 2], r.pts[k - 1], r.pts[k], r.pts[k + 1]]
      const steps = Math.ceil(Math.hypot(bx - ax, bz - az) / g.step)
      for (let s = 0; s <= steps; s++) cells.push(cellOf(ax + ((bx - ax) * s) / steps, az + ((bz - az) * s) / steps))
    }
    mark(r, cells)
  }

  const order = [...sites].sort((a, b) => ORDER[a.kind] - ORDER[b.kind])
  const connected: Site[] = [order[0]]
  const todo = order.slice(1)
  const dist = (a: Site, b: Site) => Math.hypot(a.x - b.x, a.z - b.z)
  let n = 0
  while (todo.length) {
    // biggest kind first, then the one nearest to what is already connected
    todo.sort((a, b) => ORDER[a.kind] - ORDER[b.kind] ||
      Math.min(...connected.map((c) => dist(c, a))) - Math.min(...connected.map((c) => dist(c, b))))
    const s = todo.shift()!
    connected.push(s)
    p.progress?.((0.8 * (order.length - 1 - todo.length)) / Math.max(1, order.length - 1))
    const start = cellOf(s.x, s.z)
    // a road already passes through the settlement: nothing to build
    const R = Math.ceil(SITE_RADIUS[s.kind] / g.step), c0 = start % g.cols, r0 = Math.floor(start / g.cols)
    let served: Road | undefined
    for (let r = Math.max(0, r0 - R); r <= Math.min(g.rows - 1, r0 + R) && !served; r++)
      for (let c = Math.max(0, c0 - R); c <= Math.min(g.cols - 1, c0 + R); c++)
        if (onRoad[r * g.cols + c] && Math.hypot(c - c0, r - r0) <= R) { served = owner.get(r * g.cols + c); break }
    if (served) {
      // the road passing by gets a control point in front of the place (the check looks for one nearby)
      const [px, pz] = nearestOn(served.pts, s.x, s.z)
      insertPoint(served, px, pz)
      keep.add(`${px},${pz}`)
      continue
    }
    // towns are joined to the nearest town; villages and hamlets to the nearest site or any road
    const pool = s.kind === 'town' ? connected.filter((c) => c !== s && c.kind === 'town') : connected.filter((c) => c !== s)
    if (!pool.length) continue
    const target = pool.reduce((best, c) => (dist(c, s) < dist(best, s) ? c : best))
    const goal = new Set<number>([cellOf(target.x, target.z)])
    // aim the search at whichever is closer, the target place or the nearest road (cheaper A*, same goals)
    let aim: [number, number] = [target.x, target.z]
    if (s.kind !== 'town') {
      let bd = dist(target, s)
      owner.forEach((_, i) => {
        goal.add(i)
        const [x, z] = xyOf(i), d = Math.hypot(x - s.x, z - s.z)
        if (d < bd) { bd = d; aim = [x, z] }
      })
    }
    // classes (ROAD_NETWORK_V2 §3): town-town and village-town = main, village-village = secondary, hamlet = local
    const want = s.kind === 'town' || (s.kind === 'village' && target.kind === 'town') ? p.main : s.kind === 'village' ? p.minor : p.lane
    // Slope-aware routing, like a real road engineer: A* pays for grade and may wind up the hill (serpentines,
    // one heading notch per step), each step held under a per-step limit. The accepted test is the grade of
    // the bed once carved (cut/fill over ~80 m, see bedGrade), not of the raw bumpy ground. The per-step limit
    // starts a bit above the type's limit (carving evens the bumps) and tightens on each retry; only when no
    // route keeps the bed under the limit does the link fall back to a dirt track (steeper limit).
    let type = want, pts: number[] = [], cells: number[] = [], joined: number[] | null = null, fineLink = false
    // grade of every road as it stands now: a new link may not push one over its limit, but a road already
    // over it (a junction carved earlier) must not veto every later link either
    let before: Map<Road, number> | null = null
    const gradeBefore = () => {
      if (!before) {
        const t = h.slice()
        carveRoads(t, g, [...existing, ...roads], NOPIN)
        before = new Map(roads.map((o) => [o, worstGrade(o.pts, t, g).grade]))
      }
      return before
    }
    // fallback ladder: asphalt -> dirt road -> dirt trail (each one steeper)
    const ladder = [want, ...(['dirt', 'trailDirt'] as RoadType[]).filter((x) => maxGrade(x) > maxGrade(want))]
    // the usual search first (each type under its hard limit, then the steeper type). Only when the link it found
    // fell back to a lower class (the relief too steep for the wanted one), or none was found, does the mountain-pass
    // router (ROAD_MOUNTAIN: 40 headings, hairpins as moves) try each type under that comfortable grade; its link
    // replaces the first one. A link found in its wanted class is kept as it was (gentle maps unchanged).
    let gotGrade = Infinity
    const runSteps = (steps: { tt: RoadType; cap: number; fine: boolean; accept?: number }[]) => {
    search: for (const { tt, cap, fine: fineStep, accept } of steps)
      for (const f of [1.25, 1, 0.8, 0.6, 0.45]) {
        // the per-step limit stays the type's one (an 8 m step sees bumps the carving evens out, and the move
        // directions give no grade between 0 and 18 % on a 40 % flank); the slope cost is centred on the cap,
        // so the path prefers longer lacets, and the carved bed is what is tested against the cap
        const path = route(h, g, river, onRoad, start, goal, aim, Math.min(p.maxSlope, (cap / 0.9) * 80), (cap / 0.9) * f, block, fineStep, p.mountains ? 30 : 120)
        if (!path || path.length < 2) break // no way under this limit: a tighter one will not find any either
        // stop where the path joins an existing road (it would only run on top of it)
        let end = path.length - 1
        for (let k = 1; k < path.length; k++) if (onRoad[path[k]]) { end = k; break }
        const cl = path.slice(0, end + 1)
        const flat: number[] = []
        cl.forEach((i) => flat.push(...xyOf(i)))
        // a fine (mountain) path keeps its cells: simplifying a hairpin arc leaves one sharp corner that easeCorners cuts
        for (const tol of fineStep ? [0] : [0.9, 0.4, 0]) {
          const cand = easeCorners(tol ? simplify(flat, g.step * tol) : flat, 60)
          if (cand.length < 4 || bedGrade(cand, h, g) > cap / 0.9) continue
          // the real test: carve it with the roads already there (junctions included), measure like the check
          // (the T junction adds a control point to the road it reaches: tested on a copy of that road)
          const hit = owner.get(cl[cl.length - 1])
          const hitCopy = hit ? { ...hit, pts: hit.pts.slice() } : null
          if (hitCopy) {
            // the end lands exactly on the road reached (its shape untouched), and becomes one of its control points
            const [jx, jz] = nearestOn(hitCopy.pts, cand[cand.length - 2], cand[cand.length - 1])
            cand[cand.length - 2] = jx; cand[cand.length - 1] = jz
            insertPoint(hitCopy, jx, jz)
          }
          const swap = (r: Road) => (r === hit ? hitCopy! : r)
          const test = h.slice()
          carveRoads(test, g, [...existing.map(swap), ...roads.map(swap), { id: 'test', type: tt, pts: cand, flatten: true }], NOPIN)
          const wg = worstGrade(cand, test, g).grade
          if (wg <= (accept ?? cap) && roads.every((o) => { const gr = worstGrade(swap(o).pts, test, g).grade; return gr <= maxGrade(o.type) || gr <= (gradeBefore().get(o) ?? 0) + 0.005 })) {
            pts = cand; cells = cl; type = tt; joined = hitCopy && hitCopy.pts; fineLink = fineStep; gotGrade = wg
            break search
          }
        }
      }
    }
    runSteps(ladder.map((tt) => ({ tt, cap: maxGrade(tt) * 0.9, fine: false })))
    if (pts.length < 4 || type !== want) {
      const keep = { pts, cells, type, joined, gotGrade } // the fine link may not be of a lower class than this one
      pts = []
      const steps: { tt: RoadType; cap: number; fine: boolean; accept?: number }[] = ladder.filter((tt, k) => comfortGrade(tt) < maxGrade(tt) * 0.9 && (keep.pts.length < 4 || k <= ladder.indexOf(keep.type))).map((tt) => ({ tt, cap: comfortGrade(tt), fine: true }))
      // mountains: the wanted class with lacets up to its hard limit comes before any lower class (a town left on a
      // dirt link is off the paved network: no FF traffic / convoys)
      if (p.mountains && steps[0]?.tt === want) steps.splice(1, 0, { tt: want, cap: maxGrade(want) * 0.9, fine: true, accept: maxGrade(want) })
      runSteps(steps)
      if (pts.length < 4) { ({ pts, cells, type, joined, gotGrade } = keep); fineLink = false }
    } else if (p.mountains && gotGrade > comfortGrade(want) + 0.005) {
      // mountains: the link kept its class but climbs over the comfortable grade: lacets under it when the pass
      // router finds them, else the straight climb stays
      const keep = { pts, cells, type, joined, gotGrade }
      pts = []
      runSteps([{ tt: want, cap: comfortGrade(want), fine: true }])
      if (pts.length < 4) { ({ pts, cells, type, joined, gotGrade } = keep); fineLink = false }
    }
    if (pts.length < 4) continue
    const road: Road = { id: `ROAD_AUTO_${++n}`, type, pts, flatten: true } // cut/fill: the bed follows the smoothed profile bedGrade measured
    if (fineLink) lacets.add(road)
    // T junction: the end point must also be a control point of the road it reaches
    const hit = owner.get(cells[cells.length - 1])
    if (hit && joined) hit.pts = joined
    roads.push(road)
    mark(road, cells)
  }
  if (p.loops) addLoops()
  if (p.v2 !== false) finishV2()
  return roads

  // --- V2 finish: X junctions + fillets (docs/ROAD_NETWORK_V2.md stages 2 and 5) ---
  function finishV2() {
    const SPACING = 12
    const welded = weldRoads(roads, { snap: 0, crossings: true })
    roads.forEach((r, i) => { r.pts = welded[i].pts })
    // junction points: road ends and points used by two roads (existing ones included), plus served points
    const uses = new Map<string, number>()
    for (const r of [...existing, ...roads]) {
      const seen = new Set<string>()
      for (let k = 0; k + 1 < r.pts.length; k += 2) { const kk = `${r.pts[k]},${r.pts[k + 1]}`; if (!seen.has(kk)) { seen.add(kk); uses.set(kk, (uses.get(kk) ?? 0) + 1) } }
      if (r.pts.length >= 4) for (const e of [0, r.pts.length - 2]) keep.add(`${r.pts[e]},${r.pts[e + 1]}`)
    }
    // inside a place the road keeps its shape: the streets and lots of the village grow from it
    // (village.ts lays streets and lots up to 380 / 220 / 140 m from the centre)
    const FROZEN: Record<SiteKind, number> = { town: 420, village: 250, hamlet: 160 }
    const inPlace = (x: number, z: number) => sites.some((q) => Math.hypot(q.x - x, q.z - z) < FROZEN[q.kind])
    const fixed = (x: number, z: number) => keep.has(`${x},${z}`) || (uses.get(`${x},${z}`) ?? 0) > 1
    const old = new Map<Road, number[]>()
    for (const r of roads) {
      // a mountain road keeps its hairpins: no corner merging (a 180 degree turn has no intersection point, the
      // merge squared it), and the smoothed line must stay under the comfortable grade it was routed for
      const pin = lacets.has(r)
      const f = smoothRoad(r.pts, rMinOf(r.type), { spacing: SPACING, fixed, frozen: inPlace, merge: pin ? 0 : 12, minKeep: 0.5 })
      if (!f.corners) continue
      const pts = f.pts
      if (bedGrade(pts, h, g) > (pin ? comfortGrade(r.type) / 0.9 : maxGrade(r.type) * 0.9)) continue
      old.set(r, r.pts)
      r.pts = pts
    }
    // the real test, like the checker: carved together, no filleted road may end over its limit
    for (let pass = 0; pass < 3 && old.size; pass++) {
      const t = h.slice()
      carveRoads(t, g, [...existing, ...roads], NOPIN)
      let back = 0
      for (const [r, pts] of old) if (worstGrade(r.pts, t, g).grade > maxGrade(r.type)) { r.pts = pts; old.delete(r); back++ }
      if (!back) break
    }
  }

  // --- loops: shortcuts between places the tree joins only by a long detour ---
  function roadDist(from: number, to: Set<number>, cap: number): number {
    // Dijkstra over road cells only (8 neighbours), metres; Infinity past cap
    const d = new Map<number, number>([[from, 0]])
    const heap = new Heap()
    heap.push(from, 0)
    while (heap.size) {
      const i = heap.pop(), di = d.get(i)!
      if (to.has(i)) return di
      if (di > cap) return Infinity
      const c = i % g.cols, r = (i - c) / g.cols
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue
        const cc = c + dc, rr = r + dr
        if (cc < 0 || rr < 0 || cc >= g.cols || rr >= g.rows) continue
        const j = rr * g.cols + cc
        if (!onRoad[j]) continue
        const nd = di + Math.hypot(dc, dr) * g.step
        if (nd < (d.get(j) ?? Infinity)) { d.set(j, nd); heap.push(j, nd) }
      }
    }
    return Infinity
  }
  function roadCellsNear(s: Site): number[] {
    const out: number[] = [], start = cellOf(s.x, s.z), R = Math.ceil((SITE_RADIUS[s.kind] + 20) / g.step), c0 = start % g.cols, r0 = Math.floor(start / g.cols)
    for (let r = Math.max(0, r0 - R); r <= Math.min(g.rows - 1, r0 + R); r++)
      for (let c = Math.max(0, c0 - R); c <= Math.min(g.cols - 1, c0 + R); c++)
        if (onRoad[r * g.cols + c] && Math.hypot(c - c0, r - r0) <= R) out.push(r * g.cols + c)
    return out
  }
  function addLoops() {
    const detour = p.loopDetour ?? 1.8, maxM = p.loopMaxM ?? 2000, tt = p.loopType ?? p.minor
    const pairs: [Site, Site, number][] = []
    for (let i = 0; i < sites.length; i++) for (let j = i + 1; j < sites.length; j++) {
      const a = sites[i], b = sites[j], d = dist(a, b)
      if (d < maxM && d > SITE_RADIUS[a.kind] + SITE_RADIUS[b.kind] + 150) pairs.push([a, b, d])
    }
    pairs.sort((x, y) => ORDER[x[0].kind] + ORDER[x[1].kind] - ORDER[y[0].kind] - ORDER[y[1].kind] || x[2] - y[2])
    let made = 0, tries = 0, t0: number[] | null = null // t0: the roads as they stand, carved once per accepted loop
    for (const [a, b, d] of pairs) {
      if (made >= p.loops! || tries >= p.loops! * 2) break
      p.progress?.(0.8 + 0.2 * Math.min(1, Math.max(made / p.loops!, tries / (p.loops! * 2))))
      const ca = roadCellsNear(a), cb = roadCellsNear(b)
      if (!ca.length || !cb.length) continue
      const netD = roadDist(ca[0], new Set(cb), d * detour)
      if (netD <= d * detour) continue // already joined by a short enough road
      tries++
      const path = route(h, g, river, onRoad, cellOf(a.x, a.z), new Set([cellOf(b.x, b.z), ...cb]), [b.x, b.z], Math.min(p.maxSlope, maxGrade(tt) * 80), maxGrade(tt), block)
      if (!path || path.length < 3) continue
      // keep the longest run off the existing roads, from the road cell before it to the road cell after it
      let bs = -1, be = -1, k = 0
      while (k < path.length) {
        if (onRoad[path[k]]) { k++; continue }
        let e = k
        while (e < path.length && !onRoad[path[e]]) e++
        if (e - k > be - bs) { bs = k; be = e }
        k = e
      }
      if (bs < 1 || be >= path.length) continue // must start and end on a road (a real junction at both ends)
      const cl = path.slice(bs - 1, be + 1)
      if (cl.length * g.step < 250) continue
      // the shortcut must really save road: its two ends far apart along the network
      const along = roadDist(cl[0], new Set([cl[cl.length - 1]]), cl.length * g.step * detour * 1.5)
      if (along <= cl.length * g.step * detour) continue
      const flat: number[] = []
      cl.forEach((i) => flat.push(...xyOf(i)))
      for (const tol of [0.9, 0.4]) {
        const cand = easeCorners(simplify(flat, g.step * tol), 60)
        if (cand.length < 4 || bedGrade(cand, h, g) > maxGrade(tt)) continue
        const h0 = owner.get(cl[0]), h1 = owner.get(cl[cl.length - 1])
        if (!h0 || !h1) break
        const copies = new Map<Road, Road>()
        for (const [hr, ix] of [[h0, 0], [h1, cand.length - 2]] as [Road, number][]) {
          const cp = copies.get(hr) ?? { ...hr, pts: hr.pts.slice() }
          copies.set(hr, cp)
          const [jx, jz] = nearestOn(cp.pts, cand[ix], cand[ix + 1])
          cand[ix] = jx; cand[ix + 1] = jz
          insertPoint(cp, jx, jz)
        }
        const swap = (r: Road) => copies.get(r) ?? r
        const base = () => (t0 ??= (() => { const t = h.slice(); carveRoads(t, g, [...existing, ...roads], NOPIN); return t })())
        const test = h.slice()
        carveRoads(test, g, [...existing.map(swap), ...roads.map(swap), { id: 'test', type: tt, pts: cand, flatten: true }], NOPIN)
        if (worstGrade(cand, test, g).grade > maxGrade(tt) * 0.9) continue
        if (!roads.every((o) => { const gr = worstGrade(swap(o).pts, test, g).grade; return gr <= maxGrade(o.type) || gr <= worstGrade(o.pts, base(), g).grade + 0.005 })) continue
        copies.forEach((cp, hr) => { hr.pts = cp.pts })
        t0 = null
        const road: Road = { id: `ROAD_AUTO_${++n}`, type: tt, pts: cand, flatten: true }
        roads.push(road)
        mark(road, cl.slice(1, -1))
        made++
        break
      }
    }
  }
}

//! Road styles by surroundings (road classes, docs/ROAD_NETWORK_V2.md §3): auto tracks / trails mostly inside a
//! wood take the forest styles (RG_Road_Forest_01 / RG_TrailForest_01); auto trails in the open alternate dirt and
//! gravel. Only the style changes (same class, same width within 0.25 m, grade limit equal or higher).
export function styleTracks(roads: Road[], inForest: (x: number, z: number) => boolean) {
  for (const r of roads) {
    if (!r.auto || r.pts.length < 4 || (r.type !== 'dirt' && r.type !== 'trailDirt')) continue
    const line = centreLine(r.pts, 25)
    let wood = 0
    for (let i = 0; i < line.length; i += 2) if (inForest(line[i], line[i + 1])) wood++
    const share = wood / (line.length / 2)
    if (share > 0.5) r.type = r.type === 'dirt' ? 'forest' : 'trailForest'
    else if (r.type === 'trailDirt' && [...r.id].reduce((h, c) => h + c.charCodeAt(0), 0) % 2) r.type = 'trailGravel'
  }
}

//! closest point to (x, z) on a polyline
export function nearestOn(p: number[], x: number, z: number): [number, number] {
  let best: [number, number] = [p[0], p[1]], bd = Infinity
  for (let k = 2; k + 1 < p.length; k += 2) {
    const [ax, az, bx, bz] = [p[k - 2], p[k - 1], p[k], p[k + 1]]
    const L = (bx - ax) ** 2 + (bz - az) ** 2 || 1
    const t = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (z - az) * (bz - az)) / L))
    const qx = ax + t * (bx - ax), qz = az + t * (bz - az), d = Math.hypot(qx - x, qz - z)
    if (d < bd) { bd = d; best = [qx, qz] }
  }
  return best
}

//! adds (x, z) as a control point of `road`, on its closest segment (no-op if already there)
export function insertPoint(road: Road, x: number, z: number) {
  const p = road.pts
  for (let k = 0; k < p.length; k += 2) if (p[k] === x && p[k + 1] === z) return
  let best = 2, bd = Infinity
  for (let k = 2; k < p.length; k += 2) {
    const [ax, az, bx, bz] = [p[k - 2], p[k - 1], p[k], p[k + 1]]
    const L = (bx - ax) ** 2 + (bz - az) ** 2 || 1
    const t = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (z - az) * (bz - az)) / L))
    const d = Math.hypot(ax + t * (bx - ax) - x, az + t * (bz - az) - z)
    if (d < bd) { bd = d; best = k }
  }
  p.splice(best, 0, x, z)
}

//! Slope-aware link between two points (V2 island auto-connect): the A* of the network, then the same
//! simplification. Returns a polyline from a to b exactly, or null when no route keeps under the type's grade
//! (or under `grade`: forest / field tracks ask for 15 %, worldgen.ts tameTrack).
export function routeLink(h: number[], g: Grid, river: Float32Array | undefined, a: [number, number], b: [number, number], type: RoadType, maxSlope: number, grade = maxGrade(type), fine = false): number[] | null {
  const cellOf = (x: number, z: number) =>
    Math.min(g.rows - 1, Math.max(0, Math.round((z - g.minZ) / g.step))) * g.cols + Math.min(g.cols - 1, Math.max(0, Math.round((x - g.minX) / g.step)))
  const path = route(h, g, river, new Uint8Array(g.cols * g.rows), cellOf(a[0], a[1]), new Set([cellOf(b[0], b[1])]), b, Math.min(maxSlope, grade * 80), grade, undefined, fine)
  if (!path || path.length < 2) return null
  const flat: number[] = []
  for (const i of path) flat.push(g.minX + (i % g.cols) * g.step, g.minZ + Math.floor(i / g.cols) * g.step)
  const pts = easeCorners(fine ? flat : simplify(flat, g.step * 0.9), 60) // fine (hairpins): cells kept, as buildNetwork
  if (pts.length < 4) return null
  pts[0] = a[0]; pts[1] = a[1]; pts[pts.length - 2] = b[0]; pts[pts.length - 1] = b[1]
  return pts
}
