// Progressive forest edges (src/modules/forestEdge.ts): bands inside the forest, no overlap, area kept,
// no edge where two forests touch.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as turf from '@turf/turf'
import { forestEdges, forestEdgeShapes, flatArea, EDGE_GEN } from '../../src/modules/forestEdge.ts'
import { flatToPoly } from '../../src/modules/zonefill.ts'

const sq = (x0: number, z0: number, s: number) => [x0, z0, x0 + s, z0, x0 + s, z0 + s, x0, z0 + s]
const GEN = '{AAAAAAAAAAAAAAAA}core.et'
const big = { id: 'F1', pts: sq(0, 0, 400), leaf: 'broad' as const, generator: GEN }
const pieces = forestEdges([big])

test('forest edge: core + 2 bands with vanilla sparse generators', () => {
  assert.ok(pieces.some((p) => p.band === 0 && p.generator === GEN))
  assert.ok(pieces.some((p) => p.band === 1 && p.generator === EDGE_GEN.brush))
  assert.ok(pieces.some((p) => p.band === 2 && p.generator === EDGE_GEN.birch))
})

test('forest edge: every piece inside the original, area conserved, no overlap', () => {
  const A = flatToPoly(big.pts)!
  let sum = 0
  for (const p of pieces) {
    sum += flatArea(p.pts)
    for (let i = 0; i < p.pts.length; i += 2) assert.ok(p.pts[i] >= -0.01 && p.pts[i] <= 400.01 && p.pts[i + 1] >= -0.01 && p.pts[i + 1] <= 400.01)
    assert.ok(turf.booleanWithin(turf.centroid(flatToPoly(p.pts)!), A) || flatArea(p.pts) < 2000)
  }
  assert.ok(Math.abs(sum - 160000) / 160000 < 0.02, `area ${sum}`)
  const polys = pieces.map((p) => flatToPoly(p.pts)!)
  for (let i = 0; i < polys.length; i++) for (let j = i + 1; j < polys.length; j++) {
    const x = turf.intersect(turf.featureCollection([polys[i], polys[j]]))
    assert.ok(!x || flatArea(x.geometry.type === 'Polygon' ? x.geometry.coordinates[0].flat() : []) < 5, `overlap ${pieces[i].id}/${pieces[j].id}`)
  }
})

test('forest edge: no band along a side shared with another forest', () => {
  const ps = forestEdges([big, { id: 'F2', pts: sq(400, 0, 400), generator: GEN }])
  const e1 = ps.filter((p) => p.forest === 'F1' && p.band > 0)
  assert.ok(e1.length > 0)
  // no edge piece of F1 within 20 m of the shared side x = 400 (away from the corners)
  for (const p of e1) for (let i = 0; i < p.pts.length; i += 2) if (p.pts[i + 1] > 40 && p.pts[i + 1] < 360) assert.ok(p.pts[i] < 376, `edge at x=${p.pts[i]}`)
})

test('forest edge: small forests stay whole, shapes avoid obstacles', () => {
  const ps = forestEdges([{ id: 'S', pts: sq(0, 0, 50), generator: GEN }])
  assert.equal(ps.length, 1)
  assert.equal(ps[0].band, 0)
  const sh = forestEdgeShapes(pieces)
  assert.ok(sh.every((s) => s.closed && s.avoid?.objects && s.avoid.roads))
})
