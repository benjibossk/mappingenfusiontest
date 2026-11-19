// Bohemia reference maps (Everon / Kolguyev / Arland) exported from the vanilla .ent worlds by
// tools/PakTools/export_ref_map.py into public/refmaps/<map>.json. Loaded read-only, drawn with the
// tool's own renderers so a generated map and a real one can be compared side by side, plus the
// same placement metrics for both (refStats).

import type { Placed } from './settlements'
import type { BuildingCat } from '../data/buildings'
import { BUILDINGS } from '../data/buildings'
import { footprint } from './settlements'
import { footprintOf } from './industrial'

export type RefMapId = 'everon' | 'kolguyev' | 'arland'
export const REF_MAPS: RefMapId[] = ['everon', 'kolguyev', 'arland']

export interface RefMap {
  name: string
  size: number
  minX: number
  minZ: number
  roads: { gen: string; w: number; pts: number[] }[]
  buildings: { prefabs: string[]; items: [number, number, number, number, string][] }
  fences: { prefabs: string[]; items: [number, number, number, number, number][] }
  lakes: number[][]
  rivers: number[][]
  power: { pf: string; pts: number[] }[]
  trees: { cell: number; cols: number; rows: number; minX: number; minZ: number; counts: number[]; source: string; total: number }
  bushes?: RefMap['trees']
  /** smooth forest outlines rebuilt from the tree points (PakTools/forest_outlines.py): holes = clearings,
   *  parts = extra outer rings of the same massif, leaf from the conifer share (>= 70 % needle, <= 30 % broad) */
  forests?: { pts: number[]; holes: number[][]; parts?: number[][]; leaf: 'broad' | 'needle' | 'mixed'; ha: number; trees: number; conifer: number }[]
  /** game terrain heights (export_ref_map.py): Int16 decimetres, little-endian, row 0 = south, base64 */
  heights: { step: number; cols: number; rows: number; enc: 'i16dm-b64'; data: string } | null
  lakes2?: { pts: number[]; level: number; lake: number }[]
  rivers2?: { pts: number[]; w: number; y: number[] }[]
}

/** heights block -> metres (row-major, row 0 = south) */
export function refHeights(h: NonNullable<RefMap['heights']>): number[] {
  const bin = atob(h.data), n = h.cols * h.rows, dv = new DataView(new ArrayBuffer(n * 2)), out = new Array<number>(n)
  for (let i = 0; i < n * 2; i++) dv.setUint8(i, bin.charCodeAt(i))
  for (let i = 0; i < n; i++) out[i] = dv.getInt16(i * 2, true) / 10
  return out
}

export async function loadRefMap(id: RefMapId): Promise<RefMap> {
  const res = await fetch(`${import.meta.env.BASE_URL ?? '/'}refmaps/${id}.json`)
  if (!res.ok) throw new Error(`refmaps/${id}.json: HTTP ${res.status}`)
  return res.json()
}

// rough footprint per class when the prefab is not in the tool's building catalogue (half sizes, metres)
const BOX: Record<string, [number, number]> = { house: [5, 4], shed: [2.5, 2], church: [10, 6], civic: [7, 5], industrial: [10, 7], military: [6, 4], farm: [8, 5], other: [4, 3] }
const CAT: Record<string, BuildingCat> = { house: 'houseM', shed: 'shed', church: 'civic', civic: 'civic', industrial: 'annex', military: 'annex', farm: 'farm', other: 'annex' }
const strip = (p: string) => p.replace(/^\{[0-9A-F]+\}/, '')

export function refBuildings(m: RefMap): Placed[] {
  const cat = new Map(BUILDINGS.map((b) => [strip(b.prefab), b]))
  return m.buildings.items.map(([pi, x, z, yaw, cls], i) => {
    const prefab = m.buildings.prefabs[pi], b = cat.get(strip(prefab))
    const [hx, hz] = BOX[cls] ?? BOX.other
    return {
      id: `REF_BLD_${i + 1}`, site: 'REF', prefab, cat: b?.cat ?? CAT[cls] ?? 'annex', x, z, yaw,
      corners: b ? footprint(b, x, z, yaw) : footprintOf({ minX: -hx, minZ: -hz, maxX: hx, maxZ: hz }, x, z, yaw),
      ...(cls === 'house' ? { role: 'house' as const } : cls === 'church' ? { role: 'church' as const } : {}),
    }
  })
}

