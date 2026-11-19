// Building pads (pads.ts) and road junction grading (roads.ts carveRoads / junctionGrade), seed 21
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildingFootprints, generateWorld, WORLD_DEFAULTS, type WorldResult } from '../../src/modules/worldgen.ts'
import { carveRoads, centreLine, roadHalf, type Road } from '../../src/modules/roads.ts'
import { ROAD_CLASSES, classOf } from '../../src/modules/roadgraph-classes.ts'
import type { Grid } from '../../src/modules/island.ts'

const at = (h: ArrayLike<number>, g: Grid, x: number, z: number) => {
  const gx = Math.min(Math.max((x - g.minX) / g.step, 0), g.cols - 1.001), gz = Math.min(Math.max((z - g.minZ) / g.step, 0), g.rows - 1.001)
  const c = Math.floor(gx), r = Math.floor(gz), fx = gx - c, fz = gz - r, i = r * g.cols + c
  const a = h[i] + (h[i + 1] - h[i]) * fx, b = h[i + g.cols] + (h[i + g.cols + 1] - h[i + g.cols]) * fx
  return a + (b - a) * fz
}
const segDist = (p: number[], x: number, z: number) => {
  let best = Infinity
  for (let i = 0; i + 3 < p.length; i += 2) {
    const ax = p[i], az = p[i + 1], dx = p[i + 2] - ax, dz = p[i + 3] - az, L2 = dx * dx + dz * dz || 1
    const t = Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / L2))
    best = Math.min(best, Math.hypot(x - ax - t * dx, z - az - t * dz))
  }
  return best
}

let world: WorldResult | undefined
const seed21 = async () => (world ??= await generateWorld({ ...WORLD_DEFAULTS, size: 4096, seed: 21 }))

test('seed 21: building pads flat (corner spread < 0.15 m) and banks < 30 deg', async () => {
  const w = await seed21()
  const g = w.grid, h = w.heights
  const foot = buildingFootprints(w.settlement.placed, w.zones)
  assert.ok(foot.length > 20, `buildings: ${foot.length}`)
  const roads = [...w.roads, ...w.zones.flatMap((z) => z.roads), ...w.settlement.lanes].filter((r) => r.pts.length >= 4)
  const nearRoad = (x: number, z: number, m: number) => roads.some((r) => segDist(r.pts, x, z) < roadHalf(r) + m)
  let worstSpread = 0, worstSlope = 0, checked = 0, worstAt = ''
  for (const c of foot) {
    const cx = (c[0] + c[2] + c[4] + c[6]) / 4, cz = (c[1] + c[3] + c[5] + c[7]) / 4
    // a road bed laid over the pad (a house at the kerb) has the last word: not the pad's ground any more
    // on a coarse grid the bed core (half x 1.15 + edge + 1 cell) can reach the nodes under the footprint
    if (nearRoad(cx, cz, Math.hypot(c[2] - c[0], c[3] - c[1], c[4] - c[2], c[5] - c[3]) / 2 + 3 * g.step + 2)) continue
    if (at(h, g, cx, cz) <= 0.5) continue // a pier / quay item over the water: no ground pad
    checked++
    const ys = [0, 2, 4, 6].map((k) => at(h, g, c[k], c[k + 1]))
    const sp = Math.max(...ys) - Math.min(...ys)
    worstSpread = Math.max(worstSpread, sp)
    // banks: grid slopes in the ring up to 12 m around the footprint
    const c0 = Math.floor((Math.min(c[0], c[2], c[4], c[6]) - 12 - g.minX) / g.step), c1 = Math.ceil((Math.max(c[0], c[2], c[4], c[6]) + 12 - g.minX) / g.step)
    const r0 = Math.floor((Math.min(c[1], c[3], c[5], c[7]) - 12 - g.minZ) / g.step), r1 = Math.ceil((Math.max(c[1], c[3], c[5], c[7]) + 12 - g.minZ) / g.step)
    for (let r = Math.max(0, r0); r < Math.min(g.rows - 1, r1); r++) for (let q = Math.max(0, c0); q < Math.min(g.cols - 1, c1); q++) {
      const k = r * g.cols + q
      if (Math.min(h[k], h[k + 1], h[k + g.cols]) <= 1) continue // shore cliffs of the island shaping
      const s = Math.max(Math.abs(h[k + 1] - h[k]), Math.abs(h[k + g.cols] - h[k])) / g.step
      if (s > Math.tan((30 * Math.PI) / 180) && nearRoad(g.minX + q * g.step, g.minZ + r * g.step, 12)) continue // road embankment
      if (s > worstSlope) { worstSlope = s; worstAt = `${q * g.step},${r * g.step} h ${h[k].toFixed(1)} ${h[k + 1].toFixed(1)} ${h[k + g.cols].toFixed(1)}` }
    }
  }
  const deg = (Math.atan(worstSlope) * 180) / Math.PI
  console.log('pads checked', checked, '/', foot.length, 'spread', worstSpread.toFixed(3), 'slope deg', deg.toFixed(1), worstAt)
  assert.ok(checked > 10)
  assert.ok(worstSpread < 0.15, `corner spread ${worstSpread}`)
  assert.ok(deg < 30, `bank slope ${deg}`)
})

