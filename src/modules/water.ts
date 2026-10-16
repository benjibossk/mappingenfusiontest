// Water drawn by hand on the site: rivers (open line) and lakes (closed outline).
// The site carves the bed / basin into the relief (only lowers it), then sends a shape with a water
// generator whose points sit at the water level (the generators never shape the terrain).

import type { Grid } from './island'
import { t } from '../i18n'
import type { ProjectEntity, ProjectShape } from '../project'
import { centreLine } from './roads'

export type WaterType = 'river' | 'lake' | 'lakeMountain' | 'lakeCain' | 'lakeDirty' | 'drainage' | 'pool'

//! generator: bare paths are resolved to GUIDs by the plugin
export const WATER_TYPES: Record<WaterType, { label: string; generator: string; closed: boolean; colour: string }> = {
  river: { label: t('water.type.river'), generator: 'Prefabs/WEGenerators/Water/River/R_RiverMedium_01.et', closed: false, colour: '#3f8fd8' },
  lake: { label: t('water.type.lake'), generator: '{1F2254A7C9C8AA57}Prefabs/WEGenerators/Water/Lake/LG_Lake_01.et', closed: true, colour: '#3a7fc4' },
  lakeMountain: { label: t('water.type.lakeMountain'), generator: 'Prefabs/WEGenerators/Water/Lake/LG_LakeMountain_01.et', closed: true, colour: '#4c9ad6' },
  lakeCain: { label: t('water.type.lakeCain'), generator: 'Prefabs/WEGenerators/Water/Lake/LG_CainLake_01.et', closed: true, colour: '#2e5f8a' },
  lakeDirty: { label: t('water.type.lakeDirty'), generator: 'Prefabs/WEGenerators/Water/Lake/LG_LakeDirty_01.et', closed: true, colour: '#5b7a5a' },
  drainage: { label: t('water.type.drainage'), generator: 'Prefabs/WEGenerators/Water/Lake/LG_DirtyDrainage_01.et', closed: true, colour: '#6b7a4a' },
  pool: { label: t('water.type.pool'), generator: 'Prefabs/WEGenerators/Water/Pool/LG_Pool_01.et', closed: true, colour: '#5fc0e8' },
}

export interface Water {
  id: string
  type: WaterType
  pts: number[] // control points, flat X/Z (river: upstream first)
  width: number // river width, metres (lakes: unused)
  depth: number // depth below the water level, metres
  auto?: boolean // traced from the simulated rivers (replaced on regeneration)
  carve?: boolean // river: dig a bed; otherwise the water just lies on the ground (banks may cover it)
}

//! River course the generator can mesh: sharp vertices dropped, corners rounded (Chaikin), so that
//! no bend is tighter than the river width (tighter bends fold the water mesh = invalid segments).
export function riverCourse(pts: number[], width: number): number[] {
  let p = pts.slice()
  const maxTurn = (50 * Math.PI) / 180
  for (let changed = true; changed && p.length > 4;) {
    changed = false
    for (let i = 2; i + 3 < p.length; i += 2) {
      const a1 = Math.atan2(p[i + 1] - p[i - 1], p[i] - p[i - 2]), a2 = Math.atan2(p[i + 3] - p[i + 1], p[i + 2] - p[i])
      let d = Math.abs(a2 - a1)
      if (d > Math.PI) d = 2 * Math.PI - d
      if (d > maxTurn) { p.splice(i, 2); changed = true; break }
    }
  }
  // Chaikin: each pass cuts every corner at 1/4 - 3/4, ends kept
  const passes = width > 14 ? 4 : 3
  for (let k = 0; k < passes && p.length >= 6; k++) {
    const q = [p[0], p[1]]
    for (let i = 0; i + 3 < p.length; i += 2) {
      const ax = p[i], az = p[i + 1], bx = p[i + 2], bz = p[i + 3]
      q.push(ax * 0.75 + bx * 0.25, az * 0.75 + bz * 0.25, ax * 0.25 + bx * 0.75, az * 0.25 + bz * 0.75)
    }
    q.push(p[p.length - 2], p[p.length - 1])
    p = q
  }
  return p
}

const sampler = (heights: ArrayLike<number>, grid: Grid) => {
  const { cols, rows, step } = grid
  return (x: number, z: number) => {
    const gx = Math.min(Math.max(x / step, 0), cols - 1.001), gz = Math.min(Math.max(z / step, 0), rows - 1.001)
    const c = Math.floor(gx), r = Math.floor(gz), fx = gx - c, fz = gz - r
    const i = r * cols + c
    const a = heights[i] + (heights[i + 1] - heights[i]) * fx
    const b = heights[i + cols] + (heights[i + cols + 1] - heights[i + cols]) * fx
    return a + (b - a) * fz
  }
}

//! lake: water level = lowest point of the outline (the outline is then lowered to it)
function lakeLevel(w: Water, at: (x: number, z: number) => number) {
  const ring = closedRing(w.pts, 4)
  let m = Infinity
  for (let i = 0; i < ring.length; i += 2) m = Math.min(m, at(ring[i], ring[i + 1]))
  return Math.max(m - 0.3, 0.3)
}

