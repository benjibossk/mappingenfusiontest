// <world>/.Data/<prefix>N.ttile: one terrain tile. Read-only (giorbev also stopped writing them in V8).
// HGHT: u16 heights, (cellsPerTile+1)^2, row 0 = south edge (height = u16 * scale + offset from the .terr).
// LRS2: per block (blocksPerTile^2 records): u32 index = byGlobal * blocksPerSide + bxGlobal, u16 n, u16[n] ids.
// Ported from giorbev lrs2_parser.py (MIT, Copyright (c) giorbev). Difference: he decodes the index with a bit
// shift, which equals this linear form only when blocks per side is a power of two; verified on a 19x19-tile
// terrain (76 blocks per side) that the linear form is the right one (tile N = (N mod 19, N div 19)).
import { readIff, view } from './iff.ts'

export interface TileBlock { bx: number; by: number; mats: number[] }
export interface TileData { tx: number; ty: number; blocks: TileBlock[]; heights?: Uint16Array; side?: number }

export function parseTtile(b: Uint8Array, blocksPerSide: number, blocksPerTile: number, withHeights = false): TileData {
  const f = readIff(b)
  const l = f.get('LRS2')
  if (!l) throw new Error('.ttile without LRS2 chunk')
  const d = view(l)
  const blocks: TileBlock[] = []
  let tx = -1, ty = -1
  for (let o = 0, i = 0; i < blocksPerTile * blocksPerTile && o + 6 <= l.length; i++) {
    const idx = d.getUint32(o, true), n = d.getUint16(o + 4, true)
    o += 6
    if (o + n * 2 > l.length) break
    const bxg = idx % blocksPerSide, byg = Math.floor(idx / blocksPerSide)
    if (i === 0) { tx = Math.floor(bxg / blocksPerTile); ty = Math.floor(byg / blocksPerTile) }
    const mats: number[] = []
    for (let k = 0; k < n; k++) mats.push(d.getUint16(o + k * 2, true))
    o += n * 2
    blocks.push({ bx: bxg, by: byg, mats })
  }
  const out: TileData = { tx, ty, blocks }
  if (withHeights) {
    const h = f.get('HGHT')
    if (h) {
      const n = h.length >> 1, side = Math.round(Math.sqrt(n))
      if (side * side === n) {
        const hv = view(h), arr = new Uint16Array(n)
        for (let i = 0; i < n; i++) arr[i] = hv.getUint16(i * 2, true)
        out.heights = arr; out.side = side
      }
    }
  }
  return out
}
