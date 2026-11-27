import { test } from 'node:test'
import assert from 'node:assert/strict'
import { liftRoadShape, ROAD_MESH_LIFT } from '../src/modules/roadSanitize'

// picture 120 cam 10: the village street mesh sat on the terrain at its points only and the ground rose through it
test('road generator splines are lifted over the ground at points no more than 5 m apart', () => {
  const sh = { id: 'R', kind: 'spline' as const, closed: false, points: [0, 0, 22, 0, 22, 9], generator: '{8E689EDC77E2A3DC}Prefabs/WEGenerators/Roads/Asphalt/RG_Road_Asphalt_E_01_Narrow.et' }
  const out = liftRoadShape(sh)
  assert.equal(out.lift!.length, out.points.length / 2)
  assert.ok(out.lift!.every((v) => v === ROAD_MESH_LIFT && v > 0 && v <= 0.3))
  for (let i = 2; i < out.points.length; i += 2) assert.ok(Math.hypot(out.points[i] - out.points[i - 2], out.points[i + 1] - out.points[i - 1]) <= 5.01)
  assert.deepEqual(out.points.slice(-2), [22, 9])
})

test('other shapes and already lifted roads are left alone', () => {
  const water = { id: 'W', kind: 'spline' as const, closed: false, points: [0, 0, 50, 0], generator: '{X}Prefabs/WEGenerators/Water/River.et' }
  assert.equal(liftRoadShape(water), water)
  const lifted = { id: 'B', kind: 'spline' as const, closed: false, points: [0, 0, 50, 0], lift: [2, 2], generator: '{X}Prefabs/WEGenerators/Roads/Asphalt/RG_Road_Asphalt_E_01.et' }
  assert.equal(liftRoadShape(lifted), lifted)
})