//! outline resampled every `spacing` metres (straight segments), closed
function closedRing(pts: number[], spacing: number) {
  const out: number[] = []
  const n = pts.length / 2
  for (let i = 0; i < n; i++) {
    const ax = pts[i * 2], az = pts[i * 2 + 1], bx = pts[((i + 1) % n) * 2], bz = pts[((i + 1) % n) * 2 + 1]
    const k = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / spacing))
    for (let s = 0; s < k; s++) out.push(ax + ((bx - ax) * s) / k, az + ((bz - az) * s) / k)
  }
  return out
}

const inside = (pts: number[], x: number, z: number) => {
  let c = false
  for (let i = 0, j = pts.length - 2; i < pts.length; j = i, i += 2) {
    const xi = pts[i], zi = pts[i + 1], xj = pts[j], zj = pts[j + 1]
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c
  }
  return c
}

//! Carves river beds and lake basins (in place, only lowers). Bank slope ~1:3 over at least 2 grid cells.
//! water surface under the original ground (m), and the generator width relative to the channel
const RIVER_SURFACE = 0.5
const RIVER_OVERWIDTH = 1.3
const RIVER_BANK = 0.5 // bank top above the water
const RIVER_MAXCUT = 2.5
const sstep = (t: number) => { const u = Math.min(1, Math.max(0, t)); return u * u * (3 - 2 * u) }

//! water level along the river: RIVER_SURFACE under the lowest original ground across the water
//! width, never rising downstream, smoothed; at the mouth it comes down gently (2 cm/m) to just
//! under the sea surface. `sea` = first sample in the sea (-1: none).
//! river course oriented downhill: a river drawn from the sea up would get the sea level all the
//! way inland (the profile never rises downstream) = a canyon
function downhillCourse(w: Water, at: (x: number, z: number) => number) {
  const c = riverCourse(w.pts, w.width)
  if (at(c[0], c[1]) >= at(c[c.length - 2], c[c.length - 1])) return c
  const r: number[] = []
  for (let i = c.length - 2; i >= 0; i -= 2) r.push(c[i], c[i + 1])
  return r
}

function riverProfile(w: Water, at: (x: number, z: number) => number) {
  const line = centreLine(downhillCourse(w, at), 4)
  const n = line.length / 2
  const edge = (w.width * RIVER_OVERWIDTH) / 2
  const raw: number[] = []
  let sea = -1
  for (let i = 0; i < n; i++) {
    const x = line[i * 2], z = line[i * 2 + 1]
    const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1)
    let tx = line[b * 2] - line[a * 2], tz = line[b * 2 + 1] - line[a * 2 + 1]
    const L = Math.hypot(tx, tz) || 1
    tx /= L; tz /= L
    const g = at(x, z)
    if (sea < 0 && g < 0) sea = i
    raw.push(Math.min(g, at(x - tz * edge, z + tx * edge), at(x + tz * edge, z - tx * edge)) - RIVER_SURFACE)
  }
  // never rising downstream, but never more than RIVER_MAXCUT under the ground either: past that
  // the water steps up a little rather than sitting at the bottom of a gorge
  const ground = raw.slice()
  for (let i = 1; i < n; i++) raw[i] = Math.max(Math.min(raw[i], raw[i - 1]), ground[i] - RIVER_MAXCUT)
  const R = 6
  const level = raw.map((_, i) => {
    let s = 0, k = 0
    for (let j = Math.max(0, i - R); j <= Math.min(n - 1, i + R); j++) { s += raw[j]; k++ }
    return Math.min(s / k, raw[i])
  })
  if (sea >= 0) {
    let d = 0
    for (let i = sea; i >= 0; i--) {
      if (i < sea) d += Math.hypot(line[i * 2 + 2] - line[i * 2], line[i * 2 + 3] - line[i * 2 + 1])
      level[i] = Math.max(Math.min(level[i], -0.05 + 0.02 * d), Math.min(level[i], ground[i] - RIVER_MAXCUT))
    }
    for (let i = sea; i < n; i++) level[i] = -0.05
  }
  return { line, level, sea }
}

//! painted under each river: pebbles in the bed, dirt on the wet banks (same format as roadMasks)
export function waterMasks(waters: Water[]) {
  return waters.filter((w) => !WATER_TYPES[w.type].closed && w.pts.length >= 4)
    .map((w) => ({ points: centreLine(riverCourse(w.pts, w.width), 4), half: w.width / 2, edge: 2, core: 'Pebbles_01', side: 'Dirt_01' }))
}

