import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyEdgeBand, clipLineToRect, contentRect, edgeBandWidth, keepOffEdgeBand, EDGE_FLOOR, EDGE_BAND_MIN, EDGE_BAND_MAX } from '../src/modules/edgeBand.ts'
import { Sculpt } from '../src/modules/sculpt.ts'
import { computeSurfaces } from '../src/modules/island.ts'

const cols = 129, step = 20 // 2560 m map
const plateau = () => Array.from({ length: cols * cols }, () => 60)

test('edge band width scales with the map and stays in 150-300 m', () => {
  assert.equal(edgeBandWidth(1000), EDGE_BAND_MIN)
  assert.equal(edgeBandWidth(2500), 250)
  assert.equal(edgeBandWidth(8000), EDGE_BAND_MAX)
})

test('edge heights under the sea, smooth fall (no wall), inland untouched', () => {
  const h = applyEdgeBand(plateau(), cols, cols, step, 3)
  for (let k = 0; k < cols; k++) {
    assert.ok(h[k] <= EDGE_FLOOR + 1e-9 && h[k * cols] <= EDGE_FLOOR + 1e-9, 'map edge under the sea')
    assert.ok(h[(cols - 1) * cols + k] < -10)
  }
  assert.equal(h[64 * cols + 64], 60)
  // steepest step between neighbours (20 m apart) along a row: 78 m over a >= 175 m band, smoothstep max 1.5x mean
  let worst = 0
  for (let r = 0; r < cols; r += 8) for (let c = 0; c + 1 < cols; c++) worst = Math.max(worst, Math.abs(h[r * cols + c + 1] - h[r * cols + c]) / step)
  assert.ok(worst < 0.75, `max slope ${worst.toFixed(2)} m/m`)
})

test('the shore wobbles: coast distance to the edge varies along the side', () => {
  const h = applyEdgeBand(plateau(), cols, cols, step, 3)
  const coast: number[] = []
  for (let r = 10; r < cols - 10; r++) { let c = 0; while (c < cols && h[r * cols + c] < 0) c++; coast.push(c * step) }
  assert.ok(Math.max(...coast) - Math.min(...coast) >= 20, `coast ${Math.min(...coast)}-${Math.max(...coast)} m`)
})

test('Sculpt.compose: every map ends in the sea through the band', () => {
  const s = new Sculpt(cols, step, 120, 5, plateau())
  assert.ok(s.heights[0] < -10 && s.heights[64] < -10 && s.heights[64 * cols + cols - 1] < -10)
  assert.ok(s.heights[64 * cols + 64] > 40)
})

test('gentle edge shore gets a beach, a steep one rock and no beach', () => {
  const gentle = applyEdgeBand(Array.from({ length: cols * cols }, () => 6), cols, cols, step, 3)
  const g = computeSurfaces({ minX: 0, minZ: 0, step, cols, rows: cols }, gentle, 40)
  const sum = (s: ReturnType<typeof computeSurfaces>, n: string) => { const q = s.find((x) => x.name === n); return q ? q.weights.reduce((a, b) => a + b, 0) : 0 }
  assert.ok(sum(g, 'BeachGrass_01') + sum(g, 'Dirt_02') > 20, 'beach along the gentle shore')
  const steep: number[] = []
  for (let r = 0; r < cols; r++) for (let c = 0; c < cols; c++) { const d = Math.min(c, r, cols - 1 - c, cols - 1 - r); steep.push(d < 3 ? -18 : d < 5 ? -18 + (d - 2) * 40 : 62) }
  const s = computeSurfaces({ minX: 0, minZ: 0, step, cols, rows: cols }, steep, 80)
  assert.ok(sum(s, 'Rock_01') > 5, `rock on the cliff ${sum(s, 'Rock_01')}`)
})

test('no road, area or object in the band; roads stop at the band; water kept', () => {
  const R = contentRect(0, 0, 2560)
  const p = keepOffEdgeBand({ version: 0, shapes: [
    { id: 'ROAD_1', kind: 'spline', closed: false, points: [1280, 1280, 1280, 2560], generator: 'road' },
    { id: 'FOREST_1', kind: 'polyline', closed: true, points: [2000, 1000, 2560, 1000, 2560, 1400, 2000, 1400], generator: 'forest' },
    { id: 'FOREST_2', kind: 'polyline', closed: true, points: [2400, 0, 2560, 0, 2560, 100], generator: 'forest' },
    { id: 'WATER_RIVER_1', kind: 'spline', closed: false, points: [1000, 1000, 0, 1000], generator: '{X}Prefabs/WEGenerators/Water/River/R.et' },
  ], entities: [{ id: 'E1', prefab: 'p', x: 1280, z: 1280, yaw: 0 }, { id: 'E2', prefab: 'p', x: 50, z: 1280, yaw: 0 }] }, R)
  const ids = p.shapes.map((s) => s.id)
  assert.deepEqual(ids.sort(), ['FOREST_1', 'ROAD_1', 'WATER_RIVER_1'])
  for (const s of p.shapes.filter((q) => !q.id.startsWith('WATER_'))) for (let i = 0; i < s.points.length; i += 2)
    assert.ok(s.points[i] >= R[0] - 1e-6 && s.points[i] <= R[2] + 1e-6 && s.points[i + 1] >= R[1] - 1e-6 && s.points[i + 1] <= R[3] + 1e-6)
  assert.ok(Math.abs(p.shapes.find((s) => s.id === 'ROAD_1')!.points[3] - R[3]) < 1e-6, 'road ends at the band')
  assert.deepEqual(p.entities!.map((e) => e.id), ['E1'])
  assert.equal(clipLineToRect([0, 0, 10, 0], R).length, 0)
})
