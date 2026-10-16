// "Start from a real place" window: open an elevation file (or download a Copernicus DEM tile), pick the
// area on a shaded preview (drag = move, wheel = size, Shift + wheel = turn), then build the terrain and,
// when the file is georeferenced, bring OpenStreetMap roads, water, forests, fields and places with it.

import { BRIDGE_URL, type WorldExport } from './bridge'
import { t, type Key } from './i18n'
import {
  type Area, type Dem, CRS_CHOICES, areaLonLat, buildWorld, copernicusTiles, mosaic, crsKnown, defaultArea, demRange,
  isGeographic, localToLonLat, lonLatToLocal, readDem, readTiff, toSource,
} from './modules/dem'
import { canopyClasses } from './modules/canopy'
import { CREDITS, coverage, fetchIgn, fetchImagery, fetchTerrarium, fetchWorldCover } from './modules/sources'
import { WORLDCOVER } from './modules/cover'
import * as turf from '@turf/turf'
import { ADAPT_DEFAULTS, adaptForGame } from './modules/adapt'
import { OSM_ATTRIBUTION, type OsmOptions, type OsmResult, fetchOverpass, osmToMap, overpassQuery } from './modules/osm'

export interface RealPlace {
  world: WorldExport
  osm: OsmResult | null
  name: string
  credits: string[]
  adapted?: ReturnType<typeof adaptForGame>
  cover?: Uint8Array // land-cover code per terrain vertex (cover.ts), from ESA WorldCover
  warn?: string
  trace?: HTMLCanvasElement // satellite picture of the area, north up, for the tracing layer
}

let root: HTMLDivElement | null = null

