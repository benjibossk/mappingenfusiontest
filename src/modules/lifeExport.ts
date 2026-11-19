// Writers of the optional <Map>_Life sub-addon (Life Framework). The map addon stays vanilla: everything LF lives
// here, in a SubScene of the map world, on the model of LF_Everon1989 (MainWorld.ent + MainWorld_Layers/*.layer).
// Prefab GUIDs and component GUIDs are read from the LF clone (.et.meta / the pack's layers), never invented.
import { hash, type LifeAnchor } from './lifeAnchors.ts'

export const LF_VERSION = 'Life-Framework@ca77150' // commit of the clone the table below was read from
export const LF_CORE_GUID = '4550A2B656E1B569'
export const BASE_GAME_GUID = '58D0FB3206B6F859'

/** kind → prefab + the component carrying the stable id (GUID = the prefab's own component id) */
export const LF_PREFABS = {
  farmPlot: '{A77FFCD72FB618B8}Prefabs/Vegetation/Crops/FarmPlot_Cabbage.et',
  seedCrate: '{696B13AE8A088B79}Prefabs/Props/Commercial/LF_SeedCrate_Cabbage.et',
  wheatField: '{5FF806585DB556B3}Prefabs/Harvest/LF_WheatField.et',
  beehive: '{D4E1B8A27C3F5096}Prefabs/Props/Farming/LF_Beehive.et',
  miningArea: '{530D05E39B25A8C8}Prefabs/Resources/Mining/MiningArea.et',
  Furnace: '{B63FA2F04B5A5B00}Prefabs/Processor/Furnace.et',
  Sawmill: '{61418A72BA63D059}Prefabs/Processor/Sawmill.et',
  fishingSpot: '{E8C5BD1716B703E0}Prefabs/Systems/Fishing/LF_FishingSpot.et',
  fishCounter: '{2F5749F913C9B23D}Prefabs/Props/Commercial/LF_FishCounter.et',
  workplace: '{F2DA01057E99744B}Prefabs/Jobs/LF_Workplace.et',
  house: '{4D1B7E92A6C03F58}Prefabs/Systems/Houses/LF_HouseMarker.et',
  houseSign: '{2F815241C89039BC}Prefabs/Props/Property/LF_HouseSaleSign.et',
  spawnBed: '{15468371DAC524FC}Prefabs/Medic/LF_FirstSpawnBed.et',
  fuelTill: '{4E4E1620C6B02E1F}Prefabs/Props/Commercial/EL_FuelTill.et',
  gameMode: '{03913608C59017A3}Prefabs/MP/Modes/Roleplay/GameMode_Roleplay.et',
  aiWorld: '{70CCCF16487C927F}Prefabs/AI/SCR_AIWorld_Eden.et', // as in LF_Everon1989 Gamemode.layer
  systems: '{2104C177A245B6D1}Configs/Systems/LifeFrameworkSystems.conf',
} as const
const COMP = {
  farmPlot: '{2E13CAF530967224}', beehive: '{F1F5F194CF1AE092}', fishingSpot: '{4A0F573235D2E074}', workplace: '{BB227AA77D72A6F6}',
  lock: '{A3F1C5D7092E4B68}', houseMgr: '{6E2F9A13B7D40C85}', houseSale: '{59380F11830D8A96}', spawnBed: '{FCB27F8C7C2E211B}',
}

export interface LifeExportOptions {
  mapId: string
  addonName: string // the map addon folder, e.g. Mapgenerator
  addonGuid: string // map addon GUID (16 hex), '' = to fill in
  world: string // map world folder, e.g. Worlds/MG_Test
}

const hex16 = (s: string) => (hash(s).toString(16).padStart(8, '0') + hash('#' + s + '#').toString(16).padStart(8, '0')).toUpperCase()
export const lifeGuid = (mapId: string, path: string) => hex16(`${mapId}|${path}`)
const ent = (s: string) => s.replace(/[^A-Za-z0-9_]/g, '_')
const n = (v: number) => String(Math.round(v * 1000) / 1000)
const coords = (a: LifeAnchor) => ` coords ${n(a.x)} ${n(a.y)} ${n(a.z)}\n${a.yaw ? ` angleY ${Math.round(a.yaw)}\n` : ''}`

function meta(guid: string, path: string, cls: 'ENT' | 'CONF' | 'LAYER'): string {
  const c = `${cls}ResourceClass`
  return `MetaFileClass {\n Name "{${guid}}${path}"\n Configurations {\n  ${c} PC {\n  }\n  ${c} XBOX_ONE : PC {\n  }\n  ${c} XBOX_SERIES : PC {\n  }\n  ${c} PS4 : PC {\n  }\n  ${c} HEADLESS : PC {\n  }\n }\n}`
}

