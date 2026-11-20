// Village street geometry for the bench: which vanilla roads are local village streets, and the shape
// statistics of a street set (piece length between junctions, dead-end share, junction angle, total
// length per site). The same formulas run on the vanilla streets and on the streets we grow.

export interface StreetSite { x: number; z: number; kind: string }
export const STREET_REACH: Record<string, number> = { village: 170, hamlet: 80 }

export function polyLen(p: number[]): number { let L = 0; for (let i = 2; i < p.length; i += 2) L += Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]); return L }

/** resample a polyline every `step` m (keeps both ends) */
export function resample(p: number[], step: number): number[] {
  const o = [p[0], p[1]]
  let carry = 0
  for (let i = 2; i < p.length; i += 2) {
    const ax = p[i - 2], az = p[i - 1], dx = p[i] - ax, dz = p[i + 1] - az, L = Math.hypot(dx, dz)
    let t = step - carry
    while (t <= L) { o.push(ax + (dx * t) / L, az + (dz * t) / L); t += step }
    carry = L - (t - step)
  }
  if (Math.hypot(o[o.length - 2] - p[p.length - 2], o[o.length - 1] - p[p.length - 1]) > 0.5) o.push(p[p.length - 2], p[p.length - 1])
  return o
}

/** a road is a local street of a site when it is short (<= 400 m) and >= 60 % of its length lies in the site reach */
export function localStreets(roads: number[][], sites: StreetSite[]): { idx: number; site: number }[] {
  const out: { idx: number; site: number }[] = []
  roads.forEach((p, idx) => {
    if (p.length < 4) return
    const L = polyLen(p)
    if (L > 400 || L < 8) return
    const r = resample(p, 5), n = r.length / 2
    let best = -1, bestIn = 0
    sites.forEach((s, k) => {
      const R = STREET_REACH[s.kind]
      if (!R) return
      let c = 0
      for (let i = 0; i < r.length; i += 2) if (Math.hypot(r[i] - s.x, r[i + 1] - s.z) < R) c++
      if (c > bestIn) { bestIn = c; best = k }
    })
    if (best >= 0 && bestIn / n >= 0.6) out.push({ idx, site: best })
  })
  return out
}

function nearest(p: number[], x: number, z: number): { d: number; dir: [number, number]; t: number } {
  let d = Infinity, dir: [number, number] = [1, 0], t = 0, acc = 0
  for (let i = 2; i < p.length; i += 2) {
    const ax = p[i - 2], az = p[i - 1], dx = p[i] - ax, dz = p[i + 1] - az, L2 = dx * dx + dz * dz, L = Math.sqrt(L2)
    const u = L2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2)) : 0
    const q = Math.hypot(x - ax - u * dx, z - az - u * dz)
    if (q < d && L > 0) { d = q; dir = [dx / L, dz / L]; t = acc + u * L }
    acc += L
  }
  return { d, dir, t }
}

const JOIN = 7 // metres: an end this close to another road is a junction

export interface StreetStats { pieces: number[]; ends: number; deadEnds: number; angles: number[]; total: number }

/** join street polylines that continue each other (ends within 3 m, headings within 30°): vanilla splits one
 *  street into several road entities */
export function mergeChains(input: number[][]): number[][] {
  const s = input.filter((p) => p.length >= 4).map((p) => p.slice())
  const head = (p: number[], end: boolean): [number, number, number, number] => {
    const e = end ? p.length - 2 : 0, k = end ? p.length - 4 : 2
    const dx = p[e] - p[k], dz = p[e + 1] - p[k + 1], L = Math.hypot(dx, dz) || 1
    return [p[e], p[e + 1], dx / L, dz / L] // outward heading
  }
  const rev = (q: number[]) => { const r: number[] = []; for (let k = q.length - 2; k >= 0; k -= 2) r.push(q[k], q[k + 1]); return r }
  let changed = true
  while (changed) {
    changed = false
    outer: for (let i = 0; i < s.length; i++) for (let j = 0; j < s.length; j++) {
      if (i === j) continue
      for (const iEnd of [true, false]) for (const jEnd of [false, true]) {
        if (!iEnd) s[i] = rev(s[i])
        const a = head(s[i], true)
        const b = head(s[j], jEnd)
        if (Math.hypot(a[0] - b[0], a[1] - b[1]) > 3 || -(a[2] * b[2] + a[3] * b[3]) < Math.cos(Math.PI / 6)) { if (!iEnd) s[i] = rev(s[i]); continue }
        const q = jEnd ? rev(s[j]) : s[j]
        s[i] = [...s[i], ...q.slice(2)]
        s.splice(j, 1)
        changed = true
        break outer
      }
    }
  }
  return s
}

/** statistics of `streets` (polylines) given the other roads they may join */
export function streetStats(streetsIn: number[][], others: number[][]): StreetStats {
  const streets = mergeChains(streetsIn)
  const st: StreetStats = { pieces: [], ends: 0, deadEnds: 0, angles: [], total: 0 }
  const all = [...streets, ...others]
  const box = all.map((p) => { let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity; for (let i = 0; i < p.length; i += 2) { a = Math.min(a, p[i]); b = Math.min(b, p[i + 1]); c = Math.max(c, p[i]); d = Math.max(d, p[i + 1]) } return [a, b, c, d] })
  const near = (x: number, z: number, self: number) => {
    let best: { d: number; dir: [number, number]; t: number; k: number } | null = null
    for (let k = 0; k < all.length; k++) {
      if (k === self) continue
      const [a, b, c, d] = box[k]
      if (x < a - JOIN || x > c + JOIN || z < b - JOIN || z > d + JOIN) continue
      const n = nearest(all[k], x, z)
      if (n.d < JOIN && (!best || n.d < best.d)) best = { ...n, k }
    }
    return best
  }
  streets.forEach((p, si) => {
    const L = polyLen(p)
    st.total += L
    // split points: positions along this street where another street ends on it
    const cuts: number[] = [0, L]
    streets.forEach((q, qi) => {
      if (qi === si || q.length < 4) return
      for (const e of [0, q.length - 2]) { const n = nearest(p, q[e], q[e + 1]); if (n.d < JOIN && n.t > JOIN && n.t < L - JOIN) cuts.push(n.t) }
    })
    cuts.sort((a, b) => a - b)
    for (let i = 1; i < cuts.length; i++) if (cuts[i] - cuts[i - 1] > 1) st.pieces.push(cuts[i] - cuts[i - 1])
    for (const end of [0, 1]) {
      const e = end ? p.length - 2 : 0
      const x = p[e], z = p[e + 1]
      // end tangent over ~12 m
      let k = e, acc = 0
      while (acc < 12) { const nk = end ? k - 2 : k + 2; if (nk < 0 || nk > p.length - 2) break; acc += Math.hypot(p[nk] - p[k], p[nk + 1] - p[k + 1]); k = nk }
      const tx = p[k] - x, tz = p[k + 1] - z, tl = Math.hypot(tx, tz)
      st.ends++
      const n = near(x, z, si)
      if (!n) { st.deadEnds++; continue }
      if (tl > 1) { const c = Math.abs((tx * n.dir[0] + tz * n.dir[1]) / tl); st.angles.push((Math.acos(Math.min(1, c)) * 180) / Math.PI) }
    }
  })
  return st
}
