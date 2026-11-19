// "Économie Life": a calculation tool for RP / Life servers. Pure logic, no DOM.
// Reads the Life-Framework economy figures (data/life/economy.json, editable by the server owner),
// lists the production / processing / sell places of the generated world (zones tagged `rpRole`,
// field parcels), routes every chain over our road graph (Dijkstra, speed per road class and vehicle)
// and scores each chain: trip time, load, revenue per trip, profit per hour, balance flags.
// Optional (off by default) placement pass: choose which candidate building plays each chain's
// processing / sell point so trips land in a target band and profit/h is balanced across jobs.

// ---------- economy data ----------
export type RoadClass = 'main' | 'dirt' | 'trail' | 'offroad'
export type VehicleId = 'foot' | 'tractor' | 'truck' | 'car'
export interface Vehicle { label: string; capacity: number; speeds: Record<RoadClass, number> } // km/h
/** where a chain's raw material comes from: crop parcels ('field:<crop>') or places tagged with a role ('role:<rpRole>') */
export interface Chain {
  id: string
  label: string
  source: string
  /** seconds to gather one unit of raw material on site */
  harvestSecPerUnit: number
  rawItem: string
  /** processing step (null: sold raw) */
  process: { role: string; inPerOut: number; secPerOut: number; outItem: string } | null
  sellRole: string
  /** sell price per unit of the item that reaches the buyer */
  price: number
  /** cost per unit of raw material (seeds, licence, tool wear) */
  costPerRaw: number
  vehicle: VehicleId
  src?: string
}
export interface Economy { lfCommit: string; sources: string[]; vehicles: Record<VehicleId, Vehicle>; chains: Chain[]; band: { minMin: number; maxMin: number } }

export function roadClassOf(type: string): RoadClass {
  if (/^trail|concretePath/.test(type)) return 'trail'
  if (/^(dirt|forest|coal)/.test(type)) return 'dirt'
  return 'main'
}

// ---------- road graph ----------
export interface RoadLike { id: string; type: string; pts: number[] }
export interface Graph { x: number[]; z: number[]; adj: { to: number; len: number; cls: RoadClass }[][] }

/** nodes = road vertices merged on a `snap` m grid; road ends also link to the nearest vertex of another road within `join` m */
export function buildGraph(roads: RoadLike[], snap = 3, join = 20): Graph {
  const g: Graph = { x: [], z: [], adj: [] }
  const key = new Map<string, number>()
  const node = (x: number, z: number) => {
    const k = `${Math.round(x / snap)},${Math.round(z / snap)}`
    let i = key.get(k)
    if (i === undefined) { i = g.x.length; key.set(k, i); g.x.push(x); g.z.push(z); g.adj.push([]) }
    return i
  }
  const link = (a: number, b: number, cls: RoadClass) => {
    if (a === b) return
    const len = Math.hypot(g.x[a] - g.x[b], g.z[a] - g.z[b])
    g.adj[a].push({ to: b, len, cls }); g.adj[b].push({ to: a, len, cls })
  }
  const owner: number[] = []
  const ends: { n: number; r: number; cls: RoadClass }[] = []
  roads.forEach((r, ri) => {
    const cls = roadClassOf(r.type)
    let prev = -1
    for (let i = 0; i + 1 < r.pts.length; i += 2) {
      const n = node(r.pts[i], r.pts[i + 1])
      owner[n] ??= ri
      if (prev >= 0) link(prev, n, cls)
      if (i === 0 || i + 2 >= r.pts.length) ends.push({ n, r: ri, cls })
      prev = n
    }
  })
  for (const e of ends) {
    if (g.adj[e.n].length > 1) continue
    let best = -1, bd = join
    for (let j = 0; j < g.x.length; j++) {
      if (owner[j] === e.r) continue
      const d = Math.hypot(g.x[j] - g.x[e.n], g.z[j] - g.z[e.n])
      if (d < bd) { bd = d; best = j }
    }
    if (best >= 0) link(e.n, best, e.cls)
  }
  return g
}

