import { test } from 'node:test'
import assert from 'node:assert/strict'
import { qualityPreset, drapeTransform, drawForestTint, loadQuality } from '../../src/view3d/quality.ts'

test('quality presets grow with the level', () => {
  const l = qualityPreset('low', 2), m = qualityPreset('medium', 2), h = qualityPreset('high', 2)
  assert.ok(l.treeNear < m.treeNear && m.treeNear < h.treeNear)
  assert.ok(l.pixelRatio <= m.pixelRatio && m.pixelRatio <= h.pixelRatio)
  assert.equal(h.pointsFar, 0)
  assert.equal(qualityPreset('high', 1).pixelRatio, 1)
})
test('loadQuality survives a missing localStorage', () => { assert.equal(loadQuality(), null) })
test('drapeTransform maps the corners', () => {
  const [a, , , d, e, f] = drapeTransform(100, 10, 20, 50)
  assert.deepEqual([10 * a + e, 20 * d + f], [0, 100])
  assert.deepEqual([60 * a + e, 70 * d + f], [100, 0])
})
test('drawForestTint draws only real rings', () => {
  let fills = 0
  const g = { setTransform() {}, beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, fill() { fills++ }, stroke() {}, fillStyle: '', strokeStyle: '', lineWidth: 1 }
  const n = drawForestTint(g, 64, 0, 0, 100, [{ pts: [0, 0, 10, 0, 10, 10] }, { pts: [1, 1] }])
  assert.equal(n, 1); assert.equal(fills, 1)
})
