// Power lines (docs/ROADMAP_NEXT.md §2): routing; wired into the Roads step in main.ts.
// A line between two points (substation -> substation, or substation -> village) is routed with A*
// over the height grid: slope costs (steep cells are forbidden), water is forbidden, cells inside a
// "keep-out" circle (village centres, buildings) are forbidden, cells along a road corridor are
// cheaper (low-voltage lines follow roads, at an offset so poles never sit on the road surface).
// The cell path is then straightened (line-of-sight simplification) and poles are spaced every
// `spacing` metres along each straight span, plus one on every corner. Output = a polyline shape for
// a native PG_PowerLine_* generator ("Generate per point": one pole per point).

import type { Grid } from './island'
import { dedupeLines } from './fenceDedupe.ts'
import type { ProjectShape } from '../project'

export type PowerKind = 'ehv' | 'hv' | 'mv' | 'lv'
/** Pole family: Everon-like (metal / concrete / wooden) or Soviet (Arland USSR poles). */
export type PowerStyle = 'eden' | 'ussr'

/** Native power line generators (SCR_PowerlineGeneratorEntity), GUIDs checked 2026-11 against the base
 *  game data (Prefabs/WEGenerators/Powerline/*.et) and layers referencing them. A bare path would make
 *  an empty generator, so always "{GUID}path". */
export const POWER_GENERATORS: Record<PowerKind, string> = {
  ehv: '{89DEA69A406297CF}Prefabs/WEGenerators/Powerline/PG_PowerLine_EHV_01.et', // m_fDistance 130, start/end pole = TransformerStation110kV_E_01_double
  hv: '{6958471456266DD6}Prefabs/WEGenerators/Powerline/PG_PowerLine_HV_02_Metal.et',
  mv: '{F9CF7B0E9B97B012}Prefabs/WEGenerators/Powerline/PG_PowerLine_HV_01_Concrete.et',
  lv: '{20E4877A07D28502}Prefabs/WEGenerators/Powerline/PG_PowerLine_01_WoodenSmall.et',
}

/** Span between poles (m) = the prefab's own m_fDistance (HV_02 80, HV_01 50, WoodenSmall 35), the
 *  steepest slope a pole may stand on, and the cost factor along roads. */
export const POWER_DEFAULTS: Record<PowerKind, { spacing: number; maxSlope: number; roadBonus: number }> = {
  ehv: { spacing: 130, maxSlope: 0.5, roadBonus: 1 }, // EHV_01 lattice towers, very long straight spans
  hv: { spacing: 80, maxSlope: 0.45, roadBonus: 1 }, // pylons cross country, ignore roads
  mv: { spacing: 50, maxSlope: 0.35, roadBonus: 0.6 },
  lv: { spacing: 35, maxSlope: 0.3, roadBonus: 0.35 }, // wooden poles hug the roads
}

/** Generator per style and level, with its own m_fDistance (read from the .et, GUIDs from layers that
 *  reference them). USSR: HV_USSR_01 (concrete, 50 m) carries HV, HV_03_Wooden (50 m) MV, LV_USSR_01 (40 m) LV. */
export const POWER_STYLE: Record<PowerStyle, Record<PowerKind, { gen: string; spacing: number }>> = {
  eden: {
    ehv: { gen: POWER_GENERATORS.ehv, spacing: 130 },
    hv: { gen: POWER_GENERATORS.hv, spacing: 80 },
    mv: { gen: POWER_GENERATORS.mv, spacing: 50 },
    lv: { gen: POWER_GENERATORS.lv, spacing: 35 },
  },
  ussr: {
    ehv: { gen: POWER_GENERATORS.ehv, spacing: 130 },
    hv: { gen: '{92841BA54D127343}Prefabs/WEGenerators/Powerline/PG_PowerLine_HV_USSR_01.et', spacing: 50 },
    mv: { gen: '{B060731772C6D28D}Prefabs/WEGenerators/Powerline/PG_PowerLine_HV_03_Wooden.et', spacing: 50 },
    lv: { gen: '{6940032A317FFFF0}Prefabs/WEGenerators/Powerline/PG_PowerLine_LV_USSR_01.et', spacing: 40 },
  },
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
  /** extra forbidden cells (houses + clearance, fenced plots: powerroads.ts) */
  block?: (x: number, z: number) => boolean
  /** precomputed cost field (buildPowerCost) shared by many routes of the same kind */
  cost?: Float32Array
}