/** fence / wall pieces -> 2-point segments (piece origin at one end, along local +X) */
export function refFences(m: RefMap): [number, number][][] {
  return m.fences.items.map(([, x, z, yaw, len]) => {
    const a = (yaw * Math.PI) / 180
    return [[x, z], [x + len * Math.cos(a), z - len * Math.sin(a)]]
  })
}

/** forest mask on the tree-count grid: 3x3 mean >= minPerCell trees */
export function forestMask(t: RefMap['trees'], minPerCell = 3): Uint8Array {
  const { cols, rows, counts } = t, out = new Uint8Array(cols * rows)
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    let s = 0, n = 0
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      const rr = r + j, cc = c + i
      if (rr >= 0 && rr < rows && cc >= 0 && cc < cols) { s += counts[rr * cols + cc]; n++ }
    }
    if (s / n >= minPerCell) out[r * cols + c] = 1
  }
  return out
}

const ringArea = (p: number[]) => { let a = 0; for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) a += p[j] * p[i + 1] - p[i] * p[j + 1]; return a / 2 }
function inside(p: number[], x: number, z: number) {
  let o = false
  for (let a = 0, b = p.length - 2; a < p.length; b = a, a += 2) if (p[a + 1] > z !== p[b + 1] > z && x < ((p[b] - p[a]) * (z - p[a + 1])) / (p[b + 1] - p[a + 1]) + p[a]) o = !o
  return o
}

/** outlines of the mask cells: outer rings (positive area) with their holes (clearings), collinear points dropped */
export function maskOutlines(mask: Uint8Array, cols: number, rows: number, cell: number, minX: number, minZ: number, minArea = 10000): { pts: number[]; holes: number[][] }[] {
  const on = (c: number, r: number) => c >= 0 && r >= 0 && c < cols && r < rows && mask[r * cols + c] === 1
  // directed boundary edges, forest on the left: key = start vertex, value = end vertices
  const W = cols + 1, next = new Map<number, number[]>()
  const add = (a: number, b: number) => { const l = next.get(a); if (l) l.push(b); else next.set(a, [b]) }
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    if (!on(c, r)) continue
    const v00 = r * W + c, v10 = v00 + 1, v01 = v00 + W, v11 = v01 + 1
    if (!on(c, r - 1)) add(v00, v10)
    if (!on(c + 1, r)) add(v10, v11)
    if (!on(c, r + 1)) add(v11, v01)
    if (!on(c - 1, r)) add(v01, v00)
  }
  const rings: number[][] = []
  for (const start of [...next.keys()]) {
    while (next.get(start)?.length) {
      const ring: number[] = []
      let v = start, pd = -1
      for (let guard = 0; guard < 4e6; guard++) {
        const l = next.get(v)
        if (!l || !l.length) break
        // at a saddle prefer turning left (keeps diagonal cells apart)
        let k = 0
        if (l.length > 1 && pd >= 0) { const left = l.findIndex((w) => dirOf(v, w, W) === (pd + 3) % 4); if (left >= 0) k = left }
        const w = l.splice(k, 1)[0]
        const d = dirOf(v, w, W)
        if (d !== pd) ring.push(minX + (v % W) * cell, minZ + Math.floor(v / W) * cell)
        pd = d; v = w
        if (v === start) break
      }
      if (ring.length >= 6) rings.push(ring)
    }
  }
  const outers = rings.filter((p) => ringArea(p) > 0 && ringArea(p) >= minArea).map((pts) => ({ pts, holes: [] as number[][] }))
  for (const h of rings) {
    if (ringArea(h) >= 0 || -ringArea(h) < 2 * cell * cell) continue
    const o = outers.find((o) => inside(o.pts, h[0] + 0.1, h[1] + 0.1))
    if (o) o.holes.push(h)
  }
  return outers
}
function dirOf(a: number, b: number, W: number) { const d = b - a; return d === 1 ? 0 : d === W ? 1 : d === -1 ? 2 : 3 }

