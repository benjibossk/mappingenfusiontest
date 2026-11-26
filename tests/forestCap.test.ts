import { test } from 'node:test'
import assert from 'node:assert/strict'
import { capForests, generateForests, ringArea } from '../src/modules/forestgen.ts'
import { rocksClearOfHouses } from '../src/modules/cliffRocks.ts'

test('generateForests maxShare: total forest area capped (Workbench ForestGenerator ~300 trees/ha)', () => {
  const n = 257, step = 8, h = new Array(n * n)
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) h[r * n + c] = 20 + 10 * Math.sin(c / 20) + 8 * Math.cos(r / 17)
  const g = { minX: 0, minZ: 0, step, cols: n, rows: n }
  const all = generateForests(h, g, { seed: 4, cover: 0.35, sites: [] })
  const capped = generateForests(h, g, { seed: 4, cover: 0.35, sites: [], maxShare: 0.12 })
  const map = ((n - 1) * step) ** 2, sum = (fs: { pts: number[] }[]) => fs.reduce((s, f) => s + ringArea(f.pts), 0)
  assert.ok(sum(all) > 0.2 * map, `uncapped ${sum(all) / map}`)
  assert.ok(sum(capped) <= 0.12 * map + 1, `capped ${sum(capped) / map}`)
  assert.ok(capped.length > 0)
  assert.deepEqual(capForests(all, Infinity, 4), all)
})

test('rocksClearOfHouses: nothing within 25 m of a house, only small pieces within 80 m', () => {
  const R = (n: string) => `{0}Prefabs/Rocks/Granite/${n}.et`
  const es = [
    { prefab: R('GraniteRock_01_V2'), x: 10, z: 0 }, // 10 m: dropped
    { prefab: R('GraniteStone_01_V2'), x: 20, z: 0 }, // small but 20 m: dropped
    { prefab: R('GraniteCliff_01'), x: 50, z: 0 }, // big at 50 m: dropped
    { prefab: R('Granite_Boulder_01_V2'), x: 50, z: 0 }, // small at 50 m: kept
    { prefab: R('GraniteRock_02_V2'), x: 120, z: 0 }, // big far away: kept
    { prefab: '{0}Prefabs/Vegetation/Bush.et', x: 5, z: 0 }, // not a rock: kept
  ]
  const kept = rocksClearOfHouses(es, [{ x: 0, z: 0 }]).map((e) => e.prefab.split('/').pop())
  assert.deepEqual(kept, ['Granite_Boulder_01_V2.et', 'GraniteRock_02_V2.et', 'Bush.et'])
})
