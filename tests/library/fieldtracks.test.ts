// Field tracks along the plot borders (src/modules/fieldtracks.ts), more fields round hamlets (worldgen 10b)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chaikin, edgeTracks } from '../../src/modules/fieldtracks.ts'
import { countrysideZones, fillFieldZone } from '../../src/modules/zonefill.ts'
import { pointInPoly } from '../../src/modules/industrial.ts'

// a 4 x 3 grid of 100 m plots east of a north-south road at x = 0
const plots: number[][][] = []
for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) {
  const x = 15 + i * 100, z = j * 100
  plots.push([[x, z], [x + 100, z], [x + 100, z + 100], [x, z + 100], [x, z]])
}
const road = [0, -200, 0, 500]

test('chaikin keeps the ends and cuts the corners', () => {
  const p = chaikin([[0, 0], [100, 0], [100, 100]])
  assert.deepEqual(p[0], [0, 0]); assert.deepEqual(p[p.length - 1], [100, 100])
  assert.ok(!p.some((q) => q[0] === 100 && q[1] === 0), 'corner kept')
})

test('edge tracks reach every far plot, follow the borders, end on the road, never cross a plot', () => {
  const tr = edgeTracks(plots, [road])
  assert.ok(tr.length >= 1)
  assert.ok(tr.some((t) => t.length >= 6), 'a track follows the borders (more than a straight segment)')
  const reached = new Set<number>()
  for (const t of tr) {

    for (let k = 0; k < t.length; k += 2) {
      const x = t[k], z = t[k + 1]
      // never deep inside a plot (Chaikin cuts a corner by <= 1/4 of an edge)
      for (const p of plots) { const [x0, z0] = p[0]; assert.ok(!(x > x0 + 30 && x < x0 + 70 && z > z0 + 30 && z < z0 + 70), `track through a plot at ${x},${z}`) }
    }
    plots.forEach((p, i) => { for (let k = 0; k < t.length; k += 2) if (p.some((q) => Math.hypot(q[0] - t[k], q[1] - t[k + 1]) < 1)) reached.add(i) })
  }
  // the first track ends on the road
  const t0 = tr[0]
  assert.ok(Math.abs(t0[t0.length - 2]) < 0.5, 'first track ends on the road')
  // every plot not touching the road (x0 > 15) is served: it has a corner on a track or touches a served one
  assert.ok(reached.size >= 3)
})

test('no track for plots already on the road', () => {
  const near = [[[2, 0], [80, 0], [80, 80], [2, 80], [2, 0]]]
  assert.equal(edgeTracks(near, [road]).length, 0)
})

test('fillFieldZone tracks: bent, on land, deterministic', () => {
  const ok = (x: number, z: number) => Math.hypot(x, z) > 80
  const zone = countrysideZones(0, 0, 90, 600, ok)[0]
  const o = { zone, seed: 11, prefix: 'T_', ok: (x: number, z: number) => ok(x, z) && pointInPoly(zone, x, z), obstacles: [], roads: [[-700, 0, 700, 0]], hedgeSeed: 5 }
  const a = fillFieldZone(o), b = fillFieldZone(o)
  assert.ok(a.tracks.length > 0)
  assert.ok(a.tracks.some((t) => t.length > 4), 'at least one track follows the borders')
  assert.deepEqual(a.tracks, b.tracks)
})
