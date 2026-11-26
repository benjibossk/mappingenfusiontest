// Cross-section of the widest traced river of a picture map after carveWater (as main.ts applyImageMap does):
// wet width (river surface) vs ground under the sea level (0 m, flooded by the game sea) vs traced width.
// npx tsx scripts/bench/image-river.ts <raw RGBA> <width> <height> <size m>
import { readFileSync } from 'node:fs'
import { clusterImage, guessRoles, imageToMap, squareHeights } from '../../src/modules/imageMap.ts'
import { heightsFromImage } from '../../src/modules/gaeaImport.ts'
import { carveWater, type Water, PICTURE_RIVER_DEPTH } from '../../src/modules/water.ts'

const [file, W, H, S] = process.argv.slice(2)
const q = clusterImage({ width: +W, height: +H, data: new Uint8Array(readFileSync(file)) })
const r = imageToMap(q, guessRoles(q), { size: +S })
const wd = heightsFromImage(squareHeights(r.heights), { size: Math.round(Math.max(r.sizeX, r.sizeZ)), minHeight: 0, maxHeight: 0 })
const g = { minX: 0, minZ: 0, step: wd.step, cols: wd.cols, rows: wd.rows }
const hs = wd.heights.slice()
const waters: Water[] = r.waters.map((x, i) => x.kind === 'river'
  ? { id: `R${i}`, type: 'river', pts: x.pts, width: x.width, depth: PICTURE_RIVER_DEPTH, carve: false, wetEdge: true }
  : { id: `L${i}`, type: 'lake', pts: x.pts, width: 0, depth: 2, level: 0 })
const lv = carveWater(hs, g, waters)
const at = (x: number, z: number) => hs[Math.round(z / g.step) * g.cols + Math.round(x / g.step)]
const rivers = r.waters.filter((x) => x.kind === 'river').sort((a, b) => b.pts.length - a.pts.length)
for (const rv of rivers.slice(0, 2)) {
  const i = (rv.pts.length >> 2) * 2, x = rv.pts[i], z = rv.pts[i + 1]
  const tx = rv.pts[i + 2] - rv.pts[i - 2], tz = rv.pts[i + 3] - rv.pts[i - 1], L = Math.hypot(tx, tz) || 1
  const nx = -tz / L, nz = tx / L
  const row: string[] = []
  let under0 = 0, wet = 0
  for (let d = -80; d <= 80; d += 2) {
    const px = x + nx * d, pz = z + nz * d, v = at(px, pz), k = Math.round(pz / g.step) * g.cols + Math.round(px / g.step)
    if (v < 0) under0 += 2
    if (lv.wet[k]) wet += 2
    if (d % 8 === 0) row.push(v.toFixed(1))
  }
  const k = Math.round(z / g.step) * g.cols + Math.round(x / g.step)
  console.log(`river at (${x.toFixed(0)}, ${z.toFixed(0)}): traced ${rv.width} m, wet ${wet} m, ground < 0 m over ${under0} m, water level ${lv.level[k]?.toFixed(2)} m`)
  console.log(`  heights -80..80 m step 8: ${row.join(' ')}`)
}
