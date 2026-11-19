// "Explorateur de seeds" (RustMaps style): batch-generate N seeds in the generator worker, each reduced to a
// thumbnail + stats (workers/seedSummary.ts), cached in IndexedDB by generator version + size + biome + seed.
// A filterable grid; clicking a card loads that seed through the regular world pipeline (callback from main.ts).
import { runGen, type GenJob } from '../workers/genClient'
import type { SeedStats, SeedSummary } from '../workers/seedSummary'
import { APP_VERSION } from '../data/changelog'
import { getLang } from '../i18n'
import { WORLD_DEFAULTS, type WorldParams } from '../modules/worldgen'

const paramsOf = (seed: number, size: number, biome: string): WorldParams => ({ ...WORLD_DEFAULTS, seed, size, biome })

export interface SeedBrowserHooks {
  /** current settings: map size (m) and biome id */
  settings: () => { size: number; biome: string }
  /** load this seed in the app: a regular world run with exactly these params */
  load: (params: WorldParams) => void
}
interface Entry { seed: number; stats: SeedStats; thumb: string }

const L = {
  fr: { title: 'Explorateur de seeds', open: 'Seeds', from: 'Seed de départ', n: 'Nombre', go: 'Générer', stop: 'Arrêter', port: 'Au moins 1 port', air: 'Aérodrome', mil: 'Militaire', forest: 'Forêt %', forestW: 'forêt', close: 'Fermer', towns: 'villes', vill: 'villages', ind: 'industrie', road: 'routes', power: 'électr.', elev: 'alt. max', water: 'eau', field: 'champs', cached: 'en cache', of: 'sur', load: 'Cliquer pour charger cette seed', clear: 'Vider le cache', sub: 'Taille et biome : réglages actuels' },
  en: { title: 'Seed explorer', open: 'Seeds', from: 'Start seed', n: 'Count', go: 'Generate', stop: 'Stop', port: 'At least 1 port', air: 'Airfield', mil: 'Military', forest: 'Forest %', forestW: 'forest', close: 'Close', towns: 'towns', vill: 'villages', ind: 'industry', road: 'roads', power: 'power', elev: 'max elev', water: 'water', field: 'fields', cached: 'cached', of: 'of', load: 'Click to load this seed', clear: 'Clear cache', sub: 'Size and biome: current settings' },
}
const tr = () => (getLang() === 'fr' ? L.fr : L.en)

// ---- IndexedDB cache (every call wrapped: a private window or blocked storage just means no cache)
const DB = 'rm-seedbrowser', STORE = 'seeds'
let dbp: Promise<IDBDatabase | null> | undefined
function db(): Promise<IDBDatabase | null> {
  dbp ??= new Promise((res) => {
    try {
      const rq = indexedDB.open(DB, 1)
      rq.onupgradeneeded = () => rq.result.createObjectStore(STORE)
      rq.onsuccess = () => res(rq.result)
      rq.onerror = () => res(null)
    } catch { res(null) }
  })
  return dbp
}
const keyOf = (size: number, biome: string, seed: number) => `v${APP_VERSION}|${size}|${biome}|${seed}`
async function cacheGet(k: string): Promise<Entry | undefined> {
  const d = await db(); if (!d) return
  return new Promise((res) => { try { const rq = d.transaction(STORE).objectStore(STORE).get(k); rq.onsuccess = () => res(rq.result as Entry | undefined); rq.onerror = () => res(undefined) } catch { res(undefined) } })
}
async function cachePut(k: string, e: Entry) {
  const d = await db(); if (!d) return
  try { d.transaction(STORE, 'readwrite').objectStore(STORE).put(e, k) } catch { /* no cache */ }
}
async function cacheClear() {
  const d = await db(); if (!d) return
  try { d.transaction(STORE, 'readwrite').objectStore(STORE).clear() } catch { /* no cache */ }
}

