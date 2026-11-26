//! Map from an image: a 2D map picture (tactical map, sketch, old game map screenshot) -> a project.
//! Colours are clustered (Lab k-means, satmask.ts quantise), each cluster gets a role (land, water,
//! altitude band, forest, building, road, path, field, ignore), then:
//!  - ignored clusters (arrows, letters, red lines, contour lines) are inpainted from the neighbouring areas
//!  - altitude bands -> smooth heights (distance interpolation between band edges), water carved
//!  - road lines -> skeleton -> polylines (simplified, gaps joined), class by line thickness
//!  - dark blobs -> buildings (centre, orientation, size -> nearest vanilla footprint)
//!  - forest / field / water masks -> outlines; long water bodies -> rivers
//! Pure functions on pixel grids; pixel (px, py) -> world (px * m, (H - py) * m), north up.
import { quantise, rgbToLab, type Quantised, type Rgba } from './satmask'
import { maskOutlines } from './refMap'
import { BUILDINGS, type Building, type BuildingCat } from '../data/buildings'

export type ImgRole = 'land' | 'water' | 'band' | 'forest' | 'field' | 'hedge' | 'building' | 'road' | 'path' | 'ignore'
export const IMG_ROLES: ImgRole[] = ['land', 'water', 'band', 'forest', 'field', 'hedge', 'building', 'road', 'path', 'ignore']
/** role of one colour cluster; band: height (m) of its lower edge (the contour line around it) */
export interface ClusterRole { role: ImgRole; height?: number }

/** colour clusters of the picture (Lab k-means, no blur: thin lines keep their own cluster) */
export function clusterImage(img: Rgba, k = 12): Quantised {
  return quantise(img, { k, maxSamples: 60000, iterations: 25 })
}

/** default role of each cluster from its colour, tuned on tinted tactical maps */
export function guessRoles(q: Pick<Quantised, 'lab' | 'share'>): ClusterRole[] {
  const out: ClusterRole[] = q.lab.map(([L, a, b], i) => {
    const ch = Math.hypot(a, b), share = q.share[i]
    if (L > 90 && ch < 8) return { role: 'ignore' } // white letters / labels
    if (L < 33) return a < -8 ? { role: 'ignore' } : { role: 'building' } // dark green = arrow fill; near black = buildings
    if (b < -1 && a < -3 && L > 40) return { role: 'water' }
    if (a > 28) return { role: 'ignore' } // saturated red lines (front line, circle)
    // dark olive, neutral hue: the casing of drawn roads (arrow fills of that colour are blobs, dropped as roads)
    if (L >= 38 && L < 50 && a >= -8 && a <= 2 && b > 8 && b < 20) return { role: 'road' }
    if (L < 50 && (b > 11 || a > 8)) return { role: 'ignore' } // olive / brown overlay arrows
    if (a > 4 && L >= 60 && share > 0.004) return { role: 'band', height: 0 }
    if (a > 4) return { role: 'ignore' } // contour lines over the bands
    if (a < -5 && L >= 50 && L < 72) return { role: 'forest' }
    if (ch < 11 && L >= 38 && L < 62) return { role: 'road' }
    return { role: 'land' }
  })
  // bands: redder = higher; 25 m per level by default
  const bands = out.map((r, i) => [r, q.lab[i][1]] as const).filter(([r]) => r.role === 'band').sort((x, y) => x[1] - y[1])
  bands.forEach(([r], j) => { r.height = 25 * (j + 1) })
  // the most common light cluster is the land
  if (!out.some((r) => r.role === 'land')) {
    let best = -1
    q.share.forEach((s, i) => { if (out[i].role !== 'water' && out[i].role !== 'band' && (best < 0 || s > q.share[best])) best = i })
    if (best >= 0) out[best] = { role: 'land' }
  }
  // countryside maps (forest drawn): a small cluster a shade darker than the land, same tint = field edge lines
  const land = out.reduce((b, r, i) => (r.role === 'land' && (b < 0 || q.share[i] > q.share[b]) ? i : b), -1)
  if (land >= 0 && out.some((r) => r.role === 'forest')) q.lab.forEach(([L, a, b], i) => {
    const [L0, a0, b0] = q.lab[land]
    if (out[i].role === 'land' && i !== land && q.share[i] < 0.1 && L0 - L >= 4 && L0 - L <= 15 && Math.hypot(a - a0, b - b0) < 5) out[i] = { role: 'hedge' }
  })
  return out
}

// ---------------------------------------------------------------------------------------------
// grid helpers

/** exact Euclidean distance (pixels) from every pixel to the nearest pixel where mask = 1 (Felzenszwalb) */
export function edt(mask: Uint8Array, w: number, h: number): Float32Array {
  const INF = 1e20, f = new Float64Array(Math.max(w, h)), d = new Float64Array(Math.max(w, h))
  const v = new Int32Array(Math.max(w, h)), z = new Float64Array(Math.max(w, h) + 1)
  const g = new Float64Array(w * h)
  for (let i = 0; i < w * h; i++) g[i] = mask[i] ? 0 : INF
  const pass = (n: number) => {
    let k = 0
    v[0] = 0; z[0] = -INF; z[1] = INF
    for (let q = 1; q < n; q++) {
      let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k])
      while (s <= z[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]) }
      k++; v[k] = q; z[k] = s; z[k + 1] = INF
    }
    k = 0
    for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; d[q] = (q - v[k]) * (q - v[k]) + f[v[k]] }
  }
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = g[y * w + x]
    pass(h)
    for (let y = 0; y < h; y++) g[y * w + x] = d[y]
  }
  const out = new Float32Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) f[x] = g[y * w + x]
    pass(w)
    for (let x = 0; x < w; x++) out[y * w + x] = d[x] >= INF / 2 ? Infinity : Math.sqrt(d[x])
  }
  return out
}

/** every pixel where `fill` is true takes the label of the nearest pixel where it is false (BFS, 8-neighbour) */
export function fillFrom(labels: Int16Array, w: number, h: number, fill: (l: number) => boolean): Int16Array {
  const out = Int16Array.from(labels), queue = new Int32Array(w * h), done = new Uint8Array(w * h)
  let head = 0, tail = 0
  for (let i = 0; i < w * h; i++) if (!fill(labels[i])) { done[i] = 1; queue[tail++] = i }
  if (!tail) return out
  while (head < tail) {
    const i = queue[head++], x = i % w, y = (i - x) / w
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
      const j = ny * w + nx
      if (done[j]) continue
      done[j] = 1; out[j] = out[i]; queue[tail++] = j
    }
  }
  return out
}

/** box sum of a 0/1 mask over a (2r+1)^2 window, as a share 0..1 */
export function density(mask: Uint8Array, w: number, h: number, r: number): Float32Array {
  const I = new Float64Array((w + 1) * (h + 1))
  for (let y = 0; y < h; y++) { let row = 0; for (let x = 0; x < w; x++) { row += mask[y * w + x]; I[(y + 1) * (w + 1) + x + 1] = I[y * (w + 1) + x + 1] + row } }
  const out = new Float32Array(w * h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const x0 = Math.max(0, x - r), y0 = Math.max(0, y - r), x1 = Math.min(w, x + r + 1), y1 = Math.min(h, y + r + 1)
    const s = I[y1 * (w + 1) + x1] - I[y0 * (w + 1) + x1] - I[y1 * (w + 1) + x0] + I[y0 * (w + 1) + x0]
    out[y * w + x] = s / ((x1 - x0) * (y1 - y0))
  }
  return out
}

/** morphological closing (dilate then erode by r pixels), exact disc via distance transforms */
export function closeMask(mask: Uint8Array, w: number, h: number, r: number): Uint8Array {
  const d1 = edt(mask, w, h), dil = new Uint8Array(w * h)
  for (let i = 0; i < w * h; i++) dil[i] = d1[i] <= r ? 1 : 0
  const inv = new Uint8Array(w * h)
  for (let i = 0; i < w * h; i++) inv[i] = dil[i] ? 0 : 1
  const d2 = edt(inv, w, h), out = new Uint8Array(w * h)
  for (let i = 0; i < w * h; i++) out[i] = d2[i] > r ? 1 : 0
  return out
}

/** Zhang-Suen thinning: one-pixel wide 8-connected skeleton of a 0/1 mask */
export function thin(mask: Uint8Array, w: number, h: number): Uint8Array {
  const m = Uint8Array.from(mask)
  for (let x = 0; x < w; x++) { m[x] = 0; m[(h - 1) * w + x] = 0 }
  for (let y = 0; y < h; y++) { m[y * w] = 0; m[y * w + w - 1] = 0 }
  const del: number[] = []
  for (let changed = true, guard = 0; changed && guard < 200; guard++) {
    changed = false
    for (let step = 0; step < 2; step++) {
      del.length = 0
      for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
        const i = y * w + x
        if (!m[i]) continue
        const p2 = m[i - w], p3 = m[i - w + 1], p4 = m[i + 1], p5 = m[i + w + 1], p6 = m[i + w], p7 = m[i + w - 1], p8 = m[i - 1], p9 = m[i - w - 1]
        const B = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9
        if (B < 2 || B > 6) continue
        const A = (+(!p2 && p3)) + (+(!p3 && p4)) + (+(!p4 && p5)) + (+(!p5 && p6)) + (+(!p6 && p7)) + (+(!p7 && p8)) + (+(!p8 && p9)) + (+(!p9 && p2))
        if (A !== 1) continue
        if (step === 0 ? (p2 && p4 && p6) || (p4 && p6 && p8) : (p2 && p4 && p8) || (p2 && p6 && p8)) continue
        del.push(i)
      }
      if (del.length) changed = true
      for (const i of del) m[i] = 0
    }
  }
  return m
}

