import { test } from 'node:test'
import assert from 'node:assert/strict'
import { camLookAt, worldToMap } from '../../src/modules/wbCamera.ts'

test('worldToMap: north up, no offset', () => {
  const v = { x: 2048, z: 2048, mpp: 4, width: 800, height: 800 }
  assert.deepEqual(worldToMap(v, 2048, 2048), [400, 400])
  const [sx, sy] = worldToMap(v, 3290, 1990) // dam: east of centre, slightly south
  assert.ok(sx > 400 && sy > 400)
  assert.deepEqual(worldToMap(v, 2048, 2448), [400, 300]) // +Z = up on screen
})

test('camLookAt: live camera over the sea hits the dam (~3290 1990)', () => {
  const hit = camLookAt({ x: 3602.9, y: 269.5, z: 1855.1, yaw: 294.3, pitch: -47.1 }, () => 20)
  assert.ok(hit)
  assert.ok(Math.hypot(hit![0] - 3370, hit![1] - 1960) < 40, String(hit))
  assert.equal(camLookAt({ x: 0, y: 10, z: 0, yaw: 0, pitch: 5 }, () => 0), null)
})
