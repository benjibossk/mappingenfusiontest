import { test } from 'node:test'
import assert from 'node:assert/strict'
import { paintMasks, sharpenMasks } from '../src/shared/maskPaint.mjs'
import { computeSurfaces } from '../src/modules/island'
import { roadMasks } from '../src/modules/roads'
import { roadsOutOfWater, type Water } from '../src/modules/water'
import { APP_FAMILIES } from '../bridge/families.mjs'

test('sharpenMasks: a 55/45 mix becomes one dominant surface per pixel, blobs keep the area share (round 12)', () => {
  const side = 257, a = new Uint8Array(side * side).fill(140), b = new Uint8Array(side * side).fill(115)
  sharpenMasks([a, b], side, 1) // 1 m pixels, as the 4 km masks
  let pure = 0, share = 0
  for (let i = 0; i < a.length; i++) { const t = a[i] + b[i]; if (Math.max(a[i], b[i]) / t > 0.8) pure++; share += a[i] / t }
  assert.ok(pure / a.length > 0.9, `pure ${pure / a.length}`)
  const s = share / a.length
  assert.ok(s > 0.45 && s < 0.65, `share ${s}`)
  // coherent blobs, not a dither: most neighbours carry the same dominant surface
  let same = 0
  for (let i = 0; i + 1 < a.length; i++) if ((a[i] > b[i]) === (a[i + 1] > b[i + 1])) same++
  assert.ok(same / a.length > 0.95, `neighbours ${same / a.length}`)
})

test('dirt tracks: full Dirt_01 under the carriageway, kept by the per-block limit (round 12, picture 120 trails 0 %)', () => {
  const S = 252, g = { minX: 0, minZ: 0, step: 4, cols: 64, rows: 64 }
  const w = (v: number) => new Array(64 * 64).fill(v)
  const surf = [{ ...g, name: 'Grass_01', weights: w(0.6) }, { ...g, name: 'Grass_02', weights: w(0.4) }]
  const bands = roadMasks([{ id: 'T', type: 'trailDirt', pts: [10, 126, 240, 126] }] as never)
  const { names, bytes } = paintMasks(S, 252, surf, bands)
  const k = names.indexOf('Dirt_01'), row = S - 1 - 126
  let sum = 0
  for (let c = 20; c < 230; c++) sum += bytes[k][row * S + c]
  assert.ok(sum / 210 > 240, `track centre ${sum / 210}`)
})

test('inland water: no sandy shelf / bare patches under a river swelling lake (round 12, picture 119 banks)', () => {
  const cols = 40, rows = 40, g = { minX: 0, minZ: 0, step: 4, cols, rows }
  const h: number[] = [], inl = new Uint8Array(cols * rows)
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) { const d = Math.hypot(c - 20, r - 20); h.push(d < 10 ? -3 + d * 0.25 : 1 + (d - 10) * 0.05); if (d < 10.5) inl[r * cols + c] = 1 }
  const s = computeSurfaces(g, h, 60, undefined, new Uint8Array(cols * rows), undefined, undefined, inl)
  const get = (n: string) => s.find((x) => x.name === n)?.weights ?? []
  for (let i = 0; i < h.length; i++) {
    if (!inl[i] || h[i] >= -0.5) continue
    assert.ok((get('Dirt_02')[i] ?? 0) < 0.05 && (get('BeachGrass_01')[i] ?? 0) < 0.05, `cell ${i}: sand under inland water`)
  }
})

test('roads ending at a lake stop 8 m before its outline, the mask bands follow the cut roads (round 12)', () => {
  const lake: Water = { id: 'L', type: 'lake', pts: [100, 100, 200, 100, 200, 200, 100, 200], width: 0, depth: 2 }
  const road = { id: 'ROAD_1', type: 'dirt', pts: [150, 0, 150, 150] }
  const shapes = [{ id: 'ROAD_1', kind: 'spline' as const, closed: false, points: road.pts }]
  const out = roadsOutOfWater([road], shapes as never, [lake])
  assert.equal(out.length, 1)
  const p = out[0].pts
  assert.ok(Math.max(p[1], p[p.length - 1]) <= 92.5, `end ${p[p.length - 1]}`)
})

test('a full send clears the feathered bush belts of an older world (BELT_, 7 093 hazel bushes left in 119 / 120 lakes)', () => {
  assert.ok(APP_FAMILIES.includes('BELT_'))
})
