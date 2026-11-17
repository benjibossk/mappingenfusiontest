import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generateWorld, WORLD_DEFAULTS } from '../../src/modules/worldgen.ts'
import { computeSurfaces, generateIsland, limitPerBlock, overfullBlocks, type SurfaceGrid } from '../../src/modules/island.ts'

// R3 (RECETTE.md): the Workbench refuses a 64 m block painted by more than 5 surfaces
test('R3: random islands (Relief > Generate) never overfill a block, 2048/4096, seeds 1-8', () => {
  const bad: string[] = []
  for (const size of [2048, 4096]) for (const step of [2, 4]) for (let seed = 1; seed <= 8; seed++) {
    const isl = generateIsland({ size, step, maxHeight: 300, seaDepth: 40, landRatio: 0.5, roughness: 0.6, seed, islands: 1 + (seed % 3) })
    const n = overfullBlocks(isl.surfaces)
    if (n) bad.push(`${size}/${step}/${seed}: ${n}`)
    // with a noisy land cover on top (forests / fields cut into many small pieces)
    const cover = new Uint8Array(isl.heights.length)
    for (let i = 0; i < cover.length; i++) cover[i] = ((i * 2654435761) >>> 28) % 4
    const m = overfullBlocks(computeSurfaces(isl.grid, isl.heights, 300, undefined, cover))
    if (m) bad.push(`${size}/${step}/${seed}+cover: ${m}`)
  }
  assert.deepEqual(bad, [])
})

test('R3: limitPerBlock on random per-cell noise leaves 0 overfull blocks and keeps the weight', () => {
  for (let seed = 1; seed <= 5; seed++) {
    let s = seed
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647)
    const grid = { minX: 0, minZ: 0, step: 8, cols: 129, rows: 129 }
    const out: SurfaceGrid[] = Array.from({ length: 10 }, (_, k) => ({ ...grid, name: 'S' + k, weights: new Array(129 * 129).fill(0) }))
    for (let i = 0; i < 129 * 129; i++) { const a = Math.floor(rnd() * 10), b = Math.floor(rnd() * 10); out[a].weights[i] += 0.6; out[b].weights[i] += 0.4 }
    limitPerBlock(out)
    assert.equal(overfullBlocks(out), 0)
    for (let i = 0; i < 129 * 129; i += 97) assert.ok(Math.abs(out.reduce((t, o) => t + o.weights[i], 0) - 1) < 1e-9)
  }
})

test('R3: random worlds (worldgen step 11) never overfill a block', async () => {
  const bad: string[] = []
  for (const size of [2048, 4096]) for (const seed of [1, 42]) {
    const w = await generateWorld({ ...WORLD_DEFAULTS, size, seed })
    const n = overfullBlocks(w.surfaces)
    if (n) bad.push(`${size}/${seed}: ${n}`)
  }
  assert.deepEqual(bad, [])
})
