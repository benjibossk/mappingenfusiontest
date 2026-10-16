# Architecture — outil global

Un seul outil, trois couches. Chaque outil étudié devient un **module** qui lit et écrit un même
format pivot, le *projet MapGen* (JSON). Sources : inventaire de RESEARCH, WORKSHOP_TERRAIN_MODS,
BENCHMARK_GIORBEV, WIKI_TERRAIN, ENFUSION_FORMATS.

```
 Navigateur (Vite + TS)                Pont local (Node)            Workbench
 ┌──────────────────────────┐  HTTP   ┌──────────────────┐  TCP    ┌─────────────────────────┐
 │ modules → projet JSON    │ ──────▶ │ écrit le JSON,   │ ──────▶ │ plugin MapGen :         │
 │ aperçu MapLibre / WebGL  │ ◀────── │ appelle le plugin│ NET API │ lit le JSON, crée formes│
 └──────────────────────────┘ statut  └──────────────────┘ :5775   │ + générateurs, peint    │
                                                                    └─────────────────────────┘
```

- **Navigateur** : tout le calcul (relief, masques, parcelles, semis). Aucun accès Workbench requis :
  le projet s'exporte aussi en fichiers (`.asc`, PNG, JSON) pour un import manuel.
- **Pont** : petit serveur local ; le Workbench sait parler vers l'extérieur (NetApiHandler,
  RestContext, `Workbench.RunProcess`). Réutilise le mécanisme du MCP (port 5775).
- **Workbench** : plugin `MapGen - Apply project` (évolution de `MG_CreateShapesPlugin`, méthode
  validée ENFUSION_FORMATS §9) — seul endroit qui touche le monde.

## Format pivot `mapgen.json` (v0)

```json
{
  "version": 0,
  "terrain": { "size": 4096, "cell": 2, "origin": [0, 0] },
  "shapes": [
    { "id": "forest_12", "kind": "polyline", "closed": true,
      "points": [x0, z0, x1, z1, ...],   // paires X/Z monde à plat, Y échantillonné par le plugin
      "generator": "{37C347EECE844530}Prefabs/WEGenerators/Forest/FG_Forest_Pine1.et",
      "source": "worldcover" }
  ],
  "entities": [ { "prefab": "{GUID}path.et", "pos": [x, z], "yaw": 0, "scale": 1 } ],
  "masks":    [ { "surface": "grass", "png": "masks/grass.png" } ],
  "heightmap": "terrain.asc"
}
```

Règles : prefabs **toujours** `{GUID}chemin` ; routes en `kind: "spline"` (RoadGenerator refuse
les polylines) ; forêts / lacs fermés ≥ 3 points.

## Modules (ce qu'on reprend de chaque outil)

| Module | Repris de | Reprise | Sortie |
|---|---|---|---|
| Relief réel | BARNMAP (formats seulement), Copernicus / IGN / Mapterhorn | idées | `.asc` |
| Relief fictif | mapgen4 (Apache-2.0) | code | `.asc`, rivières |
| Analyse relief | Map-generator giorbev (MIT) : pente, TPI, courbure, flux | code porté TS | grilles internes |
| Masques de sol | Map-generator + WorldCover | code + données | PNG 8-bit (≤5 surfaces/bloc) |
| Occupation réelle | OSM (routes, eau), WorldCover (forêts) | données | shapes |
| Campagne | AgriFieldGenerator Tanin (MIT) : Voronoi, coloriage | code porté TS | parcelles, haies `PG_*`, masques |
| Semis d'objets | TerrainAutomationTools (pas de licence) : biome, densité, lisière, chemins | **idées seulement** | `entities` |
| Nuage de points | AdvancedTerrainTools (pas de licence) : import `.xyz` | idées | `entities` |
| Satmap | granQ (pas de licence), wiki §2 | idées | PNG |
| Budget plateforme | giorbev benchmark (pas de licence) : idées ; Lou : densité | à mesurer | alertes |

Recouvrements tranchés : semis = un seul moteur (Poisson + règles de biome) pour forêts hors
générateur, rochers, buissons ; haies = PrefabGenerator sur bordure (AFG + Path Decorator) ;
masques = un seul calcul alimente sol, satmap et règles de semis.

## Ordre de réalisation

1. Plugin `MapGen - Apply project` lisant `$profile:MapGen/mapgen.json` (shapes + generators) — **fait** (2026-10-15).
2. Pont local + bouton « Envoyer au Workbench » dans le web.
3. Campagne (port AFG) → premier module qui produit des shapes.
4. Analyse relief + masques ; puis relief réel ; puis semis ; puis budget.

