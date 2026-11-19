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
export function pickTemplate(type: string, seed: number): VanillaTemplate | null {
  const t = vanillaTemplates(type)
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
