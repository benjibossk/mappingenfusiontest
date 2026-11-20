// Pre-send check on a generated world: npx tsx scripts/bench/presend-world.ts [seed] [size]
// Prints the onRoad / overlap issues grouped by object id prefix and road id prefix (generator bug metric).
import '../../src/workers/shim'
import { generateWorld, WORLD_DEFAULTS } from '../../src/modules/worldgen'
import { preSendChecks, zoneLines } from '../../src/validate/preSend'
import { centreLine, roadHalf } from '../../src/modules/roads'

const seed = Number(process.argv[2] ?? 42), size = Number(process.argv[3] ?? 4096)
const w = await generateWorld({ ...WORLD_DEFAULTS, seed, size, vanillaSites: true, villageTemplates: true, ...(process.argv.includes('--dams') ? { dams: true } : {}), ...(process.argv.includes('--no-gameplay') ? { gameplayCover: false } : {}) } as never)
const line = (r: { id: string; pts: number[] } & Parameters<typeof roadHalf>[0], zone?: number) => ({ id: r.id, half: roadHalf(r), line: centreLine(r.pts, 4), ...(zone !== undefined ? { zone } : {}) })
const roads = [...w.roads.map((r) => line(r)), ...w.zones.flatMap((z, k) => z.roads.map((r) => line(r, k))), ...w.settlement.lanes.map((r) => line(r))].filter((r) => r.line.length >= 4)
const issues = preSendChecks({ width: size, height: size, settled: w.settlement.placed, zones: w.zones.map((z) => ({ id: z.id, entities: z.entities, lines: zoneLines(z as never, roadHalf as never) })), roads })
const pre = (s: string) => s.split(' / ').map((q) => q.replace(/\d+/g, '#').replace(/_[A-Za-z]+_#(_#)*$/, '').replace(/(_#)+$|#$/, '')).join(' / ')
const by = new Map<string, number>()
for (const i of issues) { const k = `${i.kind} ${pre(i.id)}${i.value !== undefined ? '' : ''}`; by.set(k, (by.get(k) ?? 0) + 1) }
console.log(`seed ${seed} size ${size}: ${issues.length} issues`)
for (const [k, n] of [...by].sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(n, k)
if (process.argv.includes('--list')) for (const i of issues.slice(0, 40)) console.log(JSON.stringify(i))
// parallel lines of different voltage: LV spans within 25 m of an MV / HV line (one corridor per road stretch)
{
  const { parallelOverlap } = await import('../../src/modules/powergrid')
  const L = parallelOverlap(w.power as never)
  console.log(`parallel LV/MV within 25 m: ${Math.round(L)} m`)
}
{
  const t = (w as { powerTopology?: { nodes: unknown[]; edges: unknown[]; feeders: unknown[]; consumers: { transformer: string | null }[] } }).powerTopology
  if (t) console.log(`topology: ${t.nodes.length} nodes, ${t.edges.length} edges, ${t.feeders.length} feeders, ${t.consumers.length} consumers (${t.consumers.filter((c) => !c.transformer).length} without transformer)`)
  const o = process.argv.indexOf('--topology'); if (t && o > 0) (await import('node:fs')).writeFileSync(process.argv[o + 1], JSON.stringify(t, null, 1))
}
// rocks (cliffRocks.ts, ROCKS_VANILLA.md): pieces per km2 of land by kind, slope histogram of the big ones (5 deg bins)
{
  const { rockKind } = await import('../../src/modules/cliffRocks')
  const g = w.grid, H = w.heights, at = (x: number, z: number) => H[Math.min(g.rows - 1, Math.max(0, Math.round((z - g.minZ) / g.step))) * g.cols + Math.min(g.cols - 1, Math.max(0, Math.round((x - g.minX) / g.step)))]
  const land = (H as ArrayLike<number>) ? Array.from(H as ArrayLike<number>).filter((h) => h > 0.5).length * g.step * g.step / 1e6 : 1
  const es = w.zones.find((z) => z.id === 'CLIFF_ROCKS')?.entities ?? []
  const by: Record<string, number> = {}
  for (const e of es) { const k = rockKind(e.prefab) ?? 'other'; by[k] = (by[k] ?? 0) + 1 }
  const deg = (x: number, z: number) => (Math.atan(Math.hypot(at(x + 4, z) - at(x - 4, z), at(x, z + 4) - at(x, z - 4)) / 8) * 180) / Math.PI
  const hist = new Array(10).fill(0), big = es.filter((e) => /^(rock|cliff)$/.test(rockKind(e.prefab) ?? ''))
  for (const e of big) hist[Math.min(9, Math.floor(deg(e.x, e.z) / 5))]++
  console.log(`rocks: ${es.length} (${(es.length / land).toFixed(1)}/km2 land) ${Object.entries(by).map(([k, n]) => `${k} ${(n / land).toFixed(1)}`).join(', ')}; big slope % ${hist.map((n) => Math.round((100 * n) / Math.max(1, big.length))).join(' ')}`)
}
// roads vs relief: grade along the centre lines and side slope 2-6 m past the carriageway edge (embankments)
{
  const g = w.grid, H = w.heights as ArrayLike<number>
  const hb = (x: number, z: number) => {
    const gx = Math.min(Math.max((x - g.minX) / g.step, 0), g.cols - 1.001), gz = Math.min(Math.max((z - g.minZ) / g.step, 0), g.rows - 1.001)
    const c = Math.floor(gx), r = Math.floor(gz), fx = gx - c, fz = gz - r, i = r * g.cols + c
    return (H[i] * (1 - fx) + H[i + 1] * fx) * (1 - fz) + (H[i + g.cols] * (1 - fx) + H[i + g.cols + 1] * fx) * fz
  }
  const grades: number[] = [], sides: number[] = []
  for (const r of roads) for (let i = 0; i + 3 < r.line.length; i += 2) {
    const ax = r.line[i], az = r.line[i + 1], bx = r.line[i + 2], bz = r.line[i + 3], L = Math.hypot(bx - ax, bz - az)
    if (L < 2 || hb(ax, az) < 0.5) continue
    grades.push(Math.abs(hb(bx, bz) - hb(ax, az)) / L * 100)
    const nx = -(bz - az) / L, nz = (bx - ax) / L, mx = (ax + bx) / 2, mz = (az + bz) / 2
    for (const s of [-1, 1]) {
      const d0 = r.half + 2, d1 = r.half + 6
      sides.push(Math.atan(Math.abs(hb(mx + s * nx * d1, mz + s * nz * d1) - hb(mx + s * nx * d0, mz + s * nz * d0)) / 4) * 180 / Math.PI)
    }
  }
  const q = (a: number[], f: number) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(f * s.length))].toFixed(1) : '-' }
  console.log(`road grade %: p50 ${q(grades, 0.5)} p95 ${q(grades, 0.95)} max ${q(grades, 1)}; side slope deg (2-6 m off the edge): p50 ${q(sides, 0.5)} p90 ${q(sides, 0.9)} p99 ${q(sides, 0.99)}, > 35 deg ${(100 * sides.filter((v) => v > 35).length / Math.max(1, sides.length)).toFixed(1)} %`)
}
// surfaces: sea bed on dry land (block-limiter seams, seed 21), road cores lost to the per-block limit (grass clutter on the road)
{
  const { paintMasks } = await import('../../src/shared/maskPaint.mjs')
  const { roadMasks } = await import('../../src/modules/roads')
  const sea = w.surfaces.find((s) => s.name === 'SeaBed_01')
  let dry = 0
  if (sea) for (let i = 0; i < w.heights.length; i++) if (w.heights[i] > 2 && sea.weights[i] > 0.3) dry++
  const side = 1025, f = (side - 1) / 4032
  const rm = roadMasks([...w.roads, ...w.zones.flatMap((z) => z.roads)] as never)
  const { names, bytes } = paintMasks(side, size, w.surfaces as never, rm as never, null, Math.max(4, Math.round(63 * f)), 1) as { names: string[]; bytes: Uint8Array[] }
  const mPerPx = size / (side - 1)
  let tot = 0, lost = 0
  for (const r of rm) for (let i = 0; i + 3 < r.points.length; i += 2) {
    const L = Math.hypot(r.points[i + 2] - r.points[i], r.points[i + 3] - r.points[i + 1])
    for (let t = 0; t < L; t += mPerPx) {
      const x = r.points[i] + (r.points[i + 2] - r.points[i]) * t / Math.max(L, 1e-6), z = r.points[i + 1] + (r.points[i + 3] - r.points[i + 1]) * t / Math.max(L, 1e-6)
      const p = (side - 1 - Math.round(z / mPerPx)) * side + Math.round(x / mPerPx)
      if (p < 0 || p >= side * side) continue
      let best = -1, bv = -1
      for (let k = 0; k < bytes.length; k++) if (bytes[k][p] > bv) { bv = bytes[k][p]; best = k }
      tot++
      if (!/^(Asphalt|Concrete|Cobblestone|Dirt|Pebbles|Gravel)/.test(names[best])) lost++
    }
  }
  console.log(`surfaces: SeaBed > 30 % on land > 2 m: ${dry} cells; road centre pixels on a clutter surface: ${(100 * lost / Math.max(1, tot)).toFixed(1)} % of ${tot}`)
}
// vegetation / poles vs road corridors (roadClip.ts): every road, lane, zone street and power access track
{
  const { Corridors, hedgesOnRoad, ringOnRoad } = await import('../../src/modules/roadClip')
  const all = [...w.roads, ...w.settlement.lanes, ...w.zones.flatMap((z) => z.roads), ...((w as { powerAccess?: number[][] }).powerAccess ?? []).map((pts, i) => ({ id: `PSTA_ROAD_${i + 1}`, type: 'dirt', pts }))]
  const C = new Corridors(all.filter((r) => r.pts.length >= 4).map((r) => ({ id: r.id, pts: centreLine(r.pts, 4), half: roadHalf(r as never) })))
  const hedges = (w as { campaign?: { hedges: number[][][] } }).campaign?.hedges ?? []
  const hr = hedgesOnRoad(hedges, C)
  const groves = w.areas.filter((a) => a.id.startsWith('FOREST_GROVE_') && ringOnRoad(a.pts, C, 0)).length
  const trees = w.zones.filter((z) => z.sub === 'fieldtrees').flatMap((z) => z.entities).filter((e) => C.hit(e.x, e.z, 0.5)).length
  const poles: string[] = []
  const sts = (w as { powerStations?: { x: number; z: number; w: number; d: number }[] }).powerStations ?? []
  let slots = 0
  for (const l of w.power as { id: string; poles: number[] }[]) for (let i = 0; i + 1 < l.poles.length; i += 2) { if (sts.some((st) => Math.hypot(st.x - l.poles[i], st.z - l.poles[i + 1]) < Math.max(st.w, st.d) / 2 + 3)) { slots++; continue } const h = C.hit(l.poles[i], l.poles[i + 1], 1.4); if (h) poles.push(`${l.id}#${i / 2} / ${h.id}`) }
  for (const s of (w as { powerStations?: { id: string; x: number; z: number }[] }).powerStations ?? []) { const h = C.hit(s.x, s.z, 0.5); if (h && !/^PSTA_ROAD/.test(h.id)) poles.push(`${s.id} / ${h.id}`) }
  console.log(`hedge-on-road: ${hr.length}${hr.length ? ' (' + hr.slice(0, 5).map((q) => `${JSON.stringify(hedges[q.i])} / ${q.road} @${q.x.toFixed(1)},${q.z.toFixed(1)}`).join(', ') + ')' : ''}; grove-on-road: ${groves}; fieldtree-on-road: ${trees}; pole-on-road: ${poles.length} (station slots skipped: ${slots})${poles.length ? ' (' + poles.slice(0, 6).join(', ') + ')' : ''}`)
}
// power lines vs roads (POWERGRID_LOGIC.md: 87 % of vanilla distribution poles < 10 m from a road): MV/LV poles near a
// road, line length within 15 m of a carriageway edge, road crossings per km and their angle (vanilla: near-square)
{
  const { Corridors } = await import('../../src/modules/roadClip')
  const rl = [...w.roads, ...w.settlement.lanes, ...w.zones.flatMap((z) => z.roads)].filter((r) => r.pts.length >= 4).map((r) => ({ id: r.id, pts: centreLine(r.pts, 4), half: roadHalf(r as never) }))
  const C = new Corridors(rl)
  const segs = rl.flatMap((r) => { const o: number[][] = []; for (let i = 0; i + 3 < r.pts.length; i += 2) o.push([r.pts[i], r.pts[i + 1], r.pts[i + 2], r.pts[i + 3]]); return o })
  let poles = 0, near = 0, len = 0, follow = 0, cross = 0, steep = 0
  for (const l of (w.power as { kind: string; poles: number[] }[]).filter((q) => q.kind === 'mv' || q.kind === 'lv')) {
    const p = l.poles
    for (let i = 0; i + 1 < p.length; i += 2) { poles++; if (C.hit(p[i], p[i + 1], 10)) near++ }
    for (let i = 0; i + 3 < p.length; i += 2) {
      const ax = p[i], az = p[i + 1], bx = p[i + 2], bz = p[i + 3], L = Math.hypot(bx - ax, bz - az); len += L
      for (let t = 0.5; t < L; t += 1) if (C.hit(ax + ((bx - ax) * t) / L, az + ((bz - az) * t) / L, 15)) follow++
      for (const s of segs) {
        const d = (bx - ax) * (s[3] - s[1]) - (bz - az) * (s[2] - s[0]); if (!d) continue
        const u = ((s[0] - ax) * (s[3] - s[1]) - (s[1] - az) * (s[2] - s[0])) / d, v = ((s[0] - ax) * (bz - az) - (s[1] - az) * (bx - ax)) / d
        if (u < 0 || u > 1 || v < 0 || v > 1) continue
        cross++
        const c = Math.abs(((bx - ax) * (s[2] - s[0]) + (bz - az) * (s[3] - s[1])) / (L * Math.hypot(s[2] - s[0], s[3] - s[1]) || 1))
        if (Math.acos(Math.min(1, c)) * 180 / Math.PI >= 60) steep++
      }
    }
  }
  console.log(`power vs roads (MV+LV): poles < 10 m from a road ${Math.round((100 * near) / Math.max(1, poles))} % (vanilla 87 %), length within 15 m ${Math.round((100 * follow) / Math.max(1, len))} %, crossings ${(cross / Math.max(0.001, len / 1000)).toFixed(1)}/km (${Math.round((100 * steep) / Math.max(1, cross))} % at >= 60 deg)`)
}
// harbours (harbour.ts, HARBOUR_VANILLA.md): pieces floating / sunk vs sea level, misaligned quay pieces, isolated
// breakwater pieces, land props in the water, sea parts on dry ground
{
  const { harbourIssues } = await import('../../src/modules/harbour')
  const g = w.grid, H = w.heights, at = (x: number, z: number) => H[Math.min(g.rows - 1, Math.max(0, Math.round((z - g.minZ) / g.step))) * g.cols + Math.min(g.cols - 1, Math.max(0, Math.round((x - g.minX) / g.step)))]
  for (const z of w.zones.filter((q) => q.harbour)) {
    const is = harbourIssues(z.entities, at), by: Record<string, number> = {}
    for (const i of is) by[i.kind] = (by[i.kind] ?? 0) + 1
    console.log(`harbour ${z.id} ${z.harbour!.compo} (${z.entities.length} objects): ${is.length ? Object.entries(by).map(([k, n]) => `${k} ${n}`).join(', ') : 'ok'}`)
    if (process.argv.includes('--list')) for (const i of is.slice(0, 15)) console.log(' ', JSON.stringify({ ...i, prefab: z.entities.find((e) => e.id === i.id)?.prefab.split('/').pop() }))
  }
}
