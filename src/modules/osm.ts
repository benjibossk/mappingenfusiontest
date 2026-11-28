// OpenStreetMap features of a real area, turned into the tool's own objects: roads, rivers and lakes,
// forests, field areas and village sites. Data © OpenStreetMap contributors, ODbL (attribution and
// share-alike apply to a map built from it). Fetched from the public Overpass API, or read from a file
// saved from it (Overpass JSON).

import * as turf from '@turf/turf'
import type { Feature, LineString, MultiLineString, MultiPolygon, Polygon } from 'geojson'
import type { RoadType } from './roads'
import type { SiteKind } from './network'
import { isBridge, isTunnel, osmRoadType, osmWidth } from './osmWidth'
import { classify, overpassStatements } from '../data/osmRules'

export const OVERPASS = 'https://overpass-api.de/api/interpreter'
// public mirrors, tried in turn when one is busy (502 / 504 / 429 / network error)
const MIRRORS = [OVERPASS, 'https://maps.mail.ru/osm/tools/overpass/api/interpreter', 'https://overpass.kumi.systems/api/interpreter']
export const OSM_ATTRIBUTION = '© OpenStreetMap contributors (ODbL)'

export interface OsmOptions {
  mainRoads: boolean
  minorRoads: boolean
  tracks: boolean
  paths: boolean
  water: boolean
  forests: boolean
  fields: boolean
  places: boolean
  buildings: boolean
  minForest: number // m², smaller woods are dropped
}

export interface OsmResult {
  roads: { type: RoadType; pts: number[]; width?: number; bridge?: boolean }[] // bridge: OSM bridge, never flattened (tunnels are left out)
  rivers: { pts: number[]; width: number }[]
  lakes: number[][]
  forests: { pts: number[]; leaf: 'broad' | 'needle' | 'mixed'; tall?: 'low' | 'mid' | 'high' }[]
  fields: number[][]
  sites: { x: number; z: number; kind: SiteKind; name: string }[]
  buildings: number[][] // footprints, open rings, local metres
}

type Pt = [number, number]
interface El { type: 'node' | 'way' | 'relation'; id: number; lat?: number; lon?: number; tags?: Record<string, string>; geometry?: { lat: number; lon: number }[]; members?: { type: string; role: string; geometry?: { lat: number; lon: number }[] }[] }

export function overpassQuery([s, w, n, e]: [number, number, number, number], o: OsmOptions) {
  const bb = `(${s},${w},${n},${e})`
  const q = overpassStatements(bb, (g) => o[g])
  return `[out:json][timeout:90];(${q.join('')});out geom;`
}

export async function fetchOverpass(query: string, onTry?: (host: string, k: number, n: number) => void): Promise<unknown> {
  let last = ''
  for (let k = 0; k < MIRRORS.length; k++) {
    const url = MIRRORS[k]
    onTry?.(new URL(url).host, k + 1, MIRRORS.length)
    try {
      const res = await fetch(url, { method: 'POST', body: new URLSearchParams({ data: query }) })
      if (res.ok) return await res.json()
      last = `${res.status}: ${(await res.text()).slice(0, 200)}`
      if (res.status === 400) break // the query itself is wrong, no mirror will take it
    } catch (e) { last = (e as Error).message }
  }
  throw new Error(`Overpass ${last}`)
}

/** ways of a multipolygon relation joined into closed rings */
function rings(parts: Pt[][]): Pt[][] {
  const out: Pt[][] = []
  const todo = parts.map((p) => p.slice())
  while (todo.length) {
    let ring = todo.shift()!
    for (let guard = 0; guard < 10000; guard++) {
      const a = ring[0], b = ring[ring.length - 1]
      if (a[0] === b[0] && a[1] === b[1]) break
      const k = todo.findIndex((p) => (p[0][0] === b[0] && p[0][1] === b[1]) || (p[p.length - 1][0] === b[0] && p[p.length - 1][1] === b[1]))
      if (k < 0) break
      const next = todo.splice(k, 1)[0]
      if (next[0][0] !== b[0] || next[0][1] !== b[1]) next.reverse()
      ring = ring.concat(next.slice(1))
    }
    if (ring.length >= 4) out.push(ring)
  }
  return out
}

