import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parallaxOrder } from '../../bridge/terrain-file.mjs'

test('parallaxOrder: rock, then dirt, then the rest, grass last (stable)', () => {
  const r = parallaxOrder([
    '{A}Terrains/Common/Surfaces/Grass_01.emat',
    '{B}Terrains/Common/Surfaces/Dirt_01.emat',
    '{C}Terrains/Common/Surfaces/Beach_01.emat',
    '{D}Terrains/Common/Surfaces/Rock_01.emat',
    '{E}Terrains/Common/Surfaces/GrassDry_01.emat',
  ])
  assert.deepEqual(r.map((n) => n[1]), ['D', 'B', 'C', 'A', 'E'])
})
