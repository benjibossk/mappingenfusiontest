// Parcel library: small ready-made compositions (house + garden, flats + parking, farm yard...) that the
// village generator lays down like one building. Three sources:
//   captured   parcels captured from a world by the Workbench plugin (through the bridge)
//   library    parcels made here, kept in this browser (export / import as JSON to share them)
//   community  parcels shipped with the site in public/parcels/ (added by pull request)
// Frame of a library parcel: metres, the street on the +Z side, the main building is items[0].

import { BUILDINGS, type BuildingCat } from './data/buildings'
import { t, type Key } from './i18n'
import type { Parcel, ParcelItem } from './modules/templates'

const STORE = 'reforger-mapper.parcels'
const CATS: BuildingCat[] = ['houseS', 'houseM', 'houseL', 'farm', 'civic', 'block']
const PREFAB_RE = /^\{[0-9A-F]{16}\}[^"<>]+\.et$/i

let library: Parcel[] = readStore()
let community: Parcel[] | null = null
let captured: Parcel[] = []

function readStore(): Parcel[] {
  try { return JSON.parse(localStorage.getItem(STORE) ?? '[]') as Parcel[] } catch { return [] }
}
function writeStore() {
  try { localStorage.setItem(STORE, JSON.stringify(library)) } catch { /* storage blocked */ }
}
const clean = (p: Parcel, source: Parcel['source']): Parcel | null => {
  if (!p || typeof p.name !== 'string' || !Array.isArray(p.items) || !p.items.length) return null
  const items = p.items.filter((i) => typeof i.p === 'string' && PREFAB_RE.test(i.p) && Number.isFinite(i.x) && Number.isFinite(i.z))
  if (!items.length) return null
  return { ...p, items, anchor: items[0].p, source, free: p.free ?? source !== 'captured' }
}

/** community parcels: public/parcels/index.json lists the files (each one parcel or an array) */
async function loadCommunity(): Promise<Parcel[]> {
  if (community) return community
  community = []
  try {
    const files = (await (await fetch('parcels/index.json')).json()) as string[]
    for (const f of files) {
      if (!/^[\w.-]+\.json$/.test(f)) continue
      const d = await (await fetch(`parcels/${f}`)).json()
      for (const p of Array.isArray(d) ? d : [d]) {
        const c = clean(p, 'community')
        if (c) community.push(c)
      }
    }
  } catch { /* no community folder */ }
  return community
}

/** parcels the generator can use besides the captured ones */
export async function libraryParcels(): Promise<Parcel[]> {
  return [...library, ...(await loadCommunity())]
}

// --- sizes and drawing ---
const known = new Map(BUILDINGS.map((b) => [b.prefab, b]))
const short = (p: string) => p.replace(/^\{[^}]*\}/, '').split('/').pop()!.replace(/\.et$/, '')

/** local footprint box of an item: [minX, minZ, maxX, maxZ] around its origin */
function box(i: ParcelItem): [number, number, number, number] {
  const b = known.get(i.p)
  if (b) return [b.minX, b.minZ, b.maxX, b.maxZ]
  const w = (i.w ?? 2) / 2, d = (i.d ?? 2) / 2
  return [-w, -d, w, d]
}
/** world corners of an item (same yaw convention as the buildings) */
function corners(i: ParcelItem): number[] {
  const [x0, z0, x1, z1] = box(i)
  const a = (i.yaw * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a)
  return [[x0, z0], [x1, z0], [x1, z1], [x0, z1]].flatMap(([lx, lz]) => [i.x + lx * c + lz * s, i.z - lx * s + lz * c])
}
function inside(pts: number[], x: number, z: number) {
  let n = false
  for (let a = 0, b = 3; a < 4; b = a++) {
    const xa = pts[a * 2], za = pts[a * 2 + 1], xb = pts[b * 2], zb = pts[b * 2 + 1]
    if (za > z !== zb > z && x < ((xb - xa) * (z - za)) / (zb - za) + xa) n = !n
  }
  return n
}
/** captured parcels are in the anchor's frame: turn them into a library parcel (anchor first, at 0,0) */
function toFree(p: Parcel): Parcel {
  if (p.free) return structuredClone(p)
  const rest = p.items.filter((i) => !(i.p === p.anchor && Math.abs(i.x) < 0.05 && Math.abs(i.z) < 0.05) && Math.hypot(i.x, i.z) <= 30)
  return { name: p.name, anchor: p.anchor, bounds: [...p.bounds], cat: p.cat, free: true, tags: p.tags, items: [{ p: p.anchor, x: 0, z: 0, y: 0, yaw: 0, pitch: 0, roll: 0 }, ...rest.map((i) => ({ ...i }))] }
}

