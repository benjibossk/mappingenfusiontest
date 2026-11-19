// The village fill matches vanilla Everon per site (reconstruction bench, scripts/bench/bench.ts)
import test from 'node:test'
import assert from 'node:assert/strict'
import { WORLD } from '../../src/data/worldParams'

test('village / hamlet fill stays at the bench-calibrated level (Everon ~1x buildings per site)', () => {
  assert.ok(WORLD.villages.village.density <= 0.4, 'village density 1.15 built 2.3x the vanilla count')
  assert.ok(WORLD.villages.hamlet.density <= 0.3, 'hamlet density 0.6 built 2.2x the vanilla count')
  assert.ok((WORLD.villages.village.maxStreets ?? 99) <= 5)
})