/** Douglas-Peucker on a flat X/Z list */
function simplify(pts: Pt[], tol: number): Pt[] {
  if (pts.length < 3) return pts
  const keep = new Uint8Array(pts.length)
  keep[0] = keep[pts.length - 1] = 1
  const stack: [number, number][] = [[0, pts.length - 1]]
  while (stack.length) {
    const [i, j] = stack.pop()!
    const [ax, az] = pts[i], [bx, bz] = pts[j]
    const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz) || 1
    let far = -1, best = tol
    for (let k = i + 1; k < j; k++) {
      const d = Math.abs((pts[k][0] - ax) * dz - (pts[k][1] - az) * dx) / len
      if (d > best) { best = d; far = k }
    }
    if (far > 0) { keep[far] = 1; stack.push([i, far], [far, j]) }
  }
  return pts.filter((_, k) => keep[k])
}

/** closed ring (first point = last): split at the point farthest from the start, simplify both halves
 *  (simplify alone measures from a zero-length chord and would keep only the ends), open ring out */
function simplifyRing(r: Pt[], tol: number): Pt[] {
  if (r.length < 4) return r.slice(0, -1)
  let far = 1, best = -1
  for (let k = 1; k < r.length - 1; k++) {
    const d = Math.hypot(r[k][0] - r[0][0], r[k][1] - r[0][1])
    if (d > best) { best = d; far = k }
  }
  const a = simplify(r.slice(0, far + 1), tol), b = simplify(r.slice(far), tol)
  return [...a, ...b.slice(1, -1)]
}

/** OSM cuts a road into many ways: join the pieces meeting end to end (only where exactly two meet) */
function merge(ls: Pt[][]): Pt[][] {
  const key = (p: Pt) => `${p[0].toFixed(2)},${p[1].toFixed(2)}`
  const ends = new Map<string, number[]>()
  ls.forEach((l, i) => {
    for (const p of [l[0], l[l.length - 1]]) {
      const k = key(p)
      const at = ends.get(k)
      if (at) at.push(i)
      else ends.set(k, [i])
    }
  })
  const used = new Uint8Array(ls.length)
  const grow = (line: Pt[]) => {
    for (;;) {
      const k = key(line[line.length - 1])
      const at = ends.get(k)!
      if (at.length !== 2) return line
      const j = at.find((i) => !used[i])
      if (j === undefined) return line
      used[j] = 1
      const next = key(ls[j][0]) === k ? ls[j] : ls[j].slice().reverse()
      line = line.concat(next.slice(1))
    }
  }
  const out: Pt[][] = []
  for (let i = 0; i < ls.length; i++) {
    if (used[i]) continue
    used[i] = 1
    out.push(grow(grow(ls[i].slice()).reverse()))
  }
  return out
}

const flat = (pts: Pt[]) => pts.flatMap(([x, z]) => [Math.round(x * 10) / 10, Math.round(z * 10) / 10])

/**
 * @param toLocal WGS84 -> area frame (metres from the centre, +Z north)
 * @param size side of the square area, metres; results are shifted to the terrain frame (origin south-west)
 */
