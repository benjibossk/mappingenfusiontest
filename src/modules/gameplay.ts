// Gameplay metrics on a land raster (GAMEPLAY_MAPPING.md, PakTools/analyses): how much of the map an infantryman
// crosses in the open, how much cover the approaches to a settlement give, how much ground the high points see.
// Pure functions, same code for the vanilla refmaps and our worlds (scripts/bench/gameplay.ts, app Gameplay panel, worldgen gameplayCover.ts).

export interface Raster { step: number; cols: number; rows: number; minX: number; minZ: number }
/** land: 1 = dry land; cover: 1 = forest / built-up cell (hard cover + concealment for infantry) */
export interface CoverMap extends Raster { land: Uint8Array; cover: Uint8Array }

const q = (a: ArrayLike<number>, f: number) => { const s = Array.from(a).sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(f * s.length))] : NaN }

/** scanline fill of a closed polygon [x0,z0,x1,z1,...] into a raster (value v), cell centres */
export function fillPolygon(r: Raster, out: Uint8Array, pts: number[], v = 1): void {
  const n = pts.length / 2; if (n < 3) return
  let z0 = Infinity, z1 = -Infinity
  for (let i = 1; i < pts.length; i += 2) { z0 = Math.min(z0, pts[i]); z1 = Math.max(z1, pts[i]) }
  const r0 = Math.max(0, Math.ceil((z0 - r.minZ) / r.step - 0.5)), r1 = Math.min(r.rows - 1, Math.floor((z1 - r.minZ) / r.step - 0.5))
  const xs: number[] = []
  for (let row = r0; row <= r1; row++) {
    const z = r.minZ + (row + 0.5) * r.step; xs.length = 0
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const zi = pts[2 * i + 1], zj = pts[2 * j + 1]
      if ((zi > z) !== (zj > z)) xs.push(pts[2 * i] + (z - zi) / (zj - zi) * (pts[2 * j] - pts[2 * i]))
    }
    xs.sort((a, b) => a - b)
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const c0 = Math.max(0, Math.ceil((xs[k] - r.minX) / r.step - 0.5)), c1 = Math.min(r.cols - 1, Math.floor((xs[k + 1] - r.minX) / r.step - 0.5))
      for (let c = c0; c <= c1; c++) out[row * r.cols + c] = v
    }
  }
}

/** marks the cells within `rad` metres of each point (buildings: a house is cover for its own yard) */
export function stampPoints(r: Raster, out: Uint8Array, pts: { x: number; z: number }[], rad: number): void {
  const k = Math.ceil(rad / r.step)
  for (const p of pts) {
    const cc = Math.floor((p.x - r.minX) / r.step), cr = Math.floor((p.z - r.minZ) / r.step)
    for (let dr = -k; dr <= k; dr++) for (let dc = -k; dc <= k; dc++) {
      const c = cc + dc, w = cr + dr
      if (c < 0 || w < 0 || c >= r.cols || w >= r.rows || Math.hypot(dc, dr) * r.step > rad + r.step / 2) continue
      out[w * r.cols + c] = 1
    }
  }
}

/** chamfer (3-4) distance in metres from every cell to the nearest cover cell; sea counts as nothing (no cover) */
export function distanceToCover(m: CoverMap): Float32Array {
  const { cols, rows, step } = m, d = new Float32Array(cols * rows).fill(1e9), a = step, b = step * Math.SQRT2
  for (let i = 0; i < d.length; i++) if (m.cover[i]) d[i] = 0
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const i = r * cols + c; let v = d[i]
    if (c > 0) v = Math.min(v, d[i - 1] + a)
    if (r > 0) { v = Math.min(v, d[i - cols] + a); if (c > 0) v = Math.min(v, d[i - cols - 1] + b); if (c < cols - 1) v = Math.min(v, d[i - cols + 1] + b) }
    d[i] = v
  }
  for (let r = rows - 1; r >= 0; r--) for (let c = cols - 1; c >= 0; c--) {
    const i = r * cols + c; let v = d[i]
    if (c < cols - 1) v = Math.min(v, d[i + 1] + a)
    if (r < rows - 1) { v = Math.min(v, d[i + cols] + a); if (c < cols - 1) v = Math.min(v, d[i + cols + 1] + b); if (c > 0) v = Math.min(v, d[i + cols - 1] + b) }
    d[i] = v
  }
  return d
}

