// Gameplay bench: open ground, approach cover around settlements, summit viewshed (scripts/bench/gameplayMetrics.ts),
// measured the same way on a vanilla refmap and on a generated world. See PakTools/analyses/GAMEPLAY_MAPPING.md.
//   npx tsx scripts/bench/gameplay.ts [seed=42] [size=4096] [--ref everon|arland|kolguyev] [--json out.json] [--vanilla-only]
import '../../src/workers/shim'
import { readFileSync, writeFileSync } from 'node:fs'
import { refHeights, type RefMap } from '../../src/modules/refMap'
import { gameplayReport, GAMEPLAY_NOT_BUILDING as NOT_BUILDING } from '../../src/modules/gameplay'

const args = process.argv.slice(2)
const pos = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')))
const opt = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined }
const seed = Number(pos[0] ?? 42), size = Number(pos[1] ?? 4096), refId = opt('--ref') ?? 'everon'
const brief = (r: ReturnType<typeof gameplayReport>) => ({ score: r.score, sub: Object.fromEntries(Object.entries(r.sub).map(([k, v]) => [k, `${v.value} -> ${v.score}`])),
  settlements: r.settlements, open: r.open, approach: r.approach, viewshed: r.viewshed, spots: { exposed: r.spots.filter((q) => q.kind === 'exposed').length, bare: r.spots.filter((q) => q.kind === 'bare').length } })
const t0 = Date.now()
const ref: RefMap = JSON.parse(readFileSync(new URL(`../../public/refmaps/${refId}.json`, import.meta.url), 'utf8'))
const hb = ref.heights!
const vHouses = ref.buildings.items.filter((b) => !NOT_BUILDING.test(ref.buildings.prefabs[b[0]])).map(([, x, z]) => ({ x, z }))
const vanilla = brief(gameplayReport({ heights: refHeights(hb), grid: { step: hb.step, cols: hb.cols, rows: hb.rows, minX: ref.minX, minZ: ref.minZ }, forests: ref.forests ?? [], houses: vHouses }))

let ours: ReturnType<typeof brief> | undefined
if (!args.includes('--vanilla-only')) {
  const { generateWorld, WORLD_DEFAULTS } = await import('../../src/modules/worldgen')
  const w = await generateWorld({ ...WORLD_DEFAULTS, seed, size, vanillaSites: true, villageTemplates: true } as never) as never as {
    grid: { step: number; cols: number; rows: number; minX: number; minZ: number }; heights: number[]
    areas: { kind: string; pts: number[] }[]; settlement: { placed: { x: number; z: number }[] }
  }
  ours = brief(gameplayReport({ heights: w.heights, grid: w.grid, forests: w.areas.filter((a) => a.kind === 'forest'), houses: w.settlement.placed }))
}
const report = { ref: refId, seed, size, sec: (Date.now() - t0) / 1000, vanilla, ours }
console.log(JSON.stringify(report, null, 1))
if (opt('--json')) writeFileSync(opt('--json')!, JSON.stringify(report, null, 1))