export function nearestNode(g: Graph, x: number, z: number): number {
  let best = -1, bd = Infinity
  for (let i = 0; i < g.x.length; i++) { const d = (g.x[i] - x) ** 2 + (g.z[i] - z) ** 2; if (d < bd) { bd = d; best = i } }
  return best
}

const secOf = (len: number, kmh: number) => len / Math.max(0.5, kmh) * 3.6

/** Dijkstra in seconds from one node; returns times + predecessors */
export function dijkstra(g: Graph, from: number, v: Vehicle): { t: Float64Array; prev: Int32Array } {
  const n = g.x.length, t = new Float64Array(n).fill(Infinity), prev = new Int32Array(n).fill(-1)
  if (from < 0) return { t, prev }
  t[from] = 0
  const heap: [number, number][] = [[0, from]]
  const push = (e: [number, number]) => { heap.push(e); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p } }
  const pop = () => { const top = heap[0], last = heap.pop()!; if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m } } return top }
  while (heap.length) {
    const [d, u] = pop()
    if (d > t[u]) continue
    for (const e of g.adj[u]) {
      const nd = d + secOf(e.len, v.speeds[e.cls])
      if (nd < t[e.to]) { t[e.to] = nd; prev[e.to] = u; push([nd, e.to]) }
    }
  }
  return { t, prev }
}

export interface Leg { sec: number; m: number; path: number[] } // path: flat X/Z
/** travel between two points: off-road to the nearest node, over the graph, off-road again. Falls back to a straight off-road leg. */
export function route(g: Graph, ax: number, az: number, bx: number, bz: number, v: Vehicle, cache?: Map<number, ReturnType<typeof dijkstra>>): Leg {
  const direct = Math.hypot(bx - ax, bz - az)
  const straight: Leg = { sec: secOf(direct * 1.3, v.speeds.offroad), m: direct * 1.3, path: [ax, az, bx, bz] }
  if (!g.x.length) return straight
  const a = nearestNode(g, ax, az), b = nearestNode(g, bx, bz)
  let d = cache?.get(a)
  if (!d) { d = dijkstra(g, a, v); cache?.set(a, d) }
  if (!Number.isFinite(d.t[b])) return straight
  const nodes: number[] = []
  for (let u = b; u >= 0; u = d.prev[u]) nodes.push(u)
  nodes.reverse()
  let m = 0
  for (let i = 1; i < nodes.length; i++) m += Math.hypot(g.x[nodes[i]] - g.x[nodes[i - 1]], g.z[nodes[i]] - g.z[nodes[i - 1]])
  const offA = Math.hypot(g.x[a] - ax, g.z[a] - az), offB = Math.hypot(g.x[b] - bx, g.z[b] - bz)
  const sec = d.t[b] + secOf(offA + offB, v.speeds.offroad)
  const leg: Leg = { sec, m: m + offA + offB, path: [ax, az, ...nodes.flatMap((u) => [g.x[u], g.z[u]]), bx, bz] }
  return leg.sec < straight.sec ? leg : straight
}

// ---------- places of a world ----------
export interface Place { id: string; role: string; x: number; z: number; label?: string }
export interface WorldLike {
  roads: RoadLike[]
  zones: { id: string; kind?: string; sub?: string; x: number; z: number; rpRole?: string }[]
  sites?: { id: string; x: number; z: number; kind: string }[]
  fields?: number[][][]
  crops?: string[]
}
const centroid = (ring: number[][]) => { let x = 0, z = 0; for (const p of ring) { x += p[0]; z += p[1] } return [x / ring.length, z / ring.length] }

