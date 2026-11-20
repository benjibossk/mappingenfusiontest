// Road splines sent to the Workbench: no tiny segment, no hairpin vertex, no long straight span (seed 21 crash
// after "invalid segments on the road"); power station tracks carry the same spline params as the roads.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sanitizeRoadLine, roadShapes } from '../../src/modules/roads'
import { accessShapes } from '../../src/modules/powergrid'

const segs = (p: number[]) => { const s: number[] = []; for (let i = 0; i + 3 < p.length; i += 2) s.push(Math.hypot(p[i + 2] - p[i], p[i + 3] - p[i + 1])); return s }
const turns = (p: number[]) => { const t: number[] = []; for (let i = 0; i + 5 < p.length; i += 2) { const ux = p[i + 2] - p[i], uz = p[i + 3] - p[i + 1], vx = p[i + 4] - p[i + 2], vz = p[i + 5] - p[i + 3]; t.push(Math.acos(Math.max(-1, Math.min(1, (ux * vx + uz * vz) / (Math.hypot(ux, uz) * Math.hypot(vx, vz))))) * 180 / Math.PI) } return t }

test('sanitizeRoadLine: duplicates, short end, hairpin and long span fixed, ends kept', () => {
  const p = sanitizeRoadLine([0, 0, 0, 0, 0.5, 0, 50, 0, 40, 0.5, 60, 0, 100, 0, 100.8, 0], 3)
  assert.deepEqual(p.slice(0, 2), [0, 0]); assert.deepEqual(p.slice(-2), [100.8, 0])
  assert.ok(Math.min(...segs(p)) >= 3, 'min seg'); assert.ok(Math.max(...segs(p)) <= 20, 'max seg')
  assert.ok(Math.max(...turns(p)) <= 100, 'turn')
})

test('exported road and access splines pass the same checks', () => {
  const sh = [...roadShapes([{ id: 'R', type: 'dirt', pts: [0, 0, 1, 0, 1.5, 0, 200, 0, 200, 1] }]), ...accessShapes([[0, 0, 180, 0]])]
  for (const s of sh) {
    assert.ok(Math.min(...segs(s.points)) >= 3 && Math.max(...segs(s.points)) <= 20, s.id)
    assert.equal((s as { paramValues?: string[] }).paramValues?.[0], '0', s.id + ' AdjustHeightMap off')
  }
})
