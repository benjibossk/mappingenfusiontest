import { test } from 'node:test'
import assert from 'node:assert/strict'
import { joinTributaries, waterShapes, type Water } from '../src/modules/water'
import type { ProjectShape } from '../src/project'

test('waterShapes: a river from map-edge sea to map-edge sea keeps its dry course (picture 119 sent 2 points)', () => {
  const g = { minX: 0, minZ: 0, step: 4, cols: 251, rows: 251 }
  const hs = new Float32Array(251 * 251)
  // sea (-30) on the first and last 120 m along x, land at 2 m between
  for (let r = 0; r < 251; r++) for (let c = 0; c < 251; c++) { const x = c * 4; hs[r * 251 + c] = x < 120 || x > 880 ? -30 : 2 }
  const pts: number[] = []
  for (let x = 0; x <= 1000; x += 20) pts.push(x, 500)
  const w: Water = { id: 'R', type: 'river', pts, width: 40, depth: 2.5, carve: false, wetEdge: true }
  const [s] = waterShapes([w], hs, hs, g)
  const xs = s.points.filter((_, i) => i % 2 === 0)
  assert.ok(s.points.length / 2 > 20, `${s.points.length / 2} points`)
  assert.ok(Math.min(...xs) < 130 && Math.max(...xs) > 870, `${Math.min(...xs)}..${Math.max(...xs)}`)
})

test('joinTributaries: a river starting inside another goes on to its centre and comes down to its level', () => {
  const ground = () => 0
  const main: ProjectShape = { id: 'M', kind: 'spline', closed: false, points: [0, 0, 100, 0, 200, 0], paramKeys: ['Width'], paramValues: ['100'], lift: [0.5, 0.5, 0.5] }
  const trib: ProjectShape = { id: 'T', kind: 'spline', closed: false, points: [100, 20, 100, 60, 100, 100, 100, 200], paramKeys: ['Width'], paramValues: ['40'], lift: [2.5, 2.5, 2.5, 2.5] }
  joinTributaries([main, trib], ground)
  assert.deepEqual(trib.points.slice(0, 2), [100, 0])
  assert.equal(trib.lift![0], 0.5)
  assert.ok(trib.lift![1] < 1.5, String(trib.lift))
  assert.equal(trib.lift![trib.lift!.length - 1], 2.5)
  assert.equal(main.points.length, 6)
})
