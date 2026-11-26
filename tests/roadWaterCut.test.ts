import { test } from 'node:test'
import assert from 'node:assert/strict'
import { splitAtWater, type Water } from '../src/modules/water'

const river: Water = { id: 'R', type: 'river', pts: [0, 500, 500, 500, 1000, 500], width: 40, widths: [40, 120, 40], depth: 2.5, carve: false, wetEdge: true }

test('splitAtWater: a road leg hopping over a river (both vertices dry) is cut, with a gap for the bridge', () => {
  const road = { id: 'ROAD_1', kind: 'spline' as const, closed: false, points: [100, 300, 100, 700] }
  const { gaps, shapes } = splitAtWater([road as never], [river])
  assert.equal(gaps.length, 1)
  assert.equal(shapes.length, 2)
})

test('splitAtWater: a picture river is wet to its local traced width, not only its median', () => {
  const road = { id: 'ROAD_2', kind: 'spline' as const, closed: false, points: [500, 300, 500, 400, 500, 445, 500, 555, 500, 600, 500, 700] }
  const { gaps } = splitAtWater([road as never], [river])
  assert.equal(gaps.length, 1)
  const L = Math.hypot(gaps[0].to[0] - gaps[0].from[0], gaps[0].to[1] - gaps[0].from[1])
  assert.ok(L > 110, String(L))
})

test('splitAtWater: a dry road keeps its own vertices', () => {
  const road = { id: 'ROAD_3', kind: 'spline' as const, closed: false, points: [100, 100, 400, 100, 400, 300] }
  const { shapes } = splitAtWater([road as never], [river])
  assert.deepEqual(shapes[0].points, road.points)
})
