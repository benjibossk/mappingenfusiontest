// Real elevation data (DEM) to a Reforger heightmap. Reads GeoTIFF (Copernicus DEM, national LiDAR terrain
// models...), ESRI ASCII grid (.asc, e.g. IGN LiDAR HD / RGE ALTI), SRTM .hgt and 16-bit greyscale PNG.
// An "area" (centre, size in metres, rotation) is cut from the source and resampled on the terrain grid.
// Local frame of the area: metres, +X east, +Z north (before the area's rotation), origin at its centre.

import proj4 from 'proj4'
import { fromArrayBuffer } from 'geotiff'
import type { WorldExport } from '../bridge'

export interface Dem {
  name: string
  w: number
  h: number
  data: Float32Array
  nodata: number | null
  /** source coordinates of the centre of pixel (col, row): (x0 + col * dx, y0 + row * dy); dy < 0 = north up */
  x0: number
  y0: number
  dx: number
  dy: number
  /** 'EPSG:xxxx' or a proj4 string; null = no georeference (pixels of `dx` metres, no OpenStreetMap) */
  crs: string | null
  /** PNG: values are 0..1 and need a height range */
  normalized?: boolean
}

export interface Area {
  cx: number // centre, source coordinates
  cy: number
  size: number // side of the square, metres
  rot: number // degrees, the area's north turned clockwise
}

// --- projections ---
const DEFS: Record<string, string> = {
  'EPSG:2154': '+proj=lcc +lat_0=46.5 +lon_0=3 +lat_1=49 +lat_2=44 +x_0=700000 +y_0=6600000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs',
  'EPSG:27700': '+proj=tmerc +lat_0=49 +lon_0=-2 +k=0.9996012717 +x_0=400000 +y_0=-100000 +ellps=airy +towgs84=446.448,-125.157,542.06,0.15,0.247,0.842,-20.489 +units=m +no_defs',
  'EPSG:28992': '+proj=sterea +lat_0=52.15616055555555 +lon_0=5.38763888888889 +k=0.9999079 +x_0=155000 +y_0=463000 +ellps=bessel +towgs84=565.417,50.3319,465.552,-0.398957,0.343988,-1.8774,4.0725 +units=m +no_defs',
  'EPSG:2056': '+proj=somerc +lat_0=46.95240555555556 +lon_0=7.439583333333333 +k_0=1 +x_0=2600000 +y_0=1200000 +ellps=bessel +towgs84=674.374,15.056,405.346,0,0,0,0 +units=m +no_defs',
}
for (let z = 1; z <= 60; z++) {
  DEFS[`EPSG:${32600 + z}`] = `+proj=utm +zone=${z} +datum=WGS84 +units=m +no_defs`
  DEFS[`EPSG:${32700 + z}`] = `+proj=utm +zone=${z} +south +datum=WGS84 +units=m +no_defs`
  if (z >= 28 && z <= 38) DEFS[`EPSG:${25800 + z}`] = `+proj=utm +zone=${z} +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs`
}
const GEOGRAPHIC = new Set(['EPSG:4326', 'EPSG:4258', 'EPSG:4269', 'EPSG:4171'])

/** the coordinate systems offered in the window (the file's own one is picked when it says it) */
export const CRS_CHOICES = ['EPSG:4326', 'EPSG:3857', 'EPSG:2154', 'EPSG:27700', 'EPSG:28992', 'EPSG:2056', 'UTM']

export const isGeographic = (crs: string | null) => !!crs && GEOGRAPHIC.has(crs)
function def(crs: string) {
  return DEFS[crs] ?? crs // EPSG:3857 and EPSG:4326 are built into proj4
}
export function crsKnown(crs: string) {
  try { proj4(def(crs), 'EPSG:4326', [0, 0]); return true } catch { return false }
}
const M_LAT = 110574
const mLon = (lat: number) => 111320 * Math.cos((lat * Math.PI) / 180)

