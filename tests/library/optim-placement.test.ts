import { test } from 'node:test'
import assert from 'node:assert/strict'
import { scatterLayers, BAND_LAYERS } from '../../src/modules/vegLayers.ts'
import { wbLayerName, wbLayerType, withWbLayers } from '../../src/modules/layers.ts'
import { alignsToSlope, slopeTilt, withSlopeTilt } from '../../src/modules/slopeAlign.ts'
import { buryRocks, cliffRocks, CLIFF_PREFABS, paintRockSurfaces, rockKind, rockStamps, rockThresholds } from '../../src/modules/cliffRocks.ts'
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

test('cliff rocks: steepest ranks only, kept off forbidden cells, cliffs face downhill, sunk, scree below', () => {
  // west half flat, east half a 50 deg wall rising eastwards
  const h = (x: number) => (x < 500 ? 10 : 10 + (x - 500) * 1.2)
  const o = { box: { minX: 0, minZ: 0, maxX: 1000, maxZ: 400 }, heightAt: h, ok: (x: number, z: number) => z > 100, seed: 1, density: 6 }
  const es = cliffRocks(o)
  assert.ok(es.length > 50)
  for (const e of es) {
    assert.ok(e.x >= 470, `flat ground at ${e.x}`)
    assert.ok(e.z > 100)
    assert.ok(rockKind(e.prefab), e.prefab)
    assert.ok(e.ycm !== undefined && e.ycm <= Math.round(h(e.x) * 100) + 1, `not sunk ${e.prefab}`)
    // downhill = west = yaw ~270
    if (rockKind(e.prefab) === 'cliff') assert.ok(Math.abs(e.yaw - 270) <= 21, `yaw ${e.yaw}`)
  }
  const big = es.filter((e) => CLIFF_PREFABS.rock.includes(e.prefab))
  assert.ok(big.length && big.every((e) => e.ycm! < h(e.x) * 100 - 300), 'GraniteRock sunk > 3 m')
  assert.ok(es.some((e) => CLIFF_PREFABS.cliff.includes(e.prefab)))
  assert.ok(es.some((e) => /Boulder|Cluster|Stone/.test(e.prefab)), 'scree / stones')
  assert.ok(es.some((e) => e.pitch || e.roll), 'tilted')
  assert.deepEqual(es, cliffRocks(o))
})

test('cliff rocks: outcrops of 3+ pieces are whole vanilla groups (scale kept, sunk, off forbidden cells)', () => {
  const h = (x: number) => (x < 500 ? 10 : 10 + (x - 500) * 0.45) // ~24 deg wall: matches many harvested groups
  const o = { box: { minX: 0, minZ: 0, maxX: 1000, maxZ: 400 }, heightAt: h, ok: (x: number, z: number) => z > 100, seed: 2, density: 6 }
  const es = cliffRocks(o)
  const scaled = es.filter((e) => e.scalepm)
  assert.ok(scaled.length > 10, `vanilla-scaled pieces ${scaled.length}`)
  for (const e of es) {
    assert.ok(e.z > 100)
    assert.ok(rockKind(e.prefab), e.prefab)
    assert.ok(e.ycm !== undefined && e.ycm <= Math.round(h(e.x) * 100) + 50, `floating ${e.prefab} ${e.ycm} vs ${h(e.x) * 100}`)
  }
  const off = cliffRocks({ ...o, vanillaGroups: false })
  assert.ok(!off.some((e) => e.scalepm), 'vanillaGroups: false = piece by piece')
})

test('cliff rocks: relative thresholds give rocks on a gentle island (max slope ~20 deg)', () => {
  const h = (x: number, z: number) => 40 + 30 * Math.sin(x / 90) * Math.cos(z / 110) // slopes up to ~0.4 (22 deg)
  const es = cliffRocks({ box: { minX: 0, minZ: 0, maxX: 2000, maxZ: 2000 }, heightAt: h, ok: () => true, seed: 3 })
  assert.ok(es.filter((e) => CLIFF_PREFABS.rock.includes(e.prefab) || /SurfaceStone/.test(e.prefab)).length > 20, `${es.length}`)
  const th = rockThresholds({ box: { minX: 0, minZ: 0, maxX: 2000, maxZ: 2000 }, heightAt: h })
  assert.ok(th.rock < Math.tan(Math.PI / 6) && th.rock >= Math.tan(Math.PI / 15) - 1e-9)
})

test('rock surfaces: scree halo and bare rock painted around the rocks, weights still sum to 1', () => {
  const mk = (name: string, w: number) => ({ name, minX: 0, minZ: 0, step: 4, cols: 30, rows: 30, weights: new Array(900).fill(w) })
  const S = [mk('Grass_01', 0.8), mk('Rock_01', 0), mk('Debris_Rock_01', 0.2), mk('SeaBed_01', 0)]
  const n = paintRockSurfaces(S, rockStamps([{ id: 'a', prefab: CLIFF_PREFABS.cliff[0], x: 60, z: 60, yaw: 0 }]))
  assert.ok(n > 0)
  const i = 15 * 30 + 15
  assert.ok(S[1].weights[i] > 0.6 && S[2].weights[i] > 0.15)
  for (let k = 0; k < 900; k++) assert.ok(Math.abs(S.reduce((a, s) => a + s.weights[k], 0) - 1) < 1e-6)
  assert.equal(S[1].weights[0], 0) // far corner untouched
  const sc = [{ id: 'r', prefab: CLIFF_PREFABS.rock[0], x: 1, z: 1, yaw: 0 }]
  buryRocks(sc, () => 10)
  assert.ok(sc[0].ycm! < 500)
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
