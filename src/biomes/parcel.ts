// Parcel ("parcelle") templates: a village lot = footprint + house + outbuildings + fences + props +
// garden trees, styled by a biome. generateParcel() fills a Lot (src/modules/villageLots.ts frame:
// u along the street, n away from it, b measured from the front edge) with library assets. Pure.

import { lotCorners, lotPoint, type Lot } from '../modules/villageLots.ts'
import { assetBiome, biome, type Biome, type BiomeId, type Weighted } from '../data/biomes.ts'
import { search, type Library } from '../library/index.ts'
import type { Asset, AssetKind, Footprint } from '../library/schema.ts'

export type Range = [number, number]
export interface LotTemplate {
  id: string
  label: { en: string; fr: string }
  size: { w: Range; d: Range } // frontage / depth (m) the template is meant for
  setback: number // house front distance from the street edge
  house: { kinds: AssetKind[]; tags?: string[] }
  outbuildings: { kind: AssetKind; count: Range }[]
  fences: { front: boolean; sides: boolean; back: boolean; gate: number } // gate = opening width (m) in the front fence
  props: Range
  gardenTrees: Range
}

export const LOT_TEMPLATES: LotTemplate[] = [
  { id: 'cottage', label: { en: 'Cottage + garden', fr: 'Maisonnette + jardin' }, size: { w: [14, 20], d: [22, 32] }, setback: 3,
    house: { kinds: ['house'], tags: ['small'] }, outbuildings: [{ kind: 'shed', count: [0, 1] }], fences: { front: true, sides: true, back: false, gate: 3 }, props: [1, 3], gardenTrees: [1, 3] },
  { id: 'village_house', label: { en: 'Village house', fr: 'Maison de village' }, size: { w: [18, 26], d: [26, 40] }, setback: 4,
    house: { kinds: ['house'], tags: ['medium'] }, outbuildings: [{ kind: 'annex', count: [0, 1] }, { kind: 'shed', count: [1, 1] }], fences: { front: true, sides: true, back: true, gate: 3.5 }, props: [2, 4], gardenTrees: [2, 4] },
  { id: 'farmstead', label: { en: 'Farmstead', fr: 'Corps de ferme' }, size: { w: [28, 44], d: [36, 60] }, setback: 6,
    house: { kinds: ['farm', 'house'], tags: [] }, outbuildings: [{ kind: 'annex', count: [1, 2] }, { kind: 'shed', count: [1, 2] }], fences: { front: true, sides: true, back: true, gate: 5 }, props: [3, 6], gardenTrees: [2, 5] },
]
export const lotTemplate = (id: string) => LOT_TEMPLATES.find((t) => t.id === id)

export interface PlacedAsset { guid: string; kind: AssetKind; x: number; z: number; yaw: number; footprint: Footprint } // yaw degrees, model +Z = street
export interface PlacedFence { guid: string; pts: number[] } // world polyline x,z,...
export interface Parcel3D { biome: BiomeId; template: string; corners: number[]; items: PlacedAsset[]; fences: PlacedFence[]; warnings: string[] }

function rng(seed: number) {
  let s = seed >>> 0 || 1
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296 }
}
const between = (r: () => number, [a, b]: Range) => a + Math.floor(r() * (b - a + 1))
const pick = <T,>(r: () => number, xs: T[]): T | undefined => xs[Math.floor(r() * xs.length)]
function pickW(r: () => number, xs: Weighted[]): string | undefined {
  const tot = xs.reduce((n, x) => n + x.w, 0)
  let t = r() * tot
  for (const x of xs) if ((t -= x.w) < 0) return x.p
  return xs[xs.length - 1]?.p
}

/** a lot at the origin (u = +X, n = +Z: the street runs along X at z = -d/2), for previews */
export const demoLot = (w: number, d: number): Lot => ({ cx: 0, cz: 0, ux: 1, uz: 0, nx: 0, nz: 1, w, d, s: 0 })

interface Box { a0: number; a1: number; b0: number; b1: number }
const hit = (p: Box, q: Box, pad: number) => p.a0 < q.a1 + pad && q.a0 < p.a1 + pad && p.b0 < q.b1 + pad && q.b0 < p.b1 + pad

/** assets of a kind for a biome (fallback chain), optional tags preferred */
function candidates(lib: Library, b: Biome, kinds: AssetKind[], tags: string[] = []): Asset[] {
  const id = assetBiome(b).id
  const all = search(lib, { biome: id, kind: kinds })
  const tagged = tags.length ? all.filter((a) => tags.every((t) => a.tags.includes(t))) : all
  return tagged.length ? tagged : all
}

