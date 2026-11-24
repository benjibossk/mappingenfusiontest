# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
Versions stay below 1.0.0 while the tool is a work in progress.

## [Unreleased]

## [0.8.0] - 2026-11-25

### Added
- **Gaea-style eroded relief**: ridges, river incision (stream power), droplet gullies and a thermal pass, with flow / wear / deposit masks; a "mountains" option for real high ground, 8 m detail kept.
- **Import from Gaea** via Advanced Terrain Tools: bring an eroded heightmap made in Gaea straight into the project.
- **Mountain pass roads**: when a link cannot climb directly, the router builds hairpin switchbacks at a comfortable 10-15 % grade, with flat platforms carved at each bend.
- **Several projects**: projects are saved in the browser, the 3 most recent are shown on the welcome screen, and an open project gets a dashboard (Terrain, Atelier, Masks...).
- **Vanilla pieces everywhere**: whole vanilla harbours chosen by biome (big ports for towns), RP sites (mine, garage, depot, farm, beehives, lumberjack, sawmill), 370 vanilla parcels and 109 farmsteads, 712 vanilla rock groups.
- **Gameplay score**: cover rules and a compatibility score per scenario (Conflict, Combat Ops, Freedom Fighters, King of the Hill, Game Master).
- **Automatic diagnosis after each send**: checks the base entities of a playable world (World Setup list) and reports problems; the Workbench tab shows the state of each layer (empty, ready, sent, to resend).
- **Textured satmap and topographic Atelier background**: 37 vanilla ground textures on the satellite map; altitude tints, hillshade and contour lines behind the Atelier.
- **Power grid like vanilla**: low-voltage stars around villages, MV spurs and pole transformers for remote farms, cleared corridors through forests, lines start at the power plant.
- **Roadside details**: noise berms along big roads at town edges, crash barriers on dams, street lamps on lit streets, give-way signs at each roundabout entry, desire paths from house doors.
- **App log panel**: a "Log" button in the status bar shows every message (step logs, notifications, JavaScript errors) whatever the step.
- **Comments in 3D**: click a comment to fly the camera there; comments become markers in the World Editor.

### Changed
- **README** (EN/FR) refreshed for 0.8.0: mountains gallery, feature list, known issues, new screenshots.
- **Gaea import box**: short help across the full width, tree-cloud and mask options folded away, file and Relief fields full width.
- **Mountain roads in the generated world**: steep links between towns use hairpins instead of being downgraded, and river fords no longer turn a town road into a track.
- **Mountain flanks**: grass on the slopes, rock and scree in bands, rocks and granite cliffs on ground steeper than ~37 deg.
- **Woods on slopes**: forests now climb flanks up to 35 deg; merged woods no longer open holes.
- **Houses and parcels off steep ground**: farms, fields and lots avoid steep slopes; houses that a lane runs over are dropped.
- **Graded forest and field tracks**: kept at 15 % or less, with switchbacks where possible, otherwise dropped.
- **Villages and towns closer to Bohemia maps**: oblique village streets, smaller town blocks, sheds behind houses, every built lot fenced, density per biome, farm rows on Kolguyev and Arland.
- **Reforger-look UI**: Roboto Condensed in sentence case, square corners, one-line top bar, collapsible side panel, calmer step panels and a guided first-time tour.
- **3D view**: the km grid is off by default.
- **Life economy** panel docked at the bottom of the map, 6 columns, English names.

### Fixed
- **No JS error at the end of a random world** when the guide card is missing ("Cannot set properties of null").
- **Map labels follow the UI language**: RP place badges (FARM, SAWMILL, SELL...) were always in French.
- **Send no longer fails on forests**: geometry errors ("Unable to complete output ring") are caught instead of aborting the whole send.
- **Surfaces**: no more black SeaBed on land, softer borders, beaches only from the real sea and below 12 deg.
- **Object rotation**: objects with a decimal yaw no longer stand at 0 deg (about 1 in 7 objects were affected).
- **Mask import** saves through the NET API (no keystrokes, no focus stealing), waits for the normal map and reports a failed import.
- Hedges, trees and power poles kept off every road and track; harbours and forests kept clear of other zones; village paths without steps under platforms.

## [0.7.0] - 2026-11-19

