// Gameplay metrics on a land raster (GAMEPLAY_MAPPING.md, PakTools/analyses): how much of the map an infantryman
// crosses in the open, how much cover the approaches to a settlement give, how much ground the high points see.
// Pure functions, same code for the vanilla refmaps and our worlds (scripts/bench/gameplay.ts).

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
