import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ROAD_TYPES, centreLine, type Road, type RoadType } from '../../src/modules/roads'
import { classOf } from '../../src/modules/roadgraph-classes'
import { addRoundabouts } from '../../src/modules/roundabouts'
import { crossings, minRadius, resolveCrossings } from '../../src/modules/motorway'
import { generateWorld, WORLD_DEFAULTS, type WorldResult } from '../../src/modules/worldgen'

// vanilla RoadWidth of each generator (game_read Prefabs/WEGenerators/Roads/**, parents followed), docs/ROAD_NETWORK_V2.md §3.1
const VANILLA_WIDTH: Record<RoadType, number> = {
  asphalt: 12, asphaltLine: 12, motorway: 12, asphaltNarrow: 8, asphalt2: 8, asphalt3: 8, cobble: 8, cobbleRough: 8,
  concrete: 7.5, concreteLine: 11, concreteNarrow: 5, concretePanel: 3.5, concretePath: 2.25,
  dirt: 4, dirt2: 4.5, forest: 4.5, coal: 4.5, trailDirt: 1.75, trailGravel: 1.75, trailForest: 1.75, trailCoal: 1.75,
}

test('road styles: half width = vanilla RoadWidth / 2, every style has a class', () => {
  for (const [k, w] of Object.entries(VANILLA_WIDTH)) {
    assert.equal(ROAD_TYPES[k as RoadType].half * 2, w, k)
    assert.ok(classOf(k as RoadType), k)
  }
  assert.equal(Object.keys(ROAD_TYPES).length, Object.keys(VANILLA_WIDTH).length)
  assert.equal(classOf('asphaltLine'), 'main'); assert.equal(classOf('asphalt'), 'secondary'); assert.equal(classOf('asphaltNarrow'), 'local')
  assert.equal(classOf('cobble'), 'street'); assert.equal(classOf('dirt'), 'track'); assert.equal(classOf('trailForest'), 'trail')
})

test('roundabout: branch ends are ring control points (shared point)', () => {
  const cross: Road[] = [
    { id: 'A', type: 'asphaltLine', pts: [0, 500, 1000, 500] },
    { id: 'B', type: 'asphalt', pts: [500, 0, 500, 500] },
  ]
  const { roads, rings } = addRoundabouts(cross)
  assert.equal(rings.length, 1, 'main x secondary T gets a ring')
  ringEndsShared(roads)
})

test('two close T junctions are merged into one roundabout', () => {
  const rs: Road[] = [
    { id: 'M', type: 'asphalt', pts: [0, 0, 1000, 0] },
    { id: 'N', type: 'asphaltNarrow', pts: [480, 0, 480, 400] },
    { id: 'S', type: 'asphaltNarrow', pts: [520, 0, 520, -400] },
  ]
  const { roads, rings } = addRoundabouts(rs)
  assert.equal(rings.length, 1)
  assert.ok(Math.abs(rings[0].x - 500) < 1 && rings[0].r >= 26)
  ringEndsShared(roads)
})

function ringEndsShared(roads: Road[]) {
  const rings = roads.filter((r) => r.id.startsWith('RB_'))
  for (const ring of rings) {
    const n = ring.pts.length / 2 - 1
    let cx = 0, cz = 0
    for (let i = 0; i < n; i++) { cx += ring.pts[i * 2]; cz += ring.pts[i * 2 + 1] }
    cx /= n; cz /= n
    const R = Math.hypot(ring.pts[0] - cx, ring.pts[1] - cz)
    assert.equal(ring.pts[0], ring.pts[ring.pts.length - 2]); assert.equal(ring.pts[1], ring.pts[ring.pts.length - 1])
    let touching = 0
    for (const r of roads) {
      if (r === ring) continue
      for (const e0 of [0, r.pts.length - 2]) {
        // an end may run 1.5-2 m past the junction (overlap): then the point before it is the shared one
        const inner = r.pts.length >= 6 && Math.abs(Math.hypot(r.pts[e0] - cx, r.pts[e0 + 1] - cz) - R) > 0.05
        const e = inner ? (e0 ? e0 - 2 : 2) : e0
        const d = Math.hypot(r.pts[e] - cx, r.pts[e + 1] - cz)
        if (Math.abs(d - R) > 1) continue
        touching++
        let on = false
        for (let i = 0; i < ring.pts.length; i += 2) if (ring.pts[i] === r.pts[e] && ring.pts[i + 1] === r.pts[e + 1]) on = true
        assert.ok(on, `${r.id} end is a control point of ${ring.id}`)
      }
    }
    assert.ok(touching >= 2, `${ring.id}: ${touching} roads touch it`)
  }
}

