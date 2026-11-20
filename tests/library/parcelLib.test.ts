// Parcel library (src/library/parcelLib.ts): vanilla harvest pack, categories, placement along roads,
// Workbench-saved parcels, stamping as a zone.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PARCELS_PACK, validatePack } from '../../src/library/index.ts'
import { addParcels, allParcels, parcelCorners, parcelsByCategory, pickParcel, roadClearance, savedToComposition, suggestParcelSpots, yawToRoad } from '../../src/library/parcelLib.ts'
import { makeLibraryParcel } from '../../src/modules/zones.ts'
import { isLooseWallPiece } from '../../src/modules/wallRuns.ts'

test('vanilla parcels pack is valid and covers every harvested category', () => {
  assert.deepEqual(validatePack(PARCELS_PACK), [])
  const g = parcelsByCategory()
  for (const k of ['garden', 'farm', 'cemetery', 'industrial', 'fuel', 'roadside', 'allotment', 'sport'] as const) assert.ok((g.get(k)?.length ?? 0) > 0, k)
  assert.equal(g.get('farm')!.filter((c) => !c.subtype).length, 109) // the farmsteads (subtyped: RP apiaries)
  for (const c of allParcels()) {
    assert.ok(c.size.w > 0 && c.size.d > 0)
    for (const i of c.items) assert.ok(Math.abs(i.x) <= c.size.w / 2 + 0.5 && Math.abs(i.z) <= c.size.d / 2 + 0.5, `${c.id} ${i.prefab}`)
  }
})

test('pickParcel respects category, footprint and biome', () => {
  const c = pickParcel('garden', { maxW: 30, maxD: 30, biome: 'woodland_arland', seed: 3 })!
  assert.equal(c.category, 'garden')
  assert.ok(c.size.w <= 30 && c.size.d <= 30)
  assert.ok(c.biomes.includes('woodland_arland'))
  assert.equal(pickParcel('garden', { maxW: 1, maxD: 1 }), null)
})

test('suggested spots face the road, clear of the road and of the obstacles', () => {
  const c = pickParcel('garden', { maxW: 30, maxD: 30 })!
  const roads = [{ pts: [0, 0, 400, 0], width: 6 }]
  const spots = suggestParcelSpots(c, { roads, blocked: [{ x: 60, z: 25, r: 15 }], n: 6 })
  assert.ok(spots.length >= 4)
  for (const s of spots) {
    const cs = parcelCorners(c, s.x, s.z, s.yaw)
    for (let k = 0; k < 8; k += 2) assert.ok(roadClearance(roads, cs[k], cs[k + 1]) >= 1.4)
    assert.ok(Math.hypot(s.x - 60, s.z - 25) >= 15)
    const y = yawToRoad(roads, s.x, s.z)!
    assert.ok(Math.abs((((y - s.yaw) % 360) + 540) % 360 - 180) < 1, 'front (+Z) turned to the road')
  }
})

test('Workbench-saved parcel imports into the library', () => {
  const c = savedToComposition({ name: 'Mon jardin', category: 'garden', items: [
    { prefab: '{AAAAAAAAAAAAAAAA}Prefabs/Structures/Houses/House_A.et', x: 0, y: 0, z: 0, yaw: 0 },
    { prefab: '{BBBBBBBBBBBBBBBB}Prefabs/Vegetation/Tree/Cypress.et', x: 6, z: -4, yaw: 10, scale: 1.2 },
    { prefab: 'not a prefab', x: 1, z: 1, yaw: 0 }] })!
  assert.equal(c.id, 'wb-mon-jardin'); assert.equal(c.items.length, 2); assert.equal(c.category, 'garden')
  assert.deepEqual(validatePack({ format: 'reforger-mapper.assetpack', version: 1, id: 'x', name: 'x', author: 'a', licence: 'l', source: 'vanilla', assets: [], compositions: [c] }), [])
  addParcels([c])
  assert.ok(parcelsByCategory().get('garden')!.some((x) => x.id === 'wb-mon-jardin'))
  assert.equal(savedToComposition({ name: 'vide', items: [] }), null)
})

test('a library parcel stamps as a site zone with every object', () => {
  const g = { cols: 50, rows: 50, step: 10, minX: -250, minZ: -250 } as never
  const heights = new Array(2500).fill(12)
  const c = parcelsByCategory().get('cemetery')![0]
  const zn = makeLibraryParcel(heights, g, { id: 'SITE_1', parcel: c, x: 10, z: 20, yaw: 90 })!
  const walls = c.items.filter((q) => isLooseWallPiece(q.prefab)).length // wall pieces become WG shapes (wallRuns.ts)
  assert.equal(zn.entities.length, c.items.length - walls)
  assert.ok(!walls || zn.shapes.length > 0)
  assert.equal(zn.sub, `parcel:${c.id}`)
  assert.ok(zn.entities.every((e) => e.id.startsWith('SITE_1_')))
  assert.equal(zn.flat[0].h0, 12)
})
