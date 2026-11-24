// Mountain pass roads (network.ts comfortGrade + 20 m grade window): a link that must climb a 40 % flank keeps
// the comfortable grade by winding up in lacets, with hairpins of a drivable radius and no kink elsewhere
import test from 'node:test'
import assert from 'node:assert/strict'
import { buildNetwork, comfortGrade, worstGrade } from '../../src/modules/network'
import { carveRoads } from '../../src/modules/roads'
import { roadCurveStats } from '../../src/modules/roadgeom'

const step = 8, cols = 256, rows = 128, g = { minX: 0, minZ: 0, step, cols, rows }
// valley floor at 20 m, a flank of `slope` from z = 300 to 600, a shelf above it
const flank = (slope: number) => {
  const h: number[] = []
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) h.push(20 + Math.min(300 * slope, Math.max(0, (r * step - 300) * slope)))
  return h
}
const sites = [{ id: 'A', x: 1024, z: 150, kind: 'village' as const }, { id: 'B', x: 1024, z: 800, kind: 'village' as const }]
const base = { seed: 1, sites: 2, spacing: 300, maxSlope: 8, main: 'asphalt' as const, minor: 'asphalt' as const, lane: 'dirt' as const }

test('comfortable grades: paved 10 %, tracks 15 %, trails unchanged', () => {
  assert.equal(comfortGrade('asphalt'), 0.1)
  assert.equal(comfortGrade('dirt'), 0.15)
  assert.equal(comfortGrade('trailDirt'), 0.3)
  assert.equal(comfortGrade('motorway'), 0.06)
})

for (const [slope, type] of [[0.25, 'asphalt'], [0.4, 'dirt']] as const) {
  test(`a road up a ${slope * 100} % flank winds in lacets under the ${type} comfortable grade`, () => {
    const h = flank(slope)
    const roads = buildNetwork(h, g, undefined, sites, base)
    assert.equal(roads.length, 1)
    const r = roads[0]
    assert.equal(r.type, type)
    const t = h.slice()
    carveRoads(t, g, roads)
    const gr = worstGrade(r.pts, t, g).grade
    assert.ok(gr <= comfortGrade(r.type) + 0.01, `grade ${(gr * 100).toFixed(1)} % on ${r.type}`)
    const s = roadCurveStats(r.pts)
    assert.ok(s.hairpins >= 2, `hairpins ${s.hairpins}`)
    assert.ok(s.minRadius >= 12, `tightest radius ${s.minRadius.toFixed(1)} m`)
    assert.ok(s.maxTurn <= 55, `sharpest turn between 10 m chords ${s.maxTurn.toFixed(0)} deg`)
  })
}

test('a gentle slope needs no lacet', () => {
  const h = flank(0.06)
  const roads = buildNetwork(h, g, undefined, sites, base)
  assert.equal(roads.length, 1)
  assert.equal(roadCurveStats(roads[0].pts).hairpins, 0)
})
