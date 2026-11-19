import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildGraph, route, tripMath, makeCtx, evaluate, optimize, imbalance, type Economy, type WorldLike } from '../../src/modules/lifeEconomy.ts'

const eco: Economy = JSON.parse(readFileSync(new URL('../../data/life/economy.json', import.meta.url), 'utf8'))

test('shortest path prefers the fast road over the shorter dirt one', () => {
  // A(0,0) -> B(1000,0): dirt straight (1000 m) vs asphalt detour via (500,300) (~1166 m)
  const roads = [{ id: 'd', type: 'dirt', pts: [0, 0, 1000, 0] }, { id: 'a', type: 'asphalt', pts: [0, 0, 500, 300, 1000, 0] }]
  const g = buildGraph(roads)
  const v = eco.vehicles.car
  const leg = route(g, 0, 0, 1000, 0, v)
  assert.ok(leg.path.some((c, i) => i % 2 === 1 && c === 300), 'goes through the asphalt detour')
  assert.ok(Math.abs(leg.sec - (2 * Math.hypot(500, 300)) / 90 * 3.6) < 1)
  const foot = route(g, 0, 0, 1000, 0, eco.vehicles.foot) // equal speeds: the short road wins
  assert.ok(!foot.path.includes(300))
})

test('road ends join a nearby vertex of another road', () => {
  const g = buildGraph([{ id: 'a', type: 'asphalt', pts: [0, 0, 100, 0] }, { id: 'b', type: 'asphalt', pts: [110, 0, 200, 0] }])
  const leg = route(g, 0, 0, 200, 0, eco.vehicles.car)
  assert.ok(leg.m < 205 && leg.m > 195)
})

test('profit math', () => {
  const c = { id: 'x', label: 'x', source: 'role:mine', harvestSecPerUnit: 10, rawItem: 'r', process: { role: 'depot', inPerOut: 2, secPerOut: 5, outItem: 'o' }, sellRole: 'market', price: 40, costPerRaw: 1, vehicle: 'truck' as const }
  const v = { label: 't', capacity: 100, speeds: { main: 60, dirt: 30, trail: 20, offroad: 10 } }
  const m = tripMath(c, v, 600)
  assert.equal(m.load, 50); assert.equal(m.revenue, 2000); assert.equal(m.cost, 100)
  assert.equal(m.tripSec, 1000 + 250 + 600)
  assert.ok(Math.abs(m.perHour - 1900 / 1850 * 3600) < 1e-6)
})

const world: WorldLike = {
  roads: [{ id: 'r1', type: 'asphalt', pts: [0, 0, 4000, 0] }, { id: 'r2', type: 'dirt', pts: [2000, 0, 2000, 3000] }],
  zones: [
    { id: 'MINE', x: 3900, z: 100, rpRole: 'mine' }, { id: 'DEP', x: 0, z: 100, rpRole: 'depot' }, { id: 'MKT', x: 2000, z: 3000, rpRole: 'market' },
    { id: 'FISH', x: 100, z: 0, rpRole: 'fishing' }, { id: 'IND1', kind: 'industrial', x: 3500, z: 50 }, { id: 'IND2', kind: 'industrial', x: 2100, z: 200 },
  ],
}
const small: Economy = { ...eco, chains: eco.chains.filter((c) => ['iron', 'fish'].includes(c.id)) }

test('evaluate finds routes and flags missing places', () => {
  const rows = evaluate(makeCtx(world), eco)
  const iron = rows.find((r) => r.chain.id === 'iron')!
  assert.ok(iron.ok && iron.legs.length === 3 && iron.perHour > 0)
  assert.equal(rows.find((r) => r.chain.id === 'honey')!.flag, 'missing')
})

test('optimizer is a no-op when off and improves balance when on', () => {
  const ctx = makeCtx(world)
  assert.deepEqual(optimize(ctx, small, false), {})
  const before = imbalance(evaluate(ctx, small), small.band)
  const asg = optimize(ctx, small, true)
  const after = imbalance(evaluate(ctx, small, asg), small.band)
  assert.ok(Object.keys(asg).length > 0)
  assert.ok(after < before, `${after} < ${before}`)
})
