# Bohemia Wiki — Reforger terrain creation (summary)

Source: offline BIKI dump shipped with enfusion-mcp (`enfusion-mcp/data/wiki/pages.json`). The online site blocks automated access (Cloudflare 403).
Pages: Terrain_Tutorial, Terrain_Creation_Tool, Terrain_Entity, New_Terrain_Setup, Terrain_Preparation_Tutorial, Forest / Road / River / Lake / Prefab / Wall / Power_Line Generator, Vector_Tool, Parallel_Shape_Tool, Object_Import_Tool, 2D_Map_Creation (all under `https://community.bistudio.com/wiki/Arma_Reforger:`).

## 1. Official pipeline
1. Create a "Base scene" world.
2. Place `GenericTerrain_Default.et` at 0,0,0. This is mandatory: without its Terrain Layer Preset, vehicles bounce.
3. Right-click, then "Create new terrain…", and set the grid.
4. Add the sun, sky, ocean, post-process, weather and AI (SCR_AIWorld, navmesh).
5. Constraints:
   - only one terrain per world;
   - grid = number of faces (N faces = N+1 vertices);
   - size = faces × cell size;
   - X and Z may differ.

**BI reference (close to Everon)**:
- cell 1.5 m;
- block 33×33 vertices (48 m);
- tile 129×129 vertices (4×4 blocks);
- 8193² vertices, i.e. 12,288 m;
- height in steps of 3.125 cm, from -204.78 to 1843.19 m.

BI recommends staying close to these values: the engine's optimisation and QA are done on them.

**Resolution**: aim for **2 m**, the grid the assets are designed for. At 3 m, placement becomes difficult; at 4 m, holes appear.

## 2. Heightmap, satmap, normal map
- **Heightmap**:
  - `.asc` recommended (lossless);
  - the 16-bit PNG is relative and requires "resampling heights" (min/max);
  - Invert X and Invert Z options;
  - export possible of the Base or Modified version;
  - **save**, otherwise the import is not written.
- **Height**: stored as a 16-bit integer with a step of 0.03125 m by default, i.e. **about 2048 m of range**, shiftable. Reducing the step increases precision and reduces the range. This explains the clipping at 2046 m in BARNMAP.
- **Satmap**:
  - distant texture, no required dimension;
  - **BI advises against using a real satellite photo**: it should be built from the masks, filled with the average colours of the surfaces' `*middle_BCR` textures, with slight variations;
  - finalise it last, and reimport it after the roads;
  - wait for the regeneration to finish, save, reload.
- **Normal map**: regenerated from the heightmap. One texel per vertex is enough.

## 3. Surfaces and masks
- One greyscale PNG (0 to 1) per surface. Import by right-clicking the surface, then "priority surface mask import".
- **The source resolution is free**: the mask is resampled on import. BARNMAP's 4033 px are therefore not a strict constraint. We stay cautious: to be validated by exporting a mask in the Workbench to read its native size.
- The default surface covers 100% of each block.
- **Maximum 5 surfaces per block**, default surface included; neighbouring blocks count too. **BI recommends 3 surfaces** for externally generated masks.
- A reimport erases the manual painting of that surface.
- Repair tools: Fix block border, Rebuild terrain materials, Info & Diags (merge or replace the surfaces of a block).

## 4. Generators (all direct children of a Vector Tool shape)
| Generator | Shape | Key points |
|---|---|---|
| Forest `FG_*` | closed, at least 3 points (a spline is read as a polyline) | Levels (Top, Bottom, Outline), Clusters (Circle, Strip); Avoid Roads/Rivers/PowerLines/Tracks/Lakes; **Avoid Objects is costly, disable it**; edge flags per point; 2D distribution |
| Road `RG_*` | **spline only** | Spline → RoadGenerator → Road (children). Regular, few points; Snap to Terrain; at intersections, a shared point at the same height |
| River `R_*` | open, at least 2 points | Width, Reverse Flow, Clearance, Shore Wetness. Lower the spline by 0.5 to 1 m, paint the bed, then bake |
| Lake `LG_*` | closed, at least 3 points, clockwise, no self-intersection | Flatten By Bottom Plane, Reverse Point Order |
| Prefab `PG_*` | at least 2 points | Hedges (Bushline): Distance, Align With Shape, offsets, Gap, Random Spacing, **Perlin density** |
| Wall `WG_*` | at least 2 points | First, Middle, Last objects, padding, offsets |
| PowerLine | line | Poles, Distance, Clearance (forests avoid them) |

