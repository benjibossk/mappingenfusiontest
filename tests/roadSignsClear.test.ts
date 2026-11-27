import { test } from 'node:test'
import assert from 'node:assert/strict'
import { signsClearOf } from '../src/modules/roads.ts'

test('signsClearOf: a sign inside a (rotated) house or within the margin goes, the others stay', () => {
  const c = 0.6, s = 0.8 // yawed 10 x 6 box from (100, 100)
  const house = [100, 100, 100 + 10 * c, 100 + 10 * s, 100 + 10 * c - 6 * s, 100 + 10 * s + 6 * c, 100 - 6 * s, 100 + 6 * c]
  const e = (id: string, x: number, z: number) => ({ id, prefab: 'Sign.et', x, z, yaw: 0 })
  const kept = signsClearOf([e('in', 101, 104), e('edge', 100 + 0.5 * s, 100 - 0.5 * c), e('out', 130, 130)], [house, []])
  assert.deepEqual(kept.map((k) => k.id), ['out'])
})
