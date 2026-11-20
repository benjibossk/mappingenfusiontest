// "Vraie ville" (PLAN_RESTANT P3 #13, CITIES.md §1.10 / §3.4): a town of 100-300 inhabitants
// (~40-120 buildings) in a drawn polygon. Own code after the IDEAS of watabou's city generator
// (no code taken): seed points around a centre, a Voronoi diagram relaxed (Lloyd), the central cell
// is the square / market, the cells around it are districts, the outer ones farms and fields.
// Streets follow the cell edges: main streets = shortest paths from the square to the entry roads,
// secondary streets = the other district edges (every block is closed, dead ends pruned).
// Then (UCG idea) each block gets a type (centre, residential, small industry, park, parking,
// church + cemetery, farm) and is filled by its type: houses along the street front, facing it.
// Pure module, seeded, no UI. Buildings only from the existing catalogue (data/buildings.ts).

import type { Grid } from './island'
import type { Road } from './roads'
import { centreLine, roadHalf } from './roads'
import type { Water } from './water'
import { WATER_TYPES } from './water'
import type { Building, BuildingCat } from '../data/buildings'
import { BUILDINGS, FRONT_YAW, INDUSTRIAL } from '../data/buildings'
import { boxed, footprint, hash, inside, lineDist, minSegments, overlap, rng, sampler, samples, type Line, type Placed, type PlacedRole, type Square } from './settlements'
import { nearestOn } from './villageStreets'
import { ROAD_SEED_OFF, roadEdge, roadSeeds, snapToRoads } from './townRoads'

export type TownBlockType = 'square' | 'centre' | 'residential' | 'industry' | 'park' | 'parking' | 'church' | 'farm'
export const TOWN_BLOCK_TYPES: TownBlockType[] = ['square', 'centre', 'residential', 'industry', 'park', 'parking', 'church', 'farm']
export interface TownBlock { ring: number[]; type: TownBlockType; inset: number[] } // inset: ring minus the streets (site fillers)
export interface TownOptions {
  seed: number
  density?: number // 1 = default
  maxSlope?: number // building ground slope (default 0.2)
  blocked?: number[][] // [x0, z0, x1, z1] boxes to avoid
  prefix?: string // site id (default "T")
  maxBuildings?: number // default 160 (Everon's town disc: 169 buildings, sheds included)
}
export interface TownResult {
  placed: Placed[] // keep + the new buildings
  lanes: Road[] // the streets (main + secondary + links to the entry roads)
  squares: Square[]
  blocks: TownBlock[]
  /** street graph, for checks: vertices (flat X/Z) and edges (vertex index pairs) */
  graph: { v: number[]; e: [number, number][] }
  pop: number // rough population estimate
  warnings: string[]
}

const CELL_AREA = 2000 // m² per Voronoi cell (≈ 45 m blocks; 4200 / max 70 cells laid 31 buildings on Everon's 300 m town disc, vanilla 169)
// districts reach DISTRICT_R x the zone radius (0.78 left the outer ring of Everon's town empty)
const DISTRICT_R = 0.9
const ROAD_CHORD = 36, ROAD_FADE = 2.5 // through-road frontage: chord length (m), extra skip per unit of radius past 0.6 R
const ROAD_NEAR = 14
const CORE_R = 0.35 // road fronts inside this share of the radius take the centre set (big houses, tight)
const SNAP = 3 // merge Voronoi vertices closer than this (no tiny street segments)
const MAIN_GRADE = 0.18, STREET_GRADE = 0.14
const CHURCH_RE = /Church|Chapel|Chapelle|Eglise/i

export function ringArea(r: number[]) {
  let a = 0
  for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) a += (r[j] - r[i]) * (r[j + 1] + r[i + 1])
  return Math.abs(a) / 2
}
function centroid(r: number[]): [number, number] {
  let a = 0, x = 0, z = 0
  for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
    const f = r[j] * r[i + 1] - r[i] * r[j + 1]
    a += f; x += (r[j] + r[i]) * f; z += (r[j + 1] + r[i + 1]) * f
  }
  if (Math.abs(a) < 1e-9) { let sx = 0, sz = 0; for (let i = 0; i < r.length; i += 2) { sx += r[i]; sz += r[i + 1] } return [sx / (r.length / 2), sz / (r.length / 2)] }
  return [x / (3 * a), z / (3 * a)]
}
/** convex polygon ∩ half-plane {p : (p - m)·d <= 0} */
function clipHalf(poly: number[], mx: number, mz: number, dx: number, dz: number): number[] {
  const out: number[] = [], n = poly.length / 2
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n, ax = poly[i * 2], az = poly[i * 2 + 1], bx = poly[j * 2], bz = poly[j * 2 + 1]
    const fa = (ax - mx) * dx + (az - mz) * dz, fb = (bx - mx) * dx + (bz - mz) * dz
    if (fa <= 0) out.push(ax, az)
    if ((fa <= 0) !== (fb <= 0)) { const t = fa / (fa - fb); out.push(ax + (bx - ax) * t, az + (bz - az) * t) }
  }
  return out
}
function voronoi(seeds: number[][], box: number[]): number[][] {
  return seeds.map(([sx, sz], i) => {
    let c = box
    for (let j = 0; j < seeds.length && c.length >= 6; j++) if (j !== i) c = clipHalf(c, (sx + seeds[j][0]) / 2, (sz + seeds[j][1]) / 2, seeds[j][0] - sx, seeds[j][1] - sz)
    return c
  })
}

