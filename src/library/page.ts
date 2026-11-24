// library.html: browse the public asset library (vanilla seed + every library/*.json pack in the
// repo + packs imported locally), filter by biome / kind / tags / text, preview an asset or a
// parcel template in 3D (viewer3d is lazy-loaded). FR/EN follows the app language (i18n.ts).

import './page.css'
import { BIOMES, biome, type Biome, type BiomeId } from '../data/biomes.ts'
import { ASSET_KINDS, buildLibrary, COMPOSITIONS_PACK, HARBOURS_PACK, PARCELS_PACK, importPack, search, tagCounts, VANILLA_PACK, type Asset, type AssetKind, type AssetPack, type Composition, type Library } from './index.ts'
import { compoId, importComposition } from './composition.ts'
import { parcelsByCategory, savedToComposition, PARCEL_CATEGORIES, type ParcelCategory, type SavedParcel } from './parcelLib.ts'
import { BRIDGE_URL } from '../bridge.ts'
import { LOT_TEMPLATES, demoLot, generateParcel, lotTemplate, type Parcel3D } from '../biomes/parcel.ts'
import { getLang, t as tr, type Key } from '../i18n.ts'
import type { Viewer } from './viewer3d.ts'
import { modsChecklist } from '../modsPanel.ts'
import { MOD_INDEX } from './mods.ts'
import { modAssetPack } from '../data/modBuildings.ts'

const FR = getLang() === 'fr' // same language as the app (i18n.ts)
const lab = (o: { en: string; fr: string }) => (FR ? o.fr : o.en)
const kindLabel = (k: AssetKind) => tr(('lib.kind.' + k) as Key)
const AVAIL = { vanilla: tr('lib.vanilla'), partial: tr('lib.partial'), mods: tr('lib.needs_mods') }

// community packs committed in the repo (library/*.json), validated at load
const repoPacks: AssetPack[] = []
const loadErrors: string[] = []
for (const [path, raw] of Object.entries(import.meta.glob('/library/*.json', { eager: true, query: '?raw', import: 'default' }))) {
  if (path.endsWith('/compositions-vanilla.json') || path.endsWith('/parcels-vanilla.json') || path.endsWith('/parcels-harbour.json')) continue // already built in (COMPOSITIONS_PACK, PARCELS_PACK)
  // other data files live in /library too (prefabs-catalogue, prefabs-captions): only files that declare a pack format are packs
  try { const j = JSON.parse(raw as string) as { format?: unknown }; if (typeof j !== 'object' || j === null || !('format' in j)) continue } catch { /* not JSON: let importPack report it */ }
  try { repoPacks.push(importPack(raw as string)) } catch (e) { loadErrors.push(`${path}: ${(e as Error).message.split('\n')[0]}`) }
}
// Workshop mod registries (library/mods), browsable whether or not they are ticked for the generators
const modPacks = MOD_INDEX.map((m) => modAssetPack(m.guid)).filter((x): x is AssetPack => !!x)
repoPacks.push(...modPacks)
const localPacks: AssetPack[] = []
const userCompos: Composition[] = []
const userPack = (): AssetPack => ({ format: 'reforger-mapper.assetpack', version: 1, id: 'my-compositions', name: FR ? 'Mes compositions' : 'My compositions', author: 'local', licence: 'CC-BY-4.0', source: 'vanilla', assets: [], compositions: userCompos })
const wbCompos: Composition[] = [] // saved in the Workbench (MG_SaveParcelPlugin, bridge GET /parcels)
const wbPack = (): AssetPack => ({ format: 'reforger-mapper.assetpack', version: 1, id: 'workbench-parcels', name: FR ? 'Parcelles du Workbench' : 'Workbench parcels', author: 'local', licence: 'CC-BY-4.0', source: 'vanilla', assets: [], compositions: wbCompos })
const rebuild = () => buildLibrary([VANILLA_PACK, COMPOSITIONS_PACK, PARCELS_PACK, HARBOURS_PACK, ...(wbCompos.length ? [wbPack()] : []), ...repoPacks, ...localPacks, ...(userCompos.length ? [userPack()] : [])])
let lib: Library = buildLibrary([VANILLA_PACK, COMPOSITIONS_PACK, PARCELS_PACK, HARBOURS_PACK, ...repoPacks])

