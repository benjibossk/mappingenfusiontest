// Pre-send check on a generated world: npx tsx scripts/bench/presend-world.ts [seed] [size]
// Prints the onRoad / overlap issues grouped by object id prefix and road id prefix (generator bug metric).
import '../../src/workers/shim'
import { generateWorld, WORLD_DEFAULTS } from '../../src/modules/worldgen'
import { preSendChecks } from '../../src/validate/preSend'
import { centreLine, roadHalf } from '../../src/modules/roads'

const seed = Number(process.argv[2] ?? 42), size = Number(process.argv[3] ?? 4096)
const w = await generateWorld({ ...WORLD_DEFAULTS, seed, size, vanillaSites: true, villageTemplates: true } as never)
const line = (r: { id: string; pts: number[] } & Parameters<typeof roadHalf>[0], zone?: number) => ({ id: r.id, half: roadHalf(r), line: centreLine(r.pts, 4), ...(zone !== undefined ? { zone } : {}) })
const roads = [...w.roads.map((r) => line(r)), ...w.zones.flatMap((z, k) => z.roads.map((r) => line(r, k))), ...w.settlement.lanes.map((r) => line(r))].filter((r) => r.line.length >= 4)
const issues = preSendChecks({ width: size, height: size, settled: w.settlement.placed, zones: w.zones.map((z) => ({ id: z.id, entities: z.entities })), roads })
const pre = (s: string) => s.split(' / ').map((q) => q.replace(/\d+/g, '#').replace(/_[A-Za-z]+_#(_#)*$/, '').replace(/(_#)+$|#$/, '')).join(' / ')
const by = new Map<string, number>()
for (const i of issues) { const k = `${i.kind} ${pre(i.id)}${i.value !== undefined ? '' : ''}`; by.set(k, (by.get(k) ?? 0) + 1) }
console.log(`seed ${seed} size ${size}: ${issues.length} issues`)
for (const [k, n] of [...by].sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(n, k)
if (process.argv.includes('--list')) for (const i of issues.slice(0, 40)) console.log(JSON.stringify(i))
