// Tile texture simplifier: in each terrain block, surface slots painted on less than `threshold` of the block
// are proposed for replacement by the NEAREST texture actually present (and above the threshold) in that
// same block: same family first (Grass_01/02/03, gravel/debris/rock…), then the closest average colour
// (data/texcolors.json, measured from the base-game textures). Gain is reported against the 5/7 budget.
// Weight maths on the _layer.edds pixels (R32 = 6 × 5-bit painted slots, slot 0 = implicit base).
import type { TerrInfo } from '../formats/terr.ts'
import type { TileData } from '../formats/ttile.ts'
import type { Coverage } from '../diag.ts'
import { slotWeight, type LayerWeights } from '../formats/edds.ts'

const GROUPS: [RegExp, string][] = [
  [/grass|meadow|lawn|clover|hay|field|crop|farm/, 'grass'], [/gravel|debris|rock|stone|cliff|scree|pebble/, 'rock'],
  [/dirt|mud|soil|ground|earth|clay/, 'dirt'], [/forest|leaves|leaf|needle|moss|litter|undergrowth/, 'forest'],
  [/asphalt|concrete|cobble|pavement|tarmac|road/, 'paved'], [/sand|beach|dune/, 'sand'], [/snow|ice/, 'snow'],
]
/** "Grass_01_V2" → "grass" (name without numbers / variants) */
export function family(name: string): string { return name.toLowerCase().replace(/(_v?\d+[a-z]?)+$/g, '').replace(/_?\d+/g, '').replace(/_+$/, '') }
export function group(name: string): string { const n = name.toLowerCase(); for (const [r, g] of GROUPS) if (r.test(n)) return g; return family(name) }
/** dissimilarity (lower = closer): colour distance + family / group penalty */
export function distance(a: string, b: string, colors: Record<string, number[]>): number {
  const ca = colors[a] ?? Object.entries(colors).find(([k]) => k.toLowerCase() === a.toLowerCase())?.[1]
  const cb = colors[b] ?? Object.entries(colors).find(([k]) => k.toLowerCase() === b.toLowerCase())?.[1]
  const col = ca && cb ? Math.hypot(ca[0] - cb[0], ca[1] - cb[1], ca[2] - cb[2]) : 80
  return col + (family(a) === family(b) ? 0 : group(a) === group(b) ? 60 : 150)
}

export interface SlotFix {
  key: string; tx: number; ty: number; bx: number; by: number
  slot: number; mat: number; pct: number; to: number; toMat: number; candidates: number[] /* slots, best first */; mats: number[]
}
export interface TilePlan { tx: number; ty: number; maxBefore: number; maxAfter: number; overBefore: number; overAfter: number; fixes: SlotFix[] }

export function planTiles(terr: TerrInfo, tiles: TileData[], cov: Coverage, threshold: number, budget: number, colors: Record<string, number[]>): TilePlan[] {
  const name = (m: number) => terr.materials[m]?.name ?? '#' + m, out: TilePlan[] = []
  for (const t of tiles) {
    const p: TilePlan = { tx: t.tx, ty: t.ty, maxBefore: 0, maxAfter: 0, overBefore: 0, overAfter: 0, fixes: [] }
    for (const b of t.blocks) {
      const cover = cov.blocks.get(b.bx + ',' + b.by), n = b.mats.length
      let after = n
      if (cover && cov.blockPx) {
        const pct = cover.map((c) => c / cov.blockPx)
        const keep = b.mats.map((_, s) => s === 0 || (pct[s] ?? 0) >= threshold)
        for (let s = 1; s < Math.min(n, 7); s++) {
          if (keep[s]) continue
          const cands = b.mats.map((_, k) => k).filter((k) => k !== s && keep[k]).sort((x, y) => distance(name(b.mats[s]), name(b.mats[x]), colors) - distance(name(b.mats[s]), name(b.mats[y]), colors))
          if (!cands.length) continue
          p.fixes.push({ key: `${b.bx},${b.by},${s}`, tx: t.tx, ty: t.ty, bx: b.bx, by: b.by, slot: s, mat: b.mats[s], pct: pct[s] ?? 0, to: cands[0], toMat: b.mats[cands[0]], candidates: cands, mats: b.mats })
          after--
        }
      }
      p.maxBefore = Math.max(p.maxBefore, n); p.maxAfter = Math.max(p.maxAfter, after)
      if (n > budget) p.overBefore++
      if (after > budget) p.overAfter++
    }
    out.push(p)
  }
  return out
}

/** move the weight of slot `from` onto slot `to` in one block of a tile's weight map (to = 0: back to the
 *  implicit base). Weights never overflow: the 6 painted slots of a pixel sum to ≤ 31. Returns changed px. */
export function moveWeight(L: LayerWeights, nb: number, lbx: number, lby: number, from: number, to: number): number {
  if (from < 1 || from > 6 || to < 0 || to > 6 || from === to) return 0
  const bs = Math.floor(L.width / nb), sf = (from - 1) * 5
  let n = 0
  for (let y = lby * bs; y < (lby + 1) * bs; y++) for (let x = lbx * bs; x < (lbx + 1) * bs; x++) {
    const i = y * L.width + x, p = L.px[i], w = slotWeight(p, from)
    if (!w) continue
    let q = (p & ~(31 << sf)) >>> 0
    if (to > 0) { const st = (to - 1) * 5, wt = Math.min(31, ((q >>> st) & 31) + w); q = ((q & ~(31 << st)) | (wt << st)) >>> 0 }
    L.px[i] = q; n++
  }
  return n
}
