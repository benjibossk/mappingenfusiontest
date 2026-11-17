// Biome -> vegetation and 3D tints (docs/BIOMES_LIBRARY.md §5.3 / §5.5). Pure helpers.
// Everything is expressed RELATIVE to temperate_everon, and temperate_everon returns the neutral value
// (no shift, ×1, undefined tint): an Everon project generates and renders exactly as before.
import { biome, type Biome, type BiomeId } from '../data/biomes.ts'

export const EVERON: BiomeId = 'temperate_everon'
type Leaf = 'broad' | 'needle' | 'mixed'
type Tall = 'low' | 'mid' | 'high'
export type RGB = [number, number, number]

const CONIFER = /pinus|picea|abies|larix|juniperus|taxus/i
/** weighted share of conifers among the biome's forest trees (0..1) */
export function coniferShare(b: Biome): number {
  const tot = b.vegetation.trees.reduce((n, t) => n + t.w, 0)
  return tot ? b.vegetation.trees.reduce((n, t) => n + (CONIFER.test(t.p) ? t.w : 0), 0) / tot : 0
}
const get = (id?: string) => (id && id !== EVERON ? biome(id) : undefined)
const EV = () => biome(EVERON)!

/** relative altitude (0..1 of the highest point) above which no forest grows; Everon 0.9 */
export const TREE_LINE = 0.9
/** sparser biomes (drier / harsher) stop the woods lower down: 0.78 .. 0.9 */
export function treeLineOf(densityRatio: number): number {
  return 0.78 + 0.12 * Math.min(1, Math.max(0, densityRatio))
}
/** forest generation knobs: cover multiplier (tree density vs Everon) and the shift of the leaf thresholds */
export function forestTuning(id?: string): { coverMul: number; needleShift: number; treeLine: number } {
  const b = get(id)
  if (!b) return { coverMul: 1, needleShift: 0, treeLine: TREE_LINE }
  const ev = EV()
  return {
    coverMul: Math.min(1.4, b.vegetation.treesPerHa / ev.vegetation.treesPerHa),
    needleShift: (coniferShare(b) - coniferShare(ev)) * 0.5,
    treeLine: treeLineOf(b.vegetation.treesPerHa / ev.vegetation.treesPerHa),
  }
}
/** leaf type of a generated forest from its mean relative altitude (Everon: > 0.55 needle, < 0.25 broad) */
export function leafOf(meanAlt: number, needleShift = 0): Leaf {
  return meanAlt > 0.55 - needleShift ? 'needle' : meanAlt < 0.25 - needleShift ? 'broad' : 'mixed'
}
/** share of conifers drawn in a "mixed" forest in the 3D view (Everon 0.4) */
export function mixedNeedle(id?: string): number {
  const b = get(id)
  return b ? Math.min(0.9, Math.max(0.1, 0.4 + (coniferShare(b) - coniferShare(EV())))) : 0.4
}

// vanilla forest generators (same set as main.ts FOREST_GEN) re-assigned per biome: Reforger has no
// palm / olive / snowy forest, so the drier and colder biomes lean on the pine / spruce generators
const FG = 'Prefabs/WEGenerators/Forest/'
const PINE1 = '{37C347EECE844530}Prefabs/WEGenerators/Forest/FG_Forest_Pine1.et'
const NORDIC: Record<Leaf, Record<Tall, string>> = {
  needle: { low: FG + 'FG_Forest_NurseryPicea.et', mid: FG + 'FG_Forest_PineSpruce1.et', high: FG + 'FG_Forest_PineSpruce1.et' },
  broad: { low: FG + 'FG_Forest_Birch.et', mid: FG + 'FG_Forest_Birch.et', high: FG + 'FG_Forest_MixedBirchPine.et' },
  mixed: { low: FG + 'FG_Forest_NurseryPicea.et', mid: FG + 'FG_Forest_MixedBirchPine.et', high: FG + 'FG_Forest_PineSpruce1.et' },
}
const PINE: Record<Tall, string> = { low: FG + 'FG_Forest_NurseryPine.et', mid: PINE1, high: FG + 'FG_Forest_Pine3.et' }
const DRY: Record<Leaf, Record<Tall, string>> = { needle: PINE, mixed: PINE, broad: { ...PINE, low: FG + 'FG_Forest_NurseryPine.et' } }
const SPRUCE: Record<Tall, string> = { low: FG + 'FG_Forest_NurseryPicea.et', mid: FG + 'FG_Forest_PineSpruce1.et', high: FG + 'FG_Forest_PineSpruce1.et' }
const WINTER: Record<Leaf, Record<Tall, string>> = { needle: SPRUCE, mixed: SPRUCE, broad: NORDIC.broad }
const FOREST_BY_BIOME: Partial<Record<BiomeId, Record<Leaf, Record<Tall, string>>>> = {
  nordic_kolguyev: NORDIC, winter_tundra: WINTER, mediterranean_dry: DRY, desert: DRY,
}
/** forest generator prefab of a biome, or undefined = the default (Everon) table */
export const forestGeneratorFor = (id: string | undefined, leaf: Leaf, tall: Tall): string | undefined =>
  FOREST_BY_BIOME[id as BiomeId]?.[leaf][tall]

// --- 3D tints: ratio of the biome's drape colour to Everon's, per channel ---
const hex = (s: string): RGB => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)]
const ratio = (a: string, b: string): RGB => { const x = hex(a), y = hex(b); return [x[0] / y[0], x[1] / y[1], x[2] / y[2]] }
type Group = 'ground' | 'forest' | 'field' | 'rock' | 'sand'
/** drape colours of the biome (`to`) and of Everon (`ref`) per palette group: the realistic drape moves its
 * Everon palette towards `to` (hue of the biome, brightness variety of the palette kept) */
export interface DrapeTint { to: Record<Group, RGB>; ref: Record<Group, RGB> }
const GROUPS: Group[] = ['ground', 'forest', 'field', 'rock', 'sand']
/** undefined for Everon = untouched palette */
export function drapeTint(id?: string): DrapeTint | undefined {
  const b = get(id)
  if (!b) return undefined
  const e = EV().drape
  return { to: Object.fromEntries(GROUPS.map((g) => [g, hex(b.drape[g])])) as Record<Group, RGB>, ref: Object.fromEntries(GROUPS.map((g) => [g, hex(e[g])])) as Record<Group, RGB> }
}
/** multipliers for the 3D tree crowns (needle / broad / bush), undefined for Everon */
export function treeTint(id?: string): { needle: RGB; broad: RGB; bush: RGB } | undefined {
  const b = get(id)
  if (!b) return undefined
  const e = EV().drape, t = { forest: ratio(b.drape.forest, e.forest), ground: ratio(b.drape.ground, e.ground) }
  // crowns follow the forest colour; bushes sit between the forest and the ground tints
  const bush: RGB = [(t.forest[0] + t.ground[0]) / 2, (t.forest[1] + t.ground[1]) / 2, (t.forest[2] + t.ground[2]) / 2]
  return { needle: t.forest, broad: t.forest, bush }
}
