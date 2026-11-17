// Random world power step = hierarchical planner (worldpower.ts): stations + lines, deterministic by seed
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generateWorld, WORLD_DEFAULTS } from '../../src/modules/worldgen.ts'

test('random world 8 km: places, stations, MV/HV lines, same seed -> same grid', async () => {
  const p = { ...WORLD_DEFAULTS, size: 8192, seed: 77, forests: 0 }
  const t0 = Date.now()
  const w = await generateWorld(p)
  console.log('ms', Date.now() - t0, 'lines', w.power.length, 'stations', w.powerStations?.length)
  assert.ok(w.sites.length > 10) // seed 77 used to throw in the campaign clip: no places at all
  assert.ok((w.powerStations ?? []).length >= 3)
  assert.ok(w.power.some((l) => l.kind === 'mv') && w.power.some((l) => l.kind === 'hv' || l.kind === 'ehv'))
  const again = await generateWorld(p)
  assert.equal(JSON.stringify(again.power), JSON.stringify(w.power))
  assert.equal(JSON.stringify(again.powerStations), JSON.stringify(w.powerStations))
})