export function carveWater(heights: number[], grid: Grid, waters: Water[]) {
  const { cols, rows, step } = grid
  const at = sampler(heights.slice(), grid)
  const target = new Float32Array(heights.length).fill(Infinity)
  const lower = (k: number, v: number) => { if (v < target[k]) target[k] = v }
  const shaped = new Float32Array(heights.length)
  const shapedScore = new Float32Array(heights.length).fill(Infinity)

  for (const w of waters) {
    if (w.pts.length < 4) continue
    if (!WATER_TYPES[w.type].closed) {
      // the terrain is shaped to the river, not the other way round: a smooth water profile that
      // never rises downstream, a bed under it, banks just above it, then a blend back to the
      // original ground over `fall` metres (the ground is lowered OR raised there)
      const { line, level } = riverProfile(w, at)
      const half = Math.max(w.width / 2, step) // the grid cannot hold a narrower channel
      const fall = Math.max(2 * step, w.width)
      const reach = half + fall
      const ramp = Math.max(3 * w.width, 2 * step) // the source must not end in a dug pit
      let along = 0
      for (let i = 0; i + 1 < line.length / 2; i++) {
        const ax = line[i * 2], az = line[i * 2 + 1], bx = line[i * 2 + 2], bz = line[i * 2 + 3]
        const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1
        const segLen = Math.sqrt(L2)
        const c0 = Math.max(0, Math.floor((Math.min(ax, bx) - reach) / step)), c1 = Math.min(cols - 1, Math.ceil((Math.max(ax, bx) + reach) / step))
        const r0 = Math.max(0, Math.floor((Math.min(az, bz) - reach) / step)), r1 = Math.min(rows - 1, Math.ceil((Math.max(az, bz) + reach) / step))
        for (let r = r0; r <= r1; r++)
          for (let c = c0; c <= c1; c++) {
            const x = c * step, z = r * step
            const tt = Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / L2))
            const d = Math.hypot(x - ax - dx * tt, z - az - dz * tt)
            if (d >= reach) continue
            const k = r * cols + c
            const score = d / reach
            if (score >= shapedScore[k]) continue // the nearest river shapes the cell
            const wl = level[i] + (level[i + 1] - level[i]) * tt
            const depth = w.depth * Math.min(1, (along + tt * segLen) / ramp)
            let v: number
            if (d <= half) {
              const t = Math.max(0, (d / half - 0.4) / 0.6) // flat bed to 40 %, then up to the bank top
              v = wl - depth + (depth + RIVER_BANK) * sstep(t)
            } else v = wl + RIVER_BANK + (at(x, z) - wl - RIVER_BANK) * sstep((d - half) / fall)
            if (at(x, z) < 0) v = Math.min(v, at(x, z)) // never build banks up in the sea
            shapedScore[k] = score
            shaped[k] = v
          }
        along += segLen
      }
    } else {
      const L = lakeLevel(w, at)
      const ring = closedRing(w.pts, step / 2)
      const ramp = Math.max(step, w.depth * 2) // shore slope inside, metres
      const bank = step // outside: the rim comes down just above the water level
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity
      for (let i = 0; i < ring.length; i += 2) {
        minX = Math.min(minX, ring[i]); maxX = Math.max(maxX, ring[i])
        minZ = Math.min(minZ, ring[i + 1]); maxZ = Math.max(maxZ, ring[i + 1])
      }
      const c0 = Math.max(0, Math.floor((minX - bank) / step)), c1 = Math.min(cols - 1, Math.ceil((maxX + bank) / step))
      const r0 = Math.max(0, Math.floor((minZ - bank) / step)), r1 = Math.min(rows - 1, Math.ceil((maxZ + bank) / step))
      for (let r = r0; r <= r1; r++)
        for (let c = c0; c <= c1; c++) {
          const x = c * step, z = r * step
          let d = Infinity
          for (let i = 0; i < ring.length; i += 2) d = Math.min(d, Math.hypot(ring[i] - x, ring[i + 1] - z))
          if (inside(w.pts, x, z)) {
            const u = Math.min(1, d / ramp)
            lower(r * cols + c, L - 0.2 - w.depth * u * u * (3 - 2 * u))
          } else if (d < bank) lower(r * cols + c, L + 0.3 + 1.5 * (d / bank))
        }
    }
  }
  for (let k = 0; k < heights.length; k++) {
    if (shapedScore[k] < Infinity) heights[k] = shaped[k]
    if (target[k] < heights[k]) heights[k] = target[k]
  }
}

