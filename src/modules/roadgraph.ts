// Road network V2 (docs/ROAD_NETWORK_V2.md), stages 1-3: a node/edge graph beside the Road[] export format.
// - roadsToGraph / graphToRoads: lossless round trip (an edge remembers its road and its rank in it)
// - weldRoads: welded junctions. A road end within `snap` metres of another road lands ON it (T, the other
//   road gets that point as a control point), two ends close together meet on one point, two roads that
//   cross get a shared point (X). Shared point = same spline vertex = one height for every road through it.
// - roadIslands / connectIslands: connected components of the network and an optional auto-connect.
import { classOf, type RoadClass } from './roadgraph-classes'
import type { Road, RoadType } from './roads'

export type NodeKind = 'end' | 'join' | 'tee' | 'cross' | 'roundabout' | 'bridgeEnd'
export interface RNode { id: string; x: number; z: number; y?: number; kind: NodeKind }
export interface REdge {
  id: string
  a: string // node ids
  b: string
  cls: RoadClass
  type: RoadType
  pts: number[] // interior polyline x,z (without a and b)
  road: string // Road this edge comes from (graphToRoads joins the edges of one road back)
  seq: number // rank of the edge inside its road
  width?: number
  flatten?: boolean
  bridge?: boolean
  auto?: boolean
  profile?: number[] // Y per point (a, interior..., b) once the vertical profile is computed
  structure?: { kind: 'bridge'; from: number; to: number } // arc length span (m)
}
export interface RoadGraph { nodes: Map<string, RNode>; edges: REdge[]; loose: Road[] /* roads with < 2 points */ }

const key = (x: number, z: number) => `${x},${z}`

//! node kind from its degree
export function kindOf(deg: number): NodeKind {
  return deg <= 1 ? 'end' : deg === 2 ? 'join' : deg === 3 ? 'tee' : 'cross'
}

//! Road[] -> graph. A node sits on every road end and on every control point shared by two roads (or met twice
//! by one road); each road is cut there into edges. Exact coordinates: call weldRoads first to snap near misses.
export function roadsToGraph(roads: Road[], opts: { snap?: number; crossings?: boolean } = {}): RoadGraph {
  const src = opts.snap || opts.crossings ? weldRoads(roads, { snap: opts.snap ?? 0, crossings: opts.crossings }) : roads
  const nodes = new Map<string, RNode>()
  const edges: REdge[] = []
  const loose: Road[] = []
  // how many times each point is used (by any road, ends counted once per road)
  const uses = new Map<string, number>()
  for (const r of src) {
    const seen = new Set<string>()
    for (let i = 0; i + 1 < r.pts.length; i += 2) {
      const k = key(r.pts[i], r.pts[i + 1])
      if (seen.has(k)) { uses.set(k, (uses.get(k) ?? 0) + 2); continue } // a road passing twice: a node
      seen.add(k)
      uses.set(k, (uses.get(k) ?? 0) + 1)
    }
  }
  const nodeAt = (x: number, z: number) => {
    const k = key(x, z)
    let n = nodes.get(k)
    if (!n) { n = { id: k, x, z, kind: 'end' }; nodes.set(k, n) }
    return n
  }
  for (const r of src) {
    const n = r.pts.length / 2
    if (n < 2) { loose.push({ ...r, pts: r.pts.slice() }); continue }
    let start = nodeAt(r.pts[0], r.pts[1]), interior: number[] = [], seq = 0
    for (let i = 1; i < n; i++) {
      const x = r.pts[i * 2], z = r.pts[i * 2 + 1]
      if (i === n - 1 || (uses.get(key(x, z)) ?? 0) > 1) {
        const end = nodeAt(x, z)
        edges.push({ id: `${r.id}#${seq}`, a: start.id, b: end.id, cls: classOf(r.type), type: r.type, pts: interior, road: r.id, seq: seq++,
          ...(r.width !== undefined && { width: r.width }), ...(r.flatten !== undefined && { flatten: r.flatten }),
          ...(r.bridge !== undefined && { bridge: r.bridge }), ...(r.auto !== undefined && { auto: r.auto }) })
        start = end
        interior = []
      } else interior.push(x, z)
    }
  }
  refreshKinds({ nodes, edges, loose })
  return { nodes, edges, loose }
}

//! degree of every node (a loop edge a === b counts twice)
export function degrees(g: RoadGraph): Map<string, number> {
  const d = new Map<string, number>()
  for (const id of g.nodes.keys()) d.set(id, 0)
  for (const e of g.edges) { d.set(e.a, (d.get(e.a) ?? 0) + 1); d.set(e.b, (d.get(e.b) ?? 0) + 1) }
  return d
}

