import { test } from 'node:test'
import assert from 'node:assert/strict'
import { bridgeRampPatches, riverBridges } from '../src/modules/water'

const g = { minX: 0, minZ: 0, step: 2, cols: 200, rows: 50 }
const relief = (f: (x: number) => number) => { const h = new Float32Array(200 * 50); for (let r = 0; r < 50; r++) for (let c = 0; c < 200; c++) h[r * 200 + c] = f(c * 2); return h }
const narrow = () => ({ half: 3, dirt: false })
const deckYs = (es: { id: string; ycm?: number; x: number; z: number }[]) => es.filter((e) => e.id.includes('_DECK_')).map((e) => ({ x: e.x, y: (e.ycm ?? 0) / 100 }))

test('riverBridges: a 5 m terrace past the 3 m bank sample lifts the deck end onto it (picture 120, deck 4.8 m under)', () => {
  // river 150..250, road bed at 1 m to x = 145, terrace at 6 m from x = 142 back
  const hs = relief((x) => (x < 142 ? 6 : x < 150 ? 1 : x <= 250 ? -1 : 1))
  const { entities, plans } = riverBridges([{ id: 'R', from: [150, 50], to: [250, 50] }], hs, g, narrow)
  for (const d of deckYs(entities)) { const gr = hs[25 * 200 + Math.round(d.x / 2)]; assert.ok(d.y > gr - 0.5, `deck ${d.y} at x ${d.x}, ground ${gr}`) }
  assert.ok(plans[0].capped)
  assert.ok(bridgeRampPatches(plans, hs, g).length >= 1)
})

test('riverBridges: a hump inside the gap is cleared (picture 120, middle decks 1.4-2.1 m under the ground)', () => {
  const hs = relief((x) => (x >= 160 && x <= 200 ? 6 : x >= 150 && x <= 250 ? -1 : 1))
  const { entities } = riverBridges([{ id: 'R', from: [150, 50], to: [250, 50] }], hs, g, narrow)
  for (const d of deckYs(entities)) if (d.x > 150 && d.x < 250) { const gr = hs[25 * 200 + Math.round(d.x / 2)]; assert.ok(d.y >= gr, `deck ${d.y} at x ${d.x}, ground ${gr}`) }
})

test('riverBridges: a plain crossing keeps its deck on the road beds, no ramp', () => {
  const hs = relief((x) => (x >= 150 && x <= 250 ? -1 : 1))
  const { plans } = riverBridges([{ id: 'R', from: [150, 50], to: [250, 50] }], hs, g, narrow)
  assert.equal(plans[0].capped, false)
  assert.ok(Math.abs(plans[0].a[2] - 1.05) < 0.01)
})

test('riverBridges: deck trimmed to the gap + a few metres (picture 120: BRIDGE_1 78 m, BRIDGE_2 143 m over bank grass)', () => {
  const hs = relief(() => 1)
  const len = (es: { id: string; prefab: string }[]) => es.filter((e) => e.id.includes('_DECK_')).reduce((s, e) => s + (e.prefab.includes('Long') ? 26 : 13), 0)
  const gG = { ...g, cols: 200, rows: 50 }
  for (const [L, max] of [[55, 65], [127, 130], [100, 117]]) {
    const { entities } = riverBridges([{ id: 'R', from: [20, 50], to: [20 + L, 50] }], hs, gG, narrow)
    const t = len(entities)
    assert.ok(t >= L + 2 && t <= max, `gap ${L}: deck ${t}`)
  }
})
