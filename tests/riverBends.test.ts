import { test } from 'node:test'
import assert from 'node:assert/strict'
import { easeBends, turns, waterShapes, type Water } from '../src/modules/water'

test('easeBends: a hairpin every 26 m is eased to the minimum radius, ends kept', () => {
  const p: number[] = []
  for (let i = 0; i < 30; i++) { const a = i * 0.5; p.push(Math.cos(a) * 52, Math.sin(a) * 52 + i * 4) } // 26 m legs, 29 deg turns
  const r = easeBends(p, 87)
  assert.deepEqual(r.slice(0, 2), p.slice(0, 2))
  assert.deepEqual(r.slice(-2), p.slice(-2))
  const before = Math.max(...turns(p)), after = Math.max(...turns(r))
  assert.ok(before > 0.45 && after < before / 2, `${before} -> ${after}`)
})

test('waterShapes: a wide river is sent without turns tighter than its width allows', () => {
  const g = { minX: 0, minZ: 0, step: 4, cols: 200, rows: 200 }
  const hs = new Float32Array(200 * 200).fill(5)
  const pts: number[] = []
  for (let i = 0; i < 40; i++) pts.push(100 + i * 15, 400 + (i % 4 < 2 ? 0 : 30))
  const w: Water = { id: 'R', type: 'river', pts, width: 100, depth: 2.5, carve: false, wetEdge: true }
  const [s] = waterShapes([w], hs, hs, g)
  for (const t of turns(s.points)) assert.ok(t < 0.45, String(t))
})