test('seed 21: junction height step < 0.3 m between the two roads', async () => {
  const w = await seed21()
  const g = w.grid, h = w.heights
  const rank = (r: Road) => ROAD_CLASSES[classOf(r.type)].rank
  const rs = w.roads.filter((r) => r.pts.length >= 4 && r.flatten && !r.bridge && !r.spans?.length && !r.lift?.length)
  let worst = 0, n = 0
  for (const a of rs) for (const b of rs) {
    if (a === b || rank(a) < rank(b) || (rank(a) === rank(b) && a.id >= b.id)) continue
    const la = centreLine(a.pts, 2), lb = centreLine(b.pts, 2)
    // b's centre points on a's carriageway: b's height there vs a's centre line next to it
    for (let i = 0; i < lb.length; i += 2) {
      const x = lb[i], z = lb[i + 1]
      if (segDist(la, x, z) > roadHalf(a)) continue
      let bd = Infinity, bx = 0, bz = 0
      for (let j = 0; j < la.length; j += 2) { const d = Math.hypot(la[j] - x, la[j + 1] - z); if (d < bd) { bd = d; bx = la[j]; bz = la[j + 1] } }
      worst = Math.max(worst, Math.abs(at(h, g, x, z) - at(h, g, bx, bz)))
      n++
    }
  }
  console.log('junction samples', n, 'worst step', worst.toFixed(3))
  assert.ok(n > 0)
  assert.ok(worst < 0.3, `junction step ${worst}`)
})

test('crossing on a slope: the main road keeps its bed, the secondary is graded onto it', () => {
  const g: Grid = { minX: 0, minZ: 0, step: 2, cols: 201, rows: 201 } as Grid
  const base = Array.from({ length: g.cols * g.rows }, (_, k) => 20 + (k % g.cols) * 2 * 0.08 + Math.floor(k / g.cols) * 2 * 0.03)
  const main: Road = { id: 'M', type: ROAD_CLASSES.main.type, pts: [20, 200, 380, 200], flatten: true } as Road
  const sec: Road = { id: 'S', type: ROAD_CLASSES.track.type, pts: [200, 20, 200, 380], flatten: true } as Road
  const h = base.slice()
  carveRoads(h, g, [sec, main]) // the secondary first in the list: the order must not matter
  const hm = base.slice()
  carveRoads(hm, g, [main])
  // the main bed at the crossing is the one it has alone
  assert.ok(Math.abs(at(h, g, 200, 200) - at(hm, g, 200, 200)) < 0.05)
  // the secondary arrives level with the main road (no bump / dip)
  for (const d of [4, 6, 8]) assert.ok(Math.abs(at(h, g, 200, 200 + d) - at(h, g, 200, 200)) < 0.3, `step at ${d} m`)
})
