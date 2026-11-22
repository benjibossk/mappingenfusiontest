// topographic map background (src/atelier/render.ts): hypsometric tints and contour interval
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { contourStep, hypso } from '../src/atelier/render.ts'

test('topo: green lowlands, white summits, ~20 contour lines over the relief', () => {
  const lo = hypso(0), hi = hypso(1), mid = hypso(0.5)
  assert.ok(lo[1] > lo[0] && lo[1] > lo[2], 'lowlands green')
  assert.ok(hi.every((v) => v > 240), 'summits white')
  assert.ok(mid[0] > mid[2], 'mid heights warm')
  assert.deepEqual(hypso(-1), lo); assert.deepEqual(hypso(2), hi)
  assert.equal(contourStep(400), 20)
  assert.equal(contourStep(80), 5)
  assert.equal(contourStep(2000), 100)
})