/** production places (field:<crop> per parcel + role:<rpRole>), processing / sell candidates (tagged zones) */
export function placesOf(w: WorldLike): Place[] {
  const out: Place[] = []
  ;(w.fields ?? []).forEach((f, i) => { const c = w.crops?.[i]; if (!c || !f.length) return; const [x, z] = centroid(f); out.push({ id: `FIELD_${i}`, role: `field:${c}`, x, z }) })
  for (const zn of w.zones) if (zn.rpRole) out.push({ id: zn.id, role: zn.rpRole, x: zn.x, z: zn.z, label: zn.sub })
  for (const s of w.sites ?? []) if (s.id.startsWith('FARM_')) out.push({ id: s.id, role: 'farm', x: s.x, z: s.z })
  return out
}
/** buildings the optimizer may re-use as a processing / sell point: every zone (tagged or not, vanilla industrial etc.) */
export function candidatesOf(w: WorldLike): Place[] {
  return w.zones.map((z) => ({ id: z.id, role: z.rpRole ?? `${z.kind ?? 'zone'}:${z.sub ?? ''}`, x: z.x, z: z.z, label: z.sub }))
}
const matches = (p: Place, src: string) => (src.startsWith('role:') ? p.role === src.slice(5) : src.startsWith('field:') ? p.role === src : p.role === src)

// ---------- chain economics ----------
export interface ChainMath { harvestSec: number; processSec: number; driveSec: number; load: number; revenue: number; cost: number }
/** one full trip: fill the vehicle on site, drive to the processor, process, drive to the buyer, drive back */
export function tripMath(c: Chain, v: Vehicle, driveSec: number): ChainMath & { tripSec: number; profit: number; perHour: number } {
  const raw = v.capacity
  const out = c.process ? Math.floor(raw / Math.max(1e-9, c.process.inPerOut)) : raw
  const harvestSec = raw * c.harvestSecPerUnit
  const processSec = c.process ? out * c.process.secPerOut : 0
  const revenue = out * c.price, cost = raw * c.costPerRaw
  const tripSec = harvestSec + processSec + driveSec
  const profit = revenue - cost
  return { harvestSec, processSec, driveSec, load: out, revenue, cost, tripSec, profit, perHour: tripSec > 0 ? profit / tripSec * 3600 : 0 }
}

export interface Assignment { proc?: string; sell?: string } // place ids forced per chain (optimizer)
export interface ChainRow extends ReturnType<typeof tripMath> {
  chain: Chain
  ok: boolean
  missing?: string
  from?: Place; proc?: Place; sell?: Place
  legs: Leg[]
  flag: 'ok' | 'rich' | 'useless' | 'short' | 'long' | 'missing'
}

export interface EvalCtx { g: Graph; places: Place[]; candidates: Place[]; caches: Map<VehicleId, Map<number, ReturnType<typeof dijkstra>>> }
export function makeCtx(w: WorldLike): EvalCtx {
  return { g: buildGraph(w.roads), places: placesOf(w), candidates: candidatesOf(w), caches: new Map() }
}
const nearestK = (ps: Place[], x: number, z: number, k: number) => [...ps].sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z)).slice(0, k)

function legsFor(ctx: EvalCtx, v: Vehicle, vid: VehicleId, from: Place, proc: Place | undefined, sell: Place): Leg[] {
  let cache = ctx.caches.get(vid); if (!cache) { cache = new Map(); ctx.caches.set(vid, cache) }
  const stops = proc ? [from, proc, sell, from] : [from, sell, from]
  const legs: Leg[] = []
  for (let i = 0; i + 1 < stops.length; i++) legs.push(route(ctx.g, stops[i].x, stops[i].z, stops[i + 1].x, stops[i + 1].z, v, cache))
  return legs
}

/** best route of one chain: over its production sites (5 nearest to the map's other points are enough), processors and buyers */
export function evalChain(ctx: EvalCtx, eco: Economy, c: Chain, asg: Assignment = {}): ChainRow {
  const v = eco.vehicles[c.vehicle]
  const byId = (id?: string) => (id ? ctx.candidates.find((p) => p.id === id) ?? ctx.places.find((p) => p.id === id) : undefined)
  const srcs = ctx.places.filter((p) => matches(p, c.source))
  const procs = c.process ? (asg.proc ? [byId(asg.proc)!].filter(Boolean) : ctx.places.filter((p) => p.role === c.process!.role)) : []
  const sells = asg.sell ? [byId(asg.sell)!].filter(Boolean) : ctx.places.filter((p) => p.role === c.sellRole)
  const missing = !srcs.length ? c.source : c.process && !procs.length ? c.process.role : !sells.length ? c.sellRole : undefined
  if (missing) return { chain: c, ok: false, missing, legs: [], flag: 'missing', ...tripMath(c, v, 0), perHour: 0 }
  let best: ChainRow | null = null
  const hub = procs[0] ?? sells[0]
  for (const from of srcs.length > 8 ? nearestK(srcs, hub.x, hub.z, 8) : srcs) {
    for (const proc of c.process ? nearestK(procs, from.x, from.z, 4) : [undefined]) {
      const at = proc ?? from
      for (const sell of nearestK(sells, at.x, at.z, 4)) {
        const legs = legsFor(ctx, v, c.vehicle, from, proc, sell)
        const m = tripMath(c, v, legs.reduce((s, l) => s + l.sec, 0))
        if (!best || m.perHour > best.perHour) best = { chain: c, ok: true, from, proc, sell, legs, flag: 'ok', ...m }
      }
    }
  }
  return best!
}

