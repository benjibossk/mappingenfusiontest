// Opt-in "climate ground classes" mask export (groundClasses.ts, idea from giorbev MapGeneratorPro V8.4, MIT,
// see NOTICE). Replaces the generator's ground surfaces of a /masks body by one surface per texture layer;
// roads / yards / water stamps are kept. The per-block budget stays in src/shared/maskPaint.mjs (bridge).
import {
  BIOME_CLASSES, type BiomeSettings, type ClimateBiome, type Derivatives, type MaskLayer, type TextureAssignment,
  classifyGround, computeDerivatives, importReadme, mergeByTexture, proposeTextures,
} from './groundClasses.ts'

export interface GroundGrid { minX: number; minZ: number; step: number; cols: number; rows: number }
interface Body { surfaces: { name: string; weights: number[] }[]; colours: Record<string, [number, number, number]>; roads: { core: string; side?: string }[] }

/** texture names the project has for this body: surfaces, coloured names, road cores. */
export function projectTextureNames(body: Body): string[] {
  const s = new Set<string>()
  for (const x of body.surfaces) s.add(x.name)
  for (const k of Object.keys(body.colours)) s.add(k)
  for (const r of body.roads) { s.add(r.core); if (r.side) s.add(r.side) }
  return [...s]
}

const derivCache = new WeakMap<ArrayLike<number>, Derivatives>()
export function derivativesFor(grid: GroundGrid, heights: ArrayLike<number>): Derivatives {
  let d = derivCache.get(heights)
  if (!d || d.cols !== grid.cols || d.rows !== grid.rows || d.step !== grid.step) {
    d = computeDerivatives(heights, grid.cols, grid.rows, grid.step, 0)
    if (typeof heights === 'object') derivCache.set(heights, d)
  }
  return d
}

export interface GroundPlan { assign: TextureAssignment[]; layers: MaskLayer[]; layerGrid: Uint8Array }

export function groundPlan(biome: ClimateBiome, d: Derivatives, settings: BiomeSettings, textures: readonly string[], overrides: Record<string, string | null> = {}): GroundPlan {
  const cls = classifyGround(biome, d, settings)
  const assign = proposeTextures(biome, textures, overrides)
  return { assign, ...mergeByTexture(biome, cls, assign) }
}

const MISSING_COLOUR: [number, number, number] = [220, 40, 40]
/** surface name of a layer: its texture, or manquant_<classes> (paintMasks names must match [\w-]+). */
export const layerSurfaceName = (biome: ClimateBiome, l: MaskLayer) =>
  l.texture ?? 'manquant_' + l.classIndices.map((k) => BIOME_CLASSES[biome][k].id).join('_')

/** body with the ground replaced by the biome layers + `fileNames` (surface -> import-ordered file) + `readme`. */
export function groundBiomeBody<T extends Body>(body: T, grid: GroundGrid, heights: ArrayLike<number>, biome: ClimateBiome, settings: BiomeSettings,
  overrides: Record<string, string | null> = {}): T & { fileNames: Record<string, string>; readme: string } {
  const d = derivativesFor(grid, heights)
  const { layers, layerGrid } = groundPlan(biome, d, settings, projectTextureNames(body), overrides)
  const colours = { ...body.colours }, fileNames: Record<string, string> = {}
  const surfaces = layers.map((l, k) => {
    const name = layerSurfaceName(biome, l)
    const weights = new Array<number>(layerGrid.length)
    for (let i = 0; i < layerGrid.length; i++) weights[i] = layerGrid[i] === k ? 1 : 0
    if (!colours[name]) colours[name] = l.texture ? [128, 128, 128] : MISSING_COLOUR
    fileNames[name] = l.file.replace(/\.png$/, '')
    return { ...grid, name, weights }
  })
  return { ...body, surfaces, colours, fileNames, readme: importReadme(biome, layers) }
}
