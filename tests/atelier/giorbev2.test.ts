// Atelier — giorbev parity batch 2: EDDS decoder, negligible slots, .topo, Metric Atlas / auto-calibration /
// biome rules, hand-off to the generator. Real files are read when present (READ-ONLY), skipped otherwise.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { blockCoverage, decodeColor, decodeLayer, lz4Chained, slotWeight } from '../../src/atelier/formats/edds.ts'
import { parseTopo, topoToWorld } from '../../src/atelier/formats/topo.ts'
import { negligibleSlots } from '../../src/atelier/diag.ts'
import { atlas, autoCalibrate, biomeRules, classify, metrics, percentile } from '../../src/atelier/terrain.ts'
import { downsample, islandProject, macroOf } from '../../src/atelier/handoff.ts'

const ADDONS = 'C:/Users/benbo/Documents/My Games/ArmaReforgerWorkbench/addons/'

function dds(w: number, h: number, dxgi: number, payload: Uint8Array): Uint8Array {
  const b = new Uint8Array(148 + payload.length), d = new DataView(b.buffer)
  b.set([68, 68, 83, 32]); d.setUint32(12, h, true); d.setUint32(16, w, true); d.setUint32(28, 1, true)
  b.set([68, 88, 49, 48], 84); d.setUint32(128, dxgi, true); b.set(payload, 148)
  return b
}

test('LZ4 chained: literals + overlapping match', () => {
  // "abc" then match offset 3 length 6 → "abcabcabc"; token: 3 literals, match len 6-4=2
  const blk = [0x32, 97, 98, 99, 3, 0], src = new Uint8Array(4 + 4 + blk.length), d = new DataView(src.buffer)
  d.setUint32(0, 9, true); d.setUint32(4, blk.length, true); src.set(blk, 8)
  assert.equal(new TextDecoder().decode(lz4Chained(src)), 'abcabcabc')
})

test('BC1 block decodes its two endpoint colours', () => {
  // c0 = pure red (0xF800), c1 = pure blue (0x001F), indices: pixel 0 → c0, pixel 1 → c1
  const im = decodeColor(dds(4, 4, 71, new Uint8Array([0x00, 0xf8, 0x1f, 0x00, 0b0100, 0, 0, 0])))
  assert.deepEqual([...im.data.slice(0, 4)], [255, 0, 0, 255])
  assert.deepEqual([...im.data.slice(4, 8)], [0, 0, 255, 255])
})

test('BC7 mode 6 solid block', () => {
  // mode 6: bit 6 set; endpoints all 127 (7 bits) + pbits 1 → 255; all indices 0
  const b = new Uint8Array(16); let bit = 0
  const w = (v: number, n: number) => { for (let i = 0; i < n; i++, bit++) if ((v >> i) & 1) b[bit >> 3] |= 1 << (bit & 7) }
  w(1 << 6, 7); for (let i = 0; i < 8; i++) w(127, 7); w(1, 1); w(1, 1)
  const im = decodeColor(dds(4, 4, 98, b))
  assert.deepEqual([...im.data.slice(0, 4)], [255, 255, 255, 255])
})

test('layer weights: 6 × 5-bit slots + implicit base, negligible slots', () => {
  const p = 10 | (21 << 5) // slot1 = 10, slot2 = 21 → base 0
  assert.equal(slotWeight(p, 1), 10); assert.equal(slotWeight(p, 2), 21); assert.equal(slotWeight(p, 0), 0); assert.equal(slotWeight(0, 0), 31)
  assert.equal(negligibleSlots([4096, 8, 2000], 4096, 0.01), 1)
})

const LAYER = ADDONS + 'Mapgenerator/Worlds/MG_Test/.Data/MG_Test_100_layer.edds'
test('real _layer.edds (MG_Test) decodes to 256×256 weights', { skip: !existsSync(LAYER) }, () => {
  const L = decodeLayer(readFileSync(LAYER))
  assert.equal(L.width, 256); assert.equal(L.px.length, 256 * 256)
  const c = blockCoverage(L, 4, 0, 0, 7)
  assert.equal(c.px, 64 * 64)
  assert.ok(c.cover.some((v) => v > 0))
})

