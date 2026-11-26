import { test } from 'node:test'
import assert from 'node:assert/strict'
import { clipForestsToWater } from '../src/modules/forestWater.ts'

const inPoly = (p: number[], x: number, z: number) => {
  let ins = false
  for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) if ((p[i + 1] > z) !== (p[j + 1] > z) && x < ((p[j] - p[i]) * (z - p[i + 1])) / (p[j + 1] - p[i + 1]) + p[i]) ins = !ins
  return ins
}
const distSeg = (p: number[], x: number, z: number) => {
  let b = Infinity
  for (let i = 0; i + 3 < p.length; i += 2) {
    const ax = p[i], az = p[i + 1], dx = p[i + 2] - ax, dz = p[i + 3] - az, L = dx * dx + dz * dz || 1
    const t = Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / L))
    b = Math.min(b, Math.hypot(x - ax - dx * t, z - az - dz * t))
  }
  return b
}

test('clipForestsToWater: no forest polygon overlaps the river corridor nor a lake', () => {
  const river = { pts: [0, 500, 300, 520, 600, 480, 1000, 500], width: 20, closed: false }
  const lake = { pts: [700, 150, 800, 150, 800, 250, 700, 250], width: 0, closed: true }
  const forests = [
    { id: 'F1', pts: [100, 300, 900, 300, 900, 700, 100, 700] }, // across the river
    { id: 'F2', pts: [600, 50, 950, 50, 950, 350, 600, 350] }, // around the lake: a hole, split
    { id: 'F3', pts: [0, 0, 200, 0, 200, 200, 0, 200] }, // dry: untouched
  ]
  const out = clipForestsToWater(forests, [river, lake], { margin: 4 })
  assert.ok(out.some((f) => f.id === 'F3' && f.pts === forests[2].pts), 'dry forest kept as is')
  assert.ok(out.filter((f) => f.id.startsWith('F1')).length >= 2, 'river splits F1 in two')
  assert.ok(out.filter((f) => f.id.startsWith('F2')).length >= 2, 'lake hole split away')
  for (const f of out) assert.ok(!f.holes, 'single rings')
  // sample the map: no point inside a forest piece is in the corridor (width / 2 + margin, 0.5 m tolerance)
  let inside = 0
  for (let x = 0; x <= 1000; x += 5) for (let z = 0; z <= 1000; z += 5) {
    const f = out.find((q) => inPoly(q.pts, x, z))
    if (!f) continue
    inside++
    assert.ok(distSeg(river.pts, x, z) > river.width / 2 + 3.5, `forest ${f.id} at ${x},${z} in the river corridor`)
    assert.ok(!inPoly(lake.pts, x, z) && distSeg([...lake.pts, lake.pts[0], lake.pts[1]], x, z) > 3.5, `forest ${f.id} at ${x},${z} in the lake`)
  }
  assert.ok(inside > 10000, `forests mostly kept (${inside})`)
})
