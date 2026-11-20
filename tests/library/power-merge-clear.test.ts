// mergePowerLines: the tie / cut-end poles of a merged piece move off a building when a check is given
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mergePowerLines } from '../../src/modules/power'

test('merged piece ends avoid a house', () => {
  const a = { id: 'A', kind: 'lv' as const, path: [0, 0, 300, 0], poles: [0, 0, 300, 0], length: 300 }
  const b = { id: 'B', kind: 'lv' as const, path: [0, 5, 150, 5, 150, 200], poles: [0, 5, 150, 5, 150, 200], length: 345 }
  const house = (x: number, z: number) => x > 145 && x < 155 && z > -5 && z < 8 // over the branch point
  const free = (x: number, z: number) => !house(x, z)
  const plain = mergePowerLines([a, b])
  const hit = plain.some((l) => { for (let i = 0; i < l.path.length; i += 2) if (house(l.path[i], l.path[i + 1])) return true; return false })
  assert.ok(hit, 'the plain merge puts a pole in the house (test set-up)')
  const m = mergePowerLines([a, b], 15, free)
  for (const l of m.filter((l) => l.id !== 'A'))
    for (const i of [0, 1, l.path.length / 2 - 2, l.path.length / 2 - 1]) assert.ok(free(l.path[i * 2], l.path[i * 2 + 1]), `${l.id} pole ${i}`)
})
