# Architecture — global tool

A single tool, three layers. Each studied tool becomes a **module** that reads and writes the same
pivot format, the *MapGen project* (JSON). Sources: inventory from RESEARCH, WORKSHOP_TERRAIN_MODS,
BENCHMARK_GIORBEV, WIKI_TERRAIN, ENFUSION_FORMATS.

```
 Browser (Vite + TS)                   Local bridge (Node)          Workbench
 ┌──────────────────────────┐  HTTP   ┌──────────────────┐  TCP    ┌─────────────────────────┐
 │ modules → project JSON   │ ──────▶ │ writes the JSON, │ ──────▶ │ MapGen plugin:          │
 │ MapLibre / WebGL preview │ ◀────── │ calls the plugin │ NET API │ reads the JSON, creates │
 └──────────────────────────┘ status  └──────────────────┘ :5775   │ shapes + generators,    │
                                                                    │ paints                  │
                                                                    └─────────────────────────┘
```

- **Browser**: all the computation (terrain, masks, parcels, scattering). No Workbench access required:
  the project can also be exported as files (`.asc`, PNG, JSON) for a manual import.
- **Bridge**: small local server; the Workbench can talk to the outside (NetApiHandler,
  RestContext, `Workbench.RunProcess`). Reuses the MCP mechanism (port 5775).
- **Workbench**: `MapGen - Apply project` plugin (an evolution of `MG_CreateShapesPlugin`, method
  validated in ENFUSION_FORMATS §9) — the only place that touches the world.

## Pivot format `mapgen.json` (v0)

```json
{
  "version": 0,
  "terrain": { "size": 4096, "cell": 2, "origin": [0, 0] },
  "shapes": [
    { "id": "forest_12", "kind": "polyline", "closed": true,
      "points": [x0, z0, x1, z1, ...],   // flat world X/Z pairs, Y sampled by the plugin
      "generator": "{37C347EECE844530}Prefabs/WEGenerators/Forest/FG_Forest_Pine1.et",
      "source": "worldcover" }
  ],
  "entities": [ { "prefab": "{GUID}path.et", "pos": [x, z], "yaw": 0, "scale": 1 } ],
  "masks":    [ { "surface": "grass", "png": "masks/grass.png" } ],
  "heightmap": "terrain.asc"
}
```

Rules: prefabs **always** `{GUID}path`; roads as `kind: "spline"` (RoadGenerator rejects
polylines); closed forests / lakes need ≥ 3 points.

## Modules (what we take from each tool)

| Module | Taken from | What is taken | Output |
|---|---|---|---|
| Real terrain | BARNMAP (formats only), Copernicus / IGN / Mapterhorn | ideas | `.asc` |
| Fictional terrain | mapgen4 (Apache-2.0) | code | `.asc`, rivers |
| Terrain analysis | Map-generator giorbev (MIT): slope, TPI, curvature, flow | code ported to TS | internal grids |
| Ground masks | Map-generator + WorldCover | code + data | 8-bit PNG (≤5 surfaces/block) |
| Real land use | OSM (roads, water), WorldCover (forests) | data | shapes |
| Countryside | Tanin AgriFieldGenerator (MIT): Voronoi, coloring | code ported to TS | parcels, `PG_*` hedges, masks |
| Object scattering | TerrainAutomationTools (no license): biome, density, edge, paths | **ideas only** | `entities` |
| Point cloud | AdvancedTerrainTools (no license): `.xyz` import | ideas | `entities` |
| Satmap | granQ (no license), wiki §2 | ideas | PNG |
| Platform budget | giorbev benchmark (no license): ideas; Lou: density | to be measured | alerts |

Overlaps settled: scattering = a single engine (Poisson + biome rules) for forests outside
generators, rocks, bushes; hedges = PrefabGenerator on a border (AFG + Path Decorator);
masks = a single computation feeds ground, satmap and scattering rules.

## Implementation order

1. `MapGen - Apply project` plugin reading `$profile:MapGen/mapgen.json` (shapes + generators) — **done** (2026-10-15).
2. Local bridge + "Send to Workbench" button in the web app.
3. Countryside (AFG port) → first module that produces shapes.
4. Terrain analysis + masks; then real terrain; then scattering; then budget.

