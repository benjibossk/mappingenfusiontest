# Findings and pitfalls encountered

Everything we learned by doing, which is written nowhere else. Useful to anyone scripting the Enfusion
World Editor (Arma Reforger) from an external tool.

## 1. Workbench script (Enforce)

- **`JsonApiStruct` and floats**: a `float` field stays at 0 if the JSON value is an integer
  (`"yaw": 90`). Hence `int yaw` and `int ycm` (height in centimetres) in `MG_ProjectEntity`.
- **Rotation of a created entity**: the `angles` argument of `WorldEditorAPI.CreateEntity` is ignored.
  You then need `SetVariableValue(src, null, "angles", "pitch yaw roll")`. `angleY` stays at 0 and is
  useless on these entities.
- **Yaw convention**: yaw = `atan2(x, z)` in degrees turns the model's +Z toward the direction (x, z);
  the model's +X then goes toward (cos yaw, −sin yaw).
- **`Math.Atan` does not exist**: use `Math.Atan2(s, 1)`.
- **No ternary** `a ? b : c` in Enforce.
- **Buildings with terrain-relative height**: for some prefabs (houses), the height passed to
  `CreateEntity` is counted *above the ground*: the house ends up at ground + requested height (double).
  The plugin now measures the real origin right after creation and corrects `coords`.
- **Tilting to the slope**: pitch = −atan(forward slope), roll = −atan(lateral slope), slopes
  measured ±4 m along the prefab's axes. Good for embankments; buildings stay upright.
- **Ctrl+Down / Ctrl+Shift+Down** (Snap to Ground, and with Orient by Normal) are internal editor
  commands that cannot be called from a script. `SCR_EntityHelper.SnapToGround` only moves down.
- **A malformed `[EntityEditorProps(...)]`** breaks compilation with an error reported elsewhere
  (on the attribute of a neighbouring plugin).
- **Deleting an entity class** that is still present in a world prevents it from loading
  ("Bad type"): keep an empty class while the entity is being removed.
- **Persistent debug texts**: `DebugTextWorldSpace.Create(world, text, CENTER | FACE_CAMERA, x, y, z,
  size, colour, background)` works from a plugin; an entity with `_WB_AfterWorldUpdate` displayed
  nothing. The texts die when scripts reload: a global object redraws them.
- **Static variables at startup**: a global object built during `#InitGlobals` may run
  before its class's statics are initialised: test for `null`.
- **Resource search**: `Workbench.SearchResources(cb, {"et"}, null, folder, true)` (reported
  obsolete but works); `GetBounds` gives the local bounds of the instantiated prefab.

## 2. Measured vanilla prefabs

Measurements made with the "MapGen - Measure prefabs" plugin (844 prefabs → `profile/MapGen/prefabs.txt`).

- **ConcreteBridge_01 decks**: pivot at one end, extending toward +X. Narrow 13 m, Narrow_Long and
  Wide 26 m; width Narrow ±5 m, Wide ±6.5 m; top at +0.13, bottom at −1.3.
- **"Pillar" in the deck names** (`_PillarSmall`, `_PillarBig`) refers to the **guardrail posts**,
  not the piers: these are the variants with railings (children on the `socket_pillar_*` sockets).
  The `_Base` ones have no guardrail.
- **Piers** `ConcreteBridge_01_Pillar(_narrow)`: Y −4.3..7.05; top to be placed under the deck
  (1.3 + 7.05 m below the top).
- **End-to-end placement**: the yaw sent is rounded to the degree; lay the pieces along that
  rounded direction, otherwise they slide sideways (a few cm over 26 m).
- **PierWooden_02_bridge**: 50 m along Z (−25..25.3), pivot in the middle, feet down to −14.4.
- **BridgeConcrete_E_01_small**: 13 m along X, 4.6 m wide.
- **Village buildings**: no church or town hall among the measured prefabs; the pub (PubVillage)
  serves as the central building.
- **ErodedEmbankment_01 embankments**: ~16 m along X, ~8 m deep, eroded face toward −Z.

## 3. Water

- Water generators do not shape the terrain: the site digs the bed and basin itself (downward only),
  then sends the points at water level.
- Automatic lakes: "priority flood" basins (`filled − heights`) crossed by a river,
  plus small source lakes.
- Roads are cut where they cross water; the cuts become bridges.

## 4. Tooling (MCP enfusion, NET API)

- Windowless compilation goes through the NET API (handler `EMCP_WB_Reload` →
  `ScriptEditor.ExecuteAction({"Build","Validate and Reload Scripts"})`), even in a locked Windows session.
- The errors of a failed compilation are written to no log: they are read from the Errors panel
  via UI Automation.
- Dialogs to handle automatically during a reload: "Resources are leaking" (Ignore), "file
  modified by another program, reload?" (Yes, otherwise the script editor rewrites the old
  version), "Reload world: save changes?" (Yes; this is a Qt window, not a Win32 box: click via
  UI Automation).
- A line break in a C# string constant of an `Add-Type` script makes the whole PowerShell script
  fail without a message.

## 5. What remains to be done (audit of the recovered tools)

In order of usefulness / effort:

1. Pre-send validation (roads over water without a bridge, slopes, misplaced buildings, isolated villages).
2. ~~Entity budget per platform~~: "MapGen - Entity budget" plugin, with duplicates, buried objects and terrain occlusion (loaded cells that are flat or on a ridge).
3. Forest edges and cleared corridors around roads.
4. Forests by altitude / slope / biome.
5. Village fences and walls, power lines.
6. Isolated objects (rocks, ruins, lone trees) scattered with a cap.
7. Mass replacement / deletion in an area.
8. Real FPS bench on a camera path (CSV), cross-checked with the density map.
9. Debug exports (GeoJSON, inventory CSV).

## 6. Occlusion

- Enfusion's main occluder is the **relief** (Terrain Occlusion): a large flat area covered in
  forest makes everything draw at once; forests on ridges are visible from afar (BIKI terrain tutorial).
- Building occluders are `OCC_` meshes in the models (axis-aligned, 4-5 m
  minimum, 3-4 per building, 1-2 m below ground), not entities that you place in the world.

## 7. Vanilla World Editor plugins useful to MapGen

Sources read in `addons/data/data007.pak` (`scripts/WorkbenchGame`, 129 files).

- **Import Shapefile** (`SCR_ImportShapefilePlugin`): SHP → forests (ForestGenerator data option), lakes,
  roads, power lines, prefabs (ID→prefab list). Possible entry point for the site's exports.
- **CSV Object Import** (`SCR_ObjectImportPlugin`): `Prefab,x,y,z,qx,qy,qz,qw,scale`, Y relative to the terrain
  as an option. Mass placement of prefabs.
- **Export Geographic Data** (GeoJSON/SVG) and **World Data Export** (roads, buildings, water, hills in 2D):
  return path to the web map.
- **World Entities Statistics**: counts per prefab and density heat map (DDS/PNG).
- **FPS Diagnostic**: FPS measured across the whole terrain → heat map, Game mode possible. Basis for the bench.
- **Snap and Orient to Terrain**, **Floaters Finder / Fixer**: quality control after generation.
- **Shape Area / Parallel Shape / Shape Brush**, **Object Brush**: drawing and filling tools.
- **Build shore map**, **Regenerate river flow-maps** (native): to rerun after any water change.
- **Change absolute Y to relative**, **Mark shapes editor only**, **Wrap Entities**, **Entity Replacer**.