export function generateTown(polygon: number[], roads: Road[], waters: Water[], heights: ArrayLike<number>, grid: Grid, o: TownOptions, keep: Placed[] = []): TownResult {
  const at = sampler(heights, grid)
  const pre = o.prefix ?? 'T'
  const rand = rng(hash(pre, o.seed))
  const maxSlope = o.maxSlope ?? 0.2, density = o.density ?? 1
  const cap = Math.round((o.maxBuildings ?? 160) * Math.min(1.5, Math.max(0.3, density)))
  const placed = keep.slice()
  const warnings: string[] = []
  const res: TownResult = { placed, lanes: [], squares: [], blocks: [], graph: { v: [], e: [] }, pop: 0, warnings }
  const rivers = waters.filter((w) => !WATER_TYPES[w.type].closed).map((w) => boxed(w.pts, w.width / 2))
  const lakes = waters.filter((w) => WATER_TYPES[w.type].closed).map((w) => w.pts)
  const wet = (x: number, z: number, m: number) => {
    if (at(x, z) < 0.5) return true
    for (const l of rivers) if (lineDist(l.pts, x, z) < l.half + m) return true
    for (const p of lakes) if (inside(p, x, z) || lineDist(p, x, z, true) < m) return true
    return false
  }
  const inZone = (x: number, z: number) => inside(polygon, x, z)
  const grade = (ax: number, az: number, bx: number, bz: number) => Math.abs(at(ax, az) - at(bx, bz)) / (Math.hypot(bx - ax, bz - az) || 1)

  // --- 1. seeds: the square cell at the centre, a ring of 6 around it, a spiral outside
  const area = ringArea(polygon)
  if (area < 40000) { warnings.push('small'); return res }
  let [cx, cz] = centroid(polygon)
  if (!inZone(cx, cz) || wet(cx, cz, 10)) {
    let best = Infinity
    for (let i = 0; i < 400; i++) {
      const x = cx + (rand() - 0.5) * Math.sqrt(area), z = cz + (rand() - 0.5) * Math.sqrt(area)
      const d = Math.hypot(x - cx, z - cz)
      if (d < best && inZone(x, z) && !wet(x, z, 10)) { best = d; cx = x; cz = z }
    }
  }
  const R = Math.sqrt(area / Math.PI)
  // existing roads: through-roads become streets (seed pairs mirrored across them, vertices snapped on them)
  const roadLines: Line[] = roads.filter((r) => r.pts.length >= 4).map((r) => boxed(centreLine(r.pts, 4), roadHalf(r)))
  const n = Math.max(14, Math.min(200, Math.round(area / CELL_AREA)))
  const seeds: number[][] = [[cx, cz]]
  const rot0 = rand() * Math.PI
  for (let k = 0; k < 6; k++) { const a = rot0 + (k * Math.PI) / 3; seeds.push([cx + Math.cos(a) * 46, cz + Math.sin(a) * 46]) }
  seeds.push(...roadSeeds(roadLines, (x, z) => inZone(x, z) && !wet(x, z, 5) && Math.hypot(x - cx, z - cz) > 50, seeds))
  const FIXED = seeds.length
  const offRoad = (x: number, z: number) => roadLines.every((l) => lineDist(l.pts, x, z) > l.half + ROAD_SEED_OFF * 0.6)
  const golden = Math.PI * (3 - Math.sqrt(5))
  for (let i = 0, tries = 0; seeds.length < n && tries < n * 6; tries++, i++) {
    const r = 80 + (R * 1.15 - 80) * Math.sqrt((i + 0.5) / n), a = rot0 + i * golden
    const x = cx + Math.cos(a) * r + (rand() - 0.5) * 14, z = cz + Math.sin(a) * r + (rand() - 0.5) * 14
    if (inZone(x, z) && !wet(x, z, 5) && offRoad(x, z)) seeds.push([x, z])
  }
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity
  for (let i = 0; i < polygon.length; i += 2) { minX = Math.min(minX, polygon[i]); maxX = Math.max(maxX, polygon[i]); minZ = Math.min(minZ, polygon[i + 1]); maxZ = Math.max(maxZ, polygon[i + 1]) }
  const box = [minX - 60, minZ - 60, maxX + 60, minZ - 60, maxX + 60, maxZ + 60, minX - 60, maxZ + 60]
  // --- 2. Lloyd relaxation (the outer seeds only: the square keeps its size)
  let cells = voronoi(seeds, box)
  for (let it = 0; it < 2; it++) {
    for (let i = FIXED; i < seeds.length; i++) { const c = centroid(cells[i]); if (inZone(c[0], c[1]) && !wet(c[0], c[1], 5)) seeds[i] = c }
    cells = voronoi(seeds, box)
  }

  // --- 3. shared vertices and edges
  const V: number[] = []
  const vid = (x: number, z: number) => {
    for (let i = 0; i < V.length; i += 2) if (Math.abs(V[i] - x) < SNAP && Math.abs(V[i + 1] - z) < SNAP) return i / 2
    V.push(x, z)
    return V.length / 2 - 1
  }
  const cellV = cells.map((c) => {
    const ids: number[] = []
    for (let i = 0; i < c.length; i += 2) { const k = vid(c[i], c[i + 1]); if (ids[ids.length - 1] !== k && ids[0] !== k) ids.push(k) }
    return ids
  })
  const onRoad = snapToRoads(V, roadLines)
  const ekey = (a: number, b: number) => (a < b ? a * 100000 + b : b * 100000 + a)
  const edges = new Map<number, { a: number; b: number; cells: number[] }>()
  cellV.forEach((ids, ci) => ids.forEach((a, k) => {
    const b = ids[(k + 1) % ids.length], key = ekey(a, b)
    const e = edges.get(key) ?? { a: Math.min(a, b), b: Math.max(a, b), cells: [] }
    e.cells.push(ci)
    edges.set(key, e)
  }))
  const vx = (i: number) => V[i * 2], vz = (i: number) => V[i * 2 + 1]
  const vIn = (i: number) => inZone(vx(i), vz(i))
  // >= 0: the edge IS an existing road, or runs alongside one (both ends and midpoint within ROAD_NEAR m: no second
  // street drawn a few metres beside it, the road-frontage pass lines that road with houses)
  const roadMemo = new Map<number, number>()
  const roadOf = (a: number, b: number) => {
    const key = ekey(a, b), m = roadMemo.get(key)
    if (m !== undefined) return m
    let r = roadEdge(onRoad, roadLines, vx(a), vz(a), vx(b), vz(b), a, b)
    if (r < 0) {
      const mx = (vx(a) + vx(b)) / 2, mz = (vz(a) + vz(b)) / 2
      r = roadLines.findIndex((l) => lineDist(l.pts, mx, mz) < l.half + ROAD_NEAR && lineDist(l.pts, vx(a), vz(a)) < l.half + ROAD_NEAR && lineDist(l.pts, vx(b), vz(b)) < l.half + ROAD_NEAR)
    }
    roadMemo.set(key, r)
    return r
  }

  // --- 4. districts: whole cells inside the zone, near the centre; the rest of the zone = farms
  const ringOf = (ci: number) => cellV[ci].flatMap((k) => [vx(k), vz(k)])
  const steep = (ring: number[]) => {
    const [x, z] = centroid(ring)
    let bad = 0, all = 0
    for (let i = 0; i < ring.length; i += 2) { const px = (ring[i] + x) / 2, pz = (ring[i + 1] + z) / 2; all++; if (grade(px - 4, pz, px + 4, pz) > maxSlope || grade(px, pz - 4, px, pz + 4) > maxSlope) bad++ }
    return bad / Math.max(1, all) > 0.5
  }
  const kind: (TownBlockType | null)[] = cells.map((_c, ci) => {
    if (cellV[ci].length < 3) return null
    const [x, z] = centroid(ringOf(ci))
    if (!inZone(x, z) || wet(x, z, 4)) return null
    const whole = cellV[ci].every(vIn)
    if (ci === 0) return 'square'
    if (whole && Math.hypot(x - cx, z - cz) < R * DISTRICT_R) return steep(ringOf(ci)) ? 'park' : 'residential'
    return 'farm'
  })
  const district = (ci: number) => { const k = kind[ci]; return !!k && k !== 'farm' }

  // --- 5. candidate street edges: edges of a district, both ends in the zone, dry
  const dry = (a: number, b: number) => {
    const L = Math.hypot(vx(b) - vx(a), vz(b) - vz(a)), m = Math.max(1, Math.ceil(L / 6))
    for (let s = 0; s <= m; s++) { const x = vx(a) + ((vx(b) - vx(a)) * s) / m, z = vz(a) + ((vz(b) - vz(a)) * s) / m; if (wet(x, z, 3)) return false }
    return true
  }
  const egrade = (a: number, b: number) => {
    const L = Math.hypot(vx(b) - vx(a), vz(b) - vz(a)), m = Math.max(1, Math.ceil(L / 8))
    let g = 0
    for (let s = 0; s < m; s++) g = Math.max(g, grade(vx(a) + ((vx(b) - vx(a)) * s) / m, vz(a) + ((vz(b) - vz(a)) * s) / m, vx(a) + ((vx(b) - vx(a)) * (s + 1)) / m, vz(a) + ((vz(b) - vz(a)) * (s + 1)) / m))
    return g
  }
  // no street through a stamped zone box (RP places, vanilla sites: pre-send seed 42, a market on a town lane)
  const boxes = o.blocked ?? []
  const free = (a: number, b: number) => { for (let t = 0; t <= 1; t += 0.125) { const x = vx(a) + (vx(b) - vx(a)) * t, z = vz(a) + (vz(b) - vz(a)) * t; for (const q of boxes) if (x > q[0] - 3 && x < q[2] + 3 && z > q[1] - 3 && z < q[3] + 3) return false } return true }
  const cand = [...edges.values()].filter((e) => e.cells.some(district) && vIn(e.a) && vIn(e.b) && (roadOf(e.a, e.b) >= 0 || (dry(e.a, e.b) && egrade(e.a, e.b) <= MAIN_GRADE && free(e.a, e.b))))
  const adj = new Map<number, { to: number; e: typeof cand[number] }[]>()
  for (const e of cand) for (const [p, q] of [[e.a, e.b], [e.b, e.a]]) { const l = adj.get(p) ?? []; l.push({ to: q, e }); adj.set(p, l) }
  const plazaV = cellV[0].filter((k) => adj.has(k))
  if (!plazaV.length) { warnings.push('noSquare'); return res }

  // --- 6. main streets: square -> each entry (existing road reaching the zone, else 3 compass gates)
  const outerV = [...adj.keys()].filter((k) => [...edges.values()].some((e) => (e.a === k || e.b === k) && e.cells.some((c) => !district(c))))
  const gates: { v: number; link?: number[] }[] = []
  const farEnough = (k: number) => gates.every((g) => { const a1 = Math.atan2(vz(g.v) - cz, vx(g.v) - cx), a2 = Math.atan2(vz(k) - cz, vx(k) - cx); const d = Math.abs(((a1 - a2 + 3 * Math.PI) % (2 * Math.PI)) - Math.PI); return d > Math.PI / 3 })
  const byRoad: { v: number; d: number; p: [number, number] }[] = []
  for (const l of roadLines) {
    let best: { v: number; d: number; p: [number, number] } | null = null
    for (const k of outerV) { const [px, pz, d] = nearestOn(l.pts, vx(k), vz(k)); if (d < 160 && (!best || d < best.d)) best = { v: k, d, p: [px, pz] } }
    if (best) byRoad.push(best)
  }
  byRoad.sort((a, b) => a.d - b.d)
  for (const b of byRoad) if (gates.length < 4 && farEnough(b.v)) gates.push({ v: b.v, link: b.d > 4 ? [vx(b.v), vz(b.v), b.p[0], b.p[1]] : undefined })
  for (let k = 0; gates.length < 3 && k < 3; k++) {
    const a = rot0 + (k * 2 * Math.PI) / 3
    let best = -1, bd = -Infinity
    for (const v of outerV) { const d = (vx(v) - cx) * Math.cos(a) + (vz(v) - cz) * Math.sin(a); if (d > bd && farEnough(v)) { bd = d; best = v } }
    if (best >= 0) gates.push({ v: best })
  }
  const mainE = new Set<number>()
  const paths: number[][] = []
  for (const g of gates) {
    // Dijkstra from the square (multi-source), length weighted by grade
    const dist = new Map<number, number>(), prev = new Map<number, number>(), open = new Set<number>()
    for (const k of plazaV) { dist.set(k, 0); open.add(k) }
    while (open.size) {
      let u = -1, du = Infinity
      for (const k of open) { const d = dist.get(k)!; if (d < du) { du = d; u = k } }
      open.delete(u)
      if (u === g.v) break
      for (const { to, e } of adj.get(u) ?? []) {
        if (e.cells.includes(0)) continue // around the square, not across it
        const w = Math.hypot(vx(to) - vx(u), vz(to) - vz(u)) * (1 + egrade(e.a, e.b) * 8) * (mainE.has(ekey(e.a, e.b)) ? 0.6 : 1) * (roadOf(e.a, e.b) >= 0 ? 0.35 : 1)
        if (du + w < (dist.get(to) ?? Infinity)) { dist.set(to, du + w); prev.set(to, u); open.add(to) }
      }
    }
    if (!dist.has(g.v)) continue
    const p = [g.v]
    while (prev.has(p[p.length - 1])) p.push(prev.get(p[p.length - 1])!)
    p.reverse()
    for (let i = 0; i + 1 < p.length; i++) mainE.add(ekey(p[i], p[i + 1]))
    paths.push(p)
  }

  // --- 7. secondary streets: district edges not too steep; then prune dead ends (no maze)
  const keepE = new Map<number, typeof cand[number]>()
  for (const e of cand) if (mainE.has(ekey(e.a, e.b)) || e.cells.includes(0) || roadOf(e.a, e.b) >= 0 || egrade(e.a, e.b) <= STREET_GRADE) keepE.set(ekey(e.a, e.b), e)
  const gateV = new Set(gates.map((g) => g.v))
  for (let changed = true; changed; ) {
    changed = false
    const deg = new Map<number, number>()
    for (const e of keepE.values()) { deg.set(e.a, (deg.get(e.a) ?? 0) + 1); deg.set(e.b, (deg.get(e.b) ?? 0) + 1) }
    for (const [k, e] of keepE) if (!mainE.has(k) && ((deg.get(e.a) === 1 && !gateV.has(e.a)) || (deg.get(e.b) === 1 && !gateV.has(e.b)))) { keepE.delete(k); changed = true }
  }
  // keep the component of the square
  const comp = new Set<number>(paths.length ? paths.flat() : plazaV) // the main streets are one tree through the square
  for (let grow = true; grow; ) {
    grow = false
    for (const e of keepE.values()) if (comp.has(e.a) !== comp.has(e.b)) { comp.add(e.a); comp.add(e.b); grow = true }
  }
  for (const [k, e] of keepE) if (!comp.has(e.a)) keepE.delete(k)

  // --- 8. polylines: main streets (one per gate), then chains of the other edges
  const used = new Set<number>()
  const lane = (pts: number[], type: Road['type'], tag: string) => {
    const p = minSegments(pts.map((v) => Math.round(v * 100) / 100))
    if (p) res.lanes.push({ id: `SET_${pre}_LANE_${tag}${res.lanes.length + 1}`, type, pts: p, auto: true })
  }
  paths.forEach((p, gi) => {
    let run: number[] = []
    const flush = () => { if (run.length >= 2) lane(run.flatMap((k) => [vx(k), vz(k)]).concat(gi >= 0 && run[run.length - 1] === gates[gi]?.v && gates[gi].link ? gates[gi].link!.slice(2) : []), 'asphaltNarrow', 'M'); run = [] }
    for (let i = 0; i + 1 < p.length; i++) {
      const k = ekey(p[i], p[i + 1])
      if (used.has(k) || !keepE.has(k)) { flush(); continue }
      if (roadOf(p[i], p[i + 1]) >= 0) { used.add(k); flush(); continue } // already a road: no lane on top
      used.add(k)
      if (!run.length) run.push(p[i])
      run.push(p[i + 1])
    }
    flush()
  })
  const left = new Map<number, number[]>()
  for (const [k, e] of keepE) if (!used.has(k) && roadOf(e.a, e.b) < 0) for (const [p, q] of [[e.a, e.b], [e.b, e.a]]) { const l = left.get(p) ?? []; l.push(q); left.set(p, l) }
  const take = (a: number, b: number) => { used.add(ekey(a, b)); left.set(a, left.get(a)!.filter((x) => x !== b)); left.set(b, left.get(b)!.filter((x) => x !== a)) }
  const isSquareEdge = (a: number, b: number) => edges.get(ekey(a, b))?.cells.includes(0) ?? false
  for (let pass = 0; pass < 2; pass++)
    for (const s of [...left.keys()]) {
      while ((left.get(s)?.length ?? 0) && (pass === 1 || left.get(s)!.length !== 2)) {
        const chain = [s]
        let u = s, w = left.get(s)![0]
        const sq = isSquareEdge(u, w)
        for (;;) {
          take(u, w); chain.push(w)
          const nx = left.get(w) ?? []
          if (nx.length !== 1 || w === s || isSquareEdge(w, nx[0]) !== sq) break
          u = w; w = nx[0]
        }
        lane(chain.flatMap((k) => [vx(k), vz(k)]), sq ? 'cobble' : 'dirt', sq ? 'Q' : 'S')
      }
    }
  const vlist = [...new Set([...keepE.values()].flatMap((e) => [e.a, e.b]))]
  const vmap = new Map(vlist.map((k, i) => [k, i]))
  res.graph = { v: vlist.flatMap((k) => [vx(k), vz(k)]), e: [...keepE.values()].map((e) => [vmap.get(e.a)!, vmap.get(e.b)!] as [number, number]) }
  const streetLines: Line[] = res.lanes.map((l) => boxed(l.pts, roadHalf(l)))
  // the lanes are laid as smooth splines (centreLine): their bulge off the straight chords must stay clear too (pre-send seed 42: 7 houses on lanes)
  const splineLines: Line[] = res.lanes.map((l) => boxed(centreLine(l.pts, 4), roadHalf(l)))
  const halfOf = (a: number, b: number) => (roadOf(a, b) >= 0 ? roadLines[roadOf(a, b)].half + 1.5 : isSquareEdge(a, b) ? 3 : mainE.has(ekey(a, b)) ? 3 : 2)

  // --- 9. block types (UCG): centre round the square, one church, a park, a parking, a small industry
  const sq = ringOf(0)
  let sqR = Infinity
  for (let i = 0; i < sq.length; i += 2) sqR = Math.min(sqR, lineDist([sq[i], sq[i + 1], sq[(i + 2) % sq.length], sq[(i + 3) % sq.length]], cx, cz))
  res.squares.push({ site: pre, x: Math.round(seeds[0][0] * 100) / 100, z: Math.round(seeds[0][1] * 100) / 100, r: Math.round(Math.min(sqR, 30)) })
  const served = (ci: number) => cellV[ci].some((a, k) => keepE.has(ekey(a, cellV[ci][(k + 1) % cellV[ci].length])))
  const ring1 = [...edges.values()].filter((e) => e.cells.includes(0)).flatMap((e) => e.cells).filter((c) => c !== 0 && kind[c] === 'residential' && served(c))
  const ring1s = [...new Set(ring1)]
  ring1s.forEach((c, i) => { kind[c] = i === 0 ? 'church' : i === ring1s.length - 1 && ring1s.length > 3 ? 'parking' : 'centre' })
  const res2 = kind.map((k, i) => (k === 'residential' && served(i) ? i : -1)).filter((i) => i >= 0)
  const dc = (i: number) => { const c = centroid(ringOf(i)); return Math.hypot(c[0] - cx, c[1] - cz) }
  res2.sort((a, b) => dc(b) - dc(a))
  if (res2.length > 6) { const near = res2.find((i) => gates.some((g) => cellV[i].includes(g.v))) ?? res2[0]; kind[near] = 'industry' }
  if (res2.length > 4) { const mid = res2.filter((i) => kind[i] === 'residential'); if (mid.length) kind[mid[Math.floor(mid.length / 2)]] = 'park' }

  // --- 10. fill each block by its type
  const blocked = o.blocked ?? []
  const keepN = keep.length
  const clear = (c: number[]) => {
    const pts = samples(c)
    let lo = Infinity, hi = -Infinity
    for (let i = 0; i < pts.length; i += 2) {
      const x = pts[i], z = pts[i + 1]
      if (!inZone(x, z) || wet(x, z, 2)) return false
      for (const l of streetLines) if (x > l.minX - l.half - 2 && x < l.maxX + l.half + 2 && z > l.minZ - l.half - 2 && z < l.maxZ + l.half + 2 && lineDist(l.pts, x, z) < l.half + 1) return false
      for (const l of roadLines) if (lineDist(l.pts, x, z) < l.half + 2) return false
      for (const b of blocked) if (x > b[0] && x < b[2] && z > b[1] && z < b[3]) return false
      const h = at(x, z); lo = Math.min(lo, h); hi = Math.max(hi, h)
    }
    const span = Math.max(Math.hypot(c[2] - c[0], c[3] - c[1]), Math.hypot(c[6] - c[0], c[7] - c[1]))
    if (hi - lo > span * maxSlope) return false
    return !placed.some((q) => overlap(q.corners, c, 1.5))
  }
  const newCount = () => placed.length - keepN
  const add = (b: Building, x: number, z: number, yaw: number, role: PlacedRole, cat: BuildingCat = b.cat) => {
    const corners = footprint(b, x, z, yaw)
    if (newCount() >= cap || !clear(corners)) return false
    placed.push({ id: `SET_${pre}_B${newCount() + 1}`, site: pre, prefab: b.prefab, tpl: b.tpl, cat, x: Math.round(x * 100) / 100, z: Math.round(z * 100) / 100, yaw: Math.round(((yaw % 360) + 360) % 360), corners, role })
    return true
  }
  const pool = (cats: BuildingCat[]) => BUILDINGS.filter((b) => cats.includes(b.cat) && !CHURCH_RE.test(b.prefab))
  const POOL: Partial<Record<TownBlockType, Building[]>> = {
    centre: pool(['houseL', 'houseM']), residential: pool(['houseM', 'houseS', 'houseM', 'houseL']), farm: pool(['farm']),
    industry: INDUSTRIAL.filter((b) => b.role === 'main' && (b.tags.includes('depot') || b.tags.includes('factory')) && b.maxX - b.minX < 40 && b.maxZ - b.minZ < 40).map((b) => ({ prefab: b.prefab, cat: 'shed' as BuildingCat, minX: b.minX, minZ: b.minZ, maxX: b.maxX, maxZ: b.maxZ })),
  }
  const SET: Partial<Record<TownBlockType, { back: number; gap: number; skip: number; annex?: number }>> = { centre: { back: 1, gap: 0.8, skip: 0.05, annex: 0.3 }, residential: { back: 4, gap: 4, skip: 0.18, annex: 0.8 }, industry: { back: 6, gap: 8, skip: 0 }, farm: { back: 8, gap: 30, skip: 0.3, annex: 1 } }
  const pick = <T>(a: T[]) => a[Math.floor(rand() * a.length)]
  // street fronts of a cell: [ax, az, bx, bz, half, nx, nz] with n pointing into the block
  const fronts = (ci: number) => {
    const ids = cellV[ci], [mx, mz] = centroid(ringOf(ci)), out: number[][] = []
    ids.forEach((a, k) => {
      const b = ids[(k + 1) % ids.length]
      if (!keepE.has(ekey(a, b))) return
      const ux = vx(b) - vx(a), uz = vz(b) - vz(a), L = Math.hypot(ux, uz)
      let nx = -uz / L, nz = ux / L
      if ((mx - vx(a)) * nx + (mz - vz(a)) * nz < 0) { nx = -nx; nz = -nz }
      out.push([vx(a), vz(a), vx(b), vz(b), halfOf(a, b), nx, nz, L, isSquareEdge(a, b) ? 1 : mainE.has(ekey(a, b)) ? 0.5 : 0])
    })
    return out.sort((p, q) => q[8] - p[8] || q[7] - p[7]) // the square first, then main streets, then the longest
  }
  // outbuilding behind a house (Bohemia, Everon: 1.6 per house, 76 % behind, median 9 m back, aligned within 5 deg;
  // the vanilla town disc holds 69 sheds / garages for 88 houses)
  const ANNEX = pool(['annex', 'shed']).filter((b) => b.maxX - b.minX < 14 && b.maxZ - b.minZ < 14)
  const annex = (ox: number, oz: number, depth: number, maxZ: number, yaw: number, nx: number, nz: number, ux: number, uz: number) => {
    if (!ANNEX.length) return
    for (let tr = 0; tr < 3; tr++) {
      const a = pick(ANNEX), d = depth - maxZ + 1.5 + rand() * 3 + a.maxZ, lat = (rand() - 0.5) * 8 // origin -> back face, gap, annex half
      const ay = yaw + (rand() < 0.8 ? (rand() - 0.5) * 8 : rand() < 0.5 ? 90 : -90)
      if (add(a, ox + nx * d + ux * lat, oz + nz * d + uz * lat, ay, 'annex', a.cat)) return
    }
  }
  const along = (f: number[], set: { back: number; gap: number; skip: number; annex?: number }, choose: () => Building, role: PlacedRole, cat?: BuildingCat, E = 6) => {
    const [ax, az, bx, bz, half, nx, nz, L] = f, ux = (bx - ax) / L, uz = (bz - az) / L
    const yaw = (Math.atan2(-nx, -nz) * 180) / Math.PI + FRONT_YAW
    let t = E
    while (t < L - E) {
      const b = choose(), w = b.maxX - b.minX
      if (t + w > L - E) break
      if (rand() < set.skip) { t += w * 0.6 + set.gap; continue }
      const yr = (yaw * Math.PI) / 180, sgn = Math.cos(yr) * ux - Math.sin(yr) * uz // local +X = (cos, -sin): along +u or -u
      const s = sgn > 0 ? t - b.minX : t + b.maxX
      const off = half + set.back + b.maxZ
      const ox = ax + ux * s + nx * off, oz = az + uz * s + nz * off
      if (add(b, ox, oz, yaw, role, cat)) {
        t += w + set.gap
        if ((role === 'house' || role === 'farmhouse') && cat !== 'civic' && rand() < (set.annex ?? 0)) annex(ox, oz, b.maxZ - b.minZ, b.maxZ, yaw, nx, nz, ux, uz)
      } else t += 3
    }
  }
  const RANK: Record<TownBlockType, number> = { square: 0, church: 1, centre: 2, industry: 3, farm: 4, parking: 5, park: 5, residential: 6 } // residential last: it takes what the cap leaves
  const order = kind.map((_k, i) => i).filter((i) => kind[i] && served(i)).sort((a, b) => RANK[kind[a]!] - RANK[kind[b]!] || dc(a) - dc(b))
  for (const ci of order) {
    const type = kind[ci]!
    const ring = ringOf(ci)
    const [mx, mz] = centroid(ring)
    let r0 = Infinity
    for (let i = 0; i < ring.length; i += 2) r0 = Math.min(r0, lineDist([ring[i], ring[i + 1], ring[(i + 2) % ring.length], ring[(i + 3) % ring.length]], mx, mz))
    const k = Math.max(0, 1 - 6 / Math.max(r0, 6))
    const inset = []
    for (let i = 0; i < ring.length; i += 2) inset.push(Math.round((mx + (ring[i] - mx) * k) * 100) / 100, Math.round((mz + (ring[i + 1] - mz) * k) * 100) / 100)
    res.blocks.push({ ring: ring.map((v) => Math.round(v * 100) / 100), type, inset })
    const fr = fronts(ci)
    if (type === 'square' || type === 'park' || type === 'parking') continue
    if (type === 'church') {
      const churches = BUILDINGS.filter((b) => CHURCH_RE.test(b.prefab))
      const c = churches.length ? churches : BUILDINGS.filter((b) => b.cat === 'civic')
      for (const f of fr) { let ok = false; for (const b of c) { along(f, { back: 3, gap: 100, skip: 0 }, () => b, 'church', 'civic'); if (placed.some((q) => q.role === 'church' && q.site === pre)) { ok = true; break } } if (ok) break }
      continue // the rest of the block: the cemetery (site filler in the UI)
    }
    if (type === 'centre') {
      const pub = BUILDINGS.filter((b) => b.cat === 'civic' && !CHURCH_RE.test(b.prefab))
      if (pub.length && !placed.slice(keepN).some((q) => q.cat === 'civic' && q.role === 'house')) for (const f of fr) { along(f, { back: 1, gap: 200, skip: 0 }, () => pick(pub), 'house', 'civic'); if (placed.slice(keepN).some((q) => q.cat === 'civic' && q.role === 'house')) break }
    }
    const p = POOL[type]!, set = SET[type]!
    if (!p.length) continue
    if (type === 'farm') { if (fr[0]) along(fr[0], set, () => pick(p), 'farmhouse'); continue }
    for (const f of fr) along(f, set, () => pick(p), type === 'industry' ? 'annex' : 'house')
  }
  // through-roads: the existing roads crossing the town are its main streets in Bohemia's towns (the Voronoi edges
  // only follow them roughly): houses along both sides, in chords of ~ROAD_CHORD m, sparser towards the edge
  // (vanilla Everon town, buildings per ha by 50 m ring: flat to 200 m, then half, then a quarter)
  const RES = SET.residential!, rpool = POOL.residential!
  const chords: { f: number[]; r: number }[] = []
  for (const l of roadLines) {
    const p = l.pts, ch: number[] = [p[0], p[1]]
    for (let i = 2, acc = 0; i < p.length; i += 2) { acc += Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]); if (acc >= ROAD_CHORD || i === p.length - 2) { ch.push(p[i], p[i + 1]); acc = 0 } }
    for (let i = 0; i + 3 < ch.length; i += 2) {
      const ax = ch[i], az = ch[i + 1], bx = ch[i + 2], bz = ch[i + 3], L = Math.hypot(bx - ax, bz - az)
      if (L < 12) continue
      const r = Math.hypot((ax + bx) / 2 - cx, (az + bz) / 2 - cz) / R
      if (r > DISTRICT_R + 0.05 || !inZone((ax + bx) / 2, (az + bz) / 2)) continue
      for (const sg of [1, -1]) chords.push({ f: [ax, az, bx, bz, l.half + 1.5, (-(bz - az) / L) * sg, ((bx - ax) / L) * sg, L], r })
    }
  }
  chords.sort((p, q) => p.r - q.r)
  // no church in its block (a through-road across it): the first road front near the centre that takes one
  if (!placed.slice(keepN).some((q) => q.role === 'church')) {
    const churches = BUILDINGS.filter((b) => CHURCH_RE.test(b.prefab))
    for (const c of chords) {
      if (c.r > 0.5) break
      for (const b of churches) { along(c.f, { back: 3, gap: 100, skip: 0 }, () => b, 'church', 'civic', 2); if (placed.slice(keepN).some((q) => q.role === 'church')) break }
      if (placed.slice(keepN).some((q) => q.role === 'church')) break
    }
  }
  for (const c of chords) {
    const core = c.r < CORE_R
    along(c.f, core ? SET.centre! : { ...RES, skip: Math.min(0.9, RES.skip + Math.max(0, c.r - 0.6) * ROAD_FADE) }, () => pick(core ? POOL.centre! : rpool), 'house', undefined, 2)
  }
  // drop what the smoothed lanes run over (corner cut of the spline), same test as the pre-send check (corners + origin)
  for (let i = placed.length - 1; i >= keepN; i--) {
    const q = placed[i], pr = [q.x, q.z, ...q.corners]
    let hit = false
    for (let k = 0; k + 1 < pr.length && !hit; k += 2) for (const l of splineLines) if (lineDist(l.pts, pr[k], pr[k + 1]) < l.half - 0.3) { hit = true; break }
    if (hit) placed.splice(i, 1)
  }
  const houses = placed.slice(keepN).filter((q) => q.role === 'house' || q.role === 'farmhouse').length
  res.pop = Math.round(houses * 2.5)
  if (newCount() < 40) warnings.push('fewBuildings')
  return res
}