const st = { biome: 'temperate_everon' as BiomeId, kind: '' as AssetKind | '', text: '', tags: [] as string[], fallback: true, mode: 'parcel' as 'parcel' | 'asset', tpl: LOT_TEMPLATES[1].id, seed: 1, sel: '', compos: false, compo: '', src: '', view: 'parcels' as 'parcels' | 'prefabs', pcat: '' as ParcelCategory | '', allTags: false }

const app = document.getElementById('lib-app')!
const DICE = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="4" y="4" width="16" height="16"/><circle cx="9" cy="9" r="1.2" fill="currentColor"/><circle cx="15" cy="15" r="1.2" fill="currentColor"/><circle cx="15" cy="9" r="1.2" fill="currentColor"/><circle cx="9" cy="15" r="1.2" fill="currentColor"/></svg>'
app.innerHTML = `
<header class="lb-head"><h1>${tr('lib.title')}</h1>
  <span class="lb-sub">${tr('lib.lead')}</span>
  <span class="lb-grow"></span>
  <button type="button" id="packsBtn" class="lb-btn" aria-controls="packsDrawer" aria-expanded="false">${tr('lib.packs_mods')}</button>
  <a class="lb-back" href="./">← reforger-mapper</a></header>
<main class="lb-main">
  <aside class="lb-side">
    <div class="lb-tabs"><button id="v-parcels" class="on">${tr('lib.view_parcels')}</button><button id="v-prefabs">${tr('lib.view_prefabs')}</button></div>
    <label class="lb-field">${tr('lib.search')}<input id="f-text" type="search" placeholder="FarmHouse, pinus, ussr…"></label>
    <label class="lb-field">${tr('lib.biome')}<select id="f-biome">${BIOMES.map((b) => `<option value="${b.id}">${lab(b.label)} · ${AVAIL[b.availability]}</option>`).join('')}</select></label>
    <p id="b-desc" class="lb-desc"></p>
    <div class="lb-two">
      <label id="l-pcat" class="lb-field">${tr('lbl.plCat')}<select id="f-pcat"><option value="">${tr('lib.pcat_all')}</option>${PARCEL_CATEGORIES.map((k) => `<option value="${k}">${tr(('lib.pcat.' + k) as Key)}</option>`).join('')}</select></label>
      <label id="l-kind" class="lb-field">${tr('lib.kind')}<select id="f-kind"><option value="">${tr('lib.all')}</option>${ASSET_KINDS.map((k) => `<option value="${k}">${kindLabel(k)}</option>`).join('')}</select></label>
      <label class="lb-field">Source<select id="f-src"><option value="">${tr('lib.all')}</option><option value="vanilla">vanilla</option>${modPacks.map((m) => `<option value="${m.source}">${m.name.replace(/s+/g, '')}</option>`).join('')}</select></label>
    </div>
    <label class="lb-check"><input type="checkbox" id="f-fb" checked> ${tr('lib.include_fallback_biome')}</label>
    <div class="lb-tagshead"><span>${tr('lib.tags')}</span><button type="button" id="tagsMore" class="lb-link"></button></div>
    <div class="lb-tags" id="f-tags"></div>
  </aside>
  <section class="lb-list"><div class="lb-listhead"><span id="count"></span><button type="button" id="clearF" class="lb-link" hidden>${tr('lib.clear')}</button></div><ul id="list"></ul></section>
  <section class="lb-view">
    <div class="lb-tabs">
      <span class="lb-seg" role="tablist"><button id="m-parcel" class="on" role="tab">${tr('lib.lot')}</button><button id="m-asset" role="tab">${tr('lib.asset')}</button></span>
      <select id="f-tpl" aria-label="${tr('lib.lot')}">${LOT_TEMPLATES.map((t) => `<option value="${t.id}">${lab(t.label)}</option>`).join('')}</select>
      <select id="f-compo-sel"></select>
      <label class="lb-check"><input type="checkbox" id="f-compos"> ${tr('lib.real_compos')}</label>
      <button id="reroll" class="lb-btn lb-ico" title="seed" aria-label="seed">${DICE}</button>
    </div>
    <div id="view3d" class="lb-canvas"></div>
    <div id="info" class="lb-info"></div>
  </section>
</main>
<aside id="packsDrawer" class="lb-drawer" hidden aria-label="${tr('lib.packs_mods')}">
  <header><b>${tr('lib.packs_mods')}</b><button type="button" id="packsClose" class="lb-btn lb-ico" aria-label="${tr('lib.close')}">✕</button></header>
  <div class="lb-drawer-body">
    <section><h2>${tr('lib.import_title')}</h2>
      <label class="lb-import">${tr('lib.import_a_json_pack')}<input id="f-import" type="file" accept=".json,application/json"></label>
      <label class="lb-import">${tr('lib.import_compo')}<input id="f-compo" type="file" accept=".et"></label>
      <a id="compo-dl" class="lb-dl" style="display:none">${tr('lib.compo_export')}</a>
      <p id="msg" class="lb-msg"></p></section>
    <section class="lb-packs" id="packs"></section>
    <section id="lb-mods"></section>
  </div>
</aside>`

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
  $('packs').innerHTML = `<h2>${tr('lib.packs')} <small>${lib.packs.length}</small></h2><ul>` + lib.packs.map((p) => `<li><span>${esc(p.name)}</span><small>${p.count} · ${esc(p.author)}</small></li>`).join('') + '</ul>'
    + (loadErrors.length ? `<div class="lb-err">${loadErrors.map(esc).join('<br>')}</div>` : '')
}

