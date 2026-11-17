# Bibliothèque de générateurs de zones — catalogue candidat

Recherche du 2026-11-17. Ce qui existe déjà : Champs, Forêt, Habitation, Industriel, Habitat dispersé, et Forêt de production (en cours).
Sources des chemins : index du jeu de base (enfusion-mcp `asset_search`, ~85 000 fichiers). L'outil n'a renvoyé aucun GUID, donc il faut les résoudre via `.meta` / `library/compositions-vanilla.json`.

## 1. Générateurs natifs du World Editor (base game)
D'après le wiki BI, il en existe 7, tous construits sur une **shape** (le générateur doit être l'enfant direct de la shape depuis la 1.0) :
Forest, Lake, Power Line, Prefab, River, Road, Wall.

| Générateur | Préfixe / dossier | Usage pour nous |
|---|---|---|
| WallGeneratorEntity | `Prefabs/WEGenerators/Walls/**` (`WG_*`, base `WG_WallGenerator_base.et`) | Clôtures et murs le long d'une polyligne (offsets first/middle/last, padding, `m_bSnapToTerrain`) |
| PrefabGeneratorEntity | `Prefabs/WEGenerators/Bushline/PG_*` | Haies et lignes d'arbres (`m_fDistance`, `m_fGap`, `m_bAlignWithShape`, Perlin) |
| ForestGeneratorEntity | `Prefabs/WEGenerators/Brushland/FG_*`, `PrefabLibrary/*/Generators/Stones/FG_Beach*` | Surfaces remplies de végétation ou de pierres |
| Road / decals | `Prefabs/WEGenerators/Decals/**` (`RG_*` : Asphalt_Patch_Stripe, Beach_NatureDebris, ConcretePanelRow, Coal_Tracks) | Marquages au sol et débris le long d'une ligne |
| Lake / River / PowerLine | wiki | Hors périmètre « zone », déjà couvert ailleurs |

Les murs WG utiles : `Walls/Brick/WG_BrickWall_01|02|Old_01`, `Walls/Concrete/WG_ConcreteWall_01|USSR_03`, `Walls/Crashbarrier/WG_CrashBarrier_01A|E_01`, `Walls/Custom/WG_WoodenConcretePoleFence_03`, `Walls/Metal/WG_MetalFence_USSR_01|MetalFenceDecorative_E_01|E_02|MetalWall_01`, ainsi que `PrefabLibrary/CainLibrary/Generators/Walls/Net/WG_NetFence_05_*` (grillage vert, blanc, jaune, en version short) et `WG_NetFence_USSR_01`.

**Ce qu'aucun générateur natif ne fait** : remplir un polygone avec des objets *organisés* (rangées, grille, emplacements de parking, tombes alignées, piquets de vigne). Le ForestGenerator répartit au hasard, et le PrefabGenerator ne suit qu'une ligne. Les « zones structurées » sont donc à écrire nous-mêmes dans `zonefill.ts`, en émettant des prefabs ponctuels et des WG sur les bords.

## 2. Catalogue

Effort : S < 1 j, M 1 à 3 j, L > 3 j. Priorité : 1 = haute.

