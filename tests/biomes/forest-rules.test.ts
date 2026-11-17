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
