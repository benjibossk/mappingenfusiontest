import './style.css'
import { external, fr, getLang, t } from './i18n'
import { Collab } from './collab'
import { GENERATORS, type Project, type ProjectEntity, type ProjectShape } from './project'
import { openRealWorld, type RealPlace } from './realWorld'
import { rasterCover } from './modules/cover'
import { osmBuildings } from './modules/realBuildings'
import { WATER_TYPES, carveWater, riverBanks, riverCourse, waterMasks, placeLakes, splitAtWater, bridges, traceRivers, waterShapes, type Water, type WaterType } from './modules/water'
import { BRIDGE_URL, applyHeightmap, getStatus, getExisting, getTemplates, getWorld, type Existing, type ExistingObject, type ExistingShape, type WorldExport, prepareSurfaces, sendToWorkbench, writeMasks } from './bridge'
import { computeSurfaces, SURFACE_COLOURS, generateIsland, overfullBlocks, type Island } from './modules/island'
import { computeRivers } from './modules/hydro'
import { Sculpt } from './modules/sculpt'
import { generateCampaign, type CampaignResult } from './modules/campaign'
import { ROAD_COLOURS, ROAD_TYPES, carveRoads, roadFurniture, roadHalf, roadMasks, roadSigns, roadShapes, snap, type Road, type RoadType } from './modules/roads'

// map layers the user can hide (floating "Calques" panel)
const LAYERS = ['existing', 'areas', 'fields', 'water', 'roads', 'furniture', 'sites', 'buildings', 'bridges', 'issues'] as const
const hiddenLayers = new Set<string>()
const layer = (l: (typeof LAYERS)[number]) => !hiddenLayers.has(l)
let collab: Collab | null = null // shared room, see src/collab.ts
let quietUntil = 0 // a project just received from the room is not sent back
let saveTimer = 0 // declared early: handlers registered above autosave() may fire first
let issues: Issue[] = [] // read by draw(), which runs during start-up
/** what already stands in the imported world: shown locked, kept clear by the generators */
let existing: Existing = { objects: [], shapes: [] }
/** origins of existing objects taken over or deleted in the map, deleted in the Workbench on the next send */
//! family: deleted only by a send that rebuilds it (ROAD_ / WATER_), ANY = deleted by hand, on any send
interface Removed { f: 'ROAD_' | 'WATER_' | 'ANY'; x: number; z: number }
let removed: Removed[] = []
/** forests and field areas brought from OpenStreetMap (realWorld.ts): forests are sent as forest generators */
interface MapArea { id: string; kind: 'forest' | 'field'; leaf?: 'broad' | 'needle' | 'mixed'; tall?: 'low' | 'mid' | 'high'; pts: number[] }
let areas: MapArea[] = []
/** data sources of the terrain (licences asking for attribution) */
let credits: string[] = []
const toWb = async (p: Project) => {
  const ids = [...p.shapes.map((s) => s.id), ...(p.entities ?? []).map((e) => e.id)]
  const go = (r: Removed) => r.f === 'ANY' || ids.some((id) => id.startsWith(r.f))
  const msg = await sendToWorkbench({ ...p, remove: removed.filter(go).flatMap((r) => [r.x, r.z]) })
  removed = removed.filter((r) => !go(r))
  autosave()
  return msg
}
import { SITE_RADIUS, buildNetwork, pickSites, type Site, type SiteKind } from './modules/network'
import { validate, type Issue } from './modules/validate'
import { worldToIsland } from './modules/importWorld'
import { parcelItems, parcelPool, type Parcel } from './modules/templates'
import { libraryParcels, openParcels } from './parcels'
import { CAT_COLOUR, settle, settlementEntities, buildingMasks, settlementShapes, type Placed, type Square } from './modules/settlements'
import { isLand, loadHeightmap, renderTerrain, type Heightmap } from './terrain'

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
<div class="app">
  <header class="top">
    <strong>reforger-mapper</strong>
    <button id="undo" class="hist" title="${t('app.undo')}">↶</button>
    <button id="redo" class="hist" title="${t('app.redo')}">↷</button>
    <button id="lang" class="hist" title="Language / Langue">${getLang() === 'fr' ? 'EN' : 'FR'}</button>
    <button id="collab" class="hist" title="${t('collab.tip')}">👥</button>
    <span id="collabInfo" class="hint"></span>
    <span id="status" class="status" title="${t('app.refresh')}">…</span>
    <span id="cursor" class="hint"></span>
  </header>
  <div id="collabBox" class="ctxmenu collabbox" hidden>
    <div class="title">${t('collab.title')}</div>
    <label>${t('collab.server')} <input id="collabUrl" type="text"></label>
    <label>${t('collab.room')} <input id="collabRoom" type="text"></label>
    <label>${t('collab.name')} <input id="collabName" type="text"></label>
    <label>${t('collab.key')} <input id="collabKey" type="password" autocomplete="off"></label>
    <button id="collabGo" type="button">${t('collab.join')}</button>
    <div class="info">${t('collab.hint')}</div>
  </div>

  <nav class="rail" id="tools">
    <button type="button" data-tool="zone" title="${t('tool.zone.tip')}"><b>1</b>${t('tool.zone')}</button>
    <hr>
    <button type="button" data-tool="raise" title="${t('tool.raise.tip')}"><b>2</b>${t('tool.raise')}</button>
    <button type="button" data-tool="lower" title="${t('tool.lower.tip')}"><b>3</b>${t('tool.lower')}</button>
    <button type="button" data-tool="flatten" title="${t('tool.flatten.tip')}"><b>4</b>${t('tool.flatten')}</button>
    <button type="button" data-tool="smooth" title="${t('tool.smooth.tip')}"><b>5</b>${t('tool.smooth')}</button>
    <button type="button" data-tool="sea" title="${t('tool.sea.tip')}"><b>6</b>${t('tool.sea')}</button>
    <hr>
    <button type="button" data-tool="dry" title="${t('tool.dry.tip')}"><b>7</b>${t('tool.dry')}</button>
    <button type="button" data-tool="wet" title="${t('tool.wet.tip')}"><b>8</b>${t('tool.wet')}</button>
    <hr>
    <button type="button" data-tool="road" title="${t('tool.road.tip')}"><b>9</b>${t('tool.road')}</button>
    <button type="button" data-tool="water" hidden>${t('tab.water')}</button>
  </nav>

  <section class="stage">
    <canvas id="map" class="map" width="800" height="800"></canvas>
    <div id="ctxMenu" class="ctxmenu" hidden></div>
    <details id="layers" class="layers">
      <summary>${t('layers.title')}</summary>
      ${LAYERS.map((l) => `<label class="check"><input type="checkbox" data-layer="${l}" checked> ${t(('layers.' + l) as Parameters<typeof t>[0])}</label>`).join('')}
      <div class="trace" title="${t('hint.trace')}">
        <label class="check">${t('layers.trace')} <input id="traceFile" type="file" accept="image/*"></label>
        <input id="traceAlpha" type="range" min="0" max="1" step="0.05" value="0.6">
        <button id="traceClear" type="button">${t('btn.traceClear')}</button>
      </div>
    </details>
    <div class="overlay">
      <span id="brushInfo"></span>
      <span class="hint">${t('hint.map')}</span>
    </div>
  </section>

  <aside class="side">
    <div class="tabs" id="tabs">
      <button type="button" data-tab="island" class="active">${t('tab.island')}</button>
      <button type="button" data-tab="brush">${t('tab.brush')}</button>
      <button type="button" data-tab="water">${t('tab.water')}</button>
      <button type="button" data-tab="roads">${t('tab.roads')}</button>
      <button type="button" data-tab="villages">${t('tab.villages')}</button>
      <button type="button" data-tab="wb">${t('tab.wb')}</button>
      <button type="button" data-tab="camp">${t('tab.fields')}</button>
    </div>

    <div class="tab" data-tab="island">
      <div class="form">
        <label>${t('lbl.tSize')} <input id="tSize" type="number" value="4096"></label>
        <label>${t('lbl.tIslands')} <input id="tIslands" type="number" min="1" value="1"></label>
        <label>${t('lbl.tMax')} <input id="tMax" type="number" value="180"></label>
        <label>${t('lbl.tSea')} <input id="tSea" type="number" value="30"></label>
        <label>${t('lbl.tLand')} <input id="tLand" type="number" step="0.05" value="0.55"></label>
        <label>${t('lbl.tRough')} <input id="tRough" type="number" step="0.1" value="0.6"></label>
        <label>${t('lbl.tSeed')} <input id="tSeed" type="number" value="1"></label>
        <label>${t('lbl.tSeaLevel')} <input id="tSeaLevel" type="number" step="1" value="0"></label>
      </div>
      <div class="row">
        <button id="tGen" type="button">${t('btn.tGen')}</button>
        <button id="tReroll" type="button" class="secondary">${t('btn.tReroll')}</button>
        <button id="tImport" type="button" class="secondary" title="${t('hint.tImport')}">${t('btn.tImport')}</button>
        <button id="tReal" type="button" class="secondary" title="${t('hint.tReal')}">${t('btn.tReal')}</button>
      </div>
      <div class="row">
        <button id="pSave" type="button" class="secondary">${t('btn.pSave')}</button>
        <button id="pOpen" type="button" class="secondary">${t('btn.pOpen')}</button>
        <input id="pFile" type="file" accept=".json,application/json" hidden>
      </div>
      <p class="hint">${t('hint.island')}</p>
    </div>

    <div class="tab" data-tab="brush" hidden>
      <div class="form">
        <label>${t('lbl.bRadius')} <input id="bRadius" type="number" value="200"></label>
        <label>${t('lbl.bStrength')} <input id="bStrength" type="number" value="4"></label>
      </div>
      <p class="hint">${t('hint.brush')}</p>
    </div>

    <div class="tab" data-tab="water" hidden>
      <div class="form">
        <label>${t('lbl.waterType')} <select id="wType">${Object.entries(WATER_TYPES).map(([k, wt]) => `<option value="${k}">${wt.label}</option>`).join('')}</select></label>
        <label>${t('lbl.waterWidth')} <input id="wWidth" type="number" step="1" min="2" value="12"></label>
        <label>${t('lbl.waterDepth')} <input id="wDepth" type="number" step="0.5" min="0.5" value="1.5"></label>
      </div>
      <label class="check" hidden><input id="wCarve" type="checkbox"> ${t('lbl.waterCarve')}</label>
      <div class="row">
        <button id="wNew" type="button">${t('btn.waterNew')}</button>
        <button id="wClear" type="button" class="secondary">${t('btn.waterClear')}</button>
      </div>
      <button id="wSend" type="button">${t('btn.waterSend')}</button>
      <div class="row">
        <button id="wGen" type="button" class="secondary">${t('btn.waterGen')}</button>
        <button id="wTest" type="button">${t('btn.waterTest')}</button>
      </div>
      <p class="hint">${t('hint.water')}</p>
      <ul id="wList" class="roadlist"></ul>
      <fieldset>
        <legend>${t('legend.waterSim')}</legend>
      <label class="check"><input id="rLive" type="checkbox" checked> ${t('lbl.rLive')}</label>
      <div class="form">
        <label>${t('lbl.rRain')} <input id="rRain" type="number" step="0.1" value="1"></label>
        <label>${t('lbl.rWind')} <input id="rWind" type="number" value="0"></label>
        <label>${t('lbl.rThreshold')} <input id="rThreshold" type="number" value="400"></label>
        <label>${t('lbl.rDepth')} <input id="rDepth" type="number" value="4"></label>
        <label>${t('lbl.lMinArea')} <input id="lMinArea" type="number" step="500" value="2000"></label>
        <label>${t('lbl.lSource')} <input id="lSource" type="number" min="0" max="100" value="30"></label>
      </div>
      <div class="row">
        <button id="rRun" type="button" class="secondary">${t('btn.rRun')}</button>
        <button id="rClear" type="button" class="secondary">${t('btn.rClear')}</button>
      </div>
      <p class="hint">${t('hint.rivers')}</p>
      </fieldset>
    </div>

    <div class="tab" data-tab="roads" hidden>
      <div class="form">
        <label>${t('lbl.roadType')} <select id="roadType">${Object.entries(ROAD_TYPES).map(([k, rt]) => `<option value="${k}">${rt.label}</option>`).join('')}</select></label>
        <label>${t('lbl.roadSnap')} <input id="roadSnap" type="number" value="30"></label>
        <label>${t('lbl.roadWidth')} <input id="roadWidth" type="number" step="0.5" min="0" placeholder="${t('ph.auto')}"></label>
      </div>
      <label class="check"><input id="roadLeft" type="checkbox"> ${t('lbl.roadLeft')}</label>
      <label class="check"><input id="roadFlatten" type="checkbox"> ${t('lbl.roadFlatten')}</label>
      <fieldset class="test">
        <legend>${t('legend.net')}</legend>
        <div class="form">
          <label>${t('lbl.netSites')} <input id="netSites" type="number" min="2" max="40" value="8"></label>
          <label>${t('lbl.netSpacing')} <input id="netSpacing" type="number" step="50" min="100" value="600"></label>
          <label>${t('lbl.netSlope')} <input id="netSlope" type="number" step="1" min="2" value="10"></label>
          <label>${t('lbl.netMain')} <select id="netMain">${Object.entries(ROAD_TYPES).map(([k, rt]) => `<option value="${k}"${k === 'asphalt' ? ' selected' : ''}>${rt.label}</option>`).join('')}</select></label>
          <label>${t('lbl.netMinor')} <select id="netMinor">${Object.entries(ROAD_TYPES).map(([k, rt]) => `<option value="${k}"${k === 'asphaltNarrow' ? ' selected' : ''}>${rt.label}</option>`).join('')}</select></label>
          <label>${t('lbl.netLane')} <select id="netLane">${Object.entries(ROAD_TYPES).map(([k, rt]) => `<option value="${k}"${k === 'dirt' ? ' selected' : ''}>${rt.label}</option>`).join('')}</select></label>
        </div>
        <p class="hint">${t('hint.net')}</p>
        <div class="row">
          <button id="sitesPlace" type="button">${t('btn.sitesPlace')}</button>
          <button id="netGen" type="button">${t('btn.netGen')}</button>
          <button id="sitesClear" type="button">${t('btn.sitesClear')}</button>
          <button id="netClear" type="button" class="secondary">${t('btn.netClear')}</button>
        </div>
      </fieldset>
      <p class="hint">${t('hint.roads')}</p>
      <div class="row">
      </div>
      <fieldset class="test">
        <legend>${t('legend.furn')}</legend>
        <label class="check"><input id="furnShow" type="checkbox" checked> ${t('lbl.furnShow')}</label>
        <div class="row">
          <label>${t('lbl.furnDrop')} <input id="furnDrop" type="number" step="0.1" min="0.3" value="1.8"></label>
          <label>${t('lbl.furnPost')} <input id="furnPost" type="number" step="0.1" min="0.1" value="0.9"></label>
        </div>
        <span id="furnInfo" class="hint"></span>
      </fieldset>
      <div class="row">
        <button id="roadNew" type="button">${t('btn.roadNew')}</button>
        <button id="roadUndo" type="button" class="secondary">${t('btn.roadUndo')}</button>
        <button id="roadClear" type="button" class="secondary">${t('btn.roadClear')}</button>
      </div>
      <label class="check"><input id="roadFurn" type="checkbox" checked> ${t('lbl.roadFurn')}</label>
      <button id="roadSend" type="button">${t('btn.roadSend')}</button>
      <fieldset class="test">
        <legend>${t('legend.test')}</legend>
        <p class="hint">${t('hint.roadTest')}</p>
        <div class="row">
          <button id="roadTestDraw" type="button" class="secondary">${t('btn.roadTestDraw')}</button>
          <button id="roadTestAll" type="button">${t('btn.roadTestAll')}</button>
        </div>
      </fieldset>
      <p class="hint">${t('hint.roadGen')}</p>
      <span id="roadInfo" class="hint"></span>
      <p class="hint">${t('hint.roadEdit')}</p>
      <ul id="roadList" class="roadlist"></ul>
    </div>

    <div class="tab" data-tab="villages" hidden>
      <fieldset class="test">
        <legend>${t('legend.set')}</legend>
        <div class="form">
          <label>${t('lbl.setDensity')} <input id="setDensity" type="number" step="0.1" min="0.1" max="2" value="1"></label>
          <label>${t('lbl.setSeed')} <input id="setSeed" type="number" step="1" value="1"></label>
          <label class="check"><input id="setSquare" type="checkbox" checked> ${t('lbl.setSquare')}</label>
          <label class="check"><input id="setLanes" type="checkbox" checked> ${t('lbl.setLanes')}</label>
          <label class="check"><input id="setPaths" type="checkbox" checked> ${t('lbl.setPaths')}</label>
          <label class="check"><input id="setParcels" type="checkbox"> ${t('lbl.setParcels')}</label>
        </div>
        <button id="parcelLib" type="button">${t('pc.open')}</button>
        <p class="hint">${t('hint.set')}</p>
        <div class="row">
          <button id="setGen" type="button">${t('btn.setGen')}</button>
          <button id="setClear" type="button" class="secondary">${t('btn.setClear')}</button>
          <button id="setSend" type="button">${t('btn.setSend')}</button>
        </div>
        <span id="setInfo" class="hint"></span>
      </fieldset>
    </div>
    <div class="tab" data-tab="wb" hidden>
      <div class="form">
        <label>${t('lbl.tAddon')} <input id="tAddon" value="Mapgenerator"></label>
        <label>${t('lbl.tWorld')} <input id="tWorld" value="Worlds/MG_Test"></label>
      </div>
      <ol class="steps">
        <li><button id="tSurf" type="button" class="secondary">${t('btn.tSurf')}</button><span class="hint">${t('wb.closed')}</span></li>
        <li><button id="tHeight" type="button" class="secondary">${t('btn.tHeight')}</button><span class="hint">${t('wb.open')}</span></li>
        <li><button id="tMasks" type="button" class="secondary">${t('btn.tMasks')}</button><span class="hint">${t('wb.thenImport')}</span></li>
      </ol>
      <p class="hint">${t('hint.wbImport')}</p>
      <button id="loadTerrain" type="button" class="secondary">${t('btn.loadTerrain')}</button>
      <fieldset class="test">
        <legend>${t('legend.check')}</legend>
        <p class="hint">${t('hint.check')}</p>
        <button id="checkRun" type="button">${t('btn.check')}</button>
        <ul id="checkList" class="issues"></ul>
      </fieldset>
    </div>

    <div class="tab" data-tab="camp" hidden>
      <div class="form">
        <label class="wide">${t('lbl.zone')} <input id="zone" value=""></label>
        <label>${t('lbl.fieldSize')} <input id="fieldSize" type="number" value="90"></label>
        <label>${t('lbl.jitter')} <input id="jitter" type="number" step="0.1" value="0.6"></label>
        <label>${t('lbl.angle')} <input id="angle" type="number" value="15"></label>
        <label>${t('lbl.hedgeChance')} <input id="hedgeChance" type="number" step="0.1" value="0.5"></label>
        <label>${t('lbl.minHedge')} <input id="minHedge" type="number" value="15"></label>
        <label>${t('lbl.seed')} <input id="seed" type="number" value="1"></label>
        <label>${t('lbl.prefix')} <input id="prefix" value="CAMP"></label>
      </div>
      <p class="hint">${t('hint.zone')}</p>
      <div class="row">
        <button id="generate" type="button">${t('btn.generate')}</button>
        <button id="clearZone" type="button" class="secondary">${t('btn.clearZone')}</button>
      </div>
      <div class="row">
        <button id="forestSend" type="button">${t('btn.forestSend')}</button>
        <button id="areasClear" type="button" class="secondary">${t('btn.areasClear')}</button>
      </div>
      <p class="hint">${t('hint.areas')}</p>
      <details>
        <summary>${t('sum.project')} <code>mapgen.json</code></summary>
        <textarea id="project" spellcheck="false"></textarea>
      </details>
      <button id="send" type="button">${t('btn.send')}</button>
    </div>

    <pre id="log" class="log"></pre>
  </aside>
