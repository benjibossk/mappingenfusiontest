// Surface masks from the satellite image (idea: Jove Chiere, Reforger community Discord):
// quantise the photo to K colours, map each colour to a surface, export SurfaceGrid[] for POST /masks
// (same format as computeSurfaces) or an RGBA PNG where black = default surface, R/G/B/A = 4 others.
// Pure functions only: no DOM, no fetch. Image rows: row 0 = north (top); grids: row 0 = south.
import { limitPerBlock, type Grid, type SurfaceGrid } from './island'

export interface Rgba { width: number; height: number; data: Uint8ClampedArray | Uint8Array }
export interface Quantised { width: number; height: number; index: Uint8Array; palette: [number, number, number][]; lab: [number, number, number][]; share: number[] }
export interface QuantiseOptions { k?: number; blur?: number; median?: boolean; minRegion?: number; iterations?: number; maxSamples?: number }

// ---- colour space -------------------------------------------------------------------------------
const lin = (v: number) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }
const LIN = Array.from({ length: 256 }, (_, i) => lin(i))
const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116)
export function rgbToLab(r: number, g: number, b: number): [number, number, number] {
  const R = LIN[r | 0], G = LIN[g | 0], B = LIN[b | 0]
  const x = f((0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047)
  const y = f(0.2126 * R + 0.7152 * G + 0.0722 * B)
  const z = f((0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883)
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)]
}

// ---- pre-filters --------------------------------------------------------------------------------
//! box blur (radius px, separable, RGB only)
export function boxBlur(img: Rgba, radius: number): Rgba {
  const { width: w, height: h } = img
  if (radius < 1) return img
  const tmp = new Float32Array(w * h * 3), out = new Uint8ClampedArray(img.data)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let ch = 0; ch < 3; ch++) {
    let s = 0, n = 0
    for (let d = -radius; d <= radius; d++) { const xx = x + d; if (xx >= 0 && xx < w) { s += img.data[(y * w + xx) * 4 + ch]; n++ } }
    tmp[(y * w + x) * 3 + ch] = s / n
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let ch = 0; ch < 3; ch++) {
    let s = 0, n = 0
    for (let d = -radius; d <= radius; d++) { const yy = y + d; if (yy >= 0 && yy < h) { s += tmp[(yy * w + x) * 3 + ch]; n++ } }
    out[(y * w + x) * 4 + ch] = Math.round(s / n)
  }
  return { width: w, height: h, data: out }
}

//! 3x3 median per channel (removes speckle: cars, small shadows)
export function median3(img: Rgba): Rgba {
  const { width: w, height: h } = img
  const out = new Uint8ClampedArray(img.data), v: number[] = []
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let ch = 0; ch < 3; ch++) {
    v.length = 0
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = Math.min(w - 1, Math.max(0, x + dx)), yy = Math.min(h - 1, Math.max(0, y + dy))
      v.push(img.data[(yy * w + xx) * 4 + ch])
    }
    v.sort((a, b) => a - b)
    out[(y * w + x) * 4 + ch] = v[4]
  }
  return { width: w, height: h, data: out }
}

