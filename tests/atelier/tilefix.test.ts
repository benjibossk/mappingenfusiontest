// Tile texture simplifier: nearest-texture choice, weight transfer maths, _layer.edds re-encode round trip,
// safeWrite backup / restore byte-identical on a COPY (never a real addon). Real tile read when present.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { decodeLayer, slotWeight } from '../../src/atelier/formats/edds.ts'
import { distance, family, group, moveWeight, planTiles } from '../../src/atelier/tilefix/simplify.ts'
import { encodeLayer } from '../../src/atelier/tilefix/eddsWrite.ts'
// @ts-ignore plain JS module
import { listBackups, restore, safeWrite, sha1 } from '../../bridge/safewrite.mjs'

const C = { Grass_01: [80, 90, 50], Grass_02: [85, 95, 52], Gravel_01: [120, 118, 110], Dirt_01: [92, 82, 68] }
const same = (a: ArrayLike<number>, b: ArrayLike<number>) => a.length === b.length && Array.prototype.every.call(a, (v: number, i: number) => v === b[i])
const pack = (w: number[]) => w.reduce((p, v, i) => (p | (v << (i * 5))) >>> 0, 0)

test('families and nearest texture', () => {
  assert.equal(family('Grass_01'), 'grass'); assert.equal(family('Grass_02_V2'), 'grass'); assert.equal(group('Debris_Rock_01'), 'rock')
  assert.ok(distance('Grass_01', 'Grass_02', C) < distance('Grass_01', 'Dirt_01', C))
  assert.ok(distance('Grass_01', 'Dirt_01', C) < distance('Grass_01', 'Gravel_01', C) + 200)
})

test('plan: negligible slot → nearest present texture, gain against the budget', () => {
  const terr = { blocksPerTile: 1, tilesX: 1, tilesZ: 1, materials: ['Dirt_01', 'Grass_01', 'Gravel_01', 'Grass_02', 'Dirt_01', 'Gravel_01'].map((name, id) => ({ id, guid: '', path: '', name })) } as never
  const tiles = [{ tx: 0, ty: 0, blocks: [{ bx: 0, by: 0, mats: [0, 1, 2, 3, 4, 5] }] }]
  const cov = { blockPx: 1000, blocks: new Map([['0,0', [600, 300, 200, 5, 0, 100]]]) } // slot 3 = 0.5 %, slot 4 unused
  const [p] = planTiles(terr, tiles, cov, 0.01, 5, C)
  assert.equal(p.fixes.length, 2)
  const f3 = p.fixes.find((f) => f.slot === 3)!
  assert.equal(f3.to, 1) // Grass_02 → Grass_01 (same family), not gravel
  assert.equal(p.maxBefore, 6); assert.equal(p.maxAfter, 4); assert.equal(p.overBefore, 1); assert.equal(p.overAfter, 0)
})

test('moveWeight: weight moved, sums kept, base target, other blocks untouched', () => {
  const W = 4, px = new Uint32Array(W * W)
  for (let i = 0; i < px.length; i++) px[i] = pack([10, 3, 2, 0, 0, 0]) // slots 1..6
  const L = { width: W, height: W, px }, before = px.slice()
  const n = moveWeight(L, 2, 0, 0, 2, 1) // block (0,0) = pixels x<2, y<2: slot 2 → slot 1
  assert.equal(n, 4)
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
    const p = px[y * W + x]
    if (x < 2 && y < 2) { assert.equal(slotWeight(p, 1), 13); assert.equal(slotWeight(p, 2), 0); assert.equal(slotWeight(p, 3), 2) }
    else assert.equal(p, before[y * W + x])
    assert.equal(slotWeight(p, 0), slotWeight(before[y * W + x], 0)) // base unchanged
  }
  moveWeight(L, 2, 1, 1, 3, 0) // to the implicit base
  assert.equal(slotWeight(px[3 * W + 3], 3), 0); assert.equal(slotWeight(px[3 * W + 3], 0), 31 - 13)
})

function realLayer(): Uint8Array | null {
  const d = 'C:/Users/benbo/AppData/Local/Temp/claude/d96a4b32f6577f55/45052fed-5177-4ace-8344-41dcec5cad7d/scratchpad/zimni/World/Zimnitrita/Terrain/.Data'
  if (!existsSync(d)) return null
  const f = readdirSync(d).find((n) => n.endsWith('_layer.edds'))
  return f ? readFileSync(join(d, f)) : null
}
function synthLayer(): Uint8Array {
  const W = 8, b = new Uint8Array(128 + W * W * 4), d = new DataView(b.buffer)
  b.set([68, 68, 83, 32]); d.setUint32(12, W, true); d.setUint32(16, W, true); d.setUint32(28, 1, true); d.setUint32(88, 32, true)
  for (let i = 0; i < W * W; i++) d.setUint32(128 + i * 4, pack([i % 7, 2, 1, 0, 0, 0]), true)
  return b
}

test('encodeLayer: unchanged → same bytes; corrected → decodes to exactly the corrected weights', () => {
  for (const orig of [synthLayer(), realLayer()].filter(Boolean) as Uint8Array[]) {
    const L = decodeLayer(orig), o = L.px.slice()
    assert.equal(encodeLayer(orig, L.px, o), orig)
    moveWeight(L, 1, 0, 0, 2, 1)
    const out = encodeLayer(orig, L.px, o), back = decodeLayer(out)
    assert.equal(back.width, L.width); assert.ok(same(back.px, L.px))
    assert.ok(same(out.subarray(0, 12), orig.subarray(0, 12)))
  }
})

test('apply via safeWrite then Restore: original bytes back, byte-identical', async () => {
  const orig = realLayer() ?? synthLayer()
  const root = mkdtempSync(join(tmpdir(), 'rm-tilefix-')), rel = 'Terrain/.Data/Terrain_0_layer.edds'
  mkdirSync(join(root, 'Terrain/.Data'), { recursive: true }); writeFileSync(join(root, rel), orig)
  const L = decodeLayer(orig), o = L.px.slice(); moveWeight(L, 1, 0, 0, 2, 1)
  const out = encodeLayer(orig, L.px, o)
  await safeWrite(root, rel, Buffer.from(out), sha1(readFileSync(join(root, rel))), { wbRunning: async () => false })
  assert.ok(same(decodeLayer(readFileSync(join(root, rel))).px, L.px))
  const [bk] = await listBackups(root)
  await restore(root, bk.stamp, bk.file, { wbRunning: async () => false })
  assert.equal(sha1(readFileSync(join(root, rel))), sha1(orig))
})