</div>`

const $ = <T extends HTMLElement>(id: string) => document.querySelector<T>(`#${id}`)!
const statusEl = $<HTMLParagraphElement>('status')
const projectEl = $<HTMLTextAreaElement>('project')
const sendEl = $<HTMLButtonElement>('send')
const logEl = $<HTMLPreElement>('log')
const zoneEl = $<HTMLInputElement>('zone')
const map = $<HTMLCanvasElement>('map')
const ctx = map.getContext('2d')!
const num = (id: string) => Number($<HTMLInputElement>(id).value)

let terrain: Heightmap | null = null
let terrainImg: HTMLCanvasElement | null = null
let result: CampaignResult | null = null
// view: world X/Z at the canvas centre + metres per pixel
const view = { x: 2048, z: 2048, mpp: 4096 / 800 }

const toScreen = (x: number, z: number): [number, number] => [
  (x - view.x) / view.mpp + map.width / 2,
  map.height / 2 - (z - view.z) / view.mpp,
]
const toWorld = (sx: number, sy: number): [number, number] => [
  view.x + (sx - map.width / 2) * view.mpp,
  view.z - (sy - map.height / 2) * view.mpp,
]

function zonePoints(): number[] {
  return zoneEl.value.split(',').map((p) => p.trim()).filter(Boolean).flatMap((p) => p.split(/\s+/).map(Number))
}
function setZone(flat: number[]) {
  const pairs: string[] = []
  for (let i = 0; i + 1 < flat.length; i += 2) pairs.push(`${Math.round(flat[i])} ${Math.round(flat[i + 1])}`)
  zoneEl.value = pairs.join(', ')
  checkpoint()
}

function path(ring: number[][], close: boolean) {
  ctx.beginPath()
  ring.forEach(([x, z], i) => {
    const [sx, sy] = toScreen(x, z)
    if (i === 0) ctx.moveTo(sx, sy)
    else ctx.lineTo(sx, sy)
  })
  if (close) ctx.closePath()
}

function draw() {
  ctx.fillStyle = '#0f1012'
  ctx.fillRect(0, 0, map.width, map.height)
  if (terrain && terrainImg) {
    const [x0, y0] = toScreen(terrain.minX, terrain.minZ + (terrain.rows - 1) * terrain.step)
    const [x1, y1] = toScreen(terrain.minX + (terrain.cols - 1) * terrain.step, terrain.minZ)
    ctx.imageSmoothingEnabled = view.mpp > terrain.step
    ctx.drawImage(terrainImg, x0, y0, x1 - x0, y1 - y0)
  }
  drawTrace()

  if (result && layer('fields')) {
    result.fields.forEach((f, i) => {
      path(f, true)
      ctx.fillStyle = `hsla(${(i * 47) % 360}, 40%, 45%, 0.25)`
      ctx.fill()
      ctx.strokeStyle = 'rgba(0,0,0,0.4)'
      ctx.lineWidth = 1
      ctx.stroke()
    })
    ctx.strokeStyle = '#8be36f'
    ctx.lineWidth = 3
    result.hedges.forEach((h) => {
      path(h, false)
      ctx.stroke()
    })
  }

  if (layer('existing')) drawExisting()
  if (layer('areas')) drawAreas()
  if (layer('water')) drawWater()
  if (layer('roads')) for (const r of [...roads, ...(roadDraft ? [roadDraft] : [])]) {
    const ring: number[][] = []
    for (let i = 0; i + 1 < r.pts.length; i += 2) ring.push([r.pts[i], r.pts[i + 1]])
    path(ring, false)
    ctx.strokeStyle = ROAD_TYPES[r.type].colour
    ctx.lineWidth = Math.max(2, (roadHalf(r) * 2) / view.mpp)
    if (r.id === selRoad) {
      ctx.save()
      ctx.strokeStyle = '#ffd34d'
      ctx.lineWidth += 4
      ctx.stroke()
      ctx.restore()
    }
    ctx.setLineDash(r === roadDraft ? [8, 4] : [])
    ctx.stroke()
    ctx.setLineDash([])
    ctx.fillStyle = '#fff'
    ring.forEach(([x, zz]) => {
      const [sx, sy] = toScreen(x, zz)
      ctx.fillRect(sx - 2, sy - 2, 4, 4)
    })
    const mid = ring[ring.length >> 1]
    if (mid) {
      const [sx, sy] = toScreen(mid[0], mid[1])
      ctx.font = '11px sans-serif'
      ctx.lineWidth = 3
      ctx.strokeStyle = '#000a'
      ctx.strokeText(r.id, sx + 6, sy - 6)
      ctx.fillText(r.id, sx + 6, sy - 6)
    }
  }

  if (furn && layer('furniture') && $<HTMLInputElement>('furnShow').checked && tool() === 'road') drawFurniture(furn)
  if (layer('buildings')) drawSettlements()
  if (layer('sites')) drawSites()

  const z = zonePoints()
  if (z.length >= 2) {
    const ring: number[][] = []
    for (let i = 0; i + 1 < z.length; i += 2) ring.push([z[i], z[i + 1]])
    path(ring, ring.length > 2)
    ctx.strokeStyle = '#ffd34d'
    ctx.lineWidth = 2
    ctx.setLineDash([6, 4])
    ctx.stroke()
    ctx.setLineDash([])
    ctx.fillStyle = '#ffd34d'
    ring.forEach(([x, zz]) => {
      const [sx, sy] = toScreen(x, zz)
      ctx.fillRect(sx - 3, sy - 3, 6, 6)
    })
  }
  if (layer('bridges')) drawBridges()
  if (layer('issues')) drawIssues()
  if (collab) drawPeers()
  drawBrush()
}

function drawBrush() {
  if (!cursorWorld || tool() === 'zone' || tool() === 'road') return
  const [sx, sy] = toScreen(...cursorWorld)
  ctx.beginPath()
  ctx.arc(sx, sy, num('bRadius') / view.mpp, 0, Math.PI * 2)
  ctx.strokeStyle = 'rgba(255,255,255,0.8)'
  ctx.lineWidth = 1.5
  ctx.stroke()
}

function generate() {
  const zone = zonePoints()
  if (zone.length < 6) {
    logEl.textContent = t('zone.min')
    return
  }
  const tr = terrain
  result = generateCampaign({
    zone,
    fieldSize: num('fieldSize'),
    jitter: num('jitter'),
    angle: num('angle'),
    hedgeChance: num('hedgeChance'),
    minHedge: num('minHedge'),
    seed: num('seed'),
    prefix: $<HTMLInputElement>('prefix').value,
    isLand: tr ? (x, zz) => isLand(tr, x, zz) : undefined,
  })
  autosave()

  const project: Project = { version: 0, shapes: result.shapes }
  projectEl.value = JSON.stringify(project, null, 1)
  logEl.textContent =
    t('log.fieldsDone', { fields: result.fields.length, hedges: result.hedges.length }) +
    (tr ? '' : t('log.noTerrain'))
  draw()
}

// --- map interaction ---
function eventPos(e: MouseEvent): [number, number] {
  const r = map.getBoundingClientRect()
  return [((e.clientX - r.left) * map.width) / r.width, ((e.clientY - r.top) * map.height) / r.height]
}
let panFrom: [number, number] | null = null
let cursorWorld: [number, number] | null = null

function heightLabel(x: number, z: number): string {
  if (!terrain) return ''
  const c = Math.round((x - terrain.minX) / terrain.step)
  const r = Math.round((z - terrain.minZ) / terrain.step)
  if (c < 0 || r < 0 || c >= terrain.cols || r >= terrain.rows) return t('map.outside')
  const y = terrain.heights[r * terrain.cols + c]
  return t('map.altitude', { y: y.toFixed(1), water: y <= terrain.ocean ? t('map.water') : '' })
}

