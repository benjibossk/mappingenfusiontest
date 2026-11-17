// Hierarchical power grid (src/modules/powergrid.ts): EHV/HV/MV/LV + transformer stations
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { planGrid, padRelief, stationEntities, STATION_PREFABS, type GridSite } from '../../src/modules/powergrid.ts'
import { POWER_STYLE, powerLineShape } from '../../src/modules/power.ts'

const GUID = /^\{[0-9A-F]{16}\}Prefabs\//
function world(size: number) {
  const step = 20, cols = Math.round(size / step) + 1
  const grid = { minX: 0, minZ: 0, step, cols, rows: cols }
  const heights = new Float32Array(cols * cols)
  // rolling hills + a lake in the middle
  for (let r = 0; r < cols; r++) for (let c = 0; c < cols; c++) {
    const x = c * step, z = r * step
    heights[r * cols + c] = 40 + 15 * Math.sin(x / 700) * Math.cos(z / 900)
  }
  const lake = { x: size / 2, z: size / 2, r: size / 12 }
  const isWater = (x: number, z: number) => Math.hypot(x - lake.x, z - lake.z) < lake.r
  const sites: GridSite[] = [
    { id: 'T1', x: size * 0.15, z: size * 0.2, kind: 'town', r: 250 },
    { id: 'T2', x: size * 0.85, z: size * 0.8, kind: 'town', r: 250 },
    { id: 'T3', x: size * 0.8, z: size * 0.2, kind: 'town', r: 250 },
    { id: 'V1', x: size * 0.3, z: size * 0.6, kind: 'village', r: 120 },
    { id: 'V2', x: size * 0.55, z: size * 0.25, kind: 'village', r: 120 },
    { id: 'V3', x: size * 0.6, z: size * 0.75, kind: 'village', r: 120 },
    { id: 'I1', x: size * 0.25, z: size * 0.35, kind: 'industry', r: 100 },
    { id: 'H1', x: size * 0.3 + 500, z: size * 0.6 + 100, kind: 'hamlet', r: 50 },
  ]
  // roads: a ring through every site + a cross street in each
  const ring = sites.flatMap((s) => [s.x, s.z])
  const roads = [ring, ...sites.map((s) => [s.x - s.r, s.z, s.x + s.r, s.z])]
  return { input: { heights, grid, sites, roads, isWater, size }, lake, sites }
}
const along = (p: number[], f: (x: number, z: number) => void) => {
  for (let i = 0; i + 3 < p.length; i += 2) { const n = Math.ceil(Math.hypot(p[i + 2] - p[i], p[i + 3] - p[i + 1]) / 10); for (let k = 0; k <= n; k++) f(p[i] + ((p[i + 2] - p[i]) * k) / n, p[i + 1] + ((p[i + 3] - p[i + 1]) * k) / n) }
}

test('grid: every level present on a big map, each village fed, MV ends at stations', () => {
  const { input, lake, sites } = world(10000)
  const plan = planGrid(input, { style: 'eden', ehv: 'auto', mvMax: 6000 })
  const kinds = new Set(plan.lines.map((l) => l.kind))
  for (const k of ['ehv', 'hv', 'mv', 'lv']) assert.ok(kinds.has(k as never), 'level ' + k)
  const ids = new Set(plan.stations.map((s) => s.id))
  for (const l of plan.lines.filter((q) => q.kind === 'mv')) { assert.ok(ids.has(l.from), 'MV from station'); assert.ok(ids.has(l.to), 'MV to station') }
  for (const s of sites.filter((q) => q.kind !== 'hamlet')) assert.ok(plan.stations.some((st) => st.site === s.id), 'fed ' + s.id)
  assert.ok(plan.lines.some((l) => l.kind === 'lv' && l.to === 'H1'), 'hamlet fed by LV')
  // heavy lines avoid water and village centres
  for (const l of plan.lines.filter((q) => q.kind !== 'lv')) along(l.path, (x, z) => {
    assert.ok(Math.hypot(x - lake.x, z - lake.z) >= lake.r - 30, l.id + ' crosses the lake')
    for (const s of sites) if (s.kind !== 'industry') assert.ok(Math.hypot(x - s.x, z - s.z) > s.r * 0.5 - 30, l.id + ' crosses centre ' + s.id)
  })
})

test('grid: stations flat, road-connected, real prefabs; EHV ends made by the generator', () => {
  const { input } = world(10000)
  const plan = planGrid(input, { style: 'eden' })
  assert.ok(plan.stations.length >= 6)
  for (const st of plan.stations) {
    assert.ok(padRelief(input.heights, input.grid, st) < 0.6, st.id + ' flat')
    assert.match(st.prefab, GUID)
  }
  assert.ok(plan.access.length >= plan.stations.length - 1, 'access roads')
  const e = plan.stations.filter((s) => s.kind === 'ehv')
  assert.ok(e.length >= 2 && e.length % 2 === 0, 'EHV bays in pairs')
  assert.ok(e.every((s) => s.byGenerator))
  assert.equal(stationEntities(plan.stations).length, plan.stations.length - e.length)
  for (const l of plan.lines) assert.match(powerLineShape(l, l.id).generator!, /^\{[0-9A-F]{16}\}Prefabs\/WEGenerators\/Powerline\//)
})

test('grid: small map has no EHV, USSR style uses the USSR generators and kiosks', () => {
  const { input } = world(4000)
  const plan = planGrid(input, { style: 'ussr' })
  assert.ok(!plan.lines.some((l) => l.kind === 'ehv'))
  assert.ok(plan.lines.length > 0)
  for (const l of plan.lines) assert.equal(powerLineShape(l, l.id).generator, POWER_STYLE.ussr[l.kind].gen)
  assert.ok(plan.stations.some((s) => s.prefab === STATION_PREFABS.ussr.mvlv.prefab))
})

test('grid: power plants are the sources, transmission is a meshed loop', () => {
  const { input, sites } = world(12000)
  const plan = planGrid(input, { style: 'eden', plants: 'auto' })
  const plants = plan.stations.filter((s) => s.kind === 'plant')
  assert.equal(plants.length, 2)
  for (const p of plants) {
    assert.ok(sites.every((q) => q.kind === 'industry' || Math.hypot(q.x - p.x, q.z - p.z) > q.r + 300), 'plant away from settlements')
    assert.ok(stationEntities([p])[0].x !== p.x, 'mesh offset applied')
  }
  // transmission = HV + EHV links; a loop needs at least as many links as transmission nodes
  const trans = plan.lines.filter((l) => l.kind === 'hv' || l.kind === 'ehv')
  const nodes = plan.stations.filter((s) => s.kind === 'hv').length
  assert.ok(trans.length >= nodes, `meshed: ${trans.length} links for ${nodes} nodes`)
  assert.ok(plan.lines.some((l) => l.kind === 'ehv'), 'plants linked by EHV')
})
