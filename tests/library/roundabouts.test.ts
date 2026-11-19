import { test } from 'node:test'
import assert from 'node:assert/strict'
import { addRoundabouts, clipCircle, junctionNodes, villageWalls } from '../../src/modules/roundabouts'
import type { Road } from '../../src/modules/roads'

const cross: Road[] = [
  { id: 'A', type: 'asphalt', pts: [0, 500, 1000, 500] },
  { id: 'B', type: 'asphalt', pts: [500, 0, 500, 500] },
  { id: 'C', type: 'asphalt', pts: [500, 500, 500, 1000] },
]

test('a 4-branch junction is detected', () => {
  const n = junctionNodes(cross).find((k) => Math.hypot(k.x - 500, k.z - 500) < 1)
  assert.ok(n)
  assert.equal(n!.branches, 4)
})

test('clipCircle cuts a straight line through the circle in two pieces ending on the ring', () => {
  const p = clipCircle([0, 0, 100, 0], 50, 0, 10)
  assert.equal(p.length, 2)
  assert.ok(Math.abs(p[0][p[0].length - 2] - 40) < 1e-6)
  assert.ok(Math.abs(p[1][0] - 60) < 1e-6)
})

test('roundabout added at the crossing, branches clipped at the ring', () => {
  const { roads, rings } = addRoundabouts(cross)
  assert.equal(rings.length, 1)
  const ring = roads.find((r) => r.id.startsWith('RB_'))!
  assert.ok(ring)
  for (const r of roads) if (r !== ring) for (let i = 0; i < r.pts.length; i += 2) assert.ok(Math.hypot(r.pts[i] - 500, r.pts[i + 1] - 500) >= rings[0].r - 0.02)
  // idempotent: running again adds nothing
  assert.equal(addRoundabouts(roads).rings.length, 0)
})

test('a T junction of minor roads gets no roundabout', () => {
  const t: Road[] = [{ id: 'A', type: 'dirt', pts: [0, 0, 200, 0] }, { id: 'B', type: 'dirt', pts: [100, 0, 100, 200] }]
  assert.equal(addRoundabouts(t).rings.length, 0)
})

test('village walls only inside the village and open in front of houses', () => {
  const r: Road[] = [{ id: 'V', type: 'asphalt', pts: [0, 0, 400, 0] }]
  const w = villageWalls(r, (x) => x > 100 && x < 300, (x) => x > 190 && x < 210)
  assert.ok(w.length >= 2)
  for (const s of w) for (let i = 0; i < s.points.length; i += 2) { assert.ok(s.points[i] > 100 && s.points[i] < 300); assert.ok(s.points[i] < 190 || s.points[i] > 210) }
})

test('town square crossed by asphalt: one closed round ring of the asphalt type, roads and lanes stop at it', async () => {
  const { squareRoundabout } = await import('../../src/modules/roundabouts')
  const road: Road = { id: 'R1', type: 'asphaltLine', pts: [-200, 3, -50, 1, 50, -1, 200, 0] }
  const sq: Road[] = [
    { id: 'SET_TOWN_1_LANE_Q5', type: 'cobble', pts: [-20, -20, 20, -20, 20, 0] },
    { id: 'SET_TOWN_1_LANE_Q19', type: 'cobble', pts: [20, 2, 20, 20, -20, 20, -20, -20] },
    { id: 'SET_TOWN_1_LANE_S3', type: 'dirt', pts: [0, -90, 0, -40, 1, 0] },
  ]
  const rb = squareRoundabout([road], sq, 0, 0, 30)!
  assert.ok(rb)
  const rings = [...rb.roads, ...rb.lanes, rb.ring].filter((r) => r.id.startsWith('RB_'))
  assert.equal(rings.length, 1)
  const p = rb.ring.pts, n = p.length / 2
  assert.equal(rb.ring.type, 'asphaltLine')
  assert.deepEqual([p[0], p[1]], [p[p.length - 2], p[p.length - 1]])
  const rs = Array.from({ length: n }, (_, i) => Math.hypot(p[i * 2], p[i * 2 + 1]))
  const R = rs.reduce((a, b) => a + b) / n
  for (const r of rs) assert.ok(Math.abs(r - R) / R < 0.05)
  assert.ok(!rb.lanes.some((l) => /_LANE_Q/.test(l.id)), 'square loop pieces removed')
  for (const r of [...rb.roads, ...rb.lanes]) for (let i = 0; i < r.pts.length; i += 2) assert.ok(Math.hypot(r.pts[i], r.pts[i + 1]) >= R - 1, `${r.id} enters the island`)
  assert.equal(rb.roads.length, 2)
})

test('junction overlap: road ends on a ring / another road run 1.5-2 m into it; the ring stays closed', async () => {
  const { squareRoundabout, overlapJunctions } = await import('../../src/modules/roundabouts')
  const rb = squareRoundabout([{ id: 'R1', type: 'asphalt', pts: [-200, 0, 0, 0, 200, 0] }], [], 0, 0, 30)!
  const tee: Road = { id: 'T', type: 'dirt', pts: [100, 80, 100, 0.2] }
  const all = [...rb.roads, rb.ring, tee]
  const before = all.map((r) => r.pts.slice())
  overlapJunctions(all)
  const p = rb.ring.pts
  assert.deepEqual([p[0], p[1]], [p[p.length - 2], p[p.length - 1]], 'ring closed, untouched')
  assert.deepEqual(p, before[2])
  for (const r of rb.roads) {
    const b = before[rb.roads.indexOf(r)]
    const atStart = Math.hypot(b[0], b[1]) < 100, e = atStart ? 0 : r.pts.length - 2, f = atStart ? 0 : b.length - 2
    assert.equal(r.pts.length, b.length + 2, 'one overlap point added')
    const moved = Math.hypot(r.pts[e] - b[f], r.pts[e + 1] - b[f + 1])
    assert.ok(moved >= 1.5 && moved <= 2, `${r.id} pushed ${moved}`)
    assert.ok(Math.hypot(r.pts[e], r.pts[e + 1]) < Math.hypot(b[f], b[f + 1]), 'pushed into the ring')
  }
  assert.ok(tee.pts[5] < -1.4 && tee.pts[5] > -1.9 && tee.pts[3] === 0.2, 'T end runs past the road centre line')
  assert.equal(tee.pts[1], 80, 'free end untouched')
})