map.addEventListener('click', (e) => {
  if (skipClick) return void (skipClick = false)
  if (tool() === 'water' && !waterDraft && toggleBridge(...eventPos(e))) return
  if (tool() === 'water') return void waterClick(...toWorld(...eventPos(e)))
  if (tool() === 'road') {
    if (roadDrawing) return void roadClick(...toWorld(...eventPos(e)))
    return void selectRoad(hitRoad(...eventPos(e))?.id ?? null)
  }
  if (tool() !== 'zone') return
  const [x, z] = toWorld(...eventPos(e))
  setZone([...zonePoints(), x, z])
  draw()
})
map.addEventListener('contextmenu', (e) => {
  e.preventDefault()
  if (tool() === 'water') return void (waterDraft ? finishWater() : openWaterMenu(e))
  if (tool() === 'road') {
    if (roadDrawing) return void finishRoad()
    return void openRoadMenu(e)
  }
  if (tool() === 'zone' && !zonePoints().length && openAreaMenu(e)) return
  setZone(zonePoints().slice(0, -2))
  draw()
})
map.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault()
    if (e.shiftKey || e.ctrlKey) {
      const id = e.shiftKey ? 'bRadius' : 'bStrength'
      const el = $<HTMLInputElement>(id)
      const f = e.deltaY > 0 ? 0.8 : 1.25
      el.value = String(Math.max(e.shiftKey ? 10 : 0.5, Math.round(Number(el.value) * f * 10) / 10))
      setTool(currentTool)
      return
    }
    const [sx, sy] = eventPos(e)
    const [wx, wz] = toWorld(sx, sy)
    view.mpp = Math.min(20, Math.max(0.25, view.mpp * (e.deltaY > 0 ? 1.25 : 0.8)))
    // keep the point under the cursor fixed
    const [nx, nz] = toWorld(sx, sy)
    view.x += wx - nx
    view.z += wz - nz
    draw()
  },
  { passive: false },
)
map.addEventListener('mousedown', (e) => {
  hideMenu()
  if (e.button === 0 && tool() === 'road' && !roadDrawing) {
    const hit = hitRoadPoint(...eventPos(e))
    const hs = hit ? null : hitSite(...eventPos(e))
    if (hs) {
      dragSite = { s: hs, moved: false }
      skipClick = true
      return
    }
    if (hit) {
      selectRoad(hit.r.id)
      dragPt = { ...hit, moved: false }
      skipClick = true
      return
    }
  }
  if (e.button === 0 && tool() !== 'zone' && tool() !== 'road' && island) {
    painting = true
    paintAt(...toWorld(...eventPos(e)))
  }
  if (e.button === 1) {
    e.preventDefault()
    panFrom = eventPos(e)
  }
})
window.addEventListener('mouseup', () => {
  if (dragSite) {
    const moved = dragSite.moved
    dragSite = null
    if (moved) recompose(true)
  }
  if (dragPt) {
    const moved = dragPt.moved
    dragPt = null
    if (moved) { roadInfo(); recompose(true) }
  }
  panFrom = null
  if (painting) {
    painting = false
    afterRelief()
  }
})
map.addEventListener('mousemove', (e) => {
  const p = eventPos(e)
  const [x, z] = toWorld(...p)
  cursorWorld = [x, z]
  if (tool() !== 'zone' && !painting && !panFrom) draw()
  $<HTMLSpanElement>('cursor').textContent = `X ${Math.round(x)}  Z ${Math.round(z)}${heightLabel(x, z)}`
  collab?.sendCursor(x, z)
  if (painting) paintAt(x, z)
  if (dragSite) {
    dragSite.s.x = Math.round(x)
    dragSite.s.z = Math.round(z)
    dragSite.moved = true
    draw()
  }
  if (dragPt) {
    const { r, i } = dragPt
    const ox = r.pts[i], oz = r.pts[i + 1]
    const nx = Math.round(x * 10) / 10, nz = Math.round(z * 10) / 10
    // a junction point moves with every road that shares it
    for (const o of roads) for (let k = 0; k + 1 < o.pts.length; k += 2)
      if (o.pts[k] === ox && o.pts[k + 1] === oz) { o.pts[k] = nx; o.pts[k + 1] = nz }
    dragPt.moved = true
    draw()
  }
  if (panFrom) {
    view.x -= (p[0] - panFrom[0]) * view.mpp
    view.z += (p[1] - panFrom[1]) * view.mpp
    panFrom = p
    draw()
  }
})

$<HTMLButtonElement>('loadTerrain').addEventListener('click', async () => {
  logEl.textContent = t('terrain.loading')
  try {
    terrain = await loadHeightmap(BRIDGE_URL, 8)
    terrainImg = renderTerrain(terrain)
    const size = (terrain.cols - 1) * terrain.step
    view.x = terrain.minX + size / 2
    view.z = terrain.minZ + size / 2
    view.mpp = size / map.width
    logEl.textContent = t('terrain.info', { cols: terrain.cols, rows: terrain.rows, step: terrain.step, ocean: terrain.ocean })
  } catch (e) {
    logEl.textContent = t('err.terrain', { msg: (e as Error).message })
  }
  draw()
})
$<HTMLButtonElement>('generate').addEventListener('click', generate)
$<HTMLButtonElement>('clearZone').addEventListener('click', () => {
  setZone([])
  result = null
  draw()
})
zoneEl.addEventListener('change', draw)

// --- new terrain ---
let island: Island | null = null
// the brush edits sculpt.macro; fine heights and rivers are recomposed from it
let sculpt: Sculpt | null = null
let rivers: Float32Array | undefined
let riverSim: { flow: Float32Array; down: Int32Array } | undefined
let frame = 0
// fine-grid mask painted by "Effacer fleuve": no rain, and water stops there
let sink: Uint8Array | undefined
let painting = false
let selRoad: string | null = null
let dragPt: { r: Road; i: number; moved: boolean } | null = null
let skipClick = false
let dragSite: { s: Site; moved: boolean } | null = null
let roadDrawing = false
let furn: { shapes: ProjectShape[]; signs: ProjectEntity[] } | null = null
let sites: Site[] = []
let settled: Placed[] = [] // settlement buildings (tab Routes, Villages)
let setLanes: Road[] = [] // settlement lanes and footpaths, squares (tab Villages)
let setPaths: Road[] = []
let setSquares: Square[] = []
const setState = () => JSON.stringify({ settled, setLanes, setPaths, setSquares })
function loadSetState(js: string | undefined) {
  const v = js ? JSON.parse(js) : {}
  settled = Array.isArray(v) ? v : v.settled ?? []
  setLanes = v.setLanes ?? []
  setPaths = v.setPaths ?? []
  setSquares = v.setSquares ?? []
}
let waters: Water[] = []
let waterDraft: Water | null = null
let preWater: number[] | null = null // relief before carving: gives the water level
let roads: Road[] = []
let roadDraft: Road | null = null
let currentTool = 'zone'
const tool = () => currentTool
const toolButtons = [...document.querySelectorAll<HTMLButtonElement>('#tools [data-tool]')]
function setTool(name: string) {
  currentTool = name
  toolButtons.forEach((b) => b.classList.toggle('active', b.dataset.tool === name))
  map.style.cursor = name === 'zone' ? 'crosshair' : 'cell'
  $<HTMLSpanElement>('brushInfo').textContent =
    name === 'zone' ? '' : t('brush.info', { r: num('bRadius'), s: num('bStrength') })
}
toolButtons.forEach((b) => b.addEventListener('click', () => setTool(b.dataset.tool!)))
window.addEventListener('keydown', (e) => {
  if ((e.target as HTMLElement).closest('input, textarea, select')) return
  const b = toolButtons[Number(e.key) - 1]
  if (b) setTool(b.dataset.tool!)
})
setTool('zone')

function paintAt(x: number, z: number) {
  if (!island || !sculpt) return
  if (tool() === 'dry' || tool() === 'wet') paintSink(x, z, tool() === 'dry' ? 1 : 0)
  else sculpt.brush(tool(), x, z, num('bRadius'), num('bStrength'), num('tSea'))
  if (!frame) frame = requestAnimationFrame(() => {
    frame = 0
    recompose(false)
  })
}

function paintSink(x: number, z: number, v: number) {
  if (!island) return
  const g = island.grid
  sink ??= new Uint8Array(g.cols * g.rows)
  const R = num('bRadius'), rc = Math.ceil(R / g.step)
  const c0 = Math.round(x / g.step), r0 = Math.round(z / g.step)
  for (let r = Math.max(0, r0 - rc); r <= Math.min(g.rows - 1, r0 + rc); r++)
    for (let c = Math.max(0, c0 - rc); c <= Math.min(g.cols - 1, c0 + rc); c++)
      if (Math.hypot(c - c0, r - r0) * g.step < R) sink[r * g.cols + c] = v
}

//! fine heights from the macro, rivers if live; surfaces only when final (end of stroke)
function recompose(final: boolean) {
  if (!island || !sculpt) return
  const g = island.grid
  // the game sea is always at 0 m: a higher sea level = the whole relief goes down
  const seaLevel = num('tSeaLevel')
  sculpt.seaDepth = num('tSea')
  island.heights = sculpt.compose().map((h) => h - seaLevel)
  preWater = island.heights.slice()
  if (waters.length) carveWater(island.heights, g, waters)
  if (roads.length) carveRoads(island.heights, g, roads)
  rivers = undefined
  riverSim = undefined
  if ($<HTMLInputElement>('rLive').checked) {
    const sim = computeRivers(island.heights, g.cols, g.rows, g.step, {
      rain: num('rRain'), windAngle: num('rWind'), threshold: num('rThreshold'),
      // once the courses are traced as real rivers, only their own tight bed is carved
      depth: waters.some((w) => w.auto) ? 0 : num('rDepth'), sink,
    })
    rivers = sim.river
    riverSim = sim
  }
  if (final) {
    island.surfaces = computeSurfaces(g, island.heights, num('tMax'), rivers, rasterCover(g, areas))
    island.colours = { ...SURFACE_COLOURS, ...island.colours }
    const bad = overfullBlocks(island.surfaces)
    $<HTMLSpanElement>('brushInfo').dataset.warn = bad ? '1' : ''
    if (bad) logEl.textContent = t('log.overfull', { n: bad })
    autosave()
    checkpoint()
    refreshFurniture()
  }
  showIsland()
}

// --- undo / redo (Ctrl+Z, Ctrl+Y / Ctrl+Maj+Z): one snapshot per finished action ---
interface Snap { macro: Float32Array; sink?: Uint8Array; roads: string; zone: string; sites: string; waters: string; settled: string }
const history: Snap[] = []
let histAt = -1, restoring = false
function checkpoint() {
  if (restoring || !sculpt) return
  const snap: Snap = { macro: sculpt.macro.slice(), sink: sink?.slice(), roads: JSON.stringify(roads), zone: zoneEl.value, sites: JSON.stringify(sites), waters: JSON.stringify(waters), settled: setState() }
  const cur = history[histAt]
  if (cur && cur.roads === snap.roads && cur.sites === snap.sites && cur.waters === snap.waters && cur.settled === snap.settled && cur.zone === snap.zone && cur.sink?.length === snap.sink?.length
    && cur.macro.length === snap.macro.length && cur.macro.every((v, i) => v === snap.macro[i])
    && (!cur.sink || cur.sink.every((v, i) => v === snap.sink![i]))) return
  history.length = histAt + 1
  history.push(snap)
  if (history.length > 40) history.shift()
  histAt = history.length - 1
}
function restore(to: number) {
  const s = history[to]
  if (!s || !sculpt || s.macro.length !== sculpt.macro.length) return
  histAt = to
  restoring = true
  sculpt.macro.set(s.macro)
  sink = s.sink?.slice()
  roads = JSON.parse(s.roads)
  sites = JSON.parse(s.sites ?? '[]')
  waters = JSON.parse(s.waters ?? '[]')
  loadSetState(s.settled)
  waterDraft = null
  waterInfo()
  roadDraft = null
  zoneEl.value = s.zone
  roadInfo()
  setInfo()
  recompose(true)
  restoring = false
  logEl.textContent = t('log.history', { i: histAt + 1, n: history.length })
}
// --- working with several people: a room on the collab server (npm run collab) ---
const collabBox = $<HTMLDivElement>('collabBox')
const collabField = (id: string, key: string, def: string) => {
  const el = $<HTMLInputElement>(id)
  try { el.value = localStorage.getItem(key) ?? def } catch { el.value = def }
  el.addEventListener('change', () => { try { localStorage.setItem(key, el.value) } catch { /* storage blocked */ } })
  return el
}
const collabUrl = collabField('collabUrl', 'reforger-mapper.collab.url', `ws://${location.hostname || 'localhost'}:5790`)
const collabRoom = collabField('collabRoom', 'reforger-mapper.collab.room', 'map1')
const collabName = collabField('collabName', 'reforger-mapper.collab.name', 'mapper')
const collabKey = $<HTMLInputElement>('collabKey') // the password is never stored
$<HTMLButtonElement>('collab').addEventListener('click', () => { collabBox.hidden = !collabBox.hidden })
function leaveRoom() {
  collab?.close()
  collab = null
  $<HTMLSpanElement>('collabInfo').textContent = ''
  $<HTMLButtonElement>('collabGo').textContent = t('collab.join')
  draw()
}
$<HTMLButtonElement>('collabGo').addEventListener('click', () => {
  if (collab) return leaveRoom()
  let received = false
  collab = new Collab(collabUrl.value.trim(), collabRoom.value.trim() || 'map1', collabName.value.trim() || 'mapper', collabKey.value, {
    project: (p, from) => {
      received = true
      quietUntil = performance.now() + 1500
      try { loadProject(p) } catch (e) { logEl.textContent = t('err.generic', { msg: (e as Error).message }); return }
      logEl.textContent = t('collab.got', { name: from })
    },
    peers: (ps) => { $<HTMLSpanElement>('collabInfo').textContent = t('collab.peers', { room: collabRoom.value, n: ps.length + 1, names: ps.map((p) => p.name).join(', ') }) },
    cursors: () => draw(),
    status: (s, detail) => {
      if (s === 'connected') {
        $<HTMLButtonElement>('collabGo').textContent = t('collab.leave')
        collabBox.hidden = true
        // an empty room gets our map; otherwise the room's map arrives right after joining
        setTimeout(() => { if (!received) { const p = islandProject(); if (p) collab?.sendProject(p) } }, 1500)
      } else {
        logEl.textContent = t('collab.closed', { detail: detail ?? '' })
        leaveRoom()
      }
    },
  })
})
function drawPeers() {
  if (!collab) return
  ctx.font = '12px sans-serif'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  for (const [id, c] of collab.cursors) {
    const [x, y] = toScreen(c.x, c.z)
    const hue = (id * 97) % 360
    ctx.fillStyle = `hsl(${hue}, 80%, 60%)`
    ctx.beginPath()
    ctx.moveTo(x, y); ctx.lineTo(x + 12, y + 4); ctx.lineTo(x + 4, y + 12); ctx.closePath()
    ctx.fill()
    ctx.fillText(c.name, x + 14, y + 12)
  }
}
$<HTMLButtonElement>('lang').addEventListener('click', () => {
  try { localStorage.setItem('reforger-mapper.lang', getLang() === 'fr' ? 'en' : 'fr') } catch { /* storage blocked */ }
  location.reload()
})
$<HTMLButtonElement>('undo').addEventListener('click', () => restore(histAt - 1))
$<HTMLButtonElement>('redo').addEventListener('click', () => restore(histAt + 1))
window.addEventListener('keydown', (e) => {
  if (!(e.ctrlKey || e.metaKey) || (e.target as HTMLElement).closest('input, textarea, select')) return
  const k = e.key.toLowerCase()
  if (k === 'z' && !e.shiftKey) { e.preventDefault(); restore(histAt - 1) }
  else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); restore(histAt + 1) }
})

function afterRelief() {
  recompose(true)
}

