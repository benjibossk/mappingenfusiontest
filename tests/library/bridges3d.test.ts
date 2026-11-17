// 3D bridge parts (src/modules/bridges3d.ts): decks follow the road centreline at its height, piers at the joints
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { planBridge } from '../../src/modules/bridges.ts'
import { bridgeParts } from '../../src/modules/bridges3d.ts'

test('bridges3d: overpass decks on the road axis, road heading, road top; piers at joints down to the ground', () => {
  for (const [a, b] of [[[1297, 2056], [1342, 2102]], [[0, 0], [60, -10]], [[100, 100], [100, 170]]] as [number, number][][]) {
    const top = 63.5, ground = () => 50
    const plan = planBridge('R', a as [number, number], b as [number, number], top, 3.5, ground)
    const { boxes, top: tops } = bridgeParts(plan.entities, ground)
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]), ux = (b[0] - a[0]) / L, uz = (b[1] - a[1]) / L
    const decks = boxes.map((q, i) => ({ q, t: tops[i] })).filter(({ q }) => !q.toGround && q.h > 1)
    assert.ok(decks.length >= 2)
    for (const { q, t } of decks) {
      const off = Math.abs((q.cx - a[0]) * -uz + (q.cz - a[1]) * ux) // distance from the road axis
      assert.ok(off < 0.3, `deck ${off.toFixed(2)} m off the axis`)
      const dir = Math.abs(Math.cos(q.yaw) * ux + Math.sin(q.yaw) * uz)
      assert.ok(dir > 0.995, 'deck along the road')
      assert.ok(Math.abs(t - top) < 0.05, `deck top ${t} vs road ${top}`)
    }
    const piers = boxes.filter((q) => q.toGround)
    assert.equal(piers.length, plan.piers)
    for (const p of piers) assert.ok(Math.abs((p.cx - a[0]) * -uz + (p.cz - a[1]) * ux) < 0.3)
  }
})
