// Riparian band v2: autumn generators, carved banks (HAND from the bank top), forests cut by the band.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cutForests, isAutumnBiome, riparianBands, riparianShapes, RIPARIAN_GEN, RIPARIAN_GEN_AUT } from '../../src/modules/riparian.ts'
import { biome } from '../../src/data/biomes.ts'
import type { Water } from '../../src/modules/water.ts'

const grid = { minX: 0, minZ: 0, step: 4, cols: 201, rows: 101 }
const RZ = 200, HALF = 5
const river: Water = { id: 'R1', type: 'river', pts: [20, RZ, 400, RZ, 780, RZ], width: 2 * HALF, depth: 2 }
// carved channel: a 4 m bank rising 3 m, then a flat floodplain 3 m above the bed
const carved: number[] = []
for (let r = 0; r < grid.rows; r++) for (let c = 0; c < grid.cols; c++) {
  const d = Math.max(0, Math.abs(r * grid.step - RZ) - HALF - 1)
  carved.push(2 + Math.min(3, 0.75 * d) + 0.06 * Math.max(0, d - 4))
}
const ext = (ps: { pts: number[] }[]) => Math.max(0, ...ps.flatMap((p) => p.pts.filter((_, i) => i % 2 === 1).map((z) => Math.abs(z - RZ))))

test('riparian v2: autumn biomes use the vanilla _aut generators', () => {
  assert.ok(isAutumnBiome(biome('nordic_kolguyev')))
  assert.ok(!isAutumnBiome(biome('temperate_everon')))
  const ps = riparianBands(carved, grid, [river], { seed: 2, cover: 1, bank: 4 })
  const aut = riparianShapes(ps, { autumn: true }), sum = riparianShapes(ps)
  assert.ok(aut.every((s) => s.generator === RIPARIAN_GEN_AUT.reed || s.generator === RIPARIAN_GEN_AUT.willow))
  assert.ok(sum.every((s) => s.generator === RIPARIAN_GEN.reed || s.generator === RIPARIAN_GEN.willow))
  for (const g of Object.values(RIPARIAN_GEN_AUT)) assert.match(g, /^\{[0-9A-F]{16}\}Prefabs\/WEGenerators\/Brushland\/FG_Brushland_\w+_aut\.et$/)
})

test('riparian v2: on a carved bank the band is measured from the bank top (wider)', () => {
  const bed = riparianBands(carved, grid, [river], { seed: 2, cover: 1, handMax: 3.5 })
  const top = riparianBands(carved, grid, [river], { seed: 2, cover: 1, handMax: 3.5, bank: 4 })
  assert.ok(ext(top) > ext(bed) + 10, `bank top ${ext(top)} vs bed ${ext(bed)}`)
})

test('riparian v2: a forest touching the river is cut by the band, not dropped', () => {
  const flat: number[] = []
  for (let r = 0; r < grid.rows; r++) for (let c = 0; c < grid.cols; c++) flat.push(3 + 0.02 * Math.max(0, Math.abs(r * grid.step - RZ) - HALF))
  const forest = { id: 'F1', kind: 'forest', pts: [200, RZ + 6, 600, RZ + 6, 600, 390, 200, 390] }
  const ps = riparianBands(flat, grid, [river], { seed: 2, cover: 1 }) // forest not in polys: the band crosses it
  assert.ok(ps.some((p) => p.side === 1 && p.pts.some((v, i) => i % 2 === 0 && v > 250 && v < 550)))
  const out = cutForests([forest, { id: 'Z', kind: 'town', pts: [0, 0, 10, 0, 10, 10] }], ps)
  const f = out.filter((a) => a.kind === 'forest')
  assert.ok(f.length >= 1)
  const minZ = Math.min(...f.flatMap((a) => a.pts.filter((_, i) => i % 2 === 1)))
  assert.ok(minZ > RZ + 15, `forest edge pushed back to ${minZ}`)
  assert.ok(out.some((a) => a.id === 'Z'))
})
