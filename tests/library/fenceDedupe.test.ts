import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dedupeLines } from '../../src/modules/fenceDedupe.ts'

test('a fence along an already kept one is dropped, the rest is kept', () => {
  const a = [0, 0, 20, 0, 20, 20] // L shape
  const b = [0, 0.5, 20, 0.5, 40, 0.5] // runs 20 m along a, then 20 m alone
  const [ka, kb] = dedupeLines([a, b])
  assert.equal(ka.length, 1)
  assert.deepEqual(ka[0], a)
  assert.equal(kb.length, 1)
  const q = kb[0]
  assert.ok(q[0] > 20 && q[0] < 23, 'starts just after the shared part: ' + q[0])
  assert.equal(q[q.length - 2], 40)
  assert.equal(q.length, 4, 'collinear samples are simplified away')
})

test('separate fences are untouched', () => {
  const [ka, kb] = dedupeLines([[0, 0, 10, 0], [0, 10, 10, 10]])
  assert.deepEqual(ka, [[0, 0, 10, 0]])
  assert.deepEqual(kb, [[0, 10, 10, 10]])
})
