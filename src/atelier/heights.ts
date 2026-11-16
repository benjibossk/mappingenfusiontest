// Whole-terrain height grid assembled from the .ttile HGHT chunks (no Workbench needed).
// Tiles share their border row/column; placement comes from each tile's LRS2 block index.
// Same idea as giorbev's bterr_reader.load_workbench_heights (MIT, Copyright (c) giorbev), but reading the
// game tiles (.Data/*.ttile) instead of the editor .bterr files, which are not always present.
import type { TerrInfo } from './formats/terr.ts'
import type { TileData } from './formats/ttile.ts'

export interface HeightGrid { cols: number; rows: number; cell: number; h: Float32Array; min: number; max: number; missing: number }

export function assembleHeights(terr: TerrInfo, tiles: TileData[]): HeightGrid {
  const n = terr.cellsPerTile, cols = terr.tilesX * n + 1, rows = terr.tilesZ * n + 1
  const h = new Float32Array(cols * rows)
  const done = new Set<string>()
  for (const t of tiles) {
    if (!t.heights || t.side !== n + 1 || t.tx < 0 || t.tx >= terr.tilesX || t.ty < 0 || t.ty >= terr.tilesZ) continue
    done.add(t.tx + ',' + t.ty)
    for (let r = 0; r <= n; r++) for (let c = 0; c <= n; c++)
      h[(t.ty * n + r) * cols + t.tx * n + c] = t.heights[r * (n + 1) + c] * terr.heightScale + terr.heightOffset
  }
  let min = Infinity, max = -Infinity
  for (const v of h) { if (v < min) min = v; if (v > max) max = v }
  return { cols, rows, cell: terr.cellSize, h, min, max, missing: terr.tilesX * terr.tilesZ - done.size }
}

/** bilinear height at world (x, z); row 0 = south (z = 0) */
export function heightAt(g: HeightGrid, x: number, z: number): number {
  const fx = Math.min(Math.max(x / g.cell, 0), g.cols - 1.001), fz = Math.min(Math.max(z / g.cell, 0), g.rows - 1.001)
  const c = Math.floor(fx), r = Math.floor(fz), u = fx - c, v = fz - r, i = r * g.cols + c
  return (g.h[i] * (1 - u) + g.h[i + 1] * u) * (1 - v) + (g.h[i + g.cols] * (1 - u) + g.h[i + g.cols + 1] * u) * v
}
