// Desire paths (worn ground door -> road), pasture fences, street statistics of the bench
import test from 'node:test'
import assert from 'node:assert/strict'
import { desirePaths, doorOf } from '../../src/modules/desirePaths'
import { pastureFences, pastureDensity } from '../../src/modules/pastures'
import { streetStats, mergeChains } from '../../scripts/bench/streets'
import type { Placed } from '../../src/modules/settlements'

const house = (x: number, z: number, yaw: number, id = 'H'): Placed => {
  const a = (yaw * Math.PI) / 180, fx = Math.sin(a), fz = Math.cos(a), sx = Math.cos(a), sz = -Math.sin(a)
  const c: number[] = []
  for (const [u, v] of [[-5, 4], [5, 4], [5, -4], [-5, -4]]) c.push(x + sx * u + fx * v, z + sz * u + fz * v)
  return { id, site: 'S1', prefab: 'p', cat: 'houseM', x, z, yaw, corners: c }
}
const road = { pts: [-100, 30, 100, 30], half: 3 }

test('a house set back from the road gets a worn strip from its door to the road, plus a door patch', () => {
  const q = house(0, 0, 0) // front +Z faces the road at z = 30
  const [dx, dz] = doorOf(q)
  assert.ok(Math.abs(dx) < 0.01 && Math.abs(dz - 5) < 0.01)
  const b = desirePaths([q], [road], [])
  assert.equal(b.length, 3)
  for (const s of b) { assert.equal(s.core, 'Dirt_01'); assert.ok(s.half >= 0.4 && s.half <= 1.6) }
  const last = b[2].points
  assert.ok(Math.abs(last[last.length - 1] - 30) < 3, 'ends on the road')
  assert.ok(b[2].half < b[1].half, 'fades (narrower) towards the road')
})

test('no strip when the door touches the road, or when a fence closes the way', () => {
  assert.equal(desirePaths([house(0, 22, 0)], [road], []).length, 1) // patch only
  const wall = [-40, 15, 40, 15] // a fence right across, no gap
  assert.equal(desirePaths([house(0, 0, 0)], [road], [wall]).length, 1)
  const gated = [[-40, 15, -2, 15], [2, 15, 40, 15]] // gate gap in front of the door
  assert.equal(desirePaths([house(0, 0, 0)], [road], gated).length, 3)
})

test('pasture fences: near buildings along roads, none far away, deterministic', () => {
  const roads = [{ pts: [0, 0, 2000, 0], half: 3 }]
  const o = { seed: 3, roads, buildings: [{ x: 200, z: 40 }], ok: () => true }
  const a = pastureFences(o), b = pastureFences(o)
  assert.deepEqual(a, b)
  const pts = a.flatMap((p) => p.fences.flatMap((f) => f.pts.filter((_, i) => i % 2 === 0)))
  assert.ok(pts.length > 0)
  // a road lined with farms gets several times the fence of the same road with no building in reach
  const km = (q: ReturnType<typeof pastureFences>) => q.reduce((s, p) => s + p.fences.reduce((u, f) => { let L = 0; for (let i = 2; i < f.pts.length; i += 2) L += Math.hypot(f.pts[i] - f.pts[i - 2], f.pts[i + 1] - f.pts[i - 1]); return u + L }, 0), 0)
  const long = [{ pts: [0, 0, 20000, 0], half: 3 }]
  const farms = km(pastureFences({ seed: 3, roads: long, buildings: Array.from({ length: 50 }, (_, i) => ({ x: i * 400, z: 40 })), ok: () => true }))
  const none = km(pastureFences({ seed: 3, roads: long, buildings: [], ok: () => true }))
  assert.ok(farms > 4 * none, `${farms} vs ${none}`)
  for (const p of a) for (const f of p.fences) for (let i = 1; i < f.pts.length; i += 2) assert.ok(Math.abs(f.pts[i]) >= 5, 'clear of the road')
  assert.ok(pastureDensity('nordic_kolguyev') < pastureDensity() && pastureDensity('woodland_arland') > pastureDensity())
})

test('street stats: chains merged, dead ends and junction angles', () => {
  assert.equal(mergeChains([[0, 0, 50, 0], [50, 0, 100, 1]]).length, 1)
  const s = streetStats([[0, 0, 0, 80]], [[-100, 0, 100, 0]])
  assert.equal(s.ends, 2); assert.equal(s.deadEnds, 1)
  assert.ok(Math.abs(s.angles[0] - 90) < 1)
})
