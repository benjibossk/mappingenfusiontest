// Gameplay metrics (scripts/bench/gameplayMetrics.ts) on hand-built rasters
import test from 'node:test'
import assert from 'node:assert/strict'
import { openGround, approachCover, summitViewshed, fillPolygon, type CoverMap } from '../../src/modules/gameplay'

const grid = (cols: number, rows: number, step = 10) => ({ step, cols, rows, minX: 0, minZ: 0 })
const map = (cols: number, rows: number): CoverMap => ({ ...grid(cols, rows), land: new Uint8Array(cols * rows).fill(1), cover: new Uint8Array(cols * rows) })

test('open ground: a forest strip on one side, the far edge is ~ the strip distance from cover', () => {
  const m = map(100, 10)
  fillPolygon(m, m.cover, [0, 0, 100, 0, 100, 100, 0, 100]) // first 10 columns
  const o = openGround(m)
  assert.equal(o.openPct, 90)
  assert.ok(Math.abs(o.toCoverM.max - 900) <= 20, `max ${o.toCoverM.max}`)
  assert.ok(o.beyond300Pct > 50)
})

test('approach cover: a ring of forest around the objective reads ~100 %, bare ground 0 % and counts as bare', () => {
  const m = map(120, 120)
  const bare = approachCover(m, [{ x: 600, z: 600 }])
  assert.equal(bare.pct.med, 0); assert.equal(bare.barePct, 100)
  m.cover.fill(1)
  assert.equal(approachCover(m, [{ x: 600, z: 600 }]).pct.med, 100)
})

test('viewshed: a flat plain is fully visible, a wall hides what lies behind it', () => {
  const m = map(200, 200), h = new Float32Array(200 * 200).fill(10)
  h[100 * 200 + 100] = 12 // the summit
  const flat = summitViewshed(h, m, { peaks: 1, range: 800, stride: 2 })
  assert.ok(flat.visiblePct > 99, `flat ${flat.visiblePct}`)
  for (let r = 0; r < 200; r++) { h[r * 200 + 110] = 40; m.land[r * 200 + 110] = 0 } // ridge 100 m east, above the eye (not land: not a peak)
  const walled = summitViewshed(h, m, { peaks: 1, range: 800, stride: 2 })
  assert.ok(walled.deadPct > 25 && walled.deadPct < 50, `dead ${walled.deadPct}`)
})

test('band score: 95 at the centre of the vanilla band, 80 on its edge, 0 past the tolerance', async () => {
  const { bandScore } = await import('../../src/modules/gameplay')
  const b = { lo: 10, hi: 20, tol: 10 }
  assert.equal(bandScore(15, b), 95); assert.equal(bandScore(10, b), 80); assert.equal(bandScore(20, b), 80)
  assert.equal(bandScore(25, b), 40); assert.equal(bandScore(40, b), 0); assert.equal(bandScore(NaN, b), 0)
})

test('gameplay report: a bare plain scores low and flags exposed spots + the bare village', async () => {
  const { gameplayReport } = await import('../../src/modules/gameplay')
  const n = 160, step = 16, heights = new Float32Array(n * n).fill(20)
  const houses = Array.from({ length: 12 }, (_, i) => ({ x: 1280 + (i % 4) * 20, z: 1280 + Math.floor(i / 4) * 20 }))
  const r = gameplayReport({ heights, grid: { step, cols: n, rows: n, minX: 0, minZ: 0 }, forests: [], houses })
  assert.ok(r.score < 50, `score ${r.score}`)
  assert.ok(r.spots.some((s) => s.kind === 'exposed') && r.spots.some((s) => s.kind === 'bare'))
})

test('gameplay cover rules: belts around a bare village, copses on the exposed plain, one armour plain kept', async () => {
  const { gameplayReport } = await import('../../src/modules/gameplay')
  const { gameplayCover } = await import('../../src/modules/gameplayCover')
  const n = 200, step = 16, heights = new Float32Array(n * n).fill(20), grid = { step, cols: n, rows: n, minX: 0, minZ: 0 }
  const houses = Array.from({ length: 12 }, (_, i) => ({ x: 800 + (i % 4) * 20, z: 800 + Math.floor(i / 4) * 20 }))
  const forests = [[2400, 2400, 2900, 2400, 2900, 2900, 2400, 2900]]
  const before = gameplayReport({ heights, grid, forests: forests.map((pts) => ({ pts })), houses })
  const gc = gameplayCover({ heights, grid, forests, houses, sites: [{ x: 830, z: 820, kind: 'village', r: 120 }], roads: [{ pts: [830, 820, 3000, 820], half: 4 }], blocked: () => false, seed: 7 })
  assert.ok(gc.belts.length >= 4, `belts ${gc.belts.length}`)
  assert.ok(gc.copses.length > 10, `copses ${gc.copses.length}`)
  const all = [...forests, ...gc.belts, ...gc.strips, ...gc.copses].map((pts) => ({ pts }))
  const after = gameplayReport({ heights, grid, forests: all, houses })
  assert.ok(after.open.beyond150Pct < before.open.beyond150Pct / 2, `exposure ${before.open.beyond150Pct} -> ${after.open.beyond150Pct}`)
  assert.ok(after.approach.pct.med > before.approach.pct.med)
  assert.ok(after.open.toCoverM.max > 450, `armour plain kept: max ${after.open.toCoverM.max} m`)
})
