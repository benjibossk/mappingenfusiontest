# Enfusion formats and API (dig through the enfusion-mcp MCP, read-only)

Legend: [V] verified in the game files, the API or the wiki · [S] assumed.
Limit: the vanilla `.ent`, `.layer` and `.terr` files (Everon, Arland) are binarized (EBIN), hence unreadable. The GUIDs come from the inheritance lines `: "{GUID}..."` and from mod `.layer` files.

## 1. Forest Generator [V]
- `Prefabs/WEGenerators/Forest/` contains 97 `FG_*.et` (Forest_*, Brushland_*, Clearing_*, `_aut` variants), plus `FG_Forest_Pinus/` and `FG_Forest_Spruce_1/`.
- Known GUIDs:

| GUID | Prefab |
|---|---|
| `{37C347EECE844530}` | FG_Forest_Pine1 |
| `{5B97730E7240CA1E}` | FG_Forest_Pine2 |
| `{C110BC1515DDFD3F}` | FG_Forest_Spruce1 |
| `{AD4488F5A9197211}` | FG_Forest_Spruce2 |
| `{850A42E16C5B104D}` | FG_Forest_Birch |
| `{1209A690258A7A18}` | FG_Forest_Hornbeam |
| `{7D22EF2D993C004D}` | FG_Forest_Sorbus |
| `{FC00F74F9C552E1F}` | FG_Forest_PiceaWeathered_1 |
| `{FA33CB2A2E422795}` | FG_Forest_PiceaWeathered_D_1 |

- Base `FG_Forest_base.et`: `m_bAvoidObjects / Roads / Rivers / PowerLines / Tracks / Lakes = 1`, `m_bRandomiseSeedOnUse 0`.
- Structure of a prefab:
  - `GeneratorType GeneratorTypeForest "{58ACC07B205BBA26}"`, `m_iSeed`;
  - `m_aLevels`: Outline, TopLevel, BottomLevel. Each level has `m_fDensity` (300 to 400) and `m_aTreeGroups`, themselves made of Tall, Middle and Short trees (`m_fMinScale`, `m_fMaxScale`, `m_fWeight`, `m_Prefab`);
  - `m_aClusters`: `ForestGeneratorCircleCluster` (`m_fMinCDENSHA`, `m_fMaxCDENSHA`, objects with `m_iMinCount/MaxCount`, `m_fMinRadius/MaxRadius`).
- Rules:
  - the shape is a Polyline or a Spline, always considered closed, with at least 3 points;
  - the generator must be a **direct child** of the shape;
  - several FGs can be placed per zone.
