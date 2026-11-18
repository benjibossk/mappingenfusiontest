import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderIngameMap } from '../../src/modules/ingameMap.ts'

// 1000 m square, slope rising to the north (row 0 = south): south edge under the sea
const cols = 51, rows = 51, step = 20, heights = new Float32Array(cols * rows)
for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) heights[j * cols + i] = -20 + j * 4
const img = renderIngameMap({
  grid: { minX: 0, minZ: 0, step, cols, rows, heights }, seaLevel: 0, width: 200, height: 200,
  roads: [{ type: 'asphalt', points: [100, 800, 900, 800] }],
  buildings: [{ x: 500, z: 600, w: 30, d: 30 }],
})
const px = (x: number, y: number) => Array.from(img.data.slice((y * 200 + x) * 4, (y * 200 + x) * 4 + 4))

test('south (bottom rows) is sea blue, north is land', () => {
  const [r, g, b] = px(100, 198)
  assert.ok(b > r + 50 && b > g, `sea ${[r, g, b]}`)
  const [r2, , b2] = px(100, 100)
  assert.ok(r2 > b2, 'land not blue')
})

test('contour pixels present', () => {
  let n = 0
  for (let y = 0; y < 150; y++) { const [r, g, b] = px(10, y); if (r > b + 30 && r - b > (px(10, y + 2)[0] - px(10, y + 2)[2]) + 15) n++ }
  assert.ok(n >= 5, `contours ${n}`)
})

test('road and building pixels coloured', () => {
  const [r, g, b] = px(100, 40) // z=800 -> y=40
  assert.ok(r > 180 && g < 120 && b < 100, `road ${[r, g, b]}`)
  const [br, bg] = px(100, 80) // z=600 -> y=80
  assert.ok(br < 80 && bg < 80, 'building dark')
})
