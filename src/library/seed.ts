// Vanilla seed pack: built from the data the generators already use (BUILDINGS, INDUSTRIAL, MIL_*,
// FENCE_NET) plus the biome vegetation / fences / props (src/data/biomes.ts) — nothing is duplicated,
// every entry is derived. Biome attachment rule: "USSR" in the path = soviet style (Kolguyev, tundra),
// "_E_" = western (Everon, Arland, Mediterranean), neither = both. Vegetation "_aut" = autumn (Kolguyev, tundra).

import { BUILDINGS, INDUSTRIAL, FENCE_NET, type BuildingCat } from '../data/buildings.ts'
import { MIL_PREFABS, MIL_WALLS } from '../modules/military.ts'
import { BIOMES, FENCES, PROPS, VEG, type BiomeId } from '../data/biomes.ts'
import { dimsFootprint, prefabDims } from './dims.ts'
import { nameOf, type Asset, type AssetKind, type AssetPack, type Footprint } from './schema.ts'

const WESTERN: BiomeId[] = ['temperate_everon', 'woodland_arland', 'mediterranean_dry']
const SOVIET: BiomeId[] = ['nordic_kolguyev', 'winter_tundra']
const ALL: BiomeId[] = BIOMES.map((b) => b.id)

// "_E_" = Everon western style, "USSR" = soviet; neither (generic sheds, garages…) = both styles
const styleBiomes = (p: string): BiomeId[] => (/USSR/i.test(p) ? SOVIET : /_E_/.test(p) ? WESTERN : [...WESTERN, ...SOVIET])
const vegBiomes = (p: string): BiomeId[] => {
  const used = BIOMES.filter((b) => [...b.vegetation.trees, ...b.vegetation.bushes, ...b.vegetation.gardenTrees].some((x) => x.p === p)).map((b) => b.id)
  return used.length ? used : (/_aut/.test(p) ? SOVIET : WESTERN)
}

// heights are ESTIMATES (prefabs.txt only gives the XZ bounds): see docs
const H: Record<AssetKind, number> = { house: 7, farm: 8, annex: 4, shed: 3, civic: 9, religious: 6, block: 15, industrial: 10, military: 4, fence: 1.6, wall: 2.2, tree: 14, bush: 2.5, prop: 1.2 }
const fp = (minX: number, minZ: number, maxX: number, maxZ: number, h: number, measured: boolean): Footprint => ({ minX, minZ, maxX, maxZ, h, measured })
const square = (half: number, h: number) => fp(-half, -half, half, half, h, false)

const CAT: Record<BuildingCat, [AssetKind, string[]]> = {
  houseS: ['house', ['small']], houseM: ['house', ['medium']], houseL: ['house', ['large']],
  farm: ['farm', ['rural']], annex: ['annex', ['outbuilding']], shed: ['shed', ['outbuilding']],
  civic: ['civic', ['unique']], block: ['block', ['urban', 'flats']],
}

const base = { source: 'vanilla' as const, author: 'Bohemia Interactive', licence: 'Bohemia-EULA' }
// real .xob dims (library/prefabs-catalogue.json `d`): measured XZ bounds are kept, only the estimated height is
// replaced; unmeasured footprints take the real box. Trees / bushes keep their small trunk-like box (parcel collision).
const real = (guid: string, kind: AssetKind, f: Footprint): Footprint => {
  if (kind === 'tree' || kind === 'bush') return f
  if (f.measured) { const d = prefabDims(guid); return d && d.h > 0 ? { ...f, h: d.h } : f }
  return dimsFootprint(guid, f)
}
const mk = (guid: string, kind: AssetKind, f: Footprint, biomes: BiomeId[], tags: string[]): Asset => ({ guid, name: nameOf(guid), kind, footprint: real(guid, kind, f), biomes, tags, ...base })

