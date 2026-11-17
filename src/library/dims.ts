// Real prefab dimensions, read from the .xob mesh header bounding boxes of the game paks (catalogue
// field `d` = [w, dz, h, cx, cz] in metres: width along X, depth along Z, total height, centre offset).
// Cross-checked against the Workbench measure (profile/MapGen/prefabs.txt): 726/727 identical.
import CATALOGUE from '../../library/prefabs-catalogue.json' with { type: 'json' }
import type { Footprint } from './schema.ts'

export interface PrefabDims { w: number; dz: number; h: number; cx: number; cz: number }

type Row = { p: string; g?: string; d?: number[] }
let byKey: Map<string, PrefabDims> | null = null

function index(): Map<string, PrefabDims> {
  if (byKey) return byKey
  byKey = new Map()
  for (const r of (CATALOGUE as { prefabs: Row[] }).prefabs) {
    if (!r.d || r.d.length < 5) continue
    const [w, dz, h, cx, cz] = r.d
    const v = { w, dz, h, cx, cz }
    byKey.set(r.p.toLowerCase(), v)
    if (r.g) byKey.set(r.g.toUpperCase(), v)
  }
  return byKey
}

/** dims of a prefab given "{GUID}Prefabs/x.et", a bare GUID, "Prefabs/x.et" or "x.et" (path under Prefabs/); null if unknown */
export function prefabDims(guidOrPath: string): PrefabDims | null {
  const m = index()
  const s = guidOrPath.trim()
  const g = s.match(/^\{?([0-9A-Fa-f]{16})\}?/)
  if (g) { const v = m.get(g[1].toUpperCase()); if (v) return v }
  const p = s.replace(/^\{[0-9A-Fa-f]{16}\}/, '').replace(/^Prefabs\//i, '').toLowerCase()
  return p ? m.get(p) ?? null : null
}

/** footprint from the real dims (measured), or `fallback` when the prefab is unknown */
export function dimsFootprint(guidOrPath: string, fallback: Footprint): Footprint {
  const d = prefabDims(guidOrPath)
  if (!d || !(d.w > 0 && d.dz > 0 && d.h > 0)) return fallback
  return { minX: d.cx - d.w / 2, maxX: d.cx + d.w / 2, minZ: d.cz - d.dz / 2, maxZ: d.cz + d.dz / 2, h: d.h, measured: true }
}
/** half sizes (hw along X, hd along Z) + height from the real dims, `fallback` half sizes when unknown */
export function halfDims(guidOrPath: string, hw: number, hd: number, h = 0): { hw: number; hd: number; h: number; measured: boolean } {
  const d = prefabDims(guidOrPath)
  if (!d || !(d.w > 0 && d.dz > 0)) return { hw, hd, h, measured: false }
  return { hw: Math.round(d.w * 50) / 100, hd: Math.round(d.dz * 50) / 100, h: d.h, measured: true }
}
