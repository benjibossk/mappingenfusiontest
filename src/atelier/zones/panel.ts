// Atelier "Zones": draw a zone on the existing world, generate villages / power / fields / roads / forest in it
// with the generator modules (generate.ts) on the full-res heights, preview, then send ONLY the objects to the
// Workbench (send.ts: one guarded POST /apply, layers MG_Zone_<name>_*). Delete = the same family, emptied.
import { t, type Key } from '../../i18n'
import type { LayerObjects, WaterBody } from '../formats/layer.ts'
import { extract, type Extract } from '../networks/extract.ts'
import { isPole, isPowerGen } from '../networks/power.ts'
import { MapView, esc, reliefCanvas, shell, type Ctx } from '../networks/shell.ts'
import { growBox, ringBox } from './adapter.ts'
import { zoneWorld } from './world.ts'
import { generateZone, POWER_REACH, type ZoneResult, type ZoneSpec } from './generate.ts'
import { sendZone, zoneDeleteProject, zoneProject, zoneTag, type ZoneProject } from './send.ts'
import { objectFootprint, FALLBACK_HALF } from '../footprints.ts'

export interface ZoneCtx extends Ctx { objects: LayerObjects | null; bodies: WaterBody[] }
type Busy = <T>(label: string, f: (stage: (s: string, i?: number, n?: number) => void) => Promise<T>) => Promise<T | undefined>
interface Zone { spec: ZoneSpec; res: ZoneResult | null; sent: ZoneProject | null }

const tk = (k: string, v?: Record<string, string | number>) => t(k as Key, v)

