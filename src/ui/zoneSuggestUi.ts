// Zone tool helper panel (src/modules/zoneSuggest.ts): suggestions for the drawn zone, empty areas of the map
// (outlined on the 2D map, dismissable and remembered with the project), and the evolving-fill stage.
// Kept out of main.ts: main only gives a host (world, zone, redraw, save) and calls zsRefresh / drawGaps.
import { t, type Key } from '../i18n'
import { findGaps, gapStage, polyAreaM2, stagePlan, suggestZone, type Gap, type Suggestion, type SuggestWorld } from '../modules/zoneSuggest'

export interface ZsHost {
  world(): SuggestWorld | null
  zone(): number[]
  setZone(flat: number[]): void
  redraw(): void
  save(): void
  seed(): number
}
let host: ZsHost | null = null
let gaps: Gap[] = []
let showGaps = false
const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T | null
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
const label = (s: Suggestion) => t(('zt.' + s.id) as Key)
const reason = (s: Suggestion) => t(s.key as Key, s.vars)

/** panel markup, placed in the Zone tab (hidden input = dismissed gaps, saved with the project inputs) */
export function zsHtml(): string {
  return `<div class="zs" id="zsBox">
    <b>${t('zs.title')}</b>
    <ul id="zsList" class="issues"></ul>
    <label title="${esc(t('zs.stage.tip'))}">${t('zs.stage')} <select id="zsStage"><option value="off">${t('zs.stage.off')}</option>${[0, 1, 2, 3].map((k) => `<option value="${k}">${t(('stage.' + k) as Key)}</option>`).join('')}<option value="rand">${t('zs.stage.rand')}</option></select></label>
    <div class="row"><button id="zsGaps" type="button" class="secondary" title="${esc(t('zs.gaps.tip'))}">${t('zs.gaps')}</button><button id="zsGapsHide" type="button" class="secondary" hidden>${t('zs.gaps.hide')}</button></div>
    <div id="zsGapInfo" class="hint"></div>
    <ul id="zsGapList" class="issues"></ul>
    <input id="gapDismissed" type="hidden" value="[]">
  </div>`
}

function dismissed(): { x: number; z: number }[] {
  try { return (JSON.parse(el<HTMLInputElement>('gapDismissed')?.value || '[]') as number[][]).map(([x, z]) => ({ x, z })) } catch { return [] }
}
function setDismissed(d: { x: number; z: number }[]) {
  const i = el<HTMLInputElement>('gapDismissed')
  if (i) i.value = JSON.stringify(d.map((p) => [Math.round(p.x), Math.round(p.z)]))
  host?.save()
}

/** select a generator in the Zone tab, with its params */
function pick(id: string, params: Record<string, string>) {
  const sel = el<HTMLSelectElement>('zoneType')
  if (!sel) return
  sel.value = id
  sel.dispatchEvent(new Event('change'))
  const map: Record<string, string> = { dens: 'zoneDens', leaf: 'zoneLeaf', faction: 'zoneFaction', ha: 'zoneHa' }
  for (const [k, v] of Object.entries(params)) { const f = el<HTMLInputElement>(map[k] ?? ''); if (f) f.value = v }
  const info = el('zsGapInfo')
  if (info) info.textContent = t('zs.picked', { g: t(('zt.' + id) as Key) })
}

function stageOf(zone: number[]): number | null {
  const v = el<HTMLSelectElement>('zsStage')?.value ?? 'off'
  if (v === 'off') return null
  if (v !== 'rand') return Number(v)
  let x = 0, z = 0
  for (let i = 0; i + 1 < zone.length; i += 2) { x += zone[i]; z += zone[i + 1] }
  return gapStage(host?.seed() ?? 1, x / (zone.length / 2), z / (zone.length / 2))
}

/** recompute the suggestion list for the current zone (cheap: a few hundred samples) */
export function zsRefresh() {
  const ul = el('zsList')
  if (!ul || !host) return
  const zone = host.zone(), w = host.world()
  if (zone.length < 6 || !w || polyAreaM2(zone) < 100) { ul.innerHTML = `<li class="hint">${t('zs.none')}</li>`; return }
  const st = stageOf(zone)
  const sug = suggestZone(zone, w, 3)
  let html = ''
  if (st !== null) {
    const p = stagePlan(st)
    html += `<li class="zs-pick" data-id="${p.id}" data-p='${esc(JSON.stringify(p.params))}'><b>${t(p.key as Key)}</b> → ${t(('zt.' + p.id) as Key)}</li>`
  }
  html += sug.length
    ? sug.map((s) => `<li class="zs-pick" data-id="${s.id}" data-p='${esc(JSON.stringify(s.params))}'><b>${esc(label(s))}</b> <small>${s.score}</small><br><small>${esc(reason(s))}</small></li>`).join('') + `<li class="hint">${t('zs.use')}</li>`
    : `<li class="hint">${t('zs.noLand')}</li>`
  ul.innerHTML = html
}

