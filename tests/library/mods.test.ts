import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MOD_INDEX, modPrefabs, modDamPieces, requiredMods, setEnabledMods, enabledMods, modRef } from '../../src/library/mods.ts'
import { prefabDims } from '../../src/library/dims.ts'
import { BUILDINGS, INDUSTRIAL } from '../../src/data/buildings.ts'
import { buildingCat, modAssetPack, syncModBuildings } from '../../src/data/modBuildings.ts'
import { damZone, GRAVEL_DAM, type Dam } from '../../src/modules/dam.ts'

const MINUS = '672166DE5926F11F', ZIM = '597697D81A1EA202'

test('registries load, off by default', () => {
  assert.ok(MOD_INDEX.length >= 4)
  assert.deepEqual(enabledMods(), [])
  assert.equal(modPrefabs().length, 0)
  const all = modPrefabs({ mods: [MINUS] })
  assert.ok(all.length > 400 && all.every((r) => r.d.length === 5 && /^[0-9A-F]{16}$/.test(r.g ?? '')))
  const dam = all.find((r) => r.p === 'Infrastructure/Dam/Dam_01.et')!
  assert.equal(prefabDims(modRef(dam))?.w, dam.d[0])
})

test('export dependencies: mod GUID + its mod deps, base game excluded', () => {
  const zim = modPrefabs({ mods: [ZIM] }).find((r) => r.g)!
  assert.deepEqual(requiredMods([modRef(zim), GRAVEL_DAM.prefab]).map((m) => m.guid), [ZIM, MINUS])
  assert.deepEqual(requiredMods([GRAVEL_DAM.prefab]), [])
})

test('Minus buildings join the pools only while ticked', () => {
  const nb = BUILDINGS.length, ni = INDUSTRIAL.length
  setEnabledMods([MINUS])
  const r = syncModBuildings()
  assert.ok(r.buildings > 20 && r.industrial > 5)
  assert.equal(BUILDINGS.length, nb + r.buildings)
  for (const c of ['houseS', 'houseM', 'houseL', 'farm', 'civic'] as const) assert.ok(BUILDINGS.some((b) => b.cat === c && b.prefab.includes('{')), c)
  assert.equal(buildingCat(modPrefabs().find((x) => /Church Rural 01/.test(x.p))!), 'civic')
  setEnabledMods([])
  assert.equal(BUILDINGS.length, nb); assert.equal(INDUSTRIAL.length, ni)
  assert.ok(modAssetPack(MINUS)!.assets.length > 400)
})

test('dam: concrete mod pieces when Minus is enabled, gravel wall otherwise', () => {
  const d: Dam = { id: 'DAM_1', ax: -60, az: 0, bx: 60, bz: 0, cx: 0, cz: 0, nx: 0, nz: 1, bed: 10, crest: 22, level: 20.5, toe: 34, foot: [0, 40] }
  const plain = damZone(d, {}, [])
  assert.ok(plain.entities.every((e) => e.prefab === GRAVEL_DAM.prefab))
  assert.equal(modDamPieces([]), null)
  const z = damZone(d, {}, [MINUS])
  assert.ok(z.entities.length >= 6 && z.entities.every((e) => /Dam_0[12]\.et$/.test(e.prefab) && e.ycm === 2200))
  assert.deepEqual(requiredMods(z.entities.map((e) => e.prefab)).map((m) => m.guid), [MINUS])
})
