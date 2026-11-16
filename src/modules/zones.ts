// One uniform record for the "big site" generators (industrial zone, military base, airfield) so the
// UI and the random world handle them the same way: drawn, flattened, sent, saved. Pure (no DOM).

import type { Grid } from './island'
import type { Road } from './roads'
import type { ProjectEntity, ProjectShape } from '../project'
import { applyFlatten, boxCorners, type FlattenRequest } from './gen-common'
import { generateIndustrial, applyFlatten as applyPlatform, type IndustrialType, type FlattenRequest as Platform } from './industrial'
import { generateMilitary, flattenFor, type MilitaryKind } from './military'
import { generateAirfield, flattenAirfield, type AirfieldSize } from './airfield'

export type ZoneKind = 'industrial' | 'military' | 'airfield'
export interface ZoneItem {
  id: string // IND_1, MIL_1, AIR_1 : prefix of every shape / entity id it sends
  kind: ZoneKind
  sub: string // industrial type, military kind or airfield size
  x: number
  z: number
  yaw: number
  seed: number
  /** footprints to draw (flat X/Z corners), role for the colour */
  boxes: { corners: number[]; role: string }[]
  shapes: ProjectShape[]
  entities: ProjectEntity[]
  flat: FlattenRequest[]
  plat: Platform[]
  /** industrial streets, kept as roads for the map and the masks */
  roads: Road[]
  warnings: string[]
  /** where the access road should arrive (airfield apron, base gate) */
  access?: [number, number]
}

const tag = (zid: string, id: string) => `${zid}_${id.replace(/[^A-Za-z0-9_]+/g, '_')}`
function prefixed(zid: string, shapes: ProjectShape[], entities: ProjectEntity[]) {
  return { shapes: shapes.map((s) => ({ ...s, id: tag(zid, s.id) })), entities: entities.map((e) => ({ ...e, id: tag(zid, e.id) })) }
}

export function makeAirfield(heights: number[], g: Grid, o: { id: string; size: AirfieldSize; x: number; z: number; yaw: number; seed: number }): ZoneItem {
  const a = generateAirfield({ size: o.size, x: o.x, z: o.z, yaw: o.yaw, seed: o.seed })
  flattenAirfield(a, heights, g)
  const boxes = [a.runway, ...a.taxiways, a.apron].map((b) => ({ corners: boxCorners(b), role: 'pave' }))
  for (const p of a.placements) boxes.push({ corners: boxCorners(p.box), role: p.role })
  return { id: o.id, kind: 'airfield', sub: o.size, x: o.x, z: o.z, yaw: o.yaw, seed: o.seed, boxes, ...prefixed(o.id, a.shapes, a.entities), flat: a.flatten, plat: [], roads: [], warnings: [], access: [a.apron.x, a.apron.z] }
}

export function makeMilitary(heights: number[], g: Grid, o: { id: string; kind: MilitaryKind; x: number; z: number; yaw: number; seed: number }): ZoneItem {
  const m = generateMilitary({ kind: o.kind, x: o.x, z: o.z, yaw: o.yaw, seed: o.seed })
  m.flatten = flattenFor(m, heights, g)
  const boxes = [{ corners: boxCorners(m.area), role: 'area' }, ...m.roads.map((b) => ({ corners: boxCorners(b), role: 'pave' })), ...m.placements.map((p) => ({ corners: boxCorners(p.box), role: p.role }))]
  return { id: o.id, kind: 'military', sub: o.kind, x: o.x, z: o.z, yaw: o.yaw, seed: o.seed, boxes, ...prefixed(o.id, m.shapes, m.entities), flat: [m.flatten], plat: [], roads: [], warnings: [], access: [m.gate[0], m.gate[1]] }
}

export function makeIndustrial(heights: number[], g: Grid, roads: Road[], o: { id: string; type: IndustrialType; x: number; z: number; seed: number; size?: { w: number; d: number } }): ZoneItem {
  const at = (x: number, z: number) => {
    const c = Math.min(g.cols - 1, Math.max(0, Math.round((x - g.minX) / g.step))), r = Math.min(g.rows - 1, Math.max(0, Math.round((z - g.minZ) / g.step)))
    return heights[r * g.cols + c]
  }
  const z = generateIndustrial(at, roads, { type: o.type, seed: o.seed, center: { x: o.x, z: o.z }, size: o.size, idPrefix: o.id.toLowerCase() })
  const boxes = [...z.lots.map((l) => ({ corners: l.corners, role: 'lot' })), ...z.placed.map((p) => ({ corners: p.corners, role: p.role }))]
  const yaw = Math.round((Math.atan2(z.frame.vx, z.frame.vz) * 180) / Math.PI)
  return { id: o.id, kind: 'industrial', sub: o.type, x: o.x, z: o.z, yaw, seed: o.seed, boxes, ...prefixed(o.id, z.shapes, z.entities), flat: [], plat: [z.flatten], roads: z.roads, warnings: z.warnings }
}

/** ground requests of every zone, in place, before carveRoads (same grid layout) */
export function applyZones(heights: number[], g: Grid, zones: ZoneItem[]) {
  for (const zn of zones) {
    if (zn.flat.length) applyFlatten(heights, g, zn.flat)
    for (const p of zn.plat) applyPlatform(heights, g, p)
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
  const p = kind === 'industrial' ? 'IND' : kind === 'military' ? 'MIL' : 'AIR'
  for (let n = 1; ; n++) if (!zones.some((z) => z.id === `${p}_${n}`)) return `${p}_${n}`
}
