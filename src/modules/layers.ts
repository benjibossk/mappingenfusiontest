/** Per-layer seeds and "stale" propagation along the layer dependency graph (pure, no DOM). */
import { subSeed } from './worldgen'

export type LayerId = 'relief' | 'water' | 'roads' | 'settlements' | 'fields' | 'forests' | 'power'
export const LAYERS: LayerId[] = ['relief', 'water', 'roads', 'settlements', 'fields', 'forests', 'power']

/** upstream layers each layer is built from */
export const DEPENDS: Record<LayerId, LayerId[]> = {
  relief: [],
  water: ['relief'],
  roads: ['relief', 'water', 'settlements'],
  settlements: ['relief', 'water'],
  fields: ['relief', 'water', 'roads', 'settlements'],
  forests: ['relief', 'water', 'roads', 'settlements', 'fields'],
  power: ['roads', 'settlements'],
}

export interface LayerState { seed?: number; paramsHash?: string; stale?: boolean }
/** stored in the project / autosave: overrides are optional, absent = derived from the global seed */
export type LayerMap = Partial<Record<LayerId, LayerState>>

/** effective seed of a layer: its override, else derived from the global seed */
export function layerSeed(global: number, map: LayerMap, id: LayerId): number {
  const s = map[id]?.seed
  return typeof s === 'number' && s > 0 ? Math.floor(s) : subSeed(global, 'layer-' + id)
}

/** every layer that depends (directly or not) on `id`, in LAYERS order */
export function downstream(id: LayerId): LayerId[] {
  const out = new Set<LayerId>()
  let grew = true
  while (grew) {
    grew = false
    for (const l of LAYERS) if (!out.has(l) && DEPENDS[l].some((d) => d === id || out.has(d))) { out.add(l); grew = true }
  }
  return LAYERS.filter((l) => out.has(l))
}

const markDown = (map: LayerMap, id: LayerId): LayerMap => {
  const next: LayerMap = { ...map }
  for (const d of downstream(id)) next[d] = { ...next[d], stale: true }
  return next
}

/** set (or clear with undefined) a layer seed override; dependants become stale and so does the layer itself */
export function setLayerSeed(map: LayerMap, id: LayerId, seed: number | undefined): LayerMap {
  if (map[id]?.seed === seed) return map
  const next = markDown(map, id)
  next[id] = { ...next[id], seed, stale: true }
  return next
}

/** record the params of a layer; a change marks it and its dependants stale */
export function setLayerParams(map: LayerMap, id: LayerId, paramsHash: string): LayerMap {
  if (map[id]?.paramsHash === paramsHash) return map
  const next = markDown(map, id)
  next[id] = { ...next[id], paramsHash, stale: true }
  return next
}

/** the global seed changed: every layer without an override is stale */
export function setGlobalSeed(map: LayerMap): LayerMap {
  let next: LayerMap = { ...map }
  for (const l of LAYERS) if (next[l]?.seed === undefined) next = markDown({ ...next, [l]: { ...next[l], stale: true } }, l)
  return next
}

/** a layer was rebuilt: clear its flag (dependants stay stale until rebuilt) */
export function markBuilt(map: LayerMap, id: LayerId): LayerMap {
  return { ...map, [id]: { ...map[id], stale: false } }
}

export const staleLayers = (map: LayerMap): LayerId[] => LAYERS.filter((l) => map[l]?.stale)
