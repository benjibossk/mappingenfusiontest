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

export interface Node { x: number; z: number; branches: number; mains: number; type: RoadType }

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
    let branches = 0, mains = 0, rank = -1, type: RoadType = 'asphalt', roadsHere = 0
    for (const r of roads) {
      if (r.pts.length < 4) continue
      const q = nearestOnLine(r.pts, x, z)
      if (q.d > tol) continue
      roadsHere++
      branches += q.end ? 1 : 2
      const c = classOf(r.type)
      if (c === 'main') mains++
      if ((RANK[c] ?? 0) > rank) { rank = RANK[c] ?? 0; type = r.type }
    }
    if (roadsHere >= 2) nodes.push({ x, z, branches, mains, type })
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

export function ringPoints(cx: number, cz: number, R: number, k = 16): number[] {
  const out: number[] = []
  for (let i = 0; i <= k; i++) {
    const a = ((i % k) / k) * Math.PI * 2
    out.push(Math.round((cx + Math.cos(a) * R) * 100) / 100, Math.round((cz + Math.sin(a) * R) * 100) / 100)
  }
  return out
}

//! Roads with roundabouts: qualifying nodes (>= 4 branches, or main x main, paved) at least 4 R apart
//! and from other junctions; branches clipped at the ring, ring added as an auto road (`<id>_RB`).
export function addRoundabouts(roads: Road[], o: { minBranches?: number; radius?: number } = {}): { roads: Road[]; rings: { x: number; z: number; r: number }[] } {
  const minB = o.minBranches ?? 4
  const all = junctionNodes(roads)
  const picks = all.filter((n) => isPaved(n.type) && (n.branches >= minB || n.mains >= 2) && n.branches >= 3)
  const rings: { x: number; z: number; r: number; type: RoadType }[] = []
  for (const n of picks) {
    const R = o.radius ?? (classOf(n.type) === 'main' ? 14 : 11)
    const clash = all.some((m) => m !== n && Math.hypot(m.x - n.x, m.z - n.z) < R * 3) || rings.some((g) => Math.hypot(g.x - n.x, g.z - n.z) < (g.r + R) * 3)
    if (!clash) rings.push({ x: n.x, z: n.z, r: R, type: n.type })
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
  rings.forEach((g) => out.push({ id: `RB_${++id}`, type: g.type, pts: ringPoints(g.x, g.z, g.r), auto: true, width: g.r >= 14 ? 8 : 6.5 }))
  return { roads: out, rings: rings.map(({ x, z, r }) => ({ x, z, r })) }
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
