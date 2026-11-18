import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateInput, validateOutput, toContractInput, budgetReport, toMasksPayload, CONTRACT_VERSION, type ContractOutput } from '../../src/contract/schema.ts'

const hm = { minX: 0, minZ: 0, step: 2, cols: 2, rows: 2, heights: [0, 1, 2, 3] }

test('toContractInput maps project shapes and validates', () => {
  const inp = toContractInput({ version: 0, shapes: [
    { id: 'a', kind: 'spline', closed: true, points: [0, 0, 10, 0, 10, 10], generator: '{1F2254A7C9C8AA57}Prefabs/WEGenerators/Water/Lake/LG_Lake_01.et', lift: [3] },
    { id: 'b', kind: 'spline', closed: false, points: [0, 0, 50, 50], generator: '{X}Prefabs/WEGenerators/Roads/RG_Asphalt.et', paramKeys: ['RoadWidth'], paramValues: ['8'] },
  ] }, { heightmap: hm, biome: 'temperate' })
  assert.equal(inp.water.lakes[0].level, 3)
  assert.deepEqual(inp.roads[0], { points: [0, 0, 50, 50], type: 'RG_Asphalt', width: 8 })
  assert.deepEqual(validateInput(inp), { ok: true, errors: [] })
})

test('validateInput reports bad fields', () => {
  const r = validateInput({ version: 2, heightmap: { ...hm, heights: [1] }, water: {}, roads: [], zones: [], biome: '', budget: { maxMaterials: 0, maxPerBlock: 1 } })
  assert.equal(r.ok, false)
  for (const s of ['version', 'heightmap.heights', 'water.seaLevel', 'water.lakes', 'biome', 'budget.maxMaterials'])
    assert.ok(r.errors.some((e) => e.startsWith(s)), s)
})

test('output validation, budget report, masks payload', () => {
  const masks = [
    { name: 'grass', ...hm, weights: [1, 1, 0, 0] },
    { name: 'rock', ...hm, weights: [0, 0, 1, 0.5] },
    { name: 'mud', ...hm, weights: [0, 0, 0, 0] },
  ].map(({ heights, ...m }) => m)
  const b = budgetReport(masks, { maxMaterials: 4, maxPerBlock: 1 })
  assert.deepEqual(b, { materialsUsed: 2, maxPerBlockSeen: 2, overBlocks: [0], ok: false })
  const out: ContractOutput = { version: CONTRACT_VERSION, masks, vegetation: [{ points: [0, 0, 1, 0, 1, 1], generator: 'forest' }], budget: b }
  assert.equal(validateOutput(out).ok, true)
  assert.equal(toMasksPayload(out)[1].name, 'rock')
  assert.equal(validateOutput({ ...out, masks: [masks[0], masks[0]] }).ok, false)
})
