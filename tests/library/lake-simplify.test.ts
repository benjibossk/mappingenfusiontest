import { test } from 'node:test'
import assert from 'node:assert/strict'
import { simplifyLake, ringSelfIntersects, waterShapes, type Water } from '../../src/modules/water.ts'

// 176-point wobbly reservoir outline, segments ~1.8 m to ~6 m (like WATER_LAKE_2)
function outline(): number[] {
  const pts: number[] = []
  for (let i = 0; i < 176; i++) {
    const a = -(i / 176) * Math.PI * 2 // clockwise
    const r = 120 + 25 * Math.sin(3 * a) + 1.2 * Math.sin(37 * a)
    pts.push(500 + r * Math.cos(a), 500 + r * Math.sin(a))
  }
  return pts
}

test('lake outline: 176 points simplified to <= 60, simple, spaced', () => {
  const src = outline()
  const s = simplifyLake(src)
  const n = s.length / 2
  assert.ok(n <= 60 && n >= 8, `points ${n}`)
  assert.equal(ringSelfIntersects(s), false)
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    assert.ok(Math.hypot(s[j * 2] - s[i * 2], s[j * 2 + 1] - s[i * 2 + 1]) >= 6, 'min spacing')
  }
  // first point != last point: the ring is closed by the generator (closed: true), not duplicated
  assert.ok(s[0] !== s[s.length - 2] || s[1] !== s[s.length - 1])
})

test('waterShapes: lake sent simplified with lift = constant water level on kept points', () => {
  const g = { minX: 0, minZ: 0, step: 4, cols: 251, rows: 251 }
  const before = new Array(g.cols * g.rows).fill(0).map((_, k) => 20 + (k % g.cols) * 0.02)
  const after = before.map((h) => h - 3)
  const w: Water = { id: 'WATER_LAKE_2', type: 'lake', pts: outline(), width: 0, depth: 3, level: 30 }
  const [sh] = waterShapes([w], before, after, g)
  const n = sh.points.length / 2
  assert.ok(n <= 60)
  assert.equal(sh.closed, true)
  assert.equal(sh.lift!.length, n)
  assert.equal(ringSelfIntersects(sh.points), false)
  const x0 = (x: number, z: number) => { void z; return 20 + (x / 4) * 0.02 - 3 }
  for (let i = 0; i < n; i++) {
    const lvl = x0(sh.points[i * 2], sh.points[i * 2 + 1]) + sh.lift![i]
    assert.ok(Math.abs(lvl - 30) < 0.1, `level ${lvl}`)
  }
})