Open: mask size formula (8/16/32 km), remaining river/lake GUIDs, `ModifyLayers` test
to paint grounds from script, Esri/Mapterhorn/IGN licenses, measuring console limits.

## Terrain: mapgen4 → Workbench (research 2026-10-15)

- **giorbev**: only `Map-generator` touches the terrain; it **reads** the heights (`load_heightmap_asc`) and
  writes the ground layers directly into the `.ttile` files. No erosion, no height writing;
  "water" = basin-filling masks + flow accumulation.
- **mapgen4** (Apache-2.0): already TypeScript / ES modules, esbuild build, custom WebGL (no regl).
  Unitless elevation −1..1 (0 = sea), 128² painting, Delaunay mesh; rainfall and rivers
  (`assignRainfall`, `assignRivers`, `flow_s`). **No export**: to be added (rasterizing the
  triangles into a Float32 grid), then detail (noise + erosion) and conversion to meters.
- **Writing heights by script**: `WorldEditorAPI.BeginTerrainAction(TerrainToolType, …)`,
  `ModifyHeightMap(x, z, FilterMorphOperation, TerrainToolDesc, FilterMorphShape, FilterMorphLerpFunc)`,
  `ModifyHeightMapUserShape(x, z, op, toolDesc, array<float> userShape, UserShapeFilter)`.
  No example in the game scripts. Unknowns: absolute "set" or additive, buffer size,
  tile edges, undo memory. Fallback: `.asc` imported by the Terrain Creation Tool.
- **Browser erosion** (licenses to be checked): SimpleHydrology (particles, MIT), terrain-erosion-3-ways
  (grid, MIT), Sebastian Lague's Hydraulic-Erosion (MIT), WebGL2 grid erosion (Mei 2007), thermal.

Target pipeline: mapgen4 (drawing) → 1025² grid → upsampling + noise → erosion (+ mapgen4
rivers) → meters → bridge, by tiles → `ModifyHeightMapUserShape` plugin.

### Height writing: VERIFIED (2026-10-15, plugin `MG_TerrainTestPlugin`)

- Enums (probed by script): `FilterMorphOperation` ADD=0 NOISE=1 EXACT=2 SMOOTH=3 COMBINE=4
  NONCUMULATIVE=5; `FilterMorphShape` ROUND/SQUARE/USER; `FilterMorphLerpFunc` LINEAR, SIN, INV_COS,
  SMOOTH, SPHERE, INV_SPHERE; `UserShapeFilter` NEAREST/BILINEAR/BICUBIC; `TerrainToolType`
  HEIGHT_ADD=1 HEIGHT_EXACT=2 HEIGHT_SMOOTH=3 HEIGHT_NOISE=4 SURFACE_PAINT=5 …
- `BeginTerrainAction(HEIGHT_EXACT)` + `ModifyHeightMap(x, z, EXACT, TerrainToolDesc_HeightExact
  {fExactHeight=48, fOuterSize=64, fInnerSizePercent=100}, SQUARE, LINEAR)` + `EndTerrainAction`:
  38 m → **exactly 48 m**, flat up to 120 m from the center, untouched at 140 m.
  ⇒ **`fOuterSize` = half-width in terrain cells** (64 × 2 m = 128 m). Undoable (Ctrl+Z).
- Test terrain `emptyarland`: 2049 × 2049 vertices, 2 m cell.
- Still to test: `ModifyHeightMapUserShape` (free height buffer) to write a grid.

## Ground painting (giorbev research, 2026-10-15)

- Actual limit: **per block** (33 × 33 vertices, 32 × 32 faces): **5 surfaces max** including the default,
  neighbors counted; BI recommends 3 for masks made outside the Workbench (WIKI_TERRAIN §47).
  The "7" of Map-generator = capacity of the binary format (`_layer.edds` R32_UINT, w1..w6 on 5 bits,
  w0 implicit), used on a single map (Zimnitrita); its own README says 5 in vanilla.
