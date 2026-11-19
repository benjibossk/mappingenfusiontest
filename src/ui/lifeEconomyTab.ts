// "Économie Life" panel: chain table for RP / Life servers (logic in modules/lifeEconomy.ts).
// Editable prices / vehicles / speeds (kept in localStorage), route of the clicked row drawn on the 2D map,
// optional "Organiser la carte pour le Life" placement pass (off by default: nothing changes).
import ECO from '../../data/life/economy.json'
import { getLang } from '../i18n'
import { evaluate, makeCtx, optimize, imbalance, type Assignment, type ChainRow, type Economy, type VehicleId, type WorldLike } from '../modules/lifeEconomy'

export interface LifeEconomyHooks {
  world: () => WorldLike
  redraw: () => void
  /** "apply": give these zones the role (the optimizer's chosen processing / sell buildings) */
  retag: (zoneId: string, role: string) => void
}
const L = {
  fr: { open: 'Économie Life', title: 'Économie Life (outil de calcul RP)', run: 'Calculer', close: 'Fermer', opt: 'Organiser la carte pour le Life', apply: 'Appliquer à la carte', reset: 'Valeurs LF', band: 'Trajet cible (min)', chain: 'Filière', veh: 'Véhicule', price: 'Prix', from: 'Production', proc: 'Transfo', sell: 'Vente', trip: 'Trajet (min)', drive: 'dont route', load: 'Charge', rev: 'Recette/trajet', ph: 'Profit/h', flag: 'État', cap: 'Capacité', speeds: 'Vitesses km/h (route / terre / piste / hors piste)', missing: 'lieu absent', rich: 'trop lucratif', useless: 'inutile', short: 'trop court', long: 'trop long', ok: 'ok', none: 'Générez un monde d\'abord.', score: 'Déséquilibre', places: 'lieux', vehs: 'Paramètres véhicules', srcs: 'Sources et valeurs manquantes', route: 'route', walk: 'Véhicule', detail: 'Détail' },
  en: { open: 'Life economy', title: 'Life economy (RP calculator)', run: 'Compute', close: 'Close', opt: 'Organise the map for Life', apply: 'Apply to map', reset: 'LF values', band: 'Target trip (min)', chain: 'Chain', veh: 'Vehicle', price: 'Price', from: 'Production', proc: 'Processing', sell: 'Sell', trip: 'Trip (min)', drive: 'driving', load: 'Load', rev: 'Revenue/trip', ph: 'Profit/h', flag: 'Status', cap: 'Capacity', speeds: 'Speeds km/h (road / dirt / trail / off-road)', missing: 'missing place', rich: 'too lucrative', useless: 'useless', short: 'too short', long: 'too long', ok: 'ok', none: 'Generate a world first.', score: 'Imbalance', places: 'places', vehs: 'Vehicle settings', srcs: 'Sources and missing values', route: 'road', walk: 'Vehicle', detail: 'Detail' },
}
const tr = () => (getLang() === 'fr' ? L.fr : L.en)
const KEY = 'rm-life-economy'
const clone = (): Economy => JSON.parse(JSON.stringify(ECO))
function load(): Economy { try { const s = localStorage.getItem(KEY); if (s) return JSON.parse(s) } catch { /* no storage */ } return clone() }
function save(e: Economy) { try { localStorage.setItem(KEY, JSON.stringify(e)) } catch { /* no storage */ } }

let shown: ChainRow | null = null
/** called at the end of main.ts draw(): the clicked chain's route */
export function drawLifeRoute(ctx: CanvasRenderingContext2D, toScreen: (x: number, z: number) => [number, number]) {
  if (!shown?.ok) return
  const col = ['#ffd23f', '#ff7a3f', '#5fd3ff']
  shown.legs.forEach((l, i) => {
    ctx.beginPath()
    for (let k = 0; k < l.path.length; k += 2) { const [x, y] = toScreen(l.path[k], l.path[k + 1]); if (k) ctx.lineTo(x, y); else ctx.moveTo(x, y) }
    ctx.strokeStyle = col[i % 3]; ctx.lineWidth = 4; ctx.setLineDash(i === shown!.legs.length - 1 ? [8, 6] : []); ctx.stroke()
  })
  ctx.setLineDash([])
  for (const [p, c] of [[shown.from, '#7dff6a'], [shown.proc, '#ff7a3f'], [shown.sell, '#5fd3ff']] as const) {
    if (!p) continue
    const [x, y] = toScreen(p.x, p.z)
    ctx.beginPath(); ctx.arc(x, y, 8, 0, Math.PI * 2); ctx.fillStyle = c; ctx.fill(); ctx.strokeStyle = '#000'; ctx.lineWidth = 2; ctx.stroke()
  }
}

