import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BIOME_CLASSES, CLIMATE_BIOME_IDS, EXCLUDED, autoCalibrate, classifyGround, computeDerivatives, enforceBlockBudget, importReadme, layerShares, mergeByTexture, proposeTextures } from '../../src/biomes/groundClasses.ts'
import { renderIngameMap } from '../../src/modules/ingameMap.ts'

// 64x64 island: sea at the west edge, a cone mountain (to 2600 m) in the middle, step 20 m
const cols = 64, rows = 64, step = 20
const h = new Float32Array(cols * rows)
for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
  const d = Math.hypot(c - 40, r - 32)
  h[r * cols + c] = c < 4 ? -5 : Math.max(1, 2600 - d * 110)
}
const d = computeDerivatives(h, cols, rows, step, 0)

test('derivatives: sea, coast distance, sun on south face, ridge tpi', () => {
  assert.equal(d.land[10 * cols + 0], 0)
  assert.equal(d.coast[0], 0)
  assert.ok(Math.abs(d.coast[10 * cols + 10] - 7 * step) < 1)
  // south of the summit (row < 32) the slope rises toward north => sunny
  assert.ok(d.sun[22 * cols + 40] > 0.6, `sun south ${d.sun[22 * cols + 40]}`)
  assert.ok(d.sun[42 * cols + 40] < 0.4)
  assert.ok(d.tpi[32 * cols + 40] > 0)
  for (const a of [d.flow, d.wet]) for (const v of a) assert.ok(v >= 0 && v <= 1)
})

test('every biome classifies all land cells into its own classes', () => {
  for (const b of CLIMATE_BIOME_IDS) {
    const g = classifyGround(b, d, autoCalibrate(b, d))
    const n = BIOME_CLASSES[b].length
    for (const v of g) assert.ok(v < n, `${b}: ${v}`)
    assert.equal(g[10 * cols], 0, 'sea')
  }
})

test('alpine: snow on the summit, auto-calibrated snow line below the top', () => {
  const s = autoCalibrate('montagnard', d)
  assert.ok(s.snowLine < 2600 && s.treeLine < s.snowLine)
  const g = classifyGround('montagnard', d, s)
  const ids = BIOME_CLASSES.montagnard.map(c => c.id)
  assert.equal(ids[g[32 * cols + 40]], 'neige')
})

test('exclusion mask keeps cells', () => {
  const ex = new Uint8Array(cols * rows); ex[5] = 1
  assert.equal(classifyGround('tempere', d, undefined, ex)[5], EXCLUDED)
})

test('textures: proposal, missing flag, merge, budget, readme', () => {
  const tex = ['SeaBed_01', 'Grass_01', 'Forest_Floor_01', 'Debris_Rock_01', 'Sand_Beach_01']
  const a = proposeTextures('montagnard', tex)
  const ids = BIOME_CLASSES.montagnard.map(c => c.id)
  assert.equal(a[ids.indexOf('neige')].texture, null)
  assert.equal(a[ids.indexOf('mer')].texture, 'SeaBed_01')
  const g = classifyGround('montagnard', d, autoCalibrate('montagnard', d))
  const { layers, layerGrid } = mergeByTexture('montagnard', g, a)
  assert.ok(layers.length < ids.length, 'classes sharing a texture merged')
  assert.match(layers[0].file, /^01_mer__SeaBed_01\.png$/)
  assert.ok(layers.some(l => /__manquant\.png$/.test(l.file)))
  enforceBlockBudget(layerGrid, cols, rows, 16, 2)
  for (let br = 0; br < rows; br += 16) for (let bc = 0; bc < cols; bc += 16) {
    const s = new Set<number>(); for (let r = br; r < br + 16; r++) for (let c = bc; c < bc + 16; c++) s.add(layerGrid[r * cols + c])
    assert.ok(s.size <= 2)
  }
  layerShares(layerGrid, layers)
  assert.ok(Math.abs(layers.reduce((x, l) => x + l.share, 0) - 1) < 1e-9)
  const txt = importReadme('montagnard', layers)
  assert.match(txt, /=== FR ===/); assert.match(txt, /MANQUANT/); assert.match(txt, /MISSING/)
})

test('in-game map slope shading is opt-in', () => {
  const grid = { minX: 0, minZ: 0, step, cols, rows, heights: h }
  const base = renderIngameMap({ grid, seaLevel: 0, width: 64, height: 64 })
  const shaded = renderIngameMap({ grid, seaLevel: 0, width: 64, height: 64, slopeShadeDeg: 30 })
  let diff = 0; for (let i = 0; i < base.data.length; i++) if (base.data[i] !== shaded.data[i]) diff++
  assert.ok(diff > 0)
  const again = renderIngameMap({ grid, seaLevel: 0, width: 64, height: 64 })
  assert.deepEqual(again.data, base.data)
})
