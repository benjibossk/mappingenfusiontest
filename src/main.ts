import { dedupeLines, densify } from './modules/fenceDedupe'
import { PLATFORMS, PLATFORM_BUDGETS, densityGrid, type DensityGrid, type Platform } from './modules/platformBudget'
import { drawDensityHeat } from './modules/densityLayer'
import './style.css'
import { LANGS, chooseLang, completion, exportLang, external, followsBrowser, fr, getLang, importLang, t, type Key } from './i18n'
import { prefabDims } from './library/dims'
import { bridgeParts } from './modules/bridges3d'
import { modDepsText, modsChecklist } from './modsPanel'
import './data/modBuildings' // ticked mods' buildings join the generators' pools (off by default)
import { Collab, type CollabEvents, type CollabTransport, type Op } from './collab'
import { P2PCollab, newRoom } from './p2p'
import { APP_VERSION, CHANGELOG } from './data/changelog'
import { loadTrace, saveTrace, traceDataUrl } from './traceStore'
import { cemeteryPathMasks, parcelGroundMasks } from './modules/parcelground'
import { POWER_DEFAULTS, mergePowerLines, placePoles, poleDirtMasks, powerLineShape, type PowerKind, type PowerLine, type PowerStyle } from './modules/power'
import { powerKindOf } from './modules/osmImport'
import { powerWorld } from './modules/worldpower'
import { accessShapes, planGrid, stationEntities, type PowerDistrib, type GridSite, type Station } from './modules/powergrid'
import { FOREST_AVOID, GENERATORS, withAvoid, type Project, type ProjectEntity, type ProjectShape } from './project'
import { openRealWorld, type RealPlace } from './realWorld'
import { rasterCover, rle, unrle } from './modules/cover'
import { osmBuildings } from './modules/realBuildings'
import { WATER_TYPES, carveWater, riverBanks, riverCourse, waterMasks, placeLakes, splitAtWater, bridges, traceRivers, waterShapes, type Water, type WaterType } from './modules/water'
import { refReadOnly, setRefReadOnly, BRIDGE_URL, applyHeightmap, getStatus, getExisting, getTemplates, getCamera, type WbCamera, getWorld, type Existing, type ExistingObject, type ExistingShape, type WorldExport, prepareSurfaces, sendToWorkbench, writeMasks as writeMasksRaw } from './bridge'
import { computeSurfaces, settlementMask, SURFACE_COLOURS, generateIsland, overfullBlocks, type Island } from './modules/island'
import { computeRivers } from './modules/hydro'
import { Sculpt } from './modules/sculpt'
import { type CampaignResult } from './modules/campaign'
import { CROP_COLOURS, colourCrops, type Crop } from './modules/fieldlayout'
import { cutForests, isAutumnBiome, riparianBands, riparianShapes, type RiparianPatch } from './modules/riparian'
import { outsideHtml, outsideFor, wireOutside } from './outsideUi'
import { forestEdges, forestEdgeShapes } from './modules/forestEdge'
import { mergeForestPatches } from './modules/forestMerge'
import { scatterBuildings } from './modules/scattered'
import { generateTown } from './modules/town'
import { makeSiteZone, SITE_TYPES, type SiteType } from './modules/sitezones'
import type { Faction } from './modules/modules'
import { makeProdForest, type ProdLog } from './modules/prodforest'
import { addRoundabouts, dropOrphanRings, villageWalls } from './modules/roundabouts'
import { buildMotorway, overpassDecks } from './modules/motorway'
import { ZONE_FILL_TYPES, ZONE_MAX_SLOPE, ZONE_PRIORITY, clipPlots, cutRing, fillFieldZone, flatToPoly, pointObstacle, roadObstacles, slopeShare, type ZoneFillType } from './modules/zonefill'
import { cutAtRoads } from './modules/roadGaps'
import { dropCoveredPosts, extraGuardrails } from './modules/guardrails'
import { ROAD_COLOURS, ROAD_TYPES, carveRoads, centreLine, layBeds, roadFurniture, roadHalf, roadMasks, roadSigns, roadShapes, snap, type Road, type RoadType } from './modules/roads'

// map layers the user can hide (floating "Calques" panel)
const LAYERS = ['existing', 'areas', 'countryside', 'fields', 'runoff', 'water', 'roads', 'power', 'furniture', 'sites', 'buildings', 'zones', 'bridges', 'issues', 'density', 'names'] as const
const hiddenLayers = new Set<string>()
let density: DensityGrid | null = null // object count per cell for the platform budget (platformBudget.ts)
const layer = (l: (typeof LAYERS)[number]) => !hiddenLayers.has(l)
let collab: CollabTransport | null = null // shared room: direct (src/p2p.ts) or server (src/collab.ts)
let quietUntil = 0 // a project just received from the room is not sent back
let remoteApply = false // a room project being loaded: its checkpoints are not logged as our changes
let saveTimer = 0 // declared early: handlers registered above autosave() may fire first
let issues: (Issue | PreIssue)[] = [] // read by draw(), which runs during start-up
/** what already stands in the imported world: shown locked, kept clear by the generators */
let existing: Existing = { objects: [], shapes: [] }
/** origins of existing objects taken over or deleted in the map, deleted in the Workbench on the next send */
//! family: deleted only by a send that rebuilds it (ROAD_ / WATER_), ANY = deleted by hand, on any send
interface Removed { f: 'ROAD_' | 'WATER_' | 'ANY'; x: number; z: number }
let removed: Removed[] = []
/** forests and field areas brought from OpenStreetMap (realWorld.ts): forests are sent as forest generators */
interface MapArea { id: string; kind: 'forest' | 'field'; leaf?: 'broad' | 'needle' | 'mixed'; tall?: 'low' | 'mid' | 'high'; pts: number[]; holes?: number[][]; stage?: 'mature' | 'juvenile' | 'thinned' | 'clearcut'; logs?: ProdLog[] } // stage/logs: production forest (prodforest.ts)
let areas: MapArea[] = []
/** land cover per terrain vertex from ESA WorldCover (realWorld.ts), painted under the areas */
let landCover: { cols: number; data: Uint8Array } | null = null
/** data sources of the terrain (licences asking for attribution) */
let credits: string[] = []
// spline roads: drop points on top of the previous one and hairpin points (turn > 120 degrees), the
// generator draws a loop there. Shapes with a per-point lift (water) are left as they are.
function cleanSpline(pts: number[]): number[] {
  const out: number[] = [pts[0], pts[1]]
  for (let k = 2; k + 1 < pts.length; k += 2) {
    const x = pts[k], z = pts[k + 1]
    let dup = false
    const last = k + 2 >= pts.length
    for (;;) {
      const n = out.length
      const d = Math.hypot(x - out[n - 2], z - out[n - 1])
      // "invalid segments" in the road generator: interior points closer than 3 m are skipped; the end
      // point is kept and takes the place of a too close interior one
      if (d < 0.5 || (d < 3 && !last)) { dup = true; break }
      if (d < 3 && last && n >= 4) { out.length = n - 2; continue }
      if (n < 4) break
      const dx = out[n - 2] - out[n - 4], dz = out[n - 1] - out[n - 3], ex = x - out[n - 2], ez = z - out[n - 1]
      if ((dx * ex + dz * ez) / (Math.hypot(dx, dz) * Math.hypot(ex, ez)) >= -0.5) break
      out.length = n - 2 // hairpin: the middle point goes, test again against the one before
    }
    if (!dup) out.push(x, z)
  }
  return out // fewer than 2 points left: a crumb under 0.5 m, dropped by toWb
}
const toWb = async (p: Project) => {
  const before = p.shapes.reduce((n, sh) => n + sh.points.length, 0), count = p.shapes.length
  p = { ...p, shapes: p.shapes.map(withAvoid).map(sanitizeRoadShape).map((sh) => (sh.kind === 'spline' && !sh.lift?.length ? { ...sh, points: cleanSpline(sh.points) } : sh)).filter((sh) => sh.points.length >= 4) }
  const lostPts = (before - p.shapes.reduce((n, sh) => n + sh.points.length, 0)) / 2 - (count - p.shapes.length), crumbs = count - p.shapes.length
  const ids = [...p.shapes.map((s) => s.id), ...(p.entities ?? []).map((e) => e.id)]
  const go = (r: Removed) => r.f === 'ANY' || ids.some((id) => id.startsWith(r.f))
  const msg = await sendToWorkbench({ ...p, ffBiome: ffBiomeValue(currentBiome), remove: removed.filter(go).flatMap((r) => [r.x, r.z]) })
  removed = removed.filter((r) => !go(r))
  autosave()
  return (lostPts > 0 || crumbs ? t('log.cleaned', { pts: lostPts, crumbs }) + '\n' : '') + msg
}
import { ffBiomeName, ffBiomeValue } from './ffbiome'
import { SITE_RADIUS, pickSites, type Site, type SiteKind } from './modules/network'
import { validate, type Issue } from './modules/validate'
import { applyFixes, preSendChecks, type PreIssue } from './validate/preSend'
import { generateForests } from './modules/forestgen'
import { worldToIsland } from './modules/importWorld'
import { REF_MAPS, loadRefMap, refHeights, refBuildings, refFences, forestMask, maskOutlines, mapStats, treesPerHa, polyArea, type RefMap, type RefMapId, type MapStats, type StatRoad } from './modules/refMap'
import { parcelItems, parcelPool, type Parcel } from './modules/templates'
import { libraryParcels, openParcels } from './parcels'
import { CAT_COLOUR, settle, settlementEntities, buildingMasks, yardMasks, settlementShapes, type Placed, type Square } from './modules/settlements'
import { heightAt, isLand, loadHeightmap, renderTerrain, type Heightmap } from './terrain'
import { settleVillages, type VillageParcel, type VillageVariant } from './modules/village'
import { applyZones, makeAirfield, makeIndustrial, makeMilitary, nextZoneId, zoneBlocked, zoneDisc, type ZoneItem, type ZoneKind } from './modules/zones'
import { suggestIndustrialSites, INDUSTRIAL_TYPES, pointInPoly, type IndustrialType } from './modules/industrial'
import { suggestMilitary, type MilitaryKind } from './modules/military'
import { suggestAirfield, type AirfieldSize } from './modules/airfield'
import { suggestSurfaces, satelliteSurfaces, packRgbaMask, previewRgba, type Quantised } from './modules/satmask'
import { LAYERS as GEN_LAYERS, markBuilt, setGlobalSeed, setLayerSeed, staleLayers, type LayerId, type LayerMap } from './modules/layers'
import { applyPads, layPads } from './modules/pads'
import { buildingFootprints, Cancelled, WORLD_DEFAULTS, WORLD_STAGES, type WorldResult } from './modules/worldgen'
import { runGen } from './workers/genClient'
import { mountSeedBrowser } from './ui/seedBrowser'
import { mountLifeEconomy, drawLifeRoute } from './ui/lifeEconomyTab'
import { emptyPipeline, hashWorld, readPipeline, recordStep, replayPipeline, stageTimer, type Pipeline } from './modules/replay'
let layerMap: LayerMap = {} // per-layer seed overrides + stale flags (src/modules/layers.ts), saved in the project
let pipeline: Pipeline = emptyPipeline() // recorded generation steps (src/modules/replay.ts), saved in the project; declared early: the autosave reads it at startup
import { BIOMES, PROPS, biome, type BiomeId } from './data/biomes'
import { DEFAULT_BIOME, applyBiome, isBiome } from './biomes/surfaces'
import { drapeTint, forestGeneratorFor, mixedNeedle, treeTint, zoneForestLeaf, type ZoneLeafChoice } from './biomes/vegetation'
import { registerAtelierCollab, notifyAtelierCollab } from './atelier/networks/comments'
import { sanitizeRoadShape } from './modules/roadSanitize'
import { camLookAt, worldToMap } from './modules/wbCamera'
var menuOpen = false // the welcome screen was reopened from the top-left Menu (declared early: read by the step render)

// the side panel is a guided path: one step per tab, in the order a map is built
const STEPS = [
  { tab: 'island', label: 'step.relief', lead: 'step.relief.lead' },
  { tab: 'brush', label: 'step.sculpt', lead: 'step.sculpt.lead' },
  { tab: 'water', label: 'step.water', lead: 'step.water.lead' },
  { tab: 'roads', label: 'step.roads', lead: 'step.roads.lead' },
  { tab: 'villages', label: 'step.villages', lead: 'step.villages.lead' },
  { tab: 'camp', label: 'step.fields', lead: 'step.fields.lead' },
  { tab: 'wb', label: 'step.send', lead: 'step.send.lead' },
] as const