// styles: src/ui/kit.css (.rm-drawer, .rm-table, .rm-badge) + #lifeEco rules there

export function mountLifeEconomy(h: LifeEconomyHooks) {
  const T = tr()
  const el = document.createElement('div'); el.id = 'lifeEco'; el.className = 'rm-drawer'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', T.title); el.hidden = true; document.body.appendChild(el)
  const btn = document.createElement('button'); btn.type = 'button'; btn.id = 'lifeEcoBtn'; btn.className = 'hist withlbl'; btn.innerHTML = `<svg class="ic" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="square" aria-hidden="true"><ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6"/><path d="M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6"/></svg><span>${T.open}</span>`; btn.title = T.title; btn.setAttribute('aria-label', T.open)
  const anchor = document.getElementById('seedBrowserBtn') ?? document.getElementById('replayAll')
  if (anchor) anchor.after(btn); else { btn.style.cssText = 'position:fixed;right:110px;bottom:8px;z-index:8999'; document.body.appendChild(btn) }

  let eco = load(), rows: ChainRow[] = [], asg: Record<string, Assignment> = {}, sel = -1, info = ''
  const fm = (n: number) => (Number.isFinite(n) ? Math.round(n).toLocaleString() : '-')
  const compute = () => {
    const w = h.world()
    const ctx = makeCtx(w)
    asg = optimize(ctx, eco, (el.querySelector('#leOpt') as HTMLInputElement | null)?.checked ?? false)
    rows = evaluate(ctx, eco, asg)
    info = `${ctx.places.length} ${T.places} · ${T.score} ${imbalance(rows, eco.band).toFixed(2)}`
    if (!w.roads.length && !ctx.places.length) info = T.none
    shown = rows[sel] ?? null
    render(); h.redraw()
  }
  const vehOpts = (v: string) => (Object.keys(eco.vehicles) as VehicleId[]).map((k) => `<option value="${k}"${k === v ? ' selected' : ''}>${eco.vehicles[k].label}</option>`).join('')
  const SPD = ['main', 'dirt', 'trail', 'offroad'] as const
  const SPD_L = getLang() === 'fr' ? ['Route', 'Terre', 'Piste', 'Hors piste'] : ['Road', 'Dirt', 'Trail', 'Off-road']
  const badge = (r: ChainRow | undefined) => {
    if (!r) return ''
    const txt = r.flag === 'missing' ? `${T.missing} : ${r.missing}` : T[r.flag]
    const tone = r.flag === 'ok' ? 'ok' : r.flag === 'missing' ? 'off' : r.flag === 'useless' ? 'bad' : 'warn'
    return `<span class="rm-badge" data-tone="${tone}" title="${txt}">${txt}</span>`
  }
  const render = () => {
    const opt = (el.querySelector('#leOpt') as HTMLInputElement | null)?.checked ?? false
    // missing-place rows go last (greyed); the others keep the data order so a price edit never moves the row
    const order = eco.chains.map((_, i) => i).sort((a, b) => Number(rows[a]?.flag === 'missing') - Number(rows[b]?.flag === 'missing'))
    const row = (i: number) => {
      const c = eco.chains[i], r = rows[i], off = r?.flag === 'missing'
      const path = r?.ok ? [r.from?.id, c.process ? r.proc?.id : null, r.sell?.id].filter(Boolean).join(' → ') : ''
      const main = `<tr data-i="${i}" class="${i === sel ? 'sel' : ''}${off ? ' off' : ''}" title="${c.src ?? ''}">
        <td class="name"><b>${c.label}</b>${path ? `<small>${path}</small>` : ''}</td>
        <td><select data-veh="${i}" aria-label="${T.veh}">${vehOpts(c.vehicle)}</select></td>
        <td class="num"><input data-price="${i}" type="number" step="any" value="${c.price}" aria-label="${T.price}"></td>
        <td class="num">${r?.ok ? (r.tripSec / 60).toFixed(1) : '–'}</td>
        <td class="num strong">${r?.ok ? fm(r.perHour) : '–'}</td>
        <td>${badge(r)}</td></tr>`
      const det = i === sel && r?.ok ? `<tr class="det"><td colspan="6"><dl>
        <div><dt>${T.drive}</dt><dd>${(r.driveSec / 60).toFixed(1)} min</dd></div>
        <div><dt>${T.load}</dt><dd>${r.load} ${c.process?.outItem ?? c.rawItem}</dd></div>
        <div><dt>${T.rev}</dt><dd>${fm(r.revenue)}</dd></div></dl></td></tr>` : ''
      return main + det
    }
    el.innerHTML = `<header class="rm-drawer-head">
        <h2>${T.open}</h2><small class="rm-meta">${info}</small><span class="grow"></span>
        <button id="leRun" type="button">${T.run}</button>
        <button id="leClose" type="button" class="rm-icon" title="${T.close}" aria-label="${T.close}"><svg class="ic" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
      </header>
      <div class="rm-toolbar">
        <label class="rm-field">${T.band} <span class="rm-range"><input id="leMin" type="number" value="${eco.band.minMin}" aria-label="min"><span>–</span><input id="leMax" type="number" value="${eco.band.maxMin}" aria-label="max"></span></label>
        <label class="check"><input id="leOpt" type="checkbox"${opt ? ' checked' : ''}> ${T.opt}</label>
        ${opt && Object.keys(asg).length ? `<button id="leApply" type="button" class="secondary">${T.apply}</button>` : ''}
        <span class="grow"></span>
        <button id="leReset" type="button" class="rm-link">${T.reset}</button>
      </div>
      <div class="rm-scroll"><table class="rm-table"><thead><tr><th>${T.chain}</th><th>${T.veh}</th><th class="num">${T.price}</th><th class="num">${T.trip}</th><th class="num">${T.ph}</th><th>${T.flag}</th></tr></thead>
      <tbody>${order.map(row).join('')}</tbody></table></div>
      <details class="rm-sec"><summary>${T.vehs}</summary>
        <table class="rm-table compact"><thead><tr><th></th><th class="num">${T.cap}</th>${SPD_L.map((l) => `<th class="num">${l} <small>km/h</small></th>`).join('')}</tr></thead><tbody>
        ${(Object.keys(eco.vehicles) as VehicleId[]).map((k) => { const v = eco.vehicles[k]
          return `<tr><td><b>${v.label}</b></td><td class="num"><input data-cap="${k}" type="number" value="${v.capacity}" aria-label="${v.label} ${T.cap}"></td>${SPD.map((s, j) => `<td class="num"><input data-spd="${k}:${s}" type="number" value="${v.speeds[s]}" aria-label="${v.label} ${SPD_L[j]}"></td>`).join('')}</tr>` }).join('')}
        </tbody></table></details>
      <details class="rm-sec"><summary>${T.srcs}</summary><p class="rm-meta">LF commit ${eco.lfCommit.slice(0, 10)} · ${eco.sources[eco.sources.length - 1]}</p></details>`
  }
  el.addEventListener('change', (e) => {
    const t = e.target as HTMLInputElement, d = t.dataset
    if (d.price) eco.chains[+d.price].price = Number(t.value) || 0
    else if (d.veh) eco.chains[+d.veh].vehicle = t.value as VehicleId
    else if (d.cap) eco.vehicles[d.cap as VehicleId].capacity = Number(t.value) || 1
    else if (d.spd) { const [k, s] = d.spd.split(':'); eco.vehicles[k as VehicleId].speeds[s as 'main'] = Number(t.value) || 1 }
    else if (t.id === 'leMin') eco.band.minMin = Number(t.value) || 0
    else if (t.id === 'leMax') eco.band.maxMin = Number(t.value) || 0
    else if (t.id !== 'leOpt') return
    save(eco); compute()
  })
  el.addEventListener('click', (e) => {
    const t = e.target as HTMLElement
    if (t.closest('#leClose')) { el.hidden = true; shown = null; h.redraw(); return }
    if (t.id === 'leRun') { compute(); return }
    if (t.id === 'leReset') { eco = clone(); save(eco); compute(); return }
    if (t.id === 'leApply') {
      for (const c of eco.chains) { const a = asg[c.id]; if (!a) continue; if (a.proc && c.process) h.retag(a.proc, c.process.role); if (a.sell) h.retag(a.sell, c.sellRole) }
      compute(); return
    }
    if (t.closest('input,select')) return
    const tr0 = t.closest<HTMLElement>('tbody tr[data-i]'); if (!tr0) return
    sel = Number(tr0.dataset.i) === sel ? -1 : Number(tr0.dataset.i); shown = rows[sel] ?? null; render(); h.redraw()
  })
  btn.addEventListener('click', () => { el.hidden = !el.hidden; if (!el.hidden) compute(); else { shown = null; h.redraw() } })
}