/** M1 open ground: share of land with no cover, and how far a man in the open is from the nearest cover
 *  (p50 / p90 / max in metres; 2 x max ~ the longest unavoidable open crossing) */
export function openGround(m: CoverMap) {
  const d = distanceToCover(m), open: number[] = []
  let land = 0
  for (let i = 0; i < d.length; i++) if (m.land[i]) { land++; if (!m.cover[i]) open.push(d[i]) }
  const far = (t: number) => +(100 * open.filter((v) => v > t).length / Math.max(1, land)).toFixed(1)
  return {
    openPct: +(100 * open.length / Math.max(1, land)).toFixed(1),
    toCoverM: { p50: Math.round(q(open, 0.5)), p90: Math.round(q(open, 0.9)), max: Math.round(q(open, 1)) },
    /** land share farther than 150 / 300 m from any cover: killing ground for infantry, tank country */
    beyond150Pct: far(150), beyond300Pct: far(300),
  }
}

/** M2 approach cover: cover share in the ring [r0, r1] around each objective (settlement) */
export function approachCover(m: CoverMap, objs: { x: number; z: number }[], r0 = 150, r1 = 450) {
  const k = Math.ceil(r1 / m.step), per: number[] = []
  for (const o of objs) {
    const cc = Math.floor((o.x - m.minX) / m.step), cr = Math.floor((o.z - m.minZ) / m.step)
    let n = 0, cv = 0
    for (let dr = -k; dr <= k; dr++) for (let dc = -k; dc <= k; dc++) {
      const c = cc + dc, r = cr + dr, dist = Math.hypot(dc, dr) * m.step
      if (c < 0 || r < 0 || c >= m.cols || r >= m.rows || dist < r0 || dist > r1) continue
      const i = r * m.cols + c; if (!m.land[i]) continue
      n++; if (m.cover[i]) cv++
    }
    if (n > 20) per.push(100 * cv / n)
  }
  return { n: per.length, pct: { p10: +q(per, 0.1).toFixed(1), med: +q(per, 0.5).toFixed(1), p90: +q(per, 0.9).toFixed(1) },
    /** objectives whose approaches are nearly bare (< 10 % cover): only an armoured assault crosses them */
    barePct: +(100 * per.filter((v) => v < 10).length / Math.max(1, per.length)).toFixed(1) }
}

/** M3 viewshed from the summits: `peaks` highest local maxima at least `sep` m apart, line of sight on the
 *  height grid (eye / target 1.8 m, trees ignored = bare-earth worst case) within `range` m.
 *  visiblePct = mean share of the land disc each summit sees; deadPct = land of the discs seen by no summit. */
export function summitViewshed(h: ArrayLike<number>, m: CoverMap, opt: { peaks?: number; sep?: number; range?: number; stride?: number } = {}) {
  const P = opt.peaks ?? 12, sep = opt.sep ?? 1500, range = opt.range ?? 2000, s = opt.stride ?? Math.max(1, Math.round(40 / m.step))
  const { cols, rows, step } = m, H = (c: number, r: number) => h[r * cols + c]
  const order: number[] = []
  for (let i = 0; i < cols * rows; i += 1) if (m.land[i]) order.push(i)
  order.sort((a, b) => h[b] - h[a])
  const peaks: number[] = []
  for (const i of order) {
    if (peaks.length >= P) break
    const c = i % cols, r = (i / cols) | 0
    if (peaks.every((j) => Math.hypot((j % cols) - c, ((j / cols) | 0) - r) * step >= sep)) peaks.push(i)
  }
  const k = Math.floor(range / step / s) * s, seen = new Uint8Array(cols * rows), inDisc = new Uint8Array(cols * rows), vis: number[] = []
  for (const p of peaks) {
    const pc = p % cols, pr = (p / cols) | 0, eye = H(pc, pr) + 1.8
    let n = 0, v = 0
    for (let dr = -k; dr <= k; dr += s) for (let dc = -k; dc <= k; dc += s) {
      const c = pc + dc, r = pr + dr, L = Math.hypot(dc, dr)
      if (c < 0 || r < 0 || c >= cols || r >= rows || L * step > range || L === 0) continue
      const i = r * cols + c; if (!m.land[i]) continue
      n++; inDisc[i] = 1
      const tgt = H(c, r) + 1.8, steps = Math.ceil(L)
      let ok = true
      for (let t = 1; t < steps; t++) {
        const f = t / steps, x = pc + dc * f, y = pr + dr * f
        if (H(Math.round(x), Math.round(y)) > eye + (tgt - eye) * f) { ok = false; break }
      }
      if (ok) { v++; seen[i] = 1 }
    }
    if (n) vis.push(100 * v / n)
  }
  let disc = 0, dead = 0
  for (let i = 0; i < seen.length; i++) if (inDisc[i]) { disc++; if (!seen[i]) dead++ }
  return { peaks: peaks.length, peakHeights: peaks.map((i) => Math.round(h[i])), visiblePct: +(vis.reduce((a, b) => a + b, 0) / Math.max(1, vis.length)).toFixed(1),
    deadPct: +(100 * dead / Math.max(1, disc)).toFixed(1) }
}

