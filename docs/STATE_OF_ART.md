# État de l'art — génération / auto-remplissage de terrain

Mis à jour le 2026-10-14. Légende : **[V]** vérifié en ligne lors de cette passe (lien fourni) · **[M]** de mémoire, non vérifié — à confirmer avant toute décision juridique ou commerciale.

Contexte : outil web qui produit relief, masques de surfaces, shapes `.et` pilotant les générateurs natifs Enfusion (Forest/Road/River/Lake/Prefab/Wall), placement de prefabs, imports OSM/DEM/WorldCover, budget perf par plateforme.

## 1. Unreal Engine

| Outil | Ce qu'il fait / technique clé | Licence / prix | Idée à reprendre |
|---|---|---|---|
| PCG Framework (UE5) | Graphe de nœuds sur des « points » attribués : Surface/Spline Sampler, Density Filter, Self Pruning, Difference, Transform Points, Static Mesh Spawner ; Shape Grammar (5.4+) [M] pour subdiviser des splines en modules. Production-ready annoncé avec 5.7 ; ~2x plus rapide que 5.5 [V](https://80.lv/articles/what-s-new-in-pcg-in-ue5-6-ue5-7) | Inclus dans UE (EULA Epic, royalties >1 M$) [M] | Modèle « nuage de points attribués → filtres → spawner » comme cœur du pipeline prefabs |
| PCG Biome Core (V2 en 5.6) | Biomes data-driven (data assets), blending par biome, couches multiples ; plugin toujours « experimental », Epic conseille de le copier [V](https://dev.epicgames.com/documentation/en-us/unreal-engine/procedural-content-generation-pcg-biome-core-and-sample-plugins-overview-guide-in-unreal-engine) | Inclus UE | Définir les biomes comme fichiers de données (JSON) : règles d'assets + densités + priorité de blending |
| PCGEx (PCG Extended Toolkit) | Graphes (cluster), pathfinding, requêtes spatiales, filtres [V](https://github.com/PCGEx/PCGExtendedToolkit) | **MIT** [V] gratuit | Construire le réseau routier comme graphe (Delaunay/MST + pathfinding sur coût de pente) avant d'émettre les splines Road |
| Landmass / Water | Brushes non destructifs empilés sur la heightmap (Blueprint brushes) ; Water carve le lit des rivières depuis la spline [M] | Inclus UE [M] | Pile de « brushes » non destructifs : route qui aplanit, rivière qui creuse, recalculés à chaque modification |
| Brushify | Packs de landscape materials + auto-material par pente/altitude [M] | Payant Fab [M] | Auto-matériau pente/altitude/courbure → masques de surfaces |
| Houdini Engine (UE/Unity) | Exécute des HDA Houdini dans le moteur | Plugin gratuit pour usage commercial depuis 2021 (≤10 licences/studio, HDA seulement) [V](https://www.sidefx.com/faq/question/houdini-engine-plugin-free-for-unity-and-unreal/) | « Outil = actif paramétré » : nos presets doivent être des paquets de paramètres rejouables |

## 2. Unity

| Outil | Technique clé | Licence / prix | Idée |
|---|---|---|---|
| MapMagic 2 | Graphe de nœuds, génération infinie par tuiles, biomes en sous-graphes [M] | Core gratuit + modules payants Asset Store [M] | Génération par tuiles indépendantes (worker par tuile) + sous-graphes biomes |
| Gaia Pro | Stamps (tampons de relief) + « spawners » à règles (pente, hauteur, texture, bruit) [M] | Payant Asset Store [M] | Spawner à règles cumulatives, fitness 0–1 par critère, multipliées |
| Vegetation Studio Pro | Règles de végétation par biome, masques, rendu instancié [M] | Payant (déprécié ?) [M] | Masques d'exclusion (routes, bâtiments) prioritaires sur la végétation |
| MicroSplat | Splatmaps optimisées, triplanar, texture clustering [M] | Core gratuit + modules payants [M] | Limiter le nb de couches par cellule (Enfusion : budget surfaces par bloc) |

## 3. Godot

| Outil | Technique | Licence | Idée |
|---|---|---|---|
| Terrain3D | Geometry clipmaps, régions, control map (2 textures + blend par pixel) | **MIT** [V](https://godotengine.org/asset-library/asset/edit/14377) | Encodage compact « texture base/overlay + blend » par pixel |
| ProtonScatter | Scatter par modificateurs empilés (random, grid, project on colliders, relax) | **MIT** [V](https://github.com/HungryProton/scatter) | UI de pile de modificateurs ordonnée pour le placement prefab |
| Spatial Gardener | Peinture de végétation avec densité par octree | **MIT** [V](https://godotengine.org/asset-library/asset/edit/8541) | Pinceau de densité manuel par-dessus le procédural |

## 4. Logiciels autonomes de terrain

| Outil | Technique | Licence / prix | Idée |
|---|---|---|---|
| Gaea (QuadSpinner) | Graphe, érosion hydraulique/thermique, export masques (flow, deposition, wear) | Perpétuel : Community gratuit (non commercial), Indie 99 $ (<100 k$), Pro 199 $, Enterprise 299 $ ; Gaea 3 en EA juillet 2026 [V](https://quadspinner.com/Order/) | Exporter les masques d'érosion (flow/deposition) comme sources des masques de surfaces |
| World Machine | Graphe de devices, érosion, tiling | Basic gratuit (≤1025², non commercial) ; Indie 119 $, Pro 299 $ (prix 2021) [V](https://www.cgchannel.com/?p=122990) | Sortie tuilée avec marges recouvrantes (évite coutures) |
| World Creator | GPU temps réel, biomes (2025.1), scattering | Abonnement/perpétuel ; chiffres contradictoires (49 $/an Indie sur le site vs 149 $ selon CGChannel) [V](https://www.world-creator.com/en/buy.phtml) | Aperçu GPU instantané des règles de biome |
| Instant Terra | Terrains très grands, streaming, recommandé par des créateurs Reforger [V](https://reforger.armaplatform.com/news/terrain-tutorial) | Payant [M] | Traitement par tuiles pour cartes 10–20 km |
| Houdini (SideFX) | Heightfields, érosion, OSM import, PDG | Indie ~299 $/an (<100 k$) [V tiers](https://superrendersfarm.com/article/how-much-does-houdini-cost) ; Apprentice gratuit | Masques dérivés (curvature, flow, slope) en un clic |

## 5. Arma

| Outil | Technique | Licence | Idée |
|---|---|---|---|
| Terrain Builder / Terrain Processor (Arma 3) | TP : tâches chaînées sur shapefiles (placement le long de lignes, dans polygones, heightmap depuis .asc) ; heightmap carrée puissance de 2 [V](https://community.bistudio.com/wiki/Terrain_Processor:_Tutorial) | Arma 3 Tools, gratuit [M] | Reproduire le modèle « shapefile + tâche » : polygone OSM → générateur Enfusion |
| Enfusion World Editor — Terrain Creation Tool | Import heightmap .asc ou PNG 16 bits (hauteurs relatives → plage à réétalonner) [V](https://community.bistudio.com/wiki/Arma_Reforger:World_Editor:_Terrain_Creation_Tool) | Workbench gratuit | Exporter PNG 16 bits + .asc avec min/max documentés |
| ARTE (plugin QGIS) | Export satellite + heightmap pour Reforger, aplanissement routes, creusement rivières depuis OSM — pas encore de version publique [V](https://plugins.qgis.org/plugins/ARTE/) | ? | Concurrent direct : différencier par l'émission de shapes `.et` + prefabs |
| Outside Terrain Tool (Workshop) | Outil Workbench communautaire pour terrain hors-carte [V](https://reforger.armaplatform.com/workshop/61F2B96F0D3F27D4) | Workshop (APL ?) [M] | Générer aussi l'« outer terrain » |
| L3DT | Historiquement populaire pour Arma 3, abandonné [V](https://reforger.armaplatform.com/news/terrain-tutorial) | — | — |

## 6. Web / open source / données

| Outil / donnée | Technique | Licence | Idée |
|---|---|---|---|
| mapgen4 (Red Blob Games) | Dual mesh Delaunay/Voronoï, élévation peinte, rivières par drainage, rendu WebGL | **Apache 2.0** [V](https://github.com/redblobgames/mapgen4) | Rivières par flow accumulation sur mesh ; peinture d'élévation interactive |
| Azgaar FMG | Voronoï, climat, biomes, routes, burgs | **MIT** [V](https://github.com/Azgaar/Fantasy-Map-Generator) | Placement de villages selon score d'habitabilité (eau, pente, routes) |
| Watabou (MFCG, Village) | Génération de plans de villes/villages | Code source fermé (anciennes versions Haxe GPL-3 [M]) | Export GeoJSON de Watabou → bâtiments prefabs |
| WFC (mxgmn) | Wave Function Collapse | **MIT** [M] (lien vers LICENSE non lu) | WFC sur grille pour layout de bases/camps |
| Blender-OSM / Blosm | Import OSM + reliefs dans Blender | Gratuit de base / premium payant [M] | — |
| terrain.party / Tangram heightmapper | Export heightmap depuis tuiles Mapzen terrarium | terrain.party hors ligne [M] | Encodage terrarium/terrain-RGB côté navigateur |
| Mapterhorn | Tuiles terrain publiques (Copernicus GLO-30 + LiDAR nationaux), PMTiles | Licence par source : voir [attribution.json](https://download.mapterhorn.com/attribution.json) [V](https://mapterhorn.com/data-access/) | Source DEM principale côté web (pas de serveur) |
| ESA WorldCover 10 m | Occupation du sol 11 classes | **CC BY 4.0** [V](https://registry.opendata.aws/esa-worldcover-vito/) | Table classe → surface/générateur Enfusion |
| Copernicus DEM GLO-30 | DEM 30 m mondial | Licence Copernicus spécifique, libre, attribution obligatoire (© DLR/Airbus…) [V](https://registry.opendata.aws/copernicus-dem/) | Attribution auto dans l'export |
| IGN LiDAR HD (MNT 50 cm) | MNT dalles 1 km, ASC/TIF | Licence Ouverte Etalab 2.0 (pratique IGN) — page IGN non lue [M]/[V partiel](https://www.data.gouv.fr/datasets/mnt-lidar-hd-ign-2025) | Import haute résolution France |
| OpenStreetMap | Vecteurs | **ODbL** [M] | Attribution + partage à l'identique sur la base de données dérivée |

## 7. Briques JS/TS (licences [M] sauf mention ; toutes permissives classiques)

| Lib | Usage | Licence |
|---|---|---|
| simplex-noise | Bruit 2D/3D/4D | MIT [M] |
| fastnoise-lite | Bruits variés + domain warp, cellular | MIT [M] |
| poisson-disk-sampling | Placement prefabs à distance minimale, rayon variable | MIT [M] |
| delaunator / d3-delaunay | Triangulation, Voronoï (routes, parcelles) | ISC [M] |
| @turf/turf | Géométrie géo (buffer, intersect, simplify) | MIT [M] |
| osmtogeojson | Overpass → GeoJSON | MIT [M] |
| geotiff (geotiff.js) | Lecture COG/GeoTIFF DEM & WorldCover | MIT [M] |
| proj4 | Reprojection (WGS84 → UTM/Lambert-93) | MIT [M] |
| maplibre-gl | Carte de sélection de zone | BSD-3 [M] |
| three | Aperçu 3D | MIT [M] |
| rete / litegraph.js | Éditeur de graphe de nœuds | MIT [M] |
| polygon-clipping | Booléens de polygones (masques d'exclusion) | MIT [M] |
| upng-js / pngjs | Écriture PNG 8/16 bits (heightmap) | MIT [M] |

## Top idées à intégrer

1. **Nuage de points attribués + filtres + spawner** (PCG/ProtonScatter) : chaque règle de placement = pile ordonnée de filtres (pente, altitude, masque, distance route, bruit).
2. **Brushes non destructifs** (Landmass) : routes aplanissent, rivières creusent, recalculés à partir des shapes.
3. **Biomes en fichiers de données** (Biome Core) avec priorité et blending.
4. **Masques dérivés** (Gaea/Houdini) : slope, curvature, flow accumulation → surfaces et forêts.
5. **Réseau routier comme graphe** (PCGEx) : MST/pathfinding sur coût de pente puis export en shapes Road.
6. **WorldCover → table de correspondance** surfaces/générateurs, éditable.
7. **Shapes + tâches** (Terrain Processor) : polygone/ligne OSM = entrée d'un générateur natif Enfusion (Forest/Road/River/Lake/Wall).
8. **Traitement par tuiles avec marges** (World Machine/MapMagic) dans des Web Workers.
9. **Score d'habitabilité** (Azgaar) pour poser villages/prefabs.
10. **Attribution automatique** des sources (Copernicus, ESA, OSM ODbL, IGN) dans l'export.

## Briques JS/TS retenues (licence, usage)

- `geotiff` (MIT) + `proj4` (MIT) : import DEM/WorldCover et reprojection.
- `osmtogeojson` (MIT) + `@turf/turf` (MIT) + `polygon-clipping` (MIT) : vecteurs OSM, buffers, masques d'exclusion.
- `fastnoise-lite` (MIT) : bruit + domain warp ; `poisson-disk-sampling` (MIT) : placement.
- `d3-delaunay` (ISC) : graphe routier, parcelles.
- `pngjs` (MIT) : écriture PNG 16 bits heightmap / 8 bits masques.
- `maplibre-gl` (BSD-3) : sélection de zone ; `three` (MIT) : aperçu 3D.
- `rete` (MIT) : éditeur de graphe si on expose les règles en nœuds.
- Licences JS à reconfirmer par `npx license-checker` à l'installation.

## Sources principales

- QuadSpinner Order — https://quadspinner.com/Order/
- World Creator buy — https://www.world-creator.com/en/buy.phtml ; World Machine (CGChannel 2021) — https://www.cgchannel.com/?p=122990
- Epic Biome Core — https://dev.epicgames.com/documentation/en-us/unreal-engine/procedural-content-generation-pcg-biome-core-and-sample-plugins-overview-guide-in-unreal-engine
- PCGEx — https://github.com/PCGEx/PCGExtendedToolkit ; ProtonScatter — https://github.com/HungryProton/scatter
- mapgen4 — https://github.com/redblobgames/mapgen4 ; Azgaar — https://github.com/Azgaar/Fantasy-Map-Generator
- SideFX Houdini Engine FAQ — https://www.sidefx.com/faq/question/houdini-engine-plugin-free-for-unity-and-unreal/
- ESA WorldCover — https://registry.opendata.aws/esa-worldcover-vito/ ; Copernicus DEM — https://registry.opendata.aws/copernicus-dem/
- Mapterhorn — https://mapterhorn.com/data-access/
- BI Wiki Terrain Creation Tool — https://community.bistudio.com/wiki/Arma_Reforger:World_Editor:_Terrain_Creation_Tool ; Terrain Processor — https://community.bistudio.com/wiki/Terrain_Processor:_Tutorial
- ARTE QGIS — https://plugins.qgis.org/plugins/ARTE/
