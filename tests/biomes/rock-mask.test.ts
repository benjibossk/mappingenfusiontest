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
  assert.ok(share > 0.02, `some rock remains ${share}`)
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
  assert.ok(at(97) > 0.5, `cliff rock ${at(97)}`)
  let footScree = 0
  for (let c = 100; c < 110; c++) footScree = Math.max(footScree, m.scree[20 * cols + c])
  assert.ok(footScree > 0.05, `scree at cliff foot ${footScree}`)
  assert.ok(m.scree[20 * cols + 30] < 0.05)
})
