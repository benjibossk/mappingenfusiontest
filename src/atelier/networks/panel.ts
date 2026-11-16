// Atelier "Réseaux" viewer: rails / roads / power of an EXISTING Workbench project, for collaboration and
// game-design discussion. Read-only on the project. Every issue can be commented: the comment is a
// collaboration Op (kind 'comment', x/z) — see comments.ts — and room comments are drawn on the map.
import { heightAt } from '../heights.ts'
import { extract, type Extract } from './extract.ts'
import { shareText, toCsv, toJson, type Issue, type IssueKind, type NetKind, type Network } from './graph.ts'
import { railNetwork, isRailPiece, railFeature, RAIL_GENERATOR_AVAILABLE } from './rails.ts'
import { powerNetwork, isPole, isSubstation, isPowerGen } from './power.ts'
import { roadNetwork, isRoadGen } from './roads.ts'
import { addComment, comments, live, onCommentsChange } from './comments.ts'
import { MapView, download, esc, isFr, reliefCanvas, shell, type Ctx } from './shell.ts'

const COL: Record<NetKind, string> = { rail: '#e07bff', road: '#f2b84b', power: '#4fd1ff' }
const ICOL: Partial<Record<IssueKind, string>> = { gap: '#ff4d4d', overlap: '#ff8c1a', duplicate: '#ff8c1a', end: '#ffffff', deadEnd: '#ff4d4d', island: '#ff4d4d', steep: '#ff6a00', isolated: '#ff4d4d', switch: '#9dff7a', junction: '#9dff7a', station: '#7ab8ff' }
const PROBLEM = new Set<IssueKind>(['gap', 'overlap', 'duplicate', 'deadEnd', 'island', 'steep', 'isolated', 'end'])

interface St { ex: Extract | null; nets: Partial<Record<NetKind, Network>>; cur: NetKind; show: Record<NetKind | 'issues' | 'comments' | 'relief' | 'info', boolean>; kind: IssueKind | 'problems' | 'all'; sel: Issue | null; selEdge: number | null; steep: number }

