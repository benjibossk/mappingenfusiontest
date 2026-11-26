import { test } from 'node:test'
import assert from 'node:assert/strict'
import { carveWater, riverWetHalf, waterShapes, type Water } from '../src/modules/water.ts'

// picture 119: low flat land (0.4 m) along a wide river, a sea pocket touching one edge of the water upstream, the
// sea at the end. The level (lowest ground across the water, never rising downstream) fell under the sea, the banks
// were shaped under 0 and the sea flooded the land outside the traced bed (a dark stepped sheet near the mouth)
const step = 4, cols = 151, rows = 151
const g = { minX: 0, minZ: 0, step, cols, rows }
const pre: number[] = []
for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
  const x = c * step, z = r * step
  pre.push(z < 60 ? -5 : x > 318 && x < 340 && z > 400 && z < 440 ? -4 : 0.4)
}
const river: Water = { id: 'R', type: 'river', pts: [300, 590, 300, 300, 300, 20], width: 30, depth: 2.5, carve: false, wetEdge: true }

test('river near the sea: surface never under the sea, land outside the bed stays dry', () => {
  const hs = pre.slice()
  carveWater(hs, g, [river])
  const wet = riverWetHalf(river)
  let flooded = 0
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const x = c * step, z = r * step, k = r * cols + c, d = Math.abs(x - 300)
    if (pre[k] < 0 || z < 80 || z > 580 || d <= river.width / 2 + step || d > wet + step) continue
    if (hs[k] < 0.1) flooded++
  }
  assert.equal(flooded, 0)
  const s = waterShapes([river], pre, hs, g)[0]
  const at = (x: number, z: number) => hs[Math.round(z / step) * cols + Math.round(x / step)]
  for (let i = 0; i < s.points.length / 2; i++) assert.ok(s.lift![i] + at(s.points[i * 2], s.points[i * 2 + 1]) > -0.3, `point ${i} under the sea`)
  // the last point in the sea lies at the sea level, no step where both waters meet
  const n = s.points.length / 2
  assert.ok(Math.abs(s.lift![n - 1] + at(s.points[n * 2 - 2], s.points[n * 2 - 1])) < 0.2)
})