function results(): Asset[] {
  return search(lib, { source: st.src || undefined, biome: st.src && st.src !== 'vanilla' ? undefined : st.biome, kind: st.kind || undefined, text: st.text, tags: st.tags, fallback: st.fallback })
}

function render() {
  const b = biome(st.biome)!
  // "Missing" is a warning only when a biome really lacks assets (vanilla biomes: neutral/green)
  // one short paragraph; "missing" only when something really is; the technical line goes to the tooltip
  const full = b.missing.en.startsWith('Nothing')
  $('b-desc').innerHTML = `${esc(lab(b.desc))}${full ? '' : `<em class="${b.availability === 'vanilla' ? 'note' : 'miss'}">${tr('lib.missing')} : ${esc(lab(b.missing))}</em>`}`
  $('b-desc').title = `FF : ${b.ff}${b.maps.length ? ' · ' + b.maps.join(', ') : ''}`
  const res = results()
  const allTags = tagCounts(search(lib, { biome: st.biome, kind: st.kind || undefined, fallback: st.fallback })).slice(0, 24)
  const tags = st.allTags ? allTags : allTags.filter(([t], i) => i < 12 || st.tags.includes(t))
  const more = $<HTMLButtonElement>('tagsMore'); more.hidden = allTags.length <= 12; more.textContent = st.allTags ? tr('lib.less_tags') : `${tr('lib.more_tags')} (${allTags.length})`
  $<HTMLButtonElement>('clearF').hidden = !(st.text || st.kind || st.src || st.tags.length)
  $('f-tags').innerHTML = tags.map(([t, n]) => `<button class="tag${st.tags.includes(t) ? ' on' : ''}" data-tag="${esc(t)}">${esc(t)} <small>${n}</small></button>`).join('')
  $('v-parcels').classList.toggle('on', st.view === 'parcels'); $('v-prefabs').classList.toggle('on', st.view === 'prefabs')
  $('l-pcat').hidden = st.view !== 'parcels'; $('l-kind').hidden = st.view === 'parcels'; (document.querySelector('.lb-tagshead') as HTMLElement).hidden = st.view === 'parcels'
  if (st.view === 'parcels') { renderParcels(); void preview(); return }
  $('count').textContent = `${res.length} ${tr('lib.assets')}`
  $('list').innerHTML = res.slice(0, 300).map((a) => `<li data-guid="${esc(a.guid)}" class="${a.guid === st.sel ? 'sel' : ''}">
    <span class="n">${esc(a.name ?? a.guid)}</span><span class="k k-${a.kind}">${kindLabel(a.kind)}</span>
    <span class="t">${a.tags.slice(0, 4).map(esc).join(' · ')}</span></li>`).join('')
  void preview()
}