//! shapes for the Workbench; `before` = relief before carving (gives the water level)
//! `after` = final relief sent to the Workbench: each point gets lift = water level - ground there, so the
//! water sits right in the bed whatever height offset the Workbench terrain has
export function waterShapes(waters: Water[], before: ArrayLike<number>, after: ArrayLike<number>, grid: Grid): ProjectShape[] {
  const at = sampler(before, grid)
  const ground = sampler(after, grid)
  const out: ProjectShape[] = []
  for (const w of waters) {
    if (w.pts.length < 4) continue
    const wt = WATER_TYPES[w.type]
    const r2 = (v: number) => Math.round(v * 100) / 100
    if (!wt.closed) {
      const pts = centreLine(downhillCourse(w, at), Math.max(10, w.width * 0.8))
      // the water sits on the profile the terrain was shaped to (nearest profile sample)
      const { line, level, sea: seaAt } = riverProfile(w, at)
      const n = pts.length / 2
      const lift: number[] = []
      let sea = -1
      for (let i = 0; i < n; i++) {
        let best = 0, bd = Infinity
        for (let j = 0; j < line.length; j += 2) {
          const d = (line[j] - pts[i * 2]) ** 2 + (line[j + 1] - pts[i * 2 + 1]) ** 2
          if (d < bd) { bd = d; best = j / 2 }
        }
        if (sea < 0 && seaAt >= 0 && best >= seaAt) sea = i
        lift.push(r2(Math.max(0.1, level[best] - ground(pts[i * 2], pts[i * 2 + 1]))))
      }
      // a river running on under the sea would show through it: stop one point past the shore
      const keep = sea >= 0 ? Math.min(n, Math.max(sea + 2, 2)) : n
      pts.length = keep * 2
      lift.length = keep
      out.push({ id: w.id, kind: 'spline', closed: false, points: pts.map(r2), generator: wt.generator, paramKeys: ['Width'], paramValues: [String(Math.round(w.width * RIVER_OVERWIDTH))], lift })
    } else {
      if (w.pts.length < 6) continue
      const L = lakeLevel(w, at)
      // the generator wants clockwise points seen from above (prefabs with Reverse Point Order: the other way)
      let pts = w.pts.slice()
      let area = 0
      for (let i = 0, j = pts.length - 2; i < pts.length; j = i, i += 2) area += pts[j] * pts[i + 1] - pts[i] * pts[j + 1]
      const wantCw = w.type !== 'lakeCain' && w.type !== 'drainage'
      if (area > 0 === wantCw) {
        const r: number[] = []
        for (let i = pts.length - 2; i >= 0; i -= 2) r.push(pts[i], pts[i + 1])
        pts = r
      }
      const lift: number[] = []
      for (let i = 0; i < pts.length; i += 2) lift.push(r2(Math.max(0, L - ground(pts[i], pts[i + 1]))))
      out.push({ id: w.id, kind: 'polyline', closed: true, points: pts.map(r2), generator: wt.generator, lift })
    }
  }
  return out
}

//! shortens a polyline by `len` metres at its end
function trimEnd(pts: number[], len: number): number[] {
  const p = pts.slice()
  while (len > 0 && p.length >= 4) {
    const n = p.length
    const seg = Math.hypot(p[n - 2] - p[n - 4], p[n - 1] - p[n - 3])
    if (seg > len) {
      const f = (seg - len) / seg
      p[n - 2] = p[n - 4] + (p[n - 2] - p[n - 4]) * f
      p[n - 1] = p[n - 3] + (p[n - 1] - p[n - 3]) * f
      break
    }
    len -= seg
    p.length -= 2
  }
  return p
}

//! Douglas-Peucker on flat X/Z pairs
function simplifyLine(pts: number[], tol: number): number[] {
  const n = pts.length / 2
  if (n < 3) return pts.slice()
  const keep = new Uint8Array(n)
  keep[0] = keep[n - 1] = 1
  const stack: [number, number][] = [[0, n - 1]]
  while (stack.length) {
    const [a, b] = stack.pop()!
    const ax = pts[a * 2], az = pts[a * 2 + 1], dx = pts[b * 2] - ax, dz = pts[b * 2 + 1] - az
    const L = Math.hypot(dx, dz) || 1
    let best = -1, bd = tol
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((pts[i * 2] - ax) * dz - (pts[i * 2 + 1] - az) * dx) / L
      if (d > bd) { bd = d; best = i }
    }
    if (best > 0) { keep[best] = 1; stack.push([a, best], [best, b]) }
  }
  const out: number[] = []
  for (let i = 0; i < n; i++) if (keep[i]) out.push(pts[i * 2], pts[i * 2 + 1])
  return out
}

//! Turns the simulated river cells (flow >= threshold) into drawn rivers: longest courses first,
//! tributaries stop where they meet a course already traced; width grows with the flow.
export function traceRivers(heights: ArrayLike<number>, grid: Grid, flow: Float32Array, down: Int32Array, threshold: number, depth: number, minLen = 120): Omit<Water, 'id'>[] {
  const { cols, step } = grid
  const n = heights.length
  const isRiver = (i: number) => heights[i] > 0 && flow[i] >= threshold
  const hasUp = new Uint8Array(n)
  for (let i = 0; i < n; i++) if (isRiver(i) && down[i] >= 0) hasUp[down[i]] = 1
  // full course from every source down to the sea / border
  const walks: number[][] = []
  for (let i = 0; i < n; i++) {
    if (!isRiver(i) || hasUp[i]) continue
    const w = [i]
    let k = i, guard = 0
    while (down[k] >= 0 && guard++ < n) {
      k = down[k]
      w.push(k)
      if (heights[k] <= 0) break // reached the sea
    }
    walks.push(w)
  }
  walks.sort((a, b) => b.length - a.length)
  const used = new Float32Array(n) // width of the course already through this cell (0 = free)
  const out: Omit<Water, 'id'>[] = []
  for (const w of walks) {
    const cells: number[] = []
    let joinW = 0
    for (const k of w) {
      cells.push(k)
      if (used[k]) { joinW = used[k]; break } // joins a course already traced
    }
    if (cells.length * step < minLen) continue
    const last = cells[cells.length - 1]
    const s = Math.min(1, Math.sqrt(Math.max(0, flow[last] / threshold - 1)) / 4)
    const width = Math.round(6 + 18 * s)
    for (const k of cells) if (!used[k]) used[k] = width
    let pts: number[] = []
    for (const k of cells) pts.push((k % cols) * step, Math.floor(k / cols) * step)
    pts = simplifyLine(pts, step * 1.5)
    // a tributary stops just inside the main river's bank: no doubled water across the main bed
    if (joinW) pts = trimEnd(pts, joinW * 0.2)
    if (pts.length < 4) continue
    out.push({ type: 'river', pts, width: Math.min(width, joinW || width), depth })
  }
  return out
}

