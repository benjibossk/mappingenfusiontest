import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeSurfaces, waterDistance, openWaterDistance, COAST_BEACH_M } from '../src/modules/island.ts'

test('computeSurfaces: a low plain along a river is grass, beach only on a narrow bank strip', () => {
  const cols = 101, rows = 101, step = 4
  const heights: number[] = []
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) heights.push(Math.abs(c - 50) <= 3 ? -1.5 : 2) // river bed, plain at 2 m
  const s = computeSurfaces({ minX: 0, minZ: 0, step, cols, rows }, heights, 40)
  const w = (name: string, c: number) => { const g = s.find((q) => q.name === name); return g ? g.weights[50 * cols + c] : 0 }
  const beachy = (c: number) => w('BeachGrass_01', c) + w('Pebbles_02', c) + w('Grass_03_coastal', c)
  assert.ok(beachy(56) > 0.3, `bank strip ${beachy(56)}`) // 12 m from the bed
  assert.ok(beachy(2) < 0.01, `plain 180 m away ${beachy(2)}`)
  assert.ok(w('BeachGrass_01', 50 - 3 - Math.ceil((COAST_BEACH_M * 2.5) / step) - 1) < 0.01)
})

test('waterDistance: chamfer distance to the low ground', () => {
  const d = waterDistance([0, 5, 5, 5, 5], 5, 1, 10, -1)
  assert.equal(d[0], Infinity)
  const e = waterDistance([-2, 5, 5, 5, 5], 5, 1, 10, -1)
  assert.deepEqual(Array.from(e), [0, 10, 20, 30, 40])
})

test('computeSurfaces: river banks and low dry plains get no shingle / beach (open water only)', () => {
  const cols = 101, rows = 101, step = 4
  const heights: number[] = []
  // river 28 m wide on the left, a plain at 0.8 m (picture map: land just above the sea), open sea on the right
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) heights.push(Math.abs(c - 20) <= 3 ? -1.5 : c >= 75 ? -5 : 0.8)
  const s = computeSurfaces({ minX: 0, minZ: 0, step, cols, rows }, heights, 40)
  const w = (name: string, c: number) => { const g = s.find((q) => q.name === name); return g ? g.weights[50 * cols + c] : 0 }
  const shingle = (c: number) => w('Pebbles_02', c) + w('BeachGrass_01', c)
  assert.ok(shingle(26) < 0.05, `river bank ${shingle(26)}`) // 12 m from the river
  assert.ok(shingle(45) < 0.05, `plain at 0.8 m, 100 m from any water ${shingle(45)}`)
  assert.ok(shingle(72) > 0.3, `sea shore ${shingle(72)}`)
})

test('openWaterDistance: a river is not open water, the sea is', () => {
  const cols = 60, rows = 30, step = 4, h: number[] = []
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) h.push(c === 10 || c === 11 ? -2 : c >= 40 ? -5 : 3)
  const d = openWaterDistance(h, cols, rows, step, -0.5)
  assert.ok(d[15 * cols + 12] > 60, `next to the river ${d[15 * cols + 12]}`)
  assert.ok(d[15 * cols + 38] <= 8, `next to the sea ${d[15 * cols + 38]}`)
})

test('computeSurfaces: no Rock_01 band on the map-edge sea ramp (picture 120, grey band along the east edge)', () => {
  const cols = 101, rows = 101, step = 8
  const heights: number[] = []
  // plateau at 30 m falling into the sea over the last 6 % of the map (Sculpt.compose edge ramp), 45 deg
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) heights.push(c < 94 ? 30 : 30 - (c - 93) * 9)
  const s = computeSurfaces({ minX: 0, minZ: 0, step, cols, rows }, heights, 40)
  const rock = s.find((q) => q.name === 'Rock_01')!.weights
  let edge = 0
  for (let r = 20; r < 80; r++) for (let c = 93; c < cols; c++) edge += rock[r * cols + c]
  assert.equal(edge, 0)
})