function draw(cv: HTMLCanvasElement, p: Parcel, sel = -1) {
  const g = cv.getContext('2d')!
  const W = cv.width, H = cv.height
  const [bx0, bz0, bx1, bz1] = p.bounds
  let span = Math.max(bx1 - bx0, bz1 - bz0)
  for (const i of p.items) for (let k = 0; k < 8; k += 2) span = Math.max(span, Math.abs(corners(i)[k]) * 2, Math.abs(corners(i)[k + 1]) * 2)
  const k = (Math.min(W, H) * 0.86) / Math.max(span, 4)
  const sx = (x: number) => W / 2 + x * k, sy = (z: number) => H / 2 - z * k
  g.fillStyle = '#20242a'; g.fillRect(0, 0, W, H)
  // street on +Z
  g.fillStyle = '#4a4a4a'; g.fillRect(0, 0, W, Math.max(4, sy(bz1) - 2))
  g.fillStyle = '#2f3b2a'; g.fillRect(sx(bx0), sy(bz1), (bx1 - bx0) * k, (bz1 - bz0) * k)
  g.strokeStyle = '#9bc25b'; g.setLineDash([4, 3]); g.strokeRect(sx(bx0), sy(bz1), (bx1 - bx0) * k, (bz1 - bz0) * k); g.setLineDash([])
  p.items.forEach((i, n) => {
    const c = corners(i)
    g.beginPath()
    for (let m = 0; m < 4; m++) g.lineTo(sx(c[m * 2]), sy(c[m * 2 + 1]))
    g.closePath()
    g.fillStyle = n === 0 ? '#c9573a' : known.has(i.p) ? '#e8955a' : '#8f8f8f'
    g.fill()
    g.strokeStyle = n === sel ? '#ffffff' : '#111'; g.lineWidth = n === sel ? 2 : 1; g.stroke(); g.lineWidth = 1
  })
  return { k, sx, sy, x: (px: number) => (px - W / 2) / k, z: (py: number) => (H / 2 - py) / k }
}

// --- the window ---
let root: HTMLDivElement | null = null

