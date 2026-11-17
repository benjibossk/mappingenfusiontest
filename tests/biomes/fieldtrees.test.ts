// #8 groves, isolated trees in the fields and hedgerow trees (src/modules/fieldtrees.ts)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fieldTrees, fieldSpecies } from '../../src/modules/fieldtrees.ts'
import { VEG } from '../../src/data/biomes.ts'

// a 6 x 6 grid of 100 m plots, hedges on every inner border
const fields: number[][][] = [], hedges: number[][][] = []
for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) fields.push([[i * 100, j * 100], [i * 100 + 100, j * 100], [i * 100 + 100, j * 100 + 100], [i * 100, j * 100 + 100]])
for (let k = 1; k < 6; k++) { hedges.push([[k * 100, 0], [k * 100, 600]]); hedges.push([[0, k * 100], [600, k * 100]]) }
const run = (density: number, biome?: string, ok = (_x: number, _z: number) => true) => fieldTrees({ fields, hedges, seed: 5, density, biome, ok })

test('field trees: deterministic, vanilla prefabs, spaced, density scales, 0 = none', () => {
  const a = run(1), b = run(1)
  assert.deepEqual(a, b)
  assert.ok(a.length > 20, `trees ${a.length}`)
  const vanilla = new Set<string>(Object.values(VEG))
  assert.ok(a.every((e) => vanilla.has(e.prefab)))
  for (let i = 0; i < a.length; i++) for (let j = i + 1; j < a.length; j++) assert.ok(Math.hypot(a[i].x - a[j].x, a[i].z - a[j].z) >= 3)
  assert.ok(run(2).length > a.length * 1.5)
  assert.equal(run(0).length, 0)
  assert.equal(new Set(a.map((e) => e.id)).size, a.length)
})
test('field trees: hedgerow trees stand on the hedges, the ok mask is honoured', () => {
  const a = run(1)
  const onHedge = a.filter((e) => Math.min(Math.abs(e.x % 100), Math.abs(e.z % 100)) < 0.5 && e.x > 1 && e.z > 1 && e.x < 599 && e.z < 599)
  assert.ok(onHedge.length >= a.length * 0.5, `${onHedge.length}/${a.length} on hedges`)
  const half = run(1, undefined, (x) => x < 300)
  assert.ok(half.every((e) => e.x < 300) && half.length > 0)
})
test('field species: broadleaves of the biome, no conifer when the biome has broadleaves', () => {
  assert.ok(fieldSpecies('temperate_everon').every((q) => !/pinus|picea|larix/i.test(q.p)))
  assert.ok(fieldSpecies('winter_tundra').length > 0)
  assert.ok(fieldSpecies('no_such_biome').length > 0)
})

import { generateWorld, WORLD_DEFAULTS } from '../../src/modules/worldgen.ts'
test('random world: one field-tree zone, off the roads and forests, scaled by the setting', async () => {
  const P = { ...WORLD_DEFAULTS, size: 2048, seed: 4242 }
  const w = await generateWorld(P), z = w.zones.find((q) => q.sub === 'fieldtrees')
  assert.ok(z && z.entities.length >= 4, `field trees ${z?.entities.length}`)
  const none = await generateWorld({ ...P, fieldTrees: 0 })
  assert.ok(!none.zones.some((q) => q.sub === 'fieldtrees'))
  const dense = await generateWorld({ ...P, fieldTrees: 2 })
  assert.ok(dense.zones.find((q) => q.sub === 'fieldtrees')!.entities.length > z!.entities.length)
})
