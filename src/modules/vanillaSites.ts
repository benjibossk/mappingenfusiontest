// Vanilla site templates (data/templates/vanilla_sites.json, built by tools/PakTools/sites_analysis.py from the
// Bohemia worlds Eden / Cain / Arland): real military bases, checkpoints, ports, fuel depots... normalised to a
// local frame (origin = site centre, +Z = towards the access road). stampTemplate() puts one back in the world.
import LIB from '../../data/templates/vanilla_sites.json' with { type: 'json' }
import type { ProjectEntity } from '../project'
import { toWorld, round } from './gen-common'

export interface VanillaObject { p: string; dx: number; dz: number; yaw: number }
export interface VanillaTemplate {
  id: string; map: string; x: number; z: number; axisYaw: number
  roadDist: number; roadType: string | null; radius: number; slope: number
  objects: VanillaObject[]
}
export type VanillaSiteType = keyof typeof LIB.types

export const VANILLA_SITES = LIB.types as unknown as Record<string, VanillaTemplate[]>

export function vanillaTemplates(type: string): VanillaTemplate[] { return VANILLA_SITES[type] ?? [] }

/** deterministic pick among the templates of a type */
export function pickTemplate(type: string, seed: number, fit?: (t: VanillaTemplate) => boolean): VanillaTemplate | null {
  const all = vanillaTemplates(type), fitting = fit ? all.filter(fit) : all
  const t = fitting.length ? fitting : all
  if (!t.length) return null
  return t[Math.abs(Math.floor(seed)) % t.length]
}

export interface StampOptions {
  /** id prefix of the produced entities */
  id?: string
  /** terrain height; when given each object gets ycm = ground(x, z) * 100 (snapped to the terrain) */
  groundAt?: (x: number, z: number) => number
  /** drop objects whose prefab matches (e.g. clutter) */
  skip?: RegExp
  /** keep only objects within this radius of the centre */
  maxRadius?: number
}

/** world entities of a template stamped at (x, z), its +Z (access side) turned to `yaw` (Enfusion degrees).
 *  Objects are left on the terrain (no ycm) unless groundAt is given. */
export function stampTemplate(t: VanillaTemplate, x: number, z: number, yaw: number, o: StampOptions = {}): ProjectEntity[] {
  const out: ProjectEntity[] = []
  t.objects.forEach((ob, i) => {
    if (o.skip && o.skip.test(ob.p)) return
    if (o.maxRadius !== undefined && Math.hypot(ob.dx, ob.dz) > o.maxRadius) return
    const [wx, wz] = toWorld(x, z, yaw, ob.dx, ob.dz)
    const e: ProjectEntity = { id: `${o.id ?? t.id}-${i}`, prefab: ob.p, x: round(wx), z: round(wz), yaw: round((((yaw + ob.yaw) % 360) + 360) % 360) }
    if (o.groundAt) e.ycm = Math.round(o.groundAt(wx, wz) * 100)
    out.push(e)
  })
  return out
}

/** port objects that belong in the water (breakwaters, wooden piers, dolphins, slipways, boats, buoys) */
export const PORT_WATER_RX = /\/Naval\/(Breakwater|Piers\/MooringDolphin|Piers\/Pier_?Wood|Piers\/PierWooden|Slipway)|Wreck|^\{[0-9A-F]{16}\}Prefabs\/Props\/Naval\//i
/** port objects that belong on dry land (everything that is not naval: sheds, containers, cranes, fences...) */
export const isPortLand = (p: string) => !/\/Naval\//i.test(p)

/** convex hull [x0, z0, x1, z1, ...] of points (monotone chain), counter-clockwise */
export function convexHull(pts: [number, number][]): number[] {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  if (p.length < 3) return p.flat()
  const cr = (o: number[], a: number[], b: number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const lo: [number, number][] = [], up: [number, number][] = []
  for (const q of p) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q) }
  for (const q of [...p].reverse()) { while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q) }
  return [...lo.slice(0, -1), ...up.slice(0, -1)].flat()
}

