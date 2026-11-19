// TAT-like vegetation rules (src/modules/vegLayers.ts): elevation bands, feathering, Poisson-disk regularity.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { clarkEvans, elevationBand, featherAt, bushBeltAt, mulberry, poissonDisk, poissonRadius, scatterLayers } from '../../src/modules/vegLayers.ts'

test('Poisson-disk at the vanilla forest density: Clark-Evans ~1.7', () => {
  const r = poissonRadius(290)
  const pts = poissonDisk({ minX: 0, minZ: 0, maxX: 200, maxZ: 200 }, r, mulberry(5))
  const perHa = pts.length / 2 / 4
  const ce = clarkEvans(pts, 200 * 200)
  assert.ok(perHa > 200 && perHa < 380, `density ${perHa.toFixed(0)}/ha`)
  assert.ok(ce > 1.5 && ce < 1.95, `CE ${ce.toFixed(2)}`)
})

test('elevation bands relative to the height range', () => {
  assert.equal(elevationBand(5, 400), 'shore')
  assert.equal(elevationBand(60, 400), 'lowland')
  assert.equal(elevationBand(150, 400), 'midland')
  assert.equal(elevationBand(250, 400), 'highland')
  assert.equal(elevationBand(350, 400), 'alpine')
})

test('feathering: thin and small on the outline, full in the core; bush belt peaks on the outline', () => {
  const o = featherAt(0), m = featherAt(12), c = featherAt(24)
  assert.ok(o.density < 0.75 && o.scale <= 0.71, JSON.stringify(o))
  assert.ok(m.density > o.density && m.scale > o.scale)
  assert.ok(c.density > 0.98 && c.scale > 0.99)
  assert.ok(bushBeltAt(0) > bushBeltAt(16) && bushBeltAt(0) > bushBeltAt(-24) && bushBeltAt(24) <= 45)
})

test('scatter: rocks only on slopes, none on flat lowland', () => {
  const flat = scatterLayers({ box: { minX: 0, minZ: 0, maxX: 500, maxZ: 500 }, heightAt: () => 50, slopeAt: () => 0.05, maxHeight: 300, ok: () => true, seed: 3, layers: ['rocks'] })
  const steep = scatterLayers({ box: { minX: 0, minZ: 0, maxX: 500, maxZ: 500 }, heightAt: () => 50, slopeAt: () => 0.5, maxHeight: 300, ok: () => true, seed: 3, layers: ['rocks'] })
  assert.equal(flat.length, 0)
  assert.ok(steep.length > 5, `${steep.length}`)
})
