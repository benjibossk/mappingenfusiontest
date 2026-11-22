// Power line ends on the stations' real cable slots + zigzag smoothing (src/modules/powersmooth.ts),
// the random world's power step (worldpower.ts) and the campaign clip that used to kill a world (campaign.ts)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { attachPoint, smoothPath, STATION_ATTACH } from '../../src/modules/powersmooth.ts'
import { planGrid, STATION_PREFABS, type GridSite } from '../../src/modules/powergrid.ts'
import { safeIntersect } from '../../src/modules/campaign.ts'
import * as turf from '@turf/turf'

test('attach: simple_v1 portal on the back wall, rotated with the station; unknown prefab -> centre', () => {
  const hv = STATION_PREFABS.eden.hv
  const a = attachPoint({ x: 100, z: 100, yaw: 0, prefab: hv.prefab }, 100, 0, 15)
  assert.ok(Math.abs(a.at[0] - 100.04) < 1e-6 && Math.abs(a.at[1] - 88.35) < 1e-6)
  assert.ok(a.lead && a.lead[1] < a.at[1]) // lead goes out of the yard, away from the gate
  const r = attachPoint({ x: 0, z: 0, yaw: Math.PI / 2, prefab: hv.prefab }, -100, 0, 15) // gate faces +X
  assert.ok(Math.abs(r.at[0] + 11.65) < 1e-6 && Math.abs(r.at[1]) < 0.1)
  const u = attachPoint({ x: 5, z: 7, yaw: 1, prefab: '{0000000000000000}Prefabs/X.et' }, 0, 0)
  assert.deepEqual(u, { at: [5, 7], lead: null })
  // substation kiosk: in / out slot groups, the one facing the target wins
  const k = STATION_PREFABS.eden.mvlv.prefab
  assert.ok(attachPoint({ x: 0, z: 0, yaw: 0, prefab: k }, 0, 500).at[1] > 2)
  assert.ok(attachPoint({ x: 0, z: 0, yaw: 0, prefab: k }, 0, -500).at[1] < -2)
  for (const g of Object.keys(STATION_ATTACH)) assert.ok(Object.values(STATION_PREFABS).some((s) => Object.values(s).some((q) => q.prefab.startsWith(g))))
})

test('smooth: zigzag of 16 m corners collapses, a forbidden shortcut is kept', () => {
  const zig: number[] = []
  for (let i = 0; i <= 20; i++) zig.push(i * 16, i % 2 ? 8 : 0)
  const s = smoothPath(zig, 20, () => true)
  assert.ok(s.length <= 8, String(s.length)) // 21 corners -> at most 4
  assert.deepEqual([s[0], s[1], s.at(-2), s.at(-1)], [0, 0, 320, 0])
  const bend = [0, 0, 10, 100, 20, 0]
  assert.equal(smoothPath(bend, 200, () => false).length, 6)
})

test('grid lines end 3 m off the station cable slots', () => {
  const step = 20, cols = 301, size = 6000
  const grid = { minX: 0, minZ: 0, step, cols, rows: cols }
  const heights = new Float32Array(cols * cols).fill(30)
  const sites: GridSite[] = [
    { id: 'T1', x: 1000, z: 1000, kind: 'town', r: 250 }, { id: 'T2', x: 5000, z: 4800, kind: 'town', r: 250 },
    { id: 'V1', x: 2500, z: 3500, kind: 'village', r: 120 },
  ]
  const roads = [sites.flatMap((s) => [s.x, s.z]), ...sites.map((s) => [s.x - s.r, s.z, s.x + s.r, s.z])]
  const plan = planGrid({ heights, grid, sites, roads, isWater: () => false, size }, { plants: 0 })
  assert.ok(plan.lines.length >= 2)
  const slots = plan.stations.filter((s) => STATION_ATTACH[s.prefab.slice(0, 18)]).flatMap((s) => [-1e4, 1e4].flatMap((d) => [attachPoint(s, s.x + d, s.z).at, attachPoint(s, s.x, s.z + d).at]))
  for (const l of plan.lines) if (l.kind !== 'lv') {
    const end = [l.path[0], l.path[1]]
    // the end pole stands 3 m out of the slot, beside its wall (powergrid wallPole), never in the wall itself
    assert.ok(slots.some((q) => Math.abs(Math.hypot(q[0] - end[0], q[1] - end[1]) - 3) < 1e-6), `${l.id} start not 3 m off a slot`)
  }
})

test('campaign clip never throws (degenerate cell)', () => {
  const zone = turf.polygon([[[0, 0], [100, 0], [100, 100], [0, 100], [0, 0]]])
  const cell = [[100.0000000001, 50], [150, 50], [150, 0.0000000001], [100, 1e-12], [100.0000000001, 50]]
  assert.doesNotThrow(() => safeIntersect(cell, zone))
  const ok = safeIntersect([[10, 10], [50, 10], [50, 50], [10, 10]], zone)
  assert.ok(ok)
})
