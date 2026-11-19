import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildLifeAnchors, validateLifeAnchors, inscribedRect, mapIdOf, type LifeWorldInput } from '../../src/modules/lifeAnchors.ts'
import { buildLifeAddon, zipFiles, LF_CORE_GUID } from '../../src/modules/lifeExport.ts'

const cols = 129, rows = 129, step = 8
const world = (): LifeWorldInput => {
  const heights = new Array(cols * rows).fill(20)
  for (let r = 0; r < rows; r++) for (let c = 0; c < 10; c++) heights[r * cols + c] = -5 // sea strip on the west
  const box = (x: number, z: number, h = 5) => [x - h, z - h, x + h, z - h, x + h, z + h, x - h, z + h]
  return {
    grid: { minX: 0, minZ: 0, step, cols, rows },
    heights,
    sites: [{ id: 'TOWN_1', x: 500, z: 500, kind: 'town' }, { id: 'FARM_1', x: 700, z: 300, kind: 'hamlet' }],
    roads: [{ id: 'R1', pts: [0, 450, 1024, 450], width: 6 }],
    waters: [{ id: 'L1', type: 'lake', pts: [800, 800, 900, 800, 900, 900, 800, 900], width: 0 }],
    zones: [
      { id: 'VAN_PORT_1', kind: 'site', sub: 'vanilla:port:x', x: 100, z: 600, yaw: 0 },
      { id: 'IND_1', kind: 'industrial', sub: 'quarry', x: 300, z: 800, yaw: 0 },
      { id: 'VAN_GAS_STATION_1', kind: 'site', sub: 'vanilla:gas_station:y', x: 300, z: 470, yaw: 90 },
    ],
    settlement: { placed: [
      { id: 'TOWN_1_b1', site: 'TOWN_1', x: 480, z: 480, yaw: 0, corners: box(480, 480), role: 'house' },
      { id: 'TOWN_1_b2', site: 'TOWN_1', x: 520, z: 480, yaw: 0, corners: box(520, 480), role: 'house' },
      { id: 'TOWN_1_b3', site: 'TOWN_1', x: 500, z: 530, yaw: 0, corners: box(500, 530), role: 'church' },
      { id: 'FARM_1_b1', site: 'FARM_1', x: 700, z: 300, yaw: 0, corners: box(700, 300), role: 'farmhouse' },
    ] },
    areas: [{ id: 'F1', kind: 'field', pts: [720, 150, 860, 170, 850, 260, 730, 250] }],
  }
}
const opt = { mapId: mapIdOf('Worlds/MG_Test') }

test('mapIdOf sanitises the world name', () => assert.equal(opt.mapId, 'mg-test'))

test('same world => same anchors and ids (deterministic)', () => {
  const a = buildLifeAnchors(world(), opt), b = buildLifeAnchors(world(), opt)
  assert.deepEqual(a, b)
  assert.ok(a.every((x) => x.id.startsWith('mg-test.')))
})

test('covers farms, homes, port, industry, fuel, spawn, zones', () => {
  const a = buildLifeAnchors(world(), opt), kinds = new Set(a.map((x) => x.kind))
  for (const k of ['workplace', 'farmPlot', 'seedCrate', 'beehive', 'wheatField', 'house', 'houseSign', 'fishingSpot', 'miningArea', 'fuelTill', 'spawnBed', 'townArea', 'safeArea']) assert.ok(kinds.has(k as never), k)
  const plots = a.filter((x) => x.kind === 'farmPlot').length
  assert.ok(plots >= 3 && plots <= 6)
  const houses = a.filter((x) => x.kind === 'house'), signs = a.filter((x) => x.kind === 'houseSign')
  assert.equal(houses.length, 2) // the 2 town houses (church and farm sites excluded)
  assert.deepEqual(houses.map((h) => h.id), signs.map((s) => s.id))
  const wf = a.find((x) => x.kind === 'wheatField')!
  assert.ok(wf.size![0] >= 12 && wf.size![1] >= 12)
})

test('validation passes on the generated anchors and catches errors', () => {
  const w = world(), a = buildLifeAnchors(w, opt)
  assert.deepEqual(validateLifeAnchors(a, w).filter((i) => i.level === 'error'), [])
  const bad = [...a, { ...a.find((x) => x.kind === 'beehive')! }, { ...a[0], kind: 'seedCrate' as const, id: 'x.y.1', x: 500, z: 450 }].filter((x) => x.kind !== 'spawnBed')
  const msgs = validateLifeAnchors(bad, w).map((i) => i.msg)
  assert.ok(msgs.includes('duplicate id') && msgs.includes('on a road') && msgs.includes('no FirstSpawnBed'))
})

test('inscribed rect stays inside with margin', () => {
  const r = inscribedRect([0, 0, 100, 0, 100, 60, 0, 60], 3)!
  assert.ok(r.cx - r.sx / 2 >= 3 - 1e-6 && r.cx + r.sx / 2 <= 97 + 1e-6 && r.sz <= 54)
})

test('addon files: deps, subscene, layers, zip', () => {
  const a = buildLifeAnchors(world(), opt)
  const f = buildLifeAddon(a, { mapId: opt.mapId, addonName: 'Mapgenerator', addonGuid: 'ABCDEF0123456789', world: 'Worlds/MG_Test' })
  assert.match(f.get('Mapgenerator_Life.gproj')!, new RegExp(`"58D0FB3206B6F859" "ABCDEF0123456789" "${LF_CORE_GUID}"`))
  assert.match(f.get('Worlds/MG_TestLife/MG_TestLife.ent')!, /Parent "Worlds\/MG_Test\/MG_Test.ent"/)
  assert.ok(f.has('Worlds/MG_TestLife/MG_TestLife_Layers/Homes_town-1.layer'))
  assert.match(f.get('Worlds/MG_TestLife/MG_TestLife_Layers/Farms.layer')!, /m_sPlotKey "mg-test\.farmPlot\.1"/)
  assert.match(f.get('Missions/Mapgenerator_Life.conf')!, /m_sGameMode "Roleplay"/)
  const z = zipFiles(f, 'Mapgenerator_Life')
  assert.equal(new DataView(z.buffer).getUint32(0, true), 0x04034b50)
  assert.deepEqual(buildLifeAddon(a, { mapId: opt.mapId, addonName: 'Mapgenerator', addonGuid: '', world: 'Worlds/MG_Test' }).get('Mapgenerator_Life.gproj'), buildLifeAddon(a, { mapId: opt.mapId, addonName: 'Mapgenerator', addonGuid: '', world: 'Worlds/MG_Test' }).get('Mapgenerator_Life.gproj'))
})
