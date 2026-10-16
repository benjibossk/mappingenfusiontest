# Crédits et sources

Ce projet s'appuie sur le travail de nombreuses personnes. Sauf mention contraire, seules les **idées** ou des **spécifications** ont été reprises ; le code a été réécrit en TypeScript / Enforce Script.

## Projets dont on s'inspire / code porté

| Projet | Auteur | URL | Licence | Ce qu'on a repris |
|---|---|---|---|---|
| BARNMAP (v1.48) | Barnaber / LEBARNABER | https://ustorie.github.io/BARNARMA/ | Aucune (exe fermé) | Comportement et formats `.et` observés, sources de données ; aucun code. **Utilisation autorisée par l'auteur.** |
| Map-generator (« Map Generator Pro » v7) | giorbev | dépôt `giorbev/Map-generator` | MIT (© 2026 Giorbev) | Algorithmes de masques de surfaces (pente, TPI, courbure, flux, biomes JSON) portés / à porter ; documentation des formats binaires (specs). **Utilisation autorisée par l'auteur.** |
| mapgen4 | Amit Patel (Red Blob Games) | https://github.com/redblobgames/mapgen4 | Apache-2.0 | Approche reprise dans `hydro.ts` et `sculpt.ts` (rivières par accumulation de flux, pinceau de relief). La fusion Map-generator / BARNMAP / mapgen4 se fait avec l'autorisation des auteurs. |
| AgriFieldGenerator (v1.2.0) | Tanin69 (Didier ALAIN) | dépôt `Tanin69/AgriFieldGenerator` | MIT (© 2024) | Pipeline de parcelles (Voronoï, Bézier, coloriage) réimplémenté dans `campaign.ts` ; tutoriel « Painting with masks » |
| Benchmark_Tools_reforger | giorbev | — | Aucune (© 2025, tous droits réservés) | Idées de mesure et seuils par plateforme ; aucun code |
| Outils de Lou (`SCR_WorldEditorToolHelper.c`, `SCR_ImageHelper.c`) | Lou | — | non précisée | Idée de heatmap de densité d'entités |
| Azgaar Fantasy Map Generator | Azgaar | https://github.com/Azgaar/Fantasy-Map-Generator | MIT | Idée : score d'habitabilité pour placer les localités |
| ProbableTrain MapGenerator | ProbableTrain | https://maps.probabletrain.com/ | LGPL-3.0 (à confirmer) | Idées (champs de tenseurs pour les rues) |
| Medieval Fantasy City Generator / TownGeneratorOS | watabou | — | GPL-3.0 (ancienne version Haxe) / fermé | Idées seulement |
| city-roads | anvaka | — | MIT | Idées |
| Fantasy Town Generator | — | https://www.fantasytowngenerator.com/temporary-settlement | fermé | Idées |
| FantasyGen City Map Generator | — | https://fantasygen.net/city-map-generator | fermé | Idées |
| Simteract City Generator | Simteract | https://simteract.com/projects/city-generator/ | fermé | Idées |
| Mapimator City Roads | Mapimator | https://mapimator.com/tools/city-roads | fermé | Idées |
| Wave Function Collapse | mxgmn | — | MIT (non vérifié) | Idée |
| ProtonScatter | HungryProton | https://github.com/HungryProton/scatter | — | Idée : pile de filtres de placement |
| PCGExtendedToolkit | PCGEx | https://github.com/PCGEx/PCGExtendedToolkit | — | Idée : réseau routier comme graphe |
| Unreal PCG / Biome Core | Epic Games | https://dev.epicgames.com/documentation/en-us/unreal-engine/procedural-content-generation-pcg-biome-core-and-sample-plugins-overview-guide-in-unreal-engine | propriétaire | Idée : biomes en données |
| ReforgerSatGenerator | granQ | https://github.com/granQ/ReforgerSatGenerator | — | Référence |
| ARTE (plugin QGIS) | — | https://plugins.qgis.org/plugins/ARTE/ | — | Référence (outil concurrent) |

### City builders et jeux étudiés (idées seulement, CITIES.md §6)

- OpenTTD, croissance des villes : https://github.com/OpenTTD/OpenTTD/blob/master/src/town_cmd.cpp (GPL-2.0), https://wiki.openttd.org/en/Manual/Game%20mechanics
- Micropolis (SimCity open source) : https://github.com/SimHacker/micropolis (GPL-3.0)
- Citybound : https://github.com/citybound/citybound, https://aeplay.org/citybound-devblog (AGPL-3.0)
- Cities: Skylines : https://skylines.paradoxwikis.com/Zoning, https://skylines.paradoxwikis.com/Districts
- Manor Lords : https://wiki.hoodedhorse.com/Manor_Lords/Building ; Banished
- Minecraft (villages « jigsaw ») : https://minecraft.wiki/w/Village, https://minecraft.wiki/w/Jigsaw_Block
- Townscaper (Oskar Stålberg) : https://www.gamedeveloper.com/design/how-townscaper-works-a-story-four-games-in-the-making

## Articles scientifiques

