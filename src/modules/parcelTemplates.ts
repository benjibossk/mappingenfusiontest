// Parcel templates: real Bohemia farmsteads (house + barn / sheds / garages) harvested from Everon, Arland and
// Kolguyev by PakTools/parcel_harvest.py. Each item sits in the street frame of its house, the same frame as
// villageLots.lotPoint: d = depth from the road edge, u = across the lot, rel = yaw minus the heading of the depth
// axis (frame (u, n) with cross(u, n) = +1). A held-out map can be excluded (bench: --parcel-holdout).
import DATA from '../data/parcelTemplates.json' with { type: 'json' }

export interface ParcelItem { cat: string; u: number; d: number; rel: number; prefab: string }
export interface ParcelTemplate { id: string; map: string; road: string; width: number; depth: number; items: ParcelItem[] }
const ALL: ParcelTemplate[] = (DATA as { parcels: ParcelTemplate[] }).parcels

let holdout: string | null = null
/** exclude the parcels harvested on one map (held-out evaluation); null = use them all */
export function setParcelHoldout(map: string | null): void { holdout = map ? map.toLowerCase() : null }
export function parcelTemplates(): ParcelTemplate[] { return holdout ? ALL.filter((p) => p.map !== holdout) : ALL }

export interface LotFrame { cx: number; cz: number; ux: number; uz: number; nx: number; nz: number; d: number }

/**
 * World poses of a template's items on a lot. d0 = depth of the lot front from the road edge; mirror flips the
 * across axis (and reflects the yaws about the depth axis).
 */
export function placeParcel(t: ParcelTemplate, lot: LotFrame, d0: number, mirror: boolean, square = true): { x: number; z: number; yaw: number; item: ParcelItem }[] {
  const s = lot.ux * lot.nz - lot.uz * lot.nx >= 0 ? 1 : -1 // match the harvested handedness
  const m = mirror ? -1 : 1
  const ux = lot.ux * s * m, uz = lot.uz * s * m
  const hn = (Math.atan2(lot.nx, lot.nz) * 180) / Math.PI
  const fx = lot.cx - lot.nx * (lot.d / 2), fz = lot.cz - lot.nz * (lot.d / 2) // front centre
  const out = t.items.map((it) => {
    const dd = it.d - d0
    const rel = mirror ? -it.rel : it.rel
    return { x: fx + ux * it.u + lot.nx * dd, z: fz + uz * it.u + lot.nz * dd, yaw: hn + rel, item: it }
  })
  if (square && out.length) {
    // turn the whole parcel about its house so the house squares with the street (our lots face the street);
    // the barns / sheds keep their vanilla angle and offset relative to the house
    const a = out[0], r = ((a.yaw - hn) % 90 + 135) % 90 - 45, th = (-r * Math.PI) / 180, c = Math.cos(th), sn = Math.sin(th)
    for (const p of out) {
      const vx = p.x - a.x, vz = p.z - a.z
      p.x = a.x + vx * c + vz * sn; p.z = a.z - vx * sn + vz * c; p.yaw -= r
    }
  }
  for (const p of out) p.yaw = Math.round(p.yaw)
  return out
}

/** share of the farm-ring lots trying a harvested farmstead, per biome (bench calibration, CAL_parcels.md):
 * Kolguyev 0.2 (0.6 cost it villages / fences), Arland 0 (5 sites: any farmstead cost its lot fences 91 -> 75) */
export function parcelShareOf(biome?: string): number | undefined {
  if (biome === 'nordic_kolguyev') return 0.2
  if (biome === 'woodland_arland') return 0
  return undefined
}
