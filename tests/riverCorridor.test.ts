import { test } from 'node:test'
import assert from 'node:assert/strict'
import { riverCorridor, riverCourse, type Water } from '../src/modules/water.ts'
import { cliffRocks } from '../src/modules/cliffRocks.ts'

// synthetic "map from an image": colour-band relief (6 m terraces, vertical steps) with a river drawn as
// a carve:false water whose banks are steps too (the steepest ranks of the map: what attracts cliff rocks)
const step = 4, cols = 201, rows = 201
const g = { minX: 0, minZ: 0, step, cols, rows }
const river: Water = { id: 'R1', type: 'river', pts: [0, 400, 200, 410, 400, 395, 600, 405, 800, 400], width: 14, depth: 1.5, carve: false, wetEdge: true }
const course = riverCourse(river.pts, river.width)
const edgeDist = (x: number, z: number) => {
  let b = Infinity
  for (let i = 0; i + 3 < course.length; i += 2) {
    const ax = course[i], az = course[i + 1], dx = course[i + 2] - ax, dz = course[i + 3] - az, L = dx * dx + dz * dz || 1
    const t = Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / L))
    b = Math.min(b, Math.hypot(x - ax - dx * t, z - az - dz * t))
  }
  return b - river.width / 2
}

const H = new Float32Array(cols * rows)
for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
  const x = c * step, z = r * step
  const band = Math.floor(Math.abs(z - 400) / 60) * 3 + x * 0.01 // gentle bands
  H[r * cols + c] = 2 + band + (edgeDist(x, z) > 1 ? 6 : 0) // the river bank: a 6 m step
}
const hAt = (x: number, z: number) => {
  const c = Math.min(cols - 1, Math.max(0, Math.round(x / step))), r = Math.min(rows - 1, Math.max(0, Math.round(z / step)))
  return H[r * cols + c]
}
test('riverCorridor: carve:false rivers are rasterised, near() is conservative', () => {
  const rc = riverCorridor(g, [river])
  for (let k = 0; k < 4000; k++) {
    const x = 20 + ((k * 7919) % 760), z = 340 + ((k * 104729) % 120)
    if (edgeDist(x, z) < 10) assert.ok(rc.near(x, z, 10), `${x},${z} at ${edgeDist(x, z).toFixed(1)} m not flagged`)
    if (edgeDist(x, z) < 3) assert.ok(rc.near(x, z, 3))
  }
  assert.equal(rc.near(400, 100, 10), false)
})

test('cliff rocks on a stepped image relief: attracted by the river banks, kept 10 m off with the corridor', () => {
  const base = { box: { minX: 0, minZ: 0, maxX: 800, maxZ: 800 }, heightAt: hAt, seed: 5, max: 400 }
  const free = cliffRocks({ ...base, ok: () => true })
  assert.ok(free.some((e) => edgeDist(e.x, e.z) < 10), 'without the corridor the banks get rocks (the bug)')
  const rc = riverCorridor(g, [river])
  const kept = cliffRocks({ ...base, ok: (x, z) => !rc.near(x, z, 10) }).filter((e) => !rc.near(e.x, e.z, 10))
  assert.ok(kept.length > 0)
  for (const e of kept) assert.ok(edgeDist(e.x, e.z) >= 10, `${e.prefab} at ${edgeDist(e.x, e.z).toFixed(1)} m from the water`)
})

test('carveWater: the whole traced river width is under the water (no bank lumps on the river surface)', async () => {
  const { carveWater } = await import('../src/modules/water.ts')
  const n = 101, st = 4, hs: number[] = []
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) hs.push(1 + 0.02 * c) // gentle slope, picture-map ground at ~1 m
  const w: Water = { id: 'R', type: 'river', pts: [40, 200, 360, 200], width: 40, depth: 1.5, carve: false, wetEdge: true }
  const lv = carveWater(hs, { minX: 0, minZ: 0, step: st, cols: n, rows: n }, [w])
  let wet = 0, dry = 0
  for (let k = 0; k < hs.length; k++) if (lv.wet[k]) { wet++; if (hs[k] > lv.level[k]) dry++ }
  assert.ok(wet > 300, `wet ${wet}`)
  assert.equal(dry, 0, `${dry} of ${wet} river cells above the water`)
})
