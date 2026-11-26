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
  river: { label: t('water.type.river'), generator: '{B7B923DFE6B4F9B9}Prefabs/WEGenerators/Water/River/R_RiverMedium_01.et', closed: false, colour: '#3f8fd8' },
  lake: { label: t('water.type.lake'), generator: '{1F2254A7C9C8AA57}Prefabs/WEGenerators/Water/Lake/LG_Lake_01.et', closed: true, colour: '#3a7fc4' },
  lakeMountain: { label: t('water.type.lakeMountain'), generator: '{5D258FD685D411E9}Prefabs/WEGenerators/Water/Lake/LG_LakeMountain_01.et', closed: true, colour: '#4c9ad6' },
  lakeCain: { label: t('water.type.lakeCain'), generator: '{D0224BC8D6B29461}Prefabs/WEGenerators/Water/Lake/LG_CainLake_01.et', closed: true, colour: '#2e5f8a' },
  lakeDirty: { label: t('water.type.lakeDirty'), generator: '{4E28608BE618F2D7}Prefabs/WEGenerators/Water/Lake/LG_LakeDirty_01.et', closed: true, colour: '#5b7a5a' },
  drainage: { label: t('water.type.drainage'), generator: '{0263A3344F9DCAAD}Prefabs/WEGenerators/Water/Lake/LG_DirtyDrainage_01.et', closed: true, colour: '#6b7a4a' },
  pool: { label: t('water.type.pool'), generator: '{5F7E82B65AE9A3EE}Prefabs/WEGenerators/Water/Pool/LG_Pool_01.et', closed: true, colour: '#5fc0e8' },
}

export interface Water {
  id: string
  type: WaterType
  pts: number[] // control points, flat X/Z (river: upstream first)
  width: number // river width, metres (lakes: unused)
  depth: number // depth below the water level, metres
  auto?: boolean // traced from the simulated rivers (replaced on regeneration)
  carve?: boolean // river: dig a bed; otherwise the water just lies on the ground (banks may cover it)
  wetEdge?: boolean // river: ground under the water up to the traced edge (map from a picture), banks start outside
  level?: number // lake: fixed water level (dam reservoir, dam.ts); absent = from the shore
  widths?: number[] // river: traced width (m) at each control point (map from a picture); roads cut over the widest
  onRiver?: boolean // lake: a swelling of a picture river, its level set to the river's (carveWater)
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
  if (w.level !== undefined) return w.level // dam reservoir (dam.ts): level set by the crest
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
export const RIVER_OVERWIDTH = 1.3
/** widest river spline sent (m). Picture 119: the 117 m tributary sent at Width 152 showed as a dark sheet (the sea under
 *  its carved bed, cut straight at the confluence) while its 124 m neighbour rendered; same level 0.5 m, same bed -1 m,
 *  its end 3.7 m from the main centre line, so Width is the one difference left. Capped at the widest seen rendering;
 *  the ground stays under the water to the traced edge (wetEdge), so the capped water still covers it */
export const RIVER_MAX_SENT_WIDTH = 124
export const riverSentWidth = (w: { width: number }) => Math.min(RIVER_MAX_SENT_WIDTH, Math.round(w.width * RIVER_OVERWIDTH))
/** half width of the water a river shows in game (the spline is sent RIVER_OVERWIDTH wider than traced): vegetation keeps out of it */
export const riverWetHalf = (w: { width: number }) => Math.max(w.width / 2, riverSentWidth(w) / 2)
/** bed depth (m, under the water level) of the rivers of a map from a picture: 1.5 m read shallow and light in game
 *  (picture 120, the bed texture showing through); 2.5 m darkens the water like Arland's rivers */
export const PICTURE_RIVER_DEPTH = 2.5
const RIVER_BANK = 0.5 // bank top above the water
const RIVER_MAXCUT = 2.5
const RIVER_DRY = 0.4 // ground outside the traced bed but under the river ribbon, over the water (0.2 read as speckled grass islands in shallow water, picture 119 round 9)
/** centre depth of a picture river at a local half width: wide reaches go deeper (Arland-like, ~1 m at the edge,
 *  up to 4 m at the centre for 100 m+), a 2.5 m bed under a 110 m river showed turquoise shallows (picture 120) */
export function pictureRiverDepth(base: number, half: number): number {
  return Math.max(base, Math.min(4, 1 + 3 * Math.min(1, (2 * half) / 100)))
}
const RIVER_BED_MIN = 1 // a picture river's bed (wetEdge) stays this far under the water up to its traced edge
const BANK_MAX_SLOPE = 0.6 // valley side of a river, m/m (~31 deg) // ground outside the traced bed over the water level, metres
/** length (m) of a river's last stretch held at the sea level before its mouth */
export const MOUTH_FLAT = (w: { width: number }) => Math.max(40, riverSentWidth(w))
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
  const edge = riverWetHalf(w)
  const raw: number[] = []
  let sea = -1, src = -1
  for (let i = 0; i < n; i++) {
    const x = line[i * 2], z = line[i * 2 + 1]
    const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1)
    let tx = line[b * 2] - line[a * 2], tz = line[b * 2 + 1] - line[a * 2 + 1]
    const L = Math.hypot(tx, tz) || 1
    tx /= L; tz /= L
    const g = at(x, z)
    // a river drawn from map edge to map edge starts in the sea too (picture 119: both ends under the 120 m
    // edge sea): the sea is the first wet sample past the dry stretch, not the source itself
    if (src < 0 && g >= 0) src = i
    if (src >= 0 && sea < 0 && g < 0) sea = i
    raw.push(Math.min(g, at(x - tz * edge, z + tx * edge), at(x + tz * edge, z - tx * edge)) - RIVER_SURFACE)
  }
  if (src < 0) src = 0
  for (let i = 0; i < src; i++) raw[i] = -0.05
  // never rising downstream, but never more than RIVER_MAXCUT under the ground either: past that
  // the water steps up a little rather than sitting at the bottom of a gorge
  const ground = raw.slice()
  for (let i = src + 1; i < n; i++) raw[i] = Math.max(Math.min(raw[i], raw[i - 1]), ground[i] - RIVER_MAXCUT)
  const R = 6
  const level = raw.map((_, i) => {
    let s = 0, k = 0
    for (let j = Math.max(0, i - R); j <= Math.min(n - 1, i + R); j++) { s += raw[j]; k++ }
    return Math.min(s / k, raw[i])
  })
  // a river surface never under the sea surface: picture 119, the level (lowest ground across the 124 m water, never
  // rising downstream) fell to -1.6 m along the main river, its banks were shaped at -1.1 m and the sea flooded
  // 4.5 ha of land outside the traced bed (a dark stepped sheet near the mouth)
  for (let i = 0; i < n; i++) level[i] = Math.max(level[i], -0.05)
  // the last stretch before the sea (one sent width: past the last spline point or two) lies AT the sea level:
  // picture 119, the ramp up from the shore put the river ribbon 0.3-0.5 m over the sea cells it spans near the
  // mouth (a dark sheet over the sea, a step where both waters meet)
  const flat = MOUTH_FLAT(w)
  if (sea >= 0) {
    let d = 0
    for (let i = sea; i >= 0; i--) {
      if (i < sea) d += Math.hypot(line[i * 2 + 2] - line[i * 2], line[i * 2 + 3] - line[i * 2 + 1])
      level[i] = Math.max(Math.min(level[i], -0.05 + 0.02 * Math.max(0, d - flat)), Math.min(level[i], ground[i] - RIVER_MAXCUT))
    }
    for (let i = sea; i < n; i++) level[i] = -0.05
  }
  if (src > 0) {
    // source in the sea: the water climbs out of it as gently as a mouth comes down into it
    let d = 0
    for (let i = src; i < n && (sea < 0 || i < sea); i++) {
      if (i > src) d += Math.hypot(line[i * 2] - line[i * 2 - 2], line[i * 2 + 1] - line[i * 2 - 1])
      level[i] = Math.max(Math.min(level[i], -0.05 + 0.02 * Math.max(0, d - flat)), Math.min(level[i], ground[i] - RIVER_MAXCUT))
    }
    for (let i = 0; i < src; i++) level[i] = -0.05
  }
  return { line, level, sea, src }
}

