// Production forest ("forêt de production"): a managed wood inside a drawn polygon.
// A straight fishbone of forestry dirt tracks (one spine + perpendicular branches ~300 m apart, the spine laid
// along the contour when a ground sampler is given), compartments (parcelles) between the tracks, each with a
// stage (mature / juvenile / thinned / clear-cut), and felled-log piles along the track sides.

export type ProdStage = 'mature' | 'juvenile' | 'thinned' | 'clearcut'
export interface ProdCompartment { pts: number[]; stage: ProdStage }
export interface ProdLog { x: number; z: number; yaw: number } // yaw: degrees, along the track
export interface ProdForest { tracks: number[][]; compartments: ProdCompartment[]; logs: ProdLog[]; angle: number }
export interface ProdOptions {
  seed: number
  spacing?: number // metres between branches (default 230)
  roads?: number[][] // existing road polylines (flat X/Z) the spine is linked to
  linkMax?: number // max link length (default 500 m)
  ground?: (x: number, z: number) => number // to follow the slope: the spine runs along the contour
  mix?: Record<ProdStage, number> // stage shares (default 60 / 20 / 15 / 5 %)
}
export const PROD_MIX: Record<ProdStage, number> = { mature: 0.6, juvenile: 0.2, clearcut: 0.15, thinned: 0.05 }
const HALF = 4 // compartments stop this far from a track axis

function inPoly(p: number[], x: number, z: number) {
  let ins = false
  for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) if ((p[i + 1] > z) !== (p[j + 1] > z) && x < ((p[j] - p[i]) * (z - p[i + 1])) / (p[j + 1] - p[i + 1]) + p[i]) ins = !ins
  return ins
}
export function ringArea(p: number[]) {
  let a = 0
  for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) a += (p[j] - p[i]) * (p[j + 1] + p[i + 1])
  return Math.abs(a) / 2
}
/** Sutherland-Hodgman: polygon `p` clipped by the half-plane a*u + b*v <= c */
function clipHalf(p: number[], a: number, b: number, c: number): number[] {
  const out: number[] = [], n = p.length / 2
  for (let i = 0; i < n; i++) {
    const x0 = p[i * 2], z0 = p[i * 2 + 1], x1 = p[((i + 1) % n) * 2], z1 = p[((i + 1) % n) * 2 + 1]
    const d0 = a * x0 + b * z0 - c, d1 = a * x1 + b * z1 - c
    if (d0 <= 0) out.push(x0, z0)
    if ((d0 < 0) !== (d1 < 0) && d0 !== d1) { const t = d0 / (d0 - d1); out.push(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t) }
  }
  return out
}
/** inside intervals [t0, t1] of the line o + t*d through the polygon */
function lineSpans(p: number[], ox: number, oz: number, dx: number, dz: number): [number, number][] {
  const ts: number[] = []
  for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) {
    const ex = p[i] - p[j], ez = p[i + 1] - p[j + 1], den = dx * ez - dz * ex
    if (Math.abs(den) < 1e-9) continue
    const t = ((p[j] - ox) * ez - (p[j + 1] - oz) * ex) / den, s = ((p[j] - ox) * dz - (p[j + 1] - oz) * dx) / den
    if (s >= 0 && s < 1) ts.push(t)
  }
  ts.sort((a, b) => a - b)
  const out: [number, number][] = []
  for (let k = 0; k + 1 < ts.length; k += 2) if (ts[k + 1] - ts[k] > 1) out.push([ts[k], ts[k + 1]])
  return out
}

