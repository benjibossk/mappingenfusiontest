// Village generator, step 2 (docs/ROADMAP_NEXT.md §3.2, CITIES.md §3.3-3.8). Pure module, no UI.
// Per site: square + the one church, organic streets grown from the main road (villageStreets.ts),
// street blocks cut into lots by recursive OBB split (villageLots.ts), houses at the front of their
// lot facing the street (setback, garden behind), U-shaped farm courtyards on the edge, a quay and
// boat sheds when the site touches the sea, a denser core for towns.
// Output = the same Settlement as settle() (placed / lanes / paths / squares) plus lots and gardens.

import type { Grid } from './island'
import type { Site, SiteKind } from './network'
import { SITE_RADIUS } from './network'
import type { Road } from './roads'
import { centreLine, roadHalf } from './roads'
import type { Water } from './water'
import { WATER_TYPES } from './water'
import type { Building, BuildingCat } from '../data/buildings'
import { BUILDINGS, FRONT_YAW } from '../data/buildings'
import { boxed, footprint, hash, inside, lineDist, overlap, rng, sampler, samples, type Line, type Placed, type PlacedRole, type Settlement, type Square } from './settlements'
import { GROW_TOWN, GROW_VILLAGE, growStreets, nearestOn, polyGrade, type GrowOptions, type StreetSeed } from './villageStreets'
import { lotCorners, lotPoint, splitLot, streetBlocks, type Lot } from './villageLots'

export type VillageVariant = 'auto' | 'village' | 'town'
export interface VillageOptions {
  seed: number
  density: number // fill multiplier (1 = default)
  variant?: VillageVariant // 'auto': towns from site.kind === 'town'
  streets?: boolean // organic street growth (default true)
  maxStreets?: number // overrides the variant's street count
  farms?: boolean // U courtyards on the edge (default true)
  church?: boolean // one church on the square (default true)
  port?: boolean // quay + boat sheds when the site touches the sea (default true)
  maxSlope?: number // steepest street grade (0.15)
  pool?: Building[] // replaces the vanilla list (captured parcels: parcelPool)
  blocked?: [number, number, number, number][] // world boxes already taken
}
export interface VillageSite { site: string; variant: 'village' | 'town' | 'hamlet'; coastal: boolean; church?: string; streets: number; lots: number }
export interface VillageResult extends Settlement {
  lots: { site: string; corners: number[]; used: boolean }[]
  gardens: { site: string; corners: number[] }[] // back gardens (fence / hedge polylines for the wall generator)
  sites: VillageSite[]
}

// measured in profile/MapGen/prefabs.txt (local bounds X/Z); no boat prefab is measured: none placed
export const NAVAL: Record<'pier' | 'boatshed' | 'piershed', Building> = {
  pier: { prefab: '{FF39390F2D826521}Prefabs/Structures/Infrastructure/Naval/Piers/PierWooden_01_25m.et', cat: 'shed', minX: -0.79, minZ: -11.69, maxX: 0.79, maxZ: 11.9 },
  boatshed: { prefab: '{CEC3DC0C3A8B7691}Prefabs/Structures/Infrastructure/Naval/Sheds/BoatShed_01/BoatShed_01_land.et', cat: 'shed', minX: -3.39, minZ: -4.33, maxX: 3.58, maxZ: 4.34 },
  piershed: { prefab: '{3961F81016AAE7CD}Prefabs/Structures/Infrastructure/Naval/Sheds/PierShed_01/PierShed_01.et', cat: 'shed', minX: -6.67, minZ: -7.44, maxX: 6.94, maxZ: 7.39 },
}
export const PIER_YCM = 100 // pier deck origin 1 m above the sea level (0)
const BEACH_DROP = 1.2 // boat sheds stand on the sloping beach
const CHURCH_RE = /Church|Chapel|Chapelle|Eglise/i

const REACH: Record<SiteKind, number> = { town: 380, village: 220, hamlet: 140 }
const SQUARE_R: Record<SiteKind, number> = { town: 24, village: 15, hamlet: 0 }
const ROAD_MARGIN = 1.5
const WATER_MARGIN = 5
const GAP = 1
const MAX_DROP: Record<BuildingCat, number> = { houseS: 1.2, houseM: 1.2, houseL: 1.0, farm: 1.5, civic: 1.0, block: 1.0, annex: 0.6, shed: 0.6 }