- Format as a child of the shape [S] (syntax transposed from a power line `.layer`):
```
PolylineShapeEntity {
 coords 105.097 1 140.877
 Points {
  ShapePoint "{6674AED5D488B0D8}" { Position 0 0 0 }
  ShapePoint "{6674AED5D488BD66}" { Position 18.307 0 0 }
 }
 {
  ForestGeneratorEntity : "{37C347EECE844530}Prefabs/WEGenerators/Forest/FG_Forest_Pine1.et" {
   coords 0 0 0
   m_iSeed 123
  }
 }
}
```
- The points are relative to `coords`. BARNMAP uses `coords 0 0 0` with absolute points, which amounts to the same thing.
- [S] Trees are generated inside the Workbench, so there is no need to export them.
- **Test 2026-10-14 (world `emptyarland`, Arland subscene)** [V]: our hand-written `.et` files (`MapGenTests/Test_Forest|Test_Lake|Test_Hedge.et`, closed polyline + `IsClosed 1` + child generator with baked `ID`) are accepted, placed and saved in `default.layer` in the form `PolylineShapeEntity MG_TEST_Forest : "{GUID}MapGenTests/Test_Forest.et" {...}`.
  - Moving the shape freezes the Workbench for more than 10 s (MCP timeout), which suggests a regeneration. The generated objects do not appear in the editor entity list.
  - **Cause of the non-generation (Benji's finding)**: our points had `Y = 0` (relative), so they were not snapped to the terrain. After a "Snap to terrain" on the spline, **the forest generated** [V].
  - **Correction (test `MG_TEST_ForestSnapped`)**: a shape written with the exact terrain Y **still generates nothing** on load. It generates as soon as "Snap to terrain" is clicked in the Vector Tool. So height is not the cause: **the generator only runs on an edit event of the shape**. Loading a `.et` or a `.layer` triggers nothing.
  - → The generation has to be **triggered by a Workbench plugin**. Leads:
    - `ForestGeneratorEntity.RegenerateForest(bool forceRegeneration)`, the most direct (exists in the API);
    - `ToggleGeneratorEvents(true)`, then modify the points through the API;
    - failing that, the manual "Select all" + "Snap to terrain" in the Vector Tool.
  - Still write the real terrain Y, so that the shapes are accurate.
  - Resolved GUID: `{1F2254A7C9C8AA57}` LG_Lake_01.

## 2. Water [V]
- **River**: `Prefabs/WEGenerators/Water/River/R_RiverMedium_01.et` (GUID unknown).
  - Content: `RiverEntity { GeneratorType GeneratorTypeRiver "{58B894C70B4B0C9E}" Width 5 SplineOffsetUp 0.139 Material "{53A33317B1C9B8E0}Terrains/Common/Water/River/RiverSurface_01.emat" PhysicsLayer "Water" }`.
  - Open shape, at least 2 points. Clearance and ReverseFlow options.
- **Lakes**: `Water/Lake/` contains LG_Lake_01, LG_LakeDirty_01, LG_LakeMountain_01, LG_CainLake_01 and LG_DirtyDrainage_01 (GUIDs unknown).
  - Content: `LakeGeneratorEntity { GeneratorType GeneratorTypeLake "{58B894C7011D8F70}" m_MaterialName "{202B614D7E81B3C5}.../PondSurface_01.emat" m_bFlattenByBottomPlane 1 }`.
  - Closed shape, at least 3 points, **clockwise** (otherwise ReversePointOrder). The water surface is placed at the lowest point of the shape.
- `Water/Pool/` has not been explored.

## 3. Other generators [V]
- **Walls and fences**: `Walls/{Brick,Concrete,Crashbarrier,Custom,Metal,Misc,Net,Pipe,Pole,Stone,Wooden}/WG_*.et`.
  - Known GUIDs: `{E00BA421CC399343}` WG_ConcreteWall_01 and `{1A61D6F828325773}` WG_WoodenFence_01.
  - Format: `WallGeneratorEntity { FirstObject LastObject PrePadding PostPadding m_aWallGroups { WallLengthGroup { m_aWallPrefabs { WallWeightPair { m_sWallAsset m_fWeight } } } } }`.
- **Power lines**: `Powerline/PG_PowerLine_*`.
  - Known GUIDs: `{20E4877A07D28502}` PG_PowerLine_01_WoodenSmall and `{613763D114E7CD1C}` Powerline.et.
  - Class `SCR_PowerlineGeneratorEntity`, `GeneratorTypeHV "{58B894C75A99C899}"`, `m_fDistance 50`, `Clearance 3`.
  - The `.layer` also contains the generated poles and cables.
- **PrefabGeneratorEntity** (objects placed along a line): PG_Vegetation_CorylusBushline, PG_Vegetatation_BirchTreeline, PG_StreamStones.
  - Parameters: `m_PrefabNames`, `m_Weights`, `m_fDistance 4`, `m_fOffsetVariance 8`, `m_fGap 3`.
  - **This is the ideal building block for hedges** between fields.
- Folders not detailed: Brushland, Bushline, Decals, Infrastructure, Miscellaneous, Pavements, Stones.

## 4. Roads [V]
- Format: `RoadGeneratorEntity { GeneratorType GeneratorTypeRoad "{58B894C738383FF4}" AdjustHeightMap 1 AdjustHeightMapPriority 47 RoadClearance RoadWidth RoadFalloffWidth { RoadEntity { Type "Road Minor"|Path Width Material } } }`.
- **Asphalt**: RG_Road_Asphalt_E_01 `{723C2AAE6E9AD131}`, E_01_Narrow, E_01_DashedLine, E_02 (width 8, clearance 4.5, falloff 4, priority 47), E_03.
- **Dirt**: RG_Road_Dirt_01 `{8E83BBD5CEC42A11}`, Dirt_02, Road_Forest_01, Road_Coal_01, RG_TrailDirt_01 (width 1.75, type Path, priority 30), TrailForest_01, TrailGravel_01, TrailCoal_01.
- Folders not listed: Cobblestone/, Concrete/, VergePosts/.

## 5. Workbench API (WorldEditorAPI) [V]
- **Read**: `GetTerrainSurfaceY(x,z)`, `GetEditorEntityCount/GetEditorEntity`, `FindEntityByName`, `SourceToEntity`.
- **Edit**:
  - `BeginEntityAction/EndEntityAction`;
  - `ParentEntity(parent, child, transformToParentSpace)`;
  - `SetVariableValue(container, path, key, value)`;
  - `CreateObjectArrayVariableMember`, `CreateComponent`;
  - `ToggleGeneratorEvents(bool)`: must be enabled for the generators to work.
- **Terrain**: `BeginTerrainAction(TerrainToolType)`, `ModifyHeightMap`, `ModifyHeightMapUserShape(...)`, `ModifyLayers` and `ModifyLayersUserShape` (paint surfaces by script).
- **Layers**: `CreateSubsceneLayer`, `SetEntitySubsceneLayer`.
- **Heightmap import**: only through the Terrain Creation tool (`.asc` or 16-bit PNG with min/max).
- **Lead**: a Workbench plugin (Enforce script) could import a JSON produced by the web tool and create shapes, generators and painting directly. This is more robust than writing text files.

## 6. Terrain and masks [V wiki]
- 1 block = 32×32 faces (33×33 vertices), 5 LODs, 1 draw call.
- 1 tile = 1 to 32 blocks. The supertexture, the normal map and the surface mask are mapped per tile.
- A heightmap of N faces is N+1 px (2048 faces → 2049 px).
- 16-bit integer heightmap: precision = range / 65535.
- Only 1 terrain per world. Size = grid × cell size, and X and Z can differ.
- **4033 = 2·2016 + 1** [S]: probably related to the tile size and the border. To be confirmed.

## 7. Numeric limits
- 5 surfaces maximum per block.
- 5 LODs per block.
- 1 to 32 blocks per tile.
- 16-bit heightmap.
- **No limit found** on the maximum terrain size or the number of entities. This will have to be measured by benchmark.

## 8. Triggering generation by plugin [V 2026-10-14]
- The plugin `Mapgenerator/Scripts/WorkbenchGame/MapGen/MG_RegeneratePlugin.c` (menu Plugins > MapGen) does three things:
  1. `ToggleGeneratorEvents(true)`;
  2. for each `MG_*` shape, it rewrites every point (`SetVariableValue(src, {ContainerIdPathEntry("Points", i)}, "Position", ...)`) at the terrain Y (`GetTerrainSurfaceY`);
  3. it calls `RegenerateForest(true)` on each forest.
- `RegenerateForest` is **protected**. It is exposed through `modded class ForestGeneratorEntity { void MG_ForceRegenerate() }`, placed in `Scripts/Game`.
- **Result**: 7 shapes, 31 points and 3 forests processed. The world goes from 1557 to **2553 entities**: generation took place without any click.
- **Validated chain**: `.layer` or `.et` file → plugin → generation. The final importer will follow this pattern.

## 9. Validated method for creating generated shapes (2026-10-15)

Visually validated by Benji: forest, hedge and lake generated without any click.
Plugin `MG_CreateShapesPlugin` (Mapgenerator addon), reproduces the manual creation:

1. `api.ToggleGeneratorEvents(true)` then `BeginEntityAction`.
2. `api.CreateEntity("PolylineShapeEntity", name, layerId, null, pos, "0 0 0")` — **bare** shape
   (no wrapper prefab), origin at `GetTerrainSurfaceY`.
3. `SetVariableValue(shape, null, "IsClosed", "1")` for forest / lake.
4. Per point: `CreateObjectArrayVariableMember(shape, null, "Points", "ShapePoint", i)` then
   `SetVariableValue(..., [Points,i], "Position", "x y z")`, local Y = terrain − origin.
5. Generator as a child: `CreateEntity(Workbench.GetResourceName(path), "", layerId, shape, 0, 0)`.
6. `EndEntityAction`. Generation happens on its own (editor events), the result (trees,
   bushes) is serialized in the `.layer` under the generator; the lake water is not.

Failures not to reproduce:
- Shape wrapped in a test `.et` prefab: generation not triggered on load.
- Prefab reference **without GUID** (`"Prefabs/…/X.et"`): not resolved, empty generator
  (`prefabs=0`). Always `{GUID}path`; `Workbench.GetResourceName(path)` gives the GUID.
