// In-game map background (SCR_MapEntity / map config): "Military 80s" and "Realistic satellite" styles.
// Palette, forest density classes, slope tint and sea colour ported from giorbev's fond_militaire.py,
// fond_realiste.py, fond_topo.py, talus.py, map2d.py (MIT, Copyright (c) giorbev). Rendering rewritten for
// Canvas 2D (no OpenCV): north up, x to the right, 1 image pixel = sizeX / S metres.
import type { HeightGrid } from './heights.ts'
import type { LayerObjects } from './formats/layer.ts'
import { topoSurface, type Topo } from './formats/topo.ts'

export type MapStyle = 'military' | 'realistic'
export interface MapLayers { relief: boolean; forest: boolean; water: boolean; roads: boolean; buildings: boolean; walls: boolean; port: boolean; slopes: boolean; legend: boolean }
export interface WaterMask { x0: number; z1: number; W: number; H: number; m: Uint8Array }
export interface RenderInput { H: HeightGrid; sizeX: number; sizeZ: number; objects: LayerObjects; water: WaterMask[]; sea: number; sat?: { W: number; H: number; data: Uint8ClampedArray } | null; topo?: Topo | null }
type RGB = [number, number, number]

export const PAL = {
  paper: [244, 238, 220] as RGB, forestLight: [206, 228, 176] as RGB, forest: [178, 212, 150] as RGB, forestDense: [148, 192, 122] as RGB,
  forestEdge: [120, 165, 100] as RGB, water: [160, 200, 222] as RGB, waterEdge: [70, 130, 175] as RGB, quay: [212, 210, 204] as RGB,
  quayLine: [30, 30, 30] as RGB, stairs: [232, 230, 224] as RGB, dike: [165, 160, 150] as RGB, wood: [178, 148, 108] as RGB,
  slope: [152, 140, 120] as RGB, sea: [95, 126, 132] as RGB,
  asphalt: [60, 60, 62] as RGB, concrete: [140, 140, 140] as RGB, dirt: [150, 115, 75] as RGB,
  house: [150, 70, 55] as RGB, industrial: [110, 112, 120] as RGB, wall: [60, 60, 60] as RGB,
}
const css = (c: RGB, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`
const SLOPE_DEG = 30, SLOPE_RAMP = 10, DENSITY = [2.0, 3.0], TREES_PER_M2 = 1 / 60

/** box blur (3 passes ~ gaussian) of a float grid, radius in cells */
function blur(a: Float32Array, W: number, H: number, r: number): Float32Array {
  if (r < 1) return a
  let src: Float32Array = a, dst: Float32Array = new Float32Array(a.length)
  for (let pass = 0; pass < 3; pass++) {
    for (let y = 0; y < H; y++) { let s = 0; for (let x = -r; x <= r; x++) s += src[y * W + Math.min(Math.max(x, 0), W - 1)]; for (let x = 0; x < W; x++) { dst[y * W + x] = s / (2 * r + 1); s += src[y * W + Math.min(x + r + 1, W - 1)] - src[y * W + Math.max(x - r, 0)] } }
    ;[src, dst] = [dst, src]
    for (let x = 0; x < W; x++) { let s = 0; for (let y = -r; y <= r; y++) s += src[Math.min(Math.max(y, 0), H - 1) * W + x]; for (let y = 0; y < H; y++) { dst[y * W + x] = s / (2 * r + 1); s += src[Math.min(y + r + 1, H - 1) * W + x] - src[Math.max(y - r, 0) * W + x] } }
    ;[src, dst] = [dst, src]
  }
  return src
}

/** forest class per cell (0 none, 1 sparse, 2 medium, 3 dense) on a `cell` metre grid */
export function forestClasses(trees: LayerObjects['trees'], sizeX: number, sizeZ: number, cell = 5): { W: number; H: number; cell: number; c: Uint8Array } {
  const W = Math.ceil(sizeX / cell), H = Math.ceil(sizeZ / cell), n = new Float32Array(W * H)
  for (const t of trees) { if (t.type === 'bush') continue; const x = Math.floor(t.x / cell), y = Math.floor((sizeZ - t.z) / cell); if (x >= 0 && y >= 0 && x < W && y < H) n[y * W + x]++ }
  const pres = blur(n, W, H, Math.max(1, Math.round(15 / cell))), dens = blur(n, W, H, Math.max(1, Math.round(30 / cell)))
  const c = new Uint8Array(W * H), a = cell * cell
  for (let i = 0; i < c.length; i++) {
    if (pres[i] <= a * TREES_PER_M2) continue
    const per100 = dens[i] / a * 100
    c[i] = per100 < DENSITY[0] ? 1 : per100 < DENSITY[1] ? 2 : 3
  }
  return { W, H, cell, c }
}

export function renderMap(ctx: CanvasRenderingContext2D, S: number, inp: RenderInput, style: MapStyle, L: MapLayers, legend?: { title: string; items: [string, RGB][] }) {
  const { H, sizeX, sizeZ, objects } = inp, mpp = sizeX / S, SH = Math.round(sizeZ / mpp)
  const img = ctx.createImageData(S, SH), d = img.data
  const fc = L.forest ? forestClasses(objects.trees, sizeX, sizeZ) : null
  const az = 315 * Math.PI / 180, alt = 45 * Math.PI / 180, lx = Math.sin(az) * Math.cos(alt), lz = Math.cos(az) * Math.cos(alt), ly = Math.sin(alt)
  const hAt = (x: number, z: number) => { const c = Math.min(Math.max(Math.round(x / H.cell), 0), H.cols - 1), r = Math.min(Math.max(Math.round(z / H.cell), 0), H.rows - 1); return H.h[r * H.cols + c] }
  for (let j = 0; j < SH; j++) for (let i = 0; i < S; i++) {
    const x = (i + 0.5) * mpp, z = sizeZ - (j + 0.5) * mpp, h = hAt(x, z), e = Math.max(mpp, H.cell)
    const dx = (hAt(x + e, z) - hAt(x - e, z)) / (2 * e), dz = (hAt(x, z + e) - hAt(x, z - e)) / (2 * e)
    const nl = Math.hypot(dx, dz, 1), shade = Math.max(0, (-dx * lx - dz * lz + ly) / nl)
    const slope = Math.atan(Math.hypot(dx, dz)) * 180 / Math.PI
    let c: RGB
    if (style === 'military') {
      c = PAL.paper
      if (fc) { const k = fc.c[Math.floor(j * mpp / fc.cell) * fc.W + Math.floor(i * mpp / fc.cell)]; if (k) c = k === 1 ? PAL.forestLight : k === 2 ? PAL.forest : PAL.forestDense }
      if (L.slopes && slope > SLOPE_DEG - SLOPE_RAMP) { let t = Math.min(1, (slope - SLOPE_DEG + SLOPE_RAMP) / SLOPE_RAMP); t = t * t * (3 - 2 * t); c = c.map((v, q) => v + (PAL.slope[q] - v) * t) as RGB }
      if (L.relief) { const s = 0.82 + 0.18 * shade / ly; c = c.map((v) => v * Math.min(1.05, s)) as RGB }
    } else {
      const low = Math.min(1, Math.max(0, (h - H.min) / Math.max(1, H.max - H.min)))
      c = [96 + 40 * low, 112 + 20 * low, 70 + 30 * low]
      if (slope > 35) c = [120, 112, 100]
      const sat = inp.sat, so = sat ? (Math.min(sat.H - 1, Math.floor(j / SH * sat.H)) * sat.W + Math.min(sat.W - 1, Math.floor(i / S * sat.W))) * 4 : -1
      if (sat && sat.data[so + 3]) c = [sat.data[so], sat.data[so + 1], sat.data[so + 2]] // baked terrain textures (supertexture)
      else if (fc) { const k = fc.c[Math.floor(j * mpp / fc.cell) * fc.W + Math.floor(i * mpp / fc.cell)]; if (k) c = k === 3 ? [38, 62, 34] : k === 2 ? [50, 78, 42] : [70, 96, 56] }
      const s = L.relief ? (sat ? 0.75 + 0.35 * Math.min(1.2, shade / ly) : Math.max(0.3, Math.pow(shade / ly, 0.9))) : 1
      c = c.map((v) => v * s) as RGB
    }
    if (L.water && h < inp.sea + 1) { const t = Math.min(1, Math.max(0, inp.sea + 1 - h)); const sc = style === 'military' ? PAL.water : PAL.sea; c = c.map((v, q) => v + (sc[q] - v) * t) as RGB }
    const o = (j * S + i) * 4
    d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = 255
  }
  ctx.putImageData(img, 0, 0)
  const P = (x: number, z: number): [number, number] => [x / mpp, (sizeZ - z) / mpp]
  const lw = (m: number) => Math.max(1, m / mpp)
  if (L.water) {
    const wc = style === 'military' ? PAL.water : PAL.sea
    for (const w of inp.water) {
      const oc = new OffscreenCanvas(w.W, w.H), o = oc.getContext('2d')!, id = o.createImageData(w.W, w.H)
      for (let i = 0; i < w.m.length; i++) if (w.m[i]) { id.data[i * 4] = wc[0]; id.data[i * 4 + 1] = wc[1]; id.data[i * 4 + 2] = wc[2]; id.data[i * 4 + 3] = 255 }
      o.putImageData(id, 0, 0)
      const [px, py] = P(w.x0, w.z1)
      ctx.drawImage(oc, px, py, w.W / mpp, w.H / mpp)
    }
  }
  if (style === 'realistic' && L.forest && objects.trees.length < 400000) {
    // crowns + shadow cast to the south-east (sun from the north-west, as the hillshade), giorbev's fond_realiste.py
    const round = mpp < 1.5, sh = new Path2D(), dark = new Path2D(), light = new Path2D()
    for (const t of objects.trees) {
      const [x, y] = P(t.x, t.z), r = Math.max(0.6, (t.type === 'bush' ? 1.5 : 3) / mpp), o = r * 0.6, cp = t.type === 'conifer' ? dark : light
      if (round) { sh.moveTo(x + o + r / 2, y + o); sh.ellipse(x + o, y + o, r * 0.6, r * 0.45, 0.6, 0, 7); cp.moveTo(x + r / 2, y); cp.arc(x, y, r / 2, 0, 7) }
      else { sh.rect(x + o - r / 2, y + o - r / 2, r, r); cp.rect(x - r / 2, y - r / 2, r, r) }
    }
    ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.fill(sh); ctx.fillStyle = 'rgba(10,70,20,.9)'; ctx.fill(dark); ctx.fillStyle = 'rgba(40,95,25,.9)'; ctx.fill(light)
  }
  const topo = inp.topo, k1 = 1 / mpp // .topo file (x, y) = world (x, sizeZ - z) → canvas (x, y) / mpp
  if (L.roads && topo?.roads.length) {
    // real road surfaces from the .topo ROAD block (quads at the true width), giorbev's fond_realiste.py
    for (const pass of style === 'military' ? [0, 1] : [1]) for (const r of topo.roads) {
      const kind = topoSurface(r.cls), q = r.quads
      ctx.fillStyle = pass === 0 ? 'rgba(30,30,30,.9)' : style === 'military' ? (kind === 'asphalt' ? 'rgb(232,120,60)' : 'rgb(255,255,255)') : css(PAL[kind])
      ctx.strokeStyle = ctx.fillStyle; ctx.lineWidth = pass === 0 ? 1.5 : 0.5
      ctx.beginPath()
      for (let i = 0; i + 7 < q.length; i += 8) { ctx.moveTo(q[i] * k1, q[i + 1] * k1); for (let j = 2; j < 8; j += 2) ctx.lineTo(q[i + j] * k1, q[i + j + 1] * k1); ctx.closePath() }
      if (pass === 0) ctx.stroke(); else { ctx.fill(); ctx.stroke() }
    }
  } else if (L.roads) {
    ctx.lineCap = 'round'; ctx.lineJoin = 'round'
    for (const kind of ['dirt', 'concrete', 'asphalt'] as const) for (const r of objects.roads) {
      if (r.type !== kind) continue
      const w = kind === 'asphalt' ? 7 : kind === 'concrete' ? 5 : 3.5
      ctx.beginPath(); r.pts.forEach(([x, z], k) => { const [a, b] = P(x, z); if (k) ctx.lineTo(a, b); else ctx.moveTo(a, b) })
      if (style === 'military') { ctx.strokeStyle = 'rgba(30,30,30,.9)'; ctx.lineWidth = lw(w) + 1.5; ctx.stroke(); ctx.strokeStyle = kind === 'asphalt' ? 'rgb(232,120,60)' : kind === 'concrete' ? 'rgb(250,220,120)' : 'rgb(255,255,255)'; ctx.lineWidth = lw(w) }
      else { ctx.strokeStyle = css(PAL[kind]); ctx.lineWidth = lw(w) }
      ctx.stroke()
    }
  }
  if (L.walls) {
    ctx.strokeStyle = css(PAL.wall); ctx.lineWidth = Math.max(0.6, 0.8 / mpp)
    for (const w of objects.walls) { const a = w.yaw * Math.PI / 180, dx = Math.cos(a) * 2, dz = -Math.sin(a) * 2, [x1, y1] = P(w.x - dx, w.z - dz), [x2, y2] = P(w.x + dx, w.z + dz); ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke() }
  }
  if (L.port) for (const p of objects.port) {
    const [x, y] = P(p.x, p.z), s = Math.max(1.5, (p.type === 'bollard' ? 0.8 : 8) / mpp)
    const c = p.type === 'stairs' ? PAL.stairs : p.type === 'breakwater' ? PAL.dike : p.type === 'wooden' ? PAL.wood : p.type === 'retaining' ? PAL.slope : PAL.quay
    ctx.save(); ctx.translate(x, y); ctx.rotate(-p.yaw * Math.PI / 180); ctx.fillStyle = css(c); ctx.fillRect(-s / 2, -s / 4, s, s / 2)
    ctx.strokeStyle = css(PAL.quayLine); ctx.lineWidth = 0.6; ctx.strokeRect(-s / 2, -s / 4, s, s / 2); ctx.restore()
  }
  if (L.buildings && topo?.buildings.length) for (const p of topo.buildings) {
    // real footprints from the .topo BULD block
    const path = () => { ctx.beginPath(); for (let i = 0; i + 1 < p.length; i += 2) (i ? ctx.lineTo : ctx.moveTo).call(ctx, p[i] * k1, p[i + 1] * k1); ctx.closePath() }
    if (style === 'realistic') { ctx.save(); ctx.translate(2 * k1, 2 * k1); ctx.fillStyle = 'rgba(0,0,0,.3)'; path(); ctx.fill(); ctx.restore(); ctx.fillStyle = css(PAL.house) }
    else ctx.fillStyle = 'rgb(40,40,40)'
    path(); ctx.fill()
  } else if (L.buildings) for (const b of objects.buildings) {
    const [x, y] = P(b.x, b.z), s = Math.max(1.5, (b.type === 'house' ? 10 : 18) / mpp)
    ctx.fillStyle = style === 'military' ? (b.type === 'house' ? 'rgb(40,40,40)' : 'rgb(90,90,90)') : css(b.type === 'house' ? PAL.house : PAL.industrial)
    if (style === 'realistic') { ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.fillRect(x - s / 2 + s * 0.2, y - s / 2 + s * 0.2, s, s); ctx.fillStyle = css(b.type === 'house' ? PAL.house : PAL.industrial) }
    ctx.fillRect(x - s / 2, y - s / 2, s, s)
  }
  if (L.legend && legend) drawLegend(ctx, S, SH, legend)
}

export function drawLegend(ctx: CanvasRenderingContext2D, S: number, SH: number, lg: { title: string; items: [string, RGB][] }) {
  const k = Math.max(1, S / 1024), pad = 8 * k, row = 18 * k, w = 190 * k, h = pad * 2 + row * (lg.items.length + 1)
  const x0 = S - w - 12 * k, y0 = SH - h - 12 * k
  ctx.fillStyle = 'rgba(250,247,238,.92)'; ctx.fillRect(x0, y0, w, h); ctx.strokeStyle = '#222'; ctx.lineWidth = k; ctx.strokeRect(x0, y0, w, h)
  ctx.fillStyle = '#111'; ctx.font = `bold ${12 * k}px sans-serif`; ctx.fillText(lg.title, x0 + pad, y0 + pad + 11 * k)
  ctx.font = `${11 * k}px sans-serif`
  lg.items.forEach(([label, c], i) => { const y = y0 + pad + row * (i + 1); ctx.fillStyle = css(c); ctx.fillRect(x0 + pad, y + 3 * k, 18 * k, 10 * k); ctx.strokeRect(x0 + pad, y + 3 * k, 18 * k, 10 * k); ctx.fillStyle = '#111'; ctx.fillText(label, x0 + pad + 26 * k, y + 12 * k) })
}
