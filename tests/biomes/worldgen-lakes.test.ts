// Random world: nothing (place, zone, road, power pole, house) may be generated inside a lake outline.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generateWorld, WORLD_DEFAULTS } from '../../src/modules/worldgen.ts'
import { lakeHits } from './lakeHits.ts'

for (const seed of [4242, 7]) test(`no zone / road / line inside a lake (4 km, seed ${seed})`, async () => {
  const w = await generateWorld({ ...WORLD_DEFAULTS, size: 4096, seed })
  const h = lakeHits(w)
  assert.equal(h.total, 0, JSON.stringify(h))
  const again = lakeHits(await generateWorld({ ...WORLD_DEFAULTS, size: 4096, seed }))
  assert.deepEqual(again, h) // deterministic
})
