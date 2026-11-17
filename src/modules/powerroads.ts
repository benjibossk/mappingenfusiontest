// Power lines vs. the built world (powergrid.ts): road-following for the wooden-pole lines and clearance
// from houses for every line. Pure (no DOM).
//  - LV (WoodenSmall / LV_USSR_01) and the USSR wooden MV (HV_03_Wooden) run along the streets: routed on
//    the road graph (Dijkstra), offset beside the carriageway (road half width + POLE_GAP), always on the
//    side of the station they leave from; they leave the road only for the first / last drop.
//  - every pole: never on a carriageway, in a junction / roundabout / on a bridge (noPole discs), inside a
//    building footprint or a fenced plot; every span: never over a house (CLEAR per voltage).

export interface PowerRoad { pts: number[]; half: number }
export interface Disc { x: number; z: number; r: number }
export interface PowerWorld {
  roads: PowerRoad[]
  /** building footprints (4+ corner rings, flat X/Z) */
  buildings?: number[][]
  /** fenced plots (rings) */
  lots?: number[][]
  /** bridges, overpasses (no pole on them): discs along the deck */
  noPole?: Disc[]
}

/** metres between the carriageway edge and a road-following pole */
export const POLE_GAP = 4.5
/** clearance (m) of a span from any house, per voltage (HV / EHV: 30 m, MV 8 m, LV just not over it) */
export const CLEAR: Record<'ehv' | 'hv' | 'mv' | 'lv', number> = { ehv: 30, hv: 30, mv: 8, lv: 1 }

const B = 50 // bucket size (m)

type Ring = { pts: number[]; x0: number; z0: number; x1: number; z1: number }
function ring(pts: number[]): Ring {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity
  for (let i = 0; i + 1 < pts.length; i += 2) { x0 = Math.min(x0, pts[i]); x1 = Math.max(x1, pts[i]); z0 = Math.min(z0, pts[i + 1]); z1 = Math.max(z1, pts[i + 1]) }
  return { pts, x0, z0, x1, z1 }
}

class Buckets<T> {
  m = new Map<number, T[]>()
  add(x0: number, z0: number, x1: number, z1: number, v: T) {
    for (let a = Math.floor(x0 / B); a <= Math.floor(x1 / B); a++) for (let b = Math.floor(z0 / B); b <= Math.floor(z1 / B); b++) {
      const k = a * 100003 + b
      let l = this.m.get(k); if (!l) this.m.set(k, (l = [])); l.push(v)
    }
  }
  near(x0: number, z0: number, x1: number, z1: number): Set<T> {
    const out = new Set<T>()
    for (let a = Math.floor(x0 / B); a <= Math.floor(x1 / B); a++) for (let b = Math.floor(z0 / B); b <= Math.floor(z1 / B); b++) {
      const l = this.m.get(a * 100003 + b); if (l) for (const v of l) out.add(v)
    }
    return out
  }
}

export function inRing(x: number, z: number, p: number[]): boolean {
  let inside = false
  for (let i = 0, j = p.length - 2; i + 1 < p.length; j = i, i += 2) {
    const xi = p[i], zi = p[i + 1], xj = p[j], zj = p[j + 1]
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside
  }
  return inside
}
export function segDist(px: number, pz: number, ax: number, az: number, bx: number, bz: number) {
  const dx = bx - ax, dz = bz - az, l = dx * dx + dz * dz
  const t = l ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l)) : 0
  return Math.hypot(px - ax - t * dx, pz - az - t * dz)
}
function cross(ax: number, az: number, bx: number, bz: number, cx: number, cz: number, dx: number, dz: number) {
  const o = (px: number, pz: number, qx: number, qz: number, rx: number, rz: number) => (qx - px) * (rz - pz) - (qz - pz) * (rx - px)
  return o(ax, az, bx, bz, cx, cz) * o(ax, az, bx, bz, dx, dz) < 0 && o(cx, cz, dx, dz, ax, az) * o(cx, cz, dx, dz, bx, bz) < 0
}
/** distance from segment a-b to a ring (0 = crosses or inside) */
export function segRingDist(ax: number, az: number, bx: number, bz: number, p: number[]) {
  if (inRing(ax, az, p) || inRing(bx, bz, p)) return 0
  let d = Infinity
  for (let i = 0, j = p.length - 2; i + 1 < p.length; j = i, i += 2) {
    if (cross(ax, az, bx, bz, p[j], p[j + 1], p[i], p[i + 1])) return 0
    d = Math.min(d, segDist(p[i], p[i + 1], ax, az, bx, bz), segDist(ax, az, p[j], p[j + 1], p[i], p[i + 1]), segDist(bx, bz, p[j], p[j + 1], p[i], p[i + 1]))
  }
  return d
}

