// Atelier zones (src/atelier/zones/*): full-res height adapter, zone clipping, avoidance of existing content,
// and the guarantee that a zone send never writes heights.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { HeightGrid } from '../../src/atelier/heights.ts'
import { heightAt } from '../../src/atelier/heights.ts'
import { cropHeights, ringBox } from '../../src/atelier/zones/adapter.ts'
import { zoneWorld, nearestOnRoads, EMPTY_WORLD } from '../../src/atelier/zones/world.ts'
import { generateZone, type ZoneSpec } from '../../src/atelier/zones/generate.ts'
import { assertZoneSafe, sendZone, zoneDeleteProject, zoneFamily, zoneProject, zoneTag } from '../../src/atelier/zones/send.ts'
import { sampler } from '../../src/modules/settlements.ts'
import { pointInPoly } from '../../src/modules/industrial.ts'

/** gentle synthetic world, 1 m cells, any size (no 768 cap) */
function world(side: number, cell = 1): HeightGrid {
  const cols = side + 1, h = new Float32Array(cols * cols)
  for (let r = 0; r < cols; r++) for (let c = 0; c < cols; c++) h[r * cols + c] = 20 + Math.sin(c * cell / 180) * 3 + Math.cos(r * cell / 230) * 2 + (c % 7) * 0.01
  let min = Infinity, max = -Infinity
  for (const v of h) { min = Math.min(min, v); max = Math.max(max, v) }
  return { cols, rows: cols, cell, h, min, max, missing: 0 }
}
const H = world(4096) // ZBK_Island size: 4097 x 4097 samples at 1 m
const RING = [1500, 1500, 1900, 1500, 1900, 1850, 1500, 1850]

test('adapter: crop of a 4096 m world keeps the native 1 m cell and samples it exactly', () => {
  const z = cropHeights(H, [1000.4, 2000.2, 1600.7, 2400.9])
  assert.equal(z.k, 1)
  assert.equal(z.grid.step, 1)
  assert.equal(z.grid.minX, 1000); assert.equal(z.grid.minZ, 2000)
  assert.equal(z.grid.cols, 602); assert.equal(z.grid.rows, 402)
  const at = sampler(z.heights, z.grid)
  for (const [x, zz] of [[1000, 2000], [1234.5, 2222.25], [1599.9, 2399.1]]) assert.ok(Math.abs(at(x, zz) - heightAt(H, x, zz)) < 1e-3, `at ${x},${zz}`)
  assert.equal(cropHeights(H, [0, 0, 1500, 1500]).grid.cols, 1501) // no 768 generator cap on this path
})

test('adapter: memory bounded on a huge box (k > 1), still exact at nodes', () => {
  const z = cropHeights(H, [0, 0, 4096, 4096], 1_000_000)
  assert.ok(z.grid.cols * z.grid.rows <= 1_000_000)
  assert.ok(z.k > 1 && z.grid.step === z.k)
  const at = sampler(z.heights, z.grid)
  assert.ok(Math.abs(at(z.k * 10, z.k * 20) - H.h[z.k * 20 * H.cols + z.k * 10]) < 1e-4)
})

test('world: existing roads / buildings / water near the zone become generator inputs', () => {
  const objects = { roads: [{ type: 'asphalt' as const, pts: [[1400, 1700], [2000, 1700]] as [number, number][] }, { type: 'dirt' as const, pts: [[100, 100], [200, 100]] as [number, number][] }], buildings: [{ x: 1600, z: 1600, type: 'house' as const, yaw: 0 }], trees: [], port: [], walls: [], entities: 2 }
  const w = zoneWorld(objects, [], [1550, 1750, 3900, 3900], ringBox(RING))
  assert.equal(w.roads.length, 1)
  assert.equal(w.roads[0].width, 7)
  assert.equal(w.footprints.length, 1)
  assert.deepEqual(w.power, [1550, 1750])
  const n = nearestOnRoads(w.roads, 1600, 1720)
  assert.ok(Math.abs(n[1] - 1700) < 1e-9 && Math.abs(n[2] - 20) < 1e-9)
})

const spec = (o: Partial<ZoneSpec> = {}): ZoneSpec => ({ name: 'Test', ring: RING, seed: 3, villages: true, power: true, fields: false, links: true, forest: false, ...o })

