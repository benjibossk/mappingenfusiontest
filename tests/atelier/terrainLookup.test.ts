import { test } from 'node:test'
import assert from 'node:assert/strict'
import { tilePrefixOf, terrainFor } from '../../src/atelier/source.ts'

test('tile prefix: case differs from the .terr name (ZBK_terrain.terr, zbk_terrain_N.ttile)', () => {
  const r = tilePrefixOf(['zbk_terrain_0.ttile', 'zbk_terrain_1.ttile', 'Zbk_terrain_0_supertexture.edds'], 'ZBK_terrain')
  assert.deepEqual(r, { prefix: 'zbk_terrain_', tiles: 2 })
})
test('tile prefix: terrain renamed after the tiles were written, most common prefix wins', () => {
  const r = tilePrefixOf(['terrain_0.ttile', 'terrain_1.ttile', 'terrain_2.ttile', 'old_0.ttile'], 'ZBK_terrain')
  assert.deepEqual(r, { prefix: 'terrain_', tiles: 3 })
})
test('tile prefix: no tile keeps the default', () => {
  assert.deepEqual(tilePrefixOf([], 'X'), { prefix: 'X_', tiles: 0 })
})
test('world -> terrain: ZBK.ent finds ZBK_terrain.terr in a sibling folder', () => {
  const ts = [{ name: 'ZBK_terrain', dir: 'worlds/ZBK/terrain' }, { name: 'Other', dir: 'worlds/Other' }]
  assert.equal(terrainFor(ts, 'worlds/ZBK/ZBK.ent')?.name, 'ZBK_terrain')
})
test('world -> terrain: only terrain of the project is used as a last resort', () => {
  assert.equal(terrainFor([{ name: 'foo', dir: 'a' }], 'b/bar.ent')?.name, 'foo')
})
