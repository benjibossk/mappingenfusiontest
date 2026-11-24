import { test } from 'node:test'
import assert from 'node:assert/strict'
import { streamPowerErode } from '../src/modules/streamPower.ts'

// Tilted plane sloping towards y = 0 (sea), with deterministic hash noise.
function terrain(cols: number, rows: number, step: number): number[] {
  const h: number[] = new Array(cols * rows)
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453
    const noise = s - Math.floor(s)
    h[y * cols + x] = y * step * 0.05 + 20 * Math.sin(x / 9) * Math.cos(y / 13) + noise * 2 - 3
  }
  return h
}

test('stream power: a valley is carved along the flow', () => {
  const cols = 64, rows = 64, step = 8
  const h: number[] = new Array(cols * rows)
  // V-shaped valley along x = 32, sloping down to y = 0.
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++)
    h[y * cols + x] = 5 + y * 0.5 + Math.abs(x - 32) * 1.0
  const before = h.slice()
  const r = streamPowerErode(h, { cols, rows, step }, { iterations: 5, k: 2e-5 })
  const yMid = 40
  const axis = yMid * cols + 32, side = yMid * cols + 10
  const dropAxis = before[axis] - h[axis], dropSide = before[side] - h[side]
  assert.ok(dropAxis > 0.5, `axis dropped ${dropAxis}`)
  assert.ok(dropAxis > 2 * dropSide, `axis ${dropAxis} vs side ${dropSide}`)
  assert.ok(r.flow[axis] > r.flow[side])
  for (const a of [r.flow, r.wear, r.deposits]) for (const v of a) assert.ok(v >= 0 && v <= 1)
})

test('stream power: nothing goes below sea level', () => {
  const cols = 96, rows = 96
  const h = terrain(cols, rows, 8)
  const below = h.map((v) => v < 2)
  streamPowerErode(h, { cols, rows, step: 8 }, { sea: 2, iterations: 15, k: 1e-3 })
  h.forEach((v, i) => { if (!below[i]) assert.ok(v >= 2, `cell ${i} at ${v}`) })
})

test('stream power: deterministic', () => {
  const a = terrain(80, 70, 8), b = terrain(80, 70, 8)
  const ra = streamPowerErode(a, { cols: 80, rows: 70, step: 8 }, { iterations: 8 })
  const rb = streamPowerErode(b, { cols: 80, rows: 70, step: 8 }, { iterations: 8 })
  assert.deepEqual(a, b)
  assert.deepEqual(ra.flow, rb.flow)
  assert.deepEqual(ra.wear, rb.wear)
})

test('stream power: 512x512 under 2 s', () => {
  const h = terrain(512, 512, 8)
  const t0 = performance.now()
  streamPowerErode(h, { cols: 512, rows: 512, step: 8 }, { iterations: 10 })
  const ms = performance.now() - t0
  console.log(`512x512 x10 iterations: ${ms.toFixed(0)} ms`)
  assert.ok(ms < 2000, `${ms} ms`)
})
