import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generateTown } from '../../src/modules/town.ts'
import { inside, lineDist, overlap } from '../../src/modules/settlements.ts'
import type { Road } from '../../src/modules/roads.ts'
import type { Water } from '../../src/modules/water.ts'

// a 600 x 560 m zone (~34 ha) with a road crossing it west-east, a pond in the north-east corner
const zone = [0, 0, 600, 0, 620, 300, 600, 560, 0, 560, -20, 280]
const grid = { minX: -200, minZ: -200, step: 8, cols: 151, rows: 151 }
const flat = new Array(151 * 151).fill(20)
const roads: Road[] = [{ id: 'R1', type: 'asphalt', pts: [-150, 250, 300, 240, 800, 260] }]
const pond: Water = { id: 'L1', type: 'lake', pts: [480, 440, 590, 440, 590, 550, 480, 550], width: 0, depth: 3 }

test('town: square, closed connected streets, typed blocks, houses inside and apart', () => {
  const r = generateTown(zone, roads, [pond], flat, grid, { seed: 3, prefix: 'T1' })
  const n = r.placed.length
  assert.ok(n >= 40 && n <= 120, `buildings ${n} ${r.warnings}`)
  assert.ok(r.pop >= 100 && r.pop <= 320, `pop ${r.pop}`)
  // square
  assert.equal(r.squares.length, 1)
  assert.ok(r.blocks.some((b) => b.type === 'square'))
  // block types
  const types = new Set(r.blocks.map((b) => b.type))
  for (const t of ['centre', 'residential', 'church', 'farm', 'park']) assert.ok(types.has(t as never), `no ${t} block`)
  assert.ok(r.placed.some((b) => b.role === 'church'), 'no church')
  // connected street graph, no dead end except the gates
  const { v, e } = r.graph
  const nv = v.length / 2, seen = new Set([0]), deg = new Array(nv).fill(0)
  for (const [a, b] of e) { deg[a]++; deg[b]++ }
  for (let grow = true; grow; ) { grow = false; for (const [a, b] of e) if (seen.has(a) !== seen.has(b)) { seen.add(a); seen.add(b); grow = true } }
  assert.equal(seen.size, nv, 'street graph not connected')
  assert.ok(deg.filter((d) => d === 1).length <= 4, 'dead ends')
  assert.ok(r.lanes.some((l) => l.id.includes('_LANE_M')), 'no main street')
  // a main street reaches the existing road
  assert.ok(r.lanes.some((l) => { const x = l.pts[l.pts.length - 2], z = l.pts[l.pts.length - 1]; return lineDist(roads[0].pts, x, z) < 5 }), 'main street not joined to the road')
  // houses: inside, dry, no overlap, off the streets
  for (const b of r.placed) for (let i = 0; i < 8; i += 2) {
    assert.ok(inside(zone, b.corners[i], b.corners[i + 1]), 'corner outside')
    assert.ok(!inside(pond.pts, b.corners[i], b.corners[i + 1]), 'house in the pond')
  }
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) assert.ok(!overlap(r.placed[i].corners, r.placed[j].corners, 0), `overlap ${r.placed[i].id} ${r.placed[j].id}`)
  for (const b of r.placed) for (const l of r.lanes) assert.ok(lineDist(l.pts, b.x, b.z) > 2, 'house on a street')
  // deterministic
  assert.deepEqual(generateTown(zone, roads, [pond], flat, grid, { seed: 3, prefix: 'T1' }).placed, r.placed)
})

test('town: no road -> gates of its own; tiny zone -> nothing', () => {
  const r = generateTown(zone, [], [], flat, grid, { seed: 9 })
  assert.ok(r.lanes.filter((l) => l.id.includes('_LANE_M')).length >= 2)
  assert.ok(r.placed.length >= 40)
  assert.equal(generateTown([0, 0, 100, 0, 100, 100, 0, 100], [], [], flat, grid, { seed: 1 }).placed.length, 0)
})

test('town: a through-road becomes a main street (graph on it, houses face it, no lane on top)', () => {
  const r = generateTown(zone, roads, [pond], flat, grid, { seed: 3, prefix: 'T1' })
  const { v, e } = r.graph
  const onRoad = e.filter(([a, b]) => lineDist(roads[0].pts, (v[a * 2] + v[b * 2]) / 2, (v[a * 2 + 1] + v[b * 2 + 1]) / 2) < 3)
  const len = onRoad.reduce((s, [a, b]) => s + Math.hypot(v[b * 2] - v[a * 2], v[b * 2 + 1] - v[a * 2 + 1]), 0)
  assert.ok(len > 200, `road length in the street graph ${len}`)
  for (const l of r.lanes) for (let i = 0; i + 3 < l.pts.length; i += 2) {
    const mx = (l.pts[i] + l.pts[i + 2]) / 2, mz = (l.pts[i + 1] + l.pts[i + 3]) / 2
    assert.ok(lineDist(roads[0].pts, mx, mz) > 2, `lane ${l.id} drawn on the road`)
  }
  const fronting = r.placed.filter((b) => { const d = lineDist(roads[0].pts, b.x, b.z); return d > 6 && d < 25 })
  assert.ok(fronting.length >= 8, `houses along the road ${fronting.length}`)
  for (const b of r.placed) for (let i = 0; i < 8; i += 2) assert.ok(lineDist(roads[0].pts, b.corners[i], b.corners[i + 1]) > 5, 'house on the road')
})
