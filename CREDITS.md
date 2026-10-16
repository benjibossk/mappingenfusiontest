# Credits and sources

This project builds on the work of many people. Unless stated otherwise, only **ideas** or **specifications** were reused; the code was rewritten in TypeScript / Enforce Script.

## Projects that inspired us / ported code

| Project | Author | URL | Licence | What we reused |
|---|---|---|---|---|
| BARNMAP (v1.48) | Barnaber / LEBARNABER | https://ustorie.github.io/BARNARMA/ | None (closed exe) | Observed behaviour and `.et` formats, data sources; no code. **Use authorised by the author.** |
| Map-generator ("Map Generator Pro" v7) | giorbev | repo `giorbev/Map-generator` | MIT (© 2026 Giorbev) | Surface mask algorithms (slope, TPI, curvature, flow, JSON biomes) ported / to port; binary format documentation (specs). **Use authorised by the author.** |
| mapgen4 | Amit Patel (Red Blob Games) | https://github.com/redblobgames/mapgen4 | Apache-2.0 | Approach reused in `hydro.ts` and `sculpt.ts` (rivers by flow accumulation, terrain brush). Merging Map-generator / BARNMAP / mapgen4 is done with the authors' permission. |
| AgriFieldGenerator (v1.2.0) | Tanin69 (Didier ALAIN) | repo `Tanin69/AgriFieldGenerator` | MIT (© 2024) | Plot pipeline (Voronoi, Bézier, colouring) reimplemented in `campaign.ts`; "Painting with masks" tutorial |
| Benchmark_Tools_reforger | giorbev | — | None (© 2025, all rights reserved) | Measurement ideas and per-platform thresholds; no code |
| Lou's tools (`SCR_WorldEditorToolHelper.c`, `SCR_ImageHelper.c`) | Lou | — | not specified | Idea of an entity density heatmap |
| Azgaar Fantasy Map Generator | Azgaar | https://github.com/Azgaar/Fantasy-Map-Generator | MIT | Idea: habitability score to place settlements |
| ProbableTrain MapGenerator | ProbableTrain | https://maps.probabletrain.com/ | LGPL-3.0 (to confirm) | Ideas (tensor fields for streets) |
| Medieval Fantasy City Generator / TownGeneratorOS | watabou | — | GPL-3.0 (old Haxe version) / closed | Ideas only |
| city-roads | anvaka | — | MIT | Ideas |
| Fantasy Town Generator | — | https://www.fantasytowngenerator.com/temporary-settlement | closed | Ideas |
| FantasyGen City Map Generator | — | https://fantasygen.net/city-map-generator | closed | Ideas |
| Simteract City Generator | Simteract | https://simteract.com/projects/city-generator/ | closed | Ideas |
| Mapimator City Roads | Mapimator | https://mapimator.com/tools/city-roads | closed | Ideas |
| Wave Function Collapse | mxgmn | — | MIT (unverified) | Idea |
| ProtonScatter | HungryProton | https://github.com/HungryProton/scatter | — | Idea: stack of placement filters |
| PCGExtendedToolkit | PCGEx | https://github.com/PCGEx/PCGExtendedToolkit | — | Idea: road network as a graph |
| Unreal PCG / Biome Core | Epic Games | https://dev.epicgames.com/documentation/en-us/unreal-engine/procedural-content-generation-pcg-biome-core-and-sample-plugins-overview-guide-in-unreal-engine | proprietary | Idea: data-driven biomes |
| ReforgerSatGenerator | granQ | https://github.com/granQ/ReforgerSatGenerator | — | Reference |
| ARTE (QGIS plugin) | — | https://plugins.qgis.org/plugins/ARTE/ | — | Reference (competing tool) |

### City builders and games studied (ideas only, CITIES.md §6)

- OpenTTD, town growth: https://github.com/OpenTTD/OpenTTD/blob/master/src/town_cmd.cpp (GPL-2.0), https://wiki.openttd.org/en/Manual/Game%20mechanics
- Micropolis (open-source SimCity): https://github.com/SimHacker/micropolis (GPL-3.0)
- Citybound: https://github.com/citybound/citybound, https://aeplay.org/citybound-devblog (AGPL-3.0)
- Cities: Skylines: https://skylines.paradoxwikis.com/Zoning, https://skylines.paradoxwikis.com/Districts
- Manor Lords: https://wiki.hoodedhorse.com/Manor_Lords/Building ; Banished
- Minecraft ("jigsaw" villages): https://minecraft.wiki/w/Village, https://minecraft.wiki/w/Jigsaw_Block
- Townscaper (Oskar Stålberg): https://www.gamedeveloper.com/design/how-townscaper-works-a-story-four-games-in-the-making

## Scientific papers

