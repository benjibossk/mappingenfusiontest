# State of the art — terrain generation / auto-fill

Updated 2026-10-14. Legend: **[V]** verified online during this pass (link provided) · **[M]** from memory, not verified — to be confirmed before any legal or commercial decision.

Context: web tool that produces relief, surface masks, `.et` shapes driving the native Enfusion generators (Forest/Road/River/Lake/Prefab/Wall), prefab placement, OSM/DEM/WorldCover imports, per-platform perf budget.

## 1. Unreal Engine

| Tool | What it does / key technique | Licence / price | Idea to adopt |
|---|---|---|---|
| PCG Framework (UE5) | Node graph on attributed "points": Surface/Spline Sampler, Density Filter, Self Pruning, Difference, Transform Points, Static Mesh Spawner; Shape Grammar (5.4+) [M] to subdivide splines into modules. Announced production-ready with 5.7; ~2x faster than 5.5 [V](https://80.lv/articles/what-s-new-in-pcg-in-ue5-6-ue5-7) | Included in UE (Epic EULA, royalties >$1M) [M] | "Attributed point cloud → filters → spawner" model as the core of the prefab pipeline |
| PCG Biome Core (V2 in 5.6) | Data-driven biomes (data assets), per-biome blending, multiple layers; plugin still "experimental", Epic advises copying it [V](https://dev.epicgames.com/documentation/en-us/unreal-engine/procedural-content-generation-pcg-biome-core-and-sample-plugins-overview-guide-in-unreal-engine) | Included in UE | Define biomes as data files (JSON): asset rules + densities + blending priority |
| PCGEx (PCG Extended Toolkit) | Graphs (clusters), pathfinding, spatial queries, filters [V](https://github.com/PCGEx/PCGExtendedToolkit) | **MIT** [V] free | Build the road network as a graph (Delaunay/MST + pathfinding on slope cost) before emitting the Road splines |
| Landmass / Water | Non-destructive brushes stacked on the heightmap (Blueprint brushes); Water carves the river bed from the spline [M] | Included in UE [M] | Stack of non-destructive "brushes": road that flattens, river that carves, recomputed on every change |
| Brushify | Landscape material packs + auto-material by slope/altitude [M] | Paid, Fab [M] | Slope/altitude/curvature auto-material → surface masks |
| Houdini Engine (UE/Unity) | Runs Houdini HDAs in the engine | Free plugin for commercial use since 2021 (≤10 licences/studio, HDA only) [V](https://www.sidefx.com/faq/question/houdini-engine-plugin-free-for-unity-and-unreal/) | "Tool = parameterised asset": our presets must be replayable parameter bundles |

## 2. Unity

| Tool | Key technique | Licence / price | Idea |
|---|---|---|---|
| MapMagic 2 | Node graph, infinite tile-based generation, biomes as subgraphs [M] | Free core + paid modules on the Asset Store [M] | Generation by independent tiles (one worker per tile) + biome subgraphs |
| Gaia Pro | Stamps (relief stamps) + rule-based "spawners" (slope, height, texture, noise) [M] | Paid, Asset Store [M] | Spawner with cumulative rules, 0–1 fitness per criterion, multiplied |
| Vegetation Studio Pro | Per-biome vegetation rules, masks, instanced rendering [M] | Paid (deprecated?) [M] | Exclusion masks (roads, buildings) that take priority over vegetation |
| MicroSplat | Optimised splatmaps, triplanar, texture clustering [M] | Free core + paid modules [M] | Limit the number of layers per cell (Enfusion: surface budget per block) |

## 3. Godot

| Tool | Technique | Licence | Idea |
|---|---|---|---|
| Terrain3D | Geometry clipmaps, regions, control map (2 textures + per-pixel blend) | **MIT** [V](https://godotengine.org/asset-library/asset/edit/14377) | Compact per-pixel "base/overlay texture + blend" encoding |
| ProtonScatter | Scatter via stacked modifiers (random, grid, project on colliders, relax) | **MIT** [V](https://github.com/HungryProton/scatter) | Ordered modifier-stack UI for prefab placement |
| Spatial Gardener | Vegetation painting with octree density | **MIT** [V](https://godotengine.org/asset-library/asset/edit/8541) | Manual density brush on top of the procedural output |

## 4. Standalone terrain software

| Tool | Technique | Licence / price | Idea |
|---|---|---|---|
| Gaea (QuadSpinner) | Graph, hydraulic/thermal erosion, mask export (flow, deposition, wear) | Perpetual: Community free (non-commercial), Indie $99 (<$100k), Pro $199, Enterprise $299; Gaea 3 in EA July 2026 [V](https://quadspinner.com/Order/) | Export erosion masks (flow/deposition) as sources for the surface masks |
| World Machine | Device graph, erosion, tiling | Basic free (≤1025², non-commercial); Indie $119, Pro $299 (2021 prices) [V](https://www.cgchannel.com/?p=122990) | Tiled output with overlapping margins (avoids seams) |
| World Creator | Real-time GPU, biomes (2025.1), scattering | Subscription/perpetual; contradictory figures ($49/yr Indie on the site vs $149 per CGChannel) [V](https://www.world-creator.com/en/buy.phtml) | Instant GPU preview of biome rules |
| Instant Terra | Very large terrains, streaming, recommended by Reforger creators [V](https://reforger.armaplatform.com/news/terrain-tutorial) | Paid [M] | Tile-based processing for 10–20 km maps |
| Houdini (SideFX) | Heightfields, erosion, OSM import, PDG | Indie ~$299/yr (<$100k) [V third-party](https://superrendersfarm.com/article/how-much-does-houdini-cost); Apprentice free | Derived masks (curvature, flow, slope) in one click |

## 5. Arma

| Tool | Technique | Licence | Idea |
|---|---|---|---|
| Terrain Builder / Terrain Processor (Arma 3) | TP: chained tasks on shapefiles (placement along lines, inside polygons, heightmap from .asc); square power-of-2 heightmap [V](https://community.bistudio.com/wiki/Terrain_Processor:_Tutorial) | Arma 3 Tools, free [M] | Reproduce the "shapefile + task" model: OSM polygon → Enfusion generator |
| Enfusion World Editor — Terrain Creation Tool | Import of .asc or 16-bit PNG heightmap (relative heights → range to be recalibrated) [V](https://community.bistudio.com/wiki/Arma_Reforger:World_Editor:_Terrain_Creation_Tool) | Workbench free | Export 16-bit PNG + .asc with documented min/max |
| ARTE (QGIS plugin) | Satellite + heightmap export for Reforger, road flattening, river carving from OSM — no public release yet [V](https://plugins.qgis.org/plugins/ARTE/) | ? | Direct competitor: differentiate by emitting `.et` shapes + prefabs |
| Outside Terrain Tool (Workshop) | Community Workbench tool for off-map terrain [V](https://reforger.armaplatform.com/workshop/61F2B96F0D3F27D4) | Workshop (APL?) [M] | Also generate the "outer terrain" |
| L3DT | Historically popular for Arma 3, abandoned [V](https://reforger.armaplatform.com/news/terrain-tutorial) | — | — |

## 6. Web / open source / data

| Tool / data | Technique | Licence | Idea |
|---|---|---|---|
| mapgen4 (Red Blob Games) | Delaunay/Voronoi dual mesh, painted elevation, rivers by drainage, WebGL rendering | **Apache 2.0** [V](https://github.com/redblobgames/mapgen4) | Rivers by flow accumulation on a mesh; interactive elevation painting |
| Azgaar FMG | Voronoi, climate, biomes, roads, burgs | **MIT** [V](https://github.com/Azgaar/Fantasy-Map-Generator) | Village placement by habitability score (water, slope, roads) |
| Watabou (MFCG, Village) | Town/village plan generation | Closed source (older Haxe versions GPL-3 [M]) | Watabou GeoJSON export → building prefabs |
| WFC (mxgmn) | Wave Function Collapse | **MIT** [M] (LICENSE link not read) | Grid-based WFC for base/camp layouts |
| Blender-OSM / Blosm | OSM + relief import into Blender | Basic free / premium paid [M] | — |
| terrain.party / Tangram heightmapper | Heightmap export from Mapzen terrarium tiles | terrain.party offline [M] | Terrarium/terrain-RGB encoding on the browser side |
| Mapterhorn | Public terrain tiles (Copernicus GLO-30 + national LiDAR), PMTiles | Licence per source: see [attribution.json](https://download.mapterhorn.com/attribution.json) [V](https://mapterhorn.com/data-access/) | Main DEM source on the web side (no server) |
| ESA WorldCover 10 m | Land cover, 11 classes | **CC BY 4.0** [V](https://registry.opendata.aws/esa-worldcover-vito/) | Class → Enfusion surface/generator table |
| Copernicus DEM GLO-30 | Global 30 m DEM | Specific Copernicus licence, free, attribution mandatory (© DLR/Airbus…) [V](https://registry.opendata.aws/copernicus-dem/) | Automatic attribution in the export |
| IGN LiDAR HD (50 cm DTM) | DTM in 1 km tiles, ASC/TIF | Licence Ouverte Etalab 2.0 (IGN practice) — IGN page not read [M]/[V partial](https://www.data.gouv.fr/datasets/mnt-lidar-hd-ign-2025) | High-resolution import for France |
| OpenStreetMap | Vectors | **ODbL** [M] | Attribution + share-alike on the derived database |

## 7. JS/TS building blocks (licences [M] unless stated; all standard permissive)

| Lib | Use | Licence |
|---|---|---|
| simplex-noise | 2D/3D/4D noise | MIT [M] |
| fastnoise-lite | Various noises + domain warp, cellular | MIT [M] |
| poisson-disk-sampling | Prefab placement at minimum distance, variable radius | MIT [M] |
| delaunator / d3-delaunay | Triangulation, Voronoi (roads, parcels) | ISC [M] |
| @turf/turf | Geo geometry (buffer, intersect, simplify) | MIT [M] |
| osmtogeojson | Overpass → GeoJSON | MIT [M] |
| geotiff (geotiff.js) | Reading COG/GeoTIFF DEM & WorldCover | MIT [M] |
| proj4 | Reprojection (WGS84 → UTM/Lambert-93) | MIT [M] |
| maplibre-gl | Area selection map | BSD-3 [M] |
| three | 3D preview | MIT [M] |
| rete / litegraph.js | Node graph editor | MIT [M] |
| polygon-clipping | Polygon booleans (exclusion masks) | MIT [M] |
| upng-js / pngjs | 8/16-bit PNG writing (heightmap) | MIT [M] |

## Top ideas to integrate

1. **Attributed point cloud + filters + spawner** (PCG/ProtonScatter): each placement rule = ordered stack of filters (slope, altitude, mask, road distance, noise).
2. **Non-destructive brushes** (Landmass): roads flatten, rivers carve, recomputed from the shapes.
3. **Biomes as data files** (Biome Core) with priority and blending.
4. **Derived masks** (Gaea/Houdini): slope, curvature, flow accumulation → surfaces and forests.
5. **Road network as a graph** (PCGEx): MST/pathfinding on slope cost, then export as Road shapes.
6. **WorldCover → editable** surface/generator mapping table.
7. **Shapes + tasks** (Terrain Processor): OSM polygon/line = input of a native Enfusion generator (Forest/Road/River/Lake/Wall).
8. **Tile-based processing with margins** (World Machine/MapMagic) in Web Workers.
9. **Habitability score** (Azgaar) to place villages/prefabs.
10. **Automatic attribution** of sources (Copernicus, ESA, OSM ODbL, IGN) in the export.

## Selected JS/TS building blocks (licence, use)

- `geotiff` (MIT) + `proj4` (MIT): DEM/WorldCover import and reprojection.
- `osmtogeojson` (MIT) + `@turf/turf` (MIT) + `polygon-clipping` (MIT): OSM vectors, buffers, exclusion masks.
- `fastnoise-lite` (MIT): noise + domain warp; `poisson-disk-sampling` (MIT): placement.
- `d3-delaunay` (ISC): road graph, parcels.
- `pngjs` (MIT): 16-bit PNG heightmap / 8-bit masks writing.
- `maplibre-gl` (BSD-3): area selection; `three` (MIT): 3D preview.
- `rete` (MIT): graph editor if we expose the rules as nodes.
- JS licences to be reconfirmed with `npx license-checker` at install time.

## Main sources

- QuadSpinner Order — https://quadspinner.com/Order/
- World Creator buy — https://www.world-creator.com/en/buy.phtml ; World Machine (CGChannel 2021) — https://www.cgchannel.com/?p=122990
- Epic Biome Core — https://dev.epicgames.com/documentation/en-us/unreal-engine/procedural-content-generation-pcg-biome-core-and-sample-plugins-overview-guide-in-unreal-engine
- PCGEx — https://github.com/PCGEx/PCGExtendedToolkit ; ProtonScatter — https://github.com/HungryProton/scatter
- mapgen4 — https://github.com/redblobgames/mapgen4 ; Azgaar — https://github.com/Azgaar/Fantasy-Map-Generator
- SideFX Houdini Engine FAQ — https://www.sidefx.com/faq/question/houdini-engine-plugin-free-for-unity-and-unreal/
- ESA WorldCover — https://registry.opendata.aws/esa-worldcover-vito/ ; Copernicus DEM — https://registry.opendata.aws/copernicus-dem/
- Mapterhorn — https://mapterhorn.com/data-access/
- BI Wiki Terrain Creation Tool — https://community.bistudio.com/wiki/Arma_Reforger:World_Editor:_Terrain_Creation_Tool ; Terrain Processor — https://community.bistudio.com/wiki/Terrain_Processor:_Tutorial
- ARTE QGIS — https://plugins.qgis.org/plugins/ARTE/
