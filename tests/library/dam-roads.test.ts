// The road network goes round the dam embankment (dam.ts damFootprint): no road centre point on its faces.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generateWorld, WORLD_DEFAULTS } from '../../src/modules/worldgen.ts'

test('seed 21: no road point inside the dam footprint', async () => {
  const w = await generateWorld({ ...WORLD_DEFAULTS, seed: 21, dams: true })
  const dams = w.zones.filter((z) => z.sub === 'dam')
  assert.ok(dams.length > 0, 'seed 21 places a dam')
  for (const z of dams) {
    const ux = Math.cos(z.yaw), uz = Math.sin(z.yaw), c = z.boxes![0].corners
    const half = Math.hypot(c[2] - c[0], c[3] - c[1]) / 2 - 12 // crest half-length (the box runs 12 m into each hillside)
    for (const r of w.roads) for (let k = 0; k + 1 < r.pts.length; k += 2) {
      const dx = r.pts[k] - z.x, dz = r.pts[k + 1] - z.z
      const u = dx * ux + dz * uz, v = -dx * uz + dz * ux
      assert.ok(!(Math.abs(u) < half - 2 && Math.abs(v) < 25), `${r.id} point (${r.pts[k].toFixed(0)}, ${r.pts[k + 1].toFixed(0)}) on dam ${z.id}`)
    }
  }
})
