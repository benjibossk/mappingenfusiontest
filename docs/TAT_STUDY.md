# Étude — Terrain Automation Tools (gaz8157) + Outside Terrain Core + Advanced Terrain Tools

Date : 2026-11-16. Sources lues (jamais exécutées) :

| Mod | GUID | Version | Extrait dans |
|---|---|---|---|
| Terrain Automation Tools (TAT) | 684876344DA83476 | 1.0.9 | `C:\Users\benbo\tools\third_party\TerrainAutomationTools\` |
| Advanced Terrain Tools (ATT) | 6874E07B40C6D5E5 | 1.0.6 | `C:\Users\benbo\tools\third_party\AdvancedTerrainTools\` |
| Outside Terrain **Core** (OTC) | 61F0D506562D9BC9 | 1.1.0 | `C:\Users\benbo\tools\third_party\OutsideTerrainCore\` |

Téléchargés auparavant via `C:\Users\benbo\tools\reforger_server\dl.json` (serveur dédié, `-addonsDir mods_dl`) — déjà présents dans `mods_dl\addons\`, aucun nouveau téléchargement nécessaire. **« Outside Terrain Tool » (61F2B96F0D3F27D4) n'a PAS été récupéré** : c'est OTC (la librairie runtime) qui était dans dl.json. Les chemins `TAT/...` ci-dessous sont relatifs à `TerrainAutomationTools\Scripts\WorkbenchGame\`.

---

## 1. Licence — ce qu'on a le droit de réutiliser

- Les trois `meta` Workshop ont `"license":""` et `"licenseText":""` : **aucune licence déclarée** (ni APL, ni APL-SA, ni APL-ND, ni MIT). Aucun fichier LICENSE/README dans les paks, aucun en-tête de licence dans les `.c`.
- Conséquence juridique : par défaut, **tous droits réservés à l'auteur** (seules s'appliquent les conditions Workshop Bohemia : usage du mod en tant que dépendance). On ne peut **pas copier/coller du code** dans Mapgenerator ni le republier.
- Ce qu'on peut faire sans risque : **réimplémenter les idées/algorithmes** (non protégeables : Poisson disk, densité de voisins, Catmull-Rom, FBM, falloff gaussien — tous classiques et publics) avec notre propre code, nos noms (`MG_`), notre structure. Ou demander à gaz8157 une licence APL-SA explicite si on veut reprendre du code tel quel.
- Rappel APL (Bohemia) si un jour l'auteur en ajoute une : **APL** = réutilisation/adaptation avec attribution, non commercial ; **APL-SA** = idem + dérivé sous même licence ; **APL-ND** = pas de dérivés. En l'état : rien.

## 2. Architecture TAT

- Tout est sous `#ifdef WORKBENCH`, module `WorldEditor`. Chaque outil = **`class X : WorldEditorTool`** avec `[WorkbenchToolAttribute(name, description, wbModules:{"WorldEditor"}, awesomeFontCode)]` (ex. `ForestFeathererTool.c:18`, `CorridorClearanceTool.c:19`). Ce sont des *outils* (panneau latéral + souris), pas des `WorkbenchPlugin` (ATT, lui, utilise `WorkbenchPluginAttribute`, `ATT_HeightmapAnalyzer.c:2`).
- Paramètres = champs `[Attribute(...)]` (sliders, ComboBox, `UIWidgets.Object` pour palettes) ; boutons = méthodes `[ButtonAttribute]`.
- Événements souris : `OnMousePressEvent / OnMouseMoveEvent / OnMouseReleaseEvent / OnKeyPressEvent` (ex. `DensityPainterTool.c:118-170`, `CorridorClearanceTool.c:98-134`). Position monde via `m_API.TraceWorldPos(x, y, TraceFlags.WORLD, start, end, dir)` (`DensityPainterTool.c:124`).
- Appels `WorldEditorAPI` utilisés : `GetSelectedEntitiesCount/GetSelectedEntity`, `SourceToEntity/EntityToSource`, `CreateEntity(prefab,"",layerId,null,pos,vector.Zero)`, `DeleteEntity/DeleteEntities`, `SetVariableValue(src,null,"coords"|"angles"|"scale", str)`, `GetTerrainSurfaceY`, `GetCurrentEntityLayerId`, `GetWorld`. Requêtes spatiales : `SCR_WorldEditorToolHelper.QueryEntitiesBySphere(world,c,r)` et `BaseWorld.QueryEntitiesBySphere(..., callback, null, EQueryEntitiesFlags.ALL)` pour un test d'occupation (callback qui retourne false au 1er hit, `DensityPainterTool.c:464-485`). Eau : `world.GetOceanHeight` (`TerrainUtils.c:57`).
- **Undo** : `bool manage = m_API.BeginEntityAction("nom")` … `if (manage) m_API.EndEntityAction();` — un seul Ctrl+Z par opération. Pour les brosses, Begin au press et End au release (`DensityPainterTool.c:163/180`, commentaire : Begin renvoie false si une action est déjà ouverte, on ne ferme que si on l'a ouverte). Auto-Decorator **découpe l'undo en lots** : End + Begin tous les `m_iBatchSize` spawns (`AutoDecorator.c:634, 691-696`).
- `TerrainUtils.SpawnEntity` (`TerrainUtils.c:320-375`) : CreateEntity → si `Flags & EntityFlags.RELATIVE_Y`, Y stocké = Y − sol (`:339`) → `SetVariableValue "coords"` → angles (alignement pente optionnel via `GetTerrainAlignedAngles`, `:160`) → scale. **Piège utile** : les prefabs à RELATIVE_Y attendent une hauteur relative.
- Utilitaires : normale par différences centrales sur 5 échantillons (`TerrainUtils.c:19-32`), pente = acos(normal.y) (`:38`), Catmull-Rom + tangente + longueur de segment (`:193-245`), ValueNoise2D smoothstep + FBM (`:252-296`), `WeightedRandom` (`:128`).

## 3. Algorithmes

### 3.1 Forest Featherer (`ForestFeathererTool.c`)
1. Prend la sélection (≥3, terrain exclu) → positions (`:90-130`).
2. **Densité de voisins** brute O(n²) : pour chaque arbre, nb d'autres arbres à distance XZ ≤ `m_fFeatherDepth` (défaut 15 m) (`:136-150`).
3. Moyenne `avg` (plancher 1) ; **arbre de lisière si `count < 0.6·avg`** (`:174`, `:196`).
4. Pour chaque lisière : suppression avec proba `thinPercent` (défaut 50 %) (`:210-217`) ; sinon réduction d'échelle `f = edgeScale + (count/avg)·(1−edgeScale)` si graduel, sinon `edgeScale` (défaut 0.6) (`:228-233`), appliquée via `SetVariableValue "scale"`.
5. Un seul BeginEntityAction "Forest Feather" (`:200-240`).
- Limite : binaire (lisière / pas lisière), O(n²), pas de notion de distance au bord réel.
- **Pour nous** : idéal côté **navigateur (TS)**, sur nos points de forêt générés avant export : grille de hachage (cellule = depth) → O(n), et mieux : utiliser la distance au bord du polygone/masque forêt (champ de distance) au lieu de la densité, pour un gradient continu. En **addon** (`MG_FeatherPlugin` éventuel) seulement pour retoucher des forêts déjà posées dans le World Editor.

### 3.2 Corridor Clearance (`CorridorClearanceTool.c`)
1. Waypoints cliqués → spline **Catmull-Rom** échantillonnée à pas fixe (`SamplePathPoints`, `:343-390`, longueur de segment estimée à 16 pas `:369`).
2. AABB des échantillons élargie de `halfWidth + buffer` → sphère englobante → `QueryEntitiesBySphere` (`:558-590`).
3. Filtre optionnel par sous-chaîne du nom de prefab (`:600-641`).
4. Distance = min sur les échantillons de `DistanceXZ` (brute, `:647-653`). `≤ halfWidth` → suppression ; `≤ halfWidth+buffer` → suppression avec proba `bufferThinPercent` (`:656-675`). Undo "Corridor Clearance" (`:609/683`).
- **Pour nous** : en **TS**, dégager routes/rivières/lignes électriques directement à la génération (distance point–polyligne exacte, pas min sur échantillons ; grille spatiale). Ajouter la bande tampon probabiliste — rend les bords de route naturels. En **addon** : un `MG_ClearCorridor` qui prend une spline/shape existante (`ShapeEntity` points) au lieu des clics serait plus utile que la version souris.

### 3.3 Density Painter (`DensityPainterTool.c`)
- Brosse : tampon tous les `radius·PAINT_SPACING_RATIO` le long du drag (`:133-134`).
- **Thin** (`:289-348`) : entités dans la sphère → `toRemove = n·%/100` (min 1) → Fisher-Yates partiel → DeleteEntity.
- **Thicken** (`:354-457`) : liste des prefabs déjà présents dans la brosse (dédoublonnée) ; `maxPoints = πr²/minDist²·density`, 3× tentatives ; point uniforme dans le disque (`sqrt(rand)·r`, `:421`), rejet eau, rejet si entité dans `minDist` (requête sphère), prefab tiré au hasard parmi les existants, yaw/scale aléatoires, `TerrainUtils.SpawnEntity`.
- **Pour nous** : l'idée « épaissir en clonant les prefabs locaux » est bonne pour l'**addon** (retouche manuelle), mais on n'a pas besoin d'une brosse : nos plugins sont batch. Côté **TS**, c'est déjà couvert par notre placement ; retenir seulement le test d'occupation et l'échantillonnage uniforme dans un disque.

### 3.4 Biome Painter (`BiomePainterTool.c`, `BiomePainterConfig.c`)
- Biome = liste de couches (`BiomeLayer`, `Config.c:15`) : prefabs pondérés, `minDistance`, multiplicateur de densité, **pente min/max**, **altitude min/max** (`:32-41`, test `IsTerrainValidForLayer` `:115-120`), échelle, offset Y, alignement pente. Modèles prédéfinis (forêt : canopée 0-25°, sous-bois 0-30°, sol 0-35° aligné ; rochers 10-60°…, `Config.c:190-290`).
- Par couche (`PaintLayer`, `Tool.c:352-482`) : `maxPoints = πr²/minDist²·density` ; point aléatoire dans le disque → **falloff** (dur / linéaire `1−d/r` / gaussien `e^(−3(d/r)²)`, `:488-510`) → **bruit FBM** 3 octaves : garde si `rand ≤ 1 − infl·(1 − (n+1)/2)` (`:405-414`) → eau → pente/altitude → **min-distance par grille** (cellule `minDist/√2`, voisinage 5×5, `:368-456`) → évitement existant (`:460`) → prefab pondéré → spawn.
- **Pour nous** : c'est la partie la plus réutilisable **en TS** : notre générateur a la heightmap en mémoire → calcul pente/altitude gratuit, couches canopée/sous-bois/sol avec règles par couche, modulation FBM de la densité (clairières naturelles). Le gabarit « couches pondérées avec filtres pente/alt » peut devenir notre format de config de biome (JSON). L'addon n'a qu'à recevoir la liste finale.

### 3.5 Auto-Decorator (`AutoDecorator.c`)
- Zones : cercle, rectangle, boîte de sélection (`:74`, `GetEffectiveAreaDimensions :584`).
- **Poisson disk de Bridson** (`GeneratePoissonPointsCircle :924-990`, rect `:996-1070`) : cellule `minDist/√2`, liste active, 30 essais (`POISSON_ATTEMPTS`, `:35`) dans l'anneau [r, 2r], validation grille (`IsPoissonPointValid :1075`).
- Puis **falloff de densité** (`ApplyDensityFalloff :875-918`) : uniforme / centre dense `1−d` / bord dense `d` / gaussien ; distance normalisée Chebyshev pour les rectangles (`:892`).
- Spawn (`SpawnEntities :623-720`) : filtre pente global (`:659`), palette pondérée avec filtre pente **par entrée** et min-distance par entrée (`SpawnFromPalette :726-776`), collisions, undo par lots (`:691-696`). Presets sauvés en fichier texte (`:1134-1234`).
- **Pour nous** : Bridson + falloff → **TS** (remplace un placement aléatoire + rejet, qui fait des amas). L'**undo par lots** est à reprendre (en idée) dans `MG_ApplyProjectApi.c`/`MG_ApplyProjectPlugin.c` pour les gros imports : un seul `BeginEntityAction` sur 50 000 entités est lourd ; des lots de ~1 000–5 000 restent annulables.

### 3.6 Object Replacer (`ObjectReplacerTool.c`)
- Sélection, filtre optionnel prefab source exact (`:163-183`) ; mémorise position, angles (`Math3D.MatrixToAngles` sur `GetTransform`, `:198-200`), scale (`src.Get("scale")`, `:203-209`).
- Dans un undo "Object Replace" (`:235-299`) : Delete → `CreateEntity(target)` → correction RELATIVE_Y (`:260-267`) → `coords` → `angles` **réordonnés** `rot[1] rot[0] rot[2]` (MatrixToAngles = yaw,pitch,roll ; propriété `angles` = pitch,yaw,roll, `:276`) ou yaw aléatoire → scale conservée/aléatoire.
- **Pour nous** : **addon**, utile tel quel en idée (ex. `MG_Replace` pour remplacer nos prefabs placeholder par les définitifs après génération, ou changer d'essence d'arbre d'une forêt). Deux pièges à retenir pour tous nos `MG_` : l'ordre pitch/yaw/roll de `angles` et la hauteur relative RELATIVE_Y.

### 3.7 Outils non demandés mais présents
`ElevationBandTool.c` (placement par bandes d'altitude), `EraserTool.c` (brosse `DeleteEntities` en un appel, `:307`), `PathTool.c` (décor le long d'une spline : murs/clôtures, tangente Catmull-Rom), `TerrainRandomizer.c`. PathTool mérite une lecture si on veut des clôtures/haies le long de nos routes.

## 4. Outside Terrain Core (OTC) — extension hors carte
Ce n'est **pas un algorithme d'extension de bord** : c'est une entité runtime qui affiche un **morceau de maillage** à partir d'une grille de hauteurs fournie à la main.
- `OTC_Mesh` (`OutsideTerrainCore\Scripts\Game\OutsideTerrainCore\OTC_Mesh.c`) : grille `resolution²` (max 33×33), sommets `((x/(res−1))−0.5)·width, h, …`, UV 0-1, 2 triangles par quad.
- `OTC_OutsideTerrainChunkEntity` (`...\Entities\OTC_OutsideTerrainChunkEntity.c`) : attributs largeur/hauteur (128 m), résolution, `array<float>` hauteurs, matériau `.emat` ; `MeshObject.Create` (`:55`), collision optionnelle `PhysicsGeom.CreateTriMesh` + `Physics.CreateStaticEx` (`:78-82`).
- **Pour nous** : le **navigateur (TS)** peut générer l'anneau hors carte (prolongement de la heightmap en bord : clamp + atténuation/bruit vers une altitude basse) et exporter des chunks (hauteurs 33×33 par tuile de 128 m+) ; l'**addon** n'a qu'à créer des `OTC_OutsideTerrainChunkEntity` (dépendance au mod OTC) en remplissant l'attribut hauteurs via `SetVariableValue`. Alternative sans dépendance : réécrire notre propre entité mesh (code simple, mais pas de licence → réimplémenter).
- L'« Outside Terrain Tool » (61F2B96F0D3F27D4), qui contient probablement le générateur de chunks, n'est pas téléchargé : il faudrait l'ajouter à une copie de dl.json.

## 5. Advanced Terrain Tools (ATT)
Plugin (`WorkbenchPluginAttribute`) qui **lance un script Python externe** (`ATT_PythonHelper.c`, `Workbench.RunProcess`) pour analyser une heightmap / importer du XYZ (`ATT_XYZImportPlugin.c`, 320 l.). Les scripts Python ne sont pas dans le pak. Intérêt : le patron « plugin Workbench → process externe → attendre le handle » pourrait servir à appeler notre outil depuis le Workbench, mais notre NET API (`MG_*Api.c`) est déjà plus propre.

## 6. Synthèse — où mettre quoi

| Idée | TS (navigateur) | Addon MG_ |
|---|---|---|
| Lisière de forêt (densité voisins / distance bord) | **oui** (grille hash, gradient) | option retouche |
| Dégagement corridor + tampon probabiliste | **oui** (routes, rivières) | `MG_ClearCorridor` sur shape |
| Biome en couches (pente/alt/FBM/poids) | **oui** — format de config | non |
| Poisson disk Bridson + falloff | **oui** | non |
| Undo par lots Begin/EndEntityAction | — | **oui** (ApplyProject) |
| RELATIVE_Y + ordre `angles` pitch,yaw,roll | — | **oui** (à vérifier dans nos spawns) |
| Remplacement de prefabs | — | **oui** `MG_Replace` |
| Anneau hors carte (OTC) | génération des hauteurs | création des chunks |

Rappel : réimplémenter, ne rien copier (aucune licence déclarée).
