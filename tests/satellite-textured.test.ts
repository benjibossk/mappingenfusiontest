// textured satellite (bridge/terrain-masks.mjs + library/terrain-middles.json): vanilla middle textures tiled per surface
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { middleFactor, terrainMiddles } from '../bridge/terrain-masks.mjs'

test('satellite: vanilla middle textures are tiled per surface, mean kept at the chosen colour', () => {
  assert.ok(terrainMiddles().size >= 30)
  const f = middleFactor('{37DC7E40C529A95A}Terrains/Common/Surfaces/Grass_01.emat', 12, 34)
  assert.ok(f && f.every((v: number) => v > 0.5 && v < 1.6))
  assert.deepEqual(middleFactor('Grass_01', 12, 34), f, 'GUID / path / case do not matter')
  assert.equal(middleFactor('Unknown_Surface', 1, 1), null)
  // tiled: the same point one repeat away gives the same factor; mean over a repeat ~ 1
  const m = terrainMiddles().get('grass_01')!
  assert.deepEqual(middleFactor('Grass_01', 12 + m.repeat, 34), f)
  let s = 0, n = 0
  for (let i = 0; i < m.side; i++) for (let j = 0; j < m.side; j++) { s += middleFactor('Grass_01', (i + 0.5) * m.repeat / m.side, (j + 0.5) * m.repeat / m.side)![1]; n++ }
  assert.ok(Math.abs(s / n - 1) < 0.02)
})
