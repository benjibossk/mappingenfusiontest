// Land cover on the terrain grid: forest and field areas (OpenStreetMap, realWorld.ts) rasterised to one
// code per grid vertex, used by computeSurfaces to paint forest floor and crop field instead of grass.
//   0 nothing, 1 broadleaved forest, 2 needleleaved forest, 3 mixed forest, 4 field

import type { Grid } from './island'

export interface CoverArea { kind: 'forest' | 'field'; leaf?: 'broad' | 'needle' | 'mixed'; pts: number[] }

const CODE = { broad: 1, needle: 2, mixed: 3 } as const

export function rasterCover(grid: Grid, areas: CoverArea[]): Uint8Array | undefined {
  if (!areas.length) return undefined
  const { cols, rows, step, minX, minZ } = grid
  const out = new Uint8Array(cols * rows)
  // fields first: a forest drawn over a meadow wins
  const order = [...areas.filter((a) => a.kind === 'field'), ...areas.filter((a) => a.kind === 'forest')]
  for (const a of order) {
    const p = a.pts
    if (p.length < 6) continue
    const code = a.kind === 'field' ? 4 : CODE[a.leaf ?? 'mixed']
    let z0 = Infinity, z1 = -Infinity
    for (let k = 1; k < p.length; k += 2) { z0 = Math.min(z0, p[k]); z1 = Math.max(z1, p[k]) }
    const r0 = Math.max(0, Math.ceil((z0 - minZ) / step)), r1 = Math.min(rows - 1, Math.floor((z1 - minZ) / step))
    // scanline fill: crossings of each row with the polygon edges
    for (let r = r0; r <= r1; r++) {
      const z = minZ + r * step
      const xs: number[] = []
      for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) {
        const za = p[i + 1], zb = p[j + 1]
        if (za > z !== zb > z) xs.push(p[i] + ((z - za) * (p[j] - p[i])) / (zb - za))
      }
      xs.sort((u, v) => u - v)
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const c0 = Math.max(0, Math.ceil((xs[k] - minX) / step)), c1 = Math.min(cols - 1, Math.floor((xs[k + 1] - minX) / step))
        for (let c = c0; c <= c1; c++) out[r * cols + c] = code
      }
    }
  }
  return out
}
