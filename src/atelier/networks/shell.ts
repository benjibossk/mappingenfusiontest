// Shared overlay shell of the Atelier network / tile-texture tools: full-screen dialog, a pan/zoom map canvas
import { getLang } from '../../i18n'
// with a world → screen transform, download helper. Self-contained styles (no edit to atelier.css).
export interface Ctx {
  src: import('../source.ts').Source; world: import('../source.ts').WorldRef
  terr: import('../formats/terr.ts').TerrInfo | null; tiles: import('../formats/ttile.ts').TileData[]
  H: import('../heights.ts').HeightGrid | null; log: (m: string, err?: boolean) => void
}
export const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!))
export const isFr = () => getLang() === 'fr'

const CSS = `
.atn{position:fixed;inset:0;z-index:60;background:var(--bg,#14161a);color:var(--fg,#e8e8e8);display:grid;grid-template-columns:230px 1fr 360px;grid-template-rows:auto 1fr;font:13px/1.4 system-ui,sans-serif}
.atn>*{position:relative!important;inset:auto!important;width:auto!important;max-width:none!important;min-width:0;margin:0!important;transform:none!important}
.atn>header{grid-area:1/1/2/4;height:auto!important;display:flex;gap:8px;align-items:center;padding:8px 12px;border-bottom:1px solid #333}
.atn header b{letter-spacing:.06em}.atn header .sp{flex:1}
.atn>aside{grid-area:2/1/3/2}.atn>.stage{grid-area:2/2/3/3}.atn>section{grid-area:2/3/3/4}
.atn aside,.atn section{overflow:auto;min-height:0;padding:10px;border-right:1px solid #333}.atn section{border-right:0;border-left:1px solid #333}
.atn label{display:block;margin:3px 0}.atn h4{margin:12px 0 4px;font-size:12px;text-transform:uppercase;opacity:.75}
.atn .stage{position:relative;overflow:hidden;background:#0d0f12}.atn canvas{display:block;width:100%;height:100%;cursor:grab}
.atn table{width:100%;border-collapse:collapse}.atn td,.atn th{padding:2px 4px;border-bottom:1px solid #2a2a2a;text-align:left;vertical-align:top}
.atn .iss{max-height:34vh;overflow:auto}.atn .iss li{cursor:pointer;padding:2px 0}.atn .iss li:hover,.atn .iss li.sel{background:#2a3340}
.atn ul{list-style:none;margin:0;padding:0}.atn .k{display:inline-block;min-width:68px;font-size:11px;opacity:.8}
.atn .det{background:#1d2229;border:1px solid #3a4452;padding:8px;margin:8px 0;border-radius:4px}
.atn textarea{width:100%;box-sizing:border-box;min-height:60px;background:#0d0f12;color:inherit;border:1px solid #444}
.atn button{margin:2px 2px 2px 0}.atn .hint{opacity:.7;font-size:12px}.atn .warn{color:#f0b44c}.atn .ok{color:#7fd07f}
.atn .tabs button[aria-pressed=true]{outline:2px solid #6aa0ff}
@media (max-width:900px){.atn{grid-template-columns:1fr;grid-template-rows:auto 220px 50vh auto;overflow:auto}.atn>header{grid-area:1/1/2/2}.atn>aside{grid-area:2/1/3/2}.atn>.stage{grid-area:3/1/4/2}.atn>section{grid-area:4/1/5/2}.atn aside,.atn section{border:0}}
`
export function shell(id: string, title: string, onClose: () => void): { root: HTMLDivElement; left: HTMLElement; right: HTMLElement; canvas: HTMLCanvasElement; head: HTMLElement } {
  if (!document.getElementById('atnCss')) { const s = document.createElement('style'); s.id = 'atnCss'; s.textContent = CSS; document.head.append(s) }
  document.getElementById(id)?.remove()
  const root = document.createElement('div'); root.id = id; root.className = 'atn'; root.setAttribute('role', 'dialog'); root.setAttribute('aria-label', title)
  root.innerHTML = `<header><b>${esc(title.toUpperCase())}</b><span class="hdx"></span><span class="sp"></span><button type="button" class="secondary atn-close">✕ ${isFr() ? 'Fermer' : 'Close'}</button></header><aside></aside><div class="stage"><canvas></canvas></div><section></section>`
  document.body.append(root)
  const close = () => { root.remove(); onClose() }
  root.querySelector('.atn-close')!.addEventListener('click', close)
  root.addEventListener('keydown', (e) => { if (e.key === 'Escape') close() })
  return { root, left: root.querySelector('aside')!, right: root.querySelector('section')!, canvas: root.querySelector('canvas')!, head: root.querySelector('.hdx')! }
}