export function openRealWorld(onApply: (r: RealPlace) => void) {
  if (root) { root.hidden = false; return }
  root = document.createElement('div')
  root.className = 'parcels'
  const L = (k: Key) => t(k)
  const chk = (id: string, k: Key, on = true) => `<label class="check"><input id="${id}" type="checkbox"${on ? ' checked' : ''}> ${L(k)}</label>`
  root.innerHTML = `
  <div class="pc-box">
    <div class="pc-head"><b>${L('rw.title')}</b><span class="hint">${L('rw.hint')}</span><button id="rwClose" type="button">✕</button></div>
    <div class="pc-body">
      <div class="pc-edit">
        <div class="rw-left">
          <div class="pc-row">
            <label class="pc-file">${L('rw.open')}<input id="rwFile" type="file" accept=".tif,.tiff,.asc,.hgt,.png" hidden></label>
            <span class="hint">${L('rw.formats')}</span>
          </div>
          <div class="pc-row rw-cop">
            <input id="rwPlace" type="search" placeholder="${L('rw.placePh')}"><button id="rwFind" type="button">${L('rw.find')}</button>
            <span id="rwFavs"></span>
          </div>
          <div class="pc-row rw-cop">
            <select id="rwSrc" title="${L('hint.src')}"><option value="copernicus">${L('rw.src.copernicus')}</option><option value="terrarium">${L('rw.src.terrarium')}</option><option value="ign">${L('rw.src.ign')}</option><option value="ignLidar">${L('rw.src.ignLidar')}</option></select>
            <label>${L('rw.lat')} <input id="rwLat" type="number" step="0.0001" placeholder="45.1885"></label>
            <label>${L('rw.lon')} <input id="rwLon" type="number" step="0.0001" placeholder="5.7245"></label>
            <button id="rwCopGo" type="button">${L('rw.download')}</button>
          </div>
          <canvas id="rwCv" width="520" height="520"></canvas>
          <div id="rwInfo" class="hint"></div>
        </div>
        <div class="pc-side">
          <b>${L('rw.area')}</b>
          <div class="pc-row">
            <label>${L('rw.size')} <input id="rwSize" type="number" min="256" step="256"></label>
            <label>${L('rw.rot')} <input id="rwRot" type="number" step="1" value="0"></label>
          </div>
          <div class="pc-row">${[4, 8, 16, 32].map((k) => `<button type="button" data-km="${k}">${k} km</button>`).join('')}</div>
          <label>${L('rw.crs')} <input id="rwCrs" type="text" list="rwCrsList" placeholder="EPSG:2154"></label>
          <datalist id="rwCrsList">${CRS_CHOICES.filter((c) => c !== 'UTM').map((c) => `<option value="${c}">`).join('')}<option value="EPSG:32631"><option value="EPSG:32632"><option value="EPSG:25832"></datalist>
          <div id="rwPng" class="pc-row" hidden>
            <label>${L('rw.pixel')} <input id="rwPixel" type="number" value="2" min="0.1" step="0.1"></label>
            <label>${L('rw.black')} <input id="rwBlack" type="number" value="0"></label>
            <label>${L('rw.white')} <input id="rwWhite" type="number" value="500"></label>
          </div>
          <b>${L('rw.terrain')}</b>
          <div class="pc-row">
            <label>${L('rw.res')} <select id="rwCols"><option value="513">513</option><option value="1025">1025</option><option value="2049">2049</option></select></label>
            <label>${L('rw.exag')} <input id="rwExag" type="number" value="1" min="0.1" max="5" step="0.1"></label>
            <label>${L('rw.sea')} <input id="rwSea" type="number" step="0.5"></label>
          </div>
          <div id="rwStep" class="hint"></div>
          <b>${L('rw.osm')}</b>
          <div class="rw-checks">
            ${chk('rwOsm', 'rw.osmOn')}
            ${chk('rwMain', 'rw.mainRoads')}${chk('rwMinor', 'rw.minorRoads')}${chk('rwTracks', 'rw.tracks')}${chk('rwPaths', 'rw.paths', false)}
            ${chk('rwWater', 'rw.water')}${chk('rwForests', 'rw.forests')}${chk('rwFields', 'rw.fields')}${chk('rwPlaces', 'rw.places')}${chk('rwBuildings', 'rw.buildings', false)}<span title="${L('hint.adapt')}">${chk('rwAdapt', 'rw.adapt')}</span>
            <span title="${L('hint.wc')}">${chk('rwWc', 'rw.wc')}${chk('rwWcForest', 'rw.wcForest', false)}</span>
            <span title="${L('hint.sat')}">${chk('rwSat', 'rw.sat', false)}</span>
          </div>
          <div class="pc-row">
            <label>${L('rw.minForest')} <input id="rwMinForest" type="number" value="1" min="0" step="0.5"></label>
            <label class="pc-file">${L('rw.osmFile')}<input id="rwOsmFile" type="file" accept=".json" hidden></label>
            <label class="pc-file" title="${L('hint.chm')}">${L('rw.chm')}<input id="rwChm" type="file" accept=".tif,.tiff,.asc" hidden></label>
          </div>
          <div class="hint">${L('rw.osmNote')}</div>
          <div class="pc-row"><button id="rwGo" type="button">${L('rw.apply')}</button></div>
          <div id="rwMsg" class="hint"></div>
        </div>
      </div>
    </div>
  </div>`
  document.body.append(root)
  const $ = <T extends HTMLElement>(id: string) => root!.querySelector<T>(`#${id}`)!
  const num = (id: string) => Number($<HTMLInputElement>(id).value)
  const cv = $<HTMLCanvasElement>('rwCv'), g = cv.getContext('2d')!, msg = $<HTMLDivElement>('rwMsg')
  let dem: Dem | null = null
  let area: Area | null = null
  let shade: ImageData | null = null
  let osmFile: unknown = null
  let fromCop = false
  let srcCredit = '' // credit of the relief source other than Copernicus

  // --- the file ---
  function effective(): Dem | null {
    if (!dem) return null
    if (!dem.normalized) {
      const crs = $<HTMLInputElement>('rwCrs').value.trim() || null
      return { ...dem, crs }
    }
    const px = Math.max(0.1, num('rwPixel'))
    return { ...dem, dx: px, dy: -px, x0: 0, y0: (dem.h - 1) * px, crs: null }
  }
  async function useDem(d: Dem, at?: [number, number], size?: number) {
    dem = d
    $<HTMLDivElement>('rwPng').hidden = !d.normalized
    $<HTMLInputElement>('rwCrs').value = d.crs ?? ''
    $<HTMLInputElement>('rwCrs').disabled = !!d.normalized
    const e = effective()!
    area = defaultArea(e)
    if (at && isGeographic(e.crs)) { area.cx = at[1]; area.cy = at[0]; area.size = 8192 }
    area.size = Math.min(area.size, 20480)
    if (size) area.size = size
    const [lo, hi] = d.normalized ? [num('rwBlack'), num('rwWhite')] : demRange(d)
    $<HTMLInputElement>('rwSea').value = String(lo <= 0.5 ? 0 : Math.floor(lo) - 1)
    $<HTMLDivElement>('rwInfo').textContent = t('rw.info', { name: d.name, w: d.w, h: d.h, crs: d.crs ?? '—', lo: Math.round(lo), hi: Math.round(hi) })
    shade = makeShade(d)
    fill()
    redraw()
  }
  $<HTMLInputElement>('rwFile').addEventListener('change', async (ev) => {
    const f = (ev.target as HTMLInputElement).files?.[0]
    if (!f) return
    msg.textContent = t('rw.reading')
    try { fromCop = false; srcCredit = ''; await useDem(await readDem(f)); msg.textContent = '' } catch (e) { msg.textContent = (e as Error).message }
  })
  $<HTMLButtonElement>('rwCopGo').addEventListener('click', () => void copDownload())
  async function copDownload() {
    const lat = num('rwLat'), lon = num('rwLon')
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 85 || Math.abs(lon) > 180 || ($<HTMLInputElement>('rwLat').value === '')) return void (msg.textContent = t('rw.badLatLon'))
    const src = $<HTMLSelectElement>('rwSrc').value
    if (src !== 'copernicus') {
      // sized sources: fetched for the area size asked (change it, then download again)
      const size = Math.max(1024, Math.min(32768, num('rwSize') || 8192))
      try {
        let d: Dem
        if (src === 'terrarium') d = await fetchTerrarium(lat, lon, size, (k, n) => { msg.textContent = t('rw.downloading', { id: `Terrarium ${k}/${n}` }) })
        else {
          msg.textContent = t('rw.downloading', { id: 'IGN' })
          d = await fetchIgn(lat, lon, size, src === 'ignLidar' ? 'lidarMnt' : 'rgealti')
          if (coverage(d) < 0.5) throw new Error(t(src === 'ignLidar' ? 'rw.ignNoLidar' : 'rw.ignOutside'))
          if (src === 'ignLidar') {
            msg.textContent = t('rw.downloading', { id: 'IGN LiDAR HD MNH' })
            chm = await fetchIgn(lat, lon, size, 'lidarMnh').catch(() => null)
          }
        }
        fromCop = false
        srcCredit = src === 'terrarium' ? CREDITS.terrarium : CREDITS.ign
        await useDem(d, [lat, lon], size)
        msg.textContent = chm && src === 'ignLidar' ? t('rw.chmAuto') : ''
      } catch (e) { msg.textContent = t('rw.copFail', { msg: (e as Error).message }) }
      return
    }
    // every tile under a 0.3° window (about ±33 km, enough for a turned 32 km area), cut and joined
    const { box, tiles } = copernicusTiles(lat, lon, 0.3)
    try {
      const got: Dem[] = []
      let lastErr = ''
      for (const [k, tile] of tiles.entries()) {
        msg.textContent = t('rw.downloading', { id: `${tile.id} (${k + 1}/${tiles.length})` })
        try { got.push(await readTiff(await fetchTile(tile), tile.id)) } catch (e) { lastErr = (e as Error).message } // missing tile = open sea
      }
      if (!got.length) throw new Error(lastErr || '404')
      fromCop = true
      srcCredit = ''
      msg.textContent = t('rw.joining')
      await new Promise((r) => setTimeout(r, 20))
      await useDem(mosaic(got, box, `Copernicus ${lat.toFixed(3)} ${lon.toFixed(3)}`), [lat, lon])
      msg.textContent = ''
    } catch (e) { msg.textContent = t('rw.copFail', { msg: (e as Error).message }) }
  }
  async function fetchTile(tile: { id: string; url: string }) {
    try {
      const r = await fetch(tile.url)
      if (!r.ok) throw new Error(String(r.status))
      return await r.arrayBuffer()
    } catch {
      // no CORS from the browser: the local bridge fetches it (and keeps a copy)
      const r = await fetch(`${BRIDGE_URL}/dem?tile=${tile.id}`)
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? `bridge ${r.status}`)
      return r.arrayBuffer()
    }
  }

  // --- place search (OpenStreetMap Nominatim, one request per click) and 4 favourites ---
  $<HTMLButtonElement>('rwFind').addEventListener('click', async () => {
    const q = $<HTMLInputElement>('rwPlace').value.trim()
    if (!q) return
    msg.textContent = t('rw.finding')
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`)
      const js = (await r.json()) as { lat: string; lon: string; display_name: string }[]
      if (!js.length) return void (msg.textContent = t('rw.notFound', { q }))
      $<HTMLInputElement>('rwLat').value = Number(js[0].lat).toFixed(4)
      $<HTMLInputElement>('rwLon').value = Number(js[0].lon).toFixed(4)
      msg.textContent = t('rw.found', { name: js[0].display_name })
    } catch (e) { msg.textContent = (e as Error).message }
  })
  $<HTMLInputElement>('rwPlace').addEventListener('keydown', (e) => { if (e.key === 'Enter') $<HTMLButtonElement>('rwFind').click() })
  interface Fav { lat: number; lon: number; size: number; rot: number }
  const favs = (): (Fav | null)[] => { try { const v = JSON.parse(localStorage.getItem('mapgen.rwFavs') ?? '[]'); return Array.isArray(v) ? v : [] } catch { return [] } }
  function drawFavs() {
    const box = $<HTMLSpanElement>('rwFavs')
    box.innerHTML = ''
    const list = favs()
    for (let i = 0; i < 4; i++) {
      const f = list[i] ?? null
      const b = document.createElement('button')
      b.type = 'button'
      b.textContent = f ? `★${i + 1}` : `☆${i + 1}`
      b.title = f ? t('rw.favUse', { lat: f.lat.toFixed(3), lon: f.lon.toFixed(3), km: (f.size / 1000).toFixed(1) }) : t('rw.favSave')
      b.addEventListener('click', async (ev) => {
        const cur = favs()
        if (f && !ev.shiftKey) {
          $<HTMLInputElement>('rwLat').value = String(f.lat); $<HTMLInputElement>('rwLon').value = String(f.lon)
          await copDownload()
          if (area) { area.size = f.size; area.rot = f.rot; fill(); redraw() }
          return
        }
        const d = effective()
        if (!d || !area || !isGeographic(d.crs)) return void (msg.textContent = t('rw.favNeedCop'))
        cur[i] = { lat: area.cy, lon: area.cx, size: area.size, rot: area.rot }
        try { localStorage.setItem('mapgen.rwFavs', JSON.stringify(cur)) } catch { /* private mode */ }
        drawFavs()
      })
      box.append(b)
    }
  }
  drawFavs()
  for (const b of Array.from(root!.querySelectorAll<HTMLButtonElement>('[data-km]'))) {
    b.addEventListener('click', () => { if (area) { area.size = Number(b.dataset.km) * 1024; fill(); redraw() } })
  }

  for (const id of ['rwPixel', 'rwBlack', 'rwWhite', 'rwCrs']) $<HTMLInputElement>(id).addEventListener('change', () => { if (dem) { const a = area; void useDem(dem).then(() => { if (a && id === 'rwCrs') { area = a; fill(); redraw() } }) } })

  // --- the preview ---
  function makeShade(d: Dem): ImageData {
    const W = cv.width, H = cv.height, img = g.createImageData(W, H)
    const sc = Math.min(W / d.w, H / d.h)
    const [lo, hi] = demRange(d)
    const at = (c: number, r: number) => d.data[Math.min(d.h - 1, Math.max(0, r)) * d.w + Math.min(d.w - 1, Math.max(0, c))]
    const zf = d.normalized ? 255 : 1
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const c = Math.floor(x / sc), r = Math.floor(y / sc), o = (y * W + x) * 4
      if (c >= d.w || r >= d.h) { img.data[o + 3] = 255; continue }
      const v = at(c, r)
      const step = Math.max(1, Math.round(1 / sc))
      const sx = (at(c + step, r) - at(c - step, r)) * zf, sy = (at(c, r + step) - at(c, r - step)) * zf
      const lum = Math.max(0.25, Math.min(1.2, 0.85 - (sx - sy) * 0.02 * sc))
      const k = hi > lo ? (v - lo) / (hi - lo) : 0
      const nodata = d.nodata !== null && (v === d.nodata || v < -1e4)
      const [cr, cg, cb] = nodata ? [30, 50, 80] : k < 0.02 && lo <= 0 && !d.normalized ? [60, 100, 150] : [90 + 120 * k, 120 + 80 * k, 70 + 110 * k]
      img.data[o] = cr * lum; img.data[o + 1] = cg * lum; img.data[o + 2] = cb * lum; img.data[o + 3] = 255
    }
    return img
  }
  function toCanvas(d: Dem, x: number, y: number): [number, number] {
    const sc = Math.min(cv.width / d.w, cv.height / d.h)
    return [((x - d.x0) / d.dx) * sc, ((y - d.y0) / d.dy) * sc]
  }
  function redraw() {
    g.fillStyle = '#20242a'; g.fillRect(0, 0, cv.width, cv.height)
    const d = effective()
    if (!d || !area) { g.fillStyle = '#aaa'; g.fillText(t('rw.empty'), 20, 30); return }
    if (shade) g.putImageData(shade, 0, 0)
    const h = area.size / 2
    g.beginPath()
    for (const [lx, lz] of [[-h, -h], [h, -h], [h, h], [-h, h]]) g.lineTo(...toCanvas(d, ...toSource(d, area, lx, lz)))
    g.closePath(); g.strokeStyle = '#ff6b3d'; g.lineWidth = 2; g.stroke(); g.lineWidth = 1
    // north edge of the area (top of the Reforger map)
    g.beginPath(); g.moveTo(...toCanvas(d, ...toSource(d, area, -h, h))); g.lineTo(...toCanvas(d, ...toSource(d, area, h, h)))
    g.strokeStyle = '#fff'; g.lineWidth = 3; g.stroke(); g.lineWidth = 1
    const cols = num('rwCols')
    const [, top] = d.normalized ? [0, num('rwWhite')] : demRange(d)
    const over = (top - num('rwSea')) * Math.max(0.1, num('rwExag') || 1) > 2046
    $<HTMLDivElement>('rwStep').textContent = t('rw.step', { step: (area.size / (cols - 1)).toFixed(2), km: (area.size / 1000).toFixed(2) }) + (over ? ' — ' + t('rw.tooHigh') : '')
  }
  function fill() {
    if (!area) return
    $<HTMLInputElement>('rwSize').value = String(Math.round(area.size))
    $<HTMLInputElement>('rwRot').value = String(Math.round(area.rot))
  }
  $<HTMLInputElement>('rwSize').addEventListener('change', () => { if (area) { area.size = Math.max(256, Math.min(40960, num('rwSize'))); redraw() } })
  $<HTMLInputElement>('rwRot').addEventListener('change', () => { if (area) { area.rot = num('rwRot') || 0; redraw() } })
  $<HTMLSelectElement>('rwCols').addEventListener('change', redraw)
  let drag: [number, number] | null = null
  cv.addEventListener('mousedown', (e) => { drag = [e.offsetX, e.offsetY] })
  window.addEventListener('mouseup', () => { drag = null })
  cv.addEventListener('mousemove', (e) => {
    const d = effective()
    if (!drag || !d || !area) return
    const r = cv.getBoundingClientRect(), k = cv.width / r.width
    const sc = Math.min(cv.width / d.w, cv.height / d.h)
    area.cx += (((e.offsetX - drag[0]) * k) / sc) * d.dx
    area.cy += (((e.offsetY - drag[1]) * k) / sc) * d.dy
    drag = [e.offsetX, e.offsetY]
    redraw()
  })
  cv.addEventListener('wheel', (e) => {
    if (!area) return
    e.preventDefault()
    if (e.shiftKey) area.rot = Math.round(area.rot + (e.deltaY > 0 ? 5 : -5))
    else area.size = Math.max(256, Math.min(40960, Math.round((area.size * (e.deltaY > 0 ? 1.1 : 1 / 1.1)) / 64) * 64))
    fill()
    redraw()
  }, { passive: false })

  $<HTMLInputElement>('rwOsmFile').addEventListener('change', async (ev) => {
    const f = (ev.target as HTMLInputElement).files?.[0]
    if (!f) return
    try { osmFile = JSON.parse(await f.text()); msg.textContent = t('rw.osmFileOk', { name: f.name }) } catch (e) { msg.textContent = (e as Error).message }
  })

  let chm: Dem | null = null
  $<HTMLInputElement>('rwChm').addEventListener('change', async (ev) => {
    const f = (ev.target as HTMLInputElement).files?.[0]
    if (!f) return
    try { chm = await readDem(f); msg.textContent = t('rw.chmOk', { name: f.name }) } catch (e) { msg.textContent = (e as Error).message }
  })

  // --- build ---
  $<HTMLButtonElement>('rwGo').addEventListener('click', async () => {
    const d = effective()
    if (!d || !area) return void (msg.textContent = t('rw.empty'))
    if (d.crs && !crsKnown(d.crs)) return void (msg.textContent = t('rw.badCrs', { crs: d.crs }))
    const btn = $<HTMLButtonElement>('rwGo')
    btn.disabled = true
    try {
      msg.textContent = t('rw.building')
      await new Promise((r) => setTimeout(r, 30))
      const world = buildWorld(d, area, {
        cols: num('rwCols'), exaggeration: Math.max(0.1, num('rwExag') || 1), sea: num('rwSea'),
        pngRange: d.normalized ? [num('rwBlack'), num('rwWhite')] : undefined,
      })
      const credits: string[] = []
      if (srcCredit) credits.push(srcCredit)
      if (fromCop) credits.push('Copernicus DEM GLO-30 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018, provided under COPERNICUS by the European Union and ESA')
      let osm: OsmResult | null = null
      let adapted: RealPlace['adapted']
      const ck = (id: string) => $<HTMLInputElement>(id).checked
      const ar = area
      const toLL = d.crs ? localToLonLat(d, ar) : null
      // ESA WorldCover: ground surfaces for every terrain vertex, forests outlined from the tree class
      let cover: Uint8Array | undefined
      let warn = ''
      let wcForests: number[][] = []
      if ((ck('rwWc') || ck('rwWcForest')) && toLL) {
        msg.textContent = t('rw.wcFetching')
        const [s, w, n, e] = areaLonLat(d, ar)
        const wc = await fetchWorldCover(s, w, n, e, Math.min(2048, Math.ceil((ar.size * 1.45) / 10))).catch((err: Error) => { warn = t('rw.wcFail', { msg: err.message }); return null })
        if (wc) {
        const code = (x: number, z: number) => {
          const [lon, lat] = toLL(x - ar.size / 2, z - ar.size / 2)
          const c = Math.round((lon - wc.x0) / wc.dx), r = Math.round((lat - wc.y0) / wc.dy)
          return c < 0 || r < 0 || c >= wc.w || r >= wc.h ? 0 : wc.data[r * wc.w + c]
        }
        if (ck('rwWc')) {
          cover = new Uint8Array(world.cols * world.rows)
          for (let r = 0; r < world.rows; r++) for (let c = 0; c < world.cols; c++) cover[r * world.cols + c] = WORLDCOVER[code(c * world.step, r * world.step)] ?? 0
        }
        if (ck('rwWcForest')) wcForests = treeOutlines(code, ar.size)
        credits.push(CREDITS.worldcover)
        }
      }
      if (wcForests.length && !ck('rwOsm')) {
        osm = { roads: [], rivers: [], lakes: [], forests: [], fields: [], sites: [], buildings: [] }
        osm.forests.push(...wcForests.map((pts) => ({ pts, leaf: 'mixed' as const })))
        adapted = adaptForGame(osm, { ...ADAPT_DEFAULTS, minForest: Math.max(0, num('rwMinForest')) * 10000 })
      }
      if (ck('rwOsm')) {
        if (!d.crs) throw new Error(t('rw.noGeo'))
        const o: OsmOptions = {
          mainRoads: ck('rwMain'), minorRoads: ck('rwMinor'), tracks: ck('rwTracks'), paths: ck('rwPaths'),
          water: ck('rwWater'), forests: ck('rwForests'), fields: ck('rwFields'), places: ck('rwPlaces'), buildings: ck('rwBuildings'),
          minForest: Math.max(0, num('rwMinForest')) * 10000,
        }
        let data = osmFile
        if (!data) {
          msg.textContent = t('rw.osmFetching')
          data = await fetchOverpass(overpassQuery(areaLonLat(d, area), o))
        }
        // adapted: keep small woods for now, they may weld into a forest; the size limit applies after
        const adapt = ck('rwAdapt')
        osm = osmToMap(data, lonLatToLocal(d, area), area.size, adapt || wcForests.length ? { ...o, minForest: Math.min(o.minForest, 1000) } : o)
        // WorldCover woods join the OpenStreetMap ones, welded below
        osm.forests.push(...wcForests.map((pts) => ({ pts, leaf: 'mixed' as const })))
        if (chm) {
          if (chm.crs && d.crs && chm.crs !== d.crs) throw new Error(t('rw.chmCrs', { a: chm.crs, b: d.crs }))
          const ar = area
          canopyClasses(osm.forests, chm, (x, z) => toSource(d, ar, x - ar.size / 2, z - ar.size / 2))
        }
        if (adapt) adapted = adaptForGame(osm, { ...ADAPT_DEFAULTS, minForest: o.minForest })
        else if (wcForests.length) adapted = adaptForGame(osm, { ...ADAPT_DEFAULTS, minForest: o.minForest, minRoad: 0, perCell: 1e9, maxBuildings: 1e9 })
        credits.push(OSM_ATTRIBUTION)
      }
      let trace: HTMLCanvasElement | undefined
      if (ck('rwSat') && toLL) {
        msg.textContent = t('rw.satFetching')
        const [s, w, n, e] = areaLonLat(d, ar)
        trace = areaPicture(await fetchImagery(s, w, n, e, 2048), [s, w, n, e], toLL, ar.size)
        credits.push(CREDITS.esri)
      }
      onApply({ world, osm, name: d.name, credits, adapted, cover, trace, warn })
      root!.hidden = true
      msg.textContent = ''
    } catch (e) {
      msg.textContent = t('err.generic', { msg: (e as Error).message })
    } finally {
      btn.disabled = false
    }
  })
  $<HTMLButtonElement>('rwClose').addEventListener('click', () => { root!.hidden = true })
  redraw()
}

/** outlines of the WorldCover tree class (code 10 / 95) on a grid of about 20 m, local metres, open rings */
function treeOutlines(code: (x: number, z: number) => number, size: number): number[][] {
  const step = Math.max(20, size / 400), n = Math.floor(size / step) + 1, DEG = 111320
  const pts: ReturnType<typeof turf.point>[] = []
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    const v = code(c * step, r * step)
    pts.push(turf.point([(c * step) / DEG, (r * step) / DEG], { v: v === 10 || v === 95 ? 1 : 0 }))
  }
  const bands = turf.isobands(turf.featureCollection(pts), [0.5, 1.5], { zProperty: 'v' })
  const out: number[][] = []
  for (const f of bands.features) {
    for (const poly of f.geometry.coordinates) {
      const ring = poly[0]
      if (!ring || ring.length < 4) continue
      const flat: number[] = []
      for (const [x, z] of ring.slice(0, -1)) flat.push(x * DEG, z * DEG)
      out.push(flat)
    }
  }
  return out
}

/** the satellite picture turned into the area frame: north of the area up, 1 px ≈ size / 2048 m */
function areaPicture(img: HTMLCanvasElement, [s, w, n, e]: [number, number, number, number], toLL: (lx: number, lz: number) => [number, number], size: number) {
  const W = Math.min(2048, img.width * 2)
  const src = img.getContext('2d')!.getImageData(0, 0, img.width, img.height).data
  const out = document.createElement('canvas')
  out.width = out.height = W
  const g = out.getContext('2d')!
  const data = g.createImageData(W, W)
  for (let r = 0; r < W; r++) {
    for (let c = 0; c < W; c++) {
      // row 0 = north edge of the area
      const [lon, lat] = toLL(((c + 0.5) / W - 0.5) * size, (0.5 - (r + 0.5) / W) * size)
      const x = Math.floor(((lon - w) / (e - w)) * img.width), y = Math.floor(((n - lat) / (n - s)) * img.height)
      if (x < 0 || y < 0 || x >= img.width || y >= img.height) continue
      const i = (y * img.width + x) * 4, o = (r * W + c) * 4
      data.data[o] = src[i]; data.data[o + 1] = src[i + 1]; data.data[o + 2] = src[i + 2]; data.data[o + 3] = 255
    }
  }
  g.putImageData(data, 0, 0)
  return out
}
