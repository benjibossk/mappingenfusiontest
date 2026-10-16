# Mods Workshop d'outillage terrain : état de l'art détaillé (2026-10-14)

Sources : paks téléchargés via SteamCMD et le serveur dédié, extraits par un extracteur de .pak local.
Les 26 fichiers ont été lus en entier : 18 `.c`, 1 `.conf`, 2 `.emat`/`.edds`, 1 `.ent`, 1 `.layer` vide et 1 `.claude/settings.local.json`.
**Aucune licence ni aucun auteur indiqués.** On peut étudier ces sources et en tirer des idées. On ne recopie pas le code : les extraits ci-dessous font 10 lignes au plus et sont cités avec `fichier:ligne`.

Convention : `TAT/` = `TerrainAutomationTools/Scripts/WorkbenchGame/`, `ATT/` = `AdvancedTerrainTools/scripts/WorkbenchGame/AdvancedTerrainTools/`, `OTC/` = `OutsideTerrainCore/Scripts/Game/`. Les numéros de ligne sont ceux des fichiers d'origine.

**Constat transversal (vérifié chez nous, voir ENFUSION_FORMATS §1)** : un point de forme dont le Y n'est pas la hauteur réelle du terrain empêche les générateurs (FG/PG) de générer. Aucun de ces mods ne crée de forme ni de générateur. En revanche, tous recalent le Y des entités avec `GetTerrainSurfaceY`, et c'est ce même patron qu'il nous faut pour les ShapePoints.

---

## 1. AdvancedTerrainTools (6874E07B40C6D5E5)

### 1.1 Point Cloud Import Tool : `ATT/ATT_XYZImportPlugin.c`
- **But** : placer des prefabs (arbres, débris) à partir d'un nuage de points `.xyz` exporté par Gaea.
- **Déclaration** : `[WorkbenchPluginAttribute(name:"Point Cloud Import Tool", category:"Advanced Terrain Tools", wbModules:{"WorldEditor"}, awesomeFontCode:0xF074)]` sur `class PointCloudImportPlugin : WorldEditorPlugin` (l.2-8). Pas de `shortcut`. C'est un plugin de menu, pas un outil de panneau.
- **Paramètres** (l.10-36) :

| Attribut | Défaut | Catégorie | Note |
|---|---|---|---|
| `m_sImportDataFilePaths` (array<string>, FileNamePicker `xyz`) | — | Import | plusieurs fichiers |
| `m_fRandomPositionOffset` | 5 m | Import | jitter XZ pour casser la grille |
| `m_fSkipChance` | 0 | Import | décrit comme un « percent », mais comparé à `RandomFloat01()`, donc il faut une fraction de 0 à 1 |
| `m_bSnapAllToGround` | true | Terrain Heightmap Import Settings | |
| `m_iTerrainSize` | 1024 (128 à 16384) | idem | côté du terrain en m |
| `m_iTerrainHeight` | 2048 | idem | hauteur Gaea |
| `m_bTerrainFlipX` / `m_bTerrainFlipZ` | false / true | idem | doivent refléter l'import de la heightmap |
| `m_aObjects` (array<`ATT_PointCloudObjectImportData`>) | — | Objects | voir l.287-319 |

  Chaque objet a : `m_Prefab`, `m_fWeight` (1.0, plage 0 à 1), `m_fMinScale` 0.8, `m_fMaxScale` 1.2, `m_fMaxRandomYawAngle` 360, `m_fMaxRandomPitchAngle` 0, `m_fMaxRandomRollAngle` 0, `m_fMin/MaxVerticalOffset` 0, `m_bRelativeY` true.
- **Algorithme** :
  1. `Run()` ouvre un `Workbench.ScriptDialog(...)` sur `this`. Le bouton `[ButtonAttribute("Import", true)]` renvoie 1 et lance `ImportData()` (l.45-51, 273-277).
  2. Il calcule les poids cumulés une seule fois (l.84-101).
  3. `BeginEntityAction()` puis `layerID = GetCurrentEntityLayerId()` (l.104-110).
  4. Pour chaque fichier : `FileIO.BeginParse(path)`, puis une boucle infinie `parser.ParseLine(line, tokens)` qui s'arrête quand `numTokens < 1`. Une ligne doit contenir exactement 3 jetons (l.128-155).
  5. Mise à l'échelle : `x = t0*size`, `y = t2*height`, `z = t1*size`. Le format Gaea est donc normalisé de 0 à 1, avec la hauteur en 3e colonne (l.158-161).
  6. Jitter, puis flips `p = -p + size` (l.164-174). Si snap, `y = 0` (l.176-177).
  7. Tirage pondéré linéaire sur les poids cumulés (l.181-197). Yaw, pitch et roll aléatoires avec `Math.Repeat(...,360)`, échelle aléatoire (l.204-220).
  8. **Création en deux passes** (« batch ») : les tableaux sont remplis d'abord, la création suit (l.226-258). Si `m_bRelativeY`, alors `y = GetTerrainSurfaceY(x,z)`. Le prefab est créé par `CreateEntity(prefab, "", layerID, null, pos, angles)`, l'échelle posée par `SetVariableValue(src, null, "scale", s)`.
  9. Une seule `EndEntityAction()` (l.261), puis un dialogue récapitulatif (l.264-267).
- **Pièges et bugs** :
  - `m_fSkipChance >= 1` crée une **boucle infinie** : le `continue` du skip (l.139-143) passe avant `ParseLine`, donc la condition de fin n'est jamais évaluée.
  - L'offset vertical utilise toujours `cachedObjects[0]` au lieu de l'objet tiré (l.238).
  - Snap activé avec `m_bRelativeY=false` : l'objet reste à Y=0 absolu (l.176 et 232).
  - Le flag prefab `RELATIVE_Y` n'est pas géré (contrairement à TerrainUtils, §3.1). Les prefabs RELATIVE_Y reçoivent la hauteur absolue comme offset.
  - Tout se fait dans une seule action undo, sans découpage. L'auteur conseille de « splitter le fichier » (l.47).
  - Le snap fait un appel `GetTerrainSurfaceY` par point : ça va, mais pas pour des millions de points.

