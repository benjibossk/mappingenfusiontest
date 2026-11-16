// Biomes + parcel generator. Run: node --import ./tests/library/resolve-ts.mjs --test tests/biomes/*.test.ts tests/library/*.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BIOMES, surfaceOf, assetBiome } from '../../src/data/biomes.ts'
import { LOT_TEMPLATES, generateParcel, demoLot } from '../../src/biomes/parcel.ts'
import { defaultLibrary } from '../../src/library/index.ts'
import type { SurfaceRole } from '../../src/data/biomes.ts'

test('every biome surface role resolves to a vanilla surface GUID', () => {
  for (const b of BIOMES) for (const role of Object.keys(b.surfaces) as SurfaceRole[]) {
    assert.match(surfaceOf(b, role) ?? '', /^\{[0-9A-F]{16}\}Terrains\/.+\.emat$/, `${b.id}.${role}`)
  }
  assert.equal(new Set(BIOMES.map((b) => b.id)).size, BIOMES.length)
  for (const b of BIOMES) assert.notEqual(assetBiome(b).buildingStyle, 'none', b.id)
})

const inLot = (w: number, d: number, x: number, z: number) => Math.abs(x) <= w / 2 + 0.01 && Math.abs(z) <= d / 2 + 0.01

test('parcels: a house in front, everything inside the lot, deterministic', () => {
  const lib = defaultLibrary()
  for (const b of BIOMES) for (const t of LOT_TEMPLATES) {
    const w = t.size.w[1], d = t.size.d[1]
    const p = generateParcel(lib, b.id, t, demoLot(w, d), 7)
    const house = p.items[0]
    assert.ok(house && ['house', 'farm'].includes(house.kind), `${b.id}/${t.id}: ${p.warnings.join('; ')}`)
    assert.ok(house.z < 0, 'house in the front half') // street is at z = -d/2
    for (const it of p.items) assert.ok(inLot(w, d, it.x, it.z), `${b.id}/${t.id} ${it.guid}`)
    assert.ok(p.fences.length >= 3)
    assert.deepEqual(generateParcel(lib, b.id, t, demoLot(w, d), 7), p)
  }
})

test('house faces the street (yaw) on a rotated lot', () => {
  const lib = defaultLibrary()
  // street along Z, lot extends towards +X: the house front (+Z model) must face -X
  const lot = { cx: 100, cz: 50, ux: 0, uz: 1, nx: 1, nz: 0, w: 20, d: 30, s: 0 }
  const p = generateParcel(lib, 'temperate_everon', LOT_TEMPLATES[1], lot, 3)
  assert.equal(Math.round(p.items[0].yaw), -90)
  assert.ok(p.items[0].x < 100)
})
