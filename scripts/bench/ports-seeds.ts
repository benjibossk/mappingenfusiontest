// Ports per generated world: npx tsx scripts/bench/ports-seeds.ts 1 2 3 ...
import '../../src/workers/shim'
import { generateWorld, WORLD_DEFAULTS } from '../../src/modules/worldgen'
import { summarise } from '../../src/workers/seedSummary'
for (const s of process.argv.slice(2).map(Number)) {
  const w = await generateWorld({ ...WORLD_DEFAULTS, seed: s, vanillaSites: true, villageTemplates: true } as never)
  const subs = w.zones.filter((z) => /port/.test(z.sub ?? '')).map((z) => z.sub + ' ' + (z.warnings ?? []).join(';'))
  console.log(s, 'ports', summarise(w, 16).stats.ports, JSON.stringify(subs))
}