function thumbUrl(s: SeedSummary): string {
  const c = document.createElement('canvas'); c.width = s.thumb.w; c.height = s.thumb.h
  const x = c.getContext('2d'); if (!x) return ''
  x.putImageData(new ImageData(new Uint8ClampedArray(s.thumb.data), s.thumb.w, s.thumb.h), 0, 0)
  return c.toDataURL('image/png')
}

const CSS = `
#seedBrowser{position:fixed;inset:4vh 4vw;z-index:9000;background:var(--bg,#1b1d21);color:var(--fg,#e8e8e8);border:1px solid #555;border-radius:10px;display:flex;flex-direction:column;box-shadow:0 10px 40px #0009;font-size:13px}
#seedBrowser[hidden]{display:none}
#seedBrowser header{display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:10px 14px;border-bottom:1px solid #444}
#seedBrowser header h2{margin:0;font-size:16px;margin-right:auto}
#seedBrowser .sbf{display:flex;gap:12px;align-items:center;flex-wrap:wrap;padding:8px 14px;border-bottom:1px solid #333}
#seedBrowser input[type=number]{width:72px}
#seedBrowser .sbgrid{flex:1;overflow:auto;padding:12px;display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:10px;align-content:start}
#seedBrowser .sbc{border:1px solid #444;border-radius:8px;padding:6px;cursor:pointer;background:#0002}
#seedBrowser .sbc:hover{border-color:#6af}
#seedBrowser .sbc img{width:100%;aspect-ratio:1;image-rendering:pixelated;border-radius:4px;display:block}
#seedBrowser .sbc b{font-size:14px}
#seedBrowser .sbc small{display:block;opacity:.8;line-height:1.35}
#seedBrowser .tags span{display:inline-block;font-size:11px;padding:0 5px;margin:2px 3px 0 0;border-radius:3px;background:#357}
`

