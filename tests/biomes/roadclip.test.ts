import { test } from 'node:test'
import assert from 'node:assert/strict'
import { clipLine, Corridors, hedgesOnRoad, ringOnRoad } from '../../src/modules/roadClip.ts'
import { powerLineShape } from '../../src/modules/power.ts'

// a road along x = 50 (half 3 m) and a track along z = 30 (half 2 m)
const C = new Corridors([{ id: 'ROAD_A', pts: [50, -100, 50, 200], half: 3 }, { id: 'PSTA_ROAD_1', pts: [-100, 30, 200, 30], half: 2 }])

test('hedge-on-road: a hedge crossing two roads is split, with half width + margin clear on each side', () => {
  const hedge = [[0, 0], [100, 0], [100, 100]]
  assert.equal(hedgesOnRoad([hedge], C).length, 1)
  const parts = clipLine(hedge, C, 2.5)
  assert.equal(parts.length, 3)
  assert.equal(hedgesOnRoad(parts, C).length, 0)
  for (const p of parts) for (const q of p) assert.ok(!C.hit(q[0], q[1], 2.4), `point ${q} inside the gap`)
  // the gap around x = 50 is 2 x (3 + 2.5) m wide, within the 1 m sampling step
  const a = parts[0][parts[0].length - 1][0], b = parts[1][0][0]
  assert.ok(b - a >= 11 && b - a <= 13, `gap ${b - a}`)
})

test('hedge away from roads is kept whole', () => {
  const h = [[0, 60], [40, 60], [40, 90]]
  assert.deepEqual(clipLine(h, C, 2.5), [h])
})

test('grove on the road edge is caught, one clear of it is not', () => {
  assert.ok(ringOnRoad([54, 60, 60, 60, 60, 70, 54, 70], C, 2))
  assert.equal(ringOnRoad([60, 60, 70, 60, 70, 70, 60, 70], C, 2), null)
})

test('power shape: one point per pole, flagged perPoint (Workbench builds the poles where they were checked)', () => {
  const sh = powerLineShape({ kind: 'lv', spacing: 35, path: [0, 0, 100, 0], poles: [0, 0, 33.3, 0, 66.6, 0, 100, 0], length: 100 } as never, 'POWER_LV_1')
  assert.deepEqual(sh.points, [0, 0, 33.3, 0, 66.6, 0, 100, 0])
  assert.equal((sh as { perPoint?: boolean }).perPoint, true)
})