// --- reading ---
export async function readDem(file: File): Promise<Dem> {
  const name = file.name
  const buf = await file.arrayBuffer()
  if (/\.(tif|tiff)$/i.test(name)) return readTiff(buf, name)
  if (/\.asc$/i.test(name)) return readAsc(new TextDecoder().decode(buf), name)
  if (/\.hgt$/i.test(name)) return readHgt(buf, name)
  if (/\.png$/i.test(name)) return readPng16(buf, name)
  throw new Error(`unsupported file: ${name} (GeoTIFF, .asc, .hgt or 16-bit PNG)`)
}

export async function readTiff(buf: ArrayBuffer, name: string): Promise<Dem> {
  const tiff = await fromArrayBuffer(buf)
  const img = await tiff.getImage()
  const w = img.getWidth(), h = img.getHeight()
  const band = (await img.readRasters({ samples: [0], interleave: false }))[0] as ArrayLike<number>
  const data = Float32Array.from(band)
  const [ox, oy] = img.getOrigin()
  const [rx, ry] = img.getResolution()
  const keys = (img.getGeoKeys?.() ?? {}) as Record<string, number>
  const code = keys.ProjectedCSTypeGeoKey ?? keys.GeographicTypeGeoKey
  let crs: string | null = code && code !== 32767 ? `EPSG:${code}` : null
  if (!crs && Math.abs(ox) <= 180 && Math.abs(oy) <= 90 && Math.abs(rx) < 1) crs = 'EPSG:4326'
  const nd = img.getGDALNoData()
  return { name, w, h, data, nodata: nd ?? null, x0: ox + rx / 2, y0: oy + ry / 2, dx: rx, dy: ry, crs }
}

export function readAsc(text: string, name: string): Dem {
  const head: Record<string, number> = {}
  let pos = 0
  for (let k = 0; k < 7; k++) {
    const m = /^[ \t]*([a-zA-Z_]+)[ \t]+(\S+)[ \t]*\r?\n/.exec(text.slice(pos, pos + 200))
    if (!m) break
    head[m[1].toLowerCase()] = Number(m[2])
    pos += m[0].length
  }
  const w = head.ncols, h = head.nrows, cell = head.cellsize
  if (!(w > 0 && h > 0 && cell > 0)) throw new Error('not an ESRI ASCII grid (ncols / nrows / cellsize)')
  const data = new Float32Array(w * h)
  const re = /-?[\d.]+(?:e[-+]?\d+)?/gi
  re.lastIndex = pos
  let n = 0, m: RegExpExecArray | null
  while (n < data.length && (m = re.exec(text))) data[n++] = Number(m[0])
  const corner = 'xllcorner' in head
  const xll = head.xllcorner ?? head.xllcenter, yll = head.yllcorner ?? head.yllcenter
  const half = corner ? cell / 2 : 0
  // a guess for files without a .prj: French Lambert-93 (IGN) coordinates
  const crs = xll > 1e5 && xll < 1.3e6 && yll > 6e6 && yll < 7.2e6 ? 'EPSG:2154' : null
  return { name, w, h, data, nodata: head.nodata_value ?? null, x0: xll + half, y0: yll + half + (h - 1) * cell, dx: cell, dy: -cell, crs }
}

export function readHgt(buf: ArrayBuffer, name: string): Dem {
  const n = Math.round(Math.sqrt(buf.byteLength / 2))
  const m = /([NS])(\d{2})([EW])(\d{3})/i.exec(name)
  if (n * n * 2 !== buf.byteLength || !m) throw new Error('not an SRTM .hgt tile (name like N45E005.hgt)')
  const lat = Number(m[2]) * (/s/i.test(m[1]) ? -1 : 1), lon = Number(m[4]) * (/w/i.test(m[3]) ? -1 : 1)
  const v = new DataView(buf), data = new Float32Array(n * n)
  for (let i = 0; i < n * n; i++) data[i] = v.getInt16(i * 2, false)
  const step = 1 / (n - 1)
  return { name, w: n, h: n, data, nodata: -32768, x0: lon, y0: lat + 1, dx: step, dy: -step, crs: 'EPSG:4326' }
}