| # | Zone | Produit | Règles | Base game à utiliser | Manque (à construire) | Effort | Prio |
|---|---|---|---|---|---|---|---|
| 1 | **Pâturage clôturé** | Prairie bordée de clôture, abri et foin | Polygone de 0,5 à 5 ha, pente < 15°, près d'une ferme ou d'une Habitation. Clôture WG sur tout le périmètre avec 1 ou 2 portails côté route. Bottes de foin en grappes, abreuvoir près du bord | WG `WoodenConcretePoleFence_03` / NetFence, `FG_Brushland_Pastures_01`, `Prefabs/Props/Agriculture/Farm/HayBale_01*`, `HayPile_01`, `HaystackDryer_01`, CowShed_E_01 (asset `Assets/Structures/Agriculture/CowShed/`) | **Aucun animal (vache) en prefab.** Pas d'abreuvoir trouvé. Insertion de portail dans le WG | S | 1 |
| 2 | **Parking** | Nappe d'asphalte + rangées de places + véhicules épaves | Rectangle orienté sur la route la plus proche, accès côté route. Places de 2,5 × 5 m, allée de 6 m. Taux d'occupation de 20 à 60 %, lampadaires tous les 25 m en bordure, crash barrier ou bordure | `RG_Asphalt_Patch_Stripe_01`, `WG_CrashBarrier_*`, `PrefabLibrary/DefaultLibrary/Infrastructure/Lamps/LampStreet_E_01_6m*`, épaves `PrefabLibrary/CainLibrary/Props/Military/UAZ452_wreck_static.et` etc. (150 « Wreck »), panneaux Parking (asset `Sign_Informational_Parking`) | **Pas de générateur de parking ni de décal de place.** Grille de places et peinture au sol (décal en ligne répétée) | M | 1 |
| 3 | **Chantier** | Emprise clôturée, matériaux, engins, base vie | Rectangle de 0,2 à 1 ha au bord d'une route ou d'une Habitation, clôture grillage (NetFence) et un portail. Grue au centre, piles de matériaux sur les bords, conteneurs alignés | `Prefabs/Props/Military/Camps/ConstructionMaterialPacked_*`, `PrefabLibrary/CainLibrary/Structures/Industrial/GantryCrane_E_01.et`, `Prefabs/Props/Industrial/CraneShovel_01/*`, `CrawlerCraneWreck_01`, `DieselGenerator_01`, PNJ `Character_CIV_ConstructionWorker_*`, compos `*UnderConstruction_*` | **Pas d'échafaudage** (aucun résultat « Scaffold »), pas de bâtiment inachevé | M | 1 |
| 4 | **Plage** | Bande de sable entre l'eau et la terre, galets, débris, loisirs | Bande de 10 à 40 m le long du trait de côte (altitude de 0 à 2 m, pente < 8°). Débris en ligne sur la laisse de mer, serviettes et parasols en grappes près d'un accès | `FG_BeachStones_Sparse`, `FG_BeachStone_Dense`, `RG_Beach_NatureDebris_01/02_TEMP`, `PG_Fucus_fesiculosus`, `Granite_BeachCluster_01*`, `PrefabLibrary/DefaultLibrary/Props/Civilian/Recreation/BlanketBeach_01_*`, `Infrastructure/Naval/PierConcrete_01_*` | Détection automatique du trait de côte et peinture de la texture sable. Pas de poste de maître-nageur ni de parasol trouvés (à vérifier) | M | 1 |
| 5 | **Cimetière** | Enclos muré, tombes en grille, chapelle optionnelle | Rectangle de 0,1 à 0,5 ha près d'un village, pente < 10°. Mur WG brique ou métal décoratif, tombes en rangées de 2 × 1 m avec allée centrale | `WG_BrickWall_01`, `WG_MetalFenceDecorative_E_01`, `PrefabLibrary/*/Props/Cultural/Gravestone_USSR_01_A|B|C`, `GraveStone_E_01_A|B` (33 résultats) | Grille orientée, simple | S | 2 |
| 6 | **Poste de chasse** | Miradors en lisière, mangeoires, sentier | Points en lisière de Forêt tournés vers une clairière ou un champ, espacés de 150 à 400 m, 1 à 3 par massif | (rien de dédié) | **Aucun mirador (high seat), affût ni mangeoire** dans le base game. Il faudrait un mod Workshop, ou un ersatz (tour de guet militaire, HayPile) | S (règles) / L (assets) | 2 |
| 7 | **Checkpoint militaire** | Barrage sur la route | Ponctuel sur une route, perpendiculaire à l'axe | Compos slottées `Prefabs/Compositions/Slotted/SlotRoad{Small,Medium,Large}/Checkpoint*` (y compris UnderConstruction) | Rien : il suffit de choisir la taille selon la largeur de route | S | 2 |
| 8 | **Port / ponton** | Quais, jetées, grues portuaires | Le long de la côte ou d'un lac, profondeur suffisante | `PierConcrete_01_10m_end|20m|20m_T|corner_*`, `HarborCrane_01`, `ShipWreckMetal_01-03` | Assemblage de segments de quai (logique de snapping) | M | 2 |
| 9 | **Casse / dépôt de ferraille** | Épaves empilées dans un enclos | Polygone clôturé (MetalWall/NetFence), épaves en rangées serrées à rotation aléatoire | 150 prefabs « Wreck », `WG_MetalWall_01` | Rien de majeur | S | 2 |
| 10 | **Camp militaire / FOB** | Tentes, sacs de sable, générateurs | Plat < 5°, près d'une route, clôture barbelée ou sacs de sable sur le périmètre | `TentUS_01`, `GeneratorMilitary_*`, `GeneratorFloodlight_*`, compos `Compositions/Slotted/SlotFlat*` | Disposition en grille des slots | M | 3 |
| 11 | Verger / vigne | Arbres ou piquets en rangées | Pente < 20°, rangées orientées selon la pente ou au sud, espacement de 4 à 6 m (verger) ou 2 m (vigne) | Arbres fruitiers à identifier dans `Prefabs/Vegetation` | Placement en rangées (réutiliser Forêt de production) | S | 3 |
| 12 | Carrière | Fosse, tas de gravats, engins | Pente forte, éloignée de l'Habitation | `CraneShovel_01`, Coal_Tracks decal, rochers | Excavation du heightmap | L | 3 |
| 13 | Terrain de sport | Terrain rectangulaire, buts, grillage | Plat < 3 °, près d'une Habitation | `WG_NetFence_05_*` | Buts et marquages à chercher | S | 3 |
| 14 | Station-service / gare | Bâtiment et quai le long d'une route ou d'une voie | Collé à la route ou à la voie | à chercher (`GasStation`, `Railway`) | — | M | 3 |

