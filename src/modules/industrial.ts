// Industrial zones (ROADMAP_NEXT §4): a pure generator, no UI, no state.
// One zone = an oriented rectangle facing the nearest main road: a wide spine road joins that road,
// cross streets run parallel to it (grid), lots 40-120 m sit between them, each lot gets a chain-link
// fence with a gate gap on its cross street, a main building at the back (front = local +Z towards the
// street, FRONT_YAW convention), annexes and yard props in front. The ground under the zone is
// returned as a flatten request (a flat platform), applied by applyFlatten() or by the caller.
// suggestIndustrialSites() scores candidate places on the map (flatness, road access, distance to
// villages, water for some types) and returns the best N.

import type { Grid } from './island'
import type { Road, RoadType } from './roads'
import { centreLine, roadHalf, roadShapes } from './roads'
import type { ProjectEntity, ProjectShape } from '../project'
import type { IndustrialBuilding, IndustrialRole, IndustrialTag } from '../data/buildings'
import { FENCE_NET, FRONT_YAW, industrialFor } from '../data/buildings'

export type IndustrialType = IndustrialTag // 'factory' | 'depot' | 'quarry' | 'farm' | 'fuel'
export const INDUSTRIAL_TYPES: IndustrialType[] = ['factory', 'depot', 'quarry', 'farm', 'fuel']

export interface IndustrialOptions {
  type: IndustrialType
  seed: number
  /** zone: polygon (flat X/Z pairs) OR centre + size (width along the road, depth away from it) */
  polygon?: number[]
  center?: { x: number; z: number }
  size?: { w: number; d: number }
  lotMin?: number // lot width along a street, m (default 40)
  lotMax?: number // default 120 (quarry 160)
  rowDepth?: number // lot depth, m (default by type, 50-90)
  setback?: number // main road edge -> zone, m (default 15)
  spineWidth?: number // default 10
  streetWidth?: number // default 8
  gateWidth?: number // default 8
  props?: number // yard props per lot (default 4)
  idPrefix?: string // default 'ind'
}

export interface IndustrialLot { id: string; corners: number[]; gate: { x: number; z: number; yaw: number; width: number } }
export interface IndustrialPlaced { id: string; prefab: string; role: IndustrialRole; lot: string; x: number; z: number; yaw: number; corners: number[] }
/** flat platform: every cell inside `polygon` is set to `height`, blended to the terrain over `falloff` m */
export interface FlattenRequest { kind: 'platform'; polygon: number[]; height: number; falloff: number; slope: number }
export interface IndustrialZone {
  type: IndustrialType
  roads: Road[] // spine + cross streets (Road objects, same as network.ts output)
  lots: IndustrialLot[]
  placed: IndustrialPlaced[]
  fences: ProjectShape[] // open polylines, gap = gate
  shapes: ProjectShape[] // roadShapes(roads) + fences, ready for the project
  entities: ProjectEntity[]
  flatten: FlattenRequest
  /** frame: origin on the main road centre line, U along it, V into the zone */
  frame: { ox: number; oz: number; ux: number; uz: number; vx: number; vz: number; joined: boolean }
  warnings: string[]
}

const TYPE_DEFAULTS: Record<IndustrialType, { rowDepth: number; lotMax: number; road: RoadType; spineRoad: RoadType }> = {
  factory: { rowDepth: 70, lotMax: 120, road: 'concrete', spineRoad: 'asphalt' },
  depot: { rowDepth: 60, lotMax: 110, road: 'concrete', spineRoad: 'asphalt' },
  quarry: { rowDepth: 90, lotMax: 160, road: 'dirt', spineRoad: 'concretePanel' },
  farm: { rowDepth: 70, lotMax: 120, road: 'dirt', spineRoad: 'concretePanel' },
  fuel: { rowDepth: 55, lotMax: 90, road: 'concrete', spineRoad: 'asphalt' },
}

