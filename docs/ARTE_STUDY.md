# Étude du plugin ARTE (QGIS) — algorithmes portables vers reforger-mapper

Source : `ARTE-QGIS-plugin.zip` (release latest, v1.2.0), extrait dans
`C:\Users\benbo\tools\third_party\ARTE\src\ARTE\`. Code **lu uniquement, jamais exécuté**.
Fichiers : `01_engineer.py` (787 l., terrain engineering), `arte.py` (2480 l., export + paramètres Enfusion),
`03_3DView.py` (2734 l., viewer 3D + comparaison/diff).

## Licence

`LICENSE` : **MIT License — `Copyright (c) 2026 Icebird`**.
Obligations : si on copie/traduit du code (un port ligne à ligne en TS compte comme œuvre dérivée),
inclure la notice de copyright + le texte de permission MIT dans nos sources
(ex. en-tête du fichier TS porté + `THIRD_PARTY_LICENSES`/README). Aucune autre contrainte
(usage commercial, modification, redistribution libres ; pas de garantie). Réimplémenter une *idée*
(ex. « lissage cosinus ») sans copier n'oblige à rien, mais créditer reste correct.

---

## 1. Largeur des routes/rails/rivières depuis les tags OSM
`01_engineer.py:189-261`

```
surface = tags.surface ?? défaut par classe :
  motorway..tertiary,residential -> asphalt ; unclassified,service,living_street -> paved
  track: tracktype grade1 -> paved, grade2/3 -> gravel, sinon dirt ; autre -> unpaved
inferred = table par classe (m) :
  motorway(_link) 14.5 | trunk 11.5 | primary 9.5 | secondary 7.5 | tertiary 6.5
  residential/unclassified 5.5 | service/living_street 4.0
  track: asphalt/paved/concrete 4.5, gravel 3.5, sinon 3.0 | autre 2.5
  railway: tracks=2 ou main/trunk -> 8.0, sinon 4.5
  waterway: river 12 | canal 6.5 | stream 2.5 | autre 1.5
width = premier nombre de tags.width (regex)                       // priorité 1
     ?? lanes * (3.65 si motorway/trunk/primary sinon 3.15)        // priorité 2
     ?? inferred                                                    // priorité 3
