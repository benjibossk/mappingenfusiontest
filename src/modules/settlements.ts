// Settlements, step 1 (docs/CITIES.md §3.3 "hameau-rue", §3.8 step 1): no new streets. Along the
// existing roads around each site, a buildable strip on each side is cut into plots; a house is
// placed at the front of a plot, facing the road, with an optional annex at the back.
// Deterministic from the seed. Footprints are oriented boxes from the measured prefab bounds.

import type { Grid } from './island'
import type { Site, SiteKind } from './network'
import { SITE_RADIUS } from './network'
import type { Road, RoadType } from './roads'
import { centreLine, roadHalf, ROAD_TYPES } from './roads'
import type { Water } from './water'
import { WATER_TYPES } from './water'
import type { ProjectEntity, ProjectShape } from '../project'
import type { Building, BuildingCat } from '../data/buildings'
import { BUILDINGS, FRONT_YAW } from '../data/buildings'

export interface Placed {
  id: string
  site: string
  prefab: string
  cat: BuildingCat
  x: number // entity origin, world metres
  z: number
  yaw: number // integer degrees
  corners: number[] // footprint, 4 world X/Z pairs
}

export interface SettleParams {
  seed: number
  density: number // multiplier of the fill probability (1 = rings 90/70/45/20 %)
}

// distance from the site centre over which roads are lined with houses (hamlets: a street of
// 150-400 m, so wider than the site disc itself)
const REACH: Record<SiteKind, number> = { town: 400, village: 230, hamlet: 150 }
const STRIP = 42 // buildable depth behind the road edge, metres
const ROAD_MARGIN = 1.5 // clearance between a footprint and any road surface
const WATER_MARGIN = 5
const GAP = 1 // minimal distance between two footprints
const MAX_DROP: Record<BuildingCat, number> = { houseS: 1.2, houseM: 1.2, houseL: 1.0, farm: 1.5, civic: 1.0, annex: 0.6, shed: 0.6 }

function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const hash = (s: string, seed: number) => {
  let h = seed ^ 0x9e3779b9
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193)
  return h >>> 0
}

const sampler = (heights: ArrayLike<number>, grid: Grid) => {
  const { cols, rows, step, minX, minZ } = grid
  return (x: number, z: number) => {
    const gx = Math.min(Math.max((x - minX) / step, 0), cols - 1.001), gz = Math.min(Math.max((z - minZ) / step, 0), rows - 1.001)
    const c = Math.floor(gx), r = Math.floor(gz), fx = gx - c, fz = gz - r
    const i = r * cols + c
    const a = heights[i] + (heights[i + 1] - heights[i]) * fx
    const b = heights[i + cols] + (heights[i + cols + 1] - heights[i + cols]) * fx
    return a + (b - a) * fz
  }
}

//! distance from (x, z) to a polyline (flat pairs)
function lineDist(line: number[], x: number, z: number, closed = false) {
  let best = Infinity
  const n = line.length / 2
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const j = (i + 1) % n
    const ax = line[i * 2], az = line[i * 2 + 1], bx = line[j * 2] - ax, bz = line[j * 2 + 1] - az
    const l2 = bx * bx + bz * bz
    const u = l2 > 0 ? Math.min(Math.max(((x - ax) * bx + (z - az) * bz) / l2, 0), 1) : 0
    best = Math.min(best, Math.hypot(x - ax - bx * u, z - az - bz * u))
  }
  return best
}
function inside(ring: number[], x: number, z: number) {
  let r = false
  for (let i = 0, j = ring.length / 2 - 1; i < ring.length / 2; j = i++) {
    const xi = ring[i * 2], zi = ring[i * 2 + 1], xj = ring[j * 2], zj = ring[j * 2 + 1]
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) r = !r
  }
  return r
}

//! world footprint of building b with its origin at (x, z) and yaw (deg): +Z forward = (sin, cos), +X right = (cos, -sin)
export function footprint(b: Building, x: number, z: number, yaw: number): number[] {
  const a = (yaw * Math.PI) / 180, s = Math.sin(a), c = Math.cos(a)
  const out: number[] = []
  for (const [lx, lz] of [[b.minX, b.minZ], [b.maxX, b.minZ], [b.maxX, b.maxZ], [b.minX, b.maxZ]]) out.push(x + lx * c + lz * s, z - lx * s + lz * c)
  return out
}