export interface PowerLine {
  kind: PowerKind
  /** pole family (absent = eden) */
  style?: PowerStyle
  /** pole spacing used (m_fDistance on the generator); absent = POWER_DEFAULTS */
  spacing?: number
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
export function buildPowerCost(h: ArrayLike<number>, g: Grid, o: PowerOptions) { return costField(h, g, o) }

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
      if (k !== Infinity && o.block?.(x, z)) k = Infinity
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
  const cost = opts.cost ?? costField(heights, grid, opts)
  const s = cell(ax, az), t = cell(bx, bz)
  const ks = cost[s], kt = cost[t]
  cost[s] = Math.min(cost[s], 1) // end points are given: always allowed (substation pad)
  cost[t] = Math.min(cost[t], 1)
  const cells = astar(cost, grid, s, t)
  const corners = cells && straighten(cells, cost, grid, opts.kind === 'hv' || opts.kind === 'ehv' ? 5000 : (opts.spacing ?? POWER_DEFAULTS[opts.kind].spacing) * 6)
  cost[s] = ks; cost[t] = kt // shared field: restore
  if (!cells || !corners) return null
  const spacing = opts.spacing ?? POWER_DEFAULTS[opts.kind].spacing
  const path: number[] = []
  for (const i of corners) path.push(grid.minX + (i % grid.cols) * grid.step, grid.minZ + ((i / grid.cols) | 0) * grid.step)
  path[0] = ax; path[1] = az; path[path.length - 2] = bx; path[path.length - 1] = bz
  let length = 0
  for (let i = 0; i + 3 < path.length; i += 2) length += Math.hypot(path[i + 2] - path[i], path[i + 3] - path[i + 1])
  return { kind: opts.kind, spacing, path, poles: placePoles(path, spacing), length }
}

/** Half-width (m) of the cleared corridor along a line: `Clearance` on SCR_PowerlineGeneratorEntity, read by
 *  SCR_ObstacleDetector so a forest generator with m_bAvoidPowerLines leaves no tree closer than that to the
 *  wires. Vanilla prefabs: EHV_01 10, HV_01_Concrete 3, WoodenSmall 3, HV_02_Metal 0 (unset = no corridor at all,
 *  the trees grew right through the pylons). Set explicitly per voltage: EHV 24 m, HV 20 m, MV 12 m, LV 6 m wide. */
export const POWER_CLEARANCE: Record<PowerKind, number> = { ehv: 12, hv: 10, mv: 6, lv: 3 }

/** (x, z) => true within the cleared corridor of one of the lines (POWER_CLEARANCE half-width) */
export function powerCorridorTest(lines: Pick<PowerLine, 'kind' | 'path'>[]): (x: number, z: number) => boolean {
  const segs: number[] = [] // x0 z0 x1 z1 r
  for (const l of lines) {
    const r = POWER_CLEARANCE[l.kind] ?? 3
    for (let i = 0; i + 3 < l.path.length; i += 2) segs.push(l.path[i], l.path[i + 1], l.path[i + 2], l.path[i + 3], r)
  }
  return (x, z) => {
    for (let k = 0; k < segs.length; k += 5) {
      const ax = segs[k], az = segs[k + 1], bx = segs[k + 2], bz = segs[k + 3], r = segs[k + 4]
      if (x < Math.min(ax, bx) - r || x > Math.max(ax, bx) + r || z < Math.min(az, bz) - r || z > Math.max(az, bz) + r) continue
      const ex = bx - ax, ez = bz - az, l2 = ex * ex + ez * ez || 1
      const u = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / l2)), qx = ax + u * ex - x, qz = az + u * ez - z
      if (qx * qx + qz * qz < r * r) return true
    }
    return false
  }
}

/** Ground of the corridor where it crosses a forest: same mask format as roadMasks, `core` (grass) painted over
 *  the forest floor, so the 2D surfaces show the clearing the forest generator cuts in 3D. One stroke per run of
 *  the line inside a forest ring (sampled every 4 m). */
