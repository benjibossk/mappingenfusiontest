import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  annotationAndShore, inImageWater, nearWater, clusterImage, closeMask, edt, extractBuildings, guessRoles, hatchZone, imageToMap, joinGaps, nearestBuilding,
  reliefFromLevels, roadClass, simplify, splitDark, thin, traceSkeleton, type ClusterRole,
  extractWater, fieldEdges, regularRow, smoothRing, riverAsLand, type ImgRoad,
} from '../src/modules/imageMap.ts'

const mask = (w: number, h: number, on: (x: number, y: number) => boolean) => {
  const m = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (on(x, y)) m[y * w + x] = 1
  return m
}

test('edt: exact distances to the nearest set pixel', () => {
  const m = mask(9, 9, (x, y) => x === 4 && y === 4)
  const d = edt(m, 9, 9)
  assert.equal(d[4 * 9 + 4], 0)
  assert.equal(d[4 * 9 + 7], 3)
  assert.ok(Math.abs(d[0] - Math.hypot(4, 4)) < 1e-6)
  assert.equal(edt(new Uint8Array(4), 2, 2)[0], Infinity)
})

test('thin + traceSkeleton: a thick bar becomes one centre line', () => {
  const w = 60, h = 20
  const sk = thin(mask(w, h, (x, y) => x >= 5 && x < 55 && y >= 8 && y <= 12), w, h)
  const lines = traceSkeleton(sk, w, h).filter((l) => l.length >= 10)
  assert.equal(lines.length, 1)
  const l = lines[0]
  for (let i = 1; i < l.length; i += 2) assert.ok(Math.abs(l[i] - 10) <= 1)
  assert.ok(Math.abs(l[0] - l[l.length - 2]) > 40)
})

test('traceSkeleton: a cross gives 4 branches meeting at the junction', () => {
  const w = 41, h = 41
  const sk = thin(mask(w, h, (x, y) => (Math.abs(y - 20) <= 1 && x > 2 && x < 38) || (Math.abs(x - 20) <= 1 && y > 2 && y < 38)), w, h)
  const long = traceSkeleton(sk, w, h).filter((l) => l.length / 2 >= 8)
  assert.equal(long.length, 4)
})

test('simplify keeps the corners of a polyline', () => {
  const p = [0, 0, 1, 0.1, 2, 0, 3, 0.1, 4, 0, 4, 1, 4, 2, 4, 3]
  assert.deepEqual(simplify(p, 0.5), [0, 0, 4, 0, 4, 3])
})

test('joinGaps: collinear dashes join, a perpendicular stub does not', () => {
  const a = [0, 0, 10, 0], b = [14, 0, 24, 0], c = [12, 3, 12, 13]
  const out = joinGaps([a, b, c], 6)
  assert.equal(out.length, 2)
  const long = out.find((l) => l.length === 8)!
  assert.deepEqual([long[0], long[long.length - 2]].sort((x, y) => x - y), [0, 24])
  assert.equal(joinGaps([a, [30, 0, 40, 0]], 6).length, 2) // gap too wide
})

test('guessRoles: tactical map palette (land, water, bands, roads, overlays)', () => {
  const lab: [number, number, number][] = [[74, -3, 8], [62, -13, -4], [71, 5, 11], [68, 11, 16], [63, 25, 25], [57, -1, 8], [9, 2, 9], [44, -4, 14], [36, 34, 28], [99, 0, 1], [65, -9, 9]]
  const share = [0.4, 0.06, 0.2, 0.1, 0.02, 0.02, 0.005, 0.05, 0.006, 0.006, 0.05]
  const r = guessRoles({ lab, share })
  assert.deepEqual(r.map((x) => x.role), ['land', 'water', 'band', 'band', 'band', 'road', 'building', 'road', 'ignore', 'ignore', 'forest'])
  // redder bands are higher
  assert.ok(r[2].height! < r[3].height! && r[3].height! < r[4].height!)
})