/** skeleton -> pixel polylines [x0, y0, x1, y1...] between end points / junctions (and closed loops) */
export function traceSkeleton(sk: Uint8Array, w: number, h: number): number[][] {
  const at = (x: number, y: number) => (x >= 0 && y >= 0 && x < w && y < h ? sk[y * w + x] : 0)
  const RING = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]]
  // branches = 0 -> 1 transitions around the 8-ring (staircase pixels of a line count as 2, not 3)
  const branches = (i: number) => {
    const x = i % w, y = (i - x) / w
    let n = 0
    for (let k = 0; k < 8; k++) if (!at(x + RING[k][0], y + RING[k][1]) && at(x + RING[(k + 1) % 8][0], y + RING[(k + 1) % 8][1])) n++
    return n
  }
  const nb = (i: number) => {
    const x = i % w, y = (i - x) / w, r: number[] = []
    for (const [dx, dy] of RING) if (at(x + dx, y + dy)) r.push((y + dy) * w + x + dx)
    // 4-neighbours first
    return r.sort((a, b) => +(Math.abs(a - i) !== 1 && Math.abs(a - i) !== w) - +(Math.abs(b - i) !== 1 && Math.abs(b - i) !== w))
  }
  const isNode = new Uint8Array(w * h)
  for (let i = 0; i < w * h; i++) if (sk[i] && branches(i) !== 2) isNode[i] = 1
  const seen = new Uint8Array(w * h), nodeEdge = new Set<number>()
  const lines: number[][] = []
  const walk = (start: number, first: number) => {
    const path = [start, first]
    if (isNode[first]) {
      const k = Math.min(start, first) * w * h + Math.max(start, first)
      if (nodeEdge.has(k)) return
      nodeEdge.add(k)
    } else {
      seen[first] = 1
      let prev = start, cur = first
      for (;;) {
        const n = nb(cur).filter((j) => j !== prev && (isNode[j] ? !(j === start && path.length <= 3) : !seen[j]))
        if (!n.length) break
        const j = n.find((v) => isNode[v]) ?? n[0]
        path.push(j)
        if (isNode[j]) break
        seen[j] = 1; prev = cur; cur = j
      }
    }
    lines.push(path.flatMap((i) => [i % w, Math.floor(i / w)]))
  }
  for (let i = 0; i < w * h; i++) if (isNode[i]) for (const j of nb(i)) if (isNode[j] || !seen[j]) walk(i, j)
  for (let i = 0; i < w * h; i++) if (sk[i] && !isNode[i] && !seen[i]) { seen[i] = 1; const n = nb(i); if (n.length) { walk(i, n[0]); const l = lines[lines.length - 1]; l.push(l[0], l[1]) } } // loops
  return lines
}

/** Ramer-Douglas-Peucker on a flat [x, y...] polyline */
export function simplify(p: number[], eps: number): number[] {
  const n = p.length / 2
  if (n <= 2) return p.slice()
  const keep = new Uint8Array(n); keep[0] = keep[n - 1] = 1
  const st: [number, number][] = [[0, n - 1]]
  while (st.length) {
    const [a, b] = st.pop()!
    const ax = p[a * 2], ay = p[a * 2 + 1], bx = p[b * 2], by = p[b * 2 + 1], L = Math.hypot(bx - ax, by - ay)
    let md = -1, mi = -1
    for (let i = a + 1; i < b; i++) {
      const d = L < 1e-9 ? Math.hypot(p[i * 2] - ax, p[i * 2 + 1] - ay) : Math.abs((bx - ax) * (ay - p[i * 2 + 1]) - (ax - p[i * 2]) * (by - ay)) / L
      if (d > md) { md = d; mi = i }
    }
    if (md > eps) { keep[mi] = 1; st.push([a, mi], [mi, b]) }
  }
  const out: number[] = []
  for (let i = 0; i < n; i++) if (keep[i]) out.push(p[i * 2], p[i * 2 + 1])
  return out
}

const plen = (p: number[]) => { let s = 0; for (let i = 2; i < p.length; i += 2) s += Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]); return s }

/** joins polylines whose free ends face each other across a gap shorter than `gap` (dashes, overlays, crossings) */
export function joinGaps(lines: number[][], gap: number, maxTurnDeg = 50): number[][] {
  const cos = Math.cos((maxTurnDeg * Math.PI) / 180)
  // end e of line l: point + outward direction
  const ends = lines.flatMap((l, li) => ([0, 1] as const).map((e) => {
    const n = l.length / 2, i = e ? n - 1 : 0, j = e ? Math.max(0, n - 4) : Math.min(n - 1, 3)
    const x = l[i * 2], y = l[i * 2 + 1], dx = x - l[j * 2], dy = y - l[j * 2 + 1], d = Math.hypot(dx, dy) || 1
    return { li, e, x, y, dx: dx / d, dy: dy / d }
  }))
  // candidate pairs through a grid of `gap` cells
  const cell = new Map<string, number[]>()
  ends.forEach((p, k) => { const key = `${Math.floor(p.x / gap)},${Math.floor(p.y / gap)}`; const l = cell.get(key); if (l) l.push(k); else cell.set(key, [k]) })
  const pairs: [number, number, number][] = []
  ends.forEach((A, a) => {
    const cx = Math.floor(A.x / gap), cy = Math.floor(A.y / gap)
    for (let gy = cy - 1; gy <= cy + 1; gy++) for (let gx = cx - 1; gx <= cx + 1; gx++) for (const b of cell.get(`${gx},${gy}`) ?? []) {
      if (b <= a || ends[b].li === A.li) continue
      const B = ends[b], vx = B.x - A.x, vy = B.y - A.y, d = Math.hypot(vx, vy)
      if (d > gap) continue
      if (d > 1.5) { if ((A.dx * vx + A.dy * vy) / d < cos || -(B.dx * vx + B.dy * vy) / d < cos) continue }
      else if (-(A.dx * B.dx + A.dy * B.dy) < cos) continue
      pairs.push([d, a, b])
    }
  })
  pairs.sort((p, q) => p[0] - q[0])
  // greedy links between free ends of different chains (union-find on lines)
  const link = new Int32Array(ends.length).fill(-1), root = lines.map((_, i) => i)
  const find = (i: number): number => (root[i] === i ? i : (root[i] = find(root[i])))
  for (const [, a, b] of pairs) {
    if (link[a] >= 0 || link[b] >= 0) continue
    const ra = find(ends[a].li), rb = find(ends[b].li)
    if (ra === rb) continue
    link[a] = b; link[b] = a; root[ra] = rb
  }
  // walk the chains from an unlinked end
  const done = new Uint8Array(lines.length), out: number[][] = []
  const walkFrom = (li: number, e: 0 | 1) => {
    const acc: number[] = []
    let cur = li, entry = e
    for (;;) {
      done[cur] = 1
      acc.push(...(entry === 0 ? lines[cur] : rev(lines[cur])))
      const exit = (cur * 2 + (1 - entry)), to = link[exit]
      if (to < 0 || done[ends[to].li]) break
      cur = ends[to].li; entry = ends[to].e
    }
    out.push(acc)
  }
  for (let li = 0; li < lines.length; li++) if (!done[li]) for (const e of [0, 1] as const) if (!done[li] && link[li * 2 + e] < 0) walkFrom(li, e)
  for (let li = 0; li < lines.length; li++) if (!done[li]) walkFrom(li, 0) // closed chains
  return out
}
const rev = (p: number[]) => { const o: number[] = []; for (let i = p.length - 2; i >= 0; i -= 2) o.push(p[i], p[i + 1]); return o }

/** connected components of a mask (8-neighbour): pixel index lists */
export function components(mask: Uint8Array, w: number, h: number): number[][] {
  const seen = new Uint8Array(w * h), out: number[][] = []
  for (let s = 0; s < w * h; s++) {
    if (!mask[s] || seen[s]) continue
    const comp = [s]; seen[s] = 1
    for (let k = 0; k < comp.length; k++) {
      const i = comp[k], x = i % w, y = (i - x) / w
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
        const j = ny * w + nx
        if (mask[j] && !seen[j]) { seen[j] = 1; comp.push(j) }
      }
    }
    out.push(comp)
  }
  return out
}

/** holes of a mask (background not reachable from the border, 4-neighbour) filled */
export function fillHoles(mask: Uint8Array, w: number, h: number): Uint8Array {
  const out = Uint8Array.from(mask), seen = new Uint8Array(w * h), q: number[] = []
  const push = (i: number) => { if (!mask[i] && !seen[i]) { seen[i] = 1; q.push(i) } }
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x) }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1) }
  for (let k = 0; k < q.length; k++) {
    const i = q[k], x = i % w, y = (i - x) / w
    if (x > 0) push(i - 1)
    if (x < w - 1) push(i + 1)
    if (y > 0) push(i - w)
    if (y < h - 1) push(i + w)
  }
  for (let i = 0; i < w * h; i++) if (!mask[i] && !seen[i]) out[i] = 1
  return out
}

