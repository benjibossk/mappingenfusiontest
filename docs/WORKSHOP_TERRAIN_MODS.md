# Workshop terrain tooling mods: detailed state of the art (2026-10-14)

Sources: paks downloaded via SteamCMD and the dedicated server, extracted with a local .pak extractor.
All 26 files were read in full: 18 `.c`, 1 `.conf`, 2 `.emat`/`.edds`, 1 `.ent`, 1 empty `.layer` and 1 `.claude/settings.local.json`.
**No licence or author is indicated.** We can study these sources and draw ideas from them. We do not copy the code: the excerpts below are at most 10 lines long and are cited with `file:line`.

Convention: `TAT/` = `TerrainAutomationTools/Scripts/WorkbenchGame/`, `ATT/` = `AdvancedTerrainTools/scripts/WorkbenchGame/AdvancedTerrainTools/`, `OTC/` = `OutsideTerrainCore/Scripts/Game/`. Line numbers are those of the original files.

**Cross-cutting finding (verified on our side, see ENFUSION_FORMATS §1)**: a shape point whose Y is not the real terrain height prevents the generators (FG/PG) from generating. None of these mods creates a shape or a generator. However, all of them re-snap the entities' Y with `GetTerrainSurfaceY`, and this is the same pattern we need for ShapePoints.

---

## 1. AdvancedTerrainTools (6874E07B40C6D5E5)

### 1.1 Point Cloud Import Tool: `ATT/ATT_XYZImportPlugin.c`
- **Purpose**: place prefabs (trees, debris) from an `.xyz` point cloud exported by Gaea.
- **Declaration**: `[WorkbenchPluginAttribute(name:"Point Cloud Import Tool", category:"Advanced Terrain Tools", wbModules:{"WorldEditor"}, awesomeFontCode:0xF074)]` on `class PointCloudImportPlugin : WorldEditorPlugin` (l.2-8). No `shortcut`. It is a menu plugin, not a panel tool.
- **Parameters** (l.10-36):

| Attribute | Default | Category | Note |
|---|---|---|---|
| `m_sImportDataFilePaths` (array<string>, FileNamePicker `xyz`) | — | Import | several files |
| `m_fRandomPositionOffset` | 5 m | Import | XZ jitter to break the grid |
| `m_fSkipChance` | 0 | Import | described as a "percent", but compared against `RandomFloat01()`, so it needs a fraction from 0 to 1 |
| `m_bSnapAllToGround` | true | Terrain Heightmap Import Settings | |
| `m_iTerrainSize` | 1024 (128 to 16384) | same | terrain side in m |
| `m_iTerrainHeight` | 2048 | same | Gaea height |
| `m_bTerrainFlipX` / `m_bTerrainFlipZ` | false / true | same | must mirror the heightmap import |
| `m_aObjects` (array<`ATT_PointCloudObjectImportData`>) | — | Objects | see l.287-319 |

  Each object has: `m_Prefab`, `m_fWeight` (1.0, range 0 to 1), `m_fMinScale` 0.8, `m_fMaxScale` 1.2, `m_fMaxRandomYawAngle` 360, `m_fMaxRandomPitchAngle` 0, `m_fMaxRandomRollAngle` 0, `m_fMin/MaxVerticalOffset` 0, `m_bRelativeY` true.
- **Algorithm**:
  1. `Run()` opens a `Workbench.ScriptDialog(...)` on `this`. The `[ButtonAttribute("Import", true)]` button returns 1 and starts `ImportData()` (l.45-51, 273-277).
  2. It computes the cumulative weights once (l.84-101).
  3. `BeginEntityAction()` then `layerID = GetCurrentEntityLayerId()` (l.104-110).
  4. For each file: `FileIO.BeginParse(path)`, then an infinite loop `parser.ParseLine(line, tokens)` that stops when `numTokens < 1`. A line must contain exactly 3 tokens (l.128-155).
  5. Scaling: `x = t0*size`, `y = t2*height`, `z = t1*size`. The Gaea format is therefore normalised from 0 to 1, with the height in the 3rd column (l.158-161).
  6. Jitter, then flips `p = -p + size` (l.164-174). If snap, `y = 0` (l.176-177).
  7. Linear weighted draw over the cumulative weights (l.181-197). Random yaw, pitch and roll with `Math.Repeat(...,360)`, random scale (l.204-220).
  8. **Two-pass creation** ("batch"): the arrays are filled first, creation follows (l.226-258). If `m_bRelativeY`, then `y = GetTerrainSurfaceY(x,z)`. The prefab is created with `CreateEntity(prefab, "", layerID, null, pos, angles)`, the scale set with `SetVariableValue(src, null, "scale", s)`.
  9. A single `EndEntityAction()` (l.261), then a summary dialog (l.264-267).
- **Pitfalls and bugs**:
  - `m_fSkipChance >= 1` creates an **infinite loop**: the skip's `continue` (l.139-143) comes before `ParseLine`, so the end condition is never evaluated.
  - The vertical offset always uses `cachedObjects[0]` instead of the drawn object (l.238).
  - Snap enabled with `m_bRelativeY=false`: the object stays at absolute Y=0 (l.176 and 232).
  - The `RELATIVE_Y` prefab flag is not handled (unlike TerrainUtils, §3.1). RELATIVE_Y prefabs receive the absolute height as an offset.
  - Everything happens in a single undo action, with no chunking. The author advises to "split the file" (l.47).
  - Snap makes one `GetTerrainSurfaceY` call per point: fine, but not for millions of points.

