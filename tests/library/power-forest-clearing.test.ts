// Power lines cut a cleared corridor through forests (seed 21: POWER_HV_1 pylons standing in FOREST_PROD_W1_4)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { POWER_CLEARANCE, powerCorridorMasks, powerCorridorTest, powerLineShape } from '../../src/modules/power'
import { FOREST_AVOID } from '../../src/project'

test('every voltage sets a non-zero Clearance on its generator', () => {
  for (const kind of ['ehv', 'hv', 'mv', 'lv'] as const) {
    const sh = powerLineShape({ kind, path: [0, 0, 100, 0], poles: [0, 0, 100, 0], length: 100 } as never, 'L')
    const i = sh.paramKeys!.indexOf('Clearance')
    assert.ok(i >= 0 && Number(sh.paramValues![i]) === POWER_CLEARANCE[kind] && POWER_CLEARANCE[kind] > 0)
  }
  assert.ok(POWER_CLEARANCE.hv * 2 >= 20 && POWER_CLEARANCE.mv * 2 >= 10 && POWER_CLEARANCE.lv < POWER_CLEARANCE.mv)
  assert.equal(FOREST_AVOID.powerLines, true)
})

test('corridor test and ground strip only inside the forest', () => {
  const lines = [{ kind: 'hv' as const, path: [0, 0, 400, 0] }]
  const inC = powerCorridorTest(lines)
  assert.ok(inC(200, 9) && !inC(200, 11) && !inC(450, 0))
  const forest = (x: number, z: number) => x > 100 && x < 300 && Math.abs(z) < 100
  const m = powerCorridorMasks(lines, forest)
  assert.equal(m.length, 1)
  const xs = m[0].points.filter((_, i) => i % 2 === 0)
  assert.ok(Math.min(...xs) >= 90 && Math.max(...xs) <= 310 && m[0].half === POWER_CLEARANCE.hv)
})

test('every forest generator shape avoids objects, roads and power lines', async () => {
  const { withAvoid, forestAvoidMissing } = await import('../../src/project')
  const gen = '{37C347EECE844530}Prefabs/WEGenerators/Forest/FG_Forest_Pine1.et'
  const shapes = [
    { id: 'FOREST_GP_BELT_1', kind: 'polyline' as const, closed: true, points: [0, 0, 10, 0, 10, 10], generator: gen },
    { id: 'FOREST_PROD_W1_4', kind: 'polyline' as const, closed: true, points: [0, 0, 10, 0, 10, 10], generator: gen, avoid: { objects: false, roads: false } },
    { id: 'X', kind: 'polyline' as const, closed: true, points: [0, 0, 10, 0, 10, 10], generator: gen, paramKeys: ['m_bAvoidRoads'], paramValues: ['0'] },
  ]
  assert.equal(forestAvoidMissing(shapes).length, 3)
  assert.equal(forestAvoidMissing(shapes.map(withAvoid)).length, 0)
})
