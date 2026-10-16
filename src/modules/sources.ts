// Relief and imagery sources fetched for an area around a point (the BARNMAP set):
// - IGN Géoplateforme (France): RGE ALTI 1-5 m everywhere, LiDAR HD 1 m terrain (MNT) and canopy
//   height (MNH) where flown; WMS GetMap in 32-bit floats, Lambert 93, open licence Etalab 2.0
// - Terrarium tiles (Mapzen / Tilezen on AWS, world): RGB-encoded heights, web-mercator tiles
// - ESA WorldCover 2021 (world, 10 m land cover classes, CC BY 4.0), read through the bridge
// - Esri World Imagery (satellite photo): display and tracing only, never sent to the game
// Every result is a Dem the rest of dem.ts already knows (sample, toSource, buildWorld…).

import proj4 from 'proj4'
import { fromUrl } from 'geotiff'
import { BRIDGE_URL } from '../bridge'
import { DEFS, type Dem } from './dem'

export const CREDITS = {
  ign: 'IGN Géoplateforme — RGE ALTI® / LiDAR HD, Licence Ouverte Etalab 2.0',
  terrarium: 'Terrain Tiles (Mapzen / Tilezen, AWS Open Data): SRTM, GMTED, ETOPO1, NED and others',
  worldcover: 'ESA WorldCover 10 m 2021 v200, © ESA WorldCover project / Contains modified Copernicus Sentinel data (2021), CC BY 4.0',
  esri: 'Esri World Imagery — Esri, Maxar, Earthstar Geographics, and the GIS User Community',
}

const MARGIN = 1.45 // a turned area still fits (√2 + a little)

// --- IGN ---
export type IgnLayer = 'rgealti' | 'lidarMnt' | 'lidarMnh'
const IGN_LAYER: Record<IgnLayer, string> = {
  rgealti: 'ELEVATION.ELEVATIONGRIDCOVERAGE.HIGHRES',
  lidarMnt: 'IGNF_LIDAR-HD_MNT_ELEVATION.ELEVATIONGRIDCOVERAGE.LAMB93',
  lidarMnh: 'IGNF_LIDAR-HD_MNH_ELEVATION.ELEVATIONGRIDCOVERAGE.LAMB93',
}
/** square of `size` metres (plus margin) around a point, Lambert 93, about 2 m per pixel at most */
export async function fetchIgn(lat: number, lon: number, size: number, layer: IgnLayer): Promise<Dem> {
  const [cx, cy] = proj4('EPSG:4326', DEFS['EPSG:2154'], [lon, lat])
  const span = size * MARGIN
  const px = Math.min(5000, Math.max(256, Math.ceil(span / Math.max(1, size / 2048))))
  const res = span / px
  const x0 = cx - span / 2, y0 = cy - span / 2
  const url = 'https://data.geopf.fr/wms-r?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&STYLES=&CRS=EPSG:2154'
    + `&LAYERS=${IGN_LAYER[layer]}&BBOX=${x0},${y0},${x0 + span},${y0 + span}&WIDTH=${px}&HEIGHT=${px}&FORMAT=image/x-bil;bits=32`
  const r = await fetch(url)
  if (!r.ok || !(r.headers.get('content-type') ?? '').includes('bil')) throw new Error(`IGN ${r.status}: ${(await r.text()).slice(0, 160)}`)
  const data = new Float32Array(await r.arrayBuffer())
  if (data.length !== px * px) throw new Error(`IGN: ${data.length} values for ${px}×${px}`)
  // the WMS bbox is the outer edge: pixel centres are half a pixel inside, first row = north
  return { name: `IGN ${layer} ${lat.toFixed(3)} ${lon.toFixed(3)}`, w: px, h: px, data, nodata: -99999, x0: x0 + res / 2, y0: y0 + span - res / 2, dx: res, dy: -res, crs: 'EPSG:2154' }
}
/** share of real values: LiDAR HD does not cover all of France yet */
export function coverage(d: Dem) {
  let ok = 0
  for (const v of d.data) if (v > -1000 && v !== d.nodata) ok++
  return ok / d.data.length
}