export function refreshKinds(g: RoadGraph) {
  const d = degrees(g)
  for (const n of g.nodes.values()) if (n.kind !== 'roundabout' && n.kind !== 'bridgeEnd') n.kind = kindOf(d.get(n.id) ?? 0)
}

//! graph -> Road[]: the edges of one road joined back in order (an edge without a known road becomes one road)
export function graphToRoads(g: RoadGraph): Road[] {
  const by = new Map<string, REdge[]>()
  for (const e of g.edges) {
    const list = by.get(e.road)
    if (list) list.push(e)
    else by.set(e.road, [e])
  }
  const out: Road[] = []
  for (const [id, list] of by) {
    list.sort((p, q) => p.seq - q.seq)
    const f = list[0], A = g.nodes.get(f.a)!
    const pts = [A.x, A.z]
    for (const e of list) {
      const B = g.nodes.get(e.b)!
      pts.push(...e.pts, B.x, B.z)
    }
    const r: Road = { id, type: f.type, pts }
    if (f.width !== undefined) r.width = f.width
    if (f.flatten !== undefined) r.flatten = f.flatten
    if (f.bridge !== undefined) r.bridge = f.bridge
    if (f.auto !== undefined) r.auto = f.auto
    out.push(r)
  }
  for (const r of g.loose) out.push({ ...r, pts: r.pts.slice() })
  return out
}

// --- stage 2: welded junctions ---

//! closest point of polyline p to (x, z): [x, z, distance, segment index k (point between k-1 and k), t]
function closest(p: number[], x: number, z: number): [number, number, number, number, number] {
  let best: [number, number, number, number, number] = [p[0], p[1], Math.hypot(p[0] - x, p[1] - z), 0, 0]
  for (let k = 2; k + 1 < p.length; k += 2) {
    const ax = p[k - 2], az = p[k - 1], bx = p[k], bz = p[k + 1]
    const L = (bx - ax) ** 2 + (bz - az) ** 2 || 1
    const t = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (z - az) * (bz - az)) / L))
    const qx = ax + t * (bx - ax), qz = az + t * (bz - az), d = Math.hypot(qx - x, qz - z)
    if (d < best[2]) best = [qx, qz, d, k, t]
  }
  return best
}

//! adds (x, z) as a control point on the segment ending at index k (no-op if it is already a point)
function insertAt(p: number[], k: number, x: number, z: number) {
  for (let i = 0; i < p.length; i += 2) if (p[i] === x && p[i + 1] === z) return
  p.splice(k, 0, x, z)
}

export interface WeldReport { tees: number; merged: number; crosses: number }

