// Per-platform object budgets (docs/PLATFORM_LIMITS.md). Bohemia publishes no hard numbers: these are
// conservative heuristics calibrated on the vanilla maps (Everon / Arland densities) and console
// frame-pacing reports. A warning is advice, never a block.
import { inPoly } from './validate'

export type Platform = 'pc' | 'xsx' | 'ps5' | 'xss'
export interface Budget { perKm2: number; total: number }
/** objects (entities: buildings, props, trees) per km² averaged on a 256 m cell, and per map */
export const PLATFORM_BUDGETS: Record<Platform, Budget> = {
  pc: { perKm2: 40000, total: 4_000_000 },
  xsx: { perKm2: 28000, total: 2_800_000 },
  ps5: { perKm2: 28000, total: 2_800_000 },
  xss: { perKm2: 20000, total: 2_000_000 },
}
export const PLATFORMS = Object.keys(PLATFORM_BUDGETS) as Platform[]
/** trees per m² the forest generators produce at default settings (≈ 200 per ha) */
export const FOREST_TREES_PER_M2 = 0.02
export const BUDGET_CELL = 256

export interface DensityGrid { cell: number; cols: number; rows: number; counts: Float32Array; total: number }

/** counts per cell: each point object = 1, each forest polygon adds trees sampled on a 16 m lattice */
export function densityGrid(o: { width: number; height: number; objects: { x: number; z: number }[]; forests?: number[][]; cell?: number; treesPerM2?: number }): DensityGrid {
  const cell = o.cell ?? BUDGET_CELL
  const cols = Math.max(1, Math.ceil(o.width / cell)), rows = Math.max(1, Math.ceil(o.height / cell))
  const counts = new Float32Array(cols * rows)
  let total = 0
  const add = (x: number, z: number, n: number) => {
    const c = Math.min(cols - 1, Math.max(0, Math.floor(x / cell))), r = Math.min(rows - 1, Math.max(0, Math.floor(z / cell)))
    counts[r * cols + c] += n; total += n
  }
  for (const p of o.objects) add(p.x, p.z, 1)
  const s = 16, perSample = s * s * (o.treesPerM2 ?? FOREST_TREES_PER_M2)
  for (const pts of o.forests ?? []) {
    if (pts.length < 6) continue
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity
    for (let i = 0; i < pts.length; i += 2) { x0 = Math.min(x0, pts[i]); x1 = Math.max(x1, pts[i]); z0 = Math.min(z0, pts[i + 1]); z1 = Math.max(z1, pts[i + 1]) }
    for (let z = Math.floor(z0 / s) * s + s / 2; z < z1; z += s) for (let x = Math.floor(x0 / s) * s + s / 2; x < x1; x += s) if (inPoly(x, z, pts)) add(x, z, perSample)
  }
  return { cell, cols, rows, counts, total }
}

/** cells above the platform's per-km² budget, with their count */
export function overBudgetCells(g: DensityGrid, platform: Platform): { x: number; z: number; count: number; max: number }[] {
  const max = Math.round(PLATFORM_BUDGETS[platform].perKm2 * (g.cell * g.cell) / 1e6)
  const out: { x: number; z: number; count: number; max: number }[] = []
  for (let r = 0; r < g.rows; r++) for (let c = 0; c < g.cols; c++) {
    const n = g.counts[r * g.cols + c]
    if (n > max) out.push({ x: (c + 0.5) * g.cell, z: (r + 0.5) * g.cell, count: Math.round(n), max })
  }
  return out
}