export function powerCorridorMasks(lines: Pick<PowerLine, 'kind' | 'path'>[], inForest: (x: number, z: number) => boolean, core = 'Grass_01') {
  const out: { points: number[]; half: number; edge: number; core: string }[] = []
  for (const l of lines) {
    const half = POWER_CLEARANCE[l.kind] ?? 3
    let run: number[] = []
    const flush = () => { if (run.length >= 4) out.push({ points: run, half, edge: 2, core }); run = [] }
    for (let i = 0; i + 3 < l.path.length; i += 2) {
      const ax = l.path[i], az = l.path[i + 1], bx = l.path[i + 2], bz = l.path[i + 3]
      const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 4))
      for (let k = i ? 1 : 0; k <= n; k++) {
        const x = ax + ((bx - ax) * k) / n, z = az + ((bz - az) * k) / n
        // a little past the edge on both sides, so the strip meets the open ground
        if (inForest(x, z) || inForest(x + (bx - ax) / n * 2, z + (bz - az) / n * 2) || inForest(x - (bx - ax) / n * 2, z - (bz - az) / n * 2)) run.push(x, z)
        else flush()
      }
    }
    flush()
  }
  return out
}

/** Project shape for the native generator. The generator itself spaces poles every m_fDistance along
 *  the polyline (plus one on start / end / each corner it needs), so the shape carries the corners of
 *  the route and m_fDistance is set to our spacing: the preview poles match what Workbench builds. */
export function powerLineShape(line: PowerLine, id: string): ProjectShape {
  const spacing = line.spacing ?? POWER_DEFAULTS[line.kind].spacing
  return { id, kind: 'polyline', closed: false, points: simplifyPath(line.path, 1), generator: line.style ? POWER_STYLE[line.style][line.kind].gen : POWER_GENERATORS[line.kind], paramKeys: ['m_fDistance', 'm_bNextPointMeasurementXZ', 'Clearance'], paramValues: [String(spacing), '1', String(POWER_CLEARANCE[line.kind])] }
}

const KIND_RANK: Record<PowerKind, number> = { ehv: 0, hv: 1, mv: 2, lv: 3 }

/** Several lines routed on the same corridor (e.g. two LV feeders leaving one station along the same road)
 *  each got their own poles: two or three pole rows side by side in the Workbench. Same-kind lines are
 *  merged like fences (dedupeLines): the parts of a line within `tol` m of an already kept one are dropped,
 *  and each remaining piece is tied to the kept line where it branches off. Higher voltages are kept first. */
export function mergePowerLines<T extends PowerLine & { id: string }>(lines: T[], tol = 15, poleOk?: (x: number, z: number) => boolean): T[] {
  const order = lines.map((_, i) => i).sort((a, b) => KIND_RANK[lines[a].kind] - KIND_RANK[lines[b].kind] || a - b)
  const out: T[] = []
  for (const kind of Object.keys(KIND_RANK) as PowerKind[]) {
    const idx = order.filter((i) => lines[i].kind === kind)
    if (!idx.length) continue
    const pieces = dedupeLines(idx.map((i) => lines[i].path), tol, 2)
    const kept: number[][] = []
    idx.forEach((li, n) => {
      const src = lines[li], ps = pieces[n]
      const whole = ps.length === 1 && ps[0][0] === src.path[0] && ps[0][1] === src.path[1] && ps[0][ps[0].length - 2] === src.path[src.path.length - 2] && ps[0][ps[0].length - 1] === src.path[src.path.length - 1]
      ps.forEach((p, k) => {
        let path = p
        if (!whole) {
          // tie the piece back onto the kept line it leaves / joins (its cut ends sit ~tol from it)
          const snap = (x: number, z: number) => {
            let bd = tol * 1.5, bx = NaN, bz = NaN
            for (const q of kept) for (let i = 0; i + 3 < q.length; i += 2) {
              const ax = q[i], az = q[i + 1], dx = q[i + 2] - ax, dz = q[i + 3] - az, l2 = dx * dx + dz * dz
              const t = l2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2)) : 0
              const d = Math.hypot(ax + t * dx - x, az + t * dz - z)
              if (d < bd && d > 0.5) { bd = d; bx = ax + t * dx; bz = az + t * dz }
            }
            return Number.isNaN(bx) ? null : [bx, bz]
          }
          const a = snap(p[0], p[1]), b = snap(p[p.length - 2], p[p.length - 1])
          path = [...(a ?? []), ...p, ...(b ?? [])]
          // the cut ends and tie points are new poles: off the houses when a check is given (seed 21 live audit:
          // a tie point 1.3 m from a hamlet house). Slid along their own span (3..15 m), dropped if none is free.
          if (poleOk) path = freeEnds(path, poleOk)
        }
        let length = 0
        for (let i = 0; i + 3 < path.length; i += 2) length += Math.hypot(path[i + 2] - path[i], path[i + 3] - path[i + 1])
        out.push({ ...src, id: k ? `${src.id}_m${k + 1}` : src.id, path, poles: whole ? src.poles : placePoles(path, src.spacing ?? POWER_DEFAULTS[src.kind].spacing), length })
        kept.push(path)
      })
    })
  }
  return out
}