// ---- small helpers ---------------------------------------------------------------------------
export function rng(seed: number) {
  let a = seed >>> 0 || 0x9e3779b9
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const r2 = (v: number) => Math.round(v * 100) / 100

export function footprintOf(b: { minX: number; minZ: number; maxX: number; maxZ: number }, x: number, z: number, yaw: number, pad = 0): number[] {
  const a = (yaw * Math.PI) / 180, s = Math.sin(a), c = Math.cos(a)
  const out: number[] = []
  for (const [lx, lz] of [[b.minX - pad, b.minZ - pad], [b.maxX + pad, b.minZ - pad], [b.maxX + pad, b.maxZ + pad], [b.minX - pad, b.maxZ + pad]]) out.push(x + lx * c + lz * s, z - lx * s + lz * c)
  return out
}

//! separating-axis test between two convex polygons (flat X/Z pairs)
export function polysOverlap(p: number[], q: number[]): boolean {
  for (const poly of [p, q]) {
    const n = poly.length / 2
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n
      const ax = -(poly[j * 2 + 1] - poly[i * 2 + 1]), az = poly[j * 2] - poly[i * 2]
      let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity
      for (let k = 0; k < p.length; k += 2) { const d = p[k] * ax + p[k + 1] * az; a0 = Math.min(a0, d); a1 = Math.max(a1, d) }
      for (let k = 0; k < q.length; k += 2) { const d = q[k] * ax + q[k + 1] * az; b0 = Math.min(b0, d); b1 = Math.max(b1, d) }
      if (a1 <= b0 || b1 <= a0) return false
    }
  }
  return true
}

export function pointInPoly(poly: number[], x: number, z: number): boolean {
  let inside = false
  for (let i = 0, j = poly.length / 2 - 1; i < poly.length / 2; j = i++) {
    const xi = poly[i * 2], zi = poly[i * 2 + 1], xj = poly[j * 2], zj = poly[j * 2 + 1]
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside
  }
  return inside
}

const isMain = (r: Road) => !['dirt', 'dirt2', 'forest'].includes(r.type)

//! nearest point on the main roads (falls back to any road): position, unit tangent, distance, half width
export function nearestRoad(roads: Road[], x: number, z: number) {
  const pool = roads.some(isMain) ? roads.filter(isMain) : roads
  let best: { x: number; z: number; tx: number; tz: number; d: number; half: number; road: Road } | null = null
  for (const r of pool) {
    if (r.pts.length < 4) continue
    const l = centreLine(r.pts, 10)
    for (let i = 0; i + 3 < l.length; i += 2) {
      const ax = l[i], az = l[i + 1], bx = l[i + 2], bz = l[i + 3]
      const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz
      if (L2 < 1e-6) continue
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2))
      const px = ax + dx * t, pz = az + dz * t, d = Math.hypot(x - px, z - pz)
      if (!best || d < best.d) { const L = Math.sqrt(L2); best = { x: px, z: pz, tx: dx / L, tz: dz / L, d, half: roadHalf(r), road: r } }
    }
  }
  return best
}

