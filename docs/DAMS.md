# Dams (barrages)

## What the vanilla game has
There is **no large concrete or earth dam prefab** in the base game (searched `Dam`, `Weir`, `Spillway`, `Sluice`, `Prefabs/Structures/Infrastructure/Waterworks/*`). The `Dam_01 {F9BD45A336D521FF}` named in the request does not exist in the paks. What exists:

| Prefab (under Prefabs/Structures/Infrastructure/) | GUID | Real dims (mesh bbox) W x D x H | Notes |
|---|---|---|---|
| Waterworks/GravelDam_01/GravelDam_01.et | {64E482C4598F3E45} | 18.99 x 1.67 x 4.47 m, centred (cx = cz = 0) | single piece, `SCR_DestructibleBuildingEntity` (Building_Base), static rigid body, mesh `Assets/Structures/Infrastructure/Waterworks/Dams/GravelDam_01/GravelDam_01.xob`. A small gravel check dam / weir. Symmetric in depth: no water side, either face can face the water. |
| Waterworks/FloodGate_01/FloodGate_01_concrete_closed / _open.et | none referenced | 3.66 x 1.36 x 4.38 m (cz -0.39) | sluice frame for a ditch / canal; no GUID harvested, so not used |
| Waterworks/FloodGate_01/FloodGate_01_stone_closed / _open.et | none referenced | 3.94 x 2.23 x 3.86 m (cz -0.52) | idem, stone |
| Waterworks/FloodGate_01/FloodGate_01_gate.et | {10CD2AE2D3555690} | 1.06 x 0.15 x 2.97 m | the moving gate leaf |
| Walls/Wooden/WoodenRural_01/WoodenRural_01_Dam.et (Structures/Walls) | | | a wooden fence piece, not a dam |

No hydro power plant either: the only vanilla plant is DieselPowerPlant_USSR_01 (see POWER_GRID.md).
All these dims were already in `library/prefabs-catalogue.json`.

So a vanilla dam holds **~4 m** at most (GravelDam_01, partly buried), ~19 m of crest per piece. The pieces have no snap points; they butt end to end along their X axis.

## What the generator does (src/modules/dam.ts)
The dam body is **sculpted into the relief** (earth embankment); the vanilla pieces only dress it.

1. **Throat search**: every traced river is resampled every grid cell; between 25 % and 85 % of its length, rays perpendicular to the flow find how far each bank is before the ground reaches `bed + height`. The narrowest crossing (<= 360 m) wins. Default height 12 m; if no throat holds it, 8 m then 5 m are tried.
2. **Embankment** (`applyDam`): flat crest 8 m wide at `bed + height`, both faces at 1:2.5, ends running into the hillsides at 1:1. It only raises the ground.
3. **Reservoir** (`floodReservoir`): 4-connected flood from the river upstream of the toe, cells under `crest - 1.5 m` (freeboard). Rejected if it reaches the sea, the map edge, an existing lake, the downstream foot, or is > 1.5 km² / < 2 ha. Outline = outer cell border of the mask (simplified), exported as an `LG_Lake_01` lake with a **fixed level** (`Water.level`, read by `lakeLevel` in water.ts).
4. **River**: the dammed river ends where it enters the reservoir and starts again at the **downstream foot** (first point past the toe); other rivers lose their points inside the reservoir.
5. **Dressing** (`damZone`, ZoneItem kind `site`, sub `dam`): GravelDam_01 pieces end to end along the upstream crest edge, sunk so their top is 1 m above the crest (wave wall), and an RG_Road_Dirt_01 track on the crest; the crest end is an access point the road network connects to.

Random world: option **Dam + reservoir** (`WorldParams.dams`, off by default), 1 dam per 4 km of map side.
Tests: `tests/library/dam.test.ts`.

## Limits
- No spillway / sluice structure (no vanilla prefab with a GUID); the water simply stays 1.5 m under the crest.
- No hydro plant (no vanilla prefab), so nothing is added to powergrid.ts.
- Not in the Zone tool yet: the dam edits the relief and the water, which the hand-drawn zone pipeline does not do.
- GravelDam_01 yaw: local X laid along the crest with the power stations' convention (`stationEntities`); to check in the Workbench.
- Vanilla placements in the Everon / Arland world layers were not inspected (layers are not in the asset index).
