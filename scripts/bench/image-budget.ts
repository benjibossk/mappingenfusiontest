// Object budget of a "map from an image": what the Workbench will hold after a send (headless, no Workbench).
// npx tsx scripts/bench/image-budget.ts <raw RGBA file> <width> <height> <size m>
// The forest count is an estimate: ForestGenerator output = forest area x vanilla density (cores ~300 trees/ha,
// 24 m edges ~half); hedges ~1 plant / 3 m.
import { readFileSync } from 'node:fs'
import { clusterImage, guessRoles, imageToMap, squareHeights } from '../../src/modules/imageMap.ts'
import { heightsFromImage } from '../../src/modules/gaeaImport.ts'
import { generateForests } from '../../src/modules/forestgen.ts'
import { IMAGE_FOREST_SHARE } from '../../src/modules/imageMap.ts'

const [file, W, H, S] = process.argv.slice(2)
const img = { width: +W, height: +H, data: new Uint8Array(readFileSync(file)) }
const q = clusterImage(img)
const r = imageToMap(q, guessRoles(q), { size: +S })
const hm = squareHeights(r.heights)
const w = heightsFromImage(hm, { size: Math.round(Math.max(r.sizeX, r.sizeZ)), minHeight: 0, maxHeight: 0 })
const grid = { minX: w.minX, minZ: w.minZ, step: w.step, cols: w.cols, rows: w.rows }
const area = (p: number[]) => { let a = 0; for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) a += (p[j] - p[i]) * (p[j + 1] + p[i + 1]); return Math.abs(a) / 2 }
const perim = (p: number[]) => { let l = 0; for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) l += Math.hypot(p[i] - p[j], p[i + 1] - p[j + 1]); return l }
const sites = r.buildings.map((b, i) => ({ id: `S${i}`, x: b.x, z: b.z, kind: 'hamlet' as const }))
const mapHa = (r.sizeX * r.sizeZ) / 1e4
const trees = (fs: number[][]) => {
  let n = 0, ha = 0
  for (const p of fs) { const a = area(p) / 1e4, edge = Math.min(a, (perim(p) * 24) / 1e4); ha += a; n += (a - edge) * 300 + edge * 150 }
  return { ha, n: Math.round(n) }
}
const drawn = r.areas.filter((a) => a.kind === 'forest').map((a) => a.pts)
const report = (label: string, cover: number, maxShare?: number) => {
  const gen = drawn.length ? [] : generateForests(w.heights, grid, { seed: 1, cover, sites, maxShare }).map((f) => f.pts)
  const t = trees([...drawn, ...gen])
  const hedgeM = r.hedges.reduce((s, h) => s + perim(h) / 2, 0)
  const hedge = Math.round(hedgeM / 3)
  console.log(`${label}: forests ${drawn.length + gen.length} (${t.ha.toFixed(1)} ha = ${((100 * t.ha) / mapHa).toFixed(1)} %) ~${t.n} trees | hedges ${Math.round(hedgeM)} m ~${hedge} | buildings ${r.buildings.length} | total ~${t.n + hedge + r.buildings.length}`)
}
console.log(`${file} ${S} m, ${mapHa.toFixed(0)} ha`)
report('before (cover 0.35)', 0.35)
report(`after  (cap ${IMAGE_FOREST_SHARE * 100} %)`, 0.35, IMAGE_FOREST_SHARE)
