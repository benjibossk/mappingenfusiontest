// Structured Zone-tool sites (src/modules/sitezones.ts) on the shared row / grid placer (src/modules/rowgrid.ts)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fencePerimeter, fencePosts, frameOf, inPoly, rowGrid } from '../../src/modules/rowgrid.ts'
import { makeSiteZone, SITE_PREFABS, SITE_TYPES } from '../../src/modules/sitezones.ts'

const sq = (r: number, cx = 0, cz = 0) => [cx - r, cz - r, cx + r, cz - r, cx + r, cz + r, cx - r, cz + r]
const road = { pts: [-400, -80, 400, -80], half: 3 } // straight road south of the zone, along X
const flat = () => 100
const GUID = /^\{[0-9A-F]{16}\}(Prefabs|PrefabLibrary)\//

test('rowGrid: points inside, margin kept, rows along the road', () => {
  const poly = sq(50)
  const f = frameOf(poly, [road])
  assert.ok(Math.abs(Math.abs(f.ux) - 1) < 1e-6, 'U along the road')
  assert.ok(f.vz > 0.99, 'V away from the road')
  const g = rowGrid(poly, { dx: 5, dz: 5, margin: 4, roads: [road] })
  assert.ok(g.length > 300)
  for (const p of g) { assert.ok(inPoly(poly, p.x, p.z)); assert.ok(Math.abs(p.x) <= 46.01 && Math.abs(p.z) <= 46.01) }
  assert.ok(g.every((p) => Math.abs(p.yaw) < 0.01 || Math.abs(p.yaw - 360) < 0.01), 'facing +Z (away from the road)')
})
test('rowGrid: slope and ok filters', () => {
  const g = rowGrid(sq(50), { dx: 5, dz: 5, ground: (x) => (x > 0 ? x * 0.5 : 0), maxSlope: 0.2, ok: (_x, z) => z < 20 })
  assert.ok(g.length > 0 && g.every((p) => p.x <= 4 && p.z < 20))
})
test('fencePosts: a post at each corner, 4 m panels, no panel under 2 m', () => {
  const pts = fencePosts([0, 0, 10, 0, 10, 9], false, 4, 2)
  const seg: number[] = []
  for (let i = 2; i < pts.length; i += 2) seg.push(Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1]))
  assert.deepEqual([pts[0], pts[1]], [0, 0]); assert.ok(pts.includes(10))
  assert.ok(seg.every((l) => l >= 2 - 1e-6 && l <= 4 + 1e-6), seg.join(','))
  const closed = fencePerimeter(sq(20), SITE_PREFABS.metalWall, 'f')
  assert.ok(closed.closed && closed.points.length / 2 >= 4 * 10)
  const open = fencePerimeter(sq(20), SITE_PREFABS.crashBarrier, 'f', { openNear: [0, -40] })
  assert.equal(open.closed, false)
  assert.ok(open.points.every((v, i) => i % 2 === 0 || v > -19.6 || Math.abs(open.points[i - 1]) >= 19.4), 'south edge left open')
})

test('every site type builds, refs carry a GUID', () => {
  const forest = [100, -300, 400, -300, 400, 300, 100, 300]
  for (const t of SITE_TYPES) {
    const poly = t === 'checkpoint' ? sq(30, 0, -80) : t === 'hunting' ? sq(250, 100, 0) : sq(t === 'cemetery' ? 30 : 60)
    const z = makeSiteZone(t, poly, { id: 'SITE_1', seed: 3, roads: [road], ground: flat, forests: [forest], ...(t === 'beach' ? { ok: (_x: number, zz: number) => zz < 40 } : {}) })
    assert.equal(z.kind, 'site'); assert.equal(z.sub, t)
    assert.ok(z.entities.length + z.shapes.length > 0, t)
    for (const e of z.entities) assert.match(e.prefab, GUID, t)
    for (const s of z.shapes) assert.match(s.generator, GUID, t)
    if (t !== 'checkpoint' && t !== 'hunting') for (const e of z.entities) assert.ok(inPoly(poly, e.x, e.z), `${t} ${e.prefab}`)
  }
})
test('parking: bays, cars on some, lamps, stripes, barrier open on the road side', () => {
  const z = makeSiteZone('parking', sq(40), { id: 'P', seed: 1, roads: [road], ground: flat })
  const n = (p: string) => z.entities.filter((e) => e.prefab === p).length
  const cars = z.entities.filter((e) => (SITE_PREFABS.cars as readonly string[]).includes(e.prefab)).length
  assert.ok(n(SITE_PREFABS.stripe) > 40)
  assert.ok(cars > 5 && cars < n(SITE_PREFABS.stripe))
  assert.ok(n(SITE_PREFABS.lamp) >= 2)
  const bar = z.shapes.find((s) => s.generator === SITE_PREFABS.crashBarrier)!
  assert.equal(bar.closed, false)
})
test('cemetery: brick wall, gravestones in rows with a central aisle', () => {
  const z = makeSiteZone('cemetery', sq(30), { id: 'C', seed: 2, roads: [road], ground: flat })
  const graves = z.entities.filter((e) => (SITE_PREFABS.graves as readonly string[]).includes(e.prefab))
  assert.ok(graves.length > 100)
  assert.ok(!graves.some((g) => Math.abs(g.x) < 0.5), 'aisle')
  assert.ok(z.shapes.some((s) => /BrickWall/.test(s.generator) && !s.closed), 'gate on the road side')
})
test('hunting: stands on the forest edge, >= 150 m apart, facing out', () => {
  const forest = [100, -300, 400, -300, 400, 300, 100, 300]
  const z = makeSiteZone('hunting', sq(300, 100, 0), { id: 'H', seed: 1, roads: [], forests: [forest] })
  const st = z.entities.filter((e) => e.prefab === SITE_PREFABS.deerStand)
  assert.ok(st.length >= 2)
  for (let i = 0; i < st.length; i++) for (let j = i + 1; j < st.length; j++) assert.ok(Math.hypot(st[i].x - st[j].x, st[i].z - st[j].z) >= 150)
  const west = st.filter((s) => Math.abs(s.x - 103) < 0.5)
  assert.ok(west.length && west.every((s) => Math.abs(s.yaw - 270) < 1), 'west edge looks west')
})
test('checkpoint: sized by the road, on it, along it', () => {
  const z = makeSiteZone('checkpoint', sq(30, 0, -80), { id: 'K', seed: 1, roads: [road] })
  const cp = z.entities[0]
  assert.match(cp.prefab, /SlotRoadSmall\/Checkpoint_S_/)
  assert.ok(Math.abs(cp.z + 80) < 0.01 && Math.abs(Math.abs(cp.yaw - 180) - 90) < 0.01)
  const wide = makeSiteZone('checkpoint', sq(30, 0, -80), { id: 'K', seed: 1, roads: [{ ...road, half: 6 }] })
  assert.match(wide.entities[0].prefab, /SlotRoadLarge/)
  assert.ok(makeSiteZone('checkpoint', sq(20), { id: 'K', seed: 1, roads: [road] }).warnings.length)
})
test('orchard rows follow the contour on a slope', () => {
  const z = makeSiteZone('orchard', sq(40), { id: 'O', seed: 1, roads: [], ground: (x) => x * 0.2 })
  const trees = z.entities
  assert.ok(trees.length > 30)
  const xs = new Set(trees.map((t) => Math.round(t.x / 3)))
  assert.ok(xs.size < trees.length / 4, 'rows along Z (contour of an X slope)')
})