export function osmToMap(data: unknown, toLocal: (lon: number, lat: number) => Pt, size: number, o: OsmOptions): OsmResult {
  const els = ((data as { elements?: El[] })?.elements ?? []) as El[]
  const h = size / 2
  const bbox: [number, number, number, number] = [0, 0, size, size]
  const loc = (g: { lat: number; lon: number }[]): Pt[] => g.map(({ lat, lon }) => { const [x, z] = toLocal(lon, lat); return [x + h, z + h] })
  const out: OsmResult = { roads: [], rivers: [], lakes: [], forests: [], fields: [], sites: [], buildings: [] }

  const lines = (pts: Pt[]): Pt[][] => {
    if (pts.length < 2) return []
    const c = turf.bboxClip(turf.lineString(pts), bbox) as Feature<LineString | MultiLineString>
    const g = c.geometry
    const parts = g.type === 'LineString' ? [g.coordinates] : g.coordinates
    return parts.filter((p) => p.length >= 2).map((p) => p as Pt[])
  }
  const polys = (rs: Pt[][]): Pt[][] => {
    const res: Pt[][] = []
    for (const r of rs) {
      if (r.length < 4) continue
      let c: Feature<Polygon | MultiPolygon>
      try { c = turf.bboxClip(turf.polygon([r]), bbox) as Feature<Polygon | MultiPolygon> } catch { continue }
      const g = c.geometry
      const all = g.type === 'Polygon' ? [g.coordinates] : g.coordinates
      for (const p of all) if (p[0] && p[0].length >= 4) res.push(p[0] as Pt[])
    }
    return res
  }
  const area = (r: Pt[]) => { let a = 0; for (let k = 0, j = r.length - 1; k < r.length; j = k++) a += (r[j][0] + r[k][0]) * (r[j][1] - r[k][1]); return Math.abs(a / 2) }
  const ringPts = (r: Pt[], tol: number) => flat(simplifyRing(r, tol)) // open ring, the shape is closed by the plugin

  const roadParts = new Map<string, Pt[][]>(), riverParts = new Map<string, Pt[][]>()
  const group = (m: Map<string, Pt[][]>, k: string, l: Pt[]) => { if (l.length < 2) return; const g = m.get(k); if (g) g.push(l); else m.set(k, [l]) }
  for (const el of els) {
    const t = el.tags ?? {}
    // classify every element the data holds, like before the rule table (a saved Overpass file may hold
    // more than the ticked boxes); the boxes only shape the query
    const rule = classify(el.type, t, () => true)
    if (!rule) continue
    const p = rule.params ?? {}
    if (rule.layer === 'site') {
      if (el.lat === undefined || el.lon === undefined) continue
      const [x, z] = toLocal(el.lon, el.lat)
      if (Math.abs(x) < h && Math.abs(z) < h) out.sites.push({ x: Math.round(x + h), z: Math.round(z + h), kind: p.site!, name: t.name ?? '' })
      continue
    }
    const wayRings = (): Pt[][] => {
      if (el.type === 'way' && el.geometry) return [loc(el.geometry)]
      if (el.type === 'relation' && el.members) return rings(el.members.filter((m) => m.role !== 'inner' && m.geometry).map((m) => loc(m.geometry!)))
      return []
    }
    if (rule.layer === 'road') {
      if (!el.geometry || isTunnel(t)) continue // #16: no tunnel in a heightmap terrain
      const w = Math.round(osmWidth(t) * 10) / 10 // width tag, lanes, or class table (ARTE, MIT)
      group(roadParts, `${osmRoadType(t, p.roadType!)}|${w >= 2 && w < 30 ? w : ''}|${isBridge(t) ? 1 : ''}`, loc(el.geometry))
    } else if (rule.layer === 'river') {
      if (!el.geometry) continue
      const w = Number.parseFloat(t.width ?? '')
      group(riverParts, String(w > 1 && w < 200 ? w : p.width!), loc(el.geometry))
    } else if (rule.layer === 'lake') {
      for (const r of polys(wayRings())) if (area(r) > p.minArea!) out.lakes.push(ringPts(r, p.tolerance!))
    } else if (rule.layer === 'forest') {
      for (const r of polys(wayRings())) if (area(r) >= o.minForest) out.forests.push({ pts: ringPts(r, p.tolerance!), leaf: t.leaf_type === 'broadleaved' ? 'broad' : t.leaf_type === 'needleleaved' ? 'needle' : 'mixed' })
    } else if (rule.layer === 'building') {
      if (el.type !== 'way' || !el.geometry) continue
      const r = loc(el.geometry)
      if (r.length >= 4 && r.every(([x, z]) => x >= 0 && z >= 0 && x <= size && z <= size)) out.buildings.push(flat(r.slice(0, -1)))
    } else if (rule.layer === 'field') {
      for (const r of polys(wayRings())) if (area(r) > p.minArea!) out.fields.push(ringPts(r, p.tolerance!))
    }
  }
  for (const [k, ls] of roadParts) {
    const [type, w, br] = k.split('|')
    for (const l of merge(ls)) for (const p of lines(l)) {
      const s = simplify(p, 1.5)
      if (s.length >= 2) out.roads.push({ type: type as RoadType, pts: flat(s), ...(w ? { width: Number(w) } : {}), ...(br ? { bridge: true } : {}) })
    }
  }
  for (const [w, ls] of riverParts) {
    for (const l of merge(ls)) for (const p of lines(l)) {
      const s = simplify(p, 3)
      if (s.length >= 2) out.rivers.push({ pts: flat(s), width: Number(w) })
    }
  }
  return out
}