// ---------------------------------------------------------------------------------------------
// the conversion

/** woods generated on a relief-only picture: at most this share of the map (Arland massifs 11.5 %, median 2.7 ha);
 *  keeps a 2.5 km map near 20 000 ForestGenerator trees instead of ~72 000 (13-14 GB Workbench, crash) */
export const IMAGE_FOREST_SHARE = 0.12

export interface ImageMapOptions {
  /** real side of the picture, metres (the longer side) */
  size: number
  /** height of the shore line (edge of the land around water), metres */
  shore?: number
  /** water depth at the middle of wide water, metres */
  depth?: number
  /** thin lines not linking two roads become field edges; default: when a forest or field colour is set */
  fieldEdges?: boolean
  /** height smoothing radius, metres */
  smooth?: number
  /** top of the generated hills when the picture has no height colour (band), metres; 0 = flat */
  hills?: number
}

export interface ImgRoad { pts: number[]; width: number; kind: 'road' | 'path' }
export interface ImgWater { kind: 'river' | 'lake'; pts: number[]; width: number; /** river: width (m) at each point */ widths?: number[]; /** lake: a swelling of a river (its level follows the banks, not 0) */ onRiver?: boolean }
export interface ImgBuilding { x: number; z: number; yaw: number; prefab: string; cat: BuildingCat; corners: number[]; len: number; wid: number }
export interface ImgArea { kind: 'forest' | 'field'; pts: number[]; holes: number[][] }
export interface ImageMapResult {
  /** world side, metres (x: 0..sizeX, z: 0..sizeZ) */
  sizeX: number
  sizeZ: number
  /** heights on the picture pixels (row 0 = top = north), metres; HeightImage-like for heightsFromImage */
  heights: { w: number; h: number; data: Float32Array; normalized: false }
  roads: ImgRoad[]
  waters: ImgWater[]
  buildings: ImgBuilding[]
  areas: ImgArea[]
  /** per pixel role after inpainting (index in IMG_ROLES), for previews */
  roleMap: Uint8Array
  /** field edges (thin lines between fields), world polylines */
  hedges: number[][]
}

const R = (r: ImgRole) => IMG_ROLES.indexOf(r)

/** the whole conversion: picture clusters + their roles -> heights, roads, waters, buildings, areas */
export function imageToMap(q: Quantised, roles: ClusterRole[], o: ImageMapOptions): ImageMapResult {
  const { width: w, height: h } = q, N = w * h
  const mpp = o.size / Math.max(w, h), shore = o.shore ?? 1, depth = o.depth ?? 4
  // band levels: distinct heights, low to high
  const levels = [...new Set(roles.filter((r) => r.role === 'band').map((r) => r.height ?? 0))].sort((a, b) => a - b)
  const roleOf = new Int16Array(N), levelOf = new Int16Array(N)
  for (let i = 0; i < N; i++) {
    const r = roles[q.index[i]] ?? { role: 'land' }
    roleOf[i] = R(r.role)
    levelOf[i] = r.role === 'band' ? levels.indexOf(r.height ?? 0) + 1 : r.role === 'water' ? -1 : r.role === 'land' || r.role === 'forest' || r.role === 'field' ? 0 : -9
  }
  // 1. thin slivers of an area colour (anti-aliased edges of lines, red circles...) are not areas
  for (const k of new Set(levelOf)) {
    if (k === -9) continue
    const m = new Uint8Array(N)
    for (let i = 0; i < N; i++) if (levelOf[i] === k) m[i] = 1
    const kept = openMask(m, w, h, k < 0 ? 1 : 2)
    for (let i = 0; i < N; i++) if (m[i] && !kept[i]) levelOf[i] = -9
  }
  // 2. overlays: ignored pixels become the nearest real thing; ground under every line / building / overlay: the nearest area
  const roleFilled = fillFrom(roleOf, w, h, (l) => l === R('ignore'))
  const lvl = fillFrom(levelOf, w, h, (l) => l === -9)
  const roleMap = new Uint8Array(N)
  for (let i = 0; i < N; i++) roleMap[i] = roleFilled[i]

  // 3. water bodies, then heights. A river is NOT dug from its picture pixels: the picture body, blurred, sat under
  // the sea level (0 m) over a band wider than the traced width, and carveWater then sloped the banks further down
  // into it: the game sea flooded the banks (houses / trees in water) and the 2D showed two rivers. Its pixels are
  // land for the relief; carveWater alone digs the bed, exactly the traced width, its surface above the sea.
  const wm = new Uint8Array(N)
  for (let i = 0; i < N; i++) if (lvl[i] < 0) wm[i] = 1
  const waters = extractWater(wm, w, h, mpp)
  const heights = reliefFromLevels(riverAsLand(lvl, wm, w, h, waters, mpp), w, h, levels, { shore, depth, mpp, smooth: o.smooth ?? 12 })
  // a picture without any height colour (no band) gave a dead flat 1 m map: gentle generated hills (Arland-like
  // rolling ground), flat near the water so rivers / lakes / their banks stay low
  if (!levels.length) rollingRelief(heights, wm, w, h, mpp, o.hills ?? 35)

  // 4. dark marks: solid blobs = buildings, thin dark lines = road casings, aligned dashes = paths / rails
  const dark = new Uint8Array(N)
  for (let i = 0; i < N; i++) if (roleOf[i] === R('building') || roleOf[i] === R('road')) dark[i] = 1
  // red / orange annotations (zone frame, arrows, letters) and river banks: their anti-aliased edges are no road
  const notLine = annotationAndShore(q, roles, lvl, w, h)
  for (let i = 0; i < N; i++) if (notLine[i]) dark[i] = 0
  // large solid patches of a road colour (overlay arrows of the casing colour) are neither roads nor houses
  {
    const rm = new Uint8Array(N)
    for (let i = 0; i < N; i++) if (roleOf[i] === R('road')) rm[i] = 1
    const thick = openMask(rm, w, h, Math.max(3, Math.round(12 / mpp)))
    for (let i = 0; i < N; i++) if (thick[i]) dark[i] = 0
  }
  const split = splitDark(dark, w, h, mpp)
  // hatched out-of-bounds borders: no road nor building is read there
  const zone = hatchZone(split.lines, w, h)
  for (let i = 0; i < N; i++) if (zone[i]) { split.lines[i] = 0; split.blobs[i] = 0; split.dashes[i] = 0 }
  // a stub of road casing cut by a bank or a frame is no house: no blob made of road colour next to them
  {
    const nd = edt(notLine, w, h)
    const bad = new Uint8Array(N)
    for (let i = 0; i < N; i++) if (split.blobs[i] && nd[i] <= 3 && roleOf[i] !== R('building')) bad[i] = 1
    for (const c of components(split.blobs, w, h)) if (c.some((i) => bad[i])) for (const i of c) split.blobs[i] = 0
  }
  const buildings = extractBuildings(split.blobs, w, h, mpp)

  // 5. roads and paths
  const roads: ImgRoad[] = []
  for (const kind of ['road', 'path'] as const) {
    const m = new Uint8Array(N)
    for (let i = 0; i < N; i++) if (kind === 'road' ? split.lines[i] : roleOf[i] === R('path') || split.dashes[i]) m[i] = 1
    roads.push(...extractLines(m, w, h, mpp, kind, (i) => onContour(lvl, w, h, i, 3) || nearWater(lvl, w, h, i, 4)))
  }

  // 5b. thin lines that do not link two roads: field edges (hedges); the cells they close: fields
  // only on maps that draw the countryside (forest / field colours): on a relief map, thin lines are tracks
  const rural = o.fieldEdges ?? roles.some((r) => r.role === 'forest' || r.role === 'field')
  const fe = rural ? fieldEdges(roads, mpp) : { roads: [...roads], edges: [] as number[][] }
  roads.splice(0, roads.length, ...fe.roads)
  const hedges = fe.edges
  {
    const hm = new Uint8Array(N)
    for (let i = 0; i < N; i++) if (roleOf[i] === R('hedge') && !zone[i]) hm[i] = 1
    if (hm.some((v) => v)) hedges.push(...extractLines(hm, w, h, mpp, 'path').map((r) => r.pts))
  }
  // no hedge in the water: field edges traced along a lake shore stood in it (round 11, picture 119: 13 hedges,
  // 33 of their points inside the river swelling lake, bushes in the water)
  hedges.splice(0, hedges.length, ...clipLinesToWater(hedges, wm, w, h, mpp, 6))

  // 6. areas: forest / field (dot patterns closed into solid patches), water bodies
  const areas: ImgArea[] = []
  for (const kind of ['forest', 'field'] as const) {
    const m = new Uint8Array(N)
    for (let i = 0; i < N; i++) if (roleFilled[i] === R(kind) && lvl[i] >= 0) m[i] = 1
    if (!m.some((v) => v)) continue
    const solid = openMask(closeMask(m, w, h, Math.max(2, Math.round(6 / mpp))), w, h, Math.max(1, Math.round(4 / mpp)))
    for (const a of outlines(solid, w, h, mpp, 2500)) areas.push({ kind, ...a })
  }
  if (rural) {
    const drawn = new Uint8Array(N)
    for (let i = 0; i < N; i++) if (split.lines[i] || split.dashes[i] || (roleOf[i] === R('hedge') && !zone[i])) drawn[i] = 1
    areas.push(...fieldCells([...roads.map((r) => r.pts), ...hedges], lvl, roleFilled, w, h, mpp, drawn))
  }
  return { sizeX: w * mpp, sizeZ: h * mpp, heights: { w, h, data: heights, normalized: false }, roads, waters, buildings, areas, hedges, roleMap }
}

