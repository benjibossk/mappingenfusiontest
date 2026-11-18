import { test } from 'node:test'
import assert from 'node:assert/strict'
import { roleOf, withRoles } from '../../src/modules/roles.ts'
import { duplicateEntities, roleCounts } from '../../src/modules/validate.ts'
import type { ProjectEntity } from '../../src/project.ts'

test('roleOf: cover is essential, props pc, grass clutter', () => {
  assert.equal(roleOf('{A}Prefabs/Structures/Houses/House_01.et', 'h1'), 'essential')
  assert.equal(roleOf('{A}Prefabs/Structures/Bridges/Bridge_Wood.et', 'b'), 'essential')
  assert.equal(roleOf('{A}Prefabs/Structures/Walls/StoneWall_02.et', 'w'), 'essential')
  assert.equal(roleOf('{A}Prefabs/Props/Military/Sandbag_Wall.et', 's'), 'essential')
  assert.equal(roleOf('{A}Prefabs/Props/Cemetery/Gravestone_03.et', 'g'), 'pc')
  assert.equal(roleOf('{A}Prefabs/Props/Wood/Log_Pile.et', 'l'), 'pc')
  assert.equal(roleOf('{A}Prefabs/Props/Signs/RoadSign_Stop.et', 'r'), 'pc')
  assert.equal(roleOf('{A}Prefabs/Vegetation/Grass/Grass_Tall.et', 'c'), 'clutter')
  assert.equal(roleOf('{A}Prefabs/Vegetation/Flowers/Flower_Red.et', 'f'), 'clutter')
  assert.equal(roleOf('{A}Prefabs/Unknown/Thing.et', 'x'), 'essential')
})

test('withRoles keeps explicit roles, fills the rest', () => {
  const es: ProjectEntity[] = [
    { id: 'a', prefab: 'Grass.et', x: 0, z: 0, yaw: 0, role: 'essential' },
    { id: 'b', prefab: 'Grass.et', x: 0, z: 0, yaw: 0 },
  ]
  const r = withRoles(es)
  assert.deepEqual(r.map((e) => e.role), ['essential', 'clutter'])
  assert.deepEqual(roleCounts(es), { essential: 1, pc: 0, clutter: 1 })
})

test('duplicateEntities: same prefab within 0.5 m only', () => {
  const es: ProjectEntity[] = [
    { id: '1', prefab: 'A.et', x: 10, z: 10, yaw: 0 },
    { id: '2', prefab: 'A.et', x: 10.3, z: 10.2, yaw: 0 },
    { id: '3', prefab: 'B.et', x: 10, z: 10, yaw: 0 },
    { id: '4', prefab: 'A.et', x: 11, z: 10, yaw: 0 },
  ]
  assert.deepEqual(duplicateEntities(es).map((e) => e.id), ['2'])
})
