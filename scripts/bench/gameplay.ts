// Gameplay bench: open ground, approach cover around settlements, summit viewshed (scripts/bench/gameplayMetrics.ts),
// measured the same way on a vanilla refmap and on a generated world. See PakTools/analyses/GAMEPLAY_MAPPING.md.
//   npx tsx scripts/bench/gameplay.ts [seed=42] [size=4096] [--ref everon|arland|kolguyev] [--json out.json] [--vanilla-only]
import '../../src/workers/shim'
import { readFileSync, writeFileSync } from 'node:fs'
import { refHeights, type RefMap } from '../../src/modules/refMap'
import { openGround, approachCover, summitViewshed, fillPolygon, stampPoints, type CoverMap } from './gameplayMetrics'

const args = process.argv.slice(2)
const pos = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')))
const opt = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined }
const seed = Number(pos[0] ?? 42), size = Number(pos[1] ?? 4096), refId = opt('--ref') ?? 'everon'
const NOT_BUILDING = /Grave|Calvary|Castle|Fence|Wall|Monument|Statue|Ruin/i
const HOUSE_COVER = 12 // m: a house covers its yard (walls, sheds, hedges around it)

/** settlements = single-link clusters (45 m) of >= 8 buildings, centroid */
function settlements(pts: { x: number; z: number }[], link = 45, min = 8) {
  const cell = new Map<string, number[]>(), key = (x: number, z: number) => `${Math.floor(x / link)},${Math.floor(z / link)}`
  pts.forEach((p, i) => { const k = key(p.x, p.z); (cell.get(k) ?? cell.set(k, []).get(k)!).push(i) })
  const lab = new Int32Array(pts.length).fill(-1), out: { x: number; z: number; n: number }[] = []
  for (let i = 0; i < pts.length; i++) {
    if (lab[i] >= 0) continue
    const c = [i]; lab[i] = 1
    for (let t = 0; t < c.length; t++) {
      const p = pts[c[t]], cx = Math.floor(p.x / link), cz = Math.floor(p.z / link)
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) for (const j of cell.get(`${cx + dx},${cz + dz}`) ?? [])
        if (lab[j] < 0 && Math.hypot(pts[j].x - p.x, pts[j].z - p.z) < link) { lab[j] = 1; c.push(j) }
    }
    if (c.length >= min) out.push({ x: c.reduce((a, j) => a + pts[j].x, 0) / c.length, z: c.reduce((a, j) => a + pts[j].z, 0) / c.length, n: c.length })
  }
  return out
}

function measure(h: ArrayLike<number>, grid: { step: number; cols: number; rows: number; minX: number; minZ: number }, forests: { pts: number[]; holes?: number[][] }[], houses: { x: number; z: number }[]) {
  const n = grid.cols * grid.rows, land = new Uint8Array(n), cover = new Uint8Array(n)
  for (let i = 0; i < n; i++) land[i] = h[i] > 0 ? 1 : 0
  for (const f of forests) { fillPolygon(grid, cover, f.pts, 1); for (const hole of f.holes ?? []) fillPolygon(grid, cover, hole, 0) }
  stampPoints(grid, cover, houses, HOUSE_COVER)
  for (let i = 0; i < n; i++) if (!land[i]) cover[i] = 0
  const m: CoverMap = { ...grid, land, cover }
  const objs = settlements(houses)
  return { landKm2: +(land.reduce((a, b) => a + b, 0) * grid.step * grid.step / 1e6).toFixed(1), settlements: objs.length,
    open: openGround(m), approach: approachCover(m, objs), viewshed: summitViewshed(h, m) }
}

const t0 = Date.now()
const ref: RefMap = JSON.parse(readFileSync(new URL(`../../public/refmaps/${refId}.json`, import.meta.url), 'utf8'))
const hb = ref.heights!
const vHouses = ref.buildings.items.filter((b) => !NOT_BUILDING.test(ref.buildings.prefabs[b[0]])).map(([, x, z]) => ({ x, z }))
const vanilla = measure(refHeights(hb), { step: hb.step, cols: hb.cols, rows: hb.rows, minX: ref.minX, minZ: ref.minZ }, ref.forests ?? [], vHouses)

let ours: ReturnType<typeof measure> | undefined
if (!args.includes('--vanilla-only')) {
  const { generateWorld, WORLD_DEFAULTS } = await import('../../src/modules/worldgen')
  const w = await generateWorld({ ...WORLD_DEFAULTS, seed, size, vanillaSites: true, villageTemplates: true } as never) as never as {
    grid: { step: number; cols: number; rows: number; minX: number; minZ: number }; heights: number[]
    areas: { kind: string; pts: number[] }[]; settlement: { placed: { x: number; z: number }[] }
  }
  ours = measure(w.heights, w.grid, w.areas.filter((a) => a.kind === 'forest'), w.settlement.placed)
}
const report = { ref: refId, seed, size, sec: (Date.now() - t0) / 1000, vanilla, ours }
console.log(JSON.stringify(report, null, 1))
if (opt('--json')) writeFileSync(opt('--json')!, JSON.stringify(report, null, 1))