/** adds rolling hills (fractal value noise, ~700 / 280 / 110 m waves) up to `top` metres to a flat relief, faded
 *  to nothing within ~60 m of the water and fully raised past ~300 m, so the water stays at the bottom */
export function rollingRelief(out: Float32Array, water: Uint8Array, w: number, h: number, mpp: number, top: number, seed = 7): void {
  if (top <= 0) return
  const N = w * h
  const dry = new Uint8Array(N)
  let anyWater = false
  for (let i = 0; i < N; i++) { if (water[i]) anyWater = true; else dry[i] = 1 }
  const dw = anyWater ? edt(water, w, h) : null
  const hash = (x: number, y: number, o: number) => {
    let k = (x * 374761393 + y * 668265263 + (seed + o) * 2246822519) | 0
    k = Math.imul(k ^ (k >>> 13), 1274126177)
    return ((k ^ (k >>> 16)) >>> 0) / 4294967296
  }
  const noise = (x: number, y: number, o: number) => {
    const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy)
    const a = hash(xi, yi, o), b = hash(xi + 1, yi, o), c = hash(xi, yi + 1, o), d = hash(xi + 1, yi + 1, o)
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy
  }
  const oct: [number, number][] = [[700, 0.6], [280, 0.28], [110, 0.12]]
  const near = 60 / mpp, far = 300 / mpp
  for (let i = 0; i < N; i++) {
    if (!dry[i]) continue
    const x = (i % w) * mpp, y = Math.floor(i / w) * mpp
    let n = 0
    for (let k = 0; k < oct.length; k++) n += noise(x / oct[k][0], y / oct[k][0], k) * oct[k][1]
    let f = 1
    if (dw) { const t = Math.min(1, Math.max(0, (dw[i] - near) / (far - near))); f = t * t * (3 - 2 * t) }
    out[i] += top * n * f
  }
}

/** level map with the water bodies traced as rivers turned to land (level 0): lakes stay water */
export function riverAsLand(lvl: Int16Array, wm: Uint8Array, w: number, h: number, waters: ImgWater[], mpp: number): Int16Array {
  const rivers = waters.filter((x) => x.kind === 'river')
  if (!rivers.length) return lvl
  const out = lvl.slice()
  const pix = (x: number, z: number) => Math.min(h - 1, Math.max(0, Math.round(h - z / mpp))) * w + Math.min(w - 1, Math.max(0, Math.round(x / mpp)))
  for (const c of components(wm, w, h)) {
    const set = new Set(c)
    if (!rivers.some((r) => { for (let i = 0; i + 1 < r.pts.length; i += 2) if (set.has(pix(r.pts[i], r.pts[i + 1]))) return true; return false })) continue
    for (const i of c) out[i] = 0
  }
  return out
}

/** opening (erode then dilate by r) */
/** pixels that never hold a road line: red annotation colours (+3 px) and the rim of the water (2 px) */
export function annotationAndShore(q: Pick<Quantised, 'index' | 'lab'>, roles: ClusterRole[], lvl: Int16Array, w: number, h: number): Uint8Array {
  const N = w * h, red = q.lab.map(([L, a], k) => roles[k]?.role === 'ignore' && a > 12 && L < 80)
  const seed = new Uint8Array(N), out = new Uint8Array(N)
  for (let i = 0; i < N; i++) if (red[q.index[i]]) seed[i] = 1
  const d = edt(seed, w, h)
  const wm = new Uint8Array(N)
  for (let i = 0; i < N; i++) if (lvl[i] < 0) wm[i] = 1
  const dw = edt(wm, w, h)
  for (let i = 0; i < N; i++) if (d[i] <= 3 || (dw[i] > 0 && dw[i] <= 2)) out[i] = 1
  return out
}

/** a water pixel within r pixels */
export function nearWater(lvl: Int16Array, w: number, h: number, i: number, r = 4): boolean {
  const x = i % w, y = (i - x) / w
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    const X = x + dx, Y = y + dy
    if (X >= 0 && Y >= 0 && X < w && Y < h && lvl[Y * w + X] < 0) return true
  }
  return false
}

function openMask(mask: Uint8Array, w: number, h: number, r: number): Uint8Array {
  const inv = new Uint8Array(w * h)
  for (let i = 0; i < w * h; i++) inv[i] = mask[i] ? 0 : 1
  const d1 = edt(inv, w, h), er = new Uint8Array(w * h)
  for (let i = 0; i < w * h; i++) er[i] = d1[i] > r ? 1 : 0
  const d2 = edt(er, w, h), out = new Uint8Array(w * h)
  for (let i = 0; i < w * h; i++) out[i] = d2[i] <= r ? 1 : 0
  return out
}

/** level map (-1 water, 0 land, 1..N bands) -> heights: each pixel interpolated between the contour below and the one above */
export function reliefFromLevels(lvl: Int16Array, w: number, h: number, levels: number[], o: { shore: number; depth: number; mpp: number; smooth: number }): Float32Array {
  const N = w * h, out = new Float32Array(N)
  const top = levels.length
  // contour heights: C[0] = shore, C[k] = band k lower edge
  const C = [o.shore, ...levels]
  const stepAbove = top ? (top > 1 ? levels[top - 1] - levels[top - 2] : levels[0] - o.shore) : 10
  const below: (Float32Array | null)[] = [], above: (Float32Array | null)[] = []
  for (let k = 0; k <= top; k++) {
    const lo = new Uint8Array(N), hi = new Uint8Array(N)
    let anyLo = false, anyHi = false
    for (let i = 0; i < N; i++) { if (lvl[i] < k) { lo[i] = 1; anyLo = true } if (lvl[i] > k) { hi[i] = 1; anyHi = true } }
    below.push(anyLo ? edt(lo, w, h) : null)
    above.push(anyHi ? edt(hi, w, h) : null)
  }
  const capPx = Math.max(4, 150 / o.mpp) // a summit rises over ~150 m from its last contour
  for (let i = 0; i < N; i++) {
    const k = lvl[i]
    if (k < 0) continue
    const dLo = below[k]?.[i] ?? Infinity, dHi = above[k]?.[i] ?? Infinity
    const c0 = C[k], c1 = k < top ? C[k + 1] : c0 + stepAbove * 0.8
    let t: number
    if (Number.isFinite(dHi) && Number.isFinite(dLo)) t = dLo / (dLo + dHi)
    else if (Number.isFinite(dLo)) t = Math.min(1, dLo / capPx) * (k < top ? 0.5 : 1)
    else if (Number.isFinite(dHi)) t = Math.max(0, 1 - dHi / capPx)
    else t = 0
    out[i] = c0 + (c1 - c0) * t
  }
  // water: below the surface, deeper away from the shore
  const land = new Uint8Array(N)
  for (let i = 0; i < N; i++) land[i] = lvl[i] >= 0 ? 1 : 0
  const dShore = edt(land, w, h), wide = Math.max(2, 30 / o.mpp)
  for (let i = 0; i < N; i++) if (lvl[i] < 0) out[i] = -0.6 - o.depth * Math.min(1, dShore[i] / wide)
  // smooth (box blur twice), then keep water under and land over the surface
  const r = Math.max(1, Math.round(o.smooth / o.mpp))
  let s = blur(out, w, h, r)
  s = blur(s, w, h, r)
  for (let i = 0; i < N; i++) s[i] = lvl[i] < 0 ? Math.min(s[i], -0.6) : Math.max(s[i], 0.3)
  return s
}

function blur(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h)
  for (let y = 0; y < h; y++) {
    let s = 0, n = 0
    for (let x = -r; x < w + r; x++) {
      if (x + r < w && x + r >= 0) { s += src[y * w + x + r]; n++ }
      if (x - r - 1 >= 0 && x - r - 1 < w) { s -= src[y * w + x - r - 1]; n-- }
      if (x >= 0 && x < w) tmp[y * w + x] = s / n
    }
  }
  for (let x = 0; x < w; x++) {
    let s = 0, n = 0
    for (let y = -r; y < h + r; y++) {
      if (y + r < h && y + r >= 0) { s += tmp[(y + r) * w + x]; n++ }
      if (y - r - 1 >= 0 && y - r - 1 < h) { s -= tmp[(y - r - 1) * w + x]; n-- }
      if (y >= 0 && y < h) out[y * w + x] = s / n
    }
  }
  return out
}

