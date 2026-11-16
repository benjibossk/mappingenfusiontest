// Atelier "Simplifier les textures de tuile": negligible slots → nearest present texture, per-tile before /
// after against the 5/7 budget, preview (diff map + list), user ticks / overrides, then
//  - export of the corrected _layer.edds + plan (always available, dry-run), and
//  - Apply (experimental): writes the corrected _layer.edds through the relay's safeWrite (Workbench closed,
//    SHA check, _originaux backup), with Restore.
// NOT decoded yet: the .ttile TMAT/BMAT chunk (per-block material masks the Workbench paints from). The slot
// therefore stays listed for its block until it is repainted in the Workbench — the budget gain shown is the
// gain once the plan is applied by hand / once BMAT is written. Said in the UI.
import { decodeLayer, type LayerWeights } from '../formats/edds.ts'
import { coverageFrom } from '../terrtex.ts'
import { zip } from '../zip.ts'
import { bridgeBackups, bridgeRestore, bridgeWrite, workbenchRunning, type Backup } from '../source.ts'
import texColors from '../data/texcolors.json'
import { moveWeight, planTiles, type SlotFix, type TilePlan } from './simplify.ts'
import { encodeLayer } from './eddsWrite.ts'
import { MapView, download, esc, isFr, reliefCanvas, shell, type Ctx } from '../networks/shell.ts'

type Busy = <T>(label: string, f: (stage: (s: string, i?: number, n?: number) => void) => Promise<T>) => Promise<T | undefined>

