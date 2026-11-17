// Outside terrain ring (docs/OUTSIDE_TERRAIN.md): a low-resolution relief around the playable map that
// continues the edge heights and the coast and fades toward the sea (or a low plain), so players do not
// look into the void at the map edge. Pure data: the 3D view draws it, the bridge writes it as
// Outside Terrain Core chunks (OTC_OutsideTerrainChunkEntity, 61F0D506562D9BC9) for the addon to place.

export interface OutsideGrid { minX: number; minZ: number; step: number; cols: number; rows: number; heights: number[] } // row 0 = minZ (south)

export interface OutsideOptions {
  /** ring width beyond each map edge, metres */
  width: number
  /** ring cell, metres (low-res: 32-128) */
  step: number
  /** 'sea': the relief dives under the sea; 'land': it settles on a low plain just above the sea */
  toward: 'sea' | 'land'
  seed: number
  /** relative amplitude of the far-field noise (0..1) */
  noise?: number
}

export const OUTSIDE_DEFAULTS: OutsideOptions = { width: 4096, step: 64, toward: 'sea', seed: 1, noise: 0.5 }

const smooth = (t: number) => { const u = Math.max(0, Math.min(1, t)); return u * u * (3 - 2 * u) }

function hash(ix: number, iz: number, seed: number) {
  let h = (ix * 374761393 + iz * 668265263 + seed * 2147483647) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}
function vnoise(x: number, z: number, seed: number) { // value noise in [-1, 1]
  const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz
  const sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz)
  const a = hash(ix, iz, seed), b = hash(ix + 1, iz, seed), c = hash(ix, iz + 1, seed), d = hash(ix + 1, iz + 1, seed)
  return (a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz) * 2 - 1
}
function fbm(x: number, z: number, seed: number) {
  let s = 0, amp = 0.5, f = 1
  for (let o = 0; o < 4; o++) { s += amp * vnoise(x * f, z * f, seed + o * 17); amp *= 0.5; f *= 2 }
  return s
}

/** bilinear height of the map grid, clamped to its bounds */
function sample(g: OutsideGrid, x: number, z: number) {
  const fx = Math.max(0, Math.min(g.cols - 1, (x - g.minX) / g.step)), fz = Math.max(0, Math.min(g.rows - 1, (z - g.minZ) / g.step))
  const c = Math.min(g.cols - 2, Math.floor(fx)), r = Math.min(g.rows - 2, Math.floor(fz)), u = fx - c, v = fz - r
  const H = (cc: number, rr: number) => g.heights[rr * g.cols + cc]
  return (H(c, r) * (1 - u) + H(c + 1, r) * u) * (1 - v) + (H(c, r + 1) * (1 - u) + H(c + 1, r + 1) * u) * v
}

/** true when (x, z) lies inside the playable map */
export function insideMap(g: OutsideGrid, x: number, z: number) {
  return x >= g.minX && z >= g.minZ && x <= g.minX + (g.cols - 1) * g.step && z <= g.minZ + (g.rows - 1) * g.step
}

/**
 * Ring grid covering the map plus `width` on every side, aligned on the map corner. Cells inside the map
 * carry the map height (bilinear) so the seam is exact; outside, the edge height (smoothed more and more
 * along the edge with the distance) fades toward the far level, plus noise growing with the distance.
 */
