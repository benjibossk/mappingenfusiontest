// library.html: browse the public asset library (vanilla seed + every library/*.json pack in the
// repo + packs imported locally), filter by biome / kind / tags / text, preview an asset or a
// parcel template in 3D (viewer3d is lazy-loaded). FR/EN follows the app language (i18n.ts).

import './page.css'
import { BIOMES, biome, type Biome, type BiomeId } from '../data/biomes.ts'
import { ASSET_KINDS, buildLibrary, importPack, search, tagCounts, VANILLA_PACK, type Asset, type AssetKind, type AssetPack, type Library } from './index.ts'
import { LOT_TEMPLATES, demoLot, generateParcel, lotTemplate } from '../biomes/parcel.ts'
import { getLang, t as tr, type Key } from '../i18n.ts'
import type { Viewer } from './viewer3d.ts'

const FR = getLang() === 'fr' // same language as the app (i18n.ts)
const lab = (o: { en: string; fr: string }) => (FR ? o.fr : o.en)
const kindLabel = (k: AssetKind) => tr(('lib.kind.' + k) as Key)
const AVAIL = { vanilla: tr('lib.vanilla'), partial: tr('lib.partial'), mods: tr('lib.needs_mods') }

// community packs committed in the repo (library/*.json), validated at load
const repoPacks: AssetPack[] = []
const loadErrors: string[] = []
for (const [path, raw] of Object.entries(import.meta.glob('/library/*.json', { eager: true, query: '?raw', import: 'default' }))) {
  try { repoPacks.push(importPack(raw as string)) } catch (e) { loadErrors.push(`${path}: ${(e as Error).message.split('\n')[0]}`) }
}
const localPacks: AssetPack[] = []
let lib: Library = buildLibrary([VANILLA_PACK, ...repoPacks])

const st = { biome: 'temperate_everon' as BiomeId, kind: '' as AssetKind | '', text: '', tags: [] as string[], fallback: true, mode: 'parcel' as 'parcel' | 'asset', tpl: LOT_TEMPLATES[1].id, seed: 1, sel: '' }

const app = document.getElementById('lib-app')!
app.innerHTML = `
<header class="lb-head"><h1>${tr('lib.title')}</h1>
  <span class="lb-sub">${tr('lib.lead')}</span>
  <a class="lb-back" href="./">← reforger-mapper</a></header>
<main class="lb-main">
  <aside class="lb-side">
    <label>${tr('lib.biome')}<select id="f-biome">${BIOMES.map((b) => `<option value="${b.id}">${lab(b.label)} · ${AVAIL[b.availability]}</option>`).join('')}</select></label>
    <p id="b-desc" class="lb-desc"></p>
    <label class="lb-check"><input type="checkbox" id="f-fb" checked> ${tr('lib.include_fallback_biome')}</label>
    <label>${tr('lib.kind')}<select id="f-kind"><option value="">${tr('lib.all')}</option>${ASSET_KINDS.map((k) => `<option value="${k}">${kindLabel(k)}</option>`).join('')}</select></label>
    <label>${tr('lib.search')}<input id="f-text" type="search" placeholder="FarmHouse, pinus, ussr…"></label>
    <div class="lb-tags" id="f-tags"></div>
    <div class="lb-packs" id="packs"></div>
    <label class="lb-import">${tr('lib.import_a_json_pack')}<input id="f-import" type="file" accept=".json,application/json"></label>
    <p id="msg" class="lb-msg"></p>
  </aside>
  <section class="lb-list"><div class="lb-count" id="count"></div><ul id="list"></ul></section>
  <section class="lb-view">
    <div class="lb-tabs">
      <button id="m-parcel" class="on">${tr('lib.lot')}</button><button id="m-asset">${tr('lib.asset')}</button>
      <select id="f-tpl">${LOT_TEMPLATES.map((t) => `<option value="${t.id}">${lab(t.label)}</option>`).join('')}</select>
      <button id="reroll" title="seed">🎲</button>
    </div>
    <div id="view3d" class="lb-canvas"></div>
    <div id="info" class="lb-info"></div>
  </section>
</main>`

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
// one shared promise: render() runs several times at start-up (and on every keystroke), and a plain
// `if (!viewer)` check across the await created several renderers on the same host — the visible
// first canvas then never received content (empty preview)
let viewerP: Promise<Viewer | null> | null = null
function getViewer(): Promise<Viewer | null> {
  viewerP ??= import('./viewer3d.ts').then(({ createViewer }) => createViewer($('view3d'))).catch((err) => {
    console.warn('3D preview unavailable:', err)
    $('view3d').innerHTML = `<div class="lb-nogl">${esc(tr('lib.no3d'))}</div>`
    return null
  })
  return viewerP
}
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

function renderPacks() {
  $('packs').innerHTML = `<b>${tr('lib.packs')}</b>` + lib.packs.map((p) => `<div>${esc(p.name)} <small>(${p.count}) — ${esc(p.author)}</small></div>`).join('')
    + (loadErrors.length ? `<div class="lb-err">${loadErrors.map(esc).join('<br>')}</div>` : '')
}

function results(): Asset[] {
  return search(lib, { biome: st.biome, kind: st.kind || undefined, text: st.text, tags: st.tags, fallback: st.fallback })
}

