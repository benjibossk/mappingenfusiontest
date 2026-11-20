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
