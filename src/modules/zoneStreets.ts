// Zone tool "Habitation": an internal street grid that serves the whole drawn polygon. Parallel
// streets every `spacing` m (two rows of lots back to back between them), laid along the main road
// that crosses the zone, plus cross streets every `cross` m that tie them into loops. Each line is
// clipped to the free part of the zone (`ok`: inside the polygon with an inset, dry, not blocked);
// cross streets are trimmed to the span between the outermost parallel streets they meet, so no
// street ends in a dead stub past the last row. Pure, deterministic.

export interface ZoneGridOptions {
  spacing: number // m between parallel streets
  cross: number // m between cross streets
  minLen: number // shorter runs are dropped
  step?: number // sampling step along a line (4 m)
  skipAxis?: boolean // the axis line itself is the main road: no street on it
}

/** street spacing for a lot depth target: two lots back to back + the street; denser = tighter */
export function zoneGridSpacing(depth: [number, number], density: number): ZoneGridOptions {
  const d = Math.max(0.3, Math.min(2, density || 1))
  const spacing = Math.max(2 * depth[0] + 10, 2 * (depth[0] + depth[1]) / 2 + 10 + (1 - d) * 40)
  return { spacing, cross: spacing * (d >= 1.3 ? 1.8 : 2.3), minLen: 40 }
}

/** polylines (flat X/Z) of the grid; (ox, oz) a point of the axis, (ux, uz) its unit direction */
export function zoneStreetGrid(poly: number[], ox: number, oz: number, ux: number, uz: number, ok: (x: number, z: number) => boolean, o: ZoneGridOptions): number[][] {
  const step = o.step ?? 4
  const vx = -uz, vz = ux
  let s0 = Infinity, s1 = -Infinity, t0 = Infinity, t1 = -Infinity
  for (let i = 0; i < poly.length; i += 2) {
    const dx = poly[i] - ox, dz = poly[i + 1] - oz
    const s = dx * ux + dz * uz, t = dx * vx + dz * vz
    s0 = Math.min(s0, s); s1 = Math.max(s1, s); t0 = Math.min(t0, t); t1 = Math.max(t1, t)
  }
  const at = (s: number, t: number): [number, number] => [ox + ux * s + vx * t, oz + uz * s + vz * t]
  // runs of free samples along one line (a = along coordinate range, p(a) the point)
  const runs = (a0: number, a1: number, p: (a: number) => [number, number]): [number, number][] => {
    const out: [number, number][] = []
    let start: number | null = null, last = a0
    for (let a = a0; a <= a1 + 1e-6; a += step) {
      const [x, z] = p(a)
      if (ok(x, z)) { if (start === null) start = a; last = a }
      else if (start !== null) { if (last - start >= o.minLen) out.push([start, last]); start = null }
    }
    if (start !== null && last - start >= o.minLen) out.push([start, last])
    return out
  }
  const line = (a: number, b: number, p: (a: number) => [number, number]) => {
    const n = Math.max(1, Math.ceil((b - a) / 20)), pts: number[] = []
    for (let i = 0; i <= n; i++) pts.push(...p(a + ((b - a) * i) / n))
    return pts
  }
  const out: number[][] = []
  const rows: number[] = [] // t of every parallel line (the axis counts: it is the main road)
  for (let k = Math.ceil(t0 / o.spacing); k * o.spacing <= t1; k++) {
    const t = k * o.spacing
    if (k === 0 && o.skipAxis) { rows.push(0); continue }
    const p = (s: number) => at(s, t)
    const rs = runs(s0, s1, p)
    if (rs.length) rows.push(t)
    for (const [a, b] of rs) out.push(line(a, b, p))
  }
  if (rows.length) {
    const r0 = Math.min(...rows), r1 = Math.max(...rows)
    const off = o.cross / 2 // stagger: the cross streets are not on the axis origin
    for (let k = Math.ceil((s0 - off) / o.cross); k * o.cross + off <= s1; k++) {
      const s = k * o.cross + off
      const p = (t: number) => at(s, t)
      for (const [a, b] of runs(Math.max(t0, r0), Math.min(t1, r1), p)) out.push(line(a, b, p))
    }
  }
  return out
}