// ---- k-means ------------------------------------------------------------------------------------
//! Deterministic k-means in CIELAB (k-means++ seeding with a fixed LCG, stride sampling).
export function quantise(src: Rgba, o: QuantiseOptions = {}): Quantised {
  const k = Math.max(1, Math.min(o.k ?? 5, 8))
  let img = src
  if (o.median) img = median3(img)
  if (o.blur) img = boxBlur(img, Math.round(o.blur))
  const { width: w, height: h } = img, N = w * h
  const L = new Float32Array(N * 3)
  for (let i = 0; i < N; i++) { const p = rgbToLab(img.data[i * 4], img.data[i * 4 + 1], img.data[i * 4 + 2]); L[i * 3] = p[0]; L[i * 3 + 1] = p[1]; L[i * 3 + 2] = p[2] }
  const stride = Math.max(1, Math.floor(N / (o.maxSamples ?? 40000)))
  const sample: number[] = []
  for (let i = 0; i < N; i += stride) sample.push(i)
  let s = 12345
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296)
  const d2 = (i: number, c: number[]) => { const a = L[i * 3] - c[0], b = L[i * 3 + 1] - c[1], e = L[i * 3 + 2] - c[2]; return a * a + b * b + e * e }
  const cent: number[][] = [[L[sample[0] * 3], L[sample[0] * 3 + 1], L[sample[0] * 3 + 2]]]
  const best = sample.map((i) => d2(i, cent[0]))
  while (cent.length < k) {
    const tot = best.reduce((a, b) => a + b, 0)
    let t = rnd() * tot, j = 0
    while (j < sample.length - 1 && (t -= best[j]) > 0) j++
    const i = sample[j]
    const c = [L[i * 3], L[i * 3 + 1], L[i * 3 + 2]]
    cent.push(c)
    sample.forEach((p, q) => { best[q] = Math.min(best[q], d2(p, c)) })
  }
  const nearest = (i: number) => { let m = 0, md = Infinity; for (let c = 0; c < cent.length; c++) { const d = d2(i, cent[c]); if (d < md) { md = d; m = c } } return m }
  for (let it = 0; it < (o.iterations ?? 20); it++) {
    const acc = cent.map(() => [0, 0, 0, 0])
    for (const i of sample) { const a = acc[nearest(i)]; a[0] += L[i * 3]; a[1] += L[i * 3 + 1]; a[2] += L[i * 3 + 2]; a[3]++ }
    let moved = 0
    acc.forEach((a, c) => { if (a[3]) { const n = [a[0] / a[3], a[1] / a[3], a[2] / a[3]]; moved += Math.abs(n[0] - cent[c][0]) + Math.abs(n[1] - cent[c][1]) + Math.abs(n[2] - cent[c][2]); cent[c] = n } })
    if (moved < 0.01) break
  }
  // stable order: dark to light, then by index (palette is deterministic and readable)
  const order = cent.map((_, i) => i).sort((a, b) => cent[a][0] - cent[b][0] || a - b)
  const sorted = order.map((i) => cent[i])
  cent.splice(0, cent.length, ...sorted)
  let index: Uint8Array = new Uint8Array(N)
  for (let i = 0; i < N; i++) index[i] = nearest(i)
  if (o.minRegion && o.minRegion > 0) index = majority(index, w, h, cent.length, o.minRegion)
  // palette = mean original sRGB per cluster
  const sum = cent.map(() => [0, 0, 0, 0])
  for (let i = 0; i < N; i++) { const a = sum[index[i]]; a[0] += src.data[i * 4]; a[1] += src.data[i * 4 + 1]; a[2] += src.data[i * 4 + 2]; a[3]++ }
  const palette = sum.map((a) => (a[3] ? [Math.round(a[0] / a[3]), Math.round(a[1] / a[3]), Math.round(a[2] / a[3])] : [0, 0, 0]) as [number, number, number])
  return { width: w, height: h, index, palette, lab: palette.map((p) => rgbToLab(p[0], p[1], p[2])), share: sum.map((a) => a[3] / N) }
}

//! Majority filter: `passes` of a 3x3 mode (radius grows with minRegion px), removes islands smaller than ~minRegion.
export function majority(index: Uint8Array, w: number, h: number, k: number, minRegion: number): Uint8Array {
  const r = Math.max(1, Math.round(Math.sqrt(minRegion) / 2))
  let cur = index
  for (let pass = 0; pass < 2; pass++) {
    const out = new Uint8Array(cur.length), cnt = new Int32Array(k)
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      cnt.fill(0)
      for (let dy = -r; dy <= r; dy++) { const yy = y + dy; if (yy < 0 || yy >= h) continue; for (let dx = -r; dx <= r; dx++) { const xx = x + dx; if (xx >= 0 && xx < w) cnt[cur[yy * w + xx]]++ } }
      let m = cur[y * w + x]
      for (let c = 0; c < k; c++) if (cnt[c] > cnt[m]) m = c
      out[y * w + x] = m
    }
    cur = out
  }
  return cur
}

// ---- surface suggestion -------------------------------------------------------------------------
//! Guess a vanilla surface from a cluster colour (CIELAB). The caller may override every entry.
export function suggestSurface([L, a, b]: [number, number, number]): string {
  const chroma = Math.hypot(a, b), hue = (Math.atan2(b, a) * 180) / Math.PI
  if (b < -12 && a < 10) return 'SeaBed_01' // blue: water
  if (L < 22) return chroma < 12 ? 'Rock_01' : 'ForestConiferous_01_Base' // very dark: shadow/rock or dense forest
  if (chroma < 10) return L > 55 ? 'Concrete_01' : 'Rock_01' // grey: urban / asphalt / rock
  if (a < -4 && hue > 95) return L < 45 ? 'ForestDeciduous_01_Base' : 'Grass_01' // green
  if (L > 55 && b > 12) return 'Crop_Field_01' // light yellow/beige
  return 'Dirt_01' // brown
}
export const suggestSurfaces = (q: Quantised) => q.lab.map(suggestSurface)