//! painted under each river: pebbles in the bed, dirt on the wet banks (same format as roadMasks)
export function waterMasks(waters: Water[]) {
  return waters.filter((w) => !WATER_TYPES[w.type].closed && w.pts.length >= 4)
    .map((w) => ({ points: centreLine(riverCourse(w.pts, w.width), 4), half: w.width / 2, edge: 2, core: 'Pebbles_01', side: 'Dirt_01', sidePeak: 0.35 }))
}

//! per grid cell: water level of the nearest lake / river where known (NaN elsewhere), wet = under water
export interface WaterLevels { level: Float32Array; wet: Uint8Array }

//! returns the water levels it used (roads keep their beds above them, see carveRoads)
export function carveWater(heights: number[], grid: Grid, waters: Water[]): WaterLevels {
  const { cols, rows, step } = grid
  const at = sampler(heights.slice(), grid)
  const target = new Float32Array(heights.length).fill(Infinity)
  const lower = (k: number, v: number) => { if (v < target[k]) target[k] = v }
  const shaped = new Float32Array(heights.length)
  const shapedScore = new Float32Array(heights.length).fill(Infinity)
  const levels: WaterLevels = { level: new Float32Array(heights.length).fill(NaN), wet: new Uint8Array(heights.length) }

  // a lake swelling a river lies at the river's level (median river level along its shore): from its own
  // shore it sat 0.4 m under the river water, the ribbon edge showing over it (picture 119)
  const profiles = waters.filter((w) => !WATER_TYPES[w.type].closed && w.pts.length >= 4).map((w) => riverProfile(w, at))
  for (const w of waters) {
    if (!w.onRiver || w.level !== undefined || !profiles.length) continue
    const ls: number[] = []
    for (let i = 0; i + 1 < w.pts.length; i += 2) {
      let bd = Infinity, bl = NaN
      for (const p of profiles) for (let j = 0; j < p.line.length; j += 2) {
        const d = (p.line[j] - w.pts[i]) ** 2 + (p.line[j + 1] - w.pts[i + 1]) ** 2
        if (d < bd) { bd = d; bl = p.level[j / 2] }
      }
      if (Number.isFinite(bl)) ls.push(bl)
    }
    ls.sort((a, b) => a - b)
    if (ls.length) w.level = Math.round(ls[ls.length >> 1] * 100) / 100
  }

  for (const w of waters) {
    if (w.pts.length < 4) continue
    if (!WATER_TYPES[w.type].closed) {
      // the terrain is shaped to the river, not the other way round: a smooth water profile that
      // never rises downstream, a bed under it, banks just above it, then a blend back to the
      // original ground over `fall` metres (the ground is lowered OR raised there)
      const { line, level } = riverProfile(w, at)
      const half0 = Math.max(w.width / 2, step) // the grid cannot hold a narrower channel
      const wetHalf0 = riverWetHalf(w)
      // a river traced from a picture is carved to its local traced width (the bridges' gaps use it too), never
      // wider than the water ribbon sent: picture 119 near 1062,730, the river traced 90-116 m wide carved at its
      // 70 m median, the rest under the ribbon at +0.2 m: a shallow sheet with grass islands
      const localW = w.widths && w.widths.length === w.pts.length / 2 ? w.widths : undefined
      const halfAt = (x: number, z: number) => {
        if (!localW) return half0
        let bd = Infinity, bw = w.width
        for (let j = 0; j + 3 < w.pts.length; j += 2) {
          const px = w.pts[j], pz = w.pts[j + 1], qx = w.pts[j + 2] - px, qz = w.pts[j + 3] - pz, Q = qx * qx + qz * qz || 1
          const u = Math.min(1, Math.max(0, ((x - px) * qx + (z - pz) * qz) / Q)), dd = Math.hypot(x - px - qx * u, z - pz - qz * u)
          if (dd < bd) { bd = dd; bw = localW[j / 2] + (localW[j / 2 + 1] - localW[j / 2]) * u }
        }
        return Math.min(Math.max(bw / 2, step), Math.max(half0, wetHalf0 - step))
      }
      const halves: number[] = []
      for (let i = 0; i < line.length / 2; i++) halves.push(halfAt(line[i * 2], line[i * 2 + 1]))
      const half = Math.max(...halves)
      const fall = Math.max(2 * step, w.width)
      const wetHalf = riverWetHalf(w)
      // a river cut deep into a hill (picture 120: water 8 m, hilltop 35 m, 30 m away) rose over `fall` at up to 60 deg:
      // the blend widens with the drop (up to 5x) so the valley side stays under ~BANK_MAX_SLOPE
      const reach = Math.max(half + 5 * fall, wetHalf + 3 * step)
      const ramp = Math.max(3 * w.width, 2 * step) // the source must not end in a dug pit
      // ...unless the source end joins another river (picture 119: the tributary's upstream end, as the terrain runs, is
      // its confluence with the main river; the 351 m depth ramp from there left a shallow sheet with grass islands)
      const joined = waters.some((o) => o !== w && !WATER_TYPES[o.type].closed && o.pts.length >= 4 && (() => {
        const c = riverCourse(o.pts, o.width), R = riverWetHalf(o) + step
        for (let j = 0; j + 3 < c.length; j += 2) if (segDist(line[0], line[1], c[j], c[j + 1], c[j + 2], c[j + 3]) <= R) return true
        return false
      })())
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
            const half = halves[i] + (halves[i + 1] - halves[i]) * tt
            const baseDepth = w.wetEdge ? pictureRiverDepth(w.depth, half) : w.depth
            const depth = joined ? baseDepth : baseDepth * Math.min(1, (along + tt * segLen) / ramp)
            let v: number
            if (d <= half) {
              // flat bed to 40 %, then up to just under the water at the traced edge: the whole river surface
              // (the Workbench river is drawn at the traced width) covers water. Rising to the bank top inside
              // it left the outer ~20 % above the surface, ground lumps on the water along the banks (picture 120)
              const t = Math.max(0, (d / half - 0.4) / 0.6)
              // (wetEdge: rivers of a map from a picture; generated rivers keep their bank-top profile, pads rely on it)
              // a picture river (wetEdge) stays RIVER_BED_MIN under the water to its edge (0.15 m there left a
              // band of ground just under the surface, speckled in game); never deeper than the source ramp allows
              const edge = Math.min(depth, RIVER_BED_MIN)
              v = w.wetEdge ? wl - depth + (depth - edge) * sstep(t) : wl - depth + (depth + RIVER_BANK) * sstep(t)
            } else {
              const drop = at(x, z) - wl - RIVER_BANK
              const fallK = Math.min(5 * fall, Math.max(fall, (1.5 * Math.abs(drop)) / BANK_MAX_SLOPE))
              if (d >= half + fallK) continue // past this river's blend: the original ground
              v = wl + RIVER_BANK + drop * sstep((d - half) / fallK)
              // outside the traced bed but under the river ribbon (sent wider than traced, straight between points
              // ~100 m apart): the ground stays over the water, else low flat land floods (picture 119 mouth)
              if (d <= wetHalf + 2 * step) v = Math.max(v, Math.max(wl, 0) + RIVER_DRY)
            }
            if (at(x, z) < 0) v = Math.min(v, at(x, z)) // never build banks up in the sea
            shapedScore[k] = score
            shaped[k] = v
            levels.level[k] = wl
            levels.wet[k] = d <= half ? 1 : 0
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
      const c0 = Math.max(0, Math.floor((minX - 3 * bank) / step)), c1 = Math.min(cols - 1, Math.ceil((maxX + 3 * bank) / step))
      const r0 = Math.max(0, Math.floor((minZ - 3 * bank) / step)), r1 = Math.min(rows - 1, Math.ceil((maxZ + 3 * bank) / step))
      for (let r = r0; r <= r1; r++)
        for (let c = c0; c <= c1; c++) {
          const x = c * step, z = r * step
          let d = Infinity
          for (let i = 0; i < ring.length; i += 2) d = Math.min(d, Math.hypot(ring[i] - x, ring[i + 1] - z))
          if (inside(w.pts, x, z)) {
            const u = Math.min(1, d / ramp)
            // height proportional to the distance to the outline near the shore: the bilinear water line
            // then follows the drawn outline instead of stair-stepping along the grid cells
            lower(r * cols + c, L - Math.min(0.15 * d, 0.2) - w.depth * u * u * (3 - 2 * u))
            levels.level[r * cols + c] = L; levels.wet[r * cols + c] = 1
          } else if (d < 3 * bank) {
            if (d < bank) lower(r * cols + c, L + Math.min(0.15 * d, 0.3) + 1.5 * (d / bank))
            if (Number.isNaN(levels.level[r * cols + c])) levels.level[r * cols + c] = L
          }
        }
    }
  }
  for (let k = 0; k < heights.length; k++) {
    if (shapedScore[k] < Infinity) heights[k] = shaped[k]
    if (target[k] < heights[k]) heights[k] = target[k]
  }
  return levels
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
      const spacing = Math.min(LAKE_MAX_SPACING, Math.max(10, w.width * 0.8))
      // the ribbon folds over itself (and the game builds only a stub of it) where the line bends tighter than its
      // half width: picture 119, 116 m wide river with 25-55 deg turns every 26 m, only the sea showed
      const pts = easeBends(centreLine(downhillCourse(w, at), spacing), RIVER_BEND_RADIUS * riverSentWidth(w))
      // the water sits on the profile the terrain was shaped to (nearest profile sample)
      const { line, level, sea: seaAt, src: srcAt } = riverProfile(w, at)
      const n = pts.length / 2
      const lift: number[] = []
      let sea = -1, src = -1
      for (let i = 0; i < n; i++) {
        let best = 0, bd = Infinity
        for (let j = 0; j < line.length; j += 2) {
          const d = (line[j] - pts[i * 2]) ** 2 + (line[j + 1] - pts[i * 2 + 1]) ** 2
          if (d < bd) { bd = d; best = j / 2 }
        }
        if (src < 0 && best >= srcAt) src = i
        if (sea < 0 && seaAt >= 0 && best >= seaAt) sea = i
        lift.push(r2(Math.max(0.1, level[best] - ground(pts[i * 2], pts[i * 2 + 1]))))
      }
      // a river running on under the sea would show through it: stop one point past the shore (both ends: a
      // river from map edge to map edge was cut to its first 2 points, picture 119)
      const keep = sea >= 0 ? Math.min(n, Math.max(sea + 2, 2)) : n
      const from = Math.max(0, Math.min(src - 1, keep - 2))
      pts.splice(keep * 2)
      pts.splice(0, from * 2)
      lift.splice(keep)
      lift.splice(0, from)
      out.push({ id: w.id, kind: 'spline', closed: false, points: pts.map(r2), generator: wt.generator, paramKeys: ['Width'], paramValues: [String(riverSentWidth(w))], lift })
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
      // LG_Lake* makes no water past too many / too short segments: simplify, then lift from the kept points
      pts = simplifyLake(pts)
      const lift: number[] = []
      for (let i = 0; i < pts.length; i += 2) lift.push(r2(Math.max(0, L - ground(pts[i], pts[i + 1]))))
      out.push({ id: w.id, kind: 'polyline', closed: true, points: pts.map(r2), generator: wt.generator, lift })
    }
  }
  joinTributaries(out, ground)
  return out
}

