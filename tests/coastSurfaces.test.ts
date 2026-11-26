import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeSurfaces, waterDistance, openWaterDistance, COAST_BEACH_M } from '../src/modules/island.ts'

test('computeSurfaces: a low plain along a river is grass, beach only on a narrow bank strip', () => {
  const cols = 101, rows = 101, step = 4
  const heights: number[] = []
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) heights.push(Math.abs(c - 50) <= 3 ? -1.5 : 2) // river bed, plain at 2 m
  const s = computeSurfaces({ minX: 0, minZ: 0, step, cols, rows }, heights, 40)
  const w = (name: string, c: number) => { const g = s.find((q) => q.name === name); return g ? g.weights[50 * cols + c] : 0 }
  const beachy = (c: number) => w('BeachGrass_01', c) + w('Pebbles_02', c) + w('Grass_03_coastal', c)
  assert.ok(beachy(56) > 0.3, `bank strip ${beachy(56)}`) // 12 m from the bed
  assert.ok(beachy(2) < 0.01, `plain 180 m away ${beachy(2)}`)
  assert.ok(w('BeachGrass_01', 50 - 3 - Math.ceil((COAST_BEACH_M * 2.5) / step) - 1) < 0.01)
})

test('waterDistance: chamfer distance to the low ground', () => {
  const d = waterDistance([0, 5, 5, 5, 5], 5, 1, 10, -1)
  assert.equal(d[0], Infinity)
  const e = waterDistance([-2, 5, 5, 5, 5], 5, 1, 10, -1)
  assert.deepEqual(Array.from(e), [0, 10, 20, 30, 40])
})

test('computeSurfaces: river banks and low dry plains get no shingle / beach (open water only)', () => {
  const cols = 101, rows = 101, step = 4
  const heights: number[] = []
  // river 28 m wide on the left, a plain at 0.8 m (picture map: land just above the sea), open sea on the right
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) heights.push(Math.abs(c - 20) <= 3 ? -1.5 : c >= 75 ? -5 : 0.8)
  const s = computeSurfaces({ minX: 0, minZ: 0, step, cols, rows }, heights, 40)
  const w = (name: string, c: number) => { const g = s.find((q) => q.name === name); return g ? g.weights[50 * cols + c] : 0 }
  const shingle = (c: number) => w('Pebbles_02', c) + w('BeachGrass_01', c)
  assert.ok(shingle(26) < 0.05, `river bank ${shingle(26)}`) // 12 m from the river
  assert.ok(shingle(45) < 0.05, `plain at 0.8 m, 100 m from any water ${shingle(45)}`)
  assert.ok(shingle(72) > 0.3, `sea shore ${shingle(72)}`)
})

test('openWaterDistance: a river is not open water, the sea is', () => {
  const cols = 60, rows = 30, step = 4, h: number[] = []
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) h.push(c === 10 || c === 11 ? -2 : c >= 40 ? -5 : 3)
  const d = openWaterDistance(h, cols, rows, step, -0.5)
  assert.ok(d[15 * cols + 12] > 60, `next to the river ${d[15 * cols + 12]}`)
  assert.ok(d[15 * cols + 38] <= 8, `next to the sea ${d[15 * cols + 38]}`)
})

test('computeSurfaces: no Rock_01 band on the map-edge sea ramp (picture 120, grey band along the east edge)', () => {
  const cols = 101, rows = 101, step = 8
  const heights: number[] = []
  // plateau at 30 m falling into the sea over the last 6 % of the map (Sculpt.compose edge ramp), 45 deg
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) heights.push(c < 94 ? 30 : 30 - (c - 93) * 9)
  const s = computeSurfaces({ minX: 0, minZ: 0, step, cols, rows }, heights, 40)
  const rock = s.find((q) => q.name === 'Rock_01')!.weights
  let edge = 0
  for (let r = 20; r < 80; r++) for (let c = 93; c < cols; c++) edge += rock[r * cols + c]
  assert.equal(edge, 0)
})

test('computeSurfaces: no beach / coastal grass band on the map-edge ramp, a gentle real shore keeps it (picture 120 round 9, light band east edge)', () => {
  const cols = 101, rows = 101, step = 8
  const ramp: number[] = [], shore: number[] = []
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    ramp.push(c < 94 ? 8 : 8 - (c - 93) * 4) // 8 m land falling to the sea floor over the edge band, 0.5 m/m
    shore.push(c < 60 ? 6 : 6 - (c - 60) * 0.5) // gentle real shore: the sea from x 576 m, inside the map
  }
  const coast = (hs: number[], c0 = 86) => {
    const s = computeSurfaces({ minX: 0, minZ: 0, step, cols, rows }, hs, 40)
    const w = ['BeachGrass_01', 'Grass_03_coastal', 'Pebbles_02'].map((n) => s.find((q) => q.name === n)!.weights)
    let t = 0
    for (let r = 20; r < 80; r++) for (let c = c0; c < cols; c++) if (hs[r * cols + c] > 0) for (const x of w) t += x[r * cols + c]
    return t
  }
  assert.ok(coast(ramp) < 1, `ramp coast weight ${coast(ramp)}`)
  assert.ok(coast(shore, 40) > 20, `real shore coast weight ${coast(shore, 40)}`)
})

test('computeSurfaces: inland water (wide picture river) gets grass banks with a narrow pebble line, no beach', () => {
  const cols = 101, rows = 101, step = 4
  const heights: number[] = [], inland = new Uint8Array(cols * rows)
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) { const wet = Math.abs(c - 50) <= 15; heights.push(wet ? -2.5 : 0.8); if (wet) inland[r * cols + c] = 1 }
  const w = (s: ReturnType<typeof computeSurfaces>, name: string, c: number) => { const g = s.find((q) => q.name === name); return g ? g.weights[50 * cols + c] : 0 }
  const before = computeSurfaces({ minX: 0, minZ: 0, step, cols, rows }, heights, 40)
  const after = computeSurfaces({ minX: 0, minZ: 0, step, cols, rows }, heights, 40, undefined, undefined, undefined, undefined, inland)
  assert.ok(w(before, 'BeachGrass_01', 70) > 0.3, 'a 120 m wide river counted as open water: beach 20 m off')
  assert.ok(w(after, 'BeachGrass_01', 70) < 0.01 && w(after, 'Pebbles_02', 70) < 0.01)
  assert.ok(w(after, 'Pebbles_02', 66) > 0.2, `pebble line at the edge ${w(after, 'Pebbles_02', 66)}`)
})

test('computeSurfaces: the shallow sea shelf off a gentle coast is mostly sand, not a shingle (dark rock) line', () => {
  const cols = 101, rows = 101, step = 4
  const heights: number[] = []
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) heights.push(r < 30 ? -30 : r < 40 ? -1.5 : 1) // sea, 40 m shelf, plain
  const s = computeSurfaces({ minX: 0, minZ: 0, step, cols, rows }, heights, 40)
  const w = (name: string) => { const g = s.find((q) => q.name === name)!; let t = 0; for (let r = 31; r < 39; r++) for (let c = 20; c < 80; c++) t += g.weights[r * cols + c]; return t / (8 * 60) }
  assert.ok(w('Pebbles_02') < 0.45, `pebbles ${w('Pebbles_02')}`)
  assert.ok(w('Dirt_02') > 0.4, `sand ${w('Dirt_02')}`)
})