Ouvert : formule taille de masque (8/16/32 km), GUID river/lake restants, test `ModifyLayers`
pour peindre les sols depuis script, licences Esri/Mapterhorn/IGN, mesure des limites consoles.

## Relief : mapgen4 → Workbench (recherche 2026-10-15)

- **giorbev** : seul `Map-generator` touche au terrain ; il **lit** les hauteurs (`load_heightmap_asc`) et
  écrit les couches de sol directement dans les `.ttile`. Pas d'érosion, pas d'écriture de hauteurs ;
  « eau » = masques remplissage de cuvettes + accumulation de flux.
- **mapgen4** (Apache-2.0) : déjà TypeScript / ES modules, build esbuild, WebGL maison (pas de regl).
  Altitude sans unité −1..1 (0 = mer), peinture 128², maillage Delaunay ; pluie et rivières
  (`assignRainfall`, `assignRivers`, `flow_s`). **Pas d'export** : à ajouter (rastérisation des
  triangles en grille Float32), puis détail (bruit + érosion) et mise en mètres.
- **Écriture des hauteurs par script** : `WorldEditorAPI.BeginTerrainAction(TerrainToolType, …)`,
  `ModifyHeightMap(x, z, FilterMorphOperation, TerrainToolDesc, FilterMorphShape, FilterMorphLerpFunc)`,
  `ModifyHeightMapUserShape(x, z, op, toolDesc, array<float> userShape, UserShapeFilter)`.
  Aucun exemple dans les scripts du jeu. Inconnues : « set » absolu ou additif, taille du tampon,
  bords des tuiles, mémoire d'annulation. Repli : `.asc` importé par le Terrain Creation Tool.
- **Érosion navigateur** (licences à vérifier) : SimpleHydrology (particules, MIT), terrain-erosion-3-ways
  (grille, MIT), Hydraulic-Erosion de Sebastian Lague (MIT), érosion grille WebGL2 (Mei 2007), thermique.

Pipeline visé : mapgen4 (dessin) → grille 1025² → sur-échantillonnage + bruit → érosion (+ rivières
mapgen4) → mètres → pont, par tuiles → plugin `ModifyHeightMapUserShape`.

### Écriture des hauteurs : VÉRIFIÉ (2026-10-15, plugin `MG_TerrainTestPlugin`)

- Enums (sondés par script) : `FilterMorphOperation` ADD=0 NOISE=1 EXACT=2 SMOOTH=3 COMBINE=4
  NONCUMULATIVE=5 ; `FilterMorphShape` ROUND/SQUARE/USER ; `FilterMorphLerpFunc` LINEAR, SIN, INV_COS,
  SMOOTH, SPHERE, INV_SPHERE ; `UserShapeFilter` NEAREST/BILINEAR/BICUBIC ; `TerrainToolType`
  HEIGHT_ADD=1 HEIGHT_EXACT=2 HEIGHT_SMOOTH=3 HEIGHT_NOISE=4 SURFACE_PAINT=5 …
- `BeginTerrainAction(HEIGHT_EXACT)` + `ModifyHeightMap(x, z, EXACT, TerrainToolDesc_HeightExact
  {fExactHeight=48, fOuterSize=64, fInnerSizePercent=100}, SQUARE, LINEAR)` + `EndTerrainAction` :
  38 m → **48 m exact**, plat jusqu'à 120 m du centre, intact à 140 m.
  ⇒ **`fOuterSize` = demi-largeur en mailles du terrain** (64 × 2 m = 128 m). Annulable (Ctrl+Z).
- Terrain test `emptyarland` : 2049 × 2049 sommets, maille 2 m.
- Reste à tester : `ModifyHeightMapUserShape` (tampon de hauteurs libres) pour écrire une grille.

## Peinture des sols (recherche giorbev, 2026-10-15)

- Limite réelle : **par bloc** (33 × 33 sommets, 32 × 32 faces) : **5 surfaces max** défaut compris,
  voisins comptés ; BI recommande 3 pour des masques faits hors Workbench (WIKI_TERRAIN §47).
  Le « 7 » de Map-generator = capacité du format binaire (`_layer.edds` R32_UINT, w1..w6 sur 5 bits,
  w0 implicite), exploitée sur une seule carte (Zimnitrita) ; son propre README dit 5 en vanilla.
- Élagage repris de `clean_weights.py` : mettre à 0 sous ~1 % de couverture, garder les N plus fortes,
  renormaliser. Mieux : reporter le poids retiré sur la surface conservée la plus proche.
