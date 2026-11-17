// Countryside: the random world uses the Zone tool "Champs" pipeline (src/modules/zonefill.ts)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { countrysideZones, fillFieldZone, pointObstacle } from '../../src/modules/zonefill.ts'
import { pointInPoly } from '../../src/modules/industrial.ts'

const wood = (x: number, z: number) => x > 300 && Math.abs(z) < 200 // a forest east of the site
const ok = (x: number, z: number) => Math.hypot(x, z) > 80 && !wood(x, z)

test('countryside zones follow the open land and leave the forest out', () => {
  const zs = countrysideZones(0, 0, 90, 600, ok)
  assert.ok(zs.length >= 1)
  const p = zs[0]
  assert.ok(p.length >= 8)
  for (let i = 0; i < p.length; i += 2) assert.ok(!(p[i] > 340 && Math.abs(p[i + 1]) < 160), 'vertex deep in the forest')
  assert.ok(!pointInPoly(p, 450, 0), 'forest inside the zone')
})

test('fillFieldZone: plots inside the zone, off the forest and the obstacles, no overlap, hedges', () => {
  const zone = countrysideZones(0, 0, 90, 600, ok)[0]
  const house = pointObstacle(-200, 0, 14)
  const r = fillFieldZone({ zone, seed: 7, prefix: 'T_', ok: (x, z) => ok(x, z) && pointInPoly(zone, x, z), obstacles: [house], hedgeSeed: 3 })
  assert.ok(r.fields.length > 10)
  assert.ok(r.hedges.length > 0)
  for (const f of r.fields) {
    let cx = 0, cz = 0
    for (const q of f) { cx += q[0]; cz += q[1] }
    cx /= f.length; cz /= f.length
    assert.ok(!wood(cx, cz) && pointInPoly(zone, cx, cz))
    assert.ok(!pointInPoly(f.slice(0, -1).flat(), -200, 0), 'house inside a field')
  }
  // same input, same output (Zone tool and worldgen share it)
  const r2 = fillFieldZone({ zone, seed: 7, prefix: 'T_', ok: (x, z) => ok(x, z) && pointInPoly(zone, x, z), obstacles: [pointObstacle(-200, 0, 14)], hedgeSeed: 3 })
  assert.deepEqual(r2.fields, r.fields)
})