/** world polylines minus the water mask (+ margin m): split where they cross it, pieces under 20 m dropped */
export function clipLinesToWater(lines: number[][], wm: Uint8Array, w: number, h: number, mpp: number, margin: number): number[][] {
  const d = edt(wm, w, h)
  const wet = (x: number, z: number) => {
    const px = Math.round(x / mpp), py = Math.round(h - z / mpp)
    return px >= 0 && py >= 0 && px < w && py < h && d[py * w + px] * mpp <= margin
  }
  const out: number[][] = []
  for (const l of lines) {
    let cur: number[] = []
    const flush = () => {
      let len = 0
      for (let i = 2; i < cur.length; i += 2) len += Math.hypot(cur[i] - cur[i - 2], cur[i + 1] - cur[i - 1])
      if (cur.length >= 4 && len >= 20) out.push(cur)
      cur = []
    }
    for (let i = 0; i < l.length; i += 2) {
      // every 4 m along the segment from the previous vertex; only the cut points and the vertices are kept
      const ax = i ? l[i - 2] : l[i], az = i ? l[i - 1] : l[i + 1], bx = l[i], bz = l[i + 1]
      const n = i ? Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 4)) : 1
      for (let k = 1; k <= n; k++) {
        const x = ax + ((bx - ax) * k) / n, z = az + ((bz - az) * k) / n
        if (wet(x, z)) { flush(); continue }
        if (k === n || !cur.length) cur.push(Math.round(x * 10) / 10, Math.round(z * 10) / 10)
        else if (wet(ax + ((bx - ax) * (k + 1)) / n, az + ((bz - az) * (k + 1)) / n)) cur.push(Math.round(x * 10) / 10, Math.round(z * 10) / 10)
      }
    }
    flush()
  }
  return out
}

const toWorld = (p: number[], mpp: number, h: number) => p.map((v, i) => (i % 2 ? (h - v) * mpp : v * mpp))

/** thin line mask -> world polylines with a width (metres) */
export function extractLines(m: Uint8Array, w: number, h: number, mpp: number, kind: 'road' | 'path', contour?: (i: number) => boolean): ImgRoad[] {
  // hatched borders / dense line patterns are not roads: a road covers a small share of its neighbourhood
  const dens = density(m, w, h, 12)
  for (let i = 0; i < w * h; i++) if (dens[i] > 0.22) m[i] = 0
  // lines thicker than a road (blobs) are dropped too
  const inv = new Uint8Array(w * h)
  for (let i = 0; i < w * h; i++) inv[i] = m[i] ? 0 : 1
  // bridge 1 px gaps before thinning; the width is read on the closed line (a cased road = its full width)
  const c = closeMask(m, w, h, 2.5)
  for (let i = 0; i < w * h; i++) inv[i] = c[i] ? 0 : 1
  const half = edt(inv, w, h)
  const sk = thin(c, w, h)
  let lines = traceSkeleton(sk, w, h).map((l) => ({ l, len: plen(l) }))
  // spurs: short lines hanging off a junction
  lines = lines.filter((x) => x.len >= 4)
  // contour lines between two relief bands follow the band edge all along: a road only crosses it
  if (contour) lines = lines.filter((x) => { let on = 0; for (let i = 0; i < x.l.length; i += 2) if (contour(x.l[i + 1] * w + x.l[i])) on++; return on < 0.6 * (x.l.length / 2) })
  const gap = Math.max(6, Math.round(25 / mpp))
  const joined = (joinGaps(lines.map((x) => simplify(x.l, 0.8)), gap))
  const out: ImgRoad[] = []
  for (const l of joined) {
    const len = plen(l)
    if (len * mpp < 40) continue
    // width: median of 2 * distance to the background along the line
    const ws: number[] = []
    for (let i = 0; i < l.length; i += 2) { const v = half[Math.round(l[i + 1]) * w + Math.round(l[i])]; if (Number.isFinite(v) && v > 0) ws.push(v) }
    ws.sort((a, b) => a - b)
    const wpx = ws.length ? 2 * ws[ws.length >> 1] : 1
    if (wpx * mpp > 40) continue
    out.push({ pts: toWorld(simplify(l, 2), mpp, h), width: Math.round(wpx * mpp * 10) / 10, kind })
  }
  return out
}

/** background pockets smaller than maxPx enclosed by the mask, filled (outlined buildings become solid) */
export function fillSmallHoles(mask: Uint8Array, w: number, h: number, maxPx: number): Uint8Array {
  const out = Uint8Array.from(mask), inv = new Uint8Array(w * h)
  for (let i = 0; i < w * h; i++) inv[i] = mask[i] ? 0 : 1
  for (const c of components4(inv, w, h)) {
    if (c.length > maxPx) continue
    if (c.some((i) => { const x = i % w, y = (i - x) / w; return x === 0 || y === 0 || x === w - 1 || y === h - 1 })) continue
    for (const i of c) out[i] = 1
  }
  return out
}
function components4(mask: Uint8Array, w: number, h: number): number[][] {
  const seen = new Uint8Array(w * h), out: number[][] = []
  for (let s = 0; s < w * h; s++) {
    if (!mask[s] || seen[s]) continue
    const comp = [s]; seen[s] = 1
    for (let k = 0; k < comp.length; k++) {
      const i = comp[k], x = i % w
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) if (j >= 0 && j < w * h && mask[j] && !seen[j]) { seen[j] = 1; comp.push(j) }
    }
    out.push(comp)
  }
  return out
}

interface Blob { px: number[]; cx: number; cy: number; ax: number; ay: number; len: number; wid: number }
/** centre, main axis (unit, pixels) and length / width (pixels) of a pixel set, from its second moments */
export function blobShape(px: number[], w: number): Blob {
  let sx = 0, sy = 0
  for (const i of px) { sx += i % w; sy += Math.floor(i / w) }
  const cx = sx / px.length, cy = sy / px.length
  let xx = 0, yy = 0, xy = 0
  for (const i of px) { const dx = (i % w) - cx, dy = Math.floor(i / w) - cy; xx += dx * dx; yy += dy * dy; xy += dx * dy }
  xx /= px.length; yy /= px.length; xy /= px.length
  const tr = xx + yy, det = xx * yy - xy * xy, disc = Math.sqrt(Math.max(0, (tr * tr) / 4 - det))
  const l1 = tr / 2 + disc, l2 = Math.max(0, tr / 2 - disc), ang = 0.5 * Math.atan2(2 * xy, xx - yy)
  return { px, cx, cy, ax: Math.cos(ang), ay: Math.sin(ang), len: Math.sqrt(12 * l1 + 1), wid: Math.sqrt(12 * l2 + 1) }
}

/** dark marks -> solid blobs (buildings), thin lines (road casings), dashes in a row (dotted paths / rails) */
export function splitDark(dark: Uint8Array, w: number, h: number, mpp: number): { blobs: Uint8Array; lines: Uint8Array; dashes: Uint8Array } {
  const N = w * h
  const filled = fillSmallHoles(dark, w, h, Math.max(4, Math.round(400 / (mpp * mpp))))
  const lines = new Uint8Array(N), dashes = new Uint8Array(N)
  // dotted lines first (rails, paths): their marks never become buildings nor roads
  const marks = components(filled, w, h).map((c) => blobShape(c, w)).filter((b) => b.px.length >= 2 && b.len * mpp < 40 && b.len / b.wid <= 6)
  for (const k of dashRows(marks)) for (const i of marks[k].px) { filled[i] = 0; dashes[i] = 1 }
  const blobs = openMask(filled, w, h, 1.5)
  for (let i = 0; i < N; i++) if (dark[i] && !blobs[i] && !dashes[i]) lines[i] = 1
  const all = components(blobs, w, h).map((c) => blobShape(c, w))
  // long thin blobs (filled road casings, bridges): lines
  for (const b of all) if (b.len / b.wid > 3.5 || b.px.length * mpp * mpp > 3000) for (const i of b.px) { blobs[i] = 0; lines[i] = 1 }
  const bs = all.filter((b) => b.len / b.wid <= 3.5 && b.len * mpp < 40)
  for (const k of dashRows(bs)) for (const i of bs[k].px) { blobs[i] = 0; dashes[i] = 1 }
  return { blobs, lines, dashes }
}