//! Cuts every ROAD_ shape (road splines and their barriers / posts) where it crosses water: the part over a
//! river (half width + margin) or inside a lake is removed, leaving a gap for a bridge. Pieces are named
//! <id>_A, <id>_B... The gaps are returned (bridge ends) for the future bridge generator.
export function splitAtWater(shapes: ProjectShape[], waters: Water[], margin = 4) {
  const courses = waters.filter((w) => !WATER_TYPES[w.type].closed && w.pts.length >= 4).map((w) => ({ c: riverCourse(w.pts, w.width), half: w.width / 2 + margin }))
  const lakes = waters.filter((w) => WATER_TYPES[w.type].closed && w.pts.length >= 6)
  const wet = (x: number, z: number) => {
    for (const l of lakes) if (inside(l.pts, x, z)) return true
    for (const { c, half } of courses)
      for (let i = 0; i + 3 < c.length; i += 2) {
        const ax = c[i], az = c[i + 1], dx = c[i + 2] - ax, dz = c[i + 3] - az, L2 = dx * dx + dz * dz || 1
        const t = Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / L2))
        if (Math.hypot(x - ax - dx * t, z - az - dz * t) < half) return true
      }
    return false
  }
  // last dry point between a dry point a and a wet point b (bisection)
  const edge = (ax: number, az: number, bx: number, bz: number): [number, number] => {
    let lo = 0, hi = 1
    for (let k = 0; k < 12; k++) {
      const m = (lo + hi) / 2
      if (wet(ax + (bx - ax) * m, az + (bz - az) * m)) hi = m
      else lo = m
    }
    return [ax + (bx - ax) * lo, az + (bz - az) * lo]
  }
  const out: ProjectShape[] = []
  const gaps: { id: string; from: [number, number]; to: [number, number] }[] = []
  if (!courses.length && !lakes.length) return { shapes, gaps }
  for (const s of shapes) {
    if (!s.id.startsWith('ROAD_') || s.closed) { out.push(s); continue }
    const p = s.points, n = p.length / 2
    const isWet = Array.from({ length: n }, (_, i) => wet(p[i * 2], p[i * 2 + 1]))
    if (!isWet.some(Boolean)) { out.push(s); continue }
    const runs: number[][] = []
    let cur: number[] = []
    let gapStart: [number, number] | null = null
    for (let i = 0; i < n; i++) {
      const x = p[i * 2], z = p[i * 2 + 1]
      if (!isWet[i]) {
        if (i > 0 && isWet[i - 1]) {
          const e = edge(x, z, p[i * 2 - 2], p[i * 2 - 1])
          if (gapStart) gaps.push({ id: s.id, from: gapStart, to: e })
          gapStart = null
          cur.push(e[0], e[1])
        }
        cur.push(x, z)
      } else if (i > 0 && !isWet[i - 1]) {
        const e = edge(p[i * 2 - 2], p[i * 2 - 1], x, z)
        cur.push(e[0], e[1])
        runs.push(cur)
        cur = []
        gapStart = e
      }
    }
    if (cur.length) runs.push(cur)
    let k = 0
    for (const raw of runs) {
      // the cut point can land right next to an existing vertex: a segment of a few cm is an
      // "invalid segment" for the road generator, so drop vertices too close to their neighbour
      const r: number[] = [raw[0], raw[1]]
      for (let i = 2; i < raw.length; i += 2) {
        const last = i + 2 >= raw.length
        if (Math.hypot(raw[i] - r[r.length - 2], raw[i + 1] - r[r.length - 1]) < 5) {
          if (last && r.length > 2) { r[r.length - 2] = raw[i]; r[r.length - 1] = raw[i + 1] }
          continue
        }
        r.push(raw[i], raw[i + 1])
      }
      let len = 0
      for (let i = 2; i < r.length; i += 2) len += Math.hypot(r[i] - r[i - 2], r[i + 1] - r[i - 1])
      if (r.length < 4 || len < 15) continue
      out.push({ ...s, id: `${s.id}_${String.fromCharCode(65 + k++)}`, points: r.map((v) => Math.round(v * 100) / 100) })
    }
  }
  return { shapes: out, gaps }
}

// --- eroded banks: ErodedEmbankment_01 pieces on the bank crest, facing the water ---