//! separating-axis test between two convex quads, with `gap` metres of clearance
function overlap(p: number[], q: number[], gap: number) {
  for (const poly of [p, q]) {
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4
      let ax = -(poly[j * 2 + 1] - poly[i * 2 + 1]), az = poly[j * 2] - poly[i * 2]
      const l = Math.hypot(ax, az) || 1
      ax /= l; az /= l
      let pmin = Infinity, pmax = -Infinity, qmin = Infinity, qmax = -Infinity
      for (let k = 0; k < 4; k++) {
        const u = p[k * 2] * ax + p[k * 2 + 1] * az, v = q[k * 2] * ax + q[k * 2 + 1] * az
        pmin = Math.min(pmin, u); pmax = Math.max(pmax, u); qmin = Math.min(qmin, v); qmax = Math.max(qmax, v)
      }
      if (pmax + gap <= qmin || qmax + gap <= pmin) return false
    }
  }
  return true
}

//! points inside a footprint: corners, centre, and a ~4 m lattice
function samples(c: number[]) {
  const out: number[] = []
  const ux = c[2] - c[0], uz = c[3] - c[1], vx = c[6] - c[0], vz = c[7] - c[1]
  const nu = Math.max(1, Math.ceil(Math.hypot(ux, uz) / 4)), nv = Math.max(1, Math.ceil(Math.hypot(vx, vz) / 4))
  for (let i = 0; i <= nu; i++) for (let j = 0; j <= nv; j++) out.push(c[0] + (ux * i) / nu + (vx * j) / nv, c[1] + (uz * i) / nu + (vz * j) / nv)
  return out
}

interface Line { pts: number[]; half: number; minX: number; minZ: number; maxX: number; maxZ: number }
const boxed = (pts: number[], half: number): Line => {
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity
  for (let i = 0; i < pts.length; i += 2) {
    minX = Math.min(minX, pts[i]); maxX = Math.max(maxX, pts[i]); minZ = Math.min(minZ, pts[i + 1]); maxZ = Math.max(maxZ, pts[i + 1])
  }
  return { pts, half, minX, minZ, maxX, maxZ }
}

//! fill probability by ring (fraction of the reach from the centre)
const ringProb = (f: number) => (f < 0.25 ? 0.9 : f < 0.5 ? 0.7 : f < 0.75 ? 0.45 : 0.2)

export interface SettleOptions {
  square: boolean // central green kept free, the civic building facing it (villages, towns)
  lanes: boolean // secondary dead-end lanes branching off the roads (villages, towns)
  paths: boolean // worn footpaths: doors to the road, to the annex, between back gardens, to the square
}
export interface Square { site: string; x: number; z: number; r: number }
export type District = 'centre' | 'mid' | 'edge'
export interface Settlement {
  placed: Placed[]
  lanes: Road[] // SET_<site>_LANE_<n>
  paths: Road[] // SET_<site>_PATH_<n>
  squares: Square[]
}

const SQUARE_R: Record<SiteKind, number> = { town: 24, village: 15, hamlet: 0 }
const LANE_COUNT: Record<SiteKind, [number, number]> = { town: [4, 4], village: [1, 3], hamlet: [0, 0] }
const PATH_TYPE: RoadType = 'trailDirt' // all trail types are 2 m wide: the plain dirt one
const MIN_SEG = 5 // the road generator rejects shorter spline segments

//! Chaikin smoothing (one pass, end points kept)
function chaikin(p: number[]): number[] {
  if (p.length < 6) return p
  const out = [p[0], p[1]]
  for (let i = 0; i < p.length / 2 - 1; i++) {
    const ax = p[i * 2], az = p[i * 2 + 1], bx = p[i * 2 + 2], bz = p[i * 2 + 3]
    out.push(ax * 0.75 + bx * 0.25, az * 0.75 + bz * 0.25, ax * 0.25 + bx * 0.75, az * 0.25 + bz * 0.75)
  }
  out.push(p[p.length - 2], p[p.length - 1])
  return out
}
//! drop points so that every segment is at least `min` metres (end points kept); null if too short
function minSegments(p: number[], min = MIN_SEG): number[] | null {
  const n = p.length / 2
  if (n < 2) return null
  const out = [p[0], p[1]]
  for (let i = 1; i < n - 1; i++)
    if (Math.hypot(p[i * 2] - out[out.length - 2], p[i * 2 + 1] - out[out.length - 1]) >= min) out.push(p[i * 2], p[i * 2 + 1])
  const lx = p[p.length - 2], lz = p[p.length - 1]
  while (out.length > 2 && Math.hypot(lx - out[out.length - 2], lz - out[out.length - 1]) < min) out.length -= 2
  out.push(lx, lz)
  return Math.hypot(out[2] - out[0], out[3] - out[1]) >= min ? out : null
}

