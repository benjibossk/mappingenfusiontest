// Zone tool, "scattered buildings": a large polygon dotted with FEW isolated groups (a farmstead =
// house + 1-2 barns / sheds, or a lone shed), far apart, preferably 40-150 m off an existing road,
// else joined to the nearest road by a short dirt track. Pure module, seeded, no UI.
// Buildings come from the same catalogue / categories the village generator uses (data/buildings.ts).

import type { Grid } from './island'
import type { Road } from './roads'
import { centreLine, roadHalf } from './roads'
import type { Water } from './water'
import { WATER_TYPES } from './water'
import type { Building, BuildingCat } from '../data/buildings'
import { BUILDINGS, FRONT_YAW } from '../data/buildings'
import { boxed, footprint, hash, inside, lineDist, overlap, rng, sampler, samples, type Line, type Placed } from './settlements'
import { nearestOn, polyGrade } from './villageStreets'

export interface ScatteredOptions {
  seed: number
  haPerGroup?: number // one group per N hectares (default 20)
  minSpacing?: number // between two groups (m, default 150)
  maxSlope?: number // ground slope at the group (default 0.15)
  blocked?: number[][] // [x0, z0, x1, z1] boxes to avoid (existing objects, industrial zones)
  pool?: Building[]
  prefix?: string // site id (default "SC")
}
export interface ScatteredResult {
  placed: Placed[] // keep + the new buildings
  lanes: Road[] // dirt tracks to the road network
  yards: number[][] // flat X/Z ring per group: fields / forest are cut under it
  groups: number
}

const ROAD_NEAR = 40, ROAD_FAR = 150, TRACK_MAX = 400
const DROP: Partial<Record<BuildingCat, number>> = { farm: 1.5, shed: 0.8, annex: 0.8 }

export function ringArea(r: number[]) {
  let a = 0
  for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) a += (r[j] - r[i]) * (r[j + 1] + r[i + 1])
  return Math.abs(a) / 2
}

