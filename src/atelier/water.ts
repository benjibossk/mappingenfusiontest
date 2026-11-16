// "Water as in game": recompute the water that the lake / river generators of the .layer files make appear,
// and propose shapes / Widths fitted to it (for the in-game map, the .topo draws the whole shape / band).
// Ported to TypeScript from giorbev's eau_layers.py + water_layers.py — MIT, Copyright (c) giorbev
// (https://github.com/giorbev/Map-generator). Rules (verified by him in Workbench, CONCEPTION.md step 16):
//   lake   level = lowest shape point + generator coords y + m_fWaterSurfaceOffset; water = terrain below it in the shape
//          fix: keep original points where water touches the outline, redo free banks MARGIN m from the water,
//          at most 60 points (the generator gives up beyond), never outside the old shape, no new self-crossing
//   river  level = line height + generator y + WaterOffset + SplineOffsetUp; water = terrain below it in the Width band
//          fix: uniform-width segments overlapping by one side, Width = water + 3 m each side, never more than before
import { heightAt, type HeightGrid } from './heights.ts'
import { area, close, components, crossings, dilate, distTo, fillPoly, largestContour, simplify, type Pt } from './raster.ts'
import { balanced, waterBodies, type WaterBody } from './formats/layer.ts'

export const MARGIN = 3.0
export const MAX_POINTS = 60
const LAKE_MIN_M2 = 2000, PUDDLE_M2 = 30, MARSH_COVER = 0.30, TOUCH_M = MARGIN + 3.0
const RIV_WMIN = 6.0, RIV_RATIO = 1.35, RIV_LMIN = 120.0, RIV_GAP = 5.0, RIV_SMALL = 100

export type WaterStatus = 'ok' | 'modified' | 'small' | 'marsh' | 'tilted' | 'manual' | 'noWidth' | 'dry' | 'error'
export interface Segment { a: number; b: number; Width: number }
export interface WaterProposal {
  file: string; kind: 'lake' | 'river'; name: string; body: WaterBody; status: WaterStatus; note: string
  cx: number; cz: number; npts: number
  level?: number; waterM2?: number; mapBeforeM2?: number; mapAfterM2?: number; lostM2?: number
  seq?: (['orig', number] | ['new', number, number])[]; nptsNew?: number
  segments?: Segment[]; width?: number | null; length?: number
  /** world-space outlines for the preview */
  oldOutline?: Pt[]; newOutline?: Pt[]; water?: { x0: number; z1: number; W: number; H: number; m: Uint8Array }
  problems: string[]
}

/** points along the shape (Catmull-Rom when spline) and the index of the original side of each */
export function sample(P: number[][], closed: boolean, spline: boolean, step = 1): { pts: number[][]; seg: number[] } {
  const n = P.length, pts: number[][] = [], seg: number[] = []
  const dim = P[0].length
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const p1 = P[i], p2 = P[(i + 1) % n]
    const k = Math.max(Math.floor(Math.hypot(p2[0] - p1[0], p2[dim - 1] - p1[dim - 1]) / step), 1)
    const idx = (j: number) => closed ? P[((j % n) + n) % n] : P[Math.min(Math.max(j, 0), n - 1)]
    const p0 = idx(i - 1), p3 = idx(i + 2)
    for (let s = 0; s < k; s++) {
      const t = s / k
      if (spline && n > 2) pts.push(p1.map((_, d) => 0.5 * (2 * p1[d] + (-p0[d] + p2[d]) * t + (2 * p0[d] - 5 * p1[d] + 4 * p2[d] - p3[d]) * t * t + (-p0[d] + 3 * p1[d] - 3 * p2[d] + p3[d]) * t * t * t)))
      else pts.push(p1.map((_, d) => p1[d] + (p2[d] - p1[d]) * t))
      seg.push(i)
    }
  }
  if (!closed) { pts.push(P[n - 1].slice()); seg.push(n - 2) }
  return { pts, seg }
}

/** quick structural checks (Enfusion generator rules), independent of the terrain */
export function bodyProblems(b: WaterBody): string[] {
  const out: string[] = [], n = b.x.length
  if (b.kind === 'lake' && n > MAX_POINTS) out.push('tooManyPoints')
  let dup = 0
  for (let i = 0; i < n; i++) { const j = (i + 1) % n; if (!b.closed && j === 0) break; if (Math.hypot(b.x[j] - b.x[i], b.z[j] - b.z[i]) < 0.5) dup++ }
  if (dup) out.push('duplicatePoints')
  if (b.kind === 'lake') { const P: Pt[] = b.x.map((x, i) => [x, b.z[i]]); if (crossings(P) > 0) out.push('selfCrossing') }
  if (b.kind === 'river' && b.width === null) out.push('noWidth')
  if (b.angles[0] || b.angles[2]) out.push('tilted')
  return out
}

