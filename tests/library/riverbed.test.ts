import { test } from 'node:test'
import assert from 'node:assert/strict'
import { carveWater, type Water } from '../../src/modules/water.ts'
import { carveRoads, type Road } from '../../src/modules/roads.ts'
import { embankRoads, EMBANK_SLOPE } from '../../src/modules/embank.ts'

const g = { minX: 0, minZ: 0, step: 2, cols: 151, rows: 151 }
const flat = (h: number) => new Array(g.cols * g.rows).fill(h)
const H = (a: number[], x: number, z: number) => a[Math.round(z / g.step) * g.cols + Math.round(x / g.step)]

test('river bed: deepest on the axis, smooth cross-section, dry far banks untouched', () => {
  const h = flat(20).map((v, k) => v + (150 - (k % g.cols)) * 0.02) // gentle slope so the flow is defined
  const river: Water = { id: 'R', type: 'river', pts: [20, 150, 280, 150], width: 12, depth: 2, carve: true }
  const before = h.slice()
  carveWater(h, g, [river])
  const axis = before[75 * g.cols + 75] - H(h, 150, 150)
  assert.ok(axis > 1, `bed depth ${axis}`)
  const cut = (dz: number) => H(before, 150, 150 + dz) - H(h, 150, 150 + dz)
  assert.ok(cut(0) >= cut(4) && cut(4) >= cut(10) && cut(10) >= cut(20), 'cut decreases away from the axis')
  assert.ok(cut(60) < 0.01, 'far bank untouched')
})

test('a road over a lake never fills the lake basin', () => {
  const h = flat(10)
  const lake: Water = { id: 'L', type: 'lake', pts: [100, 100, 200, 100, 200, 200, 100, 200], width: 0, depth: 3 }
  const wl = carveWater(h, g, [lake])
  const lakeBed = H(h, 150, 150)
  const road: Road = { id: 'r', type: 'asphalt', pts: [10, 150, 290, 150], flatten: true }
  carveRoads(h, g, [road], { water: wl })
  assert.equal(H(h, 150, 150), lakeBed)
  assert.ok(H(h, 150, 150) < 10 - 1)
})

test('embankment: fill shoulders fall at most 1:2 and only raise', () => {
  const h = flat(0)
  const w = new Float32Array(h.length), t = new Float32Array(h.length)
  for (let r = 0; r < g.rows; r++) for (const c of [74, 75, 76]) { const k = r * g.cols + c; h[k] = 6; w[k] = 1; t[k] = 6 }
  const before = h.slice()
  embankRoads(h, g, { target: t, weight: w })
  for (let c = 77; c < 100; c++) {
    const v = h[75 * g.cols + c], d = (c - 76) * g.step
    assert.ok(v >= before[75 * g.cols + c])
    assert.ok(v >= 6 - d * EMBANK_SLOPE - 1e-6, `shoulder at ${d} m`)
  }
  assert.ok(h[75 * g.cols + 77] > 4, 'no cliff next to the bed')
})
