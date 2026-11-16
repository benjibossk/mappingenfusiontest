// "Continuer dans le générateur": turn the world read by the Atelier into a generator project
// (the same `reforger-mapper-island` JSON that main.ts saves / opens / autosaves), so no change to main.ts
// is needed: the project is written to the autosave key and the page reloads (main.ts restores it at boot),
// or, if it does not fit in localStorage, downloaded as a file for "Ouvrir un projet".
import type { HeightGrid } from './heights.ts'
import type { WaterBody, RoadSurface } from './formats/layer.ts'

export const PROJECT_KEY = 'reforger-mapper.island' // main.ts autosave key (restored at startup)
export const MAX_COLS = 768 // ~3 MB of base64 heights: fits the ~5 M-char localStorage quota

const b64 = (a: Uint8Array) => { let s = ''; for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode(...a.subarray(i, i + 0x8000)); return btoa(s) }

/** same coarse grid as Sculpt's constructor (src/modules/sculpt.ts): loadProject checks its length */
export function macroOf(fine: Float32Array, cols: number, step: number, macroCell = 32): Float32Array {
  const size = (cols - 1) * step, mc = Math.round(size / macroCell) + 1, mcell = size / (mc - 1)
  const macro = new Float32Array(mc * mc), k = Math.max(1, Math.round(mcell / step / 2))
  for (let r = 0; r < mc; r++) for (let c = 0; c < mc; c++) {
    const fc = Math.round((c * mcell) / step), fr = Math.round((r * mcell) / step)
    let sum = 0, n = 0
    for (let dr = -k; dr <= k; dr++) for (let dc = -k; dc <= k; dc++) {
      const rr = fr + dr, cc = fc + dc
      if (rr >= 0 && cc >= 0 && rr < cols && cc < cols) { sum += fine[rr * cols + cc]; n++ }
    }
    macro[r * mc + c] = sum / n
  }
  return macro
}

/** square, downsampled copy of the height grid (the generator grid is square) */
export function downsample(H: HeightGrid, maxCols = MAX_COLS): { cols: number; step: number; h: Float32Array } {
  const side = Math.min(H.cols, H.rows), k = Math.max(1, Math.ceil((side - 1) / (maxCols - 1)))
  const cols = Math.floor((side - 1) / k) + 1, h = new Float32Array(cols * cols)
  for (let r = 0; r < cols; r++) for (let c = 0; c < cols; c++) h[r * cols + c] = H.h[r * k * H.cols + c * k]
  return { cols, step: H.cell * k, h }
}

const ROAD: Record<RoadSurface, string> = { asphalt: 'asphalt', concrete: 'concrete', dirt: 'dirt' }

export function islandProject(H: HeightGrid, opts: { bodies?: WaterBody[]; roads?: { type: RoadSurface; pts: [number, number][] }[]; seed?: number; ocean?: number } = {}) {
  const { cols, step, h } = downsample(H), ocean = opts.ocean ?? 0
  const rel = h.map((v) => v - ocean)
  let top = 1
  for (const v of rel) top = Math.max(top, v)
  const waters = (opts.bodies ?? []).filter((b) => b.x.length >= 2).map((b, i) => ({
    id: 'at-w' + i, type: b.kind === 'lake' ? 'lake' : 'river', pts: b.x.flatMap((x, j) => [x, b.z[j]]),
    width: b.width ?? 8, depth: 2,
  }))
  const roads = (opts.roads ?? []).filter((r) => r.pts.length >= 2).map((r, i) => ({ id: 'at-r' + i, type: ROAD[r.type], pts: r.pts.flat() }))
  return {
    kind: 'reforger-mapper-island', version: 1, inputs: { tSeed: String(opts.seed ?? 1) },
    macro: b64(new Uint8Array(macroOf(rel, cols, step).buffer)), sink: null,
    roads, sites: [], waters, fields: null, noBridge: [],
    imported: { minX: 0, minZ: 0, step, cols, rows: cols, ocean, materials: [], surfaces: [], heights: b64(new Uint8Array(h.buffer.slice(0))) },
    existing: { objects: [], shapes: [] }, removed: [], areas: [], landCover: null, credits: [], power: [],
    topHint: top,
  }
}

/** hand the project to the generator: autosave slot + reload, else a file to open with "Ouvrir un projet" */
export function continueInGenerator(p: ReturnType<typeof islandProject>): 'reload' | 'download' {
  const json = JSON.stringify(p)
  try {
    localStorage.setItem(PROJECT_KEY, json)
    try { sessionStorage.removeItem('reforger-mapper.atelier.open') } catch { /* blocked */ }
    location.reload()
    return 'reload'
  } catch {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }))
    a.download = 'atelier-projet.json'
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 5000)
    return 'download'
  }
}
