import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mergePowerLines, type PowerLine } from '../../src/modules/power.ts'

const line = (id: string, kind: PowerLine['kind'], path: number[]): PowerLine & { id: string } => ({ id, kind, path, poles: path, length: 0 })

test('two LV lines on one corridor give one pole row, the branch is tied back', () => {
  const a = line('POWER_LV_1', 'lv', [0, 0, 400, 0])
  const b = line('POWER_LV_2', 'lv', [0, 4, 300, 4, 300, 200]) // 4 m beside a for 300 m, then branches north
  const out = mergePowerLines([a, b])
  assert.equal(out.length, 2)
  assert.deepEqual(out[0].path, a.path)
  const p = out[1].path
  assert.ok(Math.abs(p[1]) < 0.01, 'branch starts on the kept line')
  assert.ok(p[0] > 250, 'shared part dropped')
  assert.equal(p[p.length - 1], 200)
})

test('different kinds and distant lines are left alone', () => {
  const out = mergePowerLines([line('POWER_LV_1', 'lv', [0, 0, 400, 0]), line('POWER_HV_1', 'hv', [0, 5, 400, 5]), line('POWER_LV_2', 'lv', [0, 100, 400, 100])])
  assert.equal(out.length, 3)
  assert.deepEqual(out.map((l) => l.id), ['POWER_HV_1', 'POWER_LV_1', 'POWER_LV_2'])
})