test('reliefFromLevels: bands rise, water is carved, smooth across band edges', () => {
  const w = 80, h = 20
  // water | land | band 1 | band 2, columns of 20 px
  const lvl = new Int16Array(w * h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) lvl[y * w + x] = x < 20 ? -1 : x < 40 ? 0 : x < 60 ? 1 : 2
  const H = reliefFromLevels(lvl, w, h, [20, 40], { shore: 1, depth: 4, mpp: 4, smooth: 4 })
  const at = (x: number) => H[10 * w + x]
  assert.ok(at(5) < 0, 'water below the surface')
  assert.ok(at(25) > 0 && at(25) < at(50) && at(50) < at(75), 'rising')
  // no cliff at the band edge: neighbours differ by a few metres only
  for (let x = 21; x < w; x++) assert.ok(Math.abs(at(x) - at(x - 1)) < 4, `step at ${x}`)
})

test('extractBuildings: a rotated dark rectangle -> one house of that footprint and orientation', () => {
  const w = 60, h = 60, mpp = 1
  // 16 x 8 m rectangle, long axis along world +X (image x)
  const m = mask(w, h, (x, y) => x >= 22 && x < 38 && y >= 26 && y < 34)
  const b = extractBuildings(m, w, h, mpp)
  assert.equal(b.length, 1)
  const c = b[0]
  assert.ok(Math.abs(c.len - 16) < 1.5 && Math.abs(c.wid - 8) < 1.5)
  // footprint centre at the blob centre (world z = h - y)
  const cx = (c.corners[0] + c.corners[2] + c.corners[4] + c.corners[6]) / 4, cz = (c.corners[1] + c.corners[3] + c.corners[5] + c.corners[7]) / 4
  assert.ok(Math.abs(cx - 30) < 1 && Math.abs(cz - 30) < 1)
  // long side of the footprint along X
  const e1 = Math.hypot(c.corners[2] - c.corners[0], c.corners[3] - c.corners[1]), e2 = Math.hypot(c.corners[4] - c.corners[2], c.corners[5] - c.corners[3])
  const longEdge = e1 >= e2 ? [c.corners[2] - c.corners[0], c.corners[3] - c.corners[1]] : [c.corners[4] - c.corners[2], c.corners[5] - c.corners[3]]
  assert.ok(Math.abs(longEdge[1]) < 0.2 * Math.abs(longEdge[0]))
  assert.ok(nearestBuilding(16, 8))
})

test('splitDark: outlined house -> blob, long line -> line, row of dashes -> dashes', () => {
  const w = 120, h = 60
  const ring = (x: number, y: number) => x >= 10 && x < 18 && y >= 10 && y < 16 && !(x > 10 && x < 17 && y > 10 && y < 15)
  const line = (x: number, y: number) => y === 40 && x >= 5 && x < 115
  const dash = (x: number, y: number) => y >= 52 && y < 55 && x >= 30 && x < 110 && (x % 10) < 5
  const s = splitDark(mask(w, h, (x, y) => ring(x, y) || line(x, y) || dash(x, y)), w, h, 1)
  assert.equal(s.blobs[12 * w + 13], 1, 'ring filled into a building')
  assert.equal(s.lines[40 * w + 60], 1)
  assert.equal(s.dashes[53 * w + 61], 1)
  assert.equal(s.blobs[53 * w + 61], 0)
})

test('hatchZone: wide hatching is out of bounds, a few roads are not', () => {
  const w = 200, h = 200
  const m = mask(w, h, (x, y) => (x < 90 && (x + y) % 8 === 0) || (x > 120 && (y === 50 || y === 150 || x === 160)))
  const z = hatchZone(m, w, h)
  assert.equal(z[100 * w + 40], 1)
  assert.equal(z[50 * w + 170], 0)
  assert.equal(z[100 * w + 160], 0)
})

test('closeMask bridges a 2 px gap', () => {
  const w = 30, h = 9
  const c = closeMask(mask(w, h, (x, y) => y === 4 && x > 2 && x < 27 && x !== 14 && x !== 15), w, h, 2.5)
  assert.equal(c[4 * w + 14], 1)
})

test('roadClass by relative thickness', () => {
  assert.equal(roadClass(12, 8, 'road'), 'asphalt')
  assert.equal(roadClass(8, 8, 'road'), 'asphaltNarrow')
  assert.equal(roadClass(4, 8, 'road'), 'dirt')
  assert.equal(roadClass(12, 8, 'path'), 'trailDirt')
})

