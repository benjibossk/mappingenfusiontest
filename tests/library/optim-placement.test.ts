import { test } from 'node:test'
import assert from 'node:assert/strict'
import { scatterLayers, BAND_LAYERS } from '../../src/modules/vegLayers.ts'
import { wbLayerName, wbLayerType, withWbLayers } from '../../src/modules/layers.ts'
import { alignsToSlope, slopeTilt, withSlopeTilt } from '../../src/modules/slopeAlign.ts'
import { cliffRocks, CLIFF_PREFABS } from '../../src/modules/cliffRocks.ts'
import { simplifyLake, densifyRing, ringSelfIntersects, LAKE_MAX_SPACING } from '../../src/modules/water.ts'

test('open-ground scatter emits no low bush / grass entities by default (surface clutter does that)', () => {
  const low = new Set(Object.values(BAND_LAYERS).flatMap((b) => b.groundCover.prefabs))
  const es = scatterLayers({ box: { minX: 0, minZ: 0, maxX: 1500, maxZ: 1500 }, heightAt: () => 50, slopeAt: () => 0.1, maxHeight: 300, ok: () => true, seed: 3 })
  assert.ok(es.length > 0)
  assert.equal(es.filter((e) => low.has(e.prefab)).length, 0)
  assert.equal(es.filter((e) => /calamagrostis|rubus_idaeus|phragmites/i.test(e.prefab)).length, 0)
})

test('Workbench layers: type + 2 km square, explicit layer kept', () => {
  assert.equal(wbLayerName('forests', 4100, 1999), 'forests_2_0')
  assert.equal(wbLayerType('SCAT_UNDERSTORY_4', '{X}Prefabs/Vegetation/Bush/b.et'), 'forests')
  assert.equal(wbLayerType('ROAD_SIGN_1', '{X}Prefabs/Props/Signs/a.et'), 'roads')
  assert.equal(wbLayerType('CLIFF_3', '{X}Prefabs/Rocks/Granite/GraniteCliff_01.et'), 'relief')
  assert.equal(wbLayerType('SET_VILLAGE_1_H2', '{X}Prefabs/Structures/Houses/h.et'), 'settlements')
  const out = withWbLayers([{ id: 'A', prefab: 'p', x: 10, z: 10 }, { id: 'B', prefab: 'p', x: 10, z: 10, layer: 'mine' }])
  assert.equal(out[0].layer, 'settlements_0_0')
  assert.equal(out[1].layer, 'mine')
})

test('slope tilt: fences / props follow the slope, buildings and trees stay upright', () => {
  const h = (x: number) => x * 0.2 // rises 0.2 m per m eastwards
  assert.equal(alignsToSlope({ id: 'F', prefab: '{X}Prefabs/Structures/Walls/Pole/PoleFence_01_3m.et' }), true)
  assert.equal(alignsToSlope({ id: 'H', prefab: '{X}Prefabs/Structures/Houses/House_01.et' }), false)
  assert.equal(alignsToSlope({ id: 'T', prefab: '{X}Prefabs/Vegetation/Tree/Pine.et' }), false)
  assert.equal(alignsToSlope({ id: 'B', prefab: '{X}Prefabs/Props/Crate.et', ycm: 500 }), false)
  // facing east (yaw 90): the slope is along the prefab's forward axis -> pitch only
  const [p, r] = slopeTilt(h, 0, 0, 90)
  assert.equal(p, -11)
  assert.equal(r, 0)
  // facing north: the slope is sideways -> roll only
  const [p2, r2] = slopeTilt(h, 0, 0, 0)
  assert.equal(p2, 0)
  assert.equal(Math.abs(r2), 11)
  const es = withSlopeTilt([
    { id: 'F', prefab: '{X}Prefabs/Structures/Walls/Pole/PoleFence_01_3m.et', x: 0, z: 0, yaw: 90 },
    { id: 'H', prefab: '{X}Prefabs/Structures/Houses/House_01.et', x: 0, z: 0, yaw: 90 },
    { id: 'G', prefab: '{X}Prefabs/Props/Crate.et', x: 0, z: 0, yaw: 0 },
  ], h)
  assert.equal(es[0].pitch, -11)
  assert.equal(es[1].pitch, undefined)
  // flat ground: nothing written
  assert.equal(es[2].roll, -11)
  assert.equal(withSlopeTilt([{ id: 'G', prefab: '{X}Prefabs/Props/Crate.et', x: 0, z: 0, yaw: 0 }], () => 5)[0].pitch, undefined)
})

test('cliff rocks: only on steep ground, kept off forbidden cells, faces downhill', () => {
  // west half flat, east half a 45+ deg wall rising eastwards
  const h = (x: number) => (x < 500 ? 10 : 10 + (x - 500) * 1.2)
  const es = cliffRocks({ box: { minX: 0, minZ: 0, maxX: 1000, maxZ: 400 }, heightAt: h, ok: (x, z) => z > 100, seed: 1 })
  assert.ok(es.length > 50)
  for (const e of es) {
    assert.ok(e.x >= 495, `flat ground at ${e.x}`)
    assert.ok(e.z > 100)
    assert.ok(CLIFF_PREFABS.cliff.includes(e.prefab) || CLIFF_PREFABS.rock.includes(e.prefab))
    // downhill = west = yaw ~270
    assert.ok(Math.abs(e.yaw - 270) <= 16, `yaw ${e.yaw}`)
  }
  assert.ok(es.some((e) => CLIFF_PREFABS.cliff.includes(e.prefab)))
  assert.deepEqual(es, cliffRocks({ box: { minX: 0, minZ: 0, maxX: 1000, maxZ: 400 }, heightAt: h, ok: (x, z) => z > 100, seed: 1 }))
})

test('lake banks: long chords split toward vanilla spacing, smoothed, simple, capped', () => {
  // a 20-gon of radius 200 m: chords of ~63 m
  const ring: number[] = []
  for (let i = 0; i < 20; i++) { const a = -(i / 20) * Math.PI * 2; ring.push(500 + 200 * Math.cos(a), 500 + 200 * Math.sin(a)) }
  const d = densifyRing(ring, 60)
  const n = d.length / 2
  assert.ok(n > 20 && n <= 60, `points ${n}`)
  assert.equal(ringSelfIntersects(d), false)
  let maxEdge = 0
  for (let i = 0; i < n; i++) { const j = (i + 1) % n; maxEdge = Math.max(maxEdge, Math.hypot(d[j * 2] - d[i * 2], d[j * 2 + 1] - d[i * 2 + 1])) }
  assert.ok(maxEdge < 63)
  // inserted points lie on the smoothed curve (outside the straight chord, close to the circle)
  for (let i = 0; i < n; i++) assert.ok(Math.abs(Math.hypot(d[i * 2] - 500, d[i * 2 + 1] - 500) - 200) < 2)
  // small lake: everything within the vanilla range
  const small: number[] = []
  for (let i = 0; i < 12; i++) { const a = -(i / 12) * Math.PI * 2; small.push(80 * Math.cos(a), 80 * Math.sin(a)) }
  const s = simplifyLake(small)
  for (let i = 0; i < s.length / 2; i++) { const j = (i + 1) % (s.length / 2); assert.ok(Math.hypot(s[j * 2] - s[i * 2], s[j * 2 + 1] - s[i * 2 + 1]) <= LAKE_MAX_SPACING) }
})