export function makeProdForest(zone: number[], o: ProdOptions): ProdForest {
  let s = (Math.abs(Math.floor(o.seed)) % 2147483646) + 1
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647)
  const sp = o.spacing ?? 230, n = zone.length / 2
  let cx = 0, cz = 0
  for (let i = 0; i < zone.length; i += 2) { cx += zone[i]; cz += zone[i + 1] }
  cx /= n; cz /= n
  // spine direction: along the contour (perpendicular to the mean downhill gradient), else the longest edge
  let ang = 0
  let best = 0
  for (let i = 0, j = zone.length - 2; i < zone.length; j = i, i += 2) { const l = Math.hypot(zone[i] - zone[j], zone[i + 1] - zone[j + 1]); if (l > best) { best = l; ang = Math.atan2(zone[i + 1] - zone[j + 1], zone[i] - zone[j]) } }
  if (o.ground) {
    let gx = 0, gz = 0
    for (let i = 0; i < zone.length; i += 2) {
      const x = (zone[i] + cx) / 2, z = (zone[i + 1] + cz) / 2
      gx += o.ground(x + 10, z) - o.ground(x - 10, z); gz += o.ground(x, z + 10) - o.ground(x, z - 10)
    }
    if (Math.hypot(gx, gz) / n > 2) ang = Math.atan2(gx, -gz) // 10 % mean slope or more: contour direction
  }
  const ux = Math.cos(ang), uz = Math.sin(ang), vx = -uz, vz = ux
  // local frame (u along the spine, v across), centred on the centroid
  const loc: number[] = []
  for (let i = 0; i < zone.length; i += 2) { const dx = zone[i] - cx, dz = zone[i + 1] - cz; loc.push(dx * ux + dz * uz, dx * vx + dz * vz) }
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity
  for (let i = 0; i < loc.length; i += 2) { u0 = Math.min(u0, loc[i]); u1 = Math.max(u1, loc[i]); v0 = Math.min(v0, loc[i + 1]); v1 = Math.max(v1, loc[i + 1]) }
  const world = (u: number, v: number): [number, number] => [cx + u * ux + v * vx, cz + u * uz + v * vz]
  const tracks: number[][] = []
  const seg = (a: [number, number], b: [number, number]) => tracks.push([a[0], a[1], b[0], b[1]].map((q) => Math.round(q * 100) / 100))
  // spine: the longest inside span of the u axis through the centroid
  const spine = lineSpans(loc, 0, 0, 1, 0).sort((a, b) => (b[1] - b[0]) - (a[1] - a[0]))[0]
  const cuts: number[] = [] // u of the branches
  if (spine) {
    seg(world(spine[0] + 2, 0), world(spine[1] - 2, 0))
    for (let u = Math.ceil((spine[0] + sp * 0.5) / sp) * sp - sp / 2; u < spine[1] - sp * 0.3; u += sp) {
      const sp2 = lineSpans(loc, u, 0, 0, 1).find(([a, b]) => a <= 0 && b >= 0)
      if (!sp2 || sp2[1] - sp2[0] < 80) continue
      seg(world(u, sp2[0] + 2), world(u, sp2[1] - 2)); cuts.push(u)
    }
    // link to the nearest existing road (from either spine end) when close enough
    let bd = o.linkMax ?? 500, link: number[] | null = null
    for (const e of [world(spine[0] + 2, 0), world(spine[1] - 2, 0)]) for (const r of o.roads ?? []) for (let i = 0; i + 3 < r.length; i += 2) {
      const ex = r[i + 2] - r[i], ez = r[i + 3] - r[i + 1], l2 = ex * ex + ez * ez || 1
      const t = Math.max(0, Math.min(1, ((e[0] - r[i]) * ex + (e[1] - r[i + 1]) * ez) / l2)), qx = r[i] + ex * t, qz = r[i + 1] + ez * t
      const d = Math.hypot(qx - e[0], qz - e[1])
      if (d < bd && d > 5) { bd = d; link = [e[0], e[1], qx, qz] }
    }
    if (link) tracks.push(link.map((q) => Math.round(q * 100) / 100))
  }
  // compartments: cells between consecutive branches, each side of the spine, clipped to the zone
  const us = [u0 - 1, ...cuts, u1 + 1], cells: number[][] = []
  for (let k = 0; k + 1 < us.length; k++) for (const side of [-1, 1]) {
    let p = loc.slice()
    const a = us[k] + (k > 0 ? HALF : 0), b = us[k + 1] - (k + 2 < us.length ? HALF : 0)
    p = clipHalf(p, -1, 0, -a); p = clipHalf(p, 1, 0, b)
    if (spine) p = side < 0 ? clipHalf(p, 0, 1, -HALF) : clipHalf(p, 0, -1, -HALF)
    else if (side > 0) continue
    if (p.length < 6 || ringArea(p) < 2000) continue
    const w: number[] = []
    for (let i = 0; i < p.length; i += 2) w.push(...world(p[i], p[i + 1]).map((q) => Math.round(q * 100) / 100))
    cells.push(w)
  }
  // stages: a seeded shuffle split by the shares (at least one mature)
  const mix = o.mix ?? PROD_MIX, order = cells.map((_, i) => i)
  for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [order[i], order[j]] = [order[j], order[i]] }
  const stages: ProdStage[] = []
  const keys: ProdStage[] = ['juvenile', 'clearcut', 'thinned']
  for (const k of keys) for (let c = Math.round(cells.length * mix[k]); c > 0; c--) stages.push(k)
  while (stages.length < cells.length) stages.push('mature')
  stages.length = cells.length
  if (cells.length && !stages.includes('mature')) stages[0] = 'mature'
  const compartments = order.map((ci, k) => ({ pts: cells[ci], stage: stages[k] }))
  // felled-log piles: along the branches and the spine, ~6.5 m off the axis, every 70-160 m
  const logs: ProdLog[] = []
  for (const t of tracks.slice(0, spine ? 1 + cuts.length : 0)) {
    const [x0, z0, x1, z1] = t, L = Math.hypot(x1 - x0, z1 - z0), dx = (x1 - x0) / L, dz = (z1 - z0) / L
    for (let d = 30 + rnd() * 60; d < L - 20; d += 70 + rnd() * 90) {
      const side = rnd() < 0.5 ? -1 : 1, x = x0 + dx * d - dz * 6.5 * side, z = z0 + dz * d + dx * 6.5 * side
      // never on another track or road (seed 21: a pile 6.5 m off a branch fell on the link track, 0.5 m off its axis)
      if (inPoly(zone, x, z) && !nearLine(x, z, [...tracks, ...(o.roads ?? [])], 4.5)) logs.push({ x: Math.round(x * 100) / 100, z: Math.round(z * 100) / 100, yaw: Math.round((Math.atan2(dx, dz) * 180) / Math.PI) })
    }
  }
  return { tracks, compartments, logs, angle: ang }
}

/** true when (x, z) is within r m of one of the polylines (flat X/Z) */
function nearLine(x: number, z: number, lines: ArrayLike<number>[], r: number): boolean {
  for (const l of lines) for (let i = 0; i + 3 < l.length; i += 2) {
    const ax = l[i], az = l[i + 1], dx = l[i + 2] - ax, dz = l[i + 3] - az, L = dx * dx + dz * dz
    const t = L ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L)) : 0
    if (Math.hypot(x - ax - t * dx, z - az - t * dz) < r) return true
  }
  return false
}
