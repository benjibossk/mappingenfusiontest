// Street lamps (streetLights.ts): lit settlement streets only, off the carriageway / footprints / poles,
// spacing and facing as measured on the vanilla maps; pre-send lampOnRoad / lampInBuilding checks.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { streetLights, lampConsumers, LAMP_PREFABS } from '../../src/modules/streetLights'
import { preSendChecks } from '../../src/validate/preSend'
import type { Road } from '../../src/modules/roads'

const box = (x: number, z: number, h = 4) => [x - h, z - h, x + h, z - h, x + h, z + h, x - h, z + h]
// a village street along +X at z = 0, houses on both sides every 20 m
const road: Road = { id: 'R1', type: 'asphalt', pts: [0, 0, 400, 0], width: 7 }
const houses = Array.from({ length: 16 }, (_, i) => ({ x: 20 + (i >> 1) * 40, z: i % 2 ? 14 : -14 })).map((h) => ({ ...h, corners: box(h.x, h.z), site: 'V1' }))
const base = { roads: [road], sites: [{ id: 'V1', kind: 'village', x: 160, z: 0 }], buildings: houses, seed: 7 }

test('lamps line the village street, off the road and the houses, vanilla spacing', () => {
  const L = streetLights(base)
  assert.ok(L.length >= 4, `lamps ${L.length}`)
  assert.ok(L.length <= Math.round(0.3 * houses.length) + 1)
  for (const l of L) {
    assert.ok(Math.abs(l.z) > 3.5 + 0.7, `lamp ${l.id} on the carriageway (z ${l.z})`)
    assert.ok(Math.abs(l.z) < 3.5 + 3.7, `lamp ${l.id} too far (z ${l.z})`)
    assert.ok(!houses.some((h) => Math.abs(h.x - l.x) < 5 && Math.abs(h.z - l.z) < 5), `lamp ${l.id} in a house`)
    assert.ok(Object.values(LAMP_PREFABS).includes(l.prefab))
    assert.equal(l.site, 'V1')
    // arm lamps face the road (bearing lamp -> axis: 0 deg = +Z when south of it, 180 when north)
    if (l.family === 'E02' || l.family === 'E03') assert.equal(l.yaw, l.z < 0 ? 0 : 180)
  }
  const xs = L.map((l) => l.x).sort((a, b) => a - b)
  for (let i = 1; i < xs.length; i++) assert.ok(xs[i] - xs[i - 1] >= 12, 'min spacing')
  assert.deepEqual(streetLights(base), L, 'deterministic')
  assert.deepEqual(lampConsumers(L), [{ siteId: 'V1', lamps: L.map((l) => l.id) }])
})

test('no lamp outside the settlements, on a motorway or a forest track, nor on a power pole', () => {
  assert.equal(streetLights({ ...base, sites: [{ id: 'V1', kind: 'village', x: 5000, z: 0 }] }).length, 0)
  assert.equal(streetLights({ ...base, roads: [{ ...road, type: 'motorway' }] }).length, 0)
  assert.equal(streetLights({ ...base, roads: [{ ...road, type: 'trailForest' }] }).length, 0)
  const L = streetLights(base)
  const poles = L.flatMap((l) => [l.x + 0.5, l.z])
  for (const l of streetLights({ ...base, poles })) assert.ok(!L.some((p) => Math.hypot(p.x + 0.5 - l.x, p.z - l.z) < 2.5))
})

test('pre-send: lamp on the carriageway is pushed off, lamp in a house is dropped', () => {
  const zones = [{ id: 'STREETLIGHTS', entities: [
    { id: 'LAMP_1', prefab: LAMP_PREFABS.E03, x: 50, z: 1 },
    { id: 'LAMP_2', prefab: LAMP_PREFABS.E02, x: 100, z: 30 },
    { id: 'LAMP_3', prefab: LAMP_PREFABS.E01_4m, x: 150, z: 6 },
  ] }]
  const settled = [{ id: 'H1', x: 100, z: 30, prefab: 'House.et', corners: box(100, 30) }]
  const is = preSendChecks({ width: 512, height: 512, settled, zones, roads: [{ id: 'R1', half: 3.5, line: [0, 0, 400, 0] }] })
  assert.deepEqual(is.map((i) => i.kind + ' ' + i.id), ['lampOnRoad LAMP_1 / R1', 'lampInBuilding LAMP_2 / H1'])
  const mv = is[0].fix
  assert.ok(mv && mv.op === 'move' && Math.abs(1 + mv.dz - (3.5 + 0.8)) < 0.01)
})
