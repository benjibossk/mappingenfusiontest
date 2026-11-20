// Vanilla ports face the sea (water parts over h <= 0, sheds ashore, no road through the footprint) and the
// first military site is a full vanilla base (not a 13-object checkpoint) when the vanilla option is on.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fitPort, pickTemplate, stampHull, lineInHull, stampTemplate, PORT_WATER_RX, isPortLand, convexHull } from '../../src/modules/vanillaSites.ts'
import { isLooseWallPiece } from '../../src/modules/wallRuns.ts'
import { generateWorld, WORLD_DEFAULTS } from '../../src/modules/worldgen.ts'

test('fitPort: synthetic coast (sea at x < 0), road kept out of the footprint', () => {
  const t = pickTemplate('port', 3, (q) => q.radius <= 160)!
  const hAt = (x: number) => (x < 0 ? -5 : 5)
  const road = [260, -600, 260, 600] // N-S road 260 m inland
  const f = fitPort(t, hAt, 30, 0, [road])
  assert.ok(f, 'a fit exists')
  const e = stampTemplate(t, f!.x, f!.z, f!.yaw)
  const wat = e.filter((q) => PORT_WATER_RX.test(q.prefab)), lnd = e.filter((q) => isPortLand(q.prefab))
  assert.ok(wat.filter((q) => q.x < 0).length / wat.length >= 0.6, 'water parts at sea')
  assert.ok(lnd.filter((q) => q.x >= 0).length / lnd.length >= 0.6, 'land parts ashore')
  assert.ok(!lineInHull(stampHull(t, f!.x, f!.z, f!.yaw), road, 8), 'road outside the footprint')
})

test('seed 21 world (vanilla on): ports in the water, no road in a port, full military base', async () => {
  const w = await generateWorld({ ...WORLD_DEFAULTS, seed: 21, vanillaSites: true, villageTemplates: true })
  const g = w.grid, h = (x: number, z: number) => w.heights[Math.round((z - g.minZ) / g.step) * g.cols + Math.round((x - g.minX) / g.step)]
  const ports = w.zones.filter((z) => /^VAN_PORT_/.test(z.id))
  assert.ok(ports.length >= 1, 'at least one port')
  for (const p of ports) {
    const wat = p.entities.filter((e) => PORT_WATER_RX.test(e.prefab)), lnd = p.entities.filter((e) => isPortLand(e.prefab))
    assert.ok(wat.filter((e) => h(e.x, e.z) <= 0).length / wat.length >= 0.55, `${p.id} water parts at sea`)
    assert.ok(lnd.filter((e) => h(e.x, e.z) > 0.5).length / lnd.length >= 0.55, `${p.id} land parts ashore`)
    const hull = convexHull(p.entities.map((e) => [e.x, e.z] as [number, number]))
    assert.ok(!w.roads.some((r) => lineInHull(hull, r.pts)), `${p.id}: no road through the port`)
  }
  const mil = w.zones.find((z) => z.id === 'MIL_1')!
  assert.ok(mil && mil.sub !== 'checkpoint', 'MIL_1 is a base')
  assert.ok(mil.entities.length >= 50, `MIL_1 entities ${mil.entities.length}`) // flat-ground vanilla camp only (hillside bases filtered), walls as WG shapes
  assert.ok(mil.shapes.length > 0, 'MIL_1 walls as wall-generator shapes')
  assert.ok(w.zones.every((z) => z.entities.every((e) => !isLooseWallPiece(e.prefab))), 'no loose wall piece')
})
