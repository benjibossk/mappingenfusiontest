# Outside terrain ring (off-map horizon)

Goal: a low-resolution relief around the playable map that continues its edges and coast, so a player
standing near the edge (or flying) does not look into the void.

## 1. What vanilla and the Workshop do
- **Vanilla (Everon `worlds/Eden`, Arland)**: no off-map terrain. `game_browse worlds/Eden` lists only
  `Eden.ent`, `.smap`, `.topo`, `Eden/Eden.terr` and the `.Rivers` / `.Shore` folders; `asset_search Outside`
  finds no terrain prefab or entity. Both maps are islands: the horizon is the open sea (ocean plane + sky).
  So "how vanilla does it" = keep the map edge under water.
- **Outside Terrain Core** (OTC, Workshop `61F0D506562D9BC9`, studied in docs/TAT_STUDY.md §4 and
  docs/WORKSHOP_TERRAIN_MODS.md §2): runtime `OTC_OutsideTerrainChunkEntity : GenericEntity`, attributes
  `m_fWidth`, `m_fHeight` (128 by default), `m_iResolution` (2..33 = one Enfusion terrain block),
  `m_aHeights` (`array<float>`, `res*res`, index = row * res + col, row along local +Z, col along +X, vertices
  from −size/2 to +size/2 around the entity origin), optional collision, `.emat` material.
  Known bug: integer division in `OTC_Mesh` (`x / zeroBasedResolution`), see WORKSHOP_TERRAIN_MODS §2.
- **Outside Terrain Tool** (`61F2B96F0D3F27D4`, MR-REX, docs/INSPIRATIONS.md): extends the heightmap edges
  + noise + smoothing, "toward the sea" or per direction. Not downloaded; the idea is reused here.

## 2. Generation (TS, `src/modules/outside.ts`)
`outsideRing(map, ocean, { width, step, toward, seed, noise })` returns a grid covering the map plus `width`
on every side (default 4096 m; the UI uses the map side clamped to 2-8 km, step 64 m):
- inside the map: the map height (bilinear) → the seam is exact;
- outside, at distance `d` from the nearest edge point: the edge height averaged over a window that widens
  with `d` (ridges soften as they leave the map), faded with a smoothstep toward the far level:
  - `sea`: `ocean − max(30, width·1%)` (the relief dives under the sea, as vanilla islands);
  - `land`: a low plain `ocean + max(4, 25 % of the mean edge height)` (mainland horizon);
- fBm value noise (1.5 km scale) that grows from 0 at the edge and dies at the far level;
- in `sea` mode, an edge already under water stays under water (no fake islands off the coast).

`ringChunks(ring, map, res = 33)` cuts it into square chunks of `(res−1)` cells (64 m × 32 = 2048 m per chunk),
skipping the chunks wholly inside the map; neighbouring chunks share their edge vertices (no cracks).
`chunksToText` serialises them: header `OTC 1 <count>`, then per chunk `x z size res` (centre, metres) and one
line of `res*res` absolute heights (entity placed at y = 0).

## 3. Export path
1. Relief tab → "Send ring (OTC)" → `POST /outside { text }` (bridge/outside.mjs, hooked in server.mjs).
2. The bridge checks the text, writes `<Workbench profile>/MapGen/outside.txt` and calls the NET API
   `MG_ApplyOutside`. If the Workbench or the handler is missing, the file is still written and the
   message says so.
3. `workbench/Mapgenerator/Scripts/WorkbenchGame/MapGen/MG_ApplyOutsideApi.c` (**repo copy only, NOT compiled
   nor tested in the Workbench**): deletes the previous `MG_OTC_*` entities, creates one
   `OTC_OutsideTerrainChunkEntity` per chunk in the current layer, sets width / height / resolution and
   `m_aHeights` (comma-separated values: format to confirm in the Workbench). The open project must depend on
   Outside Terrain Core (61F0D506562D9BC9).

To check when it is first compiled: the `m_aHeights` string format for `SetVariableValue` on an
`array<float>`, the OTC integer-division bug (mesh may collapse; an own mesh entity would then be needed),
and the material (OTC default `.emat`).

## 4. UI and 3D
- Relief tab: checkbox "Off-map terrain ring (horizon)", select "the sea / a low plain", button "Send ring (OTC)"
  (`src/outsideUi.ts`, strings en + fr in i18n.ts).
- 3D view: when ticked, `View3DData.outside` draws the ring as a plain shaded mesh (cells under the map
  skipped, 0.5 m lower to avoid z-fighting) with one sea plane over the whole ring.

## 5. Tests
`tests/library/outside.test.ts`: seam equals the map, sea mode dives and keeps the coast under water, land
mode level and determinism, chunks (ring only, shared edges, res cap 33, text format), bridge validator.