interface Node { x: number; z: number; half: number; adj: number[] }

export class PowerObstacles {
  private bld = new Buckets<Ring>()
  private lot = new Buckets<Ring>()
  private seg = new Buckets<number>() // road segment index
  private segs: number[] = [] // ax az bx bz half
  readonly noPole: Disc[]
  private nodes: Node[] | null = null
  private nodeIdx = new Buckets<number>()
  readonly world: PowerWorld
  constructor(w: PowerWorld) {
    this.world = w
    for (const b of w.buildings ?? []) if (b.length >= 6) { const r = ring(b); this.bld.add(r.x0, r.z0, r.x1, r.z1, r) }
    for (const b of w.lots ?? []) if (b.length >= 6) { const r = ring(b); this.lot.add(r.x0, r.z0, r.x1, r.z1, r) }
    for (const rd of w.roads) for (let i = 0; i + 3 < rd.pts.length; i += 2) {
      const k = this.segs.length / 5
      this.segs.push(rd.pts[i], rd.pts[i + 1], rd.pts[i + 2], rd.pts[i + 3], rd.half)
      this.seg.add(Math.min(rd.pts[i], rd.pts[i + 2]) - 20, Math.min(rd.pts[i + 1], rd.pts[i + 3]) - 20, Math.max(rd.pts[i], rd.pts[i + 2]) + 20, Math.max(rd.pts[i + 1], rd.pts[i + 3]) + 20, k)
    }
    this.noPole = [...(w.noPole ?? []), ...this.junctions()]
  }
  get hasBuildings() { return (this.world.buildings?.length ?? 0) > 0 }
  /** distance to the nearest carriageway edge (negative = on the road), capped at 20 m */
  roadEdge(x: number, z: number): number {
    let d = 20
    for (const k of this.seg.near(x, z, x, z)) {
      const o = k * 5
      d = Math.min(d, segDist(x, z, this.segs[o], this.segs[o + 1], this.segs[o + 2], this.segs[o + 3]) - this.segs[o + 4])
    }
    return d
  }
  /** distance to the nearest building footprint (0 inside), capped at `cap` */
  bldDist(x: number, z: number, cap = 40): number {
    let d = cap
    for (const r of this.bld.near(x - cap, z - cap, x + cap, z + cap)) {
      if (x < r.x0 - d || x > r.x1 + d || z < r.z0 - d || z > r.z1 + d) continue
      d = Math.min(d, segRingDist(x, z, x, z, r.pts))
      if (d === 0) return 0
    }
    return d
  }
  inLot(x: number, z: number) {
    for (const r of this.lot.near(x, z, x, z)) if (x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1 && inRing(x, z, r.pts)) return true
    return false
  }
  /** shortest distance from span a-b to a house (capped at `cap`) */
  spanBld(ax: number, az: number, bx: number, bz: number, cap = 40): number {
    let d = cap
    for (const r of this.bld.near(Math.min(ax, bx) - cap, Math.min(az, bz) - cap, Math.max(ax, bx) + cap, Math.max(az, bz) + cap)) {
      if (Math.max(ax, bx) < r.x0 - d || Math.min(ax, bx) > r.x1 + d || Math.max(az, bz) < r.z0 - d || Math.min(az, bz) > r.z1 + d) continue
      d = Math.min(d, segRingDist(ax, az, bx, bz, r.pts))
      if (d === 0) return 0
    }
    return d
  }
  /** a pole may stand here */
  poleOk(x: number, z: number): boolean {
    if (this.roadEdge(x, z) < 1.5) return false
    for (const q of this.noPole) if (Math.hypot(x - q.x, z - q.z) < q.r) return false
    if (this.bldDist(x, z, 2) < 1.5) return false
    return !this.inLot(x, z)
  }