// --- Terrarium ---
const R = 6378137
const merc = (lon: number, lat: number, z: number): [number, number] => {
  const n = 256 * 2 ** z
  const s = Math.sin((lat * Math.PI) / 180)
  return [((lon + 180) / 360) * n, (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n]
}
/** Terrarium tiles around a point, resampled to a geographic grid (so sizes stay in ground metres) */
export async function fetchTerrarium(lat: number, lon: number, size: number, onTile?: (k: number, n: number) => void): Promise<Dem> {
  const half = (size * MARGIN) / 2
  const dLat = half / 111320, dLon = half / (111320 * Math.cos((lat * Math.PI) / 180))
  // zoom so a pixel is about size / 2048 metres, never more than 100 tiles
  const want = Math.max(2, size / 2048)
  let z = Math.min(15, Math.max(1, Math.round(Math.log2((2 * Math.PI * R * Math.cos((lat * Math.PI) / 180)) / (256 * want)))))
  let t0: [number, number], t1: [number, number]
  for (;;) {
    t0 = merc(lon - dLon, lat + dLat, z).map((v) => Math.floor(v / 256)) as [number, number]
    t1 = merc(lon + dLon, lat - dLat, z).map((v) => Math.floor(v / 256)) as [number, number]
    if ((t1[0] - t0[0] + 1) * (t1[1] - t0[1] + 1) <= 100 || z <= 1) break
    z--
  }
  const tw = t1[0] - t0[0] + 1, th = t1[1] - t0[1] + 1
  const W = tw * 256, img = new Float32Array(W * th * 256)
  const cv = document.createElement('canvas')
  cv.width = cv.height = 256
  const g = cv.getContext('2d', { willReadFrequently: true })!
  let k = 0
  for (let ty = t0[1]; ty <= t1[1]; ty++) {
    for (let tx = t0[0]; tx <= t1[0]; tx++) {
      onTile?.(++k, tw * th)
      const r = await fetch(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${tx}/${ty}.png`)
      if (!r.ok) continue
      g.drawImage(await createImageBitmap(await r.blob()), 0, 0)
      const px = g.getImageData(0, 0, 256, 256).data
      for (let i = 0; i < 256 * 256; i++) {
        const row = (ty - t0[1]) * 256 + (i >> 8), col = (tx - t0[0]) * 256 + (i & 255)
        img[row * W + col] = px[i * 4] * 256 + px[i * 4 + 1] + px[i * 4 + 2] / 256 - 32768
      }
    }
  }
  // resample to lon / lat at the same pixel size
  const pxDeg = (360 / (256 * 2 ** z))
  const w = Math.ceil((2 * dLon) / pxDeg) + 1, h = Math.ceil((2 * dLat) / pxDeg) + 1
  const out = new Float32Array(w * h)
  for (let r = 0; r < h; r++) {
    const la = lat + dLat - r * pxDeg
    for (let c = 0; c < w; c++) {
      const [mx, my] = merc(lon - dLon + c * pxDeg, la, z)
      const fx = Math.min(W - 1.001, Math.max(0, mx - t0[0] * 256 - 0.5)), fy = Math.min(th * 256 - 1.001, Math.max(0, my - t0[1] * 256 - 0.5))
      const x = Math.floor(fx), y = Math.floor(fy), ax = fx - x, ay = fy - y
      const v = (i: number, j: number) => img[j * W + i]
      out[r * w + c] = (v(x, y) * (1 - ax) + v(x + 1, y) * ax) * (1 - ay) + (v(x, y + 1) * (1 - ax) + v(x + 1, y + 1) * ax) * ay
    }
  }
  return { name: `Terrarium z${z} ${lat.toFixed(3)} ${lon.toFixed(3)}`, w, h, data: out, nodata: null, x0: lon - dLon, y0: lat + dLat, dx: pxDeg, dy: -pxDeg, crs: 'EPSG:4326' }
}

// --- ESA WorldCover ---
/** class codes: 10 trees, 20 shrubs, 30 grass, 40 crops, 50 built-up, 60 bare, 70 snow, 80 water,
 *  90 wetland, 95 mangroves, 100 moss. Returned as a Dem of codes on a geographic grid. */
export async function fetchWorldCover(s: number, w: number, n: number, e: number, px: number): Promise<Dem> {
  const tiles: string[] = []
  for (let la = Math.floor(s / 3) * 3; la <= n; la += 3) {
    for (let lo = Math.floor(w / 3) * 3; lo <= e; lo += 3) {
      tiles.push(`${la < 0 ? 'S' : 'N'}${String(Math.abs(la)).padStart(2, '0')}${lo < 0 ? 'W' : 'E'}${String(Math.abs(lo)).padStart(3, '0')}`)
    }
  }
  const W = px, H = Math.max(2, Math.round((px * (n - s)) / (e - w)))
  const out = new Float32Array(W * H)
  for (const id of tiles) {
    // the bucket sends no CORS headers: the bridge forwards the range requests
    const tiff = await fromUrl(`${BRIDGE_URL}/landcover?tile=${id}`, { allowFullFile: false })
    const img = await tiff.getImage()
    const [bw, bs, be, bn] = img.getBoundingBox()
    const cs = Math.max(s, bs), cn = Math.min(n, bn), cw = Math.max(w, bw), ce = Math.min(e, be)
    if (cs >= cn || cw >= ce) continue
    // the part of the output grid this tile covers
    const c0 = Math.round(((cw - w) / (e - w)) * (W - 1)), c1 = Math.round(((ce - w) / (e - w)) * (W - 1))
    const r0 = Math.round(((n - cn) / (n - s)) * (H - 1)), r1 = Math.round(((n - cs) / (n - s)) * (H - 1))
    const ww = c1 - c0 + 1, hh = r1 - r0 + 1
    const ras = (await tiff.readRasters({ bbox: [cw, cs, ce, cn], width: ww, height: hh, resampleMethod: 'nearest', interleave: true })) as unknown as Uint8Array
    for (let r = 0; r < hh; r++) for (let c = 0; c < ww; c++) out[(r0 + r) * W + c0 + c] = ras[r * ww + c]
  }
  const dx = (e - w) / (W - 1), dy = (n - s) / (H - 1)
  return { name: 'WorldCover', w: W, h: H, data: out, nodata: 0, x0: w, y0: n, dx, dy: -dy, crs: 'EPSG:4326' }
}

// --- Esri World Imagery (picker background, tracing image) ---
/** satellite picture of a lon / lat box, as a canvas (north up, about `px` pixels wide) */
export async function fetchImagery(s: number, w: number, n: number, e: number, px: number): Promise<HTMLCanvasElement> {
  const lat = (s + n) / 2
  let z = Math.min(18, Math.max(1, Math.round(Math.log2((px * 360) / ((e - w) * 256)))))
  while (z > 1 && (Math.floor(merc(e, s, z)[0] / 256) - Math.floor(merc(w, n, z)[0] / 256) + 1) * (Math.floor(merc(e, s, z)[1] / 256) - Math.floor(merc(w, n, z)[1] / 256) + 1) > 100) z--
  const [x0, y0] = merc(w, n, z), [x1, y1] = merc(e, s, z)
  const tile = document.createElement('canvas')
  tile.width = Math.ceil(x1 - x0); tile.height = Math.ceil(y1 - y0)
  const g = tile.getContext('2d')!
  const jobs: Promise<void>[] = []
  for (let ty = Math.floor(y0 / 256); ty <= Math.floor(y1 / 256); ty++) {
    for (let tx = Math.floor(x0 / 256); tx <= Math.floor(x1 / 256); tx++) {
      jobs.push(fetch(`https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${ty}/${tx}`)
        .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(String(r.status)))))
        .then(createImageBitmap)
        .then((b) => g.drawImage(b, tx * 256 - x0, ty * 256 - y0))
        .catch(() => undefined))
    }
  }
  await Promise.all(jobs)
  // mercator -> equal lon / lat steps (north up), the tool's maps are in ground metres
  const H = Math.round((tile.width * (n - s) * 111320) / ((e - w) * 111320 * Math.cos((lat * Math.PI) / 180)))
  const out = document.createElement('canvas')
  out.width = tile.width; out.height = Math.max(1, H)
  const o = out.getContext('2d')!
  for (let r = 0; r < out.height; r++) {
    const la = n - ((r + 0.5) / out.height) * (n - s)
    const my = merc(w, la, z)[1] - y0
    o.drawImage(tile, 0, Math.floor(my), tile.width, 1, 0, r, out.width, 1)
  }
  return out
}
