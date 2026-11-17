// Extra Zone-tool sites (src/modules/sitesextra.ts): construction site, beach, terraced cemetery
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { inPoly } from '../../src/modules/rowgrid.ts'
import { makeSiteZone, SITE_PREFABS } from '../../src/modules/sitezones.ts'
import { EXTRA_PREFABS, gateFence } from '../../src/modules/sitesextra.ts'

const sq = (r: number, cx = 0, cz = 0) => [cx - r, cz - r, cx + r, cz - r, cx + r, cz + r, cx - r, cz + r]
const road = { pts: [-400, -80, 400, -80], half: 3 }
const flat = () => 100
const has = (list: readonly string[], p: string) => list.includes(p)

test('gateFence: open polyline, gap of the asked width facing the road', () => {
  const g = gateFence(sq(30), SITE_PREFABS.metalWall, 'w', [0, -80], 4)
  assert.equal(g.shape.closed, false)
  assert.ok(g.gate && Math.abs(g.gate[0]) < 0.01 && g.gate[1] < -29)
  const p = g.shape.points, gap = Math.hypot(p[0] - p[p.length - 2], p[1] - p[p.length - 1])
  assert.ok(Math.abs(gap - 4) < 0.01, String(gap))
  assert.ok(g.dir[1] > 0.99, 'inward')
})
test('construction: hoarding with a gate, cabins, materials, slab', () => {
  const poly = sq(40)
  const z = makeSiteZone('construction', poly, { id: 'K', seed: 4, roads: [road], ground: flat })
  assert.ok(z.shapes.some((s) => s.generator === EXTRA_PREFABS.tinWall && !s.closed))
  assert.ok(z.entities.some((e) => has(EXTRA_PREFABS.cabins, e.prefab) || e.prefab === EXTRA_PREFABS.cabinSmall))
  assert.ok(z.entities.filter((e) => has(EXTRA_PREFABS.materials, e.prefab) || has(EXTRA_PREFABS.heaps, e.prefab)).length >= 6)
  assert.ok(z.plat.length === 1)
  for (const e of z.entities) assert.ok(inPoly(poly, e.x, e.z), e.prefab)
})
test('beach: nothing without water; parasols, boats near water, lifeguard tower on the shore', () => {
  const poly = sq(60)
  const dry = makeSiteZone('beach', poly, { id: 'B', seed: 1, roads: [road], ground: flat })
  assert.equal(dry.entities.length, 0)
  const water = (_x: number, z: number) => z > 30 // sea to the north
  const z = makeSiteZone('beach', poly, { id: 'B', seed: 1, roads: [road], ground: flat, ok: (x, zz) => !water(x, zz), water })
  const of = (l: readonly string[]) => z.entities.filter((e) => l.includes(e.prefab))
  assert.ok(of([EXTRA_PREFABS.sunshade, ...EXTRA_PREFABS.sunshadeClosed]).length >= 4)
  assert.ok(of(EXTRA_PREFABS.loungers).length >= 4)
  assert.equal(of(EXTRA_PREFABS.lifeguard).length, 1)
  const boats = of(EXTRA_PREFABS.boats)
  assert.ok(boats.length >= 1 && boats.every((b) => b.z > 20 && b.z <= 30), 'boats on the shore')
  assert.ok(z.entities.every((e) => e.z <= 30 && inPoly(poly, e.x, e.z)), 'all on land')
  assert.ok(z.boxes.some((b) => b.role === 'sand'))
  assert.ok(Math.abs(z.yaw) < 20, 'facing the sea (+Z)')
})
test('cemetery: chapel or calvary, denser rows, terraces on a slope', () => {
  const z = makeSiteZone('cemetery', sq(30), { id: 'C', seed: 2, roads: [road], ground: flat })
  assert.ok(z.entities.some((e) => has(EXTRA_PREFABS.chapel, e.prefab) || has(EXTRA_PREFABS.calvary, e.prefab)))
  assert.ok(z.entities.filter((e) => has(SITE_PREFABS.graves, e.prefab) || has(EXTRA_PREFABS.graveFence, e.prefab)).length > 200)
  const slope = (x: number) => 100 + x * 0.18 // rising east, steeper than the flat limit (0.12)
  const s = makeSiteZone('cemetery', sq(30), { id: 'C', seed: 2, roads: [road], ground: slope })
  assert.ok(s.plat.length >= 5, 'terraces')
  assert.ok(s.entities.filter((e) => has(SITE_PREFABS.graves, e.prefab)).length > 100)
})
