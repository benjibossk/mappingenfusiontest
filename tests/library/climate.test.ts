// Climate biomes (src/biomes/climate.ts): lapse rate, rain shadow, classification.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeClimate, biomeAt } from '../../src/biomes/climate.ts'

// 200 x 20 cells, step 20 m: sea for x < 400 m, a 2000 m ridge at x = 2000 m, wind toward +X
const cols = 200, rows = 20, step = 20
const h = new Float32Array(cols * rows)
for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
  const x = c * step
  h[r * cols + c] = x < 400 ? -5 : 5 + 1995 * Math.max(0, 1 - Math.abs(x - 2000) / 1200)
}
const res = computeClimate(h, cols, rows, step, { baseTemperature: 15, baseRainfall: 900, windDirection: 0 })
const at = (x: number) => 10 * cols + Math.round(x / step)

test('cold summit vs warm coast', () => {
  assert.ok(res.temperature[at(2000)] < 3, `summit ${res.temperature[at(2000)]}`)
  assert.ok(res.temperature[at(420)] > 14)
  assert.notEqual(biomeAt(res, at(2000)), biomeAt(res, at(420)))
  assert.equal(biomeAt(res, at(100)), null) // sea
})

test('rain shadow behind the ridge', () => {
  const windward = res.rainfall[at(1600)], lee = res.rainfall[at(2400)]
  assert.ok(windward > 2 * lee, `windward ${windward} lee ${lee}`)
  // reversed wind flips the shadow
  const rev = computeClimate(h, cols, rows, step, { baseTemperature: 15, baseRainfall: 900, windDirection: 180 })
  assert.ok(rev.rainfall[at(2400)] > rev.rainfall[at(1600)])
})

test('downsample keeps a consistent grid', () => {
  const d = computeClimate(h, cols, rows, step, { baseTemperature: 15, downsample: 4 })
  assert.equal(d.cols, 50); assert.equal(d.step, 80); assert.equal(d.biome.length, 50 * 5)
})
