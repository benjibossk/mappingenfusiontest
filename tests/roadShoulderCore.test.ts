import { test } from 'node:test'
import assert from 'node:assert/strict'
import { roadLayers } from '../src/shared/maskPaint.mjs'
import { waterMasks, type Water } from '../src/modules/water'

test('roadLayers: a polyline shoulder never eats the next segment core (asphalt stays 100 %)', () => {
  const side = 201, mpp = 0.5
  // a straight road cut in 5 m segments, dirt shoulders: before, the neighbour segments' shoulder bands put
  // 10-30 % dirt over the core (round spots on the asphalt, picture 120)
  const pts: number[] = []
  for (let x = 10; x <= 90; x += 5) pts.push(x, 50)
  const L = roadLayers(side, mpp, [{ points: pts, half: 4, edge: 5, core: 'Asphalt_01', side: 'Dirt_01', sidePeak: 0.35 }])
  const a = L.get('Asphalt_01')!, d = L.get('Dirt_01')!
  let low = 0, n = 0
  for (let x = 20; x <= 80; x += 0.5) for (let z = 47; z <= 53; z += 0.5) {
    const i = (side - 1 - Math.round(z / mpp)) * side + Math.round(x / mpp)
    n++; if (a[i] < 0.999 || d[i] > 0.001) low++
  }
  assert.equal(low, 0, `${low} / ${n} core pixels not pure asphalt`)
  const j = (side - 1 - Math.round(56 / mpp)) * side + Math.round(50 / mpp)
  assert.ok(d[j] > 0.05, `shoulder still there ${d[j]}`)
})

test('waterMasks: a picture river bed follows its local traced widths', () => {
  const w = { id: 'r', type: 'river', pts: [0, 0, 100, 0, 200, 0], width: 150, widths: [150, 70, 70], depth: 2 } as unknown as Water
  const m = waterMasks([w])
  assert.equal(m.length, 2)
  assert.ok(m.every((b) => b.core === 'Pebbles_01'))
  assert.equal(m[1].half, 35)
  assert.ok(m[0].half <= 35)
})