function showIsland() {
  if (!island) return
  terrain = { ...island.grid, ocean: 0, heights: island.heights }
  terrainImg = renderTerrain(terrain)
  if (sink) {
    const g = island.grid
    const tctx = terrainImg.getContext('2d')!
    const img = tctx.getImageData(0, 0, g.cols, g.rows)
    for (let i = 0; i < sink.length; i++) {
      if (!sink[i]) continue
      const c = i % g.cols, r = (i - c) / g.cols
      const o = ((g.rows - 1 - r) * g.cols + c) * 4
      img.data[o] = img.data[o] * 0.7 + 200 * 0.3
      img.data[o + 1] *= 0.8
    }
    tctx.putImageData(img, 0, 0)
  }
  if (rivers) {
    const g = island.grid
    const tctx = terrainImg.getContext('2d')!
    const img = tctx.getImageData(0, 0, g.cols, g.rows)
    for (let i = 0; i < rivers.length; i++) {
      if (!rivers[i]) continue
      const c = i % g.cols, r = (i - c) / g.cols
      const o = ((g.rows - 1 - r) * g.cols + c) * 4
      const a = 0.4 + 0.6 * rivers[i]
      img.data[o] = img.data[o] * (1 - a) + 40 * a
      img.data[o + 1] = img.data[o + 1] * (1 - a) + 110 * a
      img.data[o + 2] = img.data[o + 2] * (1 - a) + 220 * a
    }
    tctx.putImageData(img, 0, 0)
  }
  draw()
}

$<HTMLButtonElement>('rRun').addEventListener('click', () => {
  if (!island) return void (logEl.textContent = t('log.genFirst'))
  $<HTMLInputElement>('rLive').checked = true
  recompose(true)
  const g = island.grid
  const cells = rivers ? rivers.reduce((a, v) => a + (v > 0 ? 1 : 0), 0) : 0
  logEl.textContent = t('log.rivers', { cells, km2: ((cells * g.step * g.step) / 1e6).toFixed(2) })
})
$<HTMLButtonElement>('rClear').addEventListener('click', () => {
  $<HTMLInputElement>('rLive').checked = false
  recompose(true)
})
$<HTMLInputElement>('rLive').addEventListener('change', () => recompose(true))
$<HTMLInputElement>('tSeaLevel').addEventListener('input', () => recompose(true))
for (const id of ['rRain', 'rWind', 'rThreshold', 'rDepth'])
  $<HTMLInputElement>(id).addEventListener('input', () => recompose(true))
const txt = (id: string) => $<HTMLInputElement>(id).value.trim()

async function run(label: string, f: () => Promise<string>) {
  logEl.textContent = t('run.progress', { label })
  try {
    logEl.textContent = external(await f())
  } catch (e) {
    logEl.textContent = t('run.error', { label, msg: (e as Error).message })
  }
}

$<HTMLButtonElement>('tGen').addEventListener('click', () => {
  imported = null
  existing = { objects: [], shapes: [] }
  const size = num('tSize')
  island = generateIsland({
    size,
    step: Math.max(4, size / 512),
    maxHeight: num('tMax'),
    seaDepth: num('tSea'),
    landRatio: num('tLand'),
    roughness: num('tRough'),
    seed: num('tSeed'),
    islands: num('tIslands'),
  })
  sink = undefined
  sculpt = new Sculpt(island.grid.cols, island.grid.step, num('tMax'), num('tSeed'), island.heights)
  rivers = undefined
  view.x = view.z = size / 2
  view.mpp = size / map.width
  logEl.textContent = t('log.island', { cols: island.grid.cols, rows: island.grid.rows, step: island.grid.step })
  recompose(true)
})
// load the world open in the Workbench (relief + ground materials) to carry on a map in progress
/** world imported from the Workbench (null = generated island); kept so the project survives a reload */
let imported: WorldExport | null = null
function useWorld(w: WorldExport) {
  imported = { ...w, materials: [], surfaces: [] }
  island = worldToIsland(w)
  const { cols, rows, step, minX, minZ } = island.grid
  sink = undefined
  let top = 1
  for (const h of island.heights) top = Math.max(top, h)
  sculpt = new Sculpt(cols, step, top, num('tSeed'), island.heights)
  rivers = undefined
  // the imported world replaces the previous project: nothing drawn on the old island is kept
  roads = []
  sites = []
  waters = []
  loadSetState(undefined)
  result = null
  noBridge.clear()
  existing = { objects: [], shapes: [] }
  removed = []
  areas = []
  credits = []
  waterInfo()
  view.x = minX + (cols * step) / 2
  view.z = minZ + (rows * step) / 2
  view.mpp = (cols * step) / map.width
}
$<HTMLButtonElement>('tImport').addEventListener('click', () =>
  run(t('run.l.import'), async () => {
    const w = await getWorld(8)
    useWorld(w)
    existing = await getExisting().catch(() => ({ objects: [], shapes: [] }))
    const took = adoptExisting()
    recompose(true)
    return t('log.imported', { cols: w.cols, rows: w.rows, step: w.step, objects: existing.objects.length, shapes: existing.shapes.length, ...took })
  }),
)
$<HTMLButtonElement>('tReroll').addEventListener('click', () => {
  $<HTMLInputElement>('tSeed').value = String(Math.floor(Math.random() * 1e6))
  $<HTMLButtonElement>('tGen').click()
})
$<HTMLButtonElement>('tSurf').addEventListener('click', () =>
  run(t('run.l.surfaces'), async () => {
    const r = await prepareSurfaces(txt('tAddon'), txt('tWorld'))
    return t('log.surfaces', { added: r.added, normals: r.normalsWritten })
  }),
)
$<HTMLButtonElement>('tHeight').addEventListener('click', () =>
  run(t('run.l.relief'), async () => {
    if (!island) throw new Error(t('err.genFirst'))
    return (await applyHeightmap({ ...island.grid, heights: island.heights })).message
  }),
)
$<HTMLButtonElement>('tMasks').addEventListener('click', () =>
  run(t('run.l.masks'), async () => {
    if (!island) throw new Error(t('err.genFirst'))
    const r = await writeMasks({
      addon: txt('tAddon'),
      world: txt('tWorld'),
      terrainSize: num('tSize'),
      surfaces: island.surfaces,
      colours: { ...island.colours, ...ROAD_COLOURS },
      roads: [...roadMasks(roads), ...waterMasks(waters), ...roadMasks([...setLanes, ...setPaths]), ...buildingMasks(settled)],
    })
    return t('log.masks', { files: r.written.join(', '), dir: r.dir, sat: r.satellite?.file ?? '—' })
  }),
)

async function refreshStatus() {
  const s = await getStatus()
  statusEl.textContent = t('status.line', { bridge: s.bridge ? t('status.ok') : t('status.no'), wb: s.workbench ? t('status.ok') : t('status.no'), detail: s.detail })
  statusEl.dataset.ok = String(s.workbench)
}

sendEl.addEventListener('click', async () => {
  sendEl.disabled = true
  try {
    logEl.textContent = external(await toWb(JSON.parse(projectEl.value) as Project))
  } catch (e) {
    logEl.textContent = t('err.generic', { msg: (e as Error).message })
  } finally {
    sendEl.disabled = false
    refreshStatus()
  }
})

// no polling: a NET API call landing while a Workbench modal dialog is open crashes the Workbench
statusEl.title = t('app.refresh')
statusEl.addEventListener("click", refreshStatus)

// --- layout: tabs, canvas fills the stage ---
const tabButtons = [...document.querySelectorAll<HTMLButtonElement>('#tabs [data-tab]')]
tabButtons.forEach((b) => b.addEventListener('click', () => {
  tabButtons.forEach((x) => x.classList.toggle('active', x === b))
  document.querySelectorAll<HTMLElement>('.tab').forEach((p) => (p.hidden = p.dataset.tab !== b.dataset.tab))
  // the tab also picks its tool, unless the current tool already belongs to it
  const owns: Record<string, string[]> = {
    camp: ['zone'], roads: ['road'], villages: ['road'], water: ['water', 'dry', 'wet'], brush: ['raise', 'lower', 'flatten', 'smooth', 'sea'],
  }
  const tools = owns[b.dataset.tab!]
  if (tools && !tools.includes(currentTool)) setTool(tools[0])
  showRail(b.dataset.tab!)
}))
// the tool rail exists only for brush tabs (several tools); elsewhere the map takes the room
function showRail(tab: string) {
  const own: Record<string, string[]> = { brush: ['raise', 'lower', 'flatten', 'smooth', 'sea'], water: ['dry', 'wet'] }
  const tools = own[tab]
  document.querySelector('.app')!.classList.toggle('norail', !tools)
  toolButtons.forEach((tb) => (tb.hidden = !tools?.includes(tb.dataset.tool!)))
  document.querySelectorAll<HTMLElement>('#tools hr').forEach((h) => (h.hidden = true))
}
showRail(tabButtons.find((x) => x.classList.contains('active'))?.dataset.tab ?? 'island')
// picking a tool opens its settings tab
toolButtons.forEach((b) => b.addEventListener('click', () => {
  const tl = b.dataset.tool
  const tab = tl === 'zone' ? 'camp' : tl === 'road' ? 'roads' : tl === 'water' ? 'water' : tl === 'dry' || tl === 'wet' ? 'water' : 'brush'
  tabButtons.find((x) => x.dataset.tab === tab)?.click()
}))
function fitCanvas() {
  const r = map.parentElement!.getBoundingClientRect()
  const w = Math.max(200, Math.floor(r.width)), h = Math.max(200, Math.floor(r.height))
  if (w === map.width && h === map.height) return
  view.mpp *= map.width / w // same ground width on screen
  map.width = w
  map.height = h
  draw()
}
new ResizeObserver(fitCanvas).observe(map.parentElement!)
fitCanvas()

// --- island project: autosave in the browser + save/open a file ---
// Stored: every panel setting + the sculpted macro grid + the river sink mask. The fine relief, rivers
// and surfaces are recomputed from them (same seed = same detail noise).
const PROJECT_KEY = 'reforger-mapper.island'
const b64 = (a: Uint8Array) => { let s = ''; for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode(...a.subarray(i, i + 0x8000)); return btoa(s) }
const unb64 = (s: string) => Uint8Array.from(atob(s), (ch) => ch.charCodeAt(0))
function islandProject() {
  if (!island || !sculpt) return null
  const inputs: Record<string, string | boolean> = {}
  document.querySelectorAll<HTMLInputElement>('.side .tab input[id]').forEach((el) => {
    if (el.type !== 'file' && el.id !== 'roadFlatten') inputs[el.id] = el.type === 'checkbox' ? el.checked : el.value
  })
  return {
    kind: 'reforger-mapper-island', version: 1, inputs,
    macro: b64(new Uint8Array(sculpt.macro.buffer.slice(0))),
    sink: sink ? b64(sink) : null,
    roads,
    sites,
    waters,
    settlements: setState(),
    fields: result,
    noBridge: [...noBridge],
    imported: imported && { ...imported, heights: b64(new Uint8Array(new Float32Array(imported.heights).buffer)) },
    existing,
    removed,
    areas,
    credits,
  }
}
function autosave() {
  clearTimeout(saveTimer)
  saveTimer = window.setTimeout(() => {
    const p = islandProject()
    try { if (p) localStorage.setItem(PROJECT_KEY, JSON.stringify(p)) } catch { /* storage full or blocked */ }
    if (p && collab && performance.now() > quietUntil) collab.sendProject(p)
  }, 500)
}
function loadProject(p: any) {
  if (p?.kind !== 'reforger-mapper-island') throw new Error(t('err.notIsland'))
  for (const [id, v] of Object.entries(p.inputs ?? {})) {
    if (id === 'roadFlatten') continue // per-road choice, always starts unchecked
    const el = document.getElementById(id) as HTMLInputElement | null
    if (!el) continue
    if (el.type === 'checkbox') el.checked = !!v
    else el.value = String(v)
  }
  if (p.imported) useWorld({ ...p.imported, heights: [...new Float32Array(unb64(p.imported.heights).buffer)] })
  else $<HTMLButtonElement>('tGen').click() // rebuilds grid + sculpt with the saved settings
  if (!island || !sculpt) return
  const macro = new Float32Array(unb64(p.macro).buffer)
  if (macro.length !== sculpt.macro.length) throw new Error(t('err.gridMismatch'))
  sculpt.macro.set(macro)
  sink = p.sink ? unb64(p.sink) : undefined
  roads = Array.isArray(p.roads) ? p.roads : []
  sites = Array.isArray(p.sites) ? p.sites.filter((x: Site) => x && x.kind) : []
  waters = Array.isArray(p.waters) ? p.waters.filter((x: Water) => x && WATER_TYPES[x.type]) : []
  loadSetState(typeof p.settlements === 'string' ? p.settlements : undefined)
  result = p.fields && Array.isArray(p.fields.fields) ? p.fields : null
  noBridge.clear()
  for (const k of Array.isArray(p.noBridge) ? p.noBridge : []) noBridge.add(k)
  if (p.existing?.objects) existing = p.existing
  areas = Array.isArray(p.areas) ? p.areas : []
  credits = Array.isArray(p.credits) ? p.credits : []
  removed = Array.isArray(p.removed) ? p.removed : []
  waterInfo()
  recompose(true)
}
$<HTMLButtonElement>('pSave').addEventListener('click', () => {
  const p = islandProject()
  if (!p) return void (logEl.textContent = t('log.genFirst'))
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([JSON.stringify(p)], { type: 'application/json' }))
  a.download = `ile-${num('tSeed')}.json`
  a.click()
  URL.revokeObjectURL(a.href)
})
$<HTMLButtonElement>('pOpen').addEventListener('click', () => $<HTMLInputElement>('pFile').click())
$<HTMLInputElement>('pFile').addEventListener('change', async (e) => {
  const f = (e.target as HTMLInputElement).files?.[0]
  if (!f) return
  try {
    loadProject(JSON.parse(await f.text()))
    logEl.textContent = t('log.opened', { name: f.name })
  } catch (err) {
    logEl.textContent = t('err.open', { msg: (err as Error).message })
  }
  ;(e.target as HTMLInputElement).value = ''
})

