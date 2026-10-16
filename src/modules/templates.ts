// Parcels captured from existing worlds by the Workbench plugin "MapGen - Capture templates": a main
// building with everything around it (fences, sheds, garden trees, kerbs...), positions in the
// building's frame. The village generator lays them like a building whose footprint is the whole
// parcel, then every object follows the building's position and yaw.

import { BUILDINGS, type Building, type BuildingCat } from '../data/buildings'
import type { ProjectEntity } from '../project'
import type { ParcelItems, Placed } from './settlements'

export interface ParcelItem { p: string; x: number; z: number; y: number; yaw: number; pitch: number; roll: number }
export interface Parcel { name: string; anchor: string; bounds: [number, number, number, number]; items: ParcelItem[] }

const REACH = 30 // objects further than this from the building are dropped (stray forest trees)
const ON_GROUND = 0.3 // below this height above the ground an object is snapped to the terrain

function category(p: Parcel): BuildingCat | null {
  const a = p.anchor
  // small structures join parcels, they never lead one (same list as the capture plugin)
  if (/Pipeline|Container|Crane|FuelTank|Shed|Garage|Booth|Kiosk|Toilet/i.test(a)) return null
  if (/Farm/i.test(a)) return 'farm'
  if (/Commercial|Civic|Pub/i.test(a)) return 'civic'
  if (!/Houses/i.test(a)) return null // factories, harbour: not village buildings
  const [x0, z0, x1, z1] = p.bounds
  const area = (x1 - x0) * (z1 - z0)
  return area < 90 ? 'houseS' : area < 180 ? 'houseM' : 'houseL'
}

const isAnchor = (p: Parcel, i: ParcelItem) => i.p === p.anchor && Math.abs(i.x) < 0.05 && Math.abs(i.z) < 0.05

/** kept objects of a parcel (anchor removed, strays dropped) */
function kept(p: Parcel) {
  return p.items.filter((i) => !isAnchor(p, i) && Math.hypot(i.x, i.z) <= REACH)
}

/** village building list: one entry per usable parcel (footprint = the whole parcel), plus the vanilla
 *  buildings of the categories no parcel covers */
export function parcelPool(parcels: Parcel[]): Building[] {
  const out: Building[] = []
  for (const p of parcels) {
    const cat = category(p)
    if (!cat) continue
    let [minX, minZ, maxX, maxZ] = p.bounds
    for (const i of kept(p)) {
      minX = Math.min(minX, i.x); maxX = Math.max(maxX, i.x)
      minZ = Math.min(minZ, i.z); maxZ = Math.max(maxZ, i.z)
    }
    out.push({ prefab: p.anchor, cat, minX, minZ, maxX, maxZ, tpl: p.name })
  }
  const covered = new Set(out.map((b) => b.cat))
  return [...out, ...BUILDINGS.filter((b) => !covered.has(b.cat))]
}

/** objects of a placed parcel, in world coordinates (same yaw convention as the buildings:
 *  local +Z goes to (sin yaw, cos yaw), local +X to (cos yaw, -sin yaw)) */
export function parcelItems(parcels: Parcel[], groundAt: (x: number, z: number) => number): ParcelItems {
  const byName = new Map(parcels.map((p) => [p.name, p]))
  return (q: Placed): ProjectEntity[] => {
    const p = q.tpl ? byName.get(q.tpl) : undefined
    if (!p) return []
    const a = (q.yaw * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a)
    return kept(p).map((i, k) => {
      const x = q.x + i.x * c + i.z * s, z = q.z - i.x * s + i.z * c
      const e: ProjectEntity = { id: `${q.id}P${k}`, prefab: i.p, x: Math.round(x * 100) / 100, z: Math.round(z * 100) / 100, yaw: Math.round(q.yaw + i.yaw) }
      if (i.y > ON_GROUND) e.ycm = Math.round((groundAt(x, z) + i.y) * 100)
      return e
    })
  }
}
