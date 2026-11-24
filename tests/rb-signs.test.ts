import { test } from 'node:test'
import assert from 'node:assert/strict'
import { roadSigns } from '../src/modules/roads.ts'

test('roundabout: no sign inside the ring, a give-way on each entry', () => {
  const ring: number[] = []
  for (let a = 0; a <= 12; a++) ring.push(1000 + 17 * Math.cos(a * Math.PI / 6), 1000 + 17 * Math.sin(a * Math.PI / 6))
  const roads = [
    { id: 'MAIN', type: 'asphaltLine', pts: [600, 1000, 1000, 1000, 1400, 1000], flatten: true },
    { id: 'SIDE', type: 'asphaltNarrow', pts: [1000, 1000, 1000, 1300], flatten: true },
    { id: 'RB_T', type: 'asphaltLine', pts: ring, flatten: true },
  ] as never
  const s = roadSigns(roads)
  const inside = s.filter((e) => Math.hypot(e.x - 1000, e.z - 1000) < 17 + 6 + 3)
  assert.deepEqual(inside.map((e) => e.id), [])
  assert.ok(!s.some((e) => e.id.startsWith('RB_T')))
  assert.equal(s.filter((e) => e.id.includes('RBGIVE')).length, 3)
})
