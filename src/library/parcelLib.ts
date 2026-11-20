// Parcel library: whole plots (a fenced garden with its house, shed, trees and props; a cemetery; an industrial
// yard; a fuel station...) kept as Compositions with a `category`. Sources: the vanilla harvest
// (library/parcels-vanilla.json: PakTools/parcel_lib_harvest.py, the 109 farmsteads included), the parcels saved
// in the Workbench by MG_SaveParcelPlugin (bridge GET /parcels) and any pack imported in the library page.
// Frame: metres around the bounding centre, +Z = the access road side, items[0] = main object. Pure (no DOM).

import { PARCELS_PACK, type Composition, type ParcelCategory, PARCEL_CATEGORIES } from './index.ts'
import type { VanillaTemplate } from '../modules/vanillaSites'
import { toWorld } from '../modules/gen-common'

export { PARCEL_CATEGORIES }
export type { ParcelCategory }

const extra: Composition[] = []
/** add parcels at run time (Workbench saves, imported packs); a duplicate id replaces the older one */
export function addParcels(list: Composition[]): number {
  let n = 0
  for (const c of list) {
    if (!c || !Array.isArray(c.items) || !c.items.length || !c.size) continue
    const i = extra.findIndex((x) => x.id === c.id)
    if (i >= 0) extra[i] = c
    else extra.push(c)
    n++
  }
  return n
}

/** every library parcel (vanilla harvest first) */
export function allParcels(): Composition[] {
  return [...((PARCELS_PACK.compositions ?? []) as Composition[]), ...extra]
}

/** parcels grouped by category, in PARCEL_CATEGORIES order; uncategorised compositions are left out */
export function parcelsByCategory(list: Composition[] = allParcels()): Map<ParcelCategory, Composition[]> {
  const m = new Map<ParcelCategory, Composition[]>()
  for (const k of PARCEL_CATEGORIES) m.set(k, [])
  for (const c of list) if (c.category) m.get(c.category)?.push(c)
  for (const [k, v] of m) if (!v.length) m.delete(k)
  return m
}

export interface PickOptions { biome?: string; maxW?: number; maxD?: number; seed?: number }
/** deterministic pick of one parcel of a category that fits (biome preferred, then any biome) */
export function pickParcel(category: ParcelCategory, o: PickOptions = {}, list: Composition[] = allParcels()): Composition | null {
  const fit = list.filter((c) => c.category === category && c.size.w <= (o.maxW ?? Infinity) && c.size.d <= (o.maxD ?? Infinity))
  const local = o.biome ? fit.filter((c) => c.biomes.includes(o.biome!)) : fit
  const pool = local.length ? local : fit
  if (!pool.length) return null
  return pool[Math.abs(Math.floor(o.seed ?? 0)) % pool.length]
}

/** a parcel as a vanilla site template, so zones.makeVanillaSite stamps it (same frame: +Z = access road) */
export function parcelTemplate(c: Composition): VanillaTemplate {
  const radius = Math.hypot(c.size.w, c.size.d) / 2
  return { id: `parcel_${c.id.replace(/-/g, '_')}`, map: String(c.where?.[0] ?? 'library'), x: 0, z: 0, axisYaw: 0, roadDist: 0, roadType: null, radius, slope: 0,
    objects: c.items.map((i) => ({ p: i.prefab, dx: i.x, dz: i.z, yaw: i.yaw })) }
}

/** world corners [x0,z0,...] of a parcel's footprint placed at (x, z), +Z turned to yaw */
export function parcelCorners(c: Composition, x: number, z: number, yaw: number): number[] {
  const w = c.size.w / 2, d = c.size.d / 2
  return [[-w, -d], [w, -d], [w, d], [-w, d]].flatMap(([lx, lz]) => toWorld(x, z, yaw, lx, lz))
}

export interface Spot { x: number; z: number; yaw: number }
export interface SpotContext {
  roads: { pts: number[]; width?: number }[]
  /** obstacles to keep clear of (buildings, zones): discs */
  blocked: { x: number; z: number; r: number }[]
  /** false = water / outside the map / too steep */
  ok?: (x: number, z: number) => boolean
  n?: number
  step?: number
}

const segDist = (x: number, z: number, ax: number, az: number, bx: number, bz: number) => {
  const vx = bx - ax, vz = bz - az, L = vx * vx + vz * vz
  const t = L ? Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / L)) : 0
  return Math.hypot(x - ax - t * vx, z - az - t * vz)
}
/** distance from (x, z) to the nearest road edge */
export function roadClearance(roads: SpotContext['roads'], x: number, z: number): number {
  let best = Infinity
  for (const r of roads) for (let i = 2; i < r.pts.length; i += 2) best = Math.min(best, segDist(x, z, r.pts[i - 2], r.pts[i - 1], r.pts[i], r.pts[i + 1]) - (r.width ?? 6) / 2)
  return best
}

