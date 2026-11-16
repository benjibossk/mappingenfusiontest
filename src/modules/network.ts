// Automatic road network on the island grid.
// 1. sites: flat land, near water, spaced out (best score first)
// 2. growth: the biggest sites are joined first (asphalt), then every other site is linked to the
//    nearest part of the network (dirt); a link that reaches an existing road makes a T junction
// 3. each link is routed with A* over the heights: slope costs, sea is forbidden, rivers are crossed
//    rarely, cells already on a road are cheaper so roads share corridors instead of running side by side
import type { Grid } from './island'
import { carveRoads, centreLine, type Road, type RoadType } from './roads'

export type SiteKind = 'town' | 'village' | 'hamlet'
export interface Site { id: string; x: number; z: number; kind: SiteKind }
//! settlement footprint radius (m), also the distance under which a road already serves it
export const SITE_RADIUS: Record<SiteKind, number> = { town: 250, village: 120, hamlet: 50 }
// steepest grade a vehicle copes with, by road family (shared with the pre-send check in validate.ts)
const MAX_GRADE: Partial<Record<RoadType, number>> = { dirt: 0.2, dirt2: 0.2, forest: 0.22, trailDirt: 0.3, trailGravel: 0.3, trailForest: 0.3 }
export const maxGrade = (t: RoadType) => MAX_GRADE[t] ?? 0.12
/** steepest grade along a road, over 20 m steps (the grid is coarse: shorter steps only measure noise).
 *  The pre-send check (validate.ts) uses this same measure. */
