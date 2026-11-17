import { test } from 'node:test'
import assert from 'node:assert/strict'
import { scatterBuildings, ringArea } from '../../src/modules/scattered.ts'
import { inside } from '../../src/modules/settlements.ts'
import type { Road } from '../../src/modules/roads.ts'
import type { Water } from '../../src/modules/water.ts'

// a 1200 x 1000 m zone (120 ha), a road along x = 600, a lake in the south-west corner
const zone = [0, 0, 1200, 0, 1200, 1000, 0, 1000]
const grid = { minX: -200, minZ: -200, step: 8, cols: 201, rows: 201 }
const flat = new Array(201 * 201).fill(20)
const roads: Road[] = [{ id: 'R1', type: 'dirt', pts: [600, -100, 600, 500, 600, 1100] }]
const lake: Water = { id: 'L1', type: 'lake', pts: [0, 0, 300, 0, 300, 300, 0, 300], width: 0, depth: 3 }

test('scattered: few groups, spaced, inside, dry, deterministic', () => {
  const r = scatterBuildings(zone, roads, [lake], flat, grid, { seed: 7, haPerGroup: 20 })
  assert.equal(ringArea(zone), 1_200_000)
  assert.ok(r.groups >= 3 && r.groups <= 6, `groups ${r.groups}`)
  assert.ok(r.placed.length >= r.groups && r.placed.length <= r.groups * 3)
  for (const b of r.placed) for (let i = 0; i < 8; i += 2) {
    assert.ok(inside(zone, b.corners[i], b.corners[i + 1]), 'corner outside')
    assert.ok(!inside(lake.pts, b.corners[i], b.corners[i + 1]), 'building in the lake')
    assert.ok(Math.abs(b.corners[i] - 600) > 3, 'building on the road')
  }
  const heads = r.placed.filter((b) => b.id.endsWith('_B1'))
  for (let i = 0; i < heads.length; i++) for (let j = i + 1; j < heads.length; j++) assert.ok(Math.hypot(heads[i].x - heads[j].x, heads[i].z - heads[j].z) >= 150, 'groups too close')
  // near the road: most groups 40-150 m from it
  assert.ok(heads.filter((b) => Math.abs(b.x - 600) <= 160).length >= heads.length / 2)
  assert.equal(r.yards.length, r.groups)
  const again = scatterBuildings(zone, roads, [lake], flat, grid, { seed: 7, haPerGroup: 20 })
  assert.deepEqual(again.placed.map((b) => b.prefab + b.x), r.placed.map((b) => b.prefab + b.x))
})

test('scattered: density control and existing buildings kept', () => {
  const sparse = scatterBuildings(zone, roads, [], flat, grid, { seed: 2, haPerGroup: 60 })
  const dense = scatterBuildings(zone, roads, [], flat, grid, { seed: 2, haPerGroup: 15 })
  assert.ok(sparse.groups < dense.groups)
  const keep = dense.placed.slice(0, 1)
  const more = scatterBuildings(zone, roads, [], flat, grid, { seed: 3, haPerGroup: 30, prefix: 'X' }, keep)
  assert.equal(more.placed[0], keep[0])
  for (const b of more.placed.slice(1)) assert.ok(Math.hypot(b.x - keep[0].x, b.z - keep[0].z) > 20)
})
