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
  for (const r of roads) if (r !== ring) for (let i = 0; i < r.pts.length; i += 2) assert.ok(Math.hypot(r.pts[i] - 500, r.pts[i + 1] - 500) >= rings[0].r - 1e-6)
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
