// Local import of OpenStreetMap data: an .osm (XML) file saved from openstreetmap.org / JOSM, or a
// .geojson file (QGIS, overpass-turbo export...). Both are turned into Overpass-like elements, passed
// through an editable tag -> layer schema (JSON, Maps4FS-like), then through osmToMap (osm.ts) which
// clips to the map and projects with the real-place projection. Residential / industrial areas and
// power lines / substations come out as extras. Data © OpenStreetMap contributors (ODbL).

import * as turf from '@turf/turf'
import type { Feature, LineString, MultiLineString, MultiPolygon, Polygon } from 'geojson'
import { osmToMap, type OsmOptions, type OsmResult } from './osm'

type LL = { lat: number; lon: number }
export interface OsmEl { type: 'node' | 'way' | 'relation'; id: number; lat?: number; lon?: number; tags?: Record<string, string>; geometry?: LL[]; members?: { type: string; role: string; geometry?: LL[] }[] }

export type ImportLayer = 'road' | 'river' | 'lake' | 'forest' | 'field' | 'building' | 'place' | 'residential' | 'industrial' | 'power' | 'substation' | 'ignore'
/** one rule: the first rule whose key (and value, when listed) matches gives the layer; `as` renames the
 *  value for road / river (e.g. highway=busway as secondary); `voltage` forces a power class */
export interface ImportRule { key: string; values?: string[]; layer: ImportLayer; as?: string }
export interface ImportSchema { rules: ImportRule[] }

