// Mode Atelier: finish an existing Workbench project (tools ported from giorbev's Map Generator Pro, MIT,
// Copyright (c) giorbev). Own layout: top bar, stepper A0-A6, layers | map | inspector, journal + cursor.
// Everything heavy goes through busy(); every write goes through the relay's safeWrite.
import './atelier.css'
import { getLang, setLang, t, type Key } from '../i18n'
import { parseTerr, type TerrInfo } from './formats/terr.ts'
import { parseTtile, type TileData } from './formats/ttile.ts'
import { layerObjects, splitLines, waterBodies, hasWater, type LayerObjects, type WaterBody } from './formats/layer.ts'
import { assembleHeights, heightAt, type HeightGrid } from './heights.ts'
import { diagCsv, diagnose, type Diag } from './diag.ts'
import { analyseBody, rewriteLayer, type WaterProposal } from './water.ts'
import { PAL, renderMap, type MapLayers, type MapStyle } from './render.ts'
import { CONTOUR_DEFAULTS, CONTOUR_FILE, contourConf, mapSize, type ContourSettings } from './contours.ts'
import { unzip, zip } from './zip.ts'
import { continueInGenerator, islandProject } from './handoff.ts'
import { coverageFrom, satFrom, type SatImage } from './terrtex.ts'
import type { Coverage } from './diag.ts'
import { parseTopo, type Topo } from './formats/topo.ts'
import { bridgeAlive, bridgeBackups, bridgeRestore, bridgeWrite, fsaSupported, openBridge, openFsa, workbenchRunning, type Backup, type Source, type WorldRef } from './source.ts'
import biomeTemperate from './data/biomes/temperate.json'
import biomeArid from './data/biomes/arid.json'
import biomeTropical from './data/biomes/tropical.json'
import biomeSimple from './data/biomes/temperate_simple.json'
import biomeAuto from './data/biomes/temperate_auto.json'
import texColors from './data/texcolors.json'
import { openNetworks } from './networks/panel.ts'
import { openTileFix } from './tilefix/panel.ts'
import { openZones } from './zones/panel.ts'
import { atlas, autoCalibrate, biomeRules, classify, coarse, metrics, type Calib, type Grid, type Metrics } from './terrain.ts'

type K = Key
const STEPS = ['s0', 's1', 's2', 's3', 's4', 's5', 's6'] as const
type Step = typeof STEPS[number]
const LAST_KEY = 'reforger-mapper.atelier.last', OPEN_KEY = 'reforger-mapper.atelier.open'
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!))
const tk = (k: string, v?: Record<string, string | number>) => t(k as K, v)
const ha = (m2: number | undefined) => ((m2 ?? 0) / 1e4).toFixed(2)

interface State {
  src: Source | null; world: WorldRef | null; terr: TerrInfo | null; tiles: TileData[]; H: HeightGrid | null
  objects: LayerObjects | null; layerTexts: Map<string, { text: string; sha: string }>; bodies: WaterBody[]
  budget: number; diag: Diag | null; selTile: [number, number] | null; search: number | null
  water: WaterProposal[] | null; use: Set<number>; selWater: number | null
  style: MapStyle; size: number; mapLayers: MapLayers; mapUrl: string | null
  contour: ContourSettings; journal: string[]; backups: Backup[]; wb: boolean | null
  cov: Coverage | null; sat: SatImage | null; negThr: number; topo: Topo | null
  step: Step; done: Set<Step>; show: { relief: boolean; tiles: boolean; water: boolean; objects: boolean; mapbg: boolean }
}
const S: State = {
  src: null, world: null, terr: null, tiles: [], H: null, objects: null, layerTexts: new Map(), bodies: [],
  budget: 5, diag: null, selTile: null, search: null, water: null, use: new Set(), selWater: null,
  style: 'military', size: 4096, mapLayers: { relief: true, forest: true, water: true, roads: true, buildings: true, walls: true, port: true, slopes: true, legend: true }, mapUrl: null,
  cov: null, sat: null, negThr: 0.01, topo: null, contour: structuredClone(CONTOUR_DEFAULTS), journal: [], backups: [], wb: null,
  step: 's0', done: new Set(), show: { relief: true, tiles: true, water: true, objects: false, mapbg: true },
}

let root: HTMLDivElement
const $ = <T extends HTMLElement = HTMLElement>(id: string) => root.querySelector<T>('#' + id)!

// ---------------------------------------------------------------- busy panel
let busyN = 0
async function busy<T>(label: string, f: (stage: (s: string, i?: number, n?: number) => void) => Promise<T>): Promise<T | undefined> {
  const el = $('atBusy'), t0 = performance.now()
  busyN++; el.hidden = false; $('atBusyLabel').textContent = label; $('atBusyStage').textContent = tk('at.busy.wait')
  const bar = $<HTMLProgressElement>('atBusyBar'); bar.removeAttribute('value')
  const tick = setInterval(() => { $('atBusyTime').textContent = `${Math.round((performance.now() - t0) / 1000)} s` }, 400)
  root.classList.add('is-busy')
  const stage = (s: string, i?: number, n?: number) => { $('atBusyStage').textContent = s; if (i !== undefined && n) { bar.max = n; bar.value = i + 1 } else bar.removeAttribute('value') }
  await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)))
  try { return await f(stage) }
  catch (e) { log(tk('at.err', { m: (e as Error).message }), true); return undefined }
  finally { clearInterval(tick); if (--busyN === 0) { el.hidden = true; root.classList.remove('is-busy') } }
}
const yieldUI = () => new Promise((r) => setTimeout(r, 0))

function log(msg: string, err = false) {
  const d = new Date(), line = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')} ${msg}`
  S.journal.unshift(line)
  const j = $('atJournal'); j.textContent = line; j.title = line; j.classList.toggle('err', err) // textContent: Windows paths keep their backslashes
}

