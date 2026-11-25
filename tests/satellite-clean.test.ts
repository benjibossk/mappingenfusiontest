// clean satellite (bridge/satmap-clean.mjs): hand palette + seeded noise + hillshade, no BI texture used
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { inflateSync } from 'node:zlib'
import { resetTerrainMiddles, terrainMiddles, writeSatellite } from '../bridge/terrain-masks.mjs'
import { cleanColour, cleanEntry } from '../bridge/satmap-clean.mjs'

function pixels(file: string) {
  const b = readFileSync(file)
  const idat: Buffer[] = []
  for (let o = 8; o < b.length;) { const n = b.readUInt32BE(o), t = b.toString('ascii', o + 4, o + 8); if (t === 'IDAT') idat.push(b.subarray(o + 8, o + 8 + n)); o += 12 + n }
  return { head: b.subarray(0, 33), raw: inflateSync(Buffer.concat(idat)) }
}

test('satellite clean: no middle tile read, deterministic, not uniform, same PNG format', () => {
  const side = 64, size = 630
  const surfaces = [{ name: 'Grass_01', minX: 0, minZ: 0, step: size, cols: 2, rows: 2, weights: [1, 1, 1, 1] }]
  const relief = { minX: 0, minZ: 0, step: 10, cols: 64, rows: 64, heights: Array.from({ length: 64 * 64 }, (_, i) => 40 * Math.sin((i % 64) / 6) + 20 * Math.cos(Math.floor(i / 64) / 5)) }
  const dir = mkdtempSync(join(tmpdir(), 'satclean-'))
  // poison the vanilla tiles: clean mode must not read them
  process.env.REFORGER_TERRAIN_MIDDLES = join(import.meta.dirname, 'fixtures', 'terrain-middles.fixture.json')
  resetTerrainMiddles()
  const m = terrainMiddles(), saved = new Map(m); m.clear()
  try {
    const a = writeSatellite(join(dir, 'a.png'), side, size, surfaces, { Grass_01: [78, 92, 52] }, undefined, [], { source: 'clean', relief, seed: 7 })
    const b = writeSatellite(join(dir, 'b.png'), side, size, surfaces, { Grass_01: [78, 92, 52] }, undefined, [], { source: 'clean', relief, seed: 7 })
    assert.equal(a.side, side)
    assert.deepEqual(readFileSync(a.file), readFileSync(b.file), 'same seed = same image')
    const pa = pixels(a.file)
    const g = new Set<number>()
    for (let i = 0; i < pa.raw.length; i++) if (i % (side * 3 + 1) !== 0) g.add(pa.raw[i])
    assert.ok(g.size > 20, 'detail, not a flat colour')
  } finally { for (const [k, v] of saved) m.set(k, v) }
  const v = writeSatellite(join(dir, 'v.png'), side, size, surfaces, { Grass_01: [78, 92, 52] }, undefined, [])
  assert.deepEqual(pixels(v.file).head, pixels(join(dir, 'a.png')).head, 'same PNG header (size, RGB 8-bit) in both modes')
  assert.ok(cleanEntry('{37DC7E40C529A95A}Terrains/Common/Surfaces/Grass_01.emat'))
  delete process.env.REFORGER_TERRAIN_MIDDLES; resetTerrainMiddles()
  assert.notDeepEqual(cleanColour('Grass_01', [0, 0, 0], 1, 1, 1), cleanColour('Grass_01', [0, 0, 0], 1, 1, 2), 'seeded')
})
