import { test } from 'node:test'
import assert from 'node:assert/strict'
import { clearOfRoads } from '../src/modules/imageMap'

const box = (x: number, z: number, hx: number, hz: number) => ({ x, z, corners: [x - hx, z - hz, x + hx, z - hz, x + hx, z + hz, x - hx, z + hz] })
const road = { pts: [0, 0, 100, 0], half: 3 }

test('clearOfRoads: a shed reaching 1.3 m into the road is pushed out to its side, an untouched house stays', () => {
  const [a, b] = clearOfRoads([box(50, 5.7, 4, 3), box(20, 30, 4, 4)], [road])
  assert.ok(a.z - 3 >= 3 + 1 - 0.01, String(a.z))
  assert.equal(a.x, 50)
  assert.deepEqual(b, box(20, 30, 4, 4))
})

test('clearOfRoads: a house astride the road is left out when it would move more than 8 m', () => {
  assert.equal(clearOfRoads([box(50, 0.5, 6, 6)], [road]).length, 0)
})
