import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generateWorld, WORLD_DEFAULTS } from '../../src/modules/worldgen.ts'
import { pointInPoly } from '../../src/modules/industrial.ts'

test('random world: countryside plots + hedges, never inside a forest', async () => {
  let fields = 0, hedges = 0, inForest = 0, houses = 0, roadPts = 0
  for (const seed of [1, 7, 42]) {
    const w = await generateWorld({ ...WORLD_DEFAULTS, size: 4096, seed })
    const c = w.campaign
    if (!c) continue
    fields += c.fields.length; hedges += c.hedges.length
    for (const f of c.fields) {
      let x = 0, z = 0; for (const q of f) { x += q[0]; z += q[1] }
      const ring = f.flat()
      houses += w.settlement.placed.filter((b) => pointInPoly(ring, b.x, b.z)).length
      for (const r of w.roads) for (let i = 0; i + 1 < r.pts.length; i += 2) if (pointInPoly(ring, r.pts[i], r.pts[i + 1])) roadPts++
      if (w.areas.some((a) => pointInPoly(a.pts, x / f.length, z / f.length))) inForest++
    }
  }
  console.log({ fields, hedges, inForest, houses, roadPts })
  assert.ok(fields > 10)
  assert.equal(inForest, 0)
  assert.equal(houses, 0)
})
