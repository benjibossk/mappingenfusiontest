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
