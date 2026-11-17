// Outside terrain ring (src/modules/outside.ts): exact seam with the map, fade to the far level,
// coast stays under water, chunks cover the ring only, share edges, OTC resolution cap.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { outsideRing, ringChunks, chunksToText, insideMap } from '../../src/modules/outside.ts'

// 2048 m map, step 32: a hill in the middle, west edge under the sea (ocean = 0), east edge at 60 m
const map = { minX: 0, minZ: 0, step: 32, cols: 65, rows: 65, heights: [] as number[] }
for (let r = 0; r < 65; r++) for (let c = 0; c < 65; c++) map.heights.push(-20 + c * 1.25 + 30 * Math.exp(-((c - 32) ** 2 + (r - 32) ** 2) / 200))
const at = (g: typeof map, x: number, z: number) => g.heights[Math.round((z - g.minZ) / g.step) * g.cols + Math.round((x - g.minX) / g.step)]

test('ring covers map + width, seam equals the map heights', () => {
  const ring = outsideRing(map, 0, { width: 2048, step: 64, toward: 'sea', seed: 3 })
  assert.equal(ring.minX, -2048); assert.equal(ring.cols, 33 + 64)
  for (const [x, z] of [[0, 0], [2048, 1024], [1024, 2048], [640, 0]]) assert.ok(Math.abs(at(ring, x, z) - at(map, x, z)) < 1e-6, `${x},${z}`)
})

test('sea mode: far ring dives under the sea, west coast never rises above water', () => {
  const ring = outsideRing(map, 0, { width: 2048, step: 64, toward: 'sea', seed: 3 })
  for (const x of [ring.minX, ring.minX + (ring.cols - 1) * ring.step]) assert.ok(at(ring, x, 1024) < 0, `far ${x}`)
  for (let x = -2048; x < 0; x += 64) assert.ok(at(ring, x, 1024) < 0, `west ${x}`)
  // continuity: first ring cell off the east edge stays close to the edge height
  assert.ok(Math.abs(at(ring, 2048 + 64, 1024) - at(map, 2048, 1024)) < 8)
})

test('land mode: far level just above the sea, deterministic per seed', () => {
  const a = outsideRing(map, 0, { width: 2048, step: 64, toward: 'land', seed: 5 })
  const b = outsideRing(map, 0, { width: 2048, step: 64, toward: 'land', seed: 5 })
  assert.deepEqual(a.heights, b.heights)
  const far = at(a, a.minX, a.minZ)
  assert.ok(far > 0 && far < 40, `far ${far}`)
})

test('chunks: ring only, shared edges, res capped at 33, text format', () => {
  const ring = outsideRing(map, 0, { width: 2048, step: 64, seed: 1 })
  const ch = ringChunks(ring, map, 99)
  assert.ok(ch.length > 0)
  for (const k of ch) {
    assert.equal(k.res, 33); assert.equal(k.size, 32 * 64); assert.equal(k.heights.length, 33 * 33)
    const h = k.size / 2
    assert.ok(!(insideMap(map, k.x - h, k.z - h) && insideMap(map, k.x + h, k.z + h)), 'chunk wholly inside the map')
  }
  const sorted = [...ch].sort((p, q) => p.z - q.z || p.x - q.x)
  const a = sorted[0], b = sorted.find((k) => k.z === a.z && Math.abs(k.x - a.x - a.size) < 1e-6)!
  for (let r = 0; r < 33; r++) assert.equal(a.heights[r * 33 + 32], b.heights[r * 33], 'east edge of a = west edge of b')
  const txt = chunksToText(ch).split('\n')
  assert.equal(txt[0], `OTC 1 ${ch.length}`); assert.equal(txt.length, 1 + 2 * ch.length)
  assert.equal(txt[2].split(' ').length, 33 * 33)
})

test('bridge accepts the exported text and rejects broken ones', async () => {
  const { checkOutsideText } = await import('../../bridge/outside.mjs')
  const ring = outsideRing(map, 0, { width: 1024, step: 64, seed: 2 })
  const txt = chunksToText(ringChunks(ring, map, 17))
  assert.equal(checkOutsideText(txt), '')
  assert.notEqual(checkOutsideText('OTC 1 1\n0 0 128 4\n1 2 3'), '')
  assert.notEqual(checkOutsideText('nope'), '')
})