/** parcels view: the library plots grouped by category, each with a small top-view thumbnail */
function parcelResults(): Composition[] {
  const words = st.text.toLowerCase().split(/\s+/).filter(Boolean)
  return lib.compositions.filter((c) => c.category && (!st.pcat || c.category === st.pcat)
    && (st.fallback || c.biomes.includes(st.biome))
    && words.every((w) => `${c.name} ${c.tags.join(' ')} ${c.items.map((i) => i.prefab).join(' ')}`.toLowerCase().includes(w)))
}
function thumb(c: Composition): string {
  const k = 44 / Math.max(c.size.w, c.size.d, 4)
  const dots = c.items.slice(0, 80).map((i, n) => {
    const x = 24 + i.x * k, y = 24 - i.z * k
    const col = n === 0 ? '#c9573a' : /Vegetation/.test(i.prefab) ? '#5c9c3c' : /Fence|Wall|Gate/i.test(i.prefab) ? '#d8d0b0' : /Structures/.test(i.prefab) ? '#e8955a' : '#9aa'
    return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${n === 0 ? 2.6 : 1.3}" fill="${col}"/>`
  }).join('')
  return `<svg class="lb-thumb" viewBox="0 0 48 48" width="48" height="48"><rect x="${(24 - c.size.w * k / 2).toFixed(1)}" y="${(24 - c.size.d * k / 2).toFixed(1)}" width="${(c.size.w * k).toFixed(1)}" height="${(c.size.d * k).toFixed(1)}" fill="#2f3b2a" stroke="#9bc25b" stroke-dasharray="2 1"/><rect x="0" y="0" width="48" height="2" fill="#777"/>${dots}</svg>`
}
function renderParcels() {
  const res = parcelResults()
  if (!st.compo && res[0]) st.compo = res[0].id
  $('f-tags').innerHTML = ''
  $('count').textContent = `${res.length} ${tr('lib.parcels')}`
  const groups = parcelsByCategory(res)
  $('list').innerHTML = [...groups].map(([k, v]) => `<li class="lb-group"><b>${tr(('lib.pcat.' + k) as Key)}</b> <small>${v.length}</small></li>`
    + v.slice(0, 150).map((c) => `<li data-compo="${esc(c.id)}" class="lb-parcel${c.id === st.compo ? ' sel' : ''}">${thumb(c)}<span class="n">${esc(c.name)}</span>
    <span class="t">${c.size.w.toFixed(0)}×${c.size.d.toFixed(0)} m · ${c.items.length} ${tr('lib.items')}</span></li>`).join('')).join('')
}

