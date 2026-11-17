// Module assembly (src/modules/modules.ts): constraint solver + military camp + scrapyard
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { inPoly, rectAt } from '../../src/modules/rowgrid.ts'
import { CAMP_PREFABS, FACTIONS, makeCamp, makeJunkyard, MOD_PREFABS, rectsOverlap, solveModules, type ModuleCell } from '../../src/modules/modules.ts'
import { makeSiteZone } from '../../src/modules/sitezones.ts'

const sq = (r: number, cx = 0, cz = 0) => [cx - r, cz - r, cx + r, cz - r, cx + r, cz + r, cx - r, cz + r]
const road = { pts: [-400, -130, 400, -130], half: 3 } // south of the zone, along X
const ctx = (seed: number, faction?: 'US' | 'USSR' | 'FIA') => ({ id: 'S', seed, roads: [road], ground: () => 50, maxSlope: 0.15, faction })
const cheb = (a: ModuleCell, b: ModuleCell) => Math.max(Math.abs(a.i - b.i), Math.abs(a.j - b.j))
const GUID = /^\{[0-9A-F]{16}\}(Prefabs|PrefabLibrary)\//
const solidRoles = new Set(['pave', 'lot', 'roof'])

test('solver: apart rule, min / max counts, fixed cells, deterministic', () => {
  const cells: ModuleCell[] = []
  for (let j = 0; j < 6; j++) for (let i = 0; i < 6; i++) cells.push({ i, j, x: i, z: j, corner: false })
  const spec = { labels: ['a', 'b', 'c', 'e'], weight: [5, 1, 1, 0.1], apart: [[1, 0, 1]] as [number, number, number][], min: [0, 2, 1, 0], max: [99, 3, 1, 99], fixed: new Map([[0, 2]]), fallback: 3 }
  let s = 7
  const r = () => { s = (s * 16807) % 2147483647; return s / 2147483647 }
  const sol = solveModules(cells, spec, r)
  assert.equal(sol.relaxed, false)
  assert.equal(sol.label[0], 2)
  const cnt = (l: number) => sol.label.filter((x) => x === l).length
  assert.ok(cnt(1) >= 2 && cnt(1) <= 3); assert.equal(cnt(2), 1)
  for (let p = 0; p < 36; p++) for (let q = 0; q < 36; q++) if (sol.label[p] === 1 && sol.label[q] === 0) assert.ok(cheb(cells[p], cells[q]) > 1)
  s = 7
  assert.deepEqual(solveModules(cells, spec, r).label, sol.label)
})

for (const fac of FACTIONS) test(`camp ${fac}: modules obey the rules, inside, no overlap, gate on the road side`, () => {
  const poly = sq(110)
  const m = makeCamp(poly, ctx(4, fac))
  const by = (l: string) => m.plan.filter((p) => p.label === l)
  assert.equal(by('hq').length, 1); assert.ok(by('motor').length >= 1); assert.ok(by('ammo').length >= 1); assert.ok(by('tent').length >= 4)
  assert.ok(by('heli').length === 4, 'big camp gets a helipad')
  for (const a of by('ammo')) for (const t of [...by('tent'), ...by('hq')]) assert.ok(cheb(a.cell, t.cell) > 1, 'ammo away from tents / HQ')
  for (const t of by('tower')) assert.ok(t.cell.corner)
  const gate = m.plan.find((p) => p.label === 'lane' && p.cell.j === Math.min(...m.plan.map((q) => q.cell.j)))!
  for (const mp of by('motor')) assert.ok(cheb(mp.cell, gate.cell) <= 1, 'motor pool by the gate')
  const ds = m.plan.map((p) => Math.hypot(p.cell.x, p.cell.z)).sort((a, b) => a - b)
  assert.ok(Math.hypot(by('hq')[0].cell.x, by('hq')[0].cell.z) <= ds[Math.floor(ds.length / 2)], 'HQ central')
  // gate faces the road
  assert.ok(m.gate && m.gate[1] < -100, `gate ${m.gate}`)
  const bar = m.entities.find((e) => e.prefab === MOD_PREFABS.barGate)!
  assert.ok(bar && bar.z < -100)
  const wall = m.shapes.find((s) => s.generator === CAMP_PREFABS[fac].wall)!
  assert.equal(wall.closed, false)
  for (const e of m.entities) { assert.ok(inPoly(poly, e.x, e.z), e.prefab); assert.match(e.prefab, GUID) }
  for (const s of m.shapes) assert.match(s.generator, GUID)
  const solid = m.boxes.filter((b) => !solidRoles.has(b.role))
  for (const b of solid) for (let i = 0; i < 8; i += 2) assert.ok(inPoly(poly, b.corners[i], b.corners[i + 1]))
  for (let a = 0; a < solid.length; a++) for (let b = a + 1; b < solid.length; b++) assert.ok(!rectsOverlap(solid[a].corners, solid[b].corners), `${solid[a].role}/${solid[b].role}`)
  assert.ok(m.entities.some((e) => e.prefab === CAMP_PREFABS[fac].tent) && m.entities.some((e) => e.prefab === CAMP_PREFABS[fac].heli))
})