export function settle(sites: Site[], roads: Road[], waters: Water[], heights: ArrayLike<number>, grid: Grid, p: SettleParams, opt: SettleOptions, keep: Placed[] = []): Settlement {
  const at = sampler(heights, grid)
  const roadLines = roads.filter((r) => r.pts.length >= 4).map((r) => boxed(centreLine(r.pts, 4), roadHalf(r)))
  const rivers = waters.filter((w) => !WATER_TYPES[w.type].closed).map((w) => boxed(w.pts, w.width / 2))
  const lakes = waters.filter((w) => WATER_TYPES[w.type].closed).map((w) => boxed(w.pts, 0))
  const placed: Placed[] = keep.slice()
  const lanes: Road[] = []
  const paths: Road[] = []
  const squares: Square[] = []

  const near = (l: Line, x: number, z: number, d: number) => x > l.minX - d && x < l.maxX + d && z > l.minZ - d && z < l.maxZ + d
  //! distance from (x, z) to the nearest road or lane surface edge
  const roadDist = (x: number, z: number, skip?: Line) => {
    let best = Infinity
    for (const l of roadLines) if (l !== skip && near(l, x, z, 30)) best = Math.min(best, lineDist(l.pts, x, z) - l.half)
    return best
  }
  const wet = (x: number, z: number, m: number) => {
    for (const l of rivers) if (near(l, x, z, l.half + m) && lineDist(l.pts, x, z) < l.half + m) return true
    for (const l of lakes) if (near(l, x, z, m) && (inside(l.pts, x, z) || lineDist(l.pts, x, z, true) < m)) return true
    return false
  }
  const inSquare = (x: number, z: number, m: number) => squares.some((s) => Math.hypot(x - s.x, z - s.z) < s.r + m)
  const fits = (b: Building, c: number[]) => {
    for (const q of placed) if (overlap(c, q.corners, GAP)) return false
    const pts = samples(c)
    let lo = Infinity, hi = -Infinity
    for (let i = 0; i < pts.length; i += 2) {
      const x = pts[i], z = pts[i + 1]
      for (const l of roadLines) if (near(l, x, z, l.half + ROAD_MARGIN) && lineDist(l.pts, x, z) < l.half + ROAD_MARGIN) return false
      if (wet(x, z, WATER_MARGIN) || inSquare(x, z, 1)) return false
      const h = at(x, z)
      if (h < 0.5) return false // sea or beach
      lo = Math.min(lo, h); hi = Math.max(hi, h)
    }
    return hi - lo <= MAX_DROP[b.cat]
  }

  // place b so that its footprint starts `front` metres from the road point (px,pz) along the plot
  // normal (nx,nz), centred on the plot along the road; the front faces the road
  const put = (b: Building, px: number, pz: number, nx: number, nz: number, front: number) => {
    const yaw = Math.round((Math.atan2(-nx, -nz) * 180) / Math.PI + FRONT_YAW)
    const c0 = footprint(b, 0, 0, yaw)
    let nmin = Infinity, tmin = Infinity, tmax = -Infinity, nmax = -Infinity
    for (let k = 0; k < 4; k++) {
      const u = c0[k * 2] * nx + c0[k * 2 + 1] * nz, v = c0[k * 2] * -nz + c0[k * 2 + 1] * nx
      nmin = Math.min(nmin, u); nmax = Math.max(nmax, u); tmin = Math.min(tmin, v); tmax = Math.max(tmax, v)
    }
    const dn = front - nmin, dt = -(tmin + tmax) / 2
    const x = px + nx * dn - nz * dt, z = pz + nz * dn + nx * dt
    return { x, z, yaw, corners: footprint(b, x, z, yaw), width: tmax - tmin, depth: nmax - nmin }
  }

  const pool = (cats: BuildingCat[]) => BUILDINGS.filter((b) => cats.includes(b.cat))
  const civics = pool(['civic'])

  // a house and the plot it stands on (for the footpaths)
  interface Home { q: Placed; px: number; pz: number; nx: number; nz: number; half: number; front: number; depth: number; width: number; annex?: Placed; back?: number; line: Line; side: number; s: number }

  // is the footpath polyline clear of every footprint (except `ignore`) by `m` metres, and of water?
  const clearOf = (pts: number[], ignore: Placed[], m: number) => {
    for (let i = 0; i < pts.length / 2 - 1; i++) {
      const ax = pts[i * 2], az = pts[i * 2 + 1], bx = pts[i * 2 + 2], bz = pts[i * 2 + 3]
      const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az)))
      for (let k = 0; k <= steps; k++) {
        const x = ax + ((bx - ax) * k) / steps, z = az + ((bz - az) * k) / steps
        for (const q of placed) {
          if (ignore.includes(q) || Math.abs(q.x - x) > 40 || Math.abs(q.z - z) > 40) continue
          if (inside(q.corners, x, z) || lineDist(q.corners, x, z, true) < m) return false
        }
        if (wet(x, z, 2)) return false
      }
    }
    return true
  }
  // share of the polyline lying along a road or lane (a footpath must not duplicate them)
  const onRoad = (pts: number[]) => {
    let hit = 0, all = 0
    for (let i = 0; i < pts.length / 2 - 1; i++) {
      const ax = pts[i * 2], az = pts[i * 2 + 1], bx = pts[i * 2 + 2], bz = pts[i * 2 + 3]
      const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 2))
      for (let k = 0; k < steps; k++) {
        all++
        if (roadDist(ax + ((bx - ax) * k) / steps, az + ((bz - az) * k) / steps) < 2.5) hit++
      }
    }
    return all ? hit / all : 0
  }

  for (const site of sites) {
    const rand = rng(hash(site.id, p.seed))
    const reach = Math.max(REACH[site.kind], SITE_RADIUS[site.kind])
    const pre = `SET_${site.id}_`
    const big = site.kind !== 'hamlet'
    let nH = placed.filter((q) => q.site === site.id).length
    const sides = site.kind === 'hamlet' && rand() < 0.5 ? [rand() < 0.5 ? 1 : -1] : [1, -1]
    const local = roadLines.filter((l) => near(l, site.x, site.z, reach))
    if (!local.length) continue

    // central green beside the main street, reserved before the lots (docs/CITIES.md §3.4): the
    // first flat, dry, free spot next to a road point, from the nearest to the centre outwards
    let square: Square | null = null
    let sqN: [number, number] = [0, 0], sqP: [number, number] = [0, 0], sqHalf = 0
    if (opt.square && big) {
      const r = SQUARE_R[site.kind]
      const spots: { l: Line; x: number; z: number; tx: number; tz: number; d: number }[] = []
      for (const l of local) {
        for (let i = 0; i < l.pts.length / 2 - 1; i += 2) {
          const x = l.pts[i * 2], z = l.pts[i * 2 + 1], tx = l.pts[i * 2 + 2] - x, tz = l.pts[i * 2 + 3] - z
          const d = Math.hypot(x - site.x, z - site.z), len = Math.hypot(tx, tz)
          if (len > 1e-6 && d < reach * 0.4) spots.push({ l, x, z, tx: tx / len, tz: tz / len, d })
        }
      }
      spots.sort((a, b) => a.d - b.d)
      const flip = rand() < 0.5 ? 1 : -1
      for (const c of spots.slice(0, 60)) {
        for (const side of [flip, -flip]) {
          const nx = -c.tz * side, nz = c.tx * side
          const off = c.l.half + ROAD_MARGIN + r
          const cx = c.x + nx * off, cz = c.z + nz * off
          let lo = Infinity, hi = -Infinity, ok = true
          for (let a = 0; a < 12 && ok; a++) {
            for (const f of [0, 0.5, 1]) {
              const x = cx + Math.cos((a * Math.PI) / 6) * r * f, z = cz + Math.sin((a * Math.PI) / 6) * r * f
              const h = at(x, z)
              if (h < 0.5 || wet(x, z, 3) || roadDist(x, z, c.l) < 1 || placed.some((q) => inside(q.corners, x, z))) { ok = false; break }
              lo = Math.min(lo, h); hi = Math.max(hi, h)
            }
          }
          if (ok && hi - lo <= 2.5) {
            square = { site: site.id, x: cx, z: cz, r }
            sqN = [nx, nz]; sqP = [c.x, c.z]; sqHalf = c.l.half
            squares.push(square)
            break
          }
        }
        if (square) break
      }
    }

    // secondary lanes: dead ends grown from junctions on the local roads (docs/CITIES.md §3.3)
    if (opt.lanes && big) {
      const [k0, kr] = LANE_COUNT[site.kind]
      const want = k0 + Math.floor(rand() * (kr + 1))
      const cands: { l: Line; x: number; z: number; tx: number; tz: number }[] = []
      for (const l of local) {
        let acc = 0
        for (let i = 0; i < l.pts.length / 2 - 1; i++) {
          const x = l.pts[i * 2], z = l.pts[i * 2 + 1], tx = l.pts[i * 2 + 2] - x, tz = l.pts[i * 2 + 3] - z
          const len = Math.hypot(tx, tz)
          acc += len
          if (len < 1e-6 || acc < 15) continue
          acc = 0
          if (Math.hypot(x - site.x, z - site.z) < reach * 0.7) cands.push({ l, x, z, tx: tx / len, tz: tz / len })
        }
      }
      const starts: [number, number][] = []
      let made = 0
      for (let tries = 0; tries < 40 && made < want && cands.length; tries++) {
        const c = cands.splice(Math.floor(rand() * cands.length), 1)[0]
        if (starts.some(([x, z]) => Math.hypot(x - c.x, z - c.z) < 60)) continue
        if (square && Math.hypot(c.x - square.x, c.z - square.z) < square.r + 20) continue
        const side = rand() < 0.5 ? 1 : -1
        let hx = -c.tz * side, hz = c.tx * side
        const len = 45 + rand() * (site.kind === 'town' ? 70 : 50)
        const pts = [c.x, c.z]
        let x = c.x, z = c.z, h = at(x, z)
        for (let d = 10; d <= len; d += 10) {
          const turn = (rand() - 0.5) * 0.4
          const cs = Math.cos(turn), sn = Math.sin(turn)
          const hx2 = hx * cs - hz * sn
          hz = hx * sn + hz * cs
          hx = hx2
          const nx = x + hx * 10, nz = z + hz * 10, nh = at(nx, nz)
          if (nh < 0.5 || Math.abs(nh - h) > 2.5 || wet(nx, nz, 8) || inSquare(nx, nz, 6)) break
          // keep clear of the other roads and lanes (of the parent road once away from the junction)
          if (roadDist(nx, nz, d < 20 ? c.l : undefined) < (d < 20 ? 8 : 10)) break
          if (placed.some((q) => inside(q.corners, nx, nz) || lineDist(q.corners, nx, nz, true) < 4)) break
          pts.push(nx, nz)
          x = nx; z = nz; h = nh
        }
        if (pts.length < 8) continue // shorter than 30 m
        made++
        starts.push([c.x, c.z])
        const road: Road = { id: `${pre}LANE_${made}`, type: site.kind === 'town' ? 'asphaltNarrow' : 'dirt', pts, auto: true }
        lanes.push(road)
        const line = boxed(centreLine(pts, 4), roadHalf(road))
        roadLines.push(line)
        local.push(line)
      }
    }

    // plots along each road and lane side inside the reach (blocks between streets cut into lots)
    interface Plot { px: number; pz: number; nx: number; nz: number; f: number; d: number; half: number; line: Line; side: number; s: number }
    const plots: Plot[] = []
    for (const l of local) {
      const line = l.pts, n = line.length / 2
      for (const side of sides) {
        let acc = 0, next = rand() * 6
        for (let i = 0; i < n - 1; i++) {
          const ax = line[i * 2], az = line[i * 2 + 1], bx = line[i * 2 + 2], bz = line[i * 2 + 3]
          const seg = Math.hypot(bx - ax, bz - az)
          if (seg < 1e-6) continue
          while (next <= acc + seg) {
            const u = (next - acc) / seg, px = ax + (bx - ax) * u, pz = az + (bz - az) * u
            const d = Math.hypot(px - site.x, pz - site.z)
            const central = d < reach * 0.3
            // narrower lots in the centre, narrower still in towns
            const f = central ? (site.kind === 'town' ? 7 + rand() * 5 : 8 + rand() * 6) : 12 + rand() * 13
            if (d < reach) {
              const tx = (bx - ax) / seg, tz = (bz - az) / seg
              // plot centre half a frontage further on (approximated on the current direction)
              plots.push({ px: px + (tx * f) / 2, pz: pz + (tz * f) / 2, nx: -tz * side, nz: tx * side, f, d, half: l.half, line: l, side, s: next + f / 2 })
            }
            next += f
          }
          acc += seg
        }
      }
    }
    plots.sort((a, b) => a.d - b.d)
    const homes: Home[] = []

    // the unique civic building (villages and towns): beyond the green, facing it and the street
    if (big && civics.length && !placed.some((q) => q.site === site.id && q.cat === 'civic')) {
      const b = civics[Math.floor(rand() * civics.length)]
      let done = false
      if (square) {
        const r = put(b, sqP[0], sqP[1], sqN[0], sqN[1], sqHalf + ROAD_MARGIN + square.r * 2 + 2)
        if (fits(b, r.corners)) {
          placed.push({ id: pre + 'C1', site: site.id, prefab: b.prefab, cat: b.cat, x: r.x, z: r.z, yaw: r.yaw, corners: r.corners })
          done = true
        }
      }
      for (const pl of done ? [] : plots.slice(0, 12)) {
        const front = pl.half + ROAD_MARGIN + 3
        const r = put(b, pl.px, pl.pz, pl.nx, pl.nz, front)
        if (fits(b, r.corners)) {
          const q: Placed = { id: pre + 'C1', site: site.id, prefab: b.prefab, cat: b.cat, x: r.x, z: r.z, yaw: r.yaw, corners: r.corners }
          placed.push(q)
          homes.push({ q, px: pl.px, pz: pl.pz, nx: pl.nx, nz: pl.nz, half: pl.half, front, depth: r.depth, width: r.width, line: pl.line, side: pl.side, s: pl.s })
          break
        }
      }
    }

    for (const pl of plots) {
      const fr = pl.d / reach
      if (rand() > ringProb(fr) * p.density) continue
      // districts (docs/CITIES.md §1.1, §1.10 wards): dense centre, mixed middle, farming edge
      const district: District = fr < 0.3 ? 'centre' : fr < 0.6 ? 'mid' : 'edge'
      const cats: BuildingCat[] =
        !big ? (fr < 0.5 ? ['houseS', 'houseM', 'houseM', 'farm'] : ['houseS', 'houseM', 'farm', 'farm'])
        : district === 'centre' ? (site.kind === 'town' ? ['houseL', 'houseL', 'houseM'] : ['houseM', 'houseL'])
        : district === 'mid' ? ['houseS', 'houseM', 'houseM', 'farm']
        : ['houseS', 'farm', 'farm', 'farm']
      const setback = district === 'centre' && big ? 1 + rand() * 2.5 : 2 + rand() * 4
      const front = pl.half + ROAD_MARGIN + setback
      let done: { b: Building; r: ReturnType<typeof put> } | null = null
      for (let tries = 0; tries < 4 && !done; tries++) {
        const cands = pool([cats[Math.floor(rand() * cats.length)]])
        if (!cands.length) continue
        const b = cands[Math.floor(rand() * cands.length)]
        const r = put(b, pl.px, pl.pz, pl.nx, pl.nz, front)
        if (r.width > pl.f + 4 || front + r.depth > pl.half + STRIP) continue // a large house may eat a bit of the next plot
        if (fits(b, r.corners)) done = { b, r }
      }
      if (!done) continue
      nH++
      const { b, r } = done
      const q: Placed = { id: pre + 'H' + nH, site: site.id, prefab: b.prefab, cat: b.cat, x: r.x, z: r.z, yaw: r.yaw, corners: r.corners }
      placed.push(q)
      const home: Home = { q, px: pl.px, pz: pl.pz, nx: pl.nx, nz: pl.nz, half: pl.half, front, depth: r.depth, width: r.width, line: pl.line, side: pl.side, s: pl.s }
      homes.push(home)

      // annex behind the house (farms and the edge more often, rarely in the centre)
      const back = front + r.depth + 2 + rand() * 4
      if (rand() < (b.cat === 'farm' ? 0.75 : !big ? 0.4 : district === 'centre' ? 0.12 : district === 'edge' ? 0.55 : 0.4)) {
        const ac = pool(b.cat === 'farm' || rand() < 0.5 ? ['annex'] : ['shed'])
        const a = ac[Math.floor(rand() * ac.length)]
        if (a) {
          const ra = put(a, pl.px, pl.pz, pl.nx, pl.nz, back)
          if (back + ra.depth <= pl.half + STRIP && fits(a, ra.corners)) {
            const qa: Placed = { id: pre + 'A' + nH, site: site.id, prefab: a.prefab, cat: a.cat, x: ra.x, z: ra.z, yaw: ra.yaw, corners: ra.corners }
            placed.push(qa)
            home.annex = qa
            home.back = back
          }
        }
      }
    }

    // worn footpaths ("desire lines": the shortest walks people actually take)
    if (!opt.paths) continue
    let nP = 0
    const addPath = (raw: number[], ignore: Placed[], dupCheck: boolean) => {
      const pts = minSegments(chaikin(raw))
      if (!pts || !clearOf(pts, ignore, 0.8)) return false
      if (dupCheck && onRoad(pts) > 0.4) return false
      paths.push({ id: `${pre}PATH_${++nP}`, type: PATH_TYPE, pts: pts.map((v) => Math.round(v * 100) / 100), auto: true })
      return true
    }
    // a point on the front axis of the house, `out` metres in front of its facade
    const door = (h: Home, out: number): [number, number] => [h.px + h.nx * (h.front - out), h.pz + h.nz * (h.front - out)]

    for (const h of homes) {
      // door to the road: perpendicular, ending a little inside the carriageway (at least 5 m long)
      if (rand() < 0.85) {
        const [dx, dz] = door(h, 0.8)
        const len = Math.max(MIN_SEG + 0.2, h.front - 0.8 - h.half * 0.3)
        addPath([dx, dz, dx - h.nx * len, dz - h.nz * len], [h.q], false)
      }
      // from the door round one side of the house to the annex at the back
      if (h.annex && h.back !== undefined && rand() < 0.65) {
        const [dx, dz] = door(h, 1.2)
        for (const sg of rand() < 0.5 ? [1, -1] : [-1, 1]) {
          const tx = -h.nz * sg, tz = h.nx * sg, w = h.width / 2 + 1.6, mid = h.back + 1
          const raw = [dx, dz, dx + tx * w, dz + tz * w, h.px + h.nx * mid + tx * w, h.pz + h.nz * mid + tz * w, h.px + h.nx * mid + tx * (w - 2.5), h.pz + h.nz * mid + tz * (w - 2.5)]
          if (addPath(raw, [h.q, h.annex], true)) break
        }
      }
    }
    // between neighbouring back gardens on the same street side
    const rows = new Map<Line, Map<number, Home[]>>()
    for (const h of homes) {
      if (!rows.has(h.line)) rows.set(h.line, new Map())
      const m = rows.get(h.line)!
      if (!m.has(h.side)) m.set(h.side, [])
      m.get(h.side)!.push(h)
    }
    for (const m of rows.values())
      for (const row of m.values()) {
        row.sort((a, b) => a.s - b.s)
        for (let i = 0; i < row.length - 1; i++) {
          const a = row[i], b = row[i + 1]
          if (Math.hypot(a.px - b.px, a.pz - b.pz) > 40 || rand() > 0.35) continue
          const da = a.front + a.depth + 1.5, db = b.front + b.depth + 1.5
          addPath([a.px + a.nx * da, a.pz + a.nz * da, b.px + b.nx * db, b.pz + b.nz * db], [a.q, b.q], true)
        }
      }
    // desire lines across the centre to the green (or to the civic building)
    const civic = placed.find((q) => q.site === site.id && q.cat === 'civic')
    const goal: [number, number] | null = square ? [square.x, square.z] : civic ? [civic.x, civic.z] : null
    if (goal && big) {
      const goalR = square ? square.r * 0.6 : 0
      const cands = homes
        .filter((h) => h.q.cat !== 'civic')
        .map((h) => ({ h, d: Math.hypot(h.px - goal[0], h.pz - goal[1]) }))
        .filter((e) => e.d > 25 && e.d < (site.kind === 'town' ? 160 : 110))
        .sort((a, b) => a.d - b.d)
      const max = site.kind === 'town' ? 10 : 5
      const ignore = civic ? [civic] : []
      let n = 0
      for (const { h } of cands) {
        if (n >= max) break
        if (rand() < 0.35) continue
        const [dx, dz] = door(h, 0.8)
        const vx = goal[0] - dx, vz = goal[1] - dz, L = Math.hypot(vx, vz)
        const ex = goal[0] - (vx / L) * goalR, ez = goal[1] - (vz / L) * goalR
        // straight, else bent round the obstacle by a side offset half-way
        for (const off of [0, 8, -8, 16, -16]) {
          const mx = (dx + ex) / 2 + (-vz / L) * off, mz = (dz + ez) / 2 + (vx / L) * off
          if (addPath([dx, dz, mx, mz, ex, ez], [h.q, ...ignore], true)) { n++; break }
        }
      }
    }
  }
  return { placed, lanes, paths, squares }
}

