// One uniform record for the "big site" generators (industrial zone, military base, airfield) so the
// UI and the random world handle them the same way: drawn, flattened, sent, saved. Pure (no DOM).

import type { Grid } from './island'
import type { Road } from './roads'
import type { ProjectEntity, ProjectShape } from '../project'
import { applyFlatten, boxCorners, type FlattenRequest } from './gen-common'
import { generateIndustrial, applyFlatten as applyPlatform, type IndustrialType, type FlattenRequest as Platform } from './industrial'
import { generateMilitary, flattenFor, type MilitaryKind } from './military'
import { applyDam, type Dam } from './dam'
import { pickTemplate, stampTemplate, type VanillaTemplate } from './vanillaSites'
import { wallPiecesToShapes } from './wallRuns'
import { applyHarbour, type HarbourPlan } from './harbour'
import { generateAirfield, flattenAirfield, type AirfieldSize, type AirfieldKind } from './airfield'
import { parcelCorners, parcelTemplate } from '../library/parcelLib'
import type { Composition } from '../library/schema'

export type ZoneKind = 'industrial' | 'military' | 'airfield' | 'site' // site: structured Zone-tool fills (sitezones.ts)
export interface ZoneItem {
  id: string // IND_1, MIL_1, AIR_1 : prefix of every shape / entity id it sends
  kind: ZoneKind
  sub: string // industrial type, military kind or airfield size
  x: number
  z: number
  yaw: number
  seed: number
  /** footprints to draw (flat X/Z corners), role for the colour */
  boxes: { corners: number[]; role: string; h?: number }[] // h: 3D height (props), default by role
  shapes: ProjectShape[]
  entities: ProjectEntity[]
  flat: FlattenRequest[]
  plat: Platform[]
  /** industrial streets, kept as roads for the map and the masks */
  roads: Road[]
  warnings: string[]
  /** where the access road should arrive (airfield apron, base gate) */
  access?: [number, number]
  /** dam embankment (dam.ts) sculpted into the relief by applyZones */
  dam?: { d: Dam; crestHalf: number; slope: number }
  /** port: dredged basin + flat apron (harbour.ts) sculpted by applyZones */
  harbour?: HarbourPlan
  /** RP / Life place role (rpPlaces.ts): police, clinic, market, fuel, sawmill... (metadata only, the map stays vanilla) */
  rpRole?: string
  /** surface core painted under the whole site box (parcelground.yardSurfaceMasks): RP yards (rpPlaces RP_GROUND) */
  ground?: string
}

const tag = (zid: string, id: string) => `${zid}_${id.replace(/[^A-Za-z0-9_]+/g, '_')}`
function prefixed(zid: string, shapes: ProjectShape[], entities: ProjectEntity[]) {
  return { shapes: shapes.map((s) => ({ ...s, id: tag(zid, s.id) })), entities: entities.map((e) => ({ ...e, id: tag(zid, e.id) })) }
}

export function makeAirfield(heights: number[], g: Grid, o: { id: string; size: AirfieldSize; kind?: AirfieldKind; x: number; z: number; yaw: number; seed: number }): ZoneItem {
  const kind = o.kind ?? 'military'
  const a = generateAirfield({ size: o.size, kind, x: o.x, z: o.z, yaw: o.yaw, seed: o.seed })
  flattenAirfield(a, heights, g)
  const ground = a.surface === 'grass' ? 'strip' : a.surface === 'dirt' ? 'dirt' : 'pave'
  const boxes = [a.runway, ...a.taxiways, ...(a.apron.hw ? [a.apron] : [])].map((b, i) => ({ corners: boxCorners(b), role: i ? 'pave' : ground }))
  for (const p of a.placements) boxes.push({ corners: boxCorners(p.box), role: p.role })
  boxes.push({ corners: boxCorners(a.site), role: 'area' })
  return { id: o.id, kind: 'airfield', sub: `${kind}-${o.size}`, x: o.x, z: o.z, yaw: o.yaw, seed: o.seed, boxes, ...prefixed(o.id, a.shapes, a.entities), flat: a.flatten, plat: [], roads: [], warnings: a.rejected, access: a.access }
}

