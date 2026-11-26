// P2 #11: surface paint priority + noise variants (src/modules/paintPriority.ts)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { paintByPriority, splitVariants, surfacePriority, DEFAULT_PRIORITY } from '../../src/modules/paintPriority.ts'
import type { SurfaceGrid } from '../../src/modules/island.ts'

const grid = { minX: 0, minZ: 0, step: 10, cols: 40, rows: 40 }
const base = (): SurfaceGrid[] => [{ ...grid, name: 'Grass_01', weights: new Array(1600).fill(1) }]
const full = (v = 1) => new Float32Array(1600).fill(v)
const sumAt = (s: SurfaceGrid[], i: number) => s.reduce((a, x) => a + x.weights[i], 0)

test('higher priority wins where two masks overlap, whatever the order', () => {
  for (const order of [0, 1]) {
    const masks = [{ name: 'Crop_Field_01', weights: full() }, { name: 'Concrete_01', weights: full() }]
    if (order) masks.reverse()
    const s = paintByPriority(base(), masks)
    const get = (n: string) => s.find((x) => x.name === n)!.weights[5]
    assert.equal(get('Concrete_01'), 1)
    assert.equal(get('Crop_Field_01'), 0)
    assert.equal(get('Grass_01'), 0)
  }
})

test('partial masks: lower one gets the rest, base keeps the remainder, total stays 1', () => {
  const s = paintByPriority(base(), [{ name: 'Rock_01', weights: full(0.6) }, { name: 'Dirt_03', weights: full(0.3) }])
  const get = (n: string) => s.find((x) => x.name === n)!.weights[7]
  assert.ok(Math.abs(get('Dirt_03') - 0.3) < 1e-6)
  assert.ok(Math.abs(get('Rock_01') - 0.6) < 1e-6)
  assert.ok(Math.abs(get('Grass_01') - 0.1) < 1e-6)
  assert.ok(Math.abs(sumAt(s, 7) - 1) < 1e-6)
})

test('explicit priority overrides the table; unknown names get the default', () => {
  assert.equal(surfacePriority('Nope_99'), DEFAULT_PRIORITY)
  const s = paintByPriority(base(), [{ name: 'Concrete_01', weights: full() }, { name: 'Grass_02', weights: full(), priority: 999 }])
  assert.equal(s.find((x) => x.name === 'Grass_02')!.weights[0], 1)
})

test('noise variants split the weight, keep the total and are deterministic', () => {
  const a = splitVariants(base(), 'Grass_01', ['Grass_01', 'Grass_02', 'MountainGrass_01'], { seed: 3, scale: 150 })
  const b = splitVariants(base(), 'Grass_01', ['Grass_01', 'Grass_02', 'MountainGrass_01'], { seed: 3, scale: 150 })
  assert.deepEqual(a.map((s) => s.weights), b.map((s) => s.weights))
  for (let i = 0; i < 1600; i += 37) assert.ok(Math.abs(sumAt(a, i) - 1) < 1e-6)
  // each variant dominates somewhere
  for (const s of a) assert.ok(s.weights.some((w) => w > 0.9), s.name)
  // smooth: neighbours differ little most of the time
  let jumps = 0
  for (let i = 1; i < 1600; i++) if (i % 40 && Math.abs(a[0].weights[i] - a[0].weights[i - 1]) > 0.5) jumps++
  assert.ok(jumps < 60, `jumps ${jumps}`)
})
