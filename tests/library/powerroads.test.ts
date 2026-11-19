// Power lines vs. the built world (src/modules/powerroads.ts): road-following wooden lines, house clearance
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PowerObstacles, followRoads, segDist, segRingDist, inRing } from '../../src/modules/powerroads.ts'
import { generateWorld, WORLD_DEFAULTS } from '../../src/modules/worldgen.ts'
import { centreLine, roadHalf } from '../../src/modules/roads.ts'

const box = (x: number, z: number, w: number) => [x - w, z - w, x + w, z - w, x + w, z + w, x - w, z + w]

test('followRoads: poles beside the carriageway, on one side, off the houses, out of the junction', () => {
  // an L-shaped street (half 3 m) with a side street at x = 300, houses along its north side
  const roads = [{ pts: [0, 0, 300, 0, 600, 0, 600, 300], half: 3 }, { pts: [300, 0, 300, -200], half: 3 }]
  const houses = [box(100, 12, 5), box(200, 12, 5), box(450, 13, 5)]
  const ob = new PowerObstacles({ roads, buildings: houses })
  const p = followRoads(ob, 20, 15, 615, 280, 35, true)
  assert.ok(p && p.length > 20)
  for (let i = 2; i + 1 < p.length; i += 2) {
    const x = p[i], z = p[i + 1]
    const d = Math.min(...roads.flatMap((r) => { const o: number[] = []; for (let k = 0; k + 3 < r.pts.length; k += 2) o.push(segDist(x, z, r.pts[k], r.pts[k + 1], r.pts[k + 2], r.pts[k + 3]) - 3); return o }))
    assert.ok(d >= 1.5 && d < 10, `pole ${i / 2} at ${d.toFixed(1)} m from the edge`)
    assert.ok(!houses.some((h) => inRing(x, z, h)))
    assert.ok(Math.hypot(x - 300, z) > 10, 'no pole in the junction')
  }
  for (let i = 2; i + 3 < p.length; i += 2) assert.ok(houses.every((h) => segRingDist(p[i], p[i + 1], p[i + 2], p[i + 3], h) > 0), 'span over a house')
})

test('random worlds 7/21/77: LV along the roads, no pole in a building, few spans over houses', async () => {
  for (const seed of [7, 21, 77]) {
    const w = await generateWorld({ ...WORLD_DEFAULTS, seed })
    const roads = [...w.roads, ...w.settlement.lanes].filter((r) => r.pts.length >= 4).map((r) => ({ pts: centreLine(r.pts, 5), half: roadHalf(r) }))
    const edge = (x: number, z: number) => { let d = Infinity; for (const r of roads) for (let i = 0; i + 3 < r.pts.length; i += 2) d = Math.min(d, segDist(x, z, r.pts[i], r.pts[i + 1], r.pts[i + 2], r.pts[i + 3]) - r.half); return d }
    const B = w.settlement.placed.map((b) => b.corners)
    let lv = 0, near = 0, inB = 0
    const crossed = new Set<number>()
    for (const l of w.power) {
      for (let i = 0; i + 1 < l.poles.length; i += 2) {
        // a farm drop (powergrid step 4) follows the road, then its last leg crosses the fields to the farm yard
        const farm = l.to.startsWith('FARM') ? w.sites.find((q) => q.id === l.to) : undefined
        const yardLeg = !!farm && Math.hypot(l.poles[i] - farm.x, l.poles[i + 1] - farm.z) < 250
        if (l.kind === 'lv' && !yardLeg) { lv++; if (edge(l.poles[i], l.poles[i + 1]) < 10) near++ }
        if (B.some((c) => inRing(l.poles[i], l.poles[i + 1], c))) inB++
      }
      for (let i = 0; i + 3 < l.path.length; i += 2) B.forEach((c, k) => { if (segRingDist(l.path[i], l.path[i + 1], l.path[i + 2], l.path[i + 3], c) === 0) crossed.add(k) })
    }
    assert.ok(lv > 70, `seed ${seed}: LV poles ${lv}`) // LV span 35 m since 5e0c1ca (vanilla), was > 100 at 25 m
    assert.ok(near / lv >= 0.72, `seed ${seed}: LV within 10 m of a road ${(near / lv).toFixed(2)}`)
    assert.equal(inB, 0, `seed ${seed}: poles in a building`)
    assert.ok(crossed.size <= 10, `seed ${seed}: houses under a line ${crossed.size}`) // was 26-47 before
  }
})