- Parish & Müller (2001), « Procedural Modeling of Cities », SIGGRAPH : génération de rues.
- Chen, Esch, Wonka, Müller, Zhang (2008), « Interactive Procedural Street Modeling » : champs de tenseurs.
- Vanegas et al. : découpage de lots.
- Emilien et al. (2012), « Procedural generation of villages on arbitrary terrains », The Visual Computer : https://hal.inria.fr/hal-00694525
- Zevenbergen & Thorne : courbure de terrain (via Map-generator).

Algorithmes publiés, librement réimplémentés ; aucun code copié.

## Outils et sites

- Gaea (QuadSpinner) : https://quadspinner.com/Order/ (idée : masques d'érosion)
- World Machine : https://www.cgchannel.com/?p=122990 (idée : tuilage avec marges)
- World Creator : https://www.world-creator.com/en/buy.phtml
- Houdini (SideFX) : https://www.sidefx.com/faq/question/houdini-engine-plugin-free-for-unity-and-unreal/
- Instant Terra, L3DT, Blender-OSM / Blosm, terrain.party
- PCG UE5.6/5.7 (80.lv) : https://80.lv/articles/what-s-new-in-pcg-in-ue5-6-ue5-7
- Assets Godot (https://godotengine.org/asset-library/asset/edit/14377, https://godotengine.org/asset-library/asset/edit/8541), asset Fab (https://www.fab.com/listings/013f192b-caf4-422f-b560-5166f8c6d9b8), vidéo https://www.youtube.com/watch?v=UmUs9W4riPs : idées

### Bibliothèques utilisées

`@turf/turf` (MIT), `maplibre-gl` (BSD-3-Clause), `poisson-disk-sampling` (MIT), `simplex-noise` (MIT), Vite (MIT), TypeScript (Apache-2.0).

## Mods Workshop étudiés

Lus pour en tirer des idées (extraits de 10 lignes au plus cités dans la doc, aucun code recopié). **Aucune licence ni aucun auteur indiqués.**

- AdvancedTerrainTools (`6874E07B40C6D5E5`)
- OutsideTerrainCore (`61F0D506562D9BC9`) / Outside Terrain Tool : https://reforger.armaplatform.com/workshop/61F2B96F0D3F27D4
- TerrainAutomationTools (`684876344DA83476`)
- Carte exemple OMAHA de BARNMAP (`6A84C9A969207F9F`)
- Freedom Fighters (conventions et skills, voir FF_ET_SKILLS.md)

## Sources de données (DEM, OSM…)

| Donnée | URL | Licence |
|---|---|---|
| OpenStreetMap / Overpass | — | ODbL (attribution + partage à l'identique) |
| ESA WorldCover 10 m | https://registry.opendata.aws/esa-worldcover-vito/ | CC BY 4.0 |
| Copernicus DEM GLO-30 (© DLR / Airbus) | https://registry.opendata.aws/copernicus-dem/ | Licence Copernicus, attribution obligatoire |
| Mapterhorn | https://mapterhorn.com/data-access/ | Par source : https://download.mapterhorn.com/attribution.json |
| IGN LiDAR HD (MNT) | https://www.data.gouv.fr/datasets/mnt-lidar-hd-ign-2025 | Licence Ouverte Etalab 2.0 (à confirmer) |
| Mapzen / Tilezen (Terrarium), Esri World Imagery, fond CARTO | — | Vus dans BARNMAP |

## Outils Bohemia Interactive

- Arma Reforger Tools / Enfusion Workbench, World Editor, Terrain Creation Tool : https://community.bistudio.com/wiki/Arma_Reforger:World_Editor:_Terrain_Creation_Tool
- Wiki Bohemia (BIKI) : https://community.bistudio.com/wiki/ (lu via le dump hors ligne fourni avec enfusion-mcp)
- Terrain Builder / Terrain Processor (Arma 3) : https://community.bistudio.com/wiki/Terrain_Processor:_Tutorial
- Tutoriel terrain officiel : https://reforger.armaplatform.com/news/terrain-tutorial
- Prefabs générateurs vanilla (`Prefabs/WEGenerators/`) et assets vanilla du jeu

Arma Reforger et Enfusion sont des marques de Bohemia Interactive. Outil de fan non officiel.

## Autres

- **enfusion-mcp** : serveur MCP utilisé pour explorer l'API, les fichiers du jeu et le wiki.
- Développement assisté par **Claude (Anthropic)**.

## À vérifier

- Les sources de CITIES.md §6 (city builders) n'ont **pas été vérifiées en ligne** ; licences citées de mémoire.
- URL manquante : Map-generator (giorbev), AgriFieldGenerator (Tanin69), Benchmark_Tools_reforger, watabou, anvaka city-roads, WFC (mxgmn), articles Parish & Müller / Chen / Vanegas, enfusion-mcp.
- Licence inconnue ou non confirmée : ProbableTrain (LGPL-3.0 ?), WFC, ProtonScatter, PCGEx, ReforgerSatGenerator, ARTE, outils de Lou, mods Workshop (aucune), IGN LiDAR HD, licences des libs JS (notées « de mémoire » dans STATE_OF_ART.md).
- Autorisations de BARNMAP et de giorbev : à conserver **par écrit** (BARNMAP est sans licence ; Benchmark_Tools de giorbev est sans licence, distinct de Map-generator).
- Vidéo YouTube et asset Fab de CITIES.md §1 marqués « non vérifié ».