export async function openZones(ctx: ZoneCtx, busy: Busy) {
  const H = ctx.H
  if (!H) { ctx.log(tk('at.zn.noHeights'), true); return }
  // existing power network (poles + power line splines), read once, read-only
  // per layer file, so a zone can ignore its own previous output (MG_Zone_<tag>_*) when it is generated again
  const powerByFile = new Map<string, number[]>()
  if (ctx.world.layersDir) {
    await busy(tk('at.zn.reading'), async (stage) => {
      const list = await ctx.src.list(ctx.world.layersDir!, ['.layer'])
      for (let i = 0; i < list.length; i++) {
        stage(list[i].path.split('/').pop()!, i, list.length)
        const ex: Extract = { insts: [], splines: [], grpCount: new Map() }
        extract(new TextDecoder().decode((await ctx.src.read(list[i].path)).bytes), list[i].path, { inst: (pf) => isPole(pf), spline: (c) => isPowerGen(c) }, ex)
        const pts = [...ex.insts.flatMap((q) => [q.x, q.z]), ...ex.splines.flatMap((s) => s.pts.flatMap((q) => [q[0], q[2]]))]
        if (pts.length) powerByFile.set(list[i].path.split('/').pop()!, pts)
        if (i % 8 === 0) await new Promise((r) => setTimeout(r, 0))
      }
    })
  }
  const ownLayer = (tag: string) => (file: string | undefined) => !!file && file.startsWith(`MG_Zone_${tag}_`)
  const powerFor = (tag: string) => { const own = ownLayer(tag), out: number[] = []; for (const [f, pts] of powerByFile) if (!own(f)) for (const v of pts) out.push(v); return out }
  const power = [...powerByFile.values()].flat() // all of it, for the map
  const zones: Zone[] = []
  let cur: Zone | null = null, draw: { mode: 'rect' | 'poly'; pts: number[] } | null = null, hover: [number, number] | null = null
  const ui = shell('atZones', tk('at.zn.title'), () => {})
  const relief = reliefCanvas(H), W = (H.cols - 1) * H.cell, D = (H.rows - 1) * H.cell
  const buildings = (ctx.objects?.buildings ?? []).map((b) => objectFootprint(b, b.type === 'industrial' ? FALLBACK_HALF.industrial : FALLBACK_HALF.house).corners)
  const view = new MapView(ui.canvas, paint, click)
  ui.head.textContent = `${Math.round(W)} x ${Math.round(D)} m · ${H.cols} x ${H.rows} @ ${H.cell} m`
  view.resize(); view.fit(0, 0, W, D); paint()

  function click(x: number, z: number) {
    if (!draw) {
      const hitZ = zones.find((zn) => inside(zn.spec.ring, x, z))
      if (hitZ) { cur = hitZ; side() }
      return
    }
    draw.pts.push(x, z)
    if (draw.mode === 'rect' && draw.pts.length === 4) {
      const [x0, z0, x1, z1] = draw.pts
      finish([Math.min(x0, x1), Math.min(z0, z1), Math.max(x0, x1), Math.min(z0, z1), Math.max(x0, x1), Math.max(z0, z1), Math.min(x0, x1), Math.max(z0, z1)])
    } else { side(); paint() }
  }
  ui.canvas.addEventListener('mousemove', (e) => { if (draw) { hover = view.toWorld(e.offsetX, e.offsetY); paint() } })
  function finish(ring: number[]) {
    draw = null; hover = null
    let n = zones.length + 1, name = `Zone${n}`
    while (zones.some((z) => z.spec.name === name)) name = `Zone${++n}`
    cur = { spec: { name, ring: ring.map((v) => Math.round(v * 10) / 10), seed: 1 + zones.length, villages: true, power: true, fields: false, links: true, forest: false, density: 1 }, res: null, sent: null }
    zones.push(cur); side(); paint()
  }

  function side() {
    ui.left.innerHTML = `<p class="hint">${esc(tk('at.zn.lead'))}</p>
      <button type="button" id="znRect">${esc(tk('at.zn.rect'))}</button> <button type="button" id="znPoly" class="secondary">${esc(tk('at.zn.poly'))}</button>
      ${draw ? `<p><b>${esc(tk(draw.mode === 'rect' ? 'at.zn.hintRect' : 'at.zn.hintPoly'))}</b></p>${draw.mode === 'poly' ? `<button type="button" id="znFinish" ${draw.pts.length < 6 ? 'disabled' : ''}>${esc(tk('at.zn.finish'))}</button> ` : ''}<button type="button" id="znCancel" class="secondary">${esc(tk('at.zn.cancel'))}</button>` : ''}
      <h4>${esc(tk('at.zn.zones'))}</h4>
      ${zones.length ? `<ul class="zn-list">${zones.map((z, i) => `<li><button type="button" class="${z === cur ? '' : 'secondary'}" data-zi="${i}">${esc(z.spec.name)}${z.res ? ' ·' + z.res.placed.length : ''}${z.sent ? ' ✓' : ''}</button></li>`).join('')}</ul>` : `<p class="hint">${esc(tk('at.zn.none'))}</p>`}
      <h4>${esc(tk('at.legend'))}</h4><p class="hint">${esc(tk('at.zn.legend'))}</p>`
    ui.left.querySelector('#znRect')!.addEventListener('click', () => { draw = { mode: 'rect', pts: [] }; side() })
    ui.left.querySelector('#znPoly')!.addEventListener('click', () => { draw = { mode: 'poly', pts: [] }; side() })
    ui.left.querySelector('#znFinish')?.addEventListener('click', () => { if (draw && draw.pts.length >= 6) finish(draw.pts) })
    ui.left.querySelector('#znCancel')?.addEventListener('click', () => { draw = null; hover = null; side(); paint() })
    ui.left.querySelectorAll<HTMLButtonElement>('[data-zi]').forEach((b) => b.addEventListener('click', () => { cur = zones[Number(b.dataset.zi)]; side(); const [x0, z0, x1, z1] = ringBox(cur.spec.ring); view.fit(x0 - 100, z0 - 100, x1 + 100, z1 + 100); paint() }))
    inspector()
  }

  function inspector() {
    const z = cur
    if (!z) { ui.right.innerHTML = ''; return }
    const s = z.spec, ck = (k: keyof ZoneSpec, label: string) => `<label><input type="checkbox" data-k="${k}" ${s[k] ? 'checked' : ''}> ${esc(tk(label))}</label>`
    const r = z.res
    ui.right.innerHTML = `<h4>${esc(s.name)}</h4>
      <label>${esc(tk('at.zn.name'))} <input id="znName" value="${esc(s.name)}" maxlength="24"></label>
      <h4>${esc(tk('at.zn.what'))}</h4>
      ${ck('villages', 'at.zn.villages')}${ck('power', 'at.zn.power')}${ck('links', 'at.zn.links')}${ck('fields', 'at.zn.fields')}${ck('forest', 'at.zn.forest')}
      <label>${esc(tk('at.zn.seed'))} <input id="znSeed" type="number" step="1" value="${s.seed}" style="width:7em"></label>
      <label>${esc(tk('at.zn.density'))} <input id="znDens" type="number" min="0.3" max="2" step="0.1" value="${s.density ?? 1}" style="width:5em"></label>
      <p><button type="button" id="znGen">${esc(tk('at.zn.generate'))}</button> <button type="button" id="znReroll" class="secondary">${esc(tk('at.zn.reroll'))}</button></p>
      ${r ? `<p id="znSummary">${esc(tk('at.zn.made', { name: s.name, h: r.placed.length, r: r.lanes.length + r.links.length, p: r.power.length, s: r.stations.length, f: r.fields.length, w: r.forests.length, c: r.heights.cols, rr: r.heights.rows, st: r.heights.step }))}</p>
        ${r.warnings.length ? `<p class="hint">⚠ ${esc(r.warnings.map((w) => tk('at.zn.w.' + w)).join(' · '))}</p>` : ''}
        ${s.fields ? `<p class="hint">${esc(tk('at.zn.limits'))}</p>` : ''}
        <p><button type="button" id="znSend">${esc(tk('at.zn.send'))}</button></p>` : ''}
      <p><button type="button" id="znDel" class="secondary">${esc(tk('at.zn.delete'))}</button> <button type="button" id="znForget" class="secondary">${esc(tk('at.zn.forget'))}</button></p>`
    const R = ui.right
    R.querySelectorAll<HTMLInputElement>('[data-k]').forEach((c) => c.addEventListener('change', () => { (s as unknown as Record<string, boolean>)[c.dataset.k!] = c.checked }))
    R.querySelector<HTMLInputElement>('#znName')!.addEventListener('change', (e) => { const v = zoneTag((e.target as HTMLInputElement).value); if (!zones.some((o) => o !== z && o.spec.name === v)) s.name = v; side() })
    R.querySelector<HTMLInputElement>('#znSeed')!.addEventListener('change', (e) => { s.seed = Math.round(Number((e.target as HTMLInputElement).value) || 1) })
    R.querySelector<HTMLInputElement>('#znDens')!.addEventListener('change', (e) => { s.density = Math.min(2, Math.max(0.3, Number((e.target as HTMLInputElement).value) || 1)) })
    R.querySelector('#znGen')!.addEventListener('click', () => void gen(z))
    R.querySelector('#znReroll')!.addEventListener('click', () => { s.seed += 1; void gen(z) })
    R.querySelector('#znSend')?.addEventListener('click', () => void send(z))
    R.querySelector('#znDel')!.addEventListener('click', () => void del(z))
    R.querySelector('#znForget')!.addEventListener('click', () => { zones.splice(zones.indexOf(z), 1); cur = null; side(); paint() })
  }

  async function gen(z: Zone) {
    const done = await busy(tk('at.zn.generate'), async () => {
      await new Promise((r) => setTimeout(r, 0))
      const box = growBox(ringBox(z.spec.ring), POWER_REACH)
      const tag = zoneTag(z.spec.name)
      const w = zoneWorld(ctx.objects, ctx.bodies, powerFor(tag), box, ownLayer(tag))
      z.res = generateZone(H!, w, { ...z.spec, name: tag }); z.sent = null
      return true
    }).catch((e) => { ctx.log(tk('at.zn.err', { m: String((e as Error).message ?? e) }), true); return false })
    if (done && z.res) ctx.log(tk('at.zn.made', { name: z.spec.name, h: z.res.placed.length, r: z.res.lanes.length + z.res.links.length, p: z.res.power.length, s: z.res.stations.length, f: z.res.fields.length, w: z.res.forests.length, c: z.res.heights.cols, rr: z.res.heights.rows, st: z.res.heights.step }))
    side(); paint()
  }
  async function send(z: Zone) {
    if (!z.res) return ctx.log(tk('at.zn.notGen'), true)
    const tag = zoneTag(z.spec.name)
    if (!confirm(tk('at.zn.confirmSend', { name: tag }))) return
    const p = zoneProject(z.res, tag)
    try { await sendZone(p); z.sent = p; ctx.log(tk('at.zn.sent', { name: tag, e: p.entities!.length, s: p.shapes.length })) } catch (e) { ctx.log(tk('at.zn.err', { m: (e as Error).message }), true) }
    side()
  }
  async function del(z: Zone) {
    const tag = zoneTag(z.spec.name)
    if (!confirm(tk('at.zn.confirmDel', { name: tag }))) return
    try { await sendZone(zoneDeleteProject(tag, z.sent ?? (z.res ? zoneProject(z.res, tag) : null))); z.sent = null; ctx.log(tk('at.zn.deleted', { name: tag })) } catch (e) { ctx.log(tk('at.zn.err', { m: (e as Error).message }), true) }
    side()
  }

  function paint() {
    const cv = ui.canvas, g = cv.getContext('2d')!
    g.fillStyle = '#0d0f12'; g.fillRect(0, 0, cv.width, cv.height)
    const [ax, ay] = view.toScreen(0, D), [bx, by] = view.toScreen(W, 0)
    g.imageSmoothingEnabled = true; g.drawImage(relief, ax, ay, bx - ax, by - ay)
    const line = (pts: number[], col: string, w: number, close = false, fill?: string) => {
      if (pts.length < 4) return
      g.beginPath()
      for (let i = 0; i + 1 < pts.length; i += 2) { const [x, y] = view.toScreen(pts[i], pts[i + 1]); if (i) g.lineTo(x, y); else g.moveTo(x, y) }
      if (close) g.closePath()
      if (fill) { g.fillStyle = fill; g.fill() }
      if (w > 0) { g.strokeStyle = col; g.lineWidth = w; g.stroke() }
    }
    const dot = (x: number, z: number, col: string, r: number) => { const [sx, sy] = view.toScreen(x, z); g.fillStyle = col; g.fillRect(sx - r, sy - r, 2 * r, 2 * r) }
    const px = Math.max(1, Math.min(4, view.scale * 4))
    for (const r of ctx.objects?.roads ?? []) line(r.pts.flat(), '#8a8f98', Math.max(1, view.scale * 5))
    for (const b of buildings) line(b, '#ffffff', 0, true, '#d8d8d8')
    for (let i = 0; i + 1 < power.length; i += 2) dot(power[i], power[i + 1], '#4fd1ff', 1.5)
    for (const zn of zones) {
      const r = zn.res
      if (r) {
        for (const f of r.fields) line(f, '#5fa84a', 1, true, 'rgba(110,190,80,.35)')
        for (const f of r.forests) line(f, '#1f5e2a', 1, true, 'rgba(30,100,45,.5)')
        for (const h of r.hedges) line(h, '#3d8b3d', Math.max(1, view.scale * 1.5))
        for (const l of [...r.lanes, ...r.links]) line(l.pts, '#f2b84b', Math.max(1.5, view.scale * 4))
        for (const q of r.placed) line(q.corners, '#ff9a3c', 0, true, '#ff9a3c')
        for (const p of r.parcels) for (const it of p.items) dot(it.x, it.z, '#c68c5a', 1)
        for (const l of r.power) { line(l.path, '#4fd1ff', 1.5); for (let i = 0; i + 1 < l.poles.length; i += 2) dot(l.poles[i], l.poles[i + 1], '#4fd1ff', px) }
        for (const s of r.stations) dot(s.x, s.z, '#00e5ff', Math.max(3, px * 1.5))
      }
      g.setLineDash(zn === cur ? [] : [6, 4])
      line(zn.spec.ring, zn === cur ? '#ffe14d' : '#c9b440', 2, true)
      g.setLineDash([])
      const [lx, ly] = view.toScreen(zn.spec.ring[0], zn.spec.ring[1])
      g.fillStyle = '#ffe14d'; g.font = '12px system-ui'; g.fillText(zn.spec.name, lx + 4, ly - 4)
    }
    if (draw && draw.pts.length) {
      const pts = hover ? [...draw.pts, ...hover] : draw.pts
      if (draw.mode === 'rect' && pts.length >= 4) { const [x0, z0, x1, z1] = pts; line([x0, z0, x1, z0, x1, z1, x0, z1], '#ffe14d', 2, true) } else line(pts, '#ffe14d', 2)
      for (let i = 0; i + 1 < draw.pts.length; i += 2) dot(draw.pts[i], draw.pts[i + 1], '#ffe14d', 3)
    }
  }
  side()
}

function inside(ring: number[], x: number, z: number) {
  let c = false
  for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) if ((ring[i + 1] > z) !== (ring[j + 1] > z) && x < ((ring[j] - ring[i]) * (z - ring[i + 1])) / (ring[j + 1] - ring[i + 1]) + ring[i]) c = !c
  return c
}
