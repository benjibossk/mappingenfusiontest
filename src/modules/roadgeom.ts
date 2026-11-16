// Road network V2, stages 5-6: road geometry.
// - filletPolyline: horizontal smoothing. Every corner becomes straight line + tangent circular arc
//   (radius >= rMin of the class when the segments leave room). An arc offset stays an arc, so both edges of
//   the road stay parallel (sandboxspirit "The simple geometry behind any road"). Ends and fixed points
//   (junctions) are kept exactly.
// - profileLine: vertical profile. Terrain smoothed, grades clipped to the class design grade (two passes),
//   then grade changes rounded off into vertical curves (crest / sag) whose length grows with K.
// - levelGraph: one height per junction node, every edge profile pinned to it (welded junctions).
import { ROAD_CLASSES, classOf } from './roadgraph-classes'
import type { RoadGraph } from './roadgraph'
import { centreLine } from './roads'

export interface FilletResult { pts: number[]; minR: number; reduced: number; corners: number }

//! Corners -> line + circular arc. rMin: wanted radius (m); chord: max arc chord (m); corners turning less
//! than minDeg are left alone. `fixed(x, z)`: points that must stay where they are (junctions).
//! When two corners are too close for the radius, each one gets half the segment between them and a smaller
//! radius (counted in `reduced`, so the checker can tell).
export function filletPolyline(pts0: number[], rMin: number, opts: { chord?: number; minDeg?: number; fixed?: (x: number, z: number) => boolean; merge?: number; minKeep?: number } = {}): FilletResult {
  const pts = opts.merge ? mergeCorners(pts0, rMin, opts.merge, opts.fixed) : pts0
  const n = pts.length / 2
  const chord = opts.chord ?? 5, minA = ((opts.minDeg ?? 10) * Math.PI) / 180
  if (n < 3 || rMin <= 0) return { pts: pts.slice(), minR: Infinity, reduced: 0, corners: 0 }
  const P = (i: number): [number, number] => [pts[i * 2], pts[i * 2 + 1]]
  const turn = (i: number) => {
    const [ax, az] = P(i - 1), [bx, bz] = P(i), [cx, cz] = P(i + 1)
    const a1 = Math.atan2(bz - az, bx - ax), a2 = Math.atan2(cz - bz, cx - bx)
    return Math.atan2(Math.sin(a2 - a1), Math.cos(a2 - a1))
  }
  const cand = (i: number) => i > 0 && i < n - 1 && !opts.fixed?.(pts[i * 2], pts[i * 2 + 1]) && Math.abs(turn(i)) >= minA &&
    Math.hypot(pts[i * 2] - pts[i * 2 - 2], pts[i * 2 + 1] - pts[i * 2 - 1]) > 1e-6 && Math.hypot(pts[i * 2 + 2] - pts[i * 2], pts[i * 2 + 3] - pts[i * 2 + 1]) > 1e-6
  const out: number[] = [pts[0], pts[1]]
  const push = (x: number, z: number) => {
    const l = out.length
    if (Math.hypot(out[l - 2] - x, out[l - 1] - z) > 1e-6) out.push(x, z)
  }
  let minR = Infinity, reduced = 0, corners = 0
  for (let i = 1; i < n - 1; i++) {
    const [bx, bz] = P(i)
    if (!cand(i)) { push(bx, bz); continue }
    const [ax, az] = P(i - 1), [cx, cz] = P(i + 1)
    const Lin = Math.hypot(bx - ax, bz - az), Lout = Math.hypot(cx - bx, cz - bz)
    const d = turn(i), half = Math.abs(d) / 2
    const avail = Math.min(Lin * (cand(i - 1) ? 0.5 : 1), Lout * (cand(i + 1) ? 0.5 : 1))
    let R = rMin, T = R * Math.tan(half)
    if (T > avail) { T = avail; R = T / Math.tan(half); reduced++ }
    // much too tight for an arc: leave the corner to the spline (no extra points)
    if (opts.minKeep && R < rMin * opts.minKeep) { push(bx, bz); continue }
    corners++
    minR = Math.min(minR, R)
    const ux = (bx - ax) / Lin, uz = (bz - az) / Lin, vx = (cx - bx) / Lout, vz = (cz - bz) / Lout
    const sx = bx - ux * T, sz = bz - uz * T // arc start (tangent point on the way in)
    // centre on the inner side: left normal of the way in for a left turn (d > 0 in x,z axes), else right
    const sg = Math.sign(d)
    const ox = sx - uz * R * sg, oz = sz + ux * R * sg
    const a0 = Math.atan2(sz - oz, sx - ox)
    const m = Math.max(2, Math.ceil((R * Math.abs(d)) / chord))
    for (let k = 0; k <= m; k++) {
      const a = a0 + (d * k) / m
      push(ox + R * Math.cos(a), oz + R * Math.sin(a))
    }
    // exact tangent point on the way out (no drift from the trigonometry)
    out[out.length - 2] = bx + vx * T; out[out.length - 1] = bz + vz * T
  }
  push(pts[n * 2 - 2], pts[n * 2 - 1])
  // the last point must be exactly the original end (push skips it when an arc ended right on it)
  out[out.length - 2] = pts[n * 2 - 2]; out[out.length - 1] = pts[n * 2 - 1]
  return { pts: out, minR, reduced, corners }
}