export function worstGrade(pts: number[], h: ArrayLike<number>, g: Grid): { grade: number; x: number; z: number } {
  const at = (x: number, z: number) => {
    const c = Math.min(g.cols - 1, Math.max(0, Math.round((x - g.minX) / g.step))), r = Math.min(g.rows - 1, Math.max(0, Math.round((z - g.minZ) / g.step)))
    return h[r * g.cols + c]
  }
  const line = centreLine(pts, 20)
  let grade = 0, x = 0, z = 0
  for (let i = 2; i + 1 < line.length; i += 2) {
    const d = Math.hypot(line[i] - line[i - 2], line[i + 1] - line[i - 1])
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

//! A* from `from` to any cell of `goal`; returns the cell path or null.
//! The state is (cell, heading): a step may turn by one heading notch at most (~25 degrees), which
//! keeps hairpins wide enough for the road generator; cliffs beside the road and the coast cost extra.
function route(h: number[], g: Grid, river: Float32Array | undefined, onRoad: Uint8Array, from: number, goal: Set<number>, goalXY: [number, number], maxSlope: number, hardGrade = Infinity): number[] | null {
  const n = g.cols * g.rows, D = DIRS.length
  const cost = new Float32Array(n * D).fill(Infinity)
  const prev = new Int32Array(n * D).fill(-1)
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
      for (let k = prev[st]; k >= 0; k = prev[k]) {
        const ci = Math.floor(k / D)
        if (ci !== path[path.length - 1]) path.push(ci)
      }
      return path.reverse()
    }
    const c = i % g.cols, r = (i - c) / g.cols
    const start = cost[st] === 0 && i === from
    for (let d = 0; d < D; d++) {
      let turn = Math.abs(RANK[d] - RANK[d0])
      turn = Math.min(turn, D - turn)
      if (!start && turn > 1) continue
      const [dc, dr] = DIRS[d]
      const cc = c + dc, rr = r + dr
      if (cc < 1 || rr < 1 || cc >= g.cols - 1 || rr >= g.rows - 1) continue
      const j = rr * g.cols + cc
      if (h[j] <= 0.3) continue // sea (and the waterline)
      const run = Math.hypot(dc, dr) * g.step
      if (Math.abs(h[j] - h[i]) / run > hardGrade) continue // steeper than the check allows for this road type
      const grade = Math.abs(h[j] - h[i]) / run / (maxSlope / 100)
      let w = run * (1 + grade * grade * 3 + (grade > 1 ? (grade - 1) * 20 : 0))
      // cross slope: terrain falling sideways = cliff edge or a bench cut into the hill
      const gx = (at(cc + 1, rr) - at(cc - 1, rr)) / (2 * g.step), gz = (at(cc, rr + 1) - at(cc, rr - 1)) / (2 * g.step)
      const side = Math.abs(gx * -dr + gz * dc) / Math.hypot(dc, dr)
      w += run * (side / 0.2) ** 2 * 2
      if (h[j] < 4) w += run * 2 // keep off the shoreline
      if (turn) w += 4
      if (river && river[j] > 0 && !(river[i] > 0)) w += 400 // crossing a river = future bridge
      if (onRoad[j]) w *= 0.35 // share existing roads
      const sj = j * D + d
      const nc = cost[st] + w
      if (nc < cost[sj]) {
        cost[sj] = nc
        prev[sj] = st
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
  const roads: Road[] = []
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
    const want = s.kind === 'town' ? p.main : s.kind === 'village' ? p.minor : p.lane
    // Slope-aware routing, like a real road engineer: A* pays for grade and may wind up the hill (serpentines,
    // one heading notch per step), each step held under a per-step limit. The accepted test is the grade of
    // the bed once carved (cut/fill over ~80 m, see bedGrade), not of the raw bumpy ground. The per-step limit
    // starts a bit above the type's limit (carving evens the bumps) and tightens on each retry; only when no
    // route keeps the bed under the limit does the link fall back to a dirt track (steeper limit).
    let type = want, pts: number[] = [], cells: number[] = [], joined: number[] | null = null
    // grade of every road as it stands now: a new link may not push one over its limit, but a road already
    // over it (a junction carved earlier) must not veto every later link either
    let before: Map<Road, number> | null = null
    const gradeBefore = () => {
      if (!before) {
        const t = h.slice()
        carveRoads(t, g, [...existing, ...roads])
        before = new Map(roads.map((o) => [o, worstGrade(o.pts, t, g).grade]))
      }
      return before
    }
    // fallback ladder: asphalt -> dirt road -> dirt trail (each one steeper)
    const ladder = [want, ...(['dirt', 'trailDirt'] as RoadType[]).filter((x) => maxGrade(x) > maxGrade(want))]
    search: for (const tt of ladder)
      for (const f of [1.25, 1, 0.8, 0.6, 0.45]) {
        const path = route(h, g, river, onRoad, start, goal, aim, Math.min(p.maxSlope, maxGrade(tt) * 80), maxGrade(tt) * f)
        if (!path || path.length < 2) break // no way under this limit: a tighter one will not find any either
        // stop where the path joins an existing road (it would only run on top of it)
        let end = path.length - 1
        for (let k = 1; k < path.length; k++) if (onRoad[path[k]]) { end = k; break }
        const cl = path.slice(0, end + 1)
        const flat: number[] = []
        cl.forEach((i) => flat.push(...xyOf(i)))
        for (const tol of [0.9, 0.4, 0]) {
          const cand = easeCorners(tol ? simplify(flat, g.step * tol) : flat, 60)
          if (cand.length < 4 || bedGrade(cand, h, g) > maxGrade(tt)) continue
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
          carveRoads(test, g, [...existing.map(swap), ...roads.map(swap), { id: 'test', type: tt, pts: cand, flatten: true }])
          if (worstGrade(cand, test, g).grade <= maxGrade(tt) * 0.9 && roads.every((o) => { const gr = worstGrade(swap(o).pts, test, g).grade; return gr <= maxGrade(o.type) || gr <= (gradeBefore().get(o) ?? 0) + 0.005 })) {
            pts = cand; cells = cl; type = tt; joined = hitCopy && hitCopy.pts
            break search
          }
        }
      }
    if (pts.length < 4) continue
    const road: Road = { id: `ROAD_AUTO_${++n}`, type, pts, flatten: true } // cut/fill: the bed follows the smoothed profile bedGrade measured
    // T junction: the end point must also be a control point of the road it reaches
    const hit = owner.get(cells[cells.length - 1])
    if (hit && joined) hit.pts = joined
    roads.push(road)
    mark(road, cells)
  }
  if (p.loops) addLoops()
  return roads

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
      const path = route(h, g, river, onRoad, cellOf(a.x, a.z), new Set([cellOf(b.x, b.z), ...cb]), [b.x, b.z], Math.min(p.maxSlope, maxGrade(tt) * 80), maxGrade(tt))
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
        const base = () => (t0 ??= (() => { const t = h.slice(); carveRoads(t, g, [...existing, ...roads]); return t })())
        const test = h.slice()
        carveRoads(test, g, [...existing.map(swap), ...roads.map(swap), { id: 'test', type: tt, pts: cand, flatten: true }])
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

//! closest point to (x, z) on a polyline
function nearestOn(p: number[], x: number, z: number): [number, number] {
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
function insertPoint(road: Road, x: number, z: number) {
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