// stroke icons for the UI chrome (MILSPEC style: 1.6px stroke, currentColor)
// --- biome (docs/BIOMES_LIBRARY.md §5): step 1 + random-world dialog, stored in the project ---
let currentBiome: BiomeId = DEFAULT_BIOME
function biomeTip(id: BiomeId) {
  const b = biome(id)!, fr = getLang() === 'fr'
  return `${fr ? b.desc.fr : b.desc.en}\n${t('biome.missing')} ${fr ? b.missing.fr : b.missing.en}`
}
function biomeField(id: string) {
  const fr = getLang() === 'fr'
  const opts = BIOMES.map((b) => `<option value="${b.id}">${fr ? b.label.fr : b.label.en} · ${t(('biomeAvailability.' + b.availability) as K)}</option>`).join('')
  return `<label class="biomesel"><span class="lbl">${t('biome')}</span><span class="biomeline"><select id="${id}" data-biome>${opts}</select><span class="biomebadge" data-avail="vanilla"></span></span></label>`
}
const ICON: Record<string, string> = {
  book: '<path d="M4 4h6a2 2 0 0 1 2 2v14a2 2 0 0 0-2-2H4z"/><path d="M20 4h-6a2 2 0 0 0-2 2v14a2 2 0 0 1 2-2h6z"/>',
  lock: '<rect x="5" y="11" width="14" height="10"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  dice: '<rect x="4" y="4" width="16" height="16"/><path d="M8.5 8.5h.01M15.5 8.5h.01M12 12h.01M8.5 15.5h.01M15.5 15.5h.01"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>',
  redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H9a5 5 0 0 0 0 10h3"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8"/><path d="M18 14.5a6.5 6.5 0 0 1 3.5 5.5"/>',
  island: '<path d="M3 17c2-1 4-1 6 0s4 1 6 0 4-1 6 0"/><path d="M6 13c1-4 4-6 7-6s5 2 6 6"/><path d="M12 7V3"/>',
  map: '<path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2z"/><path d="M9 4v14"/><path d="M15 6v14"/>',
  folder: '<path d="M3 6h6l2 2h10v11H3z"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  pin: '<path d="M12 21s-6-6-6-11a6 6 0 0 1 12 0c0 5-6 11-6 11z"/><circle cx="12" cy="10" r="2"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>',
  caret: '<path d="m6 9 6 6 6-6"/>',
  check: '<path d="m5 12 5 5 9-10"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5v.7"/><path d="M12 17h.01"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6"/><path d="M12 7h.01"/>',
  search: '<circle cx="11" cy="11" r="6"/><path d="m20 20-4.5-4.5"/>',
}
const ic = (n: string, size = 18) => `<svg class="ic" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="square" stroke-linejoin="miter" aria-hidden="true">${ICON[n]}</svg>`
const info = (k: Key) => `<i class="info" title="${t(k)}" aria-label="${t(k)}" role="img">${ic('info', 13)}</i>`
type K = Parameters<typeof t>[0]
/** grey help line: a short text stays as is; a long one shows its first sentence, the rest behind an (i) tooltip */
function hint(k: Key) {
  const full = t(k)
  if (full.length <= 110) return `<p class="hint">${full}</p>`
  const m = /^(.{20,110}?[.:!?])\s/.exec(full)
  const head = m ? m[1] : full.slice(0, 90).replace(/\s\S*$/, '') + '…'
  return `<p class="hint">${head} ${info(k)}</p>`
}
/** friendly, localised map label for a Workbench id (the id stays in the data and the tooltips) */
// map labels drawn this frame (screen boxes x0,y0,x1,y1): a label that would overlap one is skipped
const labelBoxes: number[] = []
function placeLabel(text: string, x: number, y: number, centre = false): boolean {
  const w = ctx.measureText(text).width, x0 = centre ? x - w / 2 : x
  const b = [x0 - 2, y - 12, x0 + w + 2, y + 3]
  for (let i = 0; i < labelBoxes.length; i += 4)
    if (b[0] < labelBoxes[i + 2] && b[2] > labelBoxes[i] && b[1] < labelBoxes[i + 3] && b[3] > labelBoxes[i + 1]) return false
  labelBoxes.push(...b)
  return true
}
function nice(id: string, roadType?: string): string {
  const n = id.match(/(\d+)$/)?.[1] ?? ''
  let m = id.match(/^WATER_(RIVER|LAKE)_\d+$/)
  if (m) return t(m[1] === 'RIVER' ? 'name.river' : 'name.lake', { n })
  m = id.match(/^(TOWN|VILLAGE|HAMLET|FARM)_\d+$/)
  if (m) return t(('name.' + m[1].toLowerCase()) as K, { n })
  if (roadType && /^ROAD_/.test(id) && n) return `${t(('road.type.' + roadType) as K)} ${n}`
  return id
}
const connectSteps = () => `<ol class="wbsteps"><li>${t('wb.how.1')}</li><li>${t('wb.how.2')}</li><li>${t('wb.how.3')}</li></ol>`
let openHelp: (section?: string) => void = () => {}
const LANG_NAME = LANGS.find((l) => l.code === getLang())?.name ?? getLang()

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
<div class="app">
  <header class="top">
    <button type="button" id="brandMenu" class="brand" title="${t('menu.tip')}" aria-label="${t('menu.tip')}">${ic('menu', 18)}<span>reforger-mapper</span></button>
    <button id="verLink" type="button" class="verbadge" title="${t('news.ver', { v: APP_VERSION })}" aria-label="${t('news.ver', { v: APP_VERSION })}">v${APP_VERSION}<i id="verDot" class="vdot" hidden></i></button>
    <button id="undo" class="hist" title="${t('app.undo')}" aria-label="${t('app.undo')}">${ic('undo')}</button>
    <button id="redo" class="hist" title="${t('app.redo')}" aria-label="${t('app.redo')}">${ic('redo')}</button>
    <span id="status" class="status" role="button" tabindex="0" title="${t('wb.chip.tip')}">${t('wb.chip.off')}</span>
    <span id="collabInfo" class="hint"></span>
    <span class="grow"></span>
    <button id="oneClick" class="hist withlbl" type="button" title="${t('replay.one.tip')}" aria-label="${t('replay.one.tip')}">${ic('dice')}<span>${t('replay.one')}</span></button>
    <button id="replayAll" class="hist withlbl" type="button" title="${t('replay.all.tip')}" aria-label="${t('replay.all.tip')}">${ic('refresh')}<span>${t('replay.all')}</span></button>
    <button id="libBtn" class="hist withlbl" type="button" title="${t('library.tip')}" aria-label="${t('library.tip')}">${ic('book')}<span>${t('library')}</span></button>
    <button id="collab" class="hist withlbl" title="${t('collab.tip')}" aria-label="${t('collab.tip')}">${ic('users')}<span>${t('collab.short')}</span></button>
    <div class="langsel">
      <button id="lang" class="langbtn" type="button" title="${t('lang.title')}" aria-haspopup="listbox" aria-expanded="false">${ic('globe', 16)}<span class="lcode">${getLang().toUpperCase()}</span><span class="lname"> · ${LANG_NAME}</span>${completion(getLang()) < 100 ? `<span class="lpct">${completion(getLang())}%</span>` : ''}${ic('caret', 14)}</button>
      <div id="langMenu" class="langmenu" hidden>
        <div class="lmhead">${t('lang.title')}</div>
        <div id="langList" role="listbox" tabindex="-1" aria-label="${t('lang.title')}">
          ${LANGS.map((l) => { const c = completion(l.code); return `<div role="option" id="lang-${l.code}" data-lang="${l.code}" aria-selected="${l.code === getLang()}"><span class="lcode">${l.code.toUpperCase()}</span><span class="lname">${l.name}${l.code === 'en' ? ` <small>· ${t('lang.base')}</small>` : ''}</span><span class="lbar"><i style="width:${c}%"></i></span><span class="lpct${c < 100 ? ' part' : ''}">${c}%</span><span class="lok">${l.code === getLang() ? ic('check', 14) : ''}</span></div>` }).join('')}
        </div>
        <div class="lmfoot">
          <label class="check"><input id="langFollow" type="checkbox"${followsBrowser() ? ' checked' : ''}> ${t('lang.follow')}</label>
          <div class="row"><button id="langExport" type="button" class="secondary">${t('lang.export')}</button><button id="langImport" type="button" class="secondary">${t('lang.import')}</button></div>
          <input id="langFile" type="file" accept=".json,application/json" hidden>
        </div>
      </div>
    </div>
    <button id="helpFab" type="button" class="hist helpbtn" title="${t('help.tip')} (F1)" aria-label="${t('help.tip')}" aria-haspopup="dialog" aria-keyshortcuts="F1">?</button>
  </header>
  <div id="collabBox" class="ctxmenu collabbox" hidden>
    <div class="title">${t('collab.title')}</div>
    <label>${t('p2p.mode')} <select id="collabMode"><option value="direct">${t('p2p.mode.direct')}</option><option value="server">${t('p2p.mode.server')}</option></select></label>
    <button id="p2pCreate" type="button">${t('p2p.create')}</button>
    <div id="p2pShare" class="p2pshare" hidden><input id="p2pLink" type="text" readonly aria-label="${t('p2p.link')}"> <button id="p2pCopy" type="button" class="secondary">${t('p2p.copy')}</button><div class="info">${t('p2p.share.hint')}</div></div>
    <label id="collabUrlRow">${t('collab.server')} <input id="collabUrl" type="text"></label>
    <label>${t('collab.room')} <input id="collabRoom" type="text"></label>
    <label>${t('collab.name')} <input id="collabName" type="text"></label>
    <label>${t('collab.key')} <input id="collabKey" type="password" autocomplete="off"></label>
    <details class="p2padv"><summary>${t('p2p.adv')}</summary>
      <label>${t('p2p.turn')} <input id="p2pTurn" type="text" placeholder="turn:turn.example.org:3478"></label>
      <label>${t('p2p.turnUser')} <input id="p2pTurnUser" type="text" autocomplete="off"></label>
      <label>${t('p2p.turnPass')} <input id="p2pTurnPass" type="password" autocomplete="off"></label>
      <div class="info">${t('p2p.turn.hint')}</div>
    </details>
    <button id="collabGo" type="button">${t('collab.join')}</button>
    <div id="p2pStatus" class="info" role="status"></div>
    <button id="p2pToServer" type="button" class="secondary" hidden>${t('p2p.toServer')}</button>
    <div id="collabHint" class="info">${t('p2p.hint')}</div>
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
    <button id="btn3d" type="button" class="v3d-toggle" title="${t('v3d.tip')}" aria-label="${t('v3d.tip')}">3D</button>
    <div id="shareDlg" class="rwdlg" hidden role="dialog" aria-modal="true" aria-labelledby="shareTitle">
      <div class="rwbox sharebox">
        <div class="dlghead"><h2 id="shareTitle">${t('share.title')}</h2><button id="shareX" type="button" class="secondary icon" title="${t('share.close')}" aria-label="${t('share.close')}">${ic('x', 16)}</button></div>
        <p class="hint">${t('share.lead')}</p>
        <div class="segtabs" role="tablist" aria-label="${t('share.title')}">
          <button type="button" role="tab" id="shtCreate" aria-controls="shpCreate" aria-selected="true">${t('share.create')}</button>
          <button type="button" role="tab" id="shtJoin" aria-controls="shpJoin" aria-selected="false" tabindex="-1">${t('share.join.tab')}</button>
        </div>
        <label class="sharename">${t('share.name')} <input id="shareName" type="text" autocomplete="nickname"></label>
        <section id="shpCreate" role="tabpanel" aria-labelledby="shtCreate" class="sharepane">
          <p>${t('share.create.tip')}</p>
          <button id="shareCreate" type="button" class="wide">${t('share.create.go')}</button>
          <div id="shareLinkRow" hidden>
            <span class="wglabel">${t('share.link.k')}</span>
            <div class="linkrow"><input id="shareLink" type="text" readonly aria-label="${t('p2p.link')}"><button id="shareCopy" type="button">${t('p2p.copy')}</button></div>
            <div class="sharewarn">${ic('lock', 16)}<span>${t('p2p.share.hint')}</span></div>
          </div>
        </section>
        <section id="shpJoin" role="tabpanel" aria-labelledby="shtJoin" class="sharepane" hidden>
          <p>${t('share.join.tip')}</p>
          <input id="shareJoinLink" type="text" placeholder="${t('share.join.ph')}" aria-label="${t('share.join.ph')}">
          <button id="shareJoin" type="button" class="wide">${t('share.join.go')}</button>
        </section>
        <div id="shareStatus" class="info" role="status"></div>
        <div class="dlgfoot"><button id="shareAdv" type="button" class="linkbtn">${t('share.adv')}</button><span class="grow"></span><button id="shareClose" type="button" class="secondary">${t('share.close')}</button></div>
      </div>
    </div>
    <div id="rwDlg" class="rwdlg" hidden role="dialog" aria-modal="true" aria-labelledby="rwTitle">
      <div class="rwbox">
        <h2 id="rwTitle">${ic('dice')} ${t('wg.title')}</h2>
        <p class="hint">${t('wg.lead')}</p>
        <div class="form">
          <label><span class="lbl">${t('wg.seed')} ${info('info.wgSeed')}</span><span class="seedrow"><input id="rwSeed" type="number" step="1" value="1"><button id="rwDice" type="button" class="secondary icon" title="${t('wg.dice')}" aria-label="${t('wg.dice')}">${ic('dice', 16)}</button></span></label>
          <details id="rwLayers" class="rwlayers"><summary>${t('wg.layers')}</summary><p class="hint">${t('wg.layers.hint')}</p>${GEN_LAYERS.map((l) => `<label><span class="lbl">${t(('layer.' + l) as K)} <span class="badge" data-stale="${l}" hidden>${t('wg.layers.stale')}</span></span><input id="rwL_${l}" data-layer="${l}" type="number" step="1" min="1" placeholder="${t('wg.layers.derived')}"></label>`).join('')}</details>
          <label>${t('wg.size')} <select id="rwSize"><option value="2048">2 km</option><option value="4096" selected>4 km</option><option value="8192">8 km</option><option value="16384">16 km (≈ 1-2 min)</option></select></label>
          ${biomeField('rwBiome')}
          ${(['towns', 'villages', 'hamlets', 'industry', 'military', 'forests', 'fieldTrees'] as const).map((k) => `<label class="rwslider"><span class="lbl">${t(('wg.' + k) as K)} ${info(('info.wg.' + k) as K)}</span><input id="rw_${k}" type="range" min="0" max="2" step="0.25" value="1"><output id="rw_${k}_v">×1</output></label>`).join('')}
        </div>
        <div class="row">
          <label class="check"><input id="rwAir" type="checkbox" checked> ${t('wg.airfield')} ${info('info.wg.airfield')}</label>
          <label class="check"><input id="rwMotorway" type="checkbox"> ${t('lbl.motorway')} ${info('info.motorway')}</label>
          <label class="check"><input id="rwDams" type="checkbox"> ${t('lbl.dams')} ${info('info.dams')}</label>
          <label class="check"><input id="rwVanillaSites" type="checkbox" checked> ${t('lbl.vanillaSites')} ${info('info.vanillaSites')}</label>
          <label class="check"><input id="rwVillageTpl" type="checkbox" checked> ${t('lbl.villageTpl')} ${info('info.villageTpl')}</label>
          <label class="check"><input id="rwPower" type="checkbox" checked> ${t('wg.power')}</label>
        </div>
        <div class="form"><label>${t('lbl.powDistrib')} ${info('info.powDistrib')} <select id="rwPowDistrib"><option value="auto" selected>${t('opt.powDistAuto')}</option><option value="overhead">${t('opt.powDistOver')}</option><option value="underground">${t('opt.powDistUnder')}</option></select></label></div>
        <div id="rwRun" class="rwrun" hidden>
          <div class="rwnum"><span id="rwSeedK" class="kicker"></span><span class="grow"></span><b id="rwPct" class="busypct"></b><span id="rwEta" class="busytime"></span></div>
          <progress id="rwProg" max="100" value="0"></progress>
          <ul id="rwSteps" class="rwsteps">${WORLD_STAGES.map((k) => `<li data-st="${k}">${t(('wg.st.' + k) as K)}</li>`).join('')}</ul>
          <span id="rwStage" class="hint" role="status"></span>
        </div>
        <p class="hint rwrepl">${t('wg.replace')}</p>
        <div class="row rwact">
          <button id="rwGo" type="button">${t('wg.go')}</button>
          <button id="rwCancel" type="button" class="secondary">${t('wg.cancel')}</button>
        </div>
      </div>
    </div>
    <div id="welcome" class="welcome" hidden>
      <div class="wresume"><span class="kicker">${t('welcome.resume.k')}</span><span class="wrtext">${t('welcome.resume.lead')}</span><span class="grow"></span><button type="button" id="welcomeResume" hidden>${t('menu.resume')} →</button></div>
      <div class="whead">
        <span class="kicker">${t('welcome.kicker')}</span>
        <h2>${t('welcome.title2')}</h2>
        <p>${t('welcome.lead')}</p>
      </div>
      <div class="wgroup">
        <span class="wglabel">${t('welcome.g.create')}</span>
        <div class="choices create">
          <button type="button" data-go="tGen" class="rec">${ic('island', 28)}<strong>${t('welcome.new')}</strong><span>${t('welcome.new.tip')}</span><em>${t('welcome.new.foot')}</em></button>
          <button type="button" data-go="tRandom">${ic('dice', 28)}<strong>${t('welcome.random')}</strong><span>${t('welcome.random.tip')}</span><em class="nocaps">${t('welcome.random.foot')}</em></button>
          <button type="button" data-go="tReal">${ic('map', 28)}<strong>${t('welcome.real')}</strong><span>${t('welcome.real.tip')}</span><em>${t('welcome.real.foot')}</em></button>
        </div>
        <span class="wglabel">${t('welcome.g.existing')}</span>
        <div class="choices existing">
          <button type="button" id="welcomeJoin">${ic('users', 28)}<span class="wtxt"><strong>${t('welcome.join')}</strong><span>${t('welcome.join.tip')}</span></span><em>${t('welcome.join.foot')}</em></button>
          <button type="button" id="welcomeAtelier">${ic('folder', 28)}<span class="wtxt"><strong>${t('welcome.atelier')}</strong><span>${t('welcome.atelier.tip')}</span></span><em>${t('welcome.atelier.foot')}</em></button>
        </div>
        <div class="wfoot"><button type="button" data-go="pOpen" class="wfile" title="${t('welcome.open.tip')}">${ic('folder', 16)} ${t('welcome.file')}</button></div>
      </div>
    </div>
    <div id="ctxMenu" class="ctxmenu" hidden></div>
    <div class="mapdock">
    <details id="layers" class="layers">
      <summary>${t('layers.title')} ${info('info.layers')}</summary>
      ${LAYERS.map((l) => `<label class="check"${l === 'runoff' ? ` title="${t('layers.runoff.tip')}"` : ''}><input type="checkbox" data-layer="${l}" checked> ${l === 'runoff' ? '<i class="swatch runoff"></i>' : ''}${t(('layers.' + l) as Parameters<typeof t>[0])}</label>`).join('')}
      <div class="trace" title="${t('hint.trace')}">
        <label class="check">${t('layers.trace')} <input id="traceFile" type="file" accept="image/*"></label>
        <input id="traceAlpha" type="range" min="0" max="1" step="0.05" value="0.6">
        <button id="traceClear" type="button">${t('btn.traceClear')}</button>
      </div>
    </details>
    </div>
    <div id="helpPanel" class="helppanel" role="dialog" aria-modal="false" aria-labelledby="helpTitle" hidden>
      <div class="hphead"><h2 id="helpTitle">${t('help.title')}</h2><button id="helpClose" type="button" class="secondary icon" title="${t('help.close')}" aria-label="${t('help.close')}">${ic('x', 16)}</button></div>
      <div class="hptabs" role="tablist" aria-label="${t('help.title')}">
        <button type="button" role="tab" id="hpt-step" aria-controls="hp-step" aria-selected="true">${t('help.tab.step')}</button>
        <button type="button" role="tab" id="hpt-faq" aria-controls="hp-faq" aria-selected="false" tabindex="-1">${t('help.tab.faq')}</button>
        <button type="button" role="tab" id="hpt-gloss" aria-controls="hp-gloss" aria-selected="false" tabindex="-1">${t('help.tab.gloss')}</button>
        <button type="button" role="tab" id="hpt-keys" aria-controls="hp-keys" aria-selected="false" tabindex="-1">${t('help.tab.keys')}</button>
      </div>
      <div class="hpbody" role="tabpanel" id="hp-step" aria-labelledby="hpt-step">
        <div class="hpcur"><span id="helpCurK" class="kicker"></span><p id="helpCurLead"></p></div>
        <p class="hplegend">${t('step.legend')}</p>
        <h3>${t('help.steps')}</h3>
        <ol class="hpsteps">${STEPS.map((st, i) => `<li><button type="button" class="hpgo" data-help-go="${st.tab}"><b>${String(i + 1).padStart(2, '0')}</b><span><strong>${t(st.label)}</strong> — ${t(st.lead)}</span><span class="hparrow" aria-hidden="true">→</span></button></li>`).join('')}</ol>
        <details class="faq hpwhat"><summary>${t('help.whatis')}</summary>${t('help.what').split('\n').map((l) => `<p>${l}</p>`).join('')}</details>
        <h3 id="helpConnect">${t('help.connect')}</h3>
        <p>${t('wb.how.lead')}</p>
        ${connectSteps()}
        <div class="row"><button type="button" class="secondary wbRetry">${ic('refresh', 14)} ${t('wb.retry')}</button></div>
      </div>
      <div class="hpbody" role="tabpanel" id="hp-faq" aria-labelledby="hpt-faq" hidden>
        ${(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11'] as const).map((k) => `<details class="faq"><summary>${t(('faq.q' + k) as K)}</summary><p>${t(('faq.a' + k) as K)}</p></details>`).join('')}
      </div>
      <div class="hpbody" role="tabpanel" id="hp-gloss" aria-labelledby="hpt-gloss" hidden>
        <dl class="gloss">${(['relay', 'wb', 'addon', 'seed', 'heightmap', 'prefab', 'splat', 'power', 'gen', 'budget', 'p2p', 'host'] as const).map((k) => `<dt>${t(('gl.' + k) as K)}</dt><dd>${t(('gl.' + k + '.d') as K)}</dd>`).join('')}</dl>
      </div>
      <div class="hpbody" role="tabpanel" id="hp-keys" aria-labelledby="hpt-keys" hidden>
        <ul class="hpkeys">${(['help.c1', 'help.c2', 'help.c3', 'help.c4', 'help.c5', 'help.c6'] as const).map((k) => `<li>${t(k)}</li>`).join('')}</ul>
        <p class="hint">${t('hint.map')}</p>
      </div>
      <div class="hpfoot"><button id="helpTour" type="button" class="secondary">${t('help.tour')}</button><button id="helpNews" type="button" class="secondary">${t('news.open')}</button><span class="grow"></span><a href="https://github.com/benjibossk/mappingenfusiontest#readme" target="_blank" rel="noopener">${t('help.docs')}</a></div>
    </div>
    <div id="newsPanel" class="helppanel newspanel" role="dialog" aria-modal="false" aria-labelledby="newsTitle" hidden>
      <div class="hphead"><h2 id="newsTitle">${t('news.title')}</h2><button id="newsClose" type="button" class="secondary icon" title="${t('news.close')}" aria-label="${t('news.close')}">${ic('x', 16)}</button></div>
      <div class="hpbody">
        ${CHANGELOG.map((c) => `<section class="newsver"><h3>v${c.version} <span class="newsdate">${c.date}</span></h3><ul>${c.items.map((i) => `<li>${getLang() === 'fr' ? i.fr : i.en}</li>`).join('')}</ul></section>`).join('')}
      </div>
      <div class="hpfoot"><a href="https://github.com/benjibossk/mappingenfusiontest/blob/main/${getLang() === 'fr' ? 'CHANGELOG.fr.md' : 'CHANGELOG.md'}" target="_blank" rel="noopener">${t('news.full')}</a><span class="grow"></span><button id="newsOk" type="button">${t('news.ok')}</button></div>
    </div>
    <div id="tour" class="tour" hidden><div class="tourring"></div><div class="tourbox" role="dialog" aria-live="polite"><span id="tourN" class="kicker"></span><p id="tourText"></p><div class="row"><button id="tourSkip" type="button" class="secondary">${t('tour.skip')}</button><button id="tourNext" type="button">${t('tour.next')}</button></div></div></div>
    <div id="busy" class="busy" hidden role="status" aria-live="polite"><div class="busybox"><span class="kicker">${t('busy.kicker')}</span><b id="busyLabel"></b><span id="busyStage" class="hint"></span><progress id="busyBar"></progress><div class="row"><b id="busyPct" class="busypct"></b><span id="busyTime" class="busytime"></span><button id="busyCancel" type="button" class="secondary" hidden>${t('busy.cancel')}</button></div></div></div>
    <div id="coach" class="coach" hidden role="dialog" aria-live="polite"><span id="coachKicker" class="kicker"></span><b id="coachTitle"></b><p id="coachText"></p><ul id="coachSteps"></ul><div class="row"><button id="coachClose" type="button" class="secondary">${t('coach.close')}</button><button id="coachTour" type="button" class="secondary">${t('coach.tour')}</button><button id="coachNext" type="button"></button></div></div>
    <div id="toast" class="toast" hidden role="status" aria-live="polite"></div>
    <div class="overlay">
      <span id="brushInfo"></span>
      <span id="mapHint" class="hint">${t('hint.map')}<button id="mapHintX" type="button" class="hintx" title="${t('hint.hide')}" aria-label="${t('hint.hide')}">${ic('x', 12)}</button></span>
    </div>
  </section>

  <aside class="side">
    <button id="sideToggle" type="button" class="secondary sidetog" aria-expanded="true" aria-controls="tabs">${ic('caret', 14)}<span>${t('side.toggle')}</span></button>
    <ol class="tabs stepper" id="tabs">
      ${STEPS.map((s, i) => `<li><button type="button" data-tab="${s.tab}"${i === 0 ? ' class="active"' : ''} title="${t(s.lead)}"><b>${i + 1}</b><span>${t(s.tab === 'camp' ? 'step.fields.short' : s.label)}</span><i class="badge"></i></button></li>`).join('')}
    </ol>
    <div class="stephead"><span id="stepKicker" class="kicker"></span><h2 id="stepTitle"></h2><button id="stepRegen" type="button" class="regen" title="${t('step.regen')}" aria-label="${t('step.regen')}">${ic('refresh', 16)}</button><p id="stepLead" class="lead"></p></div>

    <div class="tab" data-tab="island">
      <div class="row biomerow">${biomeField('pBiome')}</div>
      <div class="row">
        <button id="tGen" type="button">${t('btn.tGen')}</button>
        <button id="tReroll" type="button" class="secondary">${t('btn.tReroll')}</button>
      </div>
      <div class="row">
        <button id="tRandom" type="button" class="secondary" title="${t('wg.tip')}">${ic('dice', 16)} ${t('btn.tRandom')}</button>
      </div>
      <div class="row">
        <button id="tReal" type="button" class="secondary" title="${t('hint.tReal')}">${t('btn.tReal')}</button>
        <button id="tImport" type="button" class="secondary" title="${t('hint.tImport')}">${t('btn.tImport')}</button>
      </div>
      <div class="row">
        <select id="tRefMap" title="${t('hint.tRef')}">${REF_MAPS.map((m) => `<option value="${m}">${t(('ref.map.' + m) as Key)}</option>`).join('')}</select>
        <button id="tRef" type="button" class="secondary" title="${t('hint.tRef')}">${t('btn.tRef')}</button>
        <button id="tRefStats" type="button" class="secondary" title="${t('hint.tRefStats')}">${t('btn.tRefStats')}</button>
      </div>
      <div id="refStats" class="hint" hidden></div>
      <details class="adv"><summary>${t('ui.advanced')} ${info('info.adv')}</summary>
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
      </details>
      ${outsideHtml()}
      <div class="row">
        <button id="pSave" type="button" class="secondary">${t('btn.pSave')}</button>
        <button id="pOpen" type="button" class="secondary">${t('btn.pOpen')}</button>
        <input id="pFile" type="file" accept=".json,application/json" hidden>
      </div>
      ${hint('hint.island')}
    </div>

    <div class="tab" data-tab="brush" hidden>
      <div class="form">
        <label>${t('lbl.bRadius')} <input id="bRadius" type="number" value="200"></label>
        <label>${t('lbl.bStrength')} <input id="bStrength" type="number" value="6"></label>
      </div>
      ${hint('hint.brush')}
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
      </div>
      <div class="row">
        <label class="check"><input id="wRipa" type="checkbox"> ${t('lbl.waterRipa')}</label>
        <button id="wRipaGen" type="button" class="secondary">${t('btn.waterRipa')}</button>
      </div>
      <details class="adv"><summary>${t('ui.tests')}</summary>
        <button id="wTest" type="button" class="secondary">${t('btn.waterTest')}</button>
      </details>
      ${hint('hint.water')}
      <ul id="wList" class="roadlist"></ul>
      <details class="adv"><summary>${t('legend.waterSim')}</summary>
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
      ${hint('hint.rivers')}
      </details>
    </div>

    <div class="tab" data-tab="roads" hidden>
      <div class="form">
        <label>${t('lbl.roadType')} <select id="roadType">${Object.entries(ROAD_TYPES).map(([k, rt]) => `<option value="${k}">${rt.label}</option>`).join('')}</select></label>
      </div>
      <div class="row">
        <button id="roadNew" type="button">${t('btn.roadNew')}</button>
        <button id="roadUndo" type="button" class="secondary">${t('btn.roadUndo')}</button>
        <button id="roadClear" type="button" class="secondary">${t('btn.roadClear')}</button>
      </div>
      ${hint('hint.roads')}
      <details class="adv"><summary>${t('legend.net')}</summary>
        <div class="form">
          <label>${t('lbl.netSites')} <input id="netSites" type="number" min="2" max="40" value="8"></label>
          <label>${t('lbl.netSpacing')} <input id="netSpacing" type="number" step="50" min="100" value="600"></label>
          <label>${t('lbl.netSlope')} <input id="netSlope" type="number" step="1" min="2" value="10"></label>
          <label>${t('lbl.netMain')} <select id="netMain">${Object.entries(ROAD_TYPES).map(([k, rt]) => `<option value="${k}"${k === 'asphaltLine' ? ' selected' : ''}>${rt.label}</option>`).join('')}</select></label>
          <label>${t('lbl.netMinor')} <select id="netMinor">${Object.entries(ROAD_TYPES).map(([k, rt]) => `<option value="${k}"${k === 'asphalt' ? ' selected' : ''}>${rt.label}</option>`).join('')}</select></label>
          <label>${t('lbl.netLane')} <select id="netLane">${Object.entries(ROAD_TYPES).map(([k, rt]) => `<option value="${k}"${k === 'asphaltNarrow' ? ' selected' : ''}>${rt.label}</option>`).join('')}</select></label>
          <label class="check"><input id="netMotorway" type="checkbox"> ${t('lbl.motorway')} ${info('info.motorway')}</label>
        </div>
        ${hint('hint.net')}
        <div class="row">
          <button id="sitesPlace" type="button">${t('btn.sitesPlace')}</button>
          <button id="netGen" type="button">${t('btn.netGen')}</button>
          <button id="sitesClear" type="button" class="secondary">${t('btn.sitesClear')}</button>
          <button id="netClear" type="button" class="secondary">${t('btn.netClear')}</button>
        </div>
        ${hint('hint.roadGen')}
      </details>
      <details class="adv" id="powerBox"><summary>${t('legend.power')}</summary>
        <div class="form">
          <label>${t('lbl.powEHV')} <select id="powEHV"><option value="auto" selected>${t('opt.powAuto')}</option><option value="on">${t('opt.powOn')}</option><option value="off">${t('opt.powOff')}</option></select></label>
          <label>${t('lbl.powStyle')} <select id="powStyle"><option value="eden" selected>${t('opt.powEden')}</option><option value="ussr">${t('opt.powUSSR')}</option></select></label>
          <label>${t('lbl.powPlants')} <select id="powPlants"><option value="auto" selected>${t('opt.powAuto6')}</option><option value="0">0</option><option value="1">1</option><option value="2">2</option><option value="3">3</option></select></label>
        </div>
        <label class="check"><input id="powHV" type="checkbox" checked> <span style="display:inline-block;width:14px;height:4px;vertical-align:middle;background:#ffd24a"></span> ${t('lbl.powHV')}</label>
        <label class="check"><input id="powMV" type="checkbox" checked> <span style="display:inline-block;width:14px;height:4px;vertical-align:middle;background:#ff8a3a"></span> ${t('lbl.powMV')}</label>
        <label class="check"><input id="powLV" type="checkbox" checked> <span style="display:inline-block;width:14px;height:4px;vertical-align:middle;background:#e8e2c8"></span> ${t('lbl.powLV')}</label>
        <div class="form">
          <label>${t('lbl.powMVMax')} <input id="powMVMax" type="number" step="100" min="500" value="4000"></label>
          <label>${t('lbl.powLVMax')} <input id="powLVMax" type="number" step="100" min="200" value="900"></label>
          <label>${t('lbl.powDistrib')} ${info('info.powDistrib')} <select id="powDistrib"><option value="auto" selected>${t('opt.powDistAuto')}</option><option value="overhead">${t('opt.powDistOver')}</option><option value="underground">${t('opt.powDistUnder')}</option></select></label>
        </div>
        <div class="hint"><span style="display:inline-block;width:14px;height:4px;vertical-align:middle;background:#5ec8ff"></span> EHV · <span style="display:inline-block;width:14px;height:4px;vertical-align:middle;background:#ffd24a"></span> HV · <span style="display:inline-block;width:14px;height:4px;vertical-align:middle;background:#ff8a3a"></span> MV · <span style="display:inline-block;width:14px;height:4px;vertical-align:middle;background:#e8e2c8"></span> LV · <span style="display:inline-block;width:14px;height:4px;vertical-align:middle;background:#c050ff"></span> ${t('lbl.powStations')}</div>
        ${hint('hint.power')}
        <div class="row">
          <button id="powerGen" type="button">${t('btn.powerGen')}</button>
          <button id="powerClear" type="button" class="secondary">${t('btn.powerClear')}</button>
        </div>
        <span id="powerInfo" class="hint"></span>
      </details>
      <details class="adv"><summary>${t('ui.advanced')} ${info('info.adv')}</summary>
        <div class="form">
          <label>${t('lbl.roadSnap')} <input id="roadSnap" type="number" value="30"></label>
          <label>${t('lbl.roadWidth')} <input id="roadWidth" type="number" step="0.5" min="0" placeholder="${t('ph.auto')}"></label>
        </div>
        <label class="check"><input id="roadLeft" type="checkbox"> ${t('lbl.roadLeft')}</label>
        <label class="check"><input id="roadFlatten" type="checkbox"> ${t('lbl.roadFlatten')}</label>
        <label class="check"><input id="roadFurn" type="checkbox" checked> ${t('lbl.roadFurn')}</label>
        <fieldset class="test">
          <legend>${t('legend.furn')}</legend>
          <label class="check"><input id="furnShow" type="checkbox" checked> ${t('lbl.furnShow')}</label>
          <div class="row">
            <label>${t('lbl.furnDrop')} <input id="furnDrop" type="number" step="0.1" min="0.3" value="1.8"></label>
            <label>${t('lbl.furnPost')} <input id="furnPost" type="number" step="0.1" min="0.1" value="0.9"></label>
          </div>
          <span id="furnInfo" class="hint"></span>
        </fieldset>
      </details>
      <details class="adv"><summary>${t('ui.tests')}</summary>
        ${hint('hint.roadTest')}
        <div class="row">
          <button id="roadTestDraw" type="button" class="secondary">${t('btn.roadTestDraw')}</button>
          <button id="roadTestAll" type="button" class="secondary">${t('btn.roadTestAll')}</button>
        </div>
      </details>
      <button id="roadSend" type="button">${t('btn.roadSend')}</button>
      <span id="roadInfo" class="hint"></span>
      ${hint('hint.roadEdit')}
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
        <label class="check"><input id="setV2" type="checkbox" checked> ${t('lbl.setV2')} ${info('info.setV2')}</label>
        <div class="form" id="setV2Box">
          <label>${t('lbl.setVariant')} ${info('info.setVariant')} <select id="setVariant"><option value="auto">${t('opt.var.auto')}</option><option value="village">${t('opt.var.village')}</option><option value="town">${t('opt.var.town')}</option></select></label>
          <label>${t('lbl.setMaxStreets')} ${info('info.setMaxStreets')} <input id="setMaxStreets" type="number" min="0" max="10" step="1" value="" placeholder="${t('opt.var.auto')}"></label>
          <label class="check"><input id="setStreets" type="checkbox" checked> ${t('lbl.setStreets')} ${info('info.setStreets')}</label>
          <label class="check"><input id="setFarms" type="checkbox" checked> ${t('lbl.setFarms')} ${info('info.setFarms')}</label>
          <label class="check"><input id="setChurch" type="checkbox" checked> ${t('lbl.setChurch')}</label>
          <label class="check"><input id="setPort" type="checkbox" checked> ${t('lbl.setPort')} ${info('info.setPort')}</label>
          <label class="check"><input id="setCompositions" type="checkbox"> ${t('lbl.setCompositions')} ${info('info.setCompositions')}</label>
        </div>
        <button id="parcelLib" type="button">${t('pc.open')}</button>
        ${hint('hint.set')}
        <div class="row">
          <button id="setGen" type="button">${t('btn.setGen')}</button>
          <button id="setClear" type="button" class="secondary">${t('btn.setClear')}</button>
          <button id="setSend" type="button">${t('btn.setSend')}</button>
        </div>
        <span id="setInfo" class="hint"></span>
      </fieldset>
      <details class="adv" id="indBox"><summary>${t('legend.ind')} ${info('info.ind')}</summary>
        <div class="form">
          <label>${t('lbl.indType')} <select id="indType">${INDUSTRIAL_TYPES.map((k) => `<option value="${k}">${t(('opt.ind.' + k) as K)}</option>`).join('')}</select></label>
          <label>${t('lbl.zoneSeed')} <input id="indSeed" type="number" step="1" value="1"></label>
        </div>
        ${hint('hint.ind')}
        <div class="row">
          <button id="indSuggest" type="button">${t('btn.zoneSuggest')}</button>
          <button id="indClear" type="button" class="secondary">${t('btn.indClear')}</button>
        </div>
        <span id="indInfo" class="hint"></span>
      </details>
      <details class="adv" id="milBox"><summary>${t('legend.mil')} ${info('info.mil')}</summary>
        <div class="form">
          <label>${t('lbl.milWhat')} <select id="milWhat"><option value="main">${t('opt.mil.main')}</option><option value="outpost">${t('opt.mil.outpost')}</option><option value="checkpoint">${t('opt.mil.checkpoint')}</option><option value="air-small">${t('opt.air.small')}</option><option value="air-medium">${t('opt.air.medium')}</option><option value="air-large">${t('opt.air.large')}</option></select></label>
          <label>${t('lbl.zoneSeed')} <input id="milSeed" type="number" step="1" value="1"></label>
        </div>
        ${hint('hint.mil')}
        <div class="row">
          <button id="milSuggest" type="button">${t('btn.zoneSuggest')}</button>
          <button id="milClear" type="button" class="secondary">${t('btn.milClear')}</button>
        </div>
        <span id="milInfo" class="hint"></span>
      </details>
      <div class="row"><button id="zoneSend" type="button" class="secondary">${t('btn.zoneSend')}</button></div>
    </div>
    <div class="tab" data-tab="camp" hidden>
      <div class="form">
        <label>${t('lbl.zoneType')} <select id="zoneType">${ZONE_FILL_TYPES.map((k) => `<option value="${k}">${t(('zt.' + k) as K)}</option>`).join('')}</select></label>
        <label id="zoneDensRow" hidden>${t('lbl.zoneDens')} <select id="zoneDens"><option value="0.6">${t('dens.sparse')}</option><option value="1">${t('dens.normal')}</option><option value="1.5" selected>${t('dens.dense')}</option></select></label>
        <label id="zoneLeafRow" hidden>${t('lbl.zoneLeaf')} <select id="zoneLeaf"><option value="auto">${t('leaf.auto')}</option><option value="mixed">${t('leaf.mixed')}</option><option value="needle">${t('leaf.needle')}</option><option value="broad">${t('leaf.broad')}</option></select></label>
        <label id="zoneFactionRow" hidden>${t('lbl.zoneFaction')} <select id="zoneFaction"><option value="US">US</option><option value="USSR">USSR</option><option value="FIA">FIA</option></select></label>
        <label id="zoneHaRow" hidden>${t('lbl.zoneHa')} <input id="zoneHa" type="number" min="2" max="200" step="1" value="8"></label>
        <label class="wide">${t('lbl.zone')} <input id="zone" value=""></label>
      </div>
      ${hint('hint.zoneType')}
      ${hint('hint.zone')}
      <div class="row">
        <button id="generate" type="button">${t('btn.generate')}</button>
        <button id="clearZone" type="button" class="secondary">${t('btn.clearZone')}</button>
      </div>
      <details class="adv"><summary>${t('ui.advanced')} ${info('info.adv')}</summary>
      <div class="form">
        <label>${t('lbl.fieldSize')} <input id="fieldSize" type="number" value="110"></label>
        <label>${t('lbl.fieldAspect')} <input id="fieldAspect" type="number" step="0.1" value="1.5"></label>
        <label>${t('lbl.jitter')} <input id="jitter" type="number" step="0.1" value="0.6"></label>
        <label>${t('lbl.angle')} <input id="angle" type="number" value="15"></label>
        <label>${t('lbl.hedgeChance')} <input id="hedgeChance" type="number" step="0.1" value="0.5"></label>
        <label>${t('lbl.minHedge')} <input id="minHedge" type="number" value="15"></label>
        <label>${t('lbl.seed')} <input id="seed" type="number" value="1"></label>
        <label>${t('lbl.prefix')} <input id="prefix" value="CAMP"></label>
      </div>
      </details>
      <div class="row">
        <button id="forestGen" type="button">${t('btn.forestGen')}</button>
        <button id="forestSend" type="button" class="secondary">${t('btn.forestSend')}</button>
        <button id="areasClear" type="button" class="secondary">${t('btn.areasClear')}</button>
      </div>
      <label class="inline" title="${t('tip.forestEdge')}"><input id="forestEdge" type="checkbox" checked> ${t('lbl.forestEdge')}</label>
      ${hint('hint.areas')}
      <details class="adv" id="satBox"><summary>${t('legend.sat')} ${info('info.sat')}</summary>
        <p id="satNone" class="hint">${t('sat.none')}</p>
        <div id="satBody">
          <label>${t('lbl.satSmooth')} ${info('info.satSmooth')} <input id="satSmooth" type="range" min="0" max="4" step="1" value="1"></label>
          <div class="row"><button id="satAnalyse" type="button">${t('btn.satAnalyse')}</button></div>
          <ul id="satSwatches" class="swatches"></ul>
          <label class="check"><input id="satPreview" type="checkbox" checked> ${t('lbl.satPreview')}</label>
          <div class="row">
            <button id="satSend" type="button">${t('btn.satSend')}</button>
            <button id="satPng" type="button" class="secondary">${t('btn.satPng')}</button>
          </div>
          <span id="satInfo" class="hint"></span>
        </div>
      </details>
    </div>

    <div class="tab" data-tab="wb" hidden>
      <div class="form">
        <label>${t('lbl.tAddon')} <input id="tAddon" value="Mapgenerator"></label>
        <label>${t('lbl.tWorld')} <input id="tWorld" value="Worlds/MG_Test"></label>
        <p id="ffBiomeInfo" class="hint"></p>
      </div>
      <fieldset class="test">
        <legend>${t('legend.check')}</legend>
        ${hint('hint.check')}
        <label>${t('lbl.platform')} <select id="checkPlatform">${PLATFORMS.map((p) => `<option value="${p}"${p === 'xss' ? ' selected' : ''}>${t(('platform.' + p) as Parameters<typeof t>[0])}</option>`).join('')}</select></label>
        <button id="checkRun" type="button" class="secondary">${t('btn.check')}</button>
        <p id="checkDensity" class="hint"></p>
        <button id="checkFixAll" type="button" class="secondary" hidden></button>
        <ul id="checkList" class="issues"></ul>
      </fieldset>
      <div id="wbGuide" class="wbguide" hidden>
        <strong>${t('wb.guide.title')}</strong>
        ${connectSteps()}
        <div class="row"><button type="button" class="wbRetry">${ic('refresh', 14)} ${t('wb.retry')}</button><button id="wbDownload" type="button" class="secondary" title="${t('wb.download.tip')}">${ic('folder', 14)} ${t('wb.download')}</button></div>
      </div>
      <div id="modsBox"></div><pre id="modDeps" class="hint" hidden></pre>
      <button id="sendAll" type="button" class="big">${t('btn.sendAll')}</button>
      <details class="adv"><summary>${t('ui.manual')}</summary>
        <ol class="steps">
          <li><button id="tSurf" type="button" class="secondary">${t('btn.tSurf')}</button><span class="hint">${t('wb.closed')}</span></li>
          <li><button id="tHeight" type="button" class="secondary">${t('btn.tHeight')}</button><span class="hint">${t('wb.open')}</span></li>
          <li><button id="tMasks" type="button" class="secondary">${t('btn.tMasks')}</button><span class="hint">${t('wb.thenImport')}</span></li>
        </ol>
        ${hint('hint.wbImport')}
        <button id="loadTerrain" type="button" class="secondary">${t('btn.loadTerrain')}</button>
        <button id="send" type="button" class="secondary">${t('btn.send')}</button>
        <details>
          <summary>${t('sum.project')} <code>mapgen.json</code></summary>
          <textarea id="project" spellcheck="false"></textarea>
        </details>
      </details>
    </div>
    <div id="collabView" class="collabview" hidden>
      <div class="cvhead"><h2>${ic('users')} ${t('cv.title')}</h2><button id="cvClose" type="button" class="secondary icon" title="${t('cv.close.tip')}" aria-label="${t('cv.close.tip')}">${ic('x', 16)}</button></div>
      <p class="cvconn"><span id="cvConn" class="hint"></span> <button id="cvJoin" type="button" class="secondary">${t('cv.connect')}</button></p>
      <div id="cvOnline" class="cvonline" hidden><span class="wglabel" id="cvOnN"></span><ul id="cvPeers" class="cvpeers"></ul></div>
      <details class="cvsec" open><summary>${t('cv.comments')} <i id="cvNCom" class="badge"></i></summary>
        <button id="cvAdd" type="button">${ic('pin', 16)} ${t('cv.add')}</button>
        <div id="cvDraft" class="cvdraft" hidden>
          ${hint('cv.draft.hint')}
          <textarea id="cvText" rows="3" placeholder="${t('cv.text')}"></textarea>
          <button id="cvPost" type="button">${t('cv.post')}</button> <button id="cvCancel" type="button" class="secondary">${t('cv.cancel')}</button>
        </div>
        <label class="check"><input id="cvShowRes" type="checkbox"> ${t('cv.showResolved')}</label>
        <ul id="cvComments" class="cvlist"></ul>
      </details>
      <details class="cvsec" open><summary>${t('cv.history')}</summary>
        <ul id="cvHist" class="cvlist"></ul>
      </details>
      <details class="cvsec" open><summary>${t('cv.sat')}</summary>
        <canvas id="cvMini" class="cvmini" width="260" height="260" title="${t('cv.mini.tip')}"></canvas>
        <p id="cvSatInfo" class="hint"></p>
        <label class="check"><input id="satShow" type="checkbox" checked> ${t('cv.sat.show')}</label>
        <label>${t('cv.sat.alpha')} <input id="cvAlpha" type="range" min="0" max="1" step="0.05" value="0.6"></label>
      </details>
      <div class="cvfoot"><button id="cvLeave" type="button" class="danger" hidden>${t('collab.leave')}</button></div>
    </div>
    <div class="stepnav">
      <button id="stepPrev" type="button" class="secondary">← ${t('ui.prev')}</button>
      <button id="stepNext" type="button">${t('ui.next')} →</button>
    </div>

    <pre id="log" class="log"></pre>
  </aside>
  <footer class="statusbar"><span id="cursor"></span><span class="grow"></span><span>${t('foot.keys')}</span></footer>
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
let v3d: Awaited<ReturnType<View3DMod['open3d']>> | null = null
let draping = false
let drapeTimer = 0
// view: world X/Z at the canvas centre + metres per pixel
const view = { x: 2048, z: 2048, mpp: 4096 / 800 }

const toScreen = (x: number, z: number): [number, number] => worldToMap({ ...view, width: map.width, height: map.height }, x, z)
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
  labelBoxes.length = 0
  ctx.fillStyle = '#0f1012'
  ctx.fillRect(0, 0, map.width, map.height)
  if (terrain && terrainImg) {
    const [x0, y0] = toScreen(terrain.minX, terrain.minZ + (terrain.rows - 1) * terrain.step)
    const [x1, y1] = toScreen(terrain.minX + (terrain.cols - 1) * terrain.step, terrain.minZ)
    ctx.imageSmoothingEnabled = view.mpp > terrain.step
    ctx.drawImage(terrainImg, x0, y0, x1 - x0, y1 - y0)
  }
  drawTrace()
  refreshSteps()

  if (layer('countryside')) drawCountryside()
  if (result && layer('fields')) {
    // crop mosaic (fieldlayout.ts): recoloured when the plots changed (Zone tool, cut by a zone)
    if (result.crops?.length !== result.fields.length) result.crops = colourCrops(result.fields, { seed: num('seed') || 1 })
    const crops = result.crops
    result.fields.forEach((f, i) => {
      path(f, true)
      ctx.fillStyle = CROP_COLOURS[crops[i] as Crop] ?? '#c8b866'
      ctx.globalAlpha = 0.55
      ctx.fill()
      ctx.globalAlpha = 1
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
  if (layer('water')) { drawWater(); drawRiparian() }
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
    if (!draping) ring.forEach(([x, zz]) => {
      const [sx, sy] = toScreen(x, zz)
      ctx.fillRect(sx - 2, sy - 2, 4, 4)
    })
    const mid = ring[ring.length >> 1]
    if (mid && view.mpp < 2.5 && layer('names')) { // road names only when zoomed in: at island scale they pile up
      const [sx, sy] = toScreen(mid[0], mid[1])
      ctx.font = '11px sans-serif'
      if (!placeLabel(nice(r.id, r.type), sx + 6, sy - 6)) continue
      ctx.lineWidth = 3
      ctx.strokeStyle = '#000a'
      ctx.strokeText(nice(r.id, r.type), sx + 6, sy - 6)
      ctx.fillText(nice(r.id, r.type), sx + 6, sy - 6)
    }
  }

  if (furn && layer('furniture') && $<HTMLInputElement>('furnShow').checked && tool() === 'road') drawFurniture(furn)
  if (layer('power')) drawPower()
  if (layer('buildings')) drawSettlements()
  if (layer('existing') && view.mpp < 4) drawFences()
  if (layer('zones')) drawZones()
  drawSatPreview()
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
  if (layer('bridges')) drawWorldDecks()
  if (layer('density') && density) drawDensityHeat(ctx, density, PLATFORM_BUDGETS[budgetPlatform()].perKm2, toScreen)
  if (layer('issues')) drawIssues()
  if (!draping) drawComments()
  if (collab && !draping) drawPeers()
  drawWbCamera()
  drawLifeRoute(ctx, toScreen)
  drawBrush()
  renderMini()
  drapeLater()
}

// --- Workbench camera: live marker + view cone (bridge /camera -> MG_GetCamera), on by default, toggle next to the status chip
let wbCam: WbCamera | null = null
let camTimer = 0
const camBtn = document.createElement('button')
const camInfo = document.createElement('span')
camBtn.type = 'button'
camInfo.className = 'cam-readout'
camInfo.style.marginLeft = '6px'
camInfo.hidden = true
function camLabel() { camBtn.textContent = (camTimer ? '◉ ' : '○ ') + t('cam.toggle'); camBtn.title = t('cam.tip') }
function stopCam() {
  if (camTimer) clearInterval(camTimer)
  camTimer = 0
  wbCam = null
  camInfo.hidden = true
  camLabel()
  draw()
}
async function pollCam() {
  const c = await getCamera()
  if (!camTimer) return
  if (!c.ok) { // bridge / Workbench off: hide, keep polling so it comes back by itself
    if (wbCam || !camInfo.hidden) { wbCam = null; camInfo.hidden = true; draw() }
    return
  }
  wbCam = c
  camInfo.hidden = false
  camInfo.textContent = t('cam.readout', { x: Math.round(c.x), z: Math.round(c.z), yaw: Math.round(c.yaw) })
  draw()
}
function startCam() {
  camTimer = window.setInterval(() => void pollCam(), 1000)
  camLabel()
  void pollCam()
}
camBtn.addEventListener('click', () => {
  if (camTimer) return stopCam()
  startCam()
})
startCam() // on by default (Benji, 2026-11-19); the button turns it off
statusEl.after(camBtn, camInfo)

function drawWbCamera() {
  if (!wbCam) return
  const [sx, sy] = toScreen(wbCam.x, wbCam.z)
  const a = (wbCam.yaw * Math.PI) / 180 // 0 = north (screen up), clockwise
  const half = (35 * Math.PI) / 180
  const len = 60
  const dir = (r: number): [number, number] => [sx + Math.sin(r) * len, sy - Math.cos(r) * len]
  ctx.save()
  ctx.beginPath()
  ctx.moveTo(sx, sy)
  ctx.lineTo(...dir(a - half))
  ctx.arc(sx, sy, len, a - half - Math.PI / 2, a + half - Math.PI / 2)
  ctx.closePath()
  ctx.fillStyle = 'rgba(255,80,200,0.25)'
  ctx.strokeStyle = 'rgba(255,80,200,0.9)'
  ctx.lineWidth = 1.5
  ctx.fill()
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(sx, sy, 5, 0, Math.PI * 2)
  ctx.fillStyle = '#ff50c8'
  ctx.fill()
  ctx.strokeStyle = '#fff'
  ctx.stroke()
  // what the camera looks at (view centre on the ground): the camera itself often hangs ~250 m before it
  const hit = terrain && camLookAt(wbCam, (x, z) => {
    const c = Math.round((x - terrain!.minX) / terrain!.step), r = Math.round((z - terrain!.minZ) / terrain!.step)
    if (c < 0 || r < 0 || c >= terrain!.cols || r >= terrain!.rows) return undefined
    return Math.max(terrain!.heights[r * terrain!.cols + c], terrain!.ocean)
  })
  if (hit) {
    const [hx, hy] = toScreen(hit[0], hit[1])
    ctx.setLineDash([4, 3])
    ctx.beginPath()
    ctx.moveTo(sx, sy)
    ctx.lineTo(hx, hy)
    ctx.strokeStyle = 'rgba(255,80,200,0.9)'
    ctx.stroke()
    ctx.setLineDash([])
    ctx.beginPath()
    ctx.moveTo(hx - 7, hy); ctx.lineTo(hx + 7, hy); ctx.moveTo(hx, hy - 7); ctx.lineTo(hx, hy + 7)
    ctx.lineWidth = 2
    ctx.stroke()
  }
  ctx.restore()
}

function drawBrush() {
  if (!cursorWorld || tool() === 'zone' || tool() === 'road' || tool() === 'comment') return
  const [sx, sy] = toScreen(...cursorWorld)
  ctx.beginPath()
  ctx.arc(sx, sy, num('bRadius') / view.mpp, 0, Math.PI * 2)
  ctx.strokeStyle = 'rgba(255,255,255,0.8)'
  ctx.lineWidth = 1.5
  ctx.stroke()
}

// --- Zone tool: one drawn polygon, filled with fields / forest / habitation / industry (zonefill.ts).
// Nothing leaves the polygon; priority water > roads > habitation > industrial > fields > forest
type Poly = NonNullable<ReturnType<typeof flatToPoly>>
/** everything that outranks `type`, as obstacles to cut it by */
function zoneObstacles(type: ZoneFillType): Poly[] {
  const P = ZONE_PRIORITY[type], ob: Poly[] = []
  for (const w of waters) {
    if (WATER_TYPES[w.type].closed) { const p = flatToPoly(w.pts); if (p) ob.push(p) } else ob.push(...roadObstacles([{ pts: w.pts, half: w.width / 2 }], 3))
  }
  if (type === 'industrial' || type === 'habitation' || type === 'scattered' || type === 'town') return ob // they bring / follow their own streets
  const all = [...roads, ...existingRoads(), ...setLanes, ...zones.flatMap((z) => z.roads)]
  ob.push(...roadObstacles(all.map((r) => ({ pts: r.pts, half: roadHalf(r) })), 3))
  if (P > ZONE_PRIORITY.habitation) for (const b of settled) ob.push(pointObstacle(b.x, b.z, 14))
  if (P > ZONE_PRIORITY.industrial) for (const z of zones) for (const bx of z.boxes) { const p = flatToPoly(bx.corners); if (p) ob.push(p) }
  if (P > ZONE_PRIORITY.fields) for (const f of result?.fields ?? []) { const p = flatToPoly(f.slice(0, -1).flat()); if (p) ob.push(p) }
  return ob
}
/** the new zone wins over lower-priority content already there: fields / hedges / forests cut by it */
function cutLower(type: ZoneFillType, zone: number[], rings: number[][] = [zone]) {
  const P = ZONE_PRIORITY[type], zps = rings.map(flatToPoly).filter((p): p is Poly => !!p)
  if (!zps.length) return
  if (P < ZONE_PRIORITY.fields && result) {
    result.fields = clipPlots(result.fields, { obstacles: zps, ok: () => true, minArea: 1500, okShare: 0 })
    result.crops = undefined // recoloured at the next draw
    const keep = result.hedges.map((h) => { const m = h[0], n = h[h.length - 1]; return !rings.some((rg) => pointInPoly(rg, (m[0] + n[0]) / 2, (m[1] + n[1]) / 2)) })
    result.hedges = result.hedges.filter((_, i) => keep[i])
    result.shapes = result.shapes.filter((_, i) => keep[i])
  }
  if (P < ZONE_PRIORITY.forest) areas = areas.flatMap((a) => {
    if (a.kind !== 'forest') return [a]
    const parts = cutRing(a.pts, zps)
    return parts.map((pts, k) => ({ ...a, id: k ? `${a.id}_${k}` : a.id, pts }))
  })
}
const FIELD_MAX_SLOPE = 0.15 // 15 %: steeper ground is left to pasture / forest
/** gentle and low enough for a ploughed field: slope under 15 %, below 60 % of the highest ground */
function farmable(tr: Heightmap, x: number, z: number) {
  const d = tr.step * 2
  const gx = (heightAt(tr, x + d, z) - heightAt(tr, x - d, z)) / (2 * d), gz = (heightAt(tr, x, z + d) - heightAt(tr, x, z - d)) / (2 * d)
  topCache ??= { h: tr.heights, top: tr.heights.reduce((a, b) => Math.max(a, b), 0) }
  if (topCache.h !== tr.heights) topCache = { h: tr.heights, top: tr.heights.reduce((a, b) => Math.max(a, b), 0) }
  return Math.hypot(gx, gz) <= FIELD_MAX_SLOPE && heightAt(tr, x, z) - tr.ocean <= (topCache.top - tr.ocean) * 0.6
}
let topCache: { h: ArrayLike<number>; top: number } | null = null
let zoneRuns = 0 // per-session counter: unique ids for each filled zone
function generate() {
  const zone = zonePoints()
  if (zone.length < 6) {
    logEl.textContent = t('zone.min')
    return
  }
  const type = $<HTMLSelectElement>('zoneType').value as ZoneFillType
  const n = ++zoneRuns
  if (type === 'fields') return zoneFields(zone, n)
  if (type === 'forest') return zoneForest(zone, n)
  if (type === 'production') return zoneProduction(zone, n)
  if (!island) return void (logEl.textContent = t('log.genFirst'))
  if (type === 'industrial') return zoneIndustrial(zone)
  if (type === 'scattered') return zoneScattered(zone, n)
  if (type === 'town') return zoneTown(zone, n)
  if ((SITE_TYPES as string[]).includes(type)) return zoneSite(type as SiteType, zone)
  zoneHabitation(zone, n)
}
function finishZone(type: ZoneFillType, zone: number[], msg: string, rings?: number[][]) {
  cutLower(type, zone, rings)
  autosave()
  if (result) projectEl.value = JSON.stringify({ version: 0, shapes: result.shapes } satisfies Project, null, 1)
  logEl.textContent = msg + (terrain ? '' : t('log.noTerrain'))
  recompose(true); setInfo(); zoneInfo(); refreshSteps(); draw()
}
function zoneFields(zone: number[], n: number) {
  const tr = terrain
  const ok = (x: number, z: number) => (!tr || (isLand(tr, x, z) && farmable(tr, x, z))) && pointInPoly(zone, x, z) // fields outrank forests: those in the zone are cut afterwards
  const prefix = `${$<HTMLInputElement>('prefix').value || 'CAMP'}_Z${n}_`
  const laid = (result?.fields ?? []).map((f) => flatToPoly(f.slice(0, -1).flat())).filter((p): p is Poly => !!p)
  const landOk = (x: number, z: number) => !tr || isLand(tr, x, z)
  // same pipeline as the random world's countryside (zonefill.ts fillFieldZone)
  const { fields: kept, hedges, groves, tracks } = fillFieldZone({ zone, seed: num('seed') + n, prefix, fieldSize: num('fieldSize'), aspect: num('fieldAspect') || 1.5, jitter: num('jitter'), angle: num('angle'), hedgeChance: num('hedgeChance'), minHedge: num('minHedge'), ok, landOk, obstacles: zoneObstacles('fields'), laid, roads: roads.map((rd) => rd.pts), hedgeSeed: (num('seed') * 31 + n) || 1 })
  result ??= { fields: [], hedges: [], shapes: [] }
  result.fields.push(...kept)
  result.crops = undefined // recoloured at the next draw (neighbours never share a crop)
  for (const h of hedges) {
    result.hedges.push(h)
    result.shapes.push({ id: `${prefix}Hedge_${result.shapes.length}`, kind: 'polyline', closed: false, points: h.flatMap((q) => [Math.round(q[0] * 100) / 100, Math.round(q[1] * 100) / 100]), generator: GENERATORS.hedgeCorylus })
  }
  // groves at some plot corners + dirt tracks from the plots to the nearest road (Tanin AgriFieldGenerator)
  groves.forEach((pts, j) => areas.push({ id: `FOREST_GROVE_Z${n}_${j + 1}`, kind: 'forest', leaf: 'broad', pts }))
  tracks.forEach((pts, j) => roads.push({ id: `ROAD_FIELD_Z${n}_${j + 1}`, type: 'dirt', pts }))
  if (tracks.length) roadInfo()
  finishZone('fields', zone, t('log.fieldsDone', { fields: kept.length, hedges: hedges.length }))
}
/** essence chosen for the zone tool's forest (Mixte / Conifères / Feuillus) */
function zoneLeaf(zone?: number[]): 'broad' | 'needle' | 'mixed' {
  const v = $<HTMLSelectElement>('zoneLeaf').value
  const choice: ZoneLeafChoice = v === 'broad' || v === 'needle' || v === 'mixed' ? v : 'auto'
  let mean: number | undefined
  if (choice === 'auto' && island && zone && zone.length >= 6) { // mean relative altitude of the zone (vertices + centroid)
    let top = 1
    for (const hh of island.heights) if (hh > top) top = hh
    let s = 0, n = 0, cx = 0, cz = 0
    for (let i = 0; i + 1 < zone.length; i += 2) { s += groundAt(zone[i], zone[i + 1]); n++; cx += zone[i]; cz += zone[i + 1] }
    s += groundAt(cx / n, cz / n); mean = s / (n + 1) / top
  }
  return zoneForestLeaf(choice, mean, currentBiome)
}
function zoneForest(zone: number[], n: number) {
  const parts = cutRing(zone, zoneObstacles('forest')), leaf = zoneLeaf(zone)
  // overlapping woods: same species merged, else the new piece is cut by the older wood (forestMerge.ts)
  const forests = mergeForestPatches([...areas.filter((a) => a.kind === 'forest'), ...parts.map((pts, k) => ({ id: `FOREST_ZONE_${n}_${k + 1}`, kind: 'forest' as const, leaf, pts }))])
  const seen = new Set<string>()
  areas = [...areas.filter((a) => a.kind !== 'forest'), ...forests.map((a) => { let id = a.id; for (let k = 2; seen.has(id); k++) id = `${a.id}_${k}`; seen.add(id); return { ...a, id } })]
  finishZone('forest', zone, parts.length ? t('log.forestGen', { n: parts.length }) + ' · ' + t(('leaf.' + leaf) as K) + ' (' + (forestGenOf({ id: '', kind: 'forest', leaf, pts: [] }).split('/').pop() ?? '').replace('.et', '') + ')' : t('err.forestGenNone'))
}
/** production forest: straight dirt tracks (fishbone), compartments with a stage each, felled logs along the tracks.
 *  It replaces the woods already inside the zone; clear-cuts keep a stump-free open area (no forest shape). */
function zoneProduction(zone: number[], n: number) {
  const pf = makeProdForest(zone, { seed: num('seed') * 7 + n, roads: [...roads, ...existingRoads()].map((r) => r.pts), ground: terrain ? groundAt : undefined })
  pf.tracks.forEach((pts, j) => roads.push({ id: `ROAD_PROD_Z${n}_${j + 1}`, type: 'dirt', pts }))
  if (pf.tracks.length) roadInfo()
  const zp = flatToPoly(zone)
  if (zp) areas = areas.flatMap((a) => a.kind !== 'forest' || a.id.startsWith(`FOREST_PROD_Z${n}_`) ? [a] : cutRing(a.pts, [zp]).map((pts, k) => ({ ...a, id: k ? `${a.id}_${k}` : a.id, pts })))
  const ob = zoneObstacles('production'), leaf = zoneLeaf(zone)
  let made = 0, first: MapArea | null = null
  pf.compartments.forEach((c, j) => {
    if (c.stage === 'clearcut') return
    for (const [k, pts] of cutRing(c.pts, ob).entries()) {
      const a: MapArea = { id: `FOREST_PROD_Z${n}_${j + 1}${k ? '_' + k : ''}`, kind: 'forest', leaf, tall: c.stage === 'juvenile' ? 'low' : c.stage === 'thinned' ? 'mid' : 'high', stage: c.stage, pts }
      areas.push(a); made++; first ??= a
    }
  })
  if (first) (first as MapArea).logs = pf.logs
  const cc = pf.compartments.filter((c) => c.stage === 'clearcut').length
  finishZone('production', zone, made ? t('log.prodForest', { n: pf.compartments.length, t: pf.tracks.length, c: cc, l: pf.logs.length }) : t('err.forestGenNone'))
}
/** felled-log piles of the production forests, as vanilla WoodLog props (3 logs side by side) */
function prodLogEntities(): ProjectEntity[] {
  const out: ProjectEntity[] = []
  for (const a of areas) (a.logs ?? []).forEach((l, i) => {
    const r = (l.yaw * Math.PI) / 180, px = Math.cos(r), pz = -Math.sin(r)
    for (let k = -1; k <= 1; k++) out.push({ id: `${a.id}_LOG_${i + 1}_${k + 2}`, prefab: k ? PROPS.woodLogA : PROPS.woodLogB, x: Math.round((l.x + px * k * 0.9) * 100) / 100, z: Math.round((l.z + pz * k * 0.9) * 100) / 100, yaw: l.yaw })
  })
  return out
}
function zoneIndustrial(zone: number[]) {
  if (!island) return
  const houses = settled.map((b) => pointObstacle(b.x, b.z, 10))
  // the zone minus water and houses (habitation outranks industry): the largest piece is laid out
  const piece = cutRing(zone, [...zoneObstacles('industrial'), ...houses]).sort((a, b) => b.length - a.length)[0]
  if (!piece) return void (logEl.textContent = t('err.zoneEmpty'))
  const sl = slopeShare(groundAt, piece, 0.12) // moderate slopes are levelled (flatten pad); only a mostly steep zone is refused
  if (sl > 0.5) return void (logEl.textContent = t('err.zoneSteep', { p: Math.round(sl * 100), max: 12 }))
  const slw = slopeShare(groundAt, piece, 0.06) // over 6 %: levelled, the user is warned
  let cx = 0, cz = 0
  for (let i = 0; i < piece.length; i += 2) { cx += piece[i]; cz += piece[i + 1] }
  cx /= piece.length / 2; cz /= piece.length / 2
  const id = nextZoneId(zones, 'industrial')
  const zn = makeIndustrial(island.heights, island.grid, [...roads, ...existingRoads()], { id, type: $<HTMLSelectElement>('indType').value as IndustrialType, x: cx, z: cz, seed: num('indSeed') + zones.length, polygon: piece })
  if (!zn.entities.length && !zn.shapes.length) return void (logEl.textContent = t('err.zoneEmpty'))
  zones.push(zn)
  finishZone('industrial', zone, t('log.zoneMade', { name: t('zone.name.industrial', { n: id.replace(/\D+/g, '') }), b: zn.entities.length }) + (slw > 0.2 ? ' · ' + t('warn.zoneSlope', { p: Math.round(slw * 100) }) : ''))
}
function zoneHabitation(zone: number[], n: number) {
  if (!island) return
  let cx = 0, cz = 0, area = 0
  for (let i = 0; i < zone.length; i += 2) { cx += zone[i]; cz += zone[i + 1] }
  cx /= zone.length / 2; cz /= zone.length / 2
  for (let i = 0, j = zone.length - 2; i < zone.length; j = i, i += 2) area += (zone[j] - zone[i]) * (zone[j + 1] + zone[i + 1])
  area = Math.abs(area) / 2
  let reach = 0
  for (let i = 0; i < zone.length; i += 2) reach = Math.max(reach, Math.hypot(zone[i] - cx, zone[i + 1] - cz))
  const sl = slopeShare(groundAt, zone, 0.2)
  if (sl > 0.6) return void (logEl.textContent = t('err.zoneSteep', { p: Math.round(sl * 100), max: 20 }))
  let sid = `Z${n}`
  while (settled.some((b) => b.site === sid)) sid += 'b'
  const site: Site = { id: sid, x: cx, z: cz, kind: area > 250000 ? 'town' : area > 40000 ? 'village' : 'hamlet' }
  const blocked = [...existing.objects.filter((o) => !/Prefabs\/Terrain\//.test(o.prefab)).map((o) => o.box), ...zoneBlocked(zones)]
  const allRoads = [...roads, ...existingRoads(), ...setLanes, ...zones.flatMap((z) => z.roads)]
  const before = settled.length
  const res = settleVillages([site], allRoads, waters, island.heights, island.grid, { seed: num('setSeed') + n, density: Number($<HTMLSelectElement>('zoneDens').value) || 1, variant: 'auto', maxSlope: 0.2, polygon: zone, reach, blocked, biome: currentBiome }, settled)
  settled = res.placed
  setLanes = [...setLanes, ...res.lanes]
  setSquares = [...setSquares, ...res.squares]
  setGardens = [...setGardens, ...res.gardens]
  setParcels = [...setParcels, ...(res.parcels ?? [])]
  const made = settled.length - before
  finishZone('habitation', zone, made ? t('log.zoneHouses', { n: made, s: res.lanes.length }) : t('err.zoneNoHouse'))
}
/** structured sites (sitezones.ts): rows / grids of props, fence on the border, decals; one ZoneItem of kind 'site' */
function buildSite(type: SiteType, zone: number[]): ZoneItem {
  const id = nextZoneId(zones, 'site')
  const allRoads = [...roads, ...existingRoads(), ...setLanes, ...zones.flatMap((z) => z.roads)].filter((r) => r.pts.length >= 4).map((r) => ({ pts: centreLine(r.pts, 4), half: roadHalf(r) }))
  const wet = waters.filter((w) => WATER_TYPES[w.type].closed).map((w) => w.pts)
  const ok = (x: number, z: number) => (!terrain || isLand(terrain, x, z)) && !wet.some((p) => pointInPoly(p, x, z)) && !settled.some((b) => Math.abs(b.x - x) < 30 && Math.abs(b.z - z) < 30 && pointInPoly(b.corners, x, z))
  const zn = makeSiteZone(type, zone, { id, seed: num('seed') * 13 + zones.length, roads: allRoads, ground: terrain ? groundAt : undefined, ok, forests: areas.filter((a) => a.kind === 'forest').map((a) => a.pts), faction: $<HTMLSelectElement>('zoneFaction').value as Faction, rivers: waters.filter((w) => !WATER_TYPES[w.type].closed).map((w) => w.pts), water: (x, z) => (!!terrain && !isLand(terrain, x, z)) || wet.some((p) => pointInPoly(p, x, z)) })
  return zn
}
function zoneSite(type: SiteType, zone: number[]) {
  const zn = buildSite(type, zone)
  if (!zn.entities.length && !zn.shapes.length) return void (logEl.textContent = t('err.siteEmpty', { w: zn.warnings.join(' · ') }))
  zones.push(zn)
  finishZone(type, zone, t('log.siteMade', { name: t(('zt.' + type) as K), n: zn.entities.length, s: zn.shapes.length }) + (zn.warnings.length ? ' · ' + zn.warnings.join(' · ') : ''), ['hunting', 'checkpoint'].includes(type) ? [] : [zone])
}
function zoneScattered(zone: number[], n: number) {
  if (!island) return
  let sid = `Z${n}`
  while (settled.some((b) => b.site === sid)) sid += 'b'
  const blocked = [...existing.objects.filter((o) => !/Prefabs\/Terrain\//.test(o.prefab)).map((o) => o.box), ...zoneBlocked(zones)]
  const allRoads = [...roads, ...existingRoads(), ...setLanes, ...zones.flatMap((z) => z.roads)]
  const res = scatterBuildings(zone, allRoads, waters, island.heights, island.grid, { seed: num('setSeed') + n, haPerGroup: Math.max(2, num('zoneHa') || 8), maxSlope: ZONE_MAX_SLOPE.scattered, blocked, prefix: sid }, settled)
  const made = res.placed.length - settled.length
  settled = res.placed
  setLanes = [...setLanes, ...res.lanes]
  finishZone('scattered', zone, res.groups ? t('log.zoneScattered', { g: res.groups, n: made, s: res.lanes.length }) : t('err.zoneNoHouse'), res.yards)
}

/** "Ville" (town.ts): Voronoi districts round a square, main streets to the entry roads, typed blocks */
function zoneTown(zone: number[], n: number) {
  if (!island) return
  const sl = slopeShare(groundAt, zone, ZONE_MAX_SLOPE.town)
  if (sl > 0.6) return void (logEl.textContent = t('err.zoneSteep', { p: Math.round(sl * 100), max: 20 }))
  let sid = `Z${n}`
  while (settled.some((b) => b.site === sid)) sid += 'b'
  const blocked = [...existing.objects.filter((o) => !/Prefabs\/Terrain\//.test(o.prefab)).map((o) => o.box), ...zoneBlocked(zones)]
  const allRoads = [...roads, ...existingRoads(), ...setLanes, ...zones.flatMap((z) => z.roads)]
  const res = generateTown(zone, allRoads, waters, island.heights, island.grid, { seed: num('setSeed') + n, density: num('setDensity') || 1, maxSlope: ZONE_MAX_SLOPE.town, blocked, prefix: sid }, settled)
  const made = res.placed.length - settled.length
  settled = res.placed
  setLanes = [...setLanes, ...res.lanes]
  setSquares = [...setSquares, ...res.squares]
  // the town's parking and church blocks are dressed by the site generators (sitezones.ts): parking bays, and the
  // cemetery round the church (graves skip the church footprint: `ok` excludes the settled buildings)
  for (const bl of res.blocks) {
    if (bl.type !== 'parking' && bl.type !== 'church') continue
    const zn = buildSite(bl.type === 'church' ? 'cemetery' : 'parking', bl.inset)
    if (zn.entities.length || zn.shapes.length) zones.push(zn)
  }
  // farm cells keep the fields already there: only the districts cut the lower layers
  const rings = res.blocks.filter((b) => b.type !== 'farm').map((b) => b.ring)
  finishZone('town', zone, made ? t('log.zoneTown', { n: made, p: res.pop, s: res.lanes.length, b: rings.length }) : t('err.zoneNoHouse'), rings.length ? rings : undefined)
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
  if (zonePick) return void placeZone(...eventPos(e))
  if (tool() === 'comment') return void commentClick(...eventPos(e))
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
    strokeBefore = island.heights.slice()
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
    strokeFeedback()
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

$<HTMLButtonElement>('loadTerrain').addEventListener('click', () => void track((async () => {
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
})()))
$<HTMLButtonElement>('generate').addEventListener('click', generate)
$<HTMLButtonElement>('clearZone').addEventListener('click', () => {
  setZone([]) // the drawn outline only: generated fields stay ("Retirer forêts et champs" removes them)
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
type PowerItem = PowerLine & { id: string }
let powerLines: PowerItem[] = [] // tab Routes, Power lines
let powerStations: Station[] = [], powerAccess: number[][] = [] // transformer stations + their access tracks (powergrid.ts)
let sites: Site[] = []
let settled: Placed[] = [] // settlement buildings (tab Routes, Villages)
let setLanes: Road[] = [] // settlement lanes and footpaths, squares (tab Villages)
let setPaths: Road[] = []
let setSquares: Square[] = []
let setGardens: { site: string; corners: number[] }[] = [] // v2 back gardens (drawn only)
//! custom ground in parcels: cemetery gravel paths between grave rows + alley, worn dirt / patchy grass in gardens and farm yards
function parcelGround() {
  const seed = num('tSeed'), out = []
  for (const z of zones) if (z.kind === 'site' && z.sub === 'cemetery') out.push(...cemeteryPathMasks(z.boxes.filter((b) => b.role === 'grave').map((b) => b.corners), z.shapes.find((sh) => sh.id.endsWith('_aisle'))?.points, seed))
  const yards = settled.filter((b) => b.role === 'farmyard').map((b) => ({ corners: b.corners.map((v, i) => (i % 2 ? b.z : b.x) + (v - (i % 2 ? b.z : b.x)) * 1.8) }))
  out.push(...parcelGroundMasks([...setGardens, ...yards], settled, seed))
  return out
}
let setParcels: VillageParcel[] = [] // biome dressing of the back gardens (not Everon): trees, props, fences
let countryside: number[][] = [] // random world: the countryside polygons the plots were laid in (worldgen 10b)
let riparian: RiparianPatch[] = [] // riparian band (riparian.ts): random world, or the Water tab button
let ripaSig = '', ripaTimer = 0 // before the first draw(): ripaWatch runs from it (a later `let` threw TDZ and killed the page init)
let worldBridges: ProjectEntity[] = [] // V2 valley bridges of the last random world (3D view only)
let zones: ZoneItem[] = [] // industrial zones, military bases, airfields (tab Villages)
let zonePick: { kind: ZoneKind; sub: string } | null = null
let zoneCands: { x: number; z: number; yaw: number }[] = []
const ZONE_FILL: Record<string, string> = { tree: '#2f6b2acc', sand: '#e6d39a99', pasture: '#9cc46a44', orchard: '#6fa04a44', grave: '#d8d8d8', lamp: '#ffe066', lot: '#c9b27a33', area: '#7d8a5a33', pave: '#9a9a9acc', main: '#b07a4a', annex: '#c99a6a', prop: '#8a8a8a', hq: '#6a7d4a', barracks: '#7d8a5a', tower: '#4a5a3a', hangar: '#9aa4b0', tower_ctrl: '#d0d6dc', basin: '#2b6a9acc', apron: '#bdb8aacc', quay: '#6e6e6e', arm: '#5b5249', jetty: '#8a6a42' }
let satQ: Quantised | null = null
let satSurf: string[] = []
let satCanvas: HTMLCanvasElement | null = null
const setState = () => JSON.stringify({ settled, setLanes, setPaths, setSquares, setGardens, setParcels, zones })
function loadSetState(js: string | undefined) {
  const v = js ? JSON.parse(js) : {}
  settled = Array.isArray(v) ? v : v.settled ?? []
  setLanes = v.setLanes ?? []
  setPaths = v.setPaths ?? []
  setSquares = v.setSquares ?? []
  setGardens = Array.isArray(v.setGardens) ? v.setGardens : []
  setParcels = Array.isArray(v.setParcels) ? v.setParcels : []
  zones = Array.isArray(v.zones) ? v.zones : []
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

/** heights before the current stroke, to tell how much it changed (feedback once released) */
let strokeBefore: number[] | null = null
function strokeFeedback() {
  const before = strokeBefore
  strokeBefore = null
  if (!before || !island || tool() === 'dry' || tool() === 'wet') return
  let up = 0, down = 0
  const h = island.heights
  for (let i = 0; i < h.length; i++) { const d = h[i] - before[i]; if (d > up) up = d; if (-d > down) down = -d }
  const v = { up: up.toFixed(1), down: down.toFixed(1) }
  logEl.textContent = up < 0.05 && down < 0.05 ? t('brush.none')
    : tool() === 'raise' ? t('brush.up', v) : tool() === 'lower' || tool() === 'sea' ? t('brush.down', v) : t('brush.done', v)
}
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
  const wl = waters.length ? carveWater(island.heights, g, waters) : undefined
  if (zones.length) applyZones(island.heights, g, zones) // platforms / runway planes, before the road beds
  const padFoot = buildingFootprints(settled, zones)
  const pads = padFoot.length ? applyPads(island.heights, g, padFoot) : null // building pads
  const beds = roads.length ? carveRoads(island.heights, g, roads, { water: wl }) : null
  if (pads) layPads(island.heights, pads, beds?.weight)
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
    // the runoff carved its beds into the relief, road beds included: lay the roads again on top (a culvert
    // under the road; real rivers, traced in the Water step, keep their bridges)
    if (beds && !waters.some((w) => w.auto) && num('rDepth') > 0) { layBeds(island.heights, beds); if (pads) layPads(island.heights, pads, beds.weight) }
  }
  if (final) {
    island.surfaces = computeSurfaces(g, island.heights, num('tMax'), rivers, rasterCover(g, areas, landCover && landCover.cols === g.cols ? landCover.data : undefined), settled.length ? settlementMask(g, settled.map((q) => q.corners)) : undefined)
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
interface Snap { macro: Float32Array; sink?: Uint8Array; roads: string; power?: string; zone: string; sites: string; waters: string; settled: string }
const history: Snap[] = []
let histAt = -1, restoring = false
function checkpoint() {
  if (restoring || !sculpt) return
  const snap: Snap = { macro: sculpt.macro.slice(), sink: sink?.slice(), roads: JSON.stringify(roads), power: JSON.stringify({ l: powerLines, s: powerStations, a: powerAccess }), zone: zoneEl.value, sites: JSON.stringify(sites), waters: JSON.stringify(waters), settled: setState() }
  const cur = history[histAt]
  if (cur && cur.roads === snap.roads && cur.power === snap.power && cur.sites === snap.sites && cur.waters === snap.waters && cur.settled === snap.settled && cur.zone === snap.zone && cur.sink?.length === snap.sink?.length
    && cur.macro.length === snap.macro.length && cur.macro.every((v, i) => v === snap.macro[i])
    && (!cur.sink || cur.sink.every((v, i) => v === snap.sink![i]))) return
  if (cur && !remoteApply) logChange(cur, snap)
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
  { const pw = JSON.parse(s.power ?? '[]'); powerLines = Array.isArray(pw) ? pw : pw.l; powerStations = Array.isArray(pw) ? [] : pw.s ?? []; powerAccess = Array.isArray(pw) ? [] : pw.a ?? [] }
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
// Share: outside a room it asks first "create or join"; inside one it opens the collaboration panel
const shareDlg = $('shareDlg')
{
  const tabs = [$<HTMLButtonElement>('shtCreate'), $<HTMLButtonElement>('shtJoin')]
  const pick = (b: HTMLButtonElement, focus = false) => tabs.forEach((x) => {
    const on = x === b; x.setAttribute('aria-selected', String(on)); x.tabIndex = on ? 0 : -1
    $(x.getAttribute('aria-controls')!).hidden = !on; if (on && focus) x.focus()
  })
  tabs.forEach((b, i) => {
    b.addEventListener('click', () => pick(b))
    b.addEventListener('keydown', (e) => { if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); pick(tabs[1 - i], true) } })
  })
  $<HTMLButtonElement>('shareX').addEventListener('click', () => $<HTMLButtonElement>('shareClose').click())
}
const openShare = () => { $<HTMLInputElement>('shareName').value = collabName.value; $('shareStatus').textContent = ''; shareDlg.hidden = false; $<HTMLButtonElement>('shareCreate').focus() }
const closeShare = () => { shareDlg.hidden = true }
$<HTMLButtonElement>('collab').addEventListener('click', () => {
  if (!collab && !collabRoom.value.trim() && !collabView.classList.contains('on')) { openShare(); return }
  showCollabView(!collabView.classList.contains('on'))
})
const shareNameIn = () => { const v = $<HTMLInputElement>('shareName').value.trim(); if (v) { collabName.value = v; collabName.dispatchEvent(new Event('change')) } }
$<HTMLButtonElement>('shareCreate').addEventListener('click', () => {
  shareNameIn()
  if (collabMode.value === 'server') { collabMode.value = 'direct'; collabMode.dispatchEvent(new Event('change')) }
  $<HTMLButtonElement>('p2pCreate').click()
  $<HTMLInputElement>('shareLink').value = $<HTMLInputElement>('p2pLink').value
  $('shareLinkRow').hidden = false
  $('shareStatus').textContent = t('share.created')
  if (!collabView.classList.contains('on')) showCollabView(true)
})
$<HTMLButtonElement>('shareCopy').addEventListener('click', () => {
  const el = $<HTMLInputElement>('shareLink'); el.select()
  void navigator.clipboard?.writeText(el.value).then(() => { $('shareStatus').textContent = t('p2p.copied') }, () => { /* selected: Ctrl+C works */ })
})
$<HTMLButtonElement>('shareJoin').addEventListener('click', () => {
  const raw = $<HTMLInputElement>('shareJoinLink').value.trim()
  const h = raw.includes('#') ? raw.slice(raw.indexOf('#') + 1) : raw
  const q = new URLSearchParams(h)
  const code = q.get('salon'), key = q.get('cle')
  if (!code || !key) { $('shareStatus').textContent = t('share.join.bad'); $<HTMLInputElement>('shareJoinLink').focus(); return }
  shareNameIn()
  if (collabMode.value === 'server') { collabMode.value = 'direct'; collabMode.dispatchEvent(new Event('change')) }
  if (collab) leaveRoom()
  collabRoom.value = code; collabKey.value = key
  closeShare()
  showCollabView(true)
  joinRoomNow(false)
})
$<HTMLButtonElement>('shareAdv').addEventListener('click', () => { closeShare(); showCollabView(true); collabBox.hidden = false })
$<HTMLButtonElement>('shareClose').addEventListener('click', closeShare)
shareDlg.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeShare() })
shareDlg.addEventListener('click', (e) => { if (e.target === shareDlg) closeShare() })
$<HTMLButtonElement>('cvJoin').addEventListener('click', () => { collabBox.hidden = !collabBox.hidden })
let roster: { self: string; names: string[]; direct: boolean } | null = null
$<HTMLButtonElement>('cvLeave').addEventListener('click', () => leaveRoom())
function leaveRoom(keepStatus = false) {
  roster = null
  const c = collab
  collab = null
  c?.close()
  if (!keepStatus) p2pStatus.textContent = ''
  $<HTMLSpanElement>('collabInfo').textContent = ''
  $<HTMLButtonElement>('collabGo').textContent = t('collab.join')
  connInfo()
  draw()
}
const collabMode = collabField('collabMode', 'reforger-mapper.collab.mode', 'direct') as unknown as HTMLSelectElement
const p2pTurn = collabField('p2pTurn', 'reforger-mapper.collab.turn', '')
const p2pTurnUser = collabField('p2pTurnUser', 'reforger-mapper.collab.turnUser', '')
const p2pTurnPass = $<HTMLInputElement>('p2pTurnPass')
const p2pStatus = $<HTMLDivElement>('p2pStatus')
function collabModeUi() {
  const direct = collabMode.value !== 'server'
  $('collabUrlRow').hidden = direct
  $('p2pCreate').hidden = !direct
  $('collabHint').textContent = direct ? t('p2p.hint') : t('collab.hint')
}
collabMode.addEventListener('change', () => { collabModeUi(); p2pStatus.textContent = ''; $('p2pToServer').hidden = true })
collabModeUi()
function shareLink(code: string, key: string) {
  return `${location.origin}${location.pathname}#salon=${encodeURIComponent(code)}&cle=${encodeURIComponent(key)}`
}
$<HTMLButtonElement>('p2pCreate').addEventListener('click', () => {
  if (collab) leaveRoom()
  const r = newRoom()
  collabRoom.value = r.code
  collabKey.value = r.key
  $<HTMLInputElement>('p2pLink').value = shareLink(r.code, r.key)
  $('p2pShare').hidden = false
  joinRoomNow(true)
})
$<HTMLButtonElement>('p2pCopy').addEventListener('click', () => {
  const el = $<HTMLInputElement>('p2pLink')
  el.select()
  void navigator.clipboard?.writeText(el.value).then(() => { p2pStatus.textContent = t('p2p.copied') }, () => { /* select() left it ready for Ctrl+C */ })
})
$<HTMLButtonElement>('p2pToServer').addEventListener('click', () => {
  leaveRoom()
  collabMode.value = 'server'
  try { localStorage.setItem('reforger-mapper.collab.mode', 'server') } catch { /* storage blocked */ }
  collabModeUi()
  $('p2pToServer').hidden = true
  p2pStatus.textContent = t('p2p.serverHint')
  $<HTMLInputElement>('collabUrl').focus()
})
$<HTMLButtonElement>('collabGo').addEventListener('click', () => {
  if (collab) return leaveRoom()
  joinRoomNow(false)
})
function joinRoomNow(creator: boolean) {
  let received = false, others = 0
  const direct = collabMode.value !== 'server'
  const room = collabRoom.value.trim() || 'map1', name = collabName.value.trim() || t('collab.anon')
  $('p2pToServer').hidden = true
  const events: CollabEvents = {
    project: (p, from) => {
      received = true
      quietUntil = performance.now() + 1500
      remoteApply = true
      try { loadProject(p) } catch (e) { remoteApply = false; logEl.textContent = t('err.generic', { msg: (e as Error).message }); return }
      remoteApply = false
      logEl.textContent = from === '💾' ? t('p2p.resumed') : t('collab.got', { name: from })
    },
    ops: (list, replace) => receiveOps(list, replace),
    peers: (ps) => {
      others = ps.length
      roster = { self: name, names: ps.map((p) => p.name), direct }
      const names = ps.map((p) => p.name).join(', ')
      $<HTMLSpanElement>('collabInfo').textContent = direct
        ? t('p2p.peers', { n: ps.length + 1, names })
        : t('collab.peers', { room: collabRoom.value, n: ps.length + 1, names })
      if (direct && collab?.open) p2pStatus.textContent = t('p2p.connected', { n: ps.length + 1 })
      connInfo()
    },
    host: (h) => { if (h && collab?.open) logEl.textContent = t('p2p.nowHost') },
    cursors: () => draw(),
    status: (s, detail) => {
      if (s === 'connecting') {
        p2pStatus.textContent = t('p2p.connecting')
      } else if (s === 'connected') {
        $<HTMLButtonElement>('collabGo').textContent = t('collab.leave')
        if (direct) p2pStatus.textContent = t('p2p.connected', { n: others + 1 })
        if (!direct || !creator) collabBox.hidden = true
        // server room: an empty room gets our map; direct: the creator's map is the room's map
        if (!direct) setTimeout(() => { if (!received) { const p = islandProject(); if (p) collab?.sendProject(p) } }, 1500)
        else if (creator) { const p = islandProject(); if (p) collab?.sendProject(p) }
        connInfo()
      } else if (s === 'failed') {
        p2pStatus.textContent = t('p2p.failed')
        $('p2pToServer').hidden = false
        collabBox.hidden = false
        logEl.textContent = t('p2p.failed')
        leaveRoom(true)
      } else {
        if (collab !== self) return // we left on purpose (or after a failure): keep the message shown
        logEl.textContent = t('collab.closed', { detail: detail ?? '' })
        leaveRoom()
      }
    },
  }
  $<HTMLButtonElement>('collabGo').textContent = t('collab.leave')
  const self: CollabTransport = direct
    ? new P2PCollab(room, collabKey.value, name, creator, events, p2pTurn.value.trim() ? { url: p2pTurn.value.trim(), user: p2pTurnUser.value.trim(), pass: p2pTurnPass.value } : undefined)
    : new Collab(collabUrl.value.trim(), room, name, collabKey.value, events)
  collab = self
}
// a share link: #salon=CODE&cle=KEY (hash, never sent to any server). Ask a name, then join directly.
function joinFromHash() {
  const h = new URLSearchParams(location.hash.slice(1))
  const code = h.get('salon'), key = h.get('cle')
  if (!code || !key) return
  const name = window.prompt(t('p2p.askName'), collabName.value || '')
  if (name === null) return
  if (name.trim()) { collabName.value = name.trim(); try { localStorage.setItem('reforger-mapper.collab.name', collabName.value) } catch { /* storage blocked */ } }
  collabMode.value = 'direct'
  collabModeUi()
  collabRoom.value = code
  collabKey.value = key
  if (collab) leaveRoom()
  if (!$('collab').classList.contains('active')) showCollabView(true)
  joinRoomNow(false)
}
window.addEventListener('hashchange', joinFromHash)
setTimeout(joinFromHash, 0)
function drawPeers() {
  if (!collab) return
  ctx.font = '12px sans-serif'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  for (const [id, c] of collab.cursors) {
    const [x, y] = toScreen(c.x, c.z)
    const hue = typeof id === 'number' ? (id * 97) % 360 : [...id].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) % 360, 7)
    ctx.fillStyle = `hsl(${hue}, 80%, 60%)`
    ctx.beginPath()
    ctx.moveTo(x, y); ctx.lineTo(x + 12, y + 4); ctx.lineTo(x + 4, y + 12); ctx.closePath()
    ctx.fill()
    ctx.fillText(c.name, x + 14, y + 12)
  }
}
// --- Collaboration view (👥): history of changes, satellite / relief mini-map, comments pinned on the map.
// History and comments are small targeted ops (src/collab.ts Op) kept in the room log on the server
// (collab/data/<room>.jsonl) and in this browser; made offline, they are uploaded on the next join.
const collabView = $<HTMLDivElement>('collabView')
const OPS_KEY = 'reforger-mapper.collab.ops'
let ops: Op[] = []
try { ops = JSON.parse(localStorage.getItem(OPS_KEY) ?? '[]') } catch { ops = [] }
let selCom: string | null = null
let draftPos: [number, number] | null = null
let toolBeforeComment = 'zone'
function saveOps() { try { localStorage.setItem(OPS_KEY, JSON.stringify(ops.slice(-500))) } catch { /* storage full or blocked */ } }
function addOp(p: Partial<Op>) {
  const op = { ...p, id: 'l' + Math.random().toString(36).slice(2, 10), author: collabName.value.trim() || t('collab.anon'), at: Date.now() } as Op
  if (collab?.open) return collab.sendOp(op) // comes back stamped by the server
  ops.push({ ...op, local: true })
  saveOps()
  renderCollab()
  draw()
  notifyAtelierCollab()
}
function receiveOps(list: Op[], replace: boolean) {
  if (replace) {
    const mine = ops.filter((o) => o.local)
    ops = [...list]
    for (const o of mine) collab?.sendOp(o) // offline work goes to the room, same ids
  } else {
    const ids = new Set(ops.map((o) => o.id))
    ops.push(...list.filter((o) => !ids.has(o.id)))
  }
  saveOps()
  renderCollab()
  draw()
  notifyAtelierCollab()
}
// Atelier network viewers pin their comments in the same room
registerAtelierCollab({ add: (x, z, text) => addOp({ kind: 'comment', text, x, z }), list: () => ops })
interface Thread { c: Op; n: number; replies: Op[]; resolved: boolean }
function threads(): Thread[] {
  const m = new Map<string, Thread>()
  for (const o of ops) {
    if (o.kind === 'comment') m.set(o.id, { c: o, n: m.size + 1, replies: [], resolved: false })
    else if (o.kind === 'reply') m.get(o.ref ?? '')?.replies.push(o)
    else if (o.kind === 'resolve') { const th = m.get(o.ref ?? ''); if (th) th.resolved = !!o.resolved }
  }
  return [...m.values()]
}
const visibleThreads = () => threads().filter((th) => !th.resolved || $<HTMLInputElement>('cvShowRes').checked)
const when = (at: number) => new Date(at).toLocaleString(getLang() === 'fr' ? 'fr-FR' : 'en-GB', { dateStyle: 'short', timeStyle: 'short' })
function panTo(x: number, z: number) { view.x = x; view.z = z; draw() }
// dev only: lets the Playwright checks frame a world spot (x, z, metres per pixel)
if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__mgView = (x: number, z: number, mpp: number) => { view.x = x; view.z = z; view.mpp = mpp; draw() }

// history: one entry per undo checkpoint, named from what changed since the previous one
let pendingAct = ''
for (const id of ['tGen', 'wGen', 'netGen', 'powerGen', 'setGen', 'generate', 'rwGo']) document.getElementById(id)?.addEventListener('click', () => { pendingAct = id }, true)
let lastLogged = { key: '', at: 0 }
let genAt = 0 // a generator often makes several checkpoints: they count as its one entry
function diffList(a: string, b: string): [string, any] | null {
  if (a === b) return null
  const A = JSON.parse(a || '[]') as any[], B = JSON.parse(b || '[]') as any[]
  const had = new Set(A.map((o) => o.id)), has = new Set(B.map((o) => o.id))
  const added = B.find((o) => !had.has(o.id))
  if (added) return ['add', added]
  const gone = A.find((o) => !has.has(o.id))
  if (gone) return ['del', gone]
  return ['edit', B.find((o) => JSON.stringify(o) !== JSON.stringify(A.find((x) => x.id === o.id))) ?? B[0]]
}
/** the step a history entry belongs to comes from WHAT changed, not from the tab open at that moment
 *  (checkpoints are often taken later, or from another tab: a road made while the Relief tab is shown) */
function stepOfAction(action: string, fallback?: string): string {
  const active = fallback ?? tabButtons.find((x) => x.classList.contains('active'))?.dataset.tab ?? ''
  const k = action.split('.')
  if (k[0] === 'gen') return ({ tGen: 'island', wGen: 'water', netGen: 'roads', powerGen: 'roads', setGen: 'villages', generate: 'camp', rwGo: 'island' } as Record<string, string>)[k[1]] ?? active
  const by: Record<string, string> = { road: 'roads', power: 'roads', water: 'water', site: 'villages', villages: 'villages', zone: 'camp', send: 'wb' }
  if (by[k[0]]) return by[k[0]]
  if (k[0] === 'relief') return active === 'brush' ? 'brush' : 'island'
  return active
}
function logChange(cur: Snap, snap: Snap) {
  let action = '', detail = ''
  let pos: [number, number] = [view.x, view.z]
  if (pendingAct) { action = `gen.${pendingAct}`; pendingAct = ''; genAt = Date.now() }
  else if (Date.now() - genAt < 3000) return
  else {
    for (const [k, a, b] of [['road', cur.roads, snap.roads], ['water', cur.waters, snap.waters], ['site', cur.sites, snap.sites], ['power', cur.power ?? '[]', snap.power ?? '[]']] as const) {
      const d = diffList(a, b)
      if (!d) continue
      action = `${k}.${d[0]}`
      const o = d[1]
      detail = String(o?.id ?? '')
      if (o?.pts?.length >= 2) pos = [o.pts[0], o.pts[1]]
      else if (Number.isFinite(o?.x)) pos = [o.x, o.z]
      break
    }
    if (!action) {
      if (cur.settled !== snap.settled) action = 'villages'
      else if (cur.zone !== snap.zone) action = 'zone'
      else { action = 'relief'; if (cursorWorld) pos = [...cursorWorld] }
    }
  }
  // a brush session or a zone being drawn makes one entry, not fifty
  const key = action + detail, now = Date.now()
  if (key === lastLogged.key && now - lastLogged.at < 20000) { lastLogged.at = now; return }
  lastLogged = { key, at: now }
  addOp({ kind: 'history', action, detail, step: stepOfAction(action), x: pos[0], z: pos[1] })
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (text) e.textContent = text
  return e
}
function opLabel(o: Op): string {
  if (o.kind === 'history') return t(`hist.${o.action}` as Key) + (o.detail ? ` ${o.detail}` : '')
  return t(`hist.${o.kind}${o.kind === 'resolve' && !o.resolved ? '.re' : ''}` as Key) + (o.text ? ` « ${o.text.slice(0, 40)} »` : '')
}
function renderCollab() {
  if (collabView.hidden) return
  const all = threads()
  const byId = new Map(all.map((th) => [th.c.id, th]))
  $('cvNCom').textContent = String(all.filter((th) => !th.resolved).length || '')
  // comments, newest first
  const ul = $<HTMLUListElement>('cvComments')
  ul.replaceChildren()
  const vis = visibleThreads().reverse()
  if (!vis.length) ul.append(el('li', 'hint', t('cv.noComments')))
  for (const th of vis) {
    const li = el('li', `cvcom${th.resolved ? ' resolved' : ''}${th.c.id === selCom ? ' sel' : ''}`)
    const head = el('div', 'cvmeta')
    head.append(el('b', 'pin', String(th.n)), el('strong', '', th.c.author), el('span', '', ` · ${when(th.c.at)}${th.c.local ? ' · ' + t('cv.offline') : ''}`))
    head.title = t('cv.goto')
    head.addEventListener('click', () => { selCom = th.c.id; panTo(th.c.x ?? view.x, th.c.z ?? view.z); renderCollab() })
    li.append(head, el('p', 'cvtext', th.c.text ?? ''))
    for (const r of th.replies) {
      const rp = el('div', 'cvreply')
      rp.append(el('strong', '', r.author), el('span', '', ` · ${when(r.at)}`), el('p', 'cvtext', r.text ?? ''))
      li.append(rp)
    }
    const row = el('div', 'cvrow')
    const inp = el('input')
    inp.placeholder = t('cv.reply')
    const send = el('button', 'secondary', t('cv.replyBtn'))
    send.type = 'button'
    const go = () => { const v = inp.value.trim(); if (v) addOp({ kind: 'reply', ref: th.c.id, text: v }) }
    send.addEventListener('click', go)
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') go() })
    const res = el('button', 'secondary', th.resolved ? t('cv.reopen') : '✓ ' + t('cv.resolve'))
    res.type = 'button'
    res.addEventListener('click', () => addOp({ kind: 'resolve', ref: th.c.id, resolved: !th.resolved }))
    row.append(inp, send, res)
    li.append(row)
    ul.append(li)
  }
  // history, newest first
  const hl = $<HTMLUListElement>('cvHist')
  hl.replaceChildren()
  const hist = ops.slice(-200).reverse()
  if (!hist.length) hl.append(el('li', 'hint', t('cv.noHistory')))
  for (const o of hist) {
    const li = el('li', 'cvhist')
    const at = o.kind === 'history' || o.kind === 'comment' ? o : byId.get(o.ref ?? '')?.c
    const step = STEPS.find((s) => s.tab === (o.kind === 'history' && o.action ? stepOfAction(o.action, o.step) : o.step)) // re-derived: older entries were tagged with the open tab
    li.append(el('strong', '', o.author), el('span', '', ' ' + opLabel(o)))
    li.append(el('small', '', `${step ? t(step.label) + ' · ' : ''}${when(o.at)}${o.local ? ' · ' + t('cv.offline') : ''}`))
    if (at && Number.isFinite(at.x)) {
      li.classList.add('go')
      li.title = t('cv.goto')
      li.addEventListener('click', () => { if (at.kind === 'comment') selCom = at.id; panTo(at.x!, at.z!); renderCollab() })
    }
    hl.append(li)
  }
  renderMini()
}
const PEER_COLORS = ['#E0A233', '#4A8CC9', '#B07CD8', '#5FA24A', '#C9784A', '#4AB0A6']
function connInfo() {
  $('cvConn').textContent = collab?.open
    ? t('cv.conn.on', { room: collabRoom.value, info: $<HTMLSpanElement>('collabInfo').textContent ?? '' })
    : t('cv.conn.off')
  $('cvJoin').textContent = t('cv.connect')
  $('cvJoin').hidden = !!collab?.open
  $('cvLeave').hidden = !collab?.open
  const ul = $('cvPeers'), r = collab?.open ? roster : null
  $('cvOnline').hidden = !r
  ul.textContent = ''
  if (r) {
    $('cvOnN').textContent = t('cv.online', { n: r.names.length + 1 })
    for (const [n, me] of [[r.self, true], ...r.names.map((x) => [x, false])] as [string, boolean][]) {
      const li = document.createElement('li')
      const av = document.createElement('span'); av.className = 'cvav'; av.textContent = (n.trim()[0] ?? '?').toUpperCase()
      av.style.background = PEER_COLORS[[...n].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % PEER_COLORS.length]
      const nm = document.createElement('span'); nm.className = 'cvname'; nm.textContent = me ? t('cv.you', { name: n }) : n
      const md = document.createElement('span'); md.className = 'cvmode'; md.dataset.mode = r.direct ? 'direct' : 'relay'; md.textContent = t(r.direct ? 'cv.mode.direct' : 'cv.mode.relay')
      li.append(av, nm, md); ul.append(li)
    }
  }
}
function showCollabView(on: boolean) {
  collabView.hidden = !on
  collabView.classList.toggle('on', on)
  document.querySelector('.side')!.classList.toggle('collabmode', on)
  $('collab').classList.toggle('active', on)
  if (on) { connInfo(); renderCollab() }
  else {
    collabBox.hidden = true
    draftPos = null
    $('cvDraft').hidden = true
    tabButtons.find((x) => x.classList.contains('active'))?.click() // back to the step and its tool
  }
  draw()
}
$('cvClose').addEventListener('click', () => showCollabView(false))
$('cvShowRes').addEventListener('change', () => { renderCollab(); draw() })

// comments: the 📌 tool, then a click on the map
$('cvAdd').addEventListener('click', () => {
  if (tool() !== 'comment') toolBeforeComment = tool()
  setTool('comment')
  $<HTMLSpanElement>('brushInfo').textContent = t('cv.pick')
  logEl.textContent = t('cv.pick')
})
function commentClick(sx: number, sy: number) {
  for (const th of visibleThreads()) {
    const [px, py] = toScreen(th.c.x ?? 0, th.c.z ?? 0)
    if (Math.hypot(px - sx, py - sy) < 12) { selCom = th.c.id; renderCollab(); draw(); return }
  }
  draftPos = toWorld(sx, sy)
  $('cvDraft').hidden = false
  $<HTMLTextAreaElement>('cvText').focus()
  draw()
}
function endDraft() {
  draftPos = null
  $('cvDraft').hidden = true
  $<HTMLTextAreaElement>('cvText').value = ''
  setTool(toolBeforeComment)
  draw()
}
$('cvPost').addEventListener('click', () => {
  const text = $<HTMLTextAreaElement>('cvText').value.trim()
  if (!draftPos || !text) return void (logEl.textContent = t('cv.pick'))
  addOp({ kind: 'comment', text, x: draftPos[0], z: draftPos[1] })
  endDraft()
})
$('cvCancel').addEventListener('click', endDraft)
function drawComments() {
  if (!ops.length && !draftPos) return
  ctx.save()
  ctx.font = 'bold 11px sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  for (const th of visibleThreads()) {
    const [x, y] = toScreen(th.c.x ?? 0, th.c.z ?? 0)
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.arc(x, y - 14, 9, Math.PI * 0.75, Math.PI * 2.25)
    ctx.closePath()
    ctx.fillStyle = th.resolved ? '#6b7280' : '#f5a524'
    ctx.fill()
    ctx.lineWidth = th.c.id === selCom ? 3 : 1.5
    ctx.strokeStyle = th.c.id === selCom ? '#fff' : '#0008'
    ctx.stroke()
    ctx.fillStyle = '#111'
    ctx.fillText(String(th.n), x, y - 14)
  }
  if (draftPos) {
    const [x, y] = toScreen(...draftPos)
    ctx.setLineDash([4, 3])
    ctx.strokeStyle = '#f5a524'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.arc(x, y, 10, 0, Math.PI * 2)
    ctx.stroke()
  }
  ctx.restore()
}

// satellite: the Esri photo of a real place (the tracing image), or the hillshaded relief of a fictive island
function renderMini() {
  if (collabView.hidden) return
  const c = $<HTMLCanvasElement>('cvMini'), g = c.getContext('2d')!
  g.fillStyle = '#0f1012'
  g.fillRect(0, 0, c.width, c.height)
  const src = traceImg ?? terrainImg
  $('cvSatInfo').textContent = t(traceImg ? 'cv.sat.real' : terrainImg ? 'cv.sat.relief' : 'cv.sat.empty')
  if (!terrain || !src) return
  const W = (terrain.cols - 1) * terrain.step, H = (terrain.rows - 1) * terrain.step
  const k = Math.min(c.width / W, c.height / H), ox = (c.width - W * k) / 2, oy = (c.height - H * k) / 2
  g.imageSmoothingEnabled = true
  g.drawImage(src, ox, oy, W * k, H * k)
  const mx = (x: number) => ox + (x - terrain!.minX) * k, my = (z: number) => oy + (H - (z - terrain!.minZ)) * k
  const [ax, az] = toWorld(0, 0), [bx, bz] = toWorld(map.width, map.height)
  g.strokeStyle = '#ffd34d'
  g.lineWidth = 1.5
  g.strokeRect(mx(ax), my(az), mx(bx) - mx(ax), my(bz) - my(az))
  for (const th of visibleThreads()) {
    g.fillStyle = th.resolved ? '#6b7280' : '#f5a524'
    g.beginPath()
    g.arc(mx(th.c.x ?? 0), my(th.c.z ?? 0), 3.5, 0, Math.PI * 2)
    g.fill()
  }
  c.onclick = (e) => {
    const r = c.getBoundingClientRect()
    const px = (e.clientX - r.left) * (c.width / r.width), py = (e.clientY - r.top) * (c.height / r.height)
    panTo(terrain!.minX + (px - ox) / k, terrain!.minZ + H - (py - oy) / k)
  }
}
$('satShow').addEventListener('change', () => draw())
{
  const a = $<HTMLInputElement>('cvAlpha'), b = $<HTMLInputElement>('traceAlpha')
  a.value = b.value
  a.addEventListener('input', () => { b.value = a.value; draw() })
  b.addEventListener('input', () => { a.value = b.value })
}
// language selector: listbox (arrows / Enter / Esc), browser-language follow, export / import a translation
{
  const btn = $<HTMLButtonElement>('lang'), menu = $<HTMLDivElement>('langMenu'), list = $<HTMLDivElement>('langList')
  const opts = () => [...list.querySelectorAll<HTMLDivElement>('[role=option]')]
  let at = 0
  const focusOpt = (i: number) => {
    const o = opts(); at = (i + o.length) % o.length
    o.forEach((x, j) => x.classList.toggle('cur', j === at))
    list.setAttribute('aria-activedescendant', o[at].id)
  }
  const open = (on: boolean) => {
    menu.hidden = !on; btn.setAttribute('aria-expanded', String(on))
    if (on) { focusOpt(Math.max(0, opts().findIndex((o) => o.dataset.lang === getLang()))); list.focus() } else btn.focus()
  }
  const pick = (code: string) => { chooseLang(code, false); location.reload() }
  btn.addEventListener('click', () => open(menu.hidden === true))
  list.addEventListener('click', (e) => { const o = (e.target as HTMLElement).closest<HTMLDivElement>('[role=option]'); if (o) pick(o.dataset.lang!) })
  menu.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); open(false) } else if (e.target !== list) return
    else if (e.key === 'ArrowDown') { e.preventDefault(); focusOpt(at + 1) } else if (e.key === 'ArrowUp') { e.preventDefault(); focusOpt(at - 1) }
    else if (e.key === 'Home') { e.preventDefault(); focusOpt(0) } else if (e.key === 'End') { e.preventDefault(); focusOpt(-1) }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(opts()[at].dataset.lang!) }
    e.stopPropagation()
  })
  document.addEventListener('mousedown', (e) => { if (!menu.hidden && !(e.target as HTMLElement).closest('.langsel')) { menu.hidden = true; btn.setAttribute('aria-expanded', 'false') } })
  $<HTMLInputElement>('langFollow').addEventListener('change', (e) => { chooseLang(getLang(), (e.target as HTMLInputElement).checked); location.reload() })
  $<HTMLButtonElement>('langExport').addEventListener('click', () => {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([exportLang()], { type: 'application/json' }))
    a.download = `reforger-mapper-lang-${getLang()}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  })
  const file = $<HTMLInputElement>('langFile')
  $<HTMLButtonElement>('langImport').addEventListener('click', () => file.click())
  file.addEventListener('change', async () => {
    const f = file.files?.[0]; if (!f) return
    if (importLang(await f.text())) location.reload(); else alert(t('lang.importErr'))
  })
}
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
  if (rivers && layer('runoff')) {
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

function run(label: string, f: () => Promise<string>, onOk?: () => void) { return track(runJob(label, f, onOk)) }
async function runJob(label: string, f: () => Promise<string>, onOk?: () => void) {
  logEl.textContent = t('run.progress', { label })
  if (busyDepth) busyStage(label)
  try {
    logEl.textContent = external(await f())
    onOk?.()
  } catch (e) {
    const msg = (e as Error).message
    if (/Failed to fetch|NetworkError|Load failed|Workbench unreachable/.test(msg)) {
      busyFailed = true
      logEl.textContent = t('err.notConnected')
      $('wbGuide').hidden = false
      void refreshStatus()
    } else { busyFailed = true; logEl.textContent = t('run.error', { label, msg }) }
  }
}

/** the island now, on this thread (callers that use it on the next line) */
function islandNow() { islandSync = true; try { $<HTMLButtonElement>('tGen').click() } finally { islandSync = false } }
let islandSync = false // applyWorld: the same island right now, on this thread (the world is applied in one go)
$<HTMLButtonElement>('tGen').addEventListener('click', () => {
  setRefReadOnly(false)
  const size = num('tSize')
  const p = {
    size,
    step: Math.max(4, size / 512),
    maxHeight: num('tMax'),
    seaDepth: num('tSea'),
    landRatio: num('tLand'),
    roughness: num('tRough'),
    seed: num('tSeed'),
    islands: num('tIslands'),
  }
  const use = (isl: Island) => {
    imported = null
    existing = { objects: [], shapes: [] }
    island = isl
    sink = undefined
    sculpt = new Sculpt(island.grid.cols, island.grid.step, num('tMax'), num('tSeed'), island.heights)
    rivers = undefined
    view.x = view.z = size / 2
    view.mpp = size / map.width
    logEl.textContent = t('log.island', { cols: island.grid.cols, rows: island.grid.rows, step: island.grid.step })
    recompose(true)
    coachAfter('new')
  }
  if (islandSync) return use(generateIsland(p))
  // in the generator worker: the busy panel paints and the page answers meanwhile
  void track(runGen<Island>('island', [p]).promise.then(use, (e) => { busyFailed = true; logEl.textContent = t('run.error', { label: 'island', msg: (e as Error).message }) }))
})
// load the world open in the Workbench (relief + ground materials) to carry on a map in progress
/** world imported from the Workbench (null = generated island); kept so the project survives a reload */
let imported: WorldExport | null = null
function useWorld(w: WorldExport) {
  setRefReadOnly(false)
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
  landCover = null
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
      roads: [...yardMasks(settled), ...roadMasks(roads), ...waterMasks(waters), ...roadMasks([...setLanes, ...setPaths]), ...buildingMasks(settled), ...poleDirtMasks(mergePowerLines(powerLines), num('tSeed')), ...parcelGround()],
    })
    return t('log.masks', { files: r.written.join(', '), dir: r.dir, sat: r.satellite?.file ?? '—' })
  }),
)

/** every mask export: generator surface names -> the project's biome surfaces (biomes/surfaces.ts) */
const writeMasks = (body: Parameters<typeof applyBiome>[0] & Record<string, unknown>) => writeMasksRaw(applyBiome(body, currentBiome))

async function refreshStatus() {
  const s = await getStatus()
  statusEl.textContent = s.workbench ? t('wb.chip.on') : t('wb.chip.off')
  statusEl.title = (s.workbench ? '' : t('wb.chip.tip') + '\n') + t('status.line', { bridge: s.bridge ? t('status.ok') : t('status.no'), wb: s.workbench ? t('status.ok') : t('status.no'), detail: s.detail })
  statusEl.dataset.ok = String(s.workbench)
  $('wbGuide').hidden = s.workbench
  return s.workbench
}

sendEl.addEventListener('click', () => void track((async () => {
  sendEl.disabled = true
  try {
    logEl.textContent = external(await toWb(JSON.parse(projectEl.value) as Project))
  } catch (e) {
    logEl.textContent = t('err.generic', { msg: (e as Error).message })
  } finally {
    sendEl.disabled = false
    refreshStatus()
  }
})()))

// no polling: a NET API call landing while a Workbench modal dialog is open crashes the Workbench
const chipClick = async () => { if (!(await refreshStatus())) openHelp('helpConnect') }
statusEl.addEventListener('click', chipClick)
statusEl.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); void chipClick() } })
document.querySelectorAll<HTMLButtonElement>('.wbRetry').forEach((b) => b.addEventListener('click', async () => {
  b.disabled = true
  const ok = await refreshStatus().finally(() => (b.disabled = false))
  logEl.textContent = ok ? t('wb.retry.ok') : t('wb.retry.no')
}))
$<HTMLButtonElement>('wbDownload').addEventListener('click', () => $<HTMLButtonElement>('pSave').click())

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
  showStep(b.dataset.tab!)
}))
// step status badges: done is read from the real state; a done step turns stale when a step above it changed since
const REGEN: Record<string, string> = { island: 'tGen', water: 'wGen', roads: 'netGen', villages: 'setGen', camp: 'generate' }
let sentSig: string | null = null
const objIds = new WeakMap<object, number>()
let objNext = 1
const oid = (o: object | null | undefined) => {
  if (!o) return 0
  if (!objIds.has(o)) objIds.set(o, objNext++)
  return objIds.get(o)!
}
const ptsSum = (rs: { pts: number[] }[]) => rs.reduce((n, r) => n + r.pts.length + (r.pts[0] ?? 0), 0)
/** one cheap fingerprint per step, in STEPS order ('' = nothing there yet) */
function stepSigs(): string[] {
  const relief = terrain || island ? `${oid(terrainImg)}` : ''
  return [
    relief,
    relief,
    waters.length || rivers ? `${waters.length}:${ptsSum(waters)}:${oid(rivers)}` : '',
    roads.length || powerLines.length ? `${roads.length}:${ptsSum(roads)}:${powerLines.length}:${ptsSum(powerLines.map((l) => ({ pts: l.path })))}` : '',
    settled.length || zones.length ? `${settled.length}:${oid(settled)}:${zones.map((z) => z.id).join(',')}` : '',
    result || areas.length ? `${oid(result)}:${areas.length}` : '',
    '',
  ]
}
// which steps each step is built on
const UP: number[][] = [[], [], [0], [0, 2], [0, 3], [0, 3, 4], []]
const doneSnap: (string | null)[] = STEPS.map(() => null)
const ownSnap: string[] = STEPS.map(() => '')
function refreshSteps() {
  let sig: string[]
  try { sig = stepSigs() } catch { return } // start-up: state not declared yet
  const btns = document.querySelectorAll<HTMLButtonElement>('#tabs [data-tab]')
  if (btns.length !== STEPS.length) return
  const welcome = document.getElementById('welcome')
  if (welcome) { welcome.hidden = !menuOpen && !!sig[0]; $('welcomeResume').hidden = !sig[0] }
  STEPS.forEach((s, i) => {
    const up = UP[i].map((j) => sig[j]).join('|')
    let state: 'todo' | 'done' | 'stale' = 'todo'
    if (i === 6) {
      if (sentSig !== null) state = sentSig === sig.slice(0, 6).join('|') ? 'done' : 'stale'
    } else if (sig[i]) {
      if (ownSnap[i] !== sig[i] || doneSnap[i] === null) { ownSnap[i] = sig[i]; doneSnap[i] = up }
      state = doneSnap[i] === up ? 'done' : 'stale'
    } else { ownSnap[i] = ''; doneSnap[i] = null }
    const b = btns[i]
    b.dataset.state = state
    b.title = `${t(s.lead)}
${t(`step.state.${state}`)}`
  })
}
// step header (title + one-line explanation) and Previous / Next
function showStep(tab: string) {
  const i = STEPS.findIndex((s) => s.tab === tab)
  if (i < 0) return
  $('stepKicker').textContent = t('step.kicker', { n: String(i + 1).padStart(2, '0'), total: String(STEPS.length).padStart(2, '0') })
  $('stepTitle').textContent = t(STEPS[i].label)
  $('stepLead').textContent = t(STEPS[i].lead)
  logEl.textContent = '' // a message from another step would only confuse
  $<HTMLButtonElement>('stepPrev').disabled = i === 0
  $<HTMLButtonElement>('stepNext').hidden = i === STEPS.length - 1
  $<HTMLButtonElement>('stepRegen').hidden = !REGEN[tab]
  try { localStorage.setItem('reforger-mapper.step', tab) } catch { /* private window */ }
}
const goStep = (d: number) => {
  const cur = tabButtons.findIndex((x) => x.classList.contains('active'))
  tabButtons[Math.min(STEPS.length - 1, Math.max(0, cur + d))]?.click()
  $('tabs').scrollIntoView({ block: 'nearest' })
}
$('stepRegen').addEventListener('click', () => {
  const tab = tabButtons.find((x) => x.classList.contains('active'))?.dataset.tab ?? ''
  if (REGEN[tab]) $<HTMLButtonElement>(REGEN[tab]).click()
})
// phone layout: the step panel folds down to its step list (drawer)
$<HTMLButtonElement>('sideToggle').addEventListener('click', (e) => {
  const min = document.querySelector('.app')!.classList.toggle('side-min')
  ;(e.currentTarget as HTMLButtonElement).setAttribute('aria-expanded', String(!min))
})
// map hint (bottom centre): can be hidden for good
{
  const K = 'reforger-mapper.mapHint'
  try { if (localStorage.getItem(K) === '0') $('mapHint').hidden = true } catch { /* private window */ }
  $<HTMLButtonElement>('mapHintX').addEventListener('click', () => { $('mapHint').hidden = true; try { localStorage.setItem(K, '0') } catch { /* */ } })
}
// help bubble + guided tour (5 stops, shown once on the first visit)
let runTour: (stops: [string, Key][]) => void = () => {}
{
  const panel = $<HTMLDivElement>('helpPanel')
  const show = (on: boolean) => { panel.hidden = !on; $('helpFab').classList.toggle('active', on); if (on) $<HTMLButtonElement>('helpClose').focus() }
  $<HTMLButtonElement>('helpFab').addEventListener('click', () => show(panel.hidden === true))
  const tabsEl = [...panel.querySelectorAll<HTMLButtonElement>('[role=tab]')]
  const pick = (id: string, focus = false) => {
    for (const b of tabsEl) {
      const on = b.id === id
      b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1
      $(b.getAttribute('aria-controls')!).hidden = !on
      if (on && focus) b.focus()
    }
  }
  tabsEl.forEach((b, i) => {
    b.addEventListener('click', () => pick(b.id))
    b.addEventListener('keydown', (e) => {
      const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
      if (d) { e.preventDefault(); pick(tabsEl[(i + d + tabsEl.length) % tabsEl.length].id, true) }
    })
  })
  const fillCur = () => {
    $('helpCurK').textContent = [$('stepKicker').textContent, $('stepTitle').textContent].filter(Boolean).join(' · ')
    $('helpCurLead').textContent = $('stepLead').textContent ?? ''
  }
  new MutationObserver(() => { if (!panel.hidden) fillCur() }).observe(panel, { attributes: true, attributeFilter: ['hidden'] })
  openHelp = (section) => {
    show(true)
    const el = section ? document.getElementById(section) : null
    pick(el?.closest('[role=tabpanel]')?.id ? 'hpt-' + el.closest('[role=tabpanel]')!.id.slice(3) : 'hpt-step')
    el?.scrollIntoView({ block: 'start' })
  }
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'F1') return
    e.preventDefault()
    if (panel.hidden) openHelp(); else show(false)
  })
  $<HTMLButtonElement>('helpClose').addEventListener('click', () => { show(false); $<HTMLButtonElement>('helpFab').focus() })
  panel.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); show(false); $<HTMLButtonElement>('helpFab').focus() } })
  panel.querySelectorAll<HTMLButtonElement>('[data-help-go]').forEach((b) => b.addEventListener('click', () => {
    document.querySelector<HTMLButtonElement>(`#tabs [data-tab="${b.dataset.helpGo}"]`)?.click(); show(false)
  }))
  const TOUR_KEY = 'reforger-mapper.tour'
  let stops: [string, Key][] = [['.app > .top', 'tour.1'], ['#tabs', 'tour.2'], ['.stage', 'tour.3'], ['.app > .side', 'tour.4'], ['#tabs [data-tab="wb"]', 'tour.5']]
  const tour = $<HTMLDivElement>('tour'), ring = tour.querySelector<HTMLDivElement>('.tourring')!, box = tour.querySelector<HTMLDivElement>('.tourbox')!
  let at = 0
  const end = () => { tour.hidden = true; if (stops !== main) return; try { localStorage.setItem(TOUR_KEY, '1') } catch { /* private window */ } }
  const place = () => {
    const el = document.querySelector<HTMLElement>(stops[at][0]); if (!el) return end()
    const r = el.getBoundingClientRect()
    Object.assign(ring.style, { left: `${r.left - 4}px`, top: `${r.top - 4}px`, width: `${r.width + 8}px`, height: `${r.height + 8}px` })
    $('tourN').textContent = `${at + 1} / ${stops.length}`
    $('tourText').textContent = t(stops[at][1])
    $('tourNext').textContent = t(at === stops.length - 1 ? 'tour.done' : 'tour.next')
    const bw = 300, bh = box.offsetHeight || 140
    let x = Math.min(Math.max(8, r.left), innerWidth - bw - 8), y = r.bottom + 12
    if (y + bh > innerHeight - 8) y = Math.max(8, r.top - bh - 12)
    if (r.height > innerHeight * 0.6) { y = Math.min(innerHeight - bh - 40, r.top + 80); x = r.left > innerWidth / 2 ? r.left - bw - 16 : Math.min(r.left + 40, innerWidth - bw - 8) }
    Object.assign(box.style, { left: `${Math.max(8, x)}px`, top: `${y}px` })
  }
  const start = () => { show(false); at = 0; tour.hidden = false; place(); $<HTMLButtonElement>('tourNext').focus() }
  $<HTMLButtonElement>('tourNext').addEventListener('click', () => { if (++at >= stops.length) end(); else place() })
  $<HTMLButtonElement>('tourSkip').addEventListener('click', end)
  tour.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); end() } })
  addEventListener('resize', () => { if (!tour.hidden) place() })
  const main = stops
  $<HTMLButtonElement>('helpTour').addEventListener('click', () => { stops = main; start() })
  runTour = (s) => { stops = s; start() }
  let seen = '1'
  try { seen = localStorage.getItem(TOUR_KEY) ?? '' } catch { /* private window: never auto-start */ }
  // never over the welcome screen: there the newcomer picks a path first, and each path offers its own mini tour
  if (!seen) setTimeout(() => { if ($('welcome').hidden) start() }, 600)
}

