import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sanitizeRoad, sanitizeRoadShape, isRoadGenerator } from '../../src/modules/roadSanitize.ts'

const DIRT = '{8E83BBD5CEC42A11}Prefabs/WEGenerators/Roads/Dirt/RG_Road_Dirt_01.et'

test('drops duplicates and near points, keeps endpoints', () => {
  const r = sanitizeRoad([0, 0, 0, 0, 0.5, 0, 10, 0, 10.3, 0, 20, 0, 20.4, 0], 6)
  assert.deepEqual(r.slice(0, 2), [0, 0]); assert.deepEqual(r.slice(-2), [20.4, 0])
  for (let k = 2; k < r.length; k += 2) assert.ok(Math.hypot(r[k] - r[k - 2], r[k + 1] - r[k - 1]) >= 3)
})

test('removes backtracking point', () => {
  const r = sanitizeRoad([0, 0, 20, 0, 10, 1, 30, 0], 6)
  assert.equal(r.length / 2, 3)
})

test('limits curvature to radius >= width', () => {
  const r = sanitizeRoad([0, 0, 10, 0, 13, 4, 13, 20], 8)
  assert.ok(!r.some((v, k) => k % 2 === 0 && v === 10 && r[k + 1] === 0) || !r.includes(4))
  assert.deepEqual(r.slice(-2), [13, 20])
})

test('polyline road shape becomes spline; non-road untouched', () => {
  assert.ok(isRoadGenerator(DIRT))
  const s = sanitizeRoadShape({ id: 'a', kind: 'polyline', closed: false, points: [0, 0, 50, 0], generator: DIRT })
  assert.equal(s.kind, 'spline')
  const f = { id: 'b', kind: 'polyline' as const, closed: false, points: [0, 0, 1, 0], generator: '{X}Prefabs/WEGenerators/Fences/F.et' }
  assert.equal(sanitizeRoadShape(f), f)
})
