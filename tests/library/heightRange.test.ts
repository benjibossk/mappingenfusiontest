import { test } from 'node:test'
import assert from 'node:assert/strict'
import { heightRangeCheck } from '../../src/validate/preSend'

test('heightRangeCheck: relief inside 65535 * scale passes, over it is flagged at the highest point', () => {
  const g = { cols: 2, step: 10, minX: 0, minZ: 0 }
  assert.deepEqual(heightRangeCheck([-40, 0, 100, 380], g), [])
  const r = heightRangeCheck([0, 0, 0, 2100], g)
  assert.equal(r.length, 1)
  assert.equal(r[0].kind, 'heightRange')
  assert.equal(r[0].value, 2100 - 2048)
  assert.deepEqual([r[0].x, r[0].z], [10, 10])
  // known absolute range of the target terrain
  assert.equal(heightRangeCheck([-60, 0, 10, 20], g, 0.03125, { min: -50, max: 1998 })[0].value, 10)
})