/** water level climb (m/m) from a confluence up a tributary */
const JOIN_SLOPE = 0.03

//! a river ending inside another one meets it at its level: picture 119, the south arm started on the
//! confluence 2 m above the main river and its flat end cap showed as a dark rectangle with straight edges.
//! The end goes on to the main river's centre line (cap under the main water) and its level comes down to
//! the main level, climbing back at JOIN_SLOPE
export function joinTributaries(shapes: ProjectShape[], ground: (x: number, z: number) => number) {
  const rivers = shapes.filter((s) => s.kind === 'spline' && !s.closed && s.lift && s.paramValues?.length)
  const r2 = (v: number) => Math.round(v * 100) / 100
  for (const s of rivers) {
    for (const atStart of [true, false]) {
      const n = s.points.length / 2
      if (n < 2) continue
      const e = atStart ? 0 : n - 1
      const ex = s.points[e * 2], ez = s.points[e * 2 + 1]
      let main: ProjectShape | undefined, mi = -1, md = Infinity
      for (const m of rivers) {
        if (m === s) continue
        const half = Number(m.paramValues![0]) / 2
        for (let i = 0; i < m.points.length / 2; i++) {
          const d = Math.hypot(m.points[i * 2] - ex, m.points[i * 2 + 1] - ez)
          if (d < half && d < md) { md = d; mi = i; main = m }
        }
      }
      if (!main) continue
      const mx = main.points[mi * 2], mz = main.points[mi * 2 + 1]
      const Lj = main.lift![mi] + ground(mx, mz), mainHalf = Number(main.paramValues![0]) / 2
      // on to the main centre line, unless already about there
      if (md > 3) {
        if (atStart) { s.points.unshift(r2(mx), r2(mz)); s.lift!.unshift(0) } else { s.points.push(r2(mx), r2(mz)); s.lift!.push(0) }
      }
      const N = s.points.length / 2
      let d = 0
      for (let k = 0; k < N; k++) {
        const i = atStart ? k : N - 1 - k
        if (k > 0) { const j = atStart ? i - 1 : i + 1; d += Math.hypot(s.points[i * 2] - s.points[j * 2], s.points[i * 2 + 1] - s.points[j * 2 + 1]) }
        const g = ground(s.points[i * 2], s.points[i * 2 + 1])
        // flat at the main level across the main ribbon: climbing there put the arm's water 0.3 m over the main
        // water inside it, its end cap a straight-edged dark zone (picture 119 round 10 confluence)
        const cur = s.lift![i] + g, want = Lj + JOIN_SLOPE * Math.max(0, d - mainHalf)
        if (k > 0 && want >= cur) break
        s.lift![i] = r2(Math.max(0.1, Math.min(cur, want) - g))
        if (k === 0) s.lift![i] = r2(Math.max(0, Lj - g))
      }
    }
  }
}

