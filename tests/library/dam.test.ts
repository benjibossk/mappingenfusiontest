import { test } from 'node:test'
import assert from 'node:assert/strict'
import { placeDams, damTarget, damZone, pointInPoly, DAM_DEFAULTS, DAM_PARAPET } from '../../src/modules/dam.ts'

// a valley running +Z (downstream), narrow throat around z = 500, bed falling 3 cm/m
const g = { minX: 0, minZ: 0, step: 4, cols: 201, rows: 201 }
const valley = () => {
  const h: number[] = []
  for (let r = 0; r < g.rows; r++) for (let c = 0; c < g.cols; c++) {
    const x = c * g.step, z = r * g.step
    const k = 0.0015 + 0.004 * Math.exp(-(((z - 500) / 60) ** 2)) // steeper sides at the throat
    h.push(20 + 0.03 * (800 - z) + k * (x - 400) ** 2)
  }
  return h
}
const river = { type: 'river' as const, pts: Array.from({ length: 39 }, (_, i) => [400, 20 + i * 20]).flat(), width: 6, depth: 1, auto: true }
const H = (a: number[], x: number, z: number) => a[Math.round(z / g.step) * g.cols + Math.round(x / g.step)]

test('dam: closes the throat, reservoir upstream only, level under the crest, river restarts at the foot', () => {
  const h = valley(), before = h.slice()
  const r = placeDams(h, g, [river])
  assert.equal(r.dams.length, 1)
  const d = r.dams[0]
  assert.ok(Math.abs(d.cz - 500) < 80, `dam at the throat (z=${d.cz})`)
  // edge to edge: both crest ends reach ground at crest height
  assert.ok(H(before, d.ax, d.az) >= d.crest - 0.5 && H(before, d.bx, d.bz) >= d.crest - 0.5)
  assert.ok(Math.abs(d.crest - DAM_DEFAULTS.height - d.bed) < 1e-6)
  // crest raised to its height on the river axis
  assert.ok(H(h, d.cx, d.cz) >= d.crest - 0.5)
  // lake: level <= crest, polygon upstream only
  const lake = r.lakes[0]
  assert.ok(lake.level! <= d.crest - DAM_DEFAULTS.freeboard + 1e-6)
  for (let i = 0; i < lake.pts.length; i += 2) assert.ok((lake.pts[i + 1] - d.cz) * d.nz + (lake.pts[i] - d.cx) * d.nx < d.toe, 'lake point downstream')
  assert.ok(pointInPoly(lake.pts, 400, d.cz - d.toe - 40), 'lake just upstream')
  assert.ok(!pointInPoly(lake.pts, 400, d.cz + d.toe + 20), 'no lake downstream')
  // river: one piece ends before the lake, one starts at the foot
  const down = r.rivers.find((w) => w.pts[1] > d.cz)!
  assert.deepEqual([down.pts[0], down.pts[1]], d.foot)
  assert.ok(d.foot[1] - d.cz >= d.toe)
  for (const w of r.rivers) for (let i = 0; i < w.pts.length; i += 2) assert.ok(!pointInPoly(lake.pts, w.pts[i], w.pts[i + 1]) || w !== down)
  // embankment only raises
  for (let k = 0; k < h.length; k++) assert.ok(h[k] >= before[k])
  assert.ok(damTarget(d, DAM_DEFAULTS, d.cx, d.cz) === d.crest)
})

test('dam zone: continuous parapet on both crest edges', () => {
  const h = valley(), d = placeDams(h, g, [river]).dams[0]
  const z = damZone(d)
  const L = Math.hypot(d.bx - d.ax, d.bz - d.az)
  const par = z.shapes.filter((s) => s.generator === DAM_PARAPET)
  assert.equal(par.length, 2)
  assert.equal(z.entities.length, 0)
  for (const s of par) {
    const p = s.points, n = p.length
    assert.ok(Math.hypot(p[n - 2] - p[0], p[n - 1] - p[1]) >= L)
    for (let i = 0; i < n; i += 2) assert.ok(damTarget(d, DAM_DEFAULTS, p[i], p[i + 1]) === d.crest)
  }
  assert.ok(z.access)
})

test('dam: no throat (flat plain) = no dam', () => {
  const h = new Array(g.cols * g.rows).fill(30).map((v, k) => v + 0.01 * (800 - Math.floor(k / g.cols) * g.step))
  assert.equal(placeDams(h, g, [river]).dams.length, 0)
})
