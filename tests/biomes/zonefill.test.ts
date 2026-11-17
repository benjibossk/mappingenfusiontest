import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generateCampaign } from '../../src/modules/campaign.ts'
import { clipPlots, cutRing, flatToPoly, plotHedges, pointObstacle, roadObstacles, slopeShare } from '../../src/modules/zonefill.ts'
import { pointInPoly } from '../../src/modules/industrial.ts'
import { makeIndustrial } from '../../src/modules/zones.ts'
import { settleVillages } from '../../src/modules/village.ts'
import type { Road } from '../../src/modules/roads.ts'

// a 600 x 400 m zone crossed by a road along x = 300
const zone = [0, 0, 600, 0, 600, 400, 0, 400]
const inZone = (x: number, z: number) => pointInPoly(zone, x, z) || x === 0 || z === 0 || x === 600 || z === 400
const road = { pts: [300, -100, 300, 500], half: 3 }
const flatGrid = { minX: -500, minZ: -500, step: 8, cols: 201, rows: 201 }
const flat = new Array(201 * 201).fill(20)

test('fields: plots stay in the zone, are cut by the road, hedges on their borders', () => {
  const raw = generateCampaign({ zone, fieldSize: 90, jitter: 0.5, angle: 10, hedgeChance: 0.5, minHedge: 12, seed: 3 })
  const kept = clipPlots(raw.fields, { obstacles: roadObstacles([road], 3), zone: flatToPoly(zone), ok: () => true })
  assert.ok(kept.length > 5)
  for (const f of kept) for (const q of f) {
    assert.ok(q[0] >= -0.01 && q[0] <= 600.01 && q[1] >= -0.01 && q[1] <= 400.01, 'vertex outside the zone')
    assert.ok(Math.abs(q[0] - 300) >= 5.99, 'plot over the road')
  }
  let s = 1
  const hedges = plotHedges(kept, { rnd: () => ((s = (s * 16807) % 2147483647) / 2147483647), ok: () => true, keep: 1 })
  assert.ok(hedges.length > kept.length)
  // a hedge follows the road verge (x = 294 or 306)
  assert.ok(hedges.some((h) => h.every((q) => Math.abs(Math.abs(q[0] - 300) - 6) < 0.5)))
})

test('forest: zone minus road and a house, the hole opened (flat rings only), nothing outside', () => {
  const parts = cutRing(zone, [...roadObstacles([road], 3), pointObstacle(100, 200, 10)])
  assert.ok(parts.length >= 2)
  for (const p of parts) for (let i = 0; i < p.length; i += 2) {
    assert.ok(inZone(p[i], p[i + 1]) || Math.abs(p[i]) < 0.01)
    assert.ok(Math.abs(p[i] - 300) >= 5.99)
  }
  // the house spot is not forest any more
  assert.ok(!parts.some((p) => pointInPoly(p, 100, 200)))
  assert.ok(parts.some((p) => pointInPoly(p, 100, 100)))
})

test('priority: a higher zone cuts the forest / fields under it', () => {
  const forest = [0, 0, 600, 0, 600, 400, 0, 400]
  const habitation = flatToPoly([400, 100, 550, 100, 550, 300, 400, 300])!
  const left = cutRing(forest, [habitation])
  assert.ok(left.length >= 1 && !left.some((p) => pointInPoly(p, 475, 200)))
  const plots = clipPlots([[[350, 50], [580, 50], [580, 350], [350, 350], [350, 50]]], { obstacles: [habitation], ok: () => true, okShare: 0, minArea: 100 })
  for (const p of plots) assert.ok(!pointInPoly(p.flat(), 475, 200))
})

test('slope share: flat 0, steep 1', () => {
  assert.equal(slopeShare(() => 0, zone, 0.06), 0)
  assert.equal(slopeShare((x) => x * 0.3, zone, 0.2), 1)
})

test('industrial in a polygon: lots and buildings inside it', () => {
  const poly = [0, 0, 300, 0, 300, 200, 0, 200]
  const roads: Road[] = [{ id: 'R1', type: 'asphalt', pts: [-200, -40, 500, -40] }]
  const zn = makeIndustrial(flat, flatGrid, roads, { id: 'IND_1', type: 'factory', x: 150, z: 100, seed: 1, polygon: poly })
  const lots = zn.boxes.filter((b) => b.role === 'lot')
  assert.ok(lots.length > 0)
  for (const b of lots) {
    let cx = 0, cz = 0
    for (let i = 0; i < b.corners.length; i += 2) { cx += b.corners[i]; cz += b.corners[i + 1] }
    assert.ok(pointInPoly(poly, cx / (b.corners.length / 2), cz / (b.corners.length / 2)))
  }
})

test('habitation in a polygon: every building and street point inside', () => {
  const poly = [-150, -120, 150, -120, 150, 120, -150, 120]
  const roads: Road[] = [{ id: 'R1', type: 'asphalt', pts: [-400, 0, 400, 0] }]
  const res = settleVillages([{ id: 'Z1', x: 0, z: 0, kind: 'village' }], roads, [], flat, flatGrid, { seed: 2, density: 1.5, polygon: poly, reach: 190, maxSlope: 0.2 })
  assert.ok(res.placed.length > 3, `only ${res.placed.length} buildings`)
  for (const b of res.placed) for (let i = 0; i < b.corners.length; i += 2) assert.ok(pointInPoly(poly, b.corners[i], b.corners[i + 1]), `${b.id} outside`)
  for (const g of res.gardens) for (let i = 0; i < g.corners.length; i += 2) assert.ok(pointInPoly(poly, g.corners[i], g.corners[i + 1]), "garden outside")
  for (const l of res.lanes) for (let i = 0; i < l.pts.length; i += 2) assert.ok(pointInPoly([-152, -122, 152, -122, 152, 122, -152, 122], l.pts[i], l.pts[i + 1]) || Math.abs(l.pts[i + 1]) < 1, "street outside")
})