/** greyscale PNG (8 or 16 bits) decoded here: browsers only give 8 bits through a canvas */
export async function readPng16(buf: ArrayBuffer, name: string): Promise<Dem> {
  const b = new Uint8Array(buf), v = new DataView(buf)
  if (v.getUint32(0) !== 0x89504e47) throw new Error('not a PNG')
  let w = 0, h = 0, depth = 0, type = 0, inter = 0
  const idat: Uint8Array[] = []
  for (let p = 8; p < b.length; ) {
    const len = v.getUint32(p), kind = String.fromCharCode(...b.subarray(p + 4, p + 8))
    if (kind === 'IHDR') { w = v.getUint32(p + 8); h = v.getUint32(p + 12); depth = b[p + 16]; type = b[p + 17]; inter = b[p + 20] }
    else if (kind === 'IDAT') idat.push(b.subarray(p + 8, p + 8 + len))
    else if (kind === 'IEND') break
    p += 12 + len
  }
  const chans = ({ 0: 1, 2: 3, 4: 2, 6: 4 } as Record<number, number>)[type]
  if (!chans || (depth !== 8 && depth !== 16) || inter) throw new Error('PNG must be greyscale or RGB, 8 or 16 bits, not interlaced')
  const raw = new Uint8Array(await new Response(new Blob(idat as BlobPart[]).stream().pipeThrough(new DecompressionStream('deflate'))).arrayBuffer())
  const bpp = (chans * depth) / 8, stride = w * bpp
  const out = new Uint8Array(h * stride)
  for (let r = 0; r < h; r++) {
    const f = raw[r * (stride + 1)], src = r * (stride + 1) + 1, dst = r * stride
    for (let i = 0; i < stride; i++) {
      const x = raw[src + i]
      const a = i >= bpp ? out[dst + i - bpp] : 0
      const up = r ? out[dst - stride + i] : 0
      const c = r && i >= bpp ? out[dst - stride + i - bpp] : 0
      let val = x
      if (f === 1) val = x + a
      else if (f === 2) val = x + up
      else if (f === 3) val = x + ((a + up) >> 1)
      else if (f === 4) {
        const pa = Math.abs(up - c), pb = Math.abs(a - c), pc = Math.abs(a + up - 2 * c)
        val = x + (pa <= pb && pa <= pc ? a : pb <= pc ? up : c)
      }
      out[dst + i] = val & 255
    }
  }
  const data = new Float32Array(w * h), max = depth === 16 ? 65535 : 255
  for (let i = 0; i < w * h; i++) {
    const o = i * bpp
    data[i] = (depth === 16 ? (out[o] << 8) | out[o + 1] : out[o]) / max
  }
  return { name, w, h, data, nodata: null, x0: 0, y0: 0, dx: 1, dy: -1, crs: null, normalized: true }
}

