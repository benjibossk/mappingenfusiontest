import { test } from 'node:test'
import assert from 'node:assert/strict'
import { forestBatches } from '../src/modules/forestBatches.ts'

test('forestBatches: batches of N, FOREST_ family kept, earlier batches locked', () => {
  const shapes = Array.from({ length: 95 }, (_, i) => ({ id: i % 2 ? `FOREST_IMG_${i}` : `FOREST_GEN_${i}_E1_1`, points: [i] }))
  const b = forestBatches(shapes, 40)
  assert.equal(b.length, 3)
  assert.deepEqual(b.map((x) => x.shapes.length), [40, 40, 15])
  assert.deepEqual(b[0].locked, [])
  assert.deepEqual(b[2].locked, ['FOREST_B1_*', 'FOREST_B2_*'])
  assert.equal(b[1].shapes[0].id, 'FOREST_B2_GEN_40_E1_1')
  // every name keeps the FOREST_ family (batch 1 clears the old forests) and no batch removes another one
  for (const [k, x] of b.entries()) for (const s of x.shapes) {
    assert.ok(s.id.startsWith(`FOREST_B${k + 1}_`))
    for (const l of b[k + 1]?.locked ?? []) if (l === `FOREST_B${k + 1}_*`) assert.ok(s.id.startsWith(l.slice(0, -1)))
  }
  assert.equal(new Set(b.flatMap((x) => x.shapes.map((s) => s.id))).size, 95)
  assert.equal(forestBatches(shapes, 0).length, 1)
})
