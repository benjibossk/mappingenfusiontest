// Rural fences outside the settlements: pasture / paddock fences along the country roads near farms and
// villages. Measured on the vanilla maps (CAL_villages.md, 2026-11-20): outside the site discs, wooden pole
// fences and dry stone walls (Everon 84 km, 0.51 km/km2), 60 % of them within 30 m of a road and parallel to
// it (median 5°), the rest are paddock sides going off the road; almost all within 400 m of a building:
// fence metres per road metre 0.42 (< 100 m of a building) / 0.35 (100-200) / 0.18 (200-400) / 0.04 beyond.
// Arland ~1.8x, Kolguyev ~0.25x. Pure, deterministic.

import type { VillageParcel } from './village'
import type { PlacedFence } from '../biomes/parcel'
import { FENCES } from '../data/biomes'

export interface PastureOptions {
  seed: number
  roads: { pts: number[]; half: number }[] // road centre lines (all roads, used for the walk and kept clear)
  buildings: { x: number; z: number }[] // houses and farm buildings (pasture density falls off with the distance)
  ok: (x: number, z: number) => boolean // open land: not water, forest, settlement disc, steep slope
  blocked?: (x: number, z: number) => boolean // building footprints, roads (makeBlocker)
  density?: number // biome multiplier (pastureDensity)
  styles?: [string, number][] // wall generator GUID, weight
}

/** fence metres per road metre against the distance to the nearest building (vanilla Everon, both road sides) */
export const PASTURE_RATE: [number, number][] = [[100, 0.42], [200, 0.35], [400, 0.18], [Infinity, 0.04]]
/** per biome: Arland 1.48 km/km2 of rural fences on a denser road net (fence/road 0.74 near buildings), Kolguyev 0.1 */
export function pastureDensity(biome?: string): number { return !biome ? 1 : /kolguyev/i.test(biome) ? 0.38 : /arland/i.test(biome) ? 2.25 : 1 }
/** vanilla rural fence families (length share): Everon PoleFence_01 57 %, PoleFence_02 24 %, StoneWall_01 16 %;
 *  Kolguyev stone walls first; Arland pole fences + WoodenRural */
export function pastureStyles(biome?: string): [string, number][] {
  if (biome && /kolguyev/i.test(biome)) return [[FENCES.stone1, 0.5], [FENCES.pole2, 0.3], [FENCES.woodOld, 0.2]]
  if (biome && /arland/i.test(biome)) return [[FENCES.pole1, 0.35], [FENCES.pole2, 0.3], [FENCES.woodRural, 0.2], [FENCES.stone1, 0.15]]
  return [[FENCES.pole1, 0.58], [FENCES.pole2, 0.25], [FENCES.stone1, 0.17]]
}

function mulberry(seed: number) {
  let a = seed >>> 0
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}

function resample(p: number[], step: number): number[] {
  const o = [p[0], p[1]]
  let carry = 0
  for (let i = 2; i < p.length; i += 2) {
    const ax = p[i - 2], az = p[i - 1], dx = p[i] - ax, dz = p[i + 1] - az, L = Math.hypot(dx, dz)
    let t = step - carry
    while (t <= L) { o.push(ax + (dx * t) / L, az + (dz * t) / L); t += step }
    carry = L - (t - step)
  }
  return o
}

const STEP = 5
// fence lost to the clipping (forest, slope, roads, buildings): bench Everon 1.0 laid 0.82x the target
const CLIP = 1.2

