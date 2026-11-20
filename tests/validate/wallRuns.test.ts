import { test } from 'node:test'
import assert from 'node:assert/strict'
import { VANILLA_SITES, stampTemplate } from '../../src/modules/vanillaSites'
import { wallPiecesToShapes, isLooseWallPiece } from '../../src/modules/wallRuns'

test('a straight run of loose wall pieces becomes one wall-generator polyline', () => {
  const p = '{X}Prefabs/Structures/Walls/Concrete/ConcreteWall_01/ConcreteWall_01_6m_A.et'
  const es = [0, 1, 2, 3].map((i) => ({ id: `w${i}`, prefab: p, x: 100 + 6 * i, z: 50, yaw: 0 }))
  const r = wallPiecesToShapes([...es, { id: 't', prefab: '{Y}Prefabs/Props/Crate.et', x: 0, z: 0, yaw: 0 }], 'T')
  assert.equal(r.entities.length, 1)
  assert.equal(r.shapes.length, 1)
  assert.match(r.shapes[0].generator, /WG_ConcreteWall_01/)
  assert.deepEqual(r.shapes[0].points, [97, 50, 121, 50])
})

test('no vanilla composition keeps a loose wall piece once stamped', () => {
  for (const arr of Object.values(VANILLA_SITES)) for (const t of arr) {
    const r = wallPiecesToShapes(stampTemplate(t, 0, 0, 123), t.id)
    assert.equal(r.entities.filter((e) => isLooseWallPiece(e.prefab)).length, 0, t.id)
  }
})
