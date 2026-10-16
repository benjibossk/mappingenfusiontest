# Formats et API Enfusion (fouille MCP enfusion-mcp, lecture seule)

Légende : [V] vérifié dans les fichiers du jeu, l'API ou le wiki · [S] supposé.
Limite : les `.ent`, `.layer` et `.terr` vanilla (Everon, Arland) sont binarisés (EBIN), donc illisibles. Les GUID viennent des lignes d'héritage `: "{GUID}..."` et des `.layer` de mods.

## 1. Forest Generator [V]
- `Prefabs/WEGenerators/Forest/` contient 97 `FG_*.et` (Forest_*, Brushland_*, Clearing_*, variantes `_aut`), plus `FG_Forest_Pinus/` et `FG_Forest_Spruce_1/`.
- GUID connus :

| GUID | Prefab |
|---|---|
| `{37C347EECE844530}` | FG_Forest_Pine1 |
| `{5B97730E7240CA1E}` | FG_Forest_Pine2 |
| `{C110BC1515DDFD3F}` | FG_Forest_Spruce1 |
| `{AD4488F5A9197211}` | FG_Forest_Spruce2 |
| `{850A42E16C5B104D}` | FG_Forest_Birch |
| `{1209A690258A7A18}` | FG_Forest_Hornbeam |
| `{7D22EF2D993C004D}` | FG_Forest_Sorbus |
| `{FC00F74F9C552E1F}` | FG_Forest_PiceaWeathered_1 |
| `{FA33CB2A2E422795}` | FG_Forest_PiceaWeathered_D_1 |

- Base `FG_Forest_base.et` : `m_bAvoidObjects / Roads / Rivers / PowerLines / Tracks / Lakes = 1`, `m_bRandomiseSeedOnUse 0`.
- Structure d'un prefab :
  - `GeneratorType GeneratorTypeForest "{58ACC07B205BBA26}"`, `m_iSeed` ;
  - `m_aLevels` : Outline, TopLevel, BottomLevel. Chaque niveau a `m_fDensity` (300 à 400) et des `m_aTreeGroups`, eux-mêmes composés d'arbres Tall, Middle et Short (`m_fMinScale`, `m_fMaxScale`, `m_fWeight`, `m_Prefab`) ;
  - `m_aClusters` : `ForestGeneratorCircleCluster` (`m_fMinCDENSHA`, `m_fMaxCDENSHA`, objets avec `m_iMinCount/MaxCount`, `m_fMinRadius/MaxRadius`).
- Règles :
  - la forme est une Polyline ou une Spline, toujours considérée fermée, avec au moins 3 points ;
  - le générateur doit être **enfant direct** de la forme ;
  - on peut mettre plusieurs FG par zone.