// ---------------------------------------------------------------- metrics (same for both maps)
export interface StatRoad { type: string; pts: number[]; half: number }
export interface StatBuilding { x: number; z: number; house: boolean }
export interface MapStats {
  houses: number
  villages: number // clusters of >= 8 houses (single link 60 m), as in ref_maps_stats.py
  housesPerVillage: [number, number, number] // p10 / median / p90
  setback: [number, number, number] // house centre -> nearest road edge (m), houses within 50 m
  forestPct: number // share of the map area under forest
  treesPerHa: number | null // median trees / ha in forest cells (reference maps only)
  roadKm: Record<string, number>
}
const pct = (v: number[], q: number) => { if (!v.length) return NaN; const s = [...v].sort((a, b) => a - b); return Math.round(s[Math.min(s.length - 1, Math.round(q * (s.length - 1)))] * 10) / 10 }
const trio = (v: number[]): [number, number, number] => [pct(v, 0.1), pct(v, 0.5), pct(v, 0.9)]

export function mapStats(roads: StatRoad[], bld: StatBuilding[], forestM2: number, mapM2: number, treesPerHa: number | null): MapStats {
  const roadKm: Record<string, number> = {}
  const G = new Map<string, [number, number, number, number, number][]>(), C = 25
  for (const r of roads) {
    let L = 0
    for (let i = 2; i + 1 < r.pts.length; i += 2) {
      const ax = r.pts[i - 2], az = r.pts[i - 1], bx = r.pts[i], bz = r.pts[i + 1], d = Math.hypot(bx - ax, bz - az)
      L += d
      const n = Math.max(1, Math.ceil(d / 10))
      for (let s = 0; s <= n; s++) { const k = `${Math.floor((ax + ((bx - ax) * s) / n) / C)},${Math.floor((az + ((bz - az) * s) / n) / C)}`; const l = G.get(k); const seg: [number, number, number, number, number] = [ax, az, bx, bz, r.half]; if (l) { if (l[l.length - 1] !== seg) l.push(seg) } else G.set(k, [seg]) }
    }
    roadKm[r.type] = (roadKm[r.type] ?? 0) + L / 1000
  }
  for (const k in roadKm) roadKm[k] = Math.round(roadKm[k] * 10) / 10
  const houses = bld.filter((b) => b.house)
  const sb: number[] = []
  for (const h of houses) {
    let best = Infinity
    const cx = Math.floor(h.x / C), cz = Math.floor(h.z / C)
    for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) for (const [ax, az, bx, bz, hw] of G.get(`${cx + i},${cz + j}`) ?? []) {
      const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz
      const t = L2 ? Math.max(0, Math.min(1, ((h.x - ax) * dx + (h.z - az) * dz) / L2)) : 0
      best = Math.min(best, Math.hypot(h.x - ax - t * dx, h.z - az - t * dz) - hw)
    }
    if (best <= 50) sb.push(best)
  }
  // villages: single link 60 m
  const par = houses.map((_, i) => i), f = (x: number): number => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x] } return x }
  const HG = new Map<string, number[]>()
  houses.forEach((h, i) => { const k = `${Math.floor(h.x / 60)},${Math.floor(h.z / 60)}`; const l = HG.get(k); if (l) l.push(i); else HG.set(k, [i]) })
  houses.forEach((h, i) => {
    const cx = Math.floor(h.x / 60), cz = Math.floor(h.z / 60)
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const j of HG.get(`${cx + a},${cz + b}`) ?? []) if (j > i && Math.hypot(h.x - houses[j].x, h.z - houses[j].z) < 60) par[f(i)] = f(j)
  })
  const cl = new Map<number, number>()
  houses.forEach((_, i) => cl.set(f(i), (cl.get(f(i)) ?? 0) + 1))
  const vill = [...cl.values()].filter((n) => n >= 8)
  return { houses: houses.length, villages: vill.length, housesPerVillage: trio(vill), setback: trio(sb), forestPct: Math.round((1000 * forestM2) / Math.max(1, mapM2)) / 10, treesPerHa, roadKm }
}

/** median trees / ha over the forest cells of a tree-count grid */
export function treesPerHa(t: RefMap['trees'], mask: Uint8Array): number {
  const v: number[] = []
  for (let i = 0; i < mask.length; i++) if (mask[i]) v.push(t.counts[i])
  return Math.round((pct(v, 0.5) * 10000) / (t.cell * t.cell))
}
export const polyArea = (p: number[]) => Math.abs(ringArea(p))
