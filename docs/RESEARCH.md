# Reforger Mapper — dossier de recherche

Objectif : un outil web pour mapper vite sur Arma Reforger (moteur Enfusion) et auto-remplir des zones avec les assets vanilla.
Phase actuelle : **recherche**. Pour chaque source : ce qu'elle fait, ce qu'on a vérifié, et comment le reproduire dans l'outil final.

Légende : ✅ vérifié dans le code ou dans des fichiers · 🔎 déduit (captures, doc) · ❓ à confirmer

---

## 1. BARNMAP (Barnaber / LEBARNABER), v1.48

- **Statut** : exe Windows fermé, distribué contre un don, sans licence. On ne réutilise **aucun code**, seulement le comportement et les formats observés. L'accord de l'auteur est à garder par écrit.
- **Sources** : [page vitrine](https://ustorie.github.io/BARNARMA/), manuel PDF (`BARNMAP_Manuel_Import_Enfusion.pdf`, identique à celui du dépôt), 6 captures de la v1.48, carte exemple OMAHA (zip téléchargé, Workshop `6A84C9A969207F9F`).

### 1.1 Fonctionnement (captures 🔎)
- Interface Leaflet. On cherche un lieu ou on saisit lat/lon, puis on choisit une taille : 4, 8, 16 ou 32 km.
- 4 favoris de position (boutons 1 à 4 avec une disquette).
- Le cadre de sélection est légèrement tourné : l'outil travaille dans une projection métrique locale, pas en Mercator.
- Fonds de carte et couches exportées : Heightmap, Satellite, Forêt, Route, Eau, Surface masks.
- Bouton « Calcul du relief ».
- **Décalage vertical** : désactivé par défaut. Une fois activé, il ramène le point le plus bas à 0 m ; au-delà de 2048 m, tout est aplati à 2046 m. C'est probablement la limite de hauteur du terrain Enfusion ❓.
- Export dans un dossier, avec une barre de progression et un bouton d'annulation.

### 1.2 Sources de données (attributions visibles dans les captures 🔎)
| Couche | Source |
|---|---|
| Relief | Mapzen/Tilezen (tuiles Terrarium), Mapterhorn, Copernicus DEM (DLR/Airbus), **IGN LiDAR HD** |
| Satellite | Esri World Imagery |
| Forêt et masques | **ESA WorldCover 2021** (10 m, Sentinel). Couleurs : vert = arbres, jaune = prairie, rose = cultures, rouge = bâti, bleu = eau |
| Routes et eau | OpenStreetMap (fond CARTO) |

### 1.3 Grille terrain (✅ captures et fichiers)
- Pour N km demandés : N×512 faces, N×512+1 sommets, 2 m par cellule. Le terrain mesure réellement N×1,024 km.
  - Exemple pour 4 km : 2048 faces, 2049 sommets, terrain de 4,096 km.
- Réglages Workbench (manuel) : Blocks per tile = 4, origine du terrain en 0,0,0, import de la heightmap avec Invert X désactivé et Invert Z activé.
- Heightmap : `Terrain.asc` (grille ASCII, altitudes en mètres).
- **Masques de surfaces : PNG en gris 8 bits de 4033×4033 px pour 4 km** ✅. Ce n'est ni 4096 ni 4097 : le rapport est d'environ 0,985 px/m. Le manuel précise : « format relevé dans ton Workbench, ne redimensionne pas le PNG ». C'est donc la taille attendue par l'import Workbench pour ce terrain ; reste à trouver la formule pour 8/16/32 km ❓.
- Surfaces exportées ✅ : Asphalt_01, Concrete_01, Crop_Field_01, Dirt_01, ForestDeciduous_01_Base, Heather_01, Pebbles_01, Rock_01, SeaBed_01. Grass_01 sert de fond par défaut.
- Limite moteur : 5 surfaces par bloc (manuel).

### 1.4 Formats `.et` exportés (✅ carte OMAHA : 386 routes, 42 forêts, 14 eaux)
Chaque élément est un fichier `.et` séparé. L'entité est en `coords 0 0 0` et les points sont en **coordonnées monde absolues, Y compris** : l'altitude du terrain est déjà échantillonnée. Les ID sont des hex aléatoires de 16 caractères, les ShapePoint des `{GUID}`.

**Route** : `SplineShapeEntity` avec un générateur enfant.
```
SplineShapeEntity {
 ID "68B4AE5E9FC54922"
 coords 0 0 0
 Points {
  ShapePoint "{4B887E47FC544F3D}" { Position 1500.436 40.67 515.08 }
  ShapePoint "{A24A3F0272EB42B3}" { Position 1489.299 41.508 501.66 }
 }
 {
  RoadGeneratorEntity : "{723C2AAE6E9AD131}Prefabs/WEGenerators/Roads/Asphalt/RG_Road_Asphalt_E_01.et" {
   ID "44ECE70814ED4341"
   coords 0 0 0
   AdjustHeightMap 0
   AdjustHeightMapPriority 5
   RoadClearance 16
   RoadWidth 8
   FalloffStartWidth 1
   RoadFalloffWidth 1
  }
 }
}
```
- Deux prefabs seulement :
  - `{723C2AAE6E9AD131}RG_Road_Asphalt_E_01` : 267 routes, largeur 8 ;
  - `{8E83BBD5CEC42A11}Prefabs/WEGenerators/Roads/Dirt/RG_Road_Dirt_01.et` : 119 routes, largeur 6,5.
- La clearance vaut 16 partout.
- Une fois placée dans le monde, le `Route.layer` contient le `RoadEntity` généré (bloc `SplinePoints`, `Width`, `IsClosedSpline`).

**Forêt** : `PolylineShapeEntity` fermée, **sans générateur**. C'est à l'utilisateur d'ajouter un Forest Generator.
```
PolylineShapeEntity {
 ID "809C747A8FAB4D8F"
 coords 0 0 0
 Points { ShapePoint "{...}" { Position 3624.026 55.302 1.048 } ... }
 IsClosed 1
 LineColor 0 1 0 0
}
```

**Eau** : même format que la forêt, avec `LineColor 0.05 0.48 1 1`. Les polygones de mer suivent la côte (Y ≈ -1,6 à 0), sans générateur.

- Chaque `.et` a un `.meta` (`MetaFileClass`, `Name "{GUID}chemin"`, configurations PC/XBOX_ONE/XBOX_SERIES/PS4/PS5/HEADLESS).
- **Layers du monde** (`worlds/BarnMap4km_Layers/*.layer`) : de simples références aux prefabs, par exemple `PolylineShapeEntity : "{0268BDCAF521235C}Foret/..._009.et" { }`. Les fichiers sont `Wood.layer`, `Route.layer`, `Eau.layer` et `default.layer` (GenericWorldEntity, GenericTerrainEntity, PP effects).

### 1.5 Ce qu'on fait mieux
- Les masques WorldCover sont pixelisés (10 m) : on les lisse et on les croise avec les polygones OSM.
- On ajoute un **Forest Generator** sur les forêts et un **générateur d'eau** sur l'eau, au lieu de laisser des contours vides.
- On réutilise ses deux prefabs de routes, mais on choisit la largeur selon le tag OSM `highway=*`.
- On écrit les `.meta` avec des GUID générés, comme lui.

---

## 2. giorbev/Map-generator (« Map Generator Pro » v7)
- **Licence MIT**, © 2026 Giorbev. On peut porter le code en gardant la mention.
- **Fonction** : peindre automatiquement les surfaces à partir d'une heightmap `.asc`. Il ne place aucun objet.
- **Stack** : Python (numpy, scipy, opencv, scikit), interface PyWebView. Fichiers clés : `pipeline_v5.py`, `terrain_algorithms.py`, `clean_weights.py`.
- **Algorithmes** ✅ :
  - pente et aspect ; courbure Zevenbergen-Thorne ; TPI multi-rayon ;
  - remplissage des dépressions puis accumulation de flux ;
  - distance à la côte (distanceTransform) ;
  - bruit pseudo-fBm pour casser les formes rondes ;
  - chaque masque est un produit de rampes et de « cloches » sur altitude × pente × TPI × aspect ;
  - normalisation (somme = 1), puis budget de 5 à 7 matériaux dominants par bloc.
- **13 masques**, avec des presets de biomes en JSON (`data/biomes/`).
- **Sorties** : PNG 16 bits par masque, ou écriture binaire directe dans `.ttile` (format LRS2/GCTD documenté dans `docs/technical/`). Cette écriture est risquée.
- **Limites** : valeurs codées en dur pour Zimnitrita, seed numpy globale, gros fichiers monolithiques.
- **À reproduire** : porter en TypeScript les calculs de pente, TPI, courbure et flux, et les règles de biomes en JSON, dans un worker. On exporte des PNG, pas d'écriture `.ttile` au départ. On garde sa documentation des formats binaires pour plus tard.

## 3. mapgen4 (Red Blob Games)
- **Licence Apache-2.0** (vérifiée), dépôt officiel `redblobgames/mapgen4`.
- **Technique** :
  - maillage dual Delaunay/Voronoi (`dual-mesh`) ;
  - élévation peinte au pinceau, puis bruit ;
  - vent → humidité → pluie, avec ombre pluviométrique ;
  - rivières par accumulation de flux, largeur selon le débit ;
  - rendu WebGL (regl), calculs dans un worker.
- **À reproduire** : le mode **carte fictive** (peindre le relief, puis exporter `.asc`, masques et shapes), le pinceau de relief en temps réel, l'humidité pour les biomes, et l'architecture worker + WebGL.

## 4. Tanin69/AgriFieldGenerator (v1.2.0)
- **Licence MIT**, © 2024 Didier ALAIN.
- **Pipeline** ✅ :
  1. spline fermée (`SplineShapeEntity` lue dans un `.layer`, conversion Hermite → Bézier) ;
  2. polygone ;
  3. points de départ (aléatoires, grille tournée, rectangles) ;
  4. Voronoi découpé selon la zone ;
  5. arêtes courbées en Bézier, en gardant les parcelles voisines jointives ;
  6. coloriage glouton BFS pour que deux voisins n'aient jamais la même texture ;
  7. bordure aléatoire entre champs.
- **Sorties** : masques PNG (4 au maximum) fusionnés avec ceux exportés du Workbench, et une `PolylineShapeEntity` par parcelle (Y = 0).
- **Limites** : pas de relief, pas de prefabs, pas de haies réelles, couleurs comparées en RVB exact.
- **À reproduire** : le module **Campagne**. On reprend son pipeline (d3-delaunay, turf), puis on ajoute la hauteur réelle, des haies et clôtures en prefabs sur les bordures, des chemins via `RG_Road_Dirt_01`, et des bosquets en lisière. Les parcelles « cultures » issues de WorldCover servent de zone de départ.

## 5. État de l'art (autres moteurs)
| Outil | Idée retenue |
|---|---|
| Unreal PCG (UE5) | Un graphe de règles appliqué à un volume : échantillonner, filtrer (pente, altitude, masque), élaguer les chevauchements, spawn |
| Unity MapMagic 2 / Gaia / Vegetation Studio | Règles de spawn par biome, génération par tuiles |
| Gaea / World Machine / Instant Terra | Érosion et masques dérivés (pente, flux, dépôts). Bohemia recommande Instant Terra |
| Arma 3 Terrain Processor | Pipeline « une forme vectorielle → une tâche » (remplir un polygone, une ligne, une clôture) |
| Reforger World Editor | **Forest / Road / River Generator natifs** pilotés par des shapes. C'est la cible d'export principale |
| Terrain Automation Tools (mod) | Lisières éclaircies (« featherer »), couloirs dégagés le long des splines |
| Watabou | Village = route, puis découpe en parcelles, puis bâtiments orientés vers la route |
| Azgaar | Biomes = température × humidité, routes entre localités |

**Briques JS/TS** (licences à revérifier) : simplex-noise, poisson-disk-sampling (MIT), d3-delaunay / Delaunator (ISC), turf (MIT), osmtogeojson (MIT), geotiff.js (MIT), proj4 (MIT), MapLibre GL (BSD-3), Three.js (MIT).

## 6. Benchmark et limites moteur (TODO)
- **Problème** : certaines maps sont lourdes et plantent. Il faut connaître les limites par plateforme : Xbox Series S, Xbox Series X, PS5, PC (nombre d'entités, densité de végétation, mémoire, taille du terrain).
- **Outils reçus de Lou** :
  - `SCR_WorldEditorToolHelper.c` : accès WorldEditorAPI et `QueryEntitiesByAABB/BySphere` ;
  - `SCR_ImageHelper.c` : export d'images PNG.
  - Avec les deux, on peut produire une **heatmap de densité d'entités** (comptage par cellule de 50 m, puis PNG).
- **À reproduire** : un compteur de budget dans l'outil, une plateforme cible à choisir, et une alerte avant l'export.

---

## 7. Synthèse : comment l'outil final reproduit chaque brique

| Brique | Inspiré de | Implémentation prévue | Sortie Reforger |
|---|---|---|---|
| Sélection de zone réelle | BARNMAP | MapLibre et projection locale (proj4, UTM), tailles 4/8/16/32 km, favoris | — |
| Relief | BARNMAP | Tuiles Terrarium / Copernicus (+ IGN LiDAR HD en France), ré-échantillonnées à 2 m, décalage vertical optionnel | `Terrain.asc` |
| Relief fictif | mapgen4 | Pinceau d'élévation, Delaunay, bruit | `Terrain.asc` |
| Cartes dérivées | Map-generator | Pente, TPI, courbure, flux, distances (worker TS) | (interne) |
| Masques de surfaces | Map-generator + BARNMAP | WorldCover + OSM + règles de biomes, budget par bloc | PNG en gris 8 bits (taille à confirmer, cf. 4033) |
| Routes | BARNMAP | OSM `highway=*` → `SplineShapeEntity` + RoadGenerator (Asphalt_E_01 / Dirt_01), Y échantillonné | `.et` + `.meta` + `.layer` |
| Forêts | BARNMAP + WE natif | Polygones WorldCover/OSM lissés → `PolylineShapeEntity` fermée **+ ForestGenerator enfant** | `.et` + `.layer` |
| Eau | BARNMAP + WE natif | OSM waterway/natural=water → polylignes + générateur rivière/lac ❓ | `.et` + `.layer` |
| Champs | AgriFieldGenerator | Voronoi découpé, coloriage, haies et chemins | masques + shapes + prefabs |
| Remplissage direct | PCG / Gaia | Poisson-disk par espèce, filtres par biome | `.layer` d'entités prefab |
| Budget | Bench Lou | Comptage par cellule, seuils par plateforme | Rapport + heatmap |

## 8. Questions ouvertes
1. Formule de la taille des masques : 4033 px pour 4 km (valeur relevée dans le Workbench d'après le manuel) ; valeurs pour 8/16/32 km ?
2. Format exact d'une `PolylineShapeEntity` avec un `ForestGeneratorEntity` enfant, et prefabs `FG_*` vanilla : à extraire des fichiers du jeu.
3. Générateur d'eau natif (River / Lake) : nom de classe et prefabs.
4. GUID : les fichiers `.et` exportés ont besoin d'un `.meta` avec un GUID unique. Le format est vérifié, il reste à confirmer que des GUID aléatoires suffisent.
5. Limites moteur par plateforme : documentation Bohemia et bench.
6. Licences et CGU des tuiles Esri / Mapterhorn / IGN pour un export.

---

## 9. Tanin69 : approfondissement (README AgriFieldGenerator + tutoriel Google Doc « Painting with masks », Workbench 1.1.0.42)
- Parmi les dépôts de Tanin69, seul **AgriFieldGenerator** concerne notre outil. Il maintient aussi un fork d'`enfusion-mcp` (MIT) et DarcMods (mods).
- **Résolution du surface mask** : elle se lit dans *Terrain Tool > Info & Diags > Surface mask > Resolution* (exemple de Tanin : 1,000795 m/px pour un terrain de 16 257 px). La config AFG demande une taille de SVG égale à la satmap et au terrain, et un `tile_size` de 512.
  - **Formule probable des 4033 px de BARNMAP** : 4033 = 64×63+1 et 16 257 = 128×127+1, soit *nb_tiles × (px_par_tile − 1) + 1* (bordure de tuile partagée). À confirmer dans Info & Diags sur notre terrain test.
- **Outil Workbench « Export geographic data »** : il exporte en **SVG** les polylignes sélectionnées (`profile/export.svg`). Le SVG n'a **pas** la taille du masque : il faut le redimensionner à la taille exacte du masque, sinon tout est décalé. → L'outil web peut **importer ce SVG** pour récupérer des zones dessinées dans le Workbench, et AFG sait aussi lire les `SplineShapeEntity` d'un `.layer`.
- **Vector Tool** : les boutons « New Polyline from selected » et « Convert to polyline area » servent à créer des zones à partir de splines existantes.
- **Pièges de l'import de masque** :
  - réimporter un masque **modifie toutes les tuiles**, avec des erreurs « trop de matériaux par tuile » sur des dizaines, voire plus de cent tuiles ;
  - en équipe, cela écrase les tuiles des collègues ;
  - avant chaque nouvel import, réimporter la texture de base (Grass03) pour effacer l'import précédent.
- **Satmap** : il faut l'exporter depuis les masques, la régénérer, puis la réimporter. Cela prend 45 min sur un terrain de 256 km² avec une GTX 1060. L'équipe de Tanin utilise **[granQ/ReforgerSatGenerator](https://github.com/granQ/ReforgerSatGenerator)** (Python, sans licence publiée), qui combine les masques exportés en une image satellite. C'est exactement la recommandation BI (satmap construite à partir des masques). → À analyser et à reproduire dans l'outil.
- **Mise à jour par tuile** : chaque tuile correspond à 8 fichiers, répartis entre `Terrain/.Data` et `Terrain/.EditorData`, et contenant le numéro de tuile. Tanin a un script qui ne copie que les tuiles modifiées, et AFG exporte `polygon_tiles.txt` (la liste des tuiles touchées). → **Notre outil devrait produire des masques limités à la zone modifiée et la liste des tuiles concernées**, pour éviter de casser le reste du terrain.
- **Backlog d'AFG** (idées à reprendre) : la satmap en fond de l'aperçu, l'affichage des tuiles Enfusion sur le polygone, et la prise en compte du relief pour placer les points.
