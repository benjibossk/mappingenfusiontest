// Asset library model (docs/BIOMES_LIBRARY.md §Bibliothèque). An asset = one placeable prefab,
// attached to biomes and free tags. Assets travel in "packs" (one JSON file per pack, library/*.json
// in the repo or shared over a collab room). Pure, no DOM.

import type { BiomeId } from '../data/biomes.ts'

export type AssetKind =
  | 'house' | 'farm' | 'annex' | 'shed' | 'civic' | 'religious' | 'block'
  | 'industrial' | 'military' | 'fence' | 'wall' | 'tree' | 'bush' | 'prop'
export const ASSET_KINDS: AssetKind[] = ['house', 'farm', 'annex', 'shed', 'civic', 'religious', 'block', 'industrial', 'military', 'fence', 'wall', 'tree', 'bush', 'prop']

/** local bounds in metres (model frame, +Z = street front), h = height (estimated when not measured) */
export interface Footprint { minX: number; minZ: number; maxX: number; maxZ: number; h: number; measured?: boolean }

export interface Asset {
  guid: string // "{16 HEX}path.et" (full resource ref, as Workbench prints it)
  name?: string
  kind: AssetKind
  footprint: Footprint
  biomes: (BiomeId | string)[] // a mod biome id is allowed (string)
  tags: string[]
  source: 'vanilla' | string // 'vanilla' or the addon GUID (16 hex) that ships it
  author: string
  licence: string // SPDX id or "Bohemia-EULA" for base game refs
}

export interface AssetPack {
  format: 'reforger-mapper.assetpack'
  version: 1
  id: string // kebab-case, unique
  name: string
  author: string
  licence: string
  source: 'vanilla' | string
  workshop?: string // Workshop page of the addon (mods only)
  description?: string
  assets: Asset[]
  compositions?: Composition[] // ready-made parcels (composition prefabs, src/library/composition.ts)
}

/** one child of a composition, relative to the composition centre (model frame, +Z = street front) */
export interface CompoItem { prefab: string; x: number; y: number; z: number; yaw: number; scale?: number; pitch?: number; roll?: number }
/** a ready-made parcel: a Workbench composition prefab (parent + children) flattened to items */
export interface Composition {
  id: string
  name: string
  ref?: string // "{GUID}path.et" of the composition prefab itself, when known
  size: { w: number; d: number } // frontage (x) / depth (z) in metres
  items: CompoItem[]
  biomes: (BiomeId | string)[]
  tags: string[] // role tags: garden, yard, farm, camp, props…
  source: 'vanilla' | string
  author: string
  licence: string
  /** whole plot of the parcel library (parcelLib.ts): house + fence + trees, cemetery, yard... absent = small sub-composition */
  category?: ParcelCategory
  /** finer kind inside the category (industrial: 'sawmill'); a pick without subtype skips subtyped parcels */
  subtype?: string
  /** 'front': the plot's +Z side faces its access road (aligned to the nearest road when placed); 'none': free */
  road?: 'front' | 'none'
  /** where it was harvested: [map, x, z] */
  where?: (string | number)[]
}

export type ParcelCategory = 'garden' | 'farm' | 'cemetery' | 'industrial' | 'fuel' | 'roadside' | 'allotment' | 'sport' | 'custom'
export const PARCEL_CATEGORIES: ParcelCategory[] = ['garden', 'farm', 'cemetery', 'industrial', 'fuel', 'roadside', 'allotment', 'sport', 'custom']

export const GUID_RE = /^\{[0-9A-F]{16}\}[^\s{}]+\.et$/
const ADDON_RE = /^[0-9A-F]{16}$/
const ID_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/

export const guidOf = (ref: string) => ref.slice(1, 17)
export const nameOf = (ref: string) => ref.slice(ref.lastIndexOf('/') + 1).replace(/\.et$/, '')

const PREFAB_RE = /^\{[0-9A-F]{16}\}[^\s{}]+\.et$/i
export function validateComposition(c: unknown, where = 'composition'): string[] {
  if (!c || typeof c !== 'object') return [`${where}: not an object`]
  const x = c as Partial<Composition>
  const e: string[] = []
  if (typeof x.id !== 'string' || !ID_RE.test(x.id)) e.push(`${where}: id must be kebab-case`)
  if (typeof x.name !== 'string' || !x.name.trim()) e.push(`${where}: name required`)
  if (!x.size || !(x.size.w > 0 && x.size.d > 0)) e.push(`${where}: size {w,d} > 0`)
  if (!Array.isArray(x.items) || !x.items.length) e.push(`${where}: items must be a non-empty array`)
  else x.items.forEach((i, k) => {
    if (!i || typeof i.prefab !== 'string' || !PREFAB_RE.test(i.prefab)) e.push(`${where}.items[${k}]: prefab must look like {GUID}path.et`)
    else if (![i.x, i.y, i.z, i.yaw].every((n) => typeof n === 'number' && Number.isFinite(n))) e.push(`${where}.items[${k}]: x,y,z,yaw numbers`)
  })
  if (!Array.isArray(x.biomes) || !x.biomes.length) e.push(`${where}: biomes must be a non-empty string array`)
  if (!Array.isArray(x.tags)) e.push(`${where}: tags must be a string array`)
  if (x.source !== 'vanilla' && !(typeof x.source === 'string' && ADDON_RE.test(x.source))) e.push(`${where}: source must be "vanilla" or a 16-hex addon GUID`)
  if (typeof x.author !== 'string' || !x.author.trim()) e.push(`${where}: author required`)
  if (typeof x.licence !== 'string' || !x.licence.trim()) e.push(`${where}: licence required`)
  if (x.category !== undefined && !PARCEL_CATEGORIES.includes(x.category)) e.push(`${where}: unknown category ${String(x.category)}`)
  return e
}

