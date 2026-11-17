// Motorway ("autoroute", optional, off by default): one long axis across the map between the biggest places,
// built as a dual carriageway = two parallel road splines (vanilla widest asphalt RG_Road_Asphalt_E_01, 12 m)
// with a median crash barrier (WG_CrashBarrier_01B, road furniture), gentle curves and a 6 % grade limit.
// Simple interchanges: slip roads (single splines) from a carriageway to the road network at 2-3 points
// (a road crossing the motorway there gives a diamond: one pair of ramps on each side). No level crossing:
// every other road crossing it becomes an overpass (bed raised on approach embankments + a bridge deck span),
// or is cut back when it cannot climb in time (road end too close, very skew crossing).
import type { Grid } from './island'
import { centreLine, isPaved, roadHalf, roadProfile, type Road, type RoadType } from './roads'
import { arcLength } from './roadgeom'
import { classOf, ROAD_CLASSES } from './roadgraph-classes'
import { insertPoint, nearestOn, routeLink, SITE_RADIUS, type Site, type SiteKind } from './network'
import { planBridge } from './bridges'
import type { ProjectEntity } from '../project'

export const MOTORWAY = {
  type: 'motorway' as RoadType,
  gap: 9, // carriageway centre to axis (m): 6 m half width + 3 m half median
  taper: 150, // the two carriageways merge over this length at each end (m)
  rampType: 'asphaltNarrow' as RoadType,
  rampM: 110, // slip road start / end along the carriageway, from the interchange (m)
  sideM: 230, // where a slip road meets the crossing road, from the motorway (m)
  clear: 7, // overpass: bed raised by this much over the motorway (m)
  minRadius: 250, // design minimum horizontal radius (m), approached by DP + Chaikin smoothing
}
const ORDER: Record<SiteKind, number> = { town: 0, village: 1, hamlet: 2 }
const r2 = (v: number) => Math.round(v * 100) / 100

function dp(pts: number[], tol: number): number[] {
  const n = pts.length / 2
  if (n < 3) return pts.slice()
  const keep = new Uint8Array(n); keep[0] = keep[n - 1] = 1
  const stack: [number, number][] = [[0, n - 1]]
  while (stack.length) {
    const [a, b] = stack.pop()!
    const ax = pts[a * 2], az = pts[a * 2 + 1], bx = pts[b * 2], bz = pts[b * 2 + 1], L = Math.hypot(bx - ax, bz - az) || 1
    let best = -1, bd = tol
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((bx - ax) * (az - pts[i * 2 + 1]) - (ax - pts[i * 2]) * (bz - az)) / L
      if (d > bd) { bd = d; best = i }
    }
    if (best > 0) { keep[best] = 1; stack.push([a, best], [best, b]) }
  }
  const out: number[] = []
  for (let i = 0; i < n; i++) if (keep[i]) out.push(pts[i * 2], pts[i * 2 + 1])
  return out
}
function chaikin(pts: number[], it: number): number[] {
  let p = pts
  for (let k = 0; k < it; k++) {
    const n = p.length / 2, out = [p[0], p[1]]
    for (let i = 0; i + 1 < n; i++) {
      const ax = p[i * 2], az = p[i * 2 + 1], bx = p[i * 2 + 2], bz = p[i * 2 + 3]
      out.push(0.75 * ax + 0.25 * bx, 0.75 * az + 0.25 * bz, 0.25 * ax + 0.75 * bx, 0.25 * az + 0.75 * bz)
    }
    out.push(p[p.length - 2], p[p.length - 1])
    p = out
  }
  return p
}
//! smallest radius of the circle through three consecutive points, sampled every `step` points
export function minRadius(line: number[], step = 3): number {
  let best = Infinity
  const n = line.length / 2
  for (let i = step; i + step < n; i++) {
    const [ax, az, bx, bz, cx, cz] = [line[(i - step) * 2], line[(i - step) * 2 + 1], line[i * 2], line[i * 2 + 1], line[(i + step) * 2], line[(i + step) * 2 + 1]]
    const a = Math.hypot(bx - cx, bz - cz), b = Math.hypot(ax - cx, az - cz), c = Math.hypot(ax - bx, az - bz)
    const area2 = Math.abs((bx - ax) * (cz - az) - (bz - az) * (cx - ax))
    if (area2 > 1e-6) best = Math.min(best, (a * b * c) / (2 * area2))
  }
  return best
}

