// Power lines, step 1 (docs/ROADMAP_NEXT.md §2): pure routing, not wired into the UI yet.
// A line between two points (substation -> substation, or substation -> village) is routed with A*
// over the height grid: slope costs (steep cells are forbidden), water is forbidden, cells inside a
// "keep-out" circle (village centres, buildings) are forbidden, cells along a road corridor are
// cheaper (low-voltage lines follow roads, at an offset so poles never sit on the road surface).
// The cell path is then straightened (line-of-sight simplification) and poles are spaced every
// `spacing` metres along each straight span, plus one on every corner. Output = a polyline shape for
// a native PG_PowerLine_* generator ("Generate per point": one pole per point).

import type { Grid } from './island'
import type { ProjectShape } from '../project'

export type PowerKind = 'hv' | 'mv' | 'lv'

/** Native power line generators (docs/GENERATORS.md, docs/ENFUSION_FORMATS.md). Paths only for the
 *  ones whose GUID is not known yet: the plugin resolves a bare path. */
export const POWER_GENERATORS: Record<PowerKind, string> = {
  hv: 'Prefabs/WEGenerators/Powerline/PG_PowerLine_HV_02_Metal.et',
  mv: 'Prefabs/WEGenerators/Powerline/PG_PowerLine_HV_01_Concrete.et',
  lv: '{20E4877A07D28502}Prefabs/WEGenerators/Powerline/PG_PowerLine_01_WoodenSmall.et',
}

/** Typical span between poles (m) and the steepest slope a pole may stand on. */
export const POWER_DEFAULTS: Record<PowerKind, { spacing: number; maxSlope: number; roadBonus: number }> = {
  hv: { spacing: 220, maxSlope: 0.45, roadBonus: 1 }, // pylons cross country, ignore roads
  mv: { spacing: 90, maxSlope: 0.35, roadBonus: 0.6 },
  lv: { spacing: 40, maxSlope: 0.3, roadBonus: 0.35 }, // wooden poles hug the roads
}

export interface KeepOut { x: number; z: number; r: number }

export interface PowerOptions {
  kind: PowerKind
  spacing?: number
  maxSlope?: number
  /** cost multiplier (< 1) for cells within `roadBand` of a road but not on it */
  roadBonus?: number
  roadBand?: [number, number] // [min, max] distance to a road axis, metres
  /** true = this cell is water (sea, lake, river) */
  isWater?: (x: number, z: number) => boolean
  keepOut?: KeepOut[]
  /** road centre lines, flat x/z pairs */
  roads?: number[][]
}

export interface PowerLine {
  kind: PowerKind
  /** straightened path, flat x/z */
  path: number[]
  /** pole positions, flat x/z (first and last = the end points) */
  poles: number[]
  length: number
}

const SQ2 = Math.SQRT2

function segDist(px: number, pz: number, ax: number, az: number, bx: number, bz: number) {
  const dx = bx - ax, dz = bz - az
  const l = dx * dx + dz * dz
  const t = l ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l)) : 0
  return Math.hypot(px - ax - t * dx, pz - az - t * dz)
}

/** Per-cell cost (Infinity = forbidden). Built once per routing call. */
function costField(h: ArrayLike<number>, g: Grid, o: PowerOptions): Float32Array {
  const d = POWER_DEFAULTS[o.kind]
  const maxSlope = o.maxSlope ?? d.maxSlope
  const bonus = o.roadBonus ?? d.roadBonus
  const [bMin, bMax] = o.roadBand ?? [6, 25]
  const cost = new Float32Array(g.cols * g.rows)
  const at = (c: number, r: number) => h[Math.min(g.rows - 1, Math.max(0, r)) * g.cols + Math.min(g.cols - 1, Math.max(0, c))]
  for (let r = 0; r < g.rows; r++) {
    for (let c = 0; c < g.cols; c++) {
      const x = g.minX + c * g.step, z = g.minZ + r * g.step
      const sx = (at(c + 1, r) - at(c - 1, r)) / (2 * g.step)
      const sz = (at(c, r + 1) - at(c, r - 1)) / (2 * g.step)
      const slope = Math.hypot(sx, sz)
      let k = slope > maxSlope ? Infinity : 1 + 6 * (slope / maxSlope) ** 2
      if (k !== Infinity && o.isWater?.(x, z)) k = Infinity
      if (k !== Infinity && o.keepOut) for (const q of o.keepOut) if (Math.hypot(x - q.x, z - q.z) < q.r) { k = Infinity; break }
      if (k !== Infinity && o.roads && bonus !== 1) {
        let best = Infinity
        for (const p of o.roads) for (let i = 0; i + 3 < p.length; i += 2) best = Math.min(best, segDist(x, z, p[i], p[i + 1], p[i + 2], p[i + 3]))
        if (best < bMin) k *= 3 // on the road surface: allowed to cross, not to run along it
        else if (best <= bMax) k *= bonus
      }
      cost[r * g.cols + c] = k
    }
  }
  return cost
}

