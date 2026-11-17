import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ffBiomeName, ffBiomeValue, FF_BIOME_VALUE } from '../../src/ffbiome.ts'
import { BIOMES } from '../../src/data/biomes.ts'

test('FF enum values match JWK_EWorldBiome', () => {
  assert.deepEqual(FF_BIOME_VALUE, { WOODLAND: 1, WINTER: 2, DESERT: 4, JUNGLE: 8 })
})
test('each biome maps to a single FF flag', () => {
  for (const b of BIOMES) assert.ok([1, 2, 4, 8].includes(ffBiomeValue(b.id)), b.id)
})
test('specific mappings', () => {
  assert.equal(ffBiomeValue('temperate_everon'), 1)
  assert.equal(ffBiomeValue('winter_tundra'), 2)
  assert.equal(ffBiomeValue('desert'), 4)
  assert.equal(ffBiomeValue('tropical'), 8)
  assert.equal(ffBiomeName('nope'), 'WOODLAND')
})
