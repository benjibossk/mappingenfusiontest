// Random world extras (worldgen.ts): production forests on part of the large conifer / mixed woods,
// and fences / low walls along the village and hamlet plots (Everon has no biome parcels, so its lots
// had none). Pure functions, seeded: the same seed gives the same result.
import { centreLine } from './roads'
import { makeProdForest, ringArea, type ProdLog, type ProdStage } from './prodforest'
import { FENCES } from '../data/biomes'
import type { PlacedFence } from '../biomes/parcel'
import type { VillageParcel } from './village'

export interface ProdArea { id: string; kind: 'forest'; leaf?: 'broad' | 'needle' | 'mixed'; pts: number[]; tall?: 'low' | 'mid' | 'high'; stage?: ProdStage; logs?: ProdLog[] }
export interface ProdWorldOptions {
  seed: number
  garden?: number // share of the fenced lots that get a fenced garden / paddock behind them (default 0.8: Everon bench 0.66x -> 0.95x the vanilla length)
  back?: number // share of the lots with a back fence (default 0.7)
  share?: number // share of the eligible woods turned into production forests (default 0.35)
  minArea?: number // m², eligible wood size (default 25 ha)
  maxCount?: number // default 4
  roads: number[][] // road polylines the tracks are linked to
  ground?: (x: number, z: number) => number
  /** ground a track must not cross (zones, buildings): such a track is dropped (seed 21, cover 0.5: a link track through a military base) */
  blocked?: (x: number, z: number) => boolean
}
export interface ProdWorldResult<A> { areas: (A | ProdArea)[]; tracks: { id: string; type: 'dirt'; pts: number[]; auto: true }[]; outlines: number[][]; count: number }

