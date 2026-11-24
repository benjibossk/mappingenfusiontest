import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyPads, gradeLanes } from '../src/modules/pads.ts'
import { noiseBerms } from '../src/modules/noiseBerms.ts'

// seed 21, TOWN_1 LANE_S6: a lane climbing from a road onto a street of houses on a gentle slope rose 12 m in 8 m
const g = { minX: 0, minZ: 0, step: 8, cols: 60, rows: 60 } as never
const at = (h: number[], x: number, z: number) => {
  const gx = x / 8, gz = z / 8, c = Math.floor(gx), r = Math.floor(gz), fx = gx - c, fz = gz - r, i = r * 60 + c
  const a = h[i] + (h[i + 1] - h[i]) * fx, b = h[i + 60] + (h[i + 61] - h[i + 60]) * fx
  return a + (b - a) * fz
}
const slope = (z: number) => 10 + z * 0.05 // 5 % natural slope up +Z
const house = (x: number, z: number) => [x - 5, z - 5, x + 5, z - 5, x + 5, z + 5, x - 5, z + 5]

test('a street climbing a slope is terraced, not one platform at its mean level', () => {
  const h = Array.from({ length: 3600 }, (_, k) => slope(Math.floor(k / 60) * 8))
  // a row of touching houses from z 200 to z 440: 12 m of natural rise
  const fp: number[][] = []
  for (let z = 200; z <= 440; z += 12) fp.push(house(240, z))
  applyPads(h, g, fp)
  for (let z = 200; z <= 440; z += 12) assert.ok(Math.abs(at(h, 240, z) - slope(z)) < 2, `fill ${(at(h, 240, z) - slope(z)).toFixed(1)} m at z ${z}`)
})

test('a lane climbing onto a pad stays under 15 %', () => {
  const h = Array.from({ length: 3600 }, (_, k) => slope(Math.floor(k / 60) * 8))
  // one big lot whose high edge sets a pad 4 m above the ground where the lane arrives
  const fp = [[220, 260, 260, 260, 260, 340, 220, 340]]
  const lane = [240, 120, 240, 300]
  const pf = applyPads(h, g, fp, [lane])
  gradeLanes(h, g, [lane], pf)
  let max = 0
  for (let z = 120; z < 296; z += 4) max = Math.max(max, Math.abs(at(h, 240, z + 4) - at(h, 240, z)) / 4)
  assert.ok(max <= 0.15, `lane grade ${(max * 100).toFixed(0)} %`)
})

test('a lane crossing a noise berm keeps its ground', () => {
  const gr = { cols: 200, rows: 200, step: 2 } as never
  const h = new Array(200 * 200).fill(10)
  const road = { id: 'r', type: 'motorway', pts: [0, 200, 400, 200], flatten: true } as never
  const lane = [200, 200, 200, 300]
  noiseBerms(h, gr, [road], [{ x: 150, z: 280 }, { x: 250, z: 290 }], undefined, undefined, { lanes: [lane] })
  for (let z = 200; z < 260; z += 2) assert.equal(h[Math.round(z / 2) * 200 + 100], 10, `berm on the lane at z ${z}`)
  let top = 0
  for (let z = 200; z < 260; z += 2) top = Math.max(top, h[Math.round(z / 2) * 200 + 25])
  assert.ok(top > 13, 'the berm stays away from the lane')
})