// --- roads ---
function roadInfo() {
  const km = roads.reduce((a, r) => {
    let l = 0
    for (let i = 2; i < r.pts.length; i += 2) l += Math.hypot(r.pts[i] - r.pts[i - 2], r.pts[i + 1] - r.pts[i - 1])
    return a + l
  }, 0) / 1000
  $<HTMLSpanElement>('roadInfo').textContent = t('road.info', { n: roads.length, km: km.toFixed(1) })
  const list = $<HTMLUListElement>('roadList')
  list.innerHTML = ''
  for (const r of roads) {
    const li = document.createElement('li')
    li.className = r.id === selRoad ? 'sel' : ''
    const name = document.createElement('button')
    name.textContent = `${r.id} · ${ROAD_TYPES[r.type].label}`
    name.addEventListener('click', () => selectRoad(selRoad === r.id ? null : r.id))
    const del = document.createElement('button')
    del.textContent = '✕'
    del.title = t('road.delete.tip')
    del.addEventListener('click', () => deleteRoad(r.id))
    li.append(name, del)
    list.append(li)
  }
}
// --- editing existing roads ---
function hitRoadPoint(sx: number, sy: number): { r: Road; i: number } | null {
  let best: { r: Road; i: number } | null = null, bd = 9
  for (const r of roads) for (let i = 0; i + 1 < r.pts.length; i += 2) {
    const [px, py] = toScreen(r.pts[i], r.pts[i + 1])
    const d = Math.hypot(px - sx, py - sy)
    if (d < bd) { bd = d; best = { r, i } }
  }
  return best
}
function selectRoad(id: string | null) {
  selRoad = id
  roadInfo()
  draw()
}
function deleteRoad(id: string) {
  roads = roads.filter((r) => r.id !== id)
  if (selRoad === id) selRoad = null
  roadInfo()
  recompose(true)
}
const shortName = (path: string) => path.replace(/^.*\//, '').replace(/\.et$/, '')
/** road type of an existing road shape, from its generator prefab (null: not a road) */
function roadTypeOf(s: ExistingShape): RoadType | null {
  const g = s.generators.find((x) => /WEGenerators\/Roads\//.test(x))
  if (!g) return null
  if (/TrailDirt/i.test(g)) return 'trailDirt'
  if (/TrailGravel/i.test(g)) return 'trailGravel'
  if (/TrailForest/i.test(g)) return 'trailForest'
  if (/Forest/i.test(g)) return 'forest'
  if (/Dirt/i.test(g)) return 'dirt'
  if (/Cobble/i.test(g)) return 'cobble'
  if (/Concrete/i.test(g)) return 'concrete'
  if (/Narrow/i.test(g)) return 'asphaltNarrow'
  return 'asphalt'
}
/** takes the world's roads, rivers and lakes over as editable site objects; its road furniture (barriers,
 *  verge posts, signs) and bridges are dropped because the site rebuilds them on send. Every taken item is
 *  deleted from the world on the next send, so nothing ends up twice. */
function adoptExisting() {
  let nRoads = 0, nWaters = 0, nFurn = 0
  const keep: ExistingShape[] = []
  for (const s of existing.shapes) {
    const g = s.generators.join(' ')
    const road = roadTypeOf(s)
    const lake = (Object.keys(WATER_TYPES) as WaterType[]).find((k) => WATER_TYPES[k].closed && g.includes(WATER_TYPES[k].generator.replace(/^\{[0-9A-F]+\}/, '')))
    if (road) {
      roads.push({ id: nextRoadId(road), type: road, pts: s.points.flat() })
      nRoads++
    } else if (/WEGenerators\/Water\/River\//.test(g) && !s.closed) {
      waters.push({ id: nextWaterId('river'), type: 'river', pts: s.points.flat(), width: 8, depth: 1.5 })
      nWaters++
    } else if (lake && s.closed) {
      waters.push({ id: nextWaterId(lake), type: lake, pts: s.points.flat(), width: 0, depth: 2 })
      nWaters++
    } else { keep.push(s); continue }
    removed.push({ f: road ? 'ROAD_' : 'WATER_', x: s.origin[0], z: s.origin[1] })
  }
  existing.shapes = keep
  // prefabs: only buildings and signs are imported (locked); bridges are rebuilt by the site, the rest is ignored
  existing.objects = existing.objects.filter((o) => {
    if (/Infrastructure\/Bridges\//.test(o.prefab)) {
      removed.push({ f: 'WATER_', x: o.x, z: o.z })
      nFurn++
      return false
    }
    return /Structures\/(Signs|Houses|Commercial|Civic|Farm|Industrial|Military|Cultural|Religious|Recreation|Infrastructure\/Harbour)\//.test(o.prefab)
  })
  // the world keeps its own signs, barriers and posts: the site must not add its own on top
  $<HTMLInputElement>('roadFurn').checked = false
  waterInfo()
  roadInfo()
  return { roads: nRoads, waters: nWaters, furn: nFurn }
}
function hitExistingShape(sx: number, sy: number): ExistingShape | null {
  let best: ExistingShape | null = null, bd = 8
  for (const s of existing.shapes) for (let i = 1; i < s.points.length + (s.closed ? 1 : 0); i++) {
    const p = s.points[i - 1], q = s.points[i % s.points.length]
    const [ax, ay] = toScreen(p[0], p[1]), [bx, by] = toScreen(q[0], q[1])
    const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy || 1
    const u = Math.max(0, Math.min(1, ((sx - ax) * dx + (sy - ay) * dy) / L))
    const d = Math.hypot(ax + u * dx - sx, ay + u * dy - sy)
    if (d < bd) { bd = d; best = s }
  }
  return best
}
function hitExistingObject(wx: number, wz: number): ExistingObject | null {
  const m = 4 * view.mpp // a few pixels of slack for tiny objects
  let best: ExistingObject | null = null, ba = Infinity
  for (const o of existing.objects) {
    const [x0, z0, x1, z1] = o.box
    const a = (x1 - x0) * (z1 - z0)
    if (wx > x0 - m && wx < x1 + m && wz > z0 - m && wz < z1 + m && a < ba && !/Prefabs\/Terrain\//.test(o.prefab)) { ba = a; best = o }
  }
  return best
}
function hitRoad(sx: number, sy: number): Road | null {
  let best: Road | null = null, bd = 10
  for (const r of roads) for (let i = 2; i + 1 < r.pts.length; i += 2) {
    const [ax, ay] = toScreen(r.pts[i - 2], r.pts[i - 1]), [bx, by] = toScreen(r.pts[i], r.pts[i + 1])
    const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy || 1
    const u = Math.max(0, Math.min(1, ((sx - ax) * dx + (sy - ay) * dy) / L))
    const d = Math.hypot(ax + u * dx - sx, ay + u * dy - sy)
    if (d < bd) { bd = d; best = r }
  }
  return best
}
function setDrawing(on: boolean) {
  roadDrawing = on
  $<HTMLButtonElement>('roadNew').classList.toggle('active', on)
  map.style.cursor = on ? 'crosshair' : 'default'
}
$<HTMLButtonElement>('roadNew').addEventListener('click', () => { selectRoad(null); setDrawing(!roadDrawing) })

const menu = $<HTMLDivElement>('ctxMenu')
function hideMenu() { menu.hidden = true }
function openRoadMenu(e: MouseEvent) {
  const [sx, sy] = eventPos(e)
  const [wx, wz] = toWorld(sx, sy)
  const pt = hitRoadPoint(sx, sy)
  const r = pt?.r ?? hitRoad(sx, sy)
  menu.innerHTML = ''
  const item = (label: string, fn: () => void) => {
    const b = document.createElement('button')
    b.textContent = label
    b.addEventListener('click', () => { hideMenu(); fn() })
    menu.append(b)
  }
  const changed = () => { roadInfo(); recompose(true) }
  const site = r ? null : hitSite(sx, sy)
  const bld = r ? null : hitBuilding(wx, wz)
  const ex = r || site || bld || !layer('existing') ? null : hitExistingShape(sx, sy) ?? hitExistingObject(wx, wz)
  if (bld) {
    const h = document.createElement('div')
    h.className = 'title'
    h.textContent = bld.id
    menu.append(h)
    item(t('menu.setDel'), () => { settled = settled.filter((q) => q !== bld); setInfo(); draw() })
  } else if (site) {
    const h = document.createElement('div')
    h.className = 'title'
    h.textContent = site.id
    menu.append(h)
    for (const k of ['town', 'village', 'hamlet'] as SiteKind[])
      if (k !== site.kind) item(t('menu.siteKind', { kind: t(`site.${k}`) }), () => { site.kind = k; site.id = nextSiteId(k); changed() })
    item(t('menu.siteDel'), () => { sites = sites.filter((x) => x !== site); changed() })
  } else if (r) {
    selectRoad(r.id)
    const h = document.createElement('div')
    h.className = 'title'
    h.textContent = r.id
    menu.append(h)
    const type = document.createElement('select')
    for (const [k, v] of Object.entries(ROAD_TYPES)) type.add(new Option(v.label, k, false, k === r.type))
    type.addEventListener('change', () => { r.type = type.value as RoadType; r.id = ''; r.id = nextRoadId(r.type); selRoad = r.id; hideMenu(); changed() })
    const width = document.createElement('input')
    width.type = 'number'; width.step = '0.5'; width.min = '0'; width.placeholder = t('menu.auto', { w: ROAD_TYPES[r.type].half * 2 })
    width.value = r.width ? String(r.width) : ''
    width.addEventListener('change', () => { r.width = Number(width.value) > 0 ? Number(width.value) : undefined; changed() })
    const lt = document.createElement('label'); lt.append(t('menu.type') + ' ', type)
    const lw = document.createElement('label'); lw.append(t('menu.width') + ' ', width)
    menu.append(lt, lw)
    item(r.flatten ? t('menu.flatOnOff') : t('menu.flatOffOn'), () => { r.flatten = !r.flatten; changed() })
    item(t('menu.reverse'), () => {
      const p: number[] = []
      for (let i = r.pts.length - 2; i >= 0; i -= 2) p.push(r.pts[i], r.pts[i + 1])
      r.pts = p; changed()
    })
    item(t('menu.extend'), () => {
      roads = roads.filter((o) => o !== r)
      roadDraft = r
      setDrawing(true)
      draw()
    })
    if (pt && r.pts.length > 4) item(t('menu.delPoint'), () => { r.pts.splice(pt.i, 2); changed() })
    item(t('menu.delRoad'), () => deleteRoad(r.id))
  } else if (ex) {
    const h = document.createElement('div')
    h.className = 'title'
    menu.append(h)
    const info = (txt: string) => { const d = document.createElement('div'); d.className = 'info'; d.textContent = txt; menu.append(d) }
    if ('points' in ex) {
      h.textContent = ex.generators.length ? shortName(ex.generators[0]) : t('ex.shape')
      for (const g of ex.generators.slice(1)) info('+ ' + shortName(g))
      let len = 0
      for (let i = 1; i < ex.points.length; i++) len += Math.hypot(ex.points[i][0] - ex.points[i - 1][0], ex.points[i][1] - ex.points[i - 1][1])
      info(t('ex.shapeInfo', { n: ex.points.length, len: Math.round(len), closed: ex.closed ? t('ex.closed') : '' }))
      const type = roadTypeOf(ex)
      if (type) item(t('menu.exTake'), () => {
        const id = nextRoadId(type)
        roads.push({ id, type, pts: ex.points.flat() })
        removed.push({ f: 'ROAD_', x: ex.origin[0], z: ex.origin[1] })
        existing.shapes = existing.shapes.filter((q) => q !== ex)
        selectRoad(id)
        changed()
      })
      item(t('menu.exDel'), () => { removed.push({ f: 'ANY', x: ex.origin[0], z: ex.origin[1] }); existing.shapes = existing.shapes.filter((q) => q !== ex); changed() })
    } else {
      h.textContent = shortName(ex.prefab)
      info(ex.prefab.replace(/^\{[0-9A-F]+\}/, ''))
      info(t('ex.objInfo', { x: Math.round(ex.x), z: Math.round(ex.z), w: Math.round(ex.box[2] - ex.box[0]), d: Math.round(ex.box[3] - ex.box[1]), yaw: Math.round(ex.yaw) }))
      item(t('menu.exDel'), () => { removed.push({ f: 'ANY', x: ex.x, z: ex.z }); existing.objects = existing.objects.filter((q) => q !== ex); changed() })
    }
  } else {
    item(t('menu.newHere'), () => { selectRoad(null); setDrawing(true); roadClick(wx, wz) })
    for (const k of ['town', 'village', 'hamlet'] as SiteKind[])
      item(t('menu.siteAdd', { kind: t(`site.${k}`) }), () => { sites.push({ id: nextSiteId(k), x: Math.round(wx), z: Math.round(wz), kind: k }); changed() })
  }
  const box = map.getBoundingClientRect()
  menu.style.left = `${e.clientX - box.left + map.offsetLeft}px`
  menu.style.top = `${e.clientY - box.top + map.offsetTop}px`
  menu.hidden = false
}

map.addEventListener('dblclick', (e) => {
  if (tool() !== 'road' || roadDrawing) return
  const hit = hitRoadPoint(...eventPos(e))
  if (!hit) return
  if (hit.r.pts.length <= 4) return void deleteRoad(hit.r.id)
  hit.r.pts.splice(hit.i, 2)
  roadInfo()
  recompose(true)
})
window.addEventListener('keydown', (e) => {
  if (e.key !== 'Delete' || !selRoad || (e.target as HTMLElement).closest('input, textarea, select')) return
  deleteRoad(selRoad)
})

/** Readable id, identical to the entity name in the Workbench (ROAD_BETON_USSR_1). */
function nextRoadId(type: string) {
  // Ids are built from the French labels on purpose, so existing road ids stay stable.
  const slug = fr[('road.type.' + type) as keyof typeof fr].normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '')
  const used = new Set(roads.map((r) => r.id))
  for (let n = 1; ; n++) {
    const id = `ROAD_${slug}_${n}`
    if (!used.has(id)) return id
  }
}
function roadClick(x: number, z: number) {
  const p = snap(roads, x, z, num('roadSnap')) ?? [x, z]
  roadDraft ??= {
    id: nextRoadId($<HTMLSelectElement>('roadType').value),
    type: $<HTMLSelectElement>('roadType').value as RoadType,
    pts: [],
    width: num('roadWidth') > 0 ? num('roadWidth') : undefined,
    flatten: $<HTMLInputElement>('roadFlatten').checked,
  }
  roadDraft.pts.push(Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10)
  draw()
}
function finishRoad() {
  setDrawing(false)
  if (roadDraft && roadDraft.pts.length >= 4) {
    roads.push(roadDraft)
    roadDraft = null
    roadInfo()
    recompose(true)
  } else {
    roadDraft = null
    draw()
  }
}
window.addEventListener('keydown', (e) => {
  if (tool() !== 'road' || (e.target as HTMLElement).closest('input, textarea, select')) return
  if (e.key === 'Enter') finishRoad()
  if (e.key === 'Escape') { roadDraft = null; setDrawing(false); hideMenu(); draw() }
  if (e.key === 'Backspace' && roadDraft) { roadDraft.pts.length -= 2; draw() }
})
$<HTMLButtonElement>('roadUndo').addEventListener('click', () => { roads.pop(); roadInfo(); recompose(true) })
$<HTMLButtonElement>('roadClear').addEventListener('click', () => { roads = []; roadInfo(); recompose(true) })
$<HTMLButtonElement>('roadSend').addEventListener('click', () =>
  run(t('run.l.routes'), async () => {
    if (!roads.length) throw new Error(t('err.noRoad'))
    return toWb({ version: 0, shapes: allRoadShapes(), entities: $<HTMLInputElement>('roadFurn').checked ? roadSigns(roads, $<HTMLInputElement>('roadLeft').checked) : [] })
  }),
)
roadInfo()

// --- quick road test ---
function testRoads(): Road[] {
  if (!island) $<HTMLButtonElement>('tGen').click()
  if (!island) return []
  const { cols, rows, step } = island.grid
  const h = island.heights
  const land = (c: number, r: number) => h[r * cols + c] > 4
  // the land row with the longest run of land: the asphalt road follows it west -> east
  let best = { r: 0, c0: 0, c1: 0 }
  for (let r = 0; r < rows; r += 4) {
    let c0 = -1
    for (let c = 0; c <= cols; c++) {
      const on = c < cols && land(c, r)
      if (on && c0 < 0) c0 = c
      if (!on && c0 >= 0) {
        if (c - 1 - c0 > best.c1 - best.c0) best = { r, c0, c1: c - 1 }
        c0 = -1
      }
    }
  }
  const margin = Math.round(120 / step)
  const c0 = best.c0 + margin, c1 = best.c1 - margin
  if (c1 - c0 < 20) return []
  const asphalt: number[] = []
  const n = 6
  for (let k = 0; k <= n; k++) {
    const c = c0 + ((c1 - c0) * k) / n
    const wobble = k === 0 || k === n ? 0 : Math.sin(k * 1.7) * 150
    asphalt.push(c * step, best.r * step + wobble)
  }
  // dirt road from the middle control point, northwards while on land
  const [mx, mz] = [asphalt[6], asphalt[7]]
  const dirt = [mx, mz]
  for (let d = 250; d < 3000; d += 250) {
    const x = mx + Math.sin(d / 600) * 120, z = mz + d
    const c = Math.round(x / step), r = Math.round(z / step)
    if (r >= rows || !land(c, r) || h[r * cols + c] < 6) break
    dirt.push(x, z)
  }
  const fl = $<HTMLInputElement>('roadFlatten').checked
  const out: Road[] = [{ id: 'ROAD_TEST_A', type: 'asphalt', pts: asphalt, flatten: fl }]
  if (dirt.length >= 4) out.push({ id: 'ROAD_TEST_B', type: 'dirt', pts: dirt, flatten: fl })
  return out
}
$<HTMLButtonElement>('roadTestDraw').addEventListener('click', () => {
  roads = testRoads()
  roadInfo()
  recompose(true)
  logEl.textContent = roads.length ? t('log.testRoads', { n: roads.length }) : t('log.testNoLand')
})
$<HTMLButtonElement>('roadTestAll').addEventListener('click', () =>
  run(t('run.l.testRoutes'), async () => {
    if (!roads.length) $<HTMLButtonElement>('roadTestDraw').click()
    if (!island || !roads.length) throw new Error(t('err.noRoadsToSend'))
    const out: string[] = []
    logEl.textContent = t('test.p1')
    out.push(t('test.relief', { msg: (await applyHeightmap({ ...island.grid, heights: island.heights })).message }))
    logEl.textContent = t('test.p2')
    out.push(t('test.routes', { msg: await toWb({ version: 0, shapes: allRoadShapes(), entities: $<HTMLInputElement>('roadFurn').checked ? roadSigns(roads, $<HTMLInputElement>('roadLeft').checked) : [] }) }))
    logEl.textContent = t('test.p3')
    const r = await writeMasks({
      addon: txt('tAddon'), world: txt('tWorld'), terrainSize: num('tSize'),
      surfaces: island.surfaces, colours: { ...island.colours, ...ROAD_COLOURS }, roads: [...roadMasks(roads), ...waterMasks(waters), ...roadMasks([...setLanes, ...setPaths]), ...buildingMasks(settled)],
    })
    out.push(t('test.masks', { dir: r.dir }), t('test.sat', { file: r.satellite?.file ?? '—' }))
    out.push(t('test.rest'))
    return out.join('\n')
  }),
)

//! road splines + their furniture (verge posts, crash barriers)
// --- road furniture preview: exactly what Tout envoyer will place ---
function refreshFurniture() {
  if (!roads.length || !island) { furn = null; $<HTMLSpanElement>('furnInfo').textContent = ''; return }
  const shapes = allRoadShapes().filter((s) => s.kind === 'polyline')
  const signs = roadSigns(roads, $<HTMLInputElement>('roadLeft').checked)
  furn = { shapes, signs }
  const len = (tag: string) => shapes.filter((s) => s.id.includes(tag)).reduce((a, s) => {
    for (let i = 2; i + 1 < s.points.length; i += 2) a += Math.hypot(s.points[i] - s.points[i - 2], s.points[i + 1] - s.points[i - 1])
    return a
  }, 0)
  $<HTMLSpanElement>('furnInfo').textContent =
    t('furn.info', { bar: Math.round(len('_BAR_')), post: Math.round(len('_POST_')), signs: signs.length })
}
function drawFurniture(f: { shapes: ProjectShape[]; signs: ProjectEntity[] }) {
  for (const s of f.shapes) {
    const bar = s.id.includes('_BAR_')
    const ring: number[][] = []
    for (let i = 0; i + 1 < s.points.length; i += 2) ring.push([s.points[i], s.points[i + 1]])
    path(ring, false)
    ctx.strokeStyle = bar ? '#ff7a2f' : '#f2f2f2'
    ctx.lineWidth = bar ? 3 : 2
    ctx.setLineDash(bar ? [] : [2, 5])
    ctx.stroke()
    ctx.setLineDash([])
  }
  ctx.font = '10px sans-serif'
  for (const e of f.signs) {
    const [sx, sy] = toScreen(e.x, e.z)
    const a = (e.yaw * Math.PI) / 180
    // the plate faces (-sin yaw, -cos yaw) in world X/Z; screen Y is flipped
    const fx = -Math.sin(a), fy = Math.cos(a)
    ctx.strokeStyle = '#ffd34d'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(sx, sy)
    ctx.lineTo(sx + fx * 14, sy + fy * 14)
    ctx.stroke()
    ctx.fillStyle = '#e33'
    ctx.beginPath()
    ctx.arc(sx, sy, 4, 0, Math.PI * 2)
    ctx.fill()
    if (view.mpp < 1) {
      ctx.fillStyle = '#fff'
      ctx.fillText(e.prefab.split('/').pop()!.replace(/(_pole)?.et$/, '').replace('Sign', ''), sx + 6, sy + 10)
    }
  }
}
for (const id of ['furnShow', 'furnDrop', 'furnPost', 'roadLeft'])
  $<HTMLInputElement>(id).addEventListener('change', () => { refreshFurniture(); draw() })

// --- automatic road network ---
function netParams() {
  return {
    sites: num('netSites'), spacing: num('netSpacing'), maxSlope: num('netSlope'), seed: num('tSeed'),
    main: $<HTMLSelectElement>('netMain').value as RoadType,
    minor: $<HTMLSelectElement>('netMinor').value as RoadType,
    lane: $<HTMLSelectElement>('netLane').value as RoadType,
  }
}
$<HTMLButtonElement>('sitesPlace').addEventListener('click', () => {
  if (!island) $<HTMLButtonElement>('tGen').click()
  if (!island) return
  sites = pickSites(island.heights, island.grid, rivers, netParams())
  if (sites.length < 2) return void (logEl.textContent = t('log.netNone'))
  const c = (k: SiteKind) => sites.filter((x) => x.kind === k).length
  logEl.textContent = t('log.sitesDone', { n: sites.length, town: c('town'), village: c('village'), hamlet: c('hamlet') })
  recompose(true)
})
$<HTMLButtonElement>('netGen').addEventListener('click', () => {
  if (!island) $<HTMLButtonElement>('tGen').click()
  if (!island) return
  if (sites.length < 2) $<HTMLButtonElement>('sitesPlace').click()
  if (sites.length < 2) return
  roads = roads.filter((r) => !r.auto)
  const made = buildNetwork(island.heights, island.grid, rivers, sites, netParams(), roads)
  for (const r of made) {
    r.auto = true
    r.id = nextRoadId(r.type)
    roads.push(r)
  }
  let km = 0
  for (const r of made) for (let i = 2; i + 1 < r.pts.length; i += 2) km += Math.hypot(r.pts[i] - r.pts[i - 2], r.pts[i + 1] - r.pts[i - 1])
  logEl.textContent = t('log.netDone', { sites: sites.length, roads: made.length, km: (km / 1000).toFixed(1) })
  roadInfo()
  recompose(true)
})
$<HTMLButtonElement>('netClear').addEventListener('click', () => {
  roads = roads.filter((r) => !r.auto)
  roadInfo()
  recompose(true)
})
$<HTMLButtonElement>('sitesClear').addEventListener('click', () => {
  sites = []
  recompose(true)
})
const SITE_COLOUR: Record<SiteKind, string> = { town: '#ff6b5a', village: '#ffd34d', hamlet: '#ffffff' }
function hitSite(sx: number, sy: number): Site | null {
  let best: Site | null = null
  let bd = Infinity
  for (const s of sites) {
    const [px, py] = toScreen(s.x, s.z)
    const d = Math.hypot(px - sx, py - sy)
    if (d < Math.max(10, SITE_RADIUS[s.kind] / view.mpp) && d < bd) {
      bd = d
      best = s
    }
  }
  return best
}
function nextSiteId(kind: SiteKind) {
  const pre = kind.toUpperCase() + '_'
  for (let n = 1; ; n++) if (!sites.some((s) => s.id === pre + n)) return pre + n
}
function drawSites() {
  ctx.font = '12px sans-serif'
  for (const s of sites) {
    const [sx, sy] = toScreen(s.x, s.z)
    const R = Math.max(6, SITE_RADIUS[s.kind] / view.mpp)
    ctx.beginPath()
    ctx.arc(sx, sy, R, 0, Math.PI * 2)
    ctx.fillStyle = SITE_COLOUR[s.kind] + '33'
    ctx.fill()
    ctx.strokeStyle = SITE_COLOUR[s.kind]
    ctx.lineWidth = 2
    ctx.stroke()
    const lx = sx + R * 0.7 + 4, ly = sy - R * 0.7
    ctx.lineWidth = 3
    ctx.strokeStyle = '#000b'
    ctx.strokeText(s.id, lx, ly)
    ctx.fillStyle = SITE_COLOUR[s.kind]
    ctx.fillText(s.id, lx, ly)
  }
}

// --- settlements: hamlets and street-villages along the existing roads (docs/CITIES.md §3.8 step 1) ---
function setInfo() {
  autosave() // buildings are part of the saved project
  if (!restoring) checkpoint() // and of undo / redo
  $<HTMLSpanElement>('setInfo').textContent = settled.length
    ? t('log.setDone', { n: settled.length, sites: new Set(settled.map((q) => q.site)).size, lanes: setLanes.length, paths: setPaths.length, squares: setSquares.length })
    : ''
}
function hitBuilding(wx: number, wz: number): Placed | null {
  for (const q of settled) {
    const c = q.corners
    let r = false
    for (let i = 0, j = 3; i < 4; j = i++)
      if (c[i * 2 + 1] > wz !== c[j * 2 + 1] > wz && wx < ((c[j * 2] - c[i * 2]) * (wz - c[i * 2 + 1])) / (c[j * 2 + 1] - c[i * 2 + 1]) + c[i * 2]) r = !r
    if (r) return q
  }
  return null
}
function drawSettlements() {
  // greens, then lanes (road width) and footpaths (thin dashed) under the buildings
  for (const s of setSquares) {
    const [sx, sy] = toScreen(s.x, s.z)
    ctx.beginPath()
    ctx.arc(sx, sy, s.r / view.mpp, 0, Math.PI * 2)
    ctx.fillStyle = '#6fbf5a66'
    ctx.fill()
    ctx.strokeStyle = '#3d8a2e'
    ctx.lineWidth = 1
    ctx.stroke()
  }
  ctx.lineCap = 'round'
  for (const r of [...setLanes, ...setPaths]) {
    const path = r.id.includes('_PATH_')
    ctx.beginPath()
    for (let k = 0; k < r.pts.length / 2; k++) {
      const [sx, sy] = toScreen(r.pts[k * 2], r.pts[k * 2 + 1])
      if (k) ctx.lineTo(sx, sy)
      else ctx.moveTo(sx, sy)
    }
    ctx.strokeStyle = ROAD_TYPES[r.type].colour
    ctx.lineWidth = path ? Math.max(1.2, 2 / view.mpp) : Math.max(2, (roadHalf(r) * 2) / view.mpp)
    ctx.setLineDash(path ? [3, 3] : [])
    ctx.stroke()
  }
  ctx.setLineDash([])
  ctx.lineWidth = 1
  for (const q of settled) {
    ctx.beginPath()
    for (let k = 0; k < 4; k++) {
      const [sx, sy] = toScreen(q.corners[k * 2], q.corners[k * 2 + 1])
      if (k) ctx.lineTo(sx, sy)
      else ctx.moveTo(sx, sy)
    }
    ctx.closePath()
    ctx.fillStyle = CAT_COLOUR[q.cat]
    ctx.fill()
    ctx.strokeStyle = '#000c'
    ctx.stroke()
  }
}
// parcels: captured in the Workbench (fetched once through the bridge) + the parcel library (parcels.ts)
let captured: Parcel[] | null = null
const loadCaptured = async () => (captured ??= (await getTemplates()) as Parcel[])
async function loadParcels() {
  let got: Parcel[] = []
  let err: Error | null = null
  try { got = await loadCaptured() } catch (e) { err = e as Error }
  const all = [...got, ...(await libraryParcels())]
  if (!all.length && err) throw err
  return all
}
$<HTMLButtonElement>('parcelLib').addEventListener('click', () => openParcels(loadCaptured))
const groundAt = (x: number, z: number) => {
  if (!island) return 0
  const { cols, rows, step, minX, minZ } = island.grid
  const c = Math.min(cols - 1, Math.max(0, Math.round((x - minX) / step))), r = Math.min(rows - 1, Math.max(0, Math.round((z - minZ) / step)))
  return island.heights[r * cols + c]
}
$<HTMLButtonElement>('setGen').addEventListener('click', async () => {
  if (!island) return void (logEl.textContent = t('err.setNoIsland'))
  if (!sites.length) return void (logEl.textContent = t('err.setNoSites'))
  const chk = (id: string) => $<HTMLInputElement>(id).checked
  let pool: ReturnType<typeof parcelPool> | undefined
  if (chk('setParcels')) {
    try { pool = parcelPool(await loadParcels()) } catch (e) { logEl.textContent = t('err.parcels') + (e as Error).message; return }
  }
  const res = settle(sites, [...roads, ...existingRoads()], waters, island.heights, island.grid, { seed: num('setSeed'), density: num('setDensity') }, { square: chk('setSquare'), lanes: chk('setLanes'), paths: chk('setPaths'), pool, blocked: existing.objects.filter((o) => !/Prefabs\/Terrain\//.test(o.prefab)).map((o) => o.box) })
  settled = res.placed
  setLanes = res.lanes
  setPaths = res.paths
  setSquares = res.squares
  setInfo()
  logEl.textContent = $<HTMLSpanElement>('setInfo').textContent
  draw()
})
$<HTMLButtonElement>('setClear').addEventListener('click', () => { settled = []; setLanes = []; setPaths = []; setSquares = []; setInfo(); draw() })
// buildings plus their lanes and footpaths (SET_* family, replaced on resend); roads and water stay
$<HTMLButtonElement>('setSend').addEventListener('click', () =>
  run(t('run.l.set'), async () => {
    if (!settled.length) throw new Error(t('err.setNone'))
    runChecks()
    return toWb({ version: 0, shapes: settlementShapes({ lanes: setLanes, paths: setPaths }), entities: settlementEntities(settled, settled.some((q) => q.tpl) ? parcelItems(await loadParcels(), groundAt) : undefined) })
  }),
)

// --- start from a real place (realWorld.ts): terrain from a DEM, roads / water / forests / fields / places from OSM ---
// vanilla forest generators by leaf type and tree height (young / normal / mature): Reforger has no
// tree-height setting, the height comes from the generator chosen
const FG = 'Prefabs/WEGenerators/Forest/'
const FOREST_GEN: Record<NonNullable<MapArea['leaf']>, Record<NonNullable<MapArea['tall']>, string>> = {
  needle: { low: FG + 'FG_Forest_NurseryPine.et', mid: GENERATORS.forestPine, high: FG + 'FG_Forest_Pine3.et' },
  broad: { low: FG + 'FG_Forest_Birch.et', mid: FG + 'FG_Forest_Hornbeam.et', high: FG + 'FG_Forest_HornBeam3.et' },
  mixed: { low: FG + 'FG_Forest_NurseryPicea.et', mid: FG + 'FG_Forest_MixedBirchPine.et', high: FG + 'FG_Forest_PineSpruce1.et' },
}
function applyRealPlace(r: RealPlace) {
  let bSkipped = 0
  useWorld(r.world)
  // the real relief sets the height scale; the sea level is already in the heights
  let top = 1
  for (const h of r.world.heights) top = Math.max(top, h)
  $<HTMLInputElement>('tMax').value = String(Math.ceil(top))
  $<HTMLInputElement>('tSeaLevel').value = '0'
  const o = r.osm
  if (o) {
    for (const x of o.roads) roads.push({ id: nextRoadId(x.type), type: x.type, pts: x.pts, ...(x.width ? { width: x.width } : {}) })
    for (const x of o.rivers) waters.push({ id: nextWaterId('river'), type: 'river', pts: x.pts, width: x.width, depth: 1.5 })
    for (const x of o.lakes) waters.push({ id: nextWaterId('lake'), type: 'lake', pts: x, width: 0, depth: 2 })
    for (const s of o.sites) sites.push({ id: nextSiteId(s.kind), x: s.x, z: s.z, kind: s.kind })
    o.forests.forEach((f, k) => areas.push({ id: `FOREST_OSM_${k + 1}`, kind: 'forest', leaf: f.leaf, ...(f.tall ? { tall: f.tall } : {}), pts: f.pts }))
    o.fields.forEach((f, k) => areas.push({ id: `FIELD_OSM_${k + 1}`, kind: 'field', pts: f }))
    if (o.buildings.length) { const b = osmBuildings(o.buildings); settled = b.placed; bSkipped = b.skipped; setInfo() }
  }
  credits = r.credits
  waterInfo()
  roadInfo()
  recompose(true)
  draw()
  autosave()
  const g = r.world
  logEl.textContent = t('log.real', {
    name: r.name, km: ((g.cols - 1) * g.step / 1000).toFixed(2), step: g.step.toFixed(2),
    roads: o?.roads.length ?? 0, waters: (o?.rivers.length ?? 0) + (o?.lakes.length ?? 0), forests: o?.forests.length ?? 0,
    fields: o?.fields.length ?? 0, sites: o?.sites.length ?? 0,
  }) + (o?.buildings.length ? '\n' + t('log.realBld', { n: o.buildings.length - bSkipped, skip: bSkipped }) : '') + (credits.length ? '\n' + t('log.credits', { list: credits.join(' · ') }) : '')
}
$<HTMLButtonElement>('tReal').addEventListener('click', () => openRealWorld(applyRealPlace))
// tracing image (satellite / ortho photo / scanned map) stretched over the whole terrain, north up;
// only shown here, never sent to the game, not saved with the project (the file can be large)
let traceImg: HTMLImageElement | null = null
function drawTrace() {
  if (!traceImg || !terrain) return
  const [x0, y0] = toScreen(terrain.minX, terrain.minZ + (terrain.rows - 1) * terrain.step)
  const [x1, y1] = toScreen(terrain.minX + (terrain.cols - 1) * terrain.step, terrain.minZ)
  ctx.save()
  ctx.globalAlpha = Number($<HTMLInputElement>('traceAlpha').value)
  ctx.imageSmoothingEnabled = true
  ctx.drawImage(traceImg, x0, y0, x1 - x0, y1 - y0)
  ctx.restore()
}
$<HTMLInputElement>('traceFile').addEventListener('change', (e) => {
  const f = (e.target as HTMLInputElement).files?.[0]
  if (!f) return
  if (!terrain) { logEl.textContent = t('err.traceNoTerrain'); return }
  const img = new Image()
  img.onload = () => { traceImg = img; draw(); logEl.textContent = t('log.trace', { name: f.name, w: img.width, h: img.height }) }
  img.onerror = () => { logEl.textContent = t('err.traceImg', { name: f.name }) }
  img.src = URL.createObjectURL(f)
})
$<HTMLInputElement>('traceAlpha').addEventListener('input', () => draw())
$<HTMLButtonElement>('traceClear').addEventListener('click', () => { if (traceImg) URL.revokeObjectURL(traceImg.src); traceImg = null; $<HTMLInputElement>('traceFile').value = ''; draw() })
function drawAreas() {
  for (const a of areas) {
    ctx.beginPath()
    for (let k = 0; k < a.pts.length; k += 2) { const [sx, sy] = toScreen(a.pts[k], a.pts[k + 1]); if (k) ctx.lineTo(sx, sy); else ctx.moveTo(sx, sy) }
    ctx.closePath()
    ctx.fillStyle = a.kind === 'forest' ? 'rgba(40,110,40,0.38)' : 'rgba(200,180,80,0.18)'
    ctx.fill()
    ctx.setLineDash(a.kind === 'forest' ? [] : [5, 4])
    ctx.strokeStyle = a.kind === 'forest' ? 'rgba(70,160,70,0.9)' : 'rgba(220,200,110,0.8)'
    ctx.lineWidth = 1.2
    ctx.stroke()
    ctx.setLineDash([])
  }
}
function hitArea(x: number, z: number): MapArea | null {
  for (let i = areas.length - 1; i >= 0; i--) {
    const p = areas[i].pts
    let inside = false
    for (let a = 0, b = p.length - 2; a < p.length; b = a, a += 2) {
      if (p[a + 1] > z !== p[b + 1] > z && x < ((p[b] - p[a]) * (z - p[a + 1])) / (p[b + 1] - p[a + 1]) + p[a]) inside = !inside
    }
    if (inside) return areas[i]
  }
  return null
}
/** right-click on an OpenStreetMap area while the field zone is empty */
function openAreaMenu(e: MouseEvent) {
  const [wx, wz] = toWorld(...eventPos(e))
  const a = layer('areas') ? hitArea(wx, wz) : null
  if (!a) return false
  menu.innerHTML = ''
  const item = (label: string, fn: () => void) => {
    const b = document.createElement('button')
    b.textContent = label
    b.addEventListener('click', () => { hideMenu(); fn() })
    menu.append(b)
  }
  if (a.kind === 'field') item(t('menu.areaZone'), () => { setZone(a.pts); draw() })
  if (a.kind === 'forest') {
    const mark = (on: boolean, s: string) => (on ? '✓ ' : '\u2003') + s
    for (const l of ['broad', 'needle', 'mixed'] as const) item(mark((a.leaf ?? 'mixed') === l, t(`menu.leaf.${l}`)), () => { a.leaf = l; recompose(true); draw(); autosave() })
    for (const h of ['low', 'mid', 'high'] as const) item(mark((a.tall ?? 'mid') === h, t(`menu.tall.${h}`)), () => { a.tall = h; draw(); autosave() })
  }
  item(t('menu.areaDel'), () => { areas = areas.filter((x) => x !== a); recompose(true); draw(); autosave() })
  const box = map.getBoundingClientRect()
  menu.style.left = `${e.clientX - box.left + map.offsetLeft}px`
  menu.style.top = `${e.clientY - box.top + map.offsetTop}px`
  menu.hidden = false
  return true
}
// forests: one closed shape per area with the forest generator matching the OSM leaf type (FOREST_ family)
$<HTMLButtonElement>('forestSend').addEventListener('click', () =>
  run(t('run.l.forests'), async () => {
    const f = areas.filter((a) => a.kind === 'forest')
    if (!f.length) throw new Error(t('err.noForest'))
    return toWb({ version: 0, shapes: f.map((a) => ({ id: a.id, kind: 'polyline', closed: true, points: a.pts, generator: FOREST_GEN[a.leaf ?? 'mixed'][a.tall ?? 'mid'] })) })
  }),
)
$<HTMLButtonElement>('areasClear').addEventListener('click', () => { areas = []; recompose(true); draw(); autosave() })

// --- water: rivers and lakes drawn by hand (tab Eau) ---
function nextWaterId(type: WaterType) {
  const slug = WATER_TYPES[type].closed ? 'LAKE' : 'RIVER'
  for (let n = 1; ; n++) if (!waters.some((w) => w.id === `WATER_${slug}_${n}`)) return `WATER_${slug}_${n}`
}
function waterClick(x: number, z: number) {
  if (!waterDraft) return
  waterDraft.pts.push(Math.round(x * 10) / 10, Math.round(z * 10) / 10)
  draw()
}
function finishWater() {
  const w = waterDraft
  waterDraft = null
  $<HTMLButtonElement>('wNew').classList.remove('active')
  if (w && w.pts.length >= (WATER_TYPES[w.type].closed ? 6 : 4)) {
    waters.push(w)
    waterInfo()
    recompose(true)
  } else draw()
}
function waterInfo() {
  const ul = $<HTMLUListElement>('wList')
  ul.innerHTML = ''
  for (const w of waters) {
    const li = document.createElement('li')
    const name = document.createElement('span')
    name.textContent = `${w.id} — ${WATER_TYPES[w.type].label}${WATER_TYPES[w.type].closed ? '' : `, ${w.width} m`}, ${w.depth} m`
    const del = document.createElement('button')
    del.type = 'button'
    del.className = 'secondary'
    del.textContent = '✕'
    del.addEventListener('click', () => { waters = waters.filter((x) => x !== w); waterInfo(); recompose(true) })
    li.append(name, del)
    ul.append(li)
  }
}
function hitWater(sx: number, sy: number): Water | null {
  const [wx, wz] = toWorld(sx, sy)
  let best: Water | null = null, bd = 12 * view.mpp
  for (const w of waters) {
    const n = w.pts.length / 2, closed = WATER_TYPES[w.type].closed
    for (let i = 0; i < (closed ? n : n - 1); i++) {
      const ax = w.pts[i * 2], az = w.pts[i * 2 + 1], bx = w.pts[((i + 1) % n) * 2], bz = w.pts[((i + 1) % n) * 2 + 1]
      const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1
      const tt = Math.min(1, Math.max(0, ((wx - ax) * dx + (wz - az) * dz) / L2))
      const d = Math.hypot(wx - ax - dx * tt, wz - az - dz * tt) - (closed ? 0 : w.width / 2)
      if (d < bd) { bd = d; best = w }
    }
  }
  return best
}
function openWaterMenu(e: MouseEvent) {
  const [sx, sy] = eventPos(e)
  const w = hitWater(sx, sy)
  if (!w) return
  menu.innerHTML = ''
  const h = document.createElement('div')
  h.className = 'title'
  h.textContent = w.id
  menu.append(h)
  const item = (label: string, fn: () => void) => {
    const b = document.createElement('button')
    b.textContent = label
    b.addEventListener('click', () => { hideMenu(); fn(); waterInfo(); recompose(true) })
    menu.append(b)
  }
  const ask = (label: string, cur: number, set: (v: number) => void) =>
    item(label, () => { const v = Number(prompt(label, String(cur))); if (v > 0) set(v) })
  if (!WATER_TYPES[w.type].closed) ask(t('menu.waterWidth'), w.width, (v) => (w.width = v))
  ask(t('menu.waterDepth'), w.depth, (v) => (w.depth = v))
  item(t('menu.waterReverse'), () => {
    const r: number[] = []
    for (let i = w.pts.length - 2; i >= 0; i -= 2) r.push(w.pts[i], w.pts[i + 1])
    w.pts = r
  })
  item(t('menu.waterDel'), () => { waters = waters.filter((x) => x !== w) })
  menu.style.left = `${sx}px`
  menu.style.top = `${sy}px`
  menu.hidden = false
}
// --- planned bridges: one marker per road crossing water, click (water tool) to keep / drop it ---
const noBridge = new Set<string>() // gaps the user refused
const gapKey = (g: { id: string; from: [number, number]; to: [number, number] }) =>
  `${g.id}@${Math.round((g.from[0] + g.to[0]) / 20)},${Math.round((g.from[1] + g.to[1]) / 20)}`
let gapCache: { key: string; gaps: ReturnType<typeof splitAtWater>['gaps'] } = { key: '', gaps: [] }
function roadGaps() {
  const key = JSON.stringify([roads, waters])
  if (gapCache.key !== key) {
    const ids = new Set(roads.map((r) => r.id))
    gapCache = { key, gaps: splitAtWater(roadShapes(roads), waters).gaps.filter((g) => ids.has(g.id)) }
  }
  return gapCache.gaps
}
function drawBridges() {
  if (tool() !== 'water' && tool() !== 'road') return
  for (const g of roadGaps()) {
    const [x, y] = toScreen((g.from[0] + g.to[0]) / 2, (g.from[1] + g.to[1]) / 2)
    const off = noBridge.has(gapKey(g))
    ctx.beginPath()
    ctx.arc(x, y, 8, 0, Math.PI * 2)
    ctx.fillStyle = off ? 'rgba(200,40,40,0.85)' : 'rgba(40,170,60,0.9)'
    ctx.fill()
    ctx.strokeStyle = '#fff'
    ctx.lineWidth = 2
    ctx.stroke()
    ctx.fillStyle = '#fff'
    ctx.font = 'bold 11px sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(off ? '×' : 'P', x, y + 0.5)
  }
}
//! click on a bridge marker: toggles it; true when a marker was hit
function toggleBridge(px: number, py: number) {
  for (const g of roadGaps()) {
    const [x, y] = toScreen((g.from[0] + g.to[0]) / 2, (g.from[1] + g.to[1]) / 2)
    if (Math.hypot(px - x, py - y) > 10) continue
    const k = gapKey(g)
    if (noBridge.has(k)) noBridge.delete(k)
    else noBridge.add(k)
    autosave()
    draw()
    return true
  }
  return false
}

function drawWater() {
  for (const w of [...waters, ...(waterDraft ? [waterDraft] : [])]) {
    const wt = WATER_TYPES[w.type]
    const ring: number[][] = []
    for (let i = 0; i + 1 < w.pts.length; i += 2) ring.push([w.pts[i], w.pts[i + 1]])
    if (!ring.length) continue
    ctx.setLineDash(w === waterDraft ? [8, 4] : [])
    if (wt.closed) {
      path(ring, w !== waterDraft)
      if (w !== waterDraft) { ctx.fillStyle = wt.colour + '99'; ctx.fill() }
      ctx.strokeStyle = wt.colour
      ctx.lineWidth = 2
      ctx.stroke()
    } else {
      // the smoothed course, as the generator will mesh it
      const c = riverCourse(w.pts, w.width), course: number[][] = []
      for (let i = 0; i + 1 < c.length; i += 2) course.push([c[i], c[i + 1]])
      path(course, false)
      ctx.strokeStyle = wt.colour
      ctx.lineWidth = Math.max(2, w.width / view.mpp)
      ctx.lineCap = 'round'
      ctx.stroke()
      ctx.lineCap = 'butt'
      // flow direction: arrow at the downstream end
      if (ring.length >= 2) {
        const [ax, ay] = toScreen(ring[ring.length - 2][0], ring[ring.length - 2][1])
        const [bx, by] = toScreen(ring[ring.length - 1][0], ring[ring.length - 1][1])
        const an = Math.atan2(by - ay, bx - ax)
        ctx.beginPath()
        ctx.moveTo(bx, by)
        ctx.lineTo(bx - 10 * Math.cos(an - 0.5), by - 10 * Math.sin(an - 0.5))
        ctx.moveTo(bx, by)
        ctx.lineTo(bx - 10 * Math.cos(an + 0.5), by - 10 * Math.sin(an + 0.5))
        ctx.strokeStyle = '#fff'
        ctx.lineWidth = 2
        ctx.stroke()
      }
    }
    ctx.setLineDash([])
    ctx.fillStyle = '#fff'
    ring.forEach(([x, zz]) => {
      const [px, py] = toScreen(x, zz)
      ctx.fillRect(px - 2, py - 2, 4, 4)
    })
    // debug label: same id as the Workbench label over the object
    if (w !== waterDraft) {
      let lx = 0, lz = 0
      if (wt.closed) { for (const [x, zz] of ring) { lx += x / ring.length; lz += zz / ring.length } }
      else [lx, lz] = ring[Math.floor(ring.length / 2)]
      const [px, py] = toScreen(lx, lz)
      ctx.font = 'bold 11px sans-serif'
      ctx.textAlign = 'center'
      ctx.lineWidth = 3
      ctx.strokeStyle = '#000'
      ctx.strokeText(w.id, px, py - 6)
      ctx.fillStyle = '#ff0'
      ctx.fillText(w.id, px, py - 6)
      ctx.textAlign = 'start'
    }
  }
}
$<HTMLButtonElement>('wNew').addEventListener('click', () => {
  if (waterDraft) return finishWater()
  const type = $<HTMLSelectElement>('wType').value as WaterType
  waterDraft = { id: nextWaterId(type), type, pts: [], width: num('wWidth'), depth: num('wDepth'), carve: $<HTMLInputElement>('wCarve').checked }
  $<HTMLButtonElement>('wNew').classList.add('active')
  setTool('water')
  logEl.textContent = t(WATER_TYPES[type].closed ? 'log.waterLake' : 'log.waterRiver')
})
$<HTMLButtonElement>('wClear').addEventListener('click', () => { waters = []; waterDraft = null; waterInfo(); recompose(true) })
window.addEventListener('keydown', (e) => {
  if (tool() !== 'water' || (e.target as HTMLElement).closest('input, textarea, select')) return
  if (e.key === 'Enter') finishWater()
  if (e.key === 'Escape') { waterDraft = null; $<HTMLButtonElement>('wNew').classList.remove('active'); hideMenu(); draw() }
  if (e.key === 'Backspace' && waterDraft) { waterDraft.pts.length -= 2; draw() }
})
$<HTMLButtonElement>('wGen').addEventListener('click', () => {
  if (!island) $<HTMLButtonElement>('tGen').click()
  if (!island) return
  if (!riverSim) { $<HTMLInputElement>('rLive').checked = true; recompose(false) }
  if (!riverSim) return
  waters = waters.filter((w) => !w.auto)
  const traced = traceRivers(island.heights, island.grid, riverSim.flow, riverSim.down, num('rThreshold'), num('wDepth'))
  // lakes: pits of the relief WITHOUT the water carving (spill level from a priority flood)
  const base = Array.from(preWater ?? island.heights)
  const { filled } = computeRivers(base.slice(), island.grid.cols, island.grid.rows, island.grid.step, { rain: 1, windAngle: 0, threshold: 1e9, depth: 0 })
  const { lakes, rivers: made } = placeLakes(base, filled, island.grid, traced, {
    minArea: num('lMinArea'), sourceShare: num('lSource') / 100, depth: num('wDepth'), seed: num('tSeed') || 1,
  })
  for (const w of lakes) waters.push({ ...w, id: nextWaterId('lake') })
  for (const w of made) waters.push({ ...w, id: nextWaterId('river'), auto: true, carve: $<HTMLInputElement>('wCarve').checked })
  logEl.textContent = t('log.waterGen', { n: made.length, l: lakes.length })
  waterInfo()
  recompose(true)
})
$<HTMLButtonElement>('wTest').addEventListener('click', () =>
  run(t('run.l.waterTest'), async () => {
    if (!island || !waters.length) throw new Error(t('err.noWater'))
    runChecks() // markers only, never blocks
    const out: string[] = []
    logEl.textContent = t('test.p1')
    out.push(t('test.relief', { msg: (await applyHeightmap({ ...island.grid, heights: island.heights })).message }))
    logEl.textContent = t('test.water')
    out.push(t('test.waterSent', { msg: await toWb(waterAndRoads()) }))
    logEl.textContent = t('test.p3')
    const r = await writeMasks({
      addon: txt('tAddon'), world: txt('tWorld'), terrainSize: num('tSize'),
      surfaces: island.surfaces, colours: { ...island.colours, ...ROAD_COLOURS }, roads: [...roadMasks(roads), ...waterMasks(waters), ...roadMasks([...setLanes, ...setPaths]), ...buildingMasks(settled)],
    })
    out.push(t('test.masks', { dir: r.dir }), t('test.rest'))
    return out.join('\n')
  }),
)
// water changes where the roads are cut (bridge gaps): the roads always go with it
// roads that get a wooden bridge instead of a concrete one
const DIRT_ROADS = new Set<RoadType>(['dirt', 'dirt2', 'forest', 'trailDirt', 'trailGravel', 'trailForest'])
function waterAndRoads(): Project {
  const furn = $<HTMLInputElement>('roadFurn').checked
  const split = splitAtWater(roadShapesWithFurniture(), waters)
  const half = (id: string) => { const r = roads.find((q) => q.id === id); return r ? { half: roadHalf(r), dirt: DIRT_ROADS.has(r.type) } : undefined }
  return {
    version: 0,
    shapes: [...allWaterShapes(), ...split.shapes],
    entities: [
      ...(furn ? roadSigns(roads, $<HTMLInputElement>('roadLeft').checked) : []),
      ...(island && preWater ? riverBanks(waters, preWater, island.grid) : []),
      ...(island && preWater ? bridges(split.gaps.filter((g) => !noBridge.has(gapKey(g))), preWater, island.grid, half) : []),
    ],
  }
}
function allWaterShapes() {
  if (!island || !preWater) return []
  return waterShapes(waters, preWater, island.heights, island.grid)
}
$<HTMLButtonElement>('wSend').addEventListener('click', () =>
  run(t('run.l.water'), async () => {
    if (!island || !waters.length) throw new Error(t('err.noWater'))
    return toWb(waterAndRoads())
  }),
)

// roads (and their barriers) cut where they cross water: the gap is left for a bridge
function allRoadShapes() {
  return splitAtWater(roadShapesWithFurniture(), waters).shapes
}
function roadShapesWithFurniture() {
  const shapes = roadShapes(roads)
  if (!$<HTMLInputElement>('roadFurn').checked || !island) return shapes
  const { cols, rows, step } = island.grid
  const h = island.heights
  const heightAt = (x: number, z: number) => {
    const gx = Math.min(Math.max(x / step, 0), cols - 1.001), gz = Math.min(Math.max(z / step, 0), rows - 1.001)
    const c = Math.floor(gx), r = Math.floor(gz), fx = gx - c, fz = gz - r, i = r * cols + c
    const a = h[i] + (h[i + 1] - h[i]) * fx, b = h[i + cols] + (h[i + cols + 1] - h[i + cols]) * fx
    return a + (b - a) * fz
  }
  return [...shapes, ...roadFurniture(roads, heightAt, num('furnDrop'), num('furnPost'))]
}

document.querySelectorAll<HTMLInputElement>('#layers [data-layer]').forEach((el) => el.addEventListener('change', () => {
  if (el.checked) hiddenLayers.delete(el.dataset.layer!)
  else hiddenLayers.add(el.dataset.layer!)
  draw()
}))

// --- checks before sending: markers on the map + list in the Workbench tab; never blocks a send ---
function runChecks() {
  if (!island) return (issues = [])
  const ids = new Set(roads.map((r) => r.id))
  issues = validate({
    roads, sites, settled, heights: island.heights, grid: island.grid,
    refusedGaps: roadGaps().filter((g) => ids.has(g.id) && noBridge.has(gapKey(g))),
  })
  const list = $<HTMLUListElement>('checkList')
  list.innerHTML = ''
  for (const it of issues) {
    const li = document.createElement('li')
    li.textContent = t(('check.' + it.kind) as Parameters<typeof t>[0], { id: it.id, v: it.value ?? '' })
    li.addEventListener('click', () => { view.x = it.x; view.z = it.z; view.mpp = Math.min(view.mpp, 1.5); draw() })
    list.append(li)
  }
  if (!issues.length) list.innerHTML = `<li class="ok">${t('check.none')}</li>`
  draw()
  return issues
}
/** road shapes of the imported world, as roads the villages can line up on (never sent back) */
function existingRoads(): Road[] {
  return existing.shapes
    .filter((s) => s.generators.some((g) => /Road/i.test(g)))
    .map((s, i) => ({ id: `EXIST_${i}`, type: 'asphalt' as RoadType, pts: s.points.flat() }))
}
function drawExisting() {
  for (const s of existing.shapes) {
    const road = s.generators.some((g) => /Road/i.test(g)), forest = s.generators.some((g) => /Forest/i.test(g))
    const water = s.generators.some((g) => /River|Lake|Water/i.test(g))
    ctx.beginPath()
    s.points.forEach(([x, z], i) => { const [sx, sy] = toScreen(x, z); if (i) ctx.lineTo(sx, sy); else ctx.moveTo(sx, sy) })
    if (s.closed) ctx.closePath()
    if (forest && s.closed) { ctx.fillStyle = 'rgba(30,70,30,0.35)'; ctx.fill() }
    if (water && s.closed) { ctx.fillStyle = 'rgba(60,120,200,0.45)'; ctx.fill() }
    ctx.setLineDash(road || water ? [] : [6, 4])
    ctx.strokeStyle = water ? 'rgba(80,150,230,0.9)' : road ? 'rgba(200,200,200,0.85)' : forest ? 'rgba(60,140,60,0.8)' : 'rgba(255,255,255,0.5)'
    ctx.lineWidth = road ? Math.max(2, 6 / view.mpp) : 1.5
    ctx.stroke()
    ctx.setLineDash([])
  }
  ctx.fillStyle = 'rgba(150,150,160,0.7)'
  ctx.strokeStyle = 'rgba(0,0,0,0.6)'
  ctx.lineWidth = 1
  for (const o of existing.objects) {
    const [x0, y0] = toScreen(o.box[0], o.box[3])
    const [x1, y1] = toScreen(o.box[2], o.box[1])
    if (x1 < 0 || y1 < 0 || x0 > map.width || y0 > map.height) continue
    const w = Math.max(1, x1 - x0), h = Math.max(1, y1 - y0)
    ctx.fillRect(x0, y0, w, h)
    if (w > 4) ctx.strokeRect(x0, y0, w, h)
  }
}
function drawIssues() {
  for (const it of issues) {
    const [x, y] = toScreen(it.x, it.z)
    ctx.beginPath()
    ctx.moveTo(x, y - 11)
    ctx.lineTo(x + 10, y + 7)
    ctx.lineTo(x - 10, y + 7)
    ctx.closePath()
    ctx.fillStyle = 'rgba(255,150,0,0.92)'
    ctx.fill()
    ctx.strokeStyle = '#000'
    ctx.lineWidth = 1.5
    ctx.stroke()
    ctx.fillStyle = '#000'
    ctx.font = 'bold 12px sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('!', x, y + 1)
  }
}
$<HTMLButtonElement>('checkRun').addEventListener('click', () => {
  const n = runChecks().length
  logEl.textContent = n ? t('log.checkIssues', { n }) : t('check.none')
})

// restore the autosaved project last: loading it redraws, which needs every declaration above
try {
  const saved = localStorage.getItem(PROJECT_KEY)
  if (saved) { loadProject(JSON.parse(saved)); logEl.textContent = t('log.restored') }
} catch (err) { console.warn('autosave not restored', err) }

// first paint once everything is declared
draw()
refreshStatus()
