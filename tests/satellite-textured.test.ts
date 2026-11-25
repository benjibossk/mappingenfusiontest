// textured satellite (bridge/terrain-masks.mjs): middle textures tiled per surface. The real file is BI-derived,
// generated locally and git-ignored: the test uses a tiny synthetic fixture instead.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { middleFactor, resetTerrainMiddles, terrainMiddles } from '../bridge/terrain-masks.mjs'

test('satellite: middle textures are tiled per surface, mean kept at the chosen colour', () => {
  process.env.REFORGER_TERRAIN_MIDDLES = join(import.meta.dirname, 'fixtures', 'terrain-middles.fixture.json')
  resetTerrainMiddles()
  try {
    assert.equal(terrainMiddles().size, 1)
    const f = middleFactor('{37DC7E40C529A95A}Terrains/Common/Surfaces/Grass_01.emat', 3, 5)
    assert.ok(f && f.every((v: number) => v > 0.5 && v < 1.6))
    assert.deepEqual(middleFactor('Grass_01', 3, 5), f, 'GUID / path / case do not matter')
    assert.equal(middleFactor('Unknown_Surface', 1, 1), null)
    const m = terrainMiddles().get('grass_01')!
    assert.deepEqual(middleFactor('Grass_01', 3 + m.repeat, 5), f, 'tiled')
    let s = 0, n = 0
    for (let i = 0; i < m.side; i++) for (let j = 0; j < m.side; j++) { s += middleFactor('Grass_01', (i + 0.5) * m.repeat / m.side, (j + 0.5) * m.repeat / m.side)![1]; n++ }
    assert.ok(Math.abs(s / n - 1) < 0.02)
  } finally { delete process.env.REFORGER_TERRAIN_MIDDLES; resetTerrainMiddles() }
})
