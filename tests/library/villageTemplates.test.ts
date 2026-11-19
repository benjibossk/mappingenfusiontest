import { test } from 'node:test'
import assert from 'node:assert/strict'
import { VILLAGE_TEMPLATES, pickTemplate, polyLength, stampTemplate } from '../../src/modules/villageTemplates'
import { pickArchetype, yawJitter } from '../../src/modules/village'

test('village templates: loaded, normalised to their road', () => {
  assert.ok(VILLAGE_TEMPLATES.length >= 5)
  for (const t of VILLAGE_TEMPLATES) {
    assert.ok(t.houses.length >= 6)
    assert.equal(Math.min(...t.houses.map((h) => h.s)), 0)
    for (const h of t.houses) assert.ok(Math.abs(h.off) < 45)
  }
})

test('stampTemplate follows a straight road: offsets and relative yaw kept, mirror swaps sides', () => {
  const t = VILLAGE_TEMPLATES[0]
  const pts = [0, 0, 0, 1000] // road heading +Z (0 deg): offset side n = (-1, 0)
  assert.equal(polyLength(pts), 1000)
  const st = stampTemplate(t, pts, { start: 100 })
  assert.equal(st.length, t.houses.length)
  st.forEach((h, i) => {
    assert.ok(Math.abs(h.x + t.houses[i].off) < 1e-6)
    assert.ok(Math.abs(h.z - 100 - t.houses[i].s) < 1e-6)
    assert.equal(h.yaw, Math.round(t.houses[i].rel))
  })
  const mi = stampTemplate(t, pts, { start: 100, mirror: true })
  mi.forEach((h, i) => assert.ok(Math.abs(h.x - t.houses[i].off) < 1e-6))
  // too short a road drops the houses past its end
  assert.ok(stampTemplate(t, [0, 0, 0, 30], { start: 0 }).length < t.houses.length)
})

test('archetype mix and yaw jitter match the Bohemia measures', () => {
  const N = 4000
  const a = { street: 0, crossroads: 0, nucleated: 0 }
  const j: number[] = []
  let seed = 7
  const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  for (let i = 0; i < N; i++) { a[pickArchetype(r())]++; j.push(Math.abs(yawJitter(r(), r()))) }
  assert.ok(a.nucleated / N > 0.55 && a.street / N < 0.2)
  j.sort((x, y) => x - y)
  assert.ok(j[N / 2] > 0.3 && j[N / 2] < 3, `median ${j[N / 2]}`)
  assert.ok(j[Math.floor(N * 0.9)] > 3 && j[Math.floor(N * 0.9)] <= 15)
  assert.ok(pickTemplate('nucleated', 0.3).arch === 'nucleated')
})
