import { test } from 'node:test'
import assert from 'node:assert/strict'
import { forestBias } from '../../src/modules/forestgen.ts'
import { forestTuning, treeLineOf, TREE_LINE, leafOf } from '../../src/biomes/vegetation.ts'

test('Everon tree line is the default and sparse biomes stop lower', () => {
  assert.equal(forestTuning().treeLine, TREE_LINE)
  assert.ok(treeLineOf(0.2) < treeLineOf(1))
  assert.ok(treeLineOf(5) <= TREE_LINE && treeLineOf(0) >= 0.78)
})
test('valleys and slopes are preferred over ridges and flats', () => {
  assert.ok(forestBias(0.4, 0.1, 3) > forestBias(0.4, 0.1, -3))
  assert.ok(forestBias(0.4, 0.3, 0) > forestBias(0.4, 0, 0))
  assert.ok(forestBias(0.4, 0.1, 0) > forestBias(0.9, 0.1, 0))
})
test('conifers higher, broadleaf lower', () => {
  assert.equal(leafOf(0.8), 'needle'); assert.equal(leafOf(0.1), 'broad')
})

// #7 forests by altitude and slope
import { forestCellOk, generateForests, FOREST_MAX_SLOPE } from '../../src/modules/forestgen.ts'
test('no wood on very steep cells nor on rocky crests under the tree line', () => {
  assert.ok(forestCellOk(0.4, 0.3, 0))
  assert.ok(!forestCellOk(0.4, FOREST_MAX_SLOPE + 0.05, 0))
  assert.ok(!forestCellOk(0.8, 0.2, -3, 0.85)) // exposed convex ridge
  assert.ok(forestCellOk(0.8, 0.2, 1, 0.85)) // sheltered hollow at the same height
  assert.ok(!forestCellOk(0.9, 0.1, 0, 0.85))
})
test('a wood climbing a hill changes species with altitude, each forest in one band', () => {
  const step = 16, cols = 257, grid = { minX: 0, minZ: 0, step, cols, rows: cols }
  const h = new Float32Array(cols * cols)
  for (let r = 0; r < cols; r++) for (let c = 0; c < cols; c++) h[r * cols + c] = 5 + 300 * (c / (cols - 1)) // long gentle ramp
  const f = generateForests(h, grid, { seed: 3, cover: 0.9, sites: [] })
  const leafs = new Set(f.map((q) => q.leaf))
  assert.ok(leafs.has('broad') && leafs.has('needle') && leafs.has('mixed'), [...leafs].join(','))
  const meanX = (q: { pts: number[] }) => { let s = 0; for (let i = 0; i < q.pts.length; i += 2) s += q.pts[i]; return s / (q.pts.length / 2) }
  const avg = (l: string) => { const a = f.filter((q) => q.leaf === l).map(meanX); return a.reduce((x, y) => x + y, 0) / a.length }
  assert.ok(avg('broad') < avg('mixed') && avg('mixed') < avg('needle'))
})
