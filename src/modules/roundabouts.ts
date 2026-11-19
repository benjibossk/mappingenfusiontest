// Roundabouts at busy junctions and low stone walls along village roads (P3 #15 / #17).
// Roundabout: a node where >= 4 branches meet, or two main roads cross, becomes a ring road
// (spline, same road generator as the busiest branch); every branch is clipped at the ring.
// Village walls: native wall generator (WG_StoneWall_01) as a polyline beside paved roads that run
// through a settlement, away from junctions and from house fronts (driveways stay open).

import { centreLine, isPaved, offsetLine, roadHalf, type Road, type RoadType } from './roads'
import { classOf } from './roadgraph-classes'
import type { ProjectShape } from '../project'
import { FENCES } from '../data/biomes'

const RANK: Record<string, number> = { main: 5, secondary: 4, local: 3, street: 2, track: 1, trail: 0 }

export interface Node { x: number; z: number; branches: number; mains: number; secs: number; type: RoadType }

function nearestOnLine(pts: number[], x: number, z: number): { d: number; end: boolean } {
  let best = Infinity, end = false
  const n = pts.length / 2
  for (let i = 0; i + 1 < n; i++) {
    const ax = pts[i * 2], az = pts[i * 2 + 1], bx = pts[i * 2 + 2], bz = pts[i * 2 + 3]
    const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1
    const t = Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / l2))
    const d = Math.hypot(ax + dx * t - x, az + dz * t - z)
    if (d < best) { best = d; end = (i === 0 && t === 0) || (i === n - 2 && t === 1) }
  }
  return { d: best, end }
}

//! junction nodes (road ends lying on another road, or shared points) with their branch count
export function junctionNodes(roads: Road[], tol = 3): Node[] {
  const cand: [number, number][] = []
  for (const r of roads) {
    if (r.pts.length < 4 || r.id.startsWith('RB_')) continue
    cand.push([r.pts[0], r.pts[1]], [r.pts[r.pts.length - 2], r.pts[r.pts.length - 1]])
  }
  const nodes: Node[] = []
  for (const [x, z] of cand) {
    if (nodes.some((n) => Math.hypot(n.x - x, n.z - z) < tol * 4)) continue
    let branches = 0, mains = 0, secs = 0, rank = -1, type: RoadType = 'asphalt', roadsHere = 0
    for (const r of roads) {
      if (r.pts.length < 4) continue
      const q = nearestOnLine(r.pts, x, z)
      if (q.d > tol) continue
      roadsHere++
      branches += q.end ? 1 : 2
      const c = classOf(r.type)
      if (c === 'main') mains++
      if (c === 'secondary') secs++
      if ((RANK[c] ?? 0) > rank) { rank = RANK[c] ?? 0; type = r.type }
    }
    if (roadsHere >= 2) nodes.push({ x, z, branches, mains, secs, type })
  }
  return nodes
}

