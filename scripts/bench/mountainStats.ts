// Shared by mountain-roads.ts: runs in Node or, with --browser, inside the app page (Vite), where Math.pow/sin/cos
// round like the app's worker (Node 24 V8 13.6 and Chromium 131 differ in the last bit -> another relief).
import { generateWorld, appWorldParams, type WorldParams, type WorldResult } from '../../src/modules/worldgen'
import { worstGrade, maxGrade } from '../../src/modules/network'
import { roadCurveStats, hairpinSpots } from '../../src/modules/roadgeom'
import { roadHalf } from '../../src/modules/roads'
import { fitMetrics } from '../../src/modules/scenarioFit'

export async function mountainProbe(seed: number, over: Partial<WorldParams>, list = false) {
  const t0 = Date.now()
  const w: WorldResult = await generateWorld(appWorldParams(seed, over))
  const out: string[] = []
  let gMax = 0, over_ = 0, kink = 0, rMin = Infinity, pins = 0, len = 0, xMax = 0, xSum = 0, xN = 0
  const cls: Record<string, number> = {}, g = w.grid, pinAt: string[] = []
  const hAt = (x: number, z: number) => { const c = Math.min(g.cols - 1, Math.max(0, Math.round((x - g.minX) / g.step))), r = Math.min(g.rows - 1, Math.max(0, Math.round((z - g.minZ) / g.step))); return w.heights[r * g.cols + c] }
  for (const r of w.roads) {
    if (r.pts.length < 4) continue
    const wg = worstGrade(r.pts, w.heights, w.grid, r.spans), gr = wg.grade
    const c = /^ROAD_PROD/.test(r.id) ? 'prod' : /^ROAD_FIELD/.test(r.id) ? 'field' : r.type
    cls[c] = Math.max(cls[c] ?? 0, gr)
    if (c === 'prod' || c === 'field') { if (list) out.push(`${r.id} grade ${(gr * 100).toFixed(1)}%`); continue }
    for (const hp of hairpinSpots(r.pts)) {
      const L = 1 + roadHalf(r) + 3; let worst = 0
      for (let a = 0; a < 8; a++) { const ux = Math.cos(a * Math.PI / 8), uz = Math.sin(a * Math.PI / 8); worst = Math.max(worst, Math.abs(hAt(hp.x + ux * L, hp.z + uz * L) - hAt(hp.x - ux * L, hp.z - uz * L)) / (2 * L)) }
      xMax = Math.max(xMax, worst); xSum += worst; xN++
      if (!/^RB_/.test(r.id)) pinAt.push(`${r.id} (${r.type}) ${Math.round(hp.x)},${Math.round(hp.z)} h ${Math.round(hAt(hp.x, hp.z))} m`)
      if (list) out.push(`  pin ${r.id} ${Math.round(hp.x)} ${Math.round(hp.z)} cross ${(worst * 100).toFixed(1)}%`)
    }
    const s = roadCurveStats(r.pts)
    gMax = Math.max(gMax, gr); if (gr > maxGrade(r.type)) over_++
    kink = Math.max(kink, s.maxTurn); rMin = Math.min(rMin, s.minRadius); pins += s.hairpins; len += s.length
    if (list) out.push(`${r.id} ${r.type} grade ${(gr * 100).toFixed(1)}% turn ${s.maxTurn.toFixed(0)}deg R ${s.minRadius.toFixed(0)}m pins ${s.hairpins} at ${Math.round(wg.x)},${Math.round(wg.z)}`)
  }
  out.push(`seed ${seed} ${w.params.relief}: ${w.roads.length} roads ${Math.round(len / 1000)} km, max grade ${(gMax * 100).toFixed(1)}% (${over_} over type limit), sharpest turn/10m ${kink.toFixed(0)} deg, min radius ${rMin.toFixed(1)} m, hairpins ${pins}, pin cross-slope max ${(xMax * 100).toFixed(0)}% mean ${(xN ? xSum / xN * 100 : 0).toFixed(0)}%, ${Math.round((Date.now() - t0) / 1000)} s`)
  out.push('max grade by class: ' + Object.entries(cls).map(([k, v]) => `${k} ${(v * 100).toFixed(0)}%`).join(', '))
  const fit = fitMetrics({ heights: w.heights, grid: { cols: g.cols, rows: g.rows, cell: g.step, minX: g.minX, minZ: g.minZ }, places: w.sites.map((s) => ({ x: s.x, z: s.z, kind: s.kind })), houses: w.settlement.placed.map((b) => ({ x: b.x, z: b.z })), roads: w.roads.map((r) => ({ type: r.type, pts: r.pts })) })
  out.push(`fit: towns ${fit.towns}, asphaltTowns ${(fit.asphaltTowns * 100).toFixed(0)}%, placesOnMainRoad ${(fit.placesOnMainRoad * 100).toFixed(0)}%, roadGroups ${fit.roadGroups}`)
  out.push('ids: ' + w.roads.filter((r) => /^ROAD_ASPH/.test(r.id)).map((r) => `${r.id}:${r.type}`).join(' '))
  if (pinAt.length) out.push('hairpins: ' + pinAt.join(' | '))
  return { out, w }
}