- Pruning taken from `clean_weights.py`: set to 0 below ~1% coverage, keep the N strongest,
  renormalize. Better: transfer the removed weight to the nearest kept surface.
- Direct `.ttile` writing (LRS2/GCTD): fragile reverse engineering (hardcoded "Zimnitrita background" byte,
  offset ignored), materials must exist in `terrain.terr` → **to be avoided**. Chosen routes:
  mask import through the Terrain Tool, or `ModifyLayers` / `ModifyLayersUserShape` by script
  (same API as heights, `TerrainToolType.SURFACE_PAINT`, `TerrainToolDesc_LayerAdd`) — to be tested.
- giorbev biome rules: min/max slope, min/max altitude, curvature, priority, intensity; materials =
  vanilla `.emat` names (Grass_02, Rock_01, …).

## Tiles and terrain at giorbev (Map-generator, MIT) — 2026-10-15

- **Geometry** (Zimnitrita, 4097² vertices, 4 m cell): 32 × 32 tiles, 4 × 4 blocks per tile;
  tile = 128 cells (+1 shared vertex = 129), block = 32 cells; `_layer.edds` 512² per tile
  (128² texels per block). To be read from `Terrain.bterr` HEAD (u32 width, u32 height, f32 cell at
  offset 16) instead of hardcoding 32/4. File `<prefix><id>.ttile`, id = ty × 32 + tx;
  `.Data/` (ttile, _layer.edds) and `.EditorData/`; block row 0 = south (image flip).