- Format en enfant de la forme [S] (syntaxe transposée d'un `.layer` power line) :
```
PolylineShapeEntity {
 coords 105.097 1 140.877
 Points {
  ShapePoint "{6674AED5D488B0D8}" { Position 0 0 0 }
  ShapePoint "{6674AED5D488BD66}" { Position 18.307 0 0 }
 }
 {
  ForestGeneratorEntity : "{37C347EECE844530}Prefabs/WEGenerators/Forest/FG_Forest_Pine1.et" {
   coords 0 0 0
   m_iSeed 123
  }
 }
}
```
- Les points sont relatifs à `coords`. BARNMAP met `coords 0 0 0` avec des points absolus, ce qui revient au même.
- [S] Les arbres sont générés dans le Workbench, il n'est donc pas nécessaire de les exporter.
- **Test 2026-10-14 (monde `emptyarland`, sous-scène d'Arland)** [V] : nos `.et` écrits à la main (`MapGenTests/Test_Forest|Test_Lake|Test_Hedge.et`, polyline fermée + `IsClosed 1` + générateur enfant avec `ID` baké) sont acceptés, placés et sauvegardés dans `default.layer` sous la forme `PolylineShapeEntity MG_TEST_Forest : "{GUID}MapGenTests/Test_Forest.et" {...}`.
  - Déplacer la forme bloque le Workbench plus de 10 s (timeout MCP), ce qui suggère une régénération. Les objets générés ne figurent pas dans la liste des entités éditeur.
  - **Cause de la non-génération (constat de Benji)** : nos points avaient `Y = 0` (relatif), donc ils n'étaient pas collés au terrain. Après un « Snap to terrain » sur la spline, **la forêt s'est générée** [V].
  - **Correction (test `MG_TEST_ForestSnapped`)** : une forme écrite avec le Y exact du terrain **ne génère toujours rien** au chargement. Elle génère dès qu'on clique sur « Snap to terrain » dans le Vector Tool. La hauteur n'est donc pas la cause : **le générateur ne tourne que sur un événement d'édition de la forme**. Charger un `.et` ou un `.layer` ne déclenche rien.
  - → Il faut **déclencher la génération par un plugin Workbench**. Pistes :
    - `ForestGeneratorEntity.RegenerateForest(bool forceRegeneration)`, la plus directe (existe dans l'API) ;
    - `ToggleGeneratorEvents(true)`, puis modifier les points par l'API ;
    - à défaut, la manip manuelle « Select all » + « Snap to terrain » dans le Vector Tool.
  - Écrire quand même le Y réel du terrain, pour que les formes soient justes.
  - GUID résolu : `{1F2254A7C9C8AA57}` LG_Lake_01.

## 2. Eau [V]
- **Rivière** : `Prefabs/WEGenerators/Water/River/R_RiverMedium_01.et` (GUID inconnu).
  - Contenu : `RiverEntity { GeneratorType GeneratorTypeRiver "{58B894C70B4B0C9E}" Width 5 SplineOffsetUp 0.139 Material "{53A33317B1C9B8E0}Terrains/Common/Water/River/RiverSurface_01.emat" PhysicsLayer "Water" }`.
  - Forme ouverte, au moins 2 points. Options Clearance et ReverseFlow.
- **Lacs** : `Water/Lake/` contient LG_Lake_01, LG_LakeDirty_01, LG_LakeMountain_01, LG_CainLake_01 et LG_DirtyDrainage_01 (GUID inconnus).
  - Contenu : `LakeGeneratorEntity { GeneratorType GeneratorTypeLake "{58B894C7011D8F70}" m_MaterialName "{202B614D7E81B3C5}.../PondSurface_01.emat" m_bFlattenByBottomPlane 1 }`.
  - Forme fermée, au moins 3 points, **dans le sens horaire** (sinon ReversePointOrder). La surface de l'eau se place au point le plus bas de la forme.
- `Water/Pool/` n'a pas été exploré.

## 3. Autres générateurs [V]
- **Murs et clôtures** : `Walls/{Brick,Concrete,Crashbarrier,Custom,Metal,Misc,Net,Pipe,Pole,Stone,Wooden}/WG_*.et`.
  - GUID connus : `{E00BA421CC399343}` WG_ConcreteWall_01 et `{1A61D6F828325773}` WG_WoodenFence_01.
  - Format : `WallGeneratorEntity { FirstObject LastObject PrePadding PostPadding m_aWallGroups { WallLengthGroup { m_aWallPrefabs { WallWeightPair { m_sWallAsset m_fWeight } } } } }`.
- **Lignes électriques** : `Powerline/PG_PowerLine_*`.
  - GUID connus : `{20E4877A07D28502}` PG_PowerLine_01_WoodenSmall et `{613763D114E7CD1C}` Powerline.et.
  - Classe `SCR_PowerlineGeneratorEntity`, `GeneratorTypeHV "{58B894C75A99C899}"`, `m_fDistance 50`, `Clearance 3`.
  - Le `.layer` contient aussi les poteaux et câbles générés.
- **PrefabGeneratorEntity** (objets posés le long d'une ligne) : PG_Vegetation_CorylusBushline, PG_Vegetatation_BirchTreeline, PG_StreamStones.
  - Paramètres : `m_PrefabNames`, `m_Weights`, `m_fDistance 4`, `m_fOffsetVariance 8`, `m_fGap 3`.
  - **C'est la brique idéale pour les haies** entre champs.
- Dossiers non détaillés : Brushland, Bushline, Decals, Infrastructure, Miscellaneous, Pavements, Stones.

## 4. Routes [V]
- Format : `RoadGeneratorEntity { GeneratorType GeneratorTypeRoad "{58B894C738383FF4}" AdjustHeightMap 1 AdjustHeightMapPriority 47 RoadClearance RoadWidth RoadFalloffWidth { RoadEntity { Type "Road Minor"|Path Width Material } } }`.
- **Asphalt** : RG_Road_Asphalt_E_01 `{723C2AAE6E9AD131}`, E_01_Narrow, E_01_DashedLine, E_02 (largeur 8, clearance 4.5, falloff 4, priorité 47), E_03.
- **Dirt** : RG_Road_Dirt_01 `{8E83BBD5CEC42A11}`, Dirt_02, Road_Forest_01, Road_Coal_01, RG_TrailDirt_01 (largeur 1.75, type Path, priorité 30), TrailForest_01, TrailGravel_01, TrailCoal_01.
- Dossiers non listés : Cobblestone/, Concrete/, VergePosts/.

## 5. API Workbench (WorldEditorAPI) [V]
- **Lecture** : `GetTerrainSurfaceY(x,z)`, `GetEditorEntityCount/GetEditorEntity`, `FindEntityByName`, `SourceToEntity`.
- **Édition** :
  - `BeginEntityAction/EndEntityAction` ;
  - `ParentEntity(parent, child, transformToParentSpace)` ;
  - `SetVariableValue(container, path, key, value)` ;
  - `CreateObjectArrayVariableMember`, `CreateComponent` ;
  - `ToggleGeneratorEvents(bool)` : doit être activé pour que les générateurs fonctionnent.
- **Terrain** : `BeginTerrainAction(TerrainToolType)`, `ModifyHeightMap`, `ModifyHeightMapUserShape(...)`, `ModifyLayers` et `ModifyLayersUserShape` (peindre les surfaces par script).
- **Calques** : `CreateSubsceneLayer`, `SetEntitySubsceneLayer`.
- **Import de heightmap** : uniquement via l'outil Terrain Creation (`.asc` ou PNG 16 bits avec min/max).
- **Piste** : un plugin Workbench (Enforce script) pourrait importer un JSON produit par l'outil web et créer formes, générateurs et peinture directement. C'est plus robuste que l'écriture de fichiers texte.

## 6. Terrain et masques [V wiki]
- 1 bloc = 32×32 faces (33×33 sommets), 5 LOD, 1 draw call.
- 1 tuile = 1 à 32 blocs. La supertexture, la normal map et le surface mask sont mappés par tuile.
- Une heightmap de N faces fait N+1 px (2048 faces → 2049 px).
- Heightmap en entier 16 bits : précision = plage / 65535.
- 1 seul terrain par monde. Taille = grid × cell size, et X et Z peuvent différer.
- **4033 = 2·2016 + 1** [S] : sans doute un lien avec la taille de tuile et la bordure. Reste à confirmer.

## 7. Limites chiffrées
- 5 surfaces maximum par bloc.
- 5 LOD par bloc.
- 1 à 32 blocs par tuile.
- Heightmap en 16 bits.
- **Aucune limite trouvée** sur la taille maximale du terrain ou le nombre d'entités. Ce sera à mesurer par bench.

## 8. Déclencher la génération par plugin [V 2026-10-14]
- Le plugin `Mapgenerator/Scripts/WorkbenchGame/MapGen/MG_RegeneratePlugin.c` (menu Plugins > MapGen) fait trois choses :
  1. `ToggleGeneratorEvents(true)` ;
  2. pour chaque forme `MG_*`, il réécrit chaque point (`SetVariableValue(src, {ContainerIdPathEntry("Points", i)}, "Position", ...)`) au Y du terrain (`GetTerrainSurfaceY`) ;
  3. il appelle `RegenerateForest(true)` sur chaque forêt.
- `RegenerateForest` est **protégée**. On l'expose par `modded class ForestGeneratorEntity { void MG_ForceRegenerate() }`, placé dans `Scripts/Game`.
- **Résultat** : 7 formes, 31 points et 3 forêts traités. Le monde passe de 1557 à **2553 entités** : la génération a eu lieu sans aucun clic.
- **Chaîne validée** : fichier `.layer` ou `.et` → plugin → génération. L'importeur final suivra ce patron.

## 9. Méthode validée de création des formes générées (2026-10-15)

Validée visuellement par Benji : forêt, haie et lac générés sans aucun clic.
Plugin `MG_CreateShapesPlugin` (addon Mapgenerator), reproduit la création manuelle :

1. `api.ToggleGeneratorEvents(true)` puis `BeginEntityAction`.
2. `api.CreateEntity("PolylineShapeEntity", name, layerId, null, pos, "0 0 0")` — forme **nue**
   (pas de prefab enveloppe), origine à `GetTerrainSurfaceY`.
3. `SetVariableValue(shape, null, "IsClosed", "1")` pour forêt / lac.
4. Par point : `CreateObjectArrayVariableMember(shape, null, "Points", "ShapePoint", i)` puis
   `SetVariableValue(..., [Points,i], "Position", "x y z")`, Y local = terrain − origine.
5. Générateur en enfant : `CreateEntity(Workbench.GetResourceName(path), "", layerId, shape, 0, 0)`.
6. `EndEntityAction`. La génération se fait seule (événements éditeur), le résultat (arbres,
   buissons) est sérialisé dans le `.layer` sous le générateur ; l'eau du lac ne l'est pas.

Échecs à ne pas reproduire :
- Forme enveloppée dans un prefab `.et` de test : génération non déclenchée au chargement.
- Référence de prefab **sans GUID** (`"Prefabs/…/X.et"`) : non résolue, générateur vide
  (`prefabs=0`). Toujours `{GUID}chemin` ; `Workbench.GetResourceName(path)` donne le GUID.