### 1.2 Heightmap Analyzer: `ATT/ATT_HeightmapAnalyzer.c` + `ATT_PythonHelper.c`
- `[WorkbenchPluginAttribute(name:"Heightmap Analyzer", category:"Advanced Terrain Tools", awesomeFontCode:0xF074)]` on `ATT_HeightmapAnalyzerPlugin : WorldEditorPlugin` (l.2-8).
- **Parameters**: `m_sHeightmapPath` (png, absolute path), `m_iTargetScale` = 2048, `m_sPythonExecutable` (optional).
- **How it works**:
  - The path is resolved by `SCR_AddonTool.ToFileSystem("AdvancedTerrainTools") + "ExternalScripts/heightmap_analyzer.py"` then `Workbench.GetAbsolutePath(virt, abs, true)` (l.26-31).
  - The helper then launches `Workbench.RunProcess("cmd.exe /k python \"script\" args")` (`ATT_PythonHelper.c:23-37`) and returns a `ProcessHandle`.
  - Cancellation goes through `Workbench.IsRunningProcess` and `KillProcess` (l.75-77).
- **The `.py` is missing from the pak**: the tool therefore does not work as is. The pattern remains useful: **launch an external process from Workbench**, for example our Node CLI.
- `Configs/.../AtlasII_WorldEntitySetup.conf`: a list of `SCR_WorldSetupPluginConfig_Entity` (terrain, light, fog, post-process, weather, destruction, camera) for the vanilla "World Setup" plugin.

## 2. OutsideTerrainCore (61F0D506562D9BC9): off-map terrain
- `OTC_OutsideTerrainChunkEntity : GenericEntity`, with `[EntityEditorProps(category:"Outside Terrain Core/Chunk")]` (`OTC/Entities/OTC_OutsideTerrainChunkEntity.c:1-6`).
- **Attributes**: `m_fWidth` 128, `m_fHeight` 128, `m_iResolution` 4 (from 2 to 33), `m_aHeights` (array<float>), `m_bEnableCollision` false, `m_ePhysicsLayerPreset` Terrain, `m_Material` `{FCDCBAF69074F24C}…DefaultMaterial.emat` (l.8-27).
- **Construction** (at runtime, in the constructor, l.97-111):
  - `OTC_Mesh` generates a res×res grid. The `MAX_RESOLUTION = 33` cap, i.e. **one Enfusion terrain block**, sets the size of the static arrays (`OTC/OutsideTerrainCore/OTC_Mesh.c:3-6`).
  - The mesh API is `MeshObject.Create(1, numVerts, numIndices, materials, 0)` → `UpdateVerts(0, verts, uvs)` / `UpdateIndices` → `SetObject(meshObject,"")` (l.55-63).
  - Collision goes through `PhysicsGeom.CreateTriMesh` → `PhysicsGeomDef("Terrain", geom, material, 0xffffffff)` → `Physics.CreateStaticEx(this, defs)` (l.78-82).
- **Bug**: `_x = (x / zeroBasedResolution - 0.5) * width` with two `int`s (`OTC_Mesh.c:36,38,42-43`). Integer division collapses all columns except the last onto −0.5·width. The mesh is therefore degenerate, unless the engine promotes the expression to float.
- **Interest for us**: low (horizon scenery). The only idea worth keeping: a 33×33-vertex runtime mesh, fed by a height array, could serve as a preview. Out of scope.

## 3. TerrainAutomationTools (684876344DA83476)
The mod contains 11 `WorldEditorTool`s (World Editor side panel), plus the `TerrainUtils` utility.
- **Common declaration**: `[WorkbenchToolAttribute(name, description, wbModules:{"WorldEditor"}, awesomeFontCode)]`. **No `shortcut`** or category in any tool. Categories only exist at the `[Attribute(category: …)]` level.
- **Common parameter**: `m_iVerbosity` (0 = Silent, 1 = Normal, 2 = Verbose).
- The pak contains a `.claude/settings.local.json` (permissions `dir`, `ls`, `find`, `mcp__filesystem__*`): the mod was written with Claude Code.
- `worlds/Arland/Test.ent` is a SubScene of `{C7DC72AF0AE17724}worlds/Arland/EmptyArland.ent`, with an empty `default.layer`.