/** naval / quay-edge pieces of a vanilla base, never stamped (bases are placed inland) */
const MIL_NAVAL_RX = /\/Naval\/|PierConcrete|Ladder_Pier|Davit|LifeBuoy|SeaBollard|Breakwater|Mooring/i
export function makeMilitary(heights: number[], g: Grid, o: { id: string; kind: MilitaryKind; x: number; z: number; yaw: number; seed: number; vanilla?: boolean }): ZoneItem {
  if (o.vanilla) { // real Bohemia base / checkpoint (data/templates/vanilla_sites.json); our yaw turns +Z AWAY from the road, the template's +Z faces it
    // a base template sized for the spot the suggester found (Cain's 290 m quarry-sized bases do not fit an outpost spot)
    const maxR = o.kind === 'main' ? 150 : 100, minN = o.kind === 'main' ? 150 : 50
    const v = makeVanillaSite(heights, g, { id: o.id, type: o.kind === 'checkpoint' ? 'checkpoint' : 'military_base', x: o.x, z: o.z, yaw: o.yaw + 180, seed: o.seed,
      // hillside bases (Cain 5072/6333 slope 0.39, Arland 1452/1834 0.62) are terraces of stone / retaining walls and dug-in
      // bunkers built for their slope: stamped on our flat platform they read as loose wall blocks and bare grey boxes (seed 21)
      fit: o.kind === 'checkpoint' ? undefined : (t) => t.radius <= maxR && t.objects.filter((ob) => !MIL_NAVAL_RX.test(ob.p)).length >= minN && t.slope <= 0.1,
      // coastal bases (Arland 1117/3367) carry their own quay: inland its pier blocks, davits and ladders stand dry (seed 21 live, port-dry)
      skip: MIL_NAVAL_RX })
    if (v) return { ...v, kind: 'military', sub: o.kind, yaw: o.yaw }
  }
  const m = generateMilitary({ kind: o.kind, x: o.x, z: o.z, yaw: o.yaw, seed: o.seed })
  m.flatten = flattenFor(m, heights, g)
  const boxes = [{ corners: boxCorners(m.area), role: 'area' }, ...m.roads.map((b) => ({ corners: boxCorners(b), role: 'pave' })), ...m.placements.map((p) => ({ corners: boxCorners(p.box), role: p.role }))]
  return { id: o.id, kind: 'military', sub: o.kind, x: o.x, z: o.z, yaw: o.yaw, seed: o.seed, boxes, ...prefixed(o.id, m.shapes, m.entities), flat: [m.flatten], plat: [], roads: [], warnings: [], access: [m.gate[0], m.gate[1]] }
}

export function makeIndustrial(heights: number[], g: Grid, roads: Road[], o: { id: string; type: IndustrialType; x: number; z: number; seed: number; size?: { w: number; d: number }; polygon?: number[] }): ZoneItem {
  const at = (x: number, z: number) => {
    const c = Math.min(g.cols - 1, Math.max(0, Math.round((x - g.minX) / g.step))), r = Math.min(g.rows - 1, Math.max(0, Math.round((z - g.minZ) / g.step)))
    return heights[r * g.cols + c]
  }
  const z = generateIndustrial(at, roads, { type: o.type, seed: o.seed, ...(o.polygon ? { polygon: o.polygon } : { center: { x: o.x, z: o.z }, size: o.size }), idPrefix: o.id.toLowerCase() })
  const boxes = [...z.lots.map((l) => ({ corners: l.corners, role: 'lot' })), ...z.placed.map((p) => ({ corners: p.corners, role: p.role }))]
  const yaw = Math.round((Math.atan2(z.frame.vx, z.frame.vz) * 180) / Math.PI)
  return { id: o.id, kind: 'industrial', sub: o.type, x: o.x, z: o.z, yaw, seed: o.seed, boxes, ...prefixed(o.id, z.shapes, z.entities), flat: [], plat: [z.flatten], roads: z.roads, warnings: z.warnings }
}

/** ground requests of every zone, in place, before carveRoads (same grid layout) */
export function applyZones(heights: number[], g: Grid, zones: ZoneItem[]) {
  for (const zn of zones) {
    if (zn.flat.length) applyFlatten(heights, g, zn.flat)
    for (const p of zn.plat) applyPlatform(heights, g, p)
    if (zn.dam) applyDam(heights, g, zn.dam.d, zn.dam)
    if (zn.harbour) applyHarbour(heights, g, zn.harbour)
  }
}

/** world AABBs [x0, z0, x1, z1] of every zone (for the village generator's `blocked`) */
export function zoneBlocked(zones: ZoneItem[], pad = 10): [number, number, number, number][] {
  return zones.map((zn) => {
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity
    for (const b of zn.boxes) for (let i = 0; i + 1 < b.corners.length; i += 2) {
      x0 = Math.min(x0, b.corners[i]); x1 = Math.max(x1, b.corners[i]); z0 = Math.min(z0, b.corners[i + 1]); z1 = Math.max(z1, b.corners[i + 1])
    }
    return [x0 - pad, z0 - pad, x1 + pad, z1 + pad] as [number, number, number, number]
  })
}

