import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dropletErode } from '../src/modules/droplets'

// a cone island on a 8 m grid, sea all around
function cone(n = 96) {
  const h = new Float32Array(n * n)
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    const d = Math.hypot(c - n / 2, r - n / 2)
    h[r * n + c] = 120 - d * 3.2 + Math.sin(c * 0.7) * Math.cos(r * 0.5) * 2
  }
  return h
}

test('droplets: same seed, same relief', () => {
  const a = cone(), b = cone()
  dropletErode(a, 96, 96, 8, { seed: 5 }); dropletErode(b, 96, 96, 8, { seed: 5 })
  assert.deepEqual(Array.from(a), Array.from(b))
  const c = cone(); dropletErode(c, 96, 96, 8, { seed: 6 })
  assert.notDeepEqual(Array.from(a), Array.from(c))
})

test('droplets: nothing at or below the sea changes', () => {
  const h = cone(), h0 = h.slice()
  const r = dropletErode(h, 96, 96, 8, { seed: 1, density: 2 })
  assert.ok(r.eroded > 1, 'it erodes')
  for (let i = 0; i < h.length; i++) if (h0[i] <= 0) assert.equal(h[i], h0[i])
  for (let i = 0; i < h.length; i++) if (h0[i] > 0) assert.ok(h[i] > 0, 'land stays land')
})

test('droplets: mass roughly conserved (eroded = deposited + carried to the sea)', () => {
  const h = cone(), h0 = h.slice()
  const r = dropletErode(h, 96, 96, 8, { seed: 3 })
  assert.ok(Math.abs(r.eroded - r.deposited - r.lost) < 1e-3 * r.eroded + 1e-6)
  let d = 0; for (let i = 0; i < h.length; i++) d += h[i] - h0[i]
  // net change of the grid = what left for the sea (float32 rounding aside)
  assert.ok(Math.abs(d + r.lost) < 0.01 * r.eroded, `net ${d} lost ${r.lost} eroded ${r.eroded}`)
  assert.ok(r.deposited > 0 && r.lost <= r.eroded)
})
