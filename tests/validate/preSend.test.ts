import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyFixes, preSendChecks } from '../../src/validate/preSend'

const box = (id: string, x: number, z: number, h = 4) => ({ id, x, z, prefab: 'Prefabs/Structures/Houses/H.et', corners: [x - h, z - h, x + h, z - h, x + h, z + h, x - h, z + h] })

test('overlap, on-road and outside are found and fixed', () => {
  const settled = [box('A', 50, 50), box('B', 53, 50), box('C', 100, 21)]
  const zones = [{ id: 'IND_1', entities: [{ id: 'IND_1_E0', prefab: 'Crate.et', x: 300, z: 10, yaw: 0 }] }]
  const roads = [{ id: 'R1', half: 3, line: [0, 20, 200, 20] }]
  const is = preSendChecks({ width: 256, height: 256, settled, zones, roads })
  assert.deepEqual(is.map((i) => i.kind).sort(), ['bldgOverlap', 'entOutside', 'onRoad'])
  applyFixes(is.flatMap((i) => (i.fix ? [i.fix] : [])), settled, zones)
  assert.equal(settled.length, 2)
  assert.equal(zones[0].entities.length, 0)
  assert.equal(preSendChecks({ width: 256, height: 256, settled, zones, roads }).length, 0)
})
