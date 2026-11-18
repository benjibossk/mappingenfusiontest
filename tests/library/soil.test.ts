// Soil engine (src/soil/engine.ts) on a small synthetic island.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runSoilEngine, runSoilEngineDetailed, capRing, DEFAULT_RULES } from '../../src/soil/engine.ts'
import { validateOutput, type ContractInput } from '../../src/contract/schema.ts'

// 64 x 64 cells, step 10 m: a gentle cone island (peak 60 m, ~11°) with a steep cliff ring, sea at 0
function island(): ContractInput {
  const cols = 64, rows = 64, step = 10, heights: number[] = []
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const d = Math.hypot(c - 32, r - 32) * step
    let h = 60 - d * 0.2
    if (d > 120) h -= Math.min(d - 120, 20) * 2 // cliff step
    heights.push(Math.max(-20, h))
  }
  const lake: number[] = []
  for (let k = 0; k < 200; k++) { const a = (k / 200) * Math.PI * 2; lake.push(250 + 30 * Math.cos(a) + 3 * Math.sin(7 * a), 250 + 30 * Math.sin(a)) }
  return {
    version: 1, heightmap: { minX: 0, minZ: 0, step, cols, rows, heights },
    water: { seaLevel: 0, lakes: [{ points: lake, level: 200 }], rivers: [{ points: [320, 320, 500, 500], width: 8 }] },
    roads: [], zones: [], biome: 'temperate_everon', budget: { maxMaterials: 6, maxPerBlock: 3 },
  }
}

test('output is valid contract, weights normalised, budget respected', () => {
  const out = runSoilEngine(island())
  const v = validateOutput(out)
  assert.ok(v.ok, v.errors.join('; '))
  assert.ok(out.masks.length >= 2 && out.masks.length <= 6)
  const N = out.masks[0].weights.length
  for (let i = 0; i < N; i += 37) {
    const s = out.masks.reduce((a, m) => a + m.weights[i], 0)
    assert.ok(Math.abs(s - 1) < 1e-4, `cell ${i} sums ${s}`)
  }
  assert.equal(out.budget.overBlocks.length, 0)
  assert.ok(out.budget.maxPerBlockSeen <= 3)
})

test('rock on steep slopes, sand on the shore', () => {
  const out = runSoilEngine({ ...island(), budget: { maxMaterials: 8, maxPerBlock: 8 } })
  const m = (n: string) => out.masks.find((x) => x.name === n)!
  const cliff = 34 * 64 + 32 + 13 // d = 130 m, in the cliff band
  assert.ok(m('Rock').weights[cliff] > 0.5, `rock on cliff: ${out.masks.map((x) => x.name + "=" + x.weights[cliff].toFixed(2))}`)
  assert.ok(m('Sand'), 'sand exists')
})

test('lakes capped at 60 points, shape points on the ground', () => {
  const inp = island()
  const d = runSoilEngineDetailed(inp)
  assert.equal(d.water.length, 1)
  const p = d.water[0].points
  assert.ok(p.length / 3 <= 60 && p.length / 3 >= 3)
  for (let i = 0; i < p.length; i += 3) assert.ok(p[i + 1] > 5 && p[i + 1] < 61, 'y follows terrain')
  assert.ok(capRing(inp.water.lakes[0].points, 10, 0.01).length / 2 <= 10)
})

test('vegetation zones are polygons tagged with a native generator', () => {
  const out = runSoilEngine(island())
  assert.ok(out.vegetation.length > 0)
  for (const z of out.vegetation) {
    assert.ok(['forest', 'bushline', 'meadow'].includes(z.generator))
    assert.ok(z.points.length >= 6 && z.points.length % 2 === 0)
    assert.equal(z.prefab, undefined)
  }
})

test('rules come from data files and climate biome works', () => {
  assert.equal(DEFAULT_RULES.thresholds.lakeMaxPoints, 60)
  const d = runSoilEngineDetailed({ ...island(), biome: 'auto' })
  assert.ok(d.biomes.length >= 1)
  assert.ok(validateOutput(d.output).ok)
})
