// Mountain road probe: npx tsx scripts/bench/mountain-roads.ts [seed] [relief] [--dams] [--size N] [--list] [--browser]
// Same params as the web app's random-world dialog (appWorldParams); --dams = the Barrage box ticked.
// --browser: generate inside the app page (Vite on 127.0.0.1:5199, nothing sent to the bridge) = the world the app
// really makes; Node rounds Math.pow/sin/cos differently from Chromium, so its relief (and roads) are another map.
import '../../src/workers/shim'
import { mountainProbe } from './mountainStats'

const seed = Number(process.argv[2] ?? 21), relief = (process.argv[3] ?? 'mountains') as 'mountains'
const sz = process.argv.indexOf('--size'), list = process.argv.includes('--list')
const over = { relief, dams: process.argv.includes('--dams'), ...(sz > 0 ? { size: Number(process.argv[sz + 1]) } : {}) }
if (process.argv.includes('--browser')) {
  // playwright is not a repo dependency: PW_DIR=<folder holding node_modules/playwright> when it lives elsewhere
  const { createRequire } = await import('node:module')
  const req = createRequire((process.env.PW_DIR ?? process.cwd()).replace(/\\/g, '/') + '/x.js')
  const { chromium } = req('playwright') as { chromium: { launch(): Promise<any> } } // eslint-disable-line @typescript-eslint/no-explicit-any
  const b = await chromium.launch(), p = await b.newPage()
  await p.route('http://127.0.0.1:5780/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{}' }))
  if (process.env.PW_CONSOLE) p.on('console', (m: { text(): string }) => console.log('[page]', m.text()))
  await p.goto('http://127.0.0.1:5199/')
  const out = await p.evaluate(async ([s, o, l]) => (await (import('/scripts/bench/mountainStats.ts' as string) as Promise<typeof import('./mountainStats')>)).mountainProbe(s as number, o as never, l as boolean).then((r) => r.out), [seed, over, list] as const)
  console.log(out.join('\n')); await b.close(); process.exit(0)
}
const { out, w } = await mountainProbe(seed, over, list)
console.log(out.join('\n'))
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