//! lanes and footpaths as road splines (points every ~8 m, never closer than MIN_SEG)
export function settlementShapes(s: { lanes: Road[]; paths: Road[] }): ProjectShape[] {
  const out: ProjectShape[] = []
  for (const r of [...s.lanes, ...s.paths]) {
    const pts = minSegments(centreLine(r.pts, 8))
    if (!pts) continue
    out.push({
      id: r.id,
      kind: 'spline',
      closed: false,
      points: pts.map((v) => Math.round(v * 100) / 100),
      generator: ROAD_TYPES[r.type].generator,
      paramKeys: ['AdjustHeightMap', 'RoadWidth'],
      paramValues: ['0', String(roadHalf(r) * 2)],
    })
  }
  return out
}

//! buildings stand upright on the ground under their origin (the plugin's terrain height, like the
//! editor's Ctrl+Down snap); no tilt
export function settlementEntities(placed: Placed[]): ProjectEntity[] {
  return placed.map((q) => ({ id: q.id, prefab: q.prefab, x: Math.round(q.x * 100) / 100, z: Math.round(q.z * 100) / 100, yaw: q.yaw }))
}

//! bare earth painted under each building (1.5 m around the footprint), same mask format as roadMasks:
//! a line along the long side of the footprint, half = half the short side + margin
export function buildingMasks(placed: Placed[]) {
  return placed.map((q) => {
    const c = q.corners
    const e1 = Math.hypot(c[2] - c[0], c[3] - c[1]), e2 = Math.hypot(c[4] - c[2], c[5] - c[3])
    // ends of the centre line = middles of the two short sides
    const [a, b] = e1 >= e2 ? [[1, 2], [3, 0]] : [[0, 1], [2, 3]]
    const mid = (i: number, j: number) => [(c[i * 2] + c[j * 2]) / 2, (c[i * 2 + 1] + c[j * 2 + 1]) / 2]
    const p = mid(a[0], a[1]), r = mid(b[0], b[1])
    // stretch by the margin so the ends are covered too
    const L = Math.hypot(r[0] - p[0], r[1] - p[1]) || 1, ux = (r[0] - p[0]) / L, uz = (r[1] - p[1]) / L
    return { points: [p[0] - ux * 1.5, p[1] - uz * 1.5, r[0] + ux * 1.5, r[1] + uz * 1.5], half: Math.min(e1, e2) / 2 + 1.5, edge: 1, core: 'Dirt_01' }
  })
}

export const CAT_COLOUR: Record<BuildingCat, string> = {
  houseS: '#f2c48d', houseM: '#e8955a', houseL: '#c9573a', farm: '#9bc25b', annex: '#a0a0a0', shed: '#7d7d7d', civic: '#c77dff',
}