// ---------------------------------------------------------------- layout
/** `at`: a step (s0-s6) or a tool panel (net / tex / zone) to open, from the dashboard tiles of main.ts */
export function openAtelier(at?: string) {
  try { sessionStorage.setItem(OPEN_KEY, '1') } catch { /* storage blocked */ }
  const step = at && (STEPS as readonly string[]).includes(at) ? at as Step : null
  const tool = at ? ({ net: 'atNetBtn', tex: 'atTexBtn', zone: 'atZoneBtn' } as Record<string, string>)[at] : undefined
  if (root) { root.hidden = false; if (step) go(step); if (tool) $(tool).click(); return }
  root = document.createElement('div')
  root.id = 'atelier'; root.className = 'atelier'
  root.innerHTML = `
  <header class="at-top">
    <button id="atBack" type="button" class="secondary at-backbtn" title="${t('at.back' as K)}">← ${t('at.backShort' as K)}</button>
    <b class="at-brand">${t('at.title' as K).toUpperCase()}</b>
    <span id="atProj" class="at-proj">${t('at.noProject' as K)}</span>
    <span id="atWb" class="at-wb" data-st="unknown">${t('at.wb.unknown' as K)}</span>
    <span class="at-sp"></span>
    <label class="at-langsel" title="${t('at.lang' as K)}"><select id="atLang" aria-label="${t('at.lang' as K)}">${[['fr', 'Français'], ['en', 'English']].map(([c, n]) => `<option value="${c}"${getLang() === c ? ' selected' : ''}>${c.toUpperCase()} · ${n}</option>`).join('')}</select></label>
    <button id="atHelpBtn" type="button" class="secondary" title="${t('at.help' as K)}" aria-haspopup="dialog">?</button>
  </header>
  <ol class="at-steps" id="atSteps">${STEPS.map((s, i) => `<li><button type="button" data-step="${s}"><b>A${i}</b><span>${tk('at.' + s)}</span></button></li>`).join('')}</ol>
  <div class="at-main">
    <aside class="at-left">
      <h4>${t('at.layers' as K)}</h4>
      ${(['relief', 'tiles', 'water', 'objects', 'mapbg'] as const).map((k) => `<label><input type="checkbox" data-show="${k}" ${S.show[k] ? 'checked' : ''}> ${tk('at.show.' + k)}</label>`).join('')}
      <button id="atFit" type="button" class="secondary">${t('at.zoomFit' as K)}</button>
      <button id="atNetBtn" type="button" class="secondary">${t('at.net.open' as K)}</button>
      <button id="atTexBtn" type="button" class="secondary">${t('at.tex.open' as K)}</button>
      <button id="atZoneBtn" type="button" class="secondary">${t('at.zn.open' as K)}</button>
      <h4>${t('at.legend' as K)}</h4><div id="atLegend" class="at-legend"></div>
    </aside>
    <div class="at-stage"><canvas id="atMap"></canvas></div>
    <section class="at-side"><span id="atPanelK" class="kicker"></span><h3 id="atPanelTitle"></h3><div id="atKpis" class="at-kpis" hidden></div><p id="atPanelLead" class="hint"></p><div id="atPanel"></div>
      <div class="at-nav"><button id="atPrev" type="button" class="secondary">${t('at.prev' as K)}</button><button id="atNext" type="button">${t('at.next' as K)}</button></div></section>
  </div>
  <footer class="at-foot"><span class="at-jl">${t('at.journal' as K)} :</span><span id="atJournal">${t('at.journal.empty' as K)}</span><span id="atCursor" class="at-cursor"></span></footer>
  <div id="atBusy" class="at-busy" hidden role="status" aria-live="polite"><div class="at-busybox"><span class="kicker">ATELIER</span><b id="atBusyLabel"></b><span id="atBusyStage" class="hint"></span><progress id="atBusyBar"></progress><span id="atBusyTime" class="hint"></span></div></div>
  <div id="atHelp" class="at-help" role="dialog" aria-labelledby="atHelpTitle" hidden>
    <div class="at-hphead"><h2 id="atHelpTitle">${t('at.help' as K)}</h2><button id="atHelpClose" type="button" class="secondary">✕</button></div>
    <div class="at-hpbody">
      ${t('at.h.what' as K).split('\n').map((l) => `<p>${esc(l)}</p>`).join('')}
      <h3>${t('at.h.steps' as K)}</h3>
      <ol class="at-hpsteps">${STEPS.map((s, i) => `<li><b>A${i}</b> <strong>${tk('at.' + s)}</strong> — ${esc(tk('at.' + s + '.lead'))} <button type="button" class="secondary" data-help-go="${s}">→</button></li>`).join('')}</ol>
      <h3>${t('at.h.faq' as K)}</h3>
      ${[1, 2, 3, 4, 5].map((n) => `<details class="faq"><summary>${esc(tk('at.h.q' + n))}</summary><p>${esc(tk('at.h.a' + n))}</p></details>`).join('')}
      <h3>${t('at.h.gloss' as K)}</h3>
      <dl class="gloss">${['qtre', 'block', 'layer', 'originaux', 'mapentity'].map((g) => `<dt>${esc(tk('at.g.' + g))}</dt><dd>${esc(tk('at.g.' + g + '.d'))}</dd>`).join('')}</dl>
      <p class="hint">${t('at.h.credit' as K)}</p>
    </div>
  </div>`
  document.body.append(root)
  root.querySelectorAll<HTMLButtonElement>('[data-step]').forEach((b) => b.addEventListener('click', () => go(b.dataset.step as Step)))
  root.querySelectorAll<HTMLButtonElement>('[data-help-go]').forEach((b) => b.addEventListener('click', () => { $('atHelp').hidden = true; go(b.dataset.helpGo as Step) }))
  root.querySelectorAll<HTMLInputElement>('[data-show]').forEach((c) => c.addEventListener('change', () => { S.show[c.dataset.show as keyof State['show']] = c.checked; draw() }))
  $('atBack').addEventListener('click', () => { root.hidden = true; try { sessionStorage.removeItem(OPEN_KEY) } catch { /* */ } })
  $('atHelpBtn').addEventListener('click', () => { $('atHelp').hidden = !$('atHelp').hidden })
  $('atHelpClose').addEventListener('click', () => { $('atHelp').hidden = true })
  $('atHelp').addEventListener('keydown', (e) => { if (e.key === 'Escape') $('atHelp').hidden = true })
  $<HTMLSelectElement>('atLang').addEventListener('change', (e) => { setLang((e.target as HTMLSelectElement).value); location.reload() })
  $('atPrev').addEventListener('click', () => { const i = STEPS.indexOf(S.step); if (i > 0) go(STEPS[i - 1]) })
  $('atNext').addEventListener('click', () => { const i = STEPS.indexOf(S.step); if (i < STEPS.length - 1) go(STEPS[i + 1]) })
  $('atFit').addEventListener('click', () => { userMoved = false; fit(); draw() })
  const toolCtx = () => S.src && S.world ? { src: S.src, world: S.world, terr: S.terr, tiles: S.tiles, H: S.H, log } : null
  $('atNetBtn').addEventListener('click', () => { const c = toolCtx(); if (c) void openNetworks(c, busy); else log(tk('at.net.needWorld'), true) })
  $('atTexBtn').addEventListener('click', () => { const c = toolCtx(); if (c) void openTileFix(c, busy); else log(tk('at.net.needWorld'), true) })
  $('atZoneBtn').addEventListener('click', () => { const c = toolCtx(); if (c) void openZones({ ...c, objects: S.objects, bodies: S.bodies }, busy); else log(tk('at.net.needWorld'), true) })
  setupMap()
  void pollWb(); setInterval(() => { if (!root.hidden) void pollWb() }, 5000)
  go(step ?? 's0')
  if (tool) $(tool).click()
}

/** reopen after a language switch */
export function atelierWasOpen(): boolean { try { return sessionStorage.getItem(OPEN_KEY) === '1' } catch { return false } }

async function pollWb() {
  S.wb = await workbenchRunning()
  const el = $('atWb')
  if (S.src?.kind === 'fsa') { el.dataset.st = 'ro'; el.textContent = tk('at.readonly'); return }
  el.dataset.st = S.wb === null ? 'unknown' : S.wb ? 'open' : 'closed'
  el.textContent = tk(S.wb === null ? 'at.wb.unknown' : S.wb ? 'at.wb.open' : 'at.wb.closed')
  el.title = tk(S.wb === null ? 'at.wb.unknown.tip' : S.wb ? 'at.wb.open.tip' : 'at.wb.closed.tip')
}

function header() {
  const tr = S.terr
  $('atProj').textContent = S.src ? `${S.src.info.title}${S.world ? ' · ' + S.world.name : ''}${tr ? ` (${tr.tilesX}×${tr.tilesZ} · ${tr.cellSize} m · QTRE ${S.budget})` : ''}` : tk('at.noProject')
  root.querySelectorAll<HTMLButtonElement>('[data-step]').forEach((b) => {
    const s = b.dataset.step as Step
    b.classList.toggle('active', s === S.step); b.classList.toggle('done', S.done.has(s))
    if (s === S.step) b.setAttribute('aria-current', 'step'); else b.removeAttribute('aria-current')
    b.classList.toggle('warn', (s === 's1' && !!S.diag && S.diag.problems.some((p) => p.kind === 'overBudget')) || (s === 's3' && !!S.water && S.water.some((p) => p.status === 'modified')))
  })
  // key figures of the loaded world, at the head of the step panel
  const k = $('atKpis'), d = S.diag
  const kp: [string | number, string, string][] = []
  if (d && S.step === 's1') {
    const over = d.problems.filter((p) => p.kind === 'overBudget').length
    const at = d.problems.filter((p) => p.kind === 'atBudget').length
    kp.push([over, tk('at.kpi.over'), over ? 'err' : 'ok'], [at, tk('at.kpi.at'), at ? 'warn' : 'ok'], [S.tiles.length, tk('at.kpi.tiles'), ''])
  } else if (S.terr && S.step !== 's0') kp.push([S.tiles.length, tk('at.kpi.tiles'), ''], [S.bodies.length, tk('at.kpi.water'), ''], [S.objects?.entities ?? 0, tk('at.kpi.objects'), ''])
  k.hidden = !kp.length
  k.innerHTML = kp.map(([n, l, c]) => `<div><b class="${c}">${n}</b><span>${esc(l)}</span></div>`).join('')
}

function go(step: Step) {
  S.step = step
  $('atPanelK').textContent = tk('at.stepOf', { i: STEPS.indexOf(step), n: STEPS.length - 1 })
  $('atPanelTitle').textContent = tk('at.' + step)
  $('atPanelLead').textContent = tk('at.' + step + '.lead')
  const p = $('atPanel'); p.innerHTML = ''
  ;({ s0: panelProject, s1: panelDiag, s2: panelSurfaces, s3: panelWater, s4: panelMap, s5: panelContours, s6: panelExport })[step](p)
  header(); legend(); draw()
}
const needWorld = (p: HTMLElement) => {
  if (S.terr && S.H) return false
  p.innerHTML = `<div class="at-empty"><b>${tk('at.empty.title')}</b><p>${tk('at.needWorld')}</p><button type="button" id="atGoA0">${tk('at.empty.go')}</button></div>`
  p.querySelector('#atGoA0')!.addEventListener('click', () => go('s0'))
  return true
}

// ---------------------------------------------------------------- A0 project
function panelProject(p: HTMLElement) {
  let last = ''
  try { last = localStorage.getItem(LAST_KEY) ?? '' } catch { /* */ }
  p.innerHTML = `
    <label class="at-field">${tk('at.open.path')}<input id="atPath" type="text" spellcheck="false" placeholder="${esc(tk('at.open.path.ph'))}" value="${esc(S.src?.kind === 'bridge' ? S.src.info.root : last)}"></label>
    <div class="row"><button id="atOpen" type="button">${tk('at.open.go')}</button><button id="atFsa" type="button" class="secondary" title="${esc(tk('at.open.fsa.tip'))}">${tk('at.open.fsa')}</button></div>
    <p class="hint">${tk('at.open.fsa.tip')}</p>
    <label class="at-field">${tk('at.open.import')}<input id="atImport" type="file" accept=".zip"></label>
    <div id="atWorlds"></div><div id="atSummary"></div>`
  $('atOpen').addEventListener('click', () => void busy(tk('at.open.loading'), async () => {
    if (!(await bridgeAlive())) { log(tk('at.open.relayDown'), true); $('atWorlds').innerHTML = `<p class="at-note err">${tk('at.open.relayDown')}</p>`; return }
    const path = $<HTMLInputElement>('atPath').value.trim()
    S.src = await openBridge(path)
    try { localStorage.setItem(LAST_KEY, path) } catch { /* */ }
    afterOpen()
  }))
  $('atFsa').addEventListener('click', () => {
    if (!fsaSupported()) { log(tk('at.open.fsa.none'), true); return }
    void busy(tk('at.open.loading'), async () => { S.src = await openFsa(); afterOpen() })
  })
  $<HTMLInputElement>('atImport').addEventListener('change', (e) => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) void importArchive(f) })
  if (S.src) worldsList(); if (S.terr) summary()
}

