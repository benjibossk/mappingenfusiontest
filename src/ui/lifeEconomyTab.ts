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
  fr: { open: 'Économie Life', title: 'Économie Life (outil de calcul RP)', run: 'Calculer', close: 'Fermer', opt: 'Organiser la carte pour le Life', apply: 'Appliquer à la carte', reset: 'Valeurs LF', band: 'Trajet cible (min)', chain: 'Filière', veh: 'Véhicule', price: 'Prix', from: 'Production', proc: 'Transfo', sell: 'Vente', trip: 'Trajet (min)', drive: 'dont route', load: 'Charge', rev: 'Recette/trajet', ph: 'Profit/h', flag: 'État', cap: 'Capacité', speeds: 'Vitesses km/h (route / terre / piste / hors piste)', missing: 'lieu absent', rich: 'trop lucratif', useless: 'inutile', short: 'trop court', long: 'trop long', ok: 'ok', none: 'Générez un monde d\'abord.', score: 'Déséquilibre', places: 'lieux' },
  en: { open: 'Life economy', title: 'Life economy (RP calculator)', run: 'Compute', close: 'Close', opt: 'Organise the map for Life', apply: 'Apply to map', reset: 'LF values', band: 'Target trip (min)', chain: 'Chain', veh: 'Vehicle', price: 'Price', from: 'Production', proc: 'Processing', sell: 'Sell', trip: 'Trip (min)', drive: 'driving', load: 'Load', rev: 'Revenue/trip', ph: 'Profit/h', flag: 'Status', cap: 'Capacity', speeds: 'Speeds km/h (road / dirt / trail / off-road)', missing: 'missing place', rich: 'too lucrative', useless: 'useless', short: 'too short', long: 'too long', ok: 'ok', none: 'Generate a world first.', score: 'Imbalance', places: 'places' },
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

const CSS = `#lifeEco{position:fixed;inset:40px 40px auto auto;width:min(1100px,calc(100vw - 32px));max-height:calc(100vh - 80px);overflow:auto;z-index:9000;background:#16181c;color:#ddd;border:1px solid #444;border-radius:8px;padding:12px;font:12px system-ui;box-shadow:0 8px 30px #000a}
#lifeEco header{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:8px}#lifeEco h2{font-size:15px;margin:0 8px 0 0}
#lifeEco table{border-collapse:collapse;width:100%}#lifeEco th,#lifeEco td{border-bottom:1px solid #2c2f35;padding:3px 5px;text-align:right;white-space:nowrap}
#lifeEco th:first-child,#lifeEco td:first-child{text-align:left}#lifeEco tbody tr{cursor:pointer}#lifeEco tbody tr:hover{background:#22262c}#lifeEco tr.sel{background:#2b3440}
#lifeEco input[type=number]{width:58px;background:#0f1012;color:#ddd;border:1px solid #444}#lifeEco select{background:#0f1012;color:#ddd;border:1px solid #444}
#lifeEco .f-rich{color:#ff9d3f}#lifeEco .f-useless,#lifeEco .f-missing{color:#ff5c5c}#lifeEco .f-short,#lifeEco .f-long{color:#e6d35a}#lifeEco .f-ok{color:#7dd36a}
#lifeEco .veh{display:flex;flex-wrap:wrap;gap:12px;margin:8px 0}#lifeEco small{opacity:.7}`

export function mountLifeEconomy(h: LifeEconomyHooks) {
  const T = tr()
  const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st)
  const el = document.createElement('div'); el.id = 'lifeEco'; el.hidden = true; document.body.appendChild(el)
  const btn = document.createElement('button'); btn.type = 'button'; btn.id = 'lifeEcoBtn'; btn.className = 'hist withlbl'; btn.textContent = '💰 ' + T.open; btn.title = T.title
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
  const render = () => {
    const opt = (el.querySelector('#leOpt') as HTMLInputElement | null)?.checked ?? false
    el.innerHTML = `<header><h2>${T.title}</h2>
      <label>${T.band} <input id="leMin" type="number" value="${eco.band.minMin}"> – <input id="leMax" type="number" value="${eco.band.maxMin}"></label>
      <label><input id="leOpt" type="checkbox"${opt ? ' checked' : ''}> ${T.opt}</label>
      <button id="leRun" type="button">${T.run}</button>${opt && Object.keys(asg).length ? `<button id="leApply" type="button">${T.apply}</button>` : ''}
      <button id="leReset" type="button">${T.reset}</button><button id="leClose" type="button">${T.close}</button><small>${info}</small></header>
      <table><thead><tr><th>${T.chain}</th><th>${T.veh}</th><th>${T.price}</th><th>${T.from}</th><th>${T.proc}</th><th>${T.sell}</th><th>${T.trip}</th><th>${T.drive}</th><th>${T.load}</th><th>${T.rev}</th><th>${T.ph}</th><th>${T.flag}</th></tr></thead><tbody>
      ${eco.chains.map((c, i) => { const r = rows[i]
        return `<tr data-i="${i}"${i === sel ? ' class="sel"' : ''} title="${c.src ?? ''}"><td>${c.label}</td><td><select data-veh="${i}">${vehOpts(c.vehicle)}</select></td><td><input data-price="${i}" type="number" step="any" value="${c.price}"></td>
        <td>${r?.from?.id ?? '-'}</td><td>${c.process ? r?.proc?.id ?? '-' : '·'}</td><td>${r?.sell?.id ?? '-'}</td>
        <td>${r?.ok ? (r.tripSec / 60).toFixed(1) : '-'}</td><td>${r?.ok ? (r.driveSec / 60).toFixed(1) : '-'}</td><td>${r?.ok ? `${r.load} ${c.process?.outItem ?? c.rawItem}` : '-'}</td>
        <td>${r?.ok ? fm(r.revenue) : '-'}</td><td><b>${r?.ok ? fm(r.perHour) : '-'}</b></td><td class="f-${r?.flag ?? 'ok'}">${r ? (r.flag === 'missing' ? `${T.missing}: ${r.missing}` : T[r.flag]) : ''}</td></tr>` }).join('')}
      </tbody></table>
      <div class="veh">${(Object.keys(eco.vehicles) as VehicleId[]).map((k) => { const v = eco.vehicles[k]
        return `<div><b>${v.label}</b> ${T.cap} <input data-cap="${k}" type="number" value="${v.capacity}"><br><small>${T.speeds}</small><br>${(['main', 'dirt', 'trail', 'offroad'] as const).map((s) => `<input data-spd="${k}:${s}" type="number" value="${v.speeds[s]}">`).join('')}</div>` }).join('')}</div>
      <small>LF commit ${eco.lfCommit.slice(0, 10)} · ${eco.sources[eco.sources.length - 1]}</small>`
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
    if (t.id === 'leClose') { el.hidden = true; shown = null; h.redraw(); return }
    if (t.id === 'leRun') { compute(); return }
    if (t.id === 'leReset') { eco = clone(); save(eco); compute(); return }
    if (t.id === 'leApply') {
      for (const c of eco.chains) { const a = asg[c.id]; if (!a) continue; if (a.proc && c.process) h.retag(a.proc, c.process.role); if (a.sell) h.retag(a.sell, c.sellRole) }
      compute(); return
    }
    if (t.closest('input,select')) return
    const tr0 = t.closest<HTMLElement>('tbody tr'); if (!tr0) return
    sel = Number(tr0.dataset.i); shown = rows[sel] ?? null; render(); h.redraw()
  })
  btn.addEventListener('click', () => { el.hidden = !el.hidden; if (!el.hidden) compute(); else { shown = null; h.redraw() } })
}
