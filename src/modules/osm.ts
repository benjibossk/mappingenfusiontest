// OpenStreetMap features of a real area, turned into the tool's own objects: roads, rivers and lakes,
// forests, field areas and village sites. Data © OpenStreetMap contributors, ODbL (attribution and
// share-alike apply to a map built from it). Fetched from the public Overpass API, or read from a file
// saved from it (Overpass JSON).

import * as turf from '@turf/turf'
import type { Feature, LineString, MultiLineString, MultiPolygon, Polygon } from 'geojson'
import type { RoadType } from './roads'
import type { SiteKind } from './network'

export const OVERPASS = 'https://overpass-api.de/api/interpreter'
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
  minForest: number // m², smaller woods are dropped
}

export interface OsmResult {
  roads: { type: RoadType; pts: number[]; width?: number }[]
  rivers: { pts: number[]; width: number }[]
  lakes: number[][]
  forests: { pts: number[]; leaf: 'broad' | 'needle' | 'mixed' }[]
  fields: number[][]
  sites: { x: number; z: number; kind: SiteKind; name: string }[]
}

type Pt = [number, number]
interface El { type: 'node' | 'way' | 'relation'; id: number; lat?: number; lon?: number; tags?: Record<string, string>; geometry?: { lat: number; lon: number }[]; members?: { type: string; role: string; geometry?: { lat: number; lon: number }[] }[] }

export function overpassQuery([s, w, n, e]: [number, number, number, number], o: OsmOptions) {
  const bb = `(${s},${w},${n},${e})`
  const hw: string[] = []
  if (o.mainRoads) hw.push('motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'motorway_link', 'trunk_link', 'primary_link', 'secondary_link')
  if (o.minorRoads) hw.push('unclassified', 'residential', 'living_street', 'service', 'tertiary_link')
  if (o.tracks) hw.push('track')
  if (o.paths) hw.push('path', 'footway', 'bridleway', 'cycleway')
  const q: string[] = []
  if (hw.length) q.push(`way["highway"~"^(${hw.join('|')})$"]${bb};`)
  if (o.water) q.push(`way["waterway"~"^(river|stream|canal)$"]${bb};`, `way["natural"="water"]${bb};`, `relation["natural"="water"]${bb};`)
  if (o.forests) q.push(`way["landuse"="forest"]${bb};`, `way["natural"="wood"]${bb};`, `relation["landuse"="forest"]${bb};`, `relation["natural"="wood"]${bb};`)
  if (o.fields) q.push(`way["landuse"~"^(farmland|meadow|orchard|vineyard|grass)$"]${bb};`)
  if (o.places) q.push(`node["place"~"^(city|town|village|hamlet)$"]${bb};`)
  return `[out:json][timeout:90];(${q.join('')});out geom;`
}

export async function fetchOverpass(query: string): Promise<unknown> {
  const res = await fetch(OVERPASS, { method: 'POST', body: new URLSearchParams({ data: query }) })
  if (!res.ok) throw new Error(`Overpass ${res.status}: ${(await res.text()).slice(0, 200)}`)
  return res.json()
}

const ROAD: Record<string, RoadType> = {
  motorway: 'asphaltLine', trunk: 'asphaltLine', primary: 'asphaltLine', motorway_link: 'asphalt', trunk_link: 'asphalt', primary_link: 'asphalt',
  secondary: 'asphalt', secondary_link: 'asphalt', tertiary: 'asphalt', tertiary_link: 'asphaltNarrow',
  unclassified: 'asphaltNarrow', residential: 'asphaltNarrow', living_street: 'asphaltNarrow', service: 'asphaltNarrow',
  track: 'dirt', path: 'trailDirt', footway: 'trailDirt', bridleway: 'trailDirt', cycleway: 'trailGravel',
}
const RIVER_WIDTH: Record<string, number> = { river: 14, canal: 8, stream: 3 }
const PLACE: Record<string, SiteKind> = { city: 'town', town: 'town', village: 'village', hamlet: 'hamlet' }

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
  const out: OsmResult = { roads: [], rivers: [], lakes: [], forests: [], fields: [], sites: [] }

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
  const ringPts = (r: Pt[], tol: number) => { const s = simplify(r, tol); return flat(s.slice(0, -1)) } // open ring, the shape is closed by the plugin

  const roadParts = new Map<string, Pt[][]>(), riverParts = new Map<string, Pt[][]>()
  const group = (m: Map<string, Pt[][]>, k: string, l: Pt[]) => { if (l.length < 2) return; const g = m.get(k); if (g) g.push(l); else m.set(k, [l]) }
  for (const el of els) {
    const t = el.tags ?? {}
    if (el.type === 'node' && t.place && PLACE[t.place] && el.lat !== undefined && el.lon !== undefined) {
      const [x, z] = toLocal(el.lon, el.lat)
      if (Math.abs(x) < h && Math.abs(z) < h) out.sites.push({ x: Math.round(x + h), z: Math.round(z + h), kind: PLACE[t.place], name: t.name ?? '' })
      continue
    }
    const wayRings = (): Pt[][] => {
      if (el.type === 'way' && el.geometry) return [loc(el.geometry)]
      if (el.type === 'relation' && el.members) return rings(el.members.filter((m) => m.role !== 'inner' && m.geometry).map((m) => loc(m.geometry!)))
      return []
    }
    if (t.highway && ROAD[t.highway] && el.geometry) {
      const w = Number.parseFloat(t.width ?? '')
      group(roadParts, `${ROAD[t.highway]}|${w > 2 && w < 30 ? w : ''}`, loc(el.geometry))
    } else if (t.waterway && RIVER_WIDTH[t.waterway] && el.geometry) {
      const w = Number.parseFloat(t.width ?? '')
      group(riverParts, String(w > 1 && w < 200 ? w : RIVER_WIDTH[t.waterway]), loc(el.geometry))
    } else if (t.natural === 'water' && t.water !== 'river') {
      for (const r of polys(wayRings())) if (area(r) > 400) out.lakes.push(ringPts(r, 3))
    } else if (t.landuse === 'forest' || t.natural === 'wood') {
      for (const r of polys(wayRings())) if (area(r) >= o.minForest) out.forests.push({ pts: ringPts(r, 6), leaf: t.leaf_type === 'broadleaved' ? 'broad' : t.leaf_type === 'needleleaved' ? 'needle' : 'mixed' })
    } else if (t.landuse && /^(farmland|meadow|orchard|vineyard|grass)$/.test(t.landuse)) {
      for (const r of polys(wayRings())) if (area(r) > 5000) out.fields.push(ringPts(r, 5))
    }
  }
  for (const [k, ls] of roadParts) {
    const [type, w] = k.split('|')
    for (const l of merge(ls)) for (const p of lines(l)) {
      const s = simplify(p, 1.5)
      if (s.length >= 2) out.roads.push({ type: type as RoadType, pts: flat(s), ...(w ? { width: Number(w) } : {}) })
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
