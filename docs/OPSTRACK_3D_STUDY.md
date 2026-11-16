# Étude — la vue 3D d'OpsTrack, et comment faire pareil dans reforger-mapper

Date : 2026-11-16. Source : page partagée `opstrack.eu/shared/ca7bc8f4…` (carte *Zimnitrita*, 16 km), chargée une fois avec Playwright (Chrome), sans connexion. Captures : `scratchpad/pw/opstrack-3d-1.png`, `-2.png`, `-3.png`.

## 1. Ce que fait OpsTrack

### Pile technique (vérifiée)
| Élément | Constat |
|---|---|
| Vue 2D | **Leaflet** + pyramide de tuiles JPEG `tiles/<map>/LODS/<z>/<x>/<y>/tile.jpg` |
| Vue 3D | **three.js r185** via **@react-three/fiber** (+ OrbitControls de drei, `enableDamping`). Chunk chargé à la demande : `import("./GameMap3D-*.js")` (~950 Ko minifié) — rien n'est payé tant qu'on reste en 2D |
| Imagerie | Générée hors-ligne avec **EnfusionMapMaker** (nickludlam) ; données terrain/scène exportées par un script Workbench (`arcl.echo.terrain.v1`) |
| Pas de | Cesium, deck.gl, Babylon, MapLibre-terrain, Draco/KTX2/meshopt |

### Comment la 3D est alimentée — 5 fichiers statiques par carte
`tiles/<map>/3d/v1/` :

| Fichier | Taille | Contenu |
|---|---|---|
| `manifest.json` | 2 Ko | schéma `opstrack.map3d.v1`, axes (x=est, y=haut, z=nord), bornes, tailles |
| `heightmap.png` | 5 Mo | **terrain-RGB** façon Mapbox : `h = -10000 + (R·65536 + G·256 + B)·0.1` m. 2048×2048, `cellSize` 8 m, lignes nord→sud, échantillons au centre des cellules |
| `basecolor.jpg` | 4,8 Mo | orthophoto drapée 5962² (bornes un peu plus larges que la carte), `anisotropy=8`, sRGB |
| `contours.png` | — | courbes 20/100 m en texture séparée (6144²), mise en **2e canal UV** (`texture.channel = 1`), activable |
| `buildings.bin` | 6 Mo | format maison `OT3B` v1 : en-tête 12 o + **7 float32 / bâtiment** (≈ x, z, y, larg., prof., haut., rotation) → 212 730 boîtes en `InstancedMesh` |
| `vegetation.bin` | 12 Mo | `OT3V` v1 : 8 o / arbre (x,z en uint16 quantifiés sur les bornes, + hauteur/échelle/type en octets) → 1,5 M instances (conifère / feuillu / buisson) |

Le décodage de la heightmap se fait dans un `OffscreenCanvas` (getImageData → `Float32Array`), puis une fonction d'échantillonnage bilinéaire (`heightAt(x,z)`) sert à poser les marqueurs/joueurs au sol. Les assets sont mis en cache (react-query, `staleTime: Infinity`).

### Rendu et overlays observés
- Plan `PlaneGeometry` déplacé par la heightmap, texture basecolor, brouillard (`FogExp2`), fond sombre, bord de carte en « socle ».
- Grille kilométrique tracée en `LineSegments` qui suit le relief ; option *Contours*.
- Arbres en `InstancedMesh` (bouton *Trees: On*), bâtiments en boîtes instanciées, *Heat* (carte de chaleur des combats en `DataTexture`).
- Trajectoires des joueurs en `CatmullRomCurve3`, étiquettes en `Sprite`.
- Contrôles : orbite clic gauche, pan clic droit, molette = zoom, boussole N.
- Rendu fluide sur une carte 16 km avec 1,7 M d'instances : la clé est **instancing + un seul maillage terrain + textures pré-cuites**.

