// mapgen.json — pivot format between the web modules and the Workbench plugin
// (docs/ARCHITECTURE.md). Field names must match MG_Project / MG_ProjectShape in
// addons/Mapgenerator/Scripts/WorkbenchGame/MapGen/MG_ApplyProjectPlugin.c.

export interface ProjectShape {
  id: string
  kind: 'polyline' | 'spline'
  closed: boolean
  /** world X/Z pairs, flat: [x0, z0, x1, z1, ...] */
  points: number[]
  /** "{GUID}path.et" — a bare path is resolved by the plugin, but keep the GUID */
  generator: string
  /** generator properties set after creation (same index): ["RoadWidth"], ["10"] */
  paramKeys?: string[]
  paramValues?: string[]
  /** metres above the terrain for each point (water level); absent = points on the terrain */
  lift?: number[]
  /** power line leaving a power plant: its first point is the grid source (Workbench side: SCR_PowerlineGeneratorPointData
   *  on point 0 with m_JunctionData.m_bPowerSource = true, POWERGRID_LOGIC.md) */
  powerSource?: boolean
  /** point indices where another line of the same kind branches off: Workbench side, m_JunctionData on that point
   *  (generator m_DefaultJunctionPole = PowerLine_01_pole_small_hook_junction for LV) */
  junctions?: number[]
  /** obstacle avoidance of an area generator (ForestGeneratorEntity / SCR_AreaGeneratorBaseEntity):
   *  expanded by withAvoid() into m_bAvoid* generator params before sending */
  avoid?: AvoidSpec
}

/** obstacles an area generator keeps clear of (m_bAvoid<Name> on the generator) */
export interface AvoidSpec { objects?: boolean; roads?: boolean; rivers?: boolean; powerLines?: boolean; tracks?: boolean; lakes?: boolean; regenerate?: boolean }
/** default for every zone placed on the ground: roads / tracks / rivers / lakes / power lines stay clear */
export const ZONE_AVOID: AvoidSpec = { objects: false, roads: true, rivers: true, powerLines: true, tracks: true, lakes: true, regenerate: true }
/** forests also avoid objects (buildings, props) */
export const FOREST_AVOID: AvoidSpec = { ...ZONE_AVOID, objects: true }
const AVOID_KEYS: [keyof AvoidSpec, string][] = [
  ['objects', 'm_bAvoidObjects'], ['roads', 'm_bAvoidRoads'], ['rivers', 'm_bAvoidRivers'], ['powerLines', 'm_bAvoidPowerLines'],
  ['tracks', 'm_bAvoidTracks'], ['lakes', 'm_bAvoidLakes'], ['regenerate', 'm_bRegenerateByObstacleChanges'],
]
/** avoid -> paramKeys/paramValues ("1"/"0"), set on the generator by MG_ShapeBuilder; explicit params win */
export const withAvoid = (sh: ProjectShape): ProjectShape => {
  if (!sh.avoid) return sh
  const keys = [...(sh.paramKeys ?? [])], values = [...(sh.paramValues ?? [])]
  for (const [k, name] of AVOID_KEYS) {
    const v = sh.avoid[k]
    if (v === undefined || keys.includes(name)) continue
    keys.push(name); values.push(v ? '1' : '0')
  }
  const { avoid: _a, ...rest } = sh
  return { ...rest, paramKeys: keys, paramValues: values }
}

/** single prefab on the terrain; prefab may be a bare path (resolved by the plugin) */
export interface ProjectEntity {
  id: string
  prefab: string
  x: number
  z: number
  yaw: number
  ycm?: number // absolute height in cm (bridges); absent = on the terrain
  /** essential (gameplay/cover) / pc (PC-only detail) / clutter (decoration); absent = roleOf() default (src/modules/roles.ts) */
  role?: 'essential' | 'pc' | 'clutter'
  /** Workbench layer "<type>_<ix>_<iz>" (src/modules/layers.ts withWbLayers); absent = the plugin's default layer */
  layer?: string
  /** degrees, tilt on the terrain slope for small props / fences (src/modules/slopeAlign.ts); absent = upright */
  pitch?: number
  roll?: number
}

export interface Project {
  version: 0
  shapes: ProjectShape[]
  entities?: ProjectEntity[]
  remove?: number[] // X/Z origins of objects already in the world to delete (taken over or removed in the map)
  ffBiome?: number // Freedom Fighters JWK_EWorldBiome flag set on JWK_WorldEntity.m_iBiome (src/ffbiome.ts)
}

export const GENERATORS = {
  forestPine: '{37C347EECE844530}Prefabs/WEGenerators/Forest/FG_Forest_Pine1.et',
  hedgeCorylus: '{B5B681ECEC350BC3}Prefabs/WEGenerators/PG_Vegetation_CorylusBushline.et',
  lake: '{1F2254A7C9C8AA57}Prefabs/WEGenerators/Water/Lake/LG_Lake_01.et',
} as const