// ---- generator -------------------------------------------------------------------------------
export function generateIndustrial(heightAt: (x: number, z: number) => number, roads: Road[], o: IndustrialOptions): IndustrialZone {
  const def = TYPE_DEFAULTS[o.type]
  const rand = rng(o.seed * 7919 + INDUSTRIAL_TYPES.indexOf(o.type))
  const pre = o.idPrefix ?? 'ind'
  const warnings: string[] = []
  const lotMin = o.lotMin ?? 40, lotMax = Math.max(lotMin, o.lotMax ?? def.lotMax)
  const rowDepth = o.rowDepth ?? def.rowDepth
  const setback = o.setback ?? 15
  const spineH = (o.spineWidth ?? 10) / 2, streetH = (o.streetWidth ?? 8) / 2
  const gateW = o.gateWidth ?? 8
  const nProps = o.props ?? 4

  // zone centre
  let cx: number, cz: number
  if (o.polygon && o.polygon.length >= 6) {
    cx = 0; cz = 0
    for (let i = 0; i < o.polygon.length; i += 2) { cx += o.polygon[i]; cz += o.polygon[i + 1] }
    cx /= o.polygon.length / 2; cz /= o.polygon.length / 2
  } else if (o.center) { cx = o.center.x; cz = o.center.z } else throw new Error('industrial: polygon or center required')

  // frame from the nearest main road
  const nr = nearestRoad(roads, cx, cz)
  let ox: number, oz: number, ux: number, uz: number, vx: number, vz: number, mainHalf = 0
  const joined = !!nr && nr.d > 1
  if (nr && joined) {
    ox = nr.x; oz = nr.z; mainHalf = nr.half
    vx = (cx - ox) / nr.d; vz = (cz - oz) / nr.d
    ux = vz; uz = -vx // perpendicular to V (≈ road tangent)
  } else {
    warnings.push('no main road near the zone: no junction')
    vx = 0; vz = 1; ux = 1; uz = 0
    const d = o.size ? o.size.d : 200
    ox = cx; oz = cz - d / 2 - setback
  }
  const W = (u: number, v: number): [number, number] => [ox + u * ux + v * vx, oz + u * uz + v * vz]
  const toLocal = (x: number, z: number): [number, number] => [(x - ox) * ux + (z - oz) * uz, (x - ox) * vx + (z - oz) * vz]

  // extents in the frame
  let u0: number, u1: number, v0: number, v1: number
  if (o.polygon && o.polygon.length >= 6) {
    u0 = Infinity; u1 = -Infinity; v0 = Infinity; v1 = -Infinity
    for (let i = 0; i < o.polygon.length; i += 2) {
      const [u, v] = toLocal(o.polygon[i], o.polygon[i + 1])
      u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v)
    }
  } else {
    const w = o.size?.w ?? 240, d = o.size?.d ?? 200
    const [, vc] = toLocal(cx, cz)
    u0 = -w / 2; u1 = w / 2; v0 = vc - d / 2; v1 = vc + d / 2
  }
  v0 = Math.max(v0, mainHalf + setback)
  const inZone = (x: number, z: number) => !o.polygon || o.polygon.length < 6 || pointInPoly(o.polygon, x, z)

  // rows: cross street then a band of lots behind it
  const rows: { c: number; a: number; b: number }[] = []
  let c = v0 + streetH
  while (c + streetH + 2 + Math.min(rowDepth, 40) <= v1) {
    const a = c + streetH + 2, b = Math.min(a + rowDepth, v1)
    if (b - a < 35) break
    rows.push({ c, a, b })
    c = b + 2 + streetH + 2
  }
  if (!rows.length) warnings.push('zone too small for one row of lots')

  const roadsOut: Road[] = []
  const lots: IndustrialLot[] = []
  const placed: IndustrialPlaced[] = []
  const fences: ProjectShape[] = []
  const yawFront = (Math.atan2(-vx, -vz) * 180) / Math.PI + FRONT_YAW // front faces -V (its street)
  const mains = industrialFor(o.type, 'main'), annexes = industrialFor(o.type, 'annex'), props = industrialFor(o.type, 'prop')
  const pick = <T>(a: T[]) => a[Math.floor(rand() * a.length)]

  let rowUsed = 0, uMin = Infinity, uMax = -Infinity
  rows.forEach((row, ri) => {
    let any = false, ru0 = Infinity, ru1 = -Infinity
    for (const side of [-1, 1]) {
      // cut the half band [spine edge, zone edge] into lots
      const start = spineH + 2, end = side < 0 ? -u0 : u1
      let p = start
      while (end - p >= lotMin) {
        let w = lotMin + rand() * (lotMax - lotMin)
        if (end - p - w < lotMin) w = end - p // last lot takes the rest
        if (w > lotMax * 1.4) w = lotMax
        const ua = side < 0 ? -(p + w) : p, ub = side < 0 ? -p : p + w
        p += w + 4 // 4 m between neighbouring fences
        const cornersL: [number, number][] = [[ua, row.a], [ub, row.a], [ub, row.b], [ua, row.b]]
        const corners = cornersL.flatMap(([u, v]) => W(u, v))
        let ok = true
        for (let k = 0; k < 8; k += 2) if (!inZone(corners[k], corners[k + 1])) ok = false
        if (!ok) continue
        const id = `${pre}_${o.seed}_${ri}_${lots.length}`
        // gate on the street side, near the spine end (shorter drive)
        const gu = side < 0 ? Math.max(ua + gateW, ub - gateW - 6) : Math.min(ub - gateW, ua + gateW + 6)
        const [gx, gz] = W(gu, row.a)
        const lot: IndustrialLot = { id, corners: corners.map(r2), gate: { x: r2(gx), z: r2(gz), yaw: Math.round(yawFront), width: gateW } }
        lots.push(lot)
        any = true; ru0 = Math.min(ru0, ua); ru1 = Math.max(ru1, ub)
        // fence: open polyline from one gate post round the lot to the other
        const g0 = W(gu - gateW / 2, row.a), g1 = W(gu + gateW / 2, row.a)
        fences.push({ id: `${id}_fence`, kind: 'polyline', closed: false, generator: FENCE_NET,
          points: [...g1, ...W(ub, row.a), ...W(ub, row.b), ...W(ua, row.b), ...W(ua, row.a), ...g0].map(r2) })
        fillLot(lot, ua, ub, row.a, row.b, gu)
      }
    }
    if (any) {
      rowUsed = ri; uMin = Math.min(uMin, ru0); uMax = Math.max(uMax, ru1)
      const [ax, az] = W(Math.min(ru0, -spineH), row.c), [bx, bz] = W(Math.max(ru1, spineH), row.c)
      roadsOut.push({ id: `${pre}_${o.seed}_street${ri}`, type: def.road, pts: [ax, az, bx, bz].map(r2), width: streetH * 2 })
    }
  })
  if (lots.length) {
    const [sx, sz] = W(0, joined ? 0 : v0), [ex, ez] = W(0, rows[rowUsed].c)
    roadsOut.unshift({ id: `${pre}_${o.seed}_spine`, type: def.spineRoad, pts: [sx, sz, ex, ez].map(r2), width: spineH * 2 })
  }

  function fillLot(lot: IndustrialLot, ua: number, ub: number, va: number, vb: number, gu: number) {
    const taken: number[][] = []
    // drive from the gate 20 m in (kept free)
    taken.push([...W(gu - gateW / 2 - 1, va), ...W(gu + gateW / 2 + 1, va), ...W(gu + gateW / 2 + 1, va + 20), ...W(gu - gateW / 2 - 1, va + 20)])
    const inner = 3 // clearance to the fence
    const fits = (fp: number[]) => {
      for (let k = 0; k < fp.length; k += 2) {
        const [u, v] = toLocal(fp[k], fp[k + 1])
        if (u < ua + inner || u > ub - inner || v < va + inner || v > vb - inner) return false
      }
      return !taken.some((t) => polysOverlap(t, fp))
    }
    const put = (b: IndustrialBuilding, u: number, v: number, yaw: number) => {
      const [x, z] = W(u, v)
      const fp = footprintOf(b, x, z, yaw, 1.5)
      if (!fits(fp)) return false
      taken.push(fp)
      placed.push({ id: `${lot.id}_${placed.length}`, prefab: b.prefab, role: b.role, lot: lot.id, x: r2(x), z: r2(z), yaw: Math.round(((yaw % 360) + 540) % 360 - 180), corners: footprintOf(b, x, z, yaw).map(r2) })
      return true
    }
    // main building: biggest that fits, back of the lot, front towards the street
    const order = [...mains].sort((a, b) => (b.maxX - b.minX) * (b.maxZ - b.minZ) - (a.maxX - a.minX) * (a.maxZ - a.minZ))
    const startK = Math.floor(rand() * Math.min(2, order.length))
    let done = false
    for (let k = 0; k < order.length && !done; k++) {
      const b = order[(startK + k) % order.length]
      const um = (ua + ub) / 2 + (rand() - 0.5) * Math.max(0, ub - ua - (b.maxX - b.minX) - 10) * 0.5
      // front = local +Z = -V: local maxZ points to the street, minZ to the back
      const v = vb - inner - 2 - (-b.minZ)
      done = put(b, um, v, yawFront)
    }
    // annexes then props: random tries, axis-aligned with the lot (0/90/180/270)
    const tryPlace = (pool: IndustrialBuilding[], count: number, tries: number) => {
      let n = 0
      for (let t = 0; t < tries && n < count && pool.length; t++) {
        const b = pick(pool)
        const u = ua + rand() * (ub - ua), v = va + rand() * (vb - va)
        if (put(b, u, v, yawFront + 90 * Math.floor(rand() * 4))) n++
      }
    }
    tryPlace(annexes, 1 + Math.floor(rand() * 2), 60)
    if (o.type === 'fuel') tryPlace(mains, 2, 60) // fuel depot: a tank farm
    tryPlace(props, nProps, 80)
  }

  // flatten: the zone rectangle (used part) + 5 m
  const fu0 = (isFinite(uMin) ? Math.min(uMin, -spineH) : u0) - 5, fu1 = (isFinite(uMax) ? Math.max(uMax, spineH) : u1) + 5
  const fv0 = v0 - 2, fv1 = (rows.length ? rows[rowUsed].b : v1) + 5
  const poly = [...W(fu0, fv0), ...W(fu1, fv0), ...W(fu1, fv1), ...W(fu0, fv1)].map(r2)
  const st = zoneStats(heightAt, poly)
  const flatten: FlattenRequest = { kind: 'platform', polygon: poly, height: r2(st.mean), falloff: 20, slope: r2(st.slope) }
  if (st.slope > 0.08) warnings.push(`steep ground under the zone (${Math.round(st.slope * 100)} %): heavy flattening`)

  const entities: ProjectEntity[] = placed.map((q) => ({ id: q.id, prefab: q.prefab, x: q.x, z: q.z, yaw: q.yaw }))
  return {
    type: o.type, roads: roadsOut, lots, placed, fences, shapes: [...roadShapes(roadsOut), ...fences], entities, flatten,
    frame: { ox: r2(ox), oz: r2(oz), ux, uz, vx, vz, joined }, warnings,
  }
}

