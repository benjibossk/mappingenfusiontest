// The dam crest road is a road spline like the others: AdjustHeightMap 0 (seed 21 live audit: a bare 2-point
// polyline let the road generator raise the whole crest 2.2 m above the sent terrain)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { damZone } from '../../src/modules/dam'

test('dam crest road: spline, AdjustHeightMap 0, points <= 20 m apart', () => {
  const d = { id: 'DAM_1', ax: 0, az: 0, bx: 150, bz: 0, cx: 75, cz: 0, nx: 0, nz: 1, bed: 0, crest: 20, level: 18, toe: 30, foot: [75, 30] }
  const z = damZone(d as never)
  const c = z.shapes.find((s) => s.id.endsWith('_CREST'))!
  assert.equal(c.kind, 'spline')
  assert.equal(c.paramValues?.[c.paramKeys!.indexOf('AdjustHeightMap')], '0')
  for (let i = 0; i + 3 < c.points.length; i += 2) assert.ok(Math.hypot(c.points[i + 2] - c.points[i], c.points[i + 3] - c.points[i + 1]) <= 20.01)
})