- **Mass placement** (Object Import Tool): CSV with exactly 9 fields, `"resourceName" posX posY posZ quatX quatY quatZ quatW scale`. **This is an official, simple import route for our placed prefabs.**
- The Parallel Shape Tool creates shapes offset from -50 to +50 m. This is useful for lining roads with hedges.

## 5. Performance
- 1 block = 1 draw call, 5 LODs.
- **Forests are the main cost**. A large, flat wooded area performs badly, because the relief serves as the occluder. Forests that rise above the ridges on the horizon are expensive.
- Recommendations:
  - plenty of clearings;
  - work iteratively across the whole terrain;
  - organise nature into layers by zone;
  - for FG debugging: Print Entities Count, Print Area, Print Performance Details.
- **No numeric limit** (entities, maximum size, console budget) in the wiki. Terrain creation is only possible on PC. The Xbox / PS5 budget has to be established **by benchmark**.

## 6. Consequences for the tool
- 2 m cell by default; heightmap as `.asc` (N+1 px); 2048 m range with an automatic offset.
- **Satmap generated from our masks**, using the surfaces' average colours, rather than an Esri photo. This also removes the tile licensing problem.
- Masks: 3 surfaces per block targeted, 5 at most, with a check per block of 32×32 faces.
- Forests: closed polyline + child `FG_*`, Avoid Objects disabled, **automatic clearings**, warning on large flat forests and on ridges.
- Roads: **spline** + RG + Road, intersections merged into a single point.
- Water: lakes clockwise with `LG_*`; open rivers with `R_*` lowered by 0.5 to 1 m.
- Hedges: `PG_*` on field borders, offset with the same logic as the Parallel Shape Tool.
- Isolated prefabs: **Object Import Tool CSV export**, simpler and safer than a `.layer`.

## 7. Additions from the online version of the Terrain Tutorial (read on 2026-10-14 via Chrome)
- **Size of forest shapes**: aim for **a few hundred metres per shape**. Several small shapes are better than one large one: they fill faster, are easier to touch up, and the forest is less uniform with different FGs. → The tool must **split large forest polygons** (Voronoi / grid) and vary the `FG_*`.
- **Layers**:
  - `default` contains only the strict minimum, **never generators**;
  - nature goes into a shared layer or into layers named by large zone (`Forest_East`, `Mountains_West`, `Shorelines_NE`…);
  - place names go in a separate layer, and each village ideally has its own.
  - → The export writes one layer per type and per zone.
- **Shape points**: the Forest Generator distributes in 2D. Points must be "Snap to terrain", hence the value of writing the real terrain Y as BARNMAP does.
- **Per-point flags** of the forest shape: they enable or cut the edge undergrowth. We use them for clearings and logging areas.
- **River**:
  1. spline with Snap to terrain and many points;
  2. an **RG Dirt** with Adjust Height Map, the spline lowered by 0.5 to 1 m;
  3. an `R_*` prefab dragged onto the spline (Reverse Flow if needed);
  4. the bed painted with the brush;
  5. the road **baked** into the heightmap, then deleted.
  - → The tool can export the already-lowered river spline, with RG Dirt + `R_*` as children, and a sheet "bake then delete the RG".
- **Ponds**: **perfectly flat** polyline. If the pond looks inverted, reverse the polyline.
- **Dam**: a spline across a valley with RG and a strong "affect terrain" offset, then a lake behind it.
- **Power lines**: "Generate per point" places a pole exactly on a point. Forests with Avoid PowerLines clear the corridor.
- **BI order**:
  1. Layout: structures, villages, seabed.
  2. Population: roads, forests, water, rivers, power lines, shorelines.
  3. Details.
  4. Final satmap last.
  - Work the whole map roughly before detailing, otherwise performance cannot be measured.
- **Real data**: BI points to QGIS and OpenTopography, and reminds that a 40 m DEM requires a lot of processing to get to 2 m.
