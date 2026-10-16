// Height grid of the world open in the Workbench (bridge GET /heights → MG_ExportHeights).

export interface Heightmap {
  minX: number
  minZ: number
  step: number
  cols: number
  rows: number
  ocean: number
  heights: number[] // row-major, row 0 = minZ
}

export async function loadHeightmap(bridgeUrl: string, step = 8): Promise<Heightmap> {
  const res = await fetch(`${bridgeUrl}/heights?step=${step}`)
  const body = await res.json()
  if (!res.ok) throw new Error(body.error ?? body.message ?? `HTTP ${res.status}`)
  return body
}

/** bilinear height at world X/Z, clamped to the grid */
export function heightAt(h: Heightmap, x: number, z: number): number {
  const fx = Math.min(Math.max((x - h.minX) / h.step, 0), h.cols - 1)
  const fz = Math.min(Math.max((z - h.minZ) / h.step, 0), h.rows - 1)
  const c0 = Math.floor(fx), r0 = Math.floor(fz)
  const c1 = Math.min(c0 + 1, h.cols - 1), r1 = Math.min(r0 + 1, h.rows - 1)
  const tx = fx - c0, tz = fz - r0
  const at = (c: number, r: number) => h.heights[r * h.cols + c]
  const top = at(c0, r0) * (1 - tx) + at(c1, r0) * tx
  const bottom = at(c0, r1) * (1 - tx) + at(c1, r1) * tx
  return top * (1 - tz) + bottom * tz
}

/** land = above the sea level plus a small shore margin */
export const isLand = (h: Heightmap, x: number, z: number, margin = 0.5) => heightAt(h, x, z) > h.ocean + margin

/** hillshade + sea tint, one pixel per grid cell, north (max Z) at the top */
export function renderTerrain(h: Heightmap): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = h.cols
  canvas.height = h.rows
  const ctx = canvas.getContext('2d')!
  const img = ctx.createImageData(h.cols, h.rows)
  const at = (c: number, r: number) => h.heights[Math.min(Math.max(r, 0), h.rows - 1) * h.cols + Math.min(Math.max(c, 0), h.cols - 1)]

  for (let r = 0; r < h.rows; r++) {
    for (let c = 0; c < h.cols; c++) {
      const y = at(c, r)
      // light from the north-west
      const dx = (at(c + 1, r) - at(c - 1, r)) / (2 * h.step)
      const dz = (at(c, r + 1) - at(c, r - 1)) / (2 * h.step)
      const shade = Math.max(0, Math.min(1, 0.6 - 1.2 * dx + 1.2 * dz))
      const i = ((h.rows - 1 - r) * h.cols + c) * 4
      if (y <= h.ocean) {
        const depth = Math.min(1, (h.ocean - y) / 60)
        img.data[i] = 40 - 25 * depth
        img.data[i + 1] = 90 - 45 * depth
        img.data[i + 2] = 140 - 40 * depth
      } else {
        const t = Math.min(1, (y - h.ocean) / 150)
        img.data[i] = (95 + 90 * t) * (0.45 + shade * 0.75)
        img.data[i + 1] = (120 + 50 * t) * (0.45 + shade * 0.75)
        img.data[i + 2] = (70 + 60 * t) * (0.45 + shade * 0.75)
      }
      img.data[i + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)
  return canvas
}
