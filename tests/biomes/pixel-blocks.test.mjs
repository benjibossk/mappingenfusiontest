import { test } from 'node:test'
import assert from 'node:assert/strict'
import { limitPixelBlocks, enforcePixelBlocks } from '../../bridge/terrain-masks.mjs'

// Workbench "Surface import: Too many layers at BLOCK": 4 painted surfaces max per 63 px block (+ 3 px margin)
const overfull = (bytes, side, B = 63, M = 3, max = 4) => {
  const nb = Math.ceil((side - 1) / B)
  let bad = 0
  for (let by = 0; by < nb; by++) for (let bx = 0; bx < nb; bx++) {
    let used = 0
    for (const a of bytes) {
      let hit = false
      for (let r = Math.max(0, by * B - M); r <= Math.min(side - 1, by * B + B + M) && !hit; r++)
        for (let c = Math.max(0, bx * B - M); c <= Math.min(side - 1, bx * B + B + M); c++) if (a[r * side + c]) { hit = true; break }
      if (hit) used++
    }
    if (used > max) bad++
  }
  return bad
}

test('enforcePixelBlocks: random 8-surface noise leaves 0 overfull block and keeps every painted pixel painted', () => {
  for (let seed = 1; seed <= 3; seed++) {
    let s = seed
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647)
    const side = 4 * 63 + 1
    const bytes = Array.from({ length: 8 }, () => new Uint8Array(side * side))
    for (let i = 0; i < side * side; i++) {
      const a = Math.floor(rnd() * 8), b = Math.floor(rnd() * 8)
      bytes[a][i] += 150; bytes[b][i] = Math.min(255, bytes[b][i] + 100)
      const k = Math.floor(rnd() * 8)
      if (rnd() < 0.05 && !bytes[k][i]) bytes[k][i] = 2 // insignificant specks
    }
    assert.ok(overfull(bytes, side) > 0)
    limitPixelBlocks(bytes, side, 63, 4, 3, null)
    enforcePixelBlocks(bytes, side, 63, 4, 3, null)
    assert.equal(overfull(bytes, side), 0)
    for (let i = 0; i < side * side; i++) assert.ok(bytes.some((a) => a[i] > 2), 'pixel ' + i + ' lost its weight')
  }
})

test('enforcePixelBlocks: a surface under 1 % of a block is merged away (no odd-coloured residue block)', () => {
  const side = 63 + 1
  const a = new Uint8Array(side * side).fill(200)
  const b = new Uint8Array(side * side)
  for (let i = 0; i < 20; i++) { b[i] = 40; a[i] = 160 } // 800 / ~0.8M = 0.1 %
  enforcePixelBlocks([a, b], side)
  assert.equal(b.reduce((s, v) => s + v, 0), 0)
  assert.equal(a[0], 200) // weight given back to the kept surface
  const c = new Uint8Array(side * side)
  for (let i = 0; i < side * 20; i++) c[i] = 100 // ~30 %: kept
  const d = new Uint8Array(side * side).fill(150)
  enforcePixelBlocks([d, c], side)
  assert.ok(c.reduce((s, v) => s + v, 0) > 0)
})