/** the yaw that turns a parcel at (x, z) to face its nearest road (+Z towards the road); null = no road within 200 m */
export function yawToRoad(roads: SpotContext['roads'], x: number, z: number): number | null {
  let best: { d: number; px: number; pz: number } | null = null
  for (const r of roads) for (let i = 2; i < r.pts.length; i += 2) {
    const ax = r.pts[i - 2], az = r.pts[i - 1], vx = r.pts[i] - ax, vz = r.pts[i + 1] - az, L = vx * vx + vz * vz
    const t = L ? Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / L)) : 0
    const px = ax + t * vx, pz = az + t * vz, d = Math.hypot(x - px, z - pz)
    if (d < 200 && (!best || d < best.d)) best = { d, px, pz }
  }
  if (!best || best.d < 1e-6) return null
  return (Math.atan2(best.px - x, best.pz - z) * 180) / Math.PI
}

/**
 * Road-side spots for a parcel: along every road, on both sides, the plot front `gap` m from the road edge, +Z
 * turned to the road; the whole footprint keeps clear of every road (gap), of the obstacles and of the other spots.
 */
export function suggestParcelSpots(c: Composition, ctx: SpotContext, gap = 2): Spot[] {
  const out: Spot[] = []
  const n = ctx.n ?? 5, step = ctx.step ?? Math.max(12, c.size.w)
  const R = Math.hypot(c.size.w, c.size.d) / 2
  for (const r of ctx.roads) {
    const hw = (r.width ?? 6) / 2
    for (let i = 2; i < r.pts.length && out.length < n; i += 2) {
      const ax = r.pts[i - 2], az = r.pts[i - 1], vx = r.pts[i] - ax, vz = r.pts[i + 1] - az, L = Math.hypot(vx, vz)
      if (L < c.size.w) continue
      const tx = vx / L, tz = vz / L
      for (let s = c.size.w / 2; s <= L - c.size.w / 2 && out.length < n; s += step) {
        for (const side of [1, -1]) {
          const nx = -tz * side, nz = tx * side, off = hw + gap + c.size.d / 2
          const x = ax + tx * s + nx * off, z = az + tz * s + nz * off
          const yaw = (Math.atan2(-nx, -nz) * 180) / Math.PI
          if (ctx.ok && !ctx.ok(x, z)) continue
          if (ctx.blocked.some((b) => Math.hypot(b.x - x, b.z - z) < b.r + R)) continue
          if (out.some((p) => Math.hypot(p.x - x, p.z - z) < 2 * R)) continue
          const cs = parcelCorners(c, x, z, yaw)
          let clear = true
          for (let k = 0; k < 8 && clear; k += 2) if (roadClearance(ctx.roads, cs[k], cs[k + 1]) < gap - 0.5) clear = false
          if (clear && roadClearance(ctx.roads, x, z) < c.size.d / 2 + gap - 0.5) clear = false
          if (!clear) continue
          out.push({ x, z, yaw })
          break
        }
      }
    }
  }
  return out
}

/** a parcel saved in the Workbench by MG_SaveParcelPlugin ($profile:MapGen/parcels/<name>.json) -> library parcel */
export interface SavedParcel { name: string; category?: string; road?: string; size?: { w: number; d: number }; items: { prefab: string; x: number; y?: number; z: number; yaw: number; scale?: number }[] }
const PREFAB_RE = /^\{[0-9A-F]{16}\}[^\s{}]+\.et$/i
export function savedToComposition(s: SavedParcel): Composition | null {
  if (!s || typeof s.name !== 'string' || !Array.isArray(s.items)) return null
  const items = s.items.filter((i) => i && PREFAB_RE.test(i.prefab) && Number.isFinite(i.x) && Number.isFinite(i.z) && Number.isFinite(i.yaw))
    .map((i) => ({ prefab: i.prefab, x: i.x, y: Number.isFinite(i.y) ? i.y! : 0, z: i.z, yaw: i.yaw, ...(i.scale && i.scale !== 1 ? { scale: i.scale } : {}) }))
  if (!items.length) return null
  let w = s.size?.w ?? 0, d = s.size?.d ?? 0
  if (!(w > 0 && d > 0)) {
    w = Math.max(...items.map((i) => Math.abs(i.x))) * 2 + 4; d = Math.max(...items.map((i) => Math.abs(i.z))) * 2 + 4
  }
  const cat = (PARCEL_CATEGORIES as string[]).includes(s.category ?? '') ? (s.category as ParcelCategory) : 'custom'
  const id = 'wb-' + (s.name.toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'parcel')
  return { id, name: s.name, category: cat, road: s.road === 'none' ? 'none' : 'front', size: { w: Math.round(w * 10) / 10, d: Math.round(d * 10) / 10 }, items,
    biomes: ['temperate_everon', 'woodland_arland', 'nordic_kolguyev', 'mediterranean_dry'], tags: [cat, 'workbench'], source: 'vanilla', author: 'local (Workbench)', licence: 'CC-BY-4.0' }
}