interface Params { lotMin: [number, number, number]; lotMax: [number, number, number]; depth: [number, number, number]; setback: [number, number]; fill: [number, number, number]; grow: GrowOptions; chunk: number }
// [centre, mid, edge]
const VARIANT: Record<'village' | 'town' | 'hamlet', Params> = {
  hamlet: { lotMin: [12, 14, 16], lotMax: [20, 26, 34], depth: [36, 40, 46], setback: [2, 6], fill: [0.8, 0.6, 0.4], grow: { ...GROW_VILLAGE, maxStreets: 0 }, chunk: 40 },
  village: { lotMin: [9, 12, 16], lotMax: [15, 22, 40], depth: [32, 38, 48], setback: [1.5, 5], fill: [0.9, 0.7, 0.45], grow: GROW_VILLAGE, chunk: 40 },
  town: { lotMin: [7, 9, 14], lotMax: [11, 16, 30], depth: [26, 32, 44], setback: [0.5, 2.5], fill: [0.97, 0.85, 0.55], grow: GROW_TOWN, chunk: 36 },
}

export function settleVillages(sites: Site[], roads: Road[], waters: Water[], heights: ArrayLike<number>, grid: Grid, o: VillageOptions, keep: Placed[] = []): VillageResult {
  const at = sampler(heights, grid)
  const roadLines = roads.filter((r) => r.pts.length >= 4).map((r) => boxed(centreLine(r.pts, 4), roadHalf(r)))
  const rivers = waters.filter((w) => !WATER_TYPES[w.type].closed).map((w) => boxed(w.pts, w.width / 2))
  const lakes = waters.filter((w) => WATER_TYPES[w.type].closed).map((w) => boxed(w.pts, 0))
  const placed: Placed[] = keep.slice()
  const res: VillageResult = { placed, lanes: [], paths: [], squares: [], lots: [], gardens: [], sites: [] }
  const reserved: number[][] = [] // gardens: no building in them
  const maxSlope = o.maxSlope ?? 0.15

  const near = (l: Line, x: number, z: number, d: number) => x > l.minX - d && x < l.maxX + d && z > l.minZ - d && z < l.maxZ + d
  const roadDist = (x: number, z: number, skip?: Line) => {
    let best = Infinity
    for (const l of roadLines) if (l !== skip && near(l, x, z, 30)) best = Math.min(best, lineDist(l.pts, x, z) - l.half)
    return best
  }
  const wet = (x: number, z: number, m: number) => {
    if (at(x, z) < 0.5) return true
    for (const l of rivers) if (near(l, x, z, l.half + m) && lineDist(l.pts, x, z) < l.half + m) return true
    for (const l of lakes) if (near(l, x, z, m) && (inside(l.pts, x, z) || lineDist(l.pts, x, z, true) < m)) return true
    return false
  }
  const inSquare = (x: number, z: number, m: number) => res.squares.some((s) => Math.hypot(x - s.x, z - s.z) < s.r + m)
  const fits = (b: Building, c: number[], wm = WATER_MARGIN, soft = true, drop = MAX_DROP[b.cat]) => {
    for (const q of placed) if (Math.abs(q.x - c[0]) < 80 && Math.abs(q.z - c[1]) < 80 && overlap(c, q.corners, GAP)) return false
    for (const [x0, z0, x1, z1] of o.blocked ?? []) if (overlap(c, [x0, z0, x1, z0, x1, z1, x0, z1], GAP)) return false
    if (soft) for (const g of reserved) if (Math.abs(g[0] - c[0]) < 80 && Math.abs(g[1] - c[1]) < 80 && overlap(c, g, 0)) return false
    const pts = samples(c)
    let lo = Infinity, hi = -Infinity
    for (let i = 0; i < pts.length; i += 2) {
      const x = pts[i], z = pts[i + 1]
      for (const l of roadLines) if (near(l, x, z, l.half + ROAD_MARGIN) && lineDist(l.pts, x, z) < l.half + ROAD_MARGIN) return false
      if (wet(x, z, wm) || inSquare(x, z, 1)) return false
      const h = at(x, z)
      lo = Math.min(lo, h); hi = Math.max(hi, h)
    }
    return hi - lo <= drop
  }
  const pool = (cats: BuildingCat[]) => (o.pool ?? BUILDINGS).filter((b) => cats.includes(b.cat))
  const yawOf = (fx: number, fz: number) => Math.round((Math.atan2(fx, fz) * 180) / Math.PI + FRONT_YAW) // front (+Z) towards (fx, fz)
  //! building b with its front towards (fx,fz); its footprint's front edge at (px,pz) + f*(dir away from front), centred
  const putFacing = (b: Building, px: number, pz: number, fx: number, fz: number, f: number, shift = 0) => {
    const yaw = yawOf(fx, fz)
    const c0 = footprint(b, 0, 0, yaw)
    const nx = -fx, nz = -fz // away from the front
    let nmin = Infinity, nmax = -Infinity, tmin = Infinity, tmax = -Infinity
    for (let k = 0; k < 4; k++) {
      const u = c0[k * 2] * nx + c0[k * 2 + 1] * nz, v = c0[k * 2] * -nz + c0[k * 2 + 1] * nx
      nmin = Math.min(nmin, u); nmax = Math.max(nmax, u); tmin = Math.min(tmin, v); tmax = Math.max(tmax, v)
    }
    const dn = f - nmin, dt = shift - (tmin + tmax) / 2
    const x = px + nx * dn - nz * dt, z = pz + nz * dn + nx * dt
    return { x, z, yaw, corners: footprint(b, x, z, yaw), width: tmax - tmin, depth: nmax - nmin }
  }
  const add = (id: string, site: string, b: Building, r: { x: number; z: number; yaw: number; corners: number[] }, role: PlacedRole, ycm?: number) => {
    const q: Placed = { id, site, prefab: b.prefab, tpl: b.tpl, cat: b.cat, x: r.x, z: r.z, yaw: r.yaw, corners: r.corners, role }
    if (ycm !== undefined) q.ycm = ycm
    placed.push(q)
    return q
  }

  for (const site of sites) {
    const rand = rng(hash(site.id, o.seed))
    const variant: 'village' | 'town' | 'hamlet' = site.kind === 'hamlet' ? 'hamlet' : o.variant === 'town' || (o.variant !== 'village' && site.kind === 'town') ? 'town' : 'village'
    const P = VARIANT[variant]
    const reach = Math.max(REACH[site.kind], SITE_RADIUS[site.kind]) * (variant === 'town' && site.kind !== 'town' ? 1.3 : 1)
    const pre = `SET_${site.id}_`
    const info: VillageSite = { site: site.id, variant, coastal: false, streets: 0, lots: 0 }
    res.sites.push(info)
    const main = roadLines.filter((l) => near(l, site.x, site.z, reach))
    if (!main.length) continue
    const local = main.slice()
    let nId = 0
    const id = (k: string) => `${pre}${k}${++nId}`

    // --- coast: sea samples on rings around the centre
    let shore: { dx: number; dz: number } | null = null
    if (o.port !== false && variant !== 'hamlet') {
      let sx = 0, sz = 0, n = 0
      for (const f of [0.4, 0.7, 1]) for (let a = 0; a < 32; a++) {
        const dx = Math.cos((a * Math.PI) / 16), dz = Math.sin((a * Math.PI) / 16)
        if (at(site.x + dx * reach * f, site.z + dz * reach * f) < 0) { sx += dx; sz += dz; n++ }
      }
      const L = Math.hypot(sx, sz)
      if (n >= 2 && L > 0) shore = { dx: sx / L, dz: sz / L }
    }

    // --- square: first flat, dry spot beside a main road, nearest to the centre
    let square: Square | null = null
    let sqDir: [number, number] = [0, 0], sqRoad: [number, number] = [0, 0], sqHalf = 0
    const R = SQUARE_R[site.kind] || (variant === 'town' ? 24 : 0)
    if (R) {
      const spots: { l: Line; x: number; z: number; tx: number; tz: number; d: number }[] = []
      for (const l of main)
        for (let i = 0; i < l.pts.length / 2 - 1; i += 2) {
          const x = l.pts[i * 2], z = l.pts[i * 2 + 1], tx = l.pts[i * 2 + 2] - x, tz = l.pts[i * 2 + 3] - z
          const d = Math.hypot(x - site.x, z - site.z), len = Math.hypot(tx, tz)
          if (len > 1e-6 && d < reach * 0.4) spots.push({ l, x, z, tx: tx / len, tz: tz / len, d })
        }
      spots.sort((a, b) => a.d - b.d)
      const flip = rand() < 0.5 ? 1 : -1
      for (const c of spots.slice(0, 60)) {
        for (const side of [flip, -flip]) {
          const nx = -c.tz * side, nz = c.tx * side, off = c.l.half + ROAD_MARGIN + R
          const cx = c.x + nx * off, cz = c.z + nz * off
          let lo = Infinity, hi = -Infinity, ok = true
          for (let a = 0; a < 12 && ok; a++)
            for (const f of [0, 0.5, 1]) {
              const x = cx + Math.cos((a * Math.PI) / 6) * R * f, z = cz + Math.sin((a * Math.PI) / 6) * R * f
              const h = at(x, z)
              if (wet(x, z, 3) || roadDist(x, z, c.l) < 1 || placed.some((q) => inside(q.corners, x, z))) { ok = false; break }
              lo = Math.min(lo, h); hi = Math.max(hi, h)
            }
          if (ok && hi - lo <= 2.5) { square = { site: site.id, x: cx, z: cz, r: R }; sqDir = [nx, nz]; sqRoad = [c.x, c.z]; sqHalf = c.l.half; break }
        }
        if (square) break
      }
      if (square) res.squares.push(square)
    }

    // --- the one church: beyond the square, facing it and the street
    if (o.church !== false && variant !== 'hamlet' && !placed.some((q) => q.site === site.id && q.role === 'church')) {
      const all = o.pool ?? BUILDINGS
      const churches = all.filter((b) => CHURCH_RE.test(b.prefab) || CHURCH_RE.test(b.tpl ?? ''))
      const cands = churches.length ? churches : all.filter((b) => b.cat === 'civic')
      const order = cands.slice().sort(() => rand() - 0.5)
      let done = false
      if (square)
        for (const b of order) {
          for (const extra of [2, 5, 9]) {
            const r = putFacing(b, sqRoad[0], sqRoad[1], -sqDir[0], -sqDir[1], sqHalf + ROAD_MARGIN + square.r * 2 + extra)
            if (fits(b, r.corners)) { add(pre + 'C1', site.id, b, r, 'church'); done = true; break }
          }
          if (done) break
        }
      // no square (or no room by it): roadside spots, nearest to the centre first
      if (!done) {
        const spots: [number, number, number, number, number, number][] = [] // x z tx tz half d
        for (const l of main)
          for (let i = 0; i < l.pts.length / 2 - 1; i += 2) {
            const x = l.pts[i * 2], z = l.pts[i * 2 + 1], tx = l.pts[i * 2 + 2] - x, tz = l.pts[i * 2 + 3] - z, L = Math.hypot(tx, tz)
            const d = Math.hypot(x - site.x, z - site.z)
            if (L > 1e-6 && d < reach * 0.6) spots.push([x, z, tx / L, tz / L, l.half, d])
          }
        spots.sort((a, b) => a[5] - b[5])
        outer: for (const [x, z, tx, tz, half] of spots)
          for (const side of [1, -1])
            for (const extra of [3, 6])
              for (const b of order) {
                const r = putFacing(b, x, z, tz * side, -tx * side, half + ROAD_MARGIN + extra)
                if (fits(b, r.corners)) { add(pre + 'C1', site.id, b, r, 'church'); done = true; break outer }
              }
      }
      info.church = done ? pre + 'C1' : undefined
    }

    // --- harbour: a lane to the shore, a pier into the sea, boat sheds on the beach
    let harbourSeed: StreetSeed | null = null
    if (shore) {
      let last: [number, number] | null = null, wetAt: [number, number] | null = null
      for (let d = 0; d < reach * 1.3; d += 3) {
        const x = site.x + shore.dx * d, z = site.z + shore.dz * d
        if (at(x, z) < 0.5) { wetAt = [x, z]; break }
        last = [x, z]
      }
      if (last && wetAt) {
        // the pier: root on the dry edge, out to sea, deck above the water
        const pier = NAVAL.pier
        // long axis (local Z) out to sea, root 1.5 m on the beach
        const yaw = yawOf(shore.dx, shore.dz)
        const cx = wetAt[0] + shore.dx * 10.5, cz = wetAt[1] + shore.dz * 10.5
        const r = { x: cx, z: cz, yaw, corners: footprint(pier, cx, cz, yaw) }
        const farX = cx + shore.dx * 11, farZ = cz + shore.dz * 11
        const clearPier = !placed.some((q) => overlap(r.corners, q.corners, GAP)) && at(farX, farZ) < 0
        if (clearPier) {
          add(id('Q'), site.id, pier, r, 'quay', PIER_YCM)
          info.coastal = true
          // boat sheds on the dry strip each side of the pier root, doors to the water
          const px = -shore.dz, pz = shore.dx
          let sheds = 0
          for (const sd of [1, -1, 2, -2]) {
            if (sheds >= (variant === 'town' ? 3 : 2)) break
            const b = NAVAL.boatshed
            const bx = last[0] + px * sd * 9, bz = last[1] + pz * sd * 9
            // walk back inland until the footprint is dry
            for (let back = 0; back <= 15; back += 2.5) {
              const rr = putFacing(b, bx - shore.dx * back, bz - shore.dz * back, shore.dx, shore.dz, 0)
              if (fits(b, rr.corners, 0.5, true, BEACH_DROP)) { add(id('B'), site.id, b, rr, 'boatshed'); sheds++; break }
            }
          }
          if (variant === 'town') {
            const b = NAVAL.piershed
            for (let back = 6; back <= 30; back += 3) {
              const rr = putFacing(b, last[0] - px * 22 - shore.dx * back, last[1] - pz * 22 - shore.dz * back, shore.dx, shore.dz, 0)
              if (fits(b, rr.corners, 1, true, BEACH_DROP)) { add(id('W'), site.id, b, rr, 'harbour'); break }
            }
          }
          // harbour lane: from the nearest street to just behind the shore
          const ex = last[0] - shore.dx * 12, ez = last[1] - shore.dz * 12
          let best: [number, number, number] | null = null
          for (const l of local) { const n = nearestOn(l.pts, ex, ez); if (!best || n[2] < best[2]) best = n }
          if (best && best[2] > 20) {
            const pts: number[] = []
            const steps = Math.ceil(best[2] / 10)
            let ok = true
            for (let k = 0; k <= steps; k++) {
              const x = best[0] + ((ex - best[0]) * k) / steps, z = best[1] + ((ez - best[1]) * k) / steps
              if (k > 0 && wet(x, z, 4)) { ok = false; break }
              if (k > 1 && placed.some((q) => inside(q.corners, x, z) || lineDist(q.corners, x, z, true) < 4)) { ok = false; break }
              pts.push(x, z)
            }
            if (ok && pts.length >= 6 && polyGrade(pts, at) <= maxSlope) {
              const road: Road = { id: `${pre}LANE_H`, type: variant === 'town' ? 'asphaltNarrow' : 'dirt', pts, auto: true }
              res.lanes.push(road)
              const line = boxed(centreLine(pts, 4), roadHalf(road))
              roadLines.push(line); local.push(line)
              harbourSeed = { x: ex, z: ez, hx: px, hz: pz, parent: line }
            }
          }
        }
      }
    }

    // --- organic streets grown from the main road (and along the shore)
    if (o.streets !== false && P.grow.maxStreets > 0) {
      const g: GrowOptions = { ...P.grow, maxGrade: maxSlope, maxStreets: o.maxStreets ?? P.grow.maxStreets + Math.floor(rand() * 2) }
      const seeds: StreetSeed[] = []
      const cands: StreetSeed[] = []
      for (const l of main) {
        let acc = 0
        for (let i = 0; i < l.pts.length / 2 - 1; i++) {
          const x = l.pts[i * 2], z = l.pts[i * 2 + 1], tx = l.pts[i * 2 + 2] - x, tz = l.pts[i * 2 + 3] - z
          const len = Math.hypot(tx, tz)
          acc += len
          if (len < 1e-6 || acc < 18) continue
          acc = 0
          const d = Math.hypot(x - site.x, z - site.z)
          if (d > reach * 0.65) continue
          if (square && Math.hypot(x - square.x, z - square.z) < square.r + 25) continue
          const side = rand() < 0.5 ? 1 : -1
          const [hx, hz] = [(-tz / len) * side, (tx / len) * side]
          const j = ((rand() - 0.5) * 2 * g.angleJitter * Math.PI) / 180
          cands.push({ x, z, hx: hx * Math.cos(j) - hz * Math.sin(j), hz: hx * Math.sin(j) + hz * Math.cos(j), parent: l })
        }
      }
      // spread: nearest to the centre first, then at least 50 m apart
      cands.sort((a, b) => Math.hypot(a.x - site.x, a.z - site.z) - Math.hypot(b.x - site.x, b.z - site.z) + (rand() - 0.5) * 40)
      for (const c of cands) if (!seeds.some((s) => Math.hypot(s.x - c.x, s.z - c.z) < 50)) seeds.push(c)
      if (harbourSeed) { seeds.unshift(harbourSeed, { ...harbourSeed, hx: -harbourSeed.hx, hz: -harbourSeed.hz }) }
      const grown = growStreets({ at, wet, blocked: (x, z) => inSquare(x, z, 6) || placed.some((q) => inside(q.corners, x, z) || lineDist(q.corners, x, z, true) < 4), lines: roadLines, cx: site.x, cz: site.z, reach, rand }, seeds, g)
      for (const pts of grown) {
        const road: Road = { id: `${pre}LANE_${++info.streets}`, type: variant === 'town' ? 'asphaltNarrow' : 'dirt', pts: pts.map((v) => Math.round(v * 100) / 100), auto: true }
        res.lanes.push(road)
        const line = boxed(centreLine(road.pts, 4), roadHalf(road))
        roadLines.push(line); local.push(line)
      }
    }

    // --- lots: street blocks split by OBB, nearest to the centre first
    const lots: { lot: Lot; f: number }[] = []
    for (const l of local) {
      for (const side of [1, -1]) {
        for (const blk of streetBlocks(l.pts, side, l.half + ROAD_MARGIN, 0, P.chunk)) {
          const d = Math.hypot(blk.cx - site.x, blk.cz - site.z)
          if (d > reach) continue
          const f = d / reach, k = f < 0.3 ? 0 : f < 0.6 ? 1 : 2
          const depth = P.depth[k]
          const b: Lot = { ...blk, d: depth, cx: blk.cx + blk.nx * depth / 2, cz: blk.cz + blk.nz * depth / 2 }
          for (const lot of splitLot(b, rand, P.lotMin[k], P.lotMax[k])) lots.push({ lot, f })
        }
      }
    }
    lots.sort((a, b) => a.f - b.f)
    info.lots = lots.length

    for (const { lot, f } of lots) {
      const k = f < 0.3 ? 0 : f < 0.6 ? 1 : 2
      const rec = { site: site.id, corners: lotCorners(lot), used: false }
      res.lots.push(rec)
      if (rand() > P.fill[k] * o.density) continue
      const setback = P.setback[0] + rand() * (P.setback[1] - P.setback[0]) * (k === 0 ? 0.5 : 1)
      const [fx0, fz0] = lotPoint(lot, 0, 0) // front centre
      const fx = -lot.nx, fz = -lot.nz // the house faces the street

      // farm courtyard (U): farmhouse at the back, two wings facing the court, open to the street
      if (o.farms !== false && k === 2 && lot.w >= 24 && variant !== 'town' && rand() < 0.7) {
        const farms = pool(['farm']).sort(() => rand() - 0.5)
        const wings = pool(['annex', 'shed']).sort(() => rand() - 0.5)
        let ok = false
        for (const fb of farms.slice(0, 4)) {
          const fr0 = putFacing(fb, fx0, fz0, fx, fz, 0)
          const fhFront = lot.d - 1 - fr0.depth
          if (fhFront < setback + 10) continue
          const fr = putFacing(fb, fx0, fz0, fx, fz, fhFront)
          if (fr.width > lot.w - 2 || !fits(fb, fr.corners)) continue
          const got: { b: Building; r: ReturnType<typeof putFacing> }[] = []
          for (const sd of [-1, 1]) {
            for (const wb of wings.slice(0, 6)) {
              // wing on the side, its front towards the court centre (+/- u)
              const edgeA = sd * (lot.w / 2 - 1)
              const [ex, ez] = lotPoint(lot, edgeA, setback + 2)
              const r0 = putFacing(wb, ex, ez, lot.ux * -sd, lot.uz * -sd, 0)
              const r = putFacing(wb, ex, ez, lot.ux * -sd, lot.uz * -sd, -r0.depth)
              // shift along n so the wing sits between the street setback and the farmhouse
              const along = (r.x - ex) * lot.nx + (r.z - ez) * lot.nz
              const len = r.width
              const want = setback + 2 + len / 2
              if (want + len / 2 > fhFront - 1) continue
              const dx = (want - along) * lot.nx, dz = (want - along) * lot.nz
              const rr = { ...r, x: r.x + dx, z: r.z + dz, corners: footprint(wb, r.x + dx, r.z + dz, r.yaw) }
              if (got.some((g2) => overlap(g2.r.corners, rr.corners, GAP))) continue
              if (overlap(rr.corners, fr.corners, GAP)) continue
              if (fits(wb, rr.corners)) { got.push({ b: wb, r: rr }); break }
            }
          }
          if (got.length < 2) continue
          add(id('F'), site.id, fb, fr, 'farmhouse')
          for (const g2 of got) add(id('Y'), site.id, g2.b, g2.r, 'farmyard')
          ok = true
          break
        }
        if (ok) { rec.used = true; continue }
      }

      const cats: BuildingCat[] =
        variant === 'town' ? (k === 0 ? ['block', 'houseL', 'houseL', 'houseM'] : k === 1 ? ['houseM', 'houseL', 'houseM', 'houseS'] : ['houseS', 'houseM', 'farm'])
        : variant === 'hamlet' ? ['houseS', 'houseM', 'farm']
        : k === 0 ? ['houseM', 'houseL', 'houseL', 'block'] : k === 1 ? ['houseS', 'houseM', 'houseM', 'farm'] : ['houseS', 'houseM', 'farm', 'farm']
      let house: { b: Building; r: ReturnType<typeof putFacing> } | null = null
      for (let t = 0; t < 5 && !house; t++) {
        const cs = pool([cats[Math.floor(rand() * cats.length)]])
        if (!cs.length) continue
        const b = cs[Math.floor(rand() * cs.length)]
        const r = putFacing(b, fx0, fz0, fx, fz, setback)
        const garden = variant === 'town' && k === 0 ? 3 : 6
        if (r.width > lot.w + (k === 0 ? 2 : 0) || setback + r.depth + garden > lot.d) continue
        if (fits(b, r.corners)) house = { b, r }
      }
      if (!house) continue
      rec.used = true
      const q = add(id('H'), site.id, house.b, house.r, 'house')
      // garden: the lot behind the house, reserved (fences / hedges along its edges)
      const back = setback + house.r.depth + 0.5
      if (lot.d - back >= 4) {
        const g: Lot = { ...lot, d: lot.d - back, cx: lot.cx + lot.nx * back / 2, cz: lot.cz + lot.nz * back / 2 }
        const gc = lotCorners(g)
        const free = !placed.some((p2) => p2 !== q && overlap(gc, p2.corners, 0)) && !samplesWet(gc)
        // annex at the back of the garden
        if (free && rand() < (k === 0 ? 0.15 : k === 1 ? 0.4 : 0.55)) {
          const ac = pool(rand() < 0.5 ? ['annex'] : ['shed'])
          const a = ac[Math.floor(rand() * ac.length)]
          if (a) {
            const ra = putFacing(a, fx0, fz0, fx, fz, back + 2 + rand() * 3, (rand() - 0.5) * Math.max(0, lot.w - 8))
            if ((ra.x - fx0) * lot.nx + (ra.z - fz0) * lot.nz + ra.depth / 2 <= lot.d && fits(a, ra.corners)) add(id('A'), site.id, a, ra, 'annex')
          }
        }
        if (free) { res.gardens.push({ site: site.id, corners: gc }); reserved.push(gc) }
      }
    }
  }
  return res

  function samplesWet(c: number[]) {
    const s = samples(c)
    for (let i = 0; i < s.length; i += 2) if (wet(s[i], s[i + 1], 0)) return true
    return false
  }
}

/** gardens as closed fence polylines for the wall generator (back and side edges, street side open) */
export function gardenFences(r: VillageResult): { site: string; pts: number[] }[] {
  // corners: [front-left, front-right, back-right, back-left] of the garden lot
  return r.gardens.map((g) => ({ site: g.site, pts: [g.corners[2], g.corners[3], g.corners[4], g.corners[5], g.corners[6], g.corners[7], g.corners[0], g.corners[1]] }))
}
