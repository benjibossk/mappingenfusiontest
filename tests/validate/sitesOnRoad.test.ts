// Seed 3 (vanilla sites on): the Eden gas station's kerbs 13 m ahead of its pivot stood on its road, and the MIL_1
// outpost's link road crossed it (its gate on the template radius left no keep-out disc). Pre-send finds nothing now.
import test from 'node:test'
import assert from 'node:assert/strict'
import '../../src/workers/shim'
import { generateWorld, WORLD_DEFAULTS, entitiesOnRoads, siteFront } from '../../src/modules/worldgen'
import { preSendChecks, zoneLines } from '../../src/validate/preSend'
import { centreLine, roadHalf } from '../../src/modules/roads'

test('siteFront / entitiesOnRoads', () => {
  const es = [{ x: 0, z: 0 }, { x: 13, z: 1 }]
  assert.equal(siteFront(es, 0, 0, 1, 0), 13)
  assert.ok(entitiesOnRoads(es, [{ pts: [13, -50, 13, 50], half: 4 }]))
  assert.ok(!entitiesOnRoads(es, [{ pts: [18, -50, 18, 50], half: 4 }]))
})

test('seed 3 world: no vanilla site or base piece on a road', { timeout: 600_000 }, async () => {
  const size = 4096
  const w = await generateWorld({ ...WORLD_DEFAULTS, seed: 3, size, vanillaSites: true, villageTemplates: true } as never)
  const line = (r: { id: string; pts: number[] } & Parameters<typeof roadHalf>[0], zone?: number) => ({ id: r.id, half: roadHalf(r), line: centreLine(r.pts, 4), ...(zone !== undefined ? { zone } : {}) })
  const roads = [...w.roads.map((r) => line(r)), ...w.zones.flatMap((z, k) => z.roads.map((r) => line(r, k))), ...w.settlement.lanes.map((r) => line(r))].filter((r) => r.line.length >= 4)
  const issues = preSendChecks({ width: size, height: size, settled: w.settlement.placed, zones: w.zones.map((z) => ({ id: z.id, entities: z.entities, lines: zoneLines(z as never, roadHalf as never) })), roads })
  const bad = issues.filter((i) => /^(VAN_|MIL_)/.test(i.id))
  assert.equal(bad.length, 0, bad.slice(0, 5).map((i) => i.id).join(', '))
})
