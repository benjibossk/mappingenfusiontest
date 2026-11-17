import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generateCampaign } from '../../src/modules/campaign.ts'
import { clipPlots, flatToPoly, plotGroves, plotTracks } from '../../src/modules/zonefill.ts'
import { pointInPoly } from '../../src/modules/industrial.ts'

const zone = [0, 0, 600, 0, 600, 400, 0, 400]
const raw = generateCampaign({ zone, fieldSize: 90, jitter: 0.5, angle: 10, hedgeChance: 0.5, minHedge: 12, seed: 3 })
const kept = clipPlots(raw.fields, { obstacles: [], zone: flatToPoly(zone), ok: () => true })
const inPlot = (x: number, z: number) => kept.some((f) => pointInPoly(f.flat(), x, z))

test('groves: small rings at plot corners, never inside a plot', () => {
  let s = 7
  const g = plotGroves(kept, { rnd: () => ((s = (s * 16807) % 2147483647) / 2147483647), ok: () => true, chance: 0.6 })
  assert.ok(g.length > 0)
  for (const r of g) for (let i = 0; i < r.length; i += 2) assert.ok(!inPlot(r[i], r[i + 1]), 'grove in a field')
})

test('tracks: plots linked to a road outside the zone, no track across a field', () => {
  const road = [[-150, -500, -150, 900]]
  const tr = plotTracks(kept, road, { maxLen: 400 })
  assert.ok(tr.length > 0)
  for (const t of tr) for (let k = 1; k < 10; k++) {
    const x = t[0] + ((t[2] - t[0]) * k) / 10, z = t[1] + ((t[3] - t[1]) * k) / 10
    assert.ok(!inPlot(x, z), 'track across a field')
  }
})
