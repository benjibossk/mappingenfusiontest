// "Realistic" drape of the 3D view: a satellite-like texture made from the project data, not from the 2D
// editor render. Ground colour per surface (natural palette, noise, rock on slopes, sand on beaches, sea bed
// by depth) computed per pixel at ≤ 2048², then the vector layers at full size (field patchwork, forest
// canopy, water, roads, footprints) and a baked hillshade + ambient occlusion multiplied over everything.
import type { Box3D, HeightGrid } from './index'

type RGB = [number, number, number]
export interface SurfaceLayer { name: string; minX: number; minZ: number; step: number; cols: number; rows: number; weights: ArrayLike<number> }
export interface RealLayers {
  /** terrain surfaces (island.surfaces): weights per grid vertex, same grid for all */
  surfaces?: SurfaceLayer[]
  forests: { pts: number[]; needle: number }[] // flat X/Z rings; needle: 0 broadleaf … 1 conifer
  fields: number[][] // flat X/Z rings
  hedges: number[][] // flat X/Z polylines
  roads: { line: number[]; half: number; kind: 'asphalt' | 'paved' | 'dirt' | 'trail' }[] // centre lines
  rivers: { line: number[]; width: number }[]
  lakes: number[][]
  paved: number[][] // rings: squares, aprons, runways
  /** satellite / real image covering x0..x1, z0..z1 (row 0 = north) */
  sat?: { image: CanvasImageSource; x0: number; z0: number; x1: number; z1: number }
}

// natural palette (sRGB), a bit more saturated and varied than the surface averages of island.ts
const PAL: Record<string, RGB> = {
  grass: [94, 114, 56], grassDry: [134, 130, 78], alpine: [118, 116, 88], rock: [122, 117, 108], rockDark: [86, 82, 76],
  sand: [198, 184, 146], wetSand: [150, 140, 110], dirt: [128, 106, 78], pebbles: [142, 134, 118], heather: [108, 92, 84],
  concrete: [142, 140, 134], forestFloor: [58, 70, 38], crop: [150, 134, 88], coastal: [116, 118, 78],
  bedShallow: [64, 118, 118], bedDeep: [10, 26, 46],
}
const SURF: [RegExp, RGB][] = [
  [/^SeaBed/i, PAL.wetSand], [/^BeachGrass/i, [150, 146, 104]], [/coastal/i, PAL.coastal], [/^MountainGrass/i, PAL.alpine],
  [/^Grass/i, PAL.grass], [/Debris|^Rock/i, PAL.rock], [/^Pebbles/i, PAL.pebbles], [/^Dirt/i, PAL.dirt],
  [/^Forest/i, PAL.forestFloor], [/Crop|Field/i, PAL.crop], [/Heather/i, PAL.heather], [/Concrete|Asphalt/i, PAL.concrete],
  [/Sand|Beach/i, PAL.sand],
]
const surfColour = (name: string): RGB => SURF.find(([re]) => re.test(name))?.[1] ?? PAL.grass
const CROPS: RGB[] = [[176, 156, 92], [196, 176, 110], [112, 128, 62], [134, 146, 74], [128, 104, 74], [150, 120, 84], [92, 112, 56], [168, 150, 104], [146, 140, 82]]

// --- noise ---
const hash = (x: number, y: number) => {
  let h = (x * 374761393 + y * 668265263) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}
function vnoise(x: number, y: number) {
  const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy)
  const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1)
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v
}
const sstep = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t) }
const lerp3 = (o: RGB, a: RGB, b: RGB, t: number): RGB => { o[0] = a[0] + (b[0] - a[0]) * t; o[1] = a[1] + (b[1] - a[1]) * t; o[2] = a[2] + (b[2] - a[2]) * t; return o }
const mix3 = (o: RGB, b: RGB, t: number) => { o[0] += (b[0] - o[0]) * t; o[1] += (b[1] - o[1]) * t; o[2] += (b[2] - o[2]) * t }

