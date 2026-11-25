// Airfield generator: every kind / size generates, geometry rules (strip, 1:7, separations), known prefabs, determinism
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  generateAirfield, suggestAirfield, parseAirfieldSub, runwayNumber, AIRFIELD_SPECS, AIRFIELD_KINDS, AIR_KNOWN_PREFABS, TRANSITION_SLOPE,
  type AirfieldKind, type AirfieldSize,
} from '../src/modules/airfield'

const SIZES: AirfieldSize[] = ['small', 'medium', 'large']
const all = () => AIRFIELD_KINDS.flatMap((kind) => SIZES.map((size) => ({ kind, size })))
const gen = (kind: AirfieldKind, size: AirfieldSize, seed: number | string = 7, yaw = 35) => generateAirfield({ kind, size, x: 3000, z: 3000, yaw, seed })
const FLAT = new Set(['light', 'marker', 'mark'])

test('every kind and size generates a runway, buildings and an access point', () => {
  for (const { kind, size } of all()) {
    const a = gen(kind, size)
    assert.ok(a.placements.length > 5, `${kind}-${size} placements`)
    assert.ok(a.placements.some((p) => !FLAT.has(p.role)), `${kind}-${size} has buildings`)
    assert.ok(a.access.every(Number.isFinite), `${kind}-${size} access`)
    assert.equal(a.flatten.length, 2)
    if (a.surface === 'grass') assert.ok(!a.shapes.some((s) => s.id.endsWith('-rwy')), 'grass strip: no runway spline')
    else assert.ok(a.shapes.some((s) => s.id.endsWith('-rwy')), `${kind}-${size} runway spline`)
  }
})

test('nothing but flat items in the runway strip, and everything under the 1:7 transition surface', () => {
  for (const { kind, size } of all()) for (const seed of [1, 2, 3]) {
    const a = gen(kind, size, seed), sh = a.spec.stripHalf
    for (const l of a.local) {
      if (FLAT.has(l.role)) continue
      const inner = Math.abs(l.t) - l.ht
      assert.ok(inner >= sh, `${kind}-${size} ${l.role} at ${inner.toFixed(1)} m inside the strip ${sh}`)
      assert.ok(l.h <= (inner - sh) * TRANSITION_SLOPE + 1e-6, `${kind}-${size} ${l.role} h ${l.h} breaks 1:7 at ${inner}`)
    }
  }
})

test('military: taxiway 120-180 m from the axis, tower 200-400 m, fuel depot >= 50 m from other buildings, shelters and a fence', () => {
  for (const size of SIZES) {
    const a = gen('military', size)
    assert.ok(a.spec.taxiOff >= 120 && a.spec.taxiOff <= 180)
    const tw = a.local.find((l) => l.role === 'tower_ctrl')!
    assert.ok(Math.abs(tw.t) >= 200 && Math.abs(tw.t) <= 400, `tower at ${tw.t}`)
    assert.ok(a.local.filter((l) => l.role === 'shelter').length >= 2, 'shelters')
    assert.ok(a.shapes.some((s) => s.id.endsWith('-fence')), 'fence')
    assert.ok(a.local.some((l) => l.role === 'gate'), 'gate')
    const fuel = a.local.filter((l) => l.role === 'fuel'), fs = fuel.map((f) => f.s), ft = fuel.map((f) => Math.abs(f.t))
    const cs = (Math.min(...fs) + Math.max(...fs)) / 2, ct = (Math.min(...ft) + Math.max(...ft)) / 2
    for (const l of a.local) {
      if (FLAT.has(l.role) || l.role === 'fuel' || l.h < 3 || l.role === 'prop') continue
      const d = Math.max(Math.abs(l.s - cs) - l.hs, Math.abs(Math.abs(l.t) - ct) - l.ht)
      assert.ok(d >= 50, `${size}: ${l.role} ${d.toFixed(0)} m from the fuel depot`)
    }
  }
})

test('buildings do not overlap each other', () => {
  for (const { kind, size } of all()) {
    const b = gen(kind, size).local.filter((l) => !FLAT.has(l.role) && l.h > 3)
    for (let i = 0; i < b.length; i++) for (let j = i + 1; j < b.length; j++) {
      const ov = Math.abs(b[i].s - b[j].s) < b[i].hs + b[j].hs && Math.abs(b[i].t - b[j].t) < b[i].ht + b[j].ht
      assert.ok(!ov, `${kind}-${size}: ${b[i].role} overlaps ${b[j].role}`)
    }
  }
})

test('every emitted prefab / generator is in the known (rdb-verified) list, with a GUID, and matches the catalogue', () => {
  const cat = JSON.parse(readFileSync(new URL('../library/prefabs-catalogue.json', import.meta.url), 'utf8')).prefabs as { p: string; g?: string }[]
  const byPath = new Map(cat.map((c) => [c.p.toLowerCase(), c]))
  for (const k of AIR_KNOWN_PREFABS) {
    const m = /^\{([0-9A-F]{16})\}Prefabs\/(.+)$/.exec(k)
    assert.ok(m, `GUID + path: ${k}`)
    const c = byPath.get(m[2].toLowerCase())
    if (c?.g) assert.equal(c.g, m[1], `catalogue GUID for ${k}`)
  }
  for (const { kind, size } of all()) {
    const a = gen(kind, size)
    for (const p of a.placements) assert.ok(AIR_KNOWN_PREFABS.has(p.prefab), p.prefab)
    for (const s of a.shapes) assert.ok(AIR_KNOWN_PREFABS.has(s.generator!), s.generator)
  }
})

test('deterministic by seed', () => {
  for (const { kind, size } of all()) {
    assert.deepEqual(gen(kind, size, 'x1'), gen(kind, size, 'x1'))
    assert.notDeepEqual(gen(kind, size, 'x1').entities, gen(kind, size, 'x2').entities)
  }
})

test('sub parsing (legacy size only = military), runway numbers', () => {
  assert.deepEqual(parseAirfieldSub('medium'), { kind: 'military', size: 'medium' })
  assert.deepEqual(parseAirfieldSub('strip-small'), { kind: 'strip', size: 'small' })
  assert.equal(runwayNumber(0), 36); assert.equal(runwayNumber(92), 9); assert.equal(runwayNumber(272), 27)
})

test('auto suggester picks the type by the flat length available', () => {
  const step = 20, cols = 200, rows = 200, g = { minX: 0, minZ: 0, step, cols, rows }
  // a hilly map with one flat 700 m x 200 m field: too short for a base, fits a small strip / small civil
  const h = new Array(cols * rows).fill(0).map((_, i) => { const x = (i % cols) * step, z = Math.floor(i / cols) * step; return 40 + 25 * Math.sin(x / 90) * Math.cos(z / 110) })
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) { const x = c * step, z = r * step; if (Math.abs(x - 2000) < 120 && Math.abs(z - 2000) < 380) h[r * cols + c] = 50 }
  const s = suggestAirfield(h, g, { size: 'medium', kind: 'auto', seaLevel: 0, count: 1, step: 100, maxMeanCut: 0.5 })[0]
  assert.ok(s, 'a site')
  assert.ok(AIRFIELD_SPECS[s.kind][s.size].length <= 700, `picked ${s.kind}-${s.size}`)
  assert.ok(Math.hypot(s.x - 2000, s.z - 2000) < 200)
})
