// Atelier zones → Workbench: the zone result as a generator Project (bridge POST /apply, the same path the
// generator uses for its entities), in dedicated layers MG_Zone_<name>_*. Every name starts with the zone
// family "MGZ<name>_": the plugin deletes that family before building, so a re-send replaces the zone and a
// send with `clear` only removes it. NEVER heights: no /heightmap, no /masks, no setupWorld (noHeights flag,
// checked here and by the bridge). Entities have no ycm: the Workbench puts them on the real terrain.
import type { Project, ProjectEntity, ProjectShape } from '../../project.ts'
import { settlementEntities, settlementShapes } from '../../modules/settlements.ts'
import { powerLineShape } from '../../modules/power.ts'
import { stationEntities } from '../../modules/powergrid.ts'
import { GENERATORS } from '../../project.ts'
import type { ZoneResult } from './generate.ts'

export interface ZoneProject extends Project { noHeights: true; clear: string[] }

/** zone name → tag safe in entity names / layer names / families (letters and digits only, no "_") */
export const zoneTag = (name: string) => (name.normalize('NFD').replace(/[^A-Za-z0-9]/g, '').slice(0, 24) || 'Zone')
export const zoneFamily = (tag: string) => `MGZ${tag}_`

const r2 = (v: number) => Math.round(v * 100) / 100

export function zoneProject(res: ZoneResult, tag: string): ZoneProject {
  const fam = zoneFamily(tag), L = (k: string) => `Zone_${tag}_${k}`
  let n = 0
  const ent = (e: ProjectEntity, layer: string): ProjectEntity => ({ ...e, id: `${fam}${e.id.replace(/[^\w]/g, '')}_${++n}`, layer: L(layer) })
  const shp = (s: ProjectShape, layer: string): ProjectShape & { layer: string } => ({ ...s, id: `${fam}${s.id.replace(/[^\w]/g, '')}_${++n}`, layer: L(layer) })
  const entities: ProjectEntity[] = [
    ...settlementEntities(res.placed).map((e) => ent(e, 'Houses')),
    ...res.parcels.flatMap((p) => p.items.map((it) => ent({ id: 'PARCEL', prefab: it.guid, x: r2(it.x), z: r2(it.z), yaw: Math.round(it.yaw) }, 'Yards'))),
    ...stationEntities(res.stations).map((e) => ent(e, 'Power')),
  ]
  const shapes: ProjectShape[] = [
    ...settlementShapes({ lanes: [...res.lanes, ...res.links], paths: [] }).map((s) => shp(s, 'Roads')),
    ...res.power.map((l) => shp(powerLineShape(l, l.id), 'Power')),
    ...res.hedges.map((pts) => shp({ id: 'HEDGE', kind: 'polyline', closed: false, points: pts.map(r2), generator: GENERATORS.hedgeCorylus }, 'Hedges')),
    ...res.parcels.flatMap((p) => p.fences.filter((f) => f.pts.length >= 4).map((f) => shp({ id: 'FENCE', kind: 'polyline', closed: false, points: f.pts.map(r2), generator: f.guid }, 'Yards'))),
    ...res.forests.map((pts) => shp({ id: 'FOREST', kind: 'polyline', closed: true, points: pts.map(r2), generator: GENERATORS.forestPine }, 'Forest')),
  ]
  for (const e of entities) delete e.ycm // on the real terrain, always
  return { version: 0, shapes, entities, noHeights: true, clear: [fam] }
}

/** project that only deletes the zone (its family), with the entity origins as a fallback for older plugins */
export function zoneDeleteProject(tag: string, last?: ZoneProject | null): ZoneProject {
  return { version: 0, shapes: [], entities: [], remove: (last?.entities ?? []).flatMap((e) => [e.x, e.z]), noHeights: true, clear: [zoneFamily(tag)] }
}

/** endpoints a zone send may call: the entity apply only (never /heightmap, /masks, /satmap, /setup-world) */
export const ZONE_ENDPOINTS = ['/apply'] as const
const FORBIDDEN_KEYS = ['heights', 'heightmap', 'grid', 'setupWorld', 'masks', 'surfaces', 'satmap']

export function assertZoneSafe(path: string, body: Record<string, unknown>) {
  if (!(ZONE_ENDPOINTS as readonly string[]).includes(path)) throw new Error(`zone send: endpoint ${path} refused (heights are never written)`)
  for (const k of FORBIDDEN_KEYS) if (k in body) throw new Error(`zone send: field "${k}" refused (heights are never written)`)
  if (body.noHeights !== true) throw new Error('zone send: noHeights flag missing')
  const fam = (body.clear as string[] | undefined)?.[0]
  if (!fam || !/^MGZ\w*_$/.test(fam)) throw new Error('zone send: zone family missing')
  for (const x of [...((body.entities as { id: string }[]) ?? []), ...((body.shapes as { id: string }[]) ?? [])]) if (!x.id.startsWith(fam)) throw new Error('zone send: object outside the zone family: ' + x.id)
}

export type Poster = (path: string, body: unknown) => Promise<string>
export const bridgePost: Poster = async (path, body) => {
  const { BRIDGE_URL } = await import('../../bridge.ts')
  const r = await fetch(BRIDGE_URL + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const out = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(out.error ?? out.message ?? `HTTP ${r.status}`)
  return String(out.message ?? 'ok')
}

/** send (or, with a delete project, remove) a zone: one guarded POST /apply, nothing else */
export async function sendZone(p: ZoneProject, post: Poster = bridgePost): Promise<string> {
  assertZoneSafe('/apply', p as unknown as Record<string, unknown>)
  return post('/apply', p)
}