//! Welded junctions on a copy of the roads:
//! 1. two road ends closer than `snap` meet on one point (their middle);
//! 2. a road end closer than `snap` to another road lands on it: on its nearest control point when one is within
//!    `snap`, else on the nearest point of the line, which becomes a control point of that road (T split);
//! 3. `crossings`: two roads whose segments cross get the crossing point in both (X junction).
//! Road ends that already sit on a shared point are left alone. Deterministic (roads in order).
export function weldRoads(roads: Road[], opts: { snap: number; crossings?: boolean; report?: WeldReport }): Road[] {
  const out = roads.map((r) => ({ ...r, pts: r.pts.slice() }))
  const rep = opts.report ?? { tees: 0, merged: 0, crosses: 0 }
  const snap = opts.snap
  const shared = (x: number, z: number, self: number) =>
    out.some((o, oi) => oi !== self && o.pts.some((v, k) => k % 2 === 0 && v === x && o.pts[k + 1] === z))
  if (snap > 0) {
    // 1. ends close to ends
    const ends: [number, number][] = [] // [road, point index]
    out.forEach((r, ri) => { if (r.pts.length >= 4) ends.push([ri, 0], [ri, r.pts.length - 2]) })
    for (let i = 0; i < ends.length; i++)
      for (let j = i + 1; j < ends.length; j++) {
        const [ra, ia] = ends[i], [rb, ib] = ends[j]
        if (ra === rb) continue
        const A = out[ra].pts, B = out[rb].pts
        const d = Math.hypot(A[ia] - B[ib], A[ia + 1] - B[ib + 1])
        if (d === 0 || d >= snap) continue
        // keep a point already shared with a third road, else meet in the middle
        let x = (A[ia] + B[ib]) / 2, z = (A[ia + 1] + B[ib + 1]) / 2
        if (shared(A[ia], A[ia + 1], ra)) { x = A[ia]; z = A[ia + 1] } else if (shared(B[ib], B[ib + 1], rb)) { x = B[ib]; z = B[ib + 1] }
        const move = (P: number[], k: number) => {
          const ox = P[k], oz = P[k + 1]
          for (const o of out) for (let q = 0; q < o.pts.length; q += 2) if (o.pts[q] === ox && o.pts[q + 1] === oz) { o.pts[q] = x; o.pts[q + 1] = z }
        }
        move(A, ia); move(B, ib)
        rep.merged++
      }
    // 2. ends close to another road's line (T)
    out.forEach((r, ri) => {
      if (r.pts.length < 4) return
      for (const e of [0, r.pts.length - 2]) {
        const x = r.pts[e], z = r.pts[e + 1]
        if (shared(x, z, ri)) continue
        let best: { oi: number; c: [number, number, number, number, number] } | null = null
        out.forEach((o, oi) => {
          if (oi === ri || o.pts.length < 4) return
          const c = closest(o.pts, x, z)
          if (c[2] < snap && (!best || c[2] < best.c[2])) best = { oi, c }
        })
        if (!best) continue
        const { oi, c } = best as { oi: number; c: [number, number, number, number, number] }
        const o = out[oi].pts
        // an existing control point within snap is preferred (no new split)
        let px = c[0], pz = c[1], bv = snap
        for (let q = 0; q < o.length; q += 2) {
          const d = Math.hypot(o[q] - x, o[q + 1] - z)
          if (d < bv) { bv = d; px = o[q]; pz = o[q + 1] }
        }
        if (px === c[0] && pz === c[1] && c[3] > 0) insertAt(o, c[3], px, pz)
        r.pts[e] = px; r.pts[e + 1] = pz
        rep.tees++
      }
    })
  }
  // 3. X crossings
  if (opts.crossings)
    for (let i = 0; i < out.length; i++)
      for (let j = i + 1; j < out.length; j++) {
        const A = out[i].pts, B = out[j].pts
        for (let a = 2; a + 1 < A.length; a += 2)
          for (let b = 2; b + 1 < B.length; b += 2) {
            const p = segX(A[a - 2], A[a - 1], A[a], A[a + 1], B[b - 2], B[b - 1], B[b], B[b + 1])
            if (!p) continue
            const [x, z] = p
            // already a shared point nearby (a T made above, or a vertex of both): nothing to add
            const near = (P: number[]) => { for (let q = 0; q < P.length; q += 2) if (Math.hypot(P[q] - x, P[q + 1] - z) < 1) return [P[q], P[q + 1]]; return null }
            const na = near(A), nb = near(B)
            if (na && nb && na[0] === nb[0] && na[1] === nb[1]) continue
            const qx = na ? na[0] : nb ? nb[0] : x, qz = na ? na[1] : nb ? nb[1] : z
            if (!na) { A.splice(a, 0, qx, qz); a += 2 }
            else if (na[0] !== qx || na[1] !== qz) continue
            if (!nb) { B.splice(b, 0, qx, qz) }
            else if (nb[0] !== qx || nb[1] !== qz) continue
            rep.crosses++
          }
      }
  return out
}

//! proper crossing point of segments ab and cd (strictly inside both), or null
function segX(ax: number, az: number, bx: number, bz: number, cx: number, cz: number, dx: number, dz: number): [number, number] | null {
  const rx = bx - ax, rz = bz - az, sx = dx - cx, sz = dz - cz
  const den = rx * sz - rz * sx
  if (Math.abs(den) < 1e-9) return null
  const t = ((cx - ax) * sz - (cz - az) * sx) / den, u = ((cx - ax) * rz - (cz - az) * rx) / den
  if (t <= 1e-6 || t >= 1 - 1e-6 || u <= 1e-6 || u >= 1 - 1e-6) return null
  return [ax + t * rx, az + t * rz]
}