// ---- cover map from a world, settlements -----------------------------------------------------------------
const NOT_BUILDING = /Grave|Calvary|Castle|Fence|Wall|Monument|Statue|Ruin/i
export { NOT_BUILDING as GAMEPLAY_NOT_BUILDING }
/** m: a house covers its yard (walls, sheds, hedges around it) */
export const HOUSE_COVER = 12

/** settlements = single-link clusters (45 m) of >= `min` buildings, centroid + count */
export function settlementClusters(pts: { x: number; z: number }[], link = 45, min = 8) {
  const cell = new Map<string, number[]>(), key = (x: number, z: number) => `${Math.floor(x / link)},${Math.floor(z / link)}`
  pts.forEach((p, i) => { const k = key(p.x, p.z); (cell.get(k) ?? cell.set(k, []).get(k)!).push(i) })
  const lab = new Uint8Array(pts.length), out: { x: number; z: number; n: number }[] = []
  for (let i = 0; i < pts.length; i++) {
    if (lab[i]) continue
    const c = [i]; lab[i] = 1
    for (let t = 0; t < c.length; t++) {
      const p = pts[c[t]], cx = Math.floor(p.x / link), cz = Math.floor(p.z / link)
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) for (const j of cell.get(`${cx + dx},${cz + dz}`) ?? [])
        if (!lab[j] && Math.hypot(pts[j].x - p.x, pts[j].z - p.z) < link) { lab[j] = 1; c.push(j) }
    }
    if (c.length >= min) out.push({ x: c.reduce((a, j) => a + pts[j].x, 0) / c.length, z: c.reduce((a, j) => a + pts[j].z, 0) / c.length, n: c.length })
  }
  return out
}

export interface GameplayInput {
  heights: ArrayLike<number>; grid: Raster
  forests: { pts: number[]; holes?: number[][] }[]; houses: { x: number; z: number }[]
}
export function coverMap(inp: GameplayInput): CoverMap {
  const { grid } = inp, n = grid.cols * grid.rows, land = new Uint8Array(n), cover = new Uint8Array(n)
  for (let i = 0; i < n; i++) land[i] = inp.heights[i] > 0 ? 1 : 0
  for (const f of inp.forests) { fillPolygon(grid, cover, f.pts, 1); for (const hole of f.holes ?? []) fillPolygon(grid, cover, hole, 0) }
  stampPoints(grid, cover, inp.houses, HOUSE_COVER)
  for (let i = 0; i < n; i++) if (!land[i]) cover[i] = 0
  return { step: grid.step, cols: grid.cols, rows: grid.rows, minX: grid.minX, minZ: grid.minZ, land, cover }
}

/** coarser copy (max of cover, any land) so the 8 m vanilla grid and a 2 m world grid cost the same */
export function coarsen(inp: GameplayInput, step: number): GameplayInput {
  const g = inp.grid, f = Math.max(1, Math.round(step / g.step))
  if (f === 1) return inp
  const cols = Math.ceil(g.cols / f), rows = Math.ceil(g.rows / f), h = new Float32Array(cols * rows)
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) h[r * cols + c] = inp.heights[Math.min(g.rows - 1, r * f) * g.cols + Math.min(g.cols - 1, c * f)]
  return { ...inp, heights: h, grid: { step: g.step * f, cols, rows, minX: g.minX, minZ: g.minZ } }
}

// ---- score ------------------------------------------------------------------------------------------------
/** vanilla bands (Everon / Arland / Kolguyev, GAMEPLAY_MAPPING.md): inside the band 80..95 (95 at its centre),
 *  outside it falls from 80 to 0 over `tol` */
