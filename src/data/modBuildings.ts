// Mod buildings in the generators: classifies the ENABLED mods' registry rows (library/mods.ts) into our
// building kinds (BuildingCat for villages / towns / lots / scattered, IndustrialBuilding for industrial
// zones) from their path names and measured dims, and appends them to BUILDINGS / INDUSTRIAL while the
// mod is ticked. No mod ticked = both lists exactly as shipped (default behaviour unchanged).
// Imported for its side effect by main.ts and the generator worker (which gets the ticked list per job).
import { BUILDINGS, INDUSTRIAL, type Building, type BuildingCat, type IndustrialBuilding, type IndustrialTag } from './buildings'
import { MOD_INDEX, enabledMods, modPrefabs, modRef, onModsChange, type ModPrefab } from '../library/mods'
import type { Asset, AssetKind, AssetPack } from '../library/schema'

const bounds = (r: ModPrefab) => { const [w, dz, , cx, cz] = r.d; return { minX: cx - w / 2, minZ: cz - dz / 2, maxX: cx + w / 2, maxZ: cz + dz / 2 } }
const SKIP = /BuildingParts|BuildingsParts|Castle|walls?\/|Gate|Entrance|Stairs|LightTower|Props\/|Railway|Bridge|Tunnel|Platform|Power|Roads?\/|Dam\//i

/** our village building kind of a mod prefab, null when it is not a village building */
export function buildingCat(r: ModPrefab): BuildingCat | null {
  const p = r.p, big = Math.max(r.d[0], r.d[1]), small = Math.min(r.d[0], r.d[1])
  if (SKIP.test(p) || !/^Structures\//.test(p) || /Military|Barrack|Bunker|Airport|Hangar|Tower|Industrial|Infrastructure/i.test(p)) return null
  if (/Church|Chapel|Pub|Rural Store|Store\.et|Restroom|Services|School|Hospital|FireStation|Station|SuperMarket/i.test(p)) return big > 60 ? null : 'civic'
  if (/Barn|Cowshed|Stable|Agricult|Farm/i.test(p)) return 'farm'
  if (/Shed|Garage|Booth/i.test(p)) return big < 7 ? 'shed' : 'annex'
  if (/Appartment|Apartment|Complex|Floor_A/i.test(p)) return 'block'
  if (/House|Cabin|Brickbuilding|Barrack|Home|Villa|Cottage/i.test(p)) {
    if (small < 4) return null
    return big < 10 ? 'houseS' : big < 16 ? 'houseM' : 'houseL'
  }
  return null
}
/** industrial-zone role/tags of a mod prefab, null when it does not fit an industrial yard */
export function industrialRole(r: ModPrefab): IndustrialBuilding | null {
  const p = r.p, big = Math.max(r.d[0], r.d[1])
  if (!/^Structures\/(Industrial|Agriculture)\//.test(p) || /Gate|LightTower/i.test(p)) return null
  const tags: IndustrialTag[] = /Barn|Cowshed|Sawmill/i.test(p) ? ['farm', 'depot'] : /Construction|Complex/i.test(p) ? ['factory', 'quarry'] : ['factory', 'depot']
  return { prefab: modRef(r), role: big >= 20 ? 'main' : 'annex', tags, ...bounds(r) }
}

const added = { b: [] as Building[], i: [] as IndustrialBuilding[] }
/** rebuild the mod part of BUILDINGS / INDUSTRIAL from the ticked mods */
export function syncModBuildings() {
  for (const [list, mine] of [[BUILDINGS, added.b], [INDUSTRIAL, added.i]] as [unknown[], unknown[]][]) {
    for (const x of mine) { const k = list.indexOf(x); if (k >= 0) list.splice(k, 1) }
    mine.length = 0
  }
  for (const r of modPrefabs()) {
    if (!r.g) continue
    const c = buildingCat(r)
    if (c) { const b: Building = { prefab: modRef(r), cat: c, ...bounds(r) }; added.b.push(b); BUILDINGS.push(b) }
    const ind = industrialRole(r)
    if (ind) { added.i.push(ind); INDUSTRIAL.push(ind) }
  }
  return { buildings: added.b.length, industrial: added.i.length }
}
onModsChange(syncModBuildings)
if (enabledMods().length) syncModBuildings()

// FR/EN keywords from the path words (search in the Library page)
const FR: Record<string, string> = { house: 'maison', barn: 'grange', church: 'église', shed: 'abri', garage: 'garage', store: 'magasin', shop: 'magasin', school: 'école', hospital: 'hôpital', castle: 'château', wall: 'mur', tower: 'tour', bridge: 'pont', dam: 'barrage', tunnel: 'tunnel', railway: 'voie ferrée', station: 'gare', military: 'militaire', barrack: 'caserne', barracks: 'caserne', industrial: 'industriel', factory: 'usine', fence: 'clôture', gate: 'portail', agriculture: 'agricole', farm: 'ferme', cowshed: 'étable', apartment: 'immeuble', appartment: 'immeuble', city: 'ville', village: 'village', town: 'ville', pub: 'bar', supermarket: 'supermarché', gas: 'essence', firestation: 'caserne pompiers', bunker: 'bunker', culture: 'culturel', road: 'route', bus: 'bus', platform: 'quai', powerline: 'ligne électrique', props: 'objet', civilian: 'civil', large: 'grand', small: 'petit', wooden: 'bois', metal: 'métal', brick: 'brique', stone: 'pierre' }
export function modKeywords(p: string): string[] {
  const w = new Set<string>()
  for (const t of p.replace(/\.et$/i, '').split(/[\/_\s\-.]+|(?<=[a-z])(?=[A-Z])/)) {
    const k = t.toLowerCase()
    if (k.length < 3 || /^\d+$/.test(k) || /^v\d+$/.test(k)) continue
    w.add(k); if (FR[k]) w.add(FR[k])
  }
  return [...w]
}
const KIND: Record<BuildingCat, AssetKind> = { houseS: 'house', houseM: 'house', houseL: 'house', farm: 'farm', annex: 'annex', shed: 'shed', civic: 'civic', block: 'block' }
/** Library-page pack of a mod registry (all its rows, browsable like vanilla entries) */
export function modAssetPack(guid: string): AssetPack | null {
  const m = MOD_INDEX.find((x) => x.guid === guid)
  if (!m) return null
  const assets: Asset[] = modPrefabs({ mods: [guid] }).filter((r) => r.g).map((r) => {
    const c = buildingCat(r)
    const kind: AssetKind = /Church|Chapel/i.test(r.p) ? 'religious' : c ? KIND[c] : industrialRole(r) ? 'industrial' : /Military|Bunker|Barrack/i.test(r.p) ? 'military' : /Fence/i.test(r.p) ? 'fence' : /wall/i.test(r.p) ? 'wall' : /Tree/i.test(r.p) ? 'tree' : /Bush/i.test(r.p) ? 'bush' : 'prop'
    const b = bounds(r)
    return { guid: modRef(r), name: r.p.split('/').pop()!.replace(/\.et$/i, ''), kind, footprint: { ...b, h: r.d[2], measured: true }, biomes: ['*'], tags: [...new Set([...r.t, ...modKeywords(r.p), 'mod'])], source: guid, author: m.name, licence: m.licence ?? 'see Workshop page' }
  })
  return { format: 'reforger-mapper.assetpack', version: 1, id: 'mod-' + m.id.toLowerCase(), name: m.name, author: m.name, licence: m.licence ?? 'see Workshop page', source: guid, description: `Workshop addon ${guid} v${m.version}`, assets }
}
