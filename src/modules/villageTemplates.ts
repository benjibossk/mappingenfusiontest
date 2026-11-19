// Village templates: real Bohemia village rows (Everon / Kolguyev / Arland) normalised to their main road,
// measured by PakTools/village_analysis.py (analyses/VILLAGES_VANILLA.md). A template is stamped along any
// road polyline: each house keeps its distance along the road (s), its signed offset from the axis and its
// yaw relative to the road heading, so the stamped row follows the curves of the new road.
import DATA from '../data/villageTemplates.json' with { type: 'json' }
import type { BuildingCat } from '../data/buildings'

export interface TemplateHouse { s: number; off: number; rel: number; cat: string }
export interface VillageTemplate { id: string; map: string; arch: string; at: number[]; road: string; length: number; houses: TemplateHouse[] }
export const VILLAGE_TEMPLATES: VillageTemplate[] = (DATA as { templates: VillageTemplate[] }).templates

export interface Stamped { x: number; z: number; yaw: number; cat: BuildingCat; s: number }

/** heading-aware point at arc length s on a flat [x,z,...] polyline: [x, z, tx, tz] (unit tangent) */
function at(pts: number[], s: number): [number, number, number, number] | null {
  let acc = 0
  for (let i = 0; i < pts.length / 2 - 1; i++) {
    const ax = pts[i * 2], az = pts[i * 2 + 1], dx = pts[i * 2 + 2] - ax, dz = pts[i * 2 + 3] - az
    const L = Math.hypot(dx, dz)
    if (L > 0 && acc + L >= s) { const t = (s - acc) / L; return [ax + dx * t, az + dz * t, dx / L, dz / L] }
    acc += L
  }
  return null
}

export function polyLength(pts: number[]): number {
  let L = 0
  for (let i = 0; i < pts.length / 2 - 1; i++) L += Math.hypot(pts[i * 2 + 2] - pts[i * 2], pts[i * 2 + 3] - pts[i * 2 + 1])
  return L
}

/**
 * Stamp template `tpl` along `pts` starting at arc length `start` (centred on the road when it is long enough).
 * mirror swaps the two sides of the road; scale stretches the spacing along the road (0.85-1.15 adapts a
 * template to a slightly shorter / longer road). Houses that would fall past the road end are dropped.
 */
export function stampTemplate(tpl: VillageTemplate, pts: number[], o: { start?: number; mirror?: boolean; scale?: number } = {}): Stamped[] {
  const total = polyLength(pts), k = o.scale ?? 1
  const start = o.start ?? Math.max(0, (total - tpl.length * k) / 2)
  const m = o.mirror ? -1 : 1
  const out: Stamped[] = []
  for (const h of tpl.houses) {
    const p = at(pts, start + h.s * k)
    if (!p) continue
    const [x, z, tx, tz] = p
    const nx = -tz, nz = tx // + offset side (see village_analysis.py: cross(tangent, house - road) > 0)
    const heading = (Math.atan2(tx, tz) * 180) / Math.PI
    // mirrored: the house goes to the other side and its yaw is reflected about the road axis
    const rel = o.mirror ? 180 - h.rel : h.rel
    const cat = (['houseS', 'houseM', 'houseL', 'farm', 'annex', 'shed', 'block', 'civic'].includes(h.cat) ? h.cat : 'houseM') as BuildingCat
    out.push({ x: x + nx * h.off * m, z: z + nz * h.off * m, yaw: Math.round(heading + rel), cat, s: start + h.s * k })
  }
  return out
}

/** template for an archetype ('street' | 'crossroads' | 'nucleated' | 'hamlet-roadside' ...), seeded pick */
export function pickTemplate(arch: string, r: number): VillageTemplate {
  const c = VILLAGE_TEMPLATES.filter((t) => t.arch === arch)
  const list = c.length ? c : VILLAGE_TEMPLATES
  return list[Math.floor(r * list.length) % list.length]
}
