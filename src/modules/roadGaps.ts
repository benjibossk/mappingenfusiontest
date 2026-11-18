// Roadside linear features (crash barriers, verge posts, village walls...) laid along one road must not run
// across the mouth of another road that joins or crosses it: cut them where they come within
// (crossing road half width + margin) of another road's centre line. Pieces shorter than minLen are dropped,
// split pieces get ids `${id}_${n}`.
import type { ProjectShape } from '../project.ts'

//! one road for cutting: sampled centre line (e.g. centreLine(pts, 5)) and half width
export interface GapRoad { id: string; line: number[]; half: number }

type Seg = { ax: number; az: number; bx: number; bz: number; r: number; road: string }

function segDist(px: number, pz: number, s: Seg): number {
  const dx = s.bx - s.ax, dz = s.bz - s.az, l2 = dx * dx + dz * dz
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - s.ax) * dx + (pz - s.az) * dz) / l2)) : 0
  return Math.hypot(px - (s.ax + t * dx), pz - (s.az + t * dz))
}

//! a shape whose id starts with `${road.id}_` belongs to that road and is never cut by it
export function cutAtRoads(shapes: ProjectShape[], roads: GapRoad[], margin = 2, minLen = 2, step = 1): ProjectShape[] {
  const segs: Seg[] = []
  for (const road of roads) {
    const line = road.line, r = road.half + margin
    for (let i = 2; i < line.length; i += 2) segs.push({ ax: line[i - 2], az: line[i - 1], bx: line[i], bz: line[i + 1], r, road: road.id })
  }
  const ownerOf = (id: string) => roads.reduce<string | undefined>((best, r) => (id.startsWith(`${r.id}_`) && (!best || r.id.length > best.length) ? r.id : best), undefined)
  const out: ProjectShape[] = []
  for (const s of shapes) {
    if (s.kind !== 'polyline' || s.closed || !s.points || s.points.length < 4) { out.push(s); continue }
    const owner = ownerOf(s.id)
    const p = s.points
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity
    for (let i = 0; i < p.length; i += 2) { minX = Math.min(minX, p[i]); maxX = Math.max(maxX, p[i]); minZ = Math.min(minZ, p[i + 1]); maxZ = Math.max(maxZ, p[i + 1]) }
    const near = segs.filter((g) => g.road !== owner && Math.max(g.ax, g.bx) + g.r > minX && Math.min(g.ax, g.bx) - g.r < maxX && Math.max(g.az, g.bz) + g.r > minZ && Math.min(g.az, g.bz) - g.r < maxZ)
    if (!near.length) { out.push(s); continue }
    const blocked = (x: number, z: number) => near.some((g) => segDist(x, z, g) < g.r)
    // walk the polyline at `step` m, keeping original vertices, and split where blocked
    const pieces: number[][] = []
    let cur: number[] = [], any = false
    const visit = (x: number, z: number) => {
      if (blocked(x, z)) { any = true; if (cur.length) pieces.push(cur); cur = [] }
      else cur.push(Math.round(x * 100) / 100, Math.round(z * 100) / 100)
    }
    visit(p[0], p[1])
    for (let i = 2; i < p.length; i += 2) {
      const ax = p[i - 2], az = p[i - 1], n = Math.max(1, Math.ceil(Math.hypot(p[i] - ax, p[i + 1] - az) / step))
      for (let k = 1; k <= n; k++) {
        const t = k / n
        // interior samples only matter at piece boundaries; keep original vertices + boundary samples
        const x = ax + (p[i] - ax) * t, z = az + (p[i + 1] - az) * t
        if (k === n) visit(x, z)
        else if (blocked(x, z)) visit(x, z)
        else if (!cur.length) visit(x, z)
        else {
          const nx = ax + (p[i] - ax) * ((k + 1) / n), nz = az + (p[i + 1] - az) * ((k + 1) / n)
          if (blocked(nx, nz)) visit(x, z)
        }
      }
    }
    if (cur.length) pieces.push(cur)
    if (!any) { out.push(s); continue }
    const kept = pieces.filter((q) => {
      let len = 0
      for (let i = 2; i < q.length; i += 2) len += Math.hypot(q[i] - q[i - 2], q[i + 1] - q[i - 1])
      return q.length >= 4 && len >= minLen
    })
    kept.forEach((q, n) => out.push({ ...s, id: kept.length === 1 ? s.id : `${s.id}_${n}`, points: q }))
  }
  return out
}
