// A world exported from the Workbench (bridge GET /world) turned into the site's island: heights
// (sea level brought to 0, like the generated islands) and one weight grid per ground material.
// The materials are the physical ones under the terrain layers (grass, dirt, asphalt...): their
// colours are guessed from the name.

import type { WorldExport } from '../bridge'
import type { Island, SurfaceGrid } from './island'

const GUESS: [RegExp, [number, number, number]][] = [
  [/asphalt|road|concrete|tarmac/i, [70, 70, 72]],
  [/sand|beach/i, [176, 160, 120]],
  [/rock|stone|cliff|gravel|pebble/i, [112, 108, 100]],
  [/mud|dirt|soil|earth|field/i, [112, 90, 62]],
  [/forest|needle|leaves|moss/i, [62, 74, 44]],
  [/water|sea|seabed/i, [60, 80, 96]],
  [/grass|meadow/i, [82, 98, 54]],
]

export function worldToIsland(w: WorldExport): Island {
  const grid = { minX: w.minX, minZ: w.minZ, step: w.step, cols: w.cols, rows: w.rows }
  const heights = w.heights.map((h) => h - (w.ocean || 0))
  const surfaces: SurfaceGrid[] = w.materials.map((name, k) => ({ ...grid, name, weights: w.surfaces.map((s) => (s === k ? 1 : 0)) }))
  const colours: Island['colours'] = {}
  for (const name of w.materials) colours[name] = GUESS.find(([re]) => re.test(name))?.[1] ?? [128, 120, 110]
  return { grid, heights, surfaces, colours }
}
