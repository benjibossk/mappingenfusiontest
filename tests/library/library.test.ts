// Asset library: seed integrity, search, pack import/export. Run:
// node --import ./tests/library/resolve-ts.mjs --test tests/biomes/*.test.ts tests/library/*.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { VANILLA_PACK, defaultLibrary, search, importPack, exportPack, validatePack, tagCounts, GUID_RE } from '../../src/library/index.ts'
import { BUILDINGS } from '../../src/data/buildings.ts'
import { BIOMES } from '../../src/data/biomes.ts'

test('vanilla seed is a valid pack and covers every building', () => {
  assert.deepEqual(validatePack(VANILLA_PACK), [])
  const g = new Set(VANILLA_PACK.assets.map((a) => a.guid))
  for (const b of BUILDINGS) assert.ok(g.has(b.prefab), b.prefab)
  assert.ok(VANILLA_PACK.assets.length > BUILDINGS.length + 40)
})

test('every vanilla biome has houses, trees and fences', () => {
  const lib = defaultLibrary()
  for (const b of BIOMES.filter((x) => x.availability !== 'mods')) {
    for (const kind of ['house', 'tree', 'fence'] as const) assert.ok(search(lib, { biome: b.id, kind }).length > 0, `${b.id} ${kind}`)
  }
  assert.equal(search(lib, { biome: 'desert', kind: 'house' }).length, 0)
  assert.ok(search(lib, { biome: 'desert', kind: 'house', fallback: true }).length > 0)
})

test('soviet houses go to Kolguyev only', () => {
  const lib = defaultLibrary()
  const k = search(lib, { biome: 'nordic_kolguyev', kind: 'house' })
  assert.ok(k.some((a) => /USSR/i.test(a.guid)) && k.every((a) => !/_E_/.test(a.name ?? "")))
  assert.ok(search(lib, { biome: 'temperate_everon', kind: 'house' }).every((a) => !/USSR/i.test(a.guid)))
})

test('text search is accent/case-insensitive, all words required, tags AND', () => {
  const lib = defaultLibrary()
  const r = search(lib, { text: 'FarmHouse ussr' })
  assert.ok(r.length && r.every((a) => /farmhouse/i.test(a.guid) && /ussr/i.test(a.guid)))
  assert.ok(search(lib, { tags: ['tree', 'autumn'] }).every((a) => a.kind === 'tree' && a.tags.includes('autumn')))
  assert.ok(tagCounts(lib.assets).length > 10)
})

test('surface/veg refs are verified against the rdb index when present', () => {
  const idx = 'C:/Users/benbo/AppData/Local/Temp/claude/d96a4b32f6577f55/45052fed-5177-4ace-8344-41dcec5cad7d/scratchpad/rdb_index.txt'
  if (!existsSync(idx)) return
  const all = new Set(readFileSync(idx, 'utf8').split(/\r?\n/))
  const miss = VANILLA_PACK.assets.filter((a) => /Vegetation|WEGenerators|Props|Cultural/.test(a.guid) && !all.has(a.guid))
  assert.deepEqual(miss.map((a) => a.guid), [])
})

test('export -> import round trip, validation errors are reported', () => {
  const assets = VANILLA_PACK.assets.slice(0, 3).map((a) => ({ ...a, source: '0123456789ABCDEF', author: 'me', licence: 'CC-BY-4.0' }))
  const txt = exportPack({ id: 'my-pack', name: 'Mine', author: 'me', licence: 'CC-BY-4.0', source: '0123456789ABCDEF' }, assets)
  const p = importPack(txt)
  assert.equal(p.assets.length, 3)
  assert.throws(() => importPack('{"format":"x"}'), /format/)
  const bad = JSON.parse(txt); bad.assets[0].guid = 'Prefabs/x.et'
  assert.throws(() => importPack(JSON.stringify(bad)), /guid/)
  const lib = defaultLibrary([p])
  assert.equal(lib.conflicts.length, 3) // same guids as vanilla: first pack wins
  assert.ok(GUID_RE.test(p.assets[0].guid))
})
