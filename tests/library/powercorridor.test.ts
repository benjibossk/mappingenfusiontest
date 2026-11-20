// One corridor per road stretch: no wooden LV run alongside a concrete MV line of another voltage
// (seed 21 screenshot: both side by side along the same road a few metres apart)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { planGrid, parallelOverlap, type GridSite } from '../../src/modules/powergrid.ts'

test('parallelOverlap: metres of LV within 25 m of an MV line', () => {
  const mv = { kind: 'mv', poles: [0, 0, 50, 0, 100, 0, 150, 0, 200, 0] }
  const side = { kind: 'lv', poles: [0, 10, 35, 10, 70, 10, 105, 10, 140, 10] } // 10 m off, 140 m long
  const away = { kind: 'lv', poles: [0, 100, 35, 100, 70, 100] }
  const cross = { kind: 'lv', poles: [100, -60, 100, -20, 100, 20, 100, 60] } // crossing: one span near
  assert.equal(Math.round(parallelOverlap([mv, side])), 140)
  assert.equal(parallelOverlap([mv, away]), 0)
  assert.ok(parallelOverlap([mv, cross]) <= 40)
})

test('planner: villages along one road get no long parallel LV / MV runs', () => {
  const size = 6000, step = 20, cols = Math.round(size / step) + 1
  const grid = { minX: 0, minZ: 0, step, cols, rows: cols }
  const heights = new Float32Array(cols * cols).fill(40)
  const sites: GridSite[] = [
    { id: 'T1', x: 1200, z: 1200, kind: 'town', r: 250 },
    { id: 'V1', x: 3000, z: 1500, kind: 'village', r: 120 },
    { id: 'H1', x: 3500, z: 1600, kind: 'hamlet', r: 60 },
    { id: 'V2', x: 4400, z: 1800, kind: 'village', r: 120 },
    { id: 'FARM_1', x: 3800, z: 1700, kind: 'hamlet', r: 40 },
  ]
  const roads = [[1200, 1200, 3000, 1500, 3500, 1600, 4400, 1800]]
  const p = planGrid({ heights, grid, sites, roads, isWater: () => false, size }, { style: 'eden', plants: 0, ehv: false })
  const L = parallelOverlap(p.lines)
  assert.ok(L < 120, `parallel LV/MV ${Math.round(L)} m`)
})

test('topology: plant is the power source, edges join known nodes, every transformer sits on a feeder', async () => {
  const { gridTopology } = await import('../../src/modules/powergrid.ts')
  const size = 6000, step = 20, cols = Math.round(size / step) + 1
  const grid = { minX: 0, minZ: 0, step, cols, rows: cols }
  const heights = new Float32Array(cols * cols).fill(40)
  const sites: GridSite[] = [
    { id: 'T1', x: 1200, z: 1200, kind: 'town', r: 250 }, { id: 'V1', x: 3000, z: 1500, kind: 'village', r: 120 },
    { id: 'V2', x: 4400, z: 3800, kind: 'village', r: 120 }, { id: 'FARM_1', x: 3300, z: 1900, kind: 'hamlet', r: 40 },
  ]
  const roads = [[1200, 1200, 3000, 1500, 4400, 3800], [3000, 1500, 3300, 1900]]
  const p = planGrid({ heights, grid, sites, roads, isWater: () => false, size }, { style: 'eden', plants: 1, ehv: false })
  const t = gridTopology(p), ids = new Set(t.nodes.map((n) => n.id))
  assert.equal(ids.size, t.nodes.length)
  assert.ok(t.nodes.some((n) => n.kind === 'plant' && n.powerSource))
  assert.ok(t.nodes.filter((n) => n.powerSource).every((n) => n.kind === 'plant'))
  for (const e of t.edges) assert.ok(ids.has(e.from) && ids.has(e.to), e.id)
  const fed = new Set(t.feeders.flatMap((f) => f.transformers))
  for (const n of t.nodes) if (n.kind === 'mvlv') assert.ok(fed.has(n.id), `${n.id} on no feeder`)
  assert.deepEqual(gridTopology(p), t) // stable
})