```
Note : `width` sert ensuite de **distance de buffer** (rayon) × multiplicateur (`:349`), donc la bande
aplanie fait ~2× la largeur réelle — volontaire (« sur-élargir pour compenser l'outil smooth d'Enfusion »,
tooltip `:734`). Multiplicateur UI 0.5–1.5, défaut 1.15 (`:720-733`).
Buffer minimal : un second buffer garantit ≥ `1.5 × pixel_size` (`:359-367`).

**Port TS** : fonction pure `osmWidth(tags): number` à côté de `osm.ts`, utilisée à la place du simple
`parseFloat(t.width)` (`osm.ts:220`). Ajouter le parsing `lanes` et `tracktype`.

## 2. Exclusion ponts/tunnels
`01_engineer.py:432-440` : filtre `bridge NOT IN (yes,true,1)` et `tunnel NOT IN (...)` sur **toutes**
les couches (routes, rails, eau). Les ways ponts/tunnels ne sont ni aplanies ni creusées.
Catégories : heavy = motorway/trunk/primary(+_link) ; medium = secondary/tertiary(+_link)/residential/
unclassified ; light = track/path/footway/bridleway/cycleway/living_street/service ; rails = railway≠null.

**Port TS** : `const isStructure = (t) => ['yes','true','1'].includes(t.bridge) || [...].includes(t.tunnel)`.
Mieux qu'ARTE : `bridge=viaduct` / `tunnel=culvert` existent aussi — traiter toute valeur ≠ `no`
comme structure (sauf `culvert` pour l'eau : un ruisseau en buse ne doit pas être creusé, mais la route
au-dessus doit l'être).

## 3. Aplanissement routes/rails (« flat ribbon »)
`01_engineer.py:518-551`. Deux masques raster par catégorie : `center` (ligne rasterisée, `-at`) et
`buffer` (polygone bufferisé). Pseudo-code :
```
base   = gauss(z, max(0.75, σ/2))
idx    = indice du pixel de centre le plus proche (distance_transform_edt(~center))
ribbon = base[idx]                      // chaque pixel prend la hauteur du centre le plus proche
ribbon = gauss(ribbon, max(1.5, 1.2σ))  // profil long lissé
din    = EDT(buffer) * pixel            // distance au BORD du buffer, vers l'intérieur
f      = clamp(din / max(din), 0, 1)
f      = 0.5 - 0.5 cos(π f)             // rampe cosinus (talus)
f      = gauss(f, 1)
z'     = buffer ? ribbon*f + z*(1-f) : z
```
Ordre : light (σ=1), medium (2.5), heavy (4), rails (3.5) — les plus gros écrasent (`:548-551`).
`falloff_dist` est passé mais **inutilisé**. Limite : `max(din)` est global sur tout le masque → la rampe
dépend de la route la plus large de la catégorie (les petites routes ne sont jamais à f=1).

**Port TS** : nécessite un EDT avec indices (Felzenszwalb-Huttenlocher 1D en 2 passes, O(n), ~60 lignes)
et un flou gaussien séparable sur Float32Array. Notre `carveRoads` (vectoriel, distance au segment)
est déjà plus précis : garder notre approche, lui emprunter seulement (a) la rampe **cosinus** à la place
du smoothstep (équivalent proche), (b) le lissage du profil (on fait déjà moyenne glissante 80 m).

## 4. Anti-submersion des routes
`01_engineer.py:633-646`, après le creusement des rivières :
```
road_mask = union des buffers routes+rails
z[road_mask] = max(z, water_target + 0.05)
```
**Port TS** : trivial une fois `water_target` disponible. Nous avons seulement `max(0.8, …)` vs la mer
(`roads.ts:140`) — pas de protection vs rivières/lacs.

## 5. Masque eau (fusion lignes + polygones)
`01_engineer.py:267-268, 439-482` : polygone eau = way fermé ET (`natural=water` | `water=*` |
`waterway=riverbank|dock`). Lignes eau bufferisées à `12 × mult` ; polygones bufferisés à
`max(2, 0.6·pixel)` puis nettoyés :
```
m = gauss(m, 1.2) > 0.5 ; fill_holes ; opening 3×3 ; closing 3×3
water_c = lines_c ∪ polys_c ; water_b = lines_b ∪ polys_b
```
Remarque : les **relations** multipolygones ne sont pas traitées (seulement des ways) — notre `osm.ts`
fait mieux (relations + rings). Le buffer eau ignore `arte_dyn_width` ? Non : `create_buffer` l'utilise si
> 0, la constante 12 n'est que le défaut.

**Port TS** : rasteriser nos polygones (scanline) et lignes (épaisses) dans un `Uint8Array`, puis
morpho 3×3 (érosion/dilatation = 4 boucles), fill_holes = flood-fill depuis les bords.

## 6. Creusement de rivière (« geomorph », berges en S)
`01_engineer.py:559-627` :
```
stable = gauss(z_orig, 1)
meder  = gauss(z[nearest center pixel], 2)          // altitude du lit le long de l'axe
local  = gauss(stable, 3)
extent = (local - meder) < 1.5  -> gauss2 >0.55 -> gauss1 >0.5   // plaine inondable
wn     = gauss(clamp(EDT(~extent)*px / (BUFF_WATER/2), 0, 1), 1)
target = gauss(meder, 4) - 0.7                       // surface eau - 0.7 m
target = max(target, stable - 0.7)
target = min(target, local + (1 - wn)*0.35)
target = min(target, local + 0.15)
target -= gauss(∂meder/∂y, 1) * 0.12                 // biais "écoulement" (axe Y seulement !)
target = gauss(target, 0.8)
f      = cosRamp(clamp(EDT(water_b)*px / (BUFF_WATER/2), 0, 1)) ; gauss 0.8
z'     = water_b ? target*f + z*(1-f) : z
```
Le « S-curve » = la rampe `0.5-0.5cos(πt)` du bord vers l'intérieur. Profondeur effective ≤ ~0.7 m
sous le terrain local : lits peu profonds, pas de pente monotone aval garantie (le terme gradient
n'utilise que `gy`, c'est un artefact). 

**Port TS** : faisable vectoriellement comme `carveRoads` : pour chaque rivière, profil d'axe lissé
+ **forcer la monotonie descendante** (cummin dans le sens d'écoulement — amélioration sur ARTE),
profondeur `d = clamp(0.7 + 0.05·width, 0.7, 3)`, profil transversal cosinus jusqu'à `width/2 + berge`.

## 7. Remplissage NoData
`01_engineer.py:489-513` et `arte.py:2045-2063` : NoData = valeur NoData déclarée **ou < -10000** ;
remplacé par le **plus proche voisin valide** (`NearestNDInterpolator`) ; restauré après traitement
(`:654-655`). Puis `gauss(σ=0.5)` global anti-marches (`arte.py:2070`).

**Port TS** : notre `dem.ts:226,273` détecte déjà NoData (même seuil -1e4) mais renvoie NaN/ignore.
Remplissage : EDT avec indices sur le masque valide (même outil qu'en §3) → `z[k] = z[idx[k]]`.
Alternative plus douce : interpolation pyramidale (push-pull) ; ~40 lignes.

## 8. Alignement DEM / géoréférencement
- Zone choisie en EPSG:3857 ; taille mètres réels corrigée `× 1/cos(lat)` (`arte.py:237, 1770-1784`)
  pour compenser l'étirement Mercator.
- Terrarium XYZ : zoom `z = ceil(log2(2π·6378137 / (256·mpp_cible)))` borné 0..15 (`arte.py` ~1836-1840),
  mosaïque, crop sub-tuile, décodage `R·256 + G + B/256 − 32768` (mapbox : `−10000 + (R·65536+G·256+B)·0.1`).
- Tout est ensuite `gdal.Warp(width=res, height=res, outputBounds=bbox, Lanczos)` (`arte.py:1666, ~1930, ~2019-2031`).
- Comparaison deux DEMs (`03_3DView.py:2080-2140`) : offset Z = médiane(hm2−hm1) ; décalage XY
  global par moindres carrés sur gradient `shift = mean(g·Δ)/mean(|g|²)` borné ±1 px ; puis warp local
  par flux de gradient lissé σ=6.

**Port TS** : le décalage sub-pixel (Lucas-Kanade 1 itération) est ~20 lignes, utile pour recaler un DEM
IGN sur Terrarium. Le rééchantillonnage : bilinéaire suffit (Lanczos optionnel).

## 9. Paramètres d'import Enfusion
`arte.py:104-117, 1093-1123, 2081-2097, 2195-2200` :
```
résolution valide : puissance de 2  ((v & (v-1)) == 0)      // UI, 4096 par défaut
chunks       = res / 512 (tuile fixe 512)                    // grille affichée chunks_x × chunks_y
taille chunk = (size_m / res) * 512
cellSize     = size_m / (res - 1)                            // faces = res-1
heightScale  = (max - min) / 65535      ; offset = min       // normalisé exact
   fallback si plat : pick_clean_height_scale (échelle 0.03125..1, 10 % sous zéro)