const EMBANK = {
  straight: '{929564697C6FBF5D}Prefabs/Terrain/Erosion/ErodedEmbankment_01/ErodedEmbankment_01_terrainmat_straight.et',
  turnin: '{75F61E9FA5F4ADE6}Prefabs/Terrain/Erosion/ErodedEmbankment_01/ErodedEmbankment_01_terrainmat_turnin.et',
  wave: '{2D4C04BB044B4F5E}Prefabs/Terrain/Erosion/ErodedEmbankment_01/ErodedEmbankment_01_terrainmat_wave.et',
}
// measured in the Workbench (top view, rotation 0): every piece is about 16 m long along X, about
// 8 m deep, the pivot near the eroded face, which looks towards -Z. So +Z must point to the land:
// yaw = atan2(n) with n the normal towards the bank, no correction. Pieces overlap a little.
export const EMBANK_LEN = 14
export const EMBANK_YAW: Record<keyof typeof EMBANK, number> = { straight: 0, wave: 0, turnin: 0 }

//! pieces on the outside of every bend (where a real river erodes), plus short random runs on the
//! straights; each run starts and ends with a `turnin` piece
export function riverBanks(waters: Water[], before: ArrayLike<number>, grid: Grid): ProjectEntity[] {
  const at = sampler(before, grid)
  const out: ProjectEntity[] = []
  for (const w of waters) {
    if (WATER_TYPES[w.type].closed || w.pts.length < 4) continue
    const line = centreLine(downhillCourse(w, at), EMBANK_LEN)
    const n = line.length / 2
    if (n < 4) continue
    const off = w.width / 2 // pivot = eroded face, on the edge of the channel
    const dir = (i: number) => {
      const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1)
      const tx = line[b * 2] - line[a * 2], tz = line[b * 2 + 1] - line[a * 2 + 1], L = Math.hypot(tx, tz) || 1
      return [tx / L, tz / L]
    }
    // side: +1 = left of the flow, -1 = right, 0 = none
    const side = new Int8Array(n)
    const bend = new Uint8Array(n)
    let seed = 0
    for (const ch of w.id) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296)
    for (let i = 1; i + 1 < n; i++) {
      const [ax, az] = dir(i - 1), [bx, bz] = dir(i + 1)
      const cross = ax * bz - az * bx
      if (Math.abs(cross) > 0.12) { side[i] = cross > 0 ? -1 : 1; bend[i] = 1 } // outside of the bend
    }
    for (let i = 2; i + 2 < n; i++) {
      if (side[i] || rnd() > 0.06) continue
      const s = rnd() < 0.5 ? 1 : -1
      for (let k = i; k < Math.min(n - 1, i + 3); k++) if (!side[k]) side[k] = s
    }
    for (let i = 1; i + 1 < n; i++) {
      const s = side[i]
      if (!s) continue
      const [tx, tz] = dir(i)
      const nx = -tz * s, nz = tx * s // towards the bank
      const x = line[i * 2] + nx * off, z = line[i * 2 + 1] + nz * off
      if (at(x, z) < 0.5) continue // not in the sea
      const end = side[i - 1] !== s || side[i + 1] !== s
      const kind: keyof typeof EMBANK = end ? 'turnin' : bend[i] ? 'wave' : 'straight'
      // eroded face (-Z of the model) towards the water
      // same convention as the road signs: yaw = atan2(x, z) turns +Z towards (x, z)
      const yaw = (Math.atan2(nx, nz) * 180) / Math.PI + EMBANK_YAW[kind]
      out.push({ id: `${w.id}_BANK_${kind}_${i}`, prefab: EMBANK[kind], x: Math.round(x * 100) / 100, z: Math.round(z * 100) / 100, yaw: Math.round(yaw) })
    }
  }
  return out
}

