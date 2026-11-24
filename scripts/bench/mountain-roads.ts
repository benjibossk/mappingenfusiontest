// Mountain road probe: npx tsx scripts/bench/mountain-roads.ts [seed] [relief]
// Per road: steepest grade on the final relief (20 m steps), sharpest turn between 10 m chords, tightest radius, hairpins.
import '../../src/workers/shim'
import { generateWorld, WORLD_DEFAULTS } from '../../src/modules/worldgen'
import { worstGrade, maxGrade } from '../../src/modules/network'
import { roadCurveStats, hairpinSpots } from '../../src/modules/roadgeom'
import { roadHalf } from '../../src/modules/roads'

const seed = Number(process.argv[2] ?? 21), relief = (process.argv[3] ?? 'mountains') as 'mountains'
const t0 = Date.now()
const w = await generateWorld({ ...WORLD_DEFAULTS, seed, relief } as never)
let gMax = 0, over = 0, kink = 0, rMin = Infinity, pins = 0, len = 0, xMax = 0, xSum = 0, xN = 0
const cls: Record<string, number> = {}, g = w.grid
const hAt = (x: number, z: number) => { const c = Math.min(g.cols - 1, Math.max(0, Math.round((x - g.minX) / g.step))), r = Math.min(g.rows - 1, Math.max(0, Math.round((z - g.minZ) / g.step))); return w.heights[r * g.cols + c] }
for (const r of w.roads) {
  if (r.pts.length < 4) continue
  const wg = worstGrade(r.pts, w.heights, w.grid, r.spans), gr = wg.grade
  const c = /^ROAD_PROD/.test(r.id) ? 'prod' : /^ROAD_FIELD/.test(r.id) ? 'field' : r.type
  cls[c] = Math.max(cls[c] ?? 0, gr)
  if (c === 'prod' || c === 'field') { if (process.argv.includes('--list')) console.log(r.id, `grade ${(gr * 100).toFixed(1)}%`); continue } // other generators: per-class line only
  // hairpin bed cross-slope: across the turn at the apex, over road half + 3 m each side
  for (const hp of hairpinSpots(r.pts)) {
    const L = 1 + roadHalf(r) + 3; let worst = 0
    for (let a = 0; a < 8; a++) { const ux = Math.cos(a * Math.PI / 8), uz = Math.sin(a * Math.PI / 8); worst = Math.max(worst, Math.abs(hAt(hp.x + ux * L, hp.z + uz * L) - hAt(hp.x - ux * L, hp.z - uz * L)) / (2 * L)) }
    xMax = Math.max(xMax, worst); xSum += worst; xN++
    if (process.argv.includes("--list")) console.log("  pin", r.id, Math.round(hp.x), Math.round(hp.z), `cross ${(worst * 100).toFixed(1)}%`)
  }
  const s = roadCurveStats(r.pts)
  gMax = Math.max(gMax, gr); if (gr > maxGrade(r.type)) over++
  kink = Math.max(kink, s.maxTurn); rMin = Math.min(rMin, s.minRadius); pins += s.hairpins; len += s.length
  if (process.argv.includes('--list')) console.log(r.id, r.type, `grade ${(gr * 100).toFixed(1)}%`, `turn ${s.maxTurn.toFixed(0)}deg`, `R ${s.minRadius.toFixed(0)}m`, `pins ${s.hairpins}`, `at ${Math.round(wg.x)},${Math.round(wg.z)}`)
}
console.log(`seed ${seed} ${relief}: ${w.roads.length} roads ${Math.round(len / 1000)} km, max grade ${(gMax * 100).toFixed(1)}% (${over} over type limit), sharpest turn/10m ${kink.toFixed(0)} deg, min radius ${rMin.toFixed(1)} m, hairpins ${pins}, pin cross-slope max ${(xMax * 100).toFixed(0)}% mean ${(xN ? xSum / xN * 100 : 0).toFixed(0)}%, ${Math.round((Date.now() - t0) / 1000)} s`)
console.log('max grade by class:', Object.entries(cls).map(([k, v]) => `${k} ${(v * 100).toFixed(0)}%`).join(', '))
// --kinks ID: where that road turns harder than 60 degrees between 10 m chords
{
  const k = process.argv.indexOf('--kinks'), r = k > 0 ? w.roads.find((q) => q.id === process.argv[k + 1]) : undefined
  if (r) {
    const { centreLine } = await import('../../src/modules/roads')
    const L = centreLine(r.pts, 5), n = L.length / 2
    for (let i = 2; i + 2 < n; i++) {
      const a = Math.atan2(L[i * 2 + 1] - L[i * 2 - 3], L[i * 2] - L[i * 2 - 4]), b = Math.atan2(L[i * 2 + 5] - L[i * 2 + 1], L[i * 2 + 4] - L[i * 2])
      const d = (Math.abs(Math.atan2(Math.sin(b - a), Math.cos(b - a))) * 180) / Math.PI
      if (d > 60) console.log('kink', Math.round(L[i * 2]), Math.round(L[i * 2 + 1]), d.toFixed(0))
    }
    const o: string[] = []; for (let i = 0; i < r.pts.length; i += 2) o.push(`${Math.round(r.pts[i])},${Math.round(r.pts[i + 1])}`); console.log(o.length, 'pts', o.join(' '))
  }
}