function afterOpen() {
  resetWorld(); worldsList(); void pollWb(); header()
  log(`${S.src!.info.root}: ${S.src!.info.worlds.length} world(s), ${S.src!.info.terrains.length} terrain(s)`)
  const w = S.src!.info.worlds.find((x) => x.terrain && x.layers) ?? S.src!.info.worlds.find((x) => x.terrain)
  if (w && S.src!.info.worlds.length === 1) void loadWorld(w)
}
function resetWorld() { Object.assign(S, { world: null, terr: null, tiles: [], H: null, objects: null, bodies: [], diag: null, cov: null, sat: null, topo: null, water: null, selTile: null, selWater: null, mapUrl: null }); S.layerTexts.clear(); S.use.clear(); S.done.clear(); base = null }

function worldsList() {
  const info = S.src!.info, el = $('atWorlds')
  el.innerHTML = `<h4>${tk('at.open.world')}</h4>` + (info.worlds.length ? info.worlds.map((w, i) => `
    <div class="at-world ${S.world?.ent === w.ent ? 'sel' : ''}"><span><b>${esc(w.name)}</b> <small>${esc(w.ent)}</small><br><small>${w.layers} .layer · ${w.terrain ? esc(w.terrain) : '<i>' + tk('at.open.noTerrain') + '</i>'}</small></span>
    <button type="button" class="secondary" data-world="${i}">${tk('at.open.load')}</button></div>`).join('') : `<p class="at-note">${tk('at.open.noTerrain')}</p>`)
  el.querySelectorAll<HTMLButtonElement>('[data-world]').forEach((b) => b.addEventListener('click', () => void loadWorld(info.worlds[Number(b.dataset.world)])))
}

async function loadWorld(w: WorldRef) {
  await busy(tk('at.open.loadingWorld') + ' ' + w.name, async (stage) => {
    resetWorld(); S.world = w
    const src = S.src!, tref = src.info.terrains.find((x) => x.terr === w.terrain)
    if (tref) {
      S.terr = parseTerr((await src.read(tref.terr)).bytes)
      stage(tk('at.open.tiles'))
      const files = await src.pack(tref.dataDir, '.ttile', tref.tilePrefix, (i, n) => stage(tk('at.open.tiles'), i, n))
      const bps = S.terr.tilesX * S.terr.blocksPerTile
      for (let i = 0; i < files.length; i++) {
        if (!/^\d+\.ttile$/.test(files[i].name.slice(tref.tilePrefix.length))) continue
        try { S.tiles.push(parseTtile(files[i].bytes, bps, S.terr.blocksPerTile, true)) } catch { /* unreadable tile: reported as missing */ }
        if (i % 40 === 0) { stage(tk('at.open.tiles'), i, files.length); await yieldUI() }
      }
      S.H = assembleHeights(S.terr, S.tiles)
      // baked textures (.edds): painted weights → negligible slots, supertextures → textured satmap
      try {
        stage(tk('at.open.edds'))
        S.cov = coverageFrom(S.terr, S.tiles, await src.pack(tref.dataDir, '_layer.edds', tref.tilePrefix, (i, n) => stage(tk('at.open.edds'), i, n)), tref.tilePrefix)
        await yieldUI()
        S.sat = satFrom(S.terr, await src.pack(tref.dataDir, '_supertexture.edds', tref.tilePrefix, (i, n) => stage(tk('at.open.edds'), i, n)), tref.tilePrefix)
      } catch (e) { log(tk('at.err', { m: (e as Error).message }), true) }
    }
    if (w.layersDir) {
      const list = await src.list(w.layersDir, ['.layer'])
      const merged: LayerObjects = { roads: [], buildings: [], trees: [], port: [], walls: [], entities: 0 }
      for (let i = 0; i < list.length; i++) {
        stage(tk('at.open.layersRead') + ' — ' + list[i].path.split('/').pop(), i, list.length); await yieldUI()
        const { bytes, sha } = await src.read(list[i].path), text = new TextDecoder().decode(bytes)
        const { lines } = splitLines(text), o = layerObjects(lines)
        for (const k of ['roads', 'buildings', 'trees', 'port', 'walls'] as const) for (const v of o[k] as unknown[]) (merged[k] as unknown[]).push(v) // no spread: 100k+ items overflow the stack
        merged.entities += o.entities
        if (hasWater(text)) { S.layerTexts.set(list[i].path, { text, sha }); S.bodies.push(...waterBodies(lines, list[i].path)) }
      }
      S.objects = merged
    }
    // .topo of this world (map export): real road widths and building footprints for the A4 map
    const tp = src.info.topo.find((x) => x.split('/').pop()!.toLowerCase() === w.name.toLowerCase() + '.topo') ?? (src.info.topo.length === 1 ? src.info.topo[0] : undefined)
    if (tp) try { S.topo = parseTopo((await src.read(tp)).bytes) } catch (e) { log(tk('at.err', { m: 'topo: ' + (e as Error).message }), true) }
    S.objects ??= { roads: [], buildings: [], trees: [], port: [], walls: [], entities: 0 }
    if (S.H) { makeBase(); fit() }
    S.done.add('s0')
    log(`${w.name}: ${S.tiles.length} tiles, ${S.bodies.length} water bodies, ${S.objects.entities} entities` + (S.cov ? `, ${S.cov.blocks.size} blocks with painted weights` : '') + (S.sat ? `, satmap ${S.sat.W}×${S.sat.H}` : '') + (S.topo ? `, .topo: ${S.topo.roads.length} roads / ${S.topo.buildings.length} buildings` : ''))
  })
  if (S.step === 's0') go('s0'); else header()
}

function summary() {
  const tr = S.terr!, H = S.H!, o = S.objects!, w = S.world!
  const lakes = S.bodies.filter((b) => b.kind === 'lake').length
  $('atSummary').innerHTML = `<h4>${tk('at.open.summary')}</h4><ul class="at-sum">
    <li><b>${tk('at.sum.grid')}</b> ${tk('at.sum.tiles', { n: tr.tilesX * tr.tilesZ, x: tr.tilesX, z: tr.tilesZ, b: tr.blocksPerTile, c: tr.cellsPerBlock })}</li>
    <li>${tk('at.sum.size', { x: tr.sizeX, z: tr.sizeZ, m: tr.cellSize })}</li>
    <li>${tk('at.sum.heights', { a: H.min.toFixed(1), b: H.max.toFixed(1) })}${H.missing ? ' · <span class="err">' + tk('at.sum.missing', { n: H.missing }) + '</span>' : ''}</li>
    <li>${tk('at.sum.mats', { n: tr.materials.length })}</li>
    <li>${tk('at.sum.layers', { n: w.layers, mb: (w.layersSize / 1e6).toFixed(1) })}</li>
    <li>${tk('at.sum.objects', { e: o.entities, r: o.roads.length, b: o.buildings.length, t: o.trees.length, w: o.walls.length, p: o.port.length })}</li>
    <li>${tk('at.sum.water', { l: lakes, r: S.bodies.length - lakes })}</li></ul>
    <label class="at-field">${tk('at.open.budget')} <select id="atBudget"><option ${S.budget === 5 ? 'selected' : ''}>5</option><option ${S.budget === 7 ? 'selected' : ''}>7</option></select></label><p class="hint">${tk('at.open.budget.tip')}</p>`
  $<HTMLSelectElement>('atBudget').addEventListener('change', (e) => { S.budget = Number((e.target as HTMLSelectElement).value); S.diag = null; header() })
}