### Added
- **Realistic harbours**: dredged basin (-7.5 m), flat apron (+2.2 m), breakwater arms, jetties, buoys and a quay street; vanilla ports face the sea and avoid roads.
- **FTG-style fields**: road-anchored strip layout with a size gradient, crop mosaic and hedgerows; plots sized on Everon crop fields (110 m, aspect 1.5).
- **Building pads** under every building, and road junctions graded onto the main road.
- **Vanilla sites and village templates** (Everon / Kolguyev / Arland) with stamping, on by default in the random world, plus a full vanilla military base option.
- **Reference maps** (Everon / Kolguyev / Arland): read-only load with real relief, river widths, lake levels, power lines, exact road types and placement stats.
- **Pre-send check**: building overlaps, objects on roads and zone objects off the map, with auto-fix; 3D object counter.
- **Map-size scaling**: bases, industry, vanilla sites and ports follow measured vanilla densities times land area; TAT-like elevation bands, Poisson-disk rocks and bushes.
- **Ground rules from vanilla**: bare rock only above 35 deg, scree on 15-35 deg slopes, shore pebbles, mountain grass/heather by height, dirt shoulders on asphalt, house lawns.
- **Workbench tooling**: automatic terrain mask import (UIA script), headless World Editor shots, post-apply numeric audit, WGC window capture.
- Villages: Bohemia-measured orientation (side-on, back to the road), outbuildings beside/behind, archetypes and template mode.
- **Species of the Zone tool forest** (`src/biomes/vegetation.ts` `zoneForestLeaf`, `src/main.ts`, #12): the Species dropdown gets `Auto` (default): leaf type from the zone's mean relative altitude (`leafOf`, shifted by the biome), or from the biome's conifer share without relief; Mixed / Conifers / Broadleaf are kept as before. The export already picks the biome's vanilla generator (`forestGeneratorFor`); the log now names it. Tests in `tests/biomes/forest-rules.test.ts`.
- **Trees in the fields** (`src/modules/fieldtrees.ts`, worldgen step 10d, #8): isolated trees well inside about one plot in six, clumps of 2-4 trees at some plot corners and hedgerow trees every ~45 m on the hedges, as single vanilla tree entities (`VEG`, broadleaves of the biome first). Off roads, forests, water and buildings. They form one `site` zone `TREES_FIELD` (drawn, saved and sent like any zone). New `WorldParams.fieldTrees` (0-2, slider in the random world dialog). Tests: `tests/biomes/fieldtrees.test.ts`.
- **Forests by altitude and slope** (`src/modules/forestgen.ts`, #7): each generated wood stays in one altitude band (`leafOf`: broadleaf low, mixed mid, conifer high), so a wood spanning a hill is split into species bands instead of one averaged leaf; `forestCellOk` refuses cells steeper than `FOREST_MAX_SLOPE` (0.55, was 0.7) and exposed convex crests just under the tree line. Field groves use `leafOf(0.2)` of the biome (mixed in Arland, broadleaf in Everon). Tests in `tests/biomes/forest-rules.test.ts`.
- **Power to isolated farms** (`src/modules/powergrid.ts`, step 4, `farmMax` 600 m): a worldgen farm (`FARM_*` or `farm: true`) is no longer planned like a hamlet. It gets one short straight LV drop from the nearest LV pole; failing that a pole-mounted transformer (`TransformerSubstation_01`) beside the nearest MV pole and the drop from it; out of reach it stays unfed. `GridPlan.farms` tells how each farm is fed. Tests: `tests/library/powerfarm.test.ts`.
- **Power distribution in settlements** (`src/modules/powergrid.ts`, Power tab + random world dialog, saved in the project): the line brings one transformer / entrance pole to the settlement entrance on the road it arrives by; new setting *Distribution in settlements*: `auto` (towns and villages over 25 buildings underground past the entrance, small villages one short overhead street run, hamlets one run to the centre), `overhead`, `underground`. LV poles inside villages drop ~5x (seed 77, 8 km: 267 -> 47). Fix, 3D view: zone ground surfaces (industrial plots, military base area and paving) were drawn as 7 m slabs floating beside the roads; bridge parts moved to `src/modules/bridges3d.ts` (tested: decks on the road axis, heading and height).
- **Power lines follow the roads, never over a house** (`src/modules/powerroads.ts`, `powergrid.ts`, `worldpower.ts`): LV (wooden small poles) and the USSR wooden MV are routed on the road graph, poles 4.5 m beside the carriageway edge on the station side (onto the verge, or the other side, only beside a house), none in junctions / roundabouts / on bridges; MV/HV/EHV keep 8 / 30 m from houses, stations and poles never on a house or a fenced plot; spans over a house get a detour pole. New check `powerOverBuilding`. Seeds 7/21/77: LV poles within 10 m of a road 36-43 % -> 82-90 %, poles in a building 11-18 -> 0, houses under a line 26-47 -> 1-8. 3D: bridge decks, railings and piers from the real prefab dims; power poles and sagging cables.
- Random world power step: the hierarchical planner (src/modules/worldpower.ts -> powergrid.ts) with stations and access tracks; lines end on the stations' real cable slots read from the vanilla prefabs (src/modules/powersmooth.ts), poles no longer zigzag (min span 45 % of the spacing, near-straight kinks removed).
- Fix, random world: some 8 km seeds produced no places at all — polyclip threw "Unable to complete output ring" in the campaign field clip and the whole world failed; the clip now retries snapped and drops only that cell.
- **Roads: motorway radius to the ends, short stream bridges** (`src/modules/motorway.ts`, `bridges.ts`, `network.ts`): `trimTightEnds` stops the motorway ~80 m before a bend under 225 m that the sea holds (seed 7: 64 m near the coast end, now ≥ 600 m; the end link carries on); routing charges 30 instead of 400 to step onto a narrow stream (hydro strength < 0.5), so roads cross it on a single 13 m vanilla piece (BridgeConcrete_E_01_small / ConcreteBridge_01 Narrow; vanilla has no culvert prefab) instead of detouring; overpasses checked to be vanilla ConcreteBridge_01 decks + pillars. Tests: full-length radius > 200 m on both carriageways, `tests/library/bridges-streams.test.ts`.
- **Countryside zones, more hamlet fields, bending field tracks**: the countryside zones of the random world can be shown on the map (layer "Countryside zones"); hamlets and farms get a wider ring of fields; field tracks now follow the plot borders with gentle bends and join the road network.
- **Off-map terrain ring** (Relief tab, docs/OUTSIDE_TERRAIN.md): `src/modules/outside.ts` builds a 64 m ring (2-8 km wide) around the map from the edge heights, smoothed along the edge with distance, faded to the sea or a low plain with noise; exact seam, coast kept under water; 3D preview; bridge `POST /outside` writes `profile/MapGen/outside.txt` as 33x33 OTC chunks for `MG_ApplyOutside` (repo copy, not compiled yet).
- **Zone tool Housing: fill follows the zone size and density**: a street grid with loops (parallel streets every 2 lot depths along the main road + cross streets, src/modules/zoneStreets.ts) now serves the whole polygon; lots stay on their street side; deep back strips get second-row houses; new Density selector (sparse / normal / dense, dense = ~2/3 of the street frontage built). A 600×500 m dense zone goes from ~15 houses / 5 streets to ~200 houses / 11 streets.
- Forests: progressive edges in the Workbench export (dense core + 1-2 bands of vanilla brushland / pioneer generators, obstacle avoidance, no edge between touching forests).
- **Road widths = vanilla** (audit of every Prefabs/WEGenerators/Roads generator, docs/ROAD_NETWORK_V2.md §3.2.1): Asphalt E_01 / DashedLine 12 m (was 8), Narrow 8, cobblestone 8, USSR concrete 7.5, concrete panel 3.5, dirt 02 / forest 4.5, trails 1.75; new styles USSR concrete dashed line (11 m) and narrow (5 m), concrete path, coal road and trail.
- **Road classes in the auto network**: town-town and village-town = main (widest asphalt, dashed line), village-village = secondary asphalt, hamlets = narrow asphalt, loops / farms = dirt; auto tracks and trails mostly inside a wood become forest road / forest trail, open trails alternate dirt / gravel.
- **Motorway option** (src/modules/motorway.ts, off by default; Roads step and random world): dual carriageway (two 12 m asphalt splines, median crash barrier) between the biggest places, routed round towns and villages at 6 % max grade with gentle curves, slip-road interchanges (diamond on a crossing road) and links at both ends; other roads fly over it (raised bed + bridge deck) or are cut back, never a level crossing.
- **Roundabouts that actually appear**: also where a main road meets a secondary one, at a place entrance (main / secondary x local), or where two paved T junctions lie < 60 m apart (merged); every branch ends on a ring control point; rings left without branches are removed.

### Fixed
- No bare rock in villages (settlement mask turns rock into grass/dirt).
- Power: no pole left inside a building (farm drops re-checked, impossible poles dropped).
- Everon field groves no longer turn mixed.
- Random world: no field groves in a treeless biome (desert).

- **Power grid hierarchy** (src/modules/powergrid.ts, docs/POWER_GRID.md): 1-3 power plants (DieselPowerPlant_USSR_01, sited near water / industry / roads, away from settlements) with a step-up yard; a meshed transmission loop (MST + a link from every dead end) of EHV (PG_PowerLine_EHV_01, its double stations as bays) and HV lines between plants and the towns' 110 kV substations (TransformerStation110kV_E_01_simple_v1); MV feeders as a tree to a transformer at the edge of every village, industrial zone and remote farm (TransformerSubstation_01 / TransformerStation_E_02 / USSR_02); LV along village streets and to hamlets. Flattened station pads, dirt access tracks, Everon or Soviet pole style (HV_USSR_01, HV_03_Wooden, LV_USSR_01), per-level colours in 2D, station boxes in 3D, stations exported as prefabs.
- **Riparian band** (src/modules/riparian.ts): reeds (FG_Brushland_Phragmites) on the water edge then willow / sallow bushes (FG_Brushland_Salix) along rivers and lake shores. Width follows the height above the nearest water (HAND) and the bank grade: up to ~40 m on flat floodplains, a few metres on steep banks, none on cliffs; each bank measured on its own, broken into patches, kept off roads, bridges, fields, forests, villages and zones. In the random world, and in the Water tab for drawn rivers (checkbox + button); 2D, 3D and Workbench export (generators avoid obstacles).
- **Riparian band v2**: autumn variants (FG_Brushland_Phragmites_aut / FG_Brushland_Salix_aut) when the biome grass is an _aut surface; debounced auto-recompute when drawn rivers / lakes change; forests touching the water are cut by the band (cutForests) instead of blocking it; random worlds measure the height above the carved bank top (bank 4 m) with slightly wider bands.
- **Zone tool "Town"** (src/modules/town.ts, PLAN_RESTANT P3 #13): a 100-300 inhabitant town (40-110 buildings) after watabou's ideas (own code): Voronoi cells relaxed round a central square, main streets = shortest paths from the square to the entry roads, secondary streets on the block edges (closed loops, dead ends pruned), outer cells = farms; each block typed (centre, residential, small industry, park, parking, church) and filled by its type, houses facing the street. Random-world towns use it too (falls back to the village generator on cramped sites). Parking / cemetery blocks are left as open ground for now.
- **Real prefab dimensions**: 4 576 / 4 947 catalogue prefabs carry `d:[w,dz,h,cx,cz]` read from the game .xob mesh bounding boxes (identical to the Workbench measure); `prefabDims()` (src/library/dims.ts) feeds the library footprints and real heights.

## [0.6.0] - 2026-11-16

### Added
- **Real place**: local import of .osm (XML) / .geojson files (picker or drag & drop) with an editable JSON tag -> layer schema: roads (ARTE widths), water, forests, fields, buildings, residential areas, power lines.
- **Surfaces**: rock now depends on slope and relief (crests, slope breaks, cliff height, altitude, near-vertical faces) with a capped share of the land; long even slopes keep their grass / forest floor and scree only lies at cliff feet. Steep islands are no longer almost all rock.
- **Biomes**: biome choice at step 1 and in the random world (7 biomes, availability badge, saved and shared with the project). It drives exported ground surfaces, forest density and conifer / broadleaf mix, forest generators, village gardens (lot templates) and 3D tints. Everon unchanged for the same seed.
- **Asset library** page (dark theme, Library button, 3D preview of lots and assets).
- **Roads V2**: junction welding, fillets, vertical profile, valley bridges, island auto-connect.
- **Atelier — Networks viewer** (rail / roads / power of an existing Workbench project, read-only): hand-placed track pieces chained into lines (length and axis learnt from the data; the base game has no rail-laying generator), road generators (decor generators excluded, T junctions, near misses, disconnected islands, steep segments on the terrain), power-line generators (generated vs hand-placed poles, isolated poles, substations). Map with relief and layer toggles, stats, per-class km, issue list; click → details + **Comment**: a collaboration `comment` op pinned at that spot, room comments shown on the Atelier map. CSV / JSON / PNG / summary export.
- **Atelier — Tile texture simplifier**: negligible surface slots (< 1 %, adjustable) → nearest texture present in the block (name family, then average colour), overridable; per-tile before/after vs the 5/7 budget; preview map; export of corrected `_layer.edds` + CSV plan; experimental Apply through safeWrite with Restore. The `.ttile` TMAT/BMAT material masks are not written yet (repaint the plan in the Workbench).
- **3D view, realistic look** (closer to OpsTrack): new default texture **Réaliste / Realistic** generated from the project data (`src/view3d/drape.ts`), not from the editor render: natural ground colours per surface with noise, rock on slopes, sand on beaches, sea bed shaded by depth, field patchwork with furrows, forest canopy, hedges, rivers / lakes, thin asphalt / dirt roads, building footprints, baked hillshade + ambient occlusion. 8192² when the GPU allows it (max texture ≥ 16384 and ≥ 8 GB), else 4096²; generation time shown in the bar. **Texture** selector: Realistic / Map (2D render without site circles, labels, handles, issues, comments) / Satellite (trace image, when loaded). Draped **km grid** (toggle), terrain block with side skirts (soil + water), sea clipped to the block, ACES + aerial haze + softer sky/sun lighting. Denser instanced trees (~300 k cap, 9 m spacing): broadleaf crowns and conifer cones from the forest leaf type, colour variation, full detail up to 1.6 km, 4-sided cones up to 5 km, canopy texture beyond. Measured ~140 fps on the 8 km random world (RX 9070 XT).
- **3D view** (button 3D on the map, Esc / ◀ 2D to come back at the same spot): three.js 0.185.0 loaded on demand (separate `view3d` chunk, the 2D bundle does not grow). Terrain mesh from the height grid (≤ 1 M vertices, decimated beyond), hillshade lighting, sea at 0, lakes, 2D map draped as a 4096² texture (anisotropy 8, redrawn when the project changes), instanced buildings (villages + zone footprints), random-world valley bridges, instanced trees in the forests (~150 k cap, hidden per 1 km square beyond 3.5 km), map-style camera (pan / orbit / zoom), RELIEF ×1–×3, reset, top view, north arrow; GPU resources freed on exit. Not yet in Atelier mode. FAQ, EN/FR. Plan: `docs/OPSTRACK_3D_STUDY.md`.
- **Share dialog** (create or join a room).
- **Direct collaboration (no server, default)**: WebRTC peer-to-peer rooms (Trystero 0.27.0, Nostr signalling encrypted with the room key, HMAC key check, public STUN, optional TURN). "Create a room" gives a `#salon=…&cle=…` share link + copy button; opening it asks a name and joins. Oldest peer is host (full sync for joiners, takeover when it leaves), room copy kept in IndexedDB, chunked messages. Clear failure after 15 s with a switch to server mode. `CollabTransport` interface (`src/collab.ts`) shared by the server and direct (`src/p2p.ts`) transports. FAQ + glossary, EN/FR.
- Top-left **Menu** button (back to the welcome screen).
- **Atelier mode** (welcome card "Open an existing Workbench project"): finish a project made in the Workbench, parity with giorbev's Map Generator Pro tools. Own layout (stepper A0-A6, layers | map | inspector, journal, X/Z/Y cursor, busy panel, help with FAQ + glossary, EN/FR).
  - A0 open a project folder through the relay (or read-only in the browser, File System Access), list worlds, summary (grid, heights, materials, .layer objects, water).
  - A1 tile diagnostic: textures per block vs. QTRE budget 5/7, problem list, texture search, per-tile table, CSV.
  - A2 surfaces: terrain materials usage + biome presets (giorbev JSON) checked against the project.
  - A3 water as in game (lakes / rivers recomputed from the heights), corrections (lake <= 60 points, river split by width) and `.layer` rewrite with Apply / Restore.
  - A4 in-game 2D map background (military 80s or realistic style, legend, 2k/4k/8k PNG, save into the project) + import guidance.
  - A5 contour-line `.conf` (`SCR_MapConfig`) with optional wall hiding.
  - A6 backups (`_originaux/<time>/`) + Restore, `.rmatelier.zip` export, `.mgp.zip` import.
- Relay: `/atelier/*` endpoints and `safeWrite` (refuses while the Workbench runs, SHA check, backup, never outside the project folder).
- Tests: `node --test "tests/atelier/*.test.*"` (parsers on real files, safeWrite round trip).

### Changed
- **UI polish** (`docs/UI_POLISH_PLAN.md`, 20 points, MILSPEC boards): welcome screen in two groups (Create: 3 equal cards · Existing map: 2 wide cards), full screen (no step panel, Layers or help behind it), "Map in progress → Back to my map" banner from the Menu, random-world card reads "≈ 10 s · 4 to 16 km"; help button in the header (32 px, **F1**) instead of the floating "?", help panel anchored under the header with tabs This step / FAQ / Glossary / Keyboard (step rows clickable, legend moved there); version badge next to the name with an amber unread dot, What's new panel with GOT IT; mouse hint as one short line at the bottom centre (can be hidden); grouped 3D toolbar (BACK TO 2D, Realistic / Map segmented, relief, Trees / Km grid toggles, Reset, Top view; render time as a toast; mouse help at the bottom); collaboration panel with an "Online" list (name chips, direct / relay) and Leave room at the bottom (no more empty "(direct: )" or emoji); Share dialog with Create / Join tabs, one primary button, full-width mono link + COPY, lock warning, "Advanced network settings" link; random world dialog shows only the progress while running (checked stages, %, time left, Cancel) and slider values next to the sliders; toasts stacked at the bottom centre of the map (3 max, errors stay until closed); step list in 13 px with short labels, step buttons on a 2-column grid with destructive actions as red text links, Previous / Next pinned at the bottom of the panel; phone layout (< 720 px): compact header, single-column welcome, foldable step panel. Old blue theme removed from `style.css` (2 px corners, amber only). No emoji left in the UI.
- **Atelier**: header like the generator (← Generator, language selector FR · Français), Workbench chip in amber "Workbench open · read-only" with an explanation on hover (it is normal, not an error), step bar with ✓ done (green) and current step (amber), "Step A1 / A6" kicker, key figures at the head of the panel (blocks over budget / at maximum / tiles), empty state with a "Go to A0 · Project" button. The journal shows the full project path (Windows backslashes kept; the audit's missing backslashes came from the test script, not the app).

## [0.5.0] - 2026-11-16

The big "newcomer" release: a guided interface, a one-click random world and many new things to put on the map.

### Added
- Replayable pipeline (src/modules/replay.ts): world generations recorded in the project file (step, settings, seed, timings, output hashes); top-bar "Replay all" (deterministic, hash-checked) and "Relief in one click" with per-stage timings.
- **Guided 7-step interface**: a welcome screen with entry paths (New island, Random world, Real place, Join a room, Open a file), then 7 numbered steps (Relief, Sculpt, Water, Roads, Villages, Fields & forests, Send) with Next / Previous and a done / out-of-date / to-do state on each step. Advanced settings are folded away.
- **Help everywhere**: a "?" bubble with the 7 steps, controls, FAQ and glossary, a guided tour on the first visit, and an in-app "What's new" panel (also reachable from the version number in the status bar).
- **Language selector**: English / French with the % translated, an option to follow the browser language, and export / import of a language file so anyone can add a translation.
- **Collaboration tab**: comments pinned on the map (reply, resolve), a history of changes (who, which step, when) and a satellite / hillshade mini-map. Rooms are kept on disk by the collab server.
- **Random world generator**: one number makes a whole map — relief, rivers and lakes, towns and villages, airfield, military bases, roads, industrial zones, power lines, forests and ground surfaces. Its numbers are calibrated on the real maps Everon, Arland and Kolguyev. Same number, same map.
- **Villages v2**: organic streets, side streets, farm yards, back gardens, one church per village, ports, and different kinds of place (hamlet, village, town).
- **Industrial zones, military bases and airfields** (step Villages): "Suggest spots" shows ranked numbered spots on the map, a click builds the site and levels the ground.
- **Slope-aware road network**: the automatic network avoids steep ground and is checked on the carved road bed.
- **Power lines** (step Roads): high-voltage pylons between the main places, low-voltage poles along the roads.
- **Surfaces from a satellite photo** (step Fields & forests): 5 colours are read from the photo, each becomes a ground surface, with a preview on the map; send them as ground masks or save a PNG.
- **Ports from ARTE** (MIT, © Icebird): OpenStreetMap road width table, bridges and tunnels left out, road bed above water with a smooth edge, holes in elevation data filled.
- **Workbench connection chip** with a 3-step guide and Retry; `start-bridge.bat` starts the relay with a double-click.
- Hillshade view; the satellite image is now saved with the project.

### Changed
- **MILSPEC Tactical theme**: dark background, amber accents, clear titles, and a status bar with the cursor X / Z / altitude.
- **Heavy work runs in the background** (Web Worker): the page stays responsive, the progress panel shows a real percentage, and Cancel stops the job without changing your map.
- Denser, more believable villages in the random world (about 70 % of lots now get a house instead of 30 %).
- README rewritten for the new interface, with a French README and fresh screenshots.

### Fixed
- "Too many layers" in Workbench: at most 4 ground surfaces per 64 m block, neighbouring blocks included.
- Forests can now be generated on fictive (made-up) islands.
- Every prefab reference carries its verified `{GUID}` (checked against the base-game resource database).
- Real place with Copernicus: the relay is checked first, and if it is off a guide says what to start, with Retry or "Use Terrarium instead".
- The road network and the pre-send check now agree; piers built over water on purpose are no longer flagged.
- The guided tour no longer opens over the welcome screen; farms are counted apart from hamlets; places avoid lakes.
- Many small newcomer fixes: one floating panel at a time, friendlier labels, history step.

## [0.4.8] - 2026-10-17

### Fixed
- Road clean-up also skips interior points closer than 3 m (Workbench "invalid segments on the road").

## [0.4.7] - 2026-10-17

### Added
- Sent vs built report: the bridge writes `profile/MapGen/sent.txt` (every shape and object sent, with suspect geometry flagged), the plugin writes `built.txt` (what it really built: points, generator, objects placed), and the bridge compares them in `report.txt`. The summary shows in the site log.

### Fixed
- Broken road pieces: spline roads are cleaned before sending (points on top of each other, hairpin turns over 120° that made the generator loop, pieces under 0.5 m dropped). The site log says how much was cleaned.

## [0.4.6] - 2026-10-17

### Added
- **Send everything to Workbench** button: roads, water, forests and buildings in one go, with a log of what is sent.

### Fixed
- Big projects reached Workbench empty (0 shapes): its JSON reader fails silently on large files. The bridge now writes the project in ~300 KB parts that the plugin reads back together, and logs the totals.
- "Surface import: Too many layers" on coarse grids: the per-block surface limit now also follows the neighbouring blocks a vertex paints into, with one layer of margin.

## [0.4.5] - 2026-10-17

### Fixed
- OpenStreetMap download: when the main Overpass server is busy (502, 504, 429), two public mirrors are tried in turn.
- Copernicus tiles go through the bridge first, so the console no longer shows a CORS error on every download.

## [0.4.4] - 2026-10-17

### Added
- Real place: building now shows numbered steps (Step 2/5…), a progress bar and the time spent, plus a typical duration for the OpenStreetMap download.

## [0.4.3] - 2026-10-17

### Changed
- Real place: **Find** now downloads the relief straight away, so the preview shows without another click.
- The language button shows the current language (🌐 FR / 🌐 EN) with a clear tooltip.

## [0.4.2] - 2026-10-17

### Fixed
- The site crashed at start-up (tracing image read before it was declared), so no toolbar button worked, including **Real place**.

## [0.4.1] - 2026-10-17

### Fixed
- Real place: OpenStreetMap forests, lakes and fields came out as a single point (closed outlines were simplified away), so forests were then all dropped by the gameplay adaptation. Outlines are now kept.

## [0.4.0] - 2026-10-17

### Added
- Work with several people: shared rooms on a small server (`npm run collab`), the map is synced between
  everyone in the room and each mapper's cursor is shown with their name.
- `CONTRIBUTING.md`, issue templates and a pull request template.
- Start from a real place (Island tab, 🌍): elevation from GeoTIFF, `.asc`, `.hgt` or greyscale PNG, or a
  Copernicus DEM 30 m tile downloaded by latitude / longitude; area picked on a shaded preview (move, size,
  rotation), grid 513 / 1025 / 2049, vertical scale, sea level. OpenStreetMap roads, tracks, paths, rivers,
  lakes, forests, fields and places come with it (Overpass API or JSON file); forests are sent as forest
  generators, field areas can become the field zone. Data credits are kept in the project.
- Bridge: `GET /dem?tile=` fetches and caches a Copernicus DEM tile.
- Parcel library (Villages tab, 📦): gallery and editor of ready-made lots (house + garden, flats + parking,
  farm yard...), JSON export / import, community parcels in `public/parcels/`; the village generator
  uses them, and a new "flats + parking" type fills town centres.

- Real place: OpenStreetMap forests and fields now paint forest floor and crop field surfaces; the height scale follows the real relief.
- Real place: optional OpenStreetMap buildings, each footprint replaced by the closest-sized vanilla building, turned to match.
- Tracing image in the Layers panel: an image you may use (satellite, ortho photo, scanned map) stretched over the terrain, with opacity; display only.
- Tree height for forests: young / normal / mature picks the matching vanilla forest generator; set from a LiDAR canopy height file (CHM) or by right-click on a forest, along with the leaf type.
- Real place: "Adapt for gameplay and performance" (on by default) welds nearby woods into forests, drops small woods and short road pieces, thins dense town centres.
- Real place: search by place name, Copernicus tiles joined into one relief (areas across tile borders), 4 / 8 / 16 / 32 km size buttons, 4 favourite areas, warning over 2046 m of height.
- Real place: relief from Terrarium tiles and IGN (RGE ALTI, LiDAR HD with the tree height); ESA WorldCover land cover paints ground surfaces (forest floor, crops, heath, concrete, dirt) and can outline forests; Esri satellite photo of the area as tracing image. Bridge: `GET /landcover?tile=` forwards WorldCover byte ranges.
- Real place: optional satellite background under the area picker.

### Security
- Collab server: password required before anything is sent (map, cursors, names), listens on the local
  machine by default, wrong passwords blocked after 5 tries, room and size limits, rooms erased when empty.

### Changed
- Roadmap: new phase "Real-world import" (DEM / LiDAR heightmap, OpenStreetMap roads, water, forests,
  fields, buildings, land cover).

## [0.3.0] - 2026-10-16

### Added
- Import the world open in the Workbench: relief, roads, rivers and lakes become editable in the site;
  buildings and signs are shown locked; bridges are rebuilt by the site.
- Right-click on an existing object shows what it is; existing roads can be taken over for editing, and
  any existing object can be deleted from the world on the next send.
- `MG_ExportEntities` and `MG_Status` NET API handlers (read only).
- `MapGen - Capture templates` plugin: captures house + garden parcels from any world (vanilla maps included).
- Villages can be built from the captured parcels ("Captured parcels" option).
- `MapGen - Entity budget` plugin: entities per cell against a per-platform limit, terrain occlusion
  (flat and crest cells), suspects (duplicates, buried objects).
- English UI with a FR/EN toggle; Workbench and bridge messages translated in the French UI.
- Project logo, README diagrams, screenshots, credits tables.

### Changed
- The repository (docs, README, credits, code comments) is now in English.
- The bridge no longer needs the EnfusionMCP addon: it only talks to the plugin's own handlers.
- An imported world survives a page reload.
- Deletions in the world only go with the send that rebuilds the same family (roads, water), so sending
  villages alone never removes roads.

### Removed
- Keyboard shortcuts of the plugins (they clashed with Workbench shortcuts).
- PNG heatmap of the budget plugin (replaced by the report and in-world labels).
- Ground-material export by terrain traces: it crashed the Workbench (ground surfaces are not imported yet).

### Fixed
- Start-up errors when an autosaved project was restored before the page was ready.
- Importing a world kept the previous project's roads, rivers and villages on top of it.

## [0.2.0] - 2026-10-15

### Added
- Local bridge (`npm run bridge`) and "Send to the Workbench" button.
- Island generation, mapgen4-style relief brush, rivers on the grid, sea level and coastal surfaces.
- Surface masks and satellite map generation; 5-surfaces-per-block limit respected.
- Roads: drawing, network generator, per-road width and flattening, verge posts, crash barriers, signs.
- Water: rivers, lakes, banks, bridges at road / river crossings.
- Undo / redo, road list, draggable points, project autosave and save / open file.

### Fixed
- Sign and crash barrier orientation, river level against the terrain, bank orientation (several passes).

## [0.1.0] - 2026-10-14

### Added
- Project scaffold (Vite + TypeScript) and the research, state-of-the-art and roadmap documents.
- First Workbench plugin tests: shapes and generators created by script.

[Unreleased]: https://github.com/benjibossk/mappingenfusiontest/compare/v0.8.0...main
[0.8.0]: https://github.com/benjibossk/mappingenfusiontest/releases/tag/v0.8.0
[0.7.0]: https://github.com/benjibossk/mappingenfusiontest/releases/tag/v0.7.0
[0.5.0]: https://github.com/benjibossk/mappingenfusiontest/releases/tag/v0.5.0
[0.4.8]: https://github.com/benjibossk/mappingenfusiontest/releases/tag/v0.4.8
[0.4.7]: https://github.com/benjibossk/mappingenfusiontest/releases/tag/v0.4.7
[0.4.6]: https://github.com/benjibossk/mappingenfusiontest/releases/tag/v0.4.6
[0.4.5]: https://github.com/benjibossk/mappingenfusiontest/releases/tag/v0.4.5
[0.4.4]: https://github.com/benjibossk/mappingenfusiontest/releases/tag/v0.4.4
[0.4.3]: https://github.com/benjibossk/mappingenfusiontest/releases/tag/v0.4.3
[0.4.2]: https://github.com/benjibossk/mappingenfusiontest/releases/tag/v0.4.2
[0.4.1]: https://github.com/benjibossk/mappingenfusiontest/releases/tag/v0.4.1
[0.4.0]: https://github.com/benjibossk/mappingenfusiontest/releases/tag/v0.4.0
[0.3.0]: https://github.com/benjibossk/mappingenfusiontest/commits/main
[0.2.0]: https://github.com/benjibossk/mappingenfusiontest/commits/main
[0.1.0]: https://github.com/benjibossk/mappingenfusiontest/commits/main