function render() {
  const b = biome(st.biome)!
  // "Missing" is a warning only when a biome really lacks assets (vanilla biomes: neutral/green)
  $('b-desc').innerHTML = `${esc(lab(b.desc))}<br><em class="${b.missing.en.startsWith('Nothing') ? 'ok' : b.availability === 'vanilla' ? 'note' : 'miss'}">${tr('lib.missing')} : ${esc(lab(b.missing))}</em><br><small>FF : ${b.ff}${b.maps.length ? ' · ' + b.maps.join(', ') : ''}</small>`
  const res = results()
  const tags = tagCounts(search(lib, { biome: st.biome, kind: st.kind || undefined, fallback: st.fallback })).slice(0, 24)
  $('f-tags').innerHTML = tags.map(([t, n]) => `<button class="tag${st.tags.includes(t) ? ' on' : ''}" data-tag="${esc(t)}">${esc(t)} <small>${n}</small></button>`).join('')
  $('count').textContent = `${res.length} ${tr('lib.assets')}`
  $('list').innerHTML = res.slice(0, 300).map((a) => `<li data-guid="${esc(a.guid)}" class="${a.guid === st.sel ? 'sel' : ''}">
    <span class="k k-${a.kind}">${kindLabel(a.kind)}</span><span class="n">${esc(a.name ?? a.guid)}</span>
    <span class="t">${a.tags.slice(0, 4).map(esc).join(' · ')}</span></li>`).join('')
  void preview()
}

async function preview() {
  const b: Biome = biome(st.biome)!
  const v = await getViewer()
  if (!v) return
  $('m-parcel').classList.toggle('on', st.mode === 'parcel'); $('m-asset').classList.toggle('on', st.mode === 'asset')
  ;($('f-tpl') as HTMLSelectElement).style.display = st.mode === 'parcel' ? '' : 'none'
  if (st.mode === 'asset') {
    const a = lib.assets.find((x) => x.guid === st.sel) ?? results()[0]
    if (!a) { $('info').textContent = tr('lib.no_asset'); return }
    v.showAsset(a, b)
    const f = a.footprint
    $('info').innerHTML = `<code>${esc(a.guid)}</code><br>${kindLabel(a.kind)} · ${(f.maxX - f.minX).toFixed(1)}×${(f.maxZ - f.minZ).toFixed(1)}×${f.h} m${f.measured ? '' : ' (' + tr('lib.estimated') + ')'} · ${esc(a.source)} · ${esc(a.author)} · ${esc(a.licence)}<br>${tr('lib.biomes')} : ${a.biomes.join(', ')}`
  } else {
    const t = lotTemplate(st.tpl)!
    const p = generateParcel(lib, st.biome, t, demoLot(t.size.w[1], t.size.d[1]), st.seed)
    v.showParcel(p, b)
    $('info').innerHTML = `${esc(lab(t.label))} · ${t.size.w[1]}×${t.size.d[1]} m · ${p.items.length} ${tr('lib.items')}, ${p.fences.length} ${tr('lib.fences')} · seed ${st.seed}`
      + (p.warnings.length ? `<br><span class="lb-warn">${p.warnings.map(esc).join('<br>')}</span>` : '')
  }
}

$<HTMLSelectElement>('f-biome').onchange = (e) => { st.biome = (e.target as HTMLSelectElement).value as BiomeId; st.tags = []; render() }
$<HTMLSelectElement>('f-kind').onchange = (e) => { st.kind = (e.target as HTMLSelectElement).value as AssetKind | ''; st.tags = []; render() }
$<HTMLInputElement>('f-fb').onchange = (e) => { st.fallback = (e.target as HTMLInputElement).checked; render() }
$<HTMLInputElement>('f-text').oninput = (e) => { st.text = (e.target as HTMLInputElement).value; render() }
$<HTMLSelectElement>('f-tpl').onchange = (e) => { st.tpl = (e.target as HTMLSelectElement).value; void preview() }
$('reroll').onclick = () => { st.seed++; void preview() }
$('m-parcel').onclick = () => { st.mode = 'parcel'; void preview() }
$('m-asset').onclick = () => { st.mode = 'asset'; void preview() }
$('f-tags').onclick = (e) => {
  const t = (e.target as HTMLElement).closest<HTMLElement>('[data-tag]')?.dataset.tag
  if (!t) return
  st.tags = st.tags.includes(t) ? st.tags.filter((x) => x !== t) : [...st.tags, t]; render()
}
$('list').onclick = (e) => {
  const g = (e.target as HTMLElement).closest<HTMLElement>('[data-guid]')?.dataset.guid
  if (!g) return
  st.sel = g; st.mode = 'asset'; render()
}
$<HTMLInputElement>('f-import').onchange = async (e) => {
  const f = (e.target as HTMLInputElement).files?.[0]
  if (!f) return
  try {
    localPacks.push(importPack(await f.text()))
    lib = buildLibrary([VANILLA_PACK, ...repoPacks, ...localPacks])
    $('msg').textContent = tr('lib.pack_imported') + (lib.conflicts.length ? ` — ${lib.conflicts.length} ${tr('lib.duplicates_skipped')}` : '')
    renderPacks(); render()
  } catch (err) { $('msg').textContent = (err as Error).message }
}

$<HTMLSelectElement>('f-tpl').value = st.tpl
renderPacks()
render()
