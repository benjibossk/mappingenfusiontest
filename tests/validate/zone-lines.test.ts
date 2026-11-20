// Zone streets and fences off the other roads: the pre-send check sees them (shapeOnRoad), and the industrial
// generator keeps its lots / cross streets / fences off a second road crossing its frame (seed 21 live bug).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { preSendChecks, zoneLines } from '../../src/validate/preSend'
import { generateIndustrial } from '../../src/modules/industrial'
import { roadHalf, centreLine, type Road } from '../../src/modules/roads'

test('shapeOnRoad: a zone fence along another road is reported, a street meeting it at its end is not', () => {
  const zones = [{ id: 'IND_1', entities: [], lines: [
    { id: 'IND_1_fence', pts: [10, 21, 90, 21], half: 0.3 }, // runs along R1 inside its carriageway
    { id: 'IND_1_spine', pts: [50, 20, 50, 100], half: 5 }, // joins R1 at its first end only
  ] }]
  const roads = [{ id: 'R1', half: 3, line: [0, 20, 200, 20] }]
  const is = preSendChecks({ width: 256, height: 256, settled: [], zones, roads })
  assert.deepEqual(is.map((i) => i.kind + ' ' + i.id), ['shapeOnRoad IND_1_fence / R1'])
})

test('industrial zone: no lot, cross street or fence on a second road through its frame', () => {
  const main: Road = { id: 'MAIN', type: 'asphalt', pts: [0, 0, 400, 0] }
  const side: Road = { id: 'SIDE', type: 'asphalt', pts: [260, 0, 260, 400] } // crosses the zone's east part
  const z = generateIndustrial(() => 10, [main, side], { type: 'factory', seed: 3, center: { x: 200, z: 120 }, size: { w: 240, d: 200 } })
  assert.ok(z.lots.length > 0)
  const lines = zoneLines({ roads: z.roads, shapes: z.shapes as never }, roadHalf as never)
  const is = preSendChecks({ width: 512, height: 512, settled: [], zones: [{ id: 'IND', entities: [], lines }],
    roads: [main, side].map((r) => ({ id: r.id, half: roadHalf(r), line: centreLine(r.pts, 4) })) })
  assert.deepEqual(is.filter((i) => i.kind === 'shapeOnRoad').map((i) => i.id), [])
})
