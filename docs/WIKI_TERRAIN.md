# Wiki Bohemia — création de terrain Reforger (synthèse)

Source : dump BIKI hors ligne livré avec enfusion-mcp (`enfusion-mcp/data/wiki/pages.json`). Le site en ligne bloque les accès automatiques (Cloudflare 403).
Pages : Terrain_Tutorial, Terrain_Creation_Tool, Terrain_Entity, New_Terrain_Setup, Terrain_Preparation_Tutorial, Forest / Road / River / Lake / Prefab / Wall / Power_Line Generator, Vector_Tool, Parallel_Shape_Tool, Object_Import_Tool, 2D_Map_Creation (toutes sous `https://community.bistudio.com/wiki/Arma_Reforger:`).

## 1. Pipeline officiel
1. Créer un monde « Base scene ».
2. Placer `GenericTerrain_Default.et` en 0,0,0. C'est obligatoire : sans son Terrain Layer Preset, les véhicules rebondissent.
3. Clic droit, puis « Create new terrain… », et régler la grille.
4. Ajouter le soleil, le ciel, l'océan, les post-process, la météo et l'IA (SCR_AIWorld, navmesh).
5. Contraintes :
   - un seul terrain par monde ;
   - grid = nombre de faces (N faces = N+1 vertices) ;
   - taille = faces × cell size ;
   - X et Z peuvent différer.