/** disc around a zone (keep-out for the other generators) */
export function zoneDisc(zn: ZoneItem): { x: number; z: number; r: number } {
  const [x0, z0, x1, z1] = zoneBlocked([zn], 0)[0]
  return { x: (x0 + x1) / 2, z: (z0 + z1) / 2, r: Math.hypot(x1 - x0, z1 - z0) / 2 }
}

export function nextZoneId(zones: ZoneItem[], kind: ZoneKind) {
  const p = kind === 'industrial' ? 'IND' : kind === 'military' ? 'MIL' : kind === 'site' ? 'SITE' : 'AIR'
  for (let n = 1; ; n++) if (!zones.some((z) => z.id === `${p}_${n}`)) return `${p}_${n}`
}

/** stamps a vanilla site template (military_base, checkpoint, port, fuel_depot, gas_station, farm...) at x/z, its
 *  access side (+Z) turned to `yaw`; ground flattened to the mean height over the template radius. null = no template. */
export function makeVanillaSite(heights: number[], g: Grid, o: { id: string; type: string; x: number; z: number; yaw: number; seed: number; fit?: (t: VanillaTemplate) => boolean; template?: VanillaTemplate; skip?: RegExp }): ZoneItem | null {
  const t = o.template ?? pickTemplate(o.type, o.seed, o.fit)
  if (!t) return null
  // loose wall pieces of the composition -> WG polylines (wallRuns.ts: every wall is a wall generator)
  const { entities, shapes } = wallPiecesToShapes(stampTemplate(t, o.x, o.z, o.yaw, { id: t.id, ...(o.skip ? { skip: o.skip } : {}) }), t.id)
  const r = Math.max(10, t.radius), box = { x: o.x, z: o.z, hw: r, hd: r, yaw: o.yaw }
  const flat: FlattenRequest[] = o.type === 'port' ? [] : [{ box, h0: 0, h1: 0, falloff: 15 }]
  if (flat.length) { // flat platform at the mean height of the footprint
    let sum = 0, n = 0
    for (let dz = -r; dz <= r; dz += g.step) for (let dx = -r; dx <= r; dx += g.step) {
      const c = Math.round((o.x + dx - g.minX) / g.step), w = Math.round((o.z + dz - g.minZ) / g.step)
      if (c >= 0 && w >= 0 && c < g.cols && w < g.rows) { sum += heights[w * g.cols + c]; n++ }
    }
    flat[0].h0 = flat[0].h1 = n ? sum / n : 0
  }
  return { id: o.id, kind: 'site', sub: `vanilla:${t.id}`, x: o.x, z: o.z, yaw: o.yaw, seed: o.seed, boxes: [{ corners: boxCorners(box), role: 'area' }],
    ...prefixed(o.id, shapes, entities), flat, plat: [], roads: [], warnings: [`vanilla template ${t.id} (${t.map} ${t.x},${t.z})`], access: [o.x + Math.sin(o.yaw * Math.PI / 180) * r, o.z + Math.cos(o.yaw * Math.PI / 180) * r] }
}

/** a library parcel (parcelLib.ts: garden, farm, cemetery, industrial yard...) placed at x/z, its access side (+Z)
 *  turned to `yaw`: stamped like a vanilla site (same frame), footprint = the parcel's box. */
export function makeLibraryParcel(heights: number[], g: Grid, o: { id: string; parcel: Composition; x: number; z: number; yaw: number; seed?: number }): ZoneItem | null {
  const zn = makeVanillaSite(heights, g, { id: o.id, type: 'parcel', x: o.x, z: o.z, yaw: o.yaw, seed: o.seed ?? 0, template: parcelTemplate(o.parcel) })
  if (!zn) return null
  const box = { x: o.x, z: o.z, hw: o.parcel.size.w / 2, hd: o.parcel.size.d / 2, yaw: o.yaw }
  zn.sub = `parcel:${o.parcel.id}`
  zn.boxes = [{ corners: parcelCorners(o.parcel, o.x, o.z, o.yaw), role: 'area' }]
  zn.flat = zn.flat.map((f) => ({ ...f, box }))
  zn.warnings = [`${o.parcel.category ?? 'parcel'} ${o.parcel.name}`]
  const [fx, fz] = [Math.sin(o.yaw * Math.PI / 180), Math.cos(o.yaw * Math.PI / 180)]
  zn.access = [o.x + fx * box.hd, o.z + fz * box.hd]
  return zn
}
