// Forest / field tracks graded like real ones (worldgen.ts tameTrack: <= 15 %, re-routed in switchbacks, else
// dropped) and hairpin platforms in the road bed (roads.ts carveRoads: level terrace on the inside of a lacet)
import test from 'node:test'
import assert from 'node:assert/strict'
import { routeLink, worstGrade } from '../../src/modules/network'
import { carveRoads } from '../../src/modules/roads'
import { hairpinSpots } from '../../src/modules/roadgeom'
import { addProdForests } from '../../src/modules/worldextras'

const step = 8, cols = 256, rows = 128, g = { minX: 0, minZ: 0, step, cols, rows }
const flank = (slope: number) => {
  const h: number[] = []
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) h.push(20 + Math.min(300 * slope, Math.max(0, (r * step - 300) * slope)))
  return h
}

test('a track straight up a 30 % flank is re-routed in switchbacks, <= 18 % on its bed', () => {
  const h = flank(0.3), a: [number, number] = [1024, 250], b: [number, number] = [1024, 650]
  assert.ok(worstGrade([...a, ...b], h, g).grade > 0.25)
  const r = routeLink(h, g, undefined, a, b, 'dirt', 10, 0.15, true)
  assert.ok(r, 'a route exists')
  const t = h.slice(); carveRoads(t, g, [{ id: 'T', type: 'dirt', pts: r!, flatten: true }]) // cut into the flank
  const gr = worstGrade(r!, t, g).grade
  assert.ok(gr <= 0.18, `grade ${gr}`)
})

test('addProdForests: a dropped spine takes the whole fishbone with it, a kept track passes through', () => {
  const ring = [0, 0, 1000, 0, 1000, 600, 0, 600]
  const areas = [{ id: 'F', kind: 'forest', leaf: 'needle' as const, pts: ring }]
  const all = addProdForests(areas, { seed: 3, share: 1, roads: [[-200, 300, -100, 300]], fix: (p) => p })
  assert.ok(all.tracks.length >= 2)
  const none = addProdForests(areas, { seed: 3, share: 1, roads: [[-200, 300, -100, 300]], fix: () => null })
  assert.equal(none.tracks.length, 0)
  assert.equal(none.count, all.count) // the forest stays, only its tracks go
})

test('hairpin platform: the bed at the apex of a lacet is near level, wider on the inside', () => {
  const h = flank(0.3)
  // a lacet: up the flank to the east, a tight turn back, up to the west
  const pts: number[] = []
  for (let x = 600; x <= 1000; x += 20) pts.push(x, 400 + (x - 600) * 0.12)
  for (let a = -80; a <= 80; a += 20) pts.push(1000 + 25 * Math.cos((a * Math.PI) / 180), 473 + 25 * Math.sin((a * Math.PI) / 180) + 0)
  for (let x = 1000; x >= 600; x -= 20) pts.push(x, 498 + (1000 - x) * 0.12)
  const pins = hairpinSpots(pts)
  assert.ok(pins.length >= 1, 'the turn is a hairpin')
  const road = { id: 'R', type: 'asphalt' as const, pts, flatten: true }
  const hp = pins[0]
  const cross = (t: number[]) => {
    const at = (x: number, z: number) => t[Math.round(z / step) * cols + Math.round(x / step)]
    return Math.abs(at(hp.x, hp.z + 12) - at(hp.x, hp.z - 12)) / 24
  }
  const off = h.slice(); carveRoads(off, g, [road], { pins: false })
  const on = h.slice(); carveRoads(on, g, [road])
  assert.ok(cross(on) < cross(off), `cross-slope ${cross(on)} vs ${cross(off)} without platform`)
  assert.ok(cross(on) < 0.12, `cross-slope ${cross(on)}`)
})
