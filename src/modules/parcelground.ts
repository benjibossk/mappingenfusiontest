// Custom ground inside parcels (same mask band format as roadMasks / poleDirtMasks, the bridge paints them):
// - cemetery: narrow gravel paths between the grave rows (rows recovered from the 'grave' boxes the
//   cemetery generator emits) + the main alley along its '_aisle' spline. No mowed-grass surface exists in
//   the mask set (Grass_01/02 only), so the rest of the cemetery keeps the surrounding texture.
// - gardens / farm yards: worn dirt where the parcel touches a building, plus a few seeded blotches
//   (dirt or patchy grass), total <= ~25 % of the parcel area. Soft edges, never a perfect circle.

export interface GroundMask { points: number[]; half: number; edge: number; core: string }

function rng(seed: number) {
  let s = seed >>> 0
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}
const hash = (x: number, z: number, seed: number) => (Math.imul(Math.round(x * 10), 73856093) ^ Math.imul(Math.round(z * 10), 19349663) ^ Math.imul(seed | 0, 83492791)) >>> 0

/** polyline from a to b cut into ~3 m pieces with sideways jitter (irregular edge) */
function wobbly(ax: number, az: number, bx: number, bz: number, amp: number, rand: () => number) {
  const L = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.round(L / 3)), nx = -(bz - az) / (L || 1), nz = (bx - ax) / (L || 1)
  const p: number[] = []
  for (let i = 0; i <= n; i++) { const t = i / n, j = i === 0 || i === n ? 0 : (rand() - 0.5) * 2 * amp; p.push(ax + (bx - ax) * t + nx * j, az + (bz - az) * t + nz * j) }
  return p
}

/** irregular blob of radius R at (x, z): overlapping short stubs, pushed into out; returns its approx area */
function blob(out: GroundMask[], x: number, z: number, R: number, core: string, rand: () => number) {
  const lobes = 3 + Math.floor(rand() * 3)
  for (let k = 0; k < lobes; k++) {
    const a = (k / lobes) * Math.PI * 2 + rand() * 1.2, off = R * (0.15 + rand() * 0.35)
    const cx = x + Math.cos(a) * off, cz = z + Math.sin(a) * off, b = rand() * Math.PI, len = R * (0.2 + rand() * 0.5)
    out.push({ points: [cx - Math.cos(b) * len / 2, cz - Math.sin(b) * len / 2, cx + Math.cos(b) * len / 2, cz + Math.sin(b) * len / 2], half: R * (0.35 + rand() * 0.3), edge: R * (0.3 + rand() * 0.3), core })
  }
  return Math.PI * R * R * 0.8
}

export const polyArea = (p: number[]) => { let s = 0; for (let i = 0, n = p.length / 2; i < n; i++) { const j = (i + 1) % n; s += p[2 * i] * p[2 * j + 1] - p[2 * j] * p[2 * i + 1] } return Math.abs(s) / 2 }
function inPoly(p: number[], x: number, z: number) {
  let c = false
  for (let i = 0, n = p.length / 2, j = n - 1; i < n; j = i++) { const xi = p[2 * i], zi = p[2 * i + 1], xj = p[2 * j], zj = p[2 * j + 1]; if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c }
  return c
}

/** Cemetery grave rows -> gravel paths (~1.2 m) between consecutive rows + main alley along the aisle spline.
 *  graves: grave box corners (rectAt order: c3 - c0 = the grave's long axis = across the rows). */
export function cemeteryPathMasks(graves: number[][], aisle: number[] | undefined, seed = 1, core = 'Dirt_03'): GroundMask[] {
  const out: GroundMask[] = []
  if (graves.length) {
    let vx = graves[0][6] - graves[0][0], vz = graves[0][7] - graves[0][1]
    const L = Math.hypot(vx, vz) || 1; vx /= L; vz /= L
    const ux = vz, uz = -vx
    const pts = graves.map((c) => { const x = (c[0] + c[4]) / 2, z = (c[1] + c[5]) / 2; return { u: x * ux + z * uz, v: x * vx + z * vz } }).sort((a, b) => a.v - b.v)
    const rows: { v: number; u0: number; u1: number; n: number }[] = []
    for (const p of pts) {
      const r = rows[rows.length - 1]
      if (r && p.v - r.v / r.n < 1.3) { r.v += p.v; r.n++; r.u0 = Math.min(r.u0, p.u); r.u1 = Math.max(r.u1, p.u) } else rows.push({ v: p.v, u0: p.u, u1: p.u, n: 1 })
    }
    for (const r of rows) r.v /= r.n
    for (let i = 0; i + 1 < rows.length; i++) {
      const a = rows[i], b = rows[i + 1]
      if (b.v - a.v > 6) continue // terrace / cross-aisle gap: not a between-rows path
      const v = (a.v + b.v) / 2, u0 = Math.max(a.u0, b.u0) - 0.5, u1 = Math.min(a.u1, b.u1) + 0.5
      if (u1 - u0 < 2) continue
      const rand = rng(hash(v, u0, seed))
      const line = wobbly(u0, v, u1, v, 0.12, rand), w: number[] = []
      for (let k = 0; k < line.length; k += 2) w.push(line[k] * ux + line[k + 1] * vx, line[k] * uz + line[k + 1] * vz)
      out.push({ points: w, half: 0.45 + rand() * 0.1, edge: 0.35 + rand() * 0.15, core })
    }
  }
  if (aisle && aisle.length >= 4) {
    const rand = rng(hash(aisle[0], aisle[1], seed))
    const w: number[] = []
    for (let i = 0; i + 3 < aisle.length; i += 2) { const s = wobbly(aisle[i], aisle[i + 1], aisle[i + 2], aisle[i + 3], 0.2, rand); w.push(...(i ? s.slice(2) : s)) }
    out.push({ points: w, half: 0.9, edge: 0.6, core })
  }
  return out
}

