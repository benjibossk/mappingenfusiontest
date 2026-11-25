// Cemetery (sitesextra.ts makeCemetery): no grave reaches a road crossing the block.
import test from 'node:test'
import assert from 'node:assert/strict'
import { makeCemetery } from '../src/modules/sitesextra'

test('makeCemetery: a road crossing the block keeps every grave corner off its verge (seed 3 TOWN_1_SITE_2)', () => {
  // a 60 x 50 m church block crossed by a 12 m dashed road (RoadWidth 12) along z = 0, slightly slanted
  const polygon = [-30, -25, 30, -25, 30, 25, -30, 25]
  const axisZ = (x: number) => x * 0.05
  const lim = 6 + 1.5 // half + the margin worldgen's okAt keeps from the axis
  const ok = (x: number, z: number) => Math.abs(z - axisZ(x)) >= lim
  let graves = 0
  for (let seed = 1; seed <= 6; seed++) {
    let s = seed
    const rand = () => { s = (s * 16807) % 2147483647; return s / 2147483647 }
    const o = makeCemetery(polygon, { id: 'TOWN_1_SITE_2', rand, roads: [{ pts: [-40, axisZ(-40), 40, axisZ(40)], half: 6 }] as never, ok }, ['grave.et'])
    for (const b of o.boxes.filter((q) => q.role === 'grave')) {
      graves++
      for (let i = 0; i + 1 < b.corners.length; i += 2) assert.ok(ok(b.corners[i], b.corners[i + 1]), `seed ${seed}: grave corner ${b.corners[i].toFixed(1)},${b.corners[i + 1].toFixed(1)} on the road verge`)
    }
  }
  assert.ok(graves > 20, `graves laid (${graves})`)
})