async function preview() {
  const b: Biome = biome(st.biome)!
  const v = await getViewer()
  if (!v) return
  $('m-parcel').classList.toggle('on', st.mode === 'parcel'); $('m-asset').classList.toggle('on', st.mode === 'asset')
  ;($('f-tpl') as HTMLSelectElement).style.display = st.mode === 'parcel' ? '' : 'none'
  $('f-compo-sel').style.display = st.mode === 'parcel' ? '' : 'none'
  const cs = $<HTMLSelectElement>('f-compo-sel')
  cs.innerHTML = `<option value="">${tr('lib.compo_none')}</option>` + lib.compositions.map((c) => `<option value="${esc(c.id)}">${esc(c.name)} (${c.items.length})</option>`).join('')
  cs.value = st.compo
  const compo = st.mode === 'parcel' && st.compo ? lib.compositions.find((c) => c.id === st.compo) : undefined
  if (compo) {
    v.showParcel(compoParcel(compo), b)
    $('info').innerHTML = `${esc(compo.name)} · ${compo.size.w.toFixed(1)}×${compo.size.d.toFixed(1)} m · ${compo.items.length} ${tr('lib.items')} · ${esc(compo.tags.join(', '))}${compo.ref ? `<br><code>${esc(compo.ref)}</code>` : ''}<br><small>${esc(compo.author)} · ${esc(compo.licence)}</small>`
    return
  }
  if (st.mode === 'asset') {
    const a = lib.assets.find((x) => x.guid === st.sel) ?? results()[0]
    if (!a) { $('info').textContent = tr('lib.no_asset'); return }
    v.showAsset(a, b)
    const f = a.footprint
    $('info').innerHTML = `<h3>${esc(a.name ?? a.guid)}</h3><dl>
      <div><dt>${tr('lib.type')}</dt><dd>${kindLabel(a.kind)}</dd></div>
      <div><dt>${tr('lib.size')}</dt><dd>${(f.maxX - f.minX).toFixed(1)} × ${(f.maxZ - f.minZ).toFixed(1)} × ${f.h} m${f.measured ? '' : ' (' + tr('lib.estimated') + ')'}</dd></div>
      <div><dt>Source</dt><dd>${esc(a.source)} · ${esc(a.author)} · ${esc(a.licence)}</dd></div>
      <div><dt>${tr('lib.biomes')}</dt><dd>${a.biomes.join(', ')}</dd></div></dl>
      <div class="lb-guid"><code>${esc(a.guid)}</code><button type="button" class="lb-btn" data-copy="${esc(a.guid)}">${tr('lib.copy_guid')}</button></div>`
  } else {
    const t = lotTemplate(st.tpl)!
    const p = generateParcel(lib, st.biome, t, demoLot(t.size.w[1], t.size.d[1]), st.seed, { compositions: st.compos })
    v.showParcel(p, b)
    $('info').innerHTML = `${esc(lab(t.label))} · ${t.size.w[1]}×${t.size.d[1]} m · ${p.items.length} ${tr('lib.items')}, ${p.fences.length} ${tr('lib.fences')} · seed ${st.seed}${p.compositions?.length ? ' · ' + esc(p.compositions.join(', ')) : ''}`
      + (p.warnings.length ? `<br><span class="lb-warn">${p.warnings.map(esc).join('<br>')}</span>` : '')
  }
}