function lake(b: WaterBody, H: HeightGrid): WaterProposal {
  const O: Pt[] = b.x.map((x, i) => [x, b.z[i]]), n = O.length
  const level = Math.min(...b.y) + b.gdy + b.offset
  const r: WaterProposal = base(b, 'ok', '')
  r.level = Math.round(level * 100) / 100; r.oldOutline = O
  if (b.angles[0] || b.angles[2]) return { ...r, status: 'tilted' }
  const S = sample(O, true, b.spline), C = S.pts as Pt[], seg = S.seg
  const x0 = Math.floor(Math.min(...C.map((p) => p[0]))) - 20, z1 = Math.ceil(Math.max(...C.map((p) => p[1]))) + 20
  const W = Math.ceil(Math.max(...C.map((p) => p[0]))) + 20 - x0, Hh = z1 - (Math.floor(Math.min(...C.map((p) => p[1]))) - 20)
  if (W * Hh > 16e6) return { ...r, status: 'manual', note: 'tooLarge' }
  const w2p = (p: Pt): Pt => [p[0] - x0, z1 - p[1]], p2w = (q: Pt): Pt => [x0 + q[0], z1 - q[1]]
  const fill = (P: Pt[]) => fillPoly(W, Hh, P.map(w2p))
  const shp = fill(C)
  const wet = new Uint8Array(W * Hh)
  for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) { const i = y * W + x; if (shp[i] && heightAt(H, x0 + x + 0.5, z1 - y - 0.5) < level) wet[i] = 1 }
  const { lab, sizes } = components(wet, W, Hh)
  const keep = new Uint8Array(W * Hh); let water = 0, shpA = 0, pieces = 0
  for (let i = 1; i < sizes.length; i++) if (sizes[i] >= PUDDLE_M2) pieces++
  for (let i = 0; i < keep.length; i++) { if (lab[i] && sizes[lab[i]] >= PUDDLE_M2) { keep[i] = 1; water++ } if (shp[i]) shpA++ }
  r.waterM2 = water; r.mapBeforeM2 = shpA; r.water = { x0, z1, W, H: Hh, m: keep }
  if (water < LAKE_MIN_M2) return { ...r, status: 'small' }
  const cover = water / Math.max(shpA, 1)
  if (cover < MARSH_COVER) return { ...r, status: 'marsh', note: String(Math.round(100 * cover)) }
  const dt = distTo(keep, W, Hh)
  const dmax = new Float64Array(n)
  C.forEach((p, k) => { const q = w2p(p), xi = Math.min(Math.max(Math.round(q[0] - 0.5), 0), W - 1), yi = Math.min(Math.max(Math.round(q[1] - 0.5), 0), Hh - 1); dmax[seg[k]] = Math.max(dmax[seg[k]], dt[yi * W + xi]) })
  const sideOk = Array.from(dmax, (d) => d <= TOUCH_M)
  const kept = sideOk.map((v, i) => v || sideOk[(i - 1 + n) % n])
  if (kept.every(Boolean)) return { ...r, status: 'ok', note: 'fitted' }
  const baseCross = crossings(O), oldArea = Math.abs(area(C))
  const shpWide = dilate(shp, W, Hh, 1)
  for (let eps = 1.5; eps <= 15.01; eps += 0.5) {
    const marge = MARGIN + Math.max(Math.ceil(eps - 1.5), 0)
    let buf = dilate(keep, W, Hh, marge)
    for (let rc = 0; components(buf, W, Hh).sizes.length > 2 && rc < 60; ) { rc += 3; buf = close(dilate(keep, W, Hh, marge), W, Hh, rc) }
    for (let i = 0; i < buf.length; i++) buf[i] &= shpWide[i]
    const cont = largestContour(buf, W, Hh)
    if (!cont) break
    const Cn = cont.map(p2w)
    let seq: NonNullable<WaterProposal['seq']> = [], ok = true
    if (!kept.some(Boolean)) {
      let ap = simplify(Cn.map(w2p), eps, true).map(p2w)
      if (Math.sign(area(ap)) !== Math.sign(area(O))) ap = ap.reverse()
      seq = ap.map(([a, z]) => ['new', a, z])
    } else {
      let start = 0
      for (let k = 0; k < n; k++) if (kept[k] && !kept[(k + 1) % n]) { start = k; break }
      let i = 0
      while (i < n) {
        const k = (start + i) % n
        if (kept[k]) { seq.push(['orig', k]); i++; continue }
        let j = i
        while (j < n && !kept[(start + j) % n]) j++
        const a = (start + i - 1 + n) % n, bb = (start + j) % n
        const near = (p: Pt) => { let bi = 0, bd = Infinity; Cn.forEach((q, qi) => { const d = Math.hypot(q[0] - p[0], q[1] - p[1]); if (d < bd) { bd = d; bi = qi } }); return bi }
        const ia = near(O[a]), ib = near(O[bb]), m = Cn.length
        const arc1: Pt[] = [], arc2: Pt[] = []
        for (let t = 0; t <= ((ib - ia) % m + m) % m; t++) arc1.push(Cn[(ia + t) % m])
        for (let t = 0; t <= ((ia - ib) % m + m) % m; t++) arc2.push(Cn[((ia - t) % m + m) % m])
        const sides = new Set<number>(); for (let t = 0; t < ((bb - a) % n + n) % n; t++) sides.add((a + t) % n)
        const oldPart = C.filter((_, q) => sides.has(seg[q]))
        const score = (A: Pt[]) => { if (!oldPart.length) return 0; let s = 0; for (const p of A) { let bd = Infinity; for (const q of oldPart) { const d = (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2; if (d < bd) bd = d } s += Math.sqrt(bd) } return s / A.length }
        const arc = score(arc1) <= score(arc2) ? arc1 : arc2
        if (arc.length < 2) { ok = false; break }
        const ap = simplify(arc.map(w2p), eps, false).map(p2w)
        for (const [x, z] of ap.slice(1, -1)) seq.push(['new', x, z])
        i = j
      }
      if (!ok) continue
    }
    if (seq.length > MAX_POINTS) continue
    const P: Pt[] = seq.map((s) => s[0] === 'orig' ? O[s[1]] : [s[1], s[2]])
    if (P.length < 3) continue
    const Cnew = sample(P, true, b.spline).pts as Pt[]
    const nm = fill(Cnew)
    let lost = 0, after = 0
    for (let q = 0; q < nm.length; q++) { if (keep[q] && !nm[q]) lost++; if (nm[q]) after++ }
    if (lost > Math.max(20, 0.01 * water) || crossings(P) > baseCross) continue
    if (Math.abs(area(Cnew)) >= 0.9 * oldArea) return { ...r, status: 'ok', note: 'negligible' }
    const origKept = seq.filter((s) => s[0] === 'orig').length
    return { ...r, status: 'modified', seq, nptsNew: P.length, mapAfterM2: after, lostM2: lost, newOutline: P, note: String(origKept) }
  }
  return { ...r, status: 'manual' }
}

