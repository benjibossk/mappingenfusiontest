import { test } from 'node:test'
import assert from 'node:assert/strict'
import { poleDirtMasks } from '../../src/modules/power.ts'

test('dirt patch under each pole: small for LV, wide for HV, irregular, deterministic', () => {
  const lv = poleDirtMasks([{ kind: 'lv', poles: [0, 0, 45, 0] }], 7)
  const hv = poleDirtMasks([{ kind: 'hv', poles: [500, 500] }], 7)
  assert.deepEqual(lv, poleDirtMasks([{ kind: 'lv', poles: [0, 0, 45, 0] }], 7))
  assert.notDeepEqual(lv, poleDirtMasks([{ kind: 'lv', poles: [0, 0, 45, 0] }], 8))
  const reach = (m: typeof lv, x: number, z: number) => Math.max(...m.map((e) => Math.max(Math.hypot(e.points[0] - x, e.points[1] - z), Math.hypot(e.points[2] - x, e.points[3] - z)) + e.half + e.edge))
  const lv0 = lv.filter((e) => Math.hypot(e.points[0], e.points[1]) < 10)
  assert.ok(lv0.length >= 3 && lv.length > lv0.length, 'several lobes per pole, both poles')
  assert.ok(reach(lv0, 0, 0) < 6, 'LV patch stays small (~2 m + soft fade)')
  assert.ok(reach(hv, 500, 500) > 6 && reach(hv, 500, 500) < 14, 'HV patch ~5 m')
  assert.ok(new Set(lv0.map((e) => e.half.toFixed(3))).size > 1, 'not a perfect circle')
  assert.ok(lv.every((e) => e.core === 'Dirt_01' && e.edge > 0 && e.peak > 0.5 && e.peak < 0.9 && e.prio > 1), 'partial weight, kept by the block limiter')
})