//! mean height and slope (height range / diagonal) over a convex quad, 7x7 samples
export function zoneStats(heightAt: (x: number, z: number) => number, quad: number[]) {
  let sum = 0, n = 0, lo = Infinity, hi = -Infinity
  for (let i = 0; i <= 6; i++) for (let j = 0; j <= 6; j++) {
    const a = i / 6, b = j / 6
    const x = (1 - a) * (1 - b) * quad[0] + a * (1 - b) * quad[2] + a * b * quad[4] + (1 - a) * b * quad[6]
    const z = (1 - a) * (1 - b) * quad[1] + a * (1 - b) * quad[3] + a * b * quad[5] + (1 - a) * b * quad[7]
    const h = heightAt(x, z)
    sum += h; n++; lo = Math.min(lo, h); hi = Math.max(hi, h)
  }
  const diag = Math.hypot(quad[4] - quad[0], quad[5] - quad[1]) || 1
  return { mean: sum / n, slope: (hi - lo) / diag, range: hi - lo }
}

//! applies a flatten request to a height grid in place (same row-major layout as carveRoads)
export function applyFlatten(heights: number[] | Float32Array, grid: Grid, f: FlattenRequest) {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity
  for (let i = 0; i < f.polygon.length; i += 2) { x0 = Math.min(x0, f.polygon[i]); x1 = Math.max(x1, f.polygon[i]); z0 = Math.min(z0, f.polygon[i + 1]); z1 = Math.max(z1, f.polygon[i + 1]) }
  const c0 = Math.max(0, Math.floor((x0 - f.falloff - grid.minX) / grid.step)), c1 = Math.min(grid.cols - 1, Math.ceil((x1 + f.falloff - grid.minX) / grid.step))
  const q0 = Math.max(0, Math.floor((z0 - f.falloff - grid.minZ) / grid.step)), q1 = Math.min(grid.rows - 1, Math.ceil((z1 + f.falloff - grid.minZ) / grid.step))
  const n = f.polygon.length / 2
  for (let r = q0; r <= q1; r++) for (let c = c0; c <= c1; c++) {
    const x = grid.minX + c * grid.step, z = grid.minZ + r * grid.step
    let d = 0
    if (!pointInPoly(f.polygon, x, z)) {
      d = Infinity
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n, ax = f.polygon[i * 2], az = f.polygon[i * 2 + 1], dx = f.polygon[j * 2] - ax, dz = f.polygon[j * 2 + 1] - az
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)))
        d = Math.min(d, Math.hypot(x - ax - dx * t, z - az - dz * t))
      }
      if (d >= f.falloff) continue
    }
    const t = d / f.falloff, w = 1 - t * t * (3 - 2 * t)
    const k = r * grid.cols + c
    heights[k] = heights[k] * (1 - w) + f.height * w
  }
}

