// Road embankments: where a road bed is laid above the surrounding ground (a road crossing a hollow),
// the fill gets shoulders at a constant slope (1:2) instead of the short 3-cell cosine ramp, so the
// bank never drops as a cliff. Only raises the ground, never touches open water (lakes, rivers).
import type { Grid } from './island'
import type { RoadBeds } from './roads'

export const EMBANK_SLOPE = 0.5 // height lost per metre away from the bed edge (1:2)
export const EMBANK_MIN_FILL = 0.4 // m of fill before a shoulder is worth building
const MAX_REACH = 40 // m, caps the shoulder width (and the cost)

//! raises the cells around the road beds so the ground falls away from the bed at most EMBANK_SLOPE
//! `wet` (carveWater levels.wet): cells left alone. Returns the number of cells raised.
export function embankRoads(heights: number[], grid: Grid, beds: RoadBeds, wet?: Uint8Array): number {
  const { cols, rows, step } = grid
  const raise = new Float32Array(heights.length).fill(-Infinity)
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const k = r * cols + c
      if (!(beds.weight[k] >= 0.99)) continue
      const top = heights[k]
      // fill relative to the lowest 4-neighbour outside the bed core: only bed edges in fill matter
      let low = Infinity
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const cc = c + dc, rr = r + dr
        if (cc < 0 || rr < 0 || cc >= cols || rr >= rows) continue
        const n = rr * cols + cc
        if (beds.weight[n] >= 0.99) continue
        low = Math.min(low, heights[n])
      }
      if (!(top - low > EMBANK_MIN_FILL)) continue
      const reach = Math.min(MAX_REACH, (top - low) / EMBANK_SLOPE + step)
      const R = Math.ceil(reach / step)
      for (let dr = -R; dr <= R; dr++)
        for (let dc = -R; dc <= R; dc++) {
          const cc = c + dc, rr = r + dr
          if (cc < 0 || rr < 0 || cc >= cols || rr >= rows) continue
          const n = rr * cols + cc
          if (beds.weight[n] >= 0.99 || (wet && wet[n])) continue
          const d = Math.hypot(dc, dr) * step
          if (d > reach) continue
          const v = top - d * EMBANK_SLOPE
          if (v > raise[n]) raise[n] = v
        }
    }
  let count = 0
  for (let k = 0; k < heights.length; k++)
    if (raise[k] > heights[k]) { heights[k] = raise[k]; count++ }
  return count
}
