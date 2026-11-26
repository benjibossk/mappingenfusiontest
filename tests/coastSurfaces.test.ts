import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeSurfaces, waterDistance, COAST_BEACH_M } from '../src/modules/island.ts'

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