//! Where the relaxation could not open a bend (the sea or a town holds it), the motorway stops before it: the
//! axis is cut back from the nearer end to 4 points (~80 m) short of any bend tighter than `R`; the end link
//! (an ordinary road) then joins the network from there. A tight bend in the middle is left (rare).
export function trimTightEnds(axis: number[], R: number, step = 3): number[] {
  const tightAt = (a: number[], i: number) => minRadius(a.slice((i - step) * 2, (i + step + 1) * 2), step) < R
  let a = axis
  for (let guard = 0; guard < 20; guard++) {
    const n = a.length / 2
    let head = -1, tail = -1
    for (let i = step; i + step < n && i < n * 0.35; i++) if (tightAt(a, i)) head = i // last tight point near the start
    for (let i = n - step - 1; i >= n * 0.65 && i >= step; i--) if (tightAt(a, i)) tail = i // first tight point near the end
    if (head < 0 && tail < 0) return a
    const cut = head >= 0 && (tail < 0 || head < n - 1 - tail) ? a.slice((head + 4) * 2) : a.slice(0, Math.max(0, tail - 4) * 2)
    if (cut.length < 8) return a
    a = cut
  }
  return a
}

//! segment intersection: parameters (t on ab, u on cd) or null
function hit(ax: number, az: number, bx: number, bz: number, cx: number, cz: number, dx: number, dz: number): [number, number] | null {
  const rx = bx - ax, rz = bz - az, sx = dx - cx, sz = dz - cz, den = rx * sz - rz * sx
  if (Math.abs(den) < 1e-9) return null
  const t = ((cx - ax) * sz - (cz - az) * sx) / den, u = ((cx - ax) * rz - (cz - az) * rx) / den
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? [t, u] : null
}
//! crossings of polyline p with polyline q: arc length along p, along q, and the crossing angle (rad, 0..pi/2)
export function crossings(p: number[], q: number[]): { sp: number; sq: number; x: number; z: number; angle: number }[] {
  const out: { sp: number; sq: number; x: number; z: number; angle: number }[] = []
  const lp = arcLength(p), lq = arcLength(q)
  for (let i = 0; i + 3 < p.length; i += 2) for (let j = 0; j + 3 < q.length; j += 2) {
    const h = hit(p[i], p[i + 1], p[i + 2], p[i + 3], q[j], q[j + 1], q[j + 2], q[j + 3])
    if (!h) continue
    const [t, u] = h
    const a1 = Math.atan2(p[i + 3] - p[i + 1], p[i + 2] - p[i]), a2 = Math.atan2(q[j + 3] - q[j + 1], q[j + 2] - q[j])
    let ang = Math.abs(Math.atan2(Math.sin(a1 - a2), Math.cos(a1 - a2)))
    if (ang > Math.PI / 2) ang = Math.PI - ang
    const sp = lp[i / 2] + t * (lp[i / 2 + 1] - lp[i / 2]), sq = lq[j / 2] + u * (lq[j / 2 + 1] - lq[j / 2])
    if (!out.some((o) => Math.abs(o.sp - sp) < 1)) out.push({ sp, sq, x: p[i] + t * (p[i + 2] - p[i]), z: p[i + 1] + t * (p[i + 3] - p[i + 1]), angle: ang })
  }
  return out.sort((a, b) => a.sp - b.sp)
}
//! point at arc length s along a polyline
function pointAt(line: number[], s: number): [number, number, number] {
  const l = arcLength(line)
  for (let i = 1; i < l.length; i++) if (l[i] >= s) {
    const t = (s - l[i - 1]) / (l[i] - l[i - 1] || 1)
    const x = line[i * 2 - 2] + t * (line[i * 2] - line[i * 2 - 2]), z = line[i * 2 - 1] + t * (line[i * 2 + 1] - line[i * 2 - 1])
    return [x, z, Math.atan2(line[i * 2 + 1] - line[i * 2 - 1], line[i * 2] - line[i * 2 - 2])]
  }
  const n = line.length
  return [line[n - 2], line[n - 1], Math.atan2(line[n - 1] - line[n - 3], line[n - 2] - line[n - 4])]
}

