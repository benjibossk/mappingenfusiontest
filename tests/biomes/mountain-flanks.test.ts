import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeSurfaces } from '../../src/modules/island.ts'
import { MAX_PARCEL_GRADE, meanGrade } from '../../src/modules/gen-common.ts'
import { settleVillages } from '../../src/modules/village.ts'

// a 300 m cone: 25 deg grassy flanks roughened by 8 m grooves (eroded relief), wear on every flank
function cone(deg = 25) {
  const cols = 161, rows = 161, step = 8
  const h: number[] = []
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const d = Math.hypot(c - 80, r - 80) * step
    h.push(Math.max(40, 340 - d * Math.tan((deg * Math.PI) / 180)) + (d < 600 ? 3 * Math.sin(c * 1.7) * Math.cos(r * 1.3) : 0))
  }
  const n = cols * rows
  const masks = { flow: new Float32Array(n), wear: new Float32Array(n).fill(0.8), deposits: new Float32Array(n) }
  return { grid: { cols, rows, step, minX: 0, minZ: 0 }, h, masks }
}

test('mountain flanks: a 25 deg rough flank stays grass, no rock and no scree from wear or slope alone', () => {
  const { grid, h, masks } = cone()
  const s = computeSurfaces(grid as never, h, 320, undefined, undefined, undefined, masks)
  const w = (name: string) => s.find((q) => q.name === name)!.weights
  let rock = 0, scree = 0, n = 0
  for (let i = 0; i < h.length; i++) if (h[i] > 80 && h[i] < 300) { rock += w('Rock_01')[i]; scree += w('Debris_Rock_01')[i]; n++ }
  assert.ok(rock / n < 0.02, `rock on the flank ${(rock / n).toFixed(3)}`)
  assert.ok(scree / n < 0.08, `scree on the flank ${(scree / n).toFixed(3)}`)
})

test('mountain flanks: deposit cones at the foot get scree, the same deposits up the slope do not', () => {
  const { grid, h, masks } = cone(30)
  masks.deposits.fill(0.9)
  const s = computeSurfaces(grid as never, h, 320, undefined, undefined, undefined, masks)
  const scree = s.find((q) => q.name === 'Debris_Rock_01')!.weights
  const at = (c: number, r: number) => scree[r * 161 + c]
  // flank (30 deg, d = 240 m) vs the flat foot just below the cone (base at d ~ 520 m = 65 cells)
  assert.ok(at(80, 50) < 0.1, `scree on the flank ${at(80, 50)}`)
  assert.ok(at(80, 148) > 0.2, `scree in the cone at the foot ${at(80, 148)}`)
})

test('meanGrade: reads the slope of the whole polygon', () => {
  const sq = [0, 0, 40, 0, 40, 40, 0, 40]
  assert.ok(Math.abs(meanGrade(sq, (x) => 0.1 * x) - 0.1) < 1e-6)
  assert.ok(meanGrade(sq, (x) => 0.3 * x) > MAX_PARCEL_GRADE)
  assert.equal(meanGrade(sq, () => 7), 0)
})

test('village lots: no house or parcel on a lot steeper than 12 deg on average', () => {
  // a hillside village: flat on the west, 20 deg on the east of the road
  const cols = 101, rows = 101, step = 4
  const heights: number[] = []
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) { const x = c * step; heights.push(20 + (x > 210 ? (x - 210) * Math.tan((20 * Math.PI) / 180) : 0)) }
  const grid = { cols, rows, step, minX: 0, minZ: 0 }
  const road = { id: 'R1', type: 'asphalt', pts: [200, 0, 200, 400] }
  const res = settleVillages([{ id: 'VILLAGE_1', kind: 'village', x: 200, z: 200 } as never], [road as never], [], heights, grid as never, { seed: 7, density: 2, dropScale: 20 } as never)
  const at = (x: number, z: number) => heights[Math.min(rows - 1, Math.max(0, Math.round(z / step))) * cols + Math.min(cols - 1, Math.max(0, Math.round(x / step)))]
  assert.ok(res.placed.length > 0, 'the flat side is built')
  for (const q of res.placed) assert.ok(q.x < 215, `${q.id} built on the 20 deg side at x ${q.x.toFixed(0)}`)
  for (const l of res.lots.filter((l) => l.used)) assert.ok(meanGrade(l.corners, at) <= MAX_PARCEL_GRADE, 'a used lot on steep ground')
})