/** one entity in the Homes_saint-philippe.layer format */
export function entityText(a: LifeAnchor): string {
  const name = ent(a.kind === 'house' ? `Home_${a.id}` : a.kind === 'houseSign' ? `HomeSign_${a.id}` : `LF_${a.id}`)
  const comp = (c: string, guid: string, body: string) => ` components {\n  ${c} "${guid}" {\n${body}  }\n }\n`
  switch (a.kind) {
    case 'house':
      return `GenericEntity ${name} : "${LF_PREFABS.house}" {\n components {\n  LF_BuildingLockComponent "${COMP.lock}" {\n  }\n  LF_HouseManagerComponent "${COMP.houseMgr}" {\n   m_sDebugIdentifier "${a.id}"\n  }\n }\n${coords(a)}}`
    case 'houseSign':
      return `GenericEntity ${name} : "${LF_PREFABS.houseSign}" {\n${comp('LF_HouseSaleComponent', COMP.houseSale, `   m_sHouseId "${a.id}"\n`)}${coords(a)}}`
    case 'farmPlot':
      return `GenericEntity ${name} : "${LF_PREFABS.farmPlot}" {\n${comp('LF_FarmPlotComponent', COMP.farmPlot, `   m_sPlotKey "${a.id}"\n`)}${coords(a)}}`
    case 'beehive':
      return `GenericEntity ${name} : "${LF_PREFABS.beehive}" {\n${comp('LF_HiveComponent', COMP.beehive, `   m_sHiveKey "${a.id}"\n`)}${coords(a)}}`
    case 'workplace':
      return `GenericEntity ${name} : "${LF_PREFABS.workplace}" {\n${comp('LF_WorkplaceComponent', COMP.workplace, `   m_sJob "${a.meta.job}"\n   m_sPlaceId "${a.meta.placeId}"\n`)}${coords(a)}}`
    case 'fishingSpot':
      return `GenericEntity ${name} : "${LF_PREFABS.fishingSpot}" {\n${comp('LF_FishingSpotComponent', COMP.fishingSpot, `   m_sId "${a.id}"\n   m_sTable "${a.meta.table}"\n   m_fRadius ${a.meta.radius}\n   m_iStock ${a.meta.stock}\n   m_fRegrowSeconds ${a.meta.regrow}\n`)}${coords(a)}}`
    case 'spawnBed':
      return `GenericEntity ${name} : "${LF_PREFABS.spawnBed}" {\n${comp('LF_FirstSpawnBedComponent', COMP.spawnBed, '')}${coords(a)}}`
    case 'wheatField':
      return `LF_WheatField ${name} : "${LF_PREFABS.wheatField}" {\n${coords(a)} m_fSizeX ${a.size![0]}\n m_fSizeZ ${a.size![1]}\n}`
    case 'miningArea':
      return `LF_MiningArea ${name} : "${LF_PREFABS.miningArea}" {\n${coords(a)} m_vSize ${a.size![0]} 1 ${a.size![1]}\n}`
    case 'processor':
      return `GenericEntity ${name} : "${LF_PREFABS[a.meta.type as 'Furnace' | 'Sawmill']}" {\n${coords(a)}}`
    case 'seedCrate': case 'fishCounter': case 'fuelTill':
      return `GenericEntity ${name} : "${LF_PREFABS[a.kind]}" {\n${coords(a)}}`
    default:
      return ''
  }
}

export function mapAreasConf(anchors: LifeAnchor[], mapId: string): string {
  const rows = anchors.filter((a) => a.kind === 'townArea' || a.kind === 'safeArea').map((a) => {
    const g = lifeGuid(mapId, 'area:' + a.id)
    if (a.kind === 'townArea') {
      const p = a.meta.points as number[], pts: string[] = []
      for (let i = 0; i < p.length; i += 2) pts.push(`${n(p[i])} 0 ${n(p[i + 1])}`)
      return `  LF_MapAreaRow "{${g}}" {\n   m_sId "${a.id}"\n   m_eStyle TOWN\n   m_eShape POLYGON\n   m_aPoints { ${pts.join(' ')} }\n  }`
    }
    return `  LF_MapAreaRow "{${g}}" {\n   m_sId "${a.id}"\n   m_eStyle SAFE\n   m_eShape CIRCLE\n   m_vCentre ${n(a.x)} 0 ${n(a.z)}\n   m_fRadius ${a.meta.radius}\n  }`
  })
  return `LF_MapAreaConfig {\n m_aAreas {\n${rows.join('\n')}\n }\n}`
}

