import { test } from 'node:test'
import assert from 'node:assert/strict'
import { trimCrossings } from '../../src/modules/fenceDedupe.ts'

test('a later fence stops on an earlier one: short overhang dropped, long run kept', () => {
  const a = [0, 0, 100, 0]
  const b = [50, -10, 50, 80] // crosses a at (50,0): 10 m stub below, 80 m above
  const [ka, kb] = trimCrossings([a, b])
  assert.equal(ka.length, 1)
  assert.equal(kb.length, 1)
  assert.deepEqual(kb[0].slice(0, 2), [50, 0])
  const c = [20, -50, 20, 50] // 50 m on both sides: both runs stay, each ends on the fence
  assert.equal(trimCrossings([a, c])[1].length, 2)
})