export function generateParcel(lib: Library, biomeId: BiomeId, tpl: LotTemplate, lot: Lot, seed = 1): Parcel3D {
  const b = biome(biomeId)
  if (!b) throw new Error(`unknown biome ${biomeId}`)
  const r = rng(seed)
  const out: Parcel3D = { biome: biomeId, template: tpl.id, corners: lotCorners(lot), items: [], fences: [], warnings: [] }
  if (assetBiome(b).id !== b.id) out.warnings.push(`no vanilla buildings for ${b.id}: using ${assetBiome(b).id}`)
  // model frame -> lot frame: +Z faces the street (b decreasing); +X maps to ±u
  const yaw = (Math.atan2(-lot.nx, -lot.nz) * 180) / Math.PI
  const sx = Math.sign(-lot.nz * lot.ux + lot.nx * lot.uz) || 1
  const boxOf = (f: Footprint, ca: number, cb: number): Box => {
    const x0 = ca + sx * f.minX, x1 = ca + sx * f.maxX
    return { a0: Math.min(x0, x1), a1: Math.max(x0, x1), b0: cb - f.maxZ, b1: cb - f.minZ }
  }
  const taken: Box[] = []
  const inside = (q: Box, m: number) => q.a0 >= -lot.w / 2 + m && q.a1 <= lot.w / 2 - m && q.b0 >= m && q.b1 <= lot.d - m
  const put = (a: Asset, ca: number, cb: number) => {
    const [x, z] = lotPoint(lot, ca, cb)
    out.items.push({ guid: a.guid, kind: a.kind, x, z, yaw, footprint: a.footprint })
    taken.push(boxOf(a.footprint, ca, cb))
  }
  const tryPlace = (a: Asset, zone: [number, number], margin: number, pad: number, tries = 30) => {
    for (let i = 0; i < tries; i++) {
      const ca = (r() - 0.5) * lot.w
      const cb = zone[0] + r() * (zone[1] - zone[0])
      const q = boxOf(a.footprint, ca, cb)
      if (inside(q, margin) && !taken.some((t) => hit(t, q, pad))) { put(a, ca, cb); return true }
    }
    return false
  }

  // house: the biggest candidate that fits the frontage, front at the setback, centred
  const fits = (a: Asset) => a.footprint.maxX - a.footprint.minX <= lot.w - 2 && a.footprint.maxZ - a.footprint.minZ <= lot.d * 0.6
  const houses = candidates(lib, b, tpl.house.kinds, tpl.house.tags).filter(fits)
  const house = pick(r, houses)
  if (house) put(house, -sx * (house.footprint.minX + house.footprint.maxX) / 2, tpl.setback + house.footprint.maxZ)
  else out.warnings.push(`no ${tpl.house.kinds.join('/')} fits a ${lot.w.toFixed(0)}×${lot.d.toFixed(0)} m lot`)
  const backStart = taken.length ? taken[0].b1 + 2 : lot.d / 3

  for (const ob of tpl.outbuildings) {
    const pool = candidates(lib, b, [ob.kind]).filter((a) => a.footprint.maxX - a.footprint.minX <= lot.w - 3)
    for (let n = between(r, ob.count); n > 0; n--) {
      const a = pick(r, pool)
      if (a && !tryPlace(a, [backStart, lot.d], 1.5, 1.5)) out.warnings.push(`no room for ${ob.kind}`)
    }
  }
  const props = b.props.map((p) => lib.assets.find((a) => a.guid === p)).filter((a): a is Asset => !!a)
  for (let n = between(r, tpl.props); n > 0 && props.length; n--) tryPlace(pick(r, props)!, [tpl.setback * 0.5, lot.d], 1, 0.6)
  const trees = b.vegetation.gardenTrees.length ? b.vegetation.gardenTrees : b.vegetation.trees
  for (let n = between(r, tpl.gardenTrees); n > 0; n--) {
    const p = pickW(r, trees)
    const a = p ? lib.assets.find((x) => x.guid === p) : undefined
    if (a) tryPlace({ ...a, footprint: { ...a.footprint, minX: -1, maxX: 1, minZ: -1, maxZ: 1 } }, [1, lot.d], 1.5, 1.5)
  }

  // fences along the lot edges (corners: front-left, front-right, back-right, back-left)
  const c = out.corners
  const P = (i: number) => [c[i * 2], c[i * 2 + 1]]
  const front = pick(r, b.fences.front), side = pick(r, b.fences.side) ?? front
  if (tpl.fences.front && front) {
    const g = Math.min(tpl.fences.gate, lot.w * 0.5) / 2
    const [gl, gr] = [lotPoint(lot, -g, 0), lotPoint(lot, g, 0)]
    out.fences.push({ guid: front, pts: [...P(0), ...gl] }, { guid: front, pts: [...gr, ...P(1)] })
  }
  if (tpl.fences.sides && side) out.fences.push({ guid: side, pts: [...P(1), ...P(2)] }, { guid: side, pts: [...P(3), ...P(0)] })
  if (tpl.fences.back && side) out.fences.push({ guid: side, pts: [...P(2), ...P(3)] })
  return out
}