// --- busy panel: every long action shows its name, a bar, the time spent; buttons are greyed meanwhile ---
let busyDepth = 0, busyFailed = false, busyStop = false
const busyEl = $('busy')
document.body.append(busyEl, $('coach'), $('toast')) // above the map and side panels (own stacking context)
let busyT0 = 0, busyTick = 0, busyName = ''
const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => setTimeout(r, 0)))
/** toasts: bottom centre of the map, newest at the bottom, 3 at most; success/info fade after 4 s, errors stay until closed */
function toast(msg: string, kind: 'ok' | 'err' | 'info' = 'ok', action?: { label: string; run: () => void }, ms = 4000) {
  const box = $('toast')
  const it = document.createElement('div')
  it.className = 'toastitem'; it.dataset.kind = kind
  const mark = document.createElement('span'); mark.className = 'tmark'; mark.setAttribute('aria-hidden', 'true')
  mark.textContent = kind === 'err' ? '!' : kind === 'info' ? 'i' : '✓'
  const txt = document.createElement('span'); txt.className = 'ttext'; txt.textContent = msg
  it.append(mark, txt)
  const drop = () => { it.remove(); box.hidden = !box.childElementCount }
  if (action) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'linkbtn'; b.textContent = action.label
    b.addEventListener('click', () => { drop(); action.run() }); it.append(b)
  }
  const x = document.createElement('button'); x.type = 'button'; x.className = 'tclose'; x.textContent = '✕'
  x.title = t('help.close'); x.setAttribute('aria-label', t('help.close')); x.addEventListener('click', drop); it.append(x)
  box.append(it); box.hidden = false
  while (box.childElementCount > 3) box.firstElementChild!.remove()
  if (kind !== 'err') setTimeout(drop, ms)
}
/** stage of the current busy job: i/n gives a real bar, nothing gives an indeterminate one */
function busyStage(name: string, i?: number, n?: number, pct?: number) {
  $('busyStage').textContent = i !== undefined && n ? t('busy.stage', { i: i + 1, n, s: name }) : name
  const bar = $<HTMLProgressElement>('busyBar')
  if (pct !== undefined) { bar.max = 100; bar.value = pct } else if (i !== undefined && n) { bar.max = n; bar.value = i } else bar.removeAttribute('value')
  $('busyPct').textContent = pct !== undefined ? `${Math.round(pct)} %` : ''
}
async function busy<T>(label: string, f: () => Promise<T> | T, cancel?: () => void): Promise<T | undefined> {
  if (busyDepth++ > 0) { try { return await f() } finally { busyDepth-- } } // nested: the outer panel shows
  busyFailed = false; busyStop = false; busyName = label; busyT0 = performance.now()
  $('busyLabel').textContent = label
  busyStage(t('busy.wait'))
  $('busyPct').textContent = ''
  const cb = $<HTMLButtonElement>('busyCancel')
  cb.hidden = !cancel; cb.onclick = () => { busyStop = true; cancel?.() }
  const showTime = () => { $('busyTime').textContent = t('busy.elapsed', { s: Math.round((performance.now() - busyT0) / 1000) }) }
  showTime(); busyTick = window.setInterval(showTime, 500)
  busyEl.hidden = false
  document.body.classList.add('is-busy')
  const off = [...document.querySelectorAll<HTMLButtonElement>('.app button:not(:disabled), #welcome button:not(:disabled)')].filter((b) => !busyEl.contains(b) && b.id !== 'rwCancel') // the random-world dialog keeps its own Cancel
  off.forEach((b) => (b.disabled = true))
  await nextFrame() // let the panel paint before the heavy work starts
  try {
    const r = await f()
    const s = Math.round((performance.now() - busyT0) / 100) / 10
    if (busyStop) toast(t('busy.cancelled', { label }), 'info')
    else if (busyFailed) toast(t('busy.fail', { label }), 'err')
    else toast(t('busy.done', { label, s }))
    return r
  } catch (e) {
    toast(t('busy.fail', { label }), 'err')
    logEl.textContent = t('run.error', { label, msg: (e as Error).message })
    return undefined
  } finally {
    busyDepth = 0
    clearInterval(busyTick)
    busyEl.hidden = true
    document.body.classList.remove('is-busy')
    off.forEach((b) => (b.disabled = false))
    refreshSteps()
  }
}
void busyName
// heavy buttons: their click is held back one frame so the busy panel paints, then replayed inside busy()
const HEAVY = ['tGen', 'tReroll', 'rRun', 'wGen', 'netGen', 'sitesPlace', 'setGen', 'powerGen', 'forestGen', 'indSuggest', 'milSuggest', 'satAnalyse',
  'tSurf', 'tHeight', 'tMasks', 'tImport', 'loadTerrain', 'roadSend', 'setSend', 'forestSend', 'sendAll', 'wSend', 'zoneSend', 'satSend', 'send', 'checkRun']