### 3.1 `TAT/TerrainUtils.c`: the shared toolbox
| Function | Lines | Detail |
|---|---|---|
| `GetTerrainNormal(api,x,z,d=0.5)` | 19-35 | 5 `GetTerrainSurfaceY` calls (centre + 4 neighbours), central differences, normal = `(-dh/dx, 1, -dh/dz)` normalised. The central sample is unused. |
| `GetSlopeAtPoint` | 38-44 | `acos(normal.y)` in degrees |
| `IsAboveWater(world,x,z)` | 57-62 | `world.GetSurfaceY >= world.GetOceanHeight`: **the ocean only**, the lakes and rivers of the generators are not seen |
| `IsPositionValid` | 64-83 | water, then altitude (-500..5000), then slope |
| `IsInsideCircle/Rect/RotatedRect` | 90-119 | XZ tests, with rotation by −angle |
| `WeightedRandom(array<float>)` | 128-152 | sum, draw, linear accumulation. Returns −1 if all weights are zero. |
| `GetTerrainAlignedAngles(n,yaw)` | 160-184 | frame `right = fwd×n`, `fwd = n×right`, then `Math3D.MatrixToAngles` |
| `CatmullRom(p0..p3,t)` | 193-209 | Uniform Catmull-Rom (factor 0.5) on **XZ only**, Y=0 |
| `CatmullRomTangent` | 213-226 | analytic derivative |
| `CatmullRomSegmentLength(...,16)` | 230-244 | length via 16 sub-segments |
| `ValueNoise2D(x,y,seed)` | 252-273 | value noise: hash of the 4 corners, smoothstep `3t²-2t³`, bilinear |
| `FBM(x,y,oct=4,lac=2,gain=0.5,seed)` | 277-293 | sum of octaves `(noise*2-1)*amp`, seed+i per octave, normalised by Σamp, over [−1,1] |
| `HashFloat` | 296-308 | xor-shift integer hash (`374761393`, `668265263`, `1274126177`), then `abs` and `mod 10000`: **1e-4 precision** |
| `SpawnEntity(api,res,pos,yaw,scale,align)` | 320-368 | central point of all the tools (see below) |
| `GetRandomScale` | 376-389 | handles min>max and min==max, because `RandomFloat(a,a)` crashes according to the comment at l.375 |
| `Log` | 402-417 | filters according to verbosity |
| `GetSelectionBounds` | 425-451 | AABB of the selection's origins |

**`SpawnEntity`, the entity creation recipe** (l.320-368):
1. `layerId = api.GetCurrentEntityLayerId()`.
2. `api.CreateEntity(res, "", layerId, null, spawnPos, vector.Zero)`. The comment at l.325 says to avoid `CreateEntityExt` because of its unwanted terrain alignment.
3. Read `src.Get("Flags", flags)`. If `flags & EntityFlags.RELATIVE_Y`, Y becomes `spawnY - GetTerrainSurfaceY` (l.334-342).
4. Explicit `SetVariableValue(src, null, "coords", "x y z")` (l.345).
5. Angles: if aligned, normal then `GetTerrainAlignedAngles`. Otherwise `angles[0]=yaw`. Written with `SetVariableValue(src,null,"angles", "%1 %2 %3" (a[1],a[0],a[2]))`, i.e. the permutation of the `MatrixToAngles` output to "pitch yaw roll" (l.361).
6. `scale` is only written if ≠ 1, to keep the source clean (l.364-365).

Cost: about 1 creation and 2 to 3 `SetVariableValue` per entity, plus 5 height reads if alignment is active.

### 3.2 Auto-Decorator: `TAT/AutoDecorator.c` (+ `AutoDecoratorPalette.c`, `AutoDecoratorPreset.c`)
- `[WorkbenchToolAttribute(name:"Auto-Decorator", awesomeFontCode:0xF1BB)]` on `AutoDecoratorPlugin : WorldEditorTool` (l.22-29). Constants: `POISSON_ATTEMPTS = 30` (l.35).
- **Parameters** (l.40-166), by category:
  - **Quick Presets**: 4 slots `m_ForestMedium`, `m_ForestSmall`, `m_RockBoulder`, `m_VillageBuilding`.
  - **General**: `m_iPreset` 0 (Forest, Rocks, Village, Custom List, Palette), `m_iMaxCount` −1, `m_bUseSelection` true.
  - **Area**: `m_iAreaMode` 0 (Circle, Rectangle, Selection Box), `m_fRadius` 50, `m_fRectWidth/Length` 100.
  - **Spacing**: `m_fMinDistance` 5, `m_bGroundSnap` true, `m_bUseCameraHeight` false, `m_fHeightOffset` −1.0, `m_bAutoAdjustHeight` true, `m_bAvoidExisting` false.
  - **Terrain Filter**: slope 0..45°, altitude −500..5000.
  - **Density**: `m_iFalloffMode` 0 (Uniform, Center, Edge, Gaussian).
  - **Scale**: 0.8..1.2.
  - **Custom List** (`AutoDecoratorCustomPrefab`) and **Palette** (`AutoDecoratorPaletteEntry`: weight 1, scale 0.8..1.2, `m_fMinDistanceOverride` −1, `m_fHeightOffset` 0, `m_bAlignToSlope` false, slope 0..90).
  - **Advanced**: `m_iBatchSize` 0.
  - **Presets**: name and index.
