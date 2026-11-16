// Terrain textures baked by Workbench in the world's .Data folder, read with the EDDS decoder:
//  - <prefix>N_layer.edds        painted weights of the 7 slots → coverage per block ("slots négligeables")
//  - <prefix>N_supertexture.edds per-tile colour → textured satellite map (giorbev's "Satmap V2" idea)
// Tile N = ty * tilesX + tx; tile image row r = local block row r (same order as LRS2 blocks and giorbev's
// tile_inspector.py, MIT, Copyright (c) giorbev).
import type { TerrInfo } from './formats/terr.ts'
import type { TileData } from './formats/ttile.ts'
import type { Coverage } from './diag.ts'
import { blockCoverage, decodeColor, decodeLayer } from './formats/edds.ts'

export interface SatImage { W: number; H: number; data: Uint8ClampedArray } // row 0 = north

const tileId = (name: string, prefix: string, suffix: string) => {
  if (!name.startsWith(prefix) || !name.endsWith(suffix)) return -1
  const s = name.slice(prefix.length, name.length - suffix.length)
  return /^\d+$/.test(s) ? Number(s) : -1
}

export function coverageFrom(terr: TerrInfo, tiles: TileData[], files: { name: string; bytes: Uint8Array }[], prefix: string): Coverage | null {
  const bpt = terr.blocksPerTile, byId = new Map(tiles.map((t) => [t.ty * terr.tilesX + t.tx, t]))
  const blocks = new Map<string, number[]>()
  let blockPx = 0
  for (const f of files) {
    const t = byId.get(tileId(f.name, prefix, '_layer.edds')); if (!t) continue
    let L
    try { L = decodeLayer(f.bytes) } catch { continue }
    for (const b of t.blocks) {
      const c = blockCoverage(L, bpt, b.bx - t.tx * bpt, b.by - t.ty * bpt, Math.min(7, b.mats.length))
      blocks.set(b.bx + ',' + b.by, c.cover); blockPx = c.px
    }
  }
  return blocks.size ? { blockPx, blocks } : null
}

/** mosaic of the tiles' supertextures, at most maxSide pixels wide; tiles missing stay transparent */
export function satFrom(terr: TerrInfo, files: { name: string; bytes: Uint8Array }[], prefix: string, maxSide = 4096): SatImage | null {
  let tp = 0
  const imgs = new Map<number, ReturnType<typeof decodeColor>>()
  for (const f of files) {
    const id = tileId(f.name, prefix, '_supertexture.edds'); if (id < 0) continue
    try { const im = decodeColor(f.bytes); imgs.set(id, im); tp = Math.max(tp, im.width) } catch { /* skip unreadable tile */ }
  }
  if (!imgs.size) return null
  const k = Math.max(1, Math.ceil((tp * Math.max(terr.tilesX, terr.tilesZ)) / maxSide)), ts = Math.floor(tp / k)
  const W = ts * terr.tilesX, H = ts * terr.tilesZ, data = new Uint8ClampedArray(W * H * 4)
  for (const [id, im] of imgs) {
    const tx = id % terr.tilesX, ty = Math.floor(id / terr.tilesX); if (ty >= terr.tilesZ) continue
    const s = im.width / ts
    for (let r = 0; r < ts; r++) for (let c = 0; c < ts; c++) {
      const sr = Math.floor(r * s), sc = Math.floor(c * s), so = (sr * im.width + sc) * 4
      const y = H - 1 - (ty * ts + r), x = tx * ts + c, o = (y * W + x) * 4 // tile row 0 = south edge
      data[o] = im.data[so]; data[o + 1] = im.data[so + 1]; data[o + 2] = im.data[so + 2]; data[o + 3] = 255
    }
  }
  return { W, H, data }
}