let replaying = false, forceBusy = false // forceBusy: a scripted click (welcome card) that still gets the panel
let pendingJobs: Promise<unknown>[] = []
/** async handlers of heavy buttons hand their promise here so the panel stays up until they end */
function track<T>(p: Promise<T>): Promise<T> { if (busyDepth) pendingJobs.push(p); return p }
document.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest?.('button')
  if (!b || replaying || !HEAVY.includes(b.id) || b.disabled || !(e.isTrusted || forceBusy)) return
  forceBusy = false
  e.stopImmediatePropagation(); e.preventDefault()
  const label = (b.textContent || b.title || b.id).trim().replace(/\s+/g, ' ').slice(0, 60)
  void busy(label, async () => {
    pendingJobs = []
    replaying = true
    b.disabled = false // busy() greyed it; the replayed click must reach its handler
    try { b.click() } finally { replaying = false }
    b.disabled = true
    while (pendingJobs.length) { const p = pendingJobs; pendingJobs = []; await Promise.allSettled(p) }
  })
}, true)

// --- entry paths: after each way of starting, a short "next step" card + a mini tour for that path ---
type Entry = 'new' | 'real' | 'random' | 'open' | 'join'
let entry: Entry | null = null
const MINI: Record<Entry, [string, Key][]> = {
  new: [['.stage', 'mt.relief'], ['#tabs', 'mt.steps'], ['#tabs [data-tab="water"]', 'mt.water'], ['#layers', 'mt.layers'], ['#tabs [data-tab="wb"]', 'mt.send']],
  real: [['.stage', 'mt.relief'], ['#tabs', 'mt.steps'], ['#layers', 'mt.layers'], ['#tabs [data-tab="wb"]', 'mt.send']],
  random: [['.stage', 'mt.relief'], ['#tabs', 'mt.steps'], ['#layers', 'mt.layers'], ['#tabs [data-tab="wb"]', 'mt.send']],
  open: [['#tabs', 'mt.steps'], ['#tabs [data-tab="wb"]', 'mt.send']],
  join: [['#collabBox', 'mt.collab'], ['#tabs', 'mt.steps']],
}
function coachAfter(kind: Entry) {
  if (entry !== kind) return
  entry = null
  const render = () => {
    if (busyDepth) return void setTimeout(render, 150)
    // a fresh world built in one go (random / real place): every step that has content counts as done
    if (kind === 'random' || kind === 'real') { doneSnap.fill(null); ownSnap.fill(''); refreshSteps() }
    const el = $('coach')
    const btns = [...document.querySelectorAll<HTMLButtonElement>('#tabs [data-tab]')]
    $('coachKicker').textContent = t('coach.kicker')
    $('coachTitle').textContent = t(('coach.' + kind + '.t') as K)
    $('coachText').textContent = t(('coach.' + kind + '.p') as K)
    const done = STEPS.filter((_, i) => btns[i]?.dataset.state === 'done').map((x) => t(x.label))
    const todo = STEPS.filter((_, i) => btns[i]?.dataset.state !== 'done').map((x) => t(x.label))
    $('coachSteps').innerHTML = kind === 'join' ? '' : (done.length ? `<li class="ok">${t('coach.done')} : ${done.join(', ')}</li>` : '') + (todo.length ? `<li>${t('coach.todo')} : ${todo.join(', ')}</li>` : '')
    // random world / real place: everything is there, review it then send; otherwise the first step still empty
    let at = btns.findIndex((b, i) => i > 0 && b.dataset.state !== 'done')
    if (kind === 'random' || kind === 'real' || at < 0) at = 6
    const next = $<HTMLButtonElement>('coachNext')
    next.hidden = kind === 'join'
    next.textContent = t('coach.next', { s: t(STEPS[at].label) })
    next.onclick = () => { el.hidden = true; btns[at]?.click() }
    $<HTMLButtonElement>('coachTour').onclick = () => { el.hidden = true; runTour(MINI[kind]) }
    el.hidden = false
    if (kind !== 'join') next.focus()
  }
  setTimeout(render, 0)
}
$<HTMLButtonElement>('coachClose').addEventListener('click', () => { $('coach').hidden = true })
$('coach').addEventListener('keydown', (e) => { if (e.key === 'Escape') $('coach').hidden = true })
$<HTMLButtonElement>('welcomeJoin').addEventListener('click', () => { entry = 'join'; coachAfter('join'); if (!$('collab').classList.contains('active')) $<HTMLButtonElement>('collab').click(); $('collabBox').hidden = false; $<HTMLInputElement>('collabRoom').focus() })
// Mode Atelier (src/atelier/): own full-screen layout, loaded on demand; reopened after a language switch
const openAtelier = () => void import('./atelier/ui').then((m) => m.openAtelier())
$<HTMLButtonElement>('welcomeAtelier').addEventListener('click', openAtelier)
// top-left Menu: back to the welcome screen (the current map stays; "Resume" or any path card closes it)
const closeMenu = () => { menuOpen = false; if ($('welcomeResume').hidden === false) $('welcome').hidden = true }
$<HTMLButtonElement>('brandMenu').addEventListener('click', () => { menuOpen = true; $('welcome').hidden = false; $('welcomeResume').hidden || $<HTMLButtonElement>('welcomeResume').focus() })
$<HTMLButtonElement>('welcomeResume').addEventListener('click', closeMenu)
$('welcome').addEventListener('click', (e) => { if ((e.target as HTMLElement).closest('button[id^="welcome"]:not(#welcomeResume)')) menuOpen = false }, true)
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && menuOpen && !$('welcome').hidden) closeMenu() })
try { if (sessionStorage.getItem('reforger-mapper.atelier.open') === '1') openAtelier() } catch { /* storage blocked */ }
const ENTRY: Record<string, Entry> = { tGen: 'new', tRandom: 'random', tReal: 'real', pOpen: 'open' }
document.querySelectorAll<HTMLButtonElement>('#welcome [data-go]').forEach((b) => b.addEventListener('click', () => {
  entry = ENTRY[b.dataset.go!] ?? null
  forceBusy = true
  $<HTMLButtonElement>(b.dataset.go!).click()
  forceBusy = false
}))
$('stepPrev').addEventListener('click', () => goStep(-1))
$('stepNext').addEventListener('click', () => goStep(1))
{
  let saved: string | null = null
  try { saved = localStorage.getItem('reforger-mapper.step') } catch { /* private window */ }
  const b = tabButtons.find((x) => x.dataset.tab === saved)
  showStep('island')
  // after the whole module has run (the click picks a tool and redraws)
  if (b) setTimeout(() => b.click(), 0)
}
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
// tracing image (declared before the first draw, which reads it)
let traceImg: HTMLImageElement | HTMLCanvasElement | null = null
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
  inputs.powDistrib = $<HTMLSelectElement>('powDistrib').value // power distribution in settlements (a select)
  return {
    kind: 'reforger-mapper-island', version: 1, inputs, pipeline,
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
    landCover: landCover && { cols: landCover.cols, n: landCover.data.length, rle: rle(landCover.data) },
    credits,
    power: powerLines,
    powerStations,
    powerAccess,
    biome: currentBiome,
    layers: layerMap,
  }
}
function layersUi() {
  for (const l of GEN_LAYERS) {
    const el = document.getElementById('rwL_' + l) as HTMLInputElement | null
    if (el) el.value = layerMap[l]?.seed ? String(layerMap[l]!.seed) : ''
  }
  const st = new Set(staleLayers(layerMap))
  document.querySelectorAll<HTMLElement>('#rwLayers [data-stale]').forEach((b) => { b.hidden = !st.has(b.dataset.stale as LayerId) })
}
function autosave() {
  if (refReadOnly) return // a reference map never replaces the saved project
  clearTimeout(saveTimer)
  saveTimer = window.setTimeout(() => {
    const p = islandProject()
    try { if (p) localStorage.setItem(PROJECT_KEY, JSON.stringify(p)) } catch { /* storage full or blocked */ }
    if (p && collab && performance.now() > quietUntil) collab.sendProject(p)
  }, 500)
}
function loadProject(p: any) {
  if (p?.kind !== 'reforger-mapper-island') throw new Error(t('err.notIsland'))
  pipeline = readPipeline(p.pipeline)
  layerMap = p.layers && typeof p.layers === 'object' ? p.layers : {}
  layersUi()
  for (const [id, v] of Object.entries(p.inputs ?? {})) {
    if (id === 'roadFlatten') continue // per-road choice, always starts unchecked
    const el = document.getElementById(id) as HTMLInputElement | null
    if (!el) continue
    if (el.type === 'checkbox') el.checked = !!v
    else el.value = String(v)
  }
  if (p.imported) useWorld({ ...p.imported, heights: [...new Float32Array(unb64(p.imported.heights).buffer)] })
  else islandNow() // rebuilds grid + sculpt with the saved settings
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
  landCover = null
  if (p.landCover && typeof p.landCover.rle === 'string') { const d = unrle(p.landCover.rle, p.landCover.n); if (d) landCover = { cols: p.landCover.cols, data: d } }
  credits = Array.isArray(p.credits) ? p.credits : []
  powerLines = Array.isArray(p.power) ? p.power.filter((x: PowerItem) => x && POWER_DEFAULTS[x.kind] && Array.isArray(x.path)) : []
  powerStations = Array.isArray(p.powerStations) ? p.powerStations.filter((x: Station) => x && typeof x.prefab === 'string') : []
  powerAccess = Array.isArray(p.powerAccess) ? p.powerAccess.filter((x: unknown) => Array.isArray(x)) : []
  if (typeof p.trace === 'string' && p.trace.startsWith('data:image/')) {
    const img = new Image()
    img.onload = () => { traceImg = img; void saveTrace(img); draw() }
    img.src = p.trace
  }
  removed = Array.isArray(p.removed) ? p.removed : []
  setBiome(isBiome(p.biome) ? p.biome : DEFAULT_BIOME, false)
  waterInfo()
  recompose(true)
}
function setBiome(id: BiomeId, save = true) {
  currentBiome = id
  const b = biome(id)!
  document.querySelectorAll<HTMLSelectElement>('select[data-biome]').forEach((sel) => {
    sel.value = id
    sel.title = biomeTip(id)
    const badge = sel.parentElement!.querySelector<HTMLElement>('.biomebadge')!
    badge.dataset.avail = b.availability
    badge.textContent = t(('biomeAvailability.' + b.availability) as K)
    badge.title = biomeTip(id)
  })
  const ffEl = document.getElementById('ffBiomeInfo')
  if (ffEl) ffEl.textContent = t('wb.ffBiome', { name: ffBiomeName(id), value: ffBiomeValue(id) })
  if (save) autosave()
}
document.querySelectorAll<HTMLSelectElement>('select[data-biome]').forEach((sel) => sel.addEventListener('change', () => setBiome(sel.value as BiomeId)))
setBiome(currentBiome, false)
$<HTMLButtonElement>('libBtn').addEventListener('click', () => window.open('library.html', '_blank'))
$<HTMLButtonElement>('pSave').addEventListener('click', async () => {
  const p = islandProject()
  if (!p) return void (logEl.textContent = t('log.genFirst'))
  const a = document.createElement('a')
  const trace = traceImg ? await traceDataUrl(traceImg) : null
  a.href = URL.createObjectURL(new Blob([JSON.stringify(trace ? { ...p, trace } : p)], { type: 'application/json' }))
  a.download = `ile-${num('tSeed')}.json`
  a.click()
  URL.revokeObjectURL(a.href)
})
$<HTMLButtonElement>('pOpen').addEventListener('click', () => $<HTMLInputElement>('pFile').click())
$<HTMLInputElement>('pFile').addEventListener('change', async (e) => {
  const f = (e.target as HTMLInputElement).files?.[0]
  if (!f) return
  await busy(t('busy.open'), async () => {
    try {
      loadProject(JSON.parse(await f.text()))
      logEl.textContent = t('log.opened', { name: f.name })
      coachAfter('open')
    } catch (err) {
      busyFailed = true
      logEl.textContent = t('err.open', { msg: (err as Error).message })
    }
  })
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
    return toWb({ version: 0, shapes: [...allRoadShapes(), ...powerShapes()], entities: [...($<HTMLInputElement>('roadFurn').checked ? roadSigns(roads, $<HTMLInputElement>('roadLeft').checked) : []), ...stationEntities(powerStations)] })
  }),
)
roadInfo()