  // --- road graph ---
  private graph(): Node[] {
    if (this.nodes) return this.nodes
    const nodes: Node[] = []
    const hash = new Map<number, number[]>()
    const key = (x: number, z: number) => Math.floor(x / 4) * 100003 + Math.floor(z / 4)
    const nodeAt = (x: number, z: number, half: number) => {
      const cx = Math.floor(x / 4), cz = Math.floor(z / 4)
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const i of hash.get((cx + a) * 100003 + cz + b) ?? []) {
        if (Math.hypot(nodes[i].x - x, nodes[i].z - z) < 3) { nodes[i].half = Math.max(nodes[i].half, half); return i }
      }
      const i = nodes.length
      nodes.push({ x, z, half, adj: [] })
      const k = key(x, z); let l = hash.get(k); if (!l) hash.set(k, (l = [])); l.push(i)
      return i
    }
    const link = (a: number, b: number) => { if (a !== b && !nodes[a].adj.includes(b)) { nodes[a].adj.push(b); nodes[b].adj.push(a) } }
    const ends: { i: number; road: number }[] = [], roadOf: number[] = []
    this.world.roads.forEach((rd, ri) => {
      let prev = -1
      for (let i = 0; i + 1 < rd.pts.length; i += 2) {
        const x = rd.pts[i], z = rd.pts[i + 1]
        if (prev >= 0) { // densify to <= 15 m
          const px = nodes[prev].x, pz = nodes[prev].z, n = Math.ceil(Math.hypot(x - px, z - pz) / 15)
          for (let k = 1; k < n; k++) { const j = nodeAt(px + ((x - px) * k) / n, pz + ((z - pz) * k) / n, rd.half); roadOf[j] ??= ri; link(prev, j); prev = j }
        }
        const j = nodeAt(x, z, rd.half); roadOf[j] ??= ri
        if (prev >= 0) link(prev, j)
        if (i === 0 || i + 2 >= rd.pts.length) ends.push({ i: j, road: ri })
        prev = j
      }
    })
    nodes.forEach((n, i) => this.nodeIdx.add(n.x, n.z, n.x, n.z, i))
    this.nodes = nodes
    // T-junctions: a road end close to another road's node
    for (const e of ends) {
      const n = nodes[e.i]
      if (n.adj.length !== 1) continue
      let bj = -1, bd = n.half + 8
      for (const j of this.nodeIdx.near(n.x - 20, n.z - 20, n.x + 20, n.z + 20)) {
        if (j === e.i || roadOf[j] === e.road || n.adj.includes(j)) continue
        const d = Math.hypot(nodes[j].x - n.x, nodes[j].z - n.z)
        if (d < bd) { bd = d; bj = j }
      }
      if (bj >= 0) link(e.i, bj)
    }
    return nodes
  }
  /** junction (3+ branches) and roundabout discs */
  private junctions(): Disc[] {
    const nodes = this.graph(), out: Disc[] = []
    for (const n of nodes) if (n.adj.length >= 3) out.push({ x: n.x, z: n.z, r: n.half * 2 + 6 })
    for (const rd of this.world.roads) {
      const p = rd.pts, L = p.length
      if (L < 8 || Math.hypot(p[0] - p[L - 2], p[1] - p[L - 1]) > 3) continue
      let cx = 0, cz = 0
      for (let i = 0; i + 1 < L; i += 2) { cx += p[i]; cz += p[i + 1] }
      cx /= L / 2; cz /= L / 2
      let r = 0
      for (let i = 0; i + 1 < L; i += 2) r = Math.max(r, Math.hypot(p[i] - cx, p[i + 1] - cz))
      if (r < 60) out.push({ x: cx, z: cz, r: r + rd.half + 6 })
    }
    return out
  }
  private nearestNode(x: number, z: number, rMax: number): number {
    const nodes = this.graph()
    let bi = -1, bd = rMax
    for (let R = 50; R <= rMax + 50 && bi < 0; R *= 2) {
      for (const i of this.nodeIdx.near(x - R, z - R, x + R, z + R)) { const d = Math.hypot(nodes[i].x - x, nodes[i].z - z); if (d < bd) { bd = d; bi = i } }
    }
    return bi
  }
  /** road centre line from near a to near b (node list), null when no road connects them sensibly */
  roadPath(ax: number, az: number, bx: number, bz: number, reach = 150, reachB = 300): Node[] | null {
    const nodes = this.graph()
    const s = this.nearestNode(ax, az, reach), t = this.nearestNode(bx, bz, reachB)
    if (s < 0 || t < 0) return null
    if (s === t) return [nodes[s]]
    const straight = Math.hypot(nodes[t].x - nodes[s].x, nodes[t].z - nodes[s].z)
    const limit = straight * 2.5 + 400
    const dist = new Map<number, number>([[s, 0]]), from = new Map<number, number>()
    const heap: [number, number][] = [[0, s]]
    const push = (e: [number, number]) => { heap.push(e); let k = heap.length - 1; while (k > 0) { const p = (k - 1) >> 1; if (heap[p][0] <= heap[k][0]) break;[heap[p], heap[k]] = [heap[k], heap[p]]; k = p } }
    const pop = () => { const top = heap[0], last = heap.pop()!; if (heap.length) { heap[0] = last; let k = 0; for (;;) { const a = 2 * k + 1, b = a + 1; let m = k; if (a < heap.length && heap[a][0] < heap[m][0]) m = a; if (b < heap.length && heap[b][0] < heap[m][0]) m = b; if (m === k) break;[heap[m], heap[k]] = [heap[k], heap[m]]; k = m } } return top }
    const tx = nodes[t].x, tz = nodes[t].z
    while (heap.length) {
      const [f, i] = pop()
      const gi = dist.get(i)!
      if (f > gi + Math.hypot(nodes[i].x - tx, nodes[i].z - tz) + 1e-6) continue
      if (i === t) break
      if (gi > limit) return null
      for (const j of nodes[i].adj) {
        const ng = gi + Math.hypot(nodes[j].x - nodes[i].x, nodes[j].z - nodes[i].z)
        if (ng < (dist.get(j) ?? Infinity)) { dist.set(j, ng); from.set(j, i); push([ng + Math.hypot(nodes[j].x - tx, nodes[j].z - tz), j]) }
      }
    }
    if (!from.has(t)) return null
    const out: Node[] = []
    for (let i: number | undefined = t; i !== undefined; i = from.get(i)) out.push(nodes[i])
    return out.reverse()
  }
}