/** a composition alone, as a parcel at the origin (street = -Z) */
function compoParcel(c: Composition): Parcel3D {
  const w = c.size.w / 2, d = c.size.d / 2
  return { biome: st.biome, template: c.id, corners: [-w, -d, w, -d, w, d, -w, d], fences: [], warnings: [],
    items: c.items.map((it) => { const a = lib.assets.find((x) => x.guid === it.prefab); return { guid: it.prefab, kind: a?.kind ?? 'prop', x: it.x, z: it.z, yaw: it.yaw, footprint: a?.footprint ?? { minX: -0.5, maxX: 0.5, minZ: -0.5, maxZ: 0.5, h: 1 } } }) }
}
$<HTMLSelectElement>('f-compo-sel').onchange = (e) => { st.compo = (e.target as HTMLSelectElement).value; void preview() }
$<HTMLInputElement>('f-compos').onchange = (e) => { st.compos = (e.target as HTMLInputElement).checked; void preview() }
$<HTMLInputElement>('f-compo').onchange = async (e) => {
  const f = (e.target as HTMLInputElement).files?.[0]
  if (!f) return
  try {
    let id = compoId(f.name)
    while (lib.compositions.some((c) => c.id === id)) id += '-2'
    const c = importComposition(await f.text(), { id, name: f.name.replace(/\.et$/i, ''), biomes: [st.biome], tags: ['garden', 'yard'], source: 'vanilla', author: 'local', licence: 'CC-BY-4.0' })
    userCompos.push(c)
    lib = rebuild()
    st.compo = c.id; st.mode = 'parcel'
    const a = $<HTMLAnchorElement>('compo-dl')
    a.href = URL.createObjectURL(new Blob([JSON.stringify(userPack(), null, 1)], { type: 'application/json' }))
    a.download = 'my-compositions.json'; a.style.display = ''
    $('msg').textContent = `${tr('lib.compo_imported')} : ${c.name} (${c.items.length})`
    renderPacks(); render()
  } catch (err) { $('msg').textContent = (err as Error).message }
}
$<HTMLSelectElement>('f-biome').onchange = (e) => { st.biome = (e.target as HTMLSelectElement).value as BiomeId; st.tags = []; render() }
$<HTMLSelectElement>('f-src').onchange = (e) => { st.src = (e.target as HTMLSelectElement).value; st.tags = []; render() }
document.getElementById('lb-mods')!.append(modsChecklist())
$<HTMLSelectElement>('f-kind').onchange = (e) => { st.kind = (e.target as HTMLSelectElement).value as AssetKind | ''; st.tags = []; render() }
$<HTMLInputElement>('f-fb').onchange = (e) => { st.fallback = (e.target as HTMLInputElement).checked; render() }
$<HTMLInputElement>('f-text').oninput = (e) => { st.text = (e.target as HTMLInputElement).value; render() }
$<HTMLSelectElement>('f-tpl').onchange = (e) => { st.tpl = (e.target as HTMLSelectElement).value; void preview() }
$('reroll').onclick = () => { st.seed++; void preview() }
$('info').onclick = (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-copy]'); if (!b) return
  void navigator.clipboard?.writeText(b.dataset.copy!).then(() => { b.textContent = tr('lib.copied'); setTimeout(() => { b.textContent = tr('lib.copy_guid') }, 1200) }).catch(() => {})
}
$('tagsMore').onclick = () => { st.allTags = !st.allTags; render() }
$('clearF').onclick = () => {
  Object.assign(st, { text: '', kind: '', src: '', tags: [] })
  $<HTMLInputElement>('f-text').value = ''; $<HTMLSelectElement>('f-kind').value = ''; $<HTMLSelectElement>('f-src').value = ''
  render()
}
const drawer = $('packsDrawer'), packsBtn = $<HTMLButtonElement>('packsBtn')
const showDrawer = (on: boolean) => { drawer.hidden = !on; packsBtn.setAttribute('aria-expanded', String(on)); packsBtn.classList.toggle('on', on) }
packsBtn.onclick = () => showDrawer(!packsBtn.classList.contains('on'))
$('packsClose').onclick = () => showDrawer(false)
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !drawer.hidden) showDrawer(false) })
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
  if (matchMedia('(max-width: 1100px)').matches) document.querySelector('.lb-view')?.scrollIntoView({ behavior: 'smooth', block: 'start' }) // preview is below the list there
}
$('list').addEventListener('click', (e) => {
  const id = (e.target as HTMLElement).closest<HTMLElement>('[data-compo]')?.dataset.compo
  if (!id) return
  st.compo = id; st.mode = 'parcel'; render()
})
$('v-parcels').onclick = () => { st.view = 'parcels'; render() }
$('v-prefabs').onclick = () => { st.view = 'prefabs'; render() }
$<HTMLSelectElement>('f-pcat').onchange = (e) => { st.pcat = (e.target as HTMLSelectElement).value as ParcelCategory | ''; render() }
// parcels saved in the Workbench (bridge on): shown under "My parcels (Workbench)"
void (async () => {
  try {
    const r = await fetch(BRIDGE_URL + '/parcels')
    if (!r.ok) return
    for (const p of (await r.json()) as SavedParcel[]) { const c = savedToComposition(p); if (c && !wbCompos.some((x) => x.id === c.id)) wbCompos.push(c) }
    if (!wbCompos.length) return
    lib = rebuild()
    $('msg').textContent = `${tr('lib.wb_parcels')} : ${wbCompos.length}`
    renderPacks(); render()
  } catch { /* bridge off */ }
})()
$<HTMLInputElement>('f-import').onchange = async (e) => {
  const f = (e.target as HTMLInputElement).files?.[0]
  if (!f) return
  try {
    localPacks.push(importPack(await f.text()))
    lib = rebuild()
    $('msg').textContent = tr('lib.pack_imported') + (lib.conflicts.length ? ` — ${lib.conflicts.length} ${tr('lib.duplicates_skipped')}` : '')
    renderPacks(); render()
  } catch (err) { $('msg').textContent = (err as Error).message }
}

$<HTMLSelectElement>('f-tpl').value = st.tpl
renderPacks()
render()
