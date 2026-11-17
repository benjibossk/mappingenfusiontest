import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generateWorld, WORLD_DEFAULTS } from '../../src/modules/worldgen.ts'
import { pointInPoly } from '../../src/modules/industrial.ts'

test('random world: forest patches never overlap', async () => {
  let hits = 0, n = 0
  for (const seed of [1, 7, 42]) {
    const w = await generateWorld({ ...WORLD_DEFAULTS, size: 4096, seed })
    const A = w.areas
    n += A.length
    for (let i = 0; i < A.length; i++) for (let j = 0; j < A.length; j++) if (i !== j) {
      const p = A[i].pts, q = A[j].pts
      let cx = 0, cz = 0
      for (let k = 0; k + 1 < p.length; k += 2) { cx += p[k]; cz += p[k + 1] }
      cx /= p.length / 2; cz /= p.length / 2
      // vertex pulled 8 m inwards: shared borders after a cut are not overlaps
      for (let k = 0; k + 1 < p.length; k += 2) { const dx = cx - p[k], dz = cz - p[k + 1], d = Math.hypot(dx, dz) || 1; if (d > 10 && pointInPoly(p, p[k] + dx / d * 8, p[k + 1] + dz / d * 8) && pointInPoly(q, p[k] + dx / d * 8, p[k + 1] + dz / d * 8)) { hits++; break } }
    }
  }
  console.log({ n, hits })
  assert.equal(hits, 0)
})