function hash(seed: number, k: number) {
  let h = (seed ^ Math.imul(k + 1, 0x9e3779b1)) >>> 0
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

/** turns a share of the large needle / mixed woods into production forests (fishbone dirt tracks linked to the
 *  road network, compartments with a stage each, clear-cuts left open, felled logs on the first compartment) */
export function addProdForests<A extends { id: string; kind: string; leaf?: 'broad' | 'needle' | 'mixed'; pts: number[] }>(areas: A[], o: ProdWorldOptions): ProdWorldResult<A> {
  const share = o.share ?? 0.35, minArea = o.minArea ?? 250000, maxCount = o.maxCount ?? 4
  const eligible = areas.map((a, i) => ({ a, i, s: ringArea(a.pts) }))
    .filter((e) => e.a.kind === 'forest' && (e.a.leaf === 'needle' || e.a.leaf === 'mixed') && e.s >= minArea)
    .sort((x, y) => y.s - x.s || (x.a.id < y.a.id ? -1 : 1))
  const want = Math.min(maxCount, Math.round(eligible.length * share + (eligible.length && share > 0 ? 0.49 : 0)))
  const chosen = eligible.map((e) => ({ ...e, r: hash(o.seed, e.i) })).sort((x, y) => x.r - y.r).slice(0, want)
  const pick = new Set(chosen.map((e) => e.i))
  const out: (A | ProdArea)[] = [], tracks: ProdWorldResult<A>['tracks'] = [], outlines: number[][] = []
  const roads = [...o.roads]
  let n = 0
  areas.forEach((a, i) => {
    if (!pick.has(i)) return void out.push(a)
    const pf = makeProdForest(a.pts, { seed: Math.floor(hash(o.seed, 1000 + i) * 2147483646), roads, ground: o.ground })
    const kept = pf.compartments.filter((c) => c.stage !== 'clearcut' && c.pts.length >= 6)
    if (!kept.length) return void out.push(a)
    n++
    outlines.push(a.pts)
    const crosses = (pts: number[]) => { if (!o.blocked) return false; for (let k = 2; k < pts.length; k += 2) { const L = Math.hypot(pts[k] - pts[k - 2], pts[k + 1] - pts[k - 1]), n = Math.max(1, Math.ceil(L / 4)); for (let t = 0; t <= n; t++) if (o.blocked(pts[k - 2] + (pts[k] - pts[k - 2]) * t / n, pts[k - 1] + (pts[k + 1] - pts[k - 1]) * t / n)) return true } return false }
    pf.tracks.forEach((pts, j) => { if (pts.length >= 4 && !crosses(pts)) { tracks.push({ id: `ROAD_PROD_W${n}_${j + 1}`, type: 'dirt', pts, auto: true }); roads.push(pts) } })
    // log piles off the other roads (seed 21 live audit: a pile on ROAD_TERRE_1 next to a production track);
    // smoothed lines, a pile is ~4 m long and 2 m wide: >= 7 m from any other road's axis
    const other = o.roads.map((r) => centreLine(r, 4))
    const logs = pf.logs.filter((l) => other.every((ln) => segDist(ln, l.x, l.z) >= 7))
    kept.forEach((c, j) => {
      const tall = c.stage === 'juvenile' ? 'low' : c.stage === 'thinned' ? 'mid' : 'high'
      out.push({ id: `FOREST_PROD_W${n}_${j + 1}`, kind: 'forest', leaf: a.leaf === 'mixed' ? 'mixed' : 'needle', tall, stage: c.stage, pts: c.pts, ...(j === 0 && logs.length ? { logs } : {}) })
    })
  })
  return { areas: out, tracks, outlines, count: n }
}

export interface FenceLot { site: string; corners: number[]; used: boolean; /** farmstead row lot: always a big paddock behind (Kolguyev ~200 m of fence a farm) */ farm?: boolean }
export interface FenceOptions {
  seed: number
  kindOf: (site: string) => 'town' | 'village' | 'hamlet' | undefined
  blocked?: (x: number, z: number) => boolean // a building footprint, a road...
  garden?: number // share of the fenced lots that get a fenced garden / paddock behind them (default 0.8: Everon bench 0.66x -> 0.95x the vanilla length)
  back?: number // share of the lots with a back fence (default 0.7)
  share?: number // share of the built lots fenced (default 1: reconstruction bench, Everon sites: 0.65 laid 0.43x the vanilla fence length, 1 -> 0.66x)
}
const STYLE = {
  village: [[FENCES.stone1, FENCES.wood1], [FENCES.brickOld, FENCES.wood2], [FENCES.stone2, FENCES.woodOld], [FENCES.wood1, FENCES.wood1]],
  hamlet: [[FENCES.woodRural, FENCES.woodRural], [FENCES.woodOld, FENCES.woodRural], [FENCES.stone1, FENCES.woodRural]],
} as const

/** garden lots round the town houses (vanilla Saint-Pierre: 8 km of garden walls and fences within 300 m, the
 *  terraced core has none: neighbours block those edges). Footprint pushed out by `margin` metres. */
export function townLots(placed: { site?: string; role?: string; x: number; z: number; corners?: number[] }[], isTown: (site: string) => boolean, margin = 4): FenceLot[] {
  const out: FenceLot[] = []
  for (const q of placed) {
    if (!q.site || !q.corners || q.corners.length < 8 || !isTown(q.site) || (q.role !== 'house' && q.role !== 'farmhouse')) continue
    const c: number[] = []
    for (let i = 0; i < 8; i += 2) { const dx = q.corners[i] - q.x, dz = q.corners[i + 1] - q.z, d = Math.hypot(dx, dz) || 1; c.push(q.corners[i] + dx / d * margin * 1.41, q.corners[i + 1] + dz / d * margin * 1.41) }
    out.push({ site: q.site, corners: c, used: true })
  }
  return out
}

/** fences / low walls round the built village and hamlet lots (corners: front-left, front-right, back-right,
 *  back-left): a front wall with a gate, side and back fences; an edge shared by two lots is laid once, an
 *  edge running over a building or a road is left out. One style per settlement. */
export function lotFences(lots: FenceLot[], o: FenceOptions): VillageParcel[] {
  const share = o.share ?? 1, seen = new Set<string>(), out: VillageParcel[] = []
  const key = (ax: number, az: number, bx: number, bz: number) => {
    const a = `${Math.round(ax / 2)},${Math.round(az / 2)}`, b = `${Math.round(bx / 2)},${Math.round(bz / 2)}`
    return a < b ? a + '|' + b : b + '|' + a
  }
  const clear = (ax: number, az: number, bx: number, bz: number) => {
    if (!o.blocked) return true
    for (let t = 0.1; t < 0.95; t += 0.2) if (o.blocked(ax + (bx - ax) * t, az + (bz - az) * t)) return false
    return true
  }
  lots.forEach((l, i) => {
    const kind = o.kindOf(l.site)
    if (!l.used || l.corners.length < 8 || (kind !== 'town' && kind !== 'village' && kind !== 'hamlet')) return
    if (hash(o.seed, i) > share) return
    let sh = 0
    for (const ch of l.site) sh = (sh * 31 + ch.charCodeAt(0)) >>> 0
    const styles = STYLE[kind === 'town' ? 'village' : kind], [front, side] = styles[Math.floor(hash(o.seed ^ sh, 7) * styles.length)]
    const c = l.corners, P = (k: number) => [c[(k % 4) * 2], c[(k % 4) * 2 + 1]]
    const fences: PlacedFence[] = []
    const edge = (guid: string, a: number[], b: number[]) => {
      const k = key(a[0], a[1], b[0], b[1])
      if (seen.has(k) || !clear(a[0], a[1], b[0], b[1])) return
      seen.add(k); fences.push({ guid, pts: [a[0], a[1], b[0], b[1]] })
    }
    // front with a gate in the middle (4 m, a farm 5 m)
    const [fl, fr] = [P(0), P(1)], w = Math.hypot(fr[0] - fl[0], fr[1] - fl[1])
    if (w > 8) {
      const g = Math.min(w * 0.4, kind === 'hamlet' ? 5 : 4) / 2 / w
      const gl = [fl[0] + (fr[0] - fl[0]) * (0.5 - g), fl[1] + (fr[1] - fl[1]) * (0.5 - g)], gr = [fl[0] + (fr[0] - fl[0]) * (0.5 + g), fl[1] + (fr[1] - fl[1]) * (0.5 + g)]
      edge(front, fl, gl); edge(front, gr, fr)
    }
    edge(side, P(1), P(2)); edge(side, P(3), P(0))
    const back = o.back ?? 0.7
    if (l.farm || hash(o.seed, 6000 + i) < (o.garden ?? 0.8)) {
      // a garden / paddock behind the lot (vanilla: walled gardens, farmyard fences past the house lots)
      const [br, bl] = [P(2), P(3)], dx = br[0] - P(1)[0], dz = br[1] - P(1)[1], d = Math.hypot(dx, dz) || 1
      const ext = d * (l.farm ? 1 + hash(o.seed, 7000 + i) : 0.5 + 0.5 * hash(o.seed, 7000 + i))
      const er = [br[0] + dx / d * ext, br[1] + dz / d * ext], el = [bl[0] + dx / d * ext, bl[1] + dz / d * ext]
      edge(side, br, er); edge(side, er, el); edge(side, el, bl)
    } else if (hash(o.seed, 5000 + i) < back) edge(side, P(2), P(3))
    if (fences.length) out.push({ site: l.site, items: [], fences })
  })
  return out
}

/** point test against building footprints (4 corners each) and road centre lines (half width + 1 m), bucketed on a 50 m grid */
export function makeBlocker(foot: number[][], lines: { pts: number[]; half: number }[]): (x: number, z: number) => boolean {
  const C = 50, cell = new Map<string, { f?: number[]; s?: number[] }[]>()
  const put = (x0: number, z0: number, x1: number, z1: number, v: { f?: number[]; s?: number[] }) => {
    for (let i = Math.floor(x0 / C); i <= Math.floor(x1 / C); i++) for (let j = Math.floor(z0 / C); j <= Math.floor(z1 / C); j++) {
      const k = i + ',' + j; let b = cell.get(k); if (!b) cell.set(k, (b = [])); b.push(v)
    }
  }
  for (const f of foot) { let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity; for (let i = 0; i < f.length; i += 2) { x0 = Math.min(x0, f[i]); x1 = Math.max(x1, f[i]); z0 = Math.min(z0, f[i + 1]); z1 = Math.max(z1, f[i + 1]) } put(x0, z0, x1, z1, { f }) }
  for (const l of lines) for (let i = 0; i + 3 < l.pts.length; i += 2) {
    const s = [l.pts[i], l.pts[i + 1], l.pts[i + 2], l.pts[i + 3], l.half + 1], m = s[4]
    put(Math.min(s[0], s[2]) - m, Math.min(s[1], s[3]) - m, Math.max(s[0], s[2]) + m, Math.max(s[1], s[3]) + m, { s })
  }
  const inPoly = (p: number[], x: number, z: number) => { let ins = false; for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) if ((p[i + 1] > z) !== (p[j + 1] > z) && x < ((p[j] - p[i]) * (z - p[i + 1])) / (p[j + 1] - p[i + 1]) + p[i]) ins = !ins; return ins }
  return (x, z) => {
    for (const v of cell.get(Math.floor(x / C) + ',' + Math.floor(z / C)) ?? []) {
      if (v.f && inPoly(v.f, x, z)) return true
      if (v.s) {
        const [ax, az, bx, bz, h] = v.s, dx = bx - ax, dz = bz - az, L = dx * dx + dz * dz
        const t = L ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L)) : 0
        if (Math.hypot(x - ax - dx * t, z - az - dz * t) < h) return true
      }
    }
    return false
  }
}

/** distance from (x, z) to a polyline x,z,... */
function segDist(p: number[], x: number, z: number): number {
  let m = Infinity
  for (let i = 0; i + 3 < p.length; i += 2) {
    const ax = p[i], az = p[i + 1], dx = p[i + 2] - ax, dz = p[i + 3] - az, L = dx * dx + dz * dz
    const t = L ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L)) : 0
    m = Math.min(m, Math.hypot(x - ax - dx * t, z - az - dz * t))
  }
  return m
}