/** every file of the <Map>_Life addon, paths relative to the addon root (folder name = `${addonName}_Life`) */
export function buildLifeAddon(anchors: LifeAnchor[], o: LifeExportOptions): Map<string, string> {
  const files = new Map<string, string>()
  const life = `${o.addonName}_Life`
  const worldName = o.world.split(/[\\/]/).filter(Boolean).pop() ?? 'World'
  const lw = `${worldName}Life`
  const entPath = `Worlds/${lw}/${lw}.ent`
  const entGuid = lifeGuid(o.mapId, entPath)
  const guid = lifeGuid(o.mapId, 'addon')
  const deps = [BASE_GAME_GUID, o.addonGuid || 'MAP_ADDON_GUID', LF_CORE_GUID].map((d) => `"${d}"`).join(' ')
  files.set(`${life}.gproj`, `GameProject {\n ID "${life}"\n GUID "${guid}"\n TITLE "${life} (Life Framework layer)"\n Dependencies {\n  ${deps}\n }\n Configurations {\n  GameProjectConfig PC {\n  }\n  GameProjectConfig XBOX_ONE {\n  }\n  GameProjectConfig XBOX_SERIES {\n  }\n  GameProjectConfig PS4 {\n  }\n  GameProjectConfig HEADLESS {\n  }\n }\n}`)
  files.set(entPath, `SubScene {\n Parent "${o.world.replace(/\\/g, '/')}/${worldName}.ent"\n}`)
  files.set(entPath + '.meta', meta(entGuid, entPath, 'ENT'))
  const layers = new Map<string, LifeAnchor[]>()
  for (const a of anchors) {
    if (a.family === 'Zones') continue
    const key = a.family === 'Homes' ? `Homes_${a.group ?? 'all'}` : a.family
    if (!layers.has(key)) layers.set(key, [])
    layers.get(key)!.push(a)
  }
  const dir = `Worlds/${lw}/${lw}_Layers`
  files.set(`${dir}/Gamemode.layer`, `LF_GameModeRoleplay GameMode_Roleplay1 : "${LF_PREFABS.gameMode}" {\n}\nSCR_AIWorld AIWorld_${ent(lw)} : "${LF_PREFABS.aiWorld}" {\n}`)
  for (const [k, list] of [...layers].sort((a, b) => (a[0] < b[0] ? -1 : 1))) files.set(`${dir}/${k}.layer`, list.map(entityText).filter(Boolean).join('\n'))
  const areasPath = `Configs/Map/LF_MapAreas_${worldName}.conf`
  const areasGuid = lifeGuid(o.mapId, areasPath)
  files.set(areasPath, mapAreasConf(anchors, o.mapId))
  files.set(areasPath + '.meta', meta(areasGuid, areasPath, 'CONF'))
  const misPath = `Missions/${life}.conf`
  files.set(misPath, `LF_MissionHeader {\n World "{${entGuid}}${entPath}"\n SystemsConfig "${LF_PREFABS.systems}"\n m_sName "${o.addonName} (Life)"\n m_sAuthor "reforger-mapper"\n m_sDescription "Generated map with the Life Framework layer. Needs Life Framework (Core)."\n m_sGameMode "Roleplay"\n m_iPlayerCount 32\n m_aLF_ConfigOverlays {\n  "{${areasGuid}}${areasPath}"\n }\n}`)
  files.set(misPath + '.meta', meta(lifeGuid(o.mapId, misPath), misPath, 'CONF'))
  files.set('README_LIFE.txt', `${life}: optional Life Framework layer of ${o.addonName} (${LF_VERSION}).\nDependencies: base game ${BASE_GAME_GUID}, map ${o.addonGuid || '(fill MAP_ADDON_GUID in the .gproj)'}, Life Framework core ${LF_CORE_GUID}.\nThe map addon itself stays vanilla. Anchors: ${anchors.length}.\n`)
  return files
}

// ---- minimal ZIP writer (stored, no compression): no dependency
const CRC = (() => { const t = new Uint32Array(256); for (let i = 0; i < 256; i++) { let c = i; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[i] = c >>> 0 } return t })()
function crc32(b: Uint8Array): number { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }

export function zipFiles(files: Map<string, string>, root = ''): Uint8Array {
  const enc = new TextEncoder(), parts: Uint8Array[] = [], central: Uint8Array[] = []
  let off = 0
  for (const [p, text] of files) {
    const name = enc.encode((root ? root + '/' : '') + p), data = enc.encode(text), crc = crc32(data)
    const h = new Uint8Array(30 + name.length), v = new DataView(h.buffer)
    v.setUint32(0, 0x04034b50, true); v.setUint16(4, 20, true); v.setUint16(6, 0x0800, true); v.setUint32(14, crc, true)
    v.setUint32(18, data.length, true); v.setUint32(22, data.length, true); v.setUint16(26, name.length, true); h.set(name, 30)
    const c = new Uint8Array(46 + name.length), cv = new DataView(c.buffer)
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(8, 0x0800, true); cv.setUint32(16, crc, true)
    cv.setUint32(20, data.length, true); cv.setUint32(24, data.length, true); cv.setUint16(28, name.length, true); cv.setUint32(42, off, true); c.set(name, 46)
    parts.push(h, data); central.push(c); off += h.length + data.length
  }
  const cdSize = central.reduce((s, c) => s + c.length, 0), end = new Uint8Array(22), ev = new DataView(end.buffer)
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, files.size, true); ev.setUint16(10, files.size, true); ev.setUint32(12, cdSize, true); ev.setUint32(16, off, true)
  const all = [...parts, ...central, end], out = new Uint8Array(all.reduce((s, a) => s + a.length, 0))
  let at = 0
  for (const a of all) { out.set(a, at); at += a.length }
  return out
}