let el: HTMLElement | null = null
export function mountSeedBrowser(h: SeedBrowserHooks) {
  const T = tr()
  const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st)
  el = document.createElement('div'); el.id = 'seedBrowser'; el.hidden = true
  el.innerHTML = `<header><h2>${T.title}</h2><span id="sbSub" style="opacity:.7"></span>
    <label>${T.from} <input id="sbFrom" type="number" min="1" value="1"></label>
    <label>${T.n} <input id="sbN" type="number" min="1" max="200" value="12"></label>
    <button id="sbGo" type="button">${T.go}</button><progress id="sbProg" value="0" max="1" style="width:120px"></progress><span id="sbCount"></span>
    <button id="sbClear" type="button">${T.clear}</button><button id="sbClose" type="button">${T.close}</button></header>
    <div class="sbf"><label><input id="sbPort" type="checkbox"> ${T.port}</label><label><input id="sbAir" type="checkbox"> ${T.air}</label><label><input id="sbMil" type="checkbox"> ${T.mil}</label>
    <label>${T.forest} <input id="sbFmin" type="number" min="0" max="100" value="0"> – <input id="sbFmax" type="number" min="0" max="100" value="100"></label></div>
    <div class="sbgrid" id="sbGrid"></div>`
  document.body.appendChild(el)
  const q = <E extends HTMLElement>(id: string) => el!.querySelector('#' + id) as E
  // toolbar button next to "Replay all" (falls back to the body corner)
  const btn = document.createElement('button'); btn.type = 'button'; btn.id = 'seedBrowserBtn'; btn.className = 'hist withlbl'; btn.innerHTML = `<svg class="ic" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="square" aria-hidden="true"><rect x="4" y="4" width="7" height="7"/><rect x="13" y="4" width="7" height="7"/><rect x="4" y="13" width="7" height="7"/><rect x="13" y="13" width="7" height="7"/></svg><span>${T.open}</span>`; btn.title = T.title; btn.setAttribute('aria-label', T.open)
  const anchor = document.getElementById('replayAll')
  if (anchor) anchor.after(btn); else { btn.style.cssText = 'position:fixed;right:8px;bottom:8px;z-index:8999'; document.body.appendChild(btn) }

  let entries: Entry[] = [], jobs: GenJob<SeedSummary>[] = [], running = false, ctx = h.settings()
  const filt = () => {
    const fmin = Number(q<HTMLInputElement>('sbFmin').value) || 0, fmax = Number(q<HTMLInputElement>('sbFmax').value)
    return entries.filter((e) => (!q<HTMLInputElement>('sbPort').checked || e.stats.ports > 0) && (!q<HTMLInputElement>('sbAir').checked || e.stats.airfield > 0)
      && (!q<HTMLInputElement>('sbMil').checked || e.stats.military > 0) && e.stats.forestPct >= fmin && e.stats.forestPct <= (Number.isFinite(fmax) ? fmax : 100))
  }
  const render = () => {
    const shown = filt().sort((a, b) => a.seed - b.seed)
    q('sbCount').textContent = `${shown.length} ${T.of} ${entries.length}`
    q('sbGrid').innerHTML = shown.map((e) => { const s = e.stats
      const tags = [s.ports && `⚓ ${s.ports}`, s.airfield && `✈ ${s.airfield}`, s.military && `★ ${s.military}`].filter(Boolean).map((x) => `<span>${x}</span>`).join('')
      return `<div class="sbc" data-seed="${e.seed}" title="${T.load}"><img alt="" src="${e.thumb}"><b>#${e.seed}</b><div class="tags">${tags}</div>
        <small>${s.towns} ${T.towns} · ${s.villages} ${T.vill} · ${s.industry} ${T.ind}<br>${s.forestPct}% ${T.forestW} · ${s.fieldPct}% ${T.field} · ${s.waterPct}% ${T.water}<br>${T.road} ${s.roadKm} km · ${T.power} ${s.powerKm} km · ${T.elev} ${s.maxElev} m</small></div>` }).join('')
  }
  el.addEventListener('input', (e) => { if ((e.target as HTMLElement).closest('.sbf')) render() })
  q('sbGrid').addEventListener('click', (e) => {
    const c = (e.target as HTMLElement).closest<HTMLElement>('.sbc'); if (!c) return
    el!.hidden = true; h.load(paramsOf(Number(c.dataset.seed), ctx.size, ctx.biome))
  })
  const stop = () => { running = false; jobs.forEach((j) => j.cancel()); jobs = []; q('sbGo').textContent = T.go }
  q('sbClose').addEventListener('click', () => { el!.hidden = true })
  q('sbClear').addEventListener('click', () => { void cacheClear() })
  btn.addEventListener('click', () => { ctx = h.settings(); q('sbSub').textContent = `${ctx.size / 1024} km · ${ctx.biome} · ${T.sub}`; el!.hidden = false })
  q('sbGo').addEventListener('click', async () => {
    if (running) return stop()
    ctx = h.settings(); q('sbSub').textContent = `${ctx.size / 1024} km · ${ctx.biome} · ${T.sub}`
    const from = Math.max(1, Math.floor(Number(q<HTMLInputElement>('sbFrom').value)) || 1), n = Math.min(200, Math.max(1, Math.floor(Number(q<HTMLInputElement>('sbN').value)) || 1))
    entries = []; render(); running = true; q('sbGo').textContent = T.stop
    const prog = q<HTMLProgressElement>('sbProg'); prog.max = n; prog.value = 0
    const todo = Array.from({ length: n }, (_, i) => from + i)
    const par = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1))
    const one = async (seed: number) => {
      const k = keyOf(ctx.size, ctx.biome, seed)
      let e = await cacheGet(k)
      if (!e) {
        const j = runGen<SeedSummary>('seedSummary', [paramsOf(seed, ctx.size, ctx.biome)])
        jobs.push(j)
        try { const s = await j.promise; e = { seed, stats: s.stats, thumb: thumbUrl(s) }; void cachePut(k, e) } catch { return } finally { jobs = jobs.filter((x) => x !== j) }
      }
      if (!running) return
      entries.push(e); prog.value++; render()
    }
    const lane = async () => { while (running && todo.length) await one(todo.shift()!) }
    await Promise.all(Array.from({ length: par }, lane))
    if (running) stop()
  })
}