- **Buttons**: `Generate Decoration`, `Save Preset`, `Load Preset`, `Delete Preset`, `List Presets` (l.209-315).
- **Algorithm** (`PerformGeneration`, l.321-391):
  1. Configuration and validation: inverted min and max bounds are swapped (l.488-519).
  2. Centre: depending on the mode, centre of the selection's AABB (with caching, then `ClearEntitySelection`), selected entity, or camera (`m_World.GetCurrentCamera(mat)`, with Y = `GetSurfaceY`) (l.522-581).
  3. **Poisson disk (Bridson)**: cell `minDist/√2`, index grid initialised to −1, first point at the centre ±0.1, 30 attempts per active point in the [d, 2d] annulus, 5×5 neighbourhood test (l.924-990 for the circle, l.996-1069 for the rectangle, l.1075-1128 for the neighbourhood).
  4. **Falloff** by keep probability: centre `1−r`, edge `r`, Gaussian `e^(−3r²)`. The distance is radial for the circle, Chebyshev for the rectangle (l.875-918).
  5. **Per-point filter**: water, altitude, global slope, then `QueryEntitiesBySphere(minDist/2)` if `AvoidExisting` (l.638-671).
  6. **Palette**: entries eligible according to their slope are drawn by weight (`WeightedRandom`). The distance override only applies if `AvoidExisting` (l.726-772).
  7. **Height**: `GetTerrainSurfaceY` if snap (otherwise `World.GetSurfaceY`, which includes objects), plus offset, plus `−0.5·scale` if `AutoAdjustHeight` (l.823-843). Result: −1 − 0.5·s by default, so **the object is sunk by 1.4 to 1.6 m**.
- **Undo**: `bool manage = BeginEntityAction("Auto-Decorate Generation")`. If `m_iBatchSize > 0`, the loop does `End` then `Begin("Auto-Decorate Batch")` every N objects (l.634, 692-697). Each batch becomes a separate Ctrl+Z.
- **Presets**: file `$profile:AutoDecoratorPresets_v2.txt`, in a home-made INI with `PresetCount=`, `[Preset]`, `key=value`, `[PaletteEntry]`, `[EndPreset]` (l.1134-1231, `AutoDecoratorPreset.c:73-111`).
  - I/O: `FileIO.OpenFile(path, FileMode.WRITE/READ)`, `WriteLine`, `ReadLine(line) > 0`.
  - Preset defaults: `AutoDecoratorPreset.c:49-68`.
- **Pitfalls**:
  - In Palette mode, the global scale and min-distance are ignored for the scale, but not for the Poisson sampling.
  - The collision check takes any object, including non-physical entities (no `GetPhysics` filter, unlike BiomePainter).
  - The Poisson grain is global: an entry with a smaller override does not densify.
  - There is no seed: generation is not reproducible.

### 3.3 Terrain Randomizer: `TAT/TerrainRandomizer.c`
- `[WorkbenchToolAttribute(name:"Terrain Randomizer", awesomeFontCode:0xF074)]` on `TerrainRandomizerTool` (l.47-54).
- **Zones** (`enum TerrainZone`, l.19-27): FLAT_OPEN, FLAT_LOW, GENTLE_SLOPE, MODERATE_SLOPE, STEEP_SLOPE, WATER_EDGE.
- **Parameters** (spacing / density per zone, l.59-170):

| Zone | Spacing | Density |
|---|---|---|
| Flat Open | 15 | 0.3 |
| Flat Low | 4 | 0.6 |
| Gentle | 7 | 0.8 |
| Moderate | 6 | 0.5 |
| Steep | 10 | 0.3 |
| Water Edge | 3 | 0.7 |

  Global parameters: `m_fWaterProximity` 15, `m_fRadius` 100 (10..2000), `m_iMaxObjects` 5000, scale 0.7..1.3, `m_bAlignToSlopeAbove15` true, `m_fNoiseScale` 0.05, `m_fNoiseInfluence` 0.4, `m_fLowAltitudeThreshold` 5, `m_bAvoidExisting` false.
- **Classification** (`ClassifyPoint`, l.344-371):
  1. Underwater: FLAT_LOW.
  2. Near water, probed by 4 `IsAboveWater` tests at ±proximity/2 (l.374-381), and slope < 15°: WATER_EDGE.
  3. Slope ≥ 40: STEEP, ≥ 20: MODERATE, ≥ 5: GENTLE.
  4. Otherwise, altitude < centre altitude − 5 m: FLAT_LOW. Otherwise FLAT_OPEN.
- **Preliminary analysis**: grid with step `radius/10` (at least 2 m), count per zone and report (l.303-341, 694-718). The `Analyze Area (Preview Only)` button performs the analysis alone.
- **Generation** (`GenerateAll`, l.387-511):
  1. Grid with the step of the **finest spacing** among the filled zones, with a jitter of ±0.4·step.
  2. For each point: circle test, water test, then classification.
  3. **Probabilistic spacing**: the point is kept with probability `(step/zone_spacing)²`.
  4. Density: `rand > density` rejects.
  5. **Noise**: `n = FBM(x*scale, z*scale, 3 oct, lac 2, gain 0.5, seed)`, then `f=(n+1)/2`, `threshold = 1 − influence·(1−f)`, and rejection if `rand > threshold` (l.469-479).
  6. Alignment if slope > 15°. Creation via `TerrainUtils.SpawnEntity`, then selection of all the created entities (l.287-295).
- **Pitfalls**:
  - Cost per candidate: classification makes 1 + 5 + 4 to 8 reads (height, slope, water), and the slope is recomputed for the alignment.
  - There is no real minimum distance between objects, only a jittered grid.
  - The noise seed is random on every click (l.264).

### 3.4 Elevation Band: `TAT/ElevationBandTool.c`
- `[WorkbenchToolAttribute(name:"Elevation Band", awesomeFontCode:0xF6FC)]` on `ElevationBandTool` (l.98-105).
- **`ElevationBand` class** (l.16-94): name, `m_fAltMin` 0, `m_fAltMax` 100, prefabs (`TerrainZonePrefab`), `m_fSpacing` 5, `m_fDensity` 0.5, alignment false, scale 0.8..1.2.
- **Tool**: `m_fRadius` 100 (10..5000), `m_iMaxObjects` 5000, noise 0.05 / 0.3.
- **`Load Default Bands` button** (l.173-224):

