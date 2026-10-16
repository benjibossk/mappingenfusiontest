// "Start from a real place" window: open an elevation file (or download a Copernicus DEM tile), pick the
// area on a shaded preview (drag = move, wheel = size, Shift + wheel = turn), then build the terrain and,
// when the file is georeferenced, bring OpenStreetMap roads, water, forests, fields and places with it.

import { BRIDGE_URL, type WorldExport } from './bridge'
import { t, type Key } from './i18n'
import {
  type Area, type Dem, CRS_CHOICES, areaLonLat, buildWorld, copernicusTile, crsKnown, defaultArea, demRange,
  isGeographic, lonLatToLocal, readDem, readTiff, toSource,
} from './modules/dem'
import { canopyClasses } from './modules/canopy'
import { OSM_ATTRIBUTION, type OsmOptions, type OsmResult, fetchOverpass, osmToMap, overpassQuery } from './modules/osm'

export interface RealPlace {
  world: WorldExport
  osm: OsmResult | null
  name: string
  credits: string[]
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
            <span>${L('rw.cop')}</span>
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
            ${chk('rwWater', 'rw.water')}${chk('rwForests', 'rw.forests')}${chk('rwFields', 'rw.fields')}${chk('rwPlaces', 'rw.places')}${chk('rwBuildings', 'rw.buildings', false)}
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
  async function useDem(d: Dem, at?: [number, number]) {
    dem = d
    $<HTMLDivElement>('rwPng').hidden = !d.normalized
    $<HTMLInputElement>('rwCrs').value = d.crs ?? ''
    $<HTMLInputElement>('rwCrs').disabled = !!d.normalized
    const e = effective()!
    area = defaultArea(e)
    if (at && isGeographic(e.crs)) { area.cx = at[1]; area.cy = at[0]; area.size = 8192 }
    area.size = Math.min(area.size, 20480)
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
    try { fromCop = false; await useDem(await readDem(f)); msg.textContent = '' } catch (e) { msg.textContent = (e as Error).message }
  })
  $<HTMLButtonElement>('rwCopGo').addEventListener('click', async () => {
    const lat = num('rwLat'), lon = num('rwLon')
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 85 || Math.abs(lon) > 180 || ($<HTMLInputElement>('rwLat').value === '')) return void (msg.textContent = t('rw.badLatLon'))
    const tile = copernicusTile(lat, lon)
    msg.textContent = t('rw.downloading', { id: tile.id })
    try {
      let buf: ArrayBuffer
      try {
        const r = await fetch(tile.url)
        if (!r.ok) throw new Error(String(r.status))
        buf = await r.arrayBuffer()
      } catch {
        // no CORS from the browser: the local bridge fetches it (and keeps a copy)
        const r = await fetch(`${BRIDGE_URL}/dem?tile=${tile.id}`)
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? `bridge ${r.status}`)
        buf = await r.arrayBuffer()
      }
      fromCop = true
      await useDem(await readTiff(buf, tile.id), [lat, lon])
      msg.textContent = ''
    } catch (e) { msg.textContent = t('rw.copFail', { msg: (e as Error).message }) }
  })
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
    $<HTMLDivElement>('rwStep').textContent = t('rw.step', { step: (area.size / (cols - 1)).toFixed(2), km: (area.size / 1000).toFixed(2) })
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
      if (fromCop) credits.push('Copernicus DEM GLO-30 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018, provided under COPERNICUS by the European Union and ESA')
      let osm: OsmResult | null = null
      const ck = (id: string) => $<HTMLInputElement>(id).checked
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
        osm = osmToMap(data, lonLatToLocal(d, area), area.size, o)
        if (chm) {
          if (chm.crs && d.crs && chm.crs !== d.crs) throw new Error(t('rw.chmCrs', { a: chm.crs, b: d.crs }))
          const ar = area
          canopyClasses(osm.forests, chm, (x, z) => toSource(d, ar, x - ar.size / 2, z - ar.size / 2))
        }
        credits.push(OSM_ATTRIBUTION)
      }
      onApply({ world, osm, name: d.name, credits })
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