export async function openNetworks(ctx: Ctx, busy: <T>(label: string, f: (stage: (s: string, i?: number, n?: number) => void) => Promise<T>) => Promise<T | undefined>) {
  const F = isFr(), lang = F ? 'fr' : 'en'
  const S: St = { ex: null, nets: {}, cur: 'rail', show: { rail: true, road: true, power: true, issues: true, comments: true, relief: true, info: false }, kind: 'problems', sel: null, selEdge: null, steep: 15 }
  if (!ctx.world.layersDir) { ctx.log(F ? 'Réseaux : ce monde n\'a pas de dossier de layers.' : 'Networks: this world has no layers folder.', true); return }
  // read every layer once (read-only)
  const ok = await busy(F ? 'Réseaux — lecture des layers' : 'Networks — reading layers', async (stage) => {
    const list = await ctx.src.list(ctx.world.layersDir!, ['.layer']), ex: Extract = { insts: [], splines: [], grpCount: new Map() }
    for (let i = 0; i < list.length; i++) {
      stage(list[i].path.split('/').pop()!, i, list.length)
      const text = new TextDecoder().decode((await ctx.src.read(list[i].path)).bytes)
      extract(text, list[i].path, { inst: (p) => isRailPiece(p) || !!railFeature(p) || isPole(p) || isSubstation(p), spline: (c) => isRoadGen(c) || isPowerGen(c) }, ex)
      if (i % 8 === 0) await new Promise((r) => setTimeout(r, 0))
    }
    S.ex = ex; build(); return true
  })
  if (!ok) return
  function build() {
    const ex = S.ex!, H = ctx.H
    S.nets.rail = railNetwork(ex.insts, lang).net
    S.nets.road = roadNetwork(ex.splines, H ? (x, z) => heightAt(H, x, z) : null, lang, { steep: S.steep })
    S.nets.power = powerNetwork(ex.splines, ex.insts, lang)
    if (!S.nets.rail.edges.length) S.cur = S.nets.road.edges.length ? 'road' : 'power'
  }
  const title = F ? 'Réseaux — rail, routes, électricité' : 'Networks — rail, roads, power'
  const { left, right, canvas, head } = shell('atNet', title, () => unsub())
  head.textContent = ' · ' + ctx.world.name
  const relief = ctx.H ? reliefCanvas(ctx.H) : null
  const mv = new MapView(canvas, draw, pick)
  const unsub = onCommentsChange(() => { draw(); renderRight() })
  const sizeX = ctx.terr?.sizeX ?? 0, sizeZ = ctx.terr?.sizeZ ?? 0
  requestAnimationFrame(() => { mv.resize(); fitAll(); draw() })

  function fitAll() {
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity
    for (const n of Object.values(S.nets)) for (const e of n!.edges) for (const [x, z] of e.pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z) }
    if (sizeX && (!Number.isFinite(x0) || true)) { x0 = Math.min(x0, 0); z0 = Math.min(z0, 0); x1 = Math.max(x1, sizeX); z1 = Math.max(z1, sizeZ) }
    if (!Number.isFinite(x0)) { x0 = 0; z0 = 0; x1 = 1000; z1 = 1000 }
    mv.fit(x0, z0, x1, z1)
  }
  const issuesOf = () => (S.nets[S.cur]?.issues ?? []).filter((i) => S.kind === 'all' || (S.kind === 'problems' ? PROBLEM.has(i.kind) : i.kind === S.kind))

  function draw() {
    const g = canvas.getContext('2d')!
    g.fillStyle = '#0d0f12'; g.fillRect(0, 0, canvas.width, canvas.height)
    if (relief && S.show.relief && ctx.H) {
      const [ax, ay] = mv.toScreen(0, ctx.H.rows * ctx.H.cell), [bx, by] = mv.toScreen(ctx.H.cols * ctx.H.cell, 0)
      g.globalAlpha = 0.9; g.drawImage(relief, ax, ay, bx - ax, by - ay); g.globalAlpha = 1
    }
    for (const k of ['road', 'power', 'rail'] as NetKind[]) {
      const n = S.nets[k]; if (!n || !S.show[k]) continue
      g.strokeStyle = COL[k]; g.lineWidth = k === S.cur ? 2 : 1.2; g.globalAlpha = k === S.cur ? 1 : 0.55
      g.beginPath()
      for (const e of n.edges) { e.pts.forEach(([x, z], i) => { const [sx, sy] = mv.toScreen(x, z); if (i) g.lineTo(sx, sy); else g.moveTo(sx, sy) }) }
      g.stroke(); g.globalAlpha = 1
    }
    const cn = S.nets[S.cur]
    if (cn && S.selEdge !== null && cn.edges[S.selEdge]) { const e = cn.edges[S.selEdge]; g.strokeStyle = '#fff'; g.lineWidth = 4; g.beginPath(); e.pts.forEach(([x, z], i) => { const [sx, sy] = mv.toScreen(x, z); if (i) g.lineTo(sx, sy); else g.moveTo(sx, sy) }); g.stroke() }
    if (S.show.issues) for (const i of issuesOf()) {
      const [sx, sy] = mv.toScreen(i.x, i.z), r = i === S.sel ? 7 : 4
      g.fillStyle = ICOL[i.kind] ?? '#fff'; g.strokeStyle = '#000'; g.lineWidth = 1
      g.beginPath(); if (PROBLEM.has(i.kind)) g.rect(sx - r, sy - r, 2 * r, 2 * r); else g.arc(sx, sy, r, 0, 7); g.fill(); g.stroke()
    }
    if (S.show.comments) for (const c of comments()) {
      const [sx, sy] = mv.toScreen(c.x, c.z)
      g.fillStyle = c.resolved ? '#7a7a7a' : '#ffd84d'; g.strokeStyle = '#000'
      g.beginPath(); g.moveTo(sx, sy); g.lineTo(sx - 6, sy - 12); g.lineTo(sx + 6, sy - 12); g.closePath(); g.fill(); g.stroke()
      g.beginPath(); g.arc(sx, sy - 14, 6, 0, 7); g.fill(); g.stroke()
    }
    // scale bar
    const m = [10, 50, 100, 500, 1000, 5000].find((v) => v * mv.scale > 60) ?? 5000
    g.fillStyle = '#fff'; g.fillRect(12, canvas.height - 18, m * mv.scale, 3); g.font = '11px system-ui'; g.fillText(m >= 1000 ? m / 1000 + ' km' : m + ' m', 12, canvas.height - 22)
  }
  function pick(x: number, z: number) {
    const tol = 8 / mv.scale, iss = issuesOf()
    let best: Issue | null = null, bd = tol
    for (const i of iss) { const d = Math.hypot(i.x - x, i.z - z); if (d < bd) { bd = d; best = i } }
    if (best) { S.sel = best; S.selEdge = best.edge ?? null; draw(); renderRight(); return }
    const n = S.nets[S.cur]; let be = -1, bed = tol
    if (n) for (const e of n.edges) for (let k = 1; k < e.pts.length; k++) { const d = seg(x, z, e.pts[k - 1], e.pts[k]); if (d < bed) { bed = d; be = e.id } }
    S.sel = null; S.selEdge = be >= 0 ? be : null; draw(); renderRight()
  }

  function renderLeft() {
    const n = (k: NetKind) => S.nets[k]?.edges.length ?? 0
    left.innerHTML = `<h4>${F ? 'Réseau analysé' : 'Network'}</h4><div class="tabs">${(['rail', 'road', 'power'] as NetKind[]).map((k) => `<button type="button" class="secondary" data-cur="${k}" aria-pressed="${S.cur === k}" style="border-left:4px solid ${COL[k]}">${F ? { rail: 'Rail', road: 'Routes', power: 'Électricité' }[k] : { rail: 'Rail', road: 'Roads', power: 'Power' }[k]} (${n(k)})</button>`).join('')}</div>
      <h4>${F ? 'Calques' : 'Layers'}</h4>${(['rail', 'road', 'power', 'issues', 'comments', 'relief'] as const).map((k) => `<label><input type="checkbox" data-show="${k}" ${S.show[k] ? 'checked' : ''}> ${F ? { rail: 'Voies ferrées', road: 'Routes', power: 'Lignes électriques', issues: 'Points détectés', comments: 'Commentaires du salon', relief: 'Relief' }[k] : { rail: 'Rail', road: 'Roads', power: 'Power lines', issues: 'Detected points', comments: 'Room comments', relief: 'Relief' }[k]}</label>`).join('')}
      <button type="button" class="secondary" id="atnFit">${F ? 'Tout voir' : 'Zoom to fit'}</button>
      <h4>${F ? 'Pente max route' : 'Max road grade'}</h4><label><input type="number" id="atnSteep" min="3" max="60" step="1" value="${S.steep}" style="width:60px"> %</label>
      <h4>Export</h4><button type="button" class="secondary" data-exp="csv">CSV</button><button type="button" class="secondary" data-exp="json">JSON</button><button type="button" class="secondary" data-exp="png">PNG</button><button type="button" class="secondary" data-exp="txt">${F ? 'Résumé' : 'Summary'}</button>
      <p class="hint">${F ? 'Lecture seule : rien n\'est écrit dans le projet.' : 'Read-only: nothing is written to the project.'}</p>
      ${S.cur === 'rail' && !RAIL_GENERATOR_AVAILABLE ? `<p class="hint">${F ? 'Le jeu de base n\'a pas de générateur de voie ferrée (SCR_TrackGeneratorEntity ne fait que réserver un couloir) : les voies sont des pièces posées, analysées ici telles quelles.' : 'The base game has no rail-laying generator (SCR_TrackGeneratorEntity only reserves a corridor): tracks are placed pieces, analysed as they are.'}</p>` : ''}`
    left.querySelectorAll<HTMLButtonElement>('[data-cur]').forEach((b) => b.addEventListener('click', () => { S.cur = b.dataset.cur as NetKind; S.sel = null; S.selEdge = null; renderLeft(); renderRight(); draw() }))
    left.querySelectorAll<HTMLInputElement>('[data-show]').forEach((c) => c.addEventListener('change', () => { S.show[c.dataset.show as keyof St['show']] = c.checked; draw() }))
    left.querySelector('#atnFit')!.addEventListener('click', () => { fitAll(); draw() })
    left.querySelector<HTMLInputElement>('#atnSteep')!.addEventListener('change', (e) => { S.steep = Number((e.target as HTMLInputElement).value) || 15; S.nets.road = roadNetwork(S.ex!.splines, ctx.H ? (x, z) => heightAt(ctx.H!, x, z) : null, lang, { steep: S.steep }); renderLeft(); renderRight(); draw() })
    left.querySelectorAll<HTMLButtonElement>('[data-exp]').forEach((b) => b.addEventListener('click', () => exp(b.dataset.exp!)))
  }
  const netTitle = () => `${ctx.world.name} — ${F ? { rail: 'réseau ferré', road: 'réseau routier', power: 'réseau électrique' }[S.cur] : S.cur + ' network'}`
  function exp(k: string) {
    const n = S.nets[S.cur]!, b = `${ctx.world.name}_${S.cur}`
    if (k === 'csv') download(b + '.csv', toCsv(n), 'text/csv')
    else if (k === 'json') download(b + '.json', toJson(n), 'application/json')
    else if (k === 'png') canvas.toBlob((bl) => { if (bl) download(b + '.png', bl) })
    else { const t = shareText(n, netTitle(), lang); void navigator.clipboard?.writeText(t).catch(() => {}); download(b + '.md', t, 'text/markdown') }
  }
  function renderRight() {
    const n = S.nets[S.cur]!
    const kinds = [...new Set(n.issues.map((i) => i.kind))], iss = issuesOf()
    const sel = S.sel, e = S.selEdge !== null ? n.edges[S.selEdge] : null
    const det = sel || e ? `<div class="det">${sel ? `<b>${esc(sel.msg)}</b><br><span class="hint">x ${sel.x.toFixed(1)} · z ${sel.z.toFixed(1)}</span>` : ''}
      ${e ? `<table>${[[F ? 'Classe' : 'Class', e.cls], [F ? 'Longueur' : 'Length', e.len.toFixed(1) + ' m'], [F ? 'Réseau' : 'Network', n.comps[e.comp]?.name ?? ''], ['Layer', e.file.split('/').slice(-2).join('/')], [F ? 'Ligne' : 'Line', e.line + 1], ...Object.entries(e.info ?? {})].map(([a, b]) => `<tr><th>${esc(String(a))}</th><td>${esc(String(b))}</td></tr>`).join('')}</table>` : ''}
      <h4>${F ? 'Commenter (collaboration)' : 'Comment (collaboration)'}</h4><textarea id="atnCom">${esc(`[${S.cur}] ${sel ? sel.msg : e!.cls} — `)}</textarea>
      <button type="button" id="atnComBtn">📌 ${F ? 'Épingler le commentaire ici' : 'Pin the comment here'}</button>
      <p class="hint">${live() ? (F ? 'Envoyé au salon de collaboration.' : 'Sent to the collaboration room.') : (F ? 'Pas de salon ouvert ici : le commentaire est gardé comme les commentaires hors ligne du générateur et part au salon à la prochaine connexion.' : 'No room open here: kept like the generator\'s offline comments, sent to the room on the next connection.')}</p></div>` : `<p class="hint">${F ? 'Cliquez un point ou un tronçon pour le détail et pour le commenter.' : 'Click a point or a segment for details and to comment it.'}</p>`
    const cs = comments()
    right.innerHTML = `<h4>${esc(netTitle())}</h4><table>${n.stats.map(([a, b]) => `<tr><th>${esc(a)}</th><td>${esc(String(b))}</td></tr>`).join('')}</table>
      ${det}
      <h4>${F ? 'Points détectés' : 'Detected points'} (${iss.length})</h4>
      <select id="atnKind"><option value="problems">${F ? 'Incohérences' : 'Inconsistencies'}</option><option value="all">${F ? 'Tout' : 'All'}</option>${kinds.map((k) => `<option value="${k}">${k} (${n.issues.filter((i) => i.kind === k).length})</option>`).join('')}</select>
      <ul class="iss">${iss.slice(0, 400).map((i, k) => `<li data-i="${k}" class="${i === S.sel ? 'sel' : ''}"><span class="k" style="color:${ICOL[i.kind] ?? '#fff'}">${i.kind}</span>${esc(i.msg)}</li>`).join('')}${iss.length > 400 ? `<li class="hint">… +${iss.length - 400} (CSV)</li>` : ''}</ul>
      <h4>${F ? 'Par classe' : 'By class'}</h4><table>${n.byClass.slice(0, 15).map((c) => `<tr><td>${esc(c.cls)}</td><td>${c.km.toFixed(2)} km</td><td>${c.n}</td></tr>`).join('')}</table>
      <h4>${F ? 'Réseaux / lignes' : 'Networks / lines'} (${n.comps.length})</h4><ul class="iss">${n.comps.slice(0, 60).map((c) => `<li data-c="${c.id}">${esc(c.name)} — ${(c.len / 1000).toFixed(2)} km · ${c.edges} · ${c.ends} ${F ? 'ext.' : 'ends'} · ${c.branches} ${F ? 'emb.' : 'br.'}</li>`).join('')}</ul>
      <h4>${F ? 'Commentaires du salon' : 'Room comments'} (${cs.length})</h4><ul class="iss">${cs.slice(-40).reverse().map((c) => `<li data-cm="${esc(c.id)}">${c.resolved ? '✓ ' : '📌 '}<b>${esc(c.author)}</b> ${esc(c.text.slice(0, 90))}${c.local ? ' <span class="hint">(local)</span>' : ''}</li>`).join('')}</ul>`
    right.querySelector<HTMLSelectElement>('#atnKind')!.value = S.kind
    right.querySelector<HTMLSelectElement>('#atnKind')!.addEventListener('change', (ev) => { S.kind = (ev.target as HTMLSelectElement).value as St['kind']; S.sel = null; renderRight(); draw() })
    right.querySelectorAll<HTMLLIElement>('[data-i]').forEach((li) => li.addEventListener('click', () => { const i = iss[Number(li.dataset.i)]; S.sel = i; S.selEdge = i.edge ?? null; mv.zoomTo(i.x, i.z); renderRight() }))
    right.querySelectorAll<HTMLLIElement>('[data-c]').forEach((li) => li.addEventListener('click', () => { const c = n.comps[Number(li.dataset.c)]; mv.zoomTo(c.x, c.z, Math.max(300, c.len / 2)) }))
    right.querySelectorAll<HTMLLIElement>('[data-cm]').forEach((li) => li.addEventListener('click', () => { const c = cs.find((x) => x.id === li.dataset.cm); if (c) mv.zoomTo(c.x, c.z) }))
    right.querySelector('#atnComBtn')?.addEventListener('click', () => {
      const t = right.querySelector<HTMLTextAreaElement>('#atnCom')!.value.trim(); if (!t) return
      const at = sel ?? (e ? { x: e.pts[Math.floor(e.pts.length / 2)][0], z: e.pts[Math.floor(e.pts.length / 2)][1] } : null); if (!at) return
      addComment(at.x, at.z, t); ctx.log((F ? 'Commentaire épinglé : ' : 'Comment pinned: ') + t.slice(0, 60))
    })
  }
  renderLeft(); renderRight()
}
function seg(px: number, pz: number, a: [number, number], b: [number, number]) {
  const dx = b[0] - a[0], dz = b[1] - a[1], L = dx * dx + dz * dz, t = L ? Math.max(0, Math.min(1, ((px - a[0]) * dx + (pz - a[1]) * dz) / L)) : 0
  return Math.hypot(px - a[0] - t * dx, pz - a[1] - t * dz)
}
