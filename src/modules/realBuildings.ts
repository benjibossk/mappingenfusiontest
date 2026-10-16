// OpenStreetMap building footprints -> vanilla buildings: each footprint gets its smallest enclosing
// rectangle, then the vanilla prefab whose size is closest (either way round), turned and centred on it.
// Footprints with no close match (blocks of flats, sheds of 2 m) are skipped and counted.

import { BUILDINGS, type Building } from '../data/buildings'
import { footprint, type Placed } from './settlements'

const MAX_COST = 0.9 // sum of |log(size ratio)| on both sides; 0.9 ~ each side within x1.6
const MAX = 4000

/** smallest-area rectangle around a ring: yaw (deg, local +Z along an edge), centre, width (X) and depth (Z) */
export function minRect(p: number[]) {
  let best = { area: Infinity, yaw: 0, cx: 0, cz: 0, w: 0, d: 0 }
  const n = p.length / 2
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    const ex = p[j * 2] - p[i * 2], ez = p[j * 2 + 1] - p[i * 2 + 1]
    if (Math.hypot(ex, ez) < 0.5) continue
    const a = Math.atan2(ex, ez), s = Math.sin(a), c = Math.cos(a)
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity
    for (let k = 0; k < n; k++) {
      const x = p[k * 2], z = p[k * 2 + 1]
      const v = x * c - z * s, u = x * s + z * c // local X, local Z
      u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v)
    }
    const area = (u1 - u0) * (v1 - v0)
    if (area < best.area) {
      const lx = (v0 + v1) / 2, lz = (u0 + u1) / 2
      best = { area, yaw: (a * 180) / Math.PI, cx: lx * c + lz * s, cz: -lx * s + lz * c, w: v1 - v0, d: u1 - u0 }
    }
  }
  return best
}

export function osmBuildings(rings: number[][], pool: Building[] = BUILDINGS.filter((b) => b.cat !== 'block')) {
  const placed: Placed[] = []
  let skipped = 0
  for (const ring of rings) {
    if (placed.length >= MAX) { skipped++; continue }
    const r = minRect(ring)
    if (r.area < 12 || !Number.isFinite(r.area)) { skipped++; continue }
    let cands: { b: Building; turn: number; cost: number }[] = []
    for (const b of pool) {
      const bw = b.maxX - b.minX, bd = b.maxZ - b.minZ
      for (const turn of [0, 90]) {
        const [w, d] = turn ? [r.d, r.w] : [r.w, r.d]
        cands.push({ b, turn, cost: Math.abs(Math.log(bw / w)) + Math.abs(Math.log(bd / d)) })
      }
    }
    cands.sort((a, b) => a.cost - b.cost)
    if (!cands.length || cands[0].cost > MAX_COST) { skipped++; continue }
    // a little variety between equally good prefabs, stable for the same footprint
    cands = cands.filter((c) => c.cost <= cands[0].cost + 0.1)
    const pick = cands[Math.abs(Math.round(r.cx * 7 + r.cz * 13)) % cands.length]
    const yaw = Math.round(r.yaw + pick.turn)
    const a = (yaw * Math.PI) / 180, s = Math.sin(a), c = Math.cos(a)
    const bx = (pick.b.minX + pick.b.maxX) / 2, bz = (pick.b.minZ + pick.b.maxZ) / 2
    const x = r.cx - (bx * c + bz * s), z = r.cz - (-bx * s + bz * c)
    placed.push({ id: `OSM_BLD_${placed.length + 1}`, site: 'OSM', prefab: pick.b.prefab, cat: pick.b.cat, x, z, yaw: ((yaw % 360) + 360) % 360, corners: footprint(pick.b, x, z, yaw) })
  }
  return { placed, skipped }
}