test('resolveCrossings: a road across the motorway is lifted over it, a short one cut back', () => {
  const mw: Road[] = [
    { id: 'MW_A', type: 'motorway', pts: [0, 9, 2000, 9] },
    { id: 'MW_B', type: 'motorway', pts: [0, -9, 2000, -9] },
  ]
  const long: Road = { id: 'L', type: 'asphalt', pts: [1000, -600, 1000, 600] }
  const stub: Road = { id: 'S', type: 'dirt', pts: [500, -30, 500, 200] }
  const roads = [long, stub]
  const r = resolveCrossings(roads, mw)
  assert.equal(r.overpasses, 1)
  assert.equal(r.cut, 1)
  assert.ok(long.lift?.length === 1 && long.spans?.length === 1)
  const sp = long.spans![0]
  assert.ok(sp.from < 591 && sp.to > 609, 'deck spans both carriageways')
  assert.ok(stub.pts.every((v, i) => i % 2 === 0 || v > 9 + 6 + 20), 'stub kept on one side only')
})

// three seeded worlds with the motorway on: every road style family, roundabouts, a clean motorway
const worlds = new Map<number, WorldResult>()
for (const seed of [7, 21, 777]) {
  test(`world ${seed}: road classes, roundabouts, motorway`, async () => {
    const w = await generateWorld({ ...WORLD_DEFAULTS, size: 4096, seed, motorway: true })
    worlds.set(seed, w)
    const cls = new Set(w.roads.map((r) => classOf(r.type)))
    for (const c of ['main', 'secondary', 'local', 'track'] as const) assert.ok(cls.has(c), `seed ${seed}: class ${c}`)
    assert.ok(w.roads.some((r) => r.type === 'asphaltLine'), 'main = widest asphalt, dashed line')
    // roundabouts
    const rb = w.roads.filter((r) => r.id.startsWith('RB_'))
    assert.ok(rb.length >= 1, `seed ${seed}: no roundabout`)
    ringEndsShared(w.roads)
    // motorway: two parallel carriageways ~18 m apart away from the tapers, gentle, no level crossing
    const A = w.roads.find((r) => r.id === 'MW_A'), B = w.roads.find((r) => r.id === 'MW_B')
    assert.ok(A && B, `seed ${seed}: no motorway`)
    assert.equal(A!.pts[0], B!.pts[0]); assert.equal(A!.pts[A!.pts.length - 1], B!.pts[B!.pts.length - 1])
    const n = A!.pts.length / 2
    for (let i = Math.ceil(n * 0.15); i < n * 0.85; i++) {
      let best = Infinity
      for (let j = 0; j < B!.pts.length; j += 2) best = Math.min(best, Math.hypot(A!.pts[i * 2] - B!.pts[j], A!.pts[i * 2 + 1] - B!.pts[j + 1]))
      assert.ok(Math.abs(best - 18) < 2.5, `carriageways ${best.toFixed(1)} m apart`)
    }
    assert.ok(A!.median && A!.median.length > 20, 'median barrier')
    for (const c of [A!, B!]) { // to the very ends (tapers included): a bend the sea holds tight is trimmed off
      const r = minRadius(centreLine(c.pts, 10))
      assert.ok(r > 200, `seed ${seed}: ${c.id} radius ${r.toFixed(0)} m`)
    }
    assert.ok(w.roads.some((r) => r.id.startsWith('MW_RAMP')), 'slip roads')
    for (const r of w.roads) {
      if (r.id.startsWith('MW_') || r.pts.length < 4) continue
      for (const c of [A!, B!]) for (const x of crossings(centreLine(r.pts, 5), c.pts))
        assert.ok((r.spans ?? []).some((s) => x.sp > s.from && x.sp < s.to), `${r.id} crosses ${c.id} at level`)
    }
  })
}