## 3. Règles transverses (inspirées des autres outils)
- **Grammaire de clôture** (UE PCG Shape Grammar) : `Poteau (Panneau)* Portail (Panneau)* Poteau`, avec des poids pour les panneaux cassés, l'emplacement du portail au plus près de la route, et un remplissage « jusqu'à la fin de la spline ». Le WG natif couvre panneau et poteau, mais le portail doit être inséré par nous (en coupant la polyligne).
- **Subdivision de parcelle** (CityEngine, generateurs de parking UE) : rectangle orienté selon la route → bandes (allée / places) → cellules → occupation aléatoire.
- **Filtres** systématiques : pente maximale, distance à la route et à l'eau, exclusion des autres zones, densité par hectare.
- **Bords** : chaque zone expose un `border` facultatif (WG ou PG) et un nombre de `gates` facultatif.

## 4. Manques du base game (constat)
- Aucun **animal** domestique en prefab (vaches, moutons) : les pâturages resteront vides, ou il faudra un mod.
- Aucun **mirador de chasse** (high seat), affût ni mangeoire.
- Aucun **échafaudage** pour les chantiers.
- Aucun **générateur de remplissage structuré** (grille ou rangées) : c'est le cœur de ce qu'on doit écrire.
- Il existe le mod Workshop « More Generators for Arma Tools », qui ajoute des props (sacs de sable, tombes) aux générateurs Wall et Forest. Il est à évaluer comme dépendance optionnelle.

## Sources
- https://community.bistudio.com/wiki/Category:Arma_Reforger/Modding/Official_Tools/World_Editor_Generators
- https://community.bistudio.com/wiki/Arma_Reforger:World_Editor:_Wall_Generator
- https://community.bistudio.com/wiki/Arma_Reforger:World_Editor:_Prefab_Generator
- https://community.bistudio.com/wiki/Arma_Reforger:World_Editor:_Forest_Generator
- https://community.bistudio.com/wikidata/external-data/arma-reforger/ArmaReforgerScriptAPIPublic/interfaceWallGeneratorEntity.html
- https://reforger.armaplatform.com/workshop/686B2E58EF87757B-MoreGeneratorsforArmaTools
- https://reforger.armaplatform.com/workshop/684876344DA83476-TerrainAutomationTools
- https://dev.epicgames.com/documentation/unreal-engine/creating-a-fence-generator-using-shape-grammar-in-unreal-engine
- https://dev.epicgames.com/documentation/unreal-engine/using-shape-grammar-with-pcg-in-unreal-engine
- https://80.lv/articles/procedural-parking-lot-generator-in-unreal-engine-5

## Générateurs externes (outils et plugins)

Recensement (2026-11) d'outils/plugins de génération procédurale de zones, hors ceux déjà couverts dans `OTHER_GAMES_TOOLS.md`, `CITIES.md`, `STATE_OF_ART.md`. Prix/licences indicatifs.

