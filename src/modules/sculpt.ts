// Sculpting the way mapgen4 feels: the brush edits a COARSE elevation (macro, ~32 m cells), fine
// detail noise is added on top, so every stroke stays smooth and natural; the fine grid is recomposed
// after each stroke step (cheap), rivers can follow live.

import { noise2 } from './island'

export class Sculpt {
  readonly mc: number // macro nodes per side
  readonly mcell: number // metres between macro nodes
  macro: Float32Array
  private detail: Float32Array
  heights: number[]
  private cols: number
  private step: number
  private maxHeight: number
  seaDepth = 30

  constructor(
    cols: number,
    step: number,
    maxHeight: number,
    seed: number,
    fine: number[], // initial fine heights (generated island)
    macroCell = 32,
  ) {
    this.cols = cols
    this.step = step
    this.maxHeight = maxHeight
    const size = (cols - 1) * step
    this.mc = Math.round(size / macroCell) + 1
    this.mcell = size / (this.mc - 1)
    this.macro = new Float32Array(this.mc * this.mc)
    // macro = local average of the generated heights (keeps the island shape, drops fine noise)
    const k = Math.max(1, Math.round(this.mcell / step / 2))
    for (let r = 0; r < this.mc; r++) {
      for (let c = 0; c < this.mc; c++) {
        const fc = Math.round((c * this.mcell) / step), fr = Math.round((r * this.mcell) / step)
        let sum = 0, n = 0
        for (let dr = -k; dr <= k; dr++) for (let dc = -k; dc <= k; dc++) {
          const rr = fr + dr, cc = fc + dc
          if (rr >= 0 && cc >= 0 && rr < cols && cc < cols) { sum += fine[rr * cols + cc]; n++ }
        }
        this.macro[r * this.mc + c] = sum / n
      }
    }
    // 3 octaves: finest period ~35 m, well above the 8 m grid (finer octaves aliased into hatching)
    const nz = noise2(seed * 31 + 7, 3)
    this.detail = new Float32Array(cols * cols)
    for (let r = 0; r < cols; r++)
      for (let c = 0; c < cols; c++) this.detail[r * cols + c] = nz((c * step) / 140, (r * step) / 140) - 0.5
    this.heights = new Array(cols * cols)
    this.compose()
  }

  //! Catmull-Rom bicubic: smooth slopes across macro cells (smoothstep flattened the slope at every
  //! node, which showed as a 32 m hatching in the relief)
  private macroAt(x: number, z: number) {
    const m = this.mc, M = this.macro
    const gx = Math.min(Math.max(x / this.mcell, 0), m - 1), gz = Math.min(Math.max(z / this.mcell, 0), m - 1)
    const x0 = Math.min(Math.floor(gx), m - 2), z0 = Math.min(Math.floor(gz), m - 2)
    const tx = gx - x0, tz = gz - z0
    const cr = (p0: number, p1: number, p2: number, p3: number, t: number) =>
      p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)))
    const at = (c: number, r: number) => M[Math.min(Math.max(r, 0), m - 1) * m + Math.min(Math.max(c, 0), m - 1)]
    const row = (r: number) => cr(at(x0 - 1, r), at(x0, r), at(x0 + 1, r), at(x0 + 2, r), tx)
    return cr(row(z0 - 1), row(z0), row(z0 + 1), row(z0 + 2), tz)
  }

  //! fine heights = smooth macro + detail (stronger on high ground, faint under the sea)
  compose() {
    const { cols, step } = this
    for (let r = 0; r < cols; r++) {
      for (let c = 0; c < cols; c++) {
        const m = this.macroAt(c * step, r * step)
        const rough = m > 0 ? 3 + 0.12 * Math.min(m, this.maxHeight) : 1.5
        let h = m + this.detail[r * cols + c] * rough
        // the map edge stays sea whatever is painted: no land cut by the border
        const edge = Math.min(c, r, cols - 1 - c, cols - 1 - r) / (cols - 1)
        if (edge < 0.06) {
          const t = edge / 0.06
          const floor = -this.seaDepth
          h = floor + (Math.min(h, -2) - floor) * t * t + (h - Math.min(h, -2)) * t * t * t
        }
        this.heights[r * cols + c] = h
      }
    }
    return this.heights
  }

  //! one brush step on the macro grid. dt-like strength: metres per step at the brush centre.
  brush(tool: string, x: number, z: number, radius: number, strength: number, seaDepth: number) {
    const m = this.mc, M = this.macro
    const rc = Math.ceil(radius / this.mcell)
    const c0 = Math.round(x / this.mcell), r0 = Math.round(z / this.mcell)
    const centre = this.macroAt(x, z)
    const src = tool === 'smooth' ? M.slice() : M
    for (let r = Math.max(0, r0 - rc); r <= Math.min(m - 1, r0 + rc); r++) {
      for (let c = Math.max(0, c0 - rc); c <= Math.min(m - 1, c0 + rc); c++) {
        const d = Math.hypot(c * this.mcell - x, r * this.mcell - z) / radius
        if (d >= 1) continue
        const w = Math.pow(0.5 + 0.5 * Math.cos(d * Math.PI), 1.5) // soft edge
        const i = r * m + c
        const h = M[i]
        const blend = (target: number) => h + (target - h) * Math.min(1, w * strength * 0.03)
        switch (tool) {
          case 'raise': M[i] = h + strength * w; break
          case 'lower': M[i] = h - strength * w; break
          case 'flatten': M[i] = blend(centre); break
          case 'sea': M[i] = blend(-seaDepth); break
          case 'smooth': {
            let sum = 0, n = 0
            for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
              const rr = r + dr, cc = c + dc
              if (rr >= 0 && cc >= 0 && rr < m && cc < m) { sum += src[rr * m + cc]; n++ }
            }
            M[i] = blend(sum / n)
          }
        }
      }
    }
  }
}