/** indices of the marks lying in a dotted row (chains of look-alike, aligned, evenly spaced marks) */
export function dashRows(bs: Blob[]): Set<number> {
  const hit = new Set<number>()
  // grid of centres
  const cell = 24, grid = new Map<number, number[]>()
  const gk = (x: number, y: number) => Math.floor(y / cell) * 100000 + Math.floor(x / cell)
  bs.forEach((b, k) => { const key = gk(b.cx, b.cy); const l = grid.get(key); if (l) l.push(k); else grid.set(key, [k]) })
  // neighbours of similar size close along the row: a dotted line is a chain of look-alike dashes
  const near: number[][] = bs.map((b, k) => {
    const out: number[] = []
    for (let gy = -1; gy <= 1; gy++) for (let gx = -1; gx <= 1; gx++) for (const j of grid.get(gk(b.cx + gx * cell, b.cy + gy * cell)) ?? []) {
      if (j === k) continue
      const o = bs[j], d = Math.hypot(o.cx - b.cx, o.cy - b.cy), ratio = b.px.length / o.px.length
      if (d >= 1 && d <= 2.6 * Math.max(b.len, o.len) && ratio < 1.7 && ratio > 1 / 1.7) out.push(j)
    }
    return out
  })
  // in a row: the two nearest look-alikes lie on opposite sides (a dense row may have more within reach)
  const inRow = (k: number) => {
    const b0 = bs[k], n = [...near[k]].sort((p, q) => Math.hypot(bs[p].cx - b0.cx, bs[p].cy - b0.cy) - Math.hypot(bs[q].cx - b0.cx, bs[q].cy - b0.cy)).slice(0, 2)
    if (n.length === 1) return true
    if (n.length !== 2) return false
    const b = bs[k], p = bs[n[0]], q = bs[n[1]]
    const ux = p.cx - b.cx, uy = p.cy - b.cy, vx = q.cx - b.cx, vy = q.cy - b.cy
    return (ux * vx + uy * vy) / (Math.hypot(ux, uy) * Math.hypot(vx, vy)) < -0.75
  }
  const cand = bs.map((_, k) => inRow(k)), seen = new Uint8Array(bs.length)
  for (let s = 0; s < bs.length; s++) {
    if (!cand[s] || seen[s]) continue
    const chain = [s]; seen[s] = 1
    for (let c = 0; c < chain.length; c++) for (const j of near[chain[c]]) if (cand[j] && !seen[j]) { seen[j] = 1; chain.push(j) }
    if (chain.length >= (chain.length >= 3 && regularRow(chain.map((k) => bs[k])) ? 3 : 5)) for (const k of chain) hit.add(k)
  }
  return hit
}

/** dashes evenly spaced (nearest-neighbour gaps within 30 % of their mean) and of the same size: a drawn dotted line */
export function regularRow(bs: { cx: number; cy: number; px: number[] }[]): boolean {
  const gaps = bs.map((b) => Math.min(...bs.filter((o) => o !== b).map((o) => Math.hypot(o.cx - b.cx, o.cy - b.cy))))
  const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length
  const sizes = bs.map((b) => b.px.length), sm = sizes.reduce((a, b) => a + b, 0) / sizes.length
  return gaps.every((g) => Math.abs(g - mean) <= 0.3 * mean) && sizes.every((z) => Math.abs(z - sm) <= 0.4 * sm)
}

/** thin drawn lines (well under the typical road) are field edges unless both ends meet a real road */
export function fieldEdges(lines: ImgRoad[], mpp: number): { roads: ImgRoad[]; edges: number[][] } {
  const ws = lines.filter((r) => r.kind === 'road').map((r) => r.width).sort((a, b) => a - b)
  if (ws.length < 4) return { roads: lines, edges: [] }
  // the typical road: upper quartile (field edges may outnumber roads)
  const ref = ws[Math.floor(ws.length * 0.75)]
  const thinL = (r: ImgRoad) => r.kind === 'road' && r.width < 0.6 * ref
  const real = lines.filter((r) => !thinL(r))
  const reach = Math.max(12, 4 * mpp)
  const nearRoad = (x: number, z: number) => real.some((r) => distToLine(r.pts, x, z) < reach)
  const roads: ImgRoad[] = [], edges: number[][] = []
  for (const r of lines) {
    if (!thinL(r)) { roads.push(r); continue }
    const n = r.pts.length
    if (nearRoad(r.pts[0], r.pts[1]) && nearRoad(r.pts[n - 2], r.pts[n - 1])) roads.push(r)
    else edges.push(r.pts)
  }
  return { roads, edges }
}
function distToLine(p: number[], x: number, z: number): number {
  let m = Infinity
  for (let i = 2; i < p.length; i += 2) {
    const ax = p[i - 2], az = p[i - 1], dx = p[i] - ax, dz = p[i + 1] - az, L = dx * dx + dz * dz
    const t = L ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L)) : 0
    m = Math.min(m, Math.hypot(ax + t * dx - x, az + t * dz - z))
  }
  return m
}

/** fields: open land cells closed by roads and field edges (0.3 to 40 ha), outlined */
export function fieldCells(lines: number[][], lvl: Int16Array, role: Int16Array, w: number, h: number, mpp: number, drawn?: Uint8Array): ImgArea[] {
  if (!lines.length && !drawn) return []
  // walls: the vector lines, plus the drawn line pixels (they follow faint edges the vectors lost)
  const wall = drawn ? Uint8Array.from(drawn) : new Uint8Array(w * h)
  for (const p of lines) for (let i = 2; i < p.length; i += 2) {
    const ax = p[i - 2] / mpp, ay = h - p[i - 1] / mpp, bx = p[i] / mpp, by = h - p[i + 1] / mpp
    const n = Math.ceil(Math.hypot(bx - ax, by - ay) * 2) + 1
    for (let s = 0; s <= n; s++) {
      const x = Math.round(ax + ((bx - ax) * s) / n), y = Math.round(ay + ((by - ay) * s) / n)
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const nx = x + dx, ny = y + dy; if (nx >= 0 && ny >= 0 && nx < w && ny < h) wall[ny * w + nx] = 1 }
    }
  }
  // small gaps between the drawn edges are closed (a field is fenced even if the line stops short)
  const fence = closeMask(wall, w, h, Math.max(3, Math.round(20 / mpp)))
  const open = new Uint8Array(w * h), F = IMG_ROLES.indexOf('forest')
  for (let i = 0; i < w * h; i++) open[i] = !fence[i] && lvl[i] >= 0 && role[i] !== F ? 1 : 0
  const out: ImgArea[] = []
  for (const c of components4(open, w, h)) {
    const ha = (c.length * mpp * mpp) / 1e4
    if (ha < 0.3 || ha > 40) continue
    if (c.some((i) => { const x = i % w, y = (i - x) / w; return x === 0 || y === 0 || x === w - 1 || y === h - 1 })) continue
    // land closed by water (islands, banks) is not a field
    if (c.some((i) => lvl[i - 1] < 0 || lvl[i + 1] < 0 || lvl[i - w] < 0 || lvl[i + w] < 0)) continue
    const m = new Uint8Array(w * h)
    for (const i of c) m[i] = 1
    for (const a of outlines(m, w, h, mpp, 2000)) out.push({ kind: 'field', ...a })
  }
  return out
}

/** a line pixel lying on the edge between two land levels: a contour line, not a road */
function onContour(lvl: Int16Array, w: number, h: number, i: number, r = 2): boolean {
  const x = i % w, y = (i - x) / w
  let lo = 1e9, hi = -1e9
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    const nx = x + dx, ny = y + dy
    if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
    const v = lvl[ny * w + nx]
    if (v < 0) continue
    if (v < lo) lo = v
    if (v > hi) hi = v
  }
  return hi > lo
}

/** hatching (out-of-bounds borders): straight strokes with parallel strokes beside them; flags per line */
export function hatchStrokes(lines: number[][], near = 40, minParallel = 2): boolean[] {
  const info = lines.map((l) => {
    const n = l.length / 2, dx = l[(n - 1) * 2] - l[0], dy = l[(n - 1) * 2 + 1] - l[1], d = Math.hypot(dx, dy)
    return { mx: (l[0] + l[(n - 1) * 2]) / 2, my: (l[1] + l[(n - 1) * 2 + 1]) / 2, ux: dx / (d || 1), uy: dy / (d || 1), straight: d > 5 && d / plen(l) > 0.93 }
  })
  const cell = near, grid = new Map<number, number[]>()
  const gk = (x: number, y: number) => Math.floor(y / cell) * 100000 + Math.floor(x / cell)
  info.forEach((a, k) => { if (!a.straight) return; const key = gk(a.mx, a.my); const l = grid.get(key); if (l) l.push(k); else grid.set(key, [k]) })
  return info.map((a, k) => {
    if (!a.straight) return false
    let par = 0
    for (let gy = -1; gy <= 1; gy++) for (let gx = -1; gx <= 1; gx++) for (const j of grid.get(gk(a.mx + gx * cell, a.my + gy * cell)) ?? []) {
      if (j === k) continue
      const b = info[j], vx = b.mx - a.mx, vy = b.my - a.my
      if (Math.hypot(vx, vy) > near || Math.abs(a.ux * b.ux + a.uy * b.uy) < 0.96) continue
      if (Math.abs(vx * a.uy - vy * a.ux) > 2.5) par++
    }
    return par >= minParallel
  })
}

/** out-of-bounds zone: where thin lines cover a large share of the ground (hatching), as 0/1 per pixel */
export function hatchZone(m: Uint8Array, w: number, h: number, r = 18, share = 0.06): Uint8Array {
  // skeleton density: a thick mark (bridge, church) counts like one line
  const d = density(thin(m, w, h), w, h, r), dense = new Uint8Array(w * h)
  for (let i = 0; i < w * h; i++) dense[i] = d[i] > share ? 1 : 0
  // wide patches only (a village or a crossing is small), grown a little to cover the patch edge
  const core = openMask(dense, w, h, r * 1.2)
  for (const c of components(core, w, h)) if (c.length < 0.02 * w * h) for (const i of c) core[i] = 0
  const e = edt(core, w, h), zone = new Uint8Array(w * h)
  for (let i = 0; i < w * h; i++) zone[i] = e[i] <= r ? 1 : 0
  return zone
}