test('camp + junkyard: deterministic by seed, different seeds differ', () => {
  const a = makeCamp(sq(90), ctx(9, 'USSR')), b = makeCamp(sq(90), ctx(9, 'USSR')), c = makeCamp(sq(90), ctx(10, 'USSR'))
  assert.deepEqual(a.entities, b.entities)
  assert.notDeepEqual(a.plan.map((p) => p.label), c.plan.map((p) => p.label))
  assert.deepEqual(makeJunkyard(sq(60), ctx(3)).entities, makeJunkyard(sq(60), ctx(3)).entities)
})

test('junkyard: lanes from the gate, office by the gate, one workshop, wrecks, inside, no overlap', () => {
  const poly = [-70, -60, 70, -60, 60, 60, -60, 70] // irregular quad
  const m = makeJunkyard(poly, ctx(5))
  const by = (l: string) => m.plan.filter((p) => p.label === l)
  const gate = by('lane').sort((p, q) => p.cell.j - q.cell.j)[0]
  assert.equal(by('office').length, 1); assert.ok(cheb(by('office')[0].cell, gate.cell) <= 1)
  assert.ok(by('shed').length >= 1); assert.ok(by('wrecks').length >= 4); assert.ok(by('lane').length >= 4)
  for (const t of by('tyres')) assert.ok(cheb(t.cell, by('office')[0].cell) > 1)
  assert.ok(m.gate && m.gate[1] < -50)
  for (const e of m.entities) assert.ok(inPoly(poly, e.x, e.z))
  const solid = m.boxes.filter((b) => !solidRoles.has(b.role))
  for (let a = 0; a < solid.length; a++) for (let b = a + 1; b < solid.length; b++) assert.ok(!rectsOverlap(solid[a].corners, solid[b].corners))
  assert.ok(m.entities.filter((e) => (MOD_PREFABS.wrecks as readonly string[]).includes(e.prefab)).length > 15)
})

test('modules respect roads, water and slope; site zone wraps them', () => {
  const cross = { pts: [0, -200, 0, 200], half: 4 }
  const m = makeCamp(sq(90), { ...ctx(2, 'US'), roads: [road, cross], ok: (x: number) => x < 60 })
  for (const p of m.plan) { assert.ok(Math.abs(p.cell.x) > 4 + 2 + 8 - 1e-6); assert.ok(p.cell.x + 8 < 60 + 1e-6) }
  const steep = makeJunkyard(sq(60), { ...ctx(1), ground: (x: number) => x * 0.5 })
  assert.equal(steep.plan.length, 0); assert.ok(steep.warnings.length)
  const z = makeSiteZone('camp', sq(80), { id: 'SITE_1', seed: 1, roads: [road], ground: () => 50, faction: 'FIA' })
  assert.equal(z.sub, 'camp'); assert.ok(z.entities.length > 20)
  const r = rectAt(0, 0, 0, 2, 2); assert.ok(rectsOverlap(r, rectAt(1, 1, 30, 2, 2)) && !rectsOverlap(r, rectAt(5, 0, 0, 2, 2)))
})