//! pieces of a polyline lying outside the circle (cx, cz, R); crossing points are inserted exactly on the circle
export function clipCircle(pts: number[], cx: number, cz: number, R: number): number[][] {
  const out: number[][] = []
  let cur: number[] = []
  const inside = (x: number, z: number) => Math.hypot(x - cx, z - cz) < R
  const cross = (ax: number, az: number, bx: number, bz: number): [number, number] => {
    const dx = bx - ax, dz = bz - az, fx = ax - cx, fz = az - cz
    const a = dx * dx + dz * dz, b = 2 * (fx * dx + fz * dz), c = fx * fx + fz * fz - R * R
    const s = Math.sqrt(Math.max(0, b * b - 4 * a * c))
    const ts = [(-b - s) / (2 * a), (-b + s) / (2 * a)].filter((t) => t >= 0 && t <= 1)
    const t = ts.length ? ts[0] : 0.5
    return [ax + dx * t, az + dz * t]
  }
  const n = pts.length / 2
  for (let i = 0; i < n; i++) {
    const x = pts[i * 2], z = pts[i * 2 + 1], inn = inside(x, z)
    if (i > 0) {
      const px = pts[i * 2 - 2], pz = pts[i * 2 - 1], pin = inside(px, pz)
      if (pin !== inn) {
        // segment leaving / entering the circle (one crossing)
        const dx = x - px, dz = z - pz, fx = px - cx, fz = pz - cz
        const a = dx * dx + dz * dz, b = 2 * (fx * dx + fz * dz), c = fx * fx + fz * fz - R * R
        const s = Math.sqrt(Math.max(0, b * b - 4 * a * c))
        const t = pin ? (-b + s) / (2 * a) : (-b - s) / (2 * a)
        const p: [number, number] = [px + dx * t, pz + dz * t]
        if (pin) cur.push(p[0], p[1])
        else { cur.push(p[0], p[1]); out.push(cur); cur = [] }
      } else if (!pin && !inn) {
        // segment passing through the circle without a vertex inside
        const fx = px - cx, fz = pz - cz, dx = x - px, dz = z - pz, a = dx * dx + dz * dz
        const t = Math.min(1, Math.max(0, -(fx * dx + fz * dz) / (a || 1)))
        if (Math.hypot(fx + dx * t, fz + dz * t) < R) {
          const p = cross(px, pz, x, z), q = cross(x, z, px, pz)
          cur.push(p[0], p[1]); out.push(cur); cur = [q[0], q[1]]
        }
      }
    }
    if (!inn) cur.push(x, z)
  }
  if (cur.length) out.push(cur)
  const len = (p: number[]) => { let l = 0; for (let i = 2; i < p.length; i += 2) l += Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]); return l }
  return out.filter((p) => p.length >= 4 && len(p) >= 4)
}

//! closed ring (16 points) with the given points on it inserted in angular order (ring vertices closer than
//! 3 m to one of them are dropped); first point = last point
export function ringWith(cx: number, cz: number, R: number, on: [number, number][], k = 16): number[] {
  const ang = (x: number, z: number) => { const a = Math.atan2(z - cz, x - cx); return a < 0 ? a + Math.PI * 2 : a }
  const base = ringPoints(cx, cz, R, k).slice(0, k * 2)
  const pts: [number, number, number][] = on.map(([x, z]) => [ang(x, z), x, z])
  for (let i = 0; i < k; i++) {
    const x = base[i * 2], z = base[i * 2 + 1]
    if (!on.some(([a, b]) => Math.hypot(a - x, b - z) < 3)) pts.push([ang(x, z), x, z])
  }
  pts.sort((p, q) => p[0] - q[0])
  const out = pts.flatMap(([, x, z]) => [x, z])
  out.push(out[0], out[1])
  return out
}

export function ringPoints(cx: number, cz: number, R: number, k = 16): number[] {
  const out: number[] = []
  for (let i = 0; i <= k; i++) {
    const a = ((i % k) / k) * Math.PI * 2
    out.push(Math.round((cx + Math.cos(a) * R) * 100) / 100, Math.round((cz + Math.sin(a) * R) * 100) / 100)
  }
  return out
}

//! ring radius by the class of the busiest road at the node (m)
export const RING_RADIUS: Record<string, number> = { main: 14, secondary: 11, local: 9 }
const MERGE_M = 60 // two T junctions closer than this become one roundabout