- Écriture directe `.ttile` (LRS2/GCTD) : rétro-ingénierie fragile (octet « fond Zimnitrita » codé en dur,
  décalage ignoré), matériaux devant exister dans `terrain.terr` → **à éviter**. Voies retenues :
  import de masques par le Terrain Tool, ou `ModifyLayers` / `ModifyLayersUserShape` par script
  (même API que les hauteurs, `TerrainToolType.SURFACE_PAINT`, `TerrainToolDesc_LayerAdd`) — à tester.
- Règles de biome giorbev : pente min/max, altitude min/max, courbure, priorité, intensité ; matériaux =
  noms `.emat` vanilla (Grass_02, Rock_01, …).

## Tuiles et relief chez giorbev (Map-generator, MIT) — 2026-10-15

- **Géométrie** (Zimnitrita, 4097² sommets, maille 4 m) : 32 × 32 tuiles, 4 × 4 blocs par tuile ;
  tuile = 128 mailles (+1 sommet partagé = 129), bloc = 32 mailles ; `_layer.edds` 512² par tuile
  (128² texels par bloc). À lire dans `Terrain.bterr` HEAD (u32 largeur, u32 hauteur, f32 maille à
  l'offset 16) au lieu de coder 32/4 en dur. Fichier `<préfixe><id>.ttile`, id = ty × 32 + tx ;
  `.Data/` (ttile, _layer.edds) et `.EditorData/` ; ligne de bloc 0 = sud (inversion image).
- Chunks `.ttile` : VERS, HGHT (33 282 o = 129 × 129 u16 probable, non vérifié), BERR, GCTD, LRS2, TMAT.
- Pas de fonction « tuiles touchées par une zone » : à écrire (comme `polygon_tiles.txt` d'AFG).
- **Relief à porter en TS** (terrain_algorithms.py) : pente et orientation (`np.gradient`), courbure
  Zevenbergen-Thorne 3×3, TPI (moyenne en boîte, rayons 100 m / 500 m, normalisé p1–p99), rugosité
  (écart-type 20 m) → portage direct. À remplacer par mieux : remplissage des cuvettes (reconstruction
  skimage → priority-flood Barnes 2014), écoulement D8 (boucle Python → tableaux typés), distance à la
  côte (EDT Felzenszwalb).
- **Mer / côte** : mer = h ≤ 0 **reliée au bord** de la carte (exclut les creux intérieurs), bande
  côtière 40 m en dégradé. Pas de polygones de lacs ni de rivières : seulement l'accumulation D8.

### Test 2 (2026-10-15, `MG_TerrainTest2Plugin`, repère : mât `MG_TerrainTestMarker` en 1104 / 2832)

- `ModifyHeightMapUserShape(x, z, EXACT, HeightExact{fExactHeight=60, fOuterSize=32}, pyramide 32×32
  0→1, BILINEAR)` : sommet 59,3 m, 49,4 m à mi-pente, sol intact (39 m) à 64 m.
  ⇒ le tableau couvre ±fOuterSize mailles (32 × 2 m = 64 m de demi-largeur) et chaque valeur est un
  **poids de mélange** : h = sol + w × (fExactHeight − sol). Pour imposer une grille quelconque :
  à tester `ADD` + `HeightAdd{fAdd=1}` avec tableau = (cible − sol) en mètres.
- `ModifyLayers(SURFACE_PAINT, LayerAdd{pMaterial=Rock_01, fAddNormalized=1, fOuterSize=16})` :
  appel accepté (`begin=1`), rendu à confirmer visuellement (carré de 64 m à 60 m à l'ouest du mât).
- ⚠ Les modifications de terrain **non sauvegardées sont perdues** au rechargement des scripts
  (le plateau à 48 m du test 1 a disparu) → toujours `wb_save` avant de compiler.

## Surfaces du terrain : ce qui marche (validé 2026-10-15 sur Mapgenerator/Worlds/TestWorld)

- **Convention monde ↔ terrain** : `Worlds/X.ent`, `Worlds/X_Layers/`, `Worlds/X/X.terr` (+ `.Data/X_*`,
  `.EditorData/`), et l'entité du layer s'appelle `GenericTerrainEntity X` (le nom désigne le dossier).
- **Carte de surfaces** : un terrain importé peut ne pas en avoir (Info & Diags : « Surface Mask n/a ») →
  peindre crashe. Manage → *Change surface map size…* (256 = 1 m/texel sur tuile 256 m) l'initialise sans
  crash. Effet disque : `TerrainSurfaceBits 8` dans le `.terr.meta`, un octet de `TEXS` passe à 1.
- **Liste des surfaces** = chunk `MATS` de `X.terr` (IFF : `FORM` + taille BE, `TERR`, chunks nom + taille BE).
  Corps : 2 octets (`08 00`), puis entrées `u32 LE longueur (avec \0)` + `{GUID}chemin.emat\0`. Le panneau
  Paint ne l'écrit qu'après usage d'une surface ; **l'écrire nous-mêmes, monde fermé, marche** : 51 surfaces
  vanilla présentes à la réouverture. Liste exportée par le plugin *MapGen - Register surfaces*
  (`$profile:MapGen/surfaces.txt`).
- **Peinture par script : crashe** (`Material.GetOrLoadMaterial(res, 0)` → « Material cannot create clone
  for 0x0 creation flags », puis access violation dans `ModifyLayers`). Flags non documentés. Reste à
  tester : import de masques (Paint → Import/export masks) ou écriture `_layer.edds`.
- **ModifyHeightMapUserShape** : EXACT = poids (h = sol + w·(H − sol)) ✔ ; ADD ≈ un coup de pinceau
  (+0,6 m pour 20 demandés) ✘ → relief arbitraire en 2 passes EXACT (montée H = max, descente H = min).
- **Ne pas interroger le NET API pendant une fenêtre modale du Workbench** (crash dans `GetResponse`) :
  le site ne fait plus de sondage automatique.

### Création d'un terrain neuf (validé 2026-10-15, Mapgenerator/Worlds/MG_Test)

1. New World (Base scene) → poser `{221ABC927C672E4E}Prefabs/World/DefaultWorld/GenericTerrain_Default.et`
   en 0 0 0, nom = nom du monde, Ctrl+S → clic droit « Create new terrain… ».
2. Fenêtre New Terrain = le futur formulaire du site : nom ; grille (multiple de 128 = tuile) ; blocs par
   tuile (4) ; maille (m) ; Height scale (0,03125 m → 2048 m de plage) ; « Zero » (10 % → −205..+1843 m) ;
   Surface layer weight bits : **8 bits = 5 surfaces/bloc** (fondu fin, défaut BI) ou **5 bits = 7 surfaces**.
3. Monde fermé → `POST /surfaces` (pont) : 51 surfaces vanilla dans `MATS` + octet `TEXS` → à la
   réouverture, pas de fenêtre « Init Surface Map », peinture directe OK.
   Note : `TEXS` d'un terrain neuf = 6 octets à 0 (l'île importée avait `00 01 00 01 00 00`).
4. Relief : Manage → Import height map accepte `.asc` et PNG 16 bits (resampling min/max) → voie
   principale pour le site (réel ou mapgen4) ; EXACT par script pour les retouches.

## Masques de surface (Paint → Import/export masks)

- Un PNG par surface, nommé comme le .emat (`Grass_01.png`), niveaux de gris 8 bits, une image pour tout le terrain.
- Taille = TilesCount × 252 + 1 (MG_Test 16 tuiles → 4033 px, ≈ 1,016 m/px). Valeur 0..255 = poids de la surface.
- **Ligne 0 = NORD** (z max), colonne 0 = ouest. Vérifié sur MG_Test (2026-10-15).
- L'import prend un dossier ; les surfaces sans PNG sont signalées absentes (avertissement sans gravité).
- Les tuiles peintes non enregistrées font échouer le chargement de `<nom>_<t>_layer.edds` à l'export : Ctrl+S avant.

## À faire : routes tracées sur le site

- Route = spline avec générateur de route (comme les haies), prefab route sur la spline.
- Sous la route : masque de surface Asphalt (cœur) + Dirt (bords, fondu), écrit dans /masks.
- Carte satellite : même tracé coloré (asphalte gris, bords terre) pour la vue de loin.
- L'herbe 3D (clutter) vient de la surface peinte, pas de la carte satellite : peindre l'asphalte sous la route
  supprime l'herbe qui traverse le prefab.

## Relief fictif sur le site (2026-10-15)

Fonctions de mapgen4 (Amit Patel, Apache-2.0) refaites sur notre grille, sans reprise de son code
(maillage Delaunay + WebGL inadapté au tuyau grille → pont) :
- `src/modules/island.ts` : îles (nombre, part de terre, graine), mer en profondeur, surfaces par altitude/pente.
- Pinceau (site) : monter, creuser, aplanir, mer, adoucir — sur `baseHeights`.
- `src/modules/hydro.ts` : pluie modulée par le vent (versants exposés), priority-flood (cuvettes drainées),
  directions D8, accumulation, lit creusé + surface `Pebbles_01`. Les fleuves sont recalculés à la demande
  depuis `baseHeights` (pas de creusement cumulé).
À faire : eau des fleuves (prefab rivière sur spline depuis le tracé), biomes par pluie.

## Côtes et niveau de la mer (site, 2026-10-15)

- Surfaces de base (51, `Terrains/Common/Surfaces/`) : pas de sable ni d'algues en surface. Algues = objets
  (`Prefabs/Vegetation/Core/Seaweed_Base.et`, rochers `GraniteBeachStone_*_Fucus`), laisse de mer = décalques
  `Assets/Decals/Stones/Beach/Beach_NatureDebris_*` → futur moteur de semis.
- Règles (`computeSurfaces`) : < −3 m SeaBed_01 ; −3..+1 Pebbles_02 ; +1..+4 BeachGrass_01 ; +4..+10
  Grass_03_coastal ; pente forte Rock_01, pied de falaise côtière Debris_Rock_01 ; lit de fleuve Pebbles_01.
- `limitPerBlock` : 5 surfaces max par bloc de 64 m (tuile 256 m / 4 blocs, cellule 2 m) — à ajuster si la
  grille du terrain change. Les surfaces retirées passent à la plus forte gardée.
- Niveau de la mer : la mer du jeu reste à 0 m, le site abaisse/relève tout le relief.

## À faire : travail à plusieurs côté site

Le Workbench ne permet qu'une personne par terrain (tuiles « claim/release » seulement). Le site peut
porter la collaboration, le Workbench ne recevant que le résultat :
- Projet partagé = état du site (macro-relief, masque fleuves, zones, routes, paramètres) synchronisé
  entre navigateurs (serveur léger WebSocket ou CRDT type Yjs ; à choisir).
- Verrous par zone / par calque (relief, fleuves, campagne, routes) plutôt que par tuile, avec curseurs
  et pinceaux des autres visibles en direct.
- Les coups de pinceau sont des opérations rejouables (outil, position, rayon, force) → historique,
  annulation par personne, fusion simple.
- Un seul poste « publie » vers le Workbench (pont local) : relief, masques, satellite, shapes.
- **Onglet « Notes » (annotations partagées)**, calque à part, jamais envoyé au Workbench :
  - dessiner des lignes libres, des tracés de route proposés, des zones (polygones) ;
  - poser du texte sur la carte (étiquette ancrée à un point) ;
  - chaque note a un auteur, une date, une couleur par personne, un statut (idée / acceptée / faite / rejetée) ;
  - fil de commentaires par note : les autres répondent à l'idée, réagissent, la marquent « faite » ;
  - liste des notes dans le panneau (filtre par auteur / statut), clic = centrer la carte dessus ;
  - action « convertir en route / en zone de campagne » pour passer d'une proposition au vrai calque ;
  - visibles par-dessus tous les onglets, masquables d'un clic.

## À faire : villes (après les routes)

Références données par Benji (idées seulement, pas de code repris) :
- https://www.fantasytowngenerator.com/temporary-settlement
- https://fantasygen.net/city-map-generator
- Vidéo https://www.youtube.com/watch?v=UmUs9W4riPs et outil Fab https://www.fab.com/listings/013f192b-caf4-422f-b560-5166f8c6d9b8
  (système procédural de ville à recréer côté site + plugin).

Pistes : bibliothèque de prefabs de bâtiments vanilla (empreinte, type, rôle), îlots découpés le long
du réseau routier, parcelles orientées vers la rue, densité centre → périphérie.
- https://maps.probabletrain.com/ (ProbableTrain MapGenerator) : réseau routier par **champ de tenseurs**
  (grilles + radiaux mélangés, contournent l'eau), routes principales puis secondaires, îlots, bâtiments
  extrudés. Licence à vérifier avant toute reprise : idées seulement par défaut.
- https://simteract.com/projects/city-generator/ (Simteract) : générateur de villes pour la simulation
  (réseau routier hiérarchisé, quartiers typés, bâtiments placés selon la zone). Idées seulement.

## À faire : routes depuis des données réelles

- Référence : https://mapimator.com/tools/city-roads (même principe que anvaka/city-roads) : routes
  téléchargées depuis **OpenStreetMap via l'API Overpass** (`way[highway]` dans une zone), puis dessinées.
- Chez nous : requête Overpass sur la zone choisie → tri par `highway` (motorway/primary/secondary →
  asphalte, track/path → terre, residential → rues de ville) → projection en mètres sur le terrain →
  simplification (points tous les ~25 m) → mêmes `Road` que le tracé manuel (relief, masques, splines).
- Attribution OSM obligatoire (ODbL) si des données OSM finissent dans une carte publiée.
