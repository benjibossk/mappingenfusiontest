// P4 #19: real prefab footprints for the Atelier objects (src/atelier/footprints.ts)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { objectFootprint, footprintClashes, FALLBACK_HALF } from '../../src/atelier/footprints.ts'
import { layerObjects, splitLines } from '../../src/atelier/formats/layer.ts'

const HOUSE = 'Prefabs/Structures/Houses/Village/House_Village_E_1I01/House_Village_E_1I01.et' // .xob 9.9 x 12.47 m
const side = (c: number[], i: number) => Math.hypot(c[i + 2] - c[i], c[i + 3] - c[i + 1])

test('footprint: measured dims of a known prefab, rotated with the layer convention', () => {
  const f = objectFootprint({ x: 100, z: 200, yaw: 0, prefab: HOUSE }, FALLBACK_HALF.house)
  assert.ok(f.measured)
  assert.ok(Math.abs(side(f.corners, 0) - 9.9) < 0.01 && Math.abs(side(f.corners, 2) - 12.47) < 0.01)
  const r = objectFootprint({ x: 100, z: 200, yaw: 90, prefab: '{EDBC0E94793BA9F1}' + HOUSE }, 5)
  // yaw 90: local +X goes to world -Z (layer.ts toWorld), so the 9.9 m side lies along Z
  assert.ok(Math.abs(Math.abs(r.corners[3] - r.corners[1]) - 9.9) < 0.01 && Math.abs(r.corners[2] - r.corners[0]) < 0.01)
})

test('footprint: unknown prefab keeps the old square', () => {
  const f = objectFootprint({ x: 0, z: 0, prefab: 'Prefabs/Structures/Nope/Nope.et' }, 9)
  assert.ok(!f.measured)
  assert.ok(Math.abs(side(f.corners, 0) - 18) < 1e-9)
})

test('layer objects carry prefab + yaw; clashes found on real footprints, not on the old squares', () => {
  const ent = (x: number, z: number, yaw: number) => `GenericEntity : "{EDBC0E94793BA9F1}${HOUSE}" {\n coords ${x} 10 ${z}\n angles 0 ${yaw} 0\n}`
  // 11 m apart: the 10 m default squares would not touch, the real 12.47 m deep houses (along Z) do
  const text = [ent(500, 500, 0), ent(500, 511, 0), ent(700, 700, 0)].join('\n')
  const o = layerObjects(splitLines(text).lines)
  assert.equal(o.buildings.length, 3)
  assert.equal(o.buildings[0].prefab, HOUSE)
  const real = o.buildings.map((b) => objectFootprint(b, FALLBACK_HALF.house))
  assert.deepEqual(footprintClashes(real), [[0, 1]])
  const squares = o.buildings.map((b) => objectFootprint({ x: b.x, z: b.z }, FALLBACK_HALF.house))
  assert.deepEqual(footprintClashes(squares), [])
})