PNG16        = clip((z - min) / heightScale, 0, 65535)
```
**Port TS** : fonctions pures, copier telles quelles (`enfusionParams(size, res, min, max)`).
Attention : ARTE mélange `res` (puissance de 2) et `res-1` faces ; vérifier contre notre convention
Enfusion (vertices = 2ⁿ+1 ?) avant d'adopter.

## 10. Carte de différence
`01_engineer.py:666-678` : `diff = z_final − z_orig` écrit en GeoTIFF Float32. Viewer : colormap
divergente. **Port TS** : garder une copie `Float32Array` avant carve, afficher `diff` en canvas
(bleu = creusé, rouge = remblai), stats min/max/pixels modifiés. Très utile pour déboguer `carveRoads`.

---

## Ce que reforger-mapper fait déjà vs lacunes

| Sujet | Nous (`roads.ts`/`osm.ts`) | Lacune |
|---|---|---|
| Largeur | `width` OSM seul (2–30 m) sinon défaut du style (`osm.ts:220`, `roads.ts:61`) | `lanes`, `surface`/`tracktype`, table par classe ARTE |
| Ponts/tunnels | non filtrés (grep : aucun `bridge`/`tunnel` OSM) | exclure du carve |
| Aplanissement | vectoriel, distance au segment, profil lissé 80 m, smoothstep, poids max (`roads.ts:117-166`) — mieux qu'ARTE | multiplicateur global, rampe cosinus optionnelle |
| Sous l'eau | plancher 0.8 m (mer) seulement | protection vs rivières/lacs |
| Rivières | parsées avec largeur (`osm.ts:222-224`) | pas de creusement du lit |
| NoData | détecté (`dem.ts:226`) | pas de remplissage plus proche voisin |
| Params Enfusion | — (non vérifié ici) | cellSize/heightScale/chunks |
| Diff map | absente | à ajouter |