/** Wooden-pole line along the roads from a to b. Poles every <= spacing m beside the carriageway (station
 *  side), following the curves; a -> first pole and last pole -> b are the drops. Null = no road route. */
export function followRoads(ob: PowerObstacles, ax: number, az: number, bx: number, bz: number, spacing: number, endOnRoad: boolean): number[] | null {
  const P = ob.roadPath(ax, az, bx, bz)
  if (!P || P.length < 2) return null
  // dense centre-line samples (<= 5 m) with their left normal and road half width
  const C: number[] = [] // x z nx nz half
  for (let i = 0; i + 1 < P.length; i++) {
    const p = P[i], q = P[i + 1], L = Math.hypot(q.x - p.x, q.z - p.z) || 1
    const nx = -(q.z - p.z) / L, nz = (q.x - p.x) / L
    const n = Math.max(1, Math.ceil(L / 5))
    for (let k = i ? 1 : 0; k <= n; k++) C.push(p.x + ((q.x - p.x) * k) / n, p.z + ((q.z - p.z) * k) / n, nx, nz, Math.max(p.half, q.half))
  }
  // the station side of the road; beside a house the pole moves onto the verge, and as a last resort to
  // the other side
  const s0 = (ax - C[0]) * C[2] + (az - C[1]) * C[3] >= 0 ? 1 : -1
  const D: number[] = [], bad: boolean[] = []
  for (let i = 0; i < C.length; i += 5) {
    let px = NaN, pz = NaN
    for (const [sd, gap] of [[s0, POLE_GAP], [s0, 3], [s0, 2], [-s0, POLE_GAP], [-s0, 3]]) {
      const x = C[i] + C[i + 2] * (C[i + 4] + gap) * sd, z = C[i + 1] + C[i + 3] * (C[i + 4] + gap) * sd
      if (ob.poleOk(x, z)) { px = x; pz = z; break }
    }
    bad.push(Number.isNaN(px))
    if (Number.isNaN(px)) { px = C[i] + C[i + 2] * (C[i + 4] + POLE_GAP) * s0; pz = C[i + 1] + C[i + 3] * (C[i + 4] + POLE_GAP) * s0 }
    D.push(px, pz)
  }
  const m = D.length / 2
  const spanOk = (i: number, j: number) => {
    if (bad[j]) return false
    const x0 = D[i * 2], z0 = D[i * 2 + 1], x1 = D[j * 2], z1 = D[j * 2 + 1]
    if (Math.hypot(x1 - x0, z1 - z0) > spacing) return false
    for (let k = i + 1; k < j; k++) if (segDist(D[k * 2], D[k * 2 + 1], x0, z0, x1, z1) > 3) return false // follows the curve
    return ob.spanBld(x0, z0, x1, z1, 2) > 0.5
  }
  // first pole: nearest valid sample to the start
  // first pole: the nearest valid sample whose drop from a clears the houses
  let i0 = -1, best = Infinity
  for (let k = 0; k < Math.min(m - 1, 40); k++) {
    if (bad[k]) continue
    const d = Math.hypot(D[k * 2] - ax, D[k * 2 + 1] - az) + (ob.spanBld(ax, az, D[k * 2], D[k * 2 + 1], 2) > 0.5 ? 0 : 1000)
    if (d < best) { best = d; i0 = k }
  }
  if (i0 < 0) i0 = 0
  const poles: number[] = [ax, az, D[i0 * 2], D[i0 * 2 + 1]]
  let i = i0
  while (i < m - 1) {
    let j = i + 1
    while (j + 1 < m && Math.hypot(D[(j + 1) * 2] - D[i * 2], D[(j + 1) * 2 + 1] - D[i * 2 + 1]) <= spacing) j++
    // farthest valid pole within the spacing (even a short span), else the next valid one a bit farther
    let k = j
    while (k > i && !spanOk(i, k)) k--
    if (k > i) j = k
    else {
      let f = j + 1
      while (f < m - 1 && bad[f]) f++
      if (Math.hypot(D[f * 2] - D[i * 2], D[f * 2 + 1] - D[i * 2 + 1]) <= spacing * 1.4) j = f
    }
    poles.push(D[j * 2], D[j * 2 + 1])
    i = j
  }
  if (!endOnRoad) poles.push(bx, bz)
  return poles
}