/** Gardens / farm yards: worn dirt where a building touches the parcel + 1-3 seeded blotches, <= maxShare of the area */
export function parcelGroundMasks(parcels: { corners: number[] }[], buildings: { x: number; z: number; corners: number[] }[], seed = 1, o: { dirt?: string; grass?: string; maxShare?: number } = {}): GroundMask[] {
  const dirt = o.dirt ?? 'Dirt_01', grass = o.grass ?? 'Grass_02', maxShare = o.maxShare ?? 0.25
  const out: GroundMask[] = []
  for (const p of parcels) {
    const A = polyArea(p.corners), n = p.corners.length / 2
    if (n < 3 || A < 20) continue
    let cx = 0, cz = 0
    for (let i = 0; i < n; i++) { cx += p.corners[2 * i]; cz += p.corners[2 * i + 1] }
    cx /= n; cz /= n
    const rand = rng(hash(cx, cz, seed)), budget = A * maxShare
    let used = 0
    const R0 = Math.min(3, Math.sqrt(A) * 0.12)
    const tryBlob = (x: number, z: number, R: number, core: string) => {
      if (!inPoly(p.corners, x, z) || used + Math.PI * R * R > budget) return
      used += blob(out, x, z, R, core, rand)
    }
    // worn dirt: parcel corners / edge midpoints within 4 m of a building (doors, yard gates)
    for (const b of buildings) {
      if (Math.abs(b.x - cx) > 80 || Math.abs(b.z - cz) > 80) continue
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n, mx = (p.corners[2 * i] + p.corners[2 * j]) / 2, mz = (p.corners[2 * i + 1] + p.corners[2 * j + 1]) / 2
        if (Math.hypot(mx - b.x, mz - b.z) > Math.hypot(b.corners[0] - b.x, b.corners[1] - b.z) + 4) continue
        tryBlob(mx + (cx - mx) * 0.15, mz + (cz - mz) * 0.15, R0, dirt)
      }
    }
    const k = 1 + Math.floor(rand() * 3)
    for (let i = 0; i < k; i++) {
      const t = rand(), q = Math.floor(rand() * n), x = cx + (p.corners[2 * q] - cx) * t * 0.8, z = cz + (p.corners[2 * q + 1] - cz) * t * 0.8
      tryBlob(x, z, R0 * (0.6 + rand() * 0.5), rand() < 0.5 ? dirt : grass)
    }
  }
  return out
}

/** Working yard (vanilla sawmill...): the whole box painted with a worn gravel / dirt surface, parallel soft bands
 *  inset `inset` m from the box edge (corners = 4 corners in order, c1 - c0 = width, c3 - c0 = depth). */
export function yardSurfaceMasks(corners: number[], seed = 1, core = 'Dirt_03', inset = 2): GroundMask[] {
  if (corners.length < 8) return []
  const [x0, z0, x1, z1, , , x3, z3] = corners
  const W = Math.hypot(x1 - x0, z1 - z0), D = Math.hypot(x3 - x0, z3 - z0)
  if (W < 2 * inset + 2 || D < 2 * inset + 2) return []
  const ux = (x1 - x0) / W, uz = (z1 - z0) / W, vx = (x3 - x0) / D, vz = (z3 - z0) / D
  const rand = rng(hash(x0, z0, seed)), out: GroundMask[] = [], step = 3.5
  for (let v = inset + 1.5; v <= D - inset - 1.5 + 1e-6; v += step) {
    const a = inset + rand() * 1.5, b = W - inset - rand() * 1.5
    const line = wobbly(a, v, b, v, 0.6, rand), w: number[] = []
    for (let k = 0; k < line.length; k += 2) w.push(x0 + ux * line[k] + vx * line[k + 1], z0 + uz * line[k] + vz * line[k + 1])
    out.push({ points: w, half: 2 + rand() * 0.4, edge: 1.2 + rand() * 0.6, core })
  }
  return out
}
