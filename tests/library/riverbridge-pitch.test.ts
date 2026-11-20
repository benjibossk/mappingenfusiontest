import { test } from 'node:test'
import assert from 'node:assert/strict'
import { riverBridges, BRIDGE_MAX_PITCH, bridgeRampPatches, patchedAt, nearBridge } from '../../src/modules/water'
import { bridgeChecks } from '../../src/validate/preSend'

// 200 x 40 m grid, 2 m cells: west bank at 10 m, east bank at 12 m (x > 100), river in between
const grid = { cols: 101, rows: 21, step: 2, minX: 0, minZ: 0 } as never
const relief = (west: number, east: number) => Float32Array.from({ length: 101 * 21 }, (_, i) => ((i % 101) * 2 > 100 ? east : west))
const at = (h: Float32Array) => (x: number, z: number) => h[Math.round(z / 2) * 101 + Math.round(x / 2)]
const gap = [{ id: 'R1', from: [70, 20] as [number, number], to: [130, 20] as [number, number] }]
const road = () => ({ half: 3.5, dirt: false })

test('river bridge: one straight pitched line from bank to bank, every piece on it', () => {
  const h = relief(10, 12)
  const { entities, plans } = riverBridges(gap, h, grid, road)
  const p = plans[0]
  assert.ok(Math.abs(p.a[2] - 10.05) < 1e-6 && Math.abs(p.b[2] - 12.05) < 1e-6, 'ends at the road height of each bank')
  const decks = entities.filter((e) => e.id.includes('_DECK_'))
  assert.ok(decks.length >= 3)
  assert.ok(new Set(decks.map((e) => e.rollcd)).size === 1 && decks[0].rollcd! < 0, 'same tilt, nose up towards the east')
  assert.deepEqual(bridgeChecks({ plans, entities, roadY: at(h), settled: [] }), [])
})

test('river bridge: a step steeper than the cap keeps 8 % and is flagged', () => {
  const h = relief(10, 20)
  const { entities, plans } = riverBridges(gap, h, grid, road)
  assert.ok(plans[0].capped && Math.abs(plans[0].slope - BRIDGE_MAX_PITCH) < 1e-9)
  assert.ok(bridgeChecks({ plans, entities, roadY: at(h), settled: [] }).some((i) => i.kind === 'bridgeStep'))
})

test('bridge checks: a kinked piece and a house against the deck end', () => {
  const h = relief(10, 12)
  const { entities, plans } = riverBridges(gap, h, grid, road)
  const bent = entities.map((e) => (e.id.endsWith('_DECK_1') ? { ...e, ycm: (e.ycm ?? 0) + 40 } : e))
  const house = { id: 'H1', x: 58, z: 24, prefab: 'House', corners: [55, 21, 61, 21, 61, 27, 55, 27] }
  const kinds = bridgeChecks({ plans, entities: bent, roadY: at(h), settled: [house] }).map((i) => i.kind)
  assert.ok(kinds.includes('bridgePitch') && kinds.includes('bridgeHouse'))
})

test('capped bridge: the low bank gets a ramp up to the deck, the checks then pass', () => {
  const h = relief(10, 20)
  const { entities, plans } = riverBridges(gap, h, grid, road)
  const ramps = bridgeRampPatches(plans, h, grid)
  assert.equal(ramps.length, 1)
  const y = patchedAt(h, grid, ramps)
  assert.ok(Math.abs(y(67, 20) - (plans[0].a[2] - 0.05)) < 0.1, 'raised to the deck at the abutment')
  assert.ok(Math.abs(y(30, 20) - 10) < 0.01, 'back on the ground 40 m out')
  assert.ok(!bridgeChecks({ plans, entities, roadY: y, settled: [] }).some((i) => i.kind === 'bridgeStep'))
})

test('nearBridge: a house against the deck end is caught, one 20 m away is not', () => {
  const { plans } = riverBridges(gap, relief(10, 12), grid, road)
  assert.ok(nearBridge(plans[0], { x: 58, z: 24, corners: [] }))
  assert.ok(!nearBridge(plans[0], { x: 40, z: 20, corners: [] }))
})