//! Roads with roundabouts. A roundabout is just a closed round spline and the roads that touch it: every branch
//! is clipped at the ring and its new end is also a ring control point (shared point, so the same height).
//! Qualifying nodes (paved, >= 3 branches): >= 4 branches, a main road meeting another main or a secondary road,
//! a main or secondary road meeting a local one at the entrance of a place (`places`: centre + radius, node within 2.2 r), or two
//! paved T junctions closer than 60 m (merged into one ring between them). Rings stay clear of the other 3+ branch
//! junctions (R..2R+10 m; one inside the ring is absorbed: its roads are clipped at the ring too) and of each
//! other (3 (R1 + R2)). Motorway roads (MW_*) never get one.
export function addRoundabouts(roads: Road[], o: { minBranches?: number; radius?: number; places?: { x: number; z: number; r: number }[] } = {}): { roads: Road[]; rings: { x: number; z: number; r: number }[] } {
  const minB = o.minBranches ?? 4
  const all = junctionNodes(roads.filter((r) => !r.id.startsWith('MW_')))
  const radius = (t: RoadType) => o.radius ?? RING_RADIUS[classOf(t)] ?? 9
  const best = (a: RoadType, b: RoadType) => ((RANK[classOf(a)] ?? 0) >= (RANK[classOf(b)] ?? 0) ? a : b)
  type Cand = { x: number; z: number; r: number; type: RoadType; from: Node[] }
  const cands: Cand[] = []
  for (const n of all) {
    if (!isPaved(n.type) || n.branches < 3) continue
    const entrance = n.mains + n.secs >= 1 && (o.places ?? []).some((q) => Math.hypot(q.x - n.x, q.z - n.z) < q.r * 2.2)
    if (n.branches >= minB || n.mains >= 2 || (n.mains >= 1 && n.secs >= 1) || entrance) cands.push({ x: n.x, z: n.z, r: radius(n.type), type: n.type, from: [n] })
  }
  // two close T junctions -> one ring through both (its radius reaches past both nodes)
  const used = new Set<Node>()
  for (const a of all) for (const b of all) {
    if (a === b || used.has(a) || used.has(b) || !isPaved(a.type) || !isPaved(b.type) || a.branches < 3 || b.branches < 3) continue
    const d = Math.hypot(a.x - b.x, a.z - b.z)
    if (d >= MERGE_M || d < 1) continue
    const type = best(a.type, b.type), r = Math.min(30, Math.max(radius(type), d / 2 + 6))
    used.add(a); used.add(b)
    cands.push({ x: (a.x + b.x) / 2, z: (a.z + b.z) / 2, r, type, from: [a, b] })
  }
  // merged pairs first (they solve two junctions), then the busiest classes
  cands.sort((p, q) => q.from.length - p.from.length || (RANK[classOf(q.type)] ?? 0) - (RANK[classOf(p.type)] ?? 0))
  const rings: { x: number; z: number; r: number; type: RoadType }[] = []
  for (const c of cands) {
    const R = c.r
    const clash = all.some((m) => { const d = Math.hypot(m.x - c.x, m.z - c.z); return !c.from.includes(m) && m.branches >= 3 && d > R * 0.9 && d < R * 2 + 10 }) || rings.some((g) => Math.hypot(g.x - c.x, g.z - c.z) < (g.r + R) * 3)
    if (!clash) rings.push({ x: c.x, z: c.z, r: R, type: c.type })
  }
  if (!rings.length) return { roads, rings: [] }
  let out = roads
  for (const g of rings) {
    const next: Road[] = []
    for (const r of out) {
      if (nearestOnLine(r.pts, g.x, g.z).d > g.r) { next.push(r); continue }
      const pieces = clipCircle(r.pts, g.x, g.z, g.r)
      pieces.forEach((p, k) => next.push({ ...r, id: k ? `${r.id}_${k}` : r.id, pts: p.map((v) => Math.round(v * 100) / 100), spans: undefined }))
    }
    out = next
  }
  let id = roads.filter((r) => /^RB_\d+$/.test(r.id)).reduce((m, r) => Math.max(m, +r.id.slice(3)), 0)
  for (const g of rings) {
    // the road ends lying on this ring are snapped onto its evenly spaced control points (exactly the same point)
    const pts = snapEndsToRing(out, g.x, g.z, g.r, Math.max(16, Math.round((2 * Math.PI * g.r) / 4)))
    out.push({ id: `RB_${++id}`, type: g.type, pts, auto: true, width: g.r >= 14 ? 8 : 6.5 })
  }
  return { roads: out, rings: rings.map(({ x, z, r }) => ({ x, z, r })) }
}