export const LAKE_MAX_POINTS = 60
export const LAKE_MIN_SPACING = 6

function segCross(ax: number, az: number, bx: number, bz: number, cx: number, cz: number, dx: number, dz: number): boolean {
  const o = (px: number, pz: number, qx: number, qz: number, rx: number, rz: number) => (qx - px) * (rz - pz) - (qz - pz) * (rx - px)
  const d1 = o(cx, cz, dx, dz, ax, az), d2 = o(cx, cz, dx, dz, bx, bz), d3 = o(ax, az, bx, bz, cx, cz), d4 = o(ax, az, bx, bz, dx, dz)
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
}

//! true when two non-adjacent edges of the closed ring cross
export function ringSelfIntersects(pts: number[]): boolean {
  const n = pts.length / 2
  for (let i = 0; i < n; i++) {
    const i2 = (i + 1) % n
    for (let j = i + 2; j < n; j++) {
      const j2 = (j + 1) % n
      if (j2 === i) continue
      if (segCross(pts[i * 2], pts[i * 2 + 1], pts[i2 * 2], pts[i2 * 2 + 1], pts[j * 2], pts[j * 2 + 1], pts[j2 * 2], pts[j2 * 2 + 1])) return true
    }
  }
  return false
}

function segDist(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const vx = bx - ax, vz = bz - az, l = vx * vx + vz * vz
  const t = l > 0 ? Math.max(0, Math.min(1, ((px - ax) * vx + (pz - az) * vz) / l)) : 0
  return Math.hypot(px - ax - t * vx, pz - az - t * vz)
}

//! would replacing vertex k (neighbours a, b) by edge a-b cross another edge of the ring `idx`?
function shortcutCrosses(pts: number[], idx: number[], k: number): boolean {
  const n = idx.length, a = idx[(k - 1 + n) % n], b = idx[(k + 1) % n]
  for (let i = 0; i < n; i++) {
    const p = idx[i], q = idx[(i + 1) % n]
    if (p === a || p === b || q === a || q === b || p === idx[k] || q === idx[k]) continue
    if (segCross(pts[a * 2], pts[a * 2 + 1], pts[b * 2], pts[b * 2 + 1], pts[p * 2], pts[p * 2 + 1], pts[q * 2], pts[q * 2 + 1])) return true
  }
  return false
}

//! one pass at tolerance `tol`: Douglas-Peucker-like vertex removal on the closed ring (always removing the
//! vertex closest to its shortcut), then merges edges shorter than `minSpacing`; never creates a crossing
function simplifyRing(pts: number[], tol: number, minSpacing: number): number[] {
  const idx = Array.from({ length: pts.length / 2 }, (_, i) => i)
  const dev = (k: number) => {
    const n = idx.length, a = idx[(k - 1 + n) % n], b = idx[(k + 1) % n], c = idx[k]
    return segDist(pts[c * 2], pts[c * 2 + 1], pts[a * 2], pts[a * 2 + 1], pts[b * 2], pts[b * 2 + 1])
  }
  const len = (k: number) => {
    const a = idx[k], b = idx[(k + 1) % idx.length]
    return Math.hypot(pts[b * 2] - pts[a * 2], pts[b * 2 + 1] - pts[a * 2 + 1])
  }
  const blocked = new Set<number>()
  // pass 1: deviation below tol (visvalingam-style ordering of the DP criterion)
  for (;;) {
    if (idx.length <= 4) break
    let best = -1, bd = tol
    for (let k = 0; k < idx.length; k++) {
      if (blocked.has(idx[k])) continue
      const d = dev(k)
      if (d <= bd) { bd = d; best = k }
    }
    if (best < 0) break
    if (shortcutCrosses(pts, idx, best)) { blocked.add(idx[best]); continue }
    idx.splice(best, 1); blocked.clear()
  }
  // pass 2: minimum spacing — drop the end of the shortest edge that deviates least
  for (;;) {
    if (idx.length <= 4) break
    let best = -1, bl = minSpacing
    for (let k = 0; k < idx.length; k++) { const l = len(k); if (l < bl && !(blocked.has(idx[k]) && blocked.has(idx[(k + 1) % idx.length]))) { bl = l; best = k } }
    if (best < 0) break
    const k2 = (best + 1) % idx.length
    const order = dev(best) <= dev(k2) ? [best, k2] : [k2, best]
    const k = order.find((c) => !blocked.has(idx[c]) && !shortcutCrosses(pts, idx, c))
    if (k === undefined) { blocked.add(idx[best]); blocked.add(idx[k2]); continue }
    idx.splice(k, 1)
  }
  return idx.flatMap((i) => [pts[i * 2], pts[i * 2 + 1]])
}

