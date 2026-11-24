import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generateIsland, computeSurfaces } from '../../src/modules/island.ts'
import { terrainShape } from '../../src/modules/groundMasks.ts'
import { rockMasks, rockShare } from '../../src/modules/rockMask.ts'

test('rockMask: a steep synthetic island keeps the rock share bounded', () => {
  const isl = generateIsland({ size: 1024, step: 4, maxHeight: 600, seaDepth: 40, landRatio: 0.55, roughness: 0.9, seed: 3, islands: 1 })
  const s = computeSurfaces(isl.grid, isl.heights, 600)
  const rock = s.find((g) => g.name === 'Rock_01')!.weights
  const share = rockShare(isl.heights, rock)
  assert.ok(share < 0.4, `rock share ${share}`)
  // cap 2.5 % since the mountain flanks fix ([M] Everon bare Rock_01 1.4 %)
  assert.ok(share > 0.005, `some rock remains ${share}`)
})

test('rockMask: a long uniform slope stays vegetated, a tall cliff turns to rock', () => {
  const cols = 120, rows = 40, step = 4
  const h = new Array(cols * rows)
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const x = c * step
    // left: uniform 40 % ramp; right: flat plateau then a 40 m vertical-ish cliff
    h[r * cols + c] = x < 240 ? 10 + 0.4 * x : x < 380 ? 106 : x < 400 ? 106 - (x - 380) * 2 : 66
  }
  const m = rockMasks(h, cols, rows, step, 200, terrainShape(h, cols, rows, step), { maxShare: 1 })
  const at = (c: number) => m.rock[20 * cols + c]
  assert.ok(at(30) < 0.2, `uniform slope rock ${at(30)}`)
  // since 3aec1b7 rock weight tops at 0.45 beyond 45 deg ([M] FIELDS_SURFACES_VANILLA §3: 45 % Rock_01 pixels there)
  assert.ok(at(97) > 0.4, `cliff rock ${at(97)}`)
  let footScree = 0
  for (let c = 100; c < 110; c++) footScree = Math.max(footScree, m.scree[20 * cols + c])
  assert.ok(footScree > 0.05, `scree at cliff foot ${footScree}`)
  // 3aec1b7: scree-grass now rises with the slope on any 15-35 deg ground ([M] Everon Debris_Rock_01 13 % at 15 deg -> 32 % at 30 deg),
  // so a 22 deg ramp carries ~0.19 of it; the cliff foot must still get more
  const rampScree = m.scree[20 * cols + 30]
  assert.ok(rampScree < 0.25, `ramp scree ${rampScree}`)
  assert.ok(footScree > rampScree, `foot ${footScree} > ramp ${rampScree}`)
})
