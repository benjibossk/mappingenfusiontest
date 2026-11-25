// Soviet house style (Kolguyev look): only vanilla prefabs whose GUID the repo already references
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { SOVIET_HOUSES, buildingsFor, BUILDINGS } from '../../src/data/buildings.ts'
import { settleVillages } from '../../src/modules/village.ts'

test('soviet houses: real GUIDs found in the library / registries, sane bounds', () => {
  const lib = readFileSync('library/prefabs-catalogue.json', 'utf8') + readFileSync('library/parcels-vanilla.json', 'utf8') + readFileSync('src/data/buildings.ts', 'utf8').split('SOVIET_ROWS')[0]
  for (const b of SOVIET_HOUSES) {
    const m = /^\{([0-9A-F]{16})\}Prefabs\/(.+\.et)$/.exec(b.prefab)
    assert.ok(m, b.prefab)
    const path = m![2]
    assert.ok(lib.includes(`{${m![1]}}Prefabs/${path}`) || lib.includes(`"p":"${path}","g":"${m![1]}"`), 'unverified GUID ' + b.prefab)
    assert.ok(b.maxX - b.minX > 4 && b.maxX - b.minX < 30 && b.maxZ - b.minZ > 4 && b.maxZ - b.minZ < 30, 'bounds ' + b.prefab)
  }
  for (const c of ['houseS', 'houseM', 'houseL', 'farm']) assert.ok(SOVIET_HOUSES.some((b) => b.cat === c), 'no soviet ' + c)
  assert.equal(buildingsFor('vanilla'), BUILDINGS)
})

test('soviet style village: every house and farmhouse from the soviet set', () => {
  const flatGrid = { minX: -400, minZ: -400, step: 8, cols: 101, rows: 101 }
  const flat = new Array(101 * 101).fill(20)
  const roads = [{ id: 'R1', type: 'asphalt' as const, pts: [-380, 0, 380, 0] }]
  const res = settleVillages([{ id: 'V1', x: 0, z: 0, kind: 'village' }], roads, [], flat, flatGrid, { seed: 4, density: 1, pool: buildingsFor('soviet') })
  const sov = new Set(SOVIET_HOUSES.map((b) => b.prefab))
  const houses = res.placed.filter((p) => p.role === 'house' || p.role === 'farmhouse').filter((p) => !/Pub|Chapel|Church/.test(p.prefab))
  assert.ok(houses.length >= 5, 'houses ' + houses.length)
  for (const h of houses) assert.ok(sov.has(h.prefab), 'not soviet ' + h.prefab)
})
