// .topo (map data exported by Workbench for the in-game map): ROAD block (road surfaces as quads at their
// real width, per level of detail) and BULD block (building footprints).
// Ported from giorbev's fond_realiste.py read_topo_roads and fond_militaire.py read_topo_buildings
// (MIT, Copyright (c) giorbev). Coordinates are the file's: x, and z flipped from the top (see topoToWorld).

export interface TopoRoad { cls: number; quads: Float32Array } // k × 4 corners × (x, y)
export interface Topo { roads: TopoRoad[]; buildings: Float32Array[]; blocks: string[] }

const BT_BUILDINGS = new Set([0, 1]) // EMapBuildingType: BT_BUILDING, BT_CASTLE_BUILDING (2, 3 = walls)

function blocksOf(b: Uint8Array): Map<string, number> {
  const d = new DataView(b.buffer, b.byteOffset, b.byteLength), out = new Map<string, number>()
  let o = 20
  while (o < b.length - 8) {
    out.set(String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]), o + 20)
    const next = d.getUint32(o + 12, true)
    if (next <= o) break
    o = next
  }
  return out
}

export function parseTopo(b: Uint8Array, lod = 0): Topo {
  const d = new DataView(b.buffer, b.byteOffset, b.byteLength), u = (o: number) => d.getUint32(o, true)
  const bl = blocksOf(b), roads: TopoRoad[] = [], buildings: Float32Array[] = []
  const f32 = (o: number, n: number) => { const a = new Float32Array(n); for (let i = 0; i < n; i++) a[i] = d.getFloat32(o + 4 * i, true); return a }
  const r0 = bl.get('ROAD')
  if (r0 !== undefined) {
    let o = r0 + 32 // 8 counters per class
    const nlod = u(o); o += 4
    for (let L = 0; L < nlod && o < b.length; L++) {
      const nr = u(o); o += 4
      for (let i = 0; i < nr; i++) {
        const cls = b[o], n = u(o + 1)
        if (L === lod) roads.push({ cls, quads: f32(o + 5, 2 * n) })
        o += 5 + 8 * n
        o += 4 + 4 * u(o) // connected roads
      }
      if (L === lod) break
    }
  }
  const b0 = bl.get('BULD')
  if (b0 !== undefined) {
    let o = b0
    const nc = u(o); o += 4
    for (let c = 0; c < nc && o < b.length; c++) {
      const npg = u(o); o += 4
      for (let i = 0; i < npg; i++) { const n = u(o); if (BT_BUILDINGS.has(c)) buildings.push(f32(o + 4, 2 * n)); o += 4 + 8 * n }
      o += 4 + 20 * u(o) // isolated points of the class
    }
  }
  return { roads, buildings, blocks: [...bl.keys()] }
}

/** file (x, y) → world (x, z): y = sizeZ - z (checked on TESTIsland: 80 % of the footprint corners within
 *  20 m of a .layer building/road point, against 37 % for y = z and 5 % for y = 8192 - z) */
export const topoToWorld = (x: number, y: number, sizeZ: number): [number, number] => [x, sizeZ - y]
/** road class → surface (his default: classes ≤ 2 asphalt, else dirt) */
export const topoSurface = (cls: number): 'asphalt' | 'dirt' => cls <= 2 ? 'asphalt' : 'dirt'
