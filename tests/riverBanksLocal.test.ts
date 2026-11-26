import { test } from 'node:test'
import assert from 'node:assert/strict'
import { riverBanks, type Water } from '../src/modules/water'

// picture 119: bank pieces at the median half width stood 20-30 m out on the dry bank where the river is narrower
test('riverBanks: picture river pieces sit at the local traced edge, none inside a lake', () => {
  const g = { minX: 0, minZ: 0, step: 4, cols: 200, rows: 200 }
  // a valley: the ground rises 0.2 m/m away from the river line
  const hs = Array.from({ length: 200 * 200 }, (_, k) => { const x = (k % 200) * 4, z = Math.floor(k / 200) * 4; return 5 - x * 0.0025 + 0.2 * Math.abs(z - 400 - 120 * Math.sin((x - 20) / 76)) })
  const pts: number[] = [], widths: number[] = []
  for (let i = 0; i <= 20; i++) { const x = 20 + i * 38; pts.push(x, 400 + 120 * Math.sin(i / 2)); widths.push(i < 10 ? 40 : 120) }
  const w: Water = { id: 'R', type: 'river', pts, width: 80, widths, depth: 2.5, carve: false, wetEdge: true }
  const bs = riverBanks([w], hs, g)
  assert.ok(bs.length > 4)
  for (const b of bs) {
    let bd = Infinity, bi = 0
    for (let j = 0; j + 3 < pts.length; j += 2) {
      const px = pts[j], pz = pts[j + 1], qx = pts[j + 2] - px, qz = pts[j + 3] - pz, Q = qx * qx + qz * qz
      const u = Math.min(1, Math.max(0, ((b.x - px) * qx + (b.z - pz) * qz) / Q)), d = Math.hypot(b.x - px - qx * u, b.z - pz - qz * u)
      if (d < bd) { bd = d; bi = j / 2 }
    }
    const lo = Math.min(widths[bi], widths[bi + 1]) / 2, hi = Math.max(widths[bi], widths[bi + 1]) / 2
    assert.ok(bd > lo - 12 && bd < hi + 12, `${b.id} ${bd.toFixed(0)} vs ${lo}..${hi}`)
  }
  const lake: Water = { id: 'L', type: 'lake', pts: [-200, -200, 1000, -200, 1000, 1000, -200, 1000], width: 0, depth: 2 }
  assert.equal(riverBanks([w, lake], hs, g).length, 0)
})

test('riverBanks: no eroded embankment on a flat bank (picture 119 round 11: round bumps on the grass)', () => {
  const g = { minX: 0, minZ: 0, step: 4, cols: 200, rows: 200 }
  const hs = Array.from({ length: 200 * 200 }, () => 0.8)
  const pts: number[] = []
  for (let i = 0; i <= 20; i++) pts.push(20 + i * 38, 400 + 120 * Math.sin(i / 2))
  assert.equal(riverBanks([{ id: 'R', type: 'river', pts, width: 80, depth: 2.5, carve: false, wetEdge: true }], hs, g).length, 0)
})