//! Even spacing (about `step` metres) between kept points: ends and keep(x, z) points stay exactly, every
//! stretch between two of them is cut into equal parts. A Catmull-Rom spline (centreLine, the road generator)
//! through evenly spaced points follows the lines and arcs; through a mix of 50 m and 4 m segments it overshoots.
export function resampleKeep(pts: number[], step: number, keep?: (x: number, z: number) => boolean): number[] {
  const n = pts.length / 2
  if (n < 2) return pts.slice()
  const out = [pts[0], pts[1]]
  let piece: number[] = [pts[0], pts[1]]
  const flush = () => {
    const L: number[] = [0]
    for (let k = 2; k < piece.length; k += 2) L.push(L[L.length - 1] + Math.hypot(piece[k] - piece[k - 2], piece[k + 1] - piece[k - 1]))
    const total = L[L.length - 1], m = Math.max(1, Math.round(total / step))
    let j = 1
    for (let q = 1; q < m; q++) {
      const d = (total * q) / m
      while (j < L.length - 1 && L[j] < d) j++
      const t = (d - L[j - 1]) / Math.max(1e-9, L[j] - L[j - 1])
      out.push(piece[j * 2 - 2] + (piece[j * 2] - piece[j * 2 - 2]) * t, piece[j * 2 - 1] + (piece[j * 2 + 1] - piece[j * 2 - 1]) * t)
    }
    out.push(piece[piece.length - 2], piece[piece.length - 1])
  }
  for (let i = 1; i < n; i++) {
    piece.push(pts[i * 2], pts[i * 2 + 1])
    if (i === n - 1 || keep?.(pts[i * 2], pts[i * 2 + 1])) { flush(); piece = [pts[i * 2], pts[i * 2 + 1]] }
  }
  return out
}