/** bilinear sampler of a per-vertex grid */
function sampler(g: { minX: number; minZ: number; step: number; cols: number; rows: number }) {
  return (a: ArrayLike<number>, x: number, z: number) => {
    const fc = Math.max(0, Math.min(g.cols - 1.001, (x - g.minX) / g.step)), fr = Math.max(0, Math.min(g.rows - 1.001, (z - g.minZ) / g.step))
    const c = Math.floor(fc), r = Math.floor(fr), tx = fc - c, tz = fr - r, i = r * g.cols + c
    return (a[i] * (1 - tx) + a[i + 1] * tx) * (1 - tz) + (a[i + g.cols] * (1 - tx) + a[i + g.cols + 1] * tx) * tz
  }
}

export interface DrapeOut { canvas: HTMLCanvasElement; x0: number; z0: number; side: number; ms: number }

export function realDrape(size: number, hm: HeightGrid, sea: number, L: RealLayers, boxes: Box3D[], mode: 'real' | 'sat'): DrapeOut {
  const t0 = performance.now()
  const sideW = (hm.cols - 1) * hm.step, sideH = (hm.rows - 1) * hm.step, side = Math.max(sideW, sideH)
  const x0 = hm.minX, z0 = hm.minZ
  const { cols, rows, step } = hm, H = hm.heights
  // per height vertex: slope, ambient occlusion (height above the local mean), hillshade
  const n = cols * rows
  const slope = new Float32Array(n), ao = new Float32Array(n), shade = new Float32Array(n)
  let hMin = Infinity, hMax = -Infinity
  for (let i = 0; i < n; i++) { const h = H[i]; if (h < hMin) hMin = h; if (h > hMax) hMax = h }
  const blur = boxBlur(H, cols, rows, Math.max(2, Math.round(60 / step)))
  const lx = -0.55, ly = 0.6, lz = 0.58 // sun from the south-west (world Z north), as the scene light
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const i = r * cols + c
    const dx = (H[r * cols + Math.min(cols - 1, c + 1)] - H[r * cols + Math.max(0, c - 1)]) / (2 * step)
    const dz = (H[Math.min(rows - 1, r + 1) * cols + c] - H[Math.max(0, r - 1) * cols + c]) / (2 * step)
    slope[i] = Math.hypot(dx, dz)
    ao[i] = H[i] - blur[i]
    const l = Math.hypot(dx, 1, dz)
    shade[i] = Math.max(0, (-dx * lx + ly - dz * -lz) / l) // normal (-dx, 1, -dz) in X/Y/Z, light Z = -lz (south)
  }
  const S = sampler(hm)
  // surfaces → one colour per surface-grid vertex
  let surfCol: Float32Array | null = null, SS: ReturnType<typeof sampler> | null = null, sg: SurfaceLayer | null = null
  if (L.surfaces?.length) {
    sg = L.surfaces[0]
    const m = sg.cols * sg.rows
    surfCol = new Float32Array(m * 3)
    const acc = new Float32Array(m)
    for (const s of L.surfaces) {
      if (s.cols !== sg.cols || s.rows !== sg.rows) continue
      const k = surfColour(s.name)
      for (let i = 0; i < m; i++) { const w = s.weights[i]; if (!w) continue; surfCol[i * 3] += k[0] * w; surfCol[i * 3 + 1] += k[1] * w; surfCol[i * 3 + 2] += k[2] * w; acc[i] += w }
    }
    for (let i = 0; i < m; i++) { const w = acc[i] || 1; if (!acc[i]) { surfCol[i * 3] = PAL.grass[0]; surfCol[i * 3 + 1] = PAL.grass[1]; surfCol[i * 3 + 2] = PAL.grass[2] } else { surfCol[i * 3] /= w; surfCol[i * 3 + 1] /= w; surfCol[i * 3 + 2] /= w } }
    SS = sampler(sg)
  }
  const sr = surfCol && [new Float32Array(surfCol.length / 3), new Float32Array(surfCol.length / 3), new Float32Array(surfCol.length / 3)]
  if (surfCol && sr) for (let i = 0; i < sr[0].length; i++) { sr[0][i] = surfCol[i * 3]; sr[1][i] = surfCol[i * 3 + 1]; sr[2][i] = surfCol[i * 3 + 2] }

  // --- base ground + shading, per pixel at B ---
  const B = Math.min(2048, size)
  const base = document.createElement('canvas'); base.width = base.height = B
  const shadeC = document.createElement('canvas'); shadeC.width = shadeC.height = B
  const bi = new ImageData(B, B), si = new ImageData(B, B)
  const px = side / B, rel = Math.max(1, hMax - Math.max(sea, hMin))
  const col: RGB = [0, 0, 0], tmp: RGB = [0, 0, 0]
  for (let y = 0; y < B; y++) {
    const z = z0 + side - (y + 0.5) * px
    for (let x = 0; x < B; x++) {
      const wx = x0 + (x + 0.5) * px
      const o = (y * B + x) * 4
      if (wx > x0 + sideW || z < z0) { bi.data[o + 3] = 255; si.data[o] = si.data[o + 1] = si.data[o + 2] = si.data[o + 3] = 255; continue }
      const h = S(H, wx, z), sl = S(slope, wx, z)
      const n1 = vnoise(wx / 420, z / 420), n2 = vnoise(wx / 70 + 31, z / 70 + 17), n3 = vnoise(wx / 18 + 7, z / 18 + 3)
      if (h < sea) { // sea bed: sand in the shallows to navy in the deep
        const d = sstep(0, 1, (sea - h) / 40)
        lerp3(col, PAL.bedShallow, PAL.bedDeep, Math.sqrt(d))
        mix3(col, PAL.wetSand, (1 - sstep(0, 0.15, (sea - h) / 40)) * 0.7)
      } else {
        const alt = (h - sea) / rel
        if (SS && sr) { col[0] = SS(sr[0], wx, z); col[1] = SS(sr[1], wx, z); col[2] = SS(sr[2], wx, z) }
        else { lerp3(col, PAL.grass, PAL.alpine, sstep(0.45, 0.9, alt + (n1 - 0.5) * 0.2)) }
        // meadow variation: dry / lush patches
        lerp3(tmp, PAL.grass, PAL.grassDry, sstep(0.35, 0.8, n1 * 0.7 + n2 * 0.3))
        mix3(col, tmp, SS ? 0.35 : 0.55)
        mix3(col, n2 > 0.5 ? PAL.rockDark : PAL.rock, sstep(0.55, 1.0, sl + (n3 - 0.5) * 0.25) * 0.9) // rock on slopes
        mix3(col, PAL.dirt, sstep(0.7, 0.95, n2) * 0.25 * (1 - sstep(0.4, 0.7, sl)))
        const beach = (1 - sstep(1.2, 3.5, h - sea)) * (1 - sstep(0.12, 0.3, sl)) // beaches
        mix3(col, h - sea < 0.6 ? PAL.wetSand : PAL.sand, beach * (0.75 + n3 * 0.25))
      }
      const v = 0.92 + (n3 - 0.5) * 0.12 + (n2 - 0.5) * 0.08
      bi.data[o] = col[0] * v; bi.data[o + 1] = col[1] * v; bi.data[o + 2] = col[2] * v; bi.data[o + 3] = 255
      // shading: soft hillshade (the scene light shades again: kept mild) + cavity occlusion
      const a = S(ao, wx, z), sh = S(shade, wx, z)
      const f = Math.max(0.4, Math.min(1, (0.8 + 0.25 * sh) * (1 + Math.max(-0.4, Math.min(0.1, a / 25)))))
      si.data[o] = si.data[o + 1] = si.data[o + 2] = f * 255; si.data[o + 3] = 255
    }
  }
  base.getContext('2d')!.putImageData(bi, 0, 0)
  shadeC.getContext('2d')!.putImageData(si, 0, 0)

  const out = document.createElement('canvas'); out.width = out.height = size
  const g = out.getContext('2d')!
  g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high'
  if (mode === 'sat' && L.sat) {
    g.drawImage(base, 0, 0, size, size)
    const k = size / side, s = L.sat
    g.drawImage(s.image, (s.x0 - x0) * k, (z0 + side - s.z1) * k, (s.x1 - s.x0) * k, (s.z1 - s.z0) * k)
    return { canvas: out, x0, z0, side, ms: performance.now() - t0 }
  }
  g.drawImage(base, 0, 0, size, size)
  // fine grain: a noise tile in overlay
  g.save(); g.globalCompositeOperation = 'overlay'; g.globalAlpha = 0.22
  g.fillStyle = g.createPattern(grainTile(), 'repeat')!; g.fillRect(0, 0, size, size); g.restore()

  // --- vector layers, in world metres ---
  const k = size / side, minW = 1.1 / k
  g.setTransform(k, 0, 0, -k, -x0 * k, (z0 + side) * k)
  g.lineJoin = 'round'; g.lineCap = 'round'
  const ring = (p: number[], close: boolean) => { g.beginPath(); for (let i = 0; i + 1 < p.length; i += 2) { if (i) g.lineTo(p[i], p[i + 1]); else g.moveTo(p[i], p[i + 1]) } if (close) g.closePath() }
  const rgb = (c: RGB, f = 1, a = 1) => `rgba(${c[0] * f | 0},${c[1] * f | 0},${c[2] * f | 0},${a})`
  // fields: patchwork of crops, a few furrow stripes
  L.fields.forEach((f, i) => {
    if (f.length < 6) return
    const c = CROPS[Math.floor(hash(i, 7) * CROPS.length)], v = 0.9 + hash(i, 3) * 0.2
    ring(f, true); g.fillStyle = rgb(c, v, 0.92); g.fill()
    g.save(); g.clip()
    g.strokeStyle = rgb(c, v * 0.86, 0.5); g.lineWidth = Math.max(minW, 2.5)
    let bx0 = Infinity, bz0 = Infinity, bx1 = -Infinity, bz1 = -Infinity
    for (let j = 0; j + 1 < f.length; j += 2) { bx0 = Math.min(bx0, f[j]); bx1 = Math.max(bx1, f[j]); bz0 = Math.min(bz0, f[j + 1]); bz1 = Math.max(bz1, f[j + 1]) }
    const ang = Math.atan2(f[3] - f[1], f[2] - f[0]), ca = Math.cos(ang), sa = Math.sin(ang), R = Math.hypot(bx1 - bx0, bz1 - bz0) / 2, cx = (bx0 + bx1) / 2, cz = (bz0 + bz1) / 2
    g.beginPath()
    for (let d = -R; d < R; d += 9) { g.moveTo(cx - ca * R - sa * d, cz - sa * R + ca * d); g.lineTo(cx + ca * R - sa * d, cz + sa * R + ca * d) }
    g.stroke(); g.restore()
    ring(f, true); g.strokeStyle = 'rgba(70,64,44,0.45)'; g.lineWidth = Math.max(minW, 1.5); g.stroke()
  })
  // paved areas
  g.fillStyle = rgb(PAL.concrete, 0.95)
  for (const p of L.paved) { if (p.length >= 6) { ring(p, true); g.fill() } }
  // forest canopy
  const tile = canopyTile(), pat = g.createPattern(tile, 'repeat')!
  pat.setTransform(new DOMMatrix().scale(0.22))
  for (const f of L.forests) {
    if (f.pts.length < 6) continue
    ring(f.pts, true)
    g.fillStyle = rgb([44, 62, 32], 1 - f.needle * 0.15); g.fill()
    g.save(); g.globalAlpha = 0.95; g.fillStyle = pat; g.fill(); g.restore()
    if (f.needle > 0.3) { g.save(); g.globalCompositeOperation = 'multiply'; g.fillStyle = `rgba(150,170,165,${f.needle * 0.6})`; g.fill(); g.restore() }
    g.strokeStyle = 'rgba(20,30,14,0.55)'; g.lineWidth = Math.max(minW, 3); g.stroke()
  }
  // hedges
  g.strokeStyle = 'rgb(46,64,32)'; g.lineWidth = Math.max(minW, 3)
  for (const h of L.hedges) { if (h.length >= 4) { ring(h, false); g.stroke() } }
  // water
  const water = 'rgb(30,58,78)'
  g.fillStyle = water
  for (const p of L.lakes) { if (p.length >= 6) { ring(p, true); g.fill() } }
  for (const r of L.rivers) {
    ring(r.line, false)
    g.strokeStyle = 'rgba(120,108,80,0.8)'; g.lineWidth = Math.max(minW * 1.6, r.width + 3); g.stroke()
    g.strokeStyle = water; g.lineWidth = Math.max(minW, r.width); g.stroke()
  }
  // roads: shoulder then surface
  const RC: Record<string, [string, string]> = {
    asphalt: ['rgba(96,90,78,0.7)', 'rgb(72,74,76)'], paved: ['rgba(110,104,92,0.6)', 'rgb(132,128,120)'],
    dirt: ['rgba(110,96,70,0.5)', 'rgb(146,124,90)'], trail: ['rgba(110,96,70,0.35)', 'rgb(150,132,100)'],
  }
  for (const pass of [0, 1]) for (const r of L.roads) {
    if (r.line.length < 4) continue
    ring(r.line, false)
    g.strokeStyle = RC[r.kind][pass]
    g.lineWidth = Math.max(minW, r.half * 2 + (pass ? 0 : r.kind === 'trail' ? 1 : 2.5))
    g.stroke()
  }
  // building footprints (the 3D boxes stand on them): dark ground + shadow to the north-east
  g.fillStyle = 'rgba(40,38,34,0.75)'
  for (const b of boxes) {
    g.save(); g.translate(b.cx + b.h * 0.25, b.cz + b.h * 0.25); g.rotate(b.yaw); g.fillRect(-b.w / 2 - 1, -b.d / 2 - 1, b.w + 2, b.d + 2); g.restore()
  }
  g.setTransform(1, 0, 0, 1, 0, 0)
  // baked hillshade + occlusion over everything
  g.save(); g.globalCompositeOperation = 'multiply'; g.drawImage(shadeC, 0, 0, size, size); g.restore()
  return { canvas: out, x0, z0, side, ms: performance.now() - t0 }
}