test('imageToMap: synthetic tactical map -> river, relief, road, building; overlay erased', () => {
  const w = 160, h = 160, data = new Uint8Array(w * h * 4)
  const put = (x: number, y: number, c: number[]) => data.set([...c, 255], (y * w + x) * 4)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let c = [184, 184, 168] // land
    if ((x - 115) ** 2 + (y - 45) ** 2 < 28 ** 2) c = [203, 148, 124] // hill (band)
    if (Math.abs(x - 30 - y * 0.1) < 6) c = [121, 158, 158] // river, north-south
    if (Math.abs(y - 120) <= 1 && x > 45) c = [139, 136, 122] // road, west-east
    if (x >= 80 && x < 86 && y >= 100 && y < 108) c = [30, 25, 15] // house
    if (x >= 60 && x < 75 && y >= 20 && y < 60) c = [108, 106, 81] // olive arrow overlay
    put(x, y, c)
  }
  const q = clusterImage({ width: w, height: h, data }, 6)
  const roles = guessRoles(q)
  const want = (rgb: number[]) => roles[q.palette.findIndex((p) => Math.abs(p[0] - rgb[0]) + Math.abs(p[1] - rgb[1]) + Math.abs(p[2] - rgb[2]) < 20)]?.role
  assert.equal(want([121, 158, 158]), 'water')
  assert.equal(want([203, 148, 124]), 'band')
  assert.equal(want([108, 106, 81]), 'road') // casing colour; the arrow blob itself never becomes a road (checked below)
  const r = imageToMap(q, roles as ClusterRole[], { size: 640 }) // 4 m per pixel
  assert.equal(r.sizeX, 640)
  const H = (x: number, y: number) => r.heights.data[y * w + x]
  assert.ok(H(115, 45) > 15, 'hill top')
  assert.ok(H(38, 80) >= 0.3, 'a traced river is land in the picture relief: carveWater alone digs its bed (traced width)')
  assert.ok(H(67, 40) > H(52, 40) - 0.5 && H(67, 40) < H(82, 40) + 0.5, 'arrow erased: the slope goes on under it')
  assert.ok(r.waters.length >= 1)
  const road = r.roads.find((x) => x.kind === 'road')
  assert.ok(road, 'road found')
  // the road runs west-east at z = (160 - 120) * 4 = 160 m
  for (let i = 1; i < road!.pts.length; i += 2) assert.ok(Math.abs(road!.pts[i] - 160) < 10)
  assert.equal(r.buildings.length, 1, JSON.stringify(r.buildings.map((b) => [b.x, b.z])) + JSON.stringify(q.palette) + JSON.stringify(roles))
  assert.ok(Math.abs(r.buildings[0].corners[0] - 332) < 30)
})

test('a wide elongated water body is a river with a width profile, a compact one a lake', () => {
  const w = 300, h = 100, m = new Uint8Array(w * h)
  for (let y = 30; y < 70; y++) for (let x = 0; x < w; x++) m[y * w + x] = 1 // 40 px = 80 m wide, 600 m long
  const r = extractWater(m, w, h, 2)
  assert.ok(r.length >= 1 && r[0].kind === 'river', 'river')
  assert.ok(r[0].width > 70 && r[0].width < 95, `width ${r[0].width}`)
  assert.equal(r[0].widths!.length * 2 >= r[0].pts.length / 2, true)
  const b = new Uint8Array(100 * 100)
  for (let y = 20; y < 80; y++) for (let x = 20; x < 80; x++) if (Math.hypot(x - 50, y - 50) < 28) b[y * 100 + x] = 1
  assert.equal(extractWater(b, 100, 100, 2)[0].kind, 'lake')
})

test('evenly spaced dashes are a dotted row (even three of them), uneven marks are not', () => {
  const mk = (cx: number, cy: number, n = 6) => ({ cx, cy, px: new Array(n).fill(0) })
  assert.equal(regularRow([mk(0, 0), mk(10, 0), mk(20, 0)]), true)
  assert.equal(regularRow([mk(0, 0), mk(10, 0), mk(40, 0)]), false)
  // rail dashes never come out as buildings
  const w = 200, h = 40, d = new Uint8Array(w * h)
  for (let k = 0; k < 4; k++) for (let y = 18; y < 22; y++) for (let x = 20 + k * 14; x < 28 + k * 14; x++) d[y * w + x] = 1
  const s = splitDark(d, w, h, 2)
  assert.equal(s.blobs.some((v) => v), false)
  assert.ok(s.dashes.some((v) => v))
})

