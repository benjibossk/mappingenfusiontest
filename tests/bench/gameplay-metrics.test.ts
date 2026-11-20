// Gameplay metrics (scripts/bench/gameplayMetrics.ts) on hand-built rasters
import test from 'node:test'
import assert from 'node:assert/strict'
import { openGround, approachCover, summitViewshed, fillPolygon, type CoverMap } from '../../scripts/bench/gameplayMetrics'

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
