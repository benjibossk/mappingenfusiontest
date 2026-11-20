import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { inflateSync } from 'node:zlib'
import { writeMasks } from '../../bridge/terrain-masks.mjs'
import { paintPreview, previewGrid, toLayers, type MaskBody } from '../../src/preview/finalMasks'

// app side (preview/finalMasks.ts) and bridge side (POST /masks -> writeMasks) paint the same pixels

/** 8-bit greyscale PNG written by bridge png() (filter 0 on every row) -> pixels */
function readGrey(file: string) {
  const b = readFileSync(file)
  const w = b.readUInt32BE(16), h = b.readUInt32BE(20)
  const idat: Buffer[] = []
  for (let o = 8; o < b.length;) {
    const len = b.readUInt32BE(o), type = b.toString('latin1', o + 4, o + 8)
    if (type === 'IDAT') idat.push(b.subarray(o + 8, o + 8 + len))
    o += 12 + len
  }
  const raw = inflateSync(Buffer.concat(idat)), out = new Uint8Array(w * h)
  for (let r = 0; r < h; r++) { assert.equal(raw[r * (w + 1)], 0); out.set(raw.subarray(r * (w + 1) + 1, (r + 1) * (w + 1)), r * w) }
  return out
}

function world(): MaskBody {
  let seed = 11
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648)
  const cols = 30, rows = 30, step = 9
  const names = ['Grass_01', 'Dirt_01', 'Rock_01', 'Sand_01', 'ForestFloor_01', 'Crop_01', 'Heather_01']
  const surfaces = names.map((name) => ({ name, minX: 0, minZ: 0, step, cols, rows, weights: Array.from({ length: cols * rows }, () => (rnd() < 0.45 ? rnd() : 0)) }))
  const roads = [
    { points: [5, 5, 120, 180, 255, 250], half: 3, edge: 2, core: 'Asphalt_01' },
    { points: [0, 240, 250, 20], half: 2, edge: 3, core: 'Gravel_01', side: 'Dirt_01' },
  ]
  const colours = Object.fromEntries([...names, 'Asphalt_01', 'Gravel_01'].map((n, i) => [n, [i * 30, 255 - i * 20, (i * 70) % 255] as [number, number, number]]))
  return { terrainSize: 261, surfaces, roads, colours }
}

test('final masks: app-side painting = bridge PNGs (same side, same blocks)', () => {
  const body = world(), side = 253
  const dir = mkdtempSync(join(tmpdir(), 'fm-'))
  try {
    const r = writeMasks(dir, side, body.terrainSize, body.surfaces, body.roads, body.colours)
    const app = paintPreview(body, { side, blockPx: 63, margin: 3 })
    assert.deepEqual(app.names, r.written)
    assert.ok(app.names.includes('Asphalt_01') && app.names.includes('Gravel_01'), 'road surfaces stamped in')
    app.names.forEach((n, k) => assert.ok(Buffer.from(app.bytes[k]).equals(Buffer.from(readGrey(join(dir, n + '.png')))), n))
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('final masks: preview grid keeps the engine block count, layers flip north-up pixels to a south-up grid', () => {
  const g = previewGrid(4096)
  assert.equal((g.side - 1) / g.blockPx, Math.ceil(4096 / 252) * 4)
  const body = world(), p = paintPreview(body, previewGrid(body.terrainSize))
  const L = toLayers(p, body.terrainSize)
  assert.equal(L[0].cols, p.side)
  assert.equal(L[0].weights[0], p.bytes[0][(p.side - 1) * p.side] / 255) // south-west vertex = last pixel row
})