/** world (x east, z north) ↔ canvas pixels, with wheel zoom and drag pan */
export class MapView {
  cx = 0; cz = 0; scale = 1; private drag: [number, number, number, number] | null = null; moved = false
  cv: HTMLCanvasElement; private redraw: () => void; private click: (x: number, z: number) => void
  constructor(cv: HTMLCanvasElement, redraw: () => void, click: (x: number, z: number) => void) {
    this.cv = cv; this.redraw = redraw; this.click = click
    const ro = new ResizeObserver(() => this.resize()); ro.observe(cv)
    cv.addEventListener('wheel', (e) => { e.preventDefault(); const [wx, wz] = this.toWorld(e.offsetX, e.offsetY), f = e.deltaY < 0 ? 1.25 : 0.8; this.scale *= f; this.cx = wx - (wx - this.cx) / f; this.cz = wz - (wz - this.cz) / f; this.redraw() }, { passive: false })
    cv.addEventListener('pointerdown', (e) => { this.drag = [e.clientX, e.clientY, this.cx, this.cz]; this.moved = false })
    cv.addEventListener('pointermove', (e) => { if (!this.drag) return; const dx = e.clientX - this.drag[0], dy = e.clientY - this.drag[1]; if (Math.abs(dx) + Math.abs(dy) > 3) this.moved = true; this.cx = this.drag[2] - dx / this.scale; this.cz = this.drag[3] + dy / this.scale; this.redraw() })
    cv.addEventListener('pointerup', (e) => { const m = this.moved; this.drag = null; if (!m) { const [x, z] = this.toWorld(e.offsetX, e.offsetY); this.click(x, z) } })
  }
  resize() { const r = this.cv.getBoundingClientRect(); this.cv.width = Math.max(10, Math.round(r.width)); this.cv.height = Math.max(10, Math.round(r.height)); this.redraw() }
  fit(x0: number, z0: number, x1: number, z1: number) { this.cx = (x0 + x1) / 2; this.cz = (z0 + z1) / 2; this.scale = Math.min(this.cv.width / Math.max(1, x1 - x0), this.cv.height / Math.max(1, z1 - z0)) * 0.92 }
  toScreen(x: number, z: number): [number, number] { return [this.cv.width / 2 + (x - this.cx) * this.scale, this.cv.height / 2 - (z - this.cz) * this.scale] }
  toWorld(sx: number, sy: number): [number, number] { return [this.cx + (sx - this.cv.width / 2) / this.scale, this.cz - (sy - this.cv.height / 2) / this.scale] }
  zoomTo(x: number, z: number, span = 300) { this.cx = x; this.cz = z; this.scale = Math.min(this.cv.width, this.cv.height) / span; this.redraw() }
}

/** relief image of the height grid (hillshade, ≤ 1024 px) */
export function reliefCanvas(H: import('../heights.ts').HeightGrid): HTMLCanvasElement {
  const step = Math.max(1, Math.ceil(Math.max(H.cols, H.rows) / 1024)), W = Math.floor(H.cols / step), R = Math.floor(H.rows / step)
  const c = document.createElement('canvas'); c.width = W; c.height = R
  const g = c.getContext('2d')!, img = g.createImageData(W, R), span = Math.max(1, H.max - H.min)
  for (let y = 0; y < R; y++) for (let x = 0; x < W; x++) {
    const r = (R - 1 - y) * step, i = r * H.cols + x * step, h = H.h[i], hx = H.h[Math.min(i + step, H.h.length - 1)], hz = H.h[Math.min(i + step * H.cols, H.h.length - 1)]
    const sh = Math.max(0, Math.min(1, 0.6 + ((h - hx) + (hz - h)) / (H.cell * step) * 0.8)), base = 40 + 60 * (h - H.min) / span
    const v = base * sh + 20, o = (y * W + x) * 4
    img.data[o] = v; img.data[o + 1] = v + 4; img.data[o + 2] = v + 2; img.data[o + 3] = 255
  }
  g.putImageData(img, 0, 0)
  return c
}
export function download(name: string, data: string | Blob, type = 'text/plain') {
  const b = typeof data === 'string' ? new Blob([data], { type }) : data, u = URL.createObjectURL(b), a = document.createElement('a')
  a.href = u; a.download = name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 2000)
}
