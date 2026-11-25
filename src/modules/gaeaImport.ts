// Import a relief made in Gaea (QuadSpinner) or any terrain tool: heightmap as 16-bit greyscale PNG,
// RAW .r16 (unsigned 16-bit little endian, square) or .r32 (float 32 little endian, square), plus optional
// greyscale PNG masks (Gaea Flow / Wear / Deposits outputs, or a mask named after a surface).
// Images are north-up (row 0 = north); the terrain grid is row 0 = south (island.ts), so rows are flipped.
import { readPng16 } from './dem'
import { paintByPriority } from './paintPriority'
import { limitPerBlock, type Grid, type SurfaceGrid } from './island'
import type { ReliefMasks } from './gaeaRelief'

export interface HeightImage { w: number; h: number; data: Float32Array; /** values 0..1, need min/max heights */ normalized: boolean }

function square(n: number, what: string) {
  const s = Math.round(Math.sqrt(n))
  if (s * s !== n || s < 2) throw new Error(`${what}: ${n} samples is not a square heightmap`)
  return s
}

/** RAW unsigned 16-bit, little endian (Gaea / World Machine / Unity .r16), 0..1 */
export function readR16(buf: ArrayBuffer, bigEndian = false): HeightImage {
  const v = new DataView(buf), n = Math.floor(buf.byteLength / 2), s = square(n, 'r16')
  const data = new Float32Array(n)
  for (let i = 0; i < n; i++) data[i] = v.getUint16(i * 2, !bigEndian) / 65535
  return { w: s, h: s, data, normalized: true }
}

/** RAW float 32, little endian (.r32). Values within 0..1 are taken as normalised, else as metres. */
export function readR32(buf: ArrayBuffer): HeightImage {
  const v = new DataView(buf), n = Math.floor(buf.byteLength / 4), s = square(n, 'r32')
  const data = new Float32Array(n)
  let lo = Infinity, hi = -Infinity
  for (let i = 0; i < n; i++) { const x = v.getFloat32(i * 4, true); data[i] = x; if (x < lo) lo = x; if (x > hi) hi = x }
  return { w: s, h: s, data, normalized: lo >= -1e-4 && hi <= 1 + 1e-4 }
}

export async function readPngImage(buf: ArrayBuffer, name = 'png'): Promise<HeightImage> {
  const d = await readPng16(buf, name)
  return { w: d.w, h: d.h, data: d.data, normalized: true }
}

/** heightmap file by extension: .png (8/16-bit greyscale), .r16 / .raw (16-bit), .r32 */
export async function readHeightFile(name: string, buf: ArrayBuffer): Promise<HeightImage> {
  if (/\.png$/i.test(name)) return readPngImage(buf, name)
  if (/\.(r16|raw)$/i.test(name)) return readR16(buf)
  if (/\.r32$/i.test(name)) return readR32(buf)
  throw new Error(`unsupported heightmap: ${name} (16-bit PNG, .r16, .raw or .r32)`)
}

/** bilinear sample of the image at grid vertex (c, r), image stretched over the whole grid, north up */
function resample(img: HeightImage, cols: number, rows: number): Float32Array {
  const out = new Float32Array(cols * rows)
  for (let r = 0; r < rows; r++) {
    const y = (1 - r / (rows - 1)) * (img.h - 1)
    const y0 = Math.floor(y), y1 = Math.min(img.h - 1, y0 + 1), fy = y - y0
    for (let c = 0; c < cols; c++) {
      const x = (c / (cols - 1)) * (img.w - 1)
      const x0 = Math.floor(x), x1 = Math.min(img.w - 1, x0 + 1), fx = x - x0
      const a = img.data[y0 * img.w + x0] + (img.data[y0 * img.w + x1] - img.data[y0 * img.w + x0]) * fx
      const b = img.data[y1 * img.w + x0] + (img.data[y1 * img.w + x1] - img.data[y1 * img.w + x0]) * fx
      out[r * cols + c] = a + (b - a) * fy
    }
  }
  return out
}

export interface GaeaImportOptions {
  /** world side in metres */
  size: number
  /** grid step in metres; default max(4, size / 512) like the generated island */
  step?: number
  /** heights of black and white (normalised images); sea level is 0, so a negative min makes sea */
  minHeight: number
  maxHeight: number
}

/** heightmap -> terrain heights on the grid (WorldExport shape, used by useWorld in main.ts) */
export function heightsFromImage(img: HeightImage, o: GaeaImportOptions) {
  const step = o.step ?? Math.max(4, o.size / 512)
  const cols = Math.floor(o.size / step) + 1, rows = cols
  const v = resample(img, cols, rows)
  const heights: number[] = new Array(cols * rows)
  for (let i = 0; i < v.length; i++) heights[i] = img.normalized ? o.minHeight + v[i] * (o.maxHeight - o.minHeight) : v[i]
  return { minX: 0, minZ: 0, step, cols, rows, ocean: 0, heights, materials: [] as string[], surfaces: [] as number[] }
}

/** a mask image (0..1) on the grid */
export function maskOnGrid(img: HeightImage, grid: Pick<Grid, 'cols' | 'rows'>): Float32Array {
  const m = resample(img, grid.cols, grid.rows)
  for (let i = 0; i < m.length; i++) m[i] = Math.min(1, Math.max(0, m[i]))
  return m
}

/** what a mask file is, from its name: a Gaea relief output or a surface name (e.g. Rock_01.png) */
export function maskKind(fileName: string): 'flow' | 'wear' | 'deposits' | { surface: string } {
  const base = fileName.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '')
  if (/flow/i.test(base)) return 'flow'
  if (/wear/i.test(base)) return 'wear'
  if (/deposit/i.test(base)) return 'deposits'
  return { surface: base }
}

export interface SurfaceMask { name: string; weights: Float32Array }

/** relief masks from the imported ones; a missing one is all zero */
export function reliefMasks(n: number, got: Partial<ReliefMasks>): ReliefMasks {
  const z = () => new Float32Array(n)
  return { flow: got.flow ?? z(), wear: got.wear ?? z(), deposits: got.deposits ?? z() }
}

/** paint imported surface masks over computed surfaces: the mask takes its weight, the others share the rest;
 *  where two masks overlap the higher surface priority wins (SURFACE_PRIORITY) */
export function applySurfaceMasks(surfaces: SurfaceGrid[], masks: SurfaceMask[], colour?: (name: string) => void): SurfaceGrid[] {
  if (!masks.length || !surfaces.length) return surfaces
  // P2 #11: overlapping masks are resolved by surface priority (paintPriority.ts), not by file order
  paintByPriority(surfaces, masks, colour)
  limitPerBlock(surfaces)
  return surfaces
}
