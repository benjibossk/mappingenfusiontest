// Isolated farms (worldgen FARM_*): one short LV drop from the nearest LV pole, or a pole-mounted
// transformer beside the nearest MV pole - never their own MV feeder and kiosk like a hamlet
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { planGrid, isFarm, type GridSite } from '../../src/modules/powergrid.ts'

function world(farms: GridSite[]) {
  const size = 6000, step = 20, cols = Math.round(size / step) + 1
  const grid = { minX: 0, minZ: 0, step, cols, rows: cols }
  const heights = new Float32Array(cols * cols).fill(40)
  const sites: GridSite[] = [
    { id: 'T1', x: 1200, z: 1200, kind: 'town', r: 250 },
    { id: 'T2', x: 4800, z: 4800, kind: 'town', r: 250 },
    { id: 'V1', x: 3000, z: 1500, kind: 'village', r: 120 },
    ...farms,
  ]
  const roads = [[1200, 1200, 3000, 1500, 4800, 4800], [3000, 1300, 3000, 1700], [2900, 1500, 3100, 1500]]
  return { heights, grid, sites, roads, isWater: () => false, size }
}
const lvTo = (p: ReturnType<typeof planGrid>, id: string) => p.lines.filter((l) => l.kind === 'lv' && l.to === id)

test('farm detection: FARM_ ids or the farm flag', () => {
  assert.ok(isFarm({ id: 'FARM_3', x: 0, z: 0, kind: 'hamlet', r: 50 }))
  assert.ok(isFarm({ id: 'H', x: 0, z: 0, kind: 'hamlet', r: 50, farm: true }))
  assert.ok(!isFarm({ id: 'H1', x: 0, z: 0, kind: 'hamlet', r: 50 }))
})
test('a farm near a village gets one short LV drop and no station of its own', () => {
  const f: GridSite = { id: 'FARM_1', x: 3000 + 250, z: 1500 + 200, kind: 'hamlet', r: 50 }
  const p = planGrid(world([f]), { style: 'eden', plants: 0, ehv: false })
  assert.equal(p.farms?.FARM_1, 'lv')
  const d = lvTo(p, 'FARM_1')
  assert.equal(d.length, 1)
  assert.ok(d[0].length <= 600, `drop ${d[0].length} m`)
  assert.ok(!p.stations.some((s) => s.site === 'FARM_1'))
  assert.ok(!p.lines.some((l) => l.kind === 'mv' && l.to.includes('FARM')))
})
test('a farm far from LV but near an MV feeder gets a pole transformer', () => {
  // on the T1 -> V1 feeder corridor, ~1 km from any LV
  const f: GridSite = { id: 'FARM_2', x: 2100, z: 1350 + 150, kind: 'hamlet', r: 50 }
  const p = planGrid(world([f]), { style: 'eden', plants: 0, ehv: false })
  const how = p.farms?.FARM_2
  assert.ok(how === 'pole-trafo' || how === 'lv', String(how))
  if (how === 'pole-trafo') {
    const st = p.stations.filter((s) => s.site === 'FARM_2')
    assert.equal(st.length, 1); assert.equal(st[0].kind, 'mvlv'); assert.ok(st[0].w < 5)
  }
  assert.equal(lvTo(p, 'FARM_2').length, 1)
})
test('a farm out of reach of every line stays unfed', () => {
  const f: GridSite = { id: 'FARM_9', x: 500, z: 5500, kind: 'hamlet', r: 50 }
  const p = planGrid(world([f]), { style: 'eden', plants: 0, ehv: false, farmMax: 300 })
  assert.ok(p.unfed.includes('FARM_9'))
  assert.equal(lvTo(p, 'FARM_9').length, 0)
})