export function pastureFences(o: PastureOptions): VillageParcel[] {
  const rand = mulberry(o.seed * 2654435761 + 17)
  const dens = o.density ?? 1
  const styles = o.styles ?? pastureStyles()
  const G = 100, bg = new Map<string, { x: number; z: number }[]>()
  for (const b of o.buildings) { const k = `${Math.floor(b.x / G)},${Math.floor(b.z / G)}`; (bg.get(k) ?? bg.set(k, []).get(k)!).push(b) }
  const distB = (x: number, z: number) => {
    let d = Infinity
    const cx = Math.floor(x / G), cz = Math.floor(z / G)
    for (let r = 0; r <= 4; r++) {
      for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue
        for (const b of bg.get(`${cx + dx},${cz + dz}`) ?? []) d = Math.min(d, Math.hypot(b.x - x, b.z - z))
      }
      if (d < r * G) break
    }
    return d
  }
  const rate = (d: number) => (PASTURE_RATE.find(([lim]) => d < lim) ?? PASTURE_RATE[PASTURE_RATE.length - 1])[1]
  // occupied 8 m cells (laid paddocks): no paddock over another one
  const occ = new Set<string>()
  const cell = (x: number, z: number) => `${Math.floor(x / 8)},${Math.floor(z / 8)}`
  // road clearance: no fence within half + 2 m of any road centre line
  const RG = 50, rcell = new Map<string, number[]>()
  o.roads.forEach((r, i) => { for (let k = 0; k < r.pts.length; k += 2) { const key = `${Math.floor(r.pts[k] / RG)},${Math.floor(r.pts[k + 1] / RG)}`; const a = rcell.get(key) ?? rcell.set(key, []).get(key)!; if (a[a.length - 1] !== i) a.push(i) } })
  const nearRoad = (x: number, z: number) => {
    const cx = Math.floor(x / RG), cz = Math.floor(z / RG), seen = new Set<number>()
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) for (const i of rcell.get(`${cx + dx},${cz + dz}`) ?? []) {
      if (seen.has(i)) continue
      seen.add(i)
      const p = o.roads[i].pts, h = o.roads[i].half + 2
      for (let k = 2; k < p.length; k += 2) {
        const ax = p[k - 2], az = p[k - 1], ex = p[k] - ax, ez = p[k + 1] - az, L = ex * ex + ez * ez
        const t = L ? Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / L)) : 0
        if (Math.hypot(x - ax - t * ex, z - az - t * ez) < h) return true
      }
    }
    return false
  }
  const good = (x: number, z: number) => o.ok(x, z) && !o.blocked?.(x, z) && !nearRoad(x, z) && !occ.has(cell(x, z))
  /** keep the valid runs (>= 12 m) of a polyline, sampled every 4 m */
  const runs = (pl: number[]): number[][] => {
    const s = resample(pl, 4)
    if (Math.hypot(s[s.length - 2] - pl[pl.length - 2], s[s.length - 1] - pl[pl.length - 1]) > 1) s.push(pl[pl.length - 2], pl[pl.length - 1])
    const out: number[][] = []
    let cur: number[] = []
    for (let i = 0; i < s.length; i += 2) {
      if (good(s[i], s[i + 1])) cur.push(s[i], s[i + 1])
      else { if (cur.length >= 8) out.push(cur); cur = [] }
    }
    if (cur.length >= 8) out.push(cur)
    return out
  }
  const len = (p: number[]) => { let L = 0; for (let i = 2; i < p.length; i += 2) L += Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]); return L }
  const out: VillageParcel[] = []
  // longest roads first: the walk order is stable whatever the road ids
  const order = o.roads.map((_, i) => i).sort((a, b) => len(o.roads[b].pts) - len(o.roads[a].pts) || a - b)
  for (const ri of order) {
    const r = o.roads[ri]
    if (r.pts.length < 4) continue
    const cl = resample(r.pts, STEP), n = cl.length / 2
    if (n < 8) continue
    let budget = -rand() * 60
    for (let i = 1; i < n - 6; i++) {
      const x = cl[i * 2], z = cl[i * 2 + 1]
      budget += rate(distB(x, z)) * STEP * dens * CLIP
      if (budget < 30) continue
      // a paddock: front along the road (3-13 m off its edge), 40-120 m deep: 30 % a lone roadside fence, 20 % front + one
      // side, 50 % closed (bench Everon: road distance median 21 m vs vanilla 18, 58 % within 30 m vs 61 %)
      const k = Math.min(n - 1 - i, Math.round((30 + rand() * 90) / STEP))
      if (k < 5) continue
      const side = rand() < 0.5 ? 1 : -1, off = r.half + 3 + rand() * 10
      const front: number[] = []
      for (let j = i; j <= i + k; j++) {
        const a = Math.max(0, j - 1), b = Math.min(n - 1, j + 1), tx = cl[b * 2] - cl[a * 2], tz = cl[b * 2 + 1] - cl[a * 2 + 1], tl = Math.hypot(tx, tz) || 1
        front.push(cl[j * 2] + (-tz / tl) * off * side, cl[j * 2 + 1] + (tx / tl) * off * side)
      }
      const fl = front.length, ax = front[2] - front[0], az = front[3] - front[1], bx = front[fl - 2] - front[fl - 4], bz = front[fl - 1] - front[fl - 3]
      const na = Math.hypot(ax, az) || 1, nb = Math.hypot(bx, bz) || 1
      const D = 40 + rand() * 80, shape = rand()
      const sA = [front[0], front[1], front[0] + (-az / na) * D * side, front[1] + (ax / na) * D * side]
      const sB = [front[fl - 2], front[fl - 1], front[fl - 2] + (-bz / nb) * D * side, front[fl - 1] + (bx / nb) * D * side]
      const pls: number[][] = [front]
      if (shape >= 0.3) pls.push(sA)
      if (shape >= 0.5) { pls.push(sB); pls.push([sA[2], sA[3], sB[2], sB[3]]) }
      const guid = pickStyle(styles, rand())
      const fences: PlacedFence[] = []
      let laid = 0
      for (const pl of pls) for (const run of runs(pl)) { fences.push({ guid, pts: run.map((v) => Math.round(v * 100) / 100) }); laid += len(run) }
      if (!fences.length) { budget -= 10; continue }
      // reserve the paddock area (and the fence line) for later walks
      const corners = [sA[0], sA[1], sB[0], sB[1], sB[2], sB[3], sA[2], sA[3]]
      reserve(occ, corners, front, cell)
      out.push({ site: `PASTURE_${out.length + 1}`, items: [], fences })
      budget -= laid
      i += k + 2
    }
  }
  return out
}

function pickStyle(styles: [string, number][], r: number): string {
  const tot = styles.reduce((a, s) => a + s[1], 0)
  let acc = 0
  for (const [g, w] of styles) { acc += w / tot; if (r < acc) return g }
  return styles[styles.length - 1][0]
}

function reserve(occ: Set<string>, quad: number[], front: number[], cell: (x: number, z: number) => string) {
  for (let i = 0; i < front.length; i += 2) occ.add(cell(front[i], front[i + 1]))
  // fill the quad (front-left, front-right, back-right, back-left) on a 4 m lattice
  const [x0, z0, x1, z1, , , x3, z3] = quad
  const ux = x1 - x0, uz = z1 - z0, vx = x3 - x0, vz = z3 - z0
  const nu = Math.max(1, Math.ceil(Math.hypot(ux, uz) / 4)), nv = Math.max(1, Math.ceil(Math.hypot(vx, vz) / 4))
  for (let a = 0; a <= nu; a++) for (let b = 0; b <= nv; b++) occ.add(cell(x0 + (ux * a) / nu + (vx * b) / nv, z0 + (uz * a) / nu + (vz * b) / nv))
}