//! Lakes for generated rivers: (1) natural pits the rivers run through (priority-flood depth
//! `filled - heights`), (2) optionally a small lake at the source of some rivers. Rivers are cut
//! where they cross a lake, so the water leaves the lake at its outlet.
export function placeLakes(
  heights: ArrayLike<number>, filled: ArrayLike<number>, grid: Grid, rivers: Omit<Water, 'id'>[],
  opts: { minArea: number; sourceShare: number; depth: number; seed: number },
): { lakes: Omit<Water, 'id'>[]; rivers: Omit<Water, 'id'>[] } {
  const { cols, rows, step } = grid
  const n = cols * rows
  const at = sampler(heights, grid)
  const lakes: Omit<Water, 'id'>[] = []
  // 1. pits: connected cells under their spill level, crossed by a river
  const comp = new Int32Array(n).fill(-1)
  const wet = (i: number) => heights[i] > 0 && filled[i] - heights[i] > 0.3
  const onRiver = new Uint8Array(n)
  const dense = rivers.map((r) => centreLine(r.pts, step / 2)) // the traced points skip cells
  for (const d of dense)
    for (let i = 0; i + 1 < d.length; i += 2) {
      const c = Math.round(d[i] / step), rr = Math.round(d[i + 1] / step)
      if (c >= 0 && rr >= 0 && c < cols && rr < rows) onRiver[rr * cols + c] = 1
    }
  for (let s = 0; s < n; s++) {
    if (comp[s] >= 0 || !wet(s)) continue
    const cells = [s]
    comp[s] = s
    let river = false, deep = s
    for (let q = 0; q < cells.length; q++) {
      const i = cells[q], c = i % cols, r = (i - c) / cols
      if (onRiver[i]) river = true
      if (filled[i] - heights[i] > filled[deep] - heights[deep]) deep = i
      for (let dr = -1; dr <= 1; dr++)
        for (let dc = -1; dc <= 1; dc++) {
          const cc = c + dc, rr = r + dr
          if (cc < 0 || rr < 0 || cc >= cols || rr >= rows) continue
          const j = rr * cols + cc
          if (comp[j] < 0 && wet(j)) { comp[j] = s; cells.push(j) }
        }
    }
    if (!river || cells.length * step * step < opts.minArea) continue
    // outline: rays from the deepest cell to the edge of the pit
    const cx = (deep % cols) * step, cz = Math.floor(deep / cols) * step
    const pts: number[] = []
    for (let a = 0; a < 32; a++) {
      const an = (a / 32) * 2 * Math.PI, dx = Math.cos(an), dz = Math.sin(an)
      let d = 0
      for (;;) {
        const x = cx + dx * (d + step / 2), z = cz + dz * (d + step / 2)
        const c = Math.round(x / step), r = Math.round(z / step)
        if (c < 0 || r < 0 || c >= cols || r >= rows || comp[r * cols + c] !== s) break
        d += step / 2
      }
      pts.push(cx + dx * Math.max(d, step), cz + dz * Math.max(d, step))
    }
    lakes.push({ type: 'lake', pts: simplifyLine(pts, step / 2), width: 0, depth: opts.depth, auto: true })
  }
  // 2. source lakes: at the flattest spot of the first quarter of some rivers
  let s = opts.seed >>> 0 || 1
  const rand = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296)
  for (const r of rivers) {
    if (rand() >= opts.sourceShare) continue
    const m = r.pts.length / 2
    let best = 0, bs = Infinity
    for (let i = 0; i <= Math.max(1, Math.floor(m / 4)) && i < m; i++) {
      const x = r.pts[i * 2], z = r.pts[i * 2 + 1]
      const sl = Math.hypot(at(x + step, z) - at(x - step, z), at(x, z + step) - at(x, z - step))
      if (sl < bs) { bs = sl; best = i }
    }
    const R = 18 + rand() * 22
    if (bs / (2 * step) > 0.12) continue // too steep: the basin would be a pit dug in the slope
    const cx = r.pts[best * 2], cz = r.pts[best * 2 + 1]
    const pts: number[] = []
    for (let a = 0; a < 16; a++) {
      const an = (a / 16) * 2 * Math.PI, k = R * (0.8 + rand() * 0.4)
      pts.push(cx + Math.cos(an) * k, cz + Math.sin(an) * k)
    }
    lakes.push({ type: 'lake', pts, width: 0, depth: opts.depth, auto: true })
  }
  // rivers: the parts inside a lake are dropped (one point kept inside to join the water)
  const wetAt = (x: number, z: number) => lakes.some((l) => inside(l.pts, x, z))
  const out: Omit<Water, 'id'>[] = []
  rivers.forEach((r, ri) => {
    const p = dense[ri]
    const m = p.length / 2
    const inL = Array.from({ length: m }, (_, i) => wetAt(p[i * 2], p[i * 2 + 1]))
    let run: number[] = []
    const flush = () => {
      let len = 0
      for (let i = 2; i + 1 < run.length; i += 2) len += Math.hypot(run[i] - run[i - 2], run[i + 1] - run[i - 1])
      if (run.length >= 4 && len >= 30) out.push({ ...r, pts: simplifyLine(run, step * 1.5) })
      run = []
    }
    for (let i = 0; i < m; i++) {
      if (!inL[i]) {
        if (!run.length && i > 0) run.push(p[i * 2 - 2], p[i * 2 - 1]) // starts at the lake outlet
        run.push(p[i * 2], p[i * 2 + 1])
      } else if (run.length) {
        run.push(p[i * 2], p[i * 2 + 1]) // runs into the lake
        flush()
      }
    }
    flush()
  })
  return { lakes, rivers: out }
}

// --- bridges over the gaps left by splitAtWater ---