//! lake outline for LG_Lake* generators: tolerance 1.5 m, min spacing 6 m, ≤ 60 points (tolerance raised
//! until it fits). Keeps the ring closed (implicitly), its orientation and its simplicity.
export function simplifyLake(pts: number[], maxPts = LAKE_MAX_POINTS, minSpacing = LAKE_MIN_SPACING): number[] {
  if (pts.length / 2 <= 4) return pts.slice()
  let tol = 1.5
  let out = simplifyRing(pts, tol, minSpacing)
  while (out.length / 2 > maxPts && tol < 1e5) { tol *= 1.5; out = simplifyRing(pts, tol, minSpacing) }
  return densifyRing(out, maxPts)
}

/** vanilla lake / river bank point spacing is 6.5-26 m (VANILLA_PLACEMENT_OPTIM.md §4) */
export const LAKE_MAX_SPACING = 26

/** smallest bend radius of a sent river line, in sent widths (ribbon inner edge stays clear of folding) */
export const RIVER_BEND_RADIUS = 0.75

/** turn (rad) at each inner point of a polyline */
export function turns(p: number[]): number[] {
  const out: number[] = []
  for (let i = 1; i + 1 < p.length / 2; i++) {
    const a = Math.atan2(p[i * 2 + 1] - p[i * 2 - 1], p[i * 2] - p[i * 2 - 2]), b = Math.atan2(p[i * 2 + 3] - p[i * 2 + 1], p[i * 2 + 2] - p[i * 2])
    let d = Math.abs(b - a)
    if (d > Math.PI) d = 2 * Math.PI - d
    out.push(d)
  }
  return out
}

/** smooth the tight bends of an open line (ends kept) until each turn fits a circle of radius >= minR
 *  (turn <= segment / minR), or the passes run out; points stay evenly spaced enough for the generator */
export function easeBends(pts: number[], minR: number, passes = 60): number[] {
  const p = pts.slice(), n = p.length / 2
  if (n < 3 || minR <= 0) return p
  for (let k = 0; k < passes; k++) {
    let bad = false
    const t = turns(p)
    const q = p.slice()
    for (let i = 1; i < n - 1; i++) {
      const L = (Math.hypot(p[i * 2 + 2] - p[i * 2], p[i * 2 + 3] - p[i * 2 + 1]) + Math.hypot(p[i * 2] - p[i * 2 - 2], p[i * 2 + 1] - p[i * 2 - 1])) / 2
      // smooth around a tight point (its neighbours too, so the bend spreads rather than kinks next door)
      const tight = (j: number) => j >= 1 && j < n - 1 && t[j - 1] > L / minR
      if (!(tight(i) || tight(i - 1) || tight(i + 1))) continue
      bad = true
      q[i * 2] = (p[i * 2 - 2] + 2 * p[i * 2] + p[i * 2 + 2]) / 4
      q[i * 2 + 1] = (p[i * 2 - 1] + 2 * p[i * 2 + 1] + p[i * 2 + 3]) / 4
    }
    if (!bad) break
    for (let i = 0; i < p.length; i++) p[i] = q[i]
  }
  return p
}