/** dark blobs -> buildings: centre, main axis, length / width, nearest vanilla footprint */
export function extractBuildings(m: Uint8Array, w: number, h: number, mpp: number, catalogue: Building[] = HOUSES): ImgBuilding[] {
  const filled = fillHoles(m, w, h)
  const out: ImgBuilding[] = []
  for (const comp of components(filled, w, h)) {
    const area = comp.length * mpp * mpp
    if (area < 10 || area > 3000 || comp.length < 3) continue
    let sx = 0, sy = 0
    for (const i of comp) { sx += i % w; sy += Math.floor(i / w) }
    const cx = sx / comp.length, cy = sy / comp.length
    let xx = 0, yy = 0, xy = 0
    for (const i of comp) { const dx = (i % w) - cx, dy = Math.floor(i / w) - cy; xx += dx * dx; yy += dy * dy; xy += dx * dy }
    xx /= comp.length; yy /= comp.length; xy /= comp.length
    const tr = xx + yy, det = xx * yy - xy * xy, disc = Math.sqrt(Math.max(0, tr * tr / 4 - det))
    const l1 = tr / 2 + disc, l2 = Math.max(0, tr / 2 - disc)
    const len = Math.sqrt(12 * l1 + 1) * mpp, wid = Math.sqrt(12 * l2 + 1) * mpp
    if (len / wid > 5) continue // dashes, bridges, line pieces
    // main axis in pixels -> world (y down -> z up)
    const ang = 0.5 * Math.atan2(2 * xy, xx - yy), ax = Math.cos(ang), az = -Math.sin(ang)
    const b = nearestBuilding(len, wid, catalogue)
    if (!b) continue
    const bx = b.maxX - b.minX, bz = b.maxZ - b.minZ
    let yaw = bz >= bx ? Math.atan2(ax, az) : Math.atan2(-az, ax)
    yaw = Math.round((((yaw * 180) / Math.PI) % 360 + 360) % 360)
    const a = (yaw * Math.PI) / 180, s = Math.sin(a), c = Math.cos(a)
    const lx = (b.minX + b.maxX) / 2, lz = (b.minZ + b.maxZ) / 2
    const wx = cx * mpp, wz = (h - cy) * mpp
    const x = wx - (lx * c + lz * s), z = wz - (-lx * s + lz * c)
    const corners: number[] = []
    for (const [px, pz] of [[b.minX, b.minZ], [b.maxX, b.minZ], [b.maxX, b.maxZ], [b.minX, b.maxZ]]) corners.push(x + px * c + pz * s, z - px * s + pz * c)
    out.push({ x: Math.round(x * 100) / 100, z: Math.round(z * 100) / 100, yaw, prefab: b.prefab, cat: b.cat, corners, len, wid })
  }
  return out
}
const HOUSES = BUILDINGS.filter((b) => b.cat === 'houseS' || b.cat === 'houseM' || b.cat === 'houseL' || b.cat === 'farm' || b.cat === 'shed' || b.cat === 'civic')
/** catalogue building whose footprint (long side, short side) is closest to len x wid metres */
export function nearestBuilding(len: number, wid: number, catalogue: Building[] = HOUSES): Building | null {
  let best: Building | null = null, bd = Infinity
  for (const b of catalogue) {
    const a = b.maxX - b.minX, c = b.maxZ - b.minZ, L = Math.max(a, c), W = Math.min(a, c)
    const d = Math.abs(Math.log(L / len)) + Math.abs(Math.log(W / wid))
    if (d < bd) { bd = d; best = b }
  }
  return best
}

/** mask -> world outlines (cells of ~4 px), simplified */
function outlines(m: Uint8Array, w: number, h: number, mpp: number, minArea: number): { pts: number[]; holes: number[][] }[] {
  const cell = Math.max(1, Math.round(Math.max(w, h) / 250))
  const cols = Math.ceil(w / cell), rows = Math.ceil(h / cell), g = new Uint8Array(cols * rows)
  // cell grid row 0 = bottom (south)
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    let on = 0, n = 0
    for (let y = 0; y < cell; y++) for (let x = 0; x < cell; x++) {
      const px = c * cell + x, py = h - 1 - (r * cell + y)
      if (px >= w || py < 0) continue
      n++; on += m[py * w + px]
    }
    g[r * cols + c] = n && on * 2 >= n ? 1 : 0
  }
  const cm = cell * mpp
  return maskOutlines(g, cols, rows, cm, 0, 0, minArea).map((o) => ({ pts: closedSimplify(o.pts, cm * 0.8), holes: o.holes.map((p) => closedSimplify(p, cm * 0.8)).filter((p) => p.length >= 6) })).filter((o) => o.pts.length >= 6)
}
const closedSimplify = (p: number[], eps: number) => { const s = simplify([...p, p[0], p[1]], eps); return smoothRing(s.slice(0, -2), 2) }
/** closed ring rounded by Chaikin corner cutting (no stair steps left from the pixel grid) */
export function smoothRing(p: number[], passes: number): number[] {
  let r = p
  for (let k = 0; k < passes; k++) {
    const n = r.length / 2, o: number[] = []
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n, ax = r[i * 2], az = r[i * 2 + 1], bx = r[j * 2], bz = r[j * 2 + 1]
      o.push(0.75 * ax + 0.25 * bx, 0.75 * az + 0.25 * bz, 0.25 * ax + 0.75 * bx, 0.25 * az + 0.75 * bz)
    }
    r = o
  }
  return r.map((v) => Math.round(v * 10) / 10)
}

/** water mask -> rivers (long, narrow bodies: centre line + width) and lakes (outlines) */
export function extractWater(m: Uint8Array, w: number, h: number, mpp: number): ImgWater[] {
  const out: ImgWater[] = []
  const inv = new Uint8Array(w * h)
  for (let i = 0; i < w * h; i++) inv[i] = m[i] ? 0 : 1
  const half = edt(inv, w, h)
  for (const comp of components(m, w, h)) {
    if (comp.length * mpp * mpp < 400) continue
    const cm = new Uint8Array(w * h)
    for (const i of comp) cm[i] = 1
    // centre line: skeleton of the smoothed body, longest path first
    const sk = thin(closeMask(cm, w, h, 2), w, h)
    const paths = longestPaths(sk, w, h, half)
    let hw: number[] = []
    for (const p of paths) for (let i = 0; i < p.length; i += 2) hw.push(half[p[i + 1] * w + p[i]])
    hw = hw.filter(Number.isFinite).sort((a, b) => a - b)
    const widthM = (hw.length ? 2 * hw[hw.length >> 1] : 2) * mpp
    const main = paths[0], mainLen = main ? plen(main) * mpp : 0
    // elongated body (length > 3 x width): river, whatever its width; compact blob: lake
    if (main && mainLen > 3 * widthM) {
      // a lake swelling along the river (picture 119 east of the town, ~200 m across a 100 m river): the ribbon
      // only covers the river width, the swelling (parts wider than 1.8 x the median width, 2.5 ha+; picture 120 south tail was a flat plain 0.3-0.8 m over the sea, dark in game) becomes a lake
      const r = Math.max(2, 1.8 * (hw.length ? hw[hw.length >> 1] : 1))
      const core = new Uint8Array(w * h)
      let nCore = 0
      for (const i of comp) if (half[i] > r) { core[i] = 1; nCore++ }
      const bulge = new Uint8Array(w * h)
      if (nCore) {
        const dc = edt(core, w, h), raw = new Uint8Array(w * h)
        for (const i of comp) if (dc[i] <= r) raw[i] = 1
        // only the swellings kept as lakes cut the river
        for (const c of components(raw, w, h)) if (c.length * mpp * mpp >= 25000) for (const i of c) bulge[i] = 1
      }
      // the lake takes the river channel along the swelling too (the swelling alone left the ribbon running along its
      // edge, half over the lake), and the ribbon stops a few metres inside it: round 11, the ribbon under the lake
      // showed as straight dark bands and mottled patches (119, 120)
      if (bulge.some((v) => v)) {
        const toLake = edt(bulge, w, h), D = 2.2 * (hw.length ? hw[hw.length >> 1] : 1) + 1
        for (const i of comp) if (toLake[i] <= D) bulge[i] = 1
      }
      const riverOnly = new Uint8Array(w * h)
      for (const i of comp) if (!bulge[i]) riverOnly[i] = 1
      const toRiver = edt(riverOnly, w, h)
      const ov = Math.max(2, 6 / mpp)
      for (const p of paths) {
        if (p !== main && plen(p) * mpp < Math.max(60, 2 * widthM)) continue
        const runs: number[][] = []
        let cur: number[] = []
        for (let i = 0; i < p.length; i += 2) {
          const k = Math.round(p[i + 1]) * w + Math.round(p[i])
          if (!bulge[k] || toRiver[k] <= ov) cur.push(p[i], p[i + 1])
          else { if (cur.length) runs.push(cur); cur = [] }
        }
        if (cur.length) runs.push(cur)
        for (const run of runs) {
          if (run.length < 4 || plen(run) * mpp < Math.max(20, widthM)) continue
          const sp = simplify(run, 1.5), widths: number[] = []
          for (let i = 0; i < sp.length; i += 2) widths.push(Math.round(Math.max(4, 2 * localHalf(half, w, h, sp[i], sp[i + 1]) * mpp)))
          const sorted = [...widths].sort((a, b) => a - b)
          out.push({ kind: 'river', pts: toWorld(sp, mpp, h), width: sorted[sorted.length >> 1], widths })
        }
      }
      if (bulge.some((v) => v)) for (const o of outlines(bulge, w, h, mpp, 25000)) out.push({ kind: 'lake', pts: o.pts, width: 0, onRiver: true })
    } else for (const o of outlines(cm, w, h, mpp, 400)) out.push({ kind: 'lake', pts: o.pts, width: 0 })
  }
  return out
}

