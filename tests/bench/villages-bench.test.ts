// The village fill matches vanilla Everon per site (reconstruction bench, scripts/bench/bench.ts)
import test from 'node:test'
import assert from 'node:assert/strict'
import { WORLD } from '../../src/data/worldParams'

test('village / hamlet fill stays at the bench-calibrated level (Everon ~1x buildings per site)', () => {
  assert.ok(WORLD.villages.village.density <= 0.4, 'village density 1.15 built 2.3x the vanilla count')
  assert.ok(WORLD.villages.hamlet.density <= 0.3, 'hamlet density 0.6 built 2.2x the vanilla count')
  assert.ok((WORLD.villages.village.maxStreets ?? 99) <= 5)
})

test('every built lot is fenced by default (Everon fence length: 0.65 gave 0.43x vanilla, bench)', async () => {
  const { lotFences } = await import('../../src/modules/worldextras')
  const lot = (x: number) => ({ site: 'S', corners: [x, 0, x + 20, 0, x + 20, 30, x, 30], used: true })
  const lots = Array.from({ length: 10 }, (_, i) => lot(i * 40))
  const out = lotFences(lots as never, { seed: 3, kindOf: () => 'village' as never, blocked: () => false })
  const fenced = out.reduce((a, p) => a + p.fences.length, 0)
  assert.ok(fenced >= 30, `fence runs ${fenced}`)
})