### 1.2 Heightmap Analyzer : `ATT/ATT_HeightmapAnalyzer.c` + `ATT_PythonHelper.c`
- `[WorkbenchPluginAttribute(name:"Heightmap Analyzer", category:"Advanced Terrain Tools", awesomeFontCode:0xF074)]` sur `ATT_HeightmapAnalyzerPlugin : WorldEditorPlugin` (l.2-8).
- **Paramètres** : `m_sHeightmapPath` (png, chemin absolu), `m_iTargetScale` = 2048, `m_sPythonExecutable` (optionnel).
- **Fonctionnement** :
  - Le chemin est résolu par `SCR_AddonTool.ToFileSystem("AdvancedTerrainTools") + "ExternalScripts/heightmap_analyzer.py"` puis `Workbench.GetAbsolutePath(virt, abs, true)` (l.26-31).
  - Le helper lance ensuite `Workbench.RunProcess("cmd.exe /k python \"script\" args")` (`ATT_PythonHelper.c:23-37`) et renvoie un `ProcessHandle`.
  - L'annulation passe par `Workbench.IsRunningProcess` et `KillProcess` (l.75-77).
- **Le `.py` est absent du pak** : l'outil ne fonctionne donc pas tel quel. Le patron reste utile : **lancer un process externe depuis Workbench**, par exemple notre CLI Node.
- `Configs/.../AtlasII_WorldEntitySetup.conf` : liste de `SCR_WorldSetupPluginConfig_Entity` (terrain, lumière, brouillard, post-process, météo, destruction, caméra) pour le plugin vanilla « World Setup ».

## 2. OutsideTerrainCore (61F0D506562D9BC9) : terrain hors carte
- `OTC_OutsideTerrainChunkEntity : GenericEntity`, avec `[EntityEditorProps(category:"Outside Terrain Core/Chunk")]` (`OTC/Entities/OTC_OutsideTerrainChunkEntity.c:1-6`).
- **Attributs** : `m_fWidth` 128, `m_fHeight` 128, `m_iResolution` 4 (de 2 à 33), `m_aHeights` (array<float>), `m_bEnableCollision` false, `m_ePhysicsLayerPreset` Terrain, `m_Material` `{FCDCBAF69074F24C}…DefaultMaterial.emat` (l.8-27).
- **Construction** (au runtime, dans le constructeur, l.97-111) :
  - `OTC_Mesh` génère une grille res×res. Le plafond `MAX_RESOLUTION = 33`, soit **un bloc terrain Enfusion**, fixe la taille des tableaux statiques (`OTC/OutsideTerrainCore/OTC_Mesh.c:3-6`).
  - L'API de maillage est `MeshObject.Create(1, numVerts, numIndices, materials, 0)` → `UpdateVerts(0, verts, uvs)` / `UpdateIndices` → `SetObject(meshObject,"")` (l.55-63).
  - La collision passe par `PhysicsGeom.CreateTriMesh` → `PhysicsGeomDef("Terrain", geom, material, 0xffffffff)` → `Physics.CreateStaticEx(this, defs)` (l.78-82).
