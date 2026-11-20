// Final surface masks for the preview: the same painting + per-block limit as the bridge export
// (src/shared/maskPaint.mjs), so the drape shows the surfaces the engine will get (roads, water banks,
// building yards stamped in, blocks limited to 4 painted surfaces + default) and not only the app's grid.
// The engine mask is ~1 m/px (side = tiles * 252 + 1, 4 blocks of 63 px per tile); the preview paints the
// same blocks at 8 px each (about 8x coarser: ~2-3 s for 4096 m, 16 px took ~11 s), in a worker when possible.
import { paintMasks, type MaskColours, type MaskRoad, type MaskSurface } from '../shared/maskPaint.mjs'

export interface MaskBody { terrainSize: number; surfaces: MaskSurface[]; roads: MaskRoad[]; colours: MaskColours }
export interface FinalLayer { name: string; minX: number; minZ: number; step: number; cols: number; rows: number; weights: Float32Array }
export interface Painted { side: number; names: string[]; bytes: Uint8Array[] }

/** preview resolution: same block count as the engine mask (tiles of 252 px at ~1 m/px), blockPx px per block */
export function previewGrid(terrainSize: number, blockPx = 8) {
  const tiles = Math.max(1, Math.ceil(terrainSize / 252))
  return { side: tiles * 4 * blockPx + 1, blockPx, margin: Math.max(1, Math.round((3 * blockPx) / 63)) }
}

/** pixels (row 0 = north) as drape layers on a vertex grid (row 0 = south), origin 0,0 as the export */
export function toLayers(p: Painted, terrainSize: number): FinalLayer[] {
  const { side } = p
  return p.names.map((name, k) => {
    const a = p.bytes[k], w = new Float32Array(side * side)
    for (let row = 0; row < side; row++) {
      const src = row * side, dst = (side - 1 - row) * side
      for (let c = 0; c < side; c++) w[dst + c] = a[src + c] / 255
    }
    return { name, minX: 0, minZ: 0, step: terrainSize / (side - 1), cols: side, rows: side, weights: w }
  })
}

export function paintPreview(body: MaskBody, g = previewGrid(body.terrainSize)): Painted {
  const r = paintMasks(g.side, body.terrainSize, body.surfaces, body.roads, body.colours, g.blockPx, g.margin)
  return { side: g.side, ...r }
}

let last: { key: string; layers: FinalLayer[] } | null = null
/** paints in a worker (fallback: here), resolves to drape layers; the last result is reused while the body is unchanged */
export async function finalLayers(body: MaskBody): Promise<FinalLayer[]> {
  const g = previewGrid(body.terrainSize)
  const key = JSON.stringify([g, body])
  if (last?.key === key) return last.layers
  let p: Painted | null = null
  if (typeof Worker !== 'undefined') {
    try {
      const w = new Worker(new URL('../workers/maskPaint.worker.ts', import.meta.url), { type: 'module' })
      p = await new Promise<Painted>((res, rej) => {
        w.onmessage = (e) => { w.terminate(); if (e.data.err) rej(new Error(e.data.err)); else res(e.data.ok) }
        w.onerror = (e) => { w.terminate(); rej(new Error(e.message)) }
        w.postMessage({ body, g })
      })
    } catch { p = null }
  }
  const layers = toLayers(p ?? paintPreview(body, g), body.terrainSize)
  last = { key, layers }
  return layers
}
