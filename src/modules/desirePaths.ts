// Desire paths: worn-ground strips from each house / farm shed / civic door to the nearest road or lane, as if
// people walking had worn the grass. No road entity: mask bands only (same format as roadMasks / buildingMasks,
// the bridge paints them into the surface masks at full resolution). Core = Dirt_01, the surface already laid
// under every building (buildingMasks), so a block gains no new layer. Narrow (1.5-2.5 m), soft edge, slight
// curve, fading (narrower) towards the road; a small worn patch in front of the door. Skipped when the door
// already touches a road (< 3 m) or no road is within 60 m; the path avoids building footprints and fence
// lines (it goes through the lot's gate gap or bends round), else it is dropped. Pure, deterministic.

import type { Placed } from './settlements'

export interface MaskBand { points: number[]; half: number; edge: number; core: string }
export interface DesireOptions { seed?: number; core?: string; maxDist?: number }

const CATS = new Set(['houseS', 'houseM', 'houseL', 'farm', 'shed', 'civic', 'annex'])

function rng(seed: number) {
  let a = seed >>> 0
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}
function inside(c: number[], x: number, z: number) {
  let s = false
  for (let i = 0, j = c.length - 2; i < c.length; j = i, i += 2) if ((c[i + 1] > z) !== (c[j + 1] > z) && x < ((c[j] - c[i]) * (z - c[i + 1])) / (c[j + 1] - c[i + 1]) + c[i]) s = !s
  return s
}
function segX(ax: number, az: number, bx: number, bz: number, cx: number, cz: number, dx: number, dz: number) {
  const d1 = (bx - ax) * (cz - az) - (bz - az) * (cx - ax), d2 = (bx - ax) * (dz - az) - (bz - az) * (dx - ax)
  const d3 = (dx - cx) * (az - cz) - (dz - cz) * (ax - cx), d4 = (dx - cx) * (bz - cz) - (dz - cz) * (bx - cx)
  return d1 * d2 < 0 && d3 * d4 < 0
}

/** door point: middle of the footprint side facing local +Z (model front = street), 1 m out */
export function doorOf(q: Pick<Placed, 'x' | 'z' | 'yaw' | 'corners'>): [number, number] {
  const a = (q.yaw * Math.PI) / 180, fx = Math.sin(a), fz = Math.cos(a)
  let ext = 0
  for (let i = 0; i < 8; i += 2) ext = Math.max(ext, (q.corners[i] - q.x) * fx + (q.corners[i + 1] - q.z) * fz)
  return [q.x + fx * (ext + 1), q.z + fz * (ext + 1)]
}

export function desirePaths(placed: Placed[], roads: { pts: number[]; half: number }[], fences: number[][], o: DesireOptions = {}): MaskBand[] {
  const core = o.core ?? 'Dirt_01', maxD = o.maxDist ?? 60, out: MaskBand[] = []
  const G = 50, rc = new Map<string, number[]>(), fc = new Map<string, number[]>(), bc = new Map<string, number[]>()
  const put = (m: Map<string, number[]>, x: number, z: number, i: number) => { const k = `${Math.floor(x / G)},${Math.floor(z / G)}`; const a = m.get(k) ?? m.set(k, []).get(k)!; if (a[a.length - 1] !== i) a.push(i) }
  roads.forEach((r, i) => { for (let k = 0; k < r.pts.length; k += 2) put(rc, r.pts[k], r.pts[k + 1], i) })
  fences.forEach((f, i) => { for (let k = 0; k < f.length; k += 2) put(fc, f[k], f[k + 1], i) })
  placed.forEach((q, i) => put(bc, q.x, q.z, i))
  const around = (m: Map<string, number[]>, x: number, z: number, r = 2) => { const s = new Set<number>(), cx = Math.floor(x / G), cz = Math.floor(z / G); for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) for (const i of m.get(`${cx + dx},${cz + dz}`) ?? []) s.add(i); return s }
  placed.forEach((q, qi) => {
    if (!CATS.has(q.cat) || !q.corners || q.corners.length < 8 || q.ycm !== undefined) return
    const [dx0, dz0] = doorOf(q)
    // nearest road edge point
    let best = Infinity, px = 0, pz = 0
    for (const i of around(rc, dx0, dz0)) {
      const p = roads[i].pts, h = roads[i].half
      for (let k = 2; k < p.length; k += 2) {
        const ax = p[k - 2], az = p[k - 1], ex = p[k] - ax, ez = p[k + 1] - az, L = ex * ex + ez * ez
        const t = L ? Math.max(0, Math.min(1, ((dx0 - ax) * ex + (dz0 - az) * ez) / L)) : 0
        const cx = ax + t * ex, cz = az + t * ez, d = Math.hypot(dx0 - cx, dz0 - cz) - h
        if (d < best) { best = d; const u = Math.hypot(dx0 - cx, dz0 - cz) || 1; px = cx + ((dx0 - cx) / u) * h * 0.6; pz = cz + ((dz0 - cz) / u) * h * 0.6 }
      }
    }
    const rand = rng((o.seed ?? 1) * 7919 + qi * 104729 + Math.round(q.x * 10))
    // small worn patch at the door
    const a = (q.yaw * Math.PI) / 180, sx = Math.cos(a), sz = -Math.sin(a)
    out.push({ points: [dx0 - sx * 1.2, dz0 - sz * 1.2, dx0 + sx * 1.2, dz0 + sz * 1.2], half: 1.1 + rand() * 0.4, edge: 1.2, core })
    if (best < 3 || best > maxD) return
    const L = Math.hypot(px - dx0, pz - dz0), nx = -(pz - dz0) / L, nz = (px - dx0) / L
    const nearB = [...around(bc, dx0, dz0, 1)].filter((i) => i !== qi).map((i) => placed[i].corners).filter((c) => c && c.length >= 8)
    const nearF = [...around(fc, dx0, dz0, 2)].map((i) => fences[i])
    // candidate bows (fraction of the length): straight-ish first, then wider bends either way
    const bow0 = (rand() - 0.5) * 0.16
    for (const bow of [bow0, -bow0, 0.18, -0.18, 0.3, -0.3]) {
      const pts: number[] = []
      const n = Math.max(3, Math.ceil(L / 4))
      for (let k = 0; k <= n; k++) { const t = k / n, b = Math.sin(Math.PI * t) * bow * L; pts.push(dx0 + (px - dx0) * t + nx * b, dz0 + (pz - dz0) * t + nz * b) }
      let ok = true
      for (let k = 0; k < pts.length && ok; k += 2) if (inside(q.corners, pts[k], pts[k + 1]) || nearB.some((c) => inside(c, pts[k], pts[k + 1]))) ok = false
      for (let k = 2; k < pts.length && ok; k += 2) for (const f of nearF) { for (let j = 2; j < f.length; j += 2) if (segX(pts[k - 2], pts[k - 1], pts[k], pts[k + 1], f[j - 2], f[j - 1], f[j], f[j + 1])) { ok = false; break } if (!ok) break }
      if (!ok) continue
      const w = 0.75 + rand() * 0.5 // half width 0.75-1.25 m (1.5-2.5 m strip)
      const cut = Math.max(2, Math.round(pts.length / 2 * 0.6) * 2)
      out.push({ points: pts.slice(0, cut + 2), half: w, edge: 1, core })
      out.push({ points: pts.slice(cut), half: w * 0.65, edge: 1.2, core }) // fading towards the road
      return
    }
  })
  return out
}
