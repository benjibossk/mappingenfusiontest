// Biome -> surfaces at export (docs/BIOMES_LIBRARY.md §5.2). The generators paint with the
// vanilla Everon surface names; on export each name is mapped to its role, then to the chosen
// biome's surface (surfaceOf / b.road). temperate_everon = unchanged.
import { BIOMES, biome, surfaceOf, type Biome, type BiomeId, type SurfaceRole } from '../data/biomes'
import { SURFACES } from '../data/biomesSurfaces'

export const DEFAULT_BIOME: BiomeId = 'temperate_everon'
export const isBiome = (v: unknown): v is BiomeId => typeof v === 'string' && BIOMES.some((b) => b.id === v)

type Role = SurfaceRole | 'road.paved' | 'road.dirt' | 'road.village'
/** surface names written by the generators (island.ts, roads.ts, water.ts, satmask.ts) -> role */
const ROLE: Record<string, Role> = {
  Grass_01: 'grass', Grass_02: 'meadow', MountainGrass_01: 'meadow', Grass_03_coastal: 'beach', BeachGrass_01: 'beach',
  SeaBed_01: 'seabed', Rock_01: 'rock', Debris_Rock_01: 'scree', Pebbles_01: 'scree', Pebbles_02: 'scree',
  ForestDeciduous_01_Base: 'forest', ForestConiferous_01_Base: 'forestConifer', ForestPine_01_Base: 'forestConifer',
  Crop_Field_01: 'field', Heather_01: 'heath', Concrete_01: 'town', Dirt_01: 'dirt',
  Asphalt_01: 'road.paved', Dirt_02: 'road.dirt', Dirt_03: 'road.dirt', Cobblestone_01_Wave: 'road.village',
}

/** surface name of `name` in biome `b` (unknown names kept) */
export function biomeSurfaceName(b: Biome, name: string): string {
  if (b.id === DEFAULT_BIOME) return name
  const r = ROLE[name]
  if (!r) return name
  const n = r.startsWith('road.') ? b.road[r.slice(5) as 'paved' | 'dirt' | 'village'] : b.surfaces[r as SurfaceRole]
  return n && SURFACES[n] ? n : name
}
/** "{GUID}path.emat" of a role in the chosen biome */
export const biomeEmat = (id: BiomeId, role: SurfaceRole) => surfaceOf(biome(id) ?? biome(DEFAULT_BIOME)!, role)

interface Grid { name: string; weights: number[] }
interface MaskBody { surfaces: Grid[]; colours: Record<string, [number, number, number]>; roads: { core: string; side?: string }[] }
/** remaps a writeMasks body to the biome: surfaces merged by target name (weights summed, capped at 1) */
export function applyBiome<T extends MaskBody>(body: T, id: BiomeId): T {
  const b = biome(id)
  if (!b || id === DEFAULT_BIOME) return body
  const out = new Map<string, Grid>()
  for (const s of body.surfaces) {
    const n = biomeSurfaceName(b, s.name)
    const o = out.get(n)
    if (!o) { out.set(n, { ...s, name: n, weights: [...s.weights] }); continue }
    for (let i = 0; i < o.weights.length; i++) o.weights[i] = Math.min(1, o.weights[i] + (s.weights[i] ?? 0))
  }
  const colours = { ...body.colours }
  for (const [k, c] of Object.entries(body.colours)) { const n = biomeSurfaceName(b, k); if (!colours[n]) colours[n] = c }
  return { ...body, surfaces: [...out.values()], colours, roads: body.roads.map((r) => ({ ...r, core: biomeSurfaceName(b, r.core), ...(r.side ? { side: biomeSurfaceName(b, r.side) } : {}) })) }
}
