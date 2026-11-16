// Tile diagnostic: textures (surface materials) per block against the QTRE budget (5 or 7 per block).
// Ported from the idea and checks of giorbev's tile_inspector.py / lrs2_parser.py (MIT, Copyright (c) giorbev).
import type { TerrInfo } from './formats/terr.ts'
import type { TileData } from './formats/ttile.ts'

export interface DiagBlock { bx: number; by: number; tx: number; ty: number; mats: number[]; cover?: number[] }
/** painted coverage of each block's slots, from the tiles' _layer.edds (key "bx,by" in global blocks) */
export interface Coverage { blockPx: number; blocks: Map<string, number[]> }
export interface DiagProblem { kind: 'overBudget' | 'atBudget' | 'empty' | 'missingTile' | 'unknownMat'; tx: number; ty: number; bx?: number; by?: number; n?: number }
export interface Diag {
  blocksX: number; blocksZ: number; counts: Uint8Array; blocks: DiagBlock[]
  usage: Map<number, number>; problems: DiagProblem[]; maxPerBlock: number
  hist: number[]; blockPx: number; negligible: number
}

export function diagnose(terr: TerrInfo, tiles: TileData[], budget: number, cov?: Coverage | null, threshold = 0.01): Diag {
  const bpt = terr.blocksPerTile, blocksX = terr.tilesX * bpt, blocksZ = terr.tilesZ * bpt
  const counts = new Uint8Array(blocksX * blocksZ).fill(255), blocks: DiagBlock[] = [], usage = new Map<number, number>()
  const problems: DiagProblem[] = [], have = new Set<string>(), hist = new Array(16).fill(0)
  let maxPerBlock = 0, negligible = 0
  for (const t of tiles) {
    have.add(t.tx + ',' + t.ty)
    for (const b of t.blocks) {
      if (b.bx >= blocksX || b.by >= blocksZ) continue
      const n = b.mats.length
      counts[b.by * blocksX + b.bx] = n
      const cover = cov?.blocks.get(b.bx + ',' + b.by)
      blocks.push({ bx: b.bx, by: b.by, tx: t.tx, ty: t.ty, mats: b.mats, cover })
      if (cover) negligible += negligibleSlots(cover, cov!.blockPx, threshold)
      hist[Math.min(n, 15)]++
      if (n > maxPerBlock) maxPerBlock = n
      for (const m of b.mats) { usage.set(m, (usage.get(m) ?? 0) + 1); if (m >= terr.materials.length && terr.materials.length) problems.push({ kind: 'unknownMat', tx: t.tx, ty: t.ty, bx: b.bx, by: b.by, n: m }) }
      if (n === 0) problems.push({ kind: 'empty', tx: t.tx, ty: t.ty, bx: b.bx, by: b.by, n })
      else if (n > budget) problems.push({ kind: 'overBudget', tx: t.tx, ty: t.ty, bx: b.bx, by: b.by, n })
      else if (n === budget) problems.push({ kind: 'atBudget', tx: t.tx, ty: t.ty, bx: b.bx, by: b.by, n })
    }
  }
  for (let ty = 0; ty < terr.tilesZ; ty++) for (let tx = 0; tx < terr.tilesX; tx++) if (!have.has(tx + ',' + ty)) problems.push({ kind: 'missingTile', tx, ty })
  const order = { overBudget: 0, missingTile: 1, unknownMat: 2, empty: 3, atBudget: 4 }
  problems.sort((a, b) => order[a.kind] - order[b.kind] || (b.n ?? 0) - (a.n ?? 0))
  return { blocksX, blocksZ, counts, blocks, usage, problems, maxPerBlock, hist, blockPx: cov?.blockPx ?? 0, negligible }
}

/** CSV: one row per block (tile, block, count, material names) */
export function diagCsv(terr: TerrInfo, d: Diag, budget: number, threshold = 0.01): string {
  const name = (m: number) => terr.materials[m]?.name ?? '#' + m
  const pct = (b: DiagBlock, i: number) => b.cover && d.blockPx ? ` (${(100 * (b.cover[i] ?? 0) / d.blockPx).toFixed(1)}%)` : ''
  const rows = ['tile_x;tile_y;block_x;block_y;n_textures;budget;over;negligible_slots;textures (coverage %)']
  for (const b of [...d.blocks].sort((a, c) => a.by - c.by || a.bx - c.bx))
    rows.push([b.tx, b.ty, b.bx, b.by, b.mats.length, budget, b.mats.length > budget ? 1 : 0, b.cover ? negligibleSlots(b.cover, d.blockPx, threshold) : '', b.mats.map((m, i) => name(m) + pct(b, i)).join('|')].join(';'))
  return rows.join('\n') + '\n'
}

/** giorbev's "slot négligeable": a texture slot of the block painted on less than `threshold` of its pixels */
export function negligibleSlots(cover: number[], blockPx: number, threshold: number): number {
  return blockPx ? cover.filter((c) => c / blockPx < threshold).length : 0
}
