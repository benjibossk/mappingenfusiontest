# Étude Maps4FS (générateur de cartes Farming Simulator 22/25)

_Étude du 2026-11-16. Lecture seule, aucun code exécuté._

## 0. Source et disponibilité : à lire en premier
- **`github.com/iwatkot/maps4fs` répond 404** (repo supprimé ou rendu privé), et **`pypi.org/project/maps4fs` aussi**. Software Heritage n'en a pas d'archive. Les autres repos de l'auteur (cutwright, FS25_*) existent toujours.
- Étude faite sur un **fork miroir `ZenJakey/maps4fs`** (dernier commit 9 janv. 2025, environ v1.5), cloné en `C:\Users\benbo\tools\third_party\maps4fs\`. Le projet amont a beaucoup évolué depuis (UI Next.js `maps4fsui`, API `maps4fsapi`, données `maps4fsdata`, site `maps4fs.xyz`). Les numéros de ligne ci-dessous renvoient à ce snapshot.

## 1. Licence
- Snapshot de janvier 2025 : **Apache-2.0** (`LICENSE.md`). Il est permissif : on peut porter ou adapter le code avec attribution et une mention NOTICE/des changements.
- Les versions plus récentes et les repos satellites sont passés en **AGPL-3.0** (le fork `killemth/maps4fsdata` est déclaré AGPL-3.0, et `maps4fsui`/`maps4fsapi` sont NOASSERTION). **Ne rien copier de post-2025.** Une réimplémentation des *idées* est toujours possible, car les algorithmes ne sont pas protégés.
- Recommandation : **réécrire en TS** (de toute façon on ne garde pas une ligne de Python) et citer « inspiré de Maps4FS (Apache-2.0, iwatkot) » dans `docs/INSPIRATIONS.md`. Le risque est alors nul.

## 2. Architecture (`maps4fs/generator/`)
Un pipeline de `Component`s (`component.py`, 551 l.) orchestrés par `map.py`. Chaque composant a `preprocess / process / previews / info_sequence`, et ils échangent des **info layers JSON** (polylignes de routes, polygones de champs) : c'est le couplage clé.
| Composant | Fichier | Rôle |
|---|---|---|
| DTM providers | `dtm/dtm.py`, `srtm.py`, `usgs.py` | Abstraction des sources DEM (SRTM 30 m, USGS 1 m, plus tard IGN, etc.) |
| DEM | `dem.py` (297) | Crop, resize, multiplier, flou, plateau, export PNG 16 bits |
| Texture | `texture.py` (842) | OSM vers masques de poids par couche selon un **schéma JSON** |
| GRLE | `grle.py` (467) | InfoLayers FS : farmlands, plantes/herbe |
| Background | `background.py` (623) | DEM élargi autour de la carte, mesh OBJ (trimesh), profondeur d'eau, plans d'eau |
| I3D | `i3d.py` (618) | Écrit dans la scène FS : splines de routes, champs, arbres |
| Satellite | `satellite.py` (92) | Tuiles satellite (pygmdl, zoom réglable) pour l'overview et le fond |
| QGIS | `qgis.py` (196) | Génère des scripts PyQGIS (bbox, points) pour l'édition manuelle |
| Settings | `settings.py` (187) | Modèles Pydantic : DEM/Background/GRLE/I3D/Texture/Spline/Satellite |
| Toolbox | `toolbox/dem.py`, `background.py` | Outils isolés (extraction de tuiles DEM, etc.) |

## 3. UI/UX
- Snapshot : **Streamlit** (`webui/webui.py`, `generator.py` 705 l.), avec un mode **Docker** (`iwatkot/maps4fs`, port 8501), un hébergement public et une **file d'attente** (`webui/queuing.py`). Les versions ultérieures sont passées à Next.js et à une API séparée.
- Choix lat/lon, taille (2/4/8/16 km), rotation, provider DEM, puis des **expanders de settings avancés** générés automatiquement depuis les modèles Pydantic (`SettingsModel.all_settings()`, `settings.py:30-80`). C'est une bonne idée pour nous : un seul schéma produit à la fois l'UI, la sauvegarde et le preset.
- **OSM custom** : upload d'un `.osm` édité dans JOSM à la place d'Overpass (`webui/osmp.py`).
- **Schema editor** : éditeur JSON du texture schema et du tree schema dans l'UI, plus des templates (`webui/templates.py`).
- **Previews** de chaque étape (masques colorés, DEM colorisé, STL 3D), puis un zip téléchargeable.
- Outils annexes : sélecteur d'arbres visuel (`webui/tools/trees.py`), viewer de textures.

## 4. Algorithmes à retenir (références au snapshot)
### 4.1 Schéma de correspondance OSM vers couches (`data/fs25-texture-schema.json`, `texture.py:33-120, 409-510`)
Chaque entrée : `{name, count, tags:{clé: valeur | [valeurs] | true}, width (m, pour les lignes), color (preview), priority, info_layer, usage, background, invisible, exclude_weight, procedural}`. Exemples :
- `asphaltDusty` ← `highway ∈ {motorway, trunk, primary}`, width 8, `info_layer: roads`
- `gravelSmall` ← `secondary/tertiary/road/service`, width 4 ; `mudLight` ← `unclassified/residential/track`, width 2
- `mudDark` ← `landuse ∈ {farmland, meadow}`, `info_layer: fields`, `usage: field`
- `grassDirtPatchy` ← `natural ∈ {wood, tree_row}` + `landuse=forest`, `usage: forest`
- `mudPebblesLight` ← `waterway ∈ {ditch, drain}`, `usage: drain`, pouvant être sautée (`skip_drains`)

**Priorité** : `layers_by_priority()` (`texture.py:409`) dessine d'abord les couches sans priorité, puis par priorité décroissante. Chaque couche plus prioritaire **efface** les pixels qu'elle couvre dans le masque cumulé, et `priority 0` = couche de base qui remplit le reste (`draw_base_layer`, l.561). Les lignes sont bufferisées à `width` (`_to_polygon`, l.621).
**Dissolve** (`texture.py:512-560`) : les pixels d'une couche sont répartis aléatoirement entre `count` sous-textures (variantes), ce qui casse l'aspect uniforme.

### 4.2 DEM (`dem.py`, `settings.py:84-99`)
- `to_ground` (l.119) : décale le min à 0 (pas de valeurs négatives).
- `multiplier` (l.184) : exagération verticale entière.
- Flou gaussien `blur_radius` (35 par défaut, forcé impair, sigma 40) : `dem.py:47-53, 217`. Il supprime les marches des DEM 30 m.
- `plateau` (l.234) : ajoute une constante, ce qui permet de creuser sans valeurs négatives.
- `water_depth` (`background.py:570-590`) : masque d'eau **érodé d'1 px** (`cv2.erode` 3×3), puis on soustrait la profondeur au DEM. C'est simple et efficace pour des lits de rivière/lacs.
- Height scale auto (`SharedSettings.height_scale_*`) : l'échelle verticale du moteur est calculée d'après le min/max réel.

### 4.3 Champs / farmlands (`grle.py:138-275`, `GRLESettings.farmland_margin`)
Les polygones `info_layer: fields` (+ farmyards optionnels) sont rastérisés en InfoLayer farmlands avec un ID par champ, et `farmland_margin` les dilate ou rétrécit. `i3d.py:282-390` crée un nœud par champ avec indicateur de nom et point de téléport. Herbe : `_add_plants` / `create_island_of_plants` (l.349) sème des îlots arrondis (`get_rounded_polygon`).

### 4.4 Routes et splines (`i3d.py:131-280`)
Polylignes de routes issues de l'info layer textures, avec un **Z échantillonné sur le DEM non redimensionné** (`not_resized_dem`), écrites comme splines NURBS dans `splines.i3d`. Les versions ultérieures ajoutent des routes en mesh, ce qui est hors snapshot.

### 4.5 Terrain de fond (`background.py:115-370`)
On télécharge un DEM **plus grand** que la carte, puis `cutout` donne le centre jouable et `plane_from_np` construit un mesh trimesh du pourtour, avec `resize_factor` (8 par défaut), `remove_center` (trou au milieu), **décimation** (`decimation_percent`, `agression`) et option `generate_water` (mesh des plans d'eau). Export OBJ/STL.

### 4.6 Arbres (`i3d.py:480-620`, `data/fs25-tree-schema.json`)
Sur le masque `usage: forest`, `non_empty_pixels(image, step=density)` (l.602) parcourt une grille de pas `density`, puis `randomize_coordinates` (l.579) ajoute un jitter de ±20 % du pas. L'espèce est tirée au hasard dans le tree schema (`{name, reference_id}`), avec une rotation aléatoire.

### 4.7 Satellite (`satellite.py`)
Tuiles via `pygmdl` à zoom réglable, une image pour l'overview et une pour le fond (avec marge).

## 5. Problèmes connus (tracker GitHub inaccessible, synthèse issue du code et de la doc)
- Le DEM SRTM 30 m donne des terrasses : d'où le flou fort par défaut, mais ce flou **arase les petits reliefs et berges**.
- Le multiplier entier est trop grossier, et un height scale mal réglé donne un relief écrasé ou des pics.
- Les données OSM sont incomplètes ou tagguées différemment selon les pays (champs en `landuse=meadow` vs `farmland`, forêts en relation multipolygone). D'où l'upload d'OSM custom.
- Routes : des splines « en marches » sur un DEM non lissé, des croisements mal raccordés, des routes qui coupent le relief (pas d'aplanissement du terrain sous la route dans le snapshot).
- Background : les meshes sont lourds, d'où la décimation obligatoire et une génération lente en 16 km.
- Le dissolve pixel par pixel en Python est très lent sur les grosses cartes.
- Rotation de carte : décalages entre couches si une étape oublie la rotation.
- Instabilité de l'hébergement public (file d'attente, timeouts), d'où la recommandation Docker local.

## 6. Comparaison avec reforger-mapper
| Sujet | Maps4FS | Nous |
|---|---|---|
| OSM | Schéma JSON data-driven, priorités, upload `.osm` | Overpass + règles **codées en dur** (`modules/osm.ts:43-54, 220-240`, tables `ROAD`/`RIVER_WIDTH`) |
| DEM | SRTM/USGS + flou/plateau/multiplier/water_depth | IGN/Terrarium/Copernicus, TIFF/ASC/HGT/PNG16, mosaïque, `fillNoData` (`dem.ts`). **Pas de flou paramétrable ni de creusement d'eau** (à vérifier dans `terrain.ts`) |
| Couverture | Textures depuis l'OSM uniquement | ESA WorldCover (`cover.ts`), c'est notre avance |
| Adaptation jeu | Aucune | `adapt.ts` (lissage, suppression des petits bois), c'est notre avance |
| Fond hors zone | Mesh décimé | Absent |
| Arbres | Grille + jitter + schéma d'espèces | (selon `realWorld.ts`) |
| Sortie | Fichiers FS | Envoi direct au Workbench (`bridge.ts`), c'est notre avance |

## 7. Top 10 à emprunter (tous en réimplémentation TS, sans copie de code)
1. **Schéma JSON tag → couche Enfusion** (tags, width, priority, usage, couleur de preview) qui remplace les tables codées en dur d'`osm.ts`. Il serait éditable dans l'UI et partageable en preset.
2. **Peinture par priorité avec couche de base** (le plus prioritaire efface les autres, `priority 0` remplit le reste). Il n'y a plus de chevauchement de masques.
3. **Creusement de l'eau** : masque eau érodé d'1 px puis `−water_depth` sur la heightmap.
4. **Flou gaussien paramétrable + plateau + multiplier flottant** dans les options DEM (avec un défaut adapté à la source : faible pour IGN 1-5 m, fort pour Copernicus 30 m).
5. **Upload d'un `.osm`/`.geojson` custom** à la place d'Overpass (corrections JOSM, zones mal tagguées).
6. **Settings générés depuis un schéma unique** (UI + sauvegarde + presets), comme `SettingsModel`.
7. **Arbres** : grille `density` + jitter ±20 % + tirage d'espèce pondéré par schéma, à étendre avec WorldCover.
8. **Z des splines de route échantillonné sur le DEM brut** (non redimensionné) avant export vers le Workbench.
9. **Terrain de fond** hors zone jouable : DEM élargi basse résolution + centre retiré + décimation, en mesh ou en terrain secondaire Enfusion.
10. **Dissolve / variantes** : répartir une surface sur N matériaux de sol (à faire par bruit plutôt qu'en pixels aléatoires : plus beau et plus rapide), plus des **previews par étape** et un **export de scripts QGIS** pour l'édition manuelle.

**Licence** : avec une réimplémentation et une citation, il n'y a aucune contrainte. Si un jour on copie du code, ne le prendre **que dans le snapshot Apache-2.0** (NOTICE + attribution) et jamais dans les versions AGPL (contamination de toute l'app web servie).