// ---- grid sampling and vector overrides ---------------------------------------------------------
export interface SatMaskOptions {
  /** world box covered by the image (metres); default = the grid box */
  bounds?: { minX: number; minZ: number; maxX: number; maxZ: number }
  /** surface per cluster (default suggestSurfaces) */
  surfaces?: string[]
  /** forced surface per grid cell ('' = none), e.g. rasterised OSM roads / water; wins over pixels */
  override?: (string | '')[]
  /** WorldCover code per cell (cover.ts codes 1..7): tie-breaks pixels whose cluster is ambiguous */
  cover?: Uint8Array
  coverSurface?: string[]
  /** neighbourhood (px) averaged per cell, default = one cell footprint */
  footprint?: number
  blockSize?: number
  maxPerBlock?: number
}
const COVER_OF = ['', 'ForestDeciduous_01_Base', 'ForestConiferous_01_Base', 'ForestDeciduous_01_Base', 'Crop_Field_01', 'Heather_01', 'Concrete_01', 'Dirt_01']

//! Per-surface weights on `grid` from the quantised image (fraction of pixels of each cluster under
//! each vertex), vector overrides on top, then limitPerBlock. Same output as computeSurfaces.
export function satelliteSurfaces(q: Quantised, grid: Grid, o: SatMaskOptions = {}): SurfaceGrid[] {
  const { cols, rows, step, minX, minZ } = grid
  const bx = o.bounds ?? { minX, minZ, maxX: minX + (cols - 1) * step, maxZ: minZ + (rows - 1) * step }
  const surf = o.surfaces ?? suggestSurfaces(q)
  const names: string[] = []
  const id = (n: string) => { let i = names.indexOf(n); if (i < 0) { i = names.length; names.push(n) } return i }
  const clusterId = surf.map(id)
  const coverMap = o.coverSurface ?? COVER_OF
  const pxX = q.width / Math.max(1e-6, bx.maxX - bx.minX), pxZ = q.height / Math.max(1e-6, bx.maxZ - bx.minZ)
  const rad = Math.max(0, Math.round(o.footprint ?? Math.min(pxX, pxZ) * step / 2))
  const cells: [number, number][][] = []
  const k = q.palette.length
  const cnt = new Float64Array(k)
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const i = r * cols + c
    const w = new Map<number, number>()
    const forced = o.override?.[i]
    if (forced) { w.set(id(forced), 1); cells.push(toArr(w)); continue }
    const x = (minX + c * step - bx.minX) * pxX, y = q.height - (minZ + r * step - bx.minZ) * pxZ
    const cx = Math.floor(x), cy = Math.floor(y)
    cnt.fill(0); let tot = 0
    for (let dy = -rad; dy <= rad; dy++) for (let dx = -rad; dx <= rad; dx++) {
      const xx = cx + dx, yy = cy + dy
      if (xx < 0 || yy < 0 || xx >= q.width || yy >= q.height) continue
      cnt[q.index[yy * q.width + xx]]++; tot++
    }
    if (!tot) { cells.push([]); continue }
    const cv = o.cover?.[i] ? coverMap[o.cover[i]] : ''
    for (let j = 0; j < k; j++) if (cnt[j]) {
      const s = clusterId[j]
      w.set(s, (w.get(s) ?? 0) + cnt[j] / tot)
    }
    // tie-break: when the top two surfaces are close (< 15 %), WorldCover decides
    if (cv) {
      const top = [...w.entries()].sort((a, b) => b[1] - a[1])
      if (top.length > 1 && top[0][1] - top[1][1] < 0.15) {
        const ci = id(cv)
        w.set(ci, (w.get(ci) ?? 0) + top[0][1] * 0.5)
        w.set(top[0][0], top[0][1] * 0.5)
      }
    }
    cells.push(toArr(w))
  }
  const out: SurfaceGrid[] = names.map((name) => ({ ...grid, name, weights: new Array(cols * rows).fill(0) }))
  cells.forEach((list, i) => { for (const [s, v] of list) out[s].weights[i] = v < 1 / 255 ? 0 : v })
  limitPerBlock(out, o.blockSize ?? 64, o.maxPerBlock ?? 4)
  return out.filter((s) => s.weights.some((v) => v > 0))
}
const toArr = (m: Map<number, number>) => [...m.entries()]