export const DEFAULT_SCHEMA: ImportSchema = {
  rules: [
    { key: 'power', values: ['line', 'minor_line', 'cable'], layer: 'power' },
    { key: 'power', values: ['substation', 'plant'], layer: 'substation' },
    { key: 'building', layer: 'building' },
    { key: 'highway', values: ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link', 'unclassified', 'residential', 'living_street', 'service', 'track', 'path', 'footway', 'bridleway', 'cycleway'], layer: 'road' },
    { key: 'highway', values: ['road', 'busway'], layer: 'road', as: 'unclassified' },
    { key: 'waterway', values: ['river', 'stream', 'canal'], layer: 'river' },
    { key: 'waterway', values: ['ditch', 'drain'], layer: 'river', as: 'stream' },
    { key: 'natural', values: ['water'], layer: 'lake' },
    { key: 'landuse', values: ['reservoir', 'basin'], layer: 'lake' },
    { key: 'landuse', values: ['forest'], layer: 'forest' },
    { key: 'natural', values: ['wood'], layer: 'forest' },
    { key: 'landuse', values: ['farmland', 'meadow', 'orchard', 'vineyard', 'grass'], layer: 'field' },
    { key: 'landuse', values: ['residential'], layer: 'residential' },
    { key: 'landuse', values: ['industrial', 'commercial', 'retail'], layer: 'industrial' },
    { key: 'place', values: ['city', 'town', 'village', 'hamlet'], layer: 'place' },
  ],
}

export function parseSchema(text: string): ImportSchema {
  const s = JSON.parse(text) as ImportSchema
  if (!s || !Array.isArray(s.rules)) throw new Error('schema: "rules" array expected')
  for (const r of s.rules) if (typeof r.key !== 'string' || typeof r.layer !== 'string') throw new Error('schema: each rule needs "key" and "layer"')
  return s
}

export function ruleFor(tags: Record<string, string>, schema: ImportSchema): ImportRule | null {
  for (const r of schema.rules) {
    const v = tags[r.key]
    if (v === undefined || v === 'no') continue
    if (!r.values || r.values.includes(v) || r.values.includes('*')) return r
  }
  return null
}

const unesc = (s: string) => s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
const attrs = (s: string) => { const a: Record<string, string> = {}; for (const m of s.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) a[m[1]] = unesc(m[2] ?? m[3]); return a }

/** OSM XML (API 0.6 / JOSM) -> Overpass-like elements with geometry (way node refs resolved) */
export function parseOsmXml(text: string): { elements: OsmEl[] } {
  const nodes = new Map<string, LL>(), ways = new Map<string, LL[]>()
  const out: OsmEl[] = []
  const re = /<(node|way|relation)\b([^>]*?)(\/>|>([\s\S]*?)<\/\1>)/g
  const rels: { id: number; tags: Record<string, string>; body: string }[] = []
  for (const m of text.matchAll(re)) {
    const a = attrs(m[2]), body = m[4] ?? ''
    const tags: Record<string, string> = {}
    for (const t of body.matchAll(/<tag\b([^>]*)\/?>/g)) { const ta = attrs(t[1]); if (ta.k !== undefined) tags[ta.k] = ta.v ?? '' }
    if (a.action === 'delete') continue
    if (m[1] === 'node') {
      const ll = { lat: Number(a.lat), lon: Number(a.lon) }
      nodes.set(a.id, ll)
      if (Object.keys(tags).length) out.push({ type: 'node', id: Number(a.id), lat: ll.lat, lon: ll.lon, tags })
    } else if (m[1] === 'way') {
      const g = [...body.matchAll(/<nd\b([^>]*)\/?>/g)].map((n) => nodes.get(attrs(n[1]).ref)).filter((x): x is LL => !!x)
      ways.set(a.id, g)
      if (g.length >= 2) out.push({ type: 'way', id: Number(a.id), tags, geometry: g })
    } else rels.push({ id: Number(a.id), tags, body })
  }
  for (const r of rels) {
    const members = [...r.body.matchAll(/<member\b([^>]*)\/?>/g)].map((x) => attrs(x[1])).filter((x) => x.type === 'way' && ways.has(x.ref)).map((x) => ({ type: 'way', role: x.role ?? '', geometry: ways.get(x.ref) }))
    if (members.length) out.push({ type: 'relation', id: r.id, tags: r.tags, members })
  }
  return { elements: out }
}

/** GeoJSON (FeatureCollection / Feature, lon-lat WGS84) -> Overpass-like elements */
export function parseGeoJson(obj: unknown): { elements: OsmEl[] } {
  const o = obj as { type?: string; features?: unknown[] }
  const feats = (o?.type === 'FeatureCollection' ? o.features : o?.type === 'Feature' ? [o] : []) as { properties?: Record<string, unknown>; geometry?: { type: string; coordinates: unknown } | null }[]
  const out: OsmEl[] = []
  let id = 1
  const ll = (c: number[][]): LL[] => c.map(([lon, lat]) => ({ lat, lon }))
  for (const f of feats ?? []) {
    const g = f.geometry
    if (!g) continue
    const tags: Record<string, string> = {}
    const p = f.properties ?? {}
    // overpass-turbo exports nest the OSM tags in properties.tags
    const src = (p.tags && typeof p.tags === 'object' ? p.tags : p) as Record<string, unknown>
    for (const [k, v] of Object.entries(src)) if (v !== null && v !== undefined && typeof v !== 'object') tags[k] = String(v)
    const c = g.coordinates as never
    if (g.type === 'Point') { const [lon, lat] = c as number[]; out.push({ type: 'node', id: id++, lat, lon, tags }) }
    else if (g.type === 'LineString') out.push({ type: 'way', id: id++, tags, geometry: ll(c) })
    else if (g.type === 'MultiLineString') for (const l of c as number[][][]) out.push({ type: 'way', id: id++, tags, geometry: ll(l) })
    else if (g.type === 'Polygon' || g.type === 'MultiPolygon') {
      const polys = (g.type === 'Polygon' ? [c] : c) as number[][][][]
      const members = polys.flatMap((pl) => pl.map((ring, k) => ({ type: 'way', role: k ? 'inner' : 'outer', geometry: ll(ring) })))
      if (members.length === 1) out.push({ type: 'way', id: id++, tags, geometry: members[0].geometry })
      else out.push({ type: 'relation', id: id++, tags, members })
    }
  }
  return { elements: out }
}

/** reads a dropped / picked file by its name: .osm (XML), .geojson / .json (GeoJSON or Overpass JSON) */
export function parseOsmFile(name: string, text: string): { elements: OsmEl[] } {
  const t = text.trimStart()
  if (/\.osm$/i.test(name) || t.startsWith('<')) return parseOsmXml(text)
  const j = JSON.parse(text) as { elements?: OsmEl[]; type?: string }
  if (Array.isArray(j.elements)) return { elements: j.elements }
  return parseGeoJson(j)
}

/** canonical tags understood by osmToMap for a rule; null = not for osmToMap (extras or ignored) */
function canonical(tags: Record<string, string>, r: ImportRule): Record<string, string> | null {
  const v = r.as ?? tags[r.key]
  switch (r.layer) {
    case 'road': return { ...tags, highway: v }
    case 'river': return { ...tags, waterway: ['river', 'stream', 'canal'].includes(v) ? v : 'stream' }
    case 'lake': return { ...tags, natural: 'water', water: tags.water === 'river' ? 'river' : 'lake' }
    case 'forest': return { leaf_type: tags.leaf_type ?? '', landuse: 'forest' }
    case 'field': return { landuse: 'farmland' }
    case 'building': return { building: 'yes' }
    case 'place': return { place: v, name: tags.name ?? '' }
    default: return null
  }
}

export interface ImportExtras {
  zones: { kind: 'residential' | 'industrial'; pts: number[] }[] // open rings, local metres
  power: { pts: number[]; voltage: number }[] // volts, 0 = unknown
  substations: { x: number; z: number }[]
}
export type ImportResult = OsmResult & { extras: ImportExtras; counts: Record<string, number> }

type Pt = [number, number]

/** whole local import: schema -> osmToMap (clip + projection) + extras, all clipped to [0, size]² */
export function importOsm(data: { elements: OsmEl[] }, schema: ImportSchema, toLocal: (lon: number, lat: number) => Pt, size: number, o: OsmOptions): ImportResult {
  const keep: OsmEl[] = [], extra: { el: OsmEl; layer: ImportLayer }[] = []
  const counts: Record<string, number> = {}
  for (const el of data.elements) {
    const r = ruleFor(el.tags ?? {}, schema)
    if (!r || r.layer === 'ignore') continue
    counts[r.layer] = (counts[r.layer] ?? 0) + 1
    const c = canonical(el.tags ?? {}, r)
    if (c) keep.push({ ...el, tags: c })
    else extra.push({ el, layer: r.layer })
  }
  const res = osmToMap({ elements: keep }, toLocal, size, o)
  const h = size / 2, bbox: [number, number, number, number] = [0, 0, size, size]
  const loc = (g: LL[]): Pt[] => g.map(({ lat, lon }) => { const [x, z] = toLocal(lon, lat); return [x + h, z + h] })
  const flat = (p: Pt[]) => p.flatMap(([x, z]) => [Math.round(x * 10) / 10, Math.round(z * 10) / 10])
  const ex: ImportExtras = { zones: [], power: [], substations: [] }
  for (const { el, layer } of extra) {
    const t = el.tags ?? {}
    const outer = el.geometry ? [loc(el.geometry)] : (el.members ?? []).filter((m) => m.role !== 'inner' && m.geometry).map((m) => loc(m.geometry!))
    if (layer === 'power') {
      const volt = Math.max(0, ...String(t.voltage ?? '').split(/[;,]/).map((v) => Number.parseFloat(v) || 0))
      for (const l of outer) {
        if (l.length < 2) continue
        const g = (turf.bboxClip(turf.lineString(l), bbox) as Feature<LineString | MultiLineString>).geometry
        for (const p of g.type === 'LineString' ? [g.coordinates] : g.coordinates) if (p.length >= 2) ex.power.push({ pts: flat(p as Pt[]), voltage: volt })
      }
    } else if (layer === 'substation') {
      const ps = el.type === 'node' ? [loc([{ lat: el.lat!, lon: el.lon! }])[0]] : outer.map((r) => { const n = r.length > 1 && r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1] ? r.length - 1 : r.length; let x = 0, z = 0; for (let k = 0; k < n; k++) { x += r[k][0]; z += r[k][1] } return [x / n, z / n] as Pt })
      for (const [x, z] of ps) if (x >= 0 && z >= 0 && x <= size && z <= size) ex.substations.push({ x: Math.round(x), z: Math.round(z) })
    } else if (layer === 'residential' || layer === 'industrial') {
      for (const r of outer) {
        if (r.length < 4) continue
        const ring = r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1] ? r : [...r, r[0]]
        let c: Feature<Polygon | MultiPolygon>
        try { c = turf.bboxClip(turf.polygon([ring]), bbox) as Feature<Polygon | MultiPolygon> } catch { continue }
        const g = c.geometry
        for (const p of g.type === 'Polygon' ? [g.coordinates] : g.coordinates) if (p[0] && p[0].length >= 4) ex.zones.push({ kind: layer, pts: flat((p[0] as Pt[]).slice(0, -1)) })
      }
    }
  }
  return { ...res, extras: ex, counts }
}

/** OSM voltage (V) -> our power class (power.ts) */
export function powerKindOf(volt: number): 'ehv' | 'hv' | 'mv' | 'lv' {
  if (volt >= 200000) return 'ehv'
  if (volt >= 45000) return 'hv'
  if (volt >= 1000 || volt === 0) return 'mv'
  return 'lv'
}

/** the schema as editable text, one rule per line */
export function schemaText(s: ImportSchema): string {
  return '{"rules": [\n' + s.rules.map((r) => '  ' + JSON.stringify(r)).join(',\n') + '\n]}'
}