- `.ttile` chunks: VERS, HGHT (33,282 bytes = 129 × 129 u16 probable, unverified), BERR, GCTD, LRS2, TMAT.
- No "tiles touched by an area" function: to be written (like AFG's `polygon_tiles.txt`).
- **Terrain analysis to port to TS** (terrain_algorithms.py): slope and aspect (`np.gradient`), Zevenbergen-Thorne
  3×3 curvature, TPI (box mean, radii 100 m / 500 m, normalized p1–p99), roughness
  (20 m standard deviation) → direct port. To be replaced by better: basin filling (skimage
  reconstruction → Barnes 2014 priority-flood), D8 flow (Python loop → typed arrays), distance to
  the coast (Felzenszwalb EDT).
- **Sea / coast**: sea = h ≤ 0 **connected to the map edge** (excludes inner depressions), 40 m coastal
  band with gradient. No lake polygons or rivers: only D8 accumulation.

### Test 2 (2026-10-15, `MG_TerrainTest2Plugin`, reference: mast `MG_TerrainTestMarker` at 1104 / 2832)

- `ModifyHeightMapUserShape(x, z, EXACT, HeightExact{fExactHeight=60, fOuterSize=32}, 32×32 pyramid
  0→1, BILINEAR)`: peak 59.3 m, 49.4 m at mid-slope, ground untouched (39 m) at 64 m.
  ⇒ the array covers ±fOuterSize cells (32 × 2 m = 64 m half-width) and each value is a
  **blend weight**: h = ground + w × (fExactHeight − ground). To impose an arbitrary grid:
  to be tested `ADD` + `HeightAdd{fAdd=1}` with array = (target − ground) in meters.
- `ModifyLayers(SURFACE_PAINT, LayerAdd{pMaterial=Rock_01, fAddNormalized=1, fOuterSize=16})`:
  call accepted (`begin=1`), rendering to be confirmed visually (64 m square at 60 m west of the mast).
- ⚠ **Unsaved** terrain modifications are lost when scripts reload
  (the 48 m plateau from test 1 disappeared) → always `wb_save` before compiling.

## Terrain surfaces: what works (validated 2026-10-15 on Mapgenerator/Worlds/TestWorld)

- **World ↔ terrain convention**: `Worlds/X.ent`, `Worlds/X_Layers/`, `Worlds/X/X.terr` (+ `.Data/X_*`,
  `.EditorData/`), and the layer entity is named `GenericTerrainEntity X` (the name designates the folder).
- **Surface map**: an imported terrain may not have one (Info & Diags: "Surface Mask n/a") →
  painting crashes. Manage → *Change surface map size…* (256 = 1 m/texel on a 256 m tile) initializes it without
  crashing. Effect on disk: `TerrainSurfaceBits 8` in the `.terr.meta`, one byte of `TEXS` goes to 1.
- **Surface list** = `MATS` chunk of `X.terr` (IFF: `FORM` + BE size, `TERR`, name chunks + BE size).
  Body: 2 bytes (`08 00`), then entries `u32 LE length (with \0)` + `{GUID}path.emat\0`. The Paint panel
  only writes it after a surface has been used; **writing it ourselves, with the world closed, works**: 51 vanilla
  surfaces present on reopening. List exported by the *MapGen - Register surfaces* plugin
  (`$profile:MapGen/surfaces.txt`).
- **Painting by script: crashes** (`Material.GetOrLoadMaterial(res, 0)` → "Material cannot create clone
  for 0x0 creation flags", then access violation in `ModifyLayers`). Undocumented flags. Still to
  test: mask import (Paint → Import/export masks) or `_layer.edds` writing.
- **ModifyHeightMapUserShape**: EXACT = weight (h = ground + w·(H − ground)) ✔; ADD ≈ one brush stroke
  (+0.6 m for 20 requested) ✘ → arbitrary terrain in 2 EXACT passes (raise H = max, lower H = min).
- **Do not query the NET API while a Workbench modal window is open** (crash in `GetResponse`):
  the site no longer polls automatically.

### Creating a new terrain (validated 2026-10-15, Mapgenerator/Worlds/MG_Test)

1. New World (Base scene) → place `{221ABC927C672E4E}Prefabs/World/DefaultWorld/GenericTerrain_Default.et`
   at 0 0 0, name = world name, Ctrl+S → right click "Create new terrain…".
2. New Terrain window = the future form of the site: name; grid (multiple of 128 = tile); blocks per
   tile (4); cell (m); Height scale (0.03125 m → 2048 m range); "Zero" (10% → −205..+1843 m);
   Surface layer weight bits: **8 bits = 5 surfaces/block** (fine blending, BI default) or **5 bits = 7 surfaces**.
3. World closed → `POST /surfaces` (bridge): 51 vanilla surfaces in `MATS` + `TEXS` byte → on
   reopening, no "Init Surface Map" window, direct painting OK.
   Note: `TEXS` of a new terrain = 6 bytes at 0 (the imported island had `00 01 00 01 00 00`).
4. Terrain: Manage → Import height map accepts `.asc` and 16-bit PNG (min/max resampling) → main
   route for the site (real or mapgen4); EXACT by script for touch-ups.

## Surface masks (Paint → Import/export masks)

- One PNG per surface, named like the .emat (`Grass_01.png`), 8-bit grayscale, one image for the whole terrain.
- Size = TilesCount × 252 + 1 (MG_Test 16 tiles → 4033 px, ≈ 1.016 m/px). Value 0..255 = surface weight.
- **Row 0 = NORTH** (max z), column 0 = west. Verified on MG_Test (2026-10-15).
- The import takes a folder; surfaces without a PNG are reported as missing (harmless warning).
- Painted tiles that are not saved make loading `<name>_<t>_layer.edds` fail on export: Ctrl+S first.

## To do: roads drawn on the site

- Road = spline with a road generator (like hedges), road prefab on the spline.
- Under the road: Asphalt surface mask (core) + Dirt (edges, blended), written in /masks.
- Satellite map: same drawing colored (gray asphalt, dirt edges) for the distant view.
- 3D grass (clutter) comes from the painted surface, not from the satellite map: painting asphalt under the road
  removes the grass that shows through the prefab.

## Fictional terrain on the site (2026-10-15)

mapgen4 functions (Amit Patel, Apache-2.0) redone on our grid, without reusing its code
(Delaunay mesh + WebGL unsuited to the grid → bridge pipeline):
- `src/modules/island.ts`: islands (count, land share, seed), sea depth, surfaces by altitude/slope.
- Brush (site): raise, dig, flatten, sea, smooth — on `baseHeights`.
- `src/modules/hydro.ts`: wind-modulated rainfall (exposed slopes), priority-flood (basins drained),
  D8 directions, accumulation, carved bed + `Pebbles_01` surface. Rivers are recomputed on demand
  from `baseHeights` (no cumulative carving).
To do: river water (river prefab on a spline from the trace), biomes by rainfall.

## Coasts and sea level (site, 2026-10-15)

- Base surfaces (51, `Terrains/Common/Surfaces/`): no sand or seaweed as a surface. Seaweed = objects
  (`Prefabs/Vegetation/Core/Seaweed_Base.et`, rocks `GraniteBeachStone_*_Fucus`), strandline = decals
  `Assets/Decals/Stones/Beach/Beach_NatureDebris_*` → future scattering engine.
- Rules (`computeSurfaces`): < −3 m SeaBed_01; −3..+1 Pebbles_02; +1..+4 BeachGrass_01; +4..+10
  Grass_03_coastal; steep slope Rock_01, coastal cliff foot Debris_Rock_01; river bed Pebbles_01.
- `limitPerBlock`: 5 surfaces max per 64 m block (256 m tile / 4 blocks, 2 m cell) — to be adjusted if the
  terrain grid changes. Removed surfaces go to the strongest kept one.
- Sea level: the game's sea stays at 0 m, the site lowers/raises the whole terrain.

## To do: multi-user work on the site

The Workbench only allows one person per terrain (tiles "claim/release" only). The site can
carry the collaboration, with the Workbench only receiving the result:
- Shared project = site state (macro-terrain, rivers mask, zones, roads, parameters) synchronized
  between browsers (lightweight WebSocket server or CRDT such as Yjs; to be chosen).
- Locks per zone / per layer (terrain, rivers, countryside, roads) rather than per tile, with the cursors
  and brushes of the others visible live.
- Brush strokes are replayable operations (tool, position, radius, strength) → history,
  per-person undo, simple merging.
- Only one workstation "publishes" to the Workbench (local bridge): terrain, masks, satellite, shapes.
- **"Notes" tab (shared annotations)**, a separate layer, never sent to the Workbench:
  - draw freehand lines, proposed road traces, zones (polygons);
  - put text on the map (label anchored to a point);
  - each note has an author, a date, a color per person, a status (idea / accepted / done / rejected);
  - comment thread per note: others reply to the idea, react, mark it "done";
  - list of notes in the panel (filter by author / status), click = center the map on it;
  - "convert to road / to countryside zone" action to turn a proposal into the real layer;
  - visible over all tabs, hideable with one click.

## To do: towns (after roads)

References given by Benji (ideas only, no code reused):
- https://www.fantasytowngenerator.com/temporary-settlement
- https://fantasygen.net/city-map-generator
- Video https://www.youtube.com/watch?v=UmUs9W4riPs and Fab tool https://www.fab.com/listings/013f192b-caf4-422f-b560-5166f8c6d9b8
  (procedural town system to recreate on the site + plugin side).

Leads: library of vanilla building prefabs (footprint, type, role), blocks cut along the
road network, parcels oriented toward the street, density center → periphery.
- https://maps.probabletrain.com/ (ProbableTrain MapGenerator): road network by **tensor field**
  (blended grids + radials, avoiding water), main roads then secondary, blocks, extruded
  buildings. License to be checked before any reuse: ideas only by default.
- https://simteract.com/projects/city-generator/ (Simteract): town generator for simulation
  (hierarchical road network, typed districts, buildings placed according to the zone). Ideas only.

## To do: roads from real data

- Reference: https://mapimator.com/tools/city-roads (same principle as anvaka/city-roads): roads
  downloaded from **OpenStreetMap via the Overpass API** (`way[highway]` in an area), then drawn.
- For us: Overpass query on the chosen area → sort by `highway` (motorway/primary/secondary →
  asphalt, track/path → dirt, residential → town streets) → projection to meters on the terrain →
  simplification (points every ~25 m) → same `Road` as the manual trace (terrain, masks, splines).
- OSM attribution mandatory (ODbL) if OSM data ends up in a published map.
