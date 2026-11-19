// Roads never cross a zone footprint (military base / airfield / vanilla stamp): NetworkParams.avoid
import test from 'node:test'
import assert from 'node:assert/strict'
import { buildNetwork } from '../../src/modules/network'
import { centreLine } from '../../src/modules/roads'

test('a road between two places goes round an avoided disc instead of through it', () => {
  const step = 16, cols = 64, rows = 64, g = { minX: 0, minZ: 0, step, cols, rows }
  const h = new Array(cols * rows).fill(20) // flat land: the straight line would cross the disc
  const sites = [{ id: 'A', x: 100, z: 512, kind: 'village' as const }, { id: 'B', x: 924, z: 512, kind: 'village' as const }]
  const base = { seed: 1, sites: 2, spacing: 300, maxSlope: 8, main: 'asphalt' as const, minor: 'asphalt' as const, lane: 'dirt' as const, v2: false }
  const avoid = [{ x: 512, z: 512, r: 120 }]
  const inside = (rs: { pts: number[] }[]) => rs.some((r) => { const c = centreLine(r.pts, 4); for (let i = 0; i < c.length; i += 2) if (Math.hypot(c[i] - 512, c[i + 1] - 512) < 100) return true; return false })
  assert.ok(inside(buildNetwork(h, g, undefined, sites, base)), 'without avoid the road runs straight through')
  assert.ok(!inside(buildNetwork(h, g, undefined, sites, { ...base, avoid })), 'with avoid it stays out of the disc')
})
