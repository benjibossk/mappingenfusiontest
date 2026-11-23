import { test } from 'node:test'
import assert from 'node:assert/strict'
import { noiseBerms } from '../src/modules/noiseBerms.ts'
import { lineIsOld, poleDirtMasks } from '../src/modules/power.ts'

const grid = { cols: 200, rows: 200, step: 2 } as never
const road = { id: 'r', type: 'motorway', pts: [0, 200, 400, 200], flatten: true } as never

test('berm rises on the side of the houses only, never on the bed', () => {
  const h = new Array(200 * 200).fill(10)
  const houses = [{ x: 200, z: 280 }, { x: 220, z: 290 }]
  const n = noiseBerms(h, grid, [road], houses)
  assert.ok(n > 0)
  const at = (x: number, z: number) => h[Math.round(z / 2) * 200 + Math.round(x / 2)]
  assert.equal(at(200, 200), 10) // road centre
  let top = 0
  for (let z = 200; z < 260; z += 2) top = Math.max(top, at(200, z))
  assert.ok(top > 13 && top <= 14.01, `crest ${top}`)
  for (let z = 140; z < 200; z += 2) assert.equal(at(200, z), 10) // no houses on that side
  assert.equal(at(200, 280), 10) // around the house left alone
})

test('no houses, no berm', () => {
  const h = new Array(200 * 200).fill(0)
  assert.equal(noiseBerms(h, grid, [road], []), 0)
})

test('old lines get grass at the pole feet, recent ones bare soil', () => {
  let old = 0, all = 0
  for (let i = 0; i < 200; i++) { all++; if (lineIsOld([i * 37, i * 11], 21)) old++ }
  assert.ok(old > 60 && old < 140, `old ${old}`)
  const poles = [10, 10, 30, 10]
  const m = poleDirtMasks([{ kind: 'lv', poles }], 21)
  const want = lineIsOld(poles, 21) ? 'Grass_02' : 'Dirt_01'
  assert.ok(m.every((b) => b.core === want))
})