// ---------------------------------------------------------------- A1 diagnostic
function panelDiag(p: HTMLElement) {
  if (needWorld(p)) return
  if (!S.diag) { S.diag = diagnose(S.terr!, S.tiles, S.budget, S.cov, S.negThr); S.done.add('s1') }
  const d = S.diag, tr = S.terr!, mats = tr.materials
  const hist = d.hist.map((n, k) => n ? `<span class="${k > S.budget ? 'err' : k === S.budget ? 'warn' : ''}">${k}: ${n}</span>` : '').filter(Boolean).join(' · ')
  const shown = d.problems.filter((x) => x.kind !== 'atBudget').slice(0, 200), atN = d.problems.filter((x) => x.kind === 'atBudget').length
  p.innerHTML = `<p><b>${tk('at.diag.hist')}</b><br>${hist}</p>
    <h4>${tk('at.diag.problems', { n: d.problems.length - atN })} <small>(+${atN} ${tk('at.diag.legend.at')})</small></h4>
    ${shown.length ? `<ul class="at-list" id="atProblems">${shown.map((x, i) => `<li><button type="button" class="linkish" data-p="${i}">${esc(tk('at.diag.p.' + x.kind, { tx: x.tx, ty: x.ty, bx: x.bx ?? '', by: x.by ?? '', n: x.n ?? '' }))}</button></li>`).join('')}</ul>` : `<p class="at-note ok">${tk('at.diag.none')}</p>`}
    <label class="at-field">${tk('at.diag.search')}<input id="atSearch" list="atMats" placeholder="Grass_01"><datalist id="atMats">${mats.map((m) => `<option value="${esc(m.name)}">`).join('')}</datalist></label><p id="atHits" class="hint"></p>
    <div class="row"><button id="atCsv" type="button" class="secondary">${tk('at.diag.csv')}</button></div>
    <div id="atTile"><p class="hint">${tk('at.diag.clickHint')}</p></div>
    ${S.cov ? `<p><b>${tk('at.diag.neg', { n: d.negligible })}</b></p><label class="at-field">${tk('at.diag.negThr')}<input id="atNegThr" type="number" min="0" max="50" step="0.5" value="${S.negThr * 100}"></label>` : `<p class="hint">${tk('at.diag.negNone')}</p>`}`
  p.querySelectorAll<HTMLButtonElement>('[data-p]').forEach((b) => b.addEventListener('click', () => { const x = shown[Number(b.dataset.p)]; S.selTile = [x.tx, x.ty]; zoomTile(x.tx, x.ty); tileInfo() }))
  $<HTMLInputElement>('atSearch').addEventListener('input', (e) => {
    const v = (e.target as HTMLInputElement).value.trim().toLowerCase(), m = mats.find((x) => x.name.toLowerCase() === v)
    S.search = m ? m.id : null
    $('atHits').textContent = m ? tk('at.diag.search.hits', { n: d.usage.get(m.id) ?? 0 }) : ''
    draw()
  })
  $('atCsv').addEventListener('click', () => download(`${S.world!.name}_tile_diagnostic.csv`, diagCsv(tr, d, S.budget, S.negThr), 'text/csv'))
  root.querySelector<HTMLInputElement>('#atNegThr')?.addEventListener('change', (e) => { S.negThr = Math.max(0, Number((e.target as HTMLInputElement).value) || 0) / 100; S.diag = null; panelDiag(p) })
  if (S.selTile) tileInfo()
}
function tileInfo() {
  const el = root.querySelector('#atTile'); if (!el || !S.selTile || !S.diag) return
  const [tx, ty] = S.selTile, mats = S.terr!.materials
  const bl = S.diag.blocks.filter((b) => b.tx === tx && b.ty === ty).sort((a, b) => b.by - a.by || a.bx - b.bx)
  el.innerHTML = `<h4>${tk('at.diag.tile', { tx, ty })}</h4><table class="at-table"><tr><th>bloc</th><th>n</th><th>textures</th></tr>${bl.map((b) => `<tr class="${b.mats.length > S.budget ? 'err' : b.mats.length === S.budget ? 'warn' : ''}"><td>${b.bx},${b.by}</td><td>${b.mats.length}</td><td>${b.mats.map((m, i) => { const c = b.cover && S.diag!.blockPx ? b.cover[i] / S.diag!.blockPx : null; return `<span class="${c !== null && c < S.negThr ? 'err' : ''}">${esc(mats[m]?.name ?? '#' + m)}${c !== null ? ` <small>${(c * 100).toFixed(1)}%</small>` : ''}</span>` }).join(', ')}</td></tr>`).join('')}</table>
    <button type="button" class="secondary" id="atZoomTile">${tk('at.diag.zoom')}</button>`
  $('atZoomTile').addEventListener('click', () => zoomTile(tx, ty))
}

// ---------------------------------------------------------------- A2 surfaces / biomes
function panelSurfaces(p: HTMLElement) {
  if (needWorld(p)) return
  if (!S.diag) S.diag = diagnose(S.terr!, S.tiles, S.budget)
  const tr = S.terr!, u = S.diag.usage, total = S.diag.blocks.length || 1
  const present = new Set(tr.materials.map((m) => m.name.toLowerCase()))
  const biomes = [biomeTemperate, biomeSimple, biomeArid, biomeTropical].map((b) => {
    const tex = [...new Set(Object.entries(b.textures as Record<string, { default?: string }>).map(([k, v]) => (v.default ?? k).replace(/\.emat$/, '')))]
    return { name: (b as { name?: string; biome?: string }).name ?? (b as { biome?: string }).biome ?? '?', id: (b as { id?: string }).id ?? '', tex, ok: tex.filter((x) => present.has(x.toLowerCase())) }
  })
  p.innerHTML = `<h4>${tk('at.surf.terrain')}</h4><table class="at-table"><tr><th>#</th><th>surface</th><th>blocs</th><th>%</th></tr>
    ${tr.materials.map((m) => ({ m, n: u.get(m.id) ?? 0 })).sort((a, b) => b.n - a.n).map(({ m, n }) => `<tr><td>${m.id}</td><td title="${esc(m.path)}">${esc(m.name)}</td><td>${n}</td><td>${(100 * n / total).toFixed(1)}</td></tr>`).join('')}</table>
    <p>${tk('at.surf.project', { n: S.src!.info.emat })}</p>
    <h4>${tk('at.surf.biomes')}</h4><ul class="at-list">${biomes.map((b) => `<li><b>${esc(b.name)}</b> — ${tk('at.surf.present', { a: b.ok.length, b: b.tex.length })}<br><small>${b.tex.map((x) => `<span class="${b.ok.includes(x) ? 'ok' : 'err'}">${esc(x)}</span>`).join(' ')}</small></li>`).join('')}</ul>
    <div id="atBiome"></div><div id="atAtlas"></div>`
  biomePanel(); atlasPanel()
  S.done.add('s2')
}

// biome masks (ordered priority rules) + auto-calibration + Metric Atlas — terrain.ts (port of giorbev's tools)
let TG: { g: Grid; m: Metrics; H: HeightGrid } | null = null, calib: Calib | null = null, biomeIx = 0
const BIOMES = [biomeAuto, biomeSimple, biomeTemperate, biomeArid, biomeTropical] as unknown as Record<string, unknown>[]
const TC = texColors as Record<string, number[]>
function terrainGrid() { if (!TG || TG.H !== S.H) { const g = coarse(S.H!, 1024); TG = { g, m: metrics(g), H: S.H! }; calib = null } return TG }
function biomePanel() {
  const el = root.querySelector<HTMLElement>('#atBiome'); if (!el || !S.H) return
  const { g, m } = terrainGrid(); calib ??= autoCalibrate(g, m)
  const keys = Object.keys(calib) as (keyof Calib)[]
  el.innerHTML = `<h4>${tk('at.bio.title')}</h4><label class="at-field">${tk('at.bio.preset')}<select id="atBioSel">${BIOMES.map((b, i) => `<option value="${i}" ${i === biomeIx ? 'selected' : ''}>${esc(String(b.name ?? b.biome ?? b.id))}</option>`).join('')}</select></label>
    <p class="hint">${tk('at.bio.calib')}</p><div class="at-calib">${keys.map((k) => `<label>${k} <input type="number" step="0.5" data-cal="${k}" value="${calib![k]}"></label>`).join('')}</div>
    <div class="row"><button id="atCalAuto" type="button" class="secondary">${tk('at.bio.auto')}</button><button id="atBioRun" type="button">${tk('at.bio.run')}</button></div><div id="atBioOut"></div>`
  $<HTMLSelectElement>('atBioSel').addEventListener('change', (e) => { biomeIx = Number((e.target as HTMLSelectElement).value) })
  el.querySelectorAll<HTMLInputElement>('[data-cal]').forEach((i) => i.addEventListener('change', () => { calib![i.dataset.cal as keyof Calib] = Number(i.value) }))
  $('atCalAuto').addEventListener('click', () => { calib = autoCalibrate(g, m); biomePanel(); log(tk('at.bio.autoDone')) })
  $('atBioRun').addEventListener('click', () => {
    const rules = biomeRules(BIOMES[biomeIx], calib!, { min: S.H!.min, max: S.H!.max }), cls = classify(g, m, rules)
    const n = new Array(rules.length + 1).fill(0)
    for (const k of cls) n[k + 1]++
    const col = (k: number) => (k < 0 ? [120, 140, 90] : TC[rules[k].tex] ?? [128, 128, 128]).map((v) => Math.min(255, v * 1.6))
    const cv = document.createElement('canvas'); cv.width = g.cols; cv.height = g.rows
    const cx = cv.getContext('2d')!, id = cx.createImageData(g.cols, g.rows)
    for (let r = 0; r < g.rows; r++) for (let c = 0; c < g.cols; c++) { const k = cls[r * g.cols + c], o = ((g.rows - 1 - r) * g.cols + c) * 4, v = col(k); id.data[o] = v[0]; id.data[o + 1] = v[1]; id.data[o + 2] = v[2]; id.data[o + 3] = 255 }
    cx.putImageData(id, 0, 0)
    const present = new Set(S.terr!.materials.map((x) => x.name.toLowerCase()))
    const rows = [[-1, tk('at.bio.base')] as [number, string], ...rules.map((r, k) => [k, r.tex] as [number, string])]
    $('atBioOut').innerHTML = `<table class="at-table"><tr><th></th><th>texture</th><th>%</th><th>règle</th></tr>${rows.map(([k, name]) => { const v = col(k), r = rules[k]; return `<tr><td><span class="at-sw" style="background:rgb(${v.join(',')})"></span></td><td class="${k >= 0 && !present.has(name.toLowerCase()) ? 'warn' : ''}">${esc(name)}</td><td>${(100 * n[k + 1] / cls.length).toFixed(1)}</td><td><small>${r ? [r.altMin !== undefined ? `h≥${r.altMin.toFixed(0)}` : '', r.altMax !== undefined ? `h<${r.altMax.toFixed(0)}` : '', r.slopeMin !== undefined ? `p≥${r.slopeMin.toFixed(0)}°` : '', r.slopeMax !== undefined ? `p<${r.slopeMax.toFixed(0)}°` : ''].filter(Boolean).join(' ') : ''}</small></td></tr>` }).join('')}</table>
      <p class="hint">${tk('at.bio.missingHint')}</p><div class="row"><button id="atBioPng" type="button" class="secondary">${tk('at.bio.png')}</button></div>`
    cv.className = 'at-preview'; $('atBioOut').prepend(cv)
    $('atBioPng').addEventListener('click', () => cv.toBlob((b) => b && download(`${S.world!.name}_biome_masks.png`, b, 'image/png')))
  })
}
function atlasPanel() {
  const el = root.querySelector<HTMLElement>('#atAtlas'); if (!el || !S.H) return
  const { g, m } = terrainGrid(), a = atlas(g, m), f = (v: number) => v.toFixed(1)
  const row = (label: string, s: { min: number; p05: number; p50: number; p95: number; max: number; mean: number } | null, u: string) => s ? `<tr><td>${label}</td><td>${f(s.min)}</td><td>${f(s.p05)}</td><td>${f(s.p50)}</td><td>${f(s.mean)}</td><td>${f(s.p95)}</td><td>${f(s.max)}</td><td>${u}</td></tr>` : ''
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'], tot = a.aspect.reduce((x, y) => x + y, 0) || 1, sh = a.slopeHist.reduce((x, y) => x + y, 0) || 1
  el.innerHTML = `<h4>${tk('at.atlas.title')}</h4><p class="hint">${tk('at.atlas.tip', { cell: g.cell, land: a.landPct.toFixed(1) })}</p>
    <table class="at-table"><tr><th></th><th>min</th><th>p05</th><th>p50</th><th>moy.</th><th>p95</th><th>max</th><th></th></tr>
    ${row(tk('at.atlas.alt'), a.alt, 'm')}${row(tk('at.atlas.land'), a.land, 'm')}${row(tk('at.atlas.slope'), a.slope, '°')}${row(tk('at.atlas.rough'), a.rough, 'm')}${row('TPI 100 m', a.tpi, 'm')}</table>
    <p><b>${tk('at.atlas.aspect')}</b> ${dirs.map((d, i) => `${d} ${(100 * a.aspect[i] / tot).toFixed(0)}%`).join(' · ')}</p>
    <p><b>${tk('at.atlas.slopes')}</b> ${['0-5°', '5-10°', '10-20°', '20-30°', '30-45°', '45°+'].map((l, i) => `${l} ${(100 * a.slopeHist[i] / sh).toFixed(1)}%`).join(' · ')}</p>`
}