/** half width of water around a centre line pixel: the largest inside distance within 2 px (the skeleton may sit a pixel off) */
function localHalf(half: Float32Array, w: number, h: number, x: number, y: number): number {
  let m = 0
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
    const nx = Math.round(x) + dx, ny = Math.round(y) + dy
    if (nx >= 0 && ny >= 0 && nx < w && ny < h && Number.isFinite(half[ny * w + nx])) m = Math.max(m, half[ny * w + nx])
  }
  return m || 1
}

/** skeleton -> its long branches: longest path, then the longest branches off it (pixel polylines) */
function longestPaths(sk: Uint8Array, w: number, h: number, half: Float32Array): number[][] {
  const pix: number[] = []
  for (let i = 0; i < w * h; i++) if (sk[i]) pix.push(i)
  if (!pix.length) return []
  const nb = (i: number) => {
    const x = i % w, y = (i - x) / w, r: number[] = []
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue
      const nx = x + dx, ny = y + dy
      if (nx >= 0 && ny >= 0 && nx < w && ny < h && sk[ny * w + nx]) r.push(ny * w + nx)
    }
    return r
  }
  const taken = new Uint8Array(w * h)
  const bfs = (starts: number[]) => {
    const dist = new Map<number, number>(), prev = new Map<number, number>()
    const q = [...starts]
    starts.forEach((s) => dist.set(s, 0))
    for (let k = 0; k < q.length; k++) {
      const i = q[k]
      for (const j of nb(i)) if (!dist.has(j) && !taken[j]) { dist.set(j, dist.get(i)! + 1); prev.set(j, i); q.push(j) }
    }
    let far = starts[0], fd = 0
    for (const [i, d] of dist) if (d > fd) { fd = d; far = i }
    return { far, fd, prev }
  }
  const path = (from: number, prev: Map<number, number>) => { const p: number[] = []; for (let v: number | undefined = from; v !== undefined; v = prev.get(v)) p.push(v % w, Math.floor(v / w)); return p }
  const out: number[][] = []
  const a = bfs([pix[0]]).far, b = bfs([a])
  const main = path(b.far, b.prev)
  out.push(main)
  for (let i = 0; i < main.length; i += 2) taken[main[i + 1] * w + main[i]] = 1
  // branches: grow from the taken path, keep the long ones
  for (let k = 0; k < 4; k++) {
    const starts: number[] = []
    for (let i = 0; i < w * h; i++) if (taken[i]) for (const j of nb(i)) if (!taken[j]) starts.push(j)
    if (!starts.length) break
    const r = bfs(starts)
    const p = path(r.far, r.prev)
    const minLen = 6 * (half[r.far] || 2)
    if (p.length / 2 < minLen) break
    out.push(p)
    for (let i = 0; i < p.length; i += 2) taken[p[i + 1] * w + p[i]] = 1
  }
  return out
}

/** vanilla road class from the drawn line thickness, relative to the map's typical road */
export function roadClass(width: number, median: number, kind: 'road' | 'path'): 'asphalt' | 'asphaltNarrow' | 'dirt' | 'trailDirt' {
  if (kind === 'path') return 'trailDirt'
  if (width >= median * 1.35) return 'asphalt'
  if (width >= median * 0.75) return 'asphaltNarrow'
  return 'dirt'
}

/** small preview: every pixel painted with its role colour */
export const ROLE_COLOURS: Record<ImgRole, [number, number, number]> = {
  land: [196, 200, 170], water: [70, 130, 200], band: [200, 140, 110], forest: [60, 120, 60], field: [210, 190, 110], hedge: [90, 140, 60],
  building: [30, 30, 30], road: [120, 120, 120], path: [150, 110, 70], ignore: [255, 0, 255],
}
export { rgbToLab }

/** heights of a non-square picture padded into a square (edge rows / columns repeated at the top and the right),
 *  so the picture keeps its world position: x = px * m, z = (h - py) * m */
export function squareHeights(hm: { w: number; h: number; data: Float32Array }): { w: number; h: number; data: Float32Array; normalized: false } {
  const n = Math.max(hm.w, hm.h), out = new Float32Array(n * n), top = n - hm.h
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) out[y * n + x] = hm.data[Math.max(0, y - top) * hm.w + Math.min(hm.w - 1, x)]
  return { w: n, h: n, data: out, normalized: false }
}

/** true when (x, z) is in a water body of the picture or closer than `margin` m to its bank
 *  (river: half its local width; lake: inside the ring or near its edge) */
export function inImageWater(waters: ImgWater[], x: number, z: number, margin = 6): boolean {
  for (const w of waters) {
    const p = w.pts, n = p.length / 2
    if (w.kind === 'lake') {
      let ins = false
      for (let i = 0, j = n - 1; i < n; j = i++) {
        const xi = p[i * 2], zi = p[i * 2 + 1], xj = p[j * 2], zj = p[j * 2 + 1]
        if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) ins = !ins
      }
      if (ins) return true
    }
    for (let i = 0; i + 1 < n; i++) {
      const ax = p[i * 2], az = p[i * 2 + 1], dx = p[i * 2 + 2] - ax, dz = p[i * 2 + 3] - az, L2 = dx * dx + dz * dz || 1
      const t = Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / L2))
      const half = w.kind === 'river' ? Math.max(w.widths?.[i] ?? w.width, w.widths?.[i + 1] ?? w.width) / 2 : 0
      if (Math.hypot(x - ax - dx * t, z - az - dz * t) < half + margin) return true
    }
  }
  return false
}

/** drawn buildings off the roads as sent (vanilla carriageway half widths, roads after the water split have the
 *  same lines): a footprint reaching into a carriageway (+ `clear` m) is pushed out across the road by up to
 *  `maxShift` m, else left out. Picture 120: a shed 1.3 m and a house 2 m from a road centre line */
export function clearOfRoads<B extends { x: number; z: number; corners: number[] }>(list: B[], roads: { pts: number[]; half: number }[], clear = 1, maxShift = 8): B[] {
  const segs: { ax: number; az: number; bx: number; bz: number; half: number }[] = []
  for (const r of roads) for (let i = 0; i + 3 < r.pts.length; i += 2) segs.push({ ax: r.pts[i], az: r.pts[i + 1], bx: r.pts[i + 2], bz: r.pts[i + 3], half: r.half })
  const near = (x: number, z: number) => {
    // deepest reach into a carriageway at (x, z): depth and the way out (unit vector from the road)
    let depth = 0, nx = 0, nz = 0
    for (const s of segs) {
      const dx = s.bx - s.ax, dz = s.bz - s.az, L2 = dx * dx + dz * dz || 1
      const t = Math.max(0, Math.min(1, ((x - s.ax) * dx + (z - s.az) * dz) / L2))
      const px = s.ax + dx * t, pz = s.az + dz * t, d = Math.hypot(x - px, z - pz)
      const p = s.half + clear - d
      if (p > depth) {
        depth = p
        if (d > 0.01) { nx = (x - px) / d; nz = (z - pz) / d } else { const L = Math.sqrt(L2); nx = -dz / L; nz = dx / L }
      }
    }
    return { depth, nx, nz }
  }
  const out: B[] = []
  for (const b of list) {
    let ox = 0, oz = 0, ok = false
    for (let it = 0; it < 6; it++) {
      const c = b.corners, pts: number[] = [b.x + ox, b.z + oz]
      for (let i = 0; i + 1 < c.length; i += 2) {
        const j = (i + 2) % c.length
        pts.push(c[i] + ox, c[i + 1] + oz, (c[i] + c[j]) / 2 + ox, (c[i + 1] + c[j + 1]) / 2 + oz)
      }
      // the centre's way out wins (a road through the house: the house goes to the side it mostly stands on)
      let worst = { depth: 0, nx: 0, nz: 0 }
      for (let i = 0; i < pts.length; i += 2) { const q = near(pts[i], pts[i + 1]); if (q.depth > worst.depth) worst = q }
      if (worst.depth <= 0.01) { ok = true; break }
      const ctr = near(b.x + ox, b.z + oz)
      const nx = ctr.depth > 0 ? ctr.nx : worst.nx, nz = ctr.depth > 0 ? ctr.nz : worst.nz
      ox += nx * (worst.depth + 0.05); oz += nz * (worst.depth + 0.05)
      if (Math.hypot(ox, oz) > maxShift) break
    }
    if (!ok) continue
    if (!ox && !oz) { out.push(b); continue }
    const r2 = (v: number) => Math.round(v * 100) / 100
    out.push({ ...b, x: r2(b.x + ox), z: r2(b.z + oz), corners: b.corners.map((v, i) => r2(v + (i % 2 ? oz : ox))) })
  }
  return out
}