// --- geometry ---
/** source coordinates of a point of the area's local frame (metres from the centre) */
export function toSource(dem: Dem, a: Area, lx: number, lz: number): [number, number] {
  const r = (a.rot * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r)
  const e = lx * c + lz * s, n = -lx * s + lz * c
  if (isGeographic(dem.crs)) return [a.cx + e / mLon(a.cy), a.cy + n / M_LAT]
  return [a.cx + e, a.cy + n]
}
/** local frame of a WGS84 point (OpenStreetMap) */
export function lonLatToLocal(dem: Dem, a: Area): (lon: number, lat: number) => [number, number] {
  const r = (a.rot * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r)
  const geo = isGeographic(dem.crs)
  const fwd = geo || !dem.crs ? null : proj4('EPSG:4326', def(dem.crs))
  return (lon, lat) => {
    let e: number, n: number
    if (fwd) { const [x, y] = fwd.forward([lon, lat]); e = x - a.cx; n = y - a.cy }
    else { e = (lon - a.cx) * mLon(a.cy); n = (lat - a.cy) * M_LAT }
    return [e * c - n * s, e * s + n * c]
  }
}
/** WGS84 bounding box (south, west, north, east) of the area, for OpenStreetMap */
export function areaLonLat(dem: Dem, a: Area): [number, number, number, number] {
  if (!dem.crs) throw new Error('no georeference')
  const inv = isGeographic(dem.crs) ? null : proj4(def(dem.crs), 'EPSG:4326')
  let s = 90, w = 180, n = -90, e = -180
  const h = a.size / 2
  for (const [lx, lz] of [[-h, -h], [h, -h], [h, h], [-h, h]]) {
    const p = toSource(dem, a, lx, lz)
    const [lon, lat] = inv ? inv.forward(p) : p
    s = Math.min(s, lat); n = Math.max(n, lat); w = Math.min(w, lon); e = Math.max(e, lon)
  }
  return [s, w, n, e]
}
/** metres per source unit along X (for sizes shown in the window) */
export function metresPerUnit(dem: Dem, atY: number) {
  return isGeographic(dem.crs) ? mLon(atY) : 1
}

/** height at a source coordinate (bilinear), NaN outside or on "no data" */
export function sample(dem: Dem, x: number, y: number): number {
  const fc = (x - dem.x0) / dem.dx, fr = (y - dem.y0) / dem.dy
  if (fc < 0 || fr < 0 || fc > dem.w - 1 || fr > dem.h - 1) return NaN
  const c = Math.min(dem.w - 2, Math.floor(fc)), r = Math.min(dem.h - 2, Math.floor(fr))
  const tc = fc - c, tr = fr - r
  const at = (cc: number, rr: number) => {
    const v = dem.data[rr * dem.w + cc]
    return dem.nodata !== null && (v === dem.nodata || v < -1e4) ? NaN : v
  }
  const a = at(c, r), b = at(c + 1, r), d = at(c, r + 1), e = at(c + 1, r + 1)
  if ([a, b, d, e].some(Number.isNaN)) {
    const near = at(Math.round(fc), Math.round(fr))
    return near
  }
  return (a * (1 - tc) + b * tc) * (1 - tr) + (d * (1 - tc) + e * tc) * tr
}

export interface BuildOptions {
  cols: number // grid vertices per side (513, 1025...)
  exaggeration: number // vertical scale
  sea: number // sea level in source metres (below = water)
  pngRange?: [number, number] // PNG: heights of black and white, metres
}

/** the Reforger terrain grid for an area: X east, Z north, origin at the south-west corner */
export function buildWorld(dem: Dem, a: Area, o: BuildOptions): WorldExport {
  const cols = o.cols, rows = o.cols, step = a.size / (cols - 1)
  const [lo, hi] = o.pngRange ?? [0, 1]
  const heights = new Array<number>(cols * rows)
  let missing = 0
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const [x, y] = toSource(dem, a, c * step - a.size / 2, r * step - a.size / 2)
      let v = sample(dem, x, y)
      if (Number.isNaN(v)) { missing++; v = o.sea - 30 / o.exaggeration } else if (dem.normalized) v = lo + v * (hi - lo)
      heights[r * cols + c] = (v - o.sea) * o.exaggeration
    }
  }
  if (missing > heights.length / 2) throw new Error('the area is mostly outside the file')
  return { minX: 0, minZ: 0, step, cols, rows, ocean: 0, heights, materials: [], surfaces: [] }
}

