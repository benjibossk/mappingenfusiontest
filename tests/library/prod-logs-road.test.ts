// Production-forest log piles stay off the other roads (seed 21 live audit: a pile on ROAD_TERRE_1)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { addProdForests } from '../../src/modules/worldextras'

const sq = (x0: number, z0: number, s: number) => [x0, z0, x0 + s, z0, x0 + s, z0 + s, x0, z0 + s]
const dist = (p: number[], x: number, z: number) => { let m = Infinity; for (let i = 0; i + 3 < p.length; i += 2) { const ax = p[i], az = p[i + 1], dx = p[i + 2] - ax, dz = p[i + 3] - az, L = dx * dx + dz * dz, t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L)); m = Math.min(m, Math.hypot(x - ax - dx * t, z - az - dz * t)) } return m }

test('log piles >= 7 m off every input road', () => {
  let piles = 0
  for (let seed = 1; seed <= 6; seed++) {
    const roads = [[0, -20, 1400, -20], [700, -20, 700, 1400], [0, 300, 1400, 300]]
    const r = addProdForests([{ id: 'F', kind: 'forest', leaf: 'needle', pts: sq(0, 0, 1400) }], { seed, roads, share: 1, ground: () => 10 } as never)
    for (const a of r.areas as { logs?: { x: number; z: number }[] }[]) for (const l of a.logs ?? []) { piles++; for (const rd of roads) assert.ok(dist(rd, l.x, l.z) >= 7 - 1e-6) }
  }
  assert.ok(piles > 0)
})