/** Every pole of a line valid (poleOk): invalid interior poles slide along their spans (+-3..15 m). */
export function fixPoles(ob: PowerObstacles, poles: number[]): number[] {
  const p = poles.slice()
  for (let i = 2; i + 3 < p.length; i += 2) {
    if (ob.poleOk(p[i], p[i + 1])) continue
    const ax = p[i - 2], az = p[i - 1], bx = p[i + 2], bz = p[i + 3]
    const ux = bx - ax, uz = bz - az, L = Math.hypot(ux, uz) || 1, tx = ux / L, tz = uz / L
    // along the span first (keeps it straight), then sideways (off a carriageway / out of a yard)
    const cur = Math.min(0.3, ob.spanBld(ax, az, p[i], p[i + 1], 1), ob.spanBld(p[i], p[i + 1], bx, bz, 1))
    const tries: [number, number][] = []
    for (let s = 3; s <= 15; s += 3) tries.push([s, 0], [-s, 0])
    for (let q = 3; q <= 12; q += 3) for (const s of [0, 4, -4, 8, -8]) tries.push([s, q], [s, -q])
    for (const [s, q] of tries) {
      const x = p[i] + tx * s - tz * q, z = p[i + 1] + tz * s + tx * q
      if (ob.poleOk(x, z) && Math.min(ob.spanBld(ax, az, x, z, 1), ob.spanBld(x, z, bx, bz, 1)) >= cur) { p[i] = x; p[i + 1] = z; break }
    }
  }
  return p
}

/** Spans over a house get a detour: one extra pole beside the span (or a moved interior pole) so both
 *  new spans clear it. Two passes; what cannot be fixed is left for the validator. */
export function clearSpans(ob: PowerObstacles, poles: number[], spacing: number): number[] {
  const p = poles.slice()
  for (let pass = 0; pass < 2; pass++) for (let i = 0; i + 3 < p.length; i += 2) {
    const ax = p[i], az = p[i + 1], bx = p[i + 2], bz = p[i + 3]
    if (ob.spanBld(ax, az, bx, bz, 1) > 0) continue
    const L = Math.hypot(bx - ax, bz - az) || 1, tx = (bx - ax) / L, tz = (bz - az) / L
    let done = false
    // 1. move the far pole (interior only) sideways
    if (i + 4 < p.length) for (let q = 4; q <= 24 && !done; q += 4) for (const sg of [1, -1]) {
      const x = bx - tz * q * sg, z = bz + tx * q * sg
      if (ob.poleOk(x, z) && ob.spanBld(ax, az, x, z, 1) > 0 && ob.spanBld(x, z, p[i + 4], p[i + 5], 1) > 0 && Math.hypot(x - ax, z - az) <= spacing * 1.05) { p[i + 2] = x; p[i + 3] = z; done = true; break }
    }
    // 2. an extra pole beside the middle of the span
    for (let q = 6; q <= 30 && !done; q += 4) for (const f of [0.5, 0.35, 0.65]) for (const sg of [1, -1]) {
      const x = ax + (bx - ax) * f - tz * q * sg, z = az + (bz - az) * f + tx * q * sg
      if (ob.poleOk(x, z) && ob.spanBld(ax, az, x, z, 1) > 0 && ob.spanBld(x, z, bx, bz, 1) > 0) { p.splice(i + 2, 0, x, z); done = true; break }
      if (done) break
    }
  }
  return p
}
