// Checks run before sending to the Workbench: things that build fine but look wrong or break in game.
// Each issue has a position so the map can point at it.

import type { Grid, SurfaceGrid } from './island'
import { SITE_RADIUS, maxGrade, worstGrade, type Site } from './network'
import type { Road } from './roads'
import type { Placed } from './settlements'
import { overBudgetCells, type DensityGrid, type Platform } from './platformBudget'

export type IssueKind = 'noBridge' | 'steepRoad' | 'isolated' | 'buildingWet' | 'overlap' | 'overfull' | 'outside' | 'buildingField' | 'roadField' | 'overBudget'
export interface Issue { kind: IssueKind; x: number; z: number; id: string; value?: number }

// grade limits per road type: maxGrade() in network.ts, the same the auto network routes with

export function validate(o: {
  roads: Road[]
  sites: Site[]
  settled: Placed[]
  refusedGaps: { id: string; from: [number, number]; to: [number, number] }[]
  heights: ArrayLike<number>
  grid: Grid
  /** forests and fields drawn on the map (flat X/Z outlines) */
  areas?: { id: string; kind: 'forest' | 'field'; pts: number[] }[]
  /** zones (industrial, military, airfield) with their footprints */
  zones?: { id: string; x: number; z: number; boxes: { corners: number[] }[] }[]
  surfaces?: SurfaceGrid[]
  /** per-platform object budget (platformBudget.ts): cells above it become 'overBudget' */
  budget?: { platform: Platform; grid: DensityGrid }
}): Issue[] {
  const { cols, rows, step } = o.grid
  const at = (x: number, z: number) => {
    const c = Math.min(cols - 1, Math.max(0, Math.round(x / step))), r = Math.min(rows - 1, Math.max(0, Math.round(z / step)))
    return o.heights[r * cols + c]
  }
  const out: Issue[] = []
  for (const g of o.refusedGaps) out.push({ kind: 'noBridge', id: g.id, x: (g.from[0] + g.to[0]) / 2, z: (g.from[1] + g.to[1]) / 2 })
  // grade over 20 m steps, the same measure the auto network routes with (network.ts)
  for (const r of o.roads) {
    if (r.pts.length < 4) continue
    const w = worstGrade(r.pts, o.heights, o.grid, r.spans)
    if (w.grade > maxGrade(r.type)) out.push({ kind: 'steepRoad', id: r.id, x: w.x, z: w.z, value: Math.round(w.grade * 100) })
  }

  // a place no road reaches
  for (const s of o.sites) {
    const reach = SITE_RADIUS[s.kind] * 1.5
    const served = o.roads.some((r) => {
      for (let i = 0; i + 1 < r.pts.length; i += 2) if (Math.hypot(r.pts[i] - s.x, r.pts[i + 1] - s.z) < reach) return true
      return false
    })
    if (!served) out.push({ kind: 'isolated', id: s.id, x: s.x, z: s.z })
  }
  for (const b of o.settled) if (b.ycm === undefined && at(b.x, b.z) < 0.5) // piers (ycm) stand over the water on purpose
    out.push({ kind: 'buildingWet', id: b.id, x: b.x, z: b.z })

  // objects outside the terrain
  const W = (cols - 1) * step, H = (rows - 1) * step
  const outside = (x: number, z: number) => x < 0 || z < 0 || x > W || z > H
  for (const b of o.settled) if (outside(b.x, b.z)) out.push({ kind: 'outside', id: b.id, x: clamp(b.x, W), z: clamp(b.z, H) })
  for (const zn of o.zones ?? []) if (outside(zn.x, zn.z)) out.push({ kind: 'outside', id: zn.id, x: clamp(zn.x, W), z: clamp(zn.z, H) })
  for (const r of o.roads) for (let i = 0; i + 1 < r.pts.length; i += 2) if (outside(r.pts[i], r.pts[i + 1])) {
    out.push({ kind: 'outside', id: r.id, x: clamp(r.pts[i], W), z: clamp(r.pts[i + 1], H) }); break
  }
  for (const a of o.areas ?? []) for (let i = 0; i + 1 < a.pts.length; i += 2) if (outside(a.pts[i], a.pts[i + 1])) {
    out.push({ kind: 'outside', id: a.id, x: clamp(a.pts[i], W), z: clamp(a.pts[i + 1], H) }); break
  }

  // overlapping zones / fields / forests
  const polys: { id: string; pts: number[] }[] = (o.areas ?? []).filter((a) => a.pts.length >= 6).map((a) => ({ id: a.id, pts: a.pts }))
  for (const zn of o.zones ?? []) for (const b of zn.boxes) if (b.corners.length >= 6) polys.push({ id: zn.id, pts: b.corners })
  const seen = new Set<string>()
  for (let i = 0; i < polys.length; i++) for (let j = i + 1; j < polys.length; j++) {
    const a = polys[i], b = polys[j]
    if (a.id === b.id) continue
    const key = a.id < b.id ? a.id + '|' + b.id : b.id + '|' + a.id
    if (seen.has(key)) continue
    const hit = polyOverlap(a.pts, b.pts)
    if (hit) { seen.add(key); out.push({ kind: 'overlap', id: a.id + ' / ' + b.id, x: hit[0], z: hit[1] }) }
  }

  // houses in fields, roads through fields
  const fields = (o.areas ?? []).filter((a) => a.kind === 'field' && a.pts.length >= 6)
  for (const b of o.settled) {
    const f = fields.find((f) => inPoly(b.x, b.z, f.pts))
    if (f) out.push({ kind: 'buildingField', id: b.id + ' / ' + f.id, x: b.x, z: b.z })
  }
  for (const r of o.roads) for (const f of fields) {
    for (let i = 0; i + 1 < r.pts.length; i += 2) if (inPoly(r.pts[i], r.pts[i + 1], f.pts)) {
      out.push({ kind: 'roadField', id: r.id + ' / ' + f.id, x: r.pts[i], z: r.pts[i + 1] }); break
    }
  }

  // more than 5 surfaces per terrain block
  if (o.surfaces) for (const b of overfullBlockList(o.surfaces)) out.push({ kind: 'overfull', id: `${Math.round(b.x)},${Math.round(b.z)}`, x: b.x, z: b.z, value: b.used })
  if (o.budget) for (const c of overBudgetCells(o.budget.grid, o.budget.platform)) out.push({ kind: 'overBudget', id: `${Math.round(c.x)},${Math.round(c.z)}`, x: c.x, z: c.z, value: c.count })
  return out
}

