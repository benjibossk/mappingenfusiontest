// In-game style topographic map (PLAN_GIORBEV Phase 3 "Carte en jeu").
// Pure RGBA rasteriser: no DOM, no canvas. North-up: image row 0 = maxZ (north).
// PNG export is left to the bridge (bridge/terrain-masks.mjs already has a PNG writer).
import { isPaved, type RoadType } from './roads.ts'

export interface HeightGrid { minX: number; minZ: number; step: number; cols: number; rows: number; heights: ArrayLike<number> }
export interface MapRoad { type: RoadType | string; points: number[] /* x,z,x,z... */; width?: number }
export interface MapRect { x: number; z: number; w: number; d: number; angle?: number /* rad, around centre */ }
export interface IngameMapInput {
  grid: HeightGrid
  seaLevel: number
  width: number
  height: number
  water?: number[][]          // closed polygons x,z,...
  rivers?: { points: number[]; width: number }[]
  forests?: number[][]
  roads?: MapRoad[]
  buildings?: MapRect[]
  contourStep?: number        // metres, default 10; major every 5x
  /** opt-in slope shading (idea from giorbev MapGeneratorPro V8.4): land steeper than this (deg, e.g. 25/30/35) is tinted grey-brown */
  slopeShadeDeg?: number
}
export interface RgbaImage { width: number; height: number; data: Uint8ClampedArray }

export const MAP_COLOURS = {
  sea: [92, 150, 200], land: [238, 232, 214], forest: [168, 204, 140], contour: [176, 132, 92],
  contourMajor: [140, 96, 60], steep: [150, 138, 122], building: [60, 56, 54], paved: [210, 70, 50], dirt: [150, 110, 70],
} as const

const roadStyle = (t: string): { c: readonly number[]; w: number } =>
  t === 'motorway' ? { c: [230, 140, 40], w: 10 }
    : isPaved(t as RoadType) ? { c: MAP_COLOURS.paved, w: 7 }
    : t.startsWith('trail') ? { c: MAP_COLOURS.dirt, w: 3 } : { c: MAP_COLOURS.dirt, w: 5 }

