import { test } from 'node:test'
import assert from 'node:assert/strict'
import { yardMasks } from '../src/modules/settlements'

test('yard lawn / dirt patches keep off the roads (picture 120 round 11: round spots on the village roads)', () => {
  const houses = Array.from({ length: 20 }, (_, i) => { const x = i * 40, z = 12; return { corners: [x - 5, z - 4, x + 5, z - 4, x + 5, z + 4, x - 5, z + 4] } })
  const road = (x: number, z: number, r: number) => Math.abs(z) < 9 + r // road along z = 0, band 9 m
  const all = yardMasks(houses), kept = yardMasks(houses, 1, 'Grass_01', 'Dirt_01', road)
  assert.ok(all.some((m) => Math.abs((m.points[1] + m.points[3]) / 2) < 9), 'some patches fell on the road')
  assert.ok(kept.length > 0 && kept.length < all.length)
  for (const m of kept) for (let i = 1; i < m.points.length; i += 2) assert.ok(Math.abs(m.points[i]) >= 9 + m.half - 0.01, String(m.points[i]))
})