/** point inside a counter-clockwise convex polygon, grown by `pad` m */
export function inConvex(poly: number[], x: number, z: number, pad = 0): boolean {
  const n = poly.length / 2
  if (n < 3) return false
  for (let i = 0; i < n; i++) {
    const ax = poly[i * 2], az = poly[i * 2 + 1], bx = poly[((i + 1) % n) * 2], bz = poly[((i + 1) % n) * 2 + 1]
    const L = Math.hypot(bx - ax, bz - az) || 1
    if (((bx - ax) * (z - az) - (bz - az) * (x - ax)) / L < -pad) return false
  }
  return true
}

/** footprint hull of a stamped template (all its objects) */
export function stampHull(t: VanillaTemplate, x: number, z: number, yaw: number): number[] {
  return convexHull(t.objects.map((ob) => toWorld(x, z, yaw, ob.dx, ob.dz) as [number, number]))
}

/** true when a polyline (flat x/z) crosses / enters the hull (sampled every 4 m) */
export function lineInHull(hull: number[], l: ArrayLike<number>, pad = 0): boolean {
  for (let i = 0; i + 3 < l.length; i += 2) {
    const ax = l[i], az = l[i + 1], dx = l[i + 2] - ax, dz = l[i + 3] - az, n = Math.max(1, Math.ceil(Math.hypot(dx, dz) / 4))
    for (let k = 0; k <= n; k++) if (inConvex(hull, ax + (dx * k) / n, az + (dz * k) / n, pad)) return true
  }
  return false
}

export interface PortFit { x: number; z: number; yaw: number; water: number; land: number; score: number }

/** Places a port template on a coast: tries yaws (15°) and offsets around (x, z); scores the share of water parts
 *  (breakwaters, piers...) over the sea (h ≤ 0) and of land parts over dry ground (h > 0.5); candidates whose
 *  footprint hull a road enters are rejected. null = no fit with ≥ 60 % of the water parts at sea and ≥ 60 % of the
 *  land parts ashore. */
export function fitPort(t: VanillaTemplate, hAt: (x: number, z: number) => number, x: number, z: number, roads: ArrayLike<number>[] = [], o: { reach?: number; roadPad?: number } = {}): PortFit | null {
  const wat = t.objects.filter((ob) => PORT_WATER_RX.test(ob.p)), lnd = t.objects.filter((ob) => isPortLand(ob.p))
  if (!wat.length || !lnd.length) return null
  // subsample for speed
  const sub = <T,>(a: T[], n: number) => a.length <= n ? a : a.filter((_, i) => i % Math.ceil(a.length / n) === 0)
  const W = sub(wat, 60), L = sub(lnd, 60), reach = o.reach ?? Math.min(150, t.radius), step = Math.max(15, reach / 5)
  let best: PortFit | null = null
  const cands: PortFit[] = []
  for (let yaw = 0; yaw < 360; yaw += 15) for (let oz = -reach; oz <= reach; oz += step) for (let ox = -reach; ox <= reach; ox += step) {
    const cx = x + ox, cz = z + oz
    let w = 0, l = 0
    for (const ob of W) { const [px, pz] = toWorld(cx, cz, yaw, ob.dx, ob.dz); if (hAt(px, pz) <= 0) w++ }
    for (const ob of L) { const [px, pz] = toWorld(cx, cz, yaw, ob.dx, ob.dz); if (hAt(px, pz) > 0.5) l++ }
    const fw = w / W.length, fl = l / L.length
    if (fw < 0.6 || fl < 0.6) continue
    cands.push({ x: round(cx), z: round(cz), yaw, water: round(fw), land: round(fl), score: fw + fl - Math.hypot(ox, oz) / (reach * 20) })
  }
  cands.sort((a, b) => b.score - a.score)
  for (const c of cands.slice(0, 40)) {
    const hull = stampHull(t, c.x, c.z, c.yaw)
    if (roads.some((r) => lineInHull(hull, r, o.roadPad ?? 8))) continue
    best = c; break
  }
  return best
}
