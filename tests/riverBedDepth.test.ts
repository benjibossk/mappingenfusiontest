import { test } from 'node:test'
import assert from 'node:assert/strict'
import { carveWater, pictureRiverDepth, type Water } from '../src/modules/water'

// picture 120: a 110 m river carved 2.5 m at its centre showed its bed in turquoise patches. The bed deepens
// with the local width: ~1 m at the edge, up to 4 m at the centre for 100 m+
function profile(width: number) {
  const g = { minX: 0, minZ: 0, step: 4, cols: 200, rows: 200 }
  const hs = Array.from({ length: 200 * 200 }, () => 3)
  const w: Water = { id: 'R', type: 'river', pts: [0, 400, 400, 400, 796, 400], width, widths: [width, width, width], depth: 2.5, carve: false, wetEdge: true } as Water
  const lv = carveWater(hs, g, [w])
  const out: number[] = []
  for (let r = 100; r <= 100 + Math.ceil(width / 8); r++) { const k = r * 200 + 100; out.push(+(lv.level[k] - hs[k]).toFixed(2)) }
  return out
}
test('picture river bed: deeper at the centre of wide reaches, ~1 m at the edge', () => {
  assert.equal(pictureRiverDepth(2.5, 15), 2.5)
  assert.equal(pictureRiverDepth(2.5, 60), 4)
  const wide = profile(120), narrow = profile(30)
  console.log('120 m', wide.join(' '), '| 30 m', narrow.join(' '))
  assert.ok(wide[0] >= 3.9, `centre ${wide[0]}`)
  assert.ok(narrow[0] <= 2.6 && narrow[0] >= 2.4)
  assert.ok(wide[Math.floor(wide.length * 0.75)] >= 1.5) // still deep at 3/4 of the half width
})