function buildSeed(): Asset[] {
  const out: Asset[] = []
  for (const b of BUILDINGS) {
    const [k0, tags] = CAT[b.cat]
    const church = /Church|Chapel/i.test(b.prefab)
    const kind: AssetKind = church ? 'religious' : k0
    const st = /USSR/i.test(b.prefab) ? 'soviet' : /_E_/.test(b.prefab) ? 'western' : 'generic'
    out.push(mk(b.prefab, kind, fp(b.minX, b.minZ, b.maxX, b.maxZ, H[kind], true), styleBiomes(b.prefab), [...tags, st, b.cat, ...(church ? ['church'] : [])]))
  }
  for (const b of INDUSTRIAL) {
    const kind: AssetKind = b.role === 'prop' ? 'prop' : 'industrial'
    out.push(mk(b.prefab, kind, fp(b.minX, b.minZ, b.maxX, b.maxZ, b.role === 'prop' ? 3 : H.industrial, true), [...ALL], ['industrial', b.role, ...b.tags]))
  }
  for (const [k, m] of Object.entries(MIL_PREFABS)) out.push(mk(m.p, 'military', fp(-m.hw, -m.hd, m.hw, m.hd, k === 'tower' ? 8 : H.military, false), [...ALL], ['military', k]))
  for (const [k, p] of Object.entries(MIL_WALLS)) out.push(mk(p, 'wall', square(0.5, H.wall), [...ALL], ['military', 'generator', k]))
  for (const [k, p] of Object.entries(FENCES)) {
    const kind: AssetKind = /Stone|Brick|Tin|Wall_/.test(p) ? 'wall' : 'fence'
    const biomes = BIOMES.filter((b) => [...b.fences.front, ...b.fences.side].includes(p)).map((b) => b.id)
    out.push(mk(p, kind, square(0.5, H[kind]), biomes.length ? biomes : styleBiomes(p), ['generator', 'garden', k]))
  }
  out.push(mk(FENCE_NET, 'fence', square(0.5, 2), [...ALL], ['generator', 'industrial', 'net']))
  for (const [k, p] of Object.entries(VEG)) {
    const bush = p.includes('/Bush/')
    out.push(mk(p, bush ? 'bush' : 'tree', square(bush ? 1.5 : 3, bush ? H.bush : H.tree), vegBiomes(p), [bush ? 'bush' : 'tree', /_aut/.test(p) ? 'autumn' : 'summer', k.replace(/Aut$/, '')]))
  }
  for (const [k, p] of Object.entries(PROPS)) {
    const biomes = BIOMES.filter((b) => b.props.includes(p)).map((b) => b.id)
    out.push(mk(p, 'prop', square(k.startsWith('hay') ? 1.5 : 0.8, k === 'haystack' ? 4 : H.prop), biomes.length ? biomes : WESTERN, ['garden', 'yard', k]))
  }
  // religious landmarks besides the chapel / church buildings (verified rdb refs)
  out.push(mk('{B17E628E5602C093}Prefabs/Structures/Cultural/Calvaries/BelfrySmall_01.et', 'religious', square(1.5, 6), WESTERN, ['belfry', 'landmark']))
  out.push(mk('{C8FAB83670BCF7C3}Prefabs/Structures/Cultural/Calvaries/CalvaryLarge_01.et', 'religious', square(1.2, 4), WESTERN, ['calvary', 'landmark']))
  // unique by guid (a prefab can appear in two source tables)
  const seen = new Set<string>()
  return out.filter((a) => (seen.has(a.guid) ? false : (seen.add(a.guid), true)))
}

export const VANILLA_PACK: AssetPack = {
  format: 'reforger-mapper.assetpack', version: 1, id: 'vanilla-base', name: 'Arma Reforger base game',
  author: 'Bohemia Interactive (refs) / reforger-mapper (tags)', licence: 'Bohemia-EULA', source: 'vanilla',
  description: 'Base-game prefab references verified against resourceDatabase.rdb; footprints measured (buildings) or estimated.',
  assets: buildSeed(),
}
