import { test } from 'node:test'
import assert from 'node:assert/strict'
import { stampTemplate, vanillaTemplates, pickTemplate, type VanillaTemplate } from '../../src/modules/vanillaSites.ts'

const T: VanillaTemplate = {
  id: 't', map: 'x', x: 0, z: 0, axisYaw: 0, roadDist: 10, roadType: null, radius: 20, slope: 0,
  objects: [{ p: 'A', dx: 0, dz: 10, yaw: 0 }, { p: 'B', dx: 5, dz: 0, yaw: 30 }],
}

test('stamp: translation only (yaw 0)', () => {
  const e = stampTemplate(T, 100, 200, 0)
  assert.deepEqual([e[0].x, e[0].z, e[0].yaw], [100, 210, 0])
  assert.deepEqual([e[1].x, e[1].z, e[1].yaw], [105, 200, 30])
})

test('stamp: rotation 90 turns local +Z to world +X, local +X to world -Z', () => {
  const e = stampTemplate(T, 100, 200, 90)
  assert.ok(Math.abs(e[0].x - 110) < 1e-6 && Math.abs(e[0].z - 200) < 1e-6)
  assert.ok(Math.abs(e[1].x - 100) < 1e-6 && Math.abs(e[1].z - 195) < 1e-6)
  assert.equal(e[1].yaw, 120)
})

test('stamp: snap + skip + radius', () => {
  const e = stampTemplate(T, 0, 0, 0, { groundAt: (x, z) => x + z, skip: /^B$/ })
  assert.equal(e.length, 1); assert.equal(e[0].ycm, 1000)
  assert.equal(stampTemplate(T, 0, 0, 0, { maxRadius: 6 }).length, 1)
})

test('library: military base and port templates exist, objects capped', () => {
  for (const k of ['military_base', 'checkpoint', 'port']) {
    const l = vanillaTemplates(k)
    assert.ok(l.length >= 1, k)
    for (const t of l) { assert.ok(t.objects.length > 0 && t.objects.length <= 300); assert.ok(t.objects.every((o) => /^\{[0-9A-F]{16}\}Prefabs\//.test(o.p))) }
  }
  assert.ok(pickTemplate('military_base', 7))
})