## 2. Notre outil aujourd'hui
- Aucun rendu 3D (`three`/WebGL absents ; `maplibre-gl` 6 est déjà une dépendance mais sert au fond géographique réel).
- Données disponibles : `island.heights: number[]` + `grid {cols, rows, step, minX, minZ}` (**ligne 0 = minZ = sud**, inverse d'OpsTrack), `island.surfaces` + `island.colours` (couleur moyenne par surface), `roads`, `waters`, forêts/villages/champs du `result`, `terrainImg` (le rendu 2D du relief, déjà une image).
- Un worker de génération existe (`src/workers/gen.worker.ts`, `genClient.ts`, `pack.ts`) : réutilisable pour construire les buffers 3D hors du thread UI.

## 3. Proposition

### Bibliothèque
**three.js en direct, sans React** (on est en Vite/TS vanilla) : `"three": "0.185.0"` + `"@types/three": "0.185.0"` en versions **exactes** (même révision qu'OpsTrack, vérifier qu'elle a > 2 semaines au moment d'installer). `OrbitControls`/`MapControls` viennent de `three/examples/jsm/controls/`. Chargement par `import()` dynamique dans un module `src/view3d/` → zéro coût pour la vue 2D.
Écartés : Cesium (globe, trop lourd, inutile en coordonnées locales), deck.gl (bon pour des couches, moins pour un terrain drapé + instancing custom), Babylon (équivalent mais plus gros), MapLibre terrain (exige des tuiles DEM en web-mercator — gymnastique de projection pour un monde en mètres).

### Maillage terrain depuis `island.heights`
- Une `BufferGeometry` grille (on remplit `position.y` directement, x/z en mètres locaux, y = hauteur ; inverser l'ordre des lignes : notre ligne 0 est au sud).
- Budget : ≤ **1 M de sommets** pour un seul maillage. Pas d'échantillonnage = `max(step, taille/1024)` :
  - 8 km → 1024² (≈ 8 m), 16 km → 1024² (16 m) ou 2048² si GPU correct, 32 km → 1024² (32 m).
- **LOD v1 simple** : un maillage grossier global + régénération d'un « patch » fin (512², pas natif) autour de la cible caméra quand on zoome. LOD v2 (si besoin) : quadtree de chunks 129² avec jupes anti-fissures. Pas de LOD au démarrage : on mesure d'abord.
- Normales calculées dans le worker (différences finies), pas `computeVertexNormals` sur le thread principal.
- Exagération verticale réglable (×1 à ×3) — utile sur nos cartes souvent plates.

### Texture drapée
1. **v1 : réutiliser notre rendu 2D** — dessiner le relief + surfaces (`island.colours`) + routes/eau/champs dans un `OffscreenCanvas` 4096² (8192² si `maxTextureSize` le permet) et l'utiliser comme `CanvasTexture` (`colorSpace = SRGBColorSpace`, `anisotropy = 8`). Routes et rivières sont ainsi « peintes » gratuitement, comme OpsTrack.
2. Option satellite : la même texture depuis une capture EnfusionMapMaker / l'export carte réaliste existant.
3. Courbes de niveau en 2e texture (canal UV 1) basculable, comme OpsTrack.

### Overlays
- **Routes / rivières** : déjà dans la texture. En option, rubans 3D (`BufferGeometry` bande posée à `heightAt + 0.5 m`) pour les grandes routes seulement.
- **Eau** : plan à `seaLevel` (mer) + polygones lacs à leur niveau, matériau semi-transparent.
- **Bâtiments** : `InstancedMesh` d'une `BoxGeometry` unitaire, matrice = position/rotation/empreinte/hauteur (hauteur par type depuis `data/buildings.ts`). Un seul draw call.
- **Forêts** : `InstancedMesh` de cônes/croix basse-poly, densité plafonnée (ex. 200 k instances), bouton On/Off ; positions tirées dans le worker (poisson-disk déjà présent).
- Marqueurs / lieux : `Sprite` avec texte en canvas.

### Caméra
`MapControls` (pan gauche, orbite droit) avec damping, `maxPolarAngle` < 85°, distance min/max, cible bloquée au sol via `heightAt`. Boutons : vue de dessus, réinitialiser, boussole. Brouillard `FogExp2` pour cacher les bords à basse altitude.

### Budget performance
| Poste | Cible |
|---|---|
| Sommets terrain | ≤ 1 M (2 M max) |
| Texture | 1 × 4096² (64 Mo VRAM) — 8192² seulement si dispo |
| Draw calls | < 50 |
| Instances | bâtiments ≤ 250 k, arbres ≤ 200 k |
| Ouverture vue 3D | < 2 s sur carte 16 km |
| FPS | 60 desktop ; rendu à la demande (`render` seulement quand la caméra bouge) |

### Worker
Ajouter une op `build3d` dans `src/workers/ops.ts` : entrée = heights + grid + params ; sortie = `Float32Array` positions/normales/uv + matrices d'instances, **transférées** (`postMessage(..., [buf])`), sans copie. La texture se fait aussi dans un `OffscreenCanvas` du worker → `ImageBitmap` transférée.

## 4. Plan par petites étapes (estimation)
1. Ajouter three (version épinglée), bouton 2D/3D, module `view3d` en `import()` dynamique, scène vide + `MapControls` — **0,5 j**.
2. Maillage terrain depuis `island.heights` (rééchantillonné, ordre des lignes corrigé), couleur unie + éclairage — **0,5 j**.
3. Texture drapée = notre rendu 2D en `OffscreenCanvas` — **0,5–1 j**.
4. Passage dans le worker (op `build3d`, buffers transférés) — **0,5 j**.
5. Eau (mer + lacs) + exagération verticale + brouillard — **0,5 j**.
6. Bâtiments en `InstancedMesh` — **0,5 j**.
7. Forêts instanciées + bouton On/Off — **0,5–1 j**.
8. Courbes de niveau en 2e texture, sprites de lieux — **0,5 j**.
9. LOD « patch fin autour de la caméra » si les mesures l'exigent (32 km) — **1 j**.
10. (Option) Export d'un paquet compatible manifest façon OpsTrack (terrain-RGB PNG + bin) pour partage web — **1 j**.

Total ≈ **5–7 jours** de travail assisté ; une vue 3D utile (étapes 1–3) est atteignable en ~1,5 j.

## 5. Points à retenir
- Le « wow » d'OpsTrack vient surtout de la **texture photo** et des **1,5 M d'arbres instanciés**, pas d'un LOD sophistiqué : un seul maillage 2048² suffit à 16 km.
- Le format terrain-RGB (0,1 m de précision) est un bon format d'échange si on veut un jour exporter/partager nos cartes en 3D.
- Ne rien charger de 3D tant que l'utilisateur n'a pas cliqué sur « 3D ».

## 6. Rapprochement visuel (2026-11-16) et « à câbler »
Fait dans `src/view3d/` : palette satellite désaturée (olive / beige / gris-brun) + étalonnage vers la luminance, bruit à 4 échelles (1600 / 420 / 70 / 18 m + grain 1,7 m) ; champs procéduraux autour des hameaux sur terrain plat quand le projet n'en a pas ; canopée plus verte ; arbres densifiés en bouquets (jusqu'à ~1 M d'instances, LOD icosaèdre / cône 3 faces) ; qualité auto (40 premières images chronométrées → portées d'arbres et pixel ratio réduits sur GPU lent) ; ciel marine `#0c0f1c`, brume plus légère, soleil haut ; mer bleu marine mate ; cadrage ~41° depuis le sud.
Vue 3D de l'Atelier (monde Workbench existant) : relief décodé + carte « réaliste » (supertexture satellite) en drapé + arbres / bâtiments des `.layer`.

À câbler (barre d'outils, hors `view3d/`) :
- sélecteur **Qualité** (auto / haute / basse) qui forcerait `TREE_NEAR` / `TREE_FAR` / pixel ratio ;
- affichage du compteur d'arbres visibles et des fps dans la barre.

## Forests and walls, second pass (0.6.0)

What OpsTrack does exactly (GameMap3D chunk, `OD({vegetation})`): per tree x, z, height, radius, kind (0 conifer, 1 broadleaf, 2 bush), seed, read from the real map (prefab sizes). Geometries: open 6-sided `ConeGeometry(.5,1,6,1,true)` for conifers, `IcosahedronGeometry(.5,0)` raised 0.65 for broadleaves (height × 0.87), `OctahedronGeometry(.5,0)` for bushes; one `MeshLambertMaterial` (white, instance colours) per kind; matrix = scale (2r, h, 2r) at the ground, no rotation. Colours ID/PD/LD × (0.8 + seed/255 × 0.4). Cells of 512 m visible to 3000 m + cell radius; one `PointsMaterial` point per tree (size 9, attenuated, colour × 0.35) faded in 1200 → 2600 m. No shadows at all (`<Canvas>` without `shadows`), ambient 0.75 + one directional 1.6 at (x-8000, 9000, z+8000), R3F defaults (ACES, sRGB). Terrain `MeshStandardMaterial` roughness 1. Objects: `BoxGeometry` instanced, `#8d8578` roughness 0.9.

Our data has no real tree sizes, so `forestTrees()` (main.ts) now spaces trees ≥ 8 m on a jittered grid, thins them over the first ~25 m of the edge (lace), opens clearings from a 40 m value noise, puts bushes in edges / clearings / undergrowth, and stores a size factor; `view3d` turns it into conifer 11-26 m (r 2.4-4.5), broadleaf 7-16 m (r 2.2-4.5), bush 1-3 m. The clump densification is gone. Walls / fences (biome parcel fences, zone wall generators) and hedges (campaign) go to the view as polylines and become one thin box per segment.

Atelier (existing maps): exact boxes need each prefab's bounding box. It is not in the `.et` (the prefab only references the `.xob` model); the bbox lives in the model's `.xob` (binary, in the game `.pak`) — reading it needs the PakInspector extract plus an `.xob` header parser, or a Workbench NET API handler calling `entity.GetWorldBounds()` / `GetBounds()` per prefab and returning a table (prefab GUID → min/max). Neither exists yet; buildings in the Atelier keep their estimated footprints.