//! rings left with fewer than 2 roads touching them (a branch dropped later, e.g. too steep) are removed
export function dropOrphanRings(roads: Road[]): Road[] {
  const ends = new Set<string>()
  for (const r of roads) if (!r.id.startsWith('RB_') && r.pts.length >= 4) for (const e of [0, r.pts.length - 2]) ends.add(`${r.pts[e]},${r.pts[e + 1]}`)
  return roads.filter((r) => {
    if (!r.id.startsWith('RB_')) return true
    let n = 0
    for (let i = 0; i + 2 < r.pts.length; i += 2) if (ends.has(`${r.pts[i]},${r.pts[i + 1]}`)) n++
    return n >= 2
  })
}

export const VILLAGE_WALL = FENCES.stone1

//! Low stone walls along paved roads crossing a village: inVillage(x, z) says where houses are,
//! nearFront(x, z) where a building front / driveway is (wall left open there). Runs >= 15 m, cut 25 m
//! around junctions, 1.5 m beyond the road edge on both sides.
export function villageWalls(roads: Road[], inVillage: (x: number, z: number) => boolean, nearFront: (x: number, z: number) => boolean = () => false): ProjectShape[] {
  const shapes: ProjectShape[] = []
  const nodes = junctionNodes(roads)
  for (const road of roads) {
    if (!isPaved(road.type) || road.pts.length < 4 || road.id.startsWith('RB_')) continue
    const line = centreLine(road.pts, 4)
    for (const side of [1, -1]) {
      const wall = offsetLine(line, side * (roadHalf(road) + 1.5))
      let cur: number[] = [], k = 0
      const flush = () => {
        let l = 0
        for (let i = 2; i < cur.length; i += 2) l += Math.hypot(cur[i] - cur[i - 2], cur[i + 1] - cur[i - 1])
        if (l >= 15) shapes.push({ id: `${road.id}_WALL_${side > 0 ? 'L' : 'R'}${k++}`, kind: 'polyline', closed: false, points: cur.map((v) => Math.round(v * 100) / 100), generator: VILLAGE_WALL })
        cur = []
      }
      for (let i = 0; i < wall.length / 2; i++) {
        const x = wall[i * 2], z = wall[i * 2 + 1]
        const ok = inVillage(x, z) && !nearFront(x, z) && !nodes.some((n) => Math.hypot(n.x - x, n.z - z) < 25)
        if (ok) cur.push(x, z)
        else flush()
      }
      flush()
    }
  }
  return shapes
}

//! closed ring of k evenly spaced points; every road end lying on the ring is snapped to its nearest ring vertex
//! (so ends and ring share the exact point and the circle stays perfectly round)
function snapEndsToRing(roads: Road[], cx: number, cz: number, R: number, k: number): number[] {
  const ring = ringPoints(cx, cz, R, k)
  for (const r of roads) for (const e of [0, r.pts.length - 2]) {
    const x = r.pts[e], z = r.pts[e + 1]
    if (Math.abs(Math.hypot(x - cx, z - cz) - R) > 0.05) continue
    let a = Math.atan2(z - cz, x - cx); if (a < 0) a += Math.PI * 2
    const i = Math.round((a / (Math.PI * 2)) * k) % k
    r.pts[e] = ring[i * 2]; r.pts[e + 1] = ring[i * 2 + 1]
  }
  return ring
}