//! splits the longest edges (> maxSpacing) of a closed ring at their Catmull-Rom midpoint (a smoothed bank
//! instead of a straight chord), longest first, while the ring has room (<= maxPts) and stays simple
export function densifyRing(pts: number[], maxPts = LAKE_MAX_POINTS, maxSpacing = LAKE_MAX_SPACING): number[] {
  let out = pts.slice()
  const skip = new Set<string>()
  while (out.length / 2 < maxPts) {
    const n = out.length / 2
    let best = -1, bl = maxSpacing
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n, l = Math.hypot(out[j * 2] - out[i * 2], out[j * 2 + 1] - out[i * 2 + 1])
      if (l > bl && !skip.has(`${out[i * 2]},${out[i * 2 + 1]}`)) { bl = l; best = i }
    }
    if (best < 0) break
    const p = (k: number) => [out[((k + n) % n) * 2], out[((k + n) % n) * 2 + 1]]
    const [x0, z0] = p(best - 1), [x1, z1] = p(best), [x2, z2] = p(best + 1), [x3, z3] = p(best + 2)
    // Catmull-Rom at t = 0.5: (-p0 + 9 p1 + 9 p2 - p3) / 16
    const mx = (-x0 + 9 * x1 + 9 * x2 - x3) / 16, mz = (-z0 + 9 * z1 + 9 * z2 - z3) / 16
    const next = [...out.slice(0, best * 2 + 2), mx, mz, ...out.slice(best * 2 + 2)]
    if (ringSelfIntersects(next)) { skip.add(`${x1},${z1}`); continue }
    out = next
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
  // a river traced from a picture keeps its local widths (its bed is carved to them): test on its own points
  const courses = waters.filter((w) => !WATER_TYPES[w.type].closed && w.pts.length >= 4).map((w) => {
    const local = w.widths && w.widths.length === w.pts.length / 2
    return { c: local ? w.pts : riverCourse(w.pts, w.width), half: (i: number) => (local ? Math.max(w.widths![i / 2], w.widths![i / 2 + 1]) : w.width) / 2 + margin }
  })
  const lakes = waters.filter((w) => WATER_TYPES[w.type].closed && w.pts.length >= 6)
  const wet = (x: number, z: number) => {
    for (const l of lakes) if (inside(l.pts, x, z)) return true
    for (const { c, half } of courses)
      for (let i = 0; i + 3 < c.length; i += 2) {
        const ax = c[i], az = c[i + 1], dx = c[i + 2] - ax, dz = c[i + 3] - az, L2 = dx * dx + dz * dz || 1
        const t = Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / L2))
        if (Math.hypot(x - ax - dx * t, z - az - dz * t) < half(i)) return true
      }
    return false
  }
  // long road legs (picture roads: one vertex every 50-100 m) can hop over a river with both ends dry:
  // test (and cut) on legs of 8 m at most, only for roads that touch the water somewhere
  const dense = (p: number[]) => {
    const o: number[] = [p[0], p[1]]
    for (let i = 2; i < p.length; i += 2) {
      const L = Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]), k = Math.ceil(L / 8)
      for (let j = 1; j <= k; j++) o.push(p[i - 2] + ((p[i] - p[i - 2]) * j) / k, p[i - 1] + ((p[i + 1] - p[i - 1]) * j) / k)
    }
    return o
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
    const d = dense(s.points)
    const dWet = Array.from({ length: d.length / 2 }, (_, i) => wet(d[i * 2], d[i * 2 + 1]))
    if (!dWet.some(Boolean)) { out.push(s); continue }
    // dry legs keep their own vertices (dense points only where a leg touches the water)
    const p: number[] = [], isWet: boolean[] = []
    {
      const o = s.points
      p.push(o[0], o[1]); isWet.push(wet(o[0], o[1]))
      let k = 1
      for (let i = 2; i < o.length; i += 2) {
        const L = Math.hypot(o[i] - o[i - 2], o[i + 1] - o[i - 1]), m = Math.ceil(L / 8)
        let any = false
        for (let j = 0; j < m; j++) if (dWet[k + j]) any = true
        for (let j = 0; j < m; j++) if (any || j === m - 1) { p.push(d[(k + j) * 2], d[(k + j) * 2 + 1]); isWet.push(dWet[k + j]) }
        k += m
      }
    }
    const n = p.length / 2
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
  const lakes = waters.filter((w) => WATER_TYPES[w.type].closed && w.pts.length >= 6)
  const inRing = (p: number[], x: number, z: number) => {
    let ins = false
    for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2)
      if ((p[i + 1] > z) !== (p[j + 1] > z) && x < ((p[j] - p[i]) * (z - p[i + 1])) / (p[j + 1] - p[i + 1]) + p[i]) ins = !ins
    return ins
  }
  for (const w of waters) {
    if (WATER_TYPES[w.type].closed || w.pts.length < 4) continue
    const line = centreLine(downhillCourse(w, at), EMBANK_LEN)
    const n = line.length / 2
    if (n < 4) continue
    const off = w.width / 2 // pivot = eroded face, on the edge of the channel
    // a picture river: its local traced width (the median put pieces 20-30 m out on the dry bank where the river
    // is narrower, round bumps on picture 119, and in the water where wider)
    const localW = w.widths && w.widths.length === w.pts.length / 2 ? w.widths : undefined
    const offAt = (x: number, z: number) => {
      if (!localW) return off
      let bd = Infinity, bw = w.width
      for (let j = 0; j + 3 < w.pts.length; j += 2) {
        const px = w.pts[j], pz = w.pts[j + 1], qx = w.pts[j + 2] - px, qz = w.pts[j + 3] - pz, Q = qx * qx + qz * qz || 1
        const u = Math.min(1, Math.max(0, ((x - px) * qx + (z - pz) * qz) / Q)), dd = Math.hypot(x - px - qx * u, z - pz - qz * u)
        if (dd < bd) { bd = dd; bw = localW[j / 2] + (localW[j / 2 + 1] - localW[j / 2]) * u }
      }
      return bw / 2
    }
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
      const o = offAt(line[i * 2], line[i * 2 + 1])
      const x = line[i * 2] + nx * o, z = line[i * 2 + 1] + nz * o
      if (at(x, z) < 0.5) continue // not in the sea
      if (lakes.some((l) => inRing(l.pts, x, z))) continue // nor in a lake (a river swelling)
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
  opts: { minArea: number; sourceShare: number; depth: number; seed: number; maxLakes?: number },
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
  // optional cap: the biggest lakes win (before the rivers are cut, so a dropped lake leaves its river whole)
  if (opts.maxLakes !== undefined && lakes.length > opts.maxLakes) {
    const area = (p: number[]) => { let a = 0; for (let i = 0; i < p.length; i += 2) { const j = (i + 2) % p.length; a += p[i] * p[j + 1] - p[j] * p[i + 1] } return Math.abs(a) / 2 }
    const keep = lakes.map((l) => ({ l, a: area(l.pts) })).sort((a, b) => b.a - a.a).slice(0, opts.maxLakes).map((q) => q.l)
    lakes.length = 0
    lakes.push(...keep)
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
const BRIDGE_MIN_REST = 1 // deck past each end of the gap at the least (the gap already has 4 m of bank a side), metres
const BRIDGE_DECK_REST = 2 // deck past each end of the gap aimed at, metres: water edge + 4 m gap margin + 2 = 6 m (5 laid decks up to 16 m on the bank grass, picture 120 round 9)

/** [M] steepest deck allowed (rise / run): above it the higher bank sets the deck and the lower end is flagged */
export const BRIDGE_MAX_PITCH = 0.08
export interface RiverBridge { id: string; a: [number, number, number]; b: [number, number, number]; slope: number; /** pitch capped or deck raised over the road bed: the low bank gets a ramp */ capped: boolean; deckIds: string[]; half: number }

//! one bridge per road gap: deck pieces end to end along ONE straight 3D line from the road height on bank A
//! to the road height on bank B (every piece and pillar on that line, same tilt; capped at BRIDGE_MAX_PITCH).
//! `heights` = the FINAL relief (road beds carved): the abutments meet the road, not the raw terrain.
//! `half(id)` = road half width (undefined: not a road, e.g. barriers)
export function bridges(gaps: { id: string; from: [number, number]; to: [number, number] }[], heights: ArrayLike<number>, grid: Grid, half: (id: string) => { half: number; dirt: boolean } | undefined): ProjectEntity[] {
  return riverBridges(gaps, heights, grid, half).entities
}
export function riverBridges(gaps: { id: string; from: [number, number]; to: [number, number] }[], heights: ArrayLike<number>, grid: Grid, half: (id: string) => { half: number; dirt: boolean } | undefined): { entities: ProjectEntity[]; plans: RiverBridge[] } {
  const at = sampler(heights, grid)
  const out: ProjectEntity[] = [], plans: RiverBridge[] = []
  const r2 = (v: number) => Math.round(v * 100) / 100
  const cd = (deg: number) => Math.round(deg * 100) // centi-degrees (int field, MG_ProjectEntity pitchcd / rollcd)
  gaps.forEach((g, k) => {
    const road = half(g.id)
    if (!road) return
    const h = road.half
    const dx = g.to[0] - g.from[0], dz = g.to[1] - g.from[1], L = Math.hypot(dx, dz)
    if (L < 2 || L > 200) return
    // the common line: abutment heights from the road bed, slope capped (the higher bank wins)
    // sampled 3 m back on the road side of each end: the bed there, not the river bank carved at the gap edge
    const ex = dx / L, ez = dz / L
    let hA = at(g.from[0] - ex * 3, g.from[1] - ez * 3) + 0.05, hB = at(g.to[0] + ex * 3, g.to[1] + ez * 3) + 0.05
    let capped = false
    // stepped relief (picture 120): the bank top just past the 3 m sample, where the deck end goes, stood up to
    // 4.8 m over the deck. The deck end rests on the highest ground it is buried in (the low road gets a ramp)
    const over = road.dirt ? 2 : BRIDGE_OVER + 6
    for (let d = 3; d <= over; d += 1) {
      const a = at(g.from[0] - ex * d, g.from[1] - ez * d) + 0.05, b = at(g.to[0] + ex * d, g.to[1] + ez * d) + 0.05
      if (a > hA + 0.3) { hA = a; capped = true }
      if (b > hB + 0.3) { hB = b; capped = true }
    }
    let slope = (hB - hA) / L
    if (Math.abs(slope) > BRIDGE_MAX_PITCH) {
      capped = true
      slope = Math.sign(slope) * BRIDGE_MAX_PITCH
      if (hA > hB) hB = hA + slope * L
      else hA = hB - slope * L
    }
    // ground inside the gap over the deck line (a bank hump the gap takes in, picture 120 decks 1.4-2.1 m under
    // it): the whole line goes up to clear it by 0.3 m
    let lift = 0
    for (let d = 0; d <= L; d += 2) lift = Math.max(lift, at(g.from[0] + ex * d, g.from[1] + ez * d) + 0.3 - (hA + slope * d))
    if (lift > 0.05) { hA += lift; hB += lift; capped = true }
    const hMid = (hA + hB) / 2
    const cx = (g.from[0] + g.to[0]) / 2, cz = (g.from[1] + g.to[1]) / 2
    const lineY = (s: number) => hMid + slope * s // s: metres from the gap centre towards `to`
    const base = `${g.id}_BRIDGE_${k}`
    const deckIds: string[] = []
    const tilt = (Math.atan(slope) * 180) / Math.PI
    if (road.dirt) {
      // wooden bridge: +Z along the road, pivot in the middle, deck surface at the pivot height
      const wy = Math.round((Math.atan2(dx, dz) * 180) / Math.PI)
      const wx = Math.sin((wy * Math.PI) / 180), wz = Math.cos((wy * Math.PI) / 180)
      const n = Math.max(1, Math.ceil((L + 4) / WOOD_LEN))
      for (let j = 0; j < n; j++) {
        const o = (j - (n - 1) / 2) * WOOD_LEN
        const id = `${base}_WOOD_${j}`
        deckIds.push(id)
        // nose up along +Z = negative editor X angle (SlopeAngles convention)
        out.push({ id, prefab: BRIDGE.wooden, x: r2(cx + wx * o), z: r2(cz + wz * o), yaw: wy, ycm: Math.round(lineY(o) * 100), ...(cd(tilt) ? { pitchcd: -cd(tilt) } : {}) })
      }
      plans.push({ id: base, a: [g.from[0], g.from[1], hA], b: [g.to[0], g.to[1], hB], slope, capped, deckIds, half: h })
      return
    }
    // +X of the model along the road: yaw turns +Z towards (sin, cos), so +X goes to (cos, -sin).
    // The yaw sent is whole degrees: lay the pieces along that rounded direction, else they drift sideways
    const yaw = Math.round((Math.atan2(-dz, dx) * 180) / Math.PI)
    const ux = Math.cos((yaw * Math.PI) / 180), uz = -Math.sin((yaw * Math.PI) / 180)
    const need = L + 2 * BRIDGE_DECK_REST // the ends go onto the banks
    // pieces: the length nearest `need`, never under the gap + BRIDGE_MIN_REST a side. Always rounding up (to 26 m)
    // laid up to 25 m more deck on the bank grass (picture 120: BRIDGE_1 78 m, BRIDGE_2 143 m over flat banks)
    const fit = (unit: number) => {
      const lo = Math.floor(need / unit)
      return lo * unit >= L + 2 * BRIDGE_MIN_REST && lo > 0 ? lo : Math.ceil(need / unit)
    }
    let pieces: { prefab: string; len: number }[]
    if (h <= 2.4 && need <= 13) pieces = [{ prefab: BRIDGE.small, len: 13 }]
    else if (h > 4.5) pieces = Array.from({ length: fit(26) }, () => ({ prefab: BRIDGE.wide, len: 26 }))
    else {
      const u = fit(13)
      pieces = Array.from({ length: u >> 1 }, () => ({ prefab: BRIDGE.narrowLong, len: 26 }))
      if (u % 2) pieces.push({ prefab: BRIDGE.narrow, len: 13 })
    }
    const total = pieces.reduce((s, p) => s + p.len, 0)
    // pivots are measured along the horizontal; along the tilted deck a piece covers len*cos: shrink the
    // horizontal step so consecutive pieces meet end to end on the line (no gap, no kink)
    const c = Math.cos(Math.atan(slope))
    let s = (-total * c) / 2
    // a deck rising along +X = negative editor Z angle (roll), SlopeAngles convention
    const rollcd = -cd(tilt)
    pieces.forEach((p, j) => {
      const x = cx + ux * s, z = cz + uz * s
      const y = lineY(s) - 0.13 * c // pivot under the deck top, along the deck normal
      const id = `${base}_DECK_${j}`
      deckIds.push(id)
      out.push({ id, prefab: p.prefab, x: r2(x), z: r2(z), yaw, ycm: Math.round(y * 100), ...(rollcd ? { rollcd } : {}) })
      if (j > 0 && p.prefab !== BRIDGE.small)
        out.push({ id: `${base}_PILLAR_${j}`, prefab: p.prefab === BRIDGE.wide ? BRIDGE.pillar : BRIDGE.pillarNarrow, x: r2(x), z: r2(z), yaw, ycm: Math.round(y * 100) - PILLAR_DROP })
      s += p.len * c
    })
    plans.push({ id: base, a: [g.from[0], g.from[1], hA], b: [g.to[0], g.to[1], hB], slope, capped, deckIds, half: h })
  })
  return { entities: out, plans }
}

/** [M] approach ramp of a capped bridge: metres of road raised beyond the 3 m abutment sample, side taper */
export const BRIDGE_RAMP = { len: 25, flat: 3, taper: 4 }
//! Height patches (2 m) that raise the terrain + road on the LOW bank of a bridge whose pitch was capped:
//! flat at the deck end for 3 m, then a straight ramp back down to the ground over BRIDGE_RAMP.len metres.
export function bridgeRampPatches(plans: RiverBridge[], heights: ArrayLike<number>, grid: Grid, step = 2): { minX: number; minZ: number; step: number; cols: number; rows: number; heights: number[] }[] {
  const at = sampler(heights, grid), out: { minX: number; minZ: number; step: number; cols: number; rows: number; heights: number[] }[] = []
  for (const p of plans) {
    if (!p.capped) continue
    const dx = p.b[0] - p.a[0], dz = p.b[1] - p.a[1], L = Math.hypot(dx, dz) || 1
    const ex = dx / L, ez = dz / L
    const sA = at(p.a[0] - ex * 3, p.a[1] - ez * 3), sB = at(p.b[0] + ex * 3, p.b[1] + ez * 3)
    const dA = p.a[2] - 0.05 - sA, dB = p.b[2] - 0.05 - sB
    // the low bank; both when the deck was raised over both road beds
    for (const useA of dA > dB ? (dB > 0.3 ? [true, false] : [true]) : (dA > 0.3 ? [false, true] : [false])) {
    const [x0, z0, y0] = useA ? p.a : p.b
    const ox = useA ? -ex : ex, oz = useA ? -ez : ez // outwards, along the road away from the river
    const top = y0 - 0.05, w = p.half + 2, R = BRIDGE_RAMP
    const far = R.flat + R.len + 3
    const xs = [x0, x0 + ox * far].flatMap((x) => [x - w - R.taper, x + w + R.taper]), zs = [z0, z0 + oz * far].flatMap((z) => [z - w - R.taper, z + w + R.taper])
    const minX = Math.floor(Math.min(...xs) / step) * step, minZ = Math.floor(Math.min(...zs) / step) * step
    const cols = Math.ceil((Math.max(...xs) - minX) / step) + 1, rows = Math.ceil((Math.max(...zs) - minZ) / step) + 1
    const hs: number[] = []
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const x = minX + c * step, z = minZ + r * step, g = at(x, z)
      const d = (x - x0) * ox + (z - z0) * oz, lat = Math.abs(-(x - x0) * oz + (z - z0) * ox)
      let y = g
      if (d >= -2 && d <= far && lat <= w + R.taper) {
        const k = d <= R.flat + 3 ? 1 : Math.max(0, 1 - (d - R.flat - 3) / R.len) // 1 = deck height
        const side = lat <= w ? 1 : 1 - (lat - w) / R.taper
        y = Math.max(g, g + (top - g) * k * side)
      }
      hs.push(Math.round(y * 100) / 100)
    }
    out.push({ minX, minZ, step, cols, rows, heights: hs })
    }
  }
  return out
}
//! terrain height with the patches on top (nearest patch sample where one covers the point)
export function patchedAt(heights: ArrayLike<number>, grid: Grid, patches: { minX: number; minZ: number; step: number; cols: number; rows: number; heights: number[] }[]): (x: number, z: number) => number {
  const at = sampler(heights, grid)
  return (x, z) => {
    for (const q of patches) {
      const c = Math.round((x - q.minX) / q.step), r = Math.round((z - q.minZ) / q.step)
      if (c >= 0 && r >= 0 && c < q.cols && r < q.rows) return q.heights[r * q.cols + c]
    }
    return at(x, z)
  }
}
//! a building (origin or corner) closer than `clear` m to a bridge deck, its buried ends (`over`) included
export function nearBridge(p: RiverBridge | { a: number[]; b: number[] }, b: { x: number; z: number; corners: number[] }, clear = 5, over = BRIDGE_OVER): boolean {
  const dx = p.b[0] - p.a[0], dz = p.b[1] - p.a[1], L = Math.hypot(dx, dz) || 1, ex = dx / L, ez = dz / L
  const ax = p.a[0] - ex * over, az = p.a[1] - ez * over, len = L + 2 * over
  const near = (x: number, z: number) => {
    const t = Math.max(0, Math.min(len, (x - ax) * ex + (z - az) * ez))
    return Math.hypot(x - ax - ex * t, z - az - ez * t) < clear + 3.5
  }
  if (near(b.x, b.z)) return true
  for (let k = 0; k + 1 < b.corners.length; k += 2) if (near(b.corners[k], b.corners[k + 1])) return true
  return false
}

//! River corridor raster: per grid vertex, distance (m) from the river edge (centre-line distance minus half
//! width; < 0 inside the water) for every open water, carved or not (carve:false rivers leave no wet cell, so
//! the wet mask alone never kept rocks / trees out of them). Rasterised once up to `reach` m from the banks;
//! farther cells stay Infinity. `near(x, z, m)` = within m metres of the water (nearest vertex + half a cell).
export function riverCorridor(g: Grid, waters: Water[], reach = 12) {
  const d = new Float32Array(g.cols * g.rows).fill(Infinity)
  for (const w of waters) {
    if (WATER_TYPES[w.type].closed || w.pts.length < 4) continue
    const c = riverCourse(w.pts, w.width), half = riverWetHalf(w), R = half + reach + g.step
    for (let i = 0; i + 3 < c.length; i += 2) {
      const ax = c[i], az = c[i + 1], bx = c[i + 2], bz = c[i + 3]
      const c0 = Math.max(0, Math.floor((Math.min(ax, bx) - R - g.minX) / g.step)), c1 = Math.min(g.cols - 1, Math.ceil((Math.max(ax, bx) + R - g.minX) / g.step))
      const r0 = Math.max(0, Math.floor((Math.min(az, bz) - R - g.minZ) / g.step)), r1 = Math.min(g.rows - 1, Math.ceil((Math.max(az, bz) + R - g.minZ) / g.step))
      for (let r = r0; r <= r1; r++) for (let q = c0; q <= c1; q++) {
        const v = segDist(g.minX + q * g.step, g.minZ + r * g.step, ax, az, bx, bz) - half, k = r * g.cols + q
        if (v < d[k]) d[k] = v
      }
    }
  }
  const near = (x: number, z: number, m: number) => {
    const q = Math.round((x - g.minX) / g.step), r = Math.round((z - g.minZ) / g.step)
    if (q < 0 || r < 0 || q >= g.cols || r >= g.rows) return false
    return d[r * g.cols + q] <= m + g.step * 0.71
  }
  return { dist: d, near }
}