export function outsideRing(map: OutsideGrid, ocean: number, opts: Partial<OutsideOptions> = {}): OutsideGrid {
  const o = { ...OUTSIDE_DEFAULTS, ...opts }
  const step = Math.max(8, o.step)
  const n = Math.ceil(o.width / step)
  const sideX = (map.cols - 1) * map.step, sideZ = (map.rows - 1) * map.step
  const cols = Math.ceil(sideX / step) + 1 + 2 * n, rows = Math.ceil(sideZ / step) + 1 + 2 * n
  const minX = map.minX - n * step, minZ = map.minZ - n * step
  const x1 = map.minX + sideX, z1 = map.minZ + sideZ
  let mean = 0, cnt = 0 // mean edge height: the 'land' far level leans on it
  for (let c = 0; c < map.cols; c++) { mean += map.heights[c] + map.heights[(map.rows - 1) * map.cols + c]; cnt += 2 }
  for (let r = 0; r < map.rows; r++) { mean += map.heights[r * map.cols] + map.heights[r * map.cols + map.cols - 1]; cnt += 2 }
  mean /= cnt
  const far = o.toward === 'sea' ? ocean - Math.max(30, o.width * 0.01) : ocean + Math.max(4, (mean - ocean) * 0.25)
  const amp = (o.noise ?? 0.5) * Math.max(10, Math.abs(mean - ocean) * 0.4)
  const heights = new Array<number>(cols * rows)
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const x = minX + c * step, z = minZ + r * step
    const cx = Math.max(map.minX, Math.min(x1, x)), cz = Math.max(map.minZ, Math.min(z1, z))
    const d = Math.hypot(x - cx, z - cz)
    if (d <= 0) { heights[r * cols + c] = sample(map, x, z); continue }
    // average the edge over a window that widens with the distance: ridges soften as they leave the map
    const w = d * 0.6, tx = Math.abs(x - cx) > 0 ? 0 : 1, tz = 1 - tx
    let e = 0
    for (let k = -2; k <= 2; k++) e += sample(map, cx + tx * k * w * 0.5, cz + tz * k * w * 0.5)
    e /= 5
    const t = smooth(d / o.width)
    const nz = fbm(x / 1500, z / 1500, o.seed) * amp * smooth(d / (o.width * 0.4)) * (1 - t)
    let h = e + (far - e) * t + nz
    if (o.toward === 'sea' && e < ocean) h = Math.min(h, e + (far - e) * smooth(d / (o.width * 0.3))) // coast under water stays under water
    heights[r * cols + c] = h
  }
  return { minX, minZ, step, cols, rows, heights }
}

/** one OTC chunk: centre (entity origin, y = 0), size and res × res absolute heights, row = local +Z (south to north) */
export interface OutsideChunk { x: number; z: number; size: number; res: number; heights: number[] }

/**
 * Cuts the ring into square chunks of (res − 1) ring cells (OTC max resolution 33 = one Enfusion block),
 * skipping chunks wholly inside the playable map. Neighbouring chunks share their edge vertices: no cracks.
 */
export function ringChunks(ring: OutsideGrid, map: OutsideGrid, res = 33): OutsideChunk[] {
  res = Math.max(2, Math.min(33, Math.floor(res)))
  const span = res - 1, size = span * ring.step, out: OutsideChunk[] = []
  const x1 = map.minX + (map.cols - 1) * map.step, z1 = map.minZ + (map.rows - 1) * map.step
  for (let r0 = 0; r0 + 1 < ring.rows; r0 += span) for (let c0 = 0; c0 + 1 < ring.cols; c0 += span) {
    const ax = ring.minX + c0 * ring.step, az = ring.minZ + r0 * ring.step
    if (ax >= map.minX && az >= map.minZ && ax + size <= x1 && az + size <= z1) continue // under the real terrain
    const heights: number[] = []
    for (let r = 0; r < res; r++) for (let c = 0; c < res; c++) {
      const rr = Math.min(ring.rows - 1, r0 + r), cc = Math.min(ring.cols - 1, c0 + c)
      heights.push(Math.round(ring.heights[rr * ring.cols + cc] * 100) / 100)
    }
    out.push({ x: ax + size / 2, z: az + size / 2, size, res, heights })
  }
  return out
}

/** text file for the addon (MG_ApplyOutside): header "OTC 1 count", then per chunk "x z size res" + one line of heights */
export function chunksToText(chunks: OutsideChunk[]): string {
  const lines = [`OTC 1 ${chunks.length}`]
  for (const k of chunks) { lines.push(`${k.x.toFixed(2)} ${k.z.toFixed(2)} ${k.size} ${k.res}`); lines.push(k.heights.map((h) => h.toFixed(2)).join(' ')) }
  return lines.join('\n')
}