//! Fillet + even resampling on the stretches where frozen(x, z) is false; frozen stretches (places: their streets
//! and lots grow from the road as it is) keep their control points verbatim. The boundary points are kept.
export function smoothRoad(pts: number[], rMin: number, o: { spacing: number; fixed?: (x: number, z: number) => boolean; frozen?: (x: number, z: number) => boolean; merge?: number; minKeep?: number; chord?: number }): { pts: number[]; corners: number } {
  const n = pts.length / 2
  const fr = Array.from({ length: n }, (_, i) => !!o.frozen?.(pts[i * 2], pts[i * 2 + 1]))
  const out: number[] = []
  let corners = 0, i = 0
  while (i < n) {
    let j = i
    while (j + 1 < n && fr[j + 1] === fr[i]) j++
    // run i..j (+ the next point as its end, so runs share their boundary point)
    const e = Math.min(n - 1, j + 1)
    const run = pts.slice(i * 2, e * 2 + 2)
    let piece = run
    if (!fr[i] && run.length >= 6) {
      const f = filletPolyline(run, rMin, { fixed: o.fixed, chord: o.chord ?? 5, merge: o.merge, minKeep: o.minKeep })
      if (f.corners) { piece = resampleKeep(f.pts, o.spacing, o.fixed); corners += f.corners }
    }
    out.push(...(out.length ? piece.slice(2) : piece))
    if (e === n - 1) break
    i = j + 1
  }
  return { pts: out, corners }
}

//! Two corners turning the same way too close for an arc of rMin each become one corner at the crossing of
//! their outer legs (the "point of intersection" of road design), when that point stays within maxDev metres
//! of the segment it replaces. Repeated, so a staircase of grid steps becomes one long bend.
export function mergeCorners(pts: number[], rMin: number, maxDev: number, fixed?: (x: number, z: number) => boolean): number[] {
  const p = pts.slice()
  const turn = (i: number) => {
    const a1 = Math.atan2(p[i * 2 + 1] - p[i * 2 - 1], p[i * 2] - p[i * 2 - 2]), a2 = Math.atan2(p[i * 2 + 3] - p[i * 2 + 1], p[i * 2 + 2] - p[i * 2])
    return Math.atan2(Math.sin(a2 - a1), Math.cos(a2 - a1))
  }
  const len = (i: number) => Math.hypot(p[i * 2 + 2] - p[i * 2], p[i * 2 + 3] - p[i * 2 + 1])
  for (let changed = true; changed; ) {
    changed = false
    for (let i = 1; i + 2 < p.length / 2; i++) {
      if (fixed?.(p[i * 2], p[i * 2 + 1]) || fixed?.(p[i * 2 + 2], p[i * 2 + 3])) continue
      const t1 = turn(i), t2 = turn(i + 1)
      if (Math.sign(t1) !== Math.sign(t2) || Math.abs(t1 + t2) >= Math.PI * 0.75) continue
      // room needed by the two arcs on the shared segment
      if (rMin * (Math.tan(Math.abs(t1) / 2) + Math.tan(Math.abs(t2) / 2)) <= len(i)) continue
      // crossing of the leg in (i-1 -> i) and the leg out (i+1 -> i+2)
      const ax = p[i * 2 - 2], az = p[i * 2 - 1], bx = p[i * 2], bz = p[i * 2 + 1]
      const cx = p[i * 2 + 2], cz = p[i * 2 + 3], dx = p[i * 2 + 4], dz = p[i * 2 + 5]
      const rx = bx - ax, rz = bz - az, sx = dx - cx, sz = dz - cz, den = rx * sz - rz * sx
      if (Math.abs(den) < 1e-9) continue
      const t = ((cx - ax) * sz - (cz - az) * sx) / den, u = ((cx - ax) * rz - (cz - az) * rx) / den
      if (t < 1 || u > 0) continue // must lie beyond b on the way in and before c on the way out
      const xx = ax + t * rx, xz = az + t * rz
      const L2 = (cx - bx) ** 2 + (cz - bz) ** 2 || 1, q = Math.max(0, Math.min(1, ((xx - bx) * (cx - bx) + (xz - bz) * (cz - bz)) / L2))
      if (Math.hypot(xx - bx - q * (cx - bx), xz - bz - q * (cz - bz)) > maxDev) continue
      p.splice(i * 2, 4, xx, xz)
      changed = true
      break
    }
  }
  return p
}