/** problems of one asset ([] = valid) */
export function validateAsset(a: unknown, where = 'asset'): string[] {
  const e: string[] = []
  if (!a || typeof a !== 'object') return [`${where}: not an object`]
  const x = a as Partial<Asset>
  if (typeof x.guid !== 'string' || !GUID_RE.test(x.guid)) e.push(`${where}: guid must look like {0123456789ABCDEF}Prefabs/....et`)
  if (!x.kind || !ASSET_KINDS.includes(x.kind)) e.push(`${where}: kind must be one of ${ASSET_KINDS.join(', ')}`)
  const f = x.footprint
  if (!f || ![f.minX, f.minZ, f.maxX, f.maxZ, f.h].every((n) => typeof n === 'number' && Number.isFinite(n))) e.push(`${where}: footprint {minX,minZ,maxX,maxZ,h} numbers`)
  else if (f.minX >= f.maxX || f.minZ >= f.maxZ || f.h <= 0) e.push(`${where}: footprint must have min < max and h > 0`)
  if (!Array.isArray(x.biomes) || !x.biomes.length || !x.biomes.every((b) => typeof b === 'string')) e.push(`${where}: biomes must be a non-empty string array`)
  if (!Array.isArray(x.tags) || !x.tags.every((t) => typeof t === 'string')) e.push(`${where}: tags must be a string array`)
  if (x.source !== 'vanilla' && !(typeof x.source === 'string' && ADDON_RE.test(x.source))) e.push(`${where}: source must be "vanilla" or a 16-hex addon GUID`)
  if (typeof x.author !== 'string' || !x.author.trim()) e.push(`${where}: author required (attribution)`)
  if (typeof x.licence !== 'string' || !x.licence.trim()) e.push(`${where}: licence required`)
  return e
}

export function validatePack(p: unknown): string[] {
  if (!p || typeof p !== 'object') return ['pack: not an object']
  const x = p as Partial<AssetPack>
  const e: string[] = []
  if (x.format !== 'reforger-mapper.assetpack') e.push('pack: format must be "reforger-mapper.assetpack"')
  if (x.version !== 1) e.push('pack: version must be 1')
  if (typeof x.id !== 'string' || !ID_RE.test(x.id)) e.push('pack: id must be kebab-case')
  if (typeof x.name !== 'string' || !x.name.trim()) e.push('pack: name required')
  if (typeof x.author !== 'string' || !x.author.trim()) e.push('pack: author required')
  if (typeof x.licence !== 'string' || !x.licence.trim()) e.push('pack: licence required')
  if (!Array.isArray(x.assets)) return [...e, 'pack: assets must be an array']
  const seen = new Set<string>()
  x.assets.forEach((a, i) => {
    e.push(...validateAsset(a, `assets[${i}]`))
    const g = (a as Asset)?.guid
    if (typeof g === 'string') { if (seen.has(g)) e.push(`assets[${i}]: duplicate guid ${g}`); seen.add(g) }
    if (x.source && a && (a as Asset).source !== x.source) e.push(`assets[${i}]: source differs from pack source`)
  })
  if (x.compositions !== undefined) {
    if (!Array.isArray(x.compositions)) e.push('pack: compositions must be an array')
    else x.compositions.forEach((c, i) => e.push(...validateComposition(c, `compositions[${i}]`)))
  }
  return e
}

/** JSON Schema (draft 2020-12) of a pack, for editors / CI (`library/*.json`) */
export const ASSET_PACK_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://github.com/reforger-mapper/library/assetpack.schema.json',
  title: 'reforger-mapper asset pack',
  type: 'object',
  required: ['format', 'version', 'id', 'name', 'author', 'licence', 'source', 'assets'],
  properties: {
    format: { const: 'reforger-mapper.assetpack' },
    version: { const: 1 },
    id: { type: 'string', pattern: ID_RE.source },
    name: { type: 'string', minLength: 1 },
    author: { type: 'string', minLength: 1 },
    licence: { type: 'string', minLength: 1 },
    source: { anyOf: [{ const: 'vanilla' }, { type: 'string', pattern: ADDON_RE.source }] },
    workshop: { type: 'string', format: 'uri' },
    description: { type: 'string' },
    compositions: { type: 'array', items: { type: 'object', required: ['id', 'name', 'size', 'items', 'biomes', 'tags', 'source', 'author', 'licence'] } },
    assets: {
      type: 'array',
      items: {
        type: 'object',
        required: ['guid', 'kind', 'footprint', 'biomes', 'tags', 'source', 'author', 'licence'],
        properties: {
          guid: { type: 'string', pattern: GUID_RE.source },
          name: { type: 'string' },
          kind: { enum: ASSET_KINDS },
          footprint: {
            type: 'object', required: ['minX', 'minZ', 'maxX', 'maxZ', 'h'],
            properties: { minX: { type: 'number' }, minZ: { type: 'number' }, maxX: { type: 'number' }, maxZ: { type: 'number' }, h: { type: 'number', exclusiveMinimum: 0 }, measured: { type: 'boolean' } },
          },
          biomes: { type: 'array', minItems: 1, items: { type: 'string' } },
          tags: { type: 'array', items: { type: 'string' } },
          source: { type: 'string' },
          author: { type: 'string', minLength: 1 },
          licence: { type: 'string', minLength: 1 },
        },
      },
    },
  },
} as const
