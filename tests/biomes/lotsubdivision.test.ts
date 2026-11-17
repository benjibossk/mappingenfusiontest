import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pointInPoly } from '../../src/modules/industrial.ts'
import { settleVillages } from '../../src/modules/village.ts'
import { overlap } from '../../src/modules/settlements.ts'
import { nearestOn } from '../../src/modules/villageStreets.ts'
import { lotTarget, subdivideBlock } from '../../src/modules/lotSubdivision.ts'
import type { Road } from '../../src/modules/roads.ts'

const flatGrid = { minX: -500, minZ: -500, step: 8, cols: 201, rows: 201 }
const flat = new Array(201 * 201).fill(20)
const poly = [-160, -130, 160, -130, 160, 130, -160, 130]
const roads: Road[] = [{ id: 'R1', type: 'asphalt', pts: [-400, 0, 400, 0] }]
const res = settleVillages([{ id: 'Z1', x: 0, z: 0, kind: 'village' }], roads, [], flat, flatGrid, { seed: 5, density: 1.2, polygon: poly, reach: 200, maxSlope: 0.2 })
const streets = [...roads, ...res.lanes].map((r) => r.pts)
const near = (x: number, z: number) => {
  let best: [number, number, number] = [0, 0, Infinity]
  for (const p of streets) { const c = nearestOn(p, x, z); if (c[2] < best[2]) best = c }
  return best
}

test('subdivideBlock: lots in the frontage / depth targets, back strip kept apart', () => {
  let s = 1
  const rand = () => ((s = (s * 16807) % 2147483647) / 2147483647)
  const tgt = lotTarget(1)
  const sub = subdivideBlock({ cx: 0, cz: 50, ux: 1, uz: 0, nx: 0, nz: 1, w: 120, d: 100, s: 0 }, tgt, rand, () => true)
  assert.ok(sub.lots.length >= 4 && sub.backs.length === 1)
  for (const l of sub.lots) {
    assert.ok(l.w >= tgt.front[0] * 0.8 && l.w <= tgt.front[1] + 1e-6, `frontage ${l.w}`)
    assert.ok(l.d >= tgt.depth[0] - 1e-6 && l.d <= tgt.depth[1] + 1e-6, `depth ${l.d}`)
    assert.ok(Math.abs(l.cz - l.d / 2) < 1e-6, 'front edge on the street')
  }
})

test('zone habitation: lots inside the polygon and every lot on a street', () => {
  assert.ok(res.lots.length > 6, `${res.lots.length} lots`)
  for (const l of res.lots) {
    for (let i = 0; i < 8; i += 2) assert.ok(pointInPoly(poly, l.corners[i], l.corners[i + 1]), 'lot outside')
    const mx = (l.corners[0] + l.corners[2]) / 2, mz = (l.corners[1] + l.corners[3]) / 2
    assert.ok(near(mx, mz)[2] < 16, `lot front ${near(mx, mz)[2].toFixed(1)} m from a street`)
  }
})

test('zone habitation: houses do not overlap and face the street (±20°)', () => {
  const houses = res.placed.filter((q) => q.role === 'house')
  assert.ok(houses.length > 3, `${houses.length} houses`)
  for (let i = 0; i < houses.length; i++) for (let j = i + 1; j < houses.length; j++) assert.ok(!overlap(houses[i].corners, houses[j].corners, -0.05), `${houses[i].id} x ${houses[j].id}`)
  for (const h of houses) {
    // the lot the house stands on (corner lots of crossing streets overlap: the best one)
    let d = Infinity
    for (const l of res.lots) {
      if (!l.used || !pointInPoly(l.corners, h.x, h.z)) continue
      const c = l.corners
      const a = Math.atan2((c[0] + c[2]) - (c[4] + c[6]), (c[1] + c[3]) - (c[5] + c[7])) * 180 / Math.PI
      d = Math.min(d, Math.abs(((a - h.yaw) % 360 + 540) % 360 - 180))
    }
    if (d === Infinity) continue // square / farm buildings are not lot houses
    assert.ok(d <= 20, `${h.id} faces ${d.toFixed(0)}° off the street`)
  }
})
