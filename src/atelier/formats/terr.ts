// <world>.terr: terrain header + surface list. Read-only.
// HEAD (32 bytes, LE): u32 vertsX, u32 vertsZ, u32 vertsPerBlock (33 = 32 cells + 1), u32 blocksPerTile (4),
//   f32 cellSize (m), f32 heightScale, f32 heightOffset, u32 version.  Height (m) = u16 * scale + offset.
// MATS: u16, then entries u32 LE length + "{GUID}path.emat\0" (same as bridge/terrain-file.mjs).
// Material ids in the .ttile LRS2 chunk are indexes into this list (giorbev terrain_terr_reader.py, MIT).
import { readIff, view } from './iff.ts'

export interface TerrMaterial { id: number; guid: string; path: string; name: string }
export interface TerrInfo {
  vertsX: number; vertsZ: number
  cellsPerBlock: number; blocksPerTile: number; cellsPerTile: number
  cellSize: number; heightScale: number; heightOffset: number
  tilesX: number; tilesZ: number; sizeX: number; sizeZ: number
  materials: TerrMaterial[]
}

export function parseTerr(b: Uint8Array): TerrInfo {
  const f = readIff(b)
  if (f.type !== 'TERR') throw new Error('not a .terr file')
  const h = f.get('HEAD')
  if (!h || h.length < 28) throw new Error('.terr without HEAD chunk')
  const d = view(h)
  const vertsX = d.getUint32(0, true), vertsZ = d.getUint32(4, true)
  const cellsPerBlock = d.getUint32(8, true) - 1, blocksPerTile = d.getUint32(12, true)
  const cellSize = d.getFloat32(16, true), heightScale = d.getFloat32(20, true), heightOffset = d.getFloat32(24, true)
  const cellsPerTile = cellsPerBlock * blocksPerTile
  const materials: TerrMaterial[] = []
  const m = f.get('MATS')
  if (m) {
    const md = view(m)
    for (let o = 2; o + 4 <= m.length; ) {
      const len = md.getUint32(o, true)
      if (len === 0 || len > 400 || o + 4 + len > m.length) { o++; continue }
      let s = ''
      for (let i = 0; i < len; i++) { const c = m[o + 4 + i]; if (c) s += String.fromCharCode(c) }
      o += 4 + len
      const g = /^\{([0-9A-Fa-f]+)\}(.+\.emat)$/.exec(s)
      if (g) materials.push({ id: materials.length, guid: g[1].toUpperCase(), path: g[2], name: g[2].split('/').pop()!.replace(/\.emat$/, '') })
    }
  }
  const tilesX = Math.round((vertsX - 1) / cellsPerTile), tilesZ = Math.round((vertsZ - 1) / cellsPerTile)
  return {
    vertsX, vertsZ, cellsPerBlock, blocksPerTile, cellsPerTile, cellSize, heightScale, heightOffset,
    tilesX, tilesZ, sizeX: (vertsX - 1) * cellSize, sizeZ: (vertsZ - 1) * cellSize, materials,
  }
}
