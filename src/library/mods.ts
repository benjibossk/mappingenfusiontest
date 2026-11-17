// Workshop mod prefab registries (library/mods/*.json, built from the installed paks' metadata only:
// paths, resource GUIDs, mesh bboxes; no mod asset is copied). Mods are OFF by default: nothing here
// changes a generator until the user ticks a mod (Library page / Send step). A project using mod
// prefabs needs those addons as dependencies of the target .gproj: requiredMods() lists them.
import INDEX from '../../library/mods/index.json' with { type: 'json' }
import ZIM from '../../library/mods/Zimnitrita_597697D81A1EA202.json' with { type: 'json' }
import MINUS from '../../library/mods/MinusBuildingPack_672166DE5926F11F.json' with { type: 'json' }
import KODIIS from '../../library/mods/KodiisBuildingSystem_644F5B4619455A52.json' with { type: 'json' }
import ANIZAY from '../../library/mods/Anizay_6266DCA9193C705E.json' with { type: 'json' }

export interface ModInfo { id: string; name: string; guid: string; version: string; file: string; dependencies: string[]; licence: string | null; count: number; families: Record<string, number> }
export interface ModPrefab { p: string; g?: string; c: string; s: string; t: string[]; d: number[]; mod: string }
type Reg = { guid: string; prefabs: Omit<ModPrefab, 'mod'>[] }

/** base game + engine core: always present, never reported as dependencies */
export const BASE_ADDONS = new Set(['58D0FB3206B6F859', '5614BBCCBB55ED1C'])
export const MOD_INDEX: ModInfo[] = (INDEX as unknown as { mods: ModInfo[] }).mods
const REGS: Reg[] = [ZIM, MINUS, KODIIS, ANIZAY] as unknown as Reg[]
const PREFABS = new Map<string, ModPrefab[]>(REGS.map((r) => [r.guid, r.prefabs.map((p) => ({ ...p, mod: r.guid }))]))

const KEY = 'reforger-mapper.mods'
let enabled: Set<string> = new Set()
try { enabled = new Set(JSON.parse(globalThis.localStorage?.getItem(KEY) ?? '[]') as string[]) } catch { /* storage blocked */ }
const listeners: (() => void)[] = []

export const enabledMods = (): string[] => [...enabled]
export function setEnabledMods(guids: string[]) {
  enabled = new Set(guids.filter((g) => PREFABS.has(g)))
  try { globalThis.localStorage?.setItem(KEY, JSON.stringify([...enabled])) } catch { /* storage blocked */ }
  for (const f of listeners) f()
}
export const setModEnabled = (guid: string, on: boolean) => setEnabledMods(on ? [...enabled, guid] : [...enabled].filter((g) => g !== guid))
export const onModsChange = (f: () => void) => void listeners.push(f)
export const modInfo = (guid: string) => MOD_INDEX.find((m) => m.guid === guid)

/** "{GUID}Prefabs/x.et" reference of a registry row */
export const modRef = (r: Pick<ModPrefab, 'p' | 'g'>) => (r.g ? `{${r.g}}` : '') + 'Prefabs/' + r.p

/** prefabs of the ENABLED mods (or of `mods`), filtered by tag / family prefix / path regex */
export function modPrefabs(q: { tag?: string; family?: string; path?: RegExp; mods?: string[] } = {}): ModPrefab[] {
  const out: ModPrefab[] = []
  for (const g of q.mods ?? enabled) for (const r of PREFABS.get(g) ?? []) {
    if (q.tag && !r.t.includes(q.tag)) continue
    if (q.family && !r.c.toLowerCase().startsWith(q.family.toLowerCase())) continue
    if (q.path && !q.path.test(r.p)) continue
    out.push(r)
  }
  return out
}

let byKey: Map<string, ModPrefab> | null = null
function index() {
  if (byKey) return byKey
  byKey = new Map()
  for (const rows of PREFABS.values()) for (const r of rows) { byKey.set(r.p.toLowerCase(), r); if (r.g) byKey.set(r.g, r) }
  return byKey
}
/** registry row of a prefab reference ("{GUID}Prefabs/x.et", GUID or path), any mod (enabled or not) */
export function modPrefab(ref: string): ModPrefab | null {
  const m = index(), s = ref.trim()
  const g = s.match(/^\{?([0-9A-Fa-f]{16})\}?/)
  if (g) { const v = m.get(g[1].toUpperCase()); if (v) return v }
  const p = s.replace(/^\{[0-9A-Fa-f]{16}\}/, '').replace(/^Prefabs\//i, '').toLowerCase()
  return (p && m.get(p)) || null
}
/** dims [w, dz, h, cx, cz] of a mod prefab (dims.ts falls back here) */
export const modDims = (ref: string) => modPrefab(ref)?.d ?? null

/** addons a project needs because of the prefabs it places (+ their mod dependencies), base game excluded */
export function requiredMods(prefabs: Iterable<string>): ModInfo[] {
  const need = new Set<string>()
  const add = (g: string) => {
    if (BASE_ADDONS.has(g) || need.has(g)) return
    need.add(g)
    for (const d of modInfo(g)?.dependencies ?? []) add(d)
  }
  for (const p of prefabs) { const r = modPrefab(p); if (r) add(r.mod) }
  return [...need].map((g) => modInfo(g) ?? { id: g, name: g, guid: g, version: '', file: '', dependencies: [], licence: null, count: 0, families: {} })
}

/** modular concrete dam pieces (Minus Building Pack Infrastructure/Dam/Dam_01 + Dam_02: 20 m crest slices,
 *  crest along local X, road on top) when their mod is enabled, else null */
export function modDamPieces(mods?: string[]): ModPrefab[] | null {
  const rows = modPrefabs({ path: /^Infrastructure\/Dam\/Dam_0[12]\.et$/i, mods })
  return rows.length === 2 ? rows.sort((a, b) => a.p.localeCompare(b.p)) : null
}
