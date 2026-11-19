// Map-size scaling (data/densities.ts): every count of the random world is a density x land area, so a 8 km map
// (16x the area of a 2 km one) gets ~16x the places, bases, zones and vanilla sites.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DENSITY, scaledCount, worldCounts } from '../../src/data/densities.ts'

const land = (sizeM: number) => ((sizeM / 1000) ** 2) * 0.6 // island maps: ~60 % land
const P = { towns: 1, villages: 1, hamlets: 1, industry: 1, military: 1, vanillaSites: true }
const total = (c: ReturnType<typeof worldCounts>) => Object.values(c).reduce((a, b) => a + b, 0)

test('2 km vs 8 km map: counts in a ~16x ratio', () => {
  const small = total(worldCounts(P, land(2048))), big = total(worldCounts(P, land(8192)))
  const ratio = big / small
  assert.ok(small >= 3, `small map still gets a few things (${small})`)
  assert.ok(ratio > 16 * 0.7 && ratio < 16 * 1.3, `ratio ${ratio.toFixed(1)} (${small} -> ${big})`)
})

test('each density scales linearly away from its floor / cap', () => {
  for (const [k, d] of Object.entries(DENSITY)) {
    const a = 200 / d.perKm2, b = a * 16 // amounts big enough that rounding is noise
    const na = d.perKm2 * a, nb = d.perKm2 * b
    assert.equal(Math.round(nb / na), 16, k)
  }
  // tiny map: floors apply, no military base on an islet below 3 km² of land
  assert.equal(scaledCount(DENSITY.military, 1), 0)
  assert.equal(scaledCount(DENSITY.military, 5), 1)
  assert.equal(scaledCount(DENSITY.military, 400), DENSITY.military.max)
  assert.equal(scaledCount(DENSITY.hamlets, 10, 0), 0)
})

test('4 km map: measured densities give Bohemia-like counts', () => {
  const c = worldCounts(P, land(4096)) // ~10 km² of land, like Arland
  assert.ok(c.town === 1 && c.village >= 2 && c.village <= 6, JSON.stringify(c))
  assert.ok(c.military >= 1 && c.military <= 2, JSON.stringify(c))
})
