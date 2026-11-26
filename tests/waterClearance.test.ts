import { test } from 'node:test'
import assert from 'node:assert/strict'
import { riverCorridor, riverSentWidth, riverWetHalf, RIVER_MAX_SENT_WIDTH, waterShapes, type Water } from '../src/modules/water.ts'
import { riparianBands } from '../src/modules/riparian.ts'
import { roadMasks } from '../src/modules/roads.ts'
import { roadLayers } from '../src/shared/maskPaint.mjs'
import { biomeSurfaceName } from '../src/biomes/surfaces.ts'
import { biome } from '../src/data/biomes.ts'

const step = 4, cols = 151, rows = 151
const g = { minX: 0, minZ: 0, step, cols, rows }
const river: Water = { id: 'R1', type: 'river', pts: [0, 300, 600, 300], width: 30, depth: 2.5, carve: false, wetEdge: true }

test('vegetation keeps out of the water shown in game (spline width x 1.3), not only the traced width', () => {
  const wet = riverWetHalf(river)
  assert.equal(wet, 19.5)
  // flat floodplain just above the water: the riparian band is as wide as it gets
  const h = new Float32Array(cols * rows).fill(1)
  const patches = riparianBands(h, g, [river], { seed: 3, cover: 1 })
  assert.ok(patches.length > 0)
  let inner = Infinity
  for (const p of patches) for (let i = 1; i < p.pts.length; i += 2) inner = Math.min(inner, Math.abs(p.pts[i] - 300))
  assert.ok(inner >= wet, `riparian point ${inner.toFixed(1)} m from the centre, water to ${wet} m`)
  // scatter / field trees / rocks use the corridor: < 0 inside the shown water
  const rc = riverCorridor(g, [river])
  const k = Math.round(300 / step + 4) * cols + 50 // 16 m off the centre: past the traced edge (15), inside the water
  assert.ok(rc.dist[k] < 0, `corridor at 16 m: ${rc.dist[k]}`)
})

test('river spline width capped (picture 119: a 152 m wide spline showed as a dark sheet)', () => {
  assert.equal(riverSentWidth({ width: 117 }), RIVER_MAX_SENT_WIDTH)
  assert.equal(riverSentWidth({ width: 74 }), 96)
  const h = new Array(cols * rows).fill(1)
  const wide: Water = { ...river, width: 117 }
  const [s] = waterShapes([wide], h, h, g)
  assert.equal(s.paramValues?.[0], String(RIVER_MAX_SENT_WIDTH))
  assert.ok(riverWetHalf(wide) >= 117 / 2, 'the traced width stays clear of trees')
})

test('road shoulders and dirt tracks paint a light dirt excess, not a full band', () => {
  const m = roadMasks([{ id: 'A', type: 'asphaltNarrow', pts: [0, 50, 100, 50] }, { id: 'D', type: 'dirt', pts: [0, 20, 100, 20] }] as never)
  assert.equal(m[0].sidePeak, 0.35)
  assert.equal(m[1].peak, 0.5)
  const L = roadLayers(101, 1, m as never)
  let side = 0
  for (const v of L.get('Dirt_01')!) side = Math.max(side, v)
  assert.ok(side <= 0.5 + 1e-6, `dirt weight ${side}`)
})

test('Arland: no crop / Dirt_02 (absent from vanilla Arland), river bed Pebbles_02 not scree', () => {
  const b = biome('woodland_arland')!
  assert.equal(biomeSurfaceName(b, 'Pebbles_01'), 'Pebbles_02')
  assert.equal(biomeSurfaceName(b, 'Dirt_01'), 'Dirt_01')
  assert.equal(biomeSurfaceName(b, 'Dirt_02'), 'Dirt_01')
  assert.equal(biomeSurfaceName(b, 'Crop_Field_01'), 'Grass_02')
  assert.equal(biomeSurfaceName(b, 'Debris_Rock_01'), 'Debris_Rock_01')
})
