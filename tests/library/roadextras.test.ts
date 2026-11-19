// PLAN_RESTANT #14 (U farmyards on FARM_ sites), #15 (stream culverts), #17 (extra guardrails), seed 21
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generateWorld, WORLD_DEFAULTS, type WorldResult } from '../../src/modules/worldgen.ts'
import { extraGuardrails, dropCoveredPosts } from '../../src/modules/guardrails.ts'
import { streamCulverts } from '../../src/modules/culverts.ts'
import { barrierFor, type Road } from '../../src/modules/roads.ts'
import { BRIDGE_PREFABS } from '../../src/modules/bridges.ts'
import type { Grid } from '../../src/modules/island.ts'
import type { ProjectShape } from '../../src/project.ts'

let world: WorldResult | undefined
const seed21 = async () => (world ??= await generateWorld({ ...WORLD_DEFAULTS, size: 4096, seed: 21 }))

test('#17 guardrails: bridge approaches on both sides, land side only', () => {
  const road: Road = { id: 'R1', type: 'asphalt', pts: [0, 0, 400, 0], spans: [{ from: 180, to: 220 }] } as Road
  const s = extraGuardrails([road], () => 10)
  const app = s.filter((x) => x.id.includes('_BAR_A'))
  assert.equal(app.length, 4, app.map((x) => x.id).join(','))
  for (const a of app) {
    const xs = a.points.filter((_, i) => i % 2 === 0)
    assert.ok(xs.every((x) => (x >= 150 && x <= 181) || (x >= 219 && x <= 251)), `${a.id}: ${Math.min(...xs)}..${Math.max(...xs)}`)
    assert.ok(a.generator === barrierFor(road))
  }
  // a water gap of the export gives the same
  const g = extraGuardrails([{ id: 'R2', type: 'asphalt', pts: [0, 0, 400, 0] } as Road], () => 10, [{ id: 'R2', from: [190, 0], to: [210, 0] }])
  assert.equal(g.filter((x) => x.id.includes('_BAR_A')).length, 4)
  // dirt roads get none
  assert.equal(extraGuardrails([{ ...road, type: 'dirt' }], () => 10).length, 0)
})

test('#17 guardrails: outer side of a sharp bend on a slope, not on flat ground', () => {
  // quarter circle radius 60 m turning right (clockwise seen from +Y with x east, z north)
  const pts: number[] = [-200, 60]
  for (let a = 0; a <= 90; a += 5) pts.push(Math.sin((a * Math.PI) / 180) * 60, Math.cos((a * Math.PI) / 180) * 60)
  pts.push(60, -200)
  const road = { id: 'B', type: 'asphalt', pts } as Road
  // ground falls away from the bend centre (0,0): outer side 1.2 m lower 6 m beyond the edge (under the 1.8 m embankment rule)
  const slope = (x: number, z: number) => 50 - Math.max(0, Math.hypot(x, z) - 60) * 0.1
  const s = extraGuardrails([road], slope).filter((x) => x.id.includes('_BAR_B'))
  assert.ok(s.length >= 1, 'bend rail')
  for (const r of s) for (let i = 0; i < r.points.length; i += 2) assert.ok(Math.hypot(r.points[i], r.points[i + 1]) > 60, 'outer side')
  assert.equal(extraGuardrails([road], () => 50).filter((x) => x.id.includes('_BAR_B')).length, 0, 'flat: posts only')
  // a post run under the new rail is cut out
  const post: ProjectShape = { id: 'B_POST_L0', kind: 'polyline', closed: false, points: s[0].points.map((v) => v * 1.0), generator: 'p' }
  assert.equal(dropCoveredPosts([post], s).length, 0)
})

test('#15 culverts: narrow stream crossed by a road gets a short deck by width', () => {
  const g = { minX: 0, minZ: 0, step: 10, cols: 101, rows: 61 } as Grid
  const river = new Float32Array(g.cols * g.rows)
  for (let r = 0; r < g.rows; r++) river[r * g.cols + 50] = 0.3
  const track = { id: 'T', type: 'trailDirt', pts: [300, 300, 700, 300] } as Road
  const main = { id: 'M', type: 'asphalt', pts: [300, 500, 700, 500] } as Road
  const res = streamCulverts([track, main], river, g, () => 20)
  assert.equal(res.culverts.length, 2)
  assert.deepEqual(res.culverts[0].prefabs, [BRIDGE_PREFABS.small])
  assert.deepEqual(res.culverts[1].prefabs, [BRIDGE_PREFABS.wide]) // 12 m asphalt: the wide deck
  for (const c of res.culverts) assert.ok(Math.abs(c.x - 500) < 8, `${c.id} at ${c.x}`)
  assert.ok(res.entities.every((e) => e.ycm === Math.round((20.05 - 0.13) * 100)))
  // a real river (>= STREAM.narrow) is left to the export gaps
  river.fill(0); for (let r = 0; r < g.rows; r++) river[r * g.cols + 50] = 1
  assert.equal(streamCulverts([track], river, g, () => 20).culverts.length, 0)
})

test('seed 21: culverts on stream crossings, U farmyards on the FARM_ sites', async () => {
  const w = await seed21()
  const culv = (w.bridges ?? []).filter((b) => b.id.includes('_CULVERT'))
  assert.ok(culv.length >= 1, `culverts: ${culv.length}`)
  const farmSites = new Set(w.sites.filter((s) => s.id.startsWith('FARM_')).map((s) => s.id))
  const onFarms = w.settlement.placed.filter((q) => farmSites.has(q.site))
  const houses = onFarms.filter((q) => q.role === 'farmhouse').length, yards = onFarms.filter((q) => q.role === 'farmyard').length
  assert.ok(farmSites.size === 0 || houses >= 1, `farm sites ${farmSites.size}, farmhouses ${houses}`)
  assert.ok(yards >= 2 * houses, `yards ${yards} for ${houses} farmhouses`)
})
