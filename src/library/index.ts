// Asset library: merge packs, search (text + tags + biome + kind), import / export. Pure.

import { assetBiome, biome } from '../data/biomes.ts'
import { validatePack, type Asset, type AssetKind, type AssetPack } from './schema.ts'
import { VANILLA_PACK } from './seed.ts'

export * from './schema.ts'
export { VANILLA_PACK }

export interface Library { assets: Asset[]; packs: { id: string; name: string; author: string; count: number }[]; conflicts: string[] }
export interface Query { text?: string; tags?: string[]; biome?: string; kind?: AssetKind | AssetKind[]; source?: string; fallback?: boolean }

/** merge packs in order (first pack wins on a duplicate guid; the duplicate is reported) */
export function buildLibrary(packs: AssetPack[]): Library {
  const by = new Map<string, Asset>()
  const lib: Library = { assets: [], packs: [], conflicts: [] }
  for (const p of packs) {
    let n = 0
    for (const a of p.assets) {
      if (by.has(a.guid)) { lib.conflicts.push(`${a.guid} (${p.id})`); continue }
      by.set(a.guid, a); n++
    }
    lib.packs.push({ id: p.id, name: p.name, author: p.author, count: n })
  }
  lib.assets = [...by.values()]
  return lib
}
export const defaultLibrary = (extra: AssetPack[] = []) => buildLibrary([VANILLA_PACK, ...extra])

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

/** biome ids an asset query should accept: the biome, plus its fallback chain when `fallback` */
export function biomeChain(id: string, fallback: boolean): string[] {
  const b = biome(id)
  if (!b || !fallback) return [id]
  const out = [id]
  const fb = assetBiome(b)
  if (fb.id !== id) out.push(fb.id)
  return out
}

/** filter + rank. Text matches name, path and tags (all words must match, accent-insensitive). */
export function search(lib: Library, q: Query): Asset[] {
  const words = q.text ? norm(q.text).split(/\s+/).filter(Boolean) : []
  const kinds = q.kind ? (Array.isArray(q.kind) ? q.kind : [q.kind]) : null
  const tags = (q.tags ?? []).map(norm)
  const biomes = q.biome ? biomeChain(q.biome, q.fallback ?? false) : null
  const scored: { a: Asset; s: number }[] = []
  for (const a of lib.assets) {
    if (kinds && !kinds.includes(a.kind)) continue
    if (q.source && a.source !== q.source) continue
    const atags = a.tags.map(norm)
    if (!tags.every((t) => atags.includes(t))) continue
    let s = 0
    if (biomes) {
      const i = biomes.findIndex((b) => a.biomes.includes(b))
      if (i < 0) continue
      s += i === 0 ? 10 : 2
    }
    if (words.length) {
      const hay = norm(`${a.name ?? ''} ${a.guid} ${a.tags.join(' ')} ${a.kind}`)
      if (!words.every((w) => hay.includes(w))) continue
      s += words.reduce((n, w) => n + (norm(a.name ?? '').includes(w) ? 3 : 1) + (atags.includes(w) ? 2 : 0), 0)
    }
    scored.push({ a, s })
  }
  return scored.sort((x, y) => y.s - x.s || (x.a.name ?? '').localeCompare(y.a.name ?? '')).map((x) => x.a)
}

/** all tags with counts (for the filter chips) */
export function tagCounts(assets: Asset[]): [string, number][] {
  const m = new Map<string, number>()
  for (const a of assets) for (const t of a.tags) m.set(t, (m.get(t) ?? 0) + 1)
  return [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
}

/** parse a pack file; throws with every validation problem */
export function importPack(json: string): AssetPack {
  let p: unknown
  try { p = JSON.parse(json) } catch (e) { throw new Error(`invalid JSON: ${(e as Error).message}`) }
  const errs = validatePack(p)
  if (errs.length) throw new Error(errs.slice(0, 20).join('\n') + (errs.length > 20 ? `\n… +${errs.length - 20}` : ''))
  return p as AssetPack
}

/** pack file content for a set of assets (same source); sorted for stable diffs in PRs */
export function exportPack(meta: Omit<AssetPack, 'format' | 'version' | 'assets'>, assets: Asset[]): string {
  const pack: AssetPack = { format: 'reforger-mapper.assetpack', version: 1, ...meta, assets: [...assets].sort((a, b) => a.guid.localeCompare(b.guid)) }
  const errs = validatePack(pack)
  if (errs.length) throw new Error(errs.join('\n'))
  return JSON.stringify(pack, null, 2) + '\n'
}
