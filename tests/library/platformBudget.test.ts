// Platform object budgets (src/modules/platformBudget.ts) and the 'overBudget' check
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { densityGrid, overBudgetCells, PLATFORM_BUDGETS } from '../../src/modules/platformBudget.ts'
import { validate } from '../../src/modules/validate.ts'

test('density grid counts objects and forest trees per cell', () => {
  const g = densityGrid({ width: 512, height: 512, objects: [{ x: 10, z: 10 }, { x: 300, z: 300 }], forests: [[0, 0, 256, 0, 256, 256, 0, 256]] })
  assert.equal(g.cols, 2)
  assert.ok(Math.abs(g.counts[0] - (1 + 256 * 256 * 0.02)) < 1)
  assert.equal(g.counts[3], 1)
})

test('budgets are ordered PC > X/PS5 > S, and dense cells are flagged', () => {
  assert.ok(PLATFORM_BUDGETS.pc.perKm2 > PLATFORM_BUDGETS.xsx.perKm2 && PLATFORM_BUDGETS.xsx.perKm2 > PLATFORM_BUDGETS.xss.perKm2)
  const objects = Array.from({ length: 1500 }, (_, i) => ({ x: 5 + (i % 40) * 6, z: 5 + Math.floor(i / 40) * 6 }))
  const g = densityGrid({ width: 512, height: 512, objects })
  assert.equal(overBudgetCells(g, 'xss').length, 1) // 1500 > 20000*0.0655 ≈ 1311
  assert.equal(overBudgetCells(g, 'pc').length, 0) // < 2621
  const grid = { cols: 52, rows: 52, step: 10 } as any
  const issues = validate({ roads: [], sites: [], settled: [], refusedGaps: [], heights: new Array(52 * 52).fill(10), grid, budget: { platform: 'xss', grid: g } })
  assert.deepEqual(issues.map((i) => i.kind), ['overBudget'])
})
