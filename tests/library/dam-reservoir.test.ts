import { test } from 'node:test'
import assert from 'node:assert/strict'
import { placeDams, damZone, snapRoadsToCrest, DAM_END, DAM_DEFAULTS } from '../../src/modules/dam.ts'
import { applyZones } from '../../src/modules/zones.ts'
import { carveWater, waterShapes } from '../../src/modules/water.ts'

const g = { minX: 0, minZ: 0, step: 4, cols: 201, rows: 201 }
const valley = () => {
  const h: number[] = []
  for (let r = 0; r < g.rows; r++) for (let c = 0; c < g.cols; c++) {
    const x = c * g.step, z = r * g.step
    const k = 0.0015 + 0.004 * Math.exp(-(((z - 500) / 60) ** 2))
    h.push(20 + 0.03 * (800 - z) + k * (x - 400) ** 2)
  }
  return h
}
const river = { type: 'river' as const, pts: Array.from({ length: 39 }, (_, i) => [400, 20 + i * 20]).flat(), width: 6, depth: 1, auto: true }
const at = (h: number[], x: number, z: number) => h[Math.round(z / g.step) * g.cols + Math.round(x / g.step)]

test('dam reservoir: level = crest - 2 m', () => {
  const r = placeDams(valley(), g, [river]), d = r.dams[0]
  assert.equal(d.level, d.crest - 2)
  assert.equal(r.lakes[0].level, d.level)
})

test('dam reservoir: the zone re-sculpts the embankment on a fresh relief (main.ts recompose)', () => {
  const r = placeDams(valley(), g, [river]), d = r.dams[0]
  const zn = damZone({ ...d })
  const h = valley() // the island relief WITHOUT the dam, as main.ts rebuilds it
  const lakes = r.lakes.map((w, i) => ({ ...w, id: `L${i}` })) as any
  carveWater(h, g, lakes)
  applyZones(h, g, [zn])
  assert.ok(Math.abs(at(h, d.cx, d.cz) - d.crest) < 0.01, 'crest in the heightmap')
  // every cell inside the reservoir sits under the water: the water shows
  const m = r.masks[0]
  let wet = 0
  for (let k = 0; k < m.length; k++) if (m[k]) { assert.ok(h[k] < d.level, `cell ${k} ${h[k]} >= ${d.level}`); wet++ }
  assert.ok(wet > 100)
  // the lake shape is sent at the reservoir level
  const before = valley()
  const sh = waterShapes(lakes, before, h, g)[0]
  for (let i = 0; i < sh.lift!.length; i++) assert.ok(sh.lift![i] >= 0)
})

test('dam: wall ends key into the hillsides (ground at crest height past both ends)', () => {
  const r = placeDams(valley(), g, [river]), d = r.dams[0]
  const h = valley()
  applyZones(h, g, [damZone(d)])
  const L = Math.hypot(d.bx - d.ax, d.bz - d.az), ux = (d.bx - d.ax) / L, uz = (d.bz - d.az) / L
  for (const s of [-1, 1]) {
    const ex = d.cx + ux * s * (L / 2 + DAM_END - 2), ez = d.cz + uz * s * (L / 2 + DAM_END - 2)
    assert.ok(at(h, ex, ez) >= d.crest - 0.5, `end ${s}: ${at(h, ex, ez)} vs crest ${d.crest}`)
  }
  assert.equal(DAM_DEFAULTS.freeboard, 2)
})

test('dam: a road ending near a crest end is carried onto the crest', () => {
  const r = placeDams(valley(), g, [river]), d = r.dams[0]
  const L = Math.hypot(d.bx - d.ax, d.bz - d.az), ux = (d.bx - d.ax) / L, uz = (d.bz - d.az) / L
  const ex = d.bx + ux * DAM_END, ez = d.bz + uz * DAM_END
  const road = { pts: [ex + 300, ez, ex + 30, ez + 5] }
  const far = { pts: [0, 0, 50, 50] }
  snapRoadsToCrest([road, far], [d])
  assert.deepEqual(road.pts.slice(-2), [ex, ez])
  assert.equal(far.pts.length, 4)
})