**Référence BI (proche d'Everon)** :
- cell 1,5 m ;
- bloc 33×33 vertices (48 m) ;
- tile 129×129 vertices (4×4 blocs) ;
- 8193² vertices, soit 12 288 m ;
- hauteur au pas de 3,125 cm, de -204,78 à 1843,19 m.

BI recommande de rester proche de ces valeurs : l'optimisation et la QA du moteur sont faites dessus.

**Résolution** : viser **2 m**, la grille pour laquelle les assets sont conçus. À 3 m, le placement devient difficile ; à 4 m, des trous apparaissent.

## 2. Heightmap, satmap, normal map
- **Heightmap** :
  - `.asc` recommandé (sans perte) ;
  - le PNG 16 bits est relatif et demande « resampling heights » (min/max) ;
  - options Invert X et Invert Z ;
  - export possible de la version Base ou Modified ;
  - **sauvegarder** sinon l'import n'est pas écrit.
- **Hauteur** : stockée en entier 16 bits avec un pas de 0,03125 m par défaut, soit **environ 2048 m de plage**, décalable. Réduire le pas augmente la précision et réduit la plage. Cela explique l'écrêtage à 2046 m de BARNMAP.
- **Satmap** :
  - texture lointaine, sans dimension imposée ;
  - **BI conseille de ne pas utiliser une vraie photo satellite** : il faut la construire à partir des masques, remplis des couleurs moyennes des textures `*middle_BCR` des surfaces, avec de légères variations ;
  - la finaliser en dernier, et la réimporter après les routes ;
  - attendre la fin de la régénération, sauvegarder, recharger.
- **Normal map** : régénérée depuis la heightmap. Un texel par vertex suffit.

## 3. Surfaces et masques
- Un PNG en niveaux de gris (0 à 1) par surface. Import par clic droit sur la surface, puis « priority surface mask import ».
- **La résolution source est libre** : le masque est rééchantillonné à l'import. Les 4033 px de BARNMAP ne sont donc pas une contrainte stricte. On reste prudent : à valider par un export de masque dans le Workbench pour lire sa taille native.
- La surface par défaut couvre 100 % de chaque bloc.
- **5 surfaces maximum par bloc**, surface par défaut comprise ; les blocs voisins comptent aussi. **BI recommande 3 surfaces** pour les masques générés en externe.
- Un réimport efface la peinture manuelle de cette surface.
- Outils de réparation : Fix block border, Rebuild terrain materials, Info & Diags (fusionner ou remplacer les surfaces d'un bloc).

## 4. Générateurs (tous enfants directs d'une shape du Vector Tool)
| Générateur | Shape | Points clés |
|---|---|---|
| Forest `FG_*` | fermée, au moins 3 points (une spline est lue comme une polyline) | Levels (Top, Bottom, Outline), Clusters (Circle, Strip) ; Avoid Roads/Rivers/PowerLines/Tracks/Lakes ; **Avoid Objects coûteux, à désactiver** ; flags de lisière par point ; répartition en 2D |
| Road `RG_*` | **spline uniquement** | Spline → RoadGenerator → Road (enfants). Points réguliers et peu nombreux ; Snap to Terrain ; aux intersections, un point commun à la même hauteur |
| River `R_*` | ouverte, au moins 2 points | Width, Reverse Flow, Clearance, Shore Wetness. Abaisser la spline de 0,5 à 1 m, peindre le lit, puis baker |
| Lake `LG_*` | fermée, au moins 3 points, sens horaire, sans auto-croisement | Flatten By Bottom Plane, Reverse Point Order |
| Prefab `PG_*` | au moins 2 points | Haies (Bushline) : Distance, Align With Shape, offsets, Gap, Random Spacing, **densité Perlin** |
| Wall `WG_*` | au moins 2 points | Objets First, Middle, Last, padding, offsets |
| PowerLine | ligne | Poteaux, Distance, Clearance (les forêts l'évitent) |

- **Placement en masse** (Object Import Tool) : CSV de 9 champs exactement, `"resourceName" posX posY posZ quatX quatY quatZ quatW scale`. **C'est une voie d'import officielle et simple pour nos prefabs placés.**
- Le Parallel Shape Tool crée des shapes décalées de -50 à +50 m. C'est utile pour longer les routes avec des haies.

## 5. Performance
- 1 bloc = 1 draw call, 5 LOD.
- **Les forêts sont le principal coût**. Une grande zone boisée et plate se comporte mal, car le relief sert d'occludeur. Les forêts qui dépassent les crêtes à l'horizon coûtent cher.
- Recommandations :
  - beaucoup de clairières ;
  - travailler de façon itérative sur tout le terrain ;
  - ranger la nature en calques par zone ;
  - pour le debug FG : Print Entities Count, Print Area, Print Performance Details.
- **Aucune limite chiffrée** (entités, taille maximale, budget console) dans le wiki. La création de terrain n'est possible que sur PC. Le budget Xbox / PS5 est à établir **par bench**.

## 6. Conséquences pour l'outil
- Cellule de 2 m par défaut ; heightmap en `.asc` (N+1 px) ; plage de 2048 m avec un décalage automatique.
- **Satmap générée à partir de nos masques**, avec les couleurs moyennes des surfaces, plutôt qu'une photo Esri. Cela supprime aussi le problème de licence des tuiles.
- Masques : 3 surfaces par bloc visées, 5 au maximum, avec vérification par bloc de 32×32 faces.
- Forêts : polyline fermée + `FG_*` enfant, Avoid Objects désactivé, **clairières automatiques**, avertissement sur les grandes forêts plates et sur les crêtes.
- Routes : **spline** + RG + Road, intersections fusionnées en un point.
- Eau : lacs dans le sens horaire avec `LG_*` ; rivières ouvertes avec `R_*` abaissées de 0,5 à 1 m.
- Haies : `PG_*` sur les bordures de champs, décalées avec la même logique que le Parallel Shape Tool.
- Prefabs isolés : **export CSV Object Import Tool**, plus simple et plus sûr qu'un `.layer`.

## 7. Compléments de la version en ligne du Terrain Tutorial (lue le 2026-10-14 via Chrome)
- **Taille des formes de forêt** : viser **quelques centaines de mètres par forme**. Plusieurs petites formes valent mieux qu'une grande : elles se remplissent plus vite, sont plus faciles à retoucher, et la forêt est moins uniforme avec des FG différents. → L'outil doit **découper les grands polygones de forêt** (Voronoi / grille) et varier les `FG_*`.
- **Calques** :
  - `default` ne contient que le strict nécessaire, **jamais de générateurs** ;
  - la nature va dans un calque collectif ou dans des calques nommés par grande zone (`Forest_East`, `Mountains_West`, `Shorelines_NE`…) ;
  - les toponymes sont dans un calque à part, et chaque village a idéalement le sien.
  - → L'export écrit un calque par type et par zone.
- **Points des formes** : le Forest Generator répartit en 2D. Les points doivent être « Snap to terrain », d'où l'intérêt d'écrire le Y réel du terrain comme BARNMAP.
- **Flags par point** de la forme forêt : ils activent ou coupent le sous-bois de lisière. On s'en sert pour les clairières et les zones d'exploitation forestière.
- **Rivière** :
  1. spline avec Snap to terrain et beaucoup de points ;
  2. un **RG Dirt** avec Adjust Height Map, la spline abaissée de 0,5 à 1 m ;
  3. un prefab `R_*` glissé sur la spline (Reverse Flow si nécessaire) ;
  4. le lit peint au pinceau ;
  5. la route **bakée** dans la heightmap, puis supprimée.
  - → L'outil peut exporter la spline rivière déjà abaissée, avec RG Dirt + `R_*` en enfants, et une fiche « baker puis supprimer le RG ».
- **Étangs** : polyligne **parfaitement plate**. Si l'étang paraît inversé, inverser la polyligne.
- **Barrage** : une spline en travers d'une vallée avec RG et un fort décalage « affect terrain », puis un lac derrière.
- **Lignes électriques** : « Generate per point » place un poteau exactement sur un point. Les forêts avec Avoid PowerLines libèrent le couloir.
- **Ordre BI** :
  1. Layout : structures, villages, fond marin.
  2. Population : routes, forêts, eau, rivières, lignes électriques, rivages.
  3. Détails.
  4. Satmap finale en dernier.
  - Travailler toute la carte grossièrement avant de détailler, sinon la performance n'est pas mesurable.
- **Données réelles** : BI renvoie vers QGIS et OpenTopography, et rappelle qu'un DEM à 40 m demande beaucoup de traitement pour passer à 2 m.
