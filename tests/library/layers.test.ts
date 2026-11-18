import { test } from 'node:test'
import assert from 'node:assert/strict'
import { layerSeed, downstream, setLayerSeed, setLayerParams, setGlobalSeed, markBuilt, staleLayers } from '../../src/modules/layers.ts'

test('layer seed derives from global, override wins', () => {
  assert.equal(layerSeed(5, {}, 'roads'), layerSeed(5, {}, 'roads'))
  assert.notEqual(layerSeed(5, {}, 'roads'), layerSeed(5, {}, 'water'))
  assert.equal(layerSeed(5, { roads: { seed: 42 } }, 'roads'), 42)
})

test('downstream closure', () => {
  assert.deepEqual(downstream('power'), [])
  assert.deepEqual(downstream('relief'), ['water', 'roads', 'settlements', 'fields', 'forests', 'power'])
  assert.deepEqual(downstream('fields'), ['forests'])
})

test('stale propagation', () => {
  let m = setLayerSeed({}, 'roads', 7)
  assert.deepEqual(staleLayers(m), ['roads', 'fields', 'forests', 'power'])
  m = markBuilt(m, 'roads')
  assert.deepEqual(staleLayers(m), ['fields', 'forests', 'power'])
  assert.equal(setLayerParams(m, 'water', 'a').water?.paramsHash, 'a')
  const p = setLayerParams({ water: { paramsHash: 'a' } }, 'water', 'a')
  assert.deepEqual(staleLayers(p), [])
  const g = setGlobalSeed({ relief: { seed: 3 }, power: { seed: 9 } })
  assert.equal(g.relief?.stale, undefined)
  assert.equal(g.power?.stale, true) // overridden but upstream changed
})
