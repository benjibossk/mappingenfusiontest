# Reforger Mapper — research file

Goal: a web tool to map quickly for Arma Reforger (Enfusion engine) and auto-fill areas with vanilla assets.
Current phase: **research**. For each source: what it does, what we verified, and how to reproduce it in the final tool.

Legend: ✅ verified in code or in files · 🔎 inferred (screenshots, docs) · ❓ to be confirmed

---

## 1. BARNMAP (Barnaber / LEBARNABER), v1.48

- **Status**: closed Windows exe, distributed against a donation, no licence. We reuse **no code**, only the observed behaviour and formats. The author's agreement is to be kept in writing.
- **Sources**: [showcase page](https://ustorie.github.io/BARNARMA/), PDF manual (`BARNMAP_Manuel_Import_Enfusion.pdf`, identical to the one in the repo), 6 screenshots of v1.48, example OMAHA map (downloaded zip, Workshop `6A84C9A969207F9F`).

### 1.1 How it works (screenshots 🔎)
- Leaflet interface. You search for a place or enter lat/lon, then choose a size: 4, 8, 16 or 32 km.
- 4 position favourites (buttons 1 to 4 with a floppy disk).
- The selection frame is slightly rotated: the tool works in a local metric projection, not in Mercator.
- Base maps and exported layers: Heightmap, Satellite, Forest, Road, Water, Surface masks.
- "Relief calculation" button.
- **Vertical offset**: disabled by default. Once enabled, it brings the lowest point to 0 m; beyond 2048 m, everything is flattened to 2046 m. This is probably the height limit of the Enfusion terrain ❓.
- Export to a folder, with a progress bar and a cancel button.

### 1.2 Data sources (attributions visible in the screenshots 🔎)
| Layer | Source |
|---|---|
| Relief | Mapzen/Tilezen (Terrarium tiles), Mapterhorn, Copernicus DEM (DLR/Airbus), **IGN LiDAR HD** |
| Satellite | Esri World Imagery |
| Forest and masks | **ESA WorldCover 2021** (10 m, Sentinel). Colours: green = trees, yellow = grassland, pink = crops, red = built-up, blue = water |
| Roads and water | OpenStreetMap (CARTO background) |

### 1.3 Terrain grid (✅ screenshots and files)
- For N km requested: N×512 faces, N×512+1 vertices, 2 m per cell. The terrain actually measures N×1.024 km.
  - Example for 4 km: 2048 faces, 2049 vertices, 4.096 km terrain.
- Workbench settings (manual): Blocks per tile = 4, terrain origin at 0,0,0, heightmap import with Invert X disabled and Invert Z enabled.
- Heightmap: `Terrain.asc` (ASCII grid, altitudes in metres).
- **Surface masks: 8-bit greyscale PNG of 4033×4033 px for 4 km** ✅. This is neither 4096 nor 4097: the ratio is about 0.985 px/m. The manual states: "format read in your Workbench, do not resize the PNG". This is therefore the size expected by the Workbench import for this terrain; the formula for 8/16/32 km is still to be found ❓.
- Exported surfaces ✅: Asphalt_01, Concrete_01, Crop_Field_01, Dirt_01, ForestDeciduous_01_Base, Heather_01, Pebbles_01, Rock_01, SeaBed_01. Grass_01 serves as the default background.
- Engine limit: 5 surfaces per block (manual).

### 1.4 Exported `.et` formats (✅ OMAHA map: 386 roads, 42 forests, 14 water bodies)
Each element is a separate `.et` file. The entity is at `coords 0 0 0` and the points are in **absolute world coordinates, Y included**: the terrain altitude is already sampled. The IDs are random 16-character hex strings, the ShapePoints are `{GUID}`s.

**Road**: `SplineShapeEntity` with a child generator.
```
SplineShapeEntity {
 ID "68B4AE5E9FC54922"
 coords 0 0 0
 Points {
  ShapePoint "{4B887E47FC544F3D}" { Position 1500.436 40.67 515.08 }
  ShapePoint "{A24A3F0272EB42B3}" { Position 1489.299 41.508 501.66 }
 }
 {
  RoadGeneratorEntity : "{723C2AAE6E9AD131}Prefabs/WEGenerators/Roads/Asphalt/RG_Road_Asphalt_E_01.et" {
   ID "44ECE70814ED4341"
   coords 0 0 0
   AdjustHeightMap 0
   AdjustHeightMapPriority 5
   RoadClearance 16
   RoadWidth 8
   FalloffStartWidth 1
   RoadFalloffWidth 1
  }
 }
}
```
- Only two prefabs:
  - `{723C2AAE6E9AD131}RG_Road_Asphalt_E_01`: 267 roads, width 8;
  - `{8E83BBD5CEC42A11}Prefabs/WEGenerators/Roads/Dirt/RG_Road_Dirt_01.et`: 119 roads, width 6.5.
- The clearance is 16 everywhere.
- Once placed in the world, `Route.layer` contains the generated `RoadEntity` (`SplinePoints` block, `Width`, `IsClosedSpline`).

**Forest**: closed `PolylineShapeEntity`, **without a generator**. It is up to the user to add a Forest Generator.
```
PolylineShapeEntity {
 ID "809C747A8FAB4D8F"
 coords 0 0 0
 Points { ShapePoint "{...}" { Position 3624.026 55.302 1.048 } ... }
 IsClosed 1
 LineColor 0 1 0 0
}
```

**Water**: same format as the forest, with `LineColor 0.05 0.48 1 1`. The sea polygons follow the coast (Y ≈ -1.6 to 0), without a generator.

- Each `.et` has a `.meta` (`MetaFileClass`, `Name "{GUID}path"`, PC/XBOX_ONE/XBOX_SERIES/PS4/PS5/HEADLESS configurations).
- **World layers** (`worlds/BarnMap4km_Layers/*.layer`): simple references to prefabs, for example `PolylineShapeEntity : "{0268BDCAF521235C}Foret/..._009.et" { }`. The files are `Wood.layer`, `Route.layer`, `Eau.layer` and `default.layer` (GenericWorldEntity, GenericTerrainEntity, PP effects).

### 1.5 What we do better
- The WorldCover masks are pixelated (10 m): we smooth them and cross them with the OSM polygons.
- We add a **Forest Generator** to the forests and a **water generator** to the water, instead of leaving empty outlines.
- We reuse its two road prefabs, but choose the width from the OSM `highway=*` tag.
- We write the `.meta` files with generated GUIDs, as it does.

---

## 2. giorbev/Map-generator ("Map Generator Pro" v7)
- **MIT licence**, © 2026 Giorbev. We can port the code while keeping the notice.
- **Function**: automatically paint the surfaces from an `.asc` heightmap. It places no objects.
- **Stack**: Python (numpy, scipy, opencv, scikit), PyWebView interface. Key files: `pipeline_v5.py`, `terrain_algorithms.py`, `clean_weights.py`.
- **Algorithms** ✅:
  - slope and aspect; Zevenbergen-Thorne curvature; multi-radius TPI;
  - depression filling then flow accumulation;
  - distance to the coast (distanceTransform);
  - pseudo-fBm noise to break up round shapes;
  - each mask is a product of ramps and "bells" over altitude × slope × TPI × aspect;
  - normalisation (sum = 1), then a budget of 5 to 7 dominant materials per block.
- **13 masks**, with biome presets in JSON (`data/biomes/`).
- **Outputs**: 16-bit PNG per mask, or direct binary writing into `.ttile` (LRS2/GCTD format documented in `docs/technical/`). This writing is risky.
- **Limits**: values hard-coded for Zimnitrita, global numpy seed, large monolithic files.
- **To reproduce**: port the slope, TPI, curvature and flow computations to TypeScript, and the biome rules as JSON, in a worker. We export PNGs, with no `.ttile` writing at first. We keep its binary format documentation for later.

## 3. mapgen4 (Red Blob Games)
- **Apache-2.0 licence** (verified), official repo `redblobgames/mapgen4`.
- **Technique**:
  - Delaunay/Voronoi dual mesh (`dual-mesh`);
  - elevation painted with a brush, then noise;
  - wind → humidity → rain, with rain shadow;
  - rivers by flow accumulation, width according to discharge;
  - WebGL rendering (regl), computation in a worker.
- **To reproduce**: the **fictional map** mode (paint the relief, then export `.asc`, masks and shapes), the real-time relief brush, humidity for the biomes, and the worker + WebGL architecture.

## 4. Tanin69/AgriFieldGenerator (v1.2.0)
- **MIT licence**, © 2024 Didier ALAIN.
- **Pipeline** ✅:
  1. closed spline (`SplineShapeEntity` read from a `.layer`, Hermite → Bézier conversion);
  2. polygon;
  3. starting points (random, rotated grid, rectangles);
  4. Voronoi clipped to the area;
  5. edges curved as Béziers, keeping neighbouring parcels contiguous;
  6. greedy BFS colouring so that two neighbours never have the same texture;
  7. random border between fields.
- **Outputs**: PNG masks (4 at most) merged with those exported from the Workbench, and one `PolylineShapeEntity` per parcel (Y = 0).
- **Limits**: no relief, no prefabs, no real hedges, colours compared in exact RGB.
- **To reproduce**: the **Countryside** module. We take its pipeline (d3-delaunay, turf), then add the real height, hedges and fences as prefabs on the borders, paths via `RG_Road_Dirt_01`, and groves at the edges. The "crops" parcels from WorldCover serve as the starting area.

## 5. State of the art (other engines)
| Tool | Idea retained |
|---|---|
| Unreal PCG (UE5) | A graph of rules applied to a volume: sample, filter (slope, altitude, mask), prune overlaps, spawn |
| Unity MapMagic 2 / Gaia / Vegetation Studio | Per-biome spawn rules, tile-based generation |
| Gaea / World Machine / Instant Terra | Erosion and derived masks (slope, flow, deposition). Bohemia recommends Instant Terra |
| Arma 3 Terrain Processor | "One vector shape → one task" pipeline (fill a polygon, a line, a fence) |
| Reforger World Editor | **Native Forest / Road / River Generators** driven by shapes. This is the main export target |
| Terrain Automation Tools (mod) | Thinned edges ("featherer"), cleared corridors along splines |
| Watabou | Village = road, then split into parcels, then buildings oriented toward the road |
| Azgaar | Biomes = temperature × humidity, roads between localities |

**JS/TS building blocks** (licences to be rechecked): simplex-noise, poisson-disk-sampling (MIT), d3-delaunay / Delaunator (ISC), turf (MIT), osmtogeojson (MIT), geotiff.js (MIT), proj4 (MIT), MapLibre GL (BSD-3), Three.js (MIT).

## 6. Benchmark and engine limits (TODO)
- **Problem**: some maps are heavy and crash. We need to know the limits per platform: Xbox Series S, Xbox Series X, PS5, PC (entity count, vegetation density, memory, terrain size).
- **Tools received from Lou**:
  - `SCR_WorldEditorToolHelper.c`: WorldEditorAPI access and `QueryEntitiesByAABB/BySphere`;
  - `SCR_ImageHelper.c`: PNG image export.
  - With both, we can produce an **entity density heatmap** (count per 50 m cell, then PNG).
- **To reproduce**: a budget counter in the tool, a target platform to choose, and an alert before export.

---

## 7. Summary: how the final tool reproduces each building block

| Building block | Inspired by | Planned implementation | Reforger output |
|---|---|---|---|
| Real-area selection | BARNMAP | MapLibre and local projection (proj4, UTM), sizes 4/8/16/32 km, favourites | — |
| Relief | BARNMAP | Terrarium / Copernicus tiles (+ IGN LiDAR HD in France), resampled to 2 m, optional vertical offset | `Terrain.asc` |
| Fictional relief | mapgen4 | Elevation brush, Delaunay, noise | `Terrain.asc` |
| Derived maps | Map-generator | Slope, TPI, curvature, flow, distances (TS worker) | (internal) |
| Surface masks | Map-generator + BARNMAP | WorldCover + OSM + biome rules, per-block budget | 8-bit greyscale PNG (size to be confirmed, cf. 4033) |
| Roads | BARNMAP | OSM `highway=*` → `SplineShapeEntity` + RoadGenerator (Asphalt_E_01 / Dirt_01), sampled Y | `.et` + `.meta` + `.layer` |
| Forests | BARNMAP + native WE | Smoothed WorldCover/OSM polygons → closed `PolylineShapeEntity` **+ child ForestGenerator** | `.et` + `.layer` |
| Water | BARNMAP + native WE | OSM waterway/natural=water → polylines + river/lake generator ❓ | `.et` + `.layer` |
| Fields | AgriFieldGenerator | Clipped Voronoi, colouring, hedges and paths | masks + shapes + prefabs |
| Direct fill | PCG / Gaia | Poisson-disk per species, per-biome filters | prefab entity `.layer` |
| Budget | Lou's bench | Per-cell counting, per-platform thresholds | Report + heatmap |

## 8. Open questions
1. Formula for the mask size: 4033 px for 4 km (value read in the Workbench according to the manual); values for 8/16/32 km?
2. Exact format of a `PolylineShapeEntity` with a child `ForestGeneratorEntity`, and vanilla `FG_*` prefabs: to be extracted from the game files.
3. Native water generator (River / Lake): class name and prefabs.
4. GUIDs: the exported `.et` files need a `.meta` with a unique GUID. The format is verified; it remains to confirm that random GUIDs are enough.
5. Engine limits per platform: Bohemia documentation and bench.
6. Licences and terms of use of the Esri / Mapterhorn / IGN tiles for an export.

---

## 9. Tanin69: deeper look (AgriFieldGenerator README + Google Doc tutorial "Painting with masks", Workbench 1.1.0.42)
- Among Tanin69's repos, only **AgriFieldGenerator** concerns our tool. He also maintains a fork of `enfusion-mcp` (MIT) and DarcMods (mods).
- **Surface mask resolution**: it is read in *Terrain Tool > Info & Diags > Surface mask > Resolution* (Tanin's example: 1.000795 m/px for a 16,257 px terrain). The AFG config requires an SVG size equal to the satmap and the terrain, and a `tile_size` of 512.
  - **Probable formula for BARNMAP's 4033 px**: 4033 = 64×63+1 and 16,257 = 128×127+1, i.e. *nb_tiles × (px_per_tile − 1) + 1* (shared tile border). To be confirmed in Info & Diags on our test terrain.
- **Workbench "Export geographic data" tool**: it exports the selected polylines as **SVG** (`profile/export.svg`). The SVG does **not** have the mask's size: it must be resized to the exact size of the mask, otherwise everything is shifted. → The web tool can **import this SVG** to recover areas drawn in the Workbench, and AFG can also read the `SplineShapeEntity` from a `.layer`.
- **Vector Tool**: the "New Polyline from selected" and "Convert to polyline area" buttons are used to create areas from existing splines.
- **Mask import pitfalls**:
  - reimporting a mask **modifies all tiles**, with "too many materials per tile" errors on dozens, even over a hundred tiles;
  - in a team, this overwrites colleagues' tiles;
  - before each new import, reimport the base texture (Grass03) to erase the previous import.
- **Satmap**: it must be exported from the masks, regenerated, then reimported. This takes 45 min on a 256 km² terrain with a GTX 1060. Tanin's team uses **[granQ/ReforgerSatGenerator](https://github.com/granQ/ReforgerSatGenerator)** (Python, no published licence), which combines the exported masks into a satellite image. This is exactly the BI recommendation (satmap built from the masks). → To be analysed and reproduced in the tool.
- **Per-tile update**: each tile corresponds to 8 files, spread between `Terrain/.Data` and `Terrain/.EditorData`, and containing the tile number. Tanin has a script that copies only the modified tiles, and AFG exports `polygon_tiles.txt` (the list of tiles touched). → **Our tool should produce masks limited to the modified area and the list of tiles concerned**, to avoid breaking the rest of the terrain.
- **AFG backlog** (ideas to adopt): the satmap as the preview background, display of the Enfusion tiles over the polygon, and taking the relief into account to place the points.