| Band | Altitude | Spacing | Density |
|---|---|---|---|
| Shore | 0-5 | 3 | 0.7 |
| Lowland | 5-50 | 8 | 0.6 |
| Midland | 50-200 | 6 | 0.8 |
| Highland | 200-500 | 10 | 0.5 |
| Alpine | 500-5000 | 15 | 0.3 |

- **Algorithm** (l.229-417): identical to the Randomizer (grid at the finest step, 0.4 jitter, probabilistic spacing, density, FBM). The selection takes the **first matching band** (l.322-333).
- **Pitfalls**: no slope filter, and prefabs drawn uniformly, without weights.

### 3.5 Biome Painter: `TAT/BiomePainterTool.c` + `BiomePainterConfig.c`
- `[WorkbenchToolAttribute(name:"Biome Painter", awesomeFontCode:0xF5A7)]` (l.18-24).
- **Constants**: radius 5..500 (step of 2), density 0.1..3, `PAINT_SPACING_RATIO = 0.4` (l.29-36).
- **Parameters**: `m_fBrushRadius` 30, `m_fBrushDensity` 1.0, `m_iBrushFalloff` 1 (Hard, Soft, Natural), `m_iBiomeType` 0..6, `m_aLayers` (`BiomeLayer`), `m_bAvoidExisting` true, noise 0.02 / 0.3, `m_iMaxPerStroke` 200.
- **`BiomeLayer`** (`BiomePainterConfig.c:15-122`): `m_aPrefabs` and `m_aWeights` are two parallel arrays. It also holds `m_fMinDistance` 5, `m_fDensityMultiplier` 1, slope 0..90, altitude −500..5000, scale, alignment, offset.
- **Six templates** (`BiomePainterConfig.c:183-441`), each layer being given as (min distance / multiplier / max slope):
  - Dense Forest: Canopy (8 / 1.0 / 25°), Understory (4 / 0.7 / 30°), Clutter (3 / 0.4 / 35°, aligned).
  - Light Woodland: 15 / 0.6, 5 / 0.5, 2.5 / 0.3.
  - Rocky Hillside: large rocks with slope from 10 to 60°, small ones from 5 to 70°.
  - Meadow: trees at 30 m, density 0.2, slope ≤ 15°.
  - Riverside: max altitude 100 and 50 m for the reeds.
  - Village Edge: slope ≤ 8 to 10°.
- **Interaction**:
  - Left click: `BeginEntityAction("Biome Painter Stroke")`, then painting every 0.4·radius while dragging, and `EndEntityAction` on release. **One stroke = one undo** (l.178-243).
  - Ctrl+wheel adjusts the radius, Shift+wheel the density, with `UpdatePropertyPanel()` (l.247-264).
  - Holding Space switches to eraser mode. Keys 1 to 6 change the template (l.269-299).
  - Preview: `CreateCircle(pos, vector.Up, r, color, 50, ShapeFlags.NOZBUFFER)` (l.317).
- **`PaintLayer`** (l.352-482):
  1. `maxPoints = πr²/d² · density`, capped by the remainder of the stroke's quota.
  2. Up to 3·maxPoints attempts. Each attempt draws a uniform point in the disk (`√rand·r`).
  3. Falloff: linear `1−r`, or Gaussian `e^(−3r²)`.
  4. Rejection by FBM noise, then by water.
  5. The layer's slope/altitude filter.
  6. Minimum distance via a local hash grid (5×5).
  7. `QueryEntitiesBySphere`, whose callback ignores the terrain and entities without `GetPhysics()` (l.586-600).
  8. Creation.
- **Pitfalls**:
  - The anti-neighbour grid is recreated on every call: there is **no spacing between two successive stamps nor between layers**, only `AvoidExisting` guarantees it.
  - Keys 1 to 6 do not replace the layers if they are already filled (l.616-641). Changing biome therefore has no effect after the first setup.
  - The eraser deletes everything that is not terrain, without a filter (l.535-569).

### 3.6 Density Painter: `TAT/DensityPainterTool.c`
- `[WorkbenchToolAttribute(name:"Density Painter", awesomeFontCode:0xF043)]` (l.17-22).
- **Parameters**: radius 30, `m_iMode` 0 (Thin, Thicken), `m_iThinPercent` 30, `m_fThickenMinDist` 5, `m_fThickenDensity` 0.5, scale 0.8..1.2, `m_bSkipTerrain` true.
- **Thin** (l.289-349): `SCR_WorldEditorToolHelper.QueryEntitiesBySphere(world, c, r)`, then `EntityToSource`. Partial Fisher-Yates, `DeleteEntity` on the first k. At least 1 deletion per stamp.
- **Thicken** (l.354-458): collects the unique `GetResourceName()`s present in the brush, then draws uniform points in the disk. Rejected if underwater or if `QueryEntitiesBySphere(minDist)` finds something. Upright creation, without alignment.
- **Pitfalls**:
  - Space toggles the mode on press then toggles it back on release (l.222-251).
  - Thin acts on **all** entities, including buildings.