//! smallest radius along a polyline (circumradius of every three consecutive points; straight runs ignored)
export function minRadius(pts: number[]): number {
  let best = Infinity
  for (let k = 2; k + 3 < pts.length; k += 2) {
    const ax = pts[k - 2], az = pts[k - 1], bx = pts[k], bz = pts[k + 1], cx = pts[k + 2], cz = pts[k + 3]
    const a = Math.hypot(bx - cx, bz - cz), b = Math.hypot(ax - cx, az - cz), c = Math.hypot(ax - bx, az - bz)
    const area2 = Math.abs((bx - ax) * (cz - az) - (bz - az) * (cx - ax))
    if (area2 < 1e-9 || a < 1e-6 || c < 1e-6) continue
    best = Math.min(best, (a * b * c) / (2 * area2))
  }
  return best
}

// --- stage 6: vertical profile ---

export interface ProfileOpts {
  maxGrade: number // design grade (rise / run)
  smooth?: number // half window of the terrain moving average (m), default 40
  curve?: number // vertical curve length (m) used to round off grade changes, default 40
  pinStart?: number // fixed height at s = 0 (junction / abutment)
  pinEnd?: number // fixed height at the last point
  floor?: number // never below (e.g. sea level + margin)
}

//! cumulative arc length of a polyline
export function arcLength(line: number[]): number[] {
  const s = [0]
  for (let i = 2; i + 1 < line.length; i += 2) s.push(s[s.length - 1] + Math.hypot(line[i] - line[i - 2], line[i + 1] - line[i - 1]))
  return s
}

//! clip grades to g, keeping pinned points; backward pass last, so every pair ends within g
function clip(y: number[], s: number[], g: number, pinned: (i: number) => boolean) {
  const m = y.length
  for (let i = 1; i < m; i++) if (!pinned(i)) { const ds = s[i] - s[i - 1]; y[i] = Math.min(Math.max(y[i], y[i - 1] - g * ds), y[i - 1] + g * ds) }
  for (let i = m - 2; i >= 0; i--) if (!pinned(i)) { const ds = s[i + 1] - s[i]; y[i] = Math.min(Math.max(y[i], y[i + 1] - g * ds), y[i + 1] + g * ds) }
}

//! box filter of the per-segment grades over a window of `w` metres (length weighted)
function smoothGrades(gr: number[], s: number[], w: number): number[] {
  // two pointers over the segment midpoints, length-weighted prefix sums
  const n = gr.length, pre = new Float64Array(n + 1), len = new Float64Array(n + 1)
  for (let k = 0; k < n; k++) { const l = s[k + 1] - s[k]; pre[k + 1] = pre[k] + gr[k] * l; len[k + 1] = len[k] + l }
  const mid = (k: number) => (s[k] + s[k + 1]) / 2
  const out = new Array<number>(n)
  let a = 0, b = 0
  for (let j = 0; j < n; j++) {
    while (mid(j) - mid(a) > w / 2) a++
    if (b < j) b = j
    while (b + 1 < n && mid(b + 1) - mid(j) <= w / 2) b++
    const L = len[b + 1] - len[a]
    out[j] = L > 0 ? (pre[b + 1] - pre[a]) / L : gr[j]
  }
  return out
}

