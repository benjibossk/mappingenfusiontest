// Ground surface shares (% of land, dominant weight per cell) of a "map from an image" (headless), with the
// auto forests of a picture without forest colour, vs Arland (FIELDS_SURFACES_VANILLA §1).
// npx tsx scripts/bench/image-surfaces.ts <raw RGBA> <width> <height> <size m>
import { readFileSync } from 'node:fs'
import { clusterImage, guessRoles, imageToMap, squareHeights, IMAGE_FOREST_SHARE } from '../../src/modules/imageMap.ts'
import { heightsFromImage } from '../../src/modules/gaeaImport.ts'
import { carveWater, type Water } from '../../src/modules/water.ts'
import { computeSurfaces } from '../../src/modules/island.ts'
import { rasterCover } from '../../src/modules/cover.ts'
import { generateForests } from '../../src/modules/forestgen.ts'

const [file, W, H, S] = process.argv.slice(2)
const q = clusterImage({ width: +W, height: +H, data: new Uint8Array(readFileSync(file)) })
const r = imageToMap(q, guessRoles(q), { size: +S })
const wd = heightsFromImage(squareHeights(r.heights), { size: Math.round(Math.max(r.sizeX, r.sizeZ)), minHeight: 0, maxHeight: 0 })
const g = { minX: 0, minZ: 0, step: wd.step, cols: wd.cols, rows: wd.rows }
const hs = Array.from(wd.heights)
const waters: Water[] = r.waters.map((x, i) => x.kind === 'river'
  ? { id: `R${i}`, type: 'river', pts: x.pts, width: x.width, depth: 1.5, carve: false, wetEdge: true }
  : { id: `L${i}`, type: 'lake', pts: x.pts, width: 0, depth: 2, level: 0 })
carveWater(hs, g, waters)
let hi = 0
for (const v of hs) hi = Math.max(hi, v)
const areas: { kind: 'forest' | 'field'; pts: number[]; holes?: number[][]; leaf?: string }[] = r.areas.map((a) => ({ kind: a.kind, pts: a.pts, holes: a.holes }))
if (!areas.some((a) => a.kind === 'forest')) {
  const made = generateForests(hs, g, { seed: 1, cover: 0.35, sites: r.buildings.map((b, i) => ({ id: `S${i}`, x: b.x, z: b.z, kind: 'hamlet' as const })), maxShare: IMAGE_FOREST_SHARE } as never)
  console.log(`auto forests: ${made.length}`)
  for (const f of made) areas.push({ kind: 'forest', leaf: f.leaf, pts: f.pts })
}
const surf = computeSurfaces(g, hs, Math.ceil(hi), undefined, rasterCover(g, areas as never))
const cnt = new Map<string, number>()
let land = 0
for (let i = 0; i < hs.length; i++) {
  if (hs[i] <= 0) continue
  land++
  let best = '', bw = -1
  for (const s of surf) if (s.weights[i] > bw) { bw = s.weights[i]; best = s.name }
  cnt.set(best, (cnt.get(best) ?? 0) + 1)
}
console.log(`max height ${hi.toFixed(0)} m, land ${(land / hs.length * 100).toFixed(0)} %`)
for (const [k, v] of [...cnt].sort((a, b) => b[1] - a[1])) console.log(`${k.padEnd(26)} ${(v / land * 100).toFixed(1)}`)
// mean weight (mixtures: a 20 % layer shows even where it never dominates)
console.log('--- mean weight % of land')
const mean = surf.map((s) => { let a = 0; for (let i = 0; i < hs.length; i++) if (hs[i] > 0) a += s.weights[i]; return [s.name, a / land * 100] as const })
for (const [k, v] of mean.sort((a, b) => b[1] - a[1])) if (v >= 0.1) console.log(`${k.padEnd(26)} ${v.toFixed(1)}`)