test('generate: village inside the zone, clear of existing roads and buildings, link snapped to the road', () => {
  const objects = { roads: [{ type: 'asphalt' as const, pts: [[1300, 1300], [1300, 2100]] as [number, number][] }], buildings: [1650, 1700, 1750].map((x) => ({ x, z: 1790, type: 'house' as const, yaw: 0 })), trees: [], port: [], walls: [], entities: 4 }
  const w = zoneWorld(objects, [], [], [1200, 1200, 2200, 2200])
  const r = generateZone(H, w, spec())
  assert.ok(r.placed.length > 0, 'houses built')
  assert.equal(r.heights.step, 1)
  for (const q of r.placed) for (let i = 0; i < 8; i += 2) assert.ok(pointInPoly(RING, q.corners[i], q.corners[i + 1]), 'house inside the zone')
  // never on an existing building footprint
  for (const q of r.placed) for (const f of w.footprints) {
    const [ax0, ax1] = [Math.min(...f.filter((_, i) => i % 2 === 0)), Math.max(...f.filter((_, i) => i % 2 === 0))]
    const [az0, az1] = [Math.min(...f.filter((_, i) => i % 2)), Math.max(...f.filter((_, i) => i % 2))]
    assert.ok(!(q.x > ax0 && q.x < ax1 && q.z > az0 && q.z < az1), 'house origin on an existing building')
  }
  // houses keep clear of the existing road (x = 1300 lies outside the zone anyway), link ends on it
  const link = r.links.find((l) => l.id.includes('LINK'))
  assert.ok(link, 'link road made')
  assert.ok(Math.abs(link!.pts[0] - 1300) < 1e-6, 'link snapped on the existing road')
  assert.ok(r.stations.length >= 1, 'substation')
})

test('generate: power line to the existing network, villages avoid an existing road crossing the zone', () => {
  const objects = { roads: [{ type: 'asphalt' as const, pts: [[1450, 1675], [1950, 1675]] as [number, number][] }], buildings: [], trees: [], port: [], walls: [], entities: 1 }
  const w = zoneWorld(objects, [], [2400, 1700], [1000, 1000, 2600, 2600])
  const r = generateZone(H, w, spec({ seed: 5 }))
  assert.ok(r.placed.length > 0)
  for (const q of r.placed) for (let i = 0; i < 8; i += 2) assert.ok(Math.abs(q.corners[i + 1] - 1675) > 3.4, 'building on the existing road')
  const mv = r.power.find((l) => l.id.includes('MV'))
  assert.ok(mv, 'MV line to the existing pole')
  assert.ok(Math.hypot(mv!.path[mv!.path.length - 2] - 2400, mv!.path[mv!.path.length - 1] - 1700) < 1e-6)
})

test('send: zone project = entities + shapes in MG_Zone_<name>_* layers, one family, no heights', async () => {
  const r = generateZone(H, EMPTY_WORLD, spec({ power: false, links: false, fields: true, forest: true }))
  const tag = zoneTag('Bel Air_2!'), p = zoneProject(r, tag)
  assert.equal(tag, 'BelAir2')
  assert.ok(p.entities!.length > 0 && p.shapes.length > 0)
  for (const e of p.entities!) { assert.ok(e.id.startsWith(zoneFamily(tag))); assert.ok(e.layer!.startsWith('Zone_BelAir2_')); assert.equal(e.ycm, undefined) }
  for (const s of p.shapes) assert.ok(s.id.startsWith('MGZBelAir2_'))
  const calls: string[] = []
  await sendZone(p, async (path, body) => { calls.push(path); assert.ok(!('heights' in (body as object))); return 'ok' })
  await sendZone(zoneDeleteProject(tag, p), async (path) => { calls.push(path); return 'ok' })
  assert.deepEqual(calls, ['/apply', '/apply']) // never /heightmap, /masks, /setup-world
  assert.throws(() => assertZoneSafe('/heightmap', p as never), /refused/)
  assert.throws(() => assertZoneSafe('/apply', { ...p, heights: [1] } as never), /refused/)
  assert.throws(() => assertZoneSafe('/apply', { ...p, setupWorld: {} } as never), /refused/)
  assert.throws(() => assertZoneSafe('/apply', { ...p, noHeights: false } as never), /noHeights/)
})