export interface MotorwayResult {
  axis: number[]
  made: Road[] // carriageways MW_A / MW_B, slip roads MW_RAMP_*, end links MW_LINK_*
  interchanges: { x: number; z: number }[]
  overpasses: number // roads lifted over it
  cut: number // roads cut back at it
}

//! the two biggest places farthest apart (towns first), each end moved out of its place toward the other
export function motorwayEnds(sites: Site[]): [[number, number], [number, number]] | null {
  const big = [...sites].sort((a, b) => ORDER[a.kind] - ORDER[b.kind])
  for (const lim of [0, 1]) {
    const pool = big.filter((s) => ORDER[s.kind] <= lim)
    let best: [Site, Site] | null = null, bd = 1500
    for (let i = 0; i < pool.length; i++) for (let j = i + 1; j < pool.length; j++) {
      const d = Math.hypot(pool[i].x - pool[j].x, pool[i].z - pool[j].z)
      if (d > bd) { bd = d; best = [pool[i], pool[j]] }
    }
    if (best) {
      const [a, b] = best, ux = (b.x - a.x) / bd, uz = (b.z - a.z) / bd
      const ra = SITE_RADIUS[a.kind] + 160, rb = SITE_RADIUS[b.kind] + 160
      return [[a.x + ux * ra, a.z + uz * ra], [b.x - ux * rb, b.z - uz * rb]]
    }
  }
  return null
}