const BRIDGE = {
  // the *_PillarSmall / *_PillarBig variants carry the railing (poles + rails on the deck sockets); _Base has none
  narrow: '{9B69E8736502C4B2}Prefabs/Structures/Infrastructure/Bridges/ConcreteBridge_01/ConcreteBridge_01_Narrow_PillarSmall.et',
  narrowLong: '{D97095FEEDBD5613}Prefabs/Structures/Infrastructure/Bridges/ConcreteBridge_01/ConcreteBridge_01_Narrow_Long_PillarSmall.et',
  wide: '{D15C35F865541979}Prefabs/Structures/Infrastructure/Bridges/ConcreteBridge_01/ConcreteBridge_01_Wide_PillarBig.et',
  pillar: '{FF4D386515F942C0}Prefabs/Structures/Infrastructure/Bridges/ConcreteBridge_01/ConcreteBridge_01_Pillar.et',
  pillarNarrow: '{93575223CBE0E68D}Prefabs/Structures/Infrastructure/Bridges/ConcreteBridge_01/ConcreteBridge_01_Pillar_narrow.et',
  // 50 m long along Z, pivot in the middle, legs down to -14.4: for dirt roads and tracks
  wooden: '{2D0A93C80A6A5C5D}Prefabs/Structures/Infrastructure/Naval/Piers/PierWooden_02/PierWooden_02_bridge.et',
  small: '{6DF062B77D4F27B5}Prefabs/Structures/Infrastructure/Bridges/BridgeConcrete_E_01_small/BridgeConcrete_E_01_small.et',
}
// measured (local bounds): decks have their pivot at one end and run along +X (Narrow 13 m, Narrow_Long
// and Wide 26 m; deck top at +0.13); the small E bridge is 13 m along X, 4.6 m wide.
// Ids carry _BRIDGE_ so the labels show them.
// pillar bounds Y -4.3..7.05: its top must sit under the deck bottom (-1.3), so 1.3 + 7.05 m lower
const PILLAR_DROP = 835
const WOOD_LEN = 50.3 // PierWooden_02_bridge length (Z -25..25.3)
const BRIDGE_OVER = 8 // metres of deck buried in each bank

//! one bridge per road gap: deck pieces end to end along the road, level with the higher bank,
//! a pillar under every joint. `half(id)` = road half width (undefined: not a road, e.g. barriers)
export function bridges(gaps: { id: string; from: [number, number]; to: [number, number] }[], heights: ArrayLike<number>, grid: Grid, half: (id: string) => { half: number; dirt: boolean } | undefined): ProjectEntity[] {
  const at = sampler(heights, grid)
  const out: ProjectEntity[] = []
  const r2 = (v: number) => Math.round(v * 100) / 100
  gaps.forEach((g, k) => {
    const road = half(g.id)
    if (!road) return
    const h = road.half
    const dx = g.to[0] - g.from[0], dz = g.to[1] - g.from[1], L = Math.hypot(dx, dz)
    if (L < 2 || L > 200) return
    // +X of the model along the road: yaw turns +Z towards (sin, cos), so +X goes to (cos, -sin).
    // The yaw sent is whole degrees: lay the pieces along that rounded direction, else they drift sideways
    const yaw = Math.round((Math.atan2(-dz, dx) * 180) / Math.PI)
    const ux = Math.cos((yaw * Math.PI) / 180), uz = -Math.sin((yaw * Math.PI) / 180)
    const top = Math.max(at(g.from[0], g.from[1]), at(g.to[0], g.to[1])) + 0.05
    const ycm = Math.round((top - 0.13) * 100)
    const need = L + 2 * BRIDGE_OVER // the ends go into the banks
    let pieces: { prefab: string; len: number }[]
    if (h <= 2.4 && need <= 13) pieces = [{ prefab: BRIDGE.small, len: 13 }]
    else if (h > 4.5) pieces = Array.from({ length: Math.ceil(need / 26) }, () => ({ prefab: BRIDGE.wide, len: 26 }))
    else {
      pieces = Array.from({ length: Math.floor(need / 26) }, () => ({ prefab: BRIDGE.narrowLong, len: 26 }))
      const rest = need - pieces.length * 26
      if (rest > 13) pieces.push({ prefab: BRIDGE.narrowLong, len: 26 })
      else if (rest > 0) pieces.push({ prefab: BRIDGE.narrow, len: 13 })
    }
    if (road.dirt) {
      // wooden bridge: +Z along the road, deck surface assumed at the pivot height (to check in game)
      const wy = Math.round((Math.atan2(dx, dz) * 180) / Math.PI)
      const wx = Math.sin((wy * Math.PI) / 180), wz = Math.cos((wy * Math.PI) / 180)
      const n = Math.max(1, Math.ceil((L + 4) / WOOD_LEN))
      const cx = (g.from[0] + g.to[0]) / 2, cz = (g.from[1] + g.to[1]) / 2
      for (let j = 0; j < n; j++) {
        const o = (j - (n - 1) / 2) * WOOD_LEN
        out.push({ id: `${g.id}_BRIDGE_${k}_WOOD_${j}`, prefab: BRIDGE.wooden, x: r2(cx + wx * o), z: r2(cz + wz * o), yaw: wy, ycm: Math.round(top * 100) })
      }
      return
    }
    const total = pieces.reduce((s, p) => s + p.len, 0)
    const cx = (g.from[0] + g.to[0]) / 2, cz = (g.from[1] + g.to[1]) / 2
    let s = -total / 2
    const base = `${g.id}_BRIDGE_${k}`
    pieces.forEach((p, j) => {
      const x = cx + ux * s, z = cz + uz * s
      out.push({ id: `${base}_DECK_${j}`, prefab: p.prefab, x: r2(x), z: r2(z), yaw, ycm })
      if (j > 0 && p.prefab !== BRIDGE.small)
        out.push({ id: `${base}_PILLAR_${j}`, prefab: p.prefab === BRIDGE.wide ? BRIDGE.pillar : BRIDGE.pillarNarrow, x: r2(x), z: r2(z), yaw, ycm: ycm - PILLAR_DROP })
      s += p.len
    })
  })
  return out
}
