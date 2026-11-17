// Lot subdivision for the Zone tool "Habitation" (own code, after the Houdini Labs "Lot Subdivision"
// idea): a street block (oriented box between the street and the back of the zone) is split
// recursively along its longest side. A depth cut leaves a front strip on the street and a back
// strip; the back strip touches no street, so it stays whole as one shared back yard / orchard
// (merged across the block's lots). The front strip is then cut across its frontage until each lot
// is in the frontage target. Lots are clipped to the polygon (depth shrinks until the back corners
// are inside). Pure functions.
import { lotCorners, type Lot } from './villageLots'

export interface LotTarget { front: [number, number]; depth: [number, number] }
/** frontage 15-30 m, depth 25-45 m: the dense core gets the small end, the edge the large one */
export function lotTarget(ring: number, density = 1): LotTarget {
  const t = Math.min(Math.max(ring / 2 + (1 - density) * 0.25, 0), 1)
  const f0 = 15 + 7 * t, d0 = 25 + 10 * t
  return { front: [f0, f0 + 8], depth: [d0, d0 + 10] }
}

export interface Subdivision { lots: Lot[]; backs: Lot[] }

/** recursive OBB split of one block (front edge on the street) */
export function subdivideBlock(blk: Lot, tgt: LotTarget, rand: () => number, inZone: (x: number, z: number) => boolean, out: Subdivision = { lots: [], backs: [] }): Subdivision {
  const [fMin, fMax] = tgt.front, [dMin, dMax] = tgt.depth
  // longest side first: a deep block is cut in depth (front strip + back yard), a long one across
  if (blk.d > dMax && blk.d - dMax >= 8) {
    const d1 = dMin + rand() * (dMax - dMin)
    const front: Lot = { ...blk, d: d1, cx: blk.cx - blk.nx * (blk.d - d1) / 2, cz: blk.cz - blk.nz * (blk.d - d1) / 2 }
    const d2 = blk.d - d1
    out.backs.push({ ...blk, d: d2, cx: blk.cx + blk.nx * d1 / 2, cz: blk.cz + blk.nz * d1 / 2 })
    return subdivideBlock(front, tgt, rand, inZone, out)
  }
  if (blk.w > fMax) {
    let r = 0.4 + rand() * 0.2 // small jitter around the middle
    if (blk.w >= 2 * fMin) r = Math.min(Math.max(r, fMin / blk.w), 1 - fMin / blk.w)
    else r = 0.5
    const w1 = blk.w * r, w2 = blk.w - w1
    subdivideBlock({ ...blk, w: w1, cx: blk.cx - blk.ux * (blk.w - w1) / 2, cz: blk.cz - blk.uz * (blk.w - w1) / 2, s: blk.s - blk.w / 2 + w1 / 2 }, tgt, rand, inZone, out)
    subdivideBlock({ ...blk, w: w2, cx: blk.cx + blk.ux * (blk.w - w2) / 2, cz: blk.cz + blk.uz * (blk.w - w2) / 2, s: blk.s + blk.w / 2 - w2 / 2 }, tgt, rand, inZone, out)
    return out
  }
  if (blk.w < fMin * 0.8) return out
  const c = clipDepth(blk, inZone, dMin * 0.7)
  if (c) out.lots.push(c)
  return out
}

/** shrink the lot from the back until all four corners are in the zone; null if the front is out
 *  or the lot gets shallower than minD */
export function clipDepth(l: Lot, inZone: (x: number, z: number) => boolean, minD: number): Lot | null {
  let d = l.d
  const fx = l.cx - l.nx * l.d / 2, fz = l.cz - l.nz * l.d / 2 // front centre
  while (d >= minD) {
    const c: Lot = { ...l, d, cx: fx + l.nx * d / 2, cz: fz + l.nz * d / 2 }
    const k = lotCorners(c)
    let ok = true
    for (let i = 0; i < 8 && ok; i += 2) ok = inZone(k[i], k[i + 1])
    if (ok) return c
    d -= 2
  }
  return null
}
