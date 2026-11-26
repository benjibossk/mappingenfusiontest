import { test } from 'node:test'
import assert from 'node:assert/strict'
import { villageWalls } from '../src/modules/roundabouts'
import type { Road } from '../src/modules/roads'

test('villageWalls: no wall point under 0.5 m from the previous one on the inside of a tight bend (119 WALL_R0 lost a point)', () => {
  const pts: number[] = []
  for (let i = 0; i <= 10; i++) pts.push(i * 10, 0)
  for (let i = 1; i <= 8; i++) { const a = (i / 8) * Math.PI / 2; pts.push(100 + Math.sin(a) * 6, 6 - Math.cos(a) * 6) }
  for (let i = 1; i <= 10; i++) pts.push(106, 6 + i * 10)
  const road: Road = { id: 'R', type: 'asphaltNarrow', pts }
  const walls = villageWalls([road], () => true)
  assert.ok(walls.length >= 2)
  for (const w of walls) for (let i = 2; i < w.points.length; i += 2) {
    const d = Math.hypot(w.points[i] - w.points[i - 2], w.points[i + 1] - w.points[i - 1])
    assert.ok(d >= 0.5, `${w.id} point ${i / 2}: ${d.toFixed(2)} m`)
  }
})
