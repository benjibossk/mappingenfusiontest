// Road corridors: keep hedges, groves, single trees and power poles off every road / track carriageway
// (seed 21 live check: FIELD_7_Hedge_281 across ROAD_ASPHALTE_ETROITE and PSTA_ROAD_7, a grove on the road edge).
// Lines are smoothed centre lines (as laid) with their half width; a spatial grid keeps the lookups cheap.

export interface CorridorLine { id: string; pts: number[]; half: number }
interface Seg { id: string; ax: number; az: number; bx: number; bz: number; half: number }

const CELL = 32

export class Corridors {
  private grid = new Map<number, Seg[]>()
  private maxHalf = 0
  constructor(lines: CorridorLine[]) {
    for (const l of lines) for (let i = 0; i + 3 < l.pts.length; i += 2) {
      const s: Seg = { id: l.id, ax: l.pts[i], az: l.pts[i + 1], bx: l.pts[i + 2], bz: l.pts[i + 3], half: l.half }
      this.maxHalf = Math.max(this.maxHalf, l.half)
      const pad = l.half + 8
      for (let cx = Math.floor((Math.min(s.ax, s.bx) - pad) / CELL); cx <= Math.floor((Math.max(s.ax, s.bx) + pad) / CELL); cx++)
        for (let cz = Math.floor((Math.min(s.az, s.bz) - pad) / CELL); cz <= Math.floor((Math.max(s.az, s.bz) + pad) / CELL); cz++) {
          const k = cx * 100003 + cz
          ;(this.grid.get(k) ?? this.grid.set(k, []).get(k)!).push(s)
        }
    }
  }
  /** the road whose carriageway + margin contains (x, z), with the distance to its edge (< 0 = inside), or null */
  hit(x: number, z: number, margin: number): { id: string; d: number; ux: number; uz: number; need: number } | null {
    const segs = this.grid.get(Math.floor(x / CELL) * 100003 + Math.floor(z / CELL))
    if (!segs) return null
    let best: { id: string; d: number; ux: number; uz: number; need: number } | null = null
    for (const s of segs) {
      const dx = s.bx - s.ax, dz = s.bz - s.az, L = dx * dx + dz * dz
      const t = L ? Math.max(0, Math.min(1, ((x - s.ax) * dx + (z - s.az) * dz) / L)) : 0
      const px = s.ax + dx * t, pz = s.az + dz * t, dist = Math.hypot(x - px, z - pz)
      const d = dist - s.half - margin
      if (d < 0 && (!best || d < best.d)) {
        let ux = x - px, uz = z - pz
        if (dist < 1e-6) { const n = Math.sqrt(L) || 1; ux = -dz / n; uz = dx / n } else { ux /= dist; uz /= dist }
        best = { id: s.id, d, ux, uz, need: -d }
      }
    }
    return best
  }
}

/** cut a polyline wherever it comes within road half + margin: the pieces in between (>= minLen) */
export function clipLine(line: number[][], c: Corridors, margin: number, minLen = 4, step = 1): number[][][] {
  const out: number[][][] = []
  let cur: number[][] = []
  const flush = () => {
    let L = 0
    for (let i = 1; i < cur.length; i++) L += Math.hypot(cur[i][0] - cur[i - 1][0], cur[i][1] - cur[i - 1][1])
    if (cur.length >= 2 && L >= minLen) out.push(cur)
    cur = []
  }
  const add = (p: number[]) => { const q = cur[cur.length - 1]; if (!q || Math.hypot(q[0] - p[0], q[1] - p[1]) > 1e-3) cur.push(p) }
  for (let i = 0; i < line.length; i++) {
    const a = line[i]
    if (i === 0) { if (!c.hit(a[0], a[1], margin)) add(a); continue }
    const p = line[i - 1], n = Math.max(1, Math.ceil(Math.hypot(a[0] - p[0], a[1] - p[1]) / step))
    let last: number[] | null = null // last clear sample of this segment, not yet added
    for (let k = 1; k <= n; k++) {
      const q = k === n ? a : [p[0] + ((a[0] - p[0]) * k) / n, p[1] + ((a[1] - p[1]) * k) / n]
      if (c.hit(q[0], q[1], margin)) {
        // the cut end before the gap
        if (cur.length) { if (last) add(last); flush() }
        last = null
        continue
      }
      // keep the original vertices, plus the first sample after a gap (the cut end)
      if (k === n || !cur.length) { add(q); last = null } else last = q
    }
  }
  flush()
  return out
}

/** a ring (flat x, z pairs) touches the corridors: a vertex / edge sample inside, or a corridor through it */
export function ringOnRoad(ring: number[], c: Corridors, margin: number, step = 2): string | null {
  for (let i = 0; i < ring.length; i += 2) {
    const j = (i + 2) % ring.length, n = Math.max(1, Math.ceil(Math.hypot(ring[j] - ring[i], ring[j + 1] - ring[i + 1]) / step))
    for (let k = 0; k < n; k++) {
      const h = c.hit(ring[i] + ((ring[j] - ring[i]) * k) / n, ring[i + 1] + ((ring[j + 1] - ring[i + 1]) * k) / n, margin)
      if (h) return h.id
    }
  }
  return null
}

/** hedge polylines with a point within road half + margin (audit: 'hedge-on-road') */
export function hedgesOnRoad(hedges: number[][][], c: Corridors, margin = 0.5): { i: number; road: string; x: number; z: number }[] {
  const out: { i: number; road: string; x: number; z: number }[] = []
  hedges.forEach((h, i) => {
    for (let s = 1; s < h.length; s++) {
      const a = h[s - 1], b = h[s], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1])))
      for (let k = 0; k <= n; k++) {
        const x = a[0] + ((b[0] - a[0]) * k) / n, z = a[1] + ((b[1] - a[1]) * k) / n, r = c.hit(x, z, margin)
        if (r) { out.push({ i, road: r.id, x, z }); return }
      }
    }
  })
  return out
}
