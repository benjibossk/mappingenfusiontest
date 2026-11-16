// Road width and structure detection from OpenStreetMap tags.
// Ported from ARTE (01_engineer.py:189-261, 432-440), MIT licence, Copyright (c) 2026 Icebird.
// See CREDITS.md.

export type OsmTags = Record<string, string | undefined>

const num = (s: string | undefined) => {
  const m = /[0-9]+(?:[.,][0-9]+)?/.exec(s ?? '')
  return m ? Number.parseFloat(m[0].replace(',', '.')) : NaN
}

//! surface of a way: its own tag, otherwise a default by class (track: by tracktype)
export function osmSurface(t: OsmTags): string {
  if (t.surface) return t.surface
  const h = (t.highway ?? '').replace(/_link$/, '')
  if (/^(motorway|trunk|primary|secondary|tertiary|residential)$/.test(h)) return 'asphalt'
  if (/^(unclassified|service|living_street)$/.test(h)) return 'paved'
  if (h === 'track') return t.tracktype === 'grade1' ? 'paved' : t.tracktype === 'grade2' || t.tracktype === 'grade3' ? 'gravel' : 'dirt'
  return 'unpaved'
}

//! road / rail width in metres: `width` tag, else lanes x lane width, else a table by class
export function osmWidth(t: OsmTags): number {
  const w = num(t.width)
  if (w > 0) return w
  const h = (t.highway ?? '').replace(/_link$/, '')
  const lanes = num(t.lanes)
  if (h && lanes > 0) return lanes * (/^(motorway|trunk|primary)$/.test(h) ? 3.65 : 3.15)
  if (t.railway) return num(t.tracks) >= 2 || t.usage === 'main' || t.usage === 'trunk' ? 8 : 4.5
  switch (h) {
    case 'motorway': return 14.5
    case 'trunk': return 11.5
    case 'primary': return 9.5
    case 'secondary': return 7.5
    case 'tertiary': return 6.5
    case 'residential': case 'unclassified': return 5.5
    case 'service': case 'living_street': return 4
    case 'track': {
      const s = osmSurface(t)
      return /^(asphalt|paved|concrete)/.test(s) ? 4.5 : s === 'gravel' ? 3.5 : 3
    }
  }
  return 2.5
}

//! bridge / tunnel (any value but "no": viaduct, culvert, building_passage...): never flatten or carve
export function isStructure(t: OsmTags): boolean {
  const on = (v: string | undefined) => !!v && v !== 'no'
  return on(t.bridge) || on(t.tunnel)
}