// --- quick road test ---
function testRoads(): Road[] {
  if (!island) islandNow()
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
      surfaces: island.surfaces, colours: { ...island.colours, ...ROAD_COLOURS }, roads: [...yardMasks(settled), ...roadMasks(roads), ...waterMasks(waters), ...roadMasks([...setLanes, ...setPaths]), ...buildingMasks(settled), ...poleDirtMasks(mergePowerLines(powerLines), num('tSeed')), ...parcelGround()],
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
  if (!island) islandNow()
  if (!island) return
  sites = pickSites(island.heights, island.grid, rivers, netParams())
  if (sites.length < 2) return void (logEl.textContent = t('log.netNone'))
  const c = (k: SiteKind) => sites.filter((x) => x.kind === k).length
  logEl.textContent = t('log.sitesDone', { n: sites.length, town: c('town'), village: c('village'), hamlet: c('hamlet') })
  recompose(true)
})
$<HTMLButtonElement>('netGen').addEventListener('click', () => {
  if (!island) islandNow()
  if (!island) return
  if (sites.length < 2) $<HTMLButtonElement>('sitesPlace').click()
  if (sites.length < 2) return
  const isl = island, keep = roads.filter((r) => !r.auto)
  // routed in the generator worker (the bar follows the tree then the loops); applied only once it is done
  void track(runGen<Road[]>('network', [isl.heights, isl.grid, rivers, sites, netParams(), keep], {
    progress: (_s, _i, _n, f) => { if (busyDepth) busyStage(t('wg.st.roads'), undefined, undefined, 100 * (f ?? 0)) },
  }).promise.then((made) => { if (island === isl) netApply(keep, made) }, (e) => { busyFailed = true; logEl.textContent = t('run.error', { label: 'network', msg: (e as Error).message }) }))
})
function netApply(keep: Road[], made: Road[]) {
  roads = keep
  for (const r of made) {
    r.auto = true
    r.id = nextRoadId(r.type)
    roads.push(r)
  }
  roads = addRoundabouts(roads, { places: sites.map((s) => ({ x: s.x, z: s.z, r: SITE_RADIUS[s.kind] })) }).roads // P3 #15: rings at busy junctions
  let km = 0
  for (const r of made) for (let i = 2; i + 1 < r.pts.length; i += 2) km += Math.hypot(r.pts[i] - r.pts[i - 2], r.pts[i + 1] - r.pts[i - 1])
  roadInfo()
  recompose(true)
  // the generator and the pre-send check share one grade limit; a road still flagged (smoothing, carving) is dropped
  const steep = new Set(runChecks().filter((it) => it.kind === 'steepRoad').map((it) => it.id))
  const drop = made.filter((r) => steep.has(r.id))
  if (drop.length) {
    roads = dropOrphanRings(roads.filter((r) => !drop.includes(r)))
    for (const r of drop) for (let i = 2; i + 1 < r.pts.length; i += 2) km -= Math.hypot(r.pts[i] - r.pts[i - 2], r.pts[i + 1] - r.pts[i - 1])
    roadInfo()
    recompose(true)
    runChecks()
  }
  // optional motorway (motorway.ts): built last, the other roads are lifted over it or cut back
  let mwMsg = ''
  if ($<HTMLInputElement>('netMotorway').checked && island) {
    const isl = island
    const mw = buildMotorway(isl.heights, isl.grid, rivers, sites, roads, { maxSlope: num('netSlope') })
    if (mw) {
      roads.push(...mw.made)
      roadInfo()
      recompose(true)
      const g = island.grid, hs = island.heights
      const at = (x: number, z: number) => hs[Math.min(g.rows - 1, Math.max(0, Math.round((z - g.minZ) / g.step))) * g.cols + Math.min(g.cols - 1, Math.max(0, Math.round((x - g.minX) / g.step)))]
      worldBridges = [...worldBridges.filter((b) => !/_OVER\d/.test(b.id ?? '')), ...overpassDecks(roads, at)]
      mwMsg = ' ' + t('log.motorway', { km: ((mw.axis.length / 2) * 0.02).toFixed(1), n: mw.interchanges.length, o: mw.overpasses })
    } else mwMsg = ' ' + t('log.motorwayNone')
  }
  logEl.textContent = t('log.netDone', { sites: sites.length, roads: made.length - drop.length, km: (km / 1000).toFixed(1) })
    + (drop.length ? ' ' + t('log.netSteep', { n: drop.length }) : '') + mwMsg
}
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
    if (!layer('names') || !placeLabel(nice(s.id), lx, ly)) continue
    ctx.lineWidth = 3
    ctx.strokeStyle = '#000b'
    ctx.strokeText(nice(s.id), lx, ly)
    ctx.fillStyle = SITE_COLOUR[s.kind]
    ctx.fillText(nice(s.id), lx, ly)
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
  for (const gd of setGardens) { // v2 back gardens
    ctx.beginPath()
    for (let i = 0; i + 1 < gd.corners.length; i += 2) { const [sx, sy] = toScreen(gd.corners[i], gd.corners[i + 1]); if (i) ctx.lineTo(sx, sy); else ctx.moveTo(sx, sy) }
    ctx.closePath()
    ctx.fillStyle = '#8fd06a40'
    ctx.fill()
  }
  for (const p of setParcels) { // biome garden dressing: fences (lines), trees (green dots), props (grey)
    ctx.strokeStyle = '#a07850'; ctx.lineWidth = 1
    for (const f of p.fences) { ctx.beginPath(); for (let i = 0; i + 1 < f.pts.length; i += 2) { const [sx, sy] = toScreen(f.pts[i], f.pts[i + 1]); if (i) ctx.lineTo(sx, sy); else ctx.moveTo(sx, sy) } ctx.stroke() }
    for (const it of p.items) { const [sx, sy] = toScreen(it.x, it.z); ctx.fillStyle = it.kind === 'tree' ? '#3f7a2e' : '#9a9a8a'; ctx.beginPath(); ctx.arc(sx, sy, it.kind === 'tree' ? 2.2 : 1.5, 0, 7); ctx.fill() }
  }
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
$<HTMLButtonElement>('setGen').addEventListener('click', () => void track((async () => {
  if (!island) return void (logEl.textContent = t('err.setNoIsland'))
  if (!sites.length) return void (logEl.textContent = t('err.setNoSites'))
  const chk = (id: string) => $<HTMLInputElement>(id).checked
  let pool: ReturnType<typeof parcelPool> | undefined
  if (chk('setParcels')) {
    try { pool = parcelPool(await loadParcels()) } catch (e) { logEl.textContent = t('err.parcels') + (e as Error).message; return }
  }
  const blocked = [...existing.objects.filter((o) => !/Prefabs\/Terrain\//.test(o.prefab)).map((o) => o.box), ...zoneBlocked(zones)]
  const allRoads = [...roads, ...existingRoads(), ...zones.flatMap((z) => z.roads)]
  const maxStreets = $<HTMLInputElement>('setMaxStreets').value.trim()
  const res = chk('setV2')
    ? settleVillages(sites, allRoads, waters, island.heights, island.grid, {
      seed: num('setSeed'), density: num('setDensity'), variant: $<HTMLSelectElement>('setVariant').value as VillageVariant,
      streets: chk('setStreets'), maxStreets: maxStreets === '' ? undefined : Number(maxStreets), farms: chk('setFarms'), church: chk('setChurch'), port: chk('setPort'), compositions: chk('setCompositions'), pool, blocked, biome: currentBiome,
    })
    : settle(sites, allRoads, waters, island.heights, island.grid, { seed: num('setSeed'), density: num('setDensity') }, { square: chk('setSquare'), lanes: chk('setLanes'), paths: chk('setPaths'), pool, blocked })
  setGardens = 'gardens' in res ? (res.gardens as typeof setGardens) : []
  setParcels = 'parcels' in res ? ((res.parcels as VillageParcel[] | undefined) ?? []) : []
  settled = res.placed
  setLanes = res.lanes
  setPaths = res.paths
  setSquares = res.squares
  setInfo()
  logEl.textContent = $<HTMLSpanElement>('setInfo').textContent
  draw()
})()))
$<HTMLButtonElement>('setClear').addEventListener('click', () => { settled = []; setLanes = []; setPaths = []; setSquares = []; setGardens = []; setParcels = []; setInfo(); draw(); refreshSteps() })
// buildings plus their lanes and footpaths (SET_* family, replaced on resend); roads and water stay
$<HTMLButtonElement>('setSend').addEventListener('click', () =>
  run(t('run.l.set'), async () => {
    if (!settled.length) throw new Error(t('err.setNone'))
    runChecks()
    return toWb({ version: 0, shapes: [...settlementShapes({ lanes: setLanes, paths: setPaths }), ...parcelShapes()], entities: [...settlementEntities(settled, settled.some((q) => q.tpl) ? parcelItems(await loadParcels(), groundAt) : undefined), ...parcelEntities()] })
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
/** forest generator of an area: the biome's own table (biomes/vegetation.ts) or the default one (Everon) */
const forestGenOf = (a: MapArea) => forestGeneratorFor(currentBiome, a.leaf ?? 'mixed', a.tall ?? 'mid') ?? FOREST_GEN[a.leaf ?? 'mixed'][a.tall ?? 'mid']
/** biome garden parcels -> entities (trees, props) and wall-generator shapes (fences) */
function parcelEntities(): ProjectEntity[] {
  const r2 = (v: number) => Math.round(v * 100) / 100
  return setParcels.flatMap((p, i) => p.items.map((it, k) => ({ id: `PARCEL_${i + 1}_${k + 1}`, prefab: it.guid, x: r2(it.x), z: r2(it.z), yaw: Math.round(it.yaw) })))
}
function parcelShapes(): ProjectShape[] {
  // neighbouring parcels share a boundary: one fence on it, not two (fenceDedupe.ts)
  const all = setParcels.flatMap((p, i) => p.fences.filter((f) => f.pts.length >= 4).map((f, k) => ({ id: `PARCEL_FENCE_${i + 1}_${k + 1}`, f })))
  const kept = dedupeLines(all.map((a) => a.f.pts))
  return all.flatMap((a, j) => kept[j].map((pts, n) => ({ id: kept[j].length > 1 ? `${a.id}_${n + 1}` : a.id, kind: 'polyline' as const, closed: false, points: densify(pts).map((v) => Math.round(v * 100) / 100), generator: a.f.guid })))
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
    for (const x of o.roads) roads.push({ id: nextRoadId(x.type), type: x.type, pts: x.pts, ...(x.width ? { width: x.width } : {}), ...(x.bridge ? { bridge: true } : {}) })
    for (const x of o.rivers) waters.push({ id: nextWaterId('river'), type: 'river', pts: x.pts, width: x.width, depth: 1.5 })
    for (const x of o.lakes) waters.push({ id: nextWaterId('lake'), type: 'lake', pts: x, width: 0, depth: 2 })
    for (const s of o.sites) sites.push({ id: nextSiteId(s.kind), x: s.x, z: s.z, kind: s.kind })
    o.forests.forEach((f, k) => areas.push({ id: `FOREST_OSM_${k + 1}`, kind: 'forest', leaf: f.leaf, ...(f.tall ? { tall: f.tall } : {}), pts: f.pts }))
    o.fields.forEach((f, k) => areas.push({ id: `FIELD_OSM_${k + 1}`, kind: 'field', pts: f }))
    if (o.buildings.length) { const b = osmBuildings(o.buildings); settled = b.placed; bSkipped = b.skipped; setInfo() }
  }
  const ex = r.extras // local .osm / .geojson import (osmImport.ts)
  if (ex) {
    // residential landuse -> a village / hamlet site at the centre of the area (the generators build on it)
    for (const z of ex.zones) {
      if (z.kind !== 'residential') continue
      let x = 0, y = 0, a = 0
      const n = z.pts.length / 2
      for (let k = 0; k < n; k++) { x += z.pts[2 * k]; y += z.pts[2 * k + 1]; const j = (k + 1) % n; a += z.pts[2 * k] * z.pts[2 * j + 1] - z.pts[2 * j] * z.pts[2 * k + 1] }
      const kind = Math.abs(a / 2) > 150000 ? 'village' : 'hamlet'
      sites.push({ id: nextSiteId(kind), x: Math.round(x / n), z: Math.round(y / n), kind })
    }
    ex.power.forEach((l, k) => {
      const kind = powerKindOf(l.voltage), spacing = POWER_DEFAULTS[kind].spacing
      let length = 0
      for (let i = 2; i < l.pts.length; i += 2) length += Math.hypot(l.pts[i] - l.pts[i - 2], l.pts[i + 1] - l.pts[i - 1])
      powerLines.push({ id: `POWER_OSM_${k + 1}`, kind, spacing, path: l.pts, poles: placePoles(l.pts, spacing), length })
    })
    if (ex.power.length) powerInfo()
  }
  credits = r.credits
  if (r.cover) landCover = { cols: r.world.cols, data: r.cover }
  if (r.trace) { traceImg = r.trace; $<HTMLDetailsElement>('layers').open = true; void saveTrace(r.trace) }
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
  }) + (r.adapted ? '\n' + t('log.adapted', { f0: r.adapted.before.forests, f1: r.adapted.after.forests, r0: r.adapted.before.roads, r1: r.adapted.after.roads, b0: r.adapted.before.buildings, b1: r.adapted.after.buildings }) : '') + (o?.buildings.length ? '\n' + t('log.realBld', { n: o.buildings.length - bSkipped, skip: bSkipped }) : '') + (ex ? '\n' + t('log.realImport', { res: ex.zones.filter((z) => z.kind === 'residential').length, ind: ex.zones.filter((z) => z.kind === 'industrial').length, pw: ex.power.length, sub: ex.substations.length }) : '') + (r.warn ? '\n' + r.warn : '') + String.fromCharCode(10) + t('log.realNext') + (credits.length ? '\n' + t('log.credits', { list: credits.join(' · ') }) : '')
  toast(t('busy.done', { label: t('welcome.real'), s: '' }).replace(/ \(\s*s\)/, ''))
  coachAfter('real')
}
$<HTMLButtonElement>('tReal').addEventListener('click', () => openRealWorld(applyRealPlace))

// --- Bohemia reference maps (public/refmaps, tools/PakTools/export_ref_map.py): read-only, drawn with the
// site's own renderers (roads, buildings, forest areas, lakes, power) to compare with a generated map
let refStatsRef: { name: string; s: MapStats } | null = null
let refStatsOurs: { name: string; s: MapStats } | null = null
function oursStats(): MapStats {
  const g = island!.grid
  const rr: StatRoad[] = [...roads, ...setLanes, ...setPaths].map((r) => ({ type: r.type, pts: r.pts, half: roadHalf(r) }))
  const bld = settled.map((b) => ({ x: b.x, z: b.z, house: b.role === 'house' || b.role === 'farmhouse' || (!b.role && /^house/.test(b.cat)) }))
  const forest = areas.filter((a) => a.kind === 'forest').reduce((s, a) => s + polyArea(a.pts) - (a.holes ?? []).reduce((h, p) => h + polyArea(p), 0), 0)
  return mapStats(rr, bld, forest, (g.cols - 1) * g.step * (g.rows - 1) * g.step, null)
}
function renderRefStats() {
  const box = $<HTMLDivElement>('refStats')
  const cols = [refStatsRef, refStatsOurs].filter((c): c is { name: string; s: MapStats } => !!c)
  box.hidden = !cols.length
  if (!cols.length) return
  const f = (v: number) => (Number.isFinite(v) ? String(v) : '—')
  const tr = (v: [number, number, number]) => `${f(v[1])} (${f(v[0])}–${f(v[2])})`
  const types = [...new Set(cols.flatMap((c) => Object.keys(c.s.roadKm)))].sort((a, b) => (cols[0].s.roadKm[b] ?? 0) - (cols[0].s.roadKm[a] ?? 0))
  const rows: [string, (s: MapStats) => string][] = [
    [t('ref.st.houses'), (s) => String(s.houses)],
    [t('ref.st.villages'), (s) => String(s.villages)],
    [t('ref.st.perVillage'), (s) => tr(s.housesPerVillage)],
    [t('ref.st.setback'), (s) => tr(s.setback)],
    [t('ref.st.forest'), (s) => `${s.forestPct} %`],
    [t('ref.st.trees'), (s) => (s.treesPerHa == null ? '—' : String(s.treesPerHa))],
    ...types.map((k) => [`${t('ref.st.km')} ${t(('road.type.' + k) as Key)}`, (s: MapStats) => f(s.roadKm[k] ?? 0)] as [string, (s: MapStats) => string]),
  ]
  box.innerHTML = `<table class="ref-stats"><tr><th></th>${cols.map((c) => `<th>${c.name}</th>`).join('')}</tr>${rows.map(([l, g]) => `<tr><td>${l}</td>${cols.map((c) => `<td>${g(c.s)}</td>`).join('')}</tr>`).join('')}</table><small>${t('ref.st.note')}</small>`
}
function applyRefMap(m: RefMap, id: RefMapId) {
  // the generated map in place is measured first, so both columns can be compared
  if (!refReadOnly && island && (roads.length || settled.length)) refStatsOurs = { name: t('ref.ours'), s: oursStats() }
  if (m.heights) {
    const hb = m.heights
    useWorld({ minX: m.minX, minZ: m.minZ, step: hb.step, cols: hb.cols, rows: hb.rows, ocean: 0, heights: refHeights(hb), materials: ['Grass_01'], surfaces: new Array(hb.cols * hb.rows).fill(0) })
  } else {
    const step = 16, n = Math.round(m.size / step) + 1
    useWorld({ minX: m.minX, minZ: m.minZ, step, cols: n, rows: n, ocean: 0, heights: new Array(n * n).fill(5), materials: ['Grass_01'], surfaces: new Array(n * n).fill(0) })
  }
  const byGen = new Map(Object.entries(ROAD_TYPES).filter(([k]) => k !== 'motorway').map(([k, v]) => [v.generator.replace(/^.*\//, '').replace(/\.et$/, '').toLowerCase(), k as RoadType]))
  for (const r of m.roads) {
    const g = r.gen.replace(/^.*\//, '').replace(/\.et$/, '').toLowerCase()
    const type = byGen.get(g) ?? (/runway/.test(g) ? 'concrete' : roadTypeOf({ generators: [r.gen], closed: false, origin: [0, 0], points: [] }) ?? 'asphalt')
    roads.push({ id: nextRoadId(type), type, pts: r.pts, ...(r.w > 0 ? { width: r.w } : {}) })
  }
  for (const l of m.lakes2 ?? m.lakes.map((pts) => ({ pts, level: 0, lake: 1 }))) waters.push({ id: nextWaterId('lake'), type: 'lake', pts: l.pts, width: 0, depth: 2, ...(m.heights ? { level: l.level } : {}) })
  for (const l of m.rivers2 ?? m.rivers.map((pts) => ({ pts, w: 8 }))) waters.push({ id: nextWaterId('river'), type: 'river', pts: l.pts, width: l.w, depth: 1.5 })
  const mask = forestMask(m.trees)
  const tc = m.trees
  if (m.forests) for (const f of m.forests) for (const pts of [f.pts, ...(f.parts ?? [])]) areas.push({ id: `FOREST_REF_${areas.length + 1}`, kind: 'forest', leaf: f.leaf, pts, holes: pts === f.pts ? f.holes : [] })
  else maskOutlines(mask, tc.cols, tc.rows, tc.cell, tc.minX, tc.minZ).forEach((o, k) => areas.push({ id: `FOREST_REF_${k + 1}`, kind: 'forest', leaf: 'mixed', pts: o.pts, holes: o.holes }))
  settled = refBuildings(m)
  existing = { objects: [], shapes: refFences(m).map((p) => ({ generators: ['Fence'], closed: false, origin: p[0], points: p })) }
  m.power.forEach((l, k) => {
    const kind: PowerKind = (l as { kind?: PowerKind }).kind ?? (/HV|High|Pylon|Lattice/i.test(l.pf) ? 'hv' : 'mv')
    let length = 0
    for (let i = 2; i < l.pts.length; i += 2) length += Math.hypot(l.pts[i] - l.pts[i - 2], l.pts[i + 1] - l.pts[i - 1])
    powerLines.push({ id: `POWER_REF_${k + 1}`, kind, spacing: POWER_DEFAULTS[kind].spacing, path: l.pts, poles: l.pts, length })
  })
  let fc = 0
  for (const v of mask) fc += v
  // forest share from the smooth outlines when present (hectares -> grid cells for mapStats)
  if (m.forests) fc = m.forests.reduce((a, f) => a + f.ha, 0) * 1e4 / (tc.cell * tc.cell)
  const rr: StatRoad[] = roads.map((r) => ({ type: r.type, pts: r.pts, half: roadHalf(r) }))
  const bld = m.buildings.items.map(([, x, z, , cls]) => ({ x, z, house: cls === 'house' }))
  refStatsRef = { name: t(('ref.map.' + id) as Key), s: mapStats(rr, bld, fc * tc.cell * tc.cell, m.size * m.size, treesPerHa(tc, mask)) }
  setRefReadOnly(true)
  // the rain simulation only makes sense on the real relief (flat placeholder ground would grow fake rivers)
  $<HTMLInputElement>('rLive').checked = !!m.heights
  setInfo(); powerInfo(); waterInfo(); roadInfo()
  recompose(true)
  draw()
  renderRefStats()
  logEl.textContent = t('log.ref', { name: refStatsRef.name, km: (m.size / 1000).toFixed(1), roads: m.roads.length, bld: m.buildings.items.length, fences: m.fences.items.length, forests: areas.length, trees: tc.total, src: tc.source, relief: m.heights ? (getLang() === 'fr' ? ', relief du jeu' : ', game relief') : (getLang() === 'fr' ? ', sans relief' : ', no relief') })
}
$<HTMLButtonElement>('tRef').addEventListener('click', () => {
  const id = $<HTMLSelectElement>('tRefMap').value as RefMapId
  void busy(t('btn.tRef'), async () => applyRefMap(await loadRefMap(id), id)).catch((e) => toast(String(e), 'err'))
})
$<HTMLButtonElement>('tRefStats').addEventListener('click', () => {
  if (!island) return toast(t('err.genFirst'), 'err')
  if (!refReadOnly) refStatsOurs = { name: t('ref.ours'), s: oursStats() }
  renderRefStats()
})
// tracing image (satellite / ortho photo / scanned map) stretched over the whole terrain, north up;
// only shown here, never sent to the game; kept in IndexedDB across reloads (src/traceStore.ts) and
// embedded in a saved project file when it is small enough (< 8 MB), never in the autosave
function drawTrace() {
  if (!traceImg || !terrain || !$<HTMLInputElement>('satShow').checked) return
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
  img.onload = () => { traceImg = img; draw(); void saveTrace(f).then((ok) => { if (!ok) logEl.textContent += ' · ' + t('log.traceNotKept') }); logEl.textContent = t('log.trace', { name: f.name, w: img.width, h: img.height }) }
  img.onerror = () => { logEl.textContent = t('err.traceImg', { name: f.name }) }
  img.src = URL.createObjectURL(f)
})
$<HTMLInputElement>('traceAlpha').addEventListener('input', () => draw())
$<HTMLButtonElement>('traceClear').addEventListener('click', () => { if (traceImg instanceof HTMLImageElement) URL.revokeObjectURL(traceImg.src); traceImg = null; $<HTMLInputElement>('traceFile').value = ''; void saveTrace(null); draw() })
/** countryside polygons (random world): light yellow wash + bold dashed yellow outline under the plots */
function drawCountryside() {
  ctx.save()
  ctx.setLineDash([14, 7]); ctx.lineWidth = 2.5
  for (const p of countryside) {
    ctx.beginPath()
    for (let k = 0; k < p.length; k += 2) { const [sx, sy] = toScreen(p[k], p[k + 1]); if (k) ctx.lineTo(sx, sy); else ctx.moveTo(sx, sy) }
    ctx.closePath()
    ctx.fillStyle = 'rgba(255, 200, 40, 0.10)'; ctx.fill()
    ctx.strokeStyle = 'rgba(255, 196, 0, 0.95)'; ctx.stroke()
  }
  ctx.restore()
}
/** riparian patches: reeds (pale green-yellow) on the water edge, willows (dark green) behind */
function drawRiparian() {
  ripaWatch()
  for (const p of riparian) {
    ctx.beginPath()
    for (let k = 0; k < p.pts.length; k += 2) { const [sx, sy] = toScreen(p.pts[k], p.pts[k + 1]); if (k) ctx.lineTo(sx, sy); else ctx.moveTo(sx, sy) }
    ctx.closePath()
    ctx.fillStyle = p.kind === 'reed' ? 'rgba(190,200,90,0.6)' : 'rgba(40,120,70,0.55)'
    ctx.fill()
    ctx.strokeStyle = p.kind === 'reed' ? 'rgba(210,215,110,0.95)' : 'rgba(60,150,90,0.95)'
    ctx.lineWidth = 1
    ctx.stroke()
  }
}
function drawAreas() {
  for (const a of areas) {
    ctx.beginPath()
    for (const ring of [a.pts, ...(a.holes ?? [])]) {
      for (let k = 0; k < ring.length; k += 2) { const [sx, sy] = toScreen(ring[k], ring[k + 1]); if (k) ctx.lineTo(sx, sy); else ctx.moveTo(sx, sy) }
      ctx.closePath()
    }
    ctx.fillStyle = a.kind === 'forest' ? (a.stage === 'juvenile' ? 'rgba(110,170,60,0.4)' : a.stage === 'thinned' ? 'rgba(60,130,60,0.22)' : 'rgba(40,110,40,0.38)') : 'rgba(200,180,80,0.18)'
    ctx.fill('evenodd')
    ctx.setLineDash(a.kind === 'forest' ? [] : [5, 4])
    ctx.strokeStyle = a.kind === 'forest' ? 'rgba(70,160,70,0.9)' : 'rgba(220,200,110,0.8)'
    ctx.lineWidth = 1.2
    ctx.stroke()
    ctx.setLineDash([])
    if (a.logs?.length) { ctx.fillStyle = 'rgba(130,80,35,0.95)'; for (const l of a.logs) { const [sx, sy] = toScreen(l.x, l.z); ctx.fillRect(sx - 2, sy - 2, 4, 4) } }
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
/** forest shapes sent to the Workbench: with progressive edges (forestEdge.ts) a dense core + 1-2 sparser bands */
function forestShapesOut(f: MapArea[]): ProjectShape[] {
  if (!$<HTMLInputElement>('forestEdge').checked) return f.map((a) => ({ id: a.id, kind: 'polyline', closed: true, points: a.pts, generator: forestGenOf(a), avoid: FOREST_AVOID }))
  return forestEdgeShapes(forestEdges(f.map((a) => ({ id: a.id, pts: a.pts, leaf: a.leaf, generator: forestGenOf(a), noEdge: a.stage === 'juvenile' || a.stage === 'clearcut' }))))
}
// forests: one closed shape per area with the forest generator matching the OSM leaf type (FOREST_ family)
$<HTMLButtonElement>('forestSend').addEventListener('click', () =>
  run(t('run.l.forests'), async () => {
    const f = areas.filter((a) => a.kind === 'forest')
    if (!f.length) throw new Error(t('err.noForest'))
    return toWb({ version: 0, shapes: forestShapesOut(f), entities: prodLogEntities() })
  }),
)
// everything at once (roads + water, forests, buildings): one project, the log says what went
$<HTMLDivElement>('modsBox').append(modsChecklist())
$<HTMLButtonElement>('sendAll').addEventListener('click', () =>
  run(t('run.l.all'), async () => {
    const wr: Project = waters.length && island ? waterAndRoads() : { version: 0, shapes: allRoadShapes(), entities: $<HTMLInputElement>('roadFurn').checked ? roadSigns(roads, $<HTMLInputElement>('roadLeft').checked) : [] }
    const forests = forestShapesOut(areas.filter((a) => a.kind === 'forest'))
    const setShapes = settled.length ? [...settlementShapes({ lanes: setLanes, paths: setPaths }), ...parcelShapes()] : []
    const setEnts = settled.length ? settlementEntities(settled, settled.some((q) => q.tpl) ? parcelItems(await loadParcels(), groundAt) : undefined).concat(parcelEntities()) : []
    const shapes = [...wr.shapes, ...(result?.shapes ?? []), ...powerShapes(), ...forests, ...setShapes, ...zones.flatMap((z) => z.shapes)], entities = [...(wr.entities ?? []), ...setEnts, ...zones.flatMap((z) => z.entities), ...prodLogEntities(), ...stationEntities(powerStations)]
    if (!shapes.length && !entities.length) throw new Error(t('err.nothingToSend'))
    const what = t('log.sending', { roads: roads.length, waters: waters.length, forests: forests.length, buildings: settled.length, shapes: shapes.length, objects: entities.length })
      + (powerLines.length ? ' · ' + t('log.sendingPower', { n: powerLines.length }) : '')
    const deps = modDepsText(entities.map((e) => e.prefab)), depsEl = $<HTMLPreElement>('modDeps')
    depsEl.textContent = deps; depsEl.hidden = !deps
    // relief first: objects are dropped on the ground that is there when they are created
    const relief = island ? (await applyHeightmap({ ...island.grid, heights: island.heights })).message + '\n' : ''
    const msg = relief + await toWb({ version: 0, shapes, entities }) + (deps ? '\n' + deps : '')
    sentSig = stepSigs().slice(0, 6).join('|')
    addOp({ kind: 'history', action: 'send', detail: '', step: 'wb', x: view.x, z: view.z })
    refreshSteps()
    return what + '\n' + msg
  }),
)
$<HTMLButtonElement>('areasClear').addEventListener('click', () => { areas = []; recompose(true); draw(); autosave() })
// forests for a fictive island (a real place brings its own): replaces the previously generated ones only
$<HTMLButtonElement>('forestGen').addEventListener('click', () => {
  if (!island) return void (logEl.textContent = t('log.genFirst'))
  const isl = island
  void track(runGen<ReturnType<typeof generateForests>>('forests', [isl.heights, isl.grid, { seed: num('tSeed'), cover: 0.35, sites, biome: currentBiome }]).promise.then((made) => {
    if (island !== isl) return
    areas = areas.filter((a) => !a.id.startsWith('FOREST_GEN_'))
    made.forEach((f, k) => areas.push({ id: `FOREST_GEN_${k + 1}`, kind: 'forest', leaf: f.leaf, pts: f.pts }))
    logEl.textContent = made.length ? t('log.forestGen', { n: made.length }) : t('err.forestGenNone')
    recompose(true); draw(); autosave()
  }, (e) => { busyFailed = true; logEl.textContent = t('run.error', { label: 'forests', msg: (e as Error).message }) }))
})

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
//! generated decks (valley bridges, overpasses, #15 stream culverts): a strip along +X from the pivot, culverts in ochre
function drawWorldDecks() {
  for (const e of worldBridges) {
    if (!/_DECK_/.test(e.id ?? '')) continue
    const len = /Long|Wide/.test(e.prefab) ? 26 : 13, a = (e.yaw * Math.PI) / 180
    const [x0, y0] = toScreen(e.x, e.z), [x1, y1] = toScreen(e.x + Math.cos(a) * len, e.z - Math.sin(a) * len)
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1)
    ctx.strokeStyle = /_CULVERT/.test(e.id ?? '') ? '#d9a441' : '#c8c8c8'
    ctx.lineWidth = Math.max(3, 6 / view.mpp); ctx.stroke()
  }
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
    // river / lake names only at close zoom (like road names), never on top of another label
    if (w !== waterDraft && layer('names') && view.mpp < 2.5) {
      let lx = 0, lz = 0
      if (wt.closed) { for (const [x, zz] of ring) { lx += x / ring.length; lz += zz / ring.length } }
      else [lx, lz] = ring[Math.floor(ring.length / 2)]
      const [px, py] = toScreen(lx, lz)
      ctx.font = 'bold 11px sans-serif'
      if (!placeLabel(nice(w.id), px, py - 6, true)) continue
      ctx.textAlign = 'center'
      ctx.lineWidth = 3
      ctx.strokeStyle = '#000'
      ctx.strokeText(nice(w.id), px, py - 6)
      ctx.fillStyle = '#ff0'
      ctx.fillText(nice(w.id), px, py - 6)
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
  if (!island) islandNow()
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
      surfaces: island.surfaces, colours: { ...island.colours, ...ROAD_COLOURS }, roads: [...yardMasks(settled), ...roadMasks(roads), ...waterMasks(waters), ...roadMasks([...setLanes, ...setPaths]), ...buildingMasks(settled), ...poleDirtMasks(mergePowerLines(powerLines), num('tSeed')), ...parcelGround()],
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
    shapes: [...allWaterShapes(), ...split.shapes, ...($<HTMLInputElement>('wRipa').checked ? riparianShapes(riparian, { autumn: isAutumnBiome(biome(currentBiome)) }) : [])],
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

// riparian band along the drawn rivers / lakes: width from the height above the water + the bank grade
// drawn rivers / lakes edited: the band follows (debounced), forests are left alone then
function ripaSigOf() { return waters.map((w) => `${w.id}:${w.type}:${w.width}:${w.pts.length}:${w.pts.reduce((a, b) => a + b, 0).toFixed(1)}`).join('|') }
function ripaWatch() {
  const sig = ripaSigOf()
  if (sig === ripaSig) return
  const first = !ripaSig
  ripaSig = sig
  if (first || !riparian.length || !$<HTMLInputElement>('wRipa').checked) return
  clearTimeout(ripaTimer)
  ripaTimer = window.setTimeout(() => { if (!island || !$<HTMLInputElement>('wRipa').checked) return; riparian = waters.length ? makeRiparian() : []; draw() }, 600)
}
/** cut = the band takes the forest edge (forests cut along it) instead of stopping at the forest */
function makeRiparian(cut = false) {
  if (!island) return []
  const ring = (b: number[][]) => b.flat()
  const out = riparianBands(island.heights, island.grid, waters, {
    seed: num('tSeed') || 1,
    roads: [...roads, ...setLanes, ...setPaths, ...zones.flatMap((z) => z.roads)].filter((r) => r.pts.length >= 4).map((r) => ({ pts: r.pts, half: roadHalf(r) })),
    polys: [...areas.filter((a) => !cut || a.kind !== 'forest').map((a) => a.pts), ...(result?.fields ?? []).map(ring), ...zones.flatMap((z) => z.boxes.filter((b) => b.corners.length >= 8).map((b) => b.corners))],
    points: [...sites.map((q) => ({ x: q.x, z: q.z, r: SITE_RADIUS[q.kind] })), ...settled.map((b) => ({ x: b.x, z: b.z, r: 12 })), ...worldBridges.map((b) => ({ x: b.x, z: b.z, r: 20 }))],
  })
  if (cut) { const c = cutForests(areas, out); areas.splice(0, areas.length, ...c) }
  return out
}
$<HTMLButtonElement>('wRipaGen').addEventListener('click', () => {
  if (!island || !waters.length) return void (logEl.textContent = t('err.noWater'))
  riparian = makeRiparian(true)
  ripaSig = ripaSigOf()
  $<HTMLInputElement>('wRipa').checked = true
  logEl.textContent = t('log.ripa', { n: riparian.length, reed: riparian.filter((p) => p.kind === 'reed').length })
  draw()
})
$<HTMLInputElement>('wRipa').addEventListener('change', (e) => {
  if ((e.target as HTMLInputElement).checked && !riparian.length && island && waters.length) riparian = makeRiparian()
  if (!(e.target as HTMLInputElement).checked) riparian = []
  draw()
})
// roads (and their barriers) cut where they cross water: the gap is left for a bridge
// --- power lines (step Routes): HV between the main sites, LV from the grid into each village along roads ---
const POWER_COLOUR: Record<PowerKind, string> = { ehv: '#5ec8ff', hv: '#ffd24a', mv: '#ff8a3a', lv: '#e8e2c8' }
function powerShapes() { return [...mergePowerLines(powerLines).map((l) => powerLineShape(l, l.id)), ...accessShapes(powerAccess)] }
function powerInfo() {
  const km = powerLines.reduce((n, l) => n + l.length, 0) / 1000
  const poles = powerLines.reduce((n, l) => n + l.poles.length / 2, 0)
  $('powerInfo').textContent = powerLines.length ? t('power.info', { n: powerLines.length, km: km.toFixed(1), poles }) : ''
}
function drawPower() {
  ctx.strokeStyle = '#9a7b55'; ctx.lineWidth = 2; ctx.setLineDash([3, 2])
  for (const a of powerAccess) { ctx.beginPath(); const [x0, y0] = toScreen(a[0], a[1]), [x1, y1] = toScreen(a[2], a[3]); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke() }
  ctx.setLineDash([])
  for (const q of powerStations) { // footprint rectangle, gate side = +Z local
    const c = Math.cos(q.yaw), sn = Math.sin(q.yaw)
    ctx.beginPath()
    for (const [u, v] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { const lx = (u * q.w) / 2, lz = (v * q.d) / 2; const [x, y] = toScreen(q.x + lx * c + lz * sn, q.z - lx * sn + lz * c); ctx.lineTo(x, y) }
    ctx.closePath(); ctx.fillStyle = '#c050ffaa'; ctx.fill(); ctx.strokeStyle = '#000'; ctx.lineWidth = 1; ctx.stroke()
    const [x, y] = toScreen(q.x, q.z); ctx.fillStyle = '#c050ff'; ctx.beginPath(); ctx.arc(x, y, q.kind === 'mvlv' ? 3 : 5, 0, Math.PI * 2); ctx.fill(); ctx.stroke()
  }
  for (const l of powerLines) {
    ctx.beginPath()
    for (let i = 0; i + 1 < l.path.length; i += 2) { const [x, y] = toScreen(l.path[i], l.path[i + 1]); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y) }
    ctx.strokeStyle = '#000a'; ctx.lineWidth = l.kind === 'lv' ? 3 : 4; ctx.setLineDash([]); ctx.stroke()
    ctx.strokeStyle = POWER_COLOUR[l.kind]; ctx.lineWidth = l.kind === 'lv' ? 1.2 : 2; ctx.setLineDash(l.kind === 'lv' ? [5, 3] : []); ctx.stroke()
    ctx.setLineDash([])
    const r = l.kind === 'lv' ? 2 : 3
    if (l.spacing && l.spacing / view.mpp < 4) continue // too far out: poles would make a solid line
    ctx.fillStyle = POWER_COLOUR[l.kind]
    for (let i = 0; i + 1 < l.poles.length; i += 2) {
      const [x, y] = toScreen(l.poles[i], l.poles[i + 1])
      ctx.fillRect(x - r, y - r, 2 * r, 2 * r)
      ctx.strokeStyle = '#000'; ctx.lineWidth = 1; ctx.strokeRect(x - r, y - r, 2 * r, 2 * r)
    }
  }
}
function generatePower() {
  if (!island) return void (logEl.textContent = t('log.genFirst'))
  const g = island.grid, h = island.heights
  if (!sites.length) return void (logEl.textContent = t('err.powerNoSites'))
  const isWater = (x: number, z: number) => {
    const c = Math.round((x - g.minX) / g.step), r = Math.round((z - g.minZ) / g.step)
    return (h[r * g.cols + c] ?? 0) <= 0.3
  }
  const roadPts = [...roads, ...existingRoads()].map((r) => r.pts)
  const gs: GridSite[] = [
    ...sites.map((q) => ({ id: q.id, x: q.x, z: q.z, kind: q.kind, r: SITE_RADIUS[q.kind] })),
    ...zones.filter((z) => z.kind === 'industrial').map((z) => ({ id: z.id, x: z.x, z: z.z, kind: 'industry' as const, r: 100 })),
  ]
  const chk = (id: string) => $<HTMLInputElement>(id).checked
  const ehv = $<HTMLSelectElement>('powEHV').value
  const t0 = performance.now()
  // hierarchical planner: EHV backbone, HV tree between towns, MV feeders to every village / industry, LV
  // along the streets; stations at each level change (pads flattened in the height grid, like the zones)
  // airfields and military bases: no line or plant across them
  const avoid = zones.filter((z) => z.kind === 'airfield' || z.kind === 'military').map((z) => {
    let r = 60
    for (const b of z.boxes) for (let i = 0; i + 1 < b.corners.length; i += 2) r = Math.max(r, Math.hypot(b.corners[i] - z.x, b.corners[i + 1] - z.z))
    return { x: z.x, z: z.z, r: r + 30 }
  })
  const plan = planGrid({ heights: h, grid: g, sites: gs, roads: roadPts, isWater, size: (g.cols - 1) * g.step, avoid, world: powerWorld([...roads, ...existingRoads()], settled.map((b) => b.corners), [], zones) }, {
    style: $<HTMLSelectElement>('powStyle').value as PowerStyle,
    ehv: ehv === 'auto' ? 'auto' : ehv === 'on', hv: chk('powHV'), mv: chk('powMV'), lv: chk('powLV'),
    mvMax: num('powMVMax'), lvMax: num('powLVMax'), distrib: $<HTMLSelectElement>('powDistrib').value as PowerDistrib,
    plants: $<HTMLSelectElement>('powPlants').value === 'auto' ? 'auto' : Number($<HTMLSelectElement>('powPlants').value),
  })
  powerLines = plan.lines; powerStations = plan.stations; powerAccess = plan.access
  if (!powerLines.length) return void (logEl.textContent = t('err.powerNone'))
  powerInfo(); draw(); checkpoint(); autosave(); refreshSteps()
  logEl.textContent = t('log.power', { n: powerLines.length, failed: plan.failed, ms: Math.round(performance.now() - t0) })
    + ' · ' + t('log.powerStations', { n: powerStations.length, unfed: plan.unfed.length })
}
$<HTMLButtonElement>('powerGen').addEventListener('click', () => {
  generatePower()
})
$<HTMLButtonElement>('powerClear').addEventListener('click', () => { powerLines = []; powerStations = []; powerAccess = []; powerInfo(); draw(); checkpoint(); autosave(); refreshSteps() })
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
  // P3 #17: low stone walls where a paved road crosses a village (none in front of houses)
  const near = (x: number, z: number, r: number) => settled.reduce((c, b) => c + (Math.abs(b.x - x) < r && Math.abs(b.z - z) < r ? 1 : 0), 0)
  const walls = villageWalls(roads, (x, z) => near(x, z, 45) >= 3, (x, z) => near(x, z, 9) > 0)
  // roadside lines stop at the mouth of every joining / crossing road (half width + 2 m each side)
  const gapRoads = roads.filter((r) => r.pts.length >= 4).map((r) => ({ id: r.id, line: centreLine(r.pts, 5), half: roadHalf(r) }))
  // #17: extra rails at bridge approaches (valley spans + kept water gaps) and on the outer side of bends on slopes
  const rails = extraGuardrails(roads, heightAt, roadGaps().filter((g) => !noBridge.has(gapKey(g))), { drop: num('furnDrop') })
  return [...shapes, ...cutAtRoads([...dropCoveredPosts(roadFurniture(roads, heightAt, num('furnDrop'), num('furnPost')), rails), ...rails, ...walls], gapRoads)]
}

document.querySelectorAll<HTMLInputElement>('#layers [data-layer]').forEach((el) => el.addEventListener('change', () => {
  if (el.checked) hiddenLayers.delete(el.dataset.layer!)
  else hiddenLayers.add(el.dataset.layer!)
  if (el.dataset.layer === 'runoff') showIsland() // the runoff is baked into the relief image
  else draw()
}))

// --- checks before sending: markers on the map + list in the Workbench tab; never blocks a send ---
function runChecks() {
  if (!island) return (issues = [])
  const ids = new Set(roads.map((r) => r.id))
  issues = validate({
    roads, sites, settled, power: powerLines, heights: island.heights, grid: island.grid, areas, zones, surfaces: island.surfaces,
    refusedGaps: roadGaps().filter((g) => ids.has(g.id) && noBridge.has(gapKey(g))),
    budget: { platform: budgetPlatform(), grid: (density = contentDensity()) },
  })
  // #1: building overlaps, objects on a road, zone objects off the map (logic of scripts/mg-audit.mjs)
  const g0 = island.grid
  issues = [...issues, ...preSendChecks({
    width: (g0.cols - 1) * g0.step, height: (g0.rows - 1) * g0.step, settled, zones,
    roads: [...roads.map((r) => ({ r, zone: undefined as number | undefined })), ...zones.flatMap((zn, k) => zn.roads.map((r) => ({ r, zone: k })))]
      .filter(({ r }) => r.pts.length >= 4).map(({ r, zone }) => ({ id: r.id, half: roadHalf(r), line: centreLine(r.pts, 4), zone })),
  })]
  $('checkDensity').textContent = t('check.density', { n: Math.round(density.total), max: PLATFORM_BUDGETS[budgetPlatform()].total })
  const list = $<HTMLUListElement>('checkList')
  list.innerHTML = ''
  for (const it of issues) {
    const li = document.createElement('li')
    li.textContent = t(('check.' + it.kind) as Parameters<typeof t>[0], { id: it.id, v: it.value ?? '' })
    li.addEventListener('click', () => { view.x = it.x; view.z = it.z; view.mpp = Math.min(view.mpp, 0.6); draw() })
    const fix = 'fix' in it ? it.fix : undefined
    if (fix) {
      const b = document.createElement('button')
      b.type = 'button'; b.className = 'secondary fixone'
      b.textContent = t(fix.op === 'drop' ? 'check.fixDrop' : 'check.fixMove')
      b.addEventListener('click', (e) => { e.stopPropagation(); fixIssues([fix]) })
      li.append(' ', b)
    }
    list.append(li)
  }
  const fixes = issues.flatMap((it) => ('fix' in it && it.fix ? [it.fix] : []))
  const all = $<HTMLButtonElement>('checkFixAll')
  all.hidden = !fixes.length
  all.textContent = t('check.fixAll', { n: fixes.length })
  all.onclick = () => fixIssues(fixes)
  if (!issues.length) list.innerHTML = `<li class="ok">${t('check.none')}</li>`
  draw()
  return issues
}
/** #1 auto-fix: drop / nudge the objects, then check again */
function fixIssues(fixes: NonNullable<PreIssue['fix']>[]) {
  const n = applyFixes(fixes, settled, zones)
  autosave()
  runChecks()
  logEl.textContent = t('check.fixed', { n })
}
/** road shapes of the imported world, as roads the villages can line up on (never sent back) */
function existingRoads(): Road[] {
  return existing.shapes
    .filter((s) => s.generators.some((g) => /Road/i.test(g)))
    .map((s, i) => ({ id: `EXIST_${i}`, type: 'asphalt' as RoadType, pts: s.points.flat() }))
}
/** fence and wall pieces (generator 'Fence', reference maps): drawn above the forest and the buildings */
function drawFences() {
  ctx.beginPath()
  for (const s of existing.shapes) {
    if (s.generators[0] !== 'Fence') continue
    s.points.forEach(([x, z], i) => { const [sx, sy] = toScreen(x, z); if (i) ctx.lineTo(sx, sy); else ctx.moveTo(sx, sy) })
  }
  ctx.strokeStyle = 'rgba(120,80,40,0.95)'
  ctx.lineWidth = Math.max(1.5, 0.8 / view.mpp)
  ctx.stroke()
}
function drawExisting() {
  for (const s of existing.shapes) {
    if (s.generators[0] === 'Fence') continue
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
const budgetPlatform = () => (($<HTMLSelectElement>('checkPlatform')?.value) || 'xss') as Platform
function contentDensity() {
  const g = island!.grid
  const objects = [...settled, ...zones.flatMap((zn) => zn.entities)]
  return densityGrid({ width: (g.cols - 1) * g.step, height: (g.rows - 1) * g.step, objects, forests: areas.filter((a) => a.kind === 'forest').map((a) => a.pts) })
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
$<HTMLSelectElement>('checkPlatform').addEventListener('change', () => { if (issues.length || density) runChecks() })
$<HTMLButtonElement>('checkRun').addEventListener('click', () => {
  const n = runChecks().length
  logEl.textContent = n ? t('log.checkIssues', { n }) : t('check.none')
})

// restore the autosaved project last: loading it redraws, which needs every declaration above
try {
  const saved = localStorage.getItem(PROJECT_KEY)
  if (saved) { loadProject(JSON.parse(saved)); logEl.textContent = t('log.restored') }
} catch (err) { console.warn('autosave not restored', err) }

// the satellite / tracing image comes back from IndexedDB (async: drawn when ready)
void loadTrace().then((img) => { if (img && !traceImg) { traceImg = img; draw(); renderCollab() } })

// first paint once everything is declared
draw()
refreshStatus()

// floating panels: only one open at a time (help, collab connect form, language list, layers); Esc closes them
{
  const news = $<HTMLDivElement>('newsPanel')
  const help = $<HTMLDivElement>('helpPanel'), box = $<HTMLDivElement>('collabBox'), lang = $<HTMLDivElement>('langMenu')
  const layers = $<HTMLDetailsElement>('layers')
  const isOpen = (el: HTMLElement) => (el === layers ? layers.open : !el.hidden)
  const close = (el: HTMLElement) => {
    if (el === layers) layers.open = false
    else el.hidden = true
    if (el === help) $('helpFab').classList.remove('active')
    if (el === lang) $('lang').setAttribute('aria-expanded', 'false')
  }
  const all: HTMLElement[] = [help, news, box, lang, layers]
  const mo = new MutationObserver((recs) => {
    for (const r of recs) {
      const el = r.target as HTMLElement
      if (isOpen(el)) for (const o of all) if (o !== el && isOpen(o)) close(o)
    }
  })
  for (const el of all) mo.observe(el, { attributes: true, attributeFilter: [el === layers ? 'open' : 'hidden'] })
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return
    for (const o of all) if (isOpen(o)) close(o)
  })
}

// "What's new" panel (data: src/data/changelog.ts): help panel button, status-bar version, toast once per new version
{
  const panel = $<HTMLDivElement>('newsPanel')
  const READ_KEY = 'reforger-mapper.newsRead'
  const dot = $('verDot')
  try { dot.hidden = localStorage.getItem(READ_KEY) === APP_VERSION } catch { dot.hidden = true }
  if (!dot.hidden) $('verLink').title = t('news.unread')
  const open = () => {
    panel.hidden = false; $<HTMLButtonElement>('newsClose').focus()
    dot.hidden = true; $('verLink').title = t('news.ver', { v: APP_VERSION })
    try { localStorage.setItem(READ_KEY, APP_VERSION) } catch { /* private window */ }
  }
  const shut = () => { panel.hidden = true; $<HTMLButtonElement>('verLink').focus() }
  $<HTMLButtonElement>('verLink').addEventListener('click', () => (panel.hidden ? open() : shut()))
  $<HTMLButtonElement>('helpNews').addEventListener('click', open)
  $<HTMLButtonElement>('newsClose').addEventListener('click', shut)
  $<HTMLButtonElement>('newsOk').addEventListener('click', shut)
  panel.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); shut() } })
  const SEEN_KEY = 'reforger-mapper.seenVersion'
  let seen: string | null = null, fresh = true
  try { seen = localStorage.getItem(SEEN_KEY); localStorage.setItem(SEEN_KEY, APP_VERSION) } catch { fresh = false /* private window: no toast */ }
  // only after an update (a first-ever visit gets the welcome screen and the tour instead)
  if (fresh && seen !== null && seen !== APP_VERSION) setTimeout(() => toast(t('news.toast', { v: APP_VERSION }), 'info', { label: t('news.see'), run: open }, 9000), 1500)
}

// --- big sites (tab Villages): industrial zones, military bases, airfields (zones.ts) ---
// "Suggest" ranks spots on the map; the next click places the site (on a numbered spot or anywhere)
function drawZones() {
  ctx.lineCap = 'round'
  for (const zn of zones) {
    for (const b of zn.boxes) {
      ctx.beginPath()
      for (let i = 0; i + 1 < b.corners.length; i += 2) { const [sx, sy] = toScreen(b.corners[i], b.corners[i + 1]); if (i) ctx.lineTo(sx, sy); else ctx.moveTo(sx, sy) }
      ctx.closePath()
      ctx.fillStyle = ZONE_FILL[b.role] ?? (zn.kind === 'industrial' ? '#b07a4a' : zn.kind === 'military' ? '#6a7d4a' : '#9aa4b0')
      ctx.fill()
      ctx.strokeStyle = '#222a'
      ctx.lineWidth = 1
      ctx.stroke()
    }
    for (const sh of zn.shapes) {
      const w = sh.paramKeys?.includes('RoadWidth') ? Number(sh.paramValues?.[sh.paramKeys.indexOf('RoadWidth')]) : 0
      ctx.beginPath()
      for (let i = 0; i + 1 < sh.points.length; i += 2) { const [sx, sy] = toScreen(sh.points[i], sh.points[i + 1]); if (i) ctx.lineTo(sx, sy); else ctx.moveTo(sx, sy) }
      ctx.strokeStyle = w ? '#8c8c8c' : zn.kind === 'military' ? '#c8d0a0' : '#e0e0e0'
      ctx.lineWidth = w ? Math.max(2, w / view.mpp) : 1.5
      ctx.setLineDash(w ? [] : [4, 3])
      ctx.stroke()
      ctx.setLineDash([])
    }
    if (zn.sub === 'fieldtrees' || zn.sub === 'scatter') continue // scattered over the whole countryside: no label at its centroid
    const [sx, sy] = toScreen(zn.x, zn.z)
    ctx.font = '11px sans-serif'
    ctx.lineWidth = 3
    ctx.strokeStyle = '#000a'
    ctx.fillStyle = '#fff'
    const label = zn.kind === 'site' ? (t(('zt.' + zn.sub) as K) ?? (zn.sub?.startsWith('vanilla:') ? zn.sub.split(':')[1].replace(/_/g, ' ') : zn.sub ?? '')) : t(('zone.name.' + zn.kind) as K, { n: zn.id.replace(/\D+/g, '') })
    ctx.strokeText(label, sx + 8, sy - 8)
    ctx.fillText(label, sx + 8, sy - 8)
  }
  zoneCands.forEach((c, i) => {
    const [sx, sy] = toScreen(c.x, c.z)
    ctx.beginPath()
    ctx.arc(sx, sy, 11, 0, Math.PI * 2)
    ctx.fillStyle = i === 0 ? '#ffd24acc' : '#ffffffaa'
    ctx.fill()
    ctx.strokeStyle = '#000'
    ctx.lineWidth = 1.5
    ctx.stroke()
    ctx.fillStyle = '#000'
    ctx.font = 'bold 12px sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText(String(i + 1), sx, sy + 4)
    ctx.textAlign = 'start'
  })
}
const siteDiscs = (extra: number) => sites.map((q) => ({ x: q.x, z: q.z, r: SITE_RADIUS[q.kind] + extra }))
function zoneInfo() {
  const n = (k: ZoneKind) => zones.filter((z) => z.kind === k).length
  $('indInfo').textContent = n('industrial') ? t('zone.info.ind', { n: n('industrial') }) : ''
  $('milInfo').textContent = n('military') || n('airfield') ? t('zone.info.mil', { n: n('military'), a: n('airfield') }) : ''
}
function startPick(kind: ZoneKind, sub: string, cands: { x: number; z: number; yaw: number }[]) {
  zonePick = { kind, sub }
  zoneCands = cands
  map.style.cursor = 'copy'
  logEl.textContent = cands.length ? t('log.zonePick', { n: cands.length }) : t('log.zonePickNone')
  draw()
}
function endPick() {
  zonePick = null
  zoneCands = []
  setTool(currentTool)
  draw()
}
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && zonePick) { endPick(); logEl.textContent = '' } })
function placeZone(sx: number, sy: number) {
  if (!island || !zonePick) return
  const [wx, wz] = toWorld(sx, sy)
  let best = -1, bd = 30
  zoneCands.forEach((c, i) => { const [cx, cy] = toScreen(c.x, c.z); const d = Math.hypot(cx - sx, cy - sy); if (d < bd) { bd = d; best = i } })
  const near = zoneCands.reduce<{ yaw: number; d: number }>((m, c) => { const d = Math.hypot(c.x - wx, c.z - wz); return d < m.d ? { yaw: c.yaw, d } : m }, { yaw: 0, d: Infinity })
  const at = best >= 0 ? zoneCands[best] : { x: wx, z: wz, yaw: near.yaw }
  const { kind, sub } = zonePick
  const g = island.grid, id = nextZoneId(zones, kind)
  let zn: ZoneItem
  if (kind === 'industrial') zn = makeIndustrial(island.heights, g, [...roads, ...existingRoads()], { id, type: sub as IndustrialType, x: at.x, z: at.z, seed: num('indSeed') + zones.length })
  else if (kind === 'military') zn = makeMilitary(island.heights, g, { id, kind: sub as MilitaryKind, x: at.x, z: at.z, yaw: at.yaw, seed: num('milSeed') + zones.length })
  else zn = makeAirfield(island.heights, g, { id, size: sub as AirfieldSize, x: at.x, z: at.z, yaw: at.yaw, seed: num('milSeed') + zones.length })
  endPick()
  if (!zn.entities.length && !zn.shapes.length) return void (logEl.textContent = t('err.zoneEmpty'))
  zones.push(zn)
  recompose(true)
  setInfo()
  zoneInfo()
  refreshSteps()
  logEl.textContent = t('log.zoneMade', { name: t(('zone.name.' + kind) as K, { n: id.replace(/\D+/g, '') }), b: zn.entities.length }) + (zn.warnings.length ? ' · ' + zn.warnings.join(' · ') : '')
}
$<HTMLButtonElement>('indSuggest').addEventListener('click', () => {
  if (!island) return void (logEl.textContent = t('log.genFirst'))
  const all = [...roads, ...existingRoads()]
  if (!all.length) return void (logEl.textContent = t('err.zoneNoRoads'))
  const g = island.grid, h = island.heights
  const isWater = (x: number, z: number) => groundAt(x, z) <= 0.5
  const c = suggestIndustrialSites(groundAt, all, {
    type: $<HTMLSelectElement>('indType').value as IndustrialType, n: 5, isWater,
    bounds: { minX: g.minX, minZ: g.minZ, maxX: g.minX + (g.cols - 1) * g.step, maxZ: g.minZ + (g.rows - 1) * g.step },
    villages: [...siteDiscs(40), ...zones.map(zoneDisc)],
  })
  void h
  startPick('industrial', $<HTMLSelectElement>('indType').value, c.map((q) => ({ x: q.x, z: q.z, yaw: 0 })))
})
$<HTMLButtonElement>('milSuggest').addEventListener('click', () => {
  if (!island) return void (logEl.textContent = t('log.genFirst'))
  const what = $<HTMLSelectElement>('milWhat').value
  const keepOut = [...siteDiscs(300), ...zones.map((z) => { const d = zoneDisc(z); return { ...d, r: d.r + 100 } })]
  if (what.startsWith('air-')) {
    const size = what.slice(4) as AirfieldSize
    startPick('airfield', size, suggestAirfield(island.heights, island.grid, { size, seaLevel: 0, keepOut, count: 5 }).map((q) => ({ x: q.x, z: q.z, yaw: q.yaw })))
  } else {
    const kind = what as MilitaryKind
    startPick('military', kind, suggestMilitary(island.heights, island.grid, { kind, seaLevel: 0, keepOut, roads: [...roads, ...existingRoads()].map((r) => r.pts), count: 5 }).map((q) => ({ x: q.x, z: q.z, yaw: q.yaw })))
  }
})
function clearZones(kinds: ZoneKind[]) {
  if (!zones.some((z) => kinds.includes(z.kind))) return
  zones = zones.filter((z) => !kinds.includes(z.kind))
  recompose(true)
  setInfo()
  zoneInfo()
  refreshSteps()
}
$<HTMLSelectElement>('zoneType').addEventListener('change', () => { $('zoneHaRow').hidden = $<HTMLSelectElement>('zoneType').value !== 'scattered'; $('zoneLeafRow').hidden = !['forest', 'production'].includes($<HTMLSelectElement>('zoneType').value); $('zoneFactionRow').hidden = $<HTMLSelectElement>('zoneType').value !== 'camp'; $('zoneDensRow').hidden = $<HTMLSelectElement>('zoneType').value !== 'habitation' })
$<HTMLButtonElement>('indClear').addEventListener('click', () => clearZones(['industrial']))
$<HTMLButtonElement>('milClear').addEventListener('click', () => clearZones(['military', 'airfield']))
$<HTMLButtonElement>('zoneSend').addEventListener('click', () =>
  run(t('run.l.zones'), async () => {
    if (!zones.length) throw new Error(t('err.zoneNone'))
    return t('log.zoneSendRelief') + '\n' + (await toWb({ version: 0, shapes: zones.flatMap((z) => z.shapes), entities: zones.flatMap((z) => z.entities) }))
  }),
)
zoneInfo()

// --- surfaces from the satellite photo (tab Fields): 5 colours -> 5 surfaces (satmask.ts, idea by Jove Chiere) ---
const SAT_SURFACES = [...new Set([...Object.keys(SURFACE_COLOURS), 'ForestDeciduous_01_Base', 'ForestConiferous_01_Base', 'Crop_Field_01', 'Heather_01', 'Concrete_01', 'Dirt_01', 'SeaBed_01'])].sort()
function satAvail() {
  const ok = !!traceImg && !!island
  $('satNone').hidden = ok
  for (const id of ['satAnalyse', 'satSend', 'satPng']) $<HTMLButtonElement>(id).disabled = !ok || (id !== 'satAnalyse' && !satQ)
}
function drawSatPreview() {
  satAvail()
  if (!satCanvas || !island || !$<HTMLInputElement>('satPreview').checked) return
  const g = island.grid
  const [x0, y0] = toScreen(g.minX, g.minZ + (g.rows - 1) * g.step)
  const [x1, y1] = toScreen(g.minX + (g.cols - 1) * g.step, g.minZ)
  ctx.save()
  ctx.globalAlpha = 0.6
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(satCanvas, x0, y0, x1 - x0, y1 - y0)
  ctx.restore()
}
function satSurfaces() {
  if (!satQ || !island) return null
  const g = island.grid
  return satelliteSurfaces(satQ, g, { surfaces: satSurf, bounds: { minX: g.minX, minZ: g.minZ, maxX: g.minX + (g.cols - 1) * g.step, maxZ: g.minZ + (g.rows - 1) * g.step } })
}
function renderSwatches() {
  const ul = $('satSwatches')
  ul.textContent = ''
  if (!satQ) return
  satQ.palette.forEach(([r, gg, b], i) => {
    const li = el('li')
    const sw = el('i', 'swatch')
    sw.style.background = `rgb(${r},${gg},${b})`
    const pct = el('span', 'hint', `${Math.round(satQ!.share[i] * 100)} %`)
    const sel = el('select')
    sel.setAttribute('aria-label', t('sat.pick', { n: i + 1 }))
    for (const k of SAT_SURFACES) { const o = el('option', '', k); o.value = k; sel.append(o) }
    sel.value = satSurf[i]
    sel.addEventListener('change', () => { satSurf[i] = sel.value })
    li.append(sw, pct, sel)
    ul.append(li)
  })
}
$<HTMLButtonElement>('satAnalyse').addEventListener('click', () => {
  if (!traceImg || !island) return
  const t0 = performance.now()
  const src = traceImg, w0 = src.width, h0 = src.height, k = Math.min(1, 1024 / Math.max(w0, h0))
  const cv = document.createElement('canvas')
  cv.width = Math.max(1, Math.round(w0 * k)); cv.height = Math.max(1, Math.round(h0 * k))
  const c2 = cv.getContext('2d')!
  c2.drawImage(src, 0, 0, cv.width, cv.height)
  const img = c2.getImageData(0, 0, cv.width, cv.height)
  const sm = num('satSmooth')
  const isl = island
  void track(runGen<Quantised>('quantise', [{ width: img.width, height: img.height, data: img.data }, { k: 5, blur: sm, median: sm > 0, minRegion: sm * 8 }]).promise.then((q) => {
    if (island === isl) satApply(q, t0)
  }, (e) => { busyFailed = true; logEl.textContent = t('run.error', { label: 'satellite', msg: (e as Error).message }) }))
})
function satApply(q: Quantised, t0: number) {
  satQ = q
  satSurf = suggestSurfaces(satQ).map((s) => (SAT_SURFACES.includes(s) ? s : SAT_SURFACES[0]))
  const pv = previewRgba(satQ)
  satCanvas = document.createElement('canvas')
  satCanvas.width = satQ.width; satCanvas.height = satQ.height
  satCanvas.getContext('2d')!.putImageData(new ImageData(Uint8ClampedArray.from(pv), satQ.width, satQ.height), 0, 0)
  renderSwatches()
  $('satInfo').textContent = t('sat.done', { w: satQ.width, h: satQ.height, ms: Math.round(performance.now() - t0) })
  draw()
}
$<HTMLInputElement>('satPreview').addEventListener('change', () => draw())
$<HTMLButtonElement>('satPng').addEventListener('click', () => {
  const s = satSurfaces()
  if (!s) return
  const chans = [...new Set(satSurf)]
  const { png, legend } = packRgbaMask(s, chans.slice(0, 5))
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([png as BlobPart], { type: 'image/png' }))
  a.download = `masque-satellite-${num('tSeed')}.png`
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  $('satInfo').textContent = t('sat.legend', { l: Object.entries(legend).map(([c, n]) => `${c} = ${n}`).join(' · ') })
})
$<HTMLButtonElement>('satSend').addEventListener('click', () =>
  run(t('run.l.sat'), async () => {
    const s = satSurfaces()
    if (!s || !island) throw new Error(t('sat.none'))
    const r = await writeMasks({
      addon: txt('tAddon'), world: txt('tWorld'), terrainSize: num('tSize'),
      surfaces: s, colours: { ...island.colours, ...ROAD_COLOURS }, roads: [...yardMasks(settled), ...roadMasks(roads), ...waterMasks(waters), ...roadMasks([...setLanes, ...setPaths]), ...buildingMasks(settled), ...poleDirtMasks(mergePowerLines(powerLines), num('tSeed')), ...parcelGround()],
    })
    return t('test.masks', { dir: r.dir })
  }),
)
satAvail()

// --- random world (worldgen.ts): one seed -> relief, water, places, sites, roads, villages, power, forests ---
const rwDlg = $<HTMLDivElement>('rwDlg')
let rwBusy = false
const RW_SLIDERS = ['towns', 'villages', 'hamlets', 'industry', 'military', 'forests'] as const
for (const k of RW_SLIDERS) {
  const inp = $<HTMLInputElement>('rw_' + k), out = $('rw_' + k + '_v')
  inp.addEventListener('input', () => { out.textContent = `×${Number(inp.value).toFixed(2).replace(/\.?0+$/, '')}` })
  out.textContent = '×1'
}
const rollSeed = () => { $<HTMLInputElement>('rwSeed').value = String(1 + Math.floor(Math.random() * 999999)) }
$<HTMLButtonElement>('rwDice').addEventListener('click', () => { rollSeed(); layerMap = setGlobalSeed(layerMap); layersUi(); autosave() })
$<HTMLInputElement>('rwSeed').addEventListener('change', () => { layerMap = setGlobalSeed(layerMap); layersUi(); autosave() })
for (const l of GEN_LAYERS) $<HTMLInputElement>('rwL_' + l).addEventListener('change', (e) => {
  const v = Math.floor(Number((e.target as HTMLInputElement).value))
  layerMap = setLayerSeed(layerMap, l, v > 0 ? v : undefined); layersUi(); autosave()
})
/** per-layer seed table for the generator: only the overridden layers (absent = derived from the global seed) */
function layerSeedTable(): Partial<Record<LayerId, number>> | undefined {
  const out: Partial<Record<LayerId, number>> = {}
  for (const l of GEN_LAYERS) { const s = layerMap[l]?.seed; if (typeof s === 'number' && s > 0) out[l] = s }
  return Object.keys(out).length ? out : undefined
}
$<HTMLButtonElement>('tRandom').addEventListener('click', () => {
  if (rwBusy) return
  rollSeed()
  $<HTMLSelectElement>('rwSize').value = String(WORLD_DEFAULTS.size)
  $('rwRun').hidden = true
  rwDlg.hidden = false
  $<HTMLButtonElement>('rwGo').focus()
})
$<HTMLButtonElement>('rwCancel').addEventListener('click', () => { if (rwBusy) $<HTMLButtonElement>('busyCancel').click(); else rwDlg.hidden = true })
rwDlg.addEventListener('keydown', (e) => { if (e.key === 'Escape') $<HTMLButtonElement>('rwCancel').click() })
function applyWorld(w: WorldResult) {
  const set = (id: string, v: number) => { $<HTMLInputElement>(id).value = String(v) }
  set('tSize', w.island.size); set('tSeed', w.island.seed); set('tMax', w.island.maxHeight); set('tSea', w.island.seaDepth)
  set('tLand', w.island.landRatio); set('tRough', w.island.roughness); set('tIslands', 1); set('tSeaLevel', 0)
  set('rThreshold', 400); set('rRain', 1); set('rWind', 0)
  $<HTMLInputElement>('rLive').checked = true
  islandNow() // same island (same function and seed), fresh sculpt + history base
  waters = w.waters
  sites = w.sites
  roads = w.roads
  powerLines = w.power
  powerStations = w.powerStations ?? []; powerAccess = w.powerAccess ?? []
  areas = w.areas.map((a) => ({ id: a.id, kind: a.kind, leaf: a.leaf, pts: a.pts, ...(a.tall && { tall: a.tall }), ...(a.stage && { stage: a.stage }), ...(a.logs && { logs: a.logs }) }))
  result = w.campaign ?? null
  settled = w.settlement.placed; setLanes = w.settlement.lanes; setPaths = w.settlement.paths; setSquares = w.settlement.squares
  setGardens = []
  setParcels = [...(w.settlement.parcels ?? []), ...(w.settlement.fences ?? [])]
  zones = w.zones
  worldBridges = w.bridges ?? []
  countryside = w.countryside ?? []
  riparian = w.riparian ?? []; ripaSig = ripaSigOf(); $<HTMLInputElement>('wRipa').checked = riparian.length > 0
  pendingAct = 'rwGo'
  doneSnap.fill(null); ownSnap.fill('') // a fresh world: every step that has content counts as done
  waterInfo(); roadInfo(); powerInfo(); zoneInfo()
  recompose(true)
  setInfo()
  draw()
  refreshSteps()
}
// share of the run time of each stage (8 km bench): the bar moves by real time, not by stage count
const WG_WEIGHT: Record<string, number> = { relief: 4, water: 3, sites: 1, airfield: 1, military: 2, roads: 60, industry: 14, villages: 5, power: 6, forests: 1, surfaces: 3 }
function worldPct(s: string, f = 0) {
  let tot = 0, before = 0
  for (const k of WORLD_STAGES) { if (k === s) before = tot; tot += WG_WEIGHT[k] }
  return (100 * (before + WG_WEIGHT[s] * Math.min(1, f))) / tot
}
let replayParams: Record<string, unknown> | undefined // set by "Replay all": run a recorded step instead of the dialog
let rwKeepOpen = false
/** run the whole world pipeline (dialog settings or replayParams); records the step, returns its output hashes */
async function worldGo(): Promise<Record<string, string> | undefined> {
  if (rwBusy) return
  rwBusy = true
  const box = rwDlg.querySelector('.rwbox') as HTMLElement
  box.querySelectorAll('input,select,button').forEach((x) => { if (x.id !== 'rwCancel') (x as HTMLInputElement).disabled = true })
  $<HTMLButtonElement>('rwGo').disabled = true
  $('rwRun').hidden = false
  box.classList.add('running'); document.body.classList.add('rw-running')
  const prog = $<HTMLProgressElement>('rwProg'), stage = $('rwStage')
  prog.value = 0; $('rwPct').textContent = '0 %'; $('rwEta').textContent = ''
  const steps = [...$('rwSteps').children] as HTMLElement[]
  steps.forEach((li) => delete li.dataset.state)
  const v = (k: string) => Number($<HTMLInputElement>('rw_' + k).value)
  const t0 = performance.now()
  $('rwSeedK').textContent = t('wg.run.k', { seed: Number(replayParams?.seed) || Math.floor(Number($<HTMLInputElement>('rwSeed').value)) || 1 })
  const timer = stageTimer()
  const fromDlg = {
    seed: Math.floor(Number($<HTMLInputElement>('rwSeed').value)) || 1, size: Number($<HTMLSelectElement>('rwSize').value),
    towns: v('towns'), villages: v('villages'), hamlets: v('hamlets'), industry: v('industry'), military: v('military'), forests: v('forests'), fieldTrees: v('fieldTrees'),
    airfield: $<HTMLInputElement>('rwAir').checked, power: $<HTMLInputElement>('rwPower').checked, biome: currentBiome, motorway: $<HTMLInputElement>('rwMotorway').checked, dams: $<HTMLInputElement>('rwDams').checked,
    vanillaSites: $<HTMLInputElement>('rwVanillaSites').checked, villageTemplates: $<HTMLInputElement>('rwVillageTpl').checked,
    powerDistrib: $<HTMLSelectElement>('rwPowDistrib').value as PowerDistrib,
    layerSeeds: layerSeedTable(),
  }
  const params = (replayParams as unknown as typeof fromDlg | undefined) ?? fromDlg
  // the whole pipeline runs in the generator worker: the page (busy panel, bar, Cancel) stays live.
  // Nothing is applied until it succeeds, so Cancel leaves the current map as it was.
  const job = runGen<WorldResult>('world', [params], {
    progress: (s, i, n, f) => {
      timer.tick(s)
      for (const li of steps) { const ms = timer.ms[li.dataset.st ?? '']; if (ms !== undefined && li.dataset.st !== s) li.dataset.ms = `${Math.round(ms)} ms` }
      const pct = worldPct(s, f)
      prog.max = 100; prog.value = pct
      const txt = t('wg.stage', { i: i + 1, n, s: t(('wg.st.' + s) as K) })
      stage.textContent = txt
      const el = (performance.now() - t0) / 1000
      $('rwPct').textContent = `${Math.round(pct)} %`
      $('rwEta').textContent = pct > 3 && pct < 100 ? t('wg.eta', { s: Math.max(1, Math.round((el * (100 - pct)) / pct)) }) : t('busy.elapsed', { s: Math.round(el) })
      const at = WORLD_STAGES.indexOf(s as (typeof WORLD_STAGES)[number])
      steps.forEach((li, j) => { li.dataset.state = j < at ? 'done' : j === at ? 'now' : '' })
      busyStage(t(('wg.st.' + s) as K), i, n, pct)
    },
  })
  try {
    const w = await busy(t('welcome.random'), async () => {
      try { return await job.promise } catch (e) { if (e instanceof Cancelled) return undefined; throw e }
    }, () => job.cancel())
    if (!w) { stage.textContent = t('wg.cancelled'); return }
    for (const l of GEN_LAYERS) layerMap = markBuilt(layerMap, l)
    layersUi()
    prog.value = 100
    $('rwPct').textContent = '100 %'; $('rwEta').textContent = t('busy.elapsed', { s: Math.round((performance.now() - t0) / 1000) })
    const stages = timer.end(), hash = hashWorld(w)
    steps.forEach((li) => { li.dataset.state = 'done'; const ms = stages[li.dataset.st ?? '']; if (ms !== undefined) li.dataset.ms = `${ms} ms` })
    applyWorld(w)
    pipeline = recordStep(pipeline, { id: 'world', params: { ...params }, seed: params.seed, inputs: [], ms: Math.round(performance.now() - t0), stages, hash })
    if (!rwKeepOpen) rwDlg.hidden = true
    coachAfter('random')
    const c = (k: string) => w.sites.filter((q) => q.kind === k && !q.id.startsWith('FARM_')).length
    logEl.textContent = t('log.world', {
      seed: w.params.seed, town: c('town'), village: c('village'), hamlet: c('hamlet'), farm: w.sites.filter((q) => q.id.startsWith('FARM_')).length, roads: w.roads.length, zones: w.zones.length,
      b: w.settlement.placed.length, ms: Math.round(performance.now() - t0),
    }) + (w.issues.length ? ' · ' + t('log.worldIssues', { n: w.issues.length }) : '') + (job.inWorker ? '' : ' · ' + t('log.noWorker'))
  } catch (e) {
    stage.textContent = (e as Error).message
  } finally {
    rwBusy = false
    box.classList.remove('running'); document.body.classList.remove('rw-running')
    box.querySelectorAll('input,select,button').forEach((x) => ((x as HTMLInputElement).disabled = false))
    $<HTMLButtonElement>('rwGo').disabled = false
  }
  return pipeline.steps[pipeline.steps.length - 1]?.hash
}
$<HTMLButtonElement>('rwGo').addEventListener('click', () => { rwKeepOpen = false; void worldGo() })
// "Relief in one click": relief -> rivers -> roads -> villages -> fields -> forests -> power with the current settings
$<HTMLButtonElement>('oneClick').addEventListener('click', () => {
  if (rwBusy) return
  rwKeepOpen = true; rwDlg.hidden = false
  void worldGo()
})
// seed explorer (ui/seedBrowser.ts): a card click runs the world pipeline with that seed's exact params
// "Économie Life" (ui/lifeEconomyTab.ts): RP chains over the road graph, read-only unless "Appliquer" is clicked
mountLifeEconomy({
  world: () => ({ roads, zones, sites, fields: result?.fields, crops: result?.crops }),
  redraw: () => draw(),
  retag: (id, role) => { const zn = zones.find((z) => z.id === id); if (zn) (zn as { rpRole?: string }).rpRole = role },
})
mountSeedBrowser({
  settings: () => ({ size: Number($<HTMLSelectElement>('rwSize').value), biome: currentBiome }),
  load: (p) => {
    if (rwBusy) return
    $<HTMLInputElement>('rwSeed').value = String(p.seed)
    rwKeepOpen = false; rwDlg.hidden = false; replayParams = p as unknown as Record<string, unknown>
    void worldGo().finally(() => { replayParams = undefined })
  },
})
// "Replay all": every recorded step again, in order, from scratch; the output hashes must match the recorded ones
$<HTMLButtonElement>('replayAll').addEventListener('click', async () => {
  if (rwBusy) return
  if (!pipeline.steps.length) { logEl.textContent = t('replay.none'); return }
  rwKeepOpen = true; rwDlg.hidden = false
  const rep = await replayPipeline(pipeline, async (s) => {
    if (s.id !== 'world') return {}
    replayParams = { ...s.params, seed: s.seed }
    try { return await worldGo() } finally { replayParams = undefined }
  })
  if (!rep) return
  const same = rep.every((r) => r.same !== false)
  $('rwStage').textContent = logEl.textContent = t('replay.done', { n: rep.length, ms: rep.reduce((a, r) => a + r.ms, 0) }) + ' · ' + t(same ? 'replay.same' : 'replay.diff')
})

// --- 3D view (src/view3d, loaded on demand: three.js stays out of the main bundle) ---
type View3DMod = typeof import('./view3d')
const BLD_H: Record<string, number> = { houseS: 5, houseM: 7, houseL: 9, farm: 7, annex: 3.5, shed: 4, civic: 12, block: 15 }
/** 3D pole heights per voltage (m, vanilla WoodenSmall ~8, concrete ~11, HV_02 ~22, EHV_01 ~35) */
const POLE_H: Record<PowerKind, number> = { lv: 8, mv: 11, hv: 22, ehv: 35 }
/** zone boxes that are ground surfaces (plots, paving, base area): draped, never 3D blocks */
const FLAT_ROLES = new Set(['lot', 'pave', 'area'])
function box3d(c: number[], h: number) {
  const cx = (c[0] + c[2] + c[4] + c[6]) / 4, cz = (c[1] + c[3] + c[5] + c[7]) / 4
  const w = Math.hypot(c[2] - c[0], c[3] - c[1]), d = Math.hypot(c[4] - c[2], c[5] - c[3])
  return { cx, cz, w: Math.max(1, w), d: Math.max(1, d), h, yaw: Math.atan2(c[3] - c[1], c[2] - c[0]) }
}
/** trees scattered in the forest areas, OpsTrack-like: spaced trees (min ~7 m apart, the ground shows between crowns),
 *  natural clearings from a low-frequency noise, bushes along the edges and in the undergrowth; capped at ~400 k.
 *  needle: 0 = broadleaf, 1 = conifer, 2 = bush; size factor (1 = typical) in the 3rd float */
/** 3D: reeds as low bushes, willows as bushes with a few broadleaf trees, scattered in the riparian patches */
function withRiparianTrees(f: { pts: Float32Array; needle: Uint8Array }) {
  const pts = Array.from(f.pts), needle = Array.from(f.needle)
  let seed = 7
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  const inside = (p: number[], x: number, z: number) => {
    let c = false
    for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) if ((p[i + 1] > z) !== (p[j + 1] > z) && x < ((p[j] - p[i]) * (z - p[i + 1])) / (p[j + 1] - p[i + 1]) + p[i]) c = !c
    return c
  }
  for (const p of riparian) {
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity
    for (let i = 0; i + 1 < p.pts.length; i += 2) { x0 = Math.min(x0, p.pts[i]); x1 = Math.max(x1, p.pts[i]); z0 = Math.min(z0, p.pts[i + 1]); z1 = Math.max(z1, p.pts[i + 1]) }
    const sp = p.kind === 'reed' ? 3 : 6
    for (let x = x0; x <= x1; x += sp) for (let z = z0; z <= z1; z += sp) {
      const jx = x + (rnd() - 0.5) * sp, jz = z + (rnd() - 0.5) * sp
      if (!inside(p.pts, jx, jz)) continue
      const tree = p.kind === 'willow' && rnd() < 0.15
      pts.push(jx, jz, p.kind === 'reed' ? 0.25 + rnd() * 0.15 : tree ? 0.8 + rnd() * 0.3 : 0.45 + rnd() * 0.25)
      needle.push(tree ? 0 : 2)
    }
  }
  return { pts: new Float32Array(pts), needle: new Uint8Array(needle) }
}
function forestTrees(): { pts: Float32Array; needle: Uint8Array } {
  const forests = areas.filter((a) => a.kind === 'forest' && a.pts.length >= 6)
  let tot = 0
  const bb = forests.map((a) => {
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity
    for (let i = 0; i + 1 < a.pts.length; i += 2) { x0 = Math.min(x0, a.pts[i]); x1 = Math.max(x1, a.pts[i]); z0 = Math.min(z0, a.pts[i + 1]); z1 = Math.max(z1, a.pts[i + 1]) }
    let ar = 0
    for (let i = 0, j = a.pts.length - 2; i < a.pts.length; j = i, i += 2) ar += (a.pts[j] - a.pts[i]) * (a.pts[j + 1] + a.pts[i + 1])
    tot += Math.abs(ar) / 2
    return [x0, z0, x1, z1]
  })
  const sp = Math.max(9, Math.sqrt(tot / 350_000))
  const out: number[] = [], kind: number[] = []
  let seed = 1
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  // value noise (~40 m cells): clearings and denser patches
  const hsh = (i: number, j: number) => (((i * 73856093) ^ (j * 19349663)) >>> 0) % 10007 / 10007
  const noise = (x: number, z: number) => {
    const gx = x / 40, gz = z / 40, i = Math.floor(gx), j = Math.floor(gz), fx = gx - i, fz = gz - j
    const sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz)
    const a = hsh(i, j) + (hsh(i + 1, j) - hsh(i, j)) * sx, b = hsh(i, j + 1) + (hsh(i + 1, j + 1) - hsh(i, j + 1)) * sx
    return a + (b - a) * sz
  }
  const mixShare = mixedNeedle(currentBiome)
  const lakeRings = waters.filter((w) => w.type !== 'river' && w.pts.length >= 6).map((w) => {
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity
    for (let i = 0; i + 1 < w.pts.length; i += 2) { x0 = Math.min(x0, w.pts[i]); x1 = Math.max(x1, w.pts[i]); z0 = Math.min(z0, w.pts[i + 1]); z1 = Math.max(z1, w.pts[i + 1]) }
    return { p: w.pts, b: [x0, z0, x1, z1] }
  })
  const inLake = (x: number, z: number) => lakeRings.some(({ p, b }) => {
    if (x < b[0] || x > b[2] || z < b[1] || z > b[3]) return false
    let ins = false
    for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) if ((p[i + 1] > z) !== (p[j + 1] > z) && x < ((p[j] - p[i]) * (z - p[i + 1])) / (p[j + 1] - p[i + 1]) + p[i]) ins = !ins
    return ins
  })
  // fields (generated plots + OSM farmland) are never wooded: same ray test as the lakes
  const fieldRings = [...(result?.fields ?? []).map((f) => f.flat() as number[]), ...areas.filter((a) => a.kind === 'field').map((a) => a.pts)]
    .filter((p) => p.length >= 6).map((p) => {
      let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity
      for (let i = 0; i + 1 < p.length; i += 2) { x0 = Math.min(x0, p[i]); x1 = Math.max(x1, p[i]); z0 = Math.min(z0, p[i + 1]); z1 = Math.max(z1, p[i + 1]) }
      return { p, b: [x0, z0, x1, z1] }
    })
  const inField = (x: number, z: number) => fieldRings.some(({ p, b }) => {
    if (x < b[0] - 4 || x > b[2] + 4 || z < b[1] - 4 || z > b[3] + 4) return false
    let ins = false
    for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) if ((p[i + 1] > z) !== (p[j + 1] > z) && x < ((p[j] - p[i]) * (z - p[i + 1])) / (p[j + 1] - p[i + 1]) + p[i]) ins = !ins
    return ins
  })
  forests.forEach((a, n) => {
    const [x0, z0, x1, z1] = bb[n], p = a.pts
    const young = a.stage === 'juvenile', st = young ? sp * 0.6 : sp // production forest: young plantation = dense, short
    for (let z = z0 + st / 2; z < z1; z += st) for (let x = x0 + st / 2; x < x1; x += st) {
      const px = x + (rnd() - 0.5) * st * 0.9, pz = z + (rnd() - 0.5) * st * 0.9
      if (a.stage === 'thinned' && rnd() < 0.55) continue
      let inside = false, d2 = Infinity
      for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) {
        if ((p[i + 1] > pz) !== (p[j + 1] > pz) && px < ((p[j] - p[i]) * (pz - p[i + 1])) / (p[j + 1] - p[i + 1]) + p[i]) inside = !inside
        const ex = p[i] - p[j], ez = p[i + 1] - p[j + 1], l2 = ex * ex + ez * ez || 1
        const u = Math.max(0, Math.min(1, ((px - p[j]) * ex + (pz - p[j + 1]) * ez) / l2)), qx = p[j] + u * ex - px, qz = p[j + 1] + u * ez - pz
        d2 = Math.min(d2, qx * qx + qz * qz)
      }
      if (!inside || inLake(px, pz) || inField(px, pz)) continue
      if (young) { out.push(px, pz, 0.25 + rnd() * 0.3); kind.push(a.leaf === 'broad' ? 0 : 1); continue } // 3-8 m saplings
      if (a.stage) { out.push(px, pz, a.stage === 'thinned' ? 1 + rnd() * 0.3 : 0.9 + rnd() * 0.35); kind.push(a.leaf === 'needle' || (a.leaf !== 'broad' && rnd() < 0.85) ? 1 : 0); continue } // managed: even stand, no clearings
      const d = Math.sqrt(d2), nz = noise(px, pz), r = rnd()
      // lace edge: trees thin out over the first ~25 m, clearings where the noise is low
      if (r > Math.min(1, 0.3 + d / 30) || nz < 0.4) { // groves and bands: ~40 % of the noise field is open ground
        if (r < 0.35 && (d < 30 || nz > 0.3)) { out.push(px, pz, 0.6 + rnd() * 0.8); kind.push(2) } // edge / clearing bushes
        continue
      }
      const needle = a.leaf === 'needle' || (a.leaf !== 'broad' && rnd() < Math.max(0.85, mixShare)) // conifers dominate (OpsTrack ~85 %)
      // progressive edge (Forest Featherer): younger, smaller trees over the outer ~35 m
      out.push(px, pz, (0.7 + rnd() * 0.5 * (0.6 + nz * 0.8)) * Math.min(1, 0.6 + d / 35 * 0.4)); kind.push(needle ? 1 : 0)
      if (d < 25 && rnd() < 0.25) { out.push(px + (rnd() - 0.5) * sp, pz + (rnd() - 0.5) * sp, 0.5 + rnd()); kind.push(2) } // undergrowth
    }
  })
  // biome garden trees (not Everon)
  for (const p of setParcels) for (const it of p.items) if (it.kind === 'tree') { out.push(it.x, it.z, 0.6); kind.push(/pinus|picea|abies|larix/i.test(it.guid) ? 1 : 0) }
  return { pts: new Float32Array(out), needle: Uint8Array.from(kind) }
}
/** walls, fences and hedges of the project as polylines for the 3D view (thin boxes, OpsTrack-style) */
function wallLines(): { pts: number[]; h: number; t: number; hedge?: boolean }[] {
  const out: { pts: number[]; h: number; t: number; hedge?: boolean }[] = []
  for (const p of setParcels) for (const f of p.fences) if (f.pts.length >= 4) out.push({ pts: f.pts, h: /wall|stone|brick/i.test(f.guid) ? 1.8 : 1.3, t: 0.25 })
  for (const z of zones) for (const s of z.shapes) if (s.kind === 'polyline' && /Walls\//.test(s.generator) && s.points.length >= 4) out.push({ pts: s.closed ? [...s.points, s.points[0], s.points[1]] : s.points, h: /Crash/.test(s.generator) ? 0.8 : /Rural|Wooden/.test(s.generator) ? 1.2 : /Brick/.test(s.generator) ? 2 : 2.2, t: 0.3 })
  for (const h of result?.hedges ?? []) if (h.length >= 2) out.push({ pts: h.flat(), h: 2, t: 1.4, hedge: true })
  return out
}
const flat = (ring: number[][]) => ring.flat()
const roadKind = (t: string) => (/^asphalt/.test(t) ? 'asphalt' : /cobble|concrete/.test(t) ? 'paved' : /^trail/.test(t) ? 'trail' : 'dirt') as 'asphalt' | 'paved' | 'dirt' | 'trail'
/** project data for the realistic 3D drape (src/view3d/drape.ts) */
function realLayers(hm: Heightmap): import('./view3d').RealLayers {
  const allRoads = [...roads, ...setLanes, ...setPaths, ...zones.flatMap((z) => z.roads)]
  return {
    surfaces: island?.surfaces,
    forests: areas.filter((a) => a.kind === 'forest').map((a) => ({ pts: a.pts, needle: a.leaf === 'needle' ? 1 : a.leaf === 'broad' ? 0 : mixedNeedle(currentBiome) })),
    tint: drapeTint(currentBiome),
    fields: [...areas.filter((a) => a.kind === 'field').map((a) => a.pts), ...(result?.fields ?? []).map(flat)],
    hedges: (result?.hedges ?? []).map(flat),
    roads: allRoads.filter((r) => r.pts.length >= 4).map((r) => ({ line: centreLine(r.pts, 4), half: roadHalf(r), kind: roadKind(r.type) })),
    rivers: waters.filter((w) => w.type === 'river' && w.pts.length >= 4).map((w) => ({ line: riverCourse(w.pts, w.width), width: w.width })),
    lakes: waters.filter((w) => w.type !== 'river' && w.pts.length >= 6).map((w) => w.pts),
    paved: [
      ...setSquares.map((q) => Array.from({ length: 20 }, (_, i) => [q.x + Math.cos(i * Math.PI / 10) * q.r, q.z + Math.sin(i * Math.PI / 10) * q.r]).flat()),
      ...zones.flatMap((z) => z.boxes.filter((b) => /pave|lot/.test(b.role) && b.corners.length >= 8).map((b) => b.corners)),
    ],
    sat: traceImg ? { image: traceImg, x0: hm.minX, z0: hm.minZ, x1: hm.minX + (hm.cols - 1) * hm.step, z1: hm.minZ + (hm.rows - 1) * hm.step } : undefined,
  }
}
/** the 2D render (relief, surfaces, areas, water, roads, buildings) into a square canvas over the whole terrain, without the
 *  editor overlays (site circles, labels, handles, issues, comments) */
function drapeCanvas(size: number) {
  if (!terrain) return null
  const side = Math.max((terrain.cols - 1) * terrain.step, (terrain.rows - 1) * terrain.step)
  const W = map.width, Hh = map.height, sv = { ...view }, cw = cursorWorld
  const hide = (['names', 'sites', 'issues', 'bridges'] as const).filter((l) => !hiddenLayers.has(l))
  draping = true
  try {
    map.width = size; map.height = size
    view.x = terrain.minX + side / 2; view.z = terrain.minZ + side / 2; view.mpp = side / size
    cursorWorld = null
    hide.forEach((l) => hiddenLayers.add(l))
    draw()
    const out = document.createElement('canvas')
    out.width = out.height = size
    out.getContext('2d')!.drawImage(map, 0, 0)
    return { canvas: out, x0: terrain.minX, z0: terrain.minZ, side }
  } finally {
    hide.forEach((l) => hiddenLayers.delete(l))
    map.width = W; map.height = Hh; Object.assign(view, sv); cursorWorld = cw
    draw()
    draping = false
  }
}
/** called at the end of draw(): the project changed while the 3D view is open, re-drape (debounced) */
function drapeLater() {
  if (!v3d || draping) return
  clearTimeout(drapeTimer)
  drapeTimer = window.setTimeout(() => v3d?.refreshDrape(), 1200)
}
const btn3d = $<HTMLButtonElement>('btn3d')
btn3d.addEventListener('click', () => void (async () => {
  if (v3d) return v3d.close()
  if (!terrain) return void (logEl.textContent = t('v3d.noTerrain'))
  const hm = terrain
  await busy(t('v3d.busy'), async () => {
    busyStage(t('v3d.load'))
    const mod: View3DMod = await import('./view3d')
    const buildings = [
      ...settled.map((b) => box3d(b.corners, prefabDims(b.prefab)?.h || BLD_H[b.cat] || 6)), // real height (catalogue dims) when known
      ...powerStations.map((q) => ({ cx: q.x, cz: q.z, w: q.w, d: q.d, h: q.h, yaw: q.yaw })), // transformer stations (powergrid.ts)
      ...zones.flatMap((z) => z.boxes.filter((b) => !FLAT_ROLES.has(b.role) && (z.kind === 'site' ? b.corners.length === 8 && (b.h ?? 0) >= 0.2 : b.corners.length >= 8)).map((b) => box3d(b.corners, b.h ?? (/hangar|tower/i.test(b.role) ? 12 : 7)))),
    ]
    const lakes = waters.filter((w) => w.type !== 'river' && w.pts.length >= 6).map((w) => w.pts)
    const trees = withRiparianTrees(forestTrees())
    const logBoxes = areas.flatMap((a) => (a.logs ?? []).map((l) => { const y = (l.yaw * Math.PI) / 180; return { cx: l.x, cz: l.z, w: 6, d: 3, h: 1.4, yaw: Math.atan2(Math.cos(y), Math.sin(y)) } }))
    const br = bridgeParts(worldBridges, (x, z) => heightAt(hm, x, z))
    v3d = await mod.open3d(map.parentElement!, {
      hm, sea: 0, buildings, props: logBoxes, trees: trees.pts, treeNeedle: trees.needle, walls: wallLines(), treeTint: treeTint(currentBiome), lakes,
      bridges: br.boxes, bridgeY: br.top,
      power: powerLines.map((l) => ({ poles: l.poles, h: POLE_H[l.kind] })),
      outside: outsideFor(hm) ?? undefined,
      target: [view.x, view.z], span: map.width * view.mpp,
    }, {
      text: {
        back: t('v3d.back'), exag: t('v3d.exag'), reset: t('v3d.reset'), top: t('v3d.top'), trees: t('v3d.trees'), help: t('v3d.help'),
        grid: t('v3d.grid'), quality: t('v3d.quality'), qLow: t('v3d.qLow'), qMed: t('v3d.qMed'), qHigh: t('v3d.qHigh'), visTrees: t('v3d.visTrees'), objs: t('v3d.objs'), drape: t('v3d.drape'), real: t('v3d.real'), map: t('v3d.map'), sat: t('v3d.sat'), genMs: (s) => t('v3d.genMs', { s }),
        stage: (k) => t(('v3d.st.' + k) as K),
      },
      drape: drapeCanvas,
      real: realLayers(hm),
      progress: (s, i, n) => busyStage(s, i, n),
      notify: (m) => toast(m, 'info'),
      onClose: (tg, span) => {
        v3d = null
        btn3d.classList.remove('on')
        view.x = tg[0]; view.z = tg[1]; view.mpp = Math.max(0.05, span / map.width)
        draw()
      },
    })
    btn3d.classList.add('on')
    ;(window as unknown as { __view3d: unknown }).__view3d = v3d
  })
})())
// dev-only probe for the Playwright checks: read the world state, move the 2D view
wireOutside(() => terrain, (m) => { logEl.textContent = m })
if (import.meta.env.DEV) (window as unknown as { __app: unknown }).__app = { view, draw, get terrain() { return terrain }, get roads() { return roads }, get sites() { return sites }, get areas() { return areas }, get waters() { return waters }, get riparian() { return riparian }, get countryside() { return countryside }, get powerLines() { return powerLines }, get powerStations() { return powerStations }, get worldBridges() { return worldBridges }, get pipeline() { return pipeline }, get result() { return result }, get zones() { return zones }, get settled() { return settled }, isLand: (x: number, z: number) => !!terrain && isLand(terrain, x, z), height: (x: number, z: number) => (terrain ? heightAt(terrain, x, z) : 0) }