// ---- site suggester --------------------------------------------------------------------------
export interface SuggestOptions {
  type: IndustrialType
  bounds: { minX: number; minZ: number; maxX: number; maxZ: number }
  size?: { w: number; d: number } // default 240 x 200
  villages?: { x: number; z: number; r: number }[] // e.g. sites with SITE_RADIUS[kind]
  waterDist?: (x: number, z: number) => number // distance to river / lake / sea shore, m
  isWater?: (x: number, z: number) => boolean
  step?: number // candidate spacing, default 100 m
  n?: number // default 5
}
export interface SiteSuggestion { x: number; z: number; score: number; slope: number; roadDist: number; villageDist: number; waterDist: number }

const WANTS_WATER: Record<IndustrialType, number> = { factory: 1, depot: 0.3, quarry: 0.6, farm: 0.6, fuel: 0.5 }

export function suggestIndustrialSites(heightAt: (x: number, z: number) => number, roads: Road[], o: SuggestOptions): SiteSuggestion[] {
  const w = o.size?.w ?? 240, d = o.size?.d ?? 200, step = o.step ?? 100, R = Math.max(w, d) / 2
  const out: SiteSuggestion[] = []
  for (let x = o.bounds.minX + R; x <= o.bounds.maxX - R; x += step) for (let z = o.bounds.minZ + R; z <= o.bounds.maxZ - R; z += step) {
    if (o.isWater && (o.isWater(x, z) || o.isWater(x - w / 2, z - d / 2) || o.isWater(x + w / 2, z + d / 2) || o.isWater(x - w / 2, z + d / 2) || o.isWater(x + w / 2, z - d / 2))) continue
    const nr = nearestRoad(roads, x, z)
    const roadDist = nr ? nr.d : Infinity
    if (roadDist < R * 0.5 + 15 || roadDist > R + 400) continue // must sit beside a road, not on it
    const st = zoneStats(heightAt, [x - w / 2, z - d / 2, x + w / 2, z - d / 2, x + w / 2, z + d / 2, x - w / 2, z + d / 2])
    if (st.slope > 0.12) continue
    let villageDist = Infinity
    for (const v of o.villages ?? []) villageDist = Math.min(villageDist, Math.hypot(v.x - x, v.z - z) - v.r - R)
    if (villageDist < 60) continue // away from village centres
    const waterDist = o.waterDist ? o.waterDist(x, z) : Infinity
    let score = 0
    score += 40 * (1 - st.slope / 0.12) // flatness
    score += 25 * (1 - Math.max(0, roadDist - R) / 400) // access
    if (isFinite(villageDist)) score += villageDist < 600 ? 20 * Math.min(1, villageDist / 150) : 20 - Math.min(15, (villageDist - 600) / 100) // periphery
    if (isFinite(waterDist)) score += 15 * WANTS_WATER[o.type] * Math.max(0, 1 - waterDist / 500)
    out.push({ x: r2(x), z: r2(z), score: r2(score), slope: r2(st.slope), roadDist: r2(roadDist), villageDist: r2(villageDist), waterDist: r2(waterDist) })
  }
  out.sort((a, b) => b.score - a.score || a.x - b.x || a.z - b.z)
  const top: SiteSuggestion[] = []
  for (const s of out) {
    if (top.some((t) => Math.hypot(t.x - s.x, t.z - s.z) < R * 2.5)) continue
    top.push(s)
    if (top.length >= (o.n ?? 5)) break
  }
  return top
}
