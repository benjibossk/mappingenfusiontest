// satellite (bridge/satmap-clean.mjs): flat colours matched to vanilla + seeded noise + hillshade, no game file read
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs, { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { inflateSync } from 'node:zlib'
import { writeSatellite } from '../bridge/terrain-masks.mjs'
import { cleanColour, cleanEntry, familyColour } from '../bridge/satmap-clean.mjs'

function pixels(file: string) {
  const b = readFileSync(file)
  const idat: Buffer[] = []
  for (let o = 8; o < b.length;) { const n = b.readUInt32BE(o), t = b.toString('ascii', o + 4, o + 8); if (t === 'IDAT') idat.push(b.subarray(o + 8, o + 8 + n)); o += 12 + n }
  return { head: b.subarray(0, 33), raw: inflateSync(Buffer.concat(idat)) }
}

test('satellite: deterministic, not uniform, never reads a game .edds', (t) => {
  const side = 64, size = 630
  const surfaces = [{ name: 'Grass_01', minX: 0, minZ: 0, step: size, cols: 2, rows: 2, weights: [1, 1, 1, 1] }]
  const relief = { minX: 0, minZ: 0, step: 10, cols: 64, rows: 64, heights: Array.from({ length: 64 * 64 }, (_, i) => 40 * Math.sin((i % 64) / 6) + 20 * Math.cos(Math.floor(i / 64) / 5)) }
  const dir = mkdtempSync(join(tmpdir(), 'satclean-'))
  const read = t.mock.method(fs, 'readFileSync')
  const a = writeSatellite(join(dir, 'a.png'), side, size, surfaces, { Grass_01: [78, 92, 52] }, undefined, [], { relief, seed: 7 })
  const b = writeSatellite(join(dir, 'b.png'), side, size, surfaces, { Grass_01: [78, 92, 52] }, undefined, [], { relief, seed: 7 })
  assert.ok(!read.mock.calls.some((c) => /\.edds$|terrain-middles/i.test(String(c.arguments[0]))), 'no game texture read')
  read.mock.restore()
  assert.equal(a.side, side)
  assert.deepEqual(readFileSync(a.file), readFileSync(b.file), 'same seed = same image')
  const pa = pixels(a.file)
  const g = new Set<number>()
  for (let i = 0; i < pa.raw.length; i++) if (i % (side * 3 + 1) !== 0) g.add(pa.raw[i])
  assert.ok(g.size > 20, 'detail, not a flat colour')
  const c = writeSatellite(join(dir, 'c.png'), side, size, surfaces, { Grass_01: [78, 92, 52] }, undefined, [], { relief, seed: 8 })
  assert.notDeepEqual(readFileSync(c.file), readFileSync(a.file), 'other seed = other noise')
  assert.ok(cleanEntry('{37DC7E40C529A95A}Terrains/Common/Surfaces/Grass_01.emat'))
  assert.notDeepEqual(cleanColour('Grass_01', [0, 0, 0], 1, 1, 1), cleanColour('Grass_01', [0, 0, 0], 1, 1, 2), 'seeded')
})

test('satellite: unknown mod surfaces fall back to their family colour', () => {
  assert.deepEqual(familyColour('{0123456789ABCDEF}MyMod/Surfaces/WetGrass_07.emat'), cleanEntry('Grass_01')!.rgb)
  assert.deepEqual(familyColour('Asphalt_Old_09'), cleanEntry('Asphalt_01')!.rgb)
  assert.ok(familyColour('SandDune_04'))
  assert.equal(familyColour('Zzz_Unknown'), null)
  // no entry, no family: the app colour is kept
  const c = cleanColour('Zzz_Unknown', [100, 100, 100], 0, 0, 1)
  assert.ok(Math.abs(c[1] - 100) < 30)
})

test('satellite: the satmap code has no game texture path left', () => {
  for (const f of ['satmap-clean.mjs', 'terrain-masks.mjs']) {
    const src = readFileSync(join(import.meta.dirname, '..', 'bridge', f), 'utf-8')
    assert.ok(!/\.edds|terrain-middles|middleFactor/i.test(src), f)
  }
})