### 3.7 Entity Eraser: `TAT/EraserTool.c`
- `[WorkbenchToolAttribute(name:"Entity Eraser", awesomeFontCode:0xF12D)]` (l.15-22).
- **Parameters**: radius 20 (1..500), `m_iFilterMode` (All, Name Contains, Current Layer Only), `m_sNameFilter`, `m_bSkipTerrain`, `m_iMaxPerStroke` 200.
- **It is the most "defensive" tool** (l.222-310):
  - it skips `GenericTerrainEntity` and **`GenericWorldEntity`** (deleting the latter corrupts the world, l.267-269);
  - it skips locked layers via `IsEntityLayerLockedHierarchy(src.GetSubScene(), src.GetLayerID())` (l.277-279), which protects the read-only parent world of a subscene;
  - it deletes **in batch** with `m_API.DeleteEntities(toDelete)` (l.307);
  - it caps deletions per stroke.
- If the mouse release was missed, the next press first closes the action left open (l.147-151).

### 3.8 Forest Featherer: `TAT/ForestFeathererTool.c`
- `[WorkbenchToolAttribute(name:"Forest Featherer", awesomeFontCode:0xF1B3)]` (l.18-23).
- **Parameters**: `m_fFeatherDepth` 15 m, `m_iThinPercent` 50, `m_fEdgeScaleFactor` 0.6, `m_bGradualScale` true, `m_bSkipTerrain` true.
- **Edge detection** (l.90-163):
  1. For the selection (at least 3 entities), we count the neighbours within `depth` in XZ (**O(n²)**), then compute the average (at least 1).
  2. An entity is **an edge** one if `neighbours < 0.6 · average` (l.174, 196).
- **Processing** (l.190-243):
  1. Each edge entity is deleted with probability `thin%`.
  2. Otherwise, the current scale is read with `src.Get("scale", str)` then multiplied by `f = edge + (n/avg)·(1−edge)` in gradual mode, or by `edge`. It is rewritten with `SetVariableValue(...,"scale",...)`.
- The `Preview Edge Detection` button only counts.
- **Pitfalls**:
  - The O(n²) cost quickly becomes prohibitive: 10,000 trees give 10⁸ tests.
  - The 0.6 factor is hard-coded.
  - The result depends on the selection: a partial selection creates false edges.

### 3.9 Path Decorator: `TAT/PathTool.c` (+ `PathToolPrefab.c`)
- `[WorkbenchToolAttribute(name:"Path Decorator", awesomeFontCode:0xF55B)]` on `PathDecoratorTool` (l.20-27).
- **Constants**: preview over 20 subdivisions, length over 16.
- **Parameters**: `m_iPathMode` 0 (Spline, Wall), `m_fPathWidth` 4.5, `m_fSpacing` 4.0, `m_fDensity` 0.8, `m_fBBoxOffset` 0, weighted prefabs (`PathToolPrefab`: weight 1, scale 0.8..1.2), `m_iRotationMode` 0 (Along, Perpendicular, Random), `m_fYawJitter` 0, `m_bAlignToSlope` false, global scale 0.8..1.2, `m_fHeightOffset` 0, `m_iRows` 1 (1..7), `m_fRowJitter` 0, slope 0..45, `m_bAvoidWater` true.
- **Input**:
  - `OnMousePressEvent`: `m_API.TraceWorldPos(x, y, TraceFlags.WORLD, start, end, dir)`. Left click adds a waypoint, right click removes the last one, as do Delete and Backspace (l.152-195).
  - Preview: `Shape.CreateLines(color, ShapeFlags.NOZBUFFER, pts, 2)` and circles, placed at terrain Y + 0.3 (l.241-395).
- **Spline mode** (l.598-807):
  1. For each segment, `p0` and `p3` are duplicated at the ends.
  2. Length via `CatmullRomSegmentLength`, then `steps = max(1, floor(L/spacing))`. The t=0 point is skipped for subsequent segments.
  3. Position, XZ-normalised tangent, perpendicular `(-tz, 0, tx)`, then yaw `atan2(tx,tz)`.
  4. `rows` rows distributed across the width, with jitter.
  5. Density, water and slope filters. Scale = entry scale × global scale. Creation at terrain Y + offset.
- **Wall mode** (l.400-593):
  1. Straight segments. Yaw = direction + 90°.
  2. **Automatic step measurement**: the 1st object is created, then `SourceToEntity(src).GetBounds(mins,maxs)`. The step becomes `max(extX, extZ) + bboxOffset` (l.479-514).
  3. Subsequent segments start at step/2.
- **Pitfalls**:
  - The t parameter is **not reparametrised by arc length**: on a non-uniform spline, the spacing varies.
  - Wall mode places entities one by one, where the **native WallGenerator / PrefabGenerator** does exactly that.

