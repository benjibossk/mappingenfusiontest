import { test } from 'node:test'
import assert from 'node:assert/strict'
import { bell, groundWeights, ramp, terrainShape } from '../../src/modules/groundMasks.ts'
import { generateIsland, overfullBlocks } from '../../src/modules/island.ts'

test('ramp/bell are smooth and bounded', () => {
  assert.equal(ramp(0, 1, 2), 0); assert.equal(ramp(3, 1, 2), 1); assert.equal(ramp(1.5, 1, 2), 0.5)
  assert.equal(bell(5, 5, 1), 1); assert.equal(bell(7, 5, 1), 0)
})

test('TPI: positive on a crest, negative in a hollow', () => {
  const cols = 41, rows = 41, h: number[] = []
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) h.push(20 * Math.cos(((c - 20) / 20) * Math.PI))
  const s = terrainShape(h, cols, rows, 4, 40)
  assert.ok(s.tpi[20 * cols + 20] > 3 && s.curv[20 * cols + 20] < 0)
  assert.ok(s.tpi[20 * cols + 0] < -3)
})

test('groundWeights: ridges get rock/gravel, hollows moist, flats plain grass', () => {
  const ridge = groundWeights(0.35, 6, -0.02, 0.5)
  assert.ok(ridge.rock + ridge.gravel > 0.5)
  const hollow = groundWeights(0.03, -6, 0.02, 0.5)
  assert.ok(hollow.moist > 0.5 && hollow.rock === 0)
  const flat = groundWeights(0.02, 0, 0, 0.5)
  assert.ok(flat.rock + flat.gravel + flat.moist < 0.05)
  for (const w of [ridge, hollow, flat]) assert.ok(w.rock + w.gravel + w.moist <= 1 + 1e-9)
})

test('islands paint inland rock and moist grass and stay within 5 surfaces per block', () => {
  const isl = generateIsland({ size: 2048, step: 4, maxHeight: 300, seaDepth: 40, landRatio: 0.5, roughness: 0.6, seed: 3, islands: 1 })
  const sum = (n: string) => isl.surfaces.find((s) => s.name === n)!.weights.reduce((a, b) => a + b, 0)
  assert.ok(sum('Grass_02') > 0 && sum('Rock_01') > 0 && sum('Debris_Rock_01') > 0)
  assert.equal(overfullBlocks(isl.surfaces), 0)
})