// ---------------------------------------------------------------- A3 water
function panelWater(p: HTMLElement) {
  if (needWorld(p)) return
  if (!S.bodies.length) { p.innerHTML = `<p class="at-note">${tk('at.water.none')}</p>`; return }
  if (!S.water) {
    p.innerHTML = `<p class="hint">${tk('at.water.rules')}</p><button id="atWaterRun" type="button">${tk('at.water.run')}</button>`
    $('atWaterRun').addEventListener('click', () => void busy(tk('at.water.run'), async (stage) => {
      const out: WaterProposal[] = []
      for (let i = 0; i < S.bodies.length; i++) { stage(`${S.bodies[i].file.split('/').pop()} — ${tk('at.water.' + S.bodies[i].kind)}`, i, S.bodies.length); await yieldUI(); out.push(analyseBody(S.bodies[i], S.H!)) }
      S.water = out; S.use = new Set(out.map((x, i) => x.status === 'modified' ? i : -1).filter((i) => i >= 0)); S.done.add('s3')
      go('s3')
    }))
    return
  }
  const W = S.water, mod = W.filter((x) => x.status === 'modified').length
  const files = [...new Set(W.filter((x, i) => x.status === 'modified' && S.use.has(i)).map((x) => x.file))]
  p.innerHTML = `<p>${tk('at.water.list', { n: W.length, m: mod })}</p><p class="hint">${tk('at.water.legend')}</p>
    <ul class="at-list at-water">${W.map((x, i) => {
      const st = tk('at.water.st.' + x.status, { n: x.note })
      const fix = x.status === 'modified' ? (x.kind === 'lake' ? tk('at.water.fixLake', { k: x.note, n: x.nptsNew ?? 0 }) : tk('at.water.fixRiver', { w: x.note, b: x.width ?? '' })) : ''
      return `<li class="${S.selWater === i ? 'sel' : ''} st-${x.status}"><button type="button" class="linkish" data-w="${i}"><b>${tk('at.water.' + x.kind)}</b> ${esc(x.name || `x ${x.cx} z ${x.cz}`)}</button>
        <small>${tk('at.water.pts', { n: x.npts })}${x.level !== undefined ? ' · ' + tk('at.water.level', { v: x.level }) : ''}${x.waterM2 !== undefined ? ' · ' + tk('at.water.area', { a: ha(x.mapBeforeM2), b: ha(x.mapAfterM2 ?? x.mapBeforeM2), w: ha(x.waterM2) }) : ''}</small>
        <span class="at-st">${esc(st)}</span>${x.problems.length ? `<span class="err">! ${x.problems.map((q) => esc(tk('at.water.pr.' + q))).join(', ')}</span>` : ''}
        ${fix ? `<label><input type="checkbox" data-use="${i}" ${S.use.has(i) ? 'checked' : ''}> ${tk('at.water.use')} — ${esc(fix)}</label>` : ''}
        <small class="hint">${esc(x.file)}</small></li>`
    }).join('')}</ul>
    <div class="row">${S.src!.canWrite ? `<button id="atApply" type="button" ${files.length ? '' : 'disabled'}>${tk('at.water.apply', { n: files.length })}</button>` : ''}<button id="atDl" type="button" class="secondary" ${files.length ? '' : 'disabled'}>${tk('at.water.download')}</button></div>
    <p class="hint">${tk('at.water.tip')}</p>`
  p.querySelectorAll<HTMLButtonElement>('[data-w]').forEach((b) => b.addEventListener('click', () => { S.selWater = Number(b.dataset.w); zoomWater(W[S.selWater]); p.querySelectorAll('.at-water li').forEach((li, k) => li.classList.toggle('sel', k === S.selWater)); draw() }))
  p.querySelectorAll<HTMLInputElement>('[data-use]').forEach((c) => c.addEventListener('change', () => { const i = Number(c.dataset.use); if (c.checked) S.use.add(i); else S.use.delete(i); go('s3') }))
  root.querySelector('#atApply')?.addEventListener('click', () => void applyWater(files))
  $('atDl').addEventListener('click', () => {
    const out = files.map((f) => ({ name: f, data: new TextEncoder().encode(corrected(f)) }))
    download(`${S.world!.name}_layers_corriges.zip`, zip(out), 'application/zip')
  })
}
function corrected(file: string): string {
  const props = S.water!.filter((x, i) => x.file === file && S.use.has(i))
  return rewriteLayer(S.layerTexts.get(file)!.text, file, props).text
}
async function applyWater(files: string[]) {
  await busy(tk('at.water.apply', { n: files.length }), async (stage) => {
    for (let i = 0; i < files.length; i++) {
      const f = files[i], cur = S.layerTexts.get(f)!
      stage(f, i, files.length)
      const text = corrected(f)
      try {
        const r = await bridgeWrite(f, text, cur.sha)
        log(tk('at.water.applied', { f, b: r.backup ?? '' }))
        S.layerTexts.set(f, { text, sha: r.sha })
      } catch (e) {
        const m = (e as Error).message
        log(m.startsWith('WORKBENCH_RUNNING') ? tk('at.water.wbOpen') : m.startsWith('SHA_MISMATCH') ? tk('at.water.changed', { f }) : tk('at.err', { m }), true)
        return
      }
    }
    // the files changed: re-read the bodies (line numbers moved) and recompute
    S.bodies = []
    for (const [f, v] of S.layerTexts) S.bodies.push(...waterBodies(splitLines(v.text).lines, f))
    S.water = S.bodies.map((b) => analyseBody(b, S.H!)); S.use = new Set(S.water.map((x, i) => x.status === 'modified' ? i : -1).filter((i) => i >= 0))
  })
  void pollWb(); go('s3')
}

// ---------------------------------------------------------------- A4 in-game map
const legendItems = (): [string, [number, number, number]][] => S.style === 'military'
  ? [[tk('at.lg.forest1'), PAL.forestLight], [tk('at.lg.forest2'), PAL.forest], [tk('at.lg.forest3'), PAL.forestDense], [tk('at.lg.water'), PAL.water], [tk('at.lg.asphalt'), [232, 120, 60]], [tk('at.lg.concrete'), [250, 220, 120]], [tk('at.lg.dirt'), [255, 255, 255]], [tk('at.lg.building'), [40, 40, 40]], [tk('at.lg.quay'), PAL.quay], [tk('at.lg.slope'), PAL.slope]]
  : [[tk('at.lg.forest3'), [38, 62, 34]], [tk('at.lg.water'), PAL.sea], [tk('at.lg.asphalt'), PAL.asphalt], [tk('at.lg.concrete'), PAL.concrete], [tk('at.lg.dirt'), PAL.dirt], [tk('at.lg.building'), PAL.house]]
