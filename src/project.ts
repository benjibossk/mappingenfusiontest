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
}

/** single prefab on the terrain; prefab may be a bare path (resolved by the plugin) */
export interface ProjectEntity {
  id: string
  prefab: string
  x: number
  z: number
  yaw: number
  ycm?: number // absolute height in cm (bridges); absent = on the terrain
}

export interface Project {
  version: 0
  shapes: ProjectShape[]
  entities?: ProjectEntity[]
  remove?: number[] // X/Z origins of objects already in the world to delete (taken over or removed in the map)
}

export const GENERATORS = {
  forestPine: '{37C347EECE844530}Prefabs/WEGenerators/Forest/FG_Forest_Pine1.et',
  hedgeCorylus: '{B5B681ECEC350BC3}Prefabs/WEGenerators/PG_Vegetation_CorylusBushline.et',
  lake: '{1F2254A7C9C8AA57}Prefabs/WEGenerators/Water/Lake/LG_Lake_01.et',
} as const
