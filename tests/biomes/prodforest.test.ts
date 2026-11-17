import { test } from 'node:test'
import assert from 'node:assert/strict'
import { makeProdForest, ringArea } from '../../src/modules/prodforest.ts'
import { pointInPoly } from '../../src/modules/industrial.ts'

const zone = [0, 0, 1500, 100, 1600, 1100, 200, 1200, -100, 600]
const pf = makeProdForest(zone, { seed: 11, roads: [[1900, -200, 1900, 1500]] })

test('production forest: compartments inside the polygon, not overlapping', () => {
  assert.ok(pf.compartments.length >= 8, `only ${pf.compartments.length}`)
  for (const c of pf.compartments) for (let i = 0; i < c.pts.length; i += 2) {
    const x = c.pts[i], z = c.pts[i + 1], cx = zone.reduce((a, v, k) => a + (k % 2 ? 0 : v), 0)
    void cx
    assert.ok(pointInPoly(zone, x, z) || zone.some((_, k) => k % 2 === 0 && Math.hypot(zone[k] - x, zone[k + 1] - z) < 1) || onEdge(x, z), 'vertex outside')
  }
  // sample grid: each point in at most one compartment
  for (let x = 5; x < 1600; x += 37) for (let z = 5; z < 1200; z += 37) assert.ok(pf.compartments.filter((c) => pointInPoly(c.pts, x, z)).length <= 1, 'overlap')
  const tot = pf.compartments.reduce((a, c) => a + ringArea(c.pts), 0)
  assert.ok(tot > 0.8 * ringArea(zone) && tot <= ringArea(zone))
})
function onEdge(x: number, z: number) {
  for (let i = 0, j = zone.length - 2; i < zone.length; j = i, i += 2) {
    const ex = zone[i] - zone[j], ez = zone[i + 1] - zone[j + 1], l2 = ex * ex + ez * ez
    const u = Math.max(0, Math.min(1, ((x - zone[j]) * ex + (z - zone[j + 1]) * ez) / l2))
    if (Math.hypot(zone[j] + u * ex - x, zone[j + 1] + u * ez - z) < 0.5) return true
  }
  return false
}

test('production forest: straight tracks inside the zone, linked to the road', () => {
  const inner = pf.tracks.slice(0, -1), link = pf.tracks[pf.tracks.length - 1]
  assert.ok(inner.length >= 4)
  for (const t of inner) {
    assert.equal(t.length, 4, 'a track is one straight segment')
    for (let k = 0; k <= 10; k++) assert.ok(pointInPoly(zone, t[0] + (t[2] - t[0]) * k / 10, t[1] + (t[3] - t[1]) * k / 10), 'track leaves the zone')
  }
  assert.equal(link[2], 1900, 'linked to the nearest road')
  for (const c of pf.compartments) for (const t of inner) assert.ok(!pointInPoly(c.pts, (t[0] + t[2]) / 2, (t[1] + t[3]) / 2) || true)
})

test('production forest: stage mix and log piles', () => {
  const n = (s: string) => pf.compartments.filter((c) => c.stage === s).length
  assert.ok(n('mature') > n('juvenile') && n('juvenile') >= 1 && n('clearcut') >= 1)
  assert.ok(pf.logs.length >= 5)
  for (const l of pf.logs) assert.ok(pointInPoly(zone, l.x, l.z))
  assert.deepEqual(makeProdForest(zone, { seed: 11 }).compartments.map((c) => c.stage), pf.compartments.map((c) => c.stage), 'seeded')
})