export function openParcels(getCaptured: () => Promise<Parcel[]>) {
  if (root) { root.hidden = false; return }
  root = document.createElement('div')
  root.className = 'parcels'
  const L = (k: Key) => t(k)
  root.innerHTML = `
  <div class="pc-box">
    <div class="pc-head"><b>${L('pc.title')}</b><span class="hint">${L('pc.hint')}</span><button id="pcClose" type="button">✕</button></div>
    <div class="pc-body">
      <div class="pc-gallery">
        <div class="pc-row"><button id="pcNew" type="button">${L('pc.new')}</button><button id="pcCapt" type="button">${L('pc.loadCaptured')}</button></div>
        <div class="pc-row"><button id="pcExport" type="button">${L('pc.export')}</button><label class="pc-file">${L('pc.import')}<input id="pcImport" type="file" accept=".json" hidden></label></div>
        <div id="pcList" class="pc-list"></div>
      </div>
      <div class="pc-edit">
        <canvas id="pcCv" width="520" height="520"></canvas>
        <div class="pc-side">
          <label>${L('pc.name')} <input id="pcName" type="text" maxlength="48"></label>
          <label>${L('pc.cat')} <select id="pcCat">${CATS.map((c) => `<option value="${c}">${t(('pc.cat.' + c) as Key)}</option>`).join('')}</select></label>
          <div class="pc-row"><label>${L('pc.width')} <input id="pcW" type="number" min="6" max="120" step="1"></label><label>${L('pc.depth')} <input id="pcD" type="number" min="6" max="120" step="1"></label></div>
          <label>${L('pc.tags')} <input id="pcTags" type="text"></label>
          <label>${L('pc.building')} <select id="pcPick">${BUILDINGS.map((b) => `<option value="${b.prefab}">${short(b.prefab)} (${b.cat})</option>`).join('')}</select></label>
          <button id="pcAddB" type="button">${L('pc.add')}</button>
          <label>${L('pc.other')} <input id="pcPrefab" type="text" placeholder="{0123456789ABCDEF}Prefabs/.../Thing.et"></label>
          <div class="pc-row"><label>${L('pc.w')} <input id="pcOw" type="number" value="2" min="0.2" step="0.1"></label><label>${L('pc.d')} <input id="pcOd" type="number" value="2" min="0.2" step="0.1"></label></div>
          <button id="pcAddO" type="button">${L('pc.add')}</button>
          <div class="pc-row"><button id="pcMain" type="button">${L('pc.main')}</button><button id="pcDelItem" type="button">${L('pc.delItem')}</button></div>
          <div class="hint">${L('pc.keys')}</div>
          <div class="pc-row"><button id="pcSave" type="button">${L('pc.save')}</button><button id="pcDel" type="button">${L('pc.delete')}</button></div>
          <div id="pcMsg" class="hint"></div>
        </div>
      </div>
    </div>
  </div>`
  document.body.append(root)
  const $ = <T extends HTMLElement>(id: string) => root!.querySelector<T>(`#${id}`)!
  const cv = $<HTMLCanvasElement>('pcCv'), msg = $<HTMLDivElement>('pcMsg')
  let cur: Parcel = blank()
  let editing = -1 // index in library, -1 = new or a copy
  let sel = -1
  let view = draw(cv, cur)

  function blank(): Parcel {
    return { name: '', anchor: '', bounds: [-12, -15, 12, 15], items: [], cat: 'houseM', free: true }
  }
  function redraw() { view = draw(cv, cur, sel) }
  function fill() {
    $<HTMLInputElement>('pcName').value = cur.name
    $<HTMLSelectElement>('pcCat').value = cur.cat ?? 'houseM'
    $<HTMLInputElement>('pcW').value = String(Math.round(cur.bounds[2] - cur.bounds[0]))
    $<HTMLInputElement>('pcD').value = String(Math.round(cur.bounds[3] - cur.bounds[1]))
    $<HTMLInputElement>('pcTags').value = (cur.tags ?? []).join(', ')
    sel = -1
    redraw()
  }
  function list() {
    const box = $<HTMLDivElement>('pcList')
    box.innerHTML = ''
    const all: [Parcel, number][] = [...library.map((p, n): [Parcel, number] => [p, n]), ...[...(community ?? []), ...captured].map((p): [Parcel, number] => [p, -1])]
    if (!all.length) box.textContent = t('pc.empty')
    for (const [p, n] of all) {
      const card = document.createElement('button')
      card.type = 'button'
      card.className = 'pc-card'
      const th = document.createElement('canvas')
      th.width = th.height = 84
      draw(th, p.free ? p : toFree(p))
      const lab = document.createElement('span')
      lab.textContent = `${p.name || '?'} · ${t(('pc.cat.' + (p.cat ?? 'houseM')) as Key)} · ${t(('pc.src.' + (p.source ?? 'library')) as Key)}`
      card.append(th, lab)
      card.addEventListener('click', () => {
        cur = toFree(p)
        editing = n
        if (n < 0) cur.name = cur.name + ' (copy)'
        fill()
        msg.textContent = n < 0 ? t('pc.copyHint') : ''
      })
      box.append(card)
    }
  }
  const resize = () => {
    const w = Math.max(6, Math.min(120, Number($<HTMLInputElement>('pcW').value) || 24)) / 2
    const d = Math.max(6, Math.min(120, Number($<HTMLInputElement>('pcD').value) || 30)) / 2
    cur.bounds = [-w, -d, w, d]
    redraw()
  }
  $<HTMLInputElement>('pcW').addEventListener('change', resize)
  $<HTMLInputElement>('pcD').addEventListener('change', resize)
  const add = (i: ParcelItem) => { cur.items.push(i); sel = cur.items.length - 1; redraw() }
  $<HTMLButtonElement>('pcAddB').addEventListener('click', () => add({ p: $<HTMLSelectElement>('pcPick').value, x: 0, z: 0, y: 0, yaw: 0, pitch: 0, roll: 0 }))
  $<HTMLButtonElement>('pcAddO').addEventListener('click', () => {
    const p = $<HTMLInputElement>('pcPrefab').value.trim()
    if (!PREFAB_RE.test(p)) return void (msg.textContent = t('pc.badPrefab'))
    const w = Number($<HTMLInputElement>('pcOw').value) || 2, d = Number($<HTMLInputElement>('pcOd').value) || 2
    add({ p, x: 0, z: 0, y: 0, yaw: 0, pitch: 0, roll: 0, w, d })
  })
  $<HTMLButtonElement>('pcMain').addEventListener('click', () => {
    if (sel <= 0) return
    cur.items.unshift(...cur.items.splice(sel, 1))
    sel = 0
    redraw()
  })
  const delItem = () => { if (sel >= 0) { cur.items.splice(sel, 1); sel = -1; redraw() } }
  $<HTMLButtonElement>('pcDelItem').addEventListener('click', delItem)

  // drag items, wheel or R to turn them
  let drag: { dx: number; dz: number } | null = null
  const at = (e: MouseEvent) => {
    const r = cv.getBoundingClientRect()
    return [view.x(((e.clientX - r.left) * cv.width) / r.width), view.z(((e.clientY - r.top) * cv.height) / r.height)]
  }
  cv.addEventListener('mousedown', (e) => {
    const [x, z] = at(e)
    sel = -1
    for (let n = cur.items.length - 1; n >= 0; n--) if (inside(corners(cur.items[n]), x, z)) { sel = n; break }
    if (sel >= 0) drag = { dx: cur.items[sel].x - x, dz: cur.items[sel].z - z }
    redraw()
  })
  cv.addEventListener('mousemove', (e) => {
    if (!drag || sel < 0) return
    const [x, z] = at(e)
    cur.items[sel].x = Math.round((x + drag.dx) * 10) / 10
    cur.items[sel].z = Math.round((z + drag.dz) * 10) / 10
    redraw()
  })
  window.addEventListener('mouseup', () => { drag = null })
  const turn = (deg: number) => { if (sel >= 0) { cur.items[sel].yaw = (cur.items[sel].yaw + deg + 360) % 360; redraw() } }
  cv.addEventListener('wheel', (e) => { if (sel >= 0) { e.preventDefault(); turn(e.deltaY > 0 ? 15 : -15) } }, { passive: false })
  root.addEventListener('keydown', (e) => {
    if ((e.target as HTMLElement).tagName === 'INPUT') return
    if (e.key === 'r' || e.key === 'R') turn(e.shiftKey ? -90 : 90)
    if (e.key === 'Delete' || e.key === 'Backspace') delItem()
  })
  cv.tabIndex = 0

  $<HTMLButtonElement>('pcNew').addEventListener('click', () => { cur = blank(); editing = -1; fill(); msg.textContent = '' })
  $<HTMLButtonElement>('pcSave').addEventListener('click', () => {
    cur.name = $<HTMLInputElement>('pcName').value.trim()
    cur.cat = $<HTMLSelectElement>('pcCat').value as BuildingCat
    cur.tags = $<HTMLInputElement>('pcTags').value.split(',').map((s) => s.trim()).filter(Boolean)
    if (!cur.name) return void (msg.textContent = t('pc.needName'))
    if (!cur.items.length) return void (msg.textContent = t('pc.needItem'))
    const p: Parcel = { ...structuredClone(cur), anchor: cur.items[0].p, free: true, source: 'library' }
    if (editing >= 0) library[editing] = p
    else { library.push(p); editing = library.length - 1 }
    writeStore()
    list()
    msg.textContent = t('pc.saved', { name: p.name })
  })
  $<HTMLButtonElement>('pcDel').addEventListener('click', () => {
    if (editing < 0) return
    library.splice(editing, 1)
    writeStore()
    cur = blank(); editing = -1; fill(); list()
  })
  $<HTMLButtonElement>('pcExport').addEventListener('click', () => {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([JSON.stringify(library, null, 1)], { type: 'application/json' }))
    a.download = 'parcels.json'
    a.click()
    URL.revokeObjectURL(a.href)
  })
  $<HTMLInputElement>('pcImport').addEventListener('change', async (e) => {
    const f = (e.target as HTMLInputElement).files?.[0]
    if (!f) return
    try {
      const d = JSON.parse(await f.text())
      const got = (Array.isArray(d) ? d : [d]).map((p) => clean(p, 'library')).filter((p): p is Parcel => !!p)
      library.push(...got)
      writeStore()
      list()
      msg.textContent = t('pc.imported', { n: got.length })
    } catch (err) { msg.textContent = (err as Error).message }
  })
  $<HTMLButtonElement>('pcCapt').addEventListener('click', async () => {
    try {
      captured = (await getCaptured()).map((p) => ({ ...p, source: 'captured' as const }))
      list()
      msg.textContent = t('pc.capturedN', { n: captured.length })
    } catch (err) { msg.textContent = t('err.parcels') + (err as Error).message }
  })
  $<HTMLButtonElement>('pcClose').addEventListener('click', () => { root!.hidden = true })
  void loadCommunity().then(list)
  fill()
  list()
}
