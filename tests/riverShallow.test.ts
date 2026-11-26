import { test } from 'node:test'
import assert from 'node:assert/strict'
import { carveWater, type Water } from '../src/modules/water'

// picture 119 round 9 near 1062,850: a shallow water sheet with grass islands. Ground within 0.3 m of the water
// under the river ribbon: the tributary's depth ramp started at its confluence, the bed carved at the median width
// where the river is traced wider, the bank under the ribbon only 0.2 m over the water
test('picture rivers: no ground within 0.3 m of the water at a confluence nor where the traced width exceeds the median', () => {
  const g = { minX: 0, minZ: 0, step: 4, cols: 200, rows: 200 }
  const hs = Array.from({ length: 200 * 200 }, (_, k) => 3 - (k % 200) * 0.005) // gentle slope down to +x
  const main: Water = { id: 'M', type: 'river', pts: [0, 400, 200, 400, 400, 400, 600, 400, 796, 400], width: 40, widths: [40, 40, 70, 40, 40], depth: 2.5, carve: false, wetEdge: true } as Water
  // tributary from the top, its lower end in the main river; the terrain makes that end its "source"
  const trib: Water = { id: 'T', type: 'river', pts: [300, 400, 300, 600, 300, 796], width: 30, widths: [30, 30, 30], depth: 2.5, carve: false, wetEdge: true } as Water
  for (let r = 0; r < 200; r++) for (let c = 0; c < 200; c++) if (r * 4 > 400) hs[r * 200 + c] -= (796 - r * 4) * 0.004 // the tributary runs downhill away from the main river (its "source" is the confluence)
  const lv = carveWater(hs, g, [main, trib])
  let near = 0, n = 0
  for (let r = 0; r < 200; r++) for (let c = 20; c < 180; c++) {
    const k = r * 200 + c
    if (Number.isNaN(lv.level[k])) continue
    const x = c * 4, z = r * 4
    const inMain = Math.abs(z - 400) <= 26 * 1.0 + 8, inTrib = Math.abs(x - 300) <= 20 + 8 && z >= 400 && z < 700
    if (!inMain && !inTrib) continue
    n++
    if (Math.abs(hs[k] - lv.level[k]) < 0.3) near++
  }
  assert.ok(n > 500)
  assert.equal(near, 0, `${near} / ${n} cells within 0.3 m of the water`)
})