//! Road height along the centre line. s: arc length (m), ground: terrain under each point.
export function profileLine(s: number[], ground: number[], o: ProfileOpts): number[] {
  const m = s.length
  if (m < 2) return ground.slice()
  const W = o.smooth ?? 40, C = o.curve ?? 40
  // 1. terrain moving average (distance window)
  const pre = new Float64Array(m + 1)
  for (let i = 0; i < m; i++) pre[i + 1] = pre[i] + ground[i]
  let y: number[] = new Array(m)
  for (let i = 0, a = 0, b = 0; i < m; i++) {
    while (s[i] - s[a] > W) a++
    if (b < i) b = i
    while (b + 1 < m && s[b + 1] - s[i] <= W) b++
    y[i] = (pre[b + 1] - pre[a]) / (b - a + 1)
  }
  if (o.floor !== undefined) y = y.map((v) => Math.max(v, o.floor!))
  const pinned = (i: number) => (i === 0 && o.pinStart !== undefined) || (i === m - 1 && o.pinEnd !== undefined)
  if (o.pinStart !== undefined) y[0] = o.pinStart
  if (o.pinEnd !== undefined) y[m - 1] = o.pinEnd
  // 2. grade limit
  clip(y, s, o.maxGrade, pinned)
  // 3. vertical curves: grades filtered twice (triangle kernel ~ parabolic transition), integrated back,
  //    the end error spread linearly so both ends keep their height
  if (C > 0 && m > 2) {
    let gr = y.slice(1).map((v, j) => (v - y[j]) / Math.max(1e-6, s[j + 1] - s[j]))
    gr = smoothGrades(smoothGrades(gr, s, C), s, C)
    const z = [y[0]]
    for (let j = 0; j < gr.length; j++) z.push(z[j] + gr[j] * (s[j + 1] - s[j]))
    const err = y[m - 1] - z[m - 1], L = s[m - 1] || 1
    y = z.map((v, i) => v + (err * s[i]) / L)
    if (o.floor !== undefined) y = y.map((v, i) => (pinned(i) ? v : Math.max(v, o.floor!)))
    clip(y, s, o.maxGrade, pinned)
  }
  return y
}

//! grade per segment and the largest grade change between two consecutive segments
export function gradeStats(s: number[], y: number[]): { max: number; maxChange: number } {
  let max = 0, maxChange = 0, prev = NaN
  for (let i = 1; i < y.length; i++) {
    const ds = s[i] - s[i - 1]
    if (ds < 1e-6) continue
    const g = (y[i] - y[i - 1]) / ds
    max = Math.max(max, Math.abs(g))
    if (!Number.isNaN(prev)) maxChange = Math.max(maxChange, Math.abs(g - prev))
    prev = g
  }
  return { max, maxChange }
}

//! Vertical profile of a polyline at `spacing` metres with the class design grade of `type`.
export function profileRoad(pts: number[], type: Parameters<typeof classOf>[0], heightAt: (x: number, z: number) => number, opts: Partial<ProfileOpts> & { spacing?: number } = {}) {
  const line = centreLine(pts, opts.spacing ?? 5)
  const s = arcLength(line)
  const ground: number[] = []
  for (let i = 0; i + 1 < line.length; i += 2) ground.push(heightAt(line[i], line[i + 1]))
  const spec = ROAD_CLASSES[classOf(type)]
  const y = profileLine(s, ground, { maxGrade: spec.design, curve: spec.kCrest * 4, ...opts })
  return { line, s, ground, y }
}

//! One height per junction node (mean terrain within `radius` of it), then every edge gets its profile
//! (e.profile, one Y per point a, interior..., b) pinned to the heights of its two nodes.
export function levelGraph(g: RoadGraph, heightAt: (x: number, z: number) => number, radius = 6) {
  for (const n of g.nodes.values()) {
    let sum = 0, k = 0
    for (let dz = -radius; dz <= radius; dz += radius) for (let dx = -radius; dx <= radius; dx += radius) { sum += heightAt(n.x + dx, n.z + dz); k++ }
    n.y = sum / k
  }
  for (const e of g.edges) {
    const A = g.nodes.get(e.a)!, B = g.nodes.get(e.b)!
    const line = [A.x, A.z, ...e.pts, B.x, B.z]
    const s = arcLength(line)
    const ground: number[] = []
    for (let i = 0; i < line.length; i += 2) ground.push(heightAt(line[i], line[i + 1]))
    const spec = ROAD_CLASSES[e.cls]
    e.profile = profileLine(s, ground, { maxGrade: spec.design, curve: spec.kCrest * 4, pinStart: A.y, pinEnd: B.y })
  }
}
