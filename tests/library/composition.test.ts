// Composition importer (src/library/composition.ts) + composition-dressed parcels.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseComposition, importComposition, compoId } from '../../src/library/composition.ts'
import { defaultLibrary, validatePack, COMPOSITIONS_PACK } from '../../src/library/index.ts'
import { LOT_TEMPLATES, generateParcel, demoLot } from '../../src/biomes/parcel.ts'

// "Casseburne" composition: an empty GenericEntity parent, one child, a $grp of two, and a child
// with its own (rotated) sub-child
const ET = `GenericEntity {
 ID "1"
 coords 1000 50 2000
 {
  GenericEntity : "{1111111111111111}Prefabs/Props/Civilian/Bench_01.et" {
   ID "2"
   coords 2 0 0
   angles 0 90 0
  }
  $grp GenericEntity : "{2222222222222222}Prefabs/Props/Civilian/Bucket_01.et" {
   {
    ID "3"
    coords -2 0 0
   }
   {
    ID "4"
    coords -2 0 4
    scale 0.5
   }
  }
  GenericEntity : "{3333333333333333}Prefabs/Structures/Houses/Shed_01.et" {
   ID "5"
   coords 0 0 -4
   angles 0 90 0
   {
    GenericEntity : "{4444444444444444}Prefabs/Props/Civilian/Barrel_01.et" {
     ID "6"
     coords 0 0 1
    }
   }
  }
 }
}`

test('parseComposition: children, $grp instances, nested transforms; empty parent skipped', () => {
  const p = parseComposition(ET)
  assert.equal(p.root, null)
  assert.equal(p.items.length, 5)
  const [bench, b1, b2, shed, barrel] = p.items
  assert.deepEqual([bench.x, bench.z, bench.yaw], [2, 0, 90])
  assert.ok(bench.prefab.endsWith('Bench_01.et'))
  assert.deepEqual([b1.x, b1.z], [-2, 0])
  assert.equal(b2.scale, 0.5)
  assert.deepEqual([shed.x, shed.z], [0, -4])
  // child (0,0,1) under yaw 90: x' = lz*sin = 1, z' = lz*cos = 0 -> world (1, -4)
  assert.ok(Math.abs(barrel.x - 1) < 1e-3 && Math.abs(barrel.z + 4) < 1e-3, `${barrel.x},${barrel.z}`)
  assert.equal(barrel.yaw, 90)
})

test('importComposition: re-centred, size = bounds + margin, valid in a pack', () => {
  const c = importComposition(ET, { id: compoId('My_Garden_01.et'), name: 'My garden', biomes: ['temperate_everon'], tags: ['garden'], source: 'vanilla', author: 't', licence: 'CC0-1.0' })
  assert.equal(c.id, 'my-garden-01')
  assert.deepEqual(c.size, { w: 6, d: 10 })
  const xs = c.items.map((i) => i.x), zs = c.items.map((i) => i.z)
  assert.equal(Math.min(...xs) + Math.max(...xs), 0)
  assert.equal(Math.min(...zs) + Math.max(...zs), 0)
  assert.deepEqual(validatePack({ format: 'reforger-mapper.assetpack', version: 1, id: 'x', name: 'x', author: 'x', licence: 'x', source: 'vanilla', assets: [], compositions: [c] }), [])
  assert.throws(() => importComposition('nothing here', { ...c }))
})

test('vanilla compositions pack is valid; parcels use it only when asked', () => {
  assert.deepEqual(validatePack(COMPOSITIONS_PACK), [])
  assert.ok(COMPOSITIONS_PACK.compositions!.length >= 10)
  const lib = defaultLibrary(), t = LOT_TEMPLATES[2], lot = demoLot(t.size.w[1], t.size.d[1])
  const plain = generateParcel(lib, 'temperate_everon', t, lot, 3)
  assert.equal(plain.compositions, undefined)
  const dressed = generateParcel(lib, 'temperate_everon', t, lot, 3, { compositions: true })
  assert.ok(dressed.compositions && dressed.compositions.length > 0, dressed.warnings.join('; '))
  assert.ok(dressed.items.length > plain.items.length)
  for (const it of dressed.items) assert.ok(Math.abs(it.x) <= lot.w / 2 + 0.01 && Math.abs(it.z) <= lot.d / 2 + 0.01)
  assert.deepEqual(generateParcel(lib, 'temperate_everon', t, lot, 3, { compositions: true }), dressed)
})
