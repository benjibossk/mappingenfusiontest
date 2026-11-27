import { test } from 'node:test'
import assert from 'node:assert/strict'
import { clipLinesToWater } from '../src/modules/imageMap'

test('picture hedges are cut where they cross the water (round 11, bushes in the 119 lake)', () => {
  const w = 100, h = 100, mpp = 2, wm = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) for (let x = 40; x < 60; x++) wm[y * w + x] = 1 // water x 80..120 m
  const out = clipLinesToWater([[0, 100, 200, 100]], wm, w, h, mpp, 6)
  assert.equal(out.length, 2)
  for (const l of out) for (let i = 0; i < l.length; i += 2) assert.ok(l[i] < 76 || l[i] > 124, String(l[i]))
  assert.deepEqual(clipLinesToWater([[0, 100, 30, 100]], wm, w, h, mpp, 6), [[0, 100, 30, 100]])
})