const DATA = ADDONS + 'Mapgenerator/Worlds/MG_Test/.Data/'
test('real _supertexture.edds (BC7) decodes to plausible terrain colours', { skip: !existsSync(DATA) }, () => {
  const f = readdirSync(DATA).find((n) => n.endsWith('_supertexture.edds'))
  if (!f) return
  const im = decodeColor(readFileSync(DATA + f))
  let a = 0
  for (let i = 3; i < im.data.length; i += 4) a += im.data[i]
  assert.ok(a / (im.data.length / 4) > 250)
})

const TOPO = ADDONS + 'Normandy_Edit/Data/TESTIsland.topo'
test('real .topo: ROAD quads and BULD footprints', { skip: !existsSync(TOPO) }, () => {
  const t = parseTopo(readFileSync(TOPO))
  assert.ok(t.blocks.includes('ROAD') && t.blocks.includes('BULD'))
  assert.ok(t.roads.length > 10 && t.buildings.length > 100)
  assert.equal(t.roads[0].quads.length % 8, 0)
  assert.deepEqual(topoToWorld(10, 100, 4864), [10, 4764])
})

const flat = (cols: number, f: (c: number, r: number) => number) => { const h = new Float32Array(cols * cols); for (let r = 0; r < cols; r++) for (let c = 0; c < cols; c++) h[r * cols + c] = f(c, r); return { cols, rows: cols, cell: 10, h } }

test('Metric Atlas, auto-calibration and biome rules on a ramp', () => {
  const g = flat(64, (c) => c * 5 - 20), m = metrics(g) // 26.6° slope everywhere, -20 .. 295 m
  const a = atlas(g, m)
  assert.ok(Math.abs(a.slope.p50 - 26.6) < 0.5)
  assert.ok(a.landPct > 90 && a.landPct < 100)
  assert.equal(a.aspect.indexOf(Math.max(...a.aspect)), 6) // slope faces west (downhill towards -x)
  const c = autoCalibrate(g, m)
  assert.ok(c.prairie > c.coastal && c.midland > c.prairie)
  assert.equal(percentile([1, 2, 3, 4, 5], 50), 3)
  const rules = biomeRules({ textures: { seabed: { default: 'SeaBed_01.emat' }, rock: { default: 'Rock_01.emat' }, grass_lowland: { default: 'Grass_02.emat' } } }, { ...c, rock: 40 }, { min: -20, max: 295 })
  assert.deepEqual(rules.map((r) => r.tex), ['SeaBed_01', 'Rock_01', 'Grass_02'])
  const cls = classify(g, m, rules)
  assert.equal(cls[0], 0) // sea
  assert.equal(cls[8], 2) // low land (20 m), 26° < 40° rock threshold
  assert.equal(cls[60], -1) // high land: no rule → base
  const explicit = biomeRules({ textures: { Rock_01: { slope_min: 20, priority: 10 }, SeaBed_01: { altitude_max_meters: 0, priority: 11 } } }, c, { min: 0, max: 1 })
  assert.equal(classify(g, m, explicit)[40], 1) // rock (26° ≥ 20°)
})

test('hand-off: project accepted by the generator (macro grid = Sculpt)', () => {
  const H = { ...flat(1025, (c, r) => (c + r) * 0.1), min: 0, max: 204.8, missing: 0 }
  const d = downsample(H, 768)
  assert.equal(d.cols, 513); assert.equal(d.step, 20)
  const p = islandProject(H, { roads: [{ type: 'dirt', pts: [[0, 0], [100, 100]] }] })
  assert.equal(p.kind, 'reforger-mapper-island')
  assert.equal(p.imported.cols, 513)
  const mc = Math.round(((d.cols - 1) * d.step) / 32) + 1 // Sculpt's macro side (src/modules/sculpt.ts)
  assert.equal(macroOf(d.h, d.cols, d.step).length, mc * mc)
  assert.equal(p.roads[0].pts.length, 4)
  assert.ok(JSON.stringify(p).length < 5e6)
})
