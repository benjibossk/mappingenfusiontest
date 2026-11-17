import { test } from 'node:test'
import assert from 'node:assert/strict'
import { prefabDims, dimsFootprint } from '../../src/library/dims.ts'
import { VANILLA_PACK } from '../../src/library/seed.ts'

const near = (a: number, b: number, tol: number) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`)

test('dims: 2 m wooden fence panel', () => {
  const d = prefabDims('Structures/Walls/Wooden/WoodenFence_01/WoodenFence_01_2m.et')!
  near(d.w, 2.06, 0.05); assert.ok(d.dz < 0.3); near(d.h, 1.54, 0.1)
})

test('dims: lookup by {GUID}path, GUID and path agree', () => {
  const p = '{B27AF198E146D70D}Prefabs/Structures/Houses/Village/House_Village_E_1I01/House_Village_E_1I01_beige.et'
  const a = prefabDims(p)!, c = prefabDims(p.slice(18))!
  assert.deepEqual(a, c)
  assert.deepEqual(prefabDims('3A52FC23A1DCAE53'), prefabDims('Prefabs/Structures/Walls/Wooden/WoodenFence_01/WoodenFence_01_2m.et'))
  near(a.w, 9.9, 0.05); near(a.dz, 12.47, 0.05) // = Workbench measure (prefabs.txt)
})

test('dims: unknown prefab -> null / fallback footprint', () => {
  assert.equal(prefabDims('Nope/Nothing.et'), null)
  const fb = { minX: -1, minZ: -1, maxX: 1, maxZ: 1, h: 2 }
  assert.equal(dimsFootprint('Nope/Nothing.et', fb), fb)
})

test('seed: church footprint and real heights', () => {
  const church = VANILLA_PACK.assets.find((a) => a.guid.includes('Church_01_white'))!
  near(church.footprint.maxZ - church.footprint.minZ, 33.76, 0.1)
  assert.ok(church.footprint.h > 30)
})