### 3.10 Corridor Clearance: `TAT/CorridorClearanceTool.c`
- `[WorkbenchToolAttribute(name:"Corridor Clearance", awesomeFontCode:0xF018)]` (l.19-26).
- **Parameters**: `m_fCorridorWidth` 15, `m_fBufferZone` 5, `m_iBufferThinPercent` 50, `m_bSkipTerrain` true, `m_sNameFilter`.
- **Algorithm** (l.343-688):
  1. Waypoints entered as in the Path Decorator. Catmull-Rom sampling every **2 m** (l.351).
  2. AABB expanded by `w/2 + buffer`, then bounding sphere and `SCR_WorldEditorToolHelper.QueryEntitiesBySphere`.
  3. For each entity, minimum XZ distance to the samples (**O(N·S)**). If `≤ w/2`, `DeleteEntity`. If it is in the buffer, deletion with probability `thin%`.
  4. Case-insensitive name filter (`ToLower`, `IndexOf`). `Count in Corridor` button for a dry run.
- **Pitfalls**:
  - The computation is done at the nearest point, not the segment: error up to 1 m.
  - The bounding sphere of a long path pulls in a huge number of entities.
  - Trees **generated by a ForestGenerator are not editor entities** and are therefore not deleted. For an FG, exclude the path from the shape, or rely on the FG's `m_bAvoidRoads`.

### 3.11 Object Replacer: `TAT/ObjectReplacerTool.c`
- `[WorkbenchToolAttribute(name:"Object Replacer", awesomeFontCode:0xF362)]` (l.17-24).
- **Parameters**: `m_sSourcePrefab` (exact filter on `GetResourceName()`), `m_sTargetPrefab`, keep position, rotation and scale (true), `m_bRandomizeScale` false, scale 0.8..1.2.
- **Algorithm** (l.139-313):
  1. Collection of the position, angles (`ent.GetTransform(mat)` then `Math3D.MatrixToAngles`) and scale (`src.Get("scale")`).
  2. `DeleteEntity`, then `CreateEntity(target,"",layerId,null,pos,vector.Zero)`.
  3. RELATIVE_Y correction, `coords`, `angles` (permuted), `scale`.
- **Pitfalls**:
  - The replacement lands in the **current layer**, not the original layer.
  - `m_bKeepPosition=false` has no effect (l.247-252).
  - The original's name and overridden components are lost.

---

## 4. Summary of observed API calls (signatures as used)
| Call | Used by |
|---|---|
| `WorldEditorAPI SCR_WorldEditorToolHelper.GetWorldEditorAPI()` | ATT XYZ (plugin); the tools have an inherited `m_API` |
| `bool BeginEntityAction(string name = "")` / `EndEntityAction()` | all; returns false if an action is already open |
| `int GetCurrentEntityLayerId()` | all the creators |
| `IEntitySource CreateEntity(ResourceName, string name, int layerId, IEntitySource parent, vector pos, vector angles)` | all the creators |
| `SetVariableValue(IEntitySource, null, "coords"/"angles"/"scale", string)` | TerrainUtils, Featherer, Replacer |
| `IEntitySource.Get("Flags", int)` / `Get("scale", string)` / `GetResourceName()` / `GetLayerID()` / `GetSubScene()` | various |
| `float GetTerrainSurfaceY(x, z)` | all |
| `BaseWorld.GetSurfaceY(x,z)` / `GetOceanHeight(x,z)` / `GetCurrentCamera(mat)` / `QueryEntitiesBySphere(c, r, cb, null, EQueryEntitiesFlags.ALL)` | TerrainUtils, collisions |
| `SCR_WorldEditorToolHelper.QueryEntitiesBySphere(world, c, r)` → `array<IEntity>` | Eraser, Density, Corridor, Biome |
| `SourceToEntity` / `EntityToSource` | various |
| `DeleteEntity(src)` / `DeleteEntities(array)` | Eraser (batch), others (one by one) |
| `GetSelectedEntitiesCount/GetSelectedEntity(i)/ClearEntitySelection/AddToEntitySelection` | input and output selection |
| `TraceWorldPos(x, y, TraceFlags.WORLD, out start, out end, out dir)` | mouse tools |
| `IsEntityLayerLockedHierarchy(subScene, layerId)` | Eraser |
| `UpdatePropertyPanel()`, `GetModifierKeyState(ModifierKey.X)`, `CreateCircle`, `Shape.CreateLines` | tool UI |
| `Workbench.ScriptDialog/Dialog/RunProcess/KillProcess/GetAbsolutePath`, `FileIO.BeginParse/OpenFile/FileExists` | ATT, presets |

**Never used** in these mods: `ModifyLayers`, `ModifyHeightMap*`, `BeginTerrainAction`, `ToggleGeneratorEvents`, `CreateSubsceneLayer`, `SetEntitySubsceneLayer`, `ParentEntity`, `CreateObjectArrayVariableMember`, and no shape or generator entity. It is raw entity placement only.

## 5. Common weaknesses
- **Entity cost**: each tree is an editor entity in the `.layer`. A ForestGenerator produces its own on the fly, without serialising them, which weighs much less on the file, loading and the console budget. Default caps: 5000 objects (Randomizer, Band), 200 per stroke (brushes).
- **No reproducibility**: random seeds and `Math.Random*` everywhere.
- **No surface painting** (`ModifyLayers`), **no heightmap**, **no dedicated layers**: everything lands in the current layer.
- **Water = ocean only** (`GetOceanHeight`): lakes and rivers ignored.
- **Repeated height reads**: 5 per slope, without a cache.
- Selecting thousands of entities at the end of generation via `AddToEntitySelection` in a loop: slow.

---

