import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Grid } from '../../src/modules/island'
import { routeLink } from '../../src/modules/network'
import { arcLength } from '../../src/modules/roadgeom'
import { BRIDGE_PREFABS, planBridge, riverCrossCost, STREAM } from '../../src/modules/bridges'
import { overpassDecks, trimTightEnds, minRadius } from '../../src/modules/motorway'
import type { Road } from '../../src/modules/roads'

// flat plain 1000 x 600 m, a stream running north from the south edge up to z = 400 at x = 500
function plain(strength: number, tip = 40) {
  const g = { minX: 0, minZ: 0, step: 10, cols: 101, rows: 61 } as Grid
  const h = new Array(g.cols * g.rows).fill(20)
  const river = new Float32Array(g.cols * g.rows)
  for (let r = 0; r <= tip; r++) { river[r * g.cols + 50] = strength; river[r * g.cols + 51] = strength; river[r * g.cols + 52] = strength }
  return { g, h, river }
}
const len = (p: number[]) => arcLength(p)[p.length / 2 - 1]

test('narrow stream: crossed straight on (short bridge), a river is still worth a detour', () => {
  assert.ok(riverCrossCost(0.3) < 50 && riverCrossCost(1) >= 400 && STREAM.narrow > 0.3)
  const a: [number, number] = [300, 300], b: [number, number] = [700, 300]
  const s = plain(0.3)
  const p = routeLink(s.h, s.g, s.river, a, b, 'dirt', 10)!
  assert.ok(p && len(p) < 415, `stream: ${len(p).toFixed(0)} m for 400 m straight`)
  const w = plain(1)
  const q = routeLink(w.h, w.g, w.river, a, b, 'dirt', 10)!
  assert.ok(q && len(q) > 440, `river: detour round its head (${len(q).toFixed(0)} m)`)
})

test('short crossing = one vanilla 13 m piece (small for tracks, Narrow for roads)', () => {
  const flat = () => 10
  assert.deepEqual(planBridge('T', [0, 0], [5, 0], 10.5, 2, flat).pieces, [BRIDGE_PREFABS.small])
  assert.deepEqual(planBridge('R', [0, 0], [5, 0], 10.5, 4, flat).pieces, [BRIDGE_PREFABS.narrow])
})

test('overpass over the motorway: vanilla ConcreteBridge_01 decks and pillars only', () => {
  const r: Road = { id: 'R1', type: 'asphalt', pts: [0, 0, 400, 0], lift: [{ at: 200, h: 7, flat: 25, len: 80 }], spans: [{ from: 175, to: 225 }] }
  const e = overpassDecks([r], () => 0)
  const vanilla = new Set(Object.values(BRIDGE_PREFABS))
  assert.ok(e.length >= 2 && e.every((x) => vanilla.has(x.prefab)))
  assert.ok(e.some((x) => x.prefab === BRIDGE_PREFABS.wide), 'wide deck for a 12 m road')
  assert.ok(e.some((x) => x.prefab === BRIDGE_PREFABS.pillar), 'pillar under the joint')
})

test('trimTightEnds: a hairpin near an end is cut off, the gentle rest kept', () => {
  const pts: number[] = []
  for (let i = 0; i < 100; i++) pts.push(i * 20, 0) // 2 km straight
  const hook = pts.slice(0, 200)
  for (let k = 1; k <= 8; k++) { const t = (k * Math.PI) / 8; hook.push(1980 + 60 * Math.sin(t), 60 - 60 * Math.cos(t)) }
  assert.ok(minRadius(hook) < 100)
  const t = trimTightEnds(hook, 225)
  assert.ok(minRadius(t) >= 225 && t.length >= 160, `kept ${t.length / 2} points`)
})
