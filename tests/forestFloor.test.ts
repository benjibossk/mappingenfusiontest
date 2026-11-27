import { test } from 'node:test'
import assert from 'node:assert/strict'
import { forestFloorAreas, flatArea } from '../src/modules/forestEdge.ts'

const sq = (x: number, z: number, s: number) => [x, z, x + s, z, x + s, z + s, x, z + s]
const inPoly = (p: number[], x: number, z: number) => {
  let ins = false
  for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) if ((p[i + 1] > z) !== (p[j + 1] > z) && x < ((p[j] - p[i]) * (z - p[i + 1])) / (p[j + 1] - p[i + 1]) + p[i]) ins = !ins
  return ins
}

test('large forest: floor = core inset by 25 m, edges stay grass', () => {
  const [f] = forestFloorAreas([{ id: 'A', pts: sq(0, 0, 400) }])
  assert.ok(f)
  assert.ok(Math.abs(flatArea(f.pts) - 350 * 350) < 350 * 350 * 0.02, `area ${flatArea(f.pts)}`)
  assert.ok(inPoly(f.pts, 200, 200))
  assert.ok(!inPoly(f.pts, 10, 200), 'edge 10 m in has no forest floor')
  assert.ok(inPoly(f.pts, 30, 200))
})

test('small grove / copse: no forest floor at all', () => {
  assert.equal(forestFloorAreas([{ id: 'B', pts: sq(0, 0, 120) }]).length, 0) // 1.44 ha
  assert.equal(forestFloorAreas([{ id: 'C', pts: sq(0, 0, 30) }]).length, 0)
})

test('floor never outside the forest (no forest floor without trees)', () => {
  const pts = [0, 0, 600, 0, 600, 200, 300, 200, 300, 500, 0, 500] // L shape
  for (const f of forestFloorAreas([{ id: 'L', pts }])) for (let i = 0; i < f.pts.length; i += 2) assert.ok(inPoly(pts, f.pts[i], f.pts[i + 1]))
})

test('thin belt wider than 2 ha but narrower than 2 insets: no floor', () => {
  assert.equal(forestFloorAreas([{ id: 'S', pts: [0, 0, 1000, 0, 1000, 40, 0, 40] }]).length, 0)
})