/** Douglas-Peucker on a flat x/z list. SCR_PowerlineGeneratorEntity walks the polyline every m_fDistance
 *  and puts no pole on interior anchors, so the shape only needs the corners of the route: the generator's
 *  own spacing then sets the poles (no point-per-pole list that it re-spaces into odd short spans). */
export function simplifyPath(p: number[], tol: number): number[] {
  const n = p.length / 2
  if (n <= 2) return p
  const keep = new Uint8Array(n); keep[0] = keep[n - 1] = 1
  const st: [number, number][] = [[0, n - 1]]
  while (st.length) {
    const [a, b] = st.pop()!
    const ax = p[2 * a], az = p[2 * a + 1], dx = p[2 * b] - ax, dz = p[2 * b + 1] - az, l2 = dx * dx + dz * dz
    let bi = -1, bd = tol
    for (let i = a + 1; i < b; i++) {
      const t = l2 ? Math.max(0, Math.min(1, ((p[2 * i] - ax) * dx + (p[2 * i + 1] - az) * dz) / l2)) : 0
      const d = Math.hypot(ax + t * dx - p[2 * i], az + t * dz - p[2 * i + 1])
      if (d > bd) { bd = d; bi = i }
    }
    if (bi > 0) { keep[bi] = 1; st.push([a, bi], [bi, b]) }
  }
  const o: number[] = []
  for (let i = 0; i < n; i++) if (keep[i]) o.push(p[2 * i], p[2 * i + 1])
  return o
}

//! disturbed ground under each pole / pylon, same mask format as roadMasks (bridge paints the bands).
//! An irregular blob = a few short overlapping stubs with seeded jitter around the pole (never a
//! perfect circle), soft edge. Radius ~2 m for LV/MV wooden poles, ~5 m for HV/EHV pylons (1.2 m was
//! under the 1 m mask pixel + bilinear blur and the block limiter dropped it as a tiny share: never seen
//! in game, seed 21 x 2512 z 3108). Partial weight (`peak`, disturbed soil mixed with the grass) and a
//! block-limiter priority (`prio`) so the patch survives.
export const POLE_PATCH_RADIUS: Record<PowerKind, number> = { lv: 2, mv: 2, hv: 5, ehv: 5 }
export function poleDirtMasks(lines: Pick<PowerLine, 'kind' | 'poles'>[], seed = 1, core = 'Dirt_01') {
  const out: { points: number[]; half: number; edge: number; core: string; peak: number; prio: number }[] = []
  for (const l of lines) {
    const R = POLE_PATCH_RADIUS[l.kind] ?? 1.2
    for (let i = 0; i + 1 < l.poles.length; i += 2) {
      const x = l.poles[i], z = l.poles[i + 1]
      // deterministic per pole: hash of seed + rounded position
      let s = (Math.imul(Math.round(x * 10), 73856093) ^ Math.imul(Math.round(z * 10), 19349663) ^ Math.imul(seed | 0, 83492791)) >>> 0
      const rnd = () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
      const lobes = 3 + Math.floor(rnd() * 3)
      for (let k = 0; k < lobes; k++) {
        const a = (k / lobes) * Math.PI * 2 + rnd() * 1.2, off = R * (0.15 + rnd() * 0.35)
        const cx = x + Math.cos(a) * off, cz = z + Math.sin(a) * off
        const b = rnd() * Math.PI, len = R * (0.2 + rnd() * 0.5)
        const half = R * (0.35 + rnd() * 0.3)
        out.push({ points: [cx - Math.cos(b) * len / 2, cz - Math.sin(b) * len / 2, cx + Math.cos(b) * len / 2, cz + Math.sin(b) * len / 2], half, edge: R * (0.4 + rnd() * 0.4), core, peak: 0.55 + rnd() * 0.3, prio: 8 })
      }
    }
  }
  return out
}