| Nom | URL | Type / licence | Ce qu'il génère | Règle à copier | Inspire |
|---|---|---|---|---|---|
| Unreal PCG Framework | dev.epicgames.com/documentation/en-us/unreal-engine/procedural-content-generation-overview | plugin natif UE5, gratuit | scatter, splines, biomes | graphe Surface Sampler → Density Filter → Self Pruning (rejet par rayon) → Spawn ; attributs par point | tous (architecture pipeline) |
| UE PCG "Spline fence/wall" (Electric Dreams sample) | unrealengine.com (Electric Dreams) | sample gratuit | clôtures, murets le long de splines | poteau tous les N m, panneau orienté entre poteaux, coin = poteau forcé | pâture clôturée, cimetière |
| PCG Biome Core (UE 5.4+) | dev.epicgames.com (PCG Biome Core) | plugin natif | biomes forestiers en couches | priorité de couches + exclusion des couches supérieures, lisière | forêt, forêt de production |
| Houdini SideFX Labs | sidefx.com/products/sidefx-labs | gratuit (Houdini Indie payant) | routes, trees, scatter, building gen | Labs Lot Subdivision (découpage parcelle façade-route), Labs Road Generator | habitat, industrie |
| Houdini Parking Lot HDA (tutos/Orbolt) | orbolt.com | HDA, divers | parkings | bandes places 2,5×5 m + allées 6 m alternées, orientation sur bord le plus long, arbres en îlots | parking |
| Houdini "City Builder" / Labs Building Generator | sidefx.com/tutorials | gratuit | façades, îlots | modules étage/travée répétés, coin et RDC spécifiques | habitat, industrie |
| CityEngine CGA (rule libraries ESRI) | doc.arcgis.com/en/cityengine | payant | bâtiments, parcelles | split(x){~3: fenêtre}* ; parcelles par subdivision « offset/skeleton », setback rue | habitat, ferme |
| MapMagic 2 (Unity) | assetstore.unity.com (Denis Pahunov) | gratuit + modules payants | terrain, objets, arbres | nœuds Scatter (grille jitter) + Stamp + masques de pente/hauteur | forêt, champ |
| Gaia Pro / GeNa Pro (Procedural Worlds) | procedural-worlds.com | ~$70-150 | biomes, spawn le long de splines | « spawn criteria » (pente, hauteur, texture, distance) avec courbes de fitness | tous (filtres) |
| Vegetation Studio Pro (Awesome Technologies) | assetstore.unity.com | payant | végétation | règles de biome + masques d'exclusion autour routes/bâtiments | forêt, lisière |
| CiDy 2 (Unity) | assetstore.unity.com | payant | villes, routes, îlots | graphe routier → îlots → lots → bâtiments face rue | habitat |
| EasyRoads3D | easyroads3d.com | gratuit/Pro | routes, carrefours | « side objects » (poteaux, glissières) à pas fixe le long du tracé | check-point, parking |
| Road Architect (Unity, OSS) | github.com/MicroGSD/RoadArchitect | MIT | routes, intersections | terrassement automatique sous route | routes, parking |
| Geo-Scatter / Scatter5 (Blender) | geoscatter.com | ~€100 (lite gratuit) | biomes, scatter | masques distance/pente/altitude/vertex, « clumping » par grappes | forêt, verger |
| Buildify (Blender) | paveloliva.gumroad.com/l/buildify | pay-what-you-want | bâtiments modulaires depuis polygones | geometry nodes : façade = modules répétés, coins, toit selon emprise | habitat |
| SceneCity (Blender) | cgchan.com/scenecity | payant | villes sur grille routière | blocs remplis de lots tirés au hasard par catégorie | habitat, industrie |
| BlenderGIS | github.com/domlysz/BlenderGIS | GPL | terrain + OSM | import emprises OSM par tag | toutes (données réelles) |
| Blosm (ex blender-osm) | prochitecture.gumroad.com/l/blender-osm | gratuit/premium | bâtiments, routes OSM | toit généré selon roof:shape, hauteur par levels | habitat |
| OSM2World | osm2world.org | LGPL | 3D depuis OSM | une règle par tag (barrier=fence, amenity=parking, landuse=cemetery…) | pâture, parking, cimetière |
| Watabou Village/City/Neighbourhood | watabou.github.io | gratuit | villages, villes, îlots | Voronoï + rues ; village = maisons le long d'une route, recul variable | habitat, ferme |
| Watabou "One Page Dungeon"/"Perilous Shores" | watabou.itch.io | gratuit | donjons, côtes | côte par bruit + plages sur pente faible | plage, port |
| Townscaper | townscapergame.com | ~€6 | ville sur grille irrégulière | WFC sur grille quad irrégulière, règles locales voisinage | habitat (noyau) |
| WFC (mxgmn) | github.com/mxgmn/WaveFunctionCollapse | MIT | tuiles, patterns | contraintes d'adjacence + entropie minimale | casse, camp militaire |
| WorldPainter custom objects | worldpainter.net | GPL | objets Minecraft | « Custom objects layer » : densité, rotation aléatoire, ancrage sol | forêt, ferme |
| Arnis | github.com/louis-e/arnis | Apache-2 | Minecraft depuis OSM | rendu par tag OSM, clôtures autour landuse=farmland | pâture, champ |
| Minecraft jigsaw structures | minecraft.wiki/w/Jigsaw_Block | natif | villages, avant-postes | pièces assemblées par connecteurs nommés + profondeur max | camp militaire, ferme |
| Cities Skylines Move It / Find It | steamcommunity.com (CS1 workshop) | gratuit | placement | « align to segment », copie motif, snap à la route | parking, check-point |
| CS "Parking Lot Roads" (Badi Dea) | steamcommunity.com | gratuit | parkings | parking = route spéciale à places latérales | parking |
| CS2 "Line Tool" (algernon) | github.com/algernon-A/LineTool | gratuit | rangées d'objets | ligne/cercle/courbe, espacement fixe, rotation relative | verger, vigne, cimetière |
| Farming Simulator GIANTS Editor + "Field toolbox" scripts | gdn.giants-software.com | gratuit | champs, clôtures | champ = polygone + bande de bord non cultivée, ID par parcelle | champ, ferme |
| FS "Fence placement" tool (GIANTS Editor 9+) | gdn.giants-software.com | natif | clôtures | panneaux sur spline, adaptation à la pente (poteau vertical, panneau incliné) | pâture clôturée |
| Arma 3 Terrain Processor | github.com/pennyworth12345/A3_TerrainProcessor | gratuit | objets depuis shapefiles | tâches : « place along line », « fill polygon random », « building in polygon facing road » | toutes |
| Arma 3 Terrain Builder | Arma 3 Tools | gratuit | objets | templates de forêt pondérés + scatter sur polygone | forêt |
| DayZ Editor (InclementDab) | github.com/InclementDab/DayZ-Dabs-Framework | gratuit | placement manuel | brosses d'objets à rayon et densité | casse, camp |
| World Machine / Gaea / World Creator | world-machine.com, quadspinner.com, world-creator.com | payants (free tier) | terrain, masques | export de masques (pente, flux, sédiments) servant de densité | forêt, champ, plage |
| Poisson disk (Bridson) | cs.ubc.ca/~rbridson/docs/bridson-siggraph07-poissondisk.pdf | algo | semis | rayon mini garanti en O(n) | forêt, ferme dispersée |
| Procedural vineyard/orchard (Houdini/Blender tutos) | youtube / blenderartists.org | tutos | vignes, vergers | rangées suivant les courbes de niveau, inter-rang 2-3 m (vigne) / 6-8 m (verger), tournières en bout | verger, vigne |
| Cemetery generator (Blender GN, Houdini) | blendswap / artstation | divers | cimetières | grille de tombes ±jitter 5 %, allées perpendiculaires, mur d'enceinte + portail | cimetière |

### Idées à reprendre (classées)
1. **Pipeline type PCG** : échantillonnage → filtres (pente, hauteur, distance route/eau) → pruning par rayon → spawn, réutilisé par tous les générateurs.
2. **Clôture sur spline** (UE/FS) : poteau tous les N m, coins forcés, panneau incliné sur pente, ouverture portail — pâture, cimetière, camp.
3. **Parking en bandes** (Houdini/CS) : places 2,5×5 m + allée 6 m, orientation sur le plus long côté bordant la route.
4. **Rangées sur courbes de niveau** pour vigne/verger, avec tournières en bout.
5. **Subdivision de lots face rue** (CityEngine/Labs Lot Subdivision) : façade sur route, recul paramétrable.
6. **Fitness curves** (Gaia) plutôt que seuils binaires pour pente/altitude.
7. **Assemblage jigsaw / WFC** pour camps militaires et casses (modules à connecteurs).
8. **Règles par tag OSM** (OSM2World/Arnis) pour importer des zones réelles.
9. **Clumping** (Geo-Scatter) : grappes de forêt/broussailles au lieu d'uniforme.
10. **Objets latéraux à pas fixe** (EasyRoads3D) : glissières, plots, panneaux pour check-point et port.
