import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fencePerimeter, roadsideRuns } from '../src/modules/rowgrid.ts'

// seed 21 TOWN_1_SITE_8_barrier: a crash barrier along the lot edge down a slope, no road anywhere near
const lot = [0, 0, 60, 0, 60, 40, 0, 40]
const bar = () => fencePerimeter(lot, 'WG_CrashBarrier', 'S_barrier')

test('a crash barrier with no road nearby is dropped', () => {
  assert.equal(roadsideRuns(bar(), [{ pts: [0, 200, 100, 200], half: 3 }]).length, 0)
})

test('a crash barrier is cut to the side along the road', () => {
  const runs = roadsideRuns(bar(), [{ pts: [-50, -5, 120, -5], half: 3 }])
  assert.equal(runs.length, 1)
  assert.equal(runs[0].id, 'S_barrier')
  for (let i = 0; i < runs[0].points.length; i += 2) assert.ok(runs[0].points[i + 1] < 4, `post at z ${runs[0].points[i + 1]}`)
  assert.ok(runs[0].points.length >= 20)
})
