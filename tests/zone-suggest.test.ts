import { test } from 'node:test'
import assert from 'node:assert/strict'
import { suggestZone, zoneFeatures, findGaps, gapStage, stagePlan, type SuggestWorld } from '../src/modules/zoneSuggest.ts'

// 8 km square, 32 m cells, land everywhere at 20 m except a sea strip on the west (x < 400)
function world(slope: (x: number, z: number) => number = () => 20): SuggestWorld {
  const cell = 32, n = 251, heights: number[] = []
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) { const x = c * cell, z = r * cell; heights.push(x < 400 ? -5 : slope(x, z)) }
  return { heights, grid: { cols: n, rows: n, cell }, places: [], houses: [], roads: [] }
}
const square = (x: number, z: number, s: number) => [x, z, x + s, z, x + s, z + s, x, z + s]
const asphalt = (z: number) => ({ type: 'asphalt', pts: [400, z, 8000, z] })

test('features: area, slope, road, distances', () => {
  const w = world((x) => 20 + x * 0.2)
  w.roads.push(asphalt(2000)); w.places.push({ x: 5000, z: 2000, kind: 'town' })
  const f = zoneFeatures(square(2000, 1900, 200), w)
  assert.ok(Math.abs(f.areaHa - 4) < 0.01)
  assert.ok(Math.abs(f.meanSlope - 0.2) < 0.02, String(f.meanSlope))
  assert.ok(f.roadInside && f.pavedM < 5)
  assert.ok(f.townM > 2500 && f.townM < 3000)
})

test('flat, far from towns, on asphalt: military camp or town first', () => {
  const w = world(); w.roads.push(asphalt(3000))
  w.places.push({ x: 1000, z: 1000, kind: 'town' }, { x: 7000, z: 7000, kind: 'town' })
  const s = suggestZone(square(3500, 2800, 500), w)
  assert.ok(s.length >= 3)
  assert.ok(['camp', 'town'].includes(s[0].id), s.map((q) => q.id).join())
})

test('valley between two villages 1.5 km apart: housing, "between" reason', () => {
  const w = world(); w.roads.push(asphalt(4000))
  w.places.push({ x: 3000, z: 4000, kind: 'village' }, { x: 4500, z: 4000, kind: 'village' })
  const s = suggestZone(square(3650, 3900, 200), w)
  const h = s.find((q) => q.id === 'habitation')
  assert.ok(h && h.key === 'zs.between', JSON.stringify(s))
  assert.ok(s.indexOf(h) <= 2)
})

test('steep wooded slope by a river: logging first', () => {
  const w = world((x) => 20 + Math.max(0, x - 3000) * 0.3)
  w.forests = [square(3000, 3000, 1000)]
  w.waters = [{ type: 'river', pts: [3000, 0, 3000, 8000] }]
  w.roads.push({ type: 'dirt', pts: [2900, 0, 2900, 8000] })
  const s = suggestZone(square(3100, 3200, 500), w)
  assert.equal(s[0].id, 'production')
  assert.equal(s[0].key, 'zs.logging.river')
})

test('sea polygon gives nothing; coast gives a beach', () => {
  const w = world()
  assert.equal(suggestZone(square(0, 0, 300), w).length, 0)
  const w2 = world(() => 2)
  assert.ok(suggestZone(square(410, 3000, 120), w2, 20).some((q) => q.id === 'beach'))
})

test('gaps: empty land is found, occupied land is not, sea is not', () => {
  const w = world(); w.roads.push(asphalt(4000))
  for (let x = 400; x < 8000; x += 60) for (let z = 4500; z < 8000; z += 60) w.houses.push({ x, z }) // north half built
  const g = findGaps(w, { seed: 3 })
  assert.ok(g.length > 0)
  for (const gp of g) {
    assert.ok(gp.cz < 4200, `gap at ${gp.cx},${gp.cz}`)
    assert.ok(gp.cx > 400)
    assert.ok(gp.best && gp.best.score > 0)
    assert.ok(gp.stage >= 0 && gp.stage <= 3)
  }
})

test('gaps: a dismissed gap ("not an empty area") stays hidden', () => {
  const w = world(); w.roads.push(asphalt(4000))
  const all = findGaps(w)
  const d = { x: all[0].cx, z: all[0].cz }
  const again = findGaps(w, { dismissed: [d] })
  assert.ok(again.every((g) => Math.hypot(g.cx - d.x, g.cz - d.z) > 1))
  assert.equal(again.length, Math.min(24, all.length - 1 + (all.length > 24 ? 1 : 0)))
})

test('stages: forest -> logged -> construction -> village, deterministic', () => {
  assert.deepEqual([0, 1, 2, 3].map((s) => stagePlan(s).id), ['forest', 'production', 'construction', 'habitation'])
  assert.equal(stagePlan(7).id, 'habitation')
  assert.equal(gapStage(1, 1234, 5678), gapStage(1, 1234, 5678))
  const seen = new Set<number>()
  for (let i = 0; i < 200; i++) seen.add(gapStage(1, i * 137, i * 91))
  assert.equal(seen.size, 4)
})