function waterMasks() { return (S.water ?? []).filter((x) => x.water).map((x) => x.water!) }
function renderTo(size: number): HTMLCanvasElement {
  const tr = S.terr!, Sx = mapSize(size), c = document.createElement('canvas')
  c.width = Sx; c.height = mapSize(Math.round(Sx * tr.sizeZ / tr.sizeX))
  renderMap(c.getContext('2d')!, Sx, { H: S.H!, sizeX: tr.sizeX, sizeZ: tr.sizeZ, objects: S.objects!, water: waterMasks(), sea: 0, sat: S.style === 'realistic' ? S.sat : null, topo: S.topo }, S.style, S.mapLayers, { title: tk('at.lg.title'), items: legendItems() })
  return c
}
function panelMap(p: HTMLElement) {
  if (needWorld(p)) return
  p.innerHTML = `<label class="at-field">${tk('at.map.style')}<select id="atStyle"><option value="military" ${S.style === 'military' ? 'selected' : ''}>${tk('at.map.military')}</option><option value="realistic" ${S.style === 'realistic' ? 'selected' : ''}>${tk('at.map.realistic')}</option><option value="topo" ${S.style === 'topo' ? 'selected' : ''}>${tk('at.map.topo')}</option></select></label>
    <label class="at-field">${tk('at.map.size')}<select id="atSize">${[2048, 4096, 8192].map((n) => `<option ${S.size === n ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
    <div class="at-checks">${(Object.keys(S.mapLayers) as (keyof MapLayers)[]).map((k) => `<label><input type="checkbox" data-ml="${k}" ${S.mapLayers[k] ? 'checked' : ''}> ${tk('at.map.l.' + k)}</label>`).join('')}</div>
    <div class="row"><button id="atPreview" type="button">${tk('at.map.preview')}</button><button id="atPng" type="button" class="secondary">${tk('at.map.export')}</button><button id="atV3d" type="button" class="secondary" title="${esc(tk('at.v3d.tip'))}">${tk('at.v3d')}</button>${S.src!.canWrite ? `<button id="atPngSave" type="button" class="secondary">${tk('at.map.save')}</button>` : ''}</div>
    ${S.mapUrl ? `<img class="at-thumb" src="${S.mapUrl}" alt="">` : ''}
    <p class="hint">${tk('at.map.water')}</p><p class="at-note">${tk('at.map.import')}</p><p class="hint">${tk('at.map.partial')}</p>`
  $<HTMLSelectElement>('atStyle').addEventListener('change', (e) => { S.style = (e.target as HTMLSelectElement).value as MapStyle; legend() })
  $<HTMLSelectElement>('atSize').addEventListener('change', (e) => { S.size = Number((e.target as HTMLSelectElement).value) })
  p.querySelectorAll<HTMLInputElement>('[data-ml]').forEach((c) => c.addEventListener('change', () => { S.mapLayers[c.dataset.ml as keyof MapLayers] = c.checked }))
  $('atPreview').addEventListener('click', () => void busy(tk('at.map.rendering'), async () => {
    const c = renderTo(1024); S.mapUrl = c.toDataURL('image/png'); mapBg = c; S.show.mapbg = true; S.done.add('s4'); go('s4')
  }))
  $('atV3d').addEventListener('click', () => void open3dAtelier())
  const big = async () => { const c = renderTo(S.size); return new Promise<Blob>((r) => c.toBlob((b) => r(b!), 'image/png')) }
  const fname = () => `${S.world!.name}_MapBackground_${S.style}_${mapSize(S.size)}.png`
  $('atPng').addEventListener('click', () => void busy(tk('at.map.rendering') + ` ${S.size}`, async () => download(fname(), await big(), 'image/png')))
  root.querySelector('#atPngSave')?.addEventListener('click', () => void busy(tk('at.map.rendering') + ` ${S.size}`, async () => {
    const b = new Uint8Array(await (await big()).arrayBuffer()), dest = `UI/Textures/Map/${fname()}`
    try { await bridgeWrite(dest, b, null); log(tk('at.map.saved', { f: dest })) } catch (e) { writeErr(e, dest) }
  }))
}
// ---------------------------------------------------------------- 3D view of the opened world (src/view3d)
// real data as OpsTrack: decoded heights, the realistic map (satellite supertexture + forests, roads, buildings) as drape,
// trees and buildings from the .layer entities
let v3dOpen: { close(): void } | null = null
async function open3dAtelier() {
  if (v3dOpen) return v3dOpen.close()
  if (!S.H || !S.terr || !S.objects) return
  await busy(tk('at.v3d.busy'), async (stage) => {
    stage(tk('at.v3d.load'))
    const mod = await import('../view3d')
    const tr = S.terr!, G = S.H!, side = Math.max(tr.sizeX, tr.sizeZ)
    const hm = { minX: 0, minZ: 0, step: G.cell, cols: G.cols, rows: G.rows, heights: G.h }
    const ob = S.objects!
    const trees = new Float32Array(ob.trees.length * 3), needle = new Uint8Array(ob.trees.length)
    ob.trees.forEach((x, i) => { trees[i * 3] = x.x; trees[i * 3 + 1] = x.z; trees[i * 3 + 2] = 0.8 + ((i * 2654435761) >>> 0) / 4294967296 * 0.4; needle[i] = x.type === 'conifer' ? 1 : 0 })
    const buildings = ob.buildings.map((b, i) => { const big2 = b.type !== 'house'; return { cx: b.x, cz: b.z, w: big2 ? 18 : 9, d: big2 ? 14 : 8, h: big2 ? 9 : 6, yaw: (((i * 40503) % 360) * Math.PI) / 180 } })
    const drape = (size: number) => {
      const sv = { style: S.style, legend: S.mapLayers.legend, slopes: S.mapLayers.slopes }
      S.style = 'realistic'; S.mapLayers.legend = false; S.mapLayers.slopes = false
      try {
        const m = renderTo(size), out = document.createElement('canvas'); out.width = out.height = size
        const k = size / side
        const g = out.getContext('2d')!
        g.drawImage(m, 0, (side - tr.sizeZ) * k, tr.sizeX * k, tr.sizeZ * k) // row 0 = north edge of the square
        // canopy: renderMap skips crowns above 400 k trees, so every tree is stamped here (dark crown, then lit core)
        const r = Math.max(1, 5 * k), DARK = ['#2a3d1c', '#33481f', '#3c5224', '#2e4422'], LIT = ['#4d6a2c', '#58752f', '#476328', '#5f7a36']
        for (let pass = 0; pass < 2; pass++) for (let j = 0; j < 4; j++) {
          g.fillStyle = pass ? LIT[j] : DARK[j]
          const s2 = pass ? r * 0.9 : r * 1.8, o2 = s2 / 2 + (pass ? r * 0.2 : 0)
          for (let i = j; i < ob.trees.length; i += 4) { const t2 = ob.trees[i]; g.fillRect(t2.x * k - o2, (side - t2.z) * k - o2, s2, s2) }
        }
        return { canvas: out, x0: 0, z0: 0, side }
      } finally { S.style = sv.style; S.mapLayers.legend = sv.legend; S.mapLayers.slopes = sv.slopes }
    }
    const host = $('atMap').parentElement!
    const T = (k: string) => tk('at.v3d.' + k)
    v3dOpen = await mod.open3d(host, {
      hm, sea: 0, buildings, trees, treeNeedle: needle, lakes: [], target: [tr.sizeX / 2, tr.sizeZ / 2], span: side,
    }, {
      text: { back: T('back'), exag: T('exag'), reset: T('reset'), top: T('top'), trees: T('trees'), help: T('help'), grid: T('grid'),
        drape: T('drape'), real: T('real'), map: T('map'), sat: T('sat'), genMs: (x) => tk('at.v3d.genMs', { s: x }), stage: (k) => T('st.' + k) },
      drape, progress: (st) => stage(st),
      onClose: () => { v3dOpen = null; (window as unknown as { __view3d: unknown }).__view3d = null },
    })
    ;(window as unknown as { __view3d: unknown }).__view3d = v3dOpen
  })
}
function writeErr(e: unknown, f: string) {
  const m = (e as Error).message
  if (m.startsWith('SHA_MISMATCH')) log(tk('at.water.changed', { f }), true)
  else log(m.startsWith('WORKBENCH_RUNNING') ? tk('at.water.wbOpen') : tk('at.err', { m }), true)
}

// ---------------------------------------------------------------- A5 contours
function panelContours(p: HTMLElement) {
  const c = S.contour
  const nums = (key: 'density' | 'major') => c[key].map((v, i) => `<input type="number" min="1" step="1" data-${key}="${i}" value="${v}">`).join('')
  const hex = '#' + c.land.slice(0, 3).map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('')
  p.innerHTML = `<label class="at-field">${tk('at.ct.density')}<span class="at-nums">${nums('density')}</span></label>
    <label class="at-field">${tk('at.ct.major')}<span class="at-nums">${nums('major')}</span></label>
    <label class="at-field">${tk('at.ct.width')}<span class="at-nums"><input id="atW1" type="number" step="0.1" value="${c.width}"><input id="atW2" type="number" step="0.1" value="${c.majorWidth}"></span></label>
    <label class="at-field">${tk('at.ct.color')}<input id="atCol" type="color" value="${hex}"></label>
    <label><input id="atCoast" type="checkbox" ${c.coastalAlpha === 0 ? 'checked' : ''}> ${tk('at.ct.coast')}</label>
    <label><input id="atWalls" type="checkbox" ${c.hideWalls ? 'checked' : ''}> ${tk('at.ct.walls')}</label>
    <p class="hint">${tk('at.ct.base')}</p>
    <pre id="atConf" class="at-pre"></pre>
    <div class="row"><button id="atConfDl" type="button">${tk('at.ct.download')}</button>${S.src?.canWrite ? `<button id="atConfSave" type="button" class="secondary">${tk('at.ct.save')}</button>` : ''}</div>
    <p class="at-note">${tk('at.ct.how')}</p>`
  const upd = () => { $('atConf').textContent = contourConf(c) }
  p.querySelectorAll<HTMLInputElement>('[data-density],[data-major]').forEach((i) => i.addEventListener('input', () => {
    const k = i.dataset.density !== undefined ? 'density' : 'major', idx = Number(i.dataset.density ?? i.dataset.major)
    c[k][idx] = Math.max(1, Number(i.value) || 1); upd()
  }))
  $<HTMLInputElement>('atW1').addEventListener('input', (e) => { c.width = Number((e.target as HTMLInputElement).value) || 1; upd() })
  $<HTMLInputElement>('atW2').addEventListener('input', (e) => { c.majorWidth = Number((e.target as HTMLInputElement).value) || 2; upd() })
  $<HTMLInputElement>('atCol').addEventListener('input', (e) => { const v = (e.target as HTMLInputElement).value; c.land = [1, 3, 5].map((o) => parseInt(v.slice(o, o + 2), 16) / 255).concat(c.land[3]) as ContourSettings['land']; upd() })
  $<HTMLInputElement>('atCoast').addEventListener('change', (e) => { c.coastalAlpha = (e.target as HTMLInputElement).checked ? 0 : 1; upd() })
  $<HTMLInputElement>('atWalls').addEventListener('change', (e) => { c.hideWalls = (e.target as HTMLInputElement).checked; upd() })
  $('atConfDl').addEventListener('click', () => { download(CONTOUR_FILE, contourConf(c), 'text/plain'); S.done.add('s5'); header() })
  root.querySelector('#atConfSave')?.addEventListener('click', () => void busy(tk('at.ct.save'), async () => {
    const dest = `Configs/Map/${CONTOUR_FILE}`
    let sha: string | null = null
    try { sha = (await S.src!.read(dest)).sha } catch { /* new file */ }
    try { await bridgeWrite(dest, contourConf(c), sha); log(tk('at.map.saved', { f: dest })); S.done.add('s5') } catch (e) { writeErr(e, dest) }
  }))
  upd()
}

// ---------------------------------------------------------------- A6 export / backups / archive
function panelExport(p: HTMLElement) {
  p.innerHTML = `<h4>${tk('at.ex.backups')}</h4><div id="atBk"></div>
    <h4>${tk('at.ex.archive')}</h4><p class="hint">${tk('at.ex.archive.tip')}</p><button id="atArch" type="button" ${S.src ? '' : 'disabled'}>${tk('at.ex.archive.go')}</button>
    <h4>${tk('at.journal')}</h4><pre class="at-pre">${esc(S.journal.join('\n') || tk('at.journal.empty'))}</pre>
    <h4>${tk('at.ex.generator')}</h4><p class="hint">${tk('at.ex.generator.tip')}</p><button id="atGen" type="button" class="secondary" ${S.H ? '' : 'disabled'}>${tk('at.ex.generator')}</button>`
  $('atArch').addEventListener('click', () => void exportArchive())
  $('atGen').addEventListener('click', () => {
    if (!S.H) return
    const how = continueInGenerator(islandProject(S.H, { bodies: S.bodies, roads: S.objects?.roads }))
    if (how === 'download') log(tk('at.ex.generator.file'))
  })
  void backups()
}
async function backups() {
  const el = root.querySelector('#atBk'); if (!el) return
  if (S.src?.kind !== 'bridge') { el.innerHTML = `<p class="hint">${tk('at.ex.noBackups')}</p>`; return }
  try { S.backups = await bridgeBackups() } catch (e) { el.innerHTML = `<p class="err">${esc((e as Error).message)}</p>`; return }
  el.innerHTML = (S.backups.length ? `<ul class="at-list">${S.backups.map((b, i) => `<li><b>${esc(b.file)}</b><small>${esc(b.stamp)} · ${(b.size / 1e6).toFixed(2)} MB · ${tk('at.ex.cur.' + b.current)}</small><button type="button" class="secondary" data-rs="${i}" ${b.current === 'original' ? 'disabled' : ''}>${tk('at.ex.restore')}</button></li>`).join('')}</ul>` : `<p class="hint">${tk('at.ex.noBackups')}</p>`) + `<button id="atBkR" type="button" class="secondary">${tk('at.ex.refresh')}</button>`
  root.querySelector('#atBkR')!.addEventListener('click', () => void backups())
  el.querySelectorAll<HTMLButtonElement>('[data-rs]').forEach((b) => b.addEventListener('click', () => void busy(tk('at.ex.restore'), async () => {
    const k = S.backups[Number(b.dataset.rs)]
    const force = k.current === 'changed' ? confirm(tk('at.ex.forceAsk', { f: k.file })) : false
    if (k.current === 'changed' && !force) return
    try { await bridgeRestore(k.stamp, k.file, force); log(tk('at.ex.restored', { f: k.file })); S.water = null; if (S.world) await loadWorld(S.world) } catch (e) { writeErr(e, k.file) }
    await backups()
  })))
}
async function exportArchive() {
  const enc = new TextEncoder(), files: { name: string; data: Uint8Array }[] = []
  const decisions = (S.water ?? []).map((x, i) => ({ file: x.file, kind: x.kind, name: x.name, cx: x.cx, cz: x.cz, status: x.status, apply: S.use.has(i) }))
  files.push({ name: 'manifest.json', data: enc.encode(JSON.stringify({ format: 'reforger-mapper-atelier', format_version: 1, exported_at: new Date().toISOString(), project: S.src?.info.title, project_folder: S.src?.info.root, world: S.world?.ent ?? null, budget: S.budget, style: S.style, size: S.size, mapLayers: S.mapLayers, contour: S.contour, water: decisions }, null, 1)) })
  files.push({ name: 'outputs/' + CONTOUR_FILE, data: enc.encode(contourConf(S.contour)) })
  if (S.diag && S.terr) files.push({ name: 'outputs/tile_diagnostic.csv', data: enc.encode(diagCsv(S.terr, S.diag, S.budget)) })
  if (S.mapUrl) files.push({ name: 'outputs/map_preview.png', data: Uint8Array.from(atob(S.mapUrl.split(',')[1]), (c) => c.charCodeAt(0)) })
  files.push({ name: 'outputs/journal.txt', data: enc.encode(S.journal.join('\n')) })
  download(`${(S.world?.name ?? S.src?.info.title ?? 'projet').replace(/\W+/g, '_')}.rmatelier.zip`, zip(files), 'application/zip')
  S.done.add('s6'); header()
}
async function importArchive(f: File) {
  await busy(tk('at.open.import'), async () => {
    const z = await unzip(new Uint8Array(await f.arrayBuffer())), dec = new TextDecoder()
    const man = z.get('manifest.json') ? JSON.parse(dec.decode(z.get('manifest.json'))) : null
    if (man?.format === 'reforger-mapper-atelier') {
      if (man.budget) S.budget = man.budget
      if (man.style) S.style = man.style
      if (man.size) S.size = man.size
      if (man.mapLayers) Object.assign(S.mapLayers, man.mapLayers)
      if (man.contour) S.contour = man.contour
      if (man.project_folder) $<HTMLInputElement>('atPath').value = man.project_folder
      log(tk('at.ex.imported', { n: f.name }))
    } else {
      // giorbev .mgp.zip: manifest {format "mgp-project"} + project.json (grid_w, num_blk, tile_size_m, pipeline.reforger_block_limit, addon path)
      const pj = z.get('project.json') ? JSON.parse(dec.decode(z.get('project.json'))) : {}
      const b = pj?.pipeline?.reforger_block_limit
      if (b === 5 || b === 7) S.budget = b
      const path = pj.addon_reforger ?? pj.addon_path ?? man?.external_paths?.addon_reforger ?? ''
      if (path) $<HTMLInputElement>('atPath').value = String(path)
      log(tk('at.ex.mgp', { g: pj.grid_w ? `${pj.grid_w}×${pj.grid_w}` : '?', b: b ?? '?', p: path || '?' }))
    }
  })
}

function download(name: string, data: string | Uint8Array | Blob, type: string) {
  const blob = data instanceof Blob ? data : new Blob([data as BlobPart], { type })
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 4000)
  log('↓ ' + name)
}

// ---------------------------------------------------------------- map view
let cv: HTMLCanvasElement, base: HTMLCanvasElement | null = null, mapBg: HTMLCanvasElement | null = null
const view = { cx: 0, cz: 0, s: 0.1 }
let userMoved = false
function makeBase() {
  const tr = S.terr!, H = S.H!, n = 1024, c = document.createElement('canvas'), mpp = tr.sizeX / n, nh = Math.round(tr.sizeZ / mpp)
  c.width = n; c.height = nh
  const x = c.getContext('2d')!, img = x.createImageData(n, nh)
  for (let j = 0; j < nh; j++) for (let i = 0; i < n; i++) {
    const wx = (i + 0.5) * mpp, wz = tr.sizeZ - (j + 0.5) * mpp, h = heightAt(H, wx, wz)
    const dx = heightAt(H, wx + mpp, wz) - heightAt(H, wx - mpp, wz), dz = heightAt(H, wx, wz + mpp) - heightAt(H, wx, wz - mpp)
    const sh = Math.max(0.25, Math.min(1, 0.75 - (dx - dz) / (4 * mpp)))
    const o = (j * n + i) * 4
    if (h < 0) { img.data[o] = 40; img.data[o + 1] = 70 + 30 * sh; img.data[o + 2] = 95 + 40 * sh }
    else { const l = Math.min(1, (h - Math.max(0, H.min)) / Math.max(1, H.max - Math.max(0, H.min))); img.data[o] = (70 + 90 * l) * sh; img.data[o + 1] = (85 + 70 * l) * sh; img.data[o + 2] = (60 + 60 * l) * sh }
    img.data[o + 3] = 255
  }
  x.putImageData(img, 0, 0); base = c
}
function fit() {
  if (!S.terr || !cv) return
  view.cx = S.terr.sizeX / 2; view.cz = S.terr.sizeZ / 2
  view.s = Math.min(cv.width / S.terr.sizeX, cv.height / S.terr.sizeZ) * 0.95
}
function zoomTile(tx: number, ty: number) {
  const ts = S.terr!.cellsPerTile * S.terr!.cellSize
  view.cx = (tx + 0.5) * ts; view.cz = (ty + 0.5) * ts; view.s = Math.min(cv.width, cv.height) / (ts * 1.6); draw()
}
function zoomWater(x: WaterProposal) {
  const xs = x.body.x, zs = x.body.z, w = Math.max(...xs) - Math.min(...xs), h = Math.max(...zs) - Math.min(...zs)
  view.cx = (Math.max(...xs) + Math.min(...xs)) / 2; view.cz = (Math.max(...zs) + Math.min(...zs)) / 2
  view.s = Math.min(cv.width / Math.max(w * 1.4, 60), cv.height / Math.max(h * 1.4, 60))
}
const toScreen = (x: number, z: number): [number, number] => [(x - view.cx) * view.s + cv.width / 2, (view.cz - z) * view.s + cv.height / 2]
const toWorld = (px: number, py: number): [number, number] => [(px - cv.width / 2) / view.s + view.cx, view.cz - (py - cv.height / 2) / view.s]

function setupMap() {
  cv = $<HTMLCanvasElement>('atMap')
  const resize = () => { const r = cv.parentElement!.getBoundingClientRect(); cv.width = Math.max(200, r.width); cv.height = Math.max(200, r.height); if (!userMoved) fit(); draw() }
  new ResizeObserver(resize).observe(cv.parentElement!)
  let drag: [number, number, number, number] | null = null, moved = false
  cv.addEventListener('pointerdown', (e) => { drag = [e.clientX, e.clientY, view.cx, view.cz]; moved = false; cv.setPointerCapture(e.pointerId) })
  cv.addEventListener('pointermove', (e) => {
    const r = cv.getBoundingClientRect(), [wx, wz] = toWorld(e.clientX - r.left, e.clientY - r.top)
    $('atCursor').textContent = S.H ? `X ${wx.toFixed(0)}  Z ${wz.toFixed(0)}  Y ${heightAt(S.H, wx, wz).toFixed(1)} m` : ''
    if (drag) { userMoved = true; const dx = e.clientX - drag[0], dy = e.clientY - drag[1]; if (Math.abs(dx) + Math.abs(dy) > 3) moved = true; view.cx = drag[2] - dx / view.s; view.cz = drag[3] + dy / view.s; draw() }
  })
  cv.addEventListener('pointerup', (e) => {
    drag = null
    if (moved || !S.terr) return
    const r = cv.getBoundingClientRect(), [wx, wz] = toWorld(e.clientX - r.left, e.clientY - r.top), ts = S.terr.cellsPerTile * S.terr.cellSize
    const tx = Math.floor(wx / ts), ty = Math.floor(wz / ts)
    if (tx >= 0 && ty >= 0 && tx < S.terr.tilesX && ty < S.terr.tilesZ) { S.selTile = [tx, ty]; if (S.step === 's1') tileInfo(); draw() }
  })
  cv.addEventListener('wheel', (e) => {
    e.preventDefault()
    const r = cv.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top, [wx, wz] = toWorld(px, py)
    view.s *= e.deltaY < 0 ? 1.2 : 1 / 1.2; userMoved = true
    view.cx = wx - (px - cv.width / 2) / view.s; view.cz = wz + (py - cv.height / 2) / view.s; draw()
  }, { passive: false })
}

function draw() {
  if (!cv) return
  const g = cv.getContext('2d')!
  g.fillStyle = '#0B0C0D'; g.fillRect(0, 0, cv.width, cv.height)
  const tr = S.terr
  if (!tr) return
  const [x0, y0] = toScreen(0, tr.sizeZ), w = tr.sizeX * view.s, h = tr.sizeZ * view.s
  g.imageSmoothingEnabled = view.s < 1
  const bg = S.show.mapbg && mapBg ? mapBg : S.show.relief ? base : null
  if (bg) g.drawImage(bg, x0, y0, w, h)
  else { g.strokeStyle = '#3A3F44'; g.strokeRect(x0, y0, w, h) }
  const bs = tr.cellsPerBlock * tr.cellSize, ts = tr.cellsPerTile * tr.cellSize
  if (S.show.tiles && S.diag && (S.step === 's1' || S.step === 's2' || S.step === 's0')) {
    const d = S.diag
    for (const b of d.blocks) {
      const n = b.mats.length, [sx, sy] = toScreen(b.bx * bs, (b.by + 1) * bs), sz = bs * view.s
      if (sx > cv.width || sy > cv.height || sx + sz < 0 || sy + sz < 0) continue
      const hit = S.search !== null && b.mats.includes(S.search)
      g.fillStyle = hit ? 'rgba(80,170,255,.75)' : n === 0 ? 'rgba(120,120,120,.6)' : n > S.budget ? 'rgba(199,80,63,.7)' : n === S.budget ? 'rgba(224,162,51,.55)' : n === S.budget - 1 ? 'rgba(160,170,60,.3)' : 'rgba(95,162,74,.18)'
      if (S.search !== null && !hit) continue
      g.fillRect(sx, sy, sz, sz)
    }
    g.strokeStyle = 'rgba(234,237,239,.25)'; g.lineWidth = 1
    for (let i = 0; i <= tr.tilesX; i++) { const [a] = toScreen(i * ts, 0); g.beginPath(); g.moveTo(a, y0); g.lineTo(a, y0 + h); g.stroke() }
    for (let j = 0; j <= tr.tilesZ; j++) { const [, b] = toScreen(0, j * ts); g.beginPath(); g.moveTo(x0, b); g.lineTo(x0 + w, b); g.stroke() }
  }
  if (S.selTile) { const [sx, sy] = toScreen(S.selTile[0] * ts, (S.selTile[1] + 1) * ts); g.strokeStyle = '#F0BB5A'; g.lineWidth = 2; g.strokeRect(sx, sy, ts * view.s, ts * view.s) }
  if (S.show.objects && S.objects) {
    g.strokeStyle = 'rgba(240,187,90,.8)'; g.lineWidth = 1
    for (const r of S.objects.roads) { g.beginPath(); r.pts.forEach(([x, z], k) => { const [a, b] = toScreen(x, z); if (k) g.lineTo(a, b); else g.moveTo(a, b) }); g.stroke() }
    g.fillStyle = 'rgba(199,80,63,.9)'
    for (const b of S.objects.buildings) { const [a, c] = toScreen(b.x, b.z); g.fillRect(a - 1.5, c - 1.5, 3, 3) }
  }
  if (S.show.water && (S.step === 's3' || S.step === 's4')) {
    for (const [i, x] of (S.water ?? []).entries()) {
      if (x.water) {
        const m = x.water, [sx, sy] = toScreen(m.x0, m.z1)
        if (sx < cv.width && sy < cv.height && sx + m.W * view.s > 0 && sy + m.H * view.s > 0) {
          const oc = waterCanvas(x); g.drawImage(oc, sx, sy, m.W * view.s, m.H * view.s)
        }
      }
      const line = (P: [number, number][] | undefined, col: string, closed: boolean, lw: number) => { if (!P?.length) return; g.strokeStyle = col; g.lineWidth = lw; g.beginPath(); P.forEach(([a, b], k) => { const [u, v] = toScreen(a, b); if (k) g.lineTo(u, v); else g.moveTo(u, v) }); if (closed) g.closePath(); g.stroke() }
      const sel = S.selWater === i
      line(x.oldOutline, sel ? '#ff5040' : 'rgba(199,80,63,.85)', x.kind === 'lake', sel ? 2.5 : 1.2)
      if (x.newOutline && S.use.has(i)) line(x.newOutline, '#7DBE64', true, sel ? 2.5 : 1.5)
    }
    if (!S.water) for (const b of S.bodies) { g.strokeStyle = 'rgba(94,160,220,.9)'; g.lineWidth = 1.5; g.beginPath(); b.x.forEach((x, k) => { const [u, v] = toScreen(x, b.z[k]); if (k) g.lineTo(u, v); else g.moveTo(u, v) }); if (b.kind === 'lake') g.closePath(); g.stroke() }
  }
}
const wcache = new WeakMap<object, HTMLCanvasElement>()
function waterCanvas(x: WaterProposal): HTMLCanvasElement {
  const m = x.water!, hit = wcache.get(m)
  if (hit) return hit
  const c = document.createElement('canvas'); c.width = m.W; c.height = m.H
  const g = c.getContext('2d')!, img = g.createImageData(m.W, m.H)
  for (let i = 0; i < m.m.length; i++) if (m.m[i]) { img.data[i * 4] = 60; img.data[i * 4 + 1] = 140; img.data[i * 4 + 2] = 230; img.data[i * 4 + 3] = 170 }
  g.putImageData(img, 0, 0); wcache.set(m, c); return c
}

function legend() {
  const el = root.querySelector('#atLegend'); if (!el) return
  const sw = (c: string, l: string) => `<div><i style="background:${c}"></i>${esc(l)}</div>`
  if (S.step === 's1' || S.step === 's2') el.innerHTML = sw('rgba(95,162,74,.6)', tk('at.diag.legend.ok')) + sw('rgba(224,162,51,.9)', tk('at.diag.legend.at')) + sw('rgba(199,80,63,.9)', tk('at.diag.legend.over')) + sw('rgba(120,120,120,.9)', tk('at.diag.legend.empty'))
  else if (S.step === 's3') el.innerHTML = sw('rgb(60,140,230)', tk('at.lg.water')) + sw('#c7503f', tk('at.lg.old')) + sw('#7DBE64', tk('at.lg.new'))
  else el.innerHTML = legendItems().map(([l, c]) => sw(`rgb(${c.join(',')})`, l)).join('')
}