function river(b: WaterBody, H: HeightGrid): WaterProposal {
  const P: Pt[] = b.x.map((x, i) => [x, b.z[i]]), n = P.length
  const segL: number[] = []
  for (let i = 0; i + 1 < n; i++) segL.push(Math.hypot(P[i + 1][0] - P[i][0], P[i + 1][1] - P[i][1]))
  const L = segL.reduce((a, c) => a + c, 0)
  const r: WaterProposal = base(b, 'ok', '')
  r.length = Math.round(L); r.width = b.width; r.oldOutline = P
  if (b.width === null) return { ...r, status: 'noWidth' }
  if (b.closed || L < 50 || n < 3) return { ...r, status: 'ok', note: 'short' }
  if (b.angles[0] || b.angles[2]) return { ...r, status: 'tilted' }
  const Y = b.y.map((y) => y + b.gdy + b.offset)
  const S = sample(b.x.map((x, i) => [x, Y[i], b.z[i]]), false, b.spline)
  const C: Pt[] = S.pts.map((p) => [p[0], p[2]]), Cy = S.pts.map((p) => p[1]), seg = S.seg
  const hw = b.width / 2
  const x0 = Math.floor(Math.min(...C.map((p) => p[0])) - hw) - 5, z1 = Math.ceil(Math.max(...C.map((p) => p[1])) + hw) + 5
  const W = Math.ceil(Math.max(...C.map((p) => p[0])) + hw) + 5 - x0, Hh = z1 - (Math.floor(Math.min(...C.map((p) => p[1])) - hw) - 5)
  if (W * Hh > 25e6) return { ...r, status: 'manual', note: 'tooLarge' }
  // nearest sample of each pixel within hw + 2 m (spatial hash of the 1 m samples)
  const cs = Math.max(4, Math.ceil(hw + 2)), grid = new Map<number, number[]>(), key = (a: number, c: number) => a * 100003 + c
  C.forEach((p, k) => { const kk = key(Math.floor((p[0] - x0) / cs), Math.floor((z1 - p[1]) / cs)); (grid.get(kk) ?? grid.set(kk, []).get(kk)!).push(k) })
  const N = W * Hh, d = new Float32Array(N).fill(Infinity), jn = new Int32Array(N).fill(-1), hpx = new Float32Array(N)
  for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) {
    const wx = x0 + x + 0.5, wz = z1 - y - 0.5, gx = Math.floor((x + 0.5) / cs), gy = Math.floor((y + 0.5) / cs)
    let bd = Infinity, bj = -1
    for (let a = -1; a <= 1; a++) for (let c = -1; c <= 1; c++) for (const k of grid.get(key(gx + a, gy + c)) ?? []) { const dd = (C[k][0] - wx) ** 2 + (C[k][1] - wz) ** 2; if (dd < bd) { bd = dd; bj = k } }
    if (bj < 0) continue
    const i = y * W + x; d[i] = Math.sqrt(bd); jn[i] = bj
    if (d[i] <= hw) hpx[i] = heightAt(H, wx, wz)
  }
  const wet = new Uint8Array(N); let band = 0
  for (let i = 0; i < N; i++) if (d[i] <= hw) { band++; if (hpx[i] < Cy[jn[i]]) wet[i] = 1 }
  const { lab, sizes } = components(wet, W, Hh)
  const big = new Uint8Array(N); let bigSum = 0, wetSum = 0
  for (let i = 0; i < N; i++) { if (wet[i]) wetSum++; if (wet[i] && sizes[lab[i]] >= RIV_SMALL) { big[i] = 1; bigSum++ } }
  const need = new Float64Array(n - 1)
  for (let i = 0; i < N; i++) if (big[i]) { const s = seg[jn[i]]; if (d[i] > need[s]) need[s] = d[i] }
  for (let i = 0; i < n - 1; i++) need[i] = Math.min(Math.max(need[i] > 0 ? need[i] + MARGIN : 0, RIV_WMIN / 2), hw)
  const grp: number[][] = [[0]]
  const sum = (a: number, c: number) => segL.slice(a, c).reduce((s, v) => s + v, 0)
  for (let i = 1; i < n - 1; i++) {
    const g = grp[grp.length - 1], vals = [...g, i].map((k) => need[k])
    if (Math.max(...vals) / Math.min(...vals) > RIV_RATIO && g.reduce((s, k) => s + segL[k], 0) >= RIV_LMIN && sum(i, n - 1) >= RIV_LMIN) grp.push([i])
    else g.push(i)
  }
  const tr: Segment[] = grp.map((g) => ({ a: g[0], b: g[g.length - 1] + 1, Width: Math.min(Math.ceil(4 * Math.max(...g.map((k) => need[k]))) / 2, b.width!) }))
  const fus: Segment[] = [tr[0]]
  for (const t of tr.slice(1)) { const p = fus[fus.length - 1]; if (Math.abs(t.Width - p.Width) < RIV_GAP) { p.b = t.b; p.Width = Math.max(p.Width, t.Width) } else fus.push(t) }
  const hwNew = new Float64Array(n - 1)
  for (const t of fus) for (let i = t.a; i < t.b; i++) hwNew[i] = t.Width / 2
  for (const t of fus.slice(1)) hwNew[t.a - 1] = Math.max(hwNew[t.a - 1], t.Width / 2)
  let after = 0, lost = 0
  for (let i = 0; i < N; i++) { if (jn[i] < 0) continue; const in2 = d[i] <= hwNew[seg[jn[i]]]; if (in2) after++; if (wet[i] && !in2) lost++ }
  Object.assign(r, { waterM2: wetSum, mapBeforeM2: band, mapAfterM2: after, lostM2: lost, water: { x0, z1, W, H: Hh, m: wet } })
  if (bigSum < RIV_SMALL) return { ...r, status: 'dry' }
  if (fus.length === 1 && fus[0].Width >= b.width) return { ...r, status: 'ok', note: 'fitted' }
  if (after >= 0.9 * band) return { ...r, status: 'ok', note: 'negligible' }
  return { ...r, status: 'modified', segments: fus, note: fus.map((t) => t.Width).join(' / ') }
}