const clamp = (v: number, m: number) => Math.min(m, Math.max(0, v))

/** point in polygon (flat X/Z list), even-odd rule */
export function inPoly(x: number, z: number, p: number[]): boolean {
  let inside = false
  for (let i = 0, j = p.length - 2; i + 1 < p.length; j = i, i += 2) {
    const xi = p[i], zi = p[i + 1], xj = p[j], zj = p[j + 1]
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside
  }
  return inside
}

function segHit(ax: number, az: number, bx: number, bz: number, cx: number, cz: number, dx: number, dz: number): [number, number] | null {
  const d = (bx - ax) * (dz - cz) - (bz - az) * (dx - cx)
  if (d === 0) return null
  const t = ((cx - ax) * (dz - cz) - (cz - az) * (dx - cx)) / d
  const u = ((cx - ax) * (bz - az) - (cz - az) * (bx - ax)) / d
  return t > 0 && t < 1 && u > 0 && u < 1 ? [ax + t * (bx - ax), az + t * (bz - az)] : null
}

/** a point where two polygons overlap, or null (touching edges do not count) */
export function polyOverlap(a: number[], b: number[]): [number, number] | null {
  for (let i = 0; i + 1 < a.length; i += 2) {
    const i2 = (i + 2) % a.length
    for (let j = 0; j + 1 < b.length; j += 2) {
      const j2 = (j + 2) % b.length
      const h = segHit(a[i], a[i + 1], a[i2], a[i2 + 1], b[j], b[j + 1], b[j2], b[j2 + 1])
      // a real overlap has ground inside both polygons next to the crossing; borders shared after a
      // forest merge/cut cross at float precision only and are not reported
      if (h) for (const [dx, dz] of [[2, 0], [-2, 0], [0, 2], [0, -2], [1.5, 1.5], [-1.5, -1.5], [1.5, -1.5], [-1.5, 1.5]]) if (inPoly(h[0] + dx, h[1] + dz, a) && inPoly(h[0] + dx, h[1] + dz, b)) return h
    }
  }
  if (inPoly(a[0], a[1], b)) return [a[0], a[1]]
  if (inPoly(b[0], b[1], a)) return [b[0], b[1]]
  return null
}

/** blocks painted by more than `max` surfaces, with their centre (same rule as island.overfullBlocks) */
export function overfullBlockList(surfaces: SurfaceGrid[], blockSize = 64, max = 5): { x: number; z: number; used: number }[] {
  if (!surfaces.length) return []
  const { cols, rows, step } = surfaces[0]
  const per = Math.max(1, Math.round(blockSize / step))
  const nb = Math.ceil((cols - 1) / per), nbr = Math.ceil((rows - 1) / per)
  const res: { x: number; z: number; used: number }[] = []
  for (let by = 0; by < nbr; by++) for (let bx = 0; bx < nb; bx++) {
    const r0 = Math.max(0, by * per - 1), r1 = Math.min(rows - 1, (by + 1) * per)
    const c0 = Math.max(0, bx * per - 1), c1 = Math.min(cols - 1, (bx + 1) * per)
    let used = 0
    for (const s of surfaces) {
      let hit = false
      for (let r = r0; r <= r1 && !hit; r++) for (let c = c0; c <= c1; c++) if (s.weights[r * cols + c] > 0) { hit = true; break }
      if (hit) used++
    }
    if (used > max) res.push({ x: (bx + 0.5) * per * step, z: (by + 0.5) * per * step, used })
  }
  return res
}
