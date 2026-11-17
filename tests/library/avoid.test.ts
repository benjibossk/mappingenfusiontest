import { test } from 'node:test'
import assert from 'node:assert/strict'
import { FOREST_AVOID, ZONE_AVOID, withAvoid, type ProjectShape } from '../../src/project.ts'

const base: ProjectShape = { id: 'F1', kind: 'polyline', closed: true, points: [0, 0, 10, 0, 10, 10], generator: '{X}FG.et' }

test('withAvoid expands avoid into m_bAvoid* params and drops the field', () => {
  const s = withAvoid({ ...base, avoid: FOREST_AVOID })
  assert.equal(s.avoid, undefined)
  const get = (k: string) => s.paramValues?.[s.paramKeys!.indexOf(k)]
  for (const k of ['m_bAvoidRoads', 'm_bAvoidTracks', 'm_bAvoidRivers', 'm_bAvoidLakes', 'm_bAvoidPowerLines', 'm_bAvoidObjects']) assert.equal(get(k), '1', k)
  assert.equal(s.closed, true)
})

test('zone default keeps objects off, explicit params win, no avoid = unchanged', () => {
  const s = withAvoid({ ...base, avoid: ZONE_AVOID, paramKeys: ['m_bAvoidRoads'], paramValues: ['0'] })
  assert.equal(s.paramValues?.[s.paramKeys!.indexOf('m_bAvoidObjects')], '0')
  assert.equal(s.paramKeys!.filter((k) => k === 'm_bAvoidRoads').length, 1)
  assert.equal(s.paramValues?.[0], '0')
  assert.equal(withAvoid(base), base)
})