- **Bug** : `_x = (x / zeroBasedResolution - 0.5) * width` avec deux `int` (`OTC_Mesh.c:36,38,42-43`). La division entière écrase toutes les colonnes sauf la dernière sur −0.5·width. Le maillage est donc dégénéré, sauf si le moteur promeut l'expression en float.
- **Intérêt pour nous** : faible (décor d'horizon). La seule idée à retenir : un maillage runtime de 33×33 sommets, alimenté par un tableau de hauteurs, pourrait servir de prévisualisation. Hors périmètre.

## 3. TerrainAutomationTools (684876344DA83476)
Le mod contient 11 `WorldEditorTool` (panneau latéral de la World Editor), plus l'utilitaire `TerrainUtils`.
- **Déclaration commune** : `[WorkbenchToolAttribute(name, description, wbModules:{"WorldEditor"}, awesomeFontCode)]`. **Aucun `shortcut`** ni catégorie dans aucun outil. Les catégories n'existent qu'au niveau des `[Attribute(category: …)]`.
- **Paramètre commun** : `m_iVerbosity` (0 = Silent, 1 = Normal, 2 = Verbose).
- Le pak contient un `.claude/settings.local.json` (droits `dir`, `ls`, `find`, `mcp__filesystem__*`) : le mod a été écrit avec Claude Code.
- `worlds/Arland/Test.ent` est une SubScene de `{C7DC72AF0AE17724}worlds/Arland/EmptyArland.ent`, avec un `default.layer` vide.

### 3.1 `TAT/TerrainUtils.c` : la boîte à outils partagée
| Fonction | Lignes | Détail |
|---|---|---|
| `GetTerrainNormal(api,x,z,d=0.5)` | 19-35 | 5 appels `GetTerrainSurfaceY` (centre + 4 voisins), différences centrées, normale = `(-dh/dx, 1, -dh/dz)` normalisée. L'échantillon central est inutilisé. |
| `GetSlopeAtPoint` | 38-44 | `acos(normal.y)` en degrés |
| `IsAboveWater(world,x,z)` | 57-62 | `world.GetSurfaceY >= world.GetOceanHeight` : **l'océan seul**, les lacs et rivières des générateurs ne sont pas vus |
| `IsPositionValid` | 64-83 | eau, puis altitude (-500..5000), puis pente |
| `IsInsideCircle/Rect/RotatedRect` | 90-119 | tests XZ, avec rotation par −angle |
| `WeightedRandom(array<float>)` | 128-152 | somme, tirage, cumul linéaire. Renvoie −1 si tous les poids sont nuls. |
| `GetTerrainAlignedAngles(n,yaw)` | 160-184 | repère `right = fwd×n`, `fwd = n×right`, puis `Math3D.MatrixToAngles` |
| `CatmullRom(p0..p3,t)` | 193-209 | Catmull-Rom uniforme (facteur 0.5) sur **XZ seulement**, Y=0 |
| `CatmullRomTangent` | 213-226 | dérivée analytique |
| `CatmullRomSegmentLength(...,16)` | 230-244 | longueur par 16 sous-segments |
| `ValueNoise2D(x,y,seed)` | 252-273 | value noise : hash des 4 coins, smoothstep `3t²-2t³`, bilinéaire |
| `FBM(x,y,oct=4,lac=2,gain=0.5,seed)` | 277-293 | somme des octaves `(noise*2-1)*amp`, seed+i par octave, normalisée par Σamp, sur [−1,1] |
| `HashFloat` | 296-308 | hash entier xor-shift (`374761393`, `668265263`, `1274126177`), puis `abs` et `mod 10000` : **précision 1e-4** |
| `SpawnEntity(api,res,pos,yaw,scale,align)` | 320-368 | point central de tous les outils (voir ci-dessous) |
| `GetRandomScale` | 376-389 | gère min>max et min==max, car `RandomFloat(a,a)` plante selon le commentaire l.375 |
| `Log` | 402-417 | filtre selon la verbosité |
| `GetSelectionBounds` | 425-451 | AABB des origines de la sélection |

**`SpawnEntity`, recette de création d'entité** (l.320-368) :
1. `layerId = api.GetCurrentEntityLayerId()`.
2. `api.CreateEntity(res, "", layerId, null, spawnPos, vector.Zero)`. Le commentaire l.325 dit d'éviter `CreateEntityExt` à cause de son alignement terrain non désiré.
3. Lecture de `src.Get("Flags", flags)`. Si `flags & EntityFlags.RELATIVE_Y`, Y devient `spawnY - GetTerrainSurfaceY` (l.334-342).
4. `SetVariableValue(src, null, "coords", "x y z")` explicite (l.345).
5. Angles : si aligné, normale puis `GetTerrainAlignedAngles`. Sinon `angles[0]=yaw`. Écriture `SetVariableValue(src,null,"angles", "%1 %2 %3" (a[1],a[0],a[2]))`, c'est-à-dire la permutation de la sortie de `MatrixToAngles` vers « pitch yaw roll » (l.361).
6. `scale` n'est écrit que si ≠ 1, pour garder la source propre (l.364-365).

Coût : environ 1 création et 2 à 3 `SetVariableValue` par entité, plus 5 lectures de hauteur si l'alignement est actif.

### 3.2 Auto-Decorator : `TAT/AutoDecorator.c` (+ `AutoDecoratorPalette.c`, `AutoDecoratorPreset.c`)
- `[WorkbenchToolAttribute(name:"Auto-Decorator", awesomeFontCode:0xF1BB)]` sur `AutoDecoratorPlugin : WorldEditorTool` (l.22-29). Constantes : `POISSON_ATTEMPTS = 30` (l.35).
- **Paramètres** (l.40-166), par catégorie :
  - **Quick Presets** : 4 slots `m_ForestMedium`, `m_ForestSmall`, `m_RockBoulder`, `m_VillageBuilding`.
  - **General** : `m_iPreset` 0 (Forest, Rocks, Village, Custom List, Palette), `m_iMaxCount` −1, `m_bUseSelection` true.
  - **Area** : `m_iAreaMode` 0 (Circle, Rectangle, Selection Box), `m_fRadius` 50, `m_fRectWidth/Length` 100.
  - **Spacing** : `m_fMinDistance` 5, `m_bGroundSnap` true, `m_bUseCameraHeight` false, `m_fHeightOffset` −1.0, `m_bAutoAdjustHeight` true, `m_bAvoidExisting` false.
  - **Terrain Filter** : pente 0..45°, altitude −500..5000.
  - **Density** : `m_iFalloffMode` 0 (Uniform, Center, Edge, Gaussian).
  - **Scale** : 0.8..1.2.
  - **Custom List** (`AutoDecoratorCustomPrefab`) et **Palette** (`AutoDecoratorPaletteEntry` : weight 1, scale 0.8..1.2, `m_fMinDistanceOverride` −1, `m_fHeightOffset` 0, `m_bAlignToSlope` false, pente 0..90).
  - **Advanced** : `m_iBatchSize` 0.
  - **Presets** : nom et index.
- **Boutons** : `Generate Decoration`, `Save Preset`, `Load Preset`, `Delete Preset`, `List Presets` (l.209-315).
- **Algorithme** (`PerformGeneration`, l.321-391) :
  1. Configuration et validation : les bornes min et max inversées sont échangées (l.488-519).
  2. Centre : selon le mode, centre de l'AABB de la sélection (avec mise en cache, puis `ClearEntitySelection`), entité sélectionnée, ou caméra (`m_World.GetCurrentCamera(mat)`, avec Y = `GetSurfaceY`) (l.522-581).
  3. **Poisson disk (Bridson)** : cellule `minDist/√2`, grille d'indices initialisée à −1, premier point au centre ±0.1, 30 essais par point actif dans l'anneau [d, 2d], test du voisinage 5×5 (l.924-990 pour le cercle, l.996-1069 pour le rectangle, l.1075-1128 pour le voisinage).
  4. **Falloff** par probabilité de conservation : centre `1−r`, bord `r`, gaussienne `e^(−3r²)`. La distance est radiale pour le cercle, de Chebyshev pour le rectangle (l.875-918).
  5. **Filtre par point** : eau, altitude, pente globale, puis `QueryEntitiesBySphere(minDist/2)` si `AvoidExisting` (l.638-671).
  6. **Palette** : les entrées éligibles selon leur pente sont tirées au sort par poids (`WeightedRandom`). L'override de distance ne s'applique que si `AvoidExisting` (l.726-772).
  7. **Hauteur** : `GetTerrainSurfaceY` si snap (sinon `World.GetSurfaceY`, qui inclut les objets), plus offset, plus `−0.5·scale` si `AutoAdjustHeight` (l.823-843). Résultat : −1 − 0.5·s par défaut, **l'objet est enfoncé de 1.4 à 1.6 m**.
- **Undo** : `bool manage = BeginEntityAction("Auto-Decorate Generation")`. Si `m_iBatchSize > 0`, la boucle fait `End` puis `Begin("Auto-Decorate Batch")` tous les N objets (l.634, 692-697). Chaque lot devient un Ctrl+Z distinct.
- **Presets** : fichier `$profile:AutoDecoratorPresets_v2.txt`, en INI maison `PresetCount=`, `[Preset]`, `clé=valeur`, `[PaletteEntry]`, `[EndPreset]` (l.1134-1231, `AutoDecoratorPreset.c:73-111`).
  - E/S : `FileIO.OpenFile(path, FileMode.WRITE/READ)`, `WriteLine`, `ReadLine(line) > 0`.
  - Défauts du preset : `AutoDecoratorPreset.c:49-68`.
- **Pièges** :
  - En mode Palette, l'échelle et le min-distance globaux sont ignorés pour l'échelle, mais pas pour le Poisson.
  - Le collision check prend tout objet, y compris les entités non physiques (pas de filtre `GetPhysics`, contrairement à BiomePainter).
  - Le grain de Poisson est global : une entrée avec un override plus petit ne densifie pas.
  - Il n'y a pas de seed : la génération n'est pas reproductible.

### 3.3 Terrain Randomizer : `TAT/TerrainRandomizer.c`
- `[WorkbenchToolAttribute(name:"Terrain Randomizer", awesomeFontCode:0xF074)]` sur `TerrainRandomizerTool` (l.47-54).
- **Zones** (`enum TerrainZone`, l.19-27) : FLAT_OPEN, FLAT_LOW, GENTLE_SLOPE, MODERATE_SLOPE, STEEP_SLOPE, WATER_EDGE.
- **Paramètres** (espacement / densité par zone, l.59-170) :

| Zone | Espacement | Densité |
|---|---|---|
| Flat Open | 15 | 0.3 |
| Flat Low | 4 | 0.6 |
| Gentle | 7 | 0.8 |
| Moderate | 6 | 0.5 |
| Steep | 10 | 0.3 |
| Water Edge | 3 | 0.7 |

  Paramètres globaux : `m_fWaterProximity` 15, `m_fRadius` 100 (10..2000), `m_iMaxObjects` 5000, échelle 0.7..1.3, `m_bAlignToSlopeAbove15` true, `m_fNoiseScale` 0.05, `m_fNoiseInfluence` 0.4, `m_fLowAltitudeThreshold` 5, `m_bAvoidExisting` false.
- **Classification** (`ClassifyPoint`, l.344-371) :
  1. Sous l'eau : FLAT_LOW.
  2. Près de l'eau, sondé par 4 tests `IsAboveWater` à ±proximité/2 (l.374-381), et pente < 15° : WATER_EDGE.
  3. Pente ≥ 40 : STEEP, ≥ 20 : MODERATE, ≥ 5 : GENTLE.
  4. Sinon, altitude < altitude du centre − 5 m : FLAT_LOW. Sinon FLAT_OPEN.
- **Analyse préalable** : grille de pas `radius/10` (au moins 2 m), comptage par zone et rapport (l.303-341, 694-718). Le bouton `Analyze Area (Preview Only)` fait l'analyse seule.
- **Génération** (`GenerateAll`, l.387-511) :
  1. Grille au pas de l'**espacement le plus fin** parmi les zones remplies, avec un jitter de ±0.4·pas.
  2. Pour chaque point : test du cercle, de l'eau, puis classification.
  3. **Espacement probabiliste** : on garde le point avec la probabilité `(pas/espacement_zone)²`.
  4. Densité : `rand > densité` rejette.
  5. **Bruit** : `n = FBM(x*scale, z*scale, 3 oct, lac 2, gain 0.5, seed)`, puis `f=(n+1)/2`, `seuil = 1 − influence·(1−f)`, et rejet si `rand > seuil` (l.469-479).
  6. Alignement si pente > 15°. Création par `TerrainUtils.SpawnEntity`, puis sélection de toutes les entités créées (l.287-295).
- **Pièges** :
  - Coût par candidat : la classification fait 1 + 5 + 4 à 8 lectures (hauteur, pente, eau), et la pente est recalculée pour l'alignement.
  - Il n'y a pas de vraie distance minimale entre objets, seulement une grille jitterée.
  - La seed du bruit est aléatoire à chaque clic (l.264).

### 3.4 Elevation Band : `TAT/ElevationBandTool.c`
- `[WorkbenchToolAttribute(name:"Elevation Band", awesomeFontCode:0xF6FC)]` sur `ElevationBandTool` (l.98-105).
- **Classe `ElevationBand`** (l.16-94) : nom, `m_fAltMin` 0, `m_fAltMax` 100, prefabs (`TerrainZonePrefab`), `m_fSpacing` 5, `m_fDensity` 0.5, alignement false, échelle 0.8..1.2.
- **Outil** : `m_fRadius` 100 (10..5000), `m_iMaxObjects` 5000, bruit 0.05 / 0.3.
- **Bouton `Load Default Bands`** (l.173-224) :

| Bande | Altitude | Espacement | Densité |
|---|---|---|---|
| Shore | 0-5 | 3 | 0.7 |
| Lowland | 5-50 | 8 | 0.6 |
| Midland | 50-200 | 6 | 0.8 |
| Highland | 200-500 | 10 | 0.5 |
| Alpine | 500-5000 | 15 | 0.3 |

- **Algorithme** (l.229-417) : identique au Randomizer (grille au pas le plus fin, jitter 0.4, espacement probabiliste, densité, FBM). La sélection prend la **première bande qui correspond** (l.322-333).
- **Pièges** : aucun filtre de pente, et prefabs tirés de façon uniforme, sans poids.

### 3.5 Biome Painter : `TAT/BiomePainterTool.c` + `BiomePainterConfig.c`
- `[WorkbenchToolAttribute(name:"Biome Painter", awesomeFontCode:0xF5A7)]` (l.18-24).
- **Constantes** : rayon 5..500 (pas de 2), densité 0.1..3, `PAINT_SPACING_RATIO = 0.4` (l.29-36).
- **Paramètres** : `m_fBrushRadius` 30, `m_fBrushDensity` 1.0, `m_iBrushFalloff` 1 (Hard, Soft, Natural), `m_iBiomeType` 0..6, `m_aLayers` (`BiomeLayer`), `m_bAvoidExisting` true, bruit 0.02 / 0.3, `m_iMaxPerStroke` 200.
- **`BiomeLayer`** (`BiomePainterConfig.c:15-122`) : `m_aPrefabs` et `m_aWeights` sont deux tableaux parallèles. On y trouve aussi `m_fMinDistance` 5, `m_fDensityMultiplier` 1, pente 0..90, altitude −500..5000, échelle, alignement, offset.
- **Six templates** (`BiomePainterConfig.c:183-441`), chaque calque étant donné par (distance min / multiplicateur / pente max) :
  - Dense Forest : Canopy (8 / 1.0 / 25°), Understory (4 / 0.7 / 30°), Clutter (3 / 0.4 / 35°, aligné).
  - Light Woodland : 15 / 0.6, 5 / 0.5, 2.5 / 0.3.
  - Rocky Hillside : grosses roches avec pente de 10 à 60°, petites de 5 à 70°.
  - Meadow : arbres à 30 m, densité 0.2, pente ≤ 15°.
  - Riverside : altitude max 100 et 50 m pour les roseaux.
  - Village Edge : pente ≤ 8 à 10°.
- **Interaction** :
  - Clic gauche : `BeginEntityAction("Biome Painter Stroke")`, puis peinture tous les 0.4·rayon pendant le glissé, et `EndEntityAction` au relâchement. **Un trait = un undo** (l.178-243).
  - Ctrl+molette règle le rayon, Maj+molette la densité, avec `UpdatePropertyPanel()` (l.247-264).
  - Espace maintenu passe en mode gomme. Les touches 1 à 6 changent de template (l.269-299).
  - Prévisualisation : `CreateCircle(pos, vector.Up, r, color, 50, ShapeFlags.NOZBUFFER)` (l.317).
- **`PaintLayer`** (l.352-482) :
  1. `maxPoints = πr²/d² · densité`, plafonné par le reste du quota du trait.
  2. Jusqu'à 3·maxPoints essais. Chaque essai tire un point uniforme dans le disque (`√rand·r`).
  3. Falloff : linéaire `1−r`, ou gaussien `e^(−3r²)`.
  4. Rejet par le bruit FBM, puis par l'eau.
  5. Filtre pente/altitude du calque.
  6. Distance minimale via une grille de hachage locale (5×5).
  7. `QueryEntitiesBySphere`, dont le callback ignore le terrain et les entités sans `GetPhysics()` (l.586-600).
  8. Création.
- **Pièges** :
  - La grille anti-voisinage est recréée à chaque appel : il n'y a **pas d'espacement entre deux tamponnages successifs ni entre calques**, seul `AvoidExisting` le garantit.
  - Les touches 1 à 6 ne remplacent pas les calques s'ils sont déjà remplis (l.616-641). Le changement de biome n'a donc aucun effet après la première configuration.
  - La gomme supprime tout ce qui n'est pas le terrain, sans filtre (l.535-569).

### 3.6 Density Painter : `TAT/DensityPainterTool.c`
- `[WorkbenchToolAttribute(name:"Density Painter", awesomeFontCode:0xF043)]` (l.17-22).
- **Paramètres** : rayon 30, `m_iMode` 0 (Thin, Thicken), `m_iThinPercent` 30, `m_fThickenMinDist` 5, `m_fThickenDensity` 0.5, échelle 0.8..1.2, `m_bSkipTerrain` true.
- **Thin** (l.289-349) : `SCR_WorldEditorToolHelper.QueryEntitiesBySphere(world, c, r)`, puis `EntityToSource`. Fisher-Yates partiel, `DeleteEntity` sur les k premiers. Au moins 1 suppression par tamponnage.
- **Thicken** (l.354-458) : relève les `GetResourceName()` uniques présents dans le pinceau, puis tire des points uniformes dans le disque. Rejet si sous l'eau ou si `QueryEntitiesBySphere(minDist)` trouve quelque chose. Création droite, sans alignement.
- **Pièges** :
  - Espace fait basculer le mode à l'appui puis rebasculer au relâchement (l.222-251).
  - Thin agit sur **toutes** les entités, y compris les bâtiments.

### 3.7 Entity Eraser : `TAT/EraserTool.c`
- `[WorkbenchToolAttribute(name:"Entity Eraser", awesomeFontCode:0xF12D)]` (l.15-22).
- **Paramètres** : rayon 20 (1..500), `m_iFilterMode` (All, Name Contains, Current Layer Only), `m_sNameFilter`, `m_bSkipTerrain`, `m_iMaxPerStroke` 200.
- **C'est l'outil le plus « défensif »** (l.222-310) :
  - il saute `GenericTerrainEntity` et **`GenericWorldEntity`** (supprimer ce dernier corrompt le monde, l.267-269) ;
  - il saute les calques verrouillés via `IsEntityLayerLockedHierarchy(src.GetSubScene(), src.GetLayerID())` (l.277-279), ce qui protège le monde parent en lecture seule d'une sous-scène ;
  - il supprime **par lot** avec `m_API.DeleteEntities(toDelete)` (l.307) ;
  - il plafonne les suppressions par trait.
- Si le relâchement de la souris a été manqué, la pression suivante ferme d'abord l'action restée ouverte (l.147-151).

### 3.8 Forest Featherer : `TAT/ForestFeathererTool.c`
- `[WorkbenchToolAttribute(name:"Forest Featherer", awesomeFontCode:0xF1B3)]` (l.18-23).
- **Paramètres** : `m_fFeatherDepth` 15 m, `m_iThinPercent` 50, `m_fEdgeScaleFactor` 0.6, `m_bGradualScale` true, `m_bSkipTerrain` true.
- **Détection de lisière** (l.90-163) :
  1. Pour la sélection (au moins 3 entités), on compte les voisins à moins de `depth` en XZ (**O(n²)**), puis on calcule la moyenne (au moins 1).
  2. Une entité est **de bord** si `voisins < 0.6 · moyenne` (l.174, 196).
- **Traitement** (l.190-243) :
  1. Chaque entité de bord est supprimée avec une probabilité `thin%`.
  2. Sinon, l'échelle courante est lue par `src.Get("scale", str)` puis multipliée par `f = edge + (n/moy)·(1−edge)` en mode graduel, ou par `edge`. Elle est réécrite par `SetVariableValue(...,"scale",...)`.
- Le bouton `Preview Edge Detection` ne fait que compter.
- **Pièges** :
  - Le coût O(n²) devient vite prohibitif : 10 000 arbres donnent 10⁸ tests.
  - Le facteur 0.6 est en dur.
  - Le résultat dépend de la sélection : une sélection partielle crée de fausses lisières.

### 3.9 Path Decorator : `TAT/PathTool.c` (+ `PathToolPrefab.c`)
- `[WorkbenchToolAttribute(name:"Path Decorator", awesomeFontCode:0xF55B)]` sur `PathDecoratorTool` (l.20-27).
- **Constantes** : prévisualisation sur 20 subdivisions, longueur sur 16.
- **Paramètres** : `m_iPathMode` 0 (Spline, Wall), `m_fPathWidth` 4.5, `m_fSpacing` 4.0, `m_fDensity` 0.8, `m_fBBoxOffset` 0, prefabs pondérés (`PathToolPrefab` : weight 1, échelle 0.8..1.2), `m_iRotationMode` 0 (Along, Perpendicular, Random), `m_fYawJitter` 0, `m_bAlignToSlope` false, échelle globale 0.8..1.2, `m_fHeightOffset` 0, `m_iRows` 1 (1..7), `m_fRowJitter` 0, pente 0..45, `m_bAvoidWater` true.
- **Saisie** :
  - `OnMousePressEvent` : `m_API.TraceWorldPos(x, y, TraceFlags.WORLD, start, end, dir)`. Clic gauche ajoute un waypoint, clic droit retire le dernier, Suppr et Retour arrière aussi (l.152-195).
  - Prévisualisation : `Shape.CreateLines(color, ShapeFlags.NOZBUFFER, pts, 2)` et cercles, placés à Y terrain + 0.3 (l.241-395).
- **Mode Spline** (l.598-807) :
  1. Pour chaque segment, `p0` et `p3` sont dupliqués aux extrémités.
  2. Longueur par `CatmullRomSegmentLength`, puis `steps = max(1, floor(L/spacing))`. Le point t=0 est sauté pour les segments suivants.
  3. Position, tangente normalisée XZ, perpendiculaire `(-tz, 0, tx)`, puis yaw `atan2(tx,tz)`.
  4. `rows` rangées réparties sur la largeur, avec jitter.
  5. Filtres densité, eau, pente. Échelle = échelle de l'entrée × échelle globale. Création à Y terrain + offset.
- **Mode Wall** (l.400-593) :
  1. Segments droits. Yaw = direction + 90°.
  2. **Mesure automatique du pas** : le 1er objet est créé, puis `SourceToEntity(src).GetBounds(mins,maxs)`. Le pas devient `max(extX, extZ) + bboxOffset` (l.479-514).
  3. Les segments suivants démarrent à pas/2.
- **Pièges** :
  - Le paramètre t n'est **pas reparamétré à abscisse constante** : sur une spline non uniforme, l'espacement varie.
  - Le mode Wall pose des entités une par une, là où le **WallGenerator / PrefabGenerator natif** fait exactement ça.

### 3.10 Corridor Clearance : `TAT/CorridorClearanceTool.c`
- `[WorkbenchToolAttribute(name:"Corridor Clearance", awesomeFontCode:0xF018)]` (l.19-26).
- **Paramètres** : `m_fCorridorWidth` 15, `m_fBufferZone` 5, `m_iBufferThinPercent` 50, `m_bSkipTerrain` true, `m_sNameFilter`.
- **Algorithme** (l.343-688) :
  1. Waypoints saisis comme dans le Path Decorator. Échantillonnage Catmull-Rom tous les **2 m** (l.351).
  2. AABB élargie de `w/2 + buffer`, puis sphère englobante et `SCR_WorldEditorToolHelper.QueryEntitiesBySphere`.
  3. Pour chaque entité, distance XZ minimale aux échantillons (**O(N·S)**). Si `≤ w/2`, `DeleteEntity`. Si elle est dans le buffer, suppression avec la probabilité `thin%`.
  4. Filtre de nom insensible à la casse (`ToLower`, `IndexOf`). Bouton `Count in Corridor` pour une simulation à blanc.
- **Pièges** :
  - Le calcul se fait au point le plus proche, pas au segment : erreur jusqu'à 1 m.
  - La sphère englobante d'un long tracé ramène énormément d'entités.
  - Les arbres **générés par un ForestGenerator ne sont pas des entités éditeur** et ne sont donc pas supprimés. Pour un FG, il faut exclure le tracé de la forme, ou compter sur `m_bAvoidRoads` du FG.

### 3.11 Object Replacer : `TAT/ObjectReplacerTool.c`
- `[WorkbenchToolAttribute(name:"Object Replacer", awesomeFontCode:0xF362)]` (l.17-24).
- **Paramètres** : `m_sSourcePrefab` (filtre exact sur `GetResourceName()`), `m_sTargetPrefab`, garder position, rotation et échelle (true), `m_bRandomizeScale` false, échelle 0.8..1.2.
- **Algorithme** (l.139-313) :
  1. Collecte de la position, des angles (`ent.GetTransform(mat)` puis `Math3D.MatrixToAngles`) et de l'échelle (`src.Get("scale")`).
  2. `DeleteEntity`, puis `CreateEntity(target,"",layerId,null,pos,vector.Zero)`.
  3. Correction RELATIVE_Y, `coords`, `angles` (permutés), `scale`.
- **Pièges** :
  - Le remplaçant atterrit dans le **calque courant**, pas dans le calque d'origine.
  - `m_bKeepPosition=false` n'a aucun effet (l.247-252).
  - Le nom et les composants surchargés de l'original sont perdus.

---

## 4. Synthèse des appels API observés (signatures telles qu'utilisées)
| Appel | Utilisé par |
|---|---|
| `WorldEditorAPI SCR_WorldEditorToolHelper.GetWorldEditorAPI()` | ATT XYZ (plugin) ; les outils ont `m_API` hérité |
| `bool BeginEntityAction(string name = "")` / `EndEntityAction()` | tous ; renvoie false si une action est déjà ouverte |
| `int GetCurrentEntityLayerId()` | tous les créateurs |
| `IEntitySource CreateEntity(ResourceName, string name, int layerId, IEntitySource parent, vector pos, vector angles)` | tous les créateurs |
| `SetVariableValue(IEntitySource, null, "coords"/"angles"/"scale", string)` | TerrainUtils, Featherer, Replacer |
| `IEntitySource.Get("Flags", int)` / `Get("scale", string)` / `GetResourceName()` / `GetLayerID()` / `GetSubScene()` | divers |
| `float GetTerrainSurfaceY(x, z)` | tous |
| `BaseWorld.GetSurfaceY(x,z)` / `GetOceanHeight(x,z)` / `GetCurrentCamera(mat)` / `QueryEntitiesBySphere(c, r, cb, null, EQueryEntitiesFlags.ALL)` | TerrainUtils, collisions |
| `SCR_WorldEditorToolHelper.QueryEntitiesBySphere(world, c, r)` → `array<IEntity>` | Eraser, Density, Corridor, Biome |
| `SourceToEntity` / `EntityToSource` | divers |
| `DeleteEntity(src)` / `DeleteEntities(array)` | Eraser (lot), autres (un par un) |
| `GetSelectedEntitiesCount/GetSelectedEntity(i)/ClearEntitySelection/AddToEntitySelection` | sélection d'entrée et de sortie |
| `TraceWorldPos(x, y, TraceFlags.WORLD, out start, out end, out dir)` | outils à souris |
| `IsEntityLayerLockedHierarchy(subScene, layerId)` | Eraser |
| `UpdatePropertyPanel()`, `GetModifierKeyState(ModifierKey.X)`, `CreateCircle`, `Shape.CreateLines` | UI des outils |
| `Workbench.ScriptDialog/Dialog/RunProcess/KillProcess/GetAbsolutePath`, `FileIO.BeginParse/OpenFile/FileExists` | ATT, presets |

**Jamais utilisés** dans ces mods : `ModifyLayers`, `ModifyHeightMap*`, `BeginTerrainAction`, `ToggleGeneratorEvents`, `CreateSubsceneLayer`, `SetEntitySubsceneLayer`, `ParentEntity`, `CreateObjectArrayVariableMember`, et aucune entité de forme ou de générateur. C'est de la pose d'entités brutes uniquement.

## 5. Faiblesses communes
- **Coût en entités** : chaque arbre est une entité éditeur dans le `.layer`. Un ForestGenerator produit les siens à la volée, sans les sérialiser, ce qui pèse bien moins sur le fichier, le chargement et le budget console. Plafonds par défaut : 5000 objets (Randomizer, Band), 200 par trait (pinceaux).
- **Pas de reproductibilité** : seeds aléatoires et `Math.Random*` partout.
- **Pas de peinture de surface** (`ModifyLayers`), **pas de heightmap**, **pas de calques dédiés** : tout tombe dans le calque courant.
- **Eau = océan seulement** (`GetOceanHeight`) : lacs et rivières ignorés.
- **Lectures de hauteur répétées** : 5 par pente, sans cache.
- Sélection de milliers d'entités en fin de génération via `AddToEntitySelection` en boucle : lent.

---

## 6. Patrons Enforce réutilisables pour notre plugin importeur Workbench
**Squelette en prose** :
1. `#ifdef WORKBENCH`, puis une classe `RM_ImportPlugin : WorldEditorPlugin` avec `[WorkbenchPluginAttribute(name, category:"Reforger Mapper", wbModules:{"WorldEditor"}, awesomeFontCode)]`. Comme l'XYZ, `Run()` ouvre `Workbench.ScriptDialog(titre, texte, this)` avec un `FileNamePicker` (extension `json` ou `txt`) et des boutons `[ButtonAttribute("Import", true)]` / `Cancel`.
2. Lecture du fichier exporté par l'outil web, au choix :
   - `FileIO.OpenFile(path, FileMode.READ)` + `ReadLine`, dans un format ligne `clé=valeur` à sections, comme les presets ;
   - `BeginParse` / `ParseLine`, pour des lignes à jetons séparés par des espaces, comme l'XYZ.

   Un format ligne est plus simple à parser en Enforce qu'un JSON.
3. `api.BeginEntityAction("RM Import")` gardé par son booléen de retour. Découpage en lots si l'import est très gros, comme `m_iBatchSize` d'AutoDecorator.
4. Pour chaque forme : créer l'entité Polyline ou Spline, puis **chaque point à `Y = api.GetTerrainSurfaceY(x, z)`**, relatif à `coords` si les points sont relatifs. Ensuite le générateur (FG/PG/RG/Lake) en enfant direct. Les appels de création de forme et de points (`CreateObjectArrayVariableMember`, `ParentEntity`) restent [S] ; voir ENFUSION_FORMATS §5.
5. Entités isolées éventuelles : appliquer la recette `TerrainUtils.SpawnEntity`, y compris la gestion de `RELATIVE_Y`.
6. `EndEntityAction()`, puis un récapitulatif dans `Workbench.Dialog`.
7. En option, `Workbench.RunProcess` pour lancer notre CLI de conversion (comme ATT_PythonHelper).

**Extraits de référence (≤ 10 lignes)** :

Création + correction RELATIVE_Y (`TAT/TerrainUtils.c:326-345`) :
> *(extrait de code retiré : il provient d'un mod tiers sans licence ; voir le mod d'origine sur le Workshop)*

Undo par lots (`TAT/AutoDecorator.c:634, 692-697`) :
> *(extrait de code retiré : il provient d'un mod tiers sans licence ; voir le mod d'origine sur le Workshop)*

Lecture d'un fichier par jetons (`ATT/ATT_XYZImportPlugin.c:128, 137-148`) :
> *(extrait de code retiré : il provient d'un mod tiers sans licence ; voir le mod d'origine sur le Workshop)*
(Prévoir `parser.EndParse()` à la fin, l.223. Ne jamais mettre de `continue` avant le test de fin.)

Garde-fous de suppression (`TAT/EraserTool.c:268, 277-279, 307`) :
> *(extrait de code retiré : il provient d'un mod tiers sans licence ; voir le mod d'origine sur le Workshop)*

Persistance d'options dans le profil (`TAT/AutoDecorator.c:1137-1139`) : `"$profile:" + "AutoDecoratorPresets_v2.txt"` puis `FileIO.OpenFile(path, FileMode.WRITE)`. Utile pour mémoriser le dernier fichier importé.

Résolution d'un chemin d'addon vers le disque (`ATT/ATT_HeightmapAnalyzer.c:26-31`) : `SCR_AddonTool.ToFileSystem("Addon") + "rel/path"` puis `Workbench.GetAbsolutePath(virt, abs, true)`.

---

## 7. Ce qu'on reproduit côté web (TS) et côté plugin
| Fonction | Côté web (TypeScript) | Côté plugin (Enforce) |
|---|---|---|
| Classification pente / altitude / eau | **Oui**, sur la heightmap entière : pente par différences centrées, comme `GetTerrainNormal`, mais en un passage raster, avec les seuils 5/20/40° et la bande « bas » du Randomizer. L'eau inclut lacs et rivières, contrairement au mod. | Non |
| Bruit FBM, value noise, seeds | **Oui** : `ValueNoise2D` + `FBM`, 3 octaves, lacunarité 2, gain 0.5, échelle 0.02 à 0.05. **Seed fixe** pour la reproductibilité. Sert à découper les polygones de forêt, de clairière et de densité. | Non |
| Poisson disk, falloffs | Oui, si l'on veut des points isolés (arbres solitaires, rochers) | Non |
| Catmull-Rom, tangente, longueur | **Oui**, pour le lissage des routes et des haies, avec reparamétrage à abscisse constante (absent du mod) | Non : on exporte des points déjà échantillonnés, et la spline native lisse elle-même |
| Lisières de forêt | Oui, mais **géométriquement** : buffer négatif du polygone, puis anneau en FG « Brushland/Clearing » ou densité réduite. Ce n'est pas le O(n²) sur entités du Featherer. | Non |
| Dégagement de couloir | Oui : soustraction booléenne du tampon de route (largeur + falloff) des polygones de forêt avant export | Non (le FG a aussi `m_bAvoidRoads`) |
| Bandes d'altitude, biomes | Oui : règles de choix du prefab FG ou des groupes par zone | Non |
| Y des points de forme | Approximatif (heightmap source) | **Oui, obligatoire** : `GetTerrainSurfaceY(x,z)` pour chaque point à l'import |
| Création formes et générateurs, undo, lots, calques | Non | **Oui** : patron du §6 |
| Peinture de surfaces, heightmap | Préparation des masques et PNG 16 bits | `ModifyLayers` / Terrain Creation (aucun mod ne l'utilise : à prototyper) |
| Entités isolées (rochers, ruines) | Liste de points | Recette `SpawnEntity` + RELATIVE_Y, avec un plafond |

**Conclusion** : ces mods valident les algorithmes (classification, FBM, Poisson, Catmull-Rom, lisière, couloir) et fournissent les patrons Workbench (dialogue, parse, undo par lots, garde-fous). Aucun ne touche aux générateurs natifs, à la peinture ou à la heightmap, et c'est précisément là que se place notre outil.