- Parish & Müller (2001), "Procedural Modeling of Cities", SIGGRAPH: street generation.
- Chen, Esch, Wonka, Müller, Zhang (2008), "Interactive Procedural Street Modeling": tensor fields.
- Vanegas et al.: lot subdivision.
- Emilien et al. (2012), "Procedural generation of villages on arbitrary terrains", The Visual Computer: https://hal.inria.fr/hal-00694525
- Zevenbergen & Thorne: terrain curvature (via Map-generator).

Published algorithms, freely reimplemented; no code copied.

## Tools and sites

- Gaea (QuadSpinner): https://quadspinner.com/Order/ (idea: erosion masks)
- World Machine: https://www.cgchannel.com/?p=122990 (idea: tiling with margins)
- World Creator: https://www.world-creator.com/en/buy.phtml
- Houdini (SideFX): https://www.sidefx.com/faq/question/houdini-engine-plugin-free-for-unity-and-unreal/
- Instant Terra, L3DT, Blender-OSM / Blosm, terrain.party
- PCG UE5.6/5.7 (80.lv): https://80.lv/articles/what-s-new-in-pcg-in-ue5-6-ue5-7
- Godot assets (https://godotengine.org/asset-library/asset/edit/14377, https://godotengine.org/asset-library/asset/edit/8541), Fab asset (https://www.fab.com/listings/013f192b-caf4-422f-b560-5166f8c6d9b8), video https://www.youtube.com/watch?v=UmUs9W4riPs: ideas

### Libraries used

`@turf/turf` (MIT), `maplibre-gl` (BSD-3-Clause), `poisson-disk-sampling` (MIT), `simplex-noise` (MIT), Vite (MIT), TypeScript (Apache-2.0).

## Workshop mods studied

Read for ideas (excerpts of at most 10 lines quoted in the docs, no code copied). **No licence or author stated.**

- AdvancedTerrainTools (`6874E07B40C6D5E5`)
- OutsideTerrainCore (`61F0D506562D9BC9`) / Outside Terrain Tool: https://reforger.armaplatform.com/workshop/61F2B96F0D3F27D4
- TerrainAutomationTools (`684876344DA83476`)
- BARNMAP OMAHA sample map (`6A84C9A969207F9F`)
- Freedom Fighters (conventions and skills, see FF_ET_SKILLS.md)

## Data sources (DEM, OSM…)

| Data | URL | Licence |
|---|---|---|
| OpenStreetMap / Overpass | — | ODbL (attribution + share-alike) |
| ESA WorldCover 10 m | https://registry.opendata.aws/esa-worldcover-vito/ | CC BY 4.0 |
| Copernicus DEM GLO-30 (© DLR / Airbus) | https://registry.opendata.aws/copernicus-dem/ | Copernicus licence, attribution required |
| Mapterhorn | https://mapterhorn.com/data-access/ | Per source: https://download.mapterhorn.com/attribution.json |
| IGN LiDAR HD (DTM) | https://www.data.gouv.fr/datasets/mnt-lidar-hd-ign-2025 | Licence Ouverte Etalab 2.0 (to confirm) |
| Mapzen / Tilezen (Terrarium), Esri World Imagery, CARTO basemap | — | Seen in BARNMAP |

## Bohemia Interactive tools

- Arma Reforger Tools / Enfusion Workbench, World Editor, Terrain Creation Tool: https://community.bistudio.com/wiki/Arma_Reforger:World_Editor:_Terrain_Creation_Tool
- Bohemia wiki (BIKI): https://community.bistudio.com/wiki/ (read via the offline dump shipped with enfusion-mcp)
- Terrain Builder / Terrain Processor (Arma 3): https://community.bistudio.com/wiki/Terrain_Processor:_Tutorial
- Official terrain tutorial: https://reforger.armaplatform.com/news/terrain-tutorial
- Vanilla generator prefabs (`Prefabs/WEGenerators/`) and vanilla game assets

Arma Reforger and Enfusion are trademarks of Bohemia Interactive. Unofficial fan tool.

## Other

- **enfusion-mcp**: MCP server used to explore the API, the game files and the wiki.
- Development assisted by **Claude (Anthropic)**.

## To verify

- The CITIES.md §6 sources (city builders) were **not verified online**; licences quoted from memory.
- Missing URL: Map-generator (giorbev), AgriFieldGenerator (Tanin69), Benchmark_Tools_reforger, watabou, anvaka city-roads, WFC (mxgmn), Parish & Müller / Chen / Vanegas papers, enfusion-mcp.
- Unknown or unconfirmed licence: ProbableTrain (LGPL-3.0?), WFC, ProtonScatter, PCGEx, ReforgerSatGenerator, ARTE, Lou's tools, Workshop mods (none), IGN LiDAR HD, JS library licences (noted "from memory" in STATE_OF_ART.md).
- BARNMAP and giorbev permissions: to be kept **in writing** (BARNMAP has no licence; giorbev's Benchmark_Tools has no licence, separate from Map-generator).
- YouTube video and Fab asset from CITIES.md §1 marked "unverified".
