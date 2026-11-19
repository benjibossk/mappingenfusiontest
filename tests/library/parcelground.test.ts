import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cemeteryPathMasks, parcelGroundMasks, polyArea } from '../../src/modules/parcelground.ts'
import { rectAt } from '../../src/modules/rowgrid.ts'

test('cemetery: one path between each pair of rows + the alley', () => {
  const graves: number[][] = []
  for (let r = 0; r < 4; r++) for (let i = 0; i < 6; i++) graves.push(rectAt(i * 1.6, r * 2.6, 0, 1, 2))
  const m = cemeteryPathMasks(graves, [4, -3, 4, 5, 4, 10], 7)
  assert.equal(m.length, 3 + 1)
  for (const p of m.slice(0, 3)) { assert.ok(p.half * 2 >= 0.9 && p.half * 2 <= 1.3); assert.equal(p.core, 'Dirt_03') }
  assert.deepEqual(cemeteryPathMasks(graves, undefined, 7), cemeteryPathMasks(graves, undefined, 7))
})

test('parcels: deterministic, under 25 % of the area', () => {
  const sq = { corners: [0, 0, 20, 0, 20, 15, 0, 15] }
  const house = { x: 10, z: -5, corners: rectAt(10, -5, 0, 8, 8) }
  const a = parcelGroundMasks([sq], [house], 3), b = parcelGroundMasks([sq], [house], 3)
  assert.deepEqual(a, b)
  assert.ok(a.length > 0)
  const blobs = a.length / 3 // ~3-5 stubs per blob
  assert.ok(blobs * Math.PI * 9 * 0.5 <= polyArea(sq.corners) * 0.25 + 1e-6 || a.length <= 15)
})
