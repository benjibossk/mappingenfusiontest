import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generateWorld, WORLD_DEFAULTS } from '../../src/modules/worldgen.ts'
import { addProdForests, lotFences } from '../../src/modules/worldextras.ts'

const square = (x: number, z: number, s: number) => [x, z, x + s, z, x + s, z + s, x, z + s]

test('addProdForests: a share of the large conifer woods, deterministic, tracks linked', () => {
  const areas = [0, 1, 2, 3].map((k) => ({ id: `F${k}`, kind: 'forest', leaf: (k === 3 ? 'broad' : 'needle') as 'broad' | 'needle', pts: square(k * 1200, 0, 800) }))
  const o = { seed: 5, share: 0.5, roads: [[-200, 400, 4000, 400]] }
  const a = addProdForests(areas, o), b = addProdForests(areas, o)
  assert.equal(a.count, 2) // round(3 eligible * 0.5) -> 2, the broadleaf one never
  assert.deepEqual(a, b)
  assert.ok(a.tracks.length > 0 && a.tracks.every((t) => t.type === 'dirt'))
  assert.ok(a.areas.some((x) => x.id === 'F3'))
  assert.ok(a.areas.some((x) => 'stage' in x && x.stage))
})

test('lotFences: built village lots get walls with a gate, shared edges once, town garden lots too', () => {
  const lots = [{ site: 'V', corners: square(0, 0, 20), used: true }, { site: 'V', corners: [20, 0, 40, 0, 40, 20, 20, 20], used: true }, { site: 'T', corners: square(100, 0, 20), used: true }]
  const kinds: Record<string, 'village' | 'town'> = { V: 'village', T: 'town' }
  const f = lotFences(lots, { seed: 1, share: 1, garden: 0, kindOf: (s) => kinds[s] })
  assert.ok(f.some((p) => p.site === 'V') && f.some((p) => p.site === 'T'))
  const n = f.filter((p) => p.site === 'V').flatMap((p) => p.fences).length
  assert.ok(n >= 6 && n <= 9, String(n))
  assert.deepEqual(f, lotFences(lots, { seed: 1, share: 1, garden: 0, kindOf: (s) => kinds[s] }))
  // gardens behind the lots add fence (vanilla walled gardens / paddocks)
  const g = lotFences(lots, { seed: 1, share: 1, garden: 1, kindOf: (s) => kinds[s] }).flatMap((p) => p.fences).length
  assert.ok(g > f.flatMap((p) => p.fences).length, String(g))
})

test('random world: production forests and plot fences, same seed = same world', async () => {
  let prod = 0, fences = 0
  for (const seed of [1, 7, 42]) {
    const w = await generateWorld({ ...WORLD_DEFAULTS, size: 4096, seed })
    prod += w.areas.filter((a) => a.id.startsWith('FOREST_PROD_W')).length
    fences += (w.settlement.fences ?? []).reduce((s, p) => s + p.fences.length, 0)
    if (seed === 7) {
      const w2 = await generateWorld({ ...WORLD_DEFAULTS, size: 4096, seed })
      assert.deepEqual(w2.areas.map((a) => a.id), w.areas.map((a) => a.id))
      assert.equal(w2.roads.length, w.roads.length)
    }
  }
  console.log('prod compartments', prod, 'fences', fences)
  assert.ok(prod > 0, 'no production forest')
  assert.ok(fences > 0, 'no fence')
})