function base(b: WaterBody, status: WaterStatus, note: string): WaterProposal {
  return {
    file: b.file, kind: b.kind, name: b.name, body: b, status, note, npts: b.x.length,
    cx: Math.round(b.x.reduce((a, c) => a + c, 0) / b.x.length), cz: Math.round(b.z.reduce((a, c) => a + c, 0) / b.z.length),
    problems: bodyProblems(b),
  }
}

export function analyseBody(b: WaterBody, H: HeightGrid): WaterProposal {
  try { return b.kind === 'lake' ? lake(b, H) : river(b, H) }
  catch (e) { return { ...base(b, 'error', (e as Error).message) } }
}

// --- rewriting -------------------------------------------------------------------------------------------
const hex = () => Array.from(crypto.getRandomValues(new Uint8Array(8)), (v) => v.toString(16).padStart(2, '0')).join('').toUpperCase()

function lakePointsBlock(lines: string[], b: WaterBody, p: WaterProposal): string[] {
  const [pa, pb] = b.pts, ind = /^\s*/.exec(lines[b.sp[0][0]])![0]
  const [cx, cy, cz] = b.coords, yaw = b.angles[1] * Math.PI / 180, cs = Math.cos(yaw), sn = Math.sin(yaw)
  const py = Math.min(...b.y) - cy // lowest point height: the water level does not change
  const blk = [lines[pa]]
  for (const s of p.seq!) {
    if (s[0] === 'orig') { const [a, e] = b.sp[s[1]]; blk.push(...lines.slice(a, e + 1)) }
    else {
      const dx = s[1] - cx, dz = s[2] - cz
      blk.push(`${ind}ShapePoint "{${hex()}}" {`, `${ind} Position ${(dx * cs - dz * sn).toFixed(3)} ${py.toFixed(3)} ${(dx * sn + dz * cs).toFixed(3)}`, `${ind}}`)
    }
  }
  return [...blk, lines[pb]]
}