export function renderIngameMap(inp: IngameMapInput): RgbaImage {
  const { grid: g, width: W, height: H } = inp
  const ext = { x: (g.cols - 1) * g.step, z: (g.rows - 1) * g.step }
  const ppmX = W / ext.x, ppmZ = H / ext.z
  const toPx = (x: number, z: number): [number, number] => [(x - g.minX) * ppmX, (g.minZ + ext.z - z) * ppmZ]
  const hAt = (x: number, z: number) => {
    const fx = Math.min(Math.max((x - g.minX) / g.step, 0), g.cols - 1.001), fz = Math.min(Math.max((z - g.minZ) / g.step, 0), g.rows - 1.001)
    const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j, h = g.heights, c = g.cols
    return (h[j * c + i] * (1 - u) + h[j * c + i + 1] * u) * (1 - v) + (h[(j + 1) * c + i] * (1 - u) + h[(j + 1) * c + i + 1] * u) * v
  }
  const data = new Uint8ClampedArray(W * H * 4)
  const hpx = new Float32Array(W * H)
  for (let py = 0; py < H; py++) for (let px = 0; px < W; px++) hpx[py * W + px] = hAt(g.minX + (px + 0.5) / ppmX, g.minZ + ext.z - (py + 0.5) / ppmZ)
  const set = (px: number, py: number, c: readonly number[], a = 1) => {
    if (px < 0 || py < 0 || px >= W || py >= H) return
    const o = (py * W + px) * 4
    data[o] = data[o] * (1 - a) + c[0] * a; data[o + 1] = data[o + 1] * (1 - a) + c[1] * a; data[o + 2] = data[o + 2] * (1 - a) + c[2] * a; data[o + 3] = 255
  }
  // base: land / sea + hillshade (light from north-west)
  const mPerPx = 1 / ppmX
  for (let py = 0; py < H; py++) for (let px = 0; px < W; px++) {
    const i = py * W + px, h = hpx[i]
    if (h <= inp.seaLevel) { set(px, py, MAP_COLOURS.sea); continue }
    const dx = (hpx[py * W + Math.min(px + 1, W - 1)] - hpx[py * W + Math.max(px - 1, 0)]) / (2 * mPerPx)
    const dy = (hpx[Math.min(py + 1, H - 1) * W + px] - hpx[Math.max(py - 1, 0) * W + px]) / (2 / ppmZ)
    const nl = Math.hypot(dx, dy, 1), shade = (dx * -0.577 + dy * -0.577 + 0.577) / nl // dot with light (-x, -y screen=north, up)
    const k = 0.75 + 0.35 * shade
    set(px, py, MAP_COLOURS.land.map(c => Math.min(255, c * k)))
    if (inp.slopeShadeDeg != null) {
      const deg = Math.atan(Math.hypot(dx, dy)) * 180 / Math.PI
      if (deg >= inp.slopeShadeDeg) set(px, py, MAP_COLOURS.steep, Math.min(0.75, 0.45 + (deg - inp.slopeShadeDeg) / 40))
    }
  }
  const fillPoly = (pts: number[], c: readonly number[], a = 1) => {
    const n = pts.length / 2; if (n < 3) return
    const P = Array.from({ length: n }, (_, k) => toPx(pts[2 * k], pts[2 * k + 1]))
    let y0 = Infinity, y1 = -Infinity
    for (const [, y] of P) { y0 = Math.min(y0, y); y1 = Math.max(y1, y) }
    for (let py = Math.max(0, Math.floor(y0)); py <= Math.min(H - 1, Math.ceil(y1)); py++) {
      const yc = py + 0.5, xs: number[] = []
      for (let k = 0; k < n; k++) {
        const [ax, ay] = P[k], [bx, by] = P[(k + 1) % n]
        if ((ay <= yc) !== (by <= yc)) xs.push(ax + (yc - ay) / (by - ay) * (bx - ax))
      }
      xs.sort((p, q) => p - q)
      for (let k = 0; k + 1 < xs.length; k += 2) for (let px = Math.ceil(xs[k] - 0.5); px < xs[k + 1] - 0.5; px++) set(px, py, c, a)
    }
  }
  const line = (pts: number[], wPx: number, c: readonly number[]) => {
    const r = Math.max(0.5, wPx / 2)
    for (let k = 0; k + 3 < pts.length; k += 2) {
      const [ax, ay] = toPx(pts[k], pts[k + 1]), [bx, by] = toPx(pts[k + 2], pts[k + 3])
      const lx = bx - ax, ly = by - ay, l2 = lx * lx + ly * ly || 1
      for (let py = Math.floor(Math.min(ay, by) - r); py <= Math.ceil(Math.max(ay, by) + r); py++)
        for (let px = Math.floor(Math.min(ax, bx) - r); px <= Math.ceil(Math.max(ax, bx) + r); px++) {
          const cx = px + 0.5, cy = py + 0.5, t = Math.max(0, Math.min(1, ((cx - ax) * lx + (cy - ay) * ly) / l2))
          if (Math.hypot(cx - ax - t * lx, cy - ay - t * ly) <= r) set(px, py, c)
        }
    }
  }
  for (const f of inp.forests ?? []) fillPoly(f, MAP_COLOURS.forest, 0.85)
  // contours: pixel whose band index differs from a right/down neighbour
  const step = inp.contourStep ?? 10
  for (let py = 0; py < H - 1; py++) for (let px = 0; px < W - 1; px++) {
    const h = hpx[py * W + px]; if (h <= inp.seaLevel) continue
    const b = Math.floor(h / step)
    for (const n of [hpx[py * W + px + 1], hpx[(py + 1) * W + px]]) {
      const bn = Math.floor(n / step); if (bn === b) continue
      const lvl = Math.max(b, bn)
      set(px, py, lvl % 5 === 0 ? MAP_COLOURS.contourMajor : MAP_COLOURS.contour, lvl % 5 === 0 ? 0.9 : 0.6)
      break
    }
  }
  for (const w of inp.water ?? []) fillPoly(w, MAP_COLOURS.sea)
  for (const rv of inp.rivers ?? []) line(rv.points, Math.max(1, rv.width * ppmX), MAP_COLOURS.sea)
  const roads = [...(inp.roads ?? [])].sort((a, b) => roadStyle(a.type).w - roadStyle(b.type).w)
  for (const rd of roads) {
    const s = roadStyle(rd.type), wPx = Math.max(1, (rd.width ?? s.w) * ppmX)
    line(rd.points, wPx + 2, [70, 50, 40]); line(rd.points, wPx, s.c)
  }
  for (const b of inp.buildings ?? []) {
    const ca = Math.cos(b.angle ?? 0), sa = Math.sin(b.angle ?? 0), hw = b.w / 2, hd = b.d / 2, pts: number[] = []
    for (const [u, v] of [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]]) pts.push(b.x + u * ca - v * sa, b.z + u * sa + v * ca)
    fillPoly(pts, MAP_COLOURS.building)
  }
  return { width: W, height: H, data }
}
