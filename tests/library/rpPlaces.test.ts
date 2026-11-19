// RP places (src/modules/rpPlaces.ts): the random world lays the places a Life / RP server needs, vanilla prefabs only
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { generateWorld, WORLD_DEFAULTS } from '../../src/modules/worldgen.ts'
import { rpPlacesOf, rpPrefabs, roadClearance } from '../../src/modules/rpPlaces.ts'
import { SITE_RADIUS } from '../../src/modules/network.ts'

const cat = JSON.parse(readFileSync(new URL('../../library/prefabs-catalogue.json', import.meta.url), 'utf8')) as { prefabs: { p: string; g?: string }[] }
const known = new Set(cat.prefabs.filter((q) => q.g).map((q) => `{${q.g}}Prefabs/${q.p}`))

test('rp prefabs: every one is a real base-game prefab (GUID + path from the catalogue)', () => {
  for (const p of rpPrefabs()) assert.ok(known.has(p), p)
})

test('random world seed 21: every RP role present at the expected counts, off roads and water, on a road', async () => {
  const w = await generateWorld({ ...WORLD_DEFAULTS, seed: 21 })
  const places = rpPlacesOf(w)
  const by = (r: string) => places.filter((q) => q.role === r)
  const towns = w.sites.filter((s) => s.kind === 'town').length, villages = w.sites.filter((s) => s.kind === 'village').length
  assert.ok(towns >= 1, 'seed 21 has a town')
  for (const r of ['police', 'clinic', 'town_hall', 'bank', 'market', 'shop', 'garage', 'car_dealer']) {
    const n = by(r).length
    assert.ok(n >= Math.ceil(towns * 0.75) && n <= towns + 1, `${r}: ${n} for ${towns} towns`)
  }
  assert.ok(by('pub').length >= Math.ceil(villages * 0.5), `pub ${by('pub').length}/${villages}`)
  for (const r of ['bus_stop', 'fuel', 'sawmill', 'lumber', 'mine', 'furnace', 'depot', 'farm', 'orchard', 'beehive', 'juicer', 'distillery', 'sell_point']) assert.ok(by(r).length >= 1, `${r} missing`)
  const roads = [...w.roads, ...w.zones.filter((z) => !z.rpRole).flatMap((z) => z.roads)]
  const water = (x: number, z: number) => {
    const c = Math.round((x - w.grid.minX) / w.grid.step), r = Math.round((z - w.grid.minZ) / w.grid.step)
    return w.heights[r * w.grid.cols + c] <= 0
  }
  for (const z of w.zones.filter((q) => q.rpRole && q.sub.startsWith('rp:'))) {
    const clear = roadClearance(z.x, z.z, w.roads)
    assert.ok(!water(z.x, z.z), `${z.id} in water`)
    for (const e of z.entities) {
      if (/BusShed|Kerb|Lamp|_domestica_/.test(e.prefab)) continue
      assert.ok(roadClearance(e.x, e.z, roads) > 0.5, `${z.id} ${e.prefab} on a road`)
      assert.ok(!water(e.x, e.z), `${z.id} ${e.prefab} in water`)
    }
    assert.ok(clear < zDisc(z) + 15, `${z.id} not reachable by road (${clear.toFixed(0)} m)`)
  }
  // in-town roles sit in or at the edge of their town
  for (const p of [...by('police'), ...by('market')]) {
    const t = w.sites.filter((s) => s.kind === 'town' || s.kind === 'village').some((s) => Math.hypot(s.x - p.x, s.z - p.z) < SITE_RADIUS[s.kind] + 200)
    assert.ok(t, `${p.id} far from any place`)
  }
})
function zDisc(z: { boxes: { corners: number[] }[]; x: number; z: number }) {
  let r = 0
  for (const b of z.boxes) for (let i = 0; i < b.corners.length; i += 2) r = Math.max(r, Math.hypot(b.corners[i] - z.x, b.corners[i + 1] - z.z))
  return r
}
