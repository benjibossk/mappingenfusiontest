# Notes reused from Reforger / Freedom Fighters modding knowledge

## Formats and GUIDs (arma-reforger-modding skill)
- **Every exported `.et` needs a `.meta`** (`MetaFileClass`, `Name "{GUID}path"`, configurations PC/XBOX_ONE/XBOX_SERIES/PS4/PS5/HEADLESS). BARNMAP does the same.
- **Deterministic GUIDs**: `sha256(salt + path)[:16]` in uppercase. Re-exporting the same area therefore keeps the same GUIDs, and layer references stay valid.
- References use the **resource GUID** (`.meta`), never the addon GUID.
- Verified in testing (2026-10-14): the Workbench also resolves a prefab by **path alone** (`Prefabs/WEGenerators/Water/Lake/LG_Lake_01.et`). This is a fallback for unknown GUIDs.
- Validation: `mod_validate` (MCP) as a pre-check.

## ⚠️ Non-"baked" entity IDs: dedicated server crash risk (FF skill §15.18)
- A hand-written `.et` without a stable `ID "..."` at the root desynchronises client and server, which causes a `REPLICATION SYSTEM_FAILURE` kick.
- **The tool must write a 16-hex `ID` on every entity**: the shape, the child generator and the ShapePoint as `{GUID}`. BARNMAP does this.
- As a safety measure, the import sheet documents a "Force Save All" in the Workbench: Resource Browser, then Edit Prefab(s), then Force Save All. **Do not use Reimport.**
- Detection: `rg --files-without-match -g '*.et' '^\s*ID "'`. We build this into the tool's validator.

## Freedom Fighters: a generated terrain must be "FF-ready" (FF skill §3-4)
- **Recommended size of 25 km² or more** (Arland, about 2.5 × 2.5 km, is the soft minimum). Our 4 km = 16 km² is therefore borderline; aim for 8 km instead.
- **Connected paved road network** between the main locations. Without it, FF has no traffic, no QRF and no convoys.
  - FF pitfalls: **endpoints that do not touch** (gaps) and **islands** (disconnected sub-networks).
  - → The tool must **weld intersections** (one shared point, same height, which BI also recommends) and detect the connected components of the road graph before export ("islands" report).
- `JWK_World` requires Map Offset and Map Size. They can be computed directly from the exported grid (origin 0,0,0, size N×1.024 km, Y min/max).
- FF locations (Town, FOB, military base, radio tower, port, checkpoint, gas station): the tool could offer **POI markers** from OSM (`place=village`, `amenity=fuel`, `man_made=mast`, `harbour`, `military`) and export them as placeholders to be completed with the `JWK_*` controllers. This is an idea for a later phase.
- Custom buildings: `JWK_SpawnPointsContainerComponent`. This is outside our scope.

## Workbench scripting notes
- `ToggleGeneratorEvents(true)` (API) is required for generators to run when entities are created by script.
- After editing a plugin, recompile with Script Editor > Build > Validate and Reload Scripts (Shift+F7) and read the errors in the Errors pane.

## Bench / performance
- The `WorldEditorPlugin` (pattern from FF skill §15.18) can also serve as the basis for the **bench plugin**: density per cell with `QueryEntitiesByAABB` (Lou's scripts), then a PNG heatmap.
