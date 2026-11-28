// OpenStreetMap tags -> tool layers, as data. One rule = which OSM elements it takes (tags, element
// types), which layer they become and with what parameters. The same table builds the Overpass query
// and classifies the answer, so adding or tuning a mapping is a one-line change here.
// Rules are tried in order (first match wins), like a priority list.

import type { RoadType } from '../modules/roads'
import type { SiteKind } from '../modules/network'

/** OSM element types a rule queries */
export type OsmElement = 'node' | 'way' | 'relation'
/** checkbox of the import dialog (OsmOptions key) that switches the rule on */
export type OsmGroup = 'mainRoads' | 'minorRoads' | 'tracks' | 'paths' | 'water' | 'forests' | 'fields' | 'places' | 'buildings'
export type OsmLayer = 'road' | 'river' | 'lake' | 'forest' | 'field' | 'building' | 'site'
/** tag value: one value, any of a list, or `true` = tag present with any value */
export type TagMatch = string | string[] | true

export interface OsmRule {
  name: string
  layer: OsmLayer
  group: OsmGroup
  elements: OsmElement[]
  /** all must match */
  tags: Record<string, TagMatch>
  /** none may match (classification only, not sent to Overpass) */
  not?: Record<string, TagMatch>
  /** road: vanilla road generator; river: default width (m); site: village kind;
   *  areas: smallest kept area (m²) and simplification tolerance (m) */
  params?: { roadType?: RoadType; width?: number; site?: SiteKind; minArea?: number; tolerance?: number }
}

const road = (name: string, group: OsmGroup, roadType: RoadType, values: string[]): OsmRule =>
  ({ name, layer: 'road', group, elements: ['way'], tags: { highway: values }, params: { roadType } })

export const OSM_RULES: OsmRule[] = [
  { name: 'Places', layer: 'site', group: 'places', elements: ['node'], tags: { place: ['city', 'town'] }, params: { site: 'town' } },
  { name: 'Villages', layer: 'site', group: 'places', elements: ['node'], tags: { place: 'village' }, params: { site: 'village' } },
  { name: 'Hamlets', layer: 'site', group: 'places', elements: ['node'], tags: { place: 'hamlet' }, params: { site: 'hamlet' } },

  road('Main roads (lined)', 'mainRoads', 'asphaltLine', ['motorway', 'trunk', 'primary']),
  road('Main roads', 'mainRoads', 'asphalt', ['secondary', 'tertiary', 'motorway_link', 'trunk_link', 'primary_link', 'secondary_link']),
  road('Minor roads', 'minorRoads', 'asphaltNarrow', ['unclassified', 'residential', 'living_street', 'service', 'tertiary_link']),
  road('Tracks', 'tracks', 'dirt', ['track']),
  road('Paths', 'paths', 'trailDirt', ['path', 'footway', 'bridleway']),
  road('Cycleways', 'paths', 'trailGravel', ['cycleway']),

  { name: 'Rivers', layer: 'river', group: 'water', elements: ['way'], tags: { waterway: 'river' }, params: { width: 14 } },
  { name: 'Canals', layer: 'river', group: 'water', elements: ['way'], tags: { waterway: 'canal' }, params: { width: 8 } },
  { name: 'Streams', layer: 'river', group: 'water', elements: ['way'], tags: { waterway: 'stream' }, params: { width: 3 } },
  { name: 'Lakes', layer: 'lake', group: 'water', elements: ['way', 'relation'], tags: { natural: 'water' }, not: { water: 'river' }, params: { minArea: 400, tolerance: 3 } },

  // minArea of forests comes from the import dialog (OsmOptions.minForest)
  { name: 'Forest (landuse)', layer: 'forest', group: 'forests', elements: ['way', 'relation'], tags: { landuse: 'forest' }, params: { tolerance: 6 } },
  { name: 'Wood (natural)', layer: 'forest', group: 'forests', elements: ['way', 'relation'], tags: { natural: 'wood' }, params: { tolerance: 6 } },

  { name: 'Buildings', layer: 'building', group: 'buildings', elements: ['way'], tags: { building: true } },
  { name: 'Fields', layer: 'field', group: 'fields', elements: ['way'], tags: { landuse: ['farmland', 'meadow', 'orchard', 'vineyard', 'grass'] }, params: { minArea: 5000, tolerance: 5 } },
]

const matches = (t: Record<string, string>, m: Record<string, TagMatch>) =>
  Object.entries(m).every(([k, v]) => t[k] !== undefined && (v === true || (Array.isArray(v) ? v.includes(t[k]) : t[k] === v)))

/** first rule of `rules` taking this element (enabled groups only), or undefined */
export function classify(type: OsmElement, tags: Record<string, string>, enabled: (g: OsmGroup) => boolean, rules = OSM_RULES): OsmRule | undefined {
  return rules.find((r) => r.elements.includes(type) && enabled(r.group) && matches(tags, r.tags) && !(r.not && matches(tags, r.not)))
}

const esc = (s: string) => s.replace(/[\\"]/g, '\\$&')
const reEsc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Overpass union statements for the enabled rules; single-tag rules on the same element/key are merged into one regex */
export function overpassStatements(bb: string, enabled: (g: OsmGroup) => boolean, rules = OSM_RULES): string[] {
  const merged = new Map<string, Set<string>>() // `${el}|${key}` -> values
  const any = new Set<string>() // `${el}|${key}` with any value
  const q: string[] = []
  for (const r of rules) {
    if (!enabled(r.group)) continue
    const keys = Object.keys(r.tags)
    for (const el of r.elements) {
      if (keys.length === 1) {
        const k = keys[0], v = r.tags[k], id = `${el}|${k}`
        if (v === true) { any.add(id); continue }
        const set = merged.get(id) ?? new Set<string>()
        for (const x of Array.isArray(v) ? v : [v]) set.add(x)
        merged.set(id, set)
      } else {
        const f = keys.map((k) => { const v = r.tags[k]; return v === true ? `["${esc(k)}"]` : Array.isArray(v) ? `["${esc(k)}"~"^(${v.map(reEsc).join('|')})$"]` : `["${esc(k)}"="${esc(v)}"]` }).join('')
        q.push(`${el}${f}${bb};`)
      }
    }
  }
  for (const id of any) { const [el, k] = id.split('|'); q.push(`${el}["${esc(k)}"]${bb};`); merged.delete(id) }
  for (const [id, set] of merged) {
    const [el, k] = id.split('|')
    const vs = [...set]
    q.push(vs.length === 1 ? `${el}["${esc(k)}"="${esc(vs[0])}"]${bb};` : `${el}["${esc(k)}"~"^(${vs.map(reEsc).join('|')})$"]${bb};`)
  }
  return q
}
