import { test } from 'node:test'
import assert from 'node:assert/strict'
import { scenarioFit, fitMetrics, type FitInput } from '../src/modules/scenarioFit.ts'

function island(size: number, nPlaces: number, connected: boolean): FitInput {
  const cell = 16, cols = Math.round(size / cell), rows = cols
  const heights = new Float32Array(cols * rows).fill(20)
  for (let i = 0; i < cols; i++) { heights[i] = -5; heights[(rows - 1) * cols + i] = -5; heights[i * cols] = -5; heights[i * cols + cols - 1] = -5 }
  const places = Array.from({ length: nPlaces }, (_, i) => ({ x: 600 + (i % 4) * ((size - 1200) / 3), z: 600 + Math.floor(i / 4) * 900, kind: 'village' }))
  const houses = places.flatMap((p, k) => Array.from({ length: k === 0 ? 50 : 10 }, (_, j) => ({ x: p.x + (j % 8) * 12, z: p.z + Math.floor(j / 8) * 12 })))
  const roads = places.slice(1).map((p, i) => {
    const a = places[i], pts: number[] = []
    for (let t = 0; t <= 1.0001; t += 0.02) pts.push(a.x + (p.x - a.x) * t, a.z + (p.z - a.z) * t)
    return { type: connected || i % 2 ? 'asphalt' : 'dirt', pts: connected || i % 2 === 0 ? pts : pts.map((v) => v + 3000) }
  })
  return { heights, grid: { cols, rows, cell }, places, houses, roads }
}

test('scenario fit: big connected island suits Conflict and FF, small one does not', () => {
  const big = island(6000, 12, true), m = fitMetrics(big)
  assert.ok(m.hqPair >= 3000, `hq ${m.hqPair}`); assert.equal(m.roadGroups, 1); assert.equal(m.placesOnMainRoad, 1)
  const fit = Object.fromEntries(scenarioFit(big).map((f) => [f.id, f]))
  assert.notEqual(fit.conflict.level, 'no', JSON.stringify(fit.conflict)); assert.ok(fit.conflict.lacks.every((l) => l.key === 'radio'))
  assert.notEqual(fit.ff.level, 'no', JSON.stringify(fit.ff))
  assert.equal(fit.gm.level, 'ok')
  const small = Object.fromEntries(scenarioFit(island(1500, 3, true)).map((f) => [f.id, f]))
  assert.equal(small.conflict.level, 'no'); assert.ok(small.conflict.lacks.some((l) => l.key === 'hq'))
  assert.equal(small.ff.level, 'no'); assert.ok(small.ff.lacks.some((l) => l.key === 'area'))
})

test('scenario fit: road islands are reported', () => {
  const m = fitMetrics(island(6000, 12, false))
  assert.ok(m.roadGroups > 1 && m.placesOnMainRoad < 0.95)
  const ff = scenarioFit(island(6000, 12, false)).find((f) => f.id === 'ff')!
  assert.ok(ff.lacks.some((l) => l.key === 'roads'))
})
