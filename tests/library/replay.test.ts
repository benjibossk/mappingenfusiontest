import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generateWorld, WORLD_DEFAULTS, type WorldParams } from '../../src/modules/worldgen.ts'
import { emptyPipeline, hashOf, hashWorld, readPipeline, recordStep, replayPipeline, sameHash, stageTimer } from '../../src/modules/replay.ts'

test('hashOf: stable over key order, sensitive to values', () => {
  assert.equal(hashOf({ a: 1, b: [1, 2] }), hashOf({ b: [1, 2], a: 1 }))
  assert.notEqual(hashOf({ a: 1 }), hashOf({ a: 2 }))
  assert.equal(hashOf(new Float32Array([1, 2])), hashOf([1, 2]))
})

test('recordStep: a from-scratch step replaces the pipeline, a dependent one appends', () => {
  let p = recordStep(emptyPipeline(), { id: 'world', params: {}, seed: 1, inputs: [] })
  p = recordStep(p, { id: 'edit', params: {}, seed: 1, inputs: ['world'] })
  assert.equal(p.steps.length, 2)
  p = recordStep(p, { id: 'world', params: {}, seed: 2, inputs: [] })
  assert.deepEqual(p.steps.map((s) => s.seed), [2])
  assert.equal(readPipeline(JSON.parse(JSON.stringify(p))).steps[0].seed, 2)
  assert.equal(readPipeline({ steps: [null, { id: 3 }] }).steps.length, 0)
})

test('stageTimer: per-stage durations', () => {
  let t = 0
  const tm = stageTimer(() => t)
  tm.tick('relief'); t = 10; tm.tick('relief'); t = 15; tm.tick('roads'); t = 40
  assert.deepEqual(tm.end(), { relief: 15, roads: 25 })
})

test('replay: same project replayed gives identical output hashes', async () => {
  const params: WorldParams = { ...WORLD_DEFAULTS, size: 2048, seed: 4242 }
  const first = hashWorld(await generateWorld(params))
  const p = recordStep(emptyPipeline(), { id: 'world', params: { ...params }, seed: params.seed, inputs: [], hash: first })
  const saved = readPipeline(JSON.parse(JSON.stringify(p))) // through the project file
  const rep = await replayPipeline(saved, async (s) => hashWorld(await generateWorld({ ...(s.params as unknown as WorldParams), seed: s.seed })))
  assert.ok(rep)
  assert.equal(rep.length, 1)
  assert.equal(rep[0].same, true)
  assert.deepEqual(rep[0].hash, first)
  const other = hashWorld(await generateWorld({ ...params, seed: 4243 }))
  assert.equal(sameHash(first, other), false)
})