//! Collapses edges shorter than `dist` between two junctions (degree >= 3 both ends): one junction in their middle
//! instead of two staggered ones a few metres apart. Returns how many edges were collapsed.
export function mergeCloseNodes(g: RoadGraph, dist: number): number {
  let n = 0
  for (let again = true; again; ) {
    again = false
    const d = degrees(g)
    for (const e of g.edges) {
      if (e.a === e.b || e.pts.length) continue
      const A = g.nodes.get(e.a)!, B = g.nodes.get(e.b)!
      if (Math.hypot(A.x - B.x, A.z - B.z) >= dist || (d.get(A.id) ?? 0) < 3 || (d.get(B.id) ?? 0) < 3) continue
      A.x = (A.x + B.x) / 2; A.z = (A.z + B.z) / 2
      g.edges = g.edges.filter((o) => o !== e)
      for (const o of g.edges) { if (o.a === B.id) o.a = A.id; if (o.b === B.id) o.b = A.id }
      g.nodes.delete(B.id)
      // the removed edge's road keeps its other edges (graphToRoads joins by road id, ranks stay ordered)
      n++
      again = true
      break
    }
  }
  refreshKinds(g)
  return n
}

// --- stage 3: islands ---

export interface RoadIsland { roads: string[]; km: number; x: number; z: number }

//! connected components of the network (roads sharing a point belong to one island), biggest first
export function roadIslands(roads: Road[], snap = 0): RoadIsland[] {
  const src = snap > 0 ? weldRoads(roads, { snap }) : roads
  const parent = src.map((_, i) => i)
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])))
  const at = new Map<string, number>()
  src.forEach((r, i) => {
    for (let k = 0; k + 1 < r.pts.length; k += 2) {
      const kk = key(r.pts[k], r.pts[k + 1]), o = at.get(kk)
      if (o === undefined) at.set(kk, i)
      else parent[find(i)] = find(o)
    }
  })
  const groups = new Map<number, number[]>()
  src.forEach((_, i) => { const f = find(i); const l = groups.get(f); if (l) l.push(i); else groups.set(f, [i]) })
  const out: RoadIsland[] = []
  for (const list of groups.values()) {
    let m = 0, sx = 0, sz = 0, c = 0
    for (const i of list) {
      const p = src[i].pts
      for (let k = 2; k + 1 < p.length; k += 2) m += Math.hypot(p[k] - p[k - 2], p[k + 1] - p[k - 1])
      for (let k = 0; k + 1 < p.length; k += 2) { sx += p[k]; sz += p[k + 1]; c++ }
    }
    out.push({ roads: list.map((i) => src[i].id), km: m / 1000, x: c ? sx / c : 0, z: c ? sz / c : 0 })
  }
  return out.sort((a, b) => b.km - a.km || (a.roads[0] < b.roads[0] ? -1 : 1))
}

//! Auto-connect: joins every island to the main one (or to the nearest island already joined) by a new road
//! between their two closest control points, when they are less than `maxDist` apart. `route(a, b)` may replace
//! the straight link (e.g. the slope-aware router); it returns the polyline from a to b or null.
//! Returns the new roads (the input is not changed); they are welded at both ends (shared control points).
export function connectIslands(roads: Road[], opts: { maxDist: number; type: RoadType; route?: (a: [number, number], b: [number, number]) => number[] | null; idPrefix?: string }): Road[] {
  const isl = roadIslands(roads)
  if (isl.length < 2) return []
  const byId = new Map(roads.map((r) => [r.id, r]))
  const ptsOf = (ids: string[]) => ids.flatMap((id) => byId.get(id)!.pts)
  const joined = [ptsOf(isl[0].roads)]
  const made: Road[] = []
  const rest = isl.slice(1).map((i) => ptsOf(i.roads))
  while (rest.length) {
    let best: { k: number; a: [number, number]; b: [number, number]; d: number } | null = null
    rest.forEach((P, k) => {
      for (const J of joined)
        for (let i = 0; i < P.length; i += 2)
          for (let j = 0; j < J.length; j += 2) {
            const d = Math.hypot(P[i] - J[j], P[i + 1] - J[j + 1])
            if (d < opts.maxDist && (!best || d < best.d)) best = { k, a: [P[i], P[i + 1]], b: [J[j], J[j + 1]], d }
          }
    })
    if (!best) break
    const { k, a, b } = best as { k: number; a: [number, number]; b: [number, number]; d: number }
    let pts = opts.route?.(a, b) ?? [a[0], a[1], b[0], b[1]]
    if (pts.length < 4) pts = [a[0], a[1], b[0], b[1]]
    pts[0] = a[0]; pts[1] = a[1]; pts[pts.length - 2] = b[0]; pts[pts.length - 1] = b[1]
    made.push({ id: `${opts.idPrefix ?? 'ROAD_LINK'}_${made.length + 1}`, type: opts.type, pts, flatten: true, auto: true })
    joined.push(rest[k], pts)
    rest.splice(k, 1)
  }
  return made
}
