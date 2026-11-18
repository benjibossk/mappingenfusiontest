import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cutAtRoads } from '../../src/modules/roadGaps.ts'

test('roadside barrier is cut at the mouth of a crossing road', () => {
  const roads = [
    { id: 'A', line: [0, 0, 100, 0], half: 3 },
    { id: 'B', line: [50, 0, 50, 80], half: 2 }, // T-junction joining A at x=50
  ]
  const bar = { id: 'A_BAR_L0', kind: 'polyline' as const, closed: false, points: [0, 4, 100, 4], generator: 'x' }
  const out = cutAtRoads([bar], roads)
  assert.equal(out.length, 2)
  assert.deepEqual(out.map((s) => s.id), ['A_BAR_L0_0', 'A_BAR_L0_1'])
  const endA = out[0].points!.at(-2)!, startB = out[1].points![0]
  assert.ok(endA <= 46 && endA > 44, `stops before B (${endA})`)
  assert.ok(startB >= 54 && startB < 56, `resumes after B (${startB})`)
  // own road never cuts it, unrelated shapes untouched
  assert.equal(cutAtRoads([bar], [roads[0]])[0], bar)
})
