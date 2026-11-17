// Ground masks from terrain shape (P2 #10/#11): TPI (height minus the local mean) and curvature
// (laplacian) from the heightmap, turned into soft ramps/bells so rock and gravel climb the ridges and
// steep flanks while moist grass fills the hollows. A low-frequency noise splits the grass into
// variants. No hard thresholds: every weight is a smooth ramp, the 5-surfaces-per-block limit is still
// applied afterwards by limitPerBlock (island.ts).

export interface TerrainShape {
  /** height minus the mean height within `radius` metres (m, > 0 = ridge / crest, < 0 = hollow) */
  tpi: Float32Array
  /** laplacian of the height (1/m, > 0 = concave hollow, < 0 = convex crest) */
  curv: Float32Array
}

export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)
/** smooth ramp 0 -> 1 between a and b (smoothstep, a > b gives a falling ramp) */
export function ramp(v: number, a: number, b: number): number {
  const t = clamp01((v - a) / (b - a))
  return t * t * (3 - 2 * t)
}
/** bell: 1 at `centre`, 0 beyond `centre ± width` (smooth) */
export function bell(v: number, centre: number, width: number): number {
  const t = clamp01(1 - Math.abs(v - centre) / width)
  return t * t * (3 - 2 * t)
}

//! TPI over a square window (summed-area table, O(n)) and the 4-neighbour laplacian.
export function terrainShape(heights: ArrayLike<number>, cols: number, rows: number, step: number, radius = 60): TerrainShape {
  const n = cols * rows
  const sat = new Float64Array((cols + 1) * (rows + 1))
  for (let r = 0; r < rows; r++) {
    let line = 0
    for (let c = 0; c < cols; c++) {
      line += heights[r * cols + c]
      sat[(r + 1) * (cols + 1) + c + 1] = sat[r * (cols + 1) + c + 1] + line
    }
  }
  const k = Math.max(1, Math.round(radius / step))
  const tpi = new Float32Array(n)
  const curv = new Float32Array(n)
  const at = (c: number, r: number) => heights[Math.min(Math.max(r, 0), rows - 1) * cols + Math.min(Math.max(c, 0), cols - 1)]
  for (let r = 0; r < rows; r++) {
    const r0 = Math.max(0, r - k), r1 = Math.min(rows, r + k + 1)
    for (let c = 0; c < cols; c++) {
      const c0 = Math.max(0, c - k), c1 = Math.min(cols, c + k + 1)
      const sum = sat[r1 * (cols + 1) + c1] - sat[r0 * (cols + 1) + c1] - sat[r1 * (cols + 1) + c0] + sat[r0 * (cols + 1) + c0]
      const i = r * cols + c
      tpi[i] = heights[i] - sum / ((r1 - r0) * (c1 - c0))
      curv[i] = (at(c + 1, r) + at(c - 1, r) + at(c, r + 1) + at(c, r - 1) - 4 * heights[i]) / (step * step)
    }
  }
  return { tpi, curv }
}

export interface GroundWeights {
  /** bare rock on crests / steep flanks (share of the free ground) */
  rock: number
  /** gravel / scree on ridges and moderate slopes */
  gravel: number
  /** moist grass in hollows */
  moist: number
  /** variant split of the remaining grass (0..1, low-frequency noise) */
  variant: number
}

//! Weights of the inland ground at one vertex, each 0..1 and summing to <= 1 (painted by priority:
//! rock, then gravel, then moist grass; the rest stays grass). `noise` is a 0..1 low-frequency value.
export function groundWeights(slope: number, tpi: number, curv: number, noise: number): GroundWeights {
  const ridge = ramp(tpi, 0.5, 4) * ramp(curv, 0.002, -0.01) // crest: above the mean and convex
  const hollow = ramp(tpi, -0.3, -3) * (0.5 + 0.5 * ramp(curv, -0.003, 0.006)) * ramp(slope, 0.25, 0.08)
  let free = 1
  const take = (w: number) => { const t = Math.min(free, clamp01(w)); free -= t; return t }
  // noise breaks the iso-lines: some crests stay grassy, some flanks go to gravel earlier
  const n = (noise - 0.5) * 2
  const rock = take(ridge * ramp(slope, 0.2 - 0.05 * n, 0.45) + 0.6 * ramp(slope, 0.5, 0.8))
  const gravel = take(ridge * bell(slope, 0.2 + 0.04 * n, 0.25) * 0.8 + ramp(slope, 0.3, 0.5) * 0.35)
  const moist = take(hollow * (0.7 + 0.3 * n))
  return { rock, gravel, moist, variant: ramp(noise, 0.4, 0.65) }
}
