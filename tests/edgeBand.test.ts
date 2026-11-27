import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyIslandCoast, coastRect, cutLineAtSea, keepOnIsland } from '../src/modules/edgeBand.ts'
import { Sculpt } from '../src/modules/sculpt.ts'
import { computeSurfaces } from '../src/modules/island.ts'

const cols = 129, step = 20 // 2560 m map
const plateau = (h = 60) => Array.from({ length: cols * cols }, () => h)

test('picture map coast: edge under the sea, centre untouched, land falls to a ~1 m beach', () => {
  const h = applyIslandCoast(plateau(), cols, cols, step, 7, 30)
  for (let k = 0; k < cols; k++) assert.ok(h[k] < -10 && h[k * cols] < -10 && h[(cols - 1) * cols + k] < -10, 'map edge under the sea')
  assert.equal(h[64 * cols + 64], 60)
  // along a row: monotonic-ish fall, and a low beach (0-3 m) just before the sea
  let beach = 0
  for (let r = 10; r < cols - 10; r += 4) for (let c = 1; c < 40; c++) { const a = h[r * cols + c], b = h[r * cols + c + 1]; if (a < 0 && b >= 0 && b <= 3) beach++ }
  assert.ok(beach > 10, `beach cells at the shoreline ${beach}`)
})

test('the coast is no straight line: shore distance varies along a side, corners rounded', () => {
  const h = applyIslandCoast(plateau(), cols, cols, step, 7, 30)
  const shore: number[] = []
  for (let r = 30; r < cols - 30; r++) { let c = 0; while (c < cols && h[r * cols + c] < 0) c++; shore.push(c * step) }
  assert.ok(Math.max(...shore) - Math.min(...shore) >= 60, `shore ${Math.min(...shore)}-${Math.max(...shore)} m`)
  let d = 0; while (h[d * cols + d] < 0) d++
  assert.ok(d * Math.SQRT2 * step > Math.min(...shore) * 1.3, 'rounded corner further in than the sides')
})

test('Sculpt: islandCoast only for picture maps, others keep the 6 % ramp', () => {
  const a = new Sculpt(cols, step, 120, 5, plateau()); a.islandCoast = true; a.compose()
  const b = new Sculpt(cols, step, 120, 5, plateau())
  const x = 12 * cols + 64 // 240 m from the north edge
  assert.ok(a.heights[x] < b.heights[x] - 20, `${a.heights[x]} vs ${b.heights[x]}`)
  assert.ok(a.heights[0] < 0 && b.heights[0] < 0)
})

test('gentle island coast gets a beach; a steep shore gets rock', () => {
  const g = computeSurfaces({ minX: 0, minZ: 0, step, cols, rows: cols }, applyIslandCoast(plateau(6), cols, cols, step, 7, 30), 40)
  const sum = (s: ReturnType<typeof computeSurfaces>, n: string) => { const q = s.find((x) => x.name === n); return q ? q.weights.reduce((a, b) => a + b, 0) : 0 }
  assert.ok(sum(g, 'BeachGrass_01') + sum(g, 'Dirt_02') > 20, 'beach along the gentle coast')
  const steep: number[] = []
  for (let r = 0; r < cols; r++) for (let c = 0; c < cols; c++) { const d = Math.min(c, r, cols - 1 - c, cols - 1 - r); steep.push(d < 3 ? -18 : d < 5 ? -18 + (d - 2) * 40 : 62) }
  assert.ok(sum(computeSurfaces({ minX: 0, minZ: 0, step, cols, rows: cols }, steep, 80), 'Rock_01') > 5)
})

test('roads stop on the shore, objects in the sea dropped, areas kept in, water and inland roads kept', () => {
  const sea = (x: number, z: number) => z > 2300 // sea north of z 2300
  const R = coastRect(0, 0, 2560)
  const p = keepOnIsland({ version: 0, shapes: [
    { id: 'ROAD_1', kind: 'spline', closed: false, points: [1280, 1280, 1280, 2560], generator: 'road' },
    { id: 'ROAD_2', kind: 'spline', closed: false, points: [1000, 1000, 1500, 1200], generator: 'road' },
    { id: 'FOREST_1', kind: 'polyline', closed: true, points: [2000, 1000, 2560, 1000, 2560, 1400, 2000, 1400], generator: 'forest' },
    { id: 'WATER_RIVER_1', kind: 'spline', closed: false, points: [1000, 1000, 1000, 2560], generator: '{X}Prefabs/WEGenerators/Water/River/R.et' },
  ], entities: [{ id: 'E1', prefab: 'p', x: 1280, z: 1280, yaw: 0 }, { id: 'E2', prefab: 'p', x: 1280, z: 2400, yaw: 0 }] }, sea, R)
  const road = p.shapes.find((s) => s.id === 'ROAD_1')!
  assert.ok(road.points[road.points.length - 1] <= 2300 && road.points[road.points.length - 1] > 2290, 'road ends at the shore')
  assert.deepEqual(p.shapes.find((s) => s.id === 'ROAD_2')!.points, [1000, 1000, 1500, 1200])
  const f = p.shapes.find((s) => s.id === 'FOREST_1')!
  for (let i = 0; i < f.points.length; i += 2) assert.ok(f.points[i] <= R[2] + 1e-6)
  assert.ok(p.shapes.some((s) => s.id === 'WATER_RIVER_1'))
  assert.deepEqual(p.entities!.map((e) => e.id), ['E1'])
  assert.equal(cutLineAtSea([0, 2400, 100, 2400], sea).length, 0)
})