//! Builds the motorway on the heights `h` and fits it into `roads` (modified in place: control points of the
//! interchange roads, overpass lifts / spans, cut roads). Returns null when no route keeps under the grade.
export function buildMotorway(h: number[], g: Grid, river: Float32Array | undefined, sites: Site[], roads: Road[], o: { maxSlope?: number } = {}): MotorwayResult | null {
  const ends = motorwayEnds(sites)
  if (!ends) return null
  // towns and villages are no-go like the sea (heights copy marked below 0): the route and the smoothing go round them
  const hm = h.slice()
  for (const s of sites) {
    if (s.kind === 'hamlet') continue
    const R = SITE_RADIUS[s.kind] * 1.15, c0 = Math.round((s.x - g.minX) / g.step), r0 = Math.round((s.z - g.minZ) / g.step), k = Math.ceil(R / g.step)
    for (let r = Math.max(0, r0 - k); r <= Math.min(g.rows - 1, r0 + k); r++) for (let c = Math.max(0, c0 - k); c <= Math.min(g.cols - 1, c0 + k); c++)
      if (Math.hypot(c - c0, r - r0) * g.step < R) hm[r * g.cols + c] = -5
  }
  const at = (x: number, z: number) => hm[Math.min(g.rows - 1, Math.max(0, Math.round((z - g.minZ) / g.step))) * g.cols + Math.min(g.cols - 1, Math.max(0, Math.round((x - g.minX) / g.step)))]
  const raw = routeLink(hm, g, river, ends[0], ends[1], MOTORWAY.type, o.maxSlope ?? 10) ?? routeLink(hm, g, river, ends[0], ends[1], 'asphaltLine', o.maxSlope ?? 10)
  if (!raw) return null
  // gentle curves: coarse polyline (DP 60 m) rounded by Chaikin at a 20 m spacing, then relaxed (Laplacian,
  // ends fixed) until the smallest radius reaches minRadius; a relaxation that would cut over the sea stops
  const wetLine = (l: number[]) => { for (let i = 0; i < l.length; i += 2) if (at(l[i], l[i + 1]) <= 0.5) return true; return false }
  let axis = centreLine(chaikin(dp(raw, 60), 4), 20)
  if (wetLine(axis)) axis = centreLine(chaikin(dp(raw, 30), 2), 20)
  for (let pass = 0; pass < 30 && minRadius(axis) < MOTORWAY.minRadius; pass++) {
    let t = axis.slice()
    for (let it = 0; it < 40; it++) {
      const nx = t.slice()
      // a point the step would move over the sea (or 30 m from it) stays put: the curve relaxes around it
      for (let i = 2; i + 3 < t.length; i += 2) {
        const x = 0.5 * t[i] + 0.25 * (t[i - 2] + t[i + 2]), z = 0.5 * t[i + 1] + 0.25 * (t[i - 1] + t[i + 3])
        if (at(x, z) > 0.5 && at(x + 30, z) > 0.5 && at(x - 30, z) > 0.5 && at(x, z + 30) > 0.5 && at(x, z - 30) > 0.5) { nx[i] = x; nx[i + 1] = z }
      }
      t = nx
    }
    t = centreLine(t, 20)
    if (wetLine(t)) break
    axis = t
  }
  axis = trimTightEnds(axis, MOTORWAY.minRadius * 0.9).map(r2)
  const sA = arcLength(axis), L = sA[sA.length - 1]
  if (L < 1000) return null
  // carriageways: offset ±gap, tapered to 0 at both ends (shared end points)
  const n = axis.length / 2
  const side = (sgn: number) => {
    const out: number[] = []
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1)
      let tx = axis[b * 2] - axis[a * 2], tz = axis[b * 2 + 1] - axis[a * 2 + 1]
      const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l
      const f = Math.min(1, sA[i] / MOTORWAY.taper, (L - sA[i]) / MOTORWAY.taper)
      const d = sgn * MOTORWAY.gap * Math.sin((f * Math.PI) / 2)
      out.push(r2(axis[i * 2] - tz * d), r2(axis[i * 2 + 1] + tx * d))
    }
    return out
  }
  const A: Road = { id: 'MW_A', type: MOTORWAY.type, pts: side(1), flatten: true, auto: true }
  const B: Road = { id: 'MW_B', type: MOTORWAY.type, pts: side(-1), flatten: true, auto: true }
  const i0 = sA.findIndex((s) => s >= MOTORWAY.taper), i1 = sA.findIndex((s) => s > L - MOTORWAY.taper)
  if (i0 > 0 && i1 > i0 + 1) A.median = axis.slice(i0 * 2, i1 * 2)
  const made: Road[] = [A, B]
  const others = roads.filter((r) => !r.id.startsWith('MW_') && r.pts.length >= 4)

  // --- interchanges: roads crossing the axis (diamond), else paved roads passing near it (half) ---
  const cands: { s: number; road: Road; cross?: { sq: number } }[] = []
  for (const r of others) {
    if (!isPaved(r.type) || classOf(r.type) === 'street') continue
    const rl = centreLine(r.pts, 5), Lr = arcLength(rl)[rl.length / 2 - 1]
    for (const c of crossings(axis, rl)) if (c.sp > 350 && c.sp < L - 350 && c.angle > 0.6 && Math.max(c.sq, Lr - c.sq) > 150) cands.push({ s: c.sp, road: r, cross: { sq: c.sq } })
  }
  for (const r of others) {
    if (!isPaved(r.type) || classOf(r.type) === 'street') continue
    for (let i = 0; i < n; i += 10) {
      if (sA[i] < 350 || sA[i] > L - 350) continue
      const [qx, qz] = nearestOn(r.pts, axis[i * 2], axis[i * 2 + 1]), d = Math.hypot(qx - axis[i * 2], qz - axis[i * 2 + 1])
      if (d > 90 && d < 500) cands.push({ s: sA[i], road: r })
    }
  }
  const rank = (c: (typeof cands)[number]) => (c.cross ? 0 : 10) + (ROAD_CLASSES[classOf(c.road.type)].rank > 3 ? 0 : 5)
  cands.sort((a, b) => rank(a) - rank(b))
  const picked: typeof cands = []
  const want = L > 6000 ? 3 : 2
  // a carriageway vertex near arc length s (exact shared point for the slip road)
  const vertexNear = (road: Road, s: number): [number, number] => { const i = Math.max(1, Math.min(n - 2, sA.findIndex((v) => v >= s))); return [road.pts[i * 2], road.pts[i * 2 + 1]] }
  const interchanges: { x: number; z: number }[] = []
  // roundabouts (RB_* rings): slip roads keep 30 m clear of them
  const rings = roads.filter((r) => r.id.startsWith('RB_') && r.pts.length >= 8).map((r) => {
    const k = r.pts.length / 2 - 1; let x = 0, z = 0
    for (let i = 0; i < k; i++) { x += r.pts[i * 2]; z += r.pts[i * 2 + 1] }
    x /= k; z /= k
    return { x, z, r: Math.hypot(r.pts[0] - x, r.pts[1] - z) }
  })
  const ringNear = (x: number, z: number) => rings.some((g) => Math.hypot(g.x - x, g.z - z) < g.r + 30)
  // a half interchange whose only target sits in a roundabout would give no slip road: skip it, take the next
  const blocked = (c: (typeof cands)[number]) => { if (c.cross) return false; const [x, z] = pointAt(axis, c.s), q = nearestOn(c.road.pts, x, z); return ringNear(q[0], q[1]) }
  for (const c of cands) if (picked.length < want && !blocked(c) && picked.every((p) => Math.abs(p.s - c.s) > Math.min(1200, L / (want + 1.5)))) picked.push(c)
  let ramp = 0
  // slip road: quadratic Bezier leaving the carriageway along its heading, ending on the road point q
  const slip = (from: [number, number], heading: number, q: [number, number], reverse: boolean): Road => {
    const len = Math.hypot(q[0] - from[0], q[1] - from[1]), k = Math.min(120, len * 0.55)
    const c: [number, number] = [from[0] + Math.cos(heading) * k, from[1] + Math.sin(heading) * k]
    const pts: number[] = []
    for (let i = 0; i <= 8; i++) {
      const t = i / 8, u = 1 - t
      pts.push(i === 0 ? from[0] : i === 8 ? q[0] : r2(u * u * from[0] + 2 * u * t * c[0] + t * t * q[0]), i === 0 ? from[1] : i === 8 ? q[1] : r2(u * u * from[1] + 2 * u * t * c[1] + t * t * q[1]))
    }
    if (reverse) { const rv: number[] = []; for (let i = pts.length - 2; i >= 0; i -= 2) rv.push(pts[i], pts[i + 1]); return { id: `MW_RAMP_${++ramp}`, type: MOTORWAY.rampType, pts: rv, flatten: true, auto: true } }
    return { id: `MW_RAMP_${++ramp}`, type: MOTORWAY.rampType, pts, flatten: true, auto: true }
  }
  for (const c of picked) {
    const [cx, cz, head] = pointAt(axis, c.s)
    interchanges.push({ x: r2(cx), z: r2(cz) })
    const rl = centreLine(c.road.pts, 5), sl = arcLength(rl), Lr = sl[sl.length - 1]
    // the road points served on each side: along the crossing road ±sideM from the crossing, or its nearest point
    const targets: { q: [number, number]; sgn: number }[] = []
    if (c.cross) {
      for (const sg of [-1, 1]) {
        // as far as sideM along the road (the overpass approach), never closer than 120 m nor past its end
        const room = sg < 0 ? c.cross.sq - 30 : Lr - 30 - c.cross.sq
        if (room < 120) continue
        const s = c.cross.sq + sg * Math.min(MOTORWAY.sideM, room)
        const [x, z] = pointAt(rl, s)
        const sgn = Math.sign((x - cx) * -Math.sin(head) + (z - cz) * Math.cos(head)) // + = left = carriageway A
        targets.push({ q: [r2(x), r2(z)], sgn })
      }
    } else {
      const [x, z] = nearestOn(c.road.pts, cx, cz)
      targets.push({ q: [r2(x), r2(z)], sgn: Math.sign((x - cx) * -Math.sin(head) + (z - cz) * Math.cos(head)) })
    }
    for (const t of targets) {
      if (ringNear(t.q[0], t.q[1])) continue // never through a roundabout
      insertPoint(c.road, t.q[0], t.q[1])
      const cw = t.sgn > 0 ? A : B
      // off-ramp leaves before the interchange, on-ramp joins after it (both directions of travel served)
      const off = vertexNear(cw, c.s - MOTORWAY.rampM), on = vertexNear(cw, c.s + MOTORWAY.rampM)
      made.push(slip(off, head, t.q, false), slip(on, head + Math.PI, t.q, true))
    }
  }
  // --- both ends joined to the nearest paved road of the network ---
  let link = 0
  for (const e of [0, axis.length - 2]) {
    const ex = axis[e], ez = axis[e + 1]
    let best: Road | null = null, bd = 1500, bq: [number, number] = [0, 0]
    for (const r of others) {
      if (!isPaved(r.type)) continue
      const q = nearestOn(r.pts, ex, ez), d = Math.hypot(q[0] - ex, q[1] - ez)
      if (d < bd) { bd = d; best = r; bq = [r2(q[0]), r2(q[1])] }
    }
    if (!best) continue
    const pts = bd < 40 ? [ex, ez, bq[0], bq[1]] : routeLink(h, g, river, [ex, ez], bq, 'asphalt', o.maxSlope ?? 10)
    if (!pts) continue
    insertPoint(best, bq[0], bq[1])
    made.push({ id: `MW_LINK_${++link}`, type: 'asphalt', pts: pts.map(r2), flatten: true, auto: true })
  }

  // --- no level crossing: every other road crossing a carriageway flies over it, or is cut back ---
  const { overpasses, cut } = resolveCrossings(roads, made)
  return { axis, made, interchanges, overpasses, cut }
}

