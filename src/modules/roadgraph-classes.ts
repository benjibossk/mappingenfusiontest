// Road network V2, stage 4: road classes mapped to the real Reforger road generator prefabs (RG_*).
// The generator GUIDs are the ones of ROAD_TYPES (roads.ts), checked against the base-game index
// (scratchpad check_prefabs.sh). Grades: `design` = what the vertical profile aims at (roadgeom.ts),
// `limit` = what the checker accepts = maxGrade(type) of network.ts (kept identical, no behaviour change).
import { ROAD_TYPES, type RoadType } from './roads'

export type RoadClass = 'main' | 'secondary' | 'local' | 'street' | 'track' | 'trail'

export interface RoadClassSpec {
  type: RoadType // default road generator style
  alt: RoadType[] // other styles of the same class
  width: number // RoadWidth sent to the generator (m)
  design: number // design max grade (rise / run) for the vertical profile
  rMin: number // min horizontal radius (m) for the fillets
  kCrest: number // vertical curve length per % of grade change (m / %)
  rank: number // priority at junctions (higher passes through)
}

export const ROAD_CLASSES: Record<RoadClass, RoadClassSpec> = {
  main: { type: 'asphaltLine', alt: ['concrete'], width: 8, design: 0.08, rMin: 60, kCrest: 15, rank: 5 },
  secondary: { type: 'asphalt', alt: ['asphalt2', 'asphalt3'], width: 8, design: 0.1, rMin: 40, kCrest: 12, rank: 4 },
  local: { type: 'asphaltNarrow', alt: ['concretePanel'], width: 6, design: 0.12, rMin: 25, kCrest: 10, rank: 3 },
  street: { type: 'cobble', alt: ['cobbleRough'], width: 6, design: 0.12, rMin: 10, kCrest: 6, rank: 2 },
  track: { type: 'dirt', alt: ['dirt2', 'forest'], width: 4, design: 0.15, rMin: 15, kCrest: 6, rank: 1 },
  trail: { type: 'trailDirt', alt: ['trailGravel', 'trailForest'], width: 2, design: 0.25, rMin: 5, kCrest: 3, rank: 0 },
}

const BY_TYPE: Record<RoadType, RoadClass> = {
  asphaltLine: 'main', asphalt: 'secondary', asphalt2: 'secondary', asphalt3: 'secondary', concrete: 'main',
  asphaltNarrow: 'local', concretePanel: 'local', cobble: 'street', cobbleRough: 'street',
  dirt: 'track', dirt2: 'track', forest: 'track', trailDirt: 'trail', trailGravel: 'trail', trailForest: 'trail',
}

//! class of a road style
export const classOf = (t: RoadType): RoadClass => BY_TYPE[t]
//! road generator prefab of a class (or of an explicit style)
export const generatorOf = (c: RoadClass, t?: RoadType) => ROAD_TYPES[t ?? ROAD_CLASSES[c].type].generator
//! min radius for a road style
export const rMinOf = (t: RoadType) => ROAD_CLASSES[classOf(t)].rMin