export async function openTileFix(ctx: Ctx, busy: Busy) {
  const F = isFr(), terr = ctx.terr
  const tref = ctx.src.info.terrains.find((x) => x.terr === ctx.world.terrain)
  if (!terr || !tref) { ctx.log(F ? 'Textures : pas de terrain chargé pour ce monde.' : 'Textures: no terrain loaded for this world.', true); return }
  const files = await busy(F ? 'Textures — lecture des poids _layer.edds' : 'Textures — reading _layer.edds weights', async (stage) => ctx.src.pack(tref.dataDir, '_layer.edds', tref.tilePrefix, (i, n) => stage('_layer.edds', i, n)))
  if (!files?.length) { ctx.log(F ? 'Textures : aucun _layer.edds trouvé.' : 'Textures: no _layer.edds found.', true); return }
  const cov = coverageFrom(terr, ctx.tiles, files, tref.tilePrefix)
  if (!cov) { ctx.log(F ? 'Textures : poids illisibles.' : 'Textures: unreadable weights.', true); return }
  const byTile = new Map<string, { name: string; bytes: Uint8Array }>()
  for (const f of files) { const id = Number(f.name.slice(tref.tilePrefix.length, -'_layer.edds'.length)); if (Number.isFinite(id)) byTile.set((id % terr.tilesX) + ',' + Math.floor(id / terr.tilesX), f) }
  const name = (m: number) => terr.materials[m]?.name ?? '#' + m
  let thr = 0.01, budget = 5, plans: TilePlan[] = [], selTile: string | null = null
  const on = new Set<string>(), target = new Map<string, number>()
  let preview: Map<string, number> | null = null, backups: Backup[] = []
  const replan = () => { plans = planTiles(terr, ctx.tiles, cov, thr, budget, texColors as Record<string, number[]>); on.clear(); target.clear(); for (const p of plans) for (const f of p.fixes) on.add(f.key); preview = null }
  replan()

  const { left, right, canvas, head } = shell('atTex', F ? 'Simplifier les textures de tuile' : 'Simplify tile textures', () => {})
  head.textContent = ' · ' + ctx.world.name
  const relief = ctx.H ? reliefCanvas(ctx.H) : null, tile = terr.cellsPerTile * terr.cellSize, bsz = tile / terr.blocksPerTile
  const mv = new MapView(canvas, draw, (x, z) => { const k = Math.floor(x / tile) + ',' + Math.floor(z / tile); selTile = selTile === k ? null : k; draw(); renderRight() })
  requestAnimationFrame(() => { mv.resize(); mv.fit(0, 0, terr.sizeX, terr.sizeZ); draw() })
  const fixes = () => plans.flatMap((p) => p.fixes)
  const tgt = (f: SlotFix) => target.get(f.key) ?? f.to
  function after(p: TilePlan) { // block count after the ticked fixes only
    let mx = 0, over = 0
    for (const t of ctx.tiles) if (t.tx === p.tx && t.ty === p.ty) for (const b of t.blocks) { const n = b.mats.length - p.fixes.filter((f) => f.bx === b.bx && f.by === b.by && on.has(f.key)).length; mx = Math.max(mx, n); if (n > budget) over++ }
    return { mx, over }
  }
  function draw() {
    const g = canvas.getContext('2d')!
    g.fillStyle = '#0d0f12'; g.fillRect(0, 0, canvas.width, canvas.height)
    if (relief && ctx.H) { const [ax, ay] = mv.toScreen(0, ctx.H.rows * ctx.H.cell), [bx, by] = mv.toScreen(ctx.H.cols * ctx.H.cell, 0); g.globalAlpha = 0.6; g.drawImage(relief, ax, ay, bx - ax, by - ay); g.globalAlpha = 1 }
    for (const p of plans) {
      const a = after(p), [sx, sy] = mv.toScreen(p.tx * tile, (p.ty + 1) * tile), w = tile * mv.scale
      g.fillStyle = a.over ? 'rgba(255,70,70,.35)' : p.overBefore ? 'rgba(90,220,90,.35)' : p.fixes.length ? 'rgba(90,160,255,.25)' : 'rgba(0,0,0,0)'
      g.fillRect(sx, sy, w, w); g.strokeStyle = selTile === p.tx + ',' + p.ty ? '#fff' : 'rgba(255,255,255,.15)'; g.strokeRect(sx, sy, w, w)
      for (const f of p.fixes) if (on.has(f.key)) { const [bx, by] = mv.toScreen(f.bx * bsz, (f.by + 1) * bsz); g.fillStyle = preview?.has(f.key) ? 'rgba(255,160,0,.8)' : 'rgba(255,200,0,.45)'; g.fillRect(bx + 1, by + 1, bsz * mv.scale - 2, bsz * mv.scale - 2) }
      if (w > 34) { g.fillStyle = '#fff'; g.font = '11px system-ui'; g.fillText(`${p.maxBefore}→${a.mx}`, sx + 3, sy + 13) }
    }
  }
  function renderLeft() {
    left.innerHTML = `<h4>${F ? 'Seuil « négligeable »' : '"Negligible" threshold'}</h4><label><input type="number" id="ttThr" min="0.1" max="20" step="0.1" value="${(thr * 100).toFixed(1)}" style="width:70px"> %</label>
      <h4>${F ? 'Budget par bloc' : 'Budget per block'}</h4><label><select id="ttBud"><option value="5">5</option><option value="7">7</option></select></label>
      <h4>${F ? 'Actions' : 'Actions'}</h4>
      <button type="button" class="secondary" id="ttAll">${F ? 'Tout cocher' : 'Tick all'}</button><button type="button" class="secondary" id="ttNone">${F ? 'Tout décocher' : 'Untick all'}</button><br>
      <button type="button" id="ttPrev">${F ? '1. Aperçu (simulation)' : '1. Preview (dry-run)'}</button><br>
      <button type="button" class="secondary" id="ttExp">${F ? '2. Exporter masques corrigés (.zip)' : '2. Export corrected masks (.zip)'}</button><br>
      <button type="button" class="secondary" id="ttCsv">${F ? 'Plan CSV' : 'Plan CSV'}</button><br>
      <button type="button" class="secondary" id="ttApply" ${ctx.src.canWrite ? '' : 'disabled'}>${F ? '3. Appliquer au projet (expérimental)' : '3. Apply to the project (experimental)'}</button>
      <button type="button" class="secondary" id="ttBk">${F ? 'Restaurer…' : 'Restore…'}</button><div id="ttBkList"></div>
      <p class="hint warn">${F ? 'Limite : le bloc TMAT/BMAT des .ttile (masques de matériaux par bloc) n\'est pas encore décodé en écriture. Les poids _layer.edds sont corrigés, mais la texture reste listée dans son bloc jusqu\'à ce qu\'on la repeigne dans le Workbench (plan CSV) : le gain affiché est le gain une fois le plan appliqué.' : 'Limit: the .ttile TMAT/BMAT chunk (per-block material masks) is not decoded for writing yet. _layer.edds weights are corrected, but the texture stays listed in its block until repainted in the Workbench (CSV plan): the gain shown is the gain once the plan is applied.'}</p>
      <p class="hint">${F ? 'Carte : vert = tuile ramenée sous le budget, rouge = encore au-dessus, jaune = bloc corrigé (orange après aperçu).' : 'Map: green = tile brought under budget, red = still over, yellow = corrected block (orange after preview).'}</p>`
    left.querySelector<HTMLSelectElement>('#ttBud')!.value = String(budget)
    left.querySelector('#ttThr')!.addEventListener('change', (e) => { thr = Math.max(0.001, Number((e.target as HTMLInputElement).value) / 100); replan(); draw(); renderRight() })
    left.querySelector('#ttBud')!.addEventListener('change', (e) => { budget = Number((e.target as HTMLSelectElement).value); replan(); draw(); renderRight() })
    left.querySelector('#ttAll')!.addEventListener('click', () => { for (const f of fixes()) on.add(f.key); preview = null; draw(); renderRight() })
    left.querySelector('#ttNone')!.addEventListener('click', () => { on.clear(); preview = null; draw(); renderRight() })
    left.querySelector('#ttPrev')!.addEventListener('click', () => void doPreview())
    left.querySelector('#ttExp')!.addEventListener('click', () => void exportZip())
    left.querySelector('#ttCsv')!.addEventListener('click', () => download(`${ctx.world.name}_texture_plan.csv`, planCsv(), 'text/csv'))
    left.querySelector('#ttApply')!.addEventListener('click', () => void apply())
    left.querySelector('#ttBk')!.addEventListener('click', () => void listBackups())
  }
  function corrected(): Map<string, { name: string; orig: Uint8Array; out: Uint8Array; changed: Map<string, number> }> {
    const res = new Map<string, { name: string; orig: Uint8Array; out: Uint8Array; changed: Map<string, number> }>()
    const bt = new Map<string, SlotFix[]>()
    for (const f of fixes()) if (on.has(f.key)) { const k = f.tx + ',' + f.ty; (bt.get(k) ?? bt.set(k, []).get(k)!).push(f) }
    for (const [k, list] of bt) {
      const file = byTile.get(k); if (!file) continue
      const L: LayerWeights = decodeLayer(file.bytes), orig = L.px.slice(), changed = new Map<string, number>()
      // highest slots first: a slot that is itself a target keeps receiving weight correctly
      for (const f of [...list].sort((a, b) => b.slot - a.slot)) changed.set(f.key, moveWeight(L, terr!.blocksPerTile, f.bx - f.tx * terr!.blocksPerTile, f.by - f.ty * terr!.blocksPerTile, f.slot, tgt(f)))
      res.set(k, { name: file.name, orig: file.bytes, out: encodeLayer(file.bytes, L.px, orig), changed })
    }
    return res
  }
  async function doPreview() {
    await busy(F ? 'Aperçu des corrections' : 'Previewing corrections', async () => {
      const c = corrected(); preview = new Map(); for (const v of c.values()) for (const [k, n] of v.changed) preview.set(k, n)
      ctx.log(F ? `Aperçu : ${preview.size} slots, ${[...preview.values()].reduce((s, n) => s + n, 0)} pixels de poids déplacés, ${c.size} tuiles (rien n'est écrit).` : `Preview: ${preview.size} slots, ${[...preview.values()].reduce((s, n) => s + n, 0)} weight pixels moved, ${c.size} tiles (nothing written).`)
    })
    draw(); renderRight()
  }
  function planCsv() {
    const rows = [['tile_x', 'tile_y', 'block_x', 'block_y', 'slot', 'texture', 'coverage_pct', 'replace_by', 'apply']]
    for (const f of fixes()) rows.push([f.tx, f.ty, f.bx, f.by, f.slot, name(f.mat), (100 * f.pct).toFixed(3), name(f.mats[tgt(f)]), on.has(f.key) ? 1 : 0].map(String))
    return rows.map((r) => r.join(';')).join('\n') + '\n'
  }
  async function exportZip() {
    await busy(F ? 'Export des masques corrigés' : 'Exporting corrected masks', async () => {
      const c = corrected(), enc = new TextEncoder()
      const z = zip([...[...c.values()].map((v) => ({ name: 'corrected/' + v.name, data: v.out })), { name: 'texture_plan.csv', data: enc.encode(planCsv()) },
        { name: 'README.txt', data: enc.encode(F ? 'Poids _layer.edds corrigés (slots négligeables reportés sur la texture la plus proche). Le .ttile (TMAT/BMAT) n\'est pas modifié : repeindre les slots du plan dans le Workbench pour retirer la texture du bloc.\n' : 'Corrected _layer.edds weights. The .ttile (TMAT/BMAT) is unchanged: repaint the plan\'s slots in the Workbench to drop the texture from the block.\n') }])
      download(`${ctx.world.name}_textures_corrigees.zip`, new Blob([z as BlobPart], { type: 'application/zip' }))
    })
  }
  async function apply() {
    if (await workbenchRunning()) { ctx.log(F ? 'Fermez le Workbench avant d\'appliquer.' : 'Close the Workbench before applying.', true); return }
    const c = corrected(); if (!c.size) return
    if (!confirm(F ? `Écrire ${c.size} fichier(s) _layer.edds dans le projet ? (sauvegarde dans _originaux, restaurable)` : `Write ${c.size} _layer.edds file(s) to the project? (backup in _originaux, restorable)`)) return
    await busy(F ? 'Application' : 'Applying', async (stage) => {
      let i = 0
      for (const v of c.values()) {
        const path = tref!.dataDir.replace(/\/$/, '') + '/' + v.name; stage(v.name, i++, c.size)
        if (v.out === v.orig) continue
        const cur = await ctx.src.read(path)
        try { const r = await bridgeWrite(path, v.out, cur.sha); ctx.log((F ? 'Écrit : ' : 'Written: ') + path + (r.backup ? ' (' + r.backup + ')' : '')) }
        catch (e) { ctx.log((e as Error).message, true); return }
      }
    })
  }
  async function listBackups() {
    try { backups = (await bridgeBackups()).filter((b) => b.file.endsWith('_layer.edds')) } catch (e) { ctx.log((e as Error).message, true); return }
    const el = left.querySelector('#ttBkList')!
    el.innerHTML = backups.length ? `<ul>${backups.slice(0, 40).map((b, i) => `<li><button type="button" class="secondary" data-bk="${i}">↺</button> ${esc(b.file.split('/').pop()!)} <span class="hint">${esc(b.stamp)} · ${b.current}</span></li>`).join('')}</ul>` : `<p class="hint">${F ? 'Aucune sauvegarde.' : 'No backup.'}</p>`
    el.querySelectorAll<HTMLButtonElement>('[data-bk]').forEach((b) => b.addEventListener('click', async () => { const k = backups[Number(b.dataset.bk)]; try { await bridgeRestore(k.stamp, k.file); ctx.log((F ? 'Restauré : ' : 'Restored: ') + k.file) } catch (e) { ctx.log((e as Error).message, true) } }))
  }
  function renderRight() {
    const tot = plans.reduce((s, p) => s + p.fixes.length, 0), overB = plans.reduce((s, p) => s + p.overBefore, 0), overA = plans.reduce((s, p) => s + after(p).over, 0)
    const shown = plans.filter((p) => p.fixes.length && (!selTile || selTile === p.tx + ',' + p.ty)).sort((a, b) => b.overBefore - a.overBefore || b.fixes.length - a.fixes.length)
    right.innerHTML = `<table><tr><th>${F ? 'Slots négligeables' : 'Negligible slots'}</th><td>${tot} (${on.size} ${F ? 'cochés' : 'ticked'})</td></tr><tr><th>${F ? `Blocs > ${budget} avant` : `Blocks > ${budget} before`}</th><td>${overB}</td></tr><tr><th>${F ? 'après' : 'after'}</th><td class="${overA < overB ? 'ok' : ''}">${overA}</td></tr></table>
      ${selTile ? `<p class="hint">${F ? 'Tuile' : 'Tile'} ${selTile} — <a href="#" id="ttClr">${F ? 'toutes' : 'all'}</a></p>` : ''}
      <h4>${F ? 'Par tuile (avant → après, max slots / bloc)' : 'Per tile (before → after, max slots / block)'}</h4>
      ${shown.slice(0, 80).map((p) => { const a = after(p); return `<div class="det"><b>${F ? 'Tuile' : 'Tile'} ${p.tx},${p.ty}</b> — ${p.maxBefore} → ${a.mx} · ${F ? 'blocs hors budget' : 'blocks over budget'} ${p.overBefore} → <span class="${a.over < p.overBefore ? 'ok' : ''}">${a.over}</span>
        <table>${p.fixes.map((f) => `<tr><td><input type="checkbox" data-f="${f.key}" ${on.has(f.key) ? 'checked' : ''}></td><td>${f.bx},${f.by} #${f.slot}<br><b>${esc(name(f.mat))}</b> ${(100 * f.pct).toFixed(2)} %</td><td>→ <select data-t="${f.key}">${f.candidates.map((k) => `<option value="${k}" ${k === tgt(f) ? 'selected' : ''}>${k === 0 ? (F ? 'base: ' : 'base: ') : ''}${esc(name(f.mats[k]))}</option>`).join('')}</select>${preview?.has(f.key) ? `<br><span class="hint">${preview.get(f.key)} px</span>` : ''}</td></tr>`).join('')}</table></div>` }).join('')}`
    right.querySelector('#ttClr')?.addEventListener('click', (e) => { e.preventDefault(); selTile = null; draw(); renderRight() })
    right.querySelectorAll<HTMLInputElement>('[data-f]').forEach((c) => c.addEventListener('change', () => { if (c.checked) on.add(c.dataset.f!); else on.delete(c.dataset.f!); preview = null; draw(); renderRight() }))
    right.querySelectorAll<HTMLSelectElement>('[data-t]').forEach((s) => s.addEventListener('change', () => { target.set(s.dataset.t!, Number(s.value)); preview = null }))
  }
  renderLeft(); renderRight()
}
