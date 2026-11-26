// Power grid of a "map from an image" (headless): poles inside / near a building footprint (oriented box) and on
// a road carriageway, as the Workbench audit pole-in-bldg / on-road would flag them.
// npx tsx scripts/bench/image-power.ts <raw RGBA> <width> <height> <size m> [margin m]
import { readFileSync } from 'node:fs'
import { clusterImage, guessRoles, imageToMap, squareHeights, roadClass } from '../../src/modules/imageMap.ts'
import { heightsFromImage } from '../../src/modules/gaeaImport.ts'
import { planGrid, type GridSite } from '../../src/modules/powergrid.ts'
import { powerWorld } from '../../src/modules/worldpower.ts'
import { centreLine, roadHalf } from '../../src/modules/roads.ts'
import { SITE_RADIUS } from '../../src/modules/network.ts'

const [file, W, H, S, M] = process.argv.slice(2)
const margin = +(M ?? 1)
const q = clusterImage({ width: +W, height: +H, data: new Uint8Array(readFileSync(file)) })
const r = imageToMap(q, guessRoles(q), { size: +S })
const wd = heightsFromImage(squareHeights(r.heights), { size: Math.round(Math.max(r.sizeX, r.sizeZ)), minHeight: 0, maxHeight: 0 })
const g = { minX: 0, minZ: 0, step: wd.step, cols: wd.cols, rows: wd.rows }
const h = Array.from(wd.heights)
const ws = r.roads.filter((x) => x.kind === 'road').map((x) => x.width).sort((a, b) => a - b)
const median = ws.length ? ws[ws.length >> 1] : 1
const roads = r.roads.map((x, i) => ({ id: `R${i}`, type: roadClass(x.width, median, x.kind), pts: x.pts }))
// sites: buildings grouped within 120 m (hamlet < 8 houses <= village)
const groups: { x: number; z: number; n: number }[] = []
for (const b of r.buildings) {
  const gr = groups.find((p) => Math.hypot(p.x / p.n - b.x, p.z / p.n - b.z) < 120)
  if (gr) { gr.x += b.x; gr.z += b.z; gr.n++ } else groups.push({ x: b.x, z: b.z, n: 1 })
}
const sites: GridSite[] = groups.filter((p) => p.n >= 2).map((p, i) => { const kind = p.n >= 8 ? 'village' as const : 'hamlet' as const; return { id: `S${i}`, x: p.x / p.n, z: p.z / p.n, kind, r: SITE_RADIUS[kind] } })
const isWater = (x: number, z: number) => (h[Math.round(z / g.step) * g.cols + Math.round(x / g.step)] ?? 0) <= 0.3
const plan = planGrid({ heights: h, grid: g, sites, roads: roads.map((x) => x.pts), isWater, size: (g.cols - 1) * g.step, avoid: [], world: powerWorld(roads as never, r.buildings.map((b) => b.corners), [], []) }, {})
// oriented box test with margin: corners are a rectangle (4 points)
const inBox = (c: number[], x: number, z: number, m: number) => {
  const ux = c[2] - c[0], uz = c[3] - c[1], vx = c[6] - c[0], vz = c[7] - c[1]
  const lu = Math.hypot(ux, uz), lv = Math.hypot(vx, vz)
  const pu = ((x - c[0]) * ux + (z - c[1]) * uz) / lu, pv = ((x - c[0]) * vx + (z - c[1]) * vz) / lv
  return pu > -m && pu < lu + m && pv > -m && pv < lv + m
}
const lines = roads.map((x) => ({ half: roadHalf(x as never), line: centreLine(x.pts, 4) }))
const onRoad = (x: number, z: number) => lines.some((l) => { for (let i = 0; i + 1 < l.line.length; i += 2) if (Math.hypot(l.line[i] - x, l.line[i + 1] - z) < l.half) return true; return false })
let poles = 0, inB = 0, nearB = 0, road = 0
const ex: string[] = []
for (const l of plan.lines) for (let i = 0; i + 1 < l.poles.length; i += 2) {
  const x = l.poles[i], z = l.poles[i + 1]
  poles++
  if (r.buildings.some((b) => inBox(b.corners, x, z, 0))) { inB++; if (ex.length < 8) ex.push(`${l.id} pole ${i / 2} (${x.toFixed(0)}, ${z.toFixed(0)}) in building`) }
  else if (r.buildings.some((b) => inBox(b.corners, x, z, margin))) nearB++
  if (onRoad(x, z)) { road++; if (ex.length < 8) ex.push(`${l.id} pole ${i / 2} (${x.toFixed(0)}, ${z.toFixed(0)}) on road`) }
}
console.log(`sites ${sites.length}, buildings ${r.buildings.length}, lines ${plan.lines.length}, poles ${poles}: in a building ${inB}, within ${margin} m ${nearB}, on a road ${road}`)
console.log(ex.join('\n'))