//! Roads (not MW_*) crossing the motorway corridor: lifted over it (overpass: Road.lift + Road.spans) when the
//! approaches fit, else cut back (the longest piece clear of it is kept). Roads already lifted there are skipped.
export function resolveCrossings(roads: Road[], mw: Road[], o: { cutOnly?: boolean } = {}): { overpasses: number; cut: number } {
  const cw = mw.filter((r) => r.type === MOTORWAY.type)
  let overpasses = 0, cut = 0
  for (let k = roads.length - 1; k >= 0; k--) {
    const r = roads[k]
    if (r.id.startsWith('MW_') || r.pts.length < 4 || r.bridge) continue
    const line = centreLine(r.pts, 5), sl = arcLength(line), Lr = sl[sl.length - 1]
    // crossings with either carriageway, grouped per motorway crossing (A and B lie within ~40 m)
    const hits = cw.flatMap((c) => crossings(line, c.pts)).sort((a, b) => a.sp - b.sp)
      .filter((c) => !(r.spans ?? []).some((sp) => c.sp > sp.from && c.sp < sp.to))
    if (!hits.length) continue
    const groups: (typeof hits)[] = []
    for (const c of hits) { const gg = groups[groups.length - 1]; if (gg && c.sp - gg[gg.length - 1].sp < 60) gg.push(c); else groups.push([c]) }
    const spec = ROAD_CLASSES[classOf(r.type)]
    const len = MOTORWAY.clear / (spec.design * 0.85)
    const plan = groups.map((gg) => {
      const s0 = gg[0].sp, s1 = gg[gg.length - 1].sp, ang = Math.max(0.35, Math.min(...gg.map((c) => c.angle)))
      const w = (MOTORWAY.gap + 6 + 4) / Math.sin(ang) // corridor half length along this road
      const at = (s0 + s1) / 2, flat = (s1 - s0) / 2 + (gg.length > 1 ? 6 / Math.sin(ang) + 4 : w)
      return { at, flat, ok: Math.min(...gg.map((c) => c.angle)) > 0.35 && at - flat - len > 0 && at + flat + len < Lr }
    })
    if (!o.cutOnly && plan.every((p) => p.ok)) {
      r.lift = [...(r.lift ?? []), ...plan.map((p) => ({ at: Math.round(p.at * 10) / 10, h: MOTORWAY.clear, flat: Math.round(p.flat * 10) / 10, len: Math.round(len) }))]
      r.spans = [...(r.spans ?? []), ...plan.map((p) => ({ from: Math.round((p.at - p.flat) * 10) / 10, to: Math.round((p.at + p.flat) * 10) / 10 }))].sort((a, b) => a.from - b.from)
      overpasses += plan.length
      continue
    }
    // cut back: pieces of the control polyline clear of the corridor (30 m margin), keep the longest
    const pieces: number[][] = []
    let cur: number[] = []
    const dense = centreLine(r.pts, 5)
    const near = (x: number, z: number) => cw.some((c) => { const q = nearestOn(c.pts, x, z); return Math.hypot(q[0] - x, q[1] - z) < roadHalf(c) + 30 })
    for (let i = 0; i < dense.length; i += 2) {
      if (near(dense[i], dense[i + 1])) { if (cur.length >= 4) pieces.push(cur); cur = [] } else cur.push(r2(dense[i]), r2(dense[i + 1]))
    }
    if (cur.length >= 4) pieces.push(cur)
    const best = pieces.sort((a, b) => arcLength(b)[b.length / 2 - 1] - arcLength(a)[a.length / 2 - 1])[0]
    cut++
    if (!best || arcLength(best)[best.length / 2 - 1] < 40) { roads.splice(k, 1); continue }
    // thin the dense piece back to control points every ~20 m (ends kept)
    const thin: number[] = []
    for (let i = 0; i < best.length; i += 8) thin.push(best[i], best[i + 1])
    if (thin[thin.length - 2] !== best[best.length - 2] || thin[thin.length - 1] !== best[best.length - 1]) thin.push(best[best.length - 2], best[best.length - 1])
    r.pts = thin; r.spans = undefined; r.lift = undefined
  }
  return { overpasses, cut }
}

//! bridge decks of the overpasses (Road.lift spans), at the raised bed height
export function overpassDecks(roads: Road[], heightAt: (x: number, z: number) => number): ProjectEntity[] {
  const out: ProjectEntity[] = []
  for (const r of roads) {
    if (!r.lift?.length) continue
    const line = centreLine(r.pts, 5), y = roadProfile(r, line, heightAt, 5)
    r.lift.forEach((l, k) => {
      const a = pointAt(line, l.at - l.flat), b = pointAt(line, l.at + l.flat)
      const i = Math.min(y.length - 1, Math.round(l.at / 5))
      out.push(...planBridge(`${r.id}_OVER${k}`, [a[0], a[1]], [b[0], b[1]], y[i], roadHalf(r), heightAt, { dirt: !isPaved(r.type) }).entities)
    })
  }
  return out
}