/** the first 2 and last 2 points of a merged piece (tie + cut end) moved along their span onto a valid spot */
function freeEnds(p: number[], ok: (x: number, z: number) => boolean): number[] {
  const q = p.slice(), n = q.length / 2
  for (const i of [0, 1, n - 2, n - 1]) {
    if (i < 0 || i >= n || ok(q[i * 2], q[i * 2 + 1])) continue
    const j = i < n / 2 ? i + 1 : i - 1
    if (j < 0 || j >= n) continue
    const dx = q[j * 2] - q[i * 2], dz = q[j * 2 + 1] - q[i * 2 + 1], L = Math.hypot(dx, dz) || 1
    for (let s = 3; s <= Math.min(15, L - 1); s += 3) {
      const x = q[i * 2] + (dx / L) * s, z = q[i * 2 + 1] + (dz / L) * s
      if (ok(x, z)) { q[i * 2] = x; q[i * 2 + 1] = z; break }
    }
  }
  return q
}

/** Branch points for the Workbench junction poles (POWERGRID_LOGIC §5): a line end lying on another line of the same
 *  generator (within `tol` m) is snapped onto it, a vertex is inserted there when needed, and that vertex index is
 *  listed in `junctions` of the parent shape (m_JunctionData, LV: PowerLine_01_pole_small_hook_junction). In place. */
export function tieJunctions(shapes: ProjectShape[], tol = 2): void {
  for (const sh of shapes) {
    if (sh.kind !== 'polyline') continue
    for (const k of [0, -1]) {
      const n = sh.points.length, ix = k === 0 ? 0 : n - 2, px = sh.points[ix], pz = sh.points[ix + 1]
      let best: { o: ProjectShape; i: number; t: number; d: number } | null = null
      for (const o of shapes) {
        if (o === sh || o.generator !== sh.generator || o.kind !== 'polyline') continue
        const p = o.points
        for (let i = 0; i + 3 < p.length; i += 2) {
          const dx = p[i + 2] - p[i], dz = p[i + 3] - p[i + 1], L = dx * dx + dz * dz || 1
          const t = Math.max(0, Math.min(1, ((px - p[i]) * dx + (pz - p[i + 1]) * dz) / L))
          const d = Math.hypot(p[i] + t * dx - px, p[i + 1] + t * dz - pz)
          if (d < tol && (!best || d < best.d)) best = { o, i, t, d }
        }
      }
      if (!best) continue
      const { o, i } = best, p = o.points
      // nearest existing vertex within 1 m, else a new one on the segment
      let vi: number
      const at = (j: number) => Math.hypot(p[j] - px, p[j + 1] - pz)
      if (at(i) < 1) vi = i / 2
      else if (at(i + 2) < 1) vi = i / 2 + 1
      else {
        const x = p[i] + best.t * (p[i + 2] - p[i]), z = p[i + 1] + best.t * (p[i + 3] - p[i + 1])
        p.splice(i + 2, 0, x, z)
        if (o.lift) o.lift.splice(i / 2 + 1, 0, (o.lift[i / 2] + (o.lift[i / 2 + 1] ?? o.lift[i / 2])) / 2)
        o.junctions = (o.junctions ?? []).map((j) => (j > i / 2 ? j + 1 : j))
        vi = i / 2 + 1
      }
      if (vi === 0 || vi === p.length / 2 - 1) continue // end to end: the generator reconnects extremities itself
      sh.points[ix] = p[vi * 2]; sh.points[ix + 1] = p[vi * 2 + 1]
      if (!(o.junctions ?? []).includes(vi)) o.junctions = [...(o.junctions ?? []), vi].sort((a, b) => a - b)
    }
  }
}
