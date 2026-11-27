// Atelier zones: thin adapter between the Atelier's full-resolution HeightGrid (heights.ts, whole world, any
// size) and the generator modules (src/modules/*), which read a flat height array + an island Grid
// {minX, minZ, step, cols, rows}. Only the zone's bounding box (+ margin) is copied, at the native cell size:
// no 768-cell cap, no downsampling of the world. Memory stays bounded: past maxCells the copy takes every k-th
// sample (k reported), which only happens for zones of several km at 1 m.
import type { HeightGrid } from '../heights.ts'
import type { Grid } from '../../modules/island.ts'

export const MAX_ZONE_CELLS = 9_000_000 // 36 MB of Float32: a 3 x 3 km zone at 1 m
export type Box = [number, number, number, number] // x0, z0, x1, z1 (world metres)

export function ringBox(ring: number[]): Box {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity
  for (let i = 0; i + 1 < ring.length; i += 2) {
    x0 = Math.min(x0, ring[i]); x1 = Math.max(x1, ring[i]); z0 = Math.min(z0, ring[i + 1]); z1 = Math.max(z1, ring[i + 1])
  }
  return [x0, z0, x1, z1]
}
export const growBox = (b: Box, m: number): Box => [b[0] - m, b[1] - m, b[2] + m, b[3] + m]
export const unionBox = (a: Box, b: Box): Box => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])]
export const inBox = (b: Box, x: number, z: number) => x >= b[0] && x <= b[2] && z >= b[1] && z <= b[3]

export interface ZoneGrid { heights: Float32Array; grid: Grid; k: number }

/** copy of the world heights over `box` at the native cell (every k-th sample when the box exceeds maxCells),
 *  as the generator's heights + Grid. Grid origin is on a world sample, so sampling it is exact at nodes. */
export function cropHeights(H: HeightGrid, box: Box, maxCells = MAX_ZONE_CELLS, minStep = 0): ZoneGrid {
  const cell = H.cell
  const c0 = Math.max(0, Math.floor(box[0] / cell)), c1 = Math.min(H.cols - 1, Math.ceil(box[2] / cell))
  const r0 = Math.max(0, Math.floor(box[1] / cell)), r1 = Math.min(H.rows - 1, Math.ceil(box[3] / cell))
  if (c1 - c0 < 1 || r1 - r0 < 1) throw new Error('zone outside the terrain')
  let k = Math.max(1, Math.ceil(minStep / cell))
  while (((Math.floor((c1 - c0) / k) + 1) * (Math.floor((r1 - r0) / k) + 1)) > maxCells) k++
  const cols = Math.floor((c1 - c0) / k) + 1, rows = Math.floor((r1 - r0) / k) + 1
  const h = new Float32Array(cols * rows)
  for (let r = 0; r < rows; r++) {
    const src = (r0 + r * k) * H.cols + c0
    if (k === 1) h.set(H.h.subarray(src, src + cols), r * cols)
    else for (let c = 0; c < cols; c++) h[r * cols + c] = H.h[src + c * k]
  }
  return { heights: h, grid: { minX: c0 * cell, minZ: r0 * cell, step: cell * k, cols, rows }, k }
}