/** rich: > 2x the median profit/h; useless: < 0.35x or <= 0; short / long: trip outside the band */
export function flagRows(rows: ChainRow[], band: Economy['band']): ChainRow[] {
  const ok = rows.filter((r) => r.ok).map((r) => r.perHour).sort((a, b) => a - b)
  const med = ok.length ? ok[ok.length >> 1] : 0
  for (const r of rows) {
    if (!r.ok) { r.flag = 'missing'; continue }
    const min = r.tripSec / 60
    r.flag = r.perHour <= 0 || r.perHour < med * 0.35 ? 'useless' : r.perHour > med * 2 ? 'rich' : min < band.minMin ? 'short' : min > band.maxMin ? 'long' : 'ok'
  }
  return rows
}

export function evaluate(ctx: EvalCtx, eco: Economy, asg: Record<string, Assignment> = {}): ChainRow[] {
  return flagRows(eco.chains.map((c) => evalChain(ctx, eco, c, asg[c.id])), eco.band)
}

/** spread of profit/h (coefficient of variation of log profit) + trip band penalty: lower is better */
export function imbalance(rows: ChainRow[], band: Economy['band']): number {
  const ok = rows.filter((r) => r.ok && r.perHour > 0)
  if (!ok.length) return Infinity
  const l = ok.map((r) => Math.log(r.perHour)), mean = l.reduce((a, b) => a + b, 0) / l.length
  const sd = Math.sqrt(l.reduce((a, b) => a + (b - mean) ** 2, 0) / l.length)
  const bandPen = ok.reduce((s, r) => { const m = r.tripSec / 60; return s + (m < band.minMin ? (band.minMin - m) / band.minMin : m > band.maxMin ? (m - band.maxMin) / band.maxMin : 0) }, 0) / ok.length
  return sd + bandPen
}

/** placement pass. OFF: returns {} (nothing changes). ON: coordinate descent, each chain picks the processing / sell
 *  building among the candidates (any zone of the map) that lowers imbalance(); a few sweeps. */
export function optimize(ctx: EvalCtx, eco: Economy, on: boolean, sweeps = 3): Record<string, Assignment> {
  if (!on) return {}
  const asg: Record<string, Assignment> = {}
  let cur = imbalance(evaluate(ctx, eco, asg), eco.band)
  for (let s = 0; s < sweeps; s++) {
    let moved = false
    for (const c of eco.chains) {
      const base = evalChain(ctx, eco, c, asg[c.id])
      if (!base.ok) continue
      const at = base.from!
      const near = nearestK(ctx.candidates, at.x, at.z, 12)
      const opts: Assignment[] = []
      for (const sp of near) {
        if (c.process) for (const pp of nearestK(ctx.candidates, at.x, at.z, 6)) { if (pp.id !== sp.id) opts.push({ proc: pp.id, sell: sp.id }) }
        else opts.push({ sell: sp.id })
      }
      for (const o of opts) {
        const trial = { ...asg, [c.id]: o }
        const score = imbalance(evaluate(ctx, eco, trial), eco.band)
        if (score < cur - 1e-9) { cur = score; asg[c.id] = o; moved = true }
      }
    }
    if (!moved) break
  }
  return asg
}