function gapList() {
  const ul = el('zsGapList'), info = el('zsGapInfo'), hide = el('zsGapsHide')
  if (!ul || !info) return
  if (hide) hide.hidden = !showGaps
  if (!showGaps) { ul.innerHTML = ''; info.textContent = ''; return }
  const nd = dismissed().length
  info.textContent = gaps.length ? t('zs.gaps.n', { n: gaps.length }) : t('zs.gaps.none')
  ul.innerHTML = gaps.map((g, i) => `<li><b>${i + 1}.</b> ${g.areaKm2} km² · ${g.best ? `<b>${esc(label(g.best))}</b><br><small>${esc(reason(g.best))}</small>` : ''}<br>
    <button type="button" class="secondary zs-use" data-i="${i}">${t('zs.gap.use')}</button>
    <button type="button" class="secondary zs-dis" data-i="${i}">${t('zs.gap.dismiss')}</button></li>`).join('')
    + (nd ? `<li><button type="button" class="secondary" id="zsRestore">${t('zs.gap.restore', { n: nd })}</button></li>` : '')
}
function runGaps() {
  const w = host?.world()
  gaps = w ? findGaps(w, { seed: host!.seed(), dismissed: dismissed() }) : []
  showGaps = true
  gapList(); host?.redraw()
}

export function initZoneSuggest(h: ZsHost) {
  host = h
  const box = el('zsBox')
  if (!box) return
  box.addEventListener('click', (e) => {
    const tg = e.target as HTMLElement
    const li = tg.closest('.zs-pick') as HTMLElement | null
    if (li) return pick(li.dataset.id!, JSON.parse(li.dataset.p || '{}'))
    if (tg.id === 'zsGaps') return runGaps()
    if (tg.id === 'zsGapsHide') { showGaps = false; gapList(); return host!.redraw() }
    if (tg.id === 'zsRestore') { setDismissed([]); return runGaps() }
    const i = Number(tg.dataset.i)
    if (tg.classList.contains('zs-use') && gaps[i]) {
      const g = gaps[i]
      host!.setZone(g.poly)
      if (g.best) pick(g.best.id, g.best.params)
      zsRefresh(); return host!.redraw()
    }
    if (tg.classList.contains('zs-dis') && gaps[i]) { setDismissed([...dismissed(), { x: gaps[i].cx, z: gaps[i].cz }]); return runGaps() }
  })
  el('zsStage')?.addEventListener('change', zsRefresh)
  zsRefresh()
}

/** gap outlines + labels on the 2D map (after the other layers) */
export function drawGaps(ctx: CanvasRenderingContext2D, toScreen: (x: number, z: number) => [number, number]) {
  if (!showGaps || !gaps.length) return
  ctx.save()
  gaps.forEach((g, i) => {
    ctx.beginPath()
    for (let k = 0; k + 1 < g.poly.length; k += 2) { const [x, y] = toScreen(g.poly[k], g.poly[k + 1]); if (k) ctx.lineTo(x, y); else ctx.moveTo(x, y) }
    ctx.closePath()
    ctx.fillStyle = 'rgba(80,200,255,0.10)'; ctx.fill()
    ctx.strokeStyle = 'rgba(0,0,0,0.7)'; ctx.lineWidth = 4; ctx.setLineDash([]); ctx.stroke()
    ctx.strokeStyle = 'rgba(80,220,255,1)'; ctx.lineWidth = 2; ctx.setLineDash([8, 5]); ctx.stroke(); ctx.setLineDash([])
    const [x, y] = toScreen(g.cx, g.cz), txt = `${i + 1}. ${g.best ? label(g.best) : ''}`
    ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    const wd = ctx.measureText(txt).width + 10
    ctx.fillStyle = 'rgba(0,30,45,0.85)'; ctx.fillRect(x - wd / 2, y - 9, wd, 18)
    ctx.fillStyle = '#bff0ff'; ctx.fillText(txt, x, y)
  })
  ctx.restore()
}