function boxBlur(src: ArrayLike<number>, cols: number, rows: number, r: number) {
  const a = new Float32Array(cols * rows), b = new Float32Array(cols * rows)
  for (let y = 0; y < rows; y++) { // horizontal
    let s = 0, n = 0
    for (let x = -r; x < cols; x++) {
      if (x + r < cols) { s += src[y * cols + x + r]; n++ }
      if (x - r - 1 >= 0) { s -= src[y * cols + x - r - 1]; n-- }
      if (x >= 0) a[y * cols + x] = s / n
    }
  }
  for (let x = 0; x < cols; x++) { // vertical
    let s = 0, n = 0
    for (let y = -r; y < rows; y++) {
      if (y + r < rows) { s += a[(y + r) * cols + x]; n++ }
      if (y - r - 1 >= 0) { s -= a[(y - r - 1) * cols + x]; n-- }
      if (y >= 0) b[y * cols + x] = s / n
    }
  }
  return b
}

let grain: HTMLCanvasElement | null = null
function grainTile() {
  if (grain) return grain
  const c = document.createElement('canvas'); c.width = c.height = 256
  const im = new ImageData(256, 256)
  for (let i = 0; i < 256 * 256; i++) { const v = 128 + (hash(i, 99) - 0.5) * 120; im.data[i * 4] = im.data[i * 4 + 1] = im.data[i * 4 + 2] = v; im.data[i * 4 + 3] = 255 }
  c.getContext('2d')!.putImageData(im, 0, 0)
  return (grain = c)
}
let canopy: HTMLCanvasElement | null = null
/** 256 px tile of tree crowns (pattern scaled to ~56 m) */
function canopyTile() {
  if (canopy) return canopy
  const c = document.createElement('canvas'); c.width = c.height = 256
  const g = c.getContext('2d')!
  g.fillStyle = 'rgb(30,44,24)'; g.fillRect(0, 0, 256, 256)
  for (let i = 0; i < 900; i++) {
    const x = hash(i, 1) * 256, y = hash(i, 2) * 256, r = 6 + hash(i, 3) * 11, t = hash(i, 4)
    for (const [dx, dy] of [[0, 0], [256, 0], [-256, 0], [0, 256], [0, -256]]) {
      const cx = x + dx, cy = y + dy
      if (cx < -r || cx > 256 + r || cy < -r || cy > 256 + r) continue
      g.fillStyle = 'rgba(14,22,10,0.55)'; g.beginPath(); g.arc(cx + r * 0.35, cy + r * 0.35, r, 0, 7); g.fill()
      const gr = g.createRadialGradient(cx - r * 0.3, cy - r * 0.3, r * 0.1, cx, cy, r)
      gr.addColorStop(0, `rgb(${92 + t * 30 | 0},${112 + t * 26 | 0},${52 + t * 10 | 0})`)
      gr.addColorStop(1, `rgb(${40 + t * 14 | 0},${58 + t * 16 | 0},${28 + t * 6 | 0})`)
      g.fillStyle = gr; g.beginPath(); g.arc(cx, cy, r, 0, 7); g.fill()
    }
  }
  return (canopy = c)
}
