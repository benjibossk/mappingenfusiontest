// Biome-driven generation (docs/BIOMES_LIBRARY.md §5.3/§5.4): Everon must stay byte-identical to the
// pre-biome output, other biomes must change the vegetation / gardens, and everything stays seeded.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { generateWorld, WORLD_DEFAULTS } from '../../src/modules/worldgen.ts'
import { forestTuning, leafOf, mixedNeedle, drapeTint, treeTint, forestGeneratorFor } from '../../src/biomes/vegetation.ts'

const P = { ...WORLD_DEFAULTS, size: 2048, seed: 4242 }
const digest = (w: unknown) => createHash('sha1').update(JSON.stringify(w)).digest('hex')
const strip = (w: Awaited<ReturnType<typeof generateWorld>>) => ({ ...w, params: undefined })

test('Everon is neutral in every helper', () => {
  for (const id of [undefined, 'temperate_everon']) {
    assert.deepEqual(forestTuning(id), { coverMul: 1, needleShift: 0 })
    assert.equal(mixedNeedle(id), 0.4)
    assert.equal(drapeTint(id), undefined)
    assert.equal(treeTint(id), undefined)
    assert.equal(forestGeneratorFor(id, 'mixed', 'mid'), undefined)
  }
  // historical thresholds
  assert.equal(leafOf(0.6), 'needle'); assert.equal(leafOf(0.2), 'broad'); assert.equal(leafOf(0.4), 'mixed')
})

test('Everon world: biome unset == temperate_everon (same seed, same map)', async () => {
  const a = await generateWorld(P), b = await generateWorld({ ...P, biome: 'temperate_everon' })
  assert.equal(digest(strip(a)), digest(strip(b)))
  assert.equal(a.settlement.parcels, undefined)
})

test('other biomes: deterministic, forests and gardens follow the biome', async () => {
  const ev = await generateWorld(P)
  const k1 = await generateWorld({ ...P, biome: 'nordic_kolguyev' }), k2 = await generateWorld({ ...P, biome: 'nordic_kolguyev' })
  assert.equal(digest(strip(k1)), digest(strip(k2)))
  // houses are the same, gardens are dressed
  assert.deepEqual(k1.settlement.placed.map((q) => q.id), ev.settlement.placed.map((q) => q.id))
  assert.ok((k1.settlement.parcels ?? []).some((p) => p.items.length || p.fences.length))
  const de = await generateWorld({ ...P, biome: 'desert' })
  assert.equal(de.areas.filter((a) => a.kind === 'forest').length, 0)
  const broad = (w: typeof ev) => w.areas.filter((a) => a.leaf === 'broad').length / Math.max(1, w.areas.length)
  const ar = await generateWorld({ ...P, biome: 'woodland_arland' }), tr = await generateWorld({ ...P, biome: 'tropical' })
  assert.ok(broad(ar) < broad(ev), `arland broadleaf share ${broad(ar)} < everon ${broad(ev)}`)
  assert.ok(broad(tr) > broad(ev), `tropical broadleaf share ${broad(tr)} > everon ${broad(ev)}`)
})