//! Town square crossed by a road -> a real roundabout: one closed round spline at (cx, cz) with the generator of the
//! most important road meeting it (asphalt > cobble > dirt), the roads and the village lanes clipped at its outer
//! edge (nothing crosses the island), the square perimeter lanes (`_LANE_Q`) replaced by the ring.
//! `reach`: square radius (roads / lanes closer than this to the centre meet the junction). Returns null when no
//! paved road reaches the square.
export function squareRoundabout(roads: Road[], lanes: Road[], cx: number, cz: number, reach: number, id = 'RB_SQ'): { roads: Road[]; lanes: Road[]; ring: Road } | null {
  const near = (r: Road) => r.pts.length >= 4 && nearestOnLine(r.pts, cx, cz).d < reach
  const meet = roads.filter((r) => near(r) && !r.id.startsWith('RB_') && !r.id.startsWith('MW_'))
  if (!meet.some((r) => isPaved(r.type) && classOf(r.type) !== 'street')) return null
  const rank = (t: RoadType) => RANK[classOf(t)] ?? 0
  const type = [...meet, ...lanes.filter(near)].map((r) => r.type).reduce((a, b) => (rank(b) > rank(a) ? b : a))
  const width = Math.max(...meet.map((r) => roadHalf(r) * 2))
  const R = Math.max(RING_RADIUS[classOf(type)] ?? 9, width * 1.5)
  const clip = (list: Road[]) => list.flatMap((r) => {
    if (!near(r) && nearestOnLine(r.pts, cx, cz).d > R) return [r]
    return clipCircle(r.pts, cx, cz, R).map((p, k) => ({ ...r, id: k ? `${r.id}_${k}` : r.id, pts: p.map((v) => Math.round(v * 100) / 100), spans: undefined }))
  })
  const outRoads = clip(roads)
  // the square loop is the duplicate: dropped, the ring replaces it
  const outLanes = clip(lanes.filter((l) => !(/_LANE_Q\d+$/.test(l.id) && near(l))))
  const k = Math.max(16, Math.round((2 * Math.PI * R) / 4))
  const pts = snapEndsToRing([...outRoads, ...outLanes], cx, cz, R, k)
  return { roads: outRoads, lanes: outLanes, ring: { id, type, pts, auto: true, width: R >= 14 ? 8 : 6.5 } }
}

//! Every road end lying on another road (a ring, a junction, a T) gets one more point `ext` m further along its own
//! direction, into the other carriageway (the shared junction point stays a control point), so the road meshes overlap and leave no hole. `targets`: roads ends may land on
//! (default: the same list). Run once, at the very end (later steps match ends to ring points exactly).
export function overlapJunctions(roads: Road[], targets: Road[] = roads, ext = 1.75, tol = 0.5): void {
  for (const r of roads) {
    if (r.pts.length < 4) continue
    const n = r.pts.length
    if (Math.hypot(r.pts[0] - r.pts[n - 2], r.pts[1] - r.pts[n - 1]) < 0.01) continue // closed ring
    if (/^MW_[AB]$/.test(r.id)) continue // motorway carriageways: their ends are the tapers, not junctions
    const moves: [number, number, number][] = []
    for (const [e, p] of [[0, 2], [n - 2, n - 4]]) {
      const x = r.pts[e], z = r.pts[e + 1]
      const hit = targets.filter((o) => o !== r && !/^MW_[AB]$/.test(o.id) && o.pts.length >= 4 && nearestOnLine(o.pts, x, z).d < tol)
      if (!hit.length) continue
      // two roads joined end to end (a continuation, the motorway taper): nothing to overlap
      const endOf = (o: Road) => [0, o.pts.length - 2].some((k) => Math.hypot(o.pts[k] - x, o.pts[k + 1] - z) < tol)
      if (hit.length === 1 && endOf(hit[0]) && !hit[0].id.startsWith('RB_')) continue
      const dx = x - r.pts[p], dz = z - r.pts[p + 1], l = Math.hypot(dx, dz) || 1
      moves.push([e, Math.round((x + (dx / l) * ext) * 100) / 100, Math.round((z + (dz / l) * ext) * 100) / 100])
    }
    for (const [e, x, z] of moves.sort((a, b) => b[0] - a[0])) { if (e) r.pts.push(x, z); else r.pts.unshift(x, z) }
  }
}
