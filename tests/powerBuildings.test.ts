import { test } from 'node:test'
import assert from 'node:assert/strict'
import { clearPolesOfBuildings, POLE_BLD_CLEAR } from '../src/modules/powergrid.ts'
import { PowerObstacles } from '../src/modules/powerroads.ts'

test('clearPolesOfBuildings: end poles inside a house move out, lines sharing that end stay tied', () => {
  const house = [100, 100, 112, 100, 112, 110, 100, 110]
  const ob = new PowerObstacles({ roads: [{ pts: [0, 140, 300, 140], half: 3 }], buildings: [house] })
  const shared = [105, 105]
  const a = { poles: [60, 105, ...shared], path: [] as number[] }
  a.path = a.poles
  const b = { poles: [...shared, 160, 105], path: [...shared, 160, 105] }
  const moved = clearPolesOfBuildings(ob, [a, b])
  assert.equal(moved, 2)
  for (const l of [a, b]) for (let i = 0; i < l.poles.length; i += 2) assert.ok(ob.bldDist(l.poles[i], l.poles[i + 1], 3) >= POLE_BLD_CLEAR)
  assert.deepEqual(a.poles.slice(2), b.poles.slice(0, 2))
  assert.deepEqual(b.path.slice(0, 2), b.poles.slice(0, 2))
  assert.ok(ob.roadEdge(a.poles[2], a.poles[3]) >= 0.5)
})