/** Binary-heap A* on the 8-connected grid; returns cell indices from start to goal, or null. */
function astar(cost: Float32Array, g: Grid, s: number, t: number): number[] | null {
  const n = cost.length
  const gs = new Float64Array(n).fill(Infinity)
  const from = new Int32Array(n).fill(-1)
  const heap: number[] = [], key: number[] = []
  const tc = t % g.cols, tr = (t / g.cols) | 0
  const hfun = (i: number) => {
    const dc = Math.abs((i % g.cols) - tc), dr = Math.abs(((i / g.cols) | 0) - tr)
    return Math.max(dc, dr) + (SQ2 - 1) * Math.min(dc, dr) // octile, min cost 1
  }
  const push = (i: number, f: number) => {
    heap.push(i); key.push(f)
    let k = heap.length - 1
    while (k > 0) {
      const p = (k - 1) >> 1
      if (key[p] <= key[k]) break
      ;[heap[p], heap[k]] = [heap[k], heap[p]]; [key[p], key[k]] = [key[k], key[p]]
      k = p
    }
  }
  const pop = () => {
    const top = heap[0]
    const li = heap.pop()!, lk = key.pop()!
    if (heap.length) {
      heap[0] = li; key[0] = lk
      let k = 0
      for (;;) {
        const a = 2 * k + 1, b = a + 1
        let m = k
        if (a < heap.length && key[a] < key[m]) m = a
        if (b < heap.length && key[b] < key[m]) m = b
        if (m === k) break
        ;[heap[m], heap[k]] = [heap[k], heap[m]]; [key[m], key[k]] = [key[k], key[m]]
        k = m
      }
    }
    return top
  }
  gs[s] = 0
  push(s, hfun(s))
  const closed = new Uint8Array(n)
  while (heap.length) {
    const i = pop()
    if (closed[i]) continue
    closed[i] = 1
    if (i === t) break
    const c = i % g.cols, r = (i / g.cols) | 0
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      if (!dc && !dr) continue
      const cc = c + dc, rr = r + dr
      if (cc < 0 || rr < 0 || cc >= g.cols || rr >= g.rows) continue
      const j = rr * g.cols + cc
      if (closed[j] || cost[j] === Infinity) continue
      const step = (dc && dr ? SQ2 : 1) * 0.5 * (cost[i] + cost[j])
      const ng = gs[i] + step
      if (ng < gs[j]) { gs[j] = ng; from[j] = i; push(j, ng + hfun(j)) }
    }
  }
  if (from[t] < 0 && s !== t) return null
  const out: number[] = []
  for (let i = t; i >= 0; i = from[i]) { out.push(i); if (i === s) break }
  return out.reverse()
}

/** True if every grid cell crossed by the segment a->b is allowed and not much costlier than the
 *  cells of the cell path it replaces (a straight span must not cut across a forbidden zone). */
function clear(cost: Float32Array, g: Grid, a: number, b: number) {
  const ac = a % g.cols, ar = (a / g.cols) | 0, bc = b % g.cols, br = (b / g.cols) | 0
  const n = Math.max(Math.abs(bc - ac), Math.abs(br - ar)) * 2
  for (let k = 0; k <= n; k++) {
    const t = n ? k / n : 0
    const c = Math.round(ac + (bc - ac) * t), r = Math.round(ar + (br - ar) * t)
    if (cost[r * g.cols + c] === Infinity) return false
  }
  return true
}

/** Greedy line-of-sight straightening, capped by `maxSpan` metres per straight piece. */
function straighten(cells: number[], cost: Float32Array, g: Grid, maxSpan: number): number[] {
  const keep = [cells[0]]
  let i = 0
  while (i < cells.length - 1) {
    let j = cells.length - 1
    const ci = cells[i]
    while (j > i + 1) {
      const cj = cells[j]
      const len = Math.hypot((cj % g.cols) - (ci % g.cols), ((cj / g.cols) | 0) - ((ci / g.cols) | 0)) * g.step
      if (len <= maxSpan && clear(cost, g, ci, cj)) break
      j--
    }
    keep.push(cells[j])
    i = j
  }
  return keep
}

/** Poles along a polyline: one on each corner, intermediates spread evenly so no span > spacing. */
export function placePoles(path: number[], spacing: number): number[] {
  const out = [path[0], path[1]]
  for (let i = 0; i + 3 < path.length; i += 2) {
    const ax = path[i], az = path[i + 1], bx = path[i + 2], bz = path[i + 3]
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / spacing))
    for (let k = 1; k <= n; k++) out.push(ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n)
  }
  return out
}

/** Route one power line between two world points. Null when no allowed path exists. */
export function routePowerLine(heights: ArrayLike<number>, grid: Grid, ax: number, az: number, bx: number, bz: number,
  opts: PowerOptions): PowerLine | null {
  const cell = (x: number, z: number) => {
    const c = Math.min(grid.cols - 1, Math.max(0, Math.round((x - grid.minX) / grid.step)))
    const r = Math.min(grid.rows - 1, Math.max(0, Math.round((z - grid.minZ) / grid.step)))
    return r * grid.cols + c
  }
  const cost = costField(heights, grid, opts)
  const s = cell(ax, az), t = cell(bx, bz)
  cost[s] = Math.min(cost[s], 1) // end points are given: always allowed (substation pad)
  cost[t] = Math.min(cost[t], 1)
  const cells = astar(cost, grid, s, t)
  if (!cells) return null
  const spacing = opts.spacing ?? POWER_DEFAULTS[opts.kind].spacing
  // a long straight span is fine for pylons; LV lines keep closer to the winding road
  const corners = straighten(cells, cost, grid, opts.kind === 'hv' ? 5000 : spacing * 6)
  const path: number[] = []
  for (const i of corners) path.push(grid.minX + (i % grid.cols) * grid.step, grid.minZ + ((i / grid.cols) | 0) * grid.step)
  path[0] = ax; path[1] = az; path[path.length - 2] = bx; path[path.length - 1] = bz
  let length = 0
  for (let i = 0; i + 3 < path.length; i += 2) length += Math.hypot(path[i + 2] - path[i], path[i + 3] - path[i + 1])
  return { kind: opts.kind, path, poles: placePoles(path, spacing), length }
}

/** Project shape for the native generator: one point per pole ("Generate per point" on). */
export function powerLineShape(line: PowerLine, id: string): ProjectShape {
  return { id, kind: 'polyline', closed: false, points: line.poles, generator: POWER_GENERATORS[line.kind] }
}