export function scatterBuildings(polygon: number[], roads: Road[], waters: Water[], heights: ArrayLike<number>, grid: Grid, o: ScatteredOptions, keep: Placed[] = []): ScatteredResult {
  const at = sampler(heights, grid)
  const rand = rng(hash(o.prefix ?? 'SC', o.seed))
  const maxSlope = o.maxSlope ?? 0.15, spacing = o.minSpacing ?? 150
  const roadLines: Line[] = roads.filter((r) => r.pts.length >= 4).map((r) => boxed(centreLine(r.pts, 4), roadHalf(r)))
  const rivers = waters.filter((w) => !WATER_TYPES[w.type].closed).map((w) => boxed(w.pts, w.width / 2))
  const lakes = waters.filter((w) => WATER_TYPES[w.type].closed).map((w) => w.pts)
  const placed = keep.slice()
  const res: ScatteredResult = { placed, lanes: [], yards: [], groups: 0 }
  const pre = o.prefix ?? 'SC'
  const target = Math.max(1, Math.round(ringArea(polygon) / ((o.haPerGroup ?? 20) * 10000)))

  const wet = (x: number, z: number, m: number) => {
    if (at(x, z) < 0.5) return true
    for (const l of rivers) if (lineDist(l.pts, x, z) < l.half + m) return true
    for (const p of lakes) if (inside(p, x, z) || lineDist(p, x, z, true) < m) return true
    return false
  }
  const nearestRoad = (x: number, z: number) => {
    let best: [number, number, number] | null = null
    for (const l of roadLines) {
      const n = nearestOn(l.pts, x, z), d = n[2] - l.half
      if (!best || d < best[2]) best = [n[0], n[1], d]
    }
    return best
  }
  const slope = (x: number, z: number) => {
    const d = 10
    return Math.hypot(at(x + d, z) - at(x - d, z), at(x, z + d) - at(x, z - d)) / (2 * d)
  }
  const fits = (b: Building, c: number[]) => {
    for (const q of placed) if (Math.abs(q.x - c[0]) < 80 && Math.abs(q.z - c[1]) < 80 && overlap(c, q.corners, 2)) return false
    for (const [x0, z0, x1, z1] of o.blocked ?? []) if (overlap(c, [x0, z0, x1, z0, x1, z1, x0, z1], 2)) return false
    const pts = samples(c)
    let lo = Infinity, hi = -Infinity
    for (let i = 0; i < pts.length; i += 2) {
      const x = pts[i], z = pts[i + 1]
      if (!inside(polygon, x, z) || wet(x, z, 8)) return false
      for (const l of roadLines) if (lineDist(l.pts, x, z) < l.half + 4) return false
      const h = at(x, z)
      lo = Math.min(lo, h); hi = Math.max(hi, h)
    }
    return hi - lo <= (DROP[b.cat] ?? 1.2)
  }
  const pool = (cats: BuildingCat[]) => (o.pool ?? BUILDINGS).filter((b) => cats.includes(b.cat))
  const pick = <T>(a: T[]) => a[Math.floor(rand() * a.length)]

  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity
  for (let i = 0; i < polygon.length; i += 2) { minX = Math.min(minX, polygon[i]); maxX = Math.max(maxX, polygon[i]); minZ = Math.min(minZ, polygon[i + 1]); maxZ = Math.max(maxZ, polygon[i + 1]) }
  // candidate spots, best first: near a road (40-150 m), then anything else
  const cands: { x: number; z: number; r: [number, number, number] | null; s: number }[] = []
  for (let k = 0; k < target * 80; k++) {
    const x = minX + rand() * (maxX - minX), z = minZ + rand() * (maxZ - minZ)
    if (!inside(polygon, x, z) || wet(x, z, 25) || slope(x, z) > maxSlope) continue
    const r = nearestRoad(x, z)
    if (r && r[2] < 20) continue
    const s = r && r[2] >= ROAD_NEAR && r[2] <= ROAD_FAR ? 0 : r && r[2] <= TRACK_MAX ? 1 : 2
    cands.push({ x, z, r, s: s + rand() * 0.5 })
  }
  cands.sort((a, b) => a.s - b.s)
  const centres: number[][] = []
  for (const c of cands) {
    if (res.groups >= target) break
    if (centres.some(([x, z]) => Math.hypot(x - c.x, z - c.z) < spacing)) continue
    if (placed.some((q) => Math.hypot(q.x - c.x, q.z - c.z) < 60)) continue
    // front towards the road (or a random heading when none)
    let fx = 0, fz = 1
    if (c.r) { const l = Math.hypot(c.r[0] - c.x, c.r[1] - c.z) || 1; fx = (c.r[0] - c.x) / l; fz = (c.r[1] - c.z) / l } else { const a = rand() * Math.PI * 2; fx = Math.sin(a); fz = Math.cos(a) }
    const yaw = Math.round((Math.atan2(fx, fz) * 180) / Math.PI + FRONT_YAW)
    const gid = `${pre}_G${res.groups + 1}`
    const lone = rand() < 0.25
    const mainCats: BuildingCat[] = lone ? ['shed', 'annex'] : ['houseS', 'houseM', 'farm']
    const got: Placed[] = []
    for (let t = 0; t < 8 && !got.length; t++) {
      const b = pick(pool(t < 6 ? mainCats : ['shed', 'annex', 'houseS']))
      if (!b) break
      const cn = footprint(b, c.x, c.z, yaw)
      if (fits(b, cn)) got.push({ id: `${gid}_B1`, site: pre, prefab: b.prefab, tpl: b.tpl, cat: b.cat, x: c.x, z: c.z, yaw, corners: cn, role: lone ? 'annex' : 'farmhouse' })
    }
    if (!got.length) continue
    placed.push(got[0])
    // 1-2 barns / sheds beside or behind the house, at right angles or parallel
    if (!lone) {
      const want = 1 + (rand() < 0.5 ? 1 : 0)
      const rx = fz, rz = -fx // right of the front
      for (let t = 0; t < 12 && got.length < want + 1; t++) {
        const b = pick(pool(rand() < 0.4 ? ['farm'] : ['shed', 'annex']))
        if (!b) break
        const side = rand() < 0.5 ? -1 : 1, back = rand() < 0.5
        const d = 14 + rand() * 12
        const x = c.x + (back ? -fx * d : rx * side * d) + rx * (rand() - 0.5) * 6, z = c.z + (back ? -fz * d : rz * side * d) + rz * (rand() - 0.5) * 6
        const y2 = yaw + (rand() < 0.5 ? 90 : 0)
        const cn = footprint(b, x, z, y2)
        if (!fits(b, cn)) continue
        const q: Placed = { id: `${gid}_B${got.length + 1}`, site: pre, prefab: b.prefab, tpl: b.tpl, cat: b.cat, x, z, yaw: y2, corners: cn, role: 'farmyard' }
        got.push(q); placed.push(q)
      }
    }
    centres.push([c.x, c.z])
    res.groups++
    // yard: the group's bounding box padded 8 m, clipped to nothing here (main.ts cuts lower ranks by it)
    let a0 = Infinity, b0 = Infinity, a1 = -Infinity, b1 = -Infinity
    for (const q of got) for (let i = 0; i < 8; i += 2) { a0 = Math.min(a0, q.corners[i]); a1 = Math.max(a1, q.corners[i]); b0 = Math.min(b0, q.corners[i + 1]); b1 = Math.max(b1, q.corners[i + 1]) }
    a0 -= 8; b0 -= 8; a1 += 8; b1 += 8
    res.yards.push([a0, b0, a1, b0, a1, b1, a0, b1])
    // dirt track from the front of the house to the nearest road
    if (c.r && c.r[2] <= TRACK_MAX) {
      const sx = c.x + fx * 10, sz = c.z + fz * 10
      const L = Math.hypot(c.r[0] - sx, c.r[1] - sz), steps = Math.max(2, Math.ceil(L / 10))
      const pts: number[] = []
      let ok = L > 5
      for (let k = 0; k <= steps && ok; k++) {
        const x = sx + ((c.r[0] - sx) * k) / steps, z = sz + ((c.r[1] - sz) * k) / steps
        if (wet(x, z, 3)) ok = false
        else if (k < steps && placed.some((q) => inside(q.corners, x, z) || lineDist(q.corners, x, z, true) < 3)) ok = false
        pts.push(x, z)
      }
      if (ok && polyGrade(pts, at) <= 0.2) res.lanes.push({ id: `SET_${gid}_TRACK`, type: 'dirt', pts, auto: true })
    }
  }
  return res
}
