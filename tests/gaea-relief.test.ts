import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deflateSync } from 'node:zlib'
import { thermalErode } from '../src/modules/gaeaRelief.ts'
import { heightsFromImage, readHeightFile, readR16, applySurfaceMasks, maskKind } from '../src/modules/gaeaImport.ts'
import { generateIsland } from '../src/modules/island.ts'
import { crc32 } from '../src/atelier/zip.ts'

test('thermal: a cliff relaxes to the talus angle, mass is kept', () => {
  const cols = 32, rows = 8, step = 8
  const h = new Float32Array(cols * rows)
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) h[r * cols + c] = c < 16 ? 100 : 10
  const before = h.reduce((a, b) => a + b, 0)
  const { removed, added } = thermalErode(h, cols, rows, step, { talusDeg: 35, iterations: 200 })
  const after = h.reduce((a, b) => a + b, 0)
  assert.ok(Math.abs(after - before) / before < 1e-4, 'mass conserved')
  const talus = Math.tan((35 * Math.PI) / 180) * step
  let worst = 0
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols - 1; c++) worst = Math.max(worst, Math.abs(h[r * cols + c] - h[r * cols + c + 1]))
  assert.ok(worst < talus * 1.3, `steepest step ${worst.toFixed(1)} m vs talus ${talus.toFixed(1)} m`)
  assert.ok(removed[4 * cols + 15] > 0 && added[4 * cols + 16] > 0, 'top loses, foot gains (scree)')
})

test('thermal: gentle slopes do not move', () => {
  const cols = 16, rows = 16, h = new Float32Array(cols * rows)
  for (let i = 0; i < h.length; i++) h[i] = (i % cols) * 2 + 5
  const copy = h.slice()
  thermalErode(h, cols, rows, 8)
  assert.deepEqual(Array.from(h), Array.from(copy))
})

test('eroded island stays a sane island (seed 21)', () => {
  const isl = generateIsland({ size: 2048, step: 8, maxHeight: 180, seaDepth: 30, landRatio: 0.55, roughness: 0.6, seed: 21, islands: 1, relief: 'eroded' })
  assert.ok(isl.masks && isl.masks.flow.length === isl.heights.length)
  const top = Math.max(...isl.heights)
  assert.ok(top > 90 && top < 260, `top ${top}`)
})

test('import r16: little endian, north-up image flipped to row 0 = south, scaled to min/max', () => {
  const s = 3, buf = new ArrayBuffer(s * s * 2), v = new DataView(buf)
  // top row (north) white, bottom row black
  for (let i = 0; i < s * s; i++) v.setUint16(i * 2, i < s ? 65535 : i >= 2 * s ? 0 : 32768, true)
  const img = readR16(buf)
  assert.equal(img.w, 3)
  const w = heightsFromImage(img, { size: 16, step: 8, minHeight: -20, maxHeight: 100 })
  assert.equal(w.cols, 3)
  assert.ok(Math.abs(w.heights[0] + 20) < 1e-6, 'south row = black = min')
  assert.ok(Math.abs(w.heights[w.cols * 2] - 100) < 1e-6, 'north row = white = max')
  assert.throws(() => readR16(new ArrayBuffer(10)))
})

function png16(w: number, h: number, px: (x: number, y: number) => number): ArrayBuffer {
  const chunk = (type: string, data: Uint8Array) => {
    const out = new Uint8Array(12 + data.length), dv = new DataView(out.buffer)
    dv.setUint32(0, data.length)
    out.set(new TextEncoder().encode(type), 4); out.set(data, 8)
    dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)))
    return out
  }
  const ihdr = new Uint8Array(13), d = new DataView(ihdr.buffer)
  d.setUint32(0, w); d.setUint32(4, h); ihdr[8] = 16; ihdr[9] = 0
  const raw = new Uint8Array(h * (1 + w * 2))
  for (let y = 0; y < h; y++) { raw[y * (1 + w * 2)] = 0; for (let x = 0; x < w; x++) { const v = px(x, y), o = y * (1 + w * 2) + 1 + x * 2; raw[o] = v >> 8; raw[o + 1] = v & 255 } }
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', new Uint8Array(deflateSync(raw))), chunk('IEND', new Uint8Array())]
  const all = new Uint8Array(parts.reduce((a, p) => a + p.length, 0))
  let o = 0
  for (const p of parts) { all.set(p, o); o += p.length }
  return all.buffer
}

test('import 16-bit PNG: full 16-bit precision, resampled on the grid', async () => {
  const img = await readHeightFile('gaea.png', png16(5, 5, (x) => x * 16384 - (x === 4 ? 1 : 0) + 1))
  assert.equal(img.w, 5)
  assert.ok(Math.abs(img.data[1] - 16385 / 65535) < 1e-7, 'not 8-bit quantised')
  const w = heightsFromImage(img, { size: 32, step: 8, minHeight: 0, maxHeight: 65535 })
  assert.equal(w.cols, 5)
  assert.ok(Math.abs(w.heights[2] - 32769) < 1e-2)
})

test('masks: kinds from names, surface mask painted over the rest', () => {
  assert.equal(maskKind('Island_Flow.png'), 'flow')
  assert.equal(maskKind('x/wear2.png'), 'wear')
  assert.deepEqual(maskKind('Rock_01.png'), { surface: 'Rock_01' })
  const g = { minX: 0, minZ: 0, step: 8, cols: 2, rows: 2 }
  const s = [{ ...g, name: 'Grass_01', weights: [1, 1, 1, 1] }]
  applySurfaceMasks(s, [{ name: 'Rock_01', weights: new Float32Array([1, 0.25, 0, 0]) }])
  const rock = s.find((x) => x.name === 'Rock_01')!
  assert.deepEqual(rock.weights, [1, 0.25, 0, 0])
  assert.deepEqual(s[0].weights, [0, 0.75, 1, 1])
})