test('thin lines become field edges unless they link two roads', () => {
  const road = (pts: number[], width: number): ImgRoad => ({ pts, width, kind: 'road' })
  const lines = [road([0, 0, 1000, 0], 12), road([0, 500, 1000, 500], 12), road([0, 0, 0, 500], 12), road([1000, 0, 1000, 500], 12),
    road([500, 0, 500, 500], 5), road([200, 100, 400, 300], 5)]
  const r = fieldEdges(lines, 2)
  assert.equal(r.edges.length, 1)
  assert.equal(r.roads.length, 5)
})

test('smoothRing removes stair steps (no right-angle corner left)', () => {
  const s = smoothRing([0, 0, 10, 0, 10, 10, 20, 10, 20, 20, 0, 20], 2)
  assert.equal(s.length, 6 * 2 * 4)
  for (let i = 0; i < s.length / 2; i++) {
    const n = s.length / 2, a = (i + n - 1) % n, b = (i + 1) % n
    const ux = s[a * 2] - s[i * 2], uz = s[a * 2 + 1] - s[i * 2 + 1], vx = s[b * 2] - s[i * 2], vz = s[b * 2 + 1] - s[i * 2 + 1]
    const cos = (ux * vx + uz * vz) / (Math.hypot(ux, uz) * Math.hypot(vx, vz))
    assert.ok(cos < -0.3, `corner ${i}`)
  }
})

test('roads: red annotations and river banks never hold a road line', () => {
  const w = 40, h = 20, N = w * h
  // cluster 0 land, 1 water (left), 2 red frame (column 30), 3 grey road casing
  const index = new Uint8Array(N), lvl = new Int16Array(N)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = y * w + x; index[i] = x < 10 ? 1 : x === 30 ? 2 : 0; lvl[i] = x < 10 ? -1 : 0 }
  const lab: [number, number, number][] = [[74, -3, 8], [62, -13, -4], [45, 40, 30], [57, -1, 8]]
  const roles = [{ role: 'land' }, { role: 'water' }, { role: 'ignore' }, { role: 'road' }] as Parameters<typeof annotationAndShore>[1]
  const m = annotationAndShore({ index, lab }, roles, lvl, w, h)
  assert.equal(m[5 * w + 11], 1, 'bank')
  assert.equal(m[5 * w + 32], 1, 'frame edge')
  assert.equal(m[5 * w + 20], 0, 'open land')
  assert.ok(nearWater(lvl, w, h, 5 * w + 12, 4) && !nearWater(lvl, w, h, 5 * w + 20, 4))
})

test('guessRoles: dark olive road casing is a road, a red frame is ignored', () => {
  const r = guessRoles({ lab: [[74, -3, 8], [44, -3, 14], [36, 20, 26], [55, 10, 15]], share: [0.5, 0.05, 0.02, 0.01] })
  assert.deepEqual(r.map((x) => x.role), ['land', 'road', 'ignore', 'ignore'])
})

test('inImageWater: buildings in a river or a lake (or on its bank) are dropped', () => {
  const river = { kind: 'river' as const, pts: [0, 0, 100, 0], width: 20 }
  const lake = { kind: 'lake' as const, pts: [200, 0, 300, 0, 300, 100, 200, 100], width: 0 }
  assert.equal(inImageWater([river], 50, 12, 6), true) // bank, 2 m from the water
  assert.equal(inImageWater([river], 50, 30, 6), false)
  assert.equal(inImageWater([lake], 250, 50), true)
  assert.equal(inImageWater([lake], 250, 104), true)
  assert.equal(inImageWater([lake], 250, 120), false)
})

test('riverAsLand: the water body of a traced river becomes land for the relief, a lake stays water', () => {
  const w = 100, h = 100, lvl = new Int16Array(w * h), wm = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) for (let x = 45; x < 55; x++) { lvl[y * w + x] = -1; wm[y * w + x] = 1 } // river, north-south
  for (let y = 10; y < 20; y++) for (let x = 5; x < 15; x++) { lvl[y * w + x] = -1; wm[y * w + x] = 1 } // pond
  const waters = extractWater(wm, w, h, 4)
  assert.ok(waters.some((x) => x.kind === 'river'))
  const out = riverAsLand(lvl, wm, w, h, waters, 4)
  assert.equal(out[50 * w + 50], 0, 'river pixel -> land')
  assert.equal(out[15 * w + 10], -1, 'pond stays water')
})