function riverBlock(lines: string[], b: WaterBody, p: WaterProposal): string[] {
  const [ea, eb] = b.ent, [pa, pb] = b.pts, [ga, gb] = b.gen, out: string[] = []
  p.segments!.forEach((t, k) => {
    const first = k === 0, i0 = first ? t.a : t.a - 1 // overlap one side with the previous segment
    for (let i = ea; i <= eb; i++) {
      let ln = lines[i]
      if (i === pa) {
        out.push(ln)
        for (const [a, e] of b.sp.slice(i0, t.b + 1)) {
          const sl = lines.slice(a, e + 1)
          if (!first) sl[0] = sl[0].replace(/ShapePoint "\{[0-9A-Fa-f]+\}"/, `ShapePoint "{${hex()}}"`)
          out.push(...sl)
        }
        out.push(lines[pb]); i = pb; continue
      }
      if (i > ga && i < gb) {
        if (/^\s*Width\s/.test(ln)) ln = ln.replace(/Width\s+\S+/, `Width ${t.Width}`)
        else if (!first && /^\s*GUID\s+"/.test(ln)) ln = ln.replace(/GUID\s+"[0-9A-Fa-f]+"/, `GUID "${hex()}"`)
      }
      if (!first && i === ea && b.named && b.name) ln = ln.replace(`${b.name} {`, `${b.name}_t${k + 1} {`)
      out.push(ln)
    }
  })
  return out
}

/** corrected text of one .layer (only proposals with status 'modified' and `apply` true are used) */
export function rewriteLayer(text: string, file: string, props: WaterProposal[]): { text: string; changed: number } {
  const nl = text.includes('\r\n') ? '\r\n' : '\n', lines = text.split(nl)
  const cur = new Set(waterBodies(lines, file).map((b) => b.ent.join() + '|' + b.pts.join()))
  const edits: [number, number, string[]][] = []
  for (const p of props) {
    if (p.file !== file || p.status !== 'modified') continue
    const b = p.body
    if (!cur.has(b.ent.join() + '|' + b.pts.join())) throw new Error(`${file} changed since the analysis: analyse again`)
    edits.push(p.kind === 'lake' ? [b.pts[0], b.pts[1], lakePointsBlock(lines, b, p)] : [b.ent[0], b.ent[1], riverBlock(lines, b, p)])
  }
  edits.sort((x, y) => y[0] - x[0])
  for (const [a, e, blk] of edits) lines.splice(a, e - a + 1, ...blk)
  if (!balanced(lines)) throw new Error(`${file}: unbalanced braces after the correction, not written`)
  return { text: lines.join(nl), changed: edits.length }
}