export const GAMEPLAY_BANDS = {
  exposure: { lo: 4, hi: 9, tol: 15 },          // % land > 150 m from cover
  coverP90: { lo: 125, hi: 165, tol: 250 },     // m, p90 distance to cover in the open
  approach: { lo: 20, hi: 46, tol: 20 },        // % cover median in the 150-450 m ring of the settlements
  bare: { lo: 0, hi: 8, tol: 30 },              // % settlements with < 10 % approach cover
  view: { lo: 14, hi: 33, tol: 14 },            // % of its 2 km disc a summit sees
  open: { lo: 58, hi: 72, tol: 20 },            // % open land
  plain: { lo: 450, hi: 900, tol: 400 },        // m, farthest point from cover: one real armour plain exists
} as const
export type GameplayKey = keyof typeof GAMEPLAY_BANDS
export function bandScore(v: number, b: { lo: number; hi: number; tol: number }): number {
  if (!Number.isFinite(v)) return 0
  if (v >= b.lo && v <= b.hi) { const c = (b.lo + b.hi) / 2, half = Math.max(1e-9, (b.hi - b.lo) / 2); return Math.round(95 - 15 * Math.abs(v - c) / half) }
  const d = v < b.lo ? b.lo - v : v - b.hi
  return Math.max(0, Math.round(80 * (1 - d / b.tol)))
}

export interface GameplaySpot { x: number; z: number; r: number; kind: 'exposed' | 'bare' }
export interface GameplayReport {
  score: number
  sub: Record<GameplayKey, { value: number; score: number }>
  open: ReturnType<typeof openGround>; approach: ReturnType<typeof approachCover>; viewshed: ReturnType<typeof summitViewshed>
  settlements: number; spots: GameplaySpot[]
}

/** exposed spots: centres of the cells farther than `min` m from cover, merged on a `merge` m grid (the worst first) */
export function exposedSpots(m: CoverMap, d: Float32Array, min = 200, merge = 300, max = 40): GameplaySpot[] {
  const best = new Map<number, { x: number; z: number; d: number }>(), mc = Math.max(1, Math.round(merge / m.step))
  for (let i = 0; i < d.length; i++) {
    if (!m.land[i] || m.cover[i] || d[i] <= min) continue
    const c = i % m.cols, r = (i / m.cols) | 0, k = Math.floor(r / mc) * 100003 + Math.floor(c / mc), o = best.get(k)
    if (!o || d[i] > o.d) best.set(k, { x: m.minX + (c + 0.5) * m.step, z: m.minZ + (r + 0.5) * m.step, d: d[i] })
  }
  return [...best.values()].sort((a, b) => b.d - a.d).slice(0, max).map((s) => ({ x: s.x, z: s.z, r: Math.round(s.d), kind: 'exposed' as const }))
}

/** the whole gameplay report of a map (vanilla or generated), on a <= 16 m grid */
export function gameplayReport(inp0: GameplayInput, step = 16): GameplayReport {
  const inp = inp0.grid.step < step ? coarsen(inp0, step) : inp0
  const m = coverMap(inp), objs = settlementClusters(inp0.houses)
  const open = openGround(m), approach = approachCover(m, objs), viewshed = summitViewshed(inp.heights, m)
  const val: Record<GameplayKey, number> = { exposure: open.beyond150Pct, coverP90: open.toCoverM.p90, approach: approach.pct.med, bare: approach.barePct,
    view: viewshed.visiblePct, open: open.openPct, plain: open.toCoverM.max }
  const sub = Object.fromEntries(Object.entries(GAMEPLAY_BANDS).map(([k, b]) => [k, { value: val[k as GameplayKey], score: bandScore(val[k as GameplayKey], b) }])) as GameplayReport['sub']
  // the approaches weigh double: they decide whether a village can be taken on foot
  const w: Record<GameplayKey, number> = { exposure: 2, coverP90: 1, approach: 2, bare: 1, view: 1, open: 1, plain: 1 }
  let s = 0, ws = 0; for (const k of Object.keys(sub) as GameplayKey[]) { s += sub[k].score * w[k]; ws += w[k] }
  const spots: GameplaySpot[] = exposedSpots(m, distanceToCover(m))
  // bare approaches: the settlements whose ring has < 10 % cover
  const one = { ...m }
  for (const o of objs) if (approachCover(one, [o]).pct.med < 10) spots.push({ x: o.x, z: o.z, r: 450, kind: 'bare' })
  return { score: Math.round(s / ws), sub, open, approach, viewshed, settlements: objs.length, spots }
}
