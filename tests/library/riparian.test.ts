// Riparian band (src/modules/riparian.ts): wide on flat banks, narrow / none on steep ones, never in the
// water or on a road, every patch inside the map.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { riparianBands, riparianShapes, RIPARIAN_GEN } from '../../src/modules/riparian.ts'
import type { Water } from '../../src/modules/water.ts'

const grid = { minX: 0, minZ: 0, step: 4, cols: 201, rows: 101 } // 800 x 400 m
const RZ = 200, HALF = 5
// river along X at z = 200; north bank (z > 200) a flat floodplain, south bank steep (30 % grade)
const heights: number[] = []
for (let r = 0; r < grid.rows; r++) for (let c = 0; c < grid.cols; c++) {
  const z = r * grid.step, d = Math.max(0, Math.abs(z - RZ) - HALF)
  heights.push(z >= RZ ? 4 + 0.03 * d : 4 + 0.3 * d)
}
const river: Water = { id: 'R1', type: 'river', pts: [20, RZ, 400, RZ, 780, RZ], width: 2 * HALF, depth: 2 }
const road = { pts: [600, 0, 600, 400], half: 3 }
const patches = riparianBands(heights, grid, [river], { seed: 3, roads: [road], cover: 1 })

const extent = (side: number) => Math.max(0, ...patches.filter((p) => p.side === side).flatMap((p) => p.pts.filter((_, i) => i % 2 === 1).map((z) => Math.abs(z - RZ))))

test('riparian: band wider on the flat bank than on the steep one', () => {
  assert.ok(patches.length > 0)
  const north = patches.filter((p) => p.pts[1] > RZ), south = patches.filter((p) => p.pts[1] < RZ)
  const ext = (ps: typeof patches) => Math.max(0, ...ps.flatMap((p) => p.pts.filter((_, i) => i % 2 === 1).map((z) => Math.abs(z - RZ))))
  assert.ok(ext(north) >= 20, `flat bank ${ext(north)} m`)
  assert.ok(ext(south) < ext(north) / 2, `steep ${ext(south)} vs flat ${ext(north)}`)
  assert.ok(extent(1) !== extent(-1)) // asymmetric
})

test('riparian: nothing in the water, on the road, or outside the map', () => {
  for (const p of patches) for (let i = 0; i + 1 < p.pts.length; i += 2) {
    const x = p.pts[i], z = p.pts[i + 1]
    assert.ok(Math.abs(z - RZ) >= HALF, `in water ${x},${z}`)
    assert.ok(Math.abs(x - 600) > road.half, `on road ${x},${z}`)
    assert.ok(x >= 0 && x <= 800 && z >= 0 && z <= 400, `outside ${x},${z}`)
  }
})

test('riparian: cliff banks get nothing, shapes use the vanilla generators', () => {
  const cliffH = heights.map((h, k) => (Math.floor(k / grid.cols) * grid.step < RZ ? 4 + Math.max(0, RZ - HALF - Math.floor(k / grid.cols) * grid.step) * 1.5 : h))
  const ps = riparianBands(cliffH, grid, [river], { seed: 3, cover: 1 })
  assert.equal(ps.filter((p) => p.pts[1] < RZ).length, 0)
  const sh = riparianShapes(patches)
  assert.ok(sh.every((s) => s.closed && Object.values(RIPARIAN_GEN).includes(s.generator as never) && s.avoid?.roads))
  assert.ok(patches.some((p) => p.kind === 'reed') && patches.some((p) => p.kind === 'willow'))
})
