import { test } from 'node:test'
import assert from 'node:assert/strict'
import { extractWater } from '../src/modules/imageMap'

// picture 119: a lake ~200 m across swelling a 100 m river east of the town came out as the river ribbon only
function mask(bulge: boolean) {
  const w = 400, h = 400, m = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const inRiver = Math.abs(x - 200) <= 12
    const inLake = bulge && ((x - 200) / 45) ** 2 + ((y - 200) / 80) ** 2 <= 1
    if (inRiver || inLake) m[y * w + x] = 1
  }
  return m
}
test('a lake swelling a river is traced as a lake beside the river; a plain river gives none', () => {
  const plain = extractWater(mask(false), 400, 400, 2)
  assert.equal(plain.filter((x) => x.kind === 'lake').length, 0)
  const sw = extractWater(mask(true), 400, 400, 2)
  const lakes = sw.filter((x) => x.kind === 'lake')
  assert.equal(lakes.length, 1)
  assert.ok(lakes[0].onRiver)
  assert.ok(sw.some((x) => x.kind === 'river'))
})