/** a sensible first area: the largest centred square that fits, in metres */
export function defaultArea(dem: Dem): Area {
  const cx = dem.x0 + ((dem.w - 1) * dem.dx) / 2, cy = dem.y0 + ((dem.h - 1) * dem.dy) / 2
  const mx = metresPerUnit(dem, cy), my = isGeographic(dem.crs) ? M_LAT : 1
  const side = Math.min(Math.abs((dem.w - 1) * dem.dx) * mx, Math.abs((dem.h - 1) * dem.dy) * my)
  return { cx, cy, size: Math.max(256, Math.floor(side / 256) * 256), rot: 0 }
}

/** heights range of the file (ignores no data) */
export function demRange(dem: Dem): [number, number] {
  let lo = Infinity, hi = -Infinity
  for (const v of dem.data) {
    if (dem.nodata !== null && (v === dem.nodata || v < -1e4)) continue
    if (v < lo) lo = v
    if (v > hi) hi = v
  }
  return [lo, hi]
}

/** Copernicus tiles covering a window of ±half degrees of latitude around a point (longitude widened
 *  by 1/cos(lat) so the window is about square on the ground) */
export function copernicusTiles(lat: number, lon: number, half: number) {
  const hl = half / Math.max(0.2, Math.cos((lat * Math.PI) / 180))
  const box: [number, number, number, number] = [lat - half, lon - hl, lat + half, lon + hl] // s, w, n, e
  const out: ReturnType<typeof copernicusTile>[] = []
  for (let la = Math.floor(box[0]); la <= Math.floor(box[2]); la++) for (let lo = Math.floor(box[1]); lo <= Math.floor(box[3]); lo++) out.push(copernicusTile(la + 0.5, lo + 0.5))
  return { box, tiles: out }
}

/** several geographic tiles cut to one window [s, w, n, e] at the finest resolution; holes (missing
 *  tiles: open sea) stay NaN */
export function mosaic(tiles: Dem[], [s, w, n, e]: [number, number, number, number], name: string): Dem {
  const dx = Math.min(...tiles.map((d) => Math.abs(d.dx))), dy = Math.min(...tiles.map((d) => Math.abs(d.dy)))
  const W = Math.round((e - w) / dx) + 1, H = Math.round((n - s) / dy) + 1
  const data = new Float32Array(W * H).fill(Number.NaN)
  for (let r = 0; r < H; r++) {
    const y = n - r * dy
    for (let c = 0; c < W; c++) {
      const x = w + c * dx
      for (const d of tiles) {
        // a point on the seam between two tiles may fall just outside both: take the edge pixel
        const xe = d.x0 + (d.w - 1) * d.dx, ye = d.y0 + (d.h - 1) * d.dy
        const near = (v: number, a: number, b: number, step: number) => v >= Math.min(a, b) - 1.5 * Math.abs(step) && v <= Math.max(a, b) + 1.5 * Math.abs(step)
        if (!near(x, d.x0, xe, d.dx) || !near(y, d.y0, ye, d.dy)) continue
        const v = sample(d, Math.min(Math.max(x, Math.min(d.x0, xe)), Math.max(d.x0, xe)), Math.min(Math.max(y, Math.min(d.y0, ye)), Math.max(d.y0, ye)))
        if (!Number.isNaN(v)) { data[r * W + c] = v; break }
      }
    }
  }
  return { name, w: W, h: H, data, nodata: null, x0: w, y0: n, dx, dy: -dy, crs: 'EPSG:4326' }
}

/** Copernicus DEM GLO-30 tile holding a point (public AWS open data, one 1°x1° GeoTIFF) */
export function copernicusTile(lat: number, lon: number) {
  const la = Math.floor(lat), lo = Math.floor(lon)
  const ns = `${la < 0 ? 'S' : 'N'}${String(Math.abs(la)).padStart(2, '0')}_00`
  const ew = `${lo < 0 ? 'W' : 'E'}${String(Math.abs(lo)).padStart(3, '0')}_00`
  const id = `Copernicus_DSM_COG_10_${ns}_${ew}_DEM`
  return { id, url: `https://copernicus-dem-30m.s3.amazonaws.com/${id}/${id}.tif` }
}