## 6. Reusable Enforce patterns for our Workbench import plugin
**Skeleton in prose**:
1. `#ifdef WORKBENCH`, then a class `RM_ImportPlugin : WorldEditorPlugin` with `[WorkbenchPluginAttribute(name, category:"Reforger Mapper", wbModules:{"WorldEditor"}, awesomeFontCode)]`. Like the XYZ one, `Run()` opens `Workbench.ScriptDialog(title, text, this)` with a `FileNamePicker` (extension `json` or `txt`) and `[ButtonAttribute("Import", true)]` / `Cancel` buttons.
2. Reading the file exported by the web tool, either:
   - `FileIO.OpenFile(path, FileMode.READ)` + `ReadLine`, in a sectioned `key=value` line format, like the presets;
   - `BeginParse` / `ParseLine`, for lines of space-separated tokens, like the XYZ.

   A line format is simpler to parse in Enforce than JSON.
3. `api.BeginEntityAction("RM Import")` guarded by its return boolean. Split into batches if the import is very large, like AutoDecorator's `m_iBatchSize`.
4. For each shape: create the Polyline or Spline entity, then **each point at `Y = api.GetTerrainSurfaceY(x, z)`**, relative to `coords` if the points are relative. Then the generator (FG/PG/RG/Lake) as a direct child. The shape and point creation calls (`CreateObjectArrayVariableMember`, `ParentEntity`) remain [S]; see ENFUSION_FORMATS §5.
5. Any isolated entities: apply the `TerrainUtils.SpawnEntity` recipe, including the `RELATIVE_Y` handling.
6. `EndEntityAction()`, then a summary in `Workbench.Dialog`.
7. Optionally, `Workbench.RunProcess` to launch our conversion CLI (like ATT_PythonHelper).

**Reference excerpts (≤ 10 lines)**:

Creation + RELATIVE_Y correction (`TAT/TerrainUtils.c:326-345`):
> *(code excerpt removed: it comes from an unlicensed third-party mod; see the original mod on the Workshop)*

Batched undo (`TAT/AutoDecorator.c:634, 692-697`):
> *(code excerpt removed: it comes from an unlicensed third-party mod; see the original mod on the Workshop)*

Reading a file by tokens (`ATT/ATT_XYZImportPlugin.c:128, 137-148`):
> *(code excerpt removed: it comes from an unlicensed third-party mod; see the original mod on the Workshop)*
(Remember `parser.EndParse()` at the end, l.223. Never put a `continue` before the end test.)

Deletion safeguards (`TAT/EraserTool.c:268, 277-279, 307`):
> *(code excerpt removed: it comes from an unlicensed third-party mod; see the original mod on the Workshop)*

Persisting options in the profile (`TAT/AutoDecorator.c:1137-1139`): `"$profile:" + "AutoDecoratorPresets_v2.txt"` then `FileIO.OpenFile(path, FileMode.WRITE)`. Useful for remembering the last imported file.

Resolving an addon path to disk (`ATT/ATT_HeightmapAnalyzer.c:26-31`): `SCR_AddonTool.ToFileSystem("Addon") + "rel/path"` then `Workbench.GetAbsolutePath(virt, abs, true)`.

---

## 7. What we reproduce on the web side (TS) and the plugin side
| Function | Web side (TypeScript) | Plugin side (Enforce) |
|---|---|---|
| Slope / altitude / water classification | **Yes**, on the whole heightmap: slope by central differences, like `GetTerrainNormal`, but in a single raster pass, with the Randomizer's 5/20/40° thresholds and "low" band. Water includes lakes and rivers, unlike the mod. | No |
| FBM noise, value noise, seeds | **Yes**: `ValueNoise2D` + `FBM`, 3 octaves, lacunarity 2, gain 0.5, scale 0.02 to 0.05. **Fixed seed** for reproducibility. Used to cut the forest, clearing and density polygons. | No |
| Poisson disk, falloffs | Yes, if we want isolated points (solitary trees, rocks) | No |
| Catmull-Rom, tangent, length | **Yes**, for smoothing roads and hedges, with arc-length reparametrisation (absent from the mod) | No: we export already-sampled points, and the native spline smooths by itself |
| Forest edges | Yes, but **geometrically**: negative polygon buffer, then a ring as a "Brushland/Clearing" FG or reduced density. This is not the Featherer's O(n²) on entities. | No |
| Corridor clearance | Yes: Boolean subtraction of the road buffer (width + falloff) from the forest polygons before export | No (the FG also has `m_bAvoidRoads`) |
| Elevation bands, biomes | Yes: rules for choosing the FG prefab or the groups per zone | No |
| Y of shape points | Approximate (source heightmap) | **Yes, mandatory**: `GetTerrainSurfaceY(x,z)` for each point at import |
| Shape and generator creation, undo, batches, layers | No | **Yes**: pattern from §6 |
| Surface painting, heightmap | Preparation of masks and 16-bit PNGs | `ModifyLayers` / Terrain Creation (no mod uses it: to be prototyped) |
| Isolated entities (rocks, ruins) | List of points | `SpawnEntity` recipe + RELATIVE_Y, with a cap |

**Conclusion**: these mods validate the algorithms (classification, FBM, Poisson, Catmull-Rom, edges, corridor) and provide the Workbench patterns (dialog, parse, batched undo, safeguards). None of them touches the native generators, painting or the heightmap, and that is precisely where our tool fits.
