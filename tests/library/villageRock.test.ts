// No bare Rock_01 in village lots + 25 m margin (island.ts settlementMask / computeSurfaces `settle`)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generateWorld, WORLD_DEFAULTS } from '../../src/modules/worldgen.ts'
import { settlementMask } from '../../src/modules/island.ts'

for (const seed of [7, 21, 77]) {
  test(`village ground: no Rock_01 within the lots + margin (seed ${seed})`, async () => {
    const w = await generateWorld({ ...WORLD_DEFAULTS, seed })
    assert.ok(w.settlement.placed.length > 0, 'some houses')
    const m = settlementMask(w.grid, w.settlement.placed.map((q) => q.corners))
    const rock = w.surfaces.find((s) => s.name === 'Rock_01')!.weights
    let inside = 0, worst = 0
    for (let i = 0; i < m.length; i++) if (m[i] >= 1) { inside++; worst = Math.max(worst, rock[i]) }
    assert.ok(inside > 0)
    assert.ok(worst < 1e-6, `rock ${worst} inside a village`)
  })
}
