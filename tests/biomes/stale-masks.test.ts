import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeMasks } from '../../bridge/terrain-masks.mjs'

// a surface painted by the previous export and absent now gets an all-zero mask (else the importer keeps it)
test('writeMasks clears the surfaces of the previous export', () => {
  const dir = mkdtempSync(join(tmpdir(), 'stale-'))
  try {
    const s = (name: string) => ({ name, minX: 0, minZ: 0, step: 10, cols: 3, rows: 3, weights: Array(9).fill(0.5) })
    const a = writeMasks(dir, 9, 20, [s('Grass_01'), s('ForestDeciduous_01_Base')])
    assert.equal((a as { cleared?: string[] }).cleared, undefined)
    const b = writeMasks(dir, 9, 20, [s('Grass_01')]) as { written: string[]; cleared?: string[] }
    assert.deepEqual(b.written, ['Grass_01'])
    assert.deepEqual(b.cleared, ['ForestDeciduous_01_Base'])
    assert.ok(existsSync(join(dir, 'ForestDeciduous_01_Base.png')))
    // still remembered on the next export, even once its file is gone
    const c = writeMasks(dir, 9, 20, [s('Grass_01')]) as { cleared?: string[] }
    assert.deepEqual(c.cleared, ['ForestDeciduous_01_Base'])
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