// ---- PNG export ---------------------------------------------------------------------------------
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0 } return t })()
function crc32(b: Uint8Array) { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
function adler(b: Uint8Array) { let a = 1, s = 0; for (const x of b) { a = (a + x) % 65521; s = (s + a) % 65521 } return ((s << 16) | a) >>> 0 }
//! Minimal PNG encoder (8-bit RGBA, stored deflate: no dependency, bigger files).
export function encodePng(w: number, h: number, rgba: Uint8Array): Uint8Array {
  const raw = new Uint8Array((w * 4 + 1) * h)
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; raw.set(rgba.subarray(y * w * 4, (y + 1) * w * 4), y * (w * 4 + 1) + 1) }
  const blocks = Math.ceil(raw.length / 65535) || 1
  const z = new Uint8Array(2 + raw.length + blocks * 5 + 4)
  z[0] = 0x78; z[1] = 0x01
  let p = 2
  for (let i = 0; i < blocks; i++) {
    const part = raw.subarray(i * 65535, Math.min(raw.length, (i + 1) * 65535))
    z[p++] = i === blocks - 1 ? 1 : 0
    z[p++] = part.length & 255; z[p++] = part.length >> 8; z[p++] = ~part.length & 255; z[p++] = (~part.length >> 8) & 255
    z.set(part, p); p += part.length
  }
  const ad = adler(raw); z[p++] = ad >>> 24; z[p++] = (ad >>> 16) & 255; z[p++] = (ad >>> 8) & 255; z[p++] = ad & 255
  const chunk = (type: string, data: Uint8Array) => {
    const c = new Uint8Array(12 + data.length), dv = new DataView(c.buffer)
    dv.setUint32(0, data.length); for (let i = 0; i < 4; i++) c[4 + i] = type.charCodeAt(i)
    c.set(data, 8); dv.setUint32(8 + data.length, crc32(c.subarray(4, 8 + data.length))); return c
  }
  const ihdr = new Uint8Array(13), dv = new DataView(ihdr.buffer)
  dv.setUint32(0, w); dv.setUint32(4, h); ihdr[8] = 8; ihdr[9] = 6
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', z), chunk('IEND', new Uint8Array())]
  const out = new Uint8Array(parts.reduce((a, b) => a + b.length, 0)); let o = 0
  for (const x of parts) { out.set(x, o); o += x.length }
  return out
}

//! Jove's format: `channels` = [R, G, B, A] surface names; any other weight = black/default.
//! Image row 0 = north. Returns PNG bytes + the legend for the Workbench import.
export function packRgbaMask(surfaces: SurfaceGrid[], channels: string[]): { png: Uint8Array; legend: Record<string, string> } {
  const { cols, rows } = surfaces[0]
  const px = new Uint8Array(cols * rows * 4)
  const ch = channels.slice(0, 4).map((n) => surfaces.find((s) => s.name === n))
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const i = r * cols + c, o = ((rows - 1 - r) * cols + c) * 4
    for (let k = 0; k < 4; k++) px[o + k] = Math.round(255 * Math.min(1, ch[k]?.weights[i] ?? 0))
  }
  const legend: Record<string, string> = { black: 'default (rest)' }
  ;['R', 'G', 'B', 'A'].forEach((k, j) => { if (channels[j]) legend[k] = channels[j] })
  return { png: encodePng(cols, rows, px), legend }
}

//! Preview: the quantised image painted with its palette (RGBA, image orientation).
export function previewRgba(q: Quantised): Uint8Array {
  const out = new Uint8Array(q.width * q.height * 4)
  for (let i = 0; i < q.index.length; i++) { const p = q.palette[q.index[i]]; out[i * 4] = p[0]; out[i * 4 + 1] = p[1]; out[i * 4 + 2] = p[2]; out[i * 4 + 3] = 255 }
  return out
}
