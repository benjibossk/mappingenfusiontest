// Outside terrain ring UI (Relief tab): toggle + far level + "send as OTC chunks" button. The ring is built
// on demand from the current terrain (modules/outside.ts) and handed to the 3D view when the box is ticked.
import { BRIDGE_URL } from './bridge'
import { t } from './i18n'
import { outsideRing, ringChunks, chunksToText, type OutsideGrid } from './modules/outside'
import type { Heightmap } from './terrain'

export function outsideHtml(): string {
  return `<div class="row" id="outsideRow">
        <label class="check" title="${t('hint.outside')}"><input id="tOutside" type="checkbox"> ${t('lbl.outside')}</label>
        <select id="tOutsideTo" aria-label="${t('lbl.outsideTo')}"><option value="sea">${t('opt.outsideSea')}</option><option value="land">${t('opt.outsideLand')}</option></select>
        <button id="tOutsideSend" type="button" class="secondary" title="${t('hint.outsideSend')}">${t('btn.outsideSend')}</button>
      </div>`
}

let cache: { key: string; ring: OutsideGrid } | null = null
const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T | null

/** the ring for the current terrain, or null when the toggle is off */
export function outsideFor(hm: Heightmap | null, force = false): OutsideGrid | null {
  if (!hm || (!force && !el<HTMLInputElement>('tOutside')?.checked)) return null
  const toward = (el<HTMLSelectElement>('tOutsideTo')?.value === 'land' ? 'land' : 'sea') as 'sea' | 'land'
  const side = Math.max((hm.cols - 1) * hm.step, (hm.rows - 1) * hm.step)
  const key = `${hm.minX},${hm.minZ},${hm.step},${hm.cols},${hm.rows},${hm.heights.length},${hm.heights[(hm.heights.length / 2) | 0]},${toward}`
  if (cache?.key === key) return cache.ring
  const ring = outsideRing(hm, hm.ocean, { width: Math.min(8192, Math.max(2048, side)), step: 64, toward, seed: 7 })
  cache = { key, ring }
  return ring
}

export function wireOutside(getTerrain: () => Heightmap | null, log: (s: string) => void) {
  el<HTMLButtonElement>('tOutsideSend')?.addEventListener('click', async () => {
    const hm = getTerrain()
    if (!hm) return log(t('log.genFirst'))
    const ring = outsideFor(hm, true)!
    const chunks = ringChunks(ring, hm, 33)
    try {
      const r = await fetch(BRIDGE_URL + '/outside', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: chunksToText(chunks) }) })
      const j = await r.json() as { message?: string; error?: string }
      log(t('log.outside', { n: chunks.length, msg: j.message ?? j.error ?? String(r.status) }))
    } catch (e) {
      log(t('log.outside', { n: chunks.length, msg: String(e) }))
    }
  })
}
