// Map layer: object density per 256 m cell against the chosen platform budget (green → red, outlined when over).
import type { DensityGrid } from './platformBudget'

export function densityColour(ratio: number): string {
  const r = Math.min(1, Math.max(0, ratio))
  const hue = 120 - 120 * r // green → red
  return `hsla(${hue},85%,50%,${0.12 + 0.38 * r})`
}

export function drawDensityHeat(ctx: CanvasRenderingContext2D, g: DensityGrid, perKm2: number, toScreen: (x: number, z: number) => [number, number] | number[]) {
  const max = perKm2 * g.cell * g.cell / 1e6
  for (let r = 0; r < g.rows; r++) for (let c = 0; c < g.cols; c++) {
    const n = g.counts[r * g.cols + c]
    if (n <= 0) continue
    const [x0, y0] = toScreen(c * g.cell, r * g.cell), [x1, y1] = toScreen((c + 1) * g.cell, (r + 1) * g.cell)
    const x = Math.min(x0, x1), y = Math.min(y0, y1), w = Math.abs(x1 - x0), h = Math.abs(y1 - y0)
    ctx.fillStyle = densityColour(n / max)
    ctx.fillRect(x, y, w, h)
    if (n > max) { ctx.strokeStyle = 'rgba(255,40,40,0.95)'; ctx.lineWidth = 2; ctx.strokeRect(x + 1, y + 1, w - 2, h - 2) }
  }
}
