import { test } from 'node:test'
import assert from 'node:assert/strict'
import { placeDams, damTarget, maskOutline, DAM_DEFAULTS, DAM_END } from '../../src/modules/dam.ts'
import { carveWater } from '../../src/modules/water.ts'

const g = { minX: 0, minZ: 0, step: 4, cols: 201, rows: 201 }
const valley = () => {
  const h: number[] = []
  for (let r = 0; r < g.rows; r++) for (let c = 0; c < g.cols; c++) {
    const x = c * g.step, z = r * g.step
    const k = 0.0015 + 0.004 * Math.exp(-(((z - 500) / 60) ** 2))
    h.push(20 + 0.03 * (800 - z) + k * (x - 400) ** 2)
  }
  return h
}
const river = { type: 'river' as const, pts: Array.from({ length: 39 }, (_, i) => [400, 20 + i * 20]).flat(), width: 6, depth: 1, auto: true }

test('dam: rounded ends at the side slope, no 1:1 cliff', () => {
  const r = placeDams(valley(), g, [river]), d = r.dams[0]
  const L = Math.hypot(d.bx - d.ax, d.bz - d.az), ux = (d.bx - d.ax) / L, uz = (d.bz - d.az) / L
  const t = damTarget(d, DAM_DEFAULTS, d.bx + ux * (DAM_END + 10), d.bz + uz * (DAM_END + 10))
  assert.ok(Math.abs(t - (d.crest - 10 / DAM_DEFAULTS.slope)) < 1e-6)
})

test('dam: lake carving leaves the crest and the upstream face intact', () => {
  const h = valley()
  const r = placeDams(h, g, [river]), d = r.dams[0]
  const before = h.slice()
  carveWater(h, g, [{ ...r.lakes[0], id: 'L1' }] as any)
  for (let s = -0.4; s <= 0.4; s += 0.1) {
    const x = d.cx + (d.bx - d.ax) * s, z = d.cz + (d.bz - d.az) * s
    for (let v = -DAM_DEFAULTS.crestHalf; v <= DAM_DEFAULTS.crestHalf; v += 2) {
      const k = Math.round((z + d.nz * v) / g.step) * g.cols + Math.round((x + d.nx * v) / g.step)
      assert.ok(h[k] >= before[k] - 0.05, `crest lowered at s=${s} v=${v}: ${before[k]} -> ${h[k]}`)
    }
  }
})

test('reservoir outline: no grid staircase on a diagonal shore', () => {
  const m = new Uint8Array(g.cols * g.rows)
  for (let r = 20; r < 180; r++) for (let c = 20; c < 180; c++) if (c + r < 250) m[r * g.cols + c] = 1
  const p = maskOutline(m, g)
  let diag = 0, n = p.length / 2
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n, dx = Math.abs(p[j * 2] - p[i * 2]), dz = Math.abs(p[j * 2 + 1] - p[i * 2 + 1])
    const L = Math.hypot(dx, dz)
    if (L > 0 && Math.min(dx, dz) / L > 0.5) diag += L
  }
  assert.ok(diag > 0.9 * Math.SQRT2 * 4 * 110, `diagonal shore kept as slant (${diag} m)`)
  assert.ok(n < 80, `simplified (${n} pts)`)
})
