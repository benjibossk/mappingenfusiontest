# Étude : giorbev/Map-generator (« Map Generator Pro », MGP) — mise à jour 2026-11-16

Source : API GitHub releases + clone lecture seule `C:\Users\benbo\tools\third_party\giorbev-map-generator\`
(commit du 2026-11-15). Rien n'a été exécuté, aucun binaire téléchargé.
Notes précédentes : `docs/RESEARCH.md` §2 (vue v7), `docs/ARCHITECTURE.md` (tuiles/formats, 2026-10-15),
mémoire projet (2026-10-15). **Tout ce qui suit le §1 concerne v8.x, nouveau depuis notre dernier passage.**

## 0. Ce que c'est
- Appli desktop Windows (Python + numpy/scipy/opencv, UI PyWebView, installeur `.exe`), ~19 400 lignes Python.
- Rôle : **post-production d'une carte déjà faite dans Workbench** : masques de surfaces depuis heightmap,
  satmap texturée, diagnostic des tuiles/budget QTRE, et (nouveau v8.2-8.3) **carte en jeu** : fond
  `SCR_MapEntity`, correction de l'eau des `.layer`, config des courbes de niveau.
- Il **ne génère aucun objet** : ni villages, ni routes, ni forêts posées, ni lignes électriques, ni bases,
  ni aérodromes. Il **lit** les `.layer` d'un monde existant. Pas de « seed → monde ».
- Licence : **MIT**, « Copyright (c) 2026 [otea] Giorbev — otea.fr ». Réutilisation/port libre en gardant la notice.

## 1. Chronologie des releases
| Tag | Date | Contenu clé |
|---|---|---|
| V7.0.0 → 7.0.3 | 09-02 → 09-12 | i18n FR/EN, correctifs install/catalog/.emat, Metric Atlas (déjà vu) |
| **V8.0.0 / 8.0.1** | 10-30 | Multi-projets générique (grille, préfixe tuiles, m/px, budget 5/7 **lus du projet**, plus de valeurs Zimnitrita en dur) ; **lecture seule** : n'écrit plus `.ttile/.dds/.edds` ; base vanilla 60 matériaux + 7 presets biomes ; retrait K-means |
| **V8.1.0** | 11-03 | Export/import projet `.mgp.zip` ; dossier données au choix ; **textures par projet** + « Synchroniser » (copie les `.emat` de l'addon, retrouve les middles en décodant les `.edds`) ; page **Tile Diagnostic** (budget QTRE par bloc, CSV) ; nouveau thème |
| **V8.2.0** | 11-11 | Onglet **2D MAP** (4k/8k, arbres lus des `.layer`) ; onglet **TOPO** : fond de carte en jeu « Satellite » ou « Militaire années 80 » ; onglet **EAU** : calcule l'eau « comme en jeu » et propose des formes de lacs / `Width` de rivières corrigés, écrit des `.layer` corrigés + Appliquer/Restaurer ; satmap 4096/8192 (multiple de 4) |
| **V8.3.0** | 11-13 | Style « Satellite réaliste » (arbres + ombres, routes par revêtement, toits maison/industriel) ; militaire refait : forêts 3 densités, **quais/ports**, **murs et clôtures**, **talus/berges** (rupture ≥40°, 2 m, 20 m), légende FR/EN ; **génère `MGP_MapFullscreen_courbes.conf`** ; réglages d'import Workbench documentés |

## 2. Implémentations utiles pour nous (file:line, dossier `app/`)
- **Parseur `.layer` générique avec repères imbriqués** — `layer_objets.py:73` `parse_layer` : pile de frames,
  composition parent→enfant (position locale × yaw, l.79-91), sort routes `[(type, [(x,z)…])]` et bâtiments.
  Classification par chemin de prefab : `type_route` l.39 (`/roads/asphalt|concrete|cobblestone/` sinon terre),
  `type_batiment` l.51 (sous `/structures/`, listes maisons/industriels/ignorés). Cache par signature de fichiers
  (`layer_vegetation.py:115,123`).
- **Végétation** — `layer_vegetation.py:34,49` : type d'arbre/buisson par prefab → densité de forêt (3 classes).
- **Ports / murs** — `layer_port.py:37` `genre_port` (bollard, escalier/cale, digue, mur de quai, ponton bois,
  dalle béton), l.55 `famille_mur`, l.87 `_resoudre` (résout prefab → emprise via table + cache), l.175 `emprise`
  (rectangle orienté monde). `mur_prefabs.py` (654 l.) = table des emprises des murs/clôtures vanilla.
  `quais.py:31,62` : emprises de quai, retrait de l'eau sous le quai.
- **Eau « comme en jeu »** — `eau_layers.py:184` `_lake` : niveau = min Y de la forme + décalage générateur +
  `m_fWaterSurfaceOffset` ; eau = terrain < niveau ∩ polygone (cv2.fillPoly sub-pixel). `_river` l.298 :
  hauteur de ligne + `WaterOffset` + `SplineOffsetUp`, bande `Width`. Écriture `.layer` l.494, garde-fous
  `workbench_ouvert` l.562, SHA du calque l.558/590, `appliquer`/`restaurer` l.605/624 (backup `_originaux`).
  `water_layers.py:78,197` : parse eau + masque raster.
- **Règles empiriques du générateur d'eau Enfusion** (`docs/TOPO_README.md` §1) : lac ≤ ~60 points (≥150 →
  « Too many points », lac sans eau) ; jamais de points superposés ; rivières en tronçons de largeur homogène,
  `Width` = eau + 3 m/côté, **un segment de recouvrement** entre tronçons, départ 25 m dans le lac,
  `ReverseFlow 1` si tracé amont→aval.
- **Fond de carte en jeu** — `fond_militaire.py:245` (hillshade, forêts, champs depuis poids peints, berges l.349),
  `fond_realiste.py:68` `read_topo_roads` (lit le `.topo` exporté), l.96 revêtements, l.121 catégories toits ;
  `legende.py`. Import : `Color Space=ToSRGB`, **Tiled Texture et Generate Mips décochés**, taille multiple de 4,
  ~2 m/px (8192 px pour 16 km).
- **Courbes de niveau** (TOPO_README §5) : `m_fContourDensity` 5/10/20/50 m, majeures 25/50/100/250 m,
  `m_fContourWidth` 1.3 / majeure 2.6, `m_CoastalColor` alpha 0 ; brancher sur `SCR_MapConfigComponent` **du
  GameMode** (`m_sGadgetMapConfigPath`), pas sur `SCR_MapEntity`. Sans GameMode la carte ne s'ouvre pas.
- **Terrain** (déjà connu) : `terrain_algorithms.py`, `pipeline_v5.py` (`ROUGHNESS_SEED = 42` l.64, seed global),
  `clean_weights.py` (budget 5/7 par bloc). `terrain_terr_reader.py`, `project_reader.py` : lecture du `.terr`
  et du texte « General Info » de Workbench pour la grille.
- **Seeds** : seulement des graines fixes locales (`map2d.py:193` `default_rng(seed)` « même carte à chaque
  génération ») ; aucun concept de monde procédural.
- **Partage de projet** — `project_archive.py` (333 l.) : zip réglages + entrées (+ résultats en option), repointage
  des dossiers absents.

## 3. Top 10 à emprunter / apprendre
1. **Contraintes eau Enfusion** (≤60 pts/lac, pas de points dupliqués, tronçons + recouvrement, `Width`=eau+6 m,
   entrée 25 m dans le lac, `ReverseFlow`) → à imposer dans notre export eau/rivières et notre validateur.
2. **Calcul « eau comme en jeu »** (`eau_layers.py:184/298`) → aperçu fidèle dans notre UI avant envoi.
3. **Génération d'un fond `SCR_MapEntity` + config courbes** → notre générateur « une seed → monde » peut sortir
   aussi la carte en jeu (on connaît déjà routes/villages/champs : rendu plus simple que le leur qui relit).
4. **Réglages d'import texture carte** (ToSRGB, pas Tiled, pas Mips, multiple de 4) → à appliquer par nos plugins MG_.
5. **Parseur `.layer` à repères imbriqués** (`layer_objets.py:73`) → import retour Workbench→mapper (round-trip).
6. **Classification par chemin de prefab** (routes par revêtement, maisons vs industriel, port) → base de nos
   catalogues villages/zones industrielles/port.
7. **Typologie de port** (`layer_port.py:37`) : quai béton, cale, escalier, bollards, ponton, digue → checklist
   pour notre générateur de port de village.
8. **Écriture sûre de fichiers mod** : refus si Workbench ouvert, SHA du fichier, backup + Restaurer.
9. **Grille lue depuis « General Info »** de Workbench + budget 5/7 par projet → éviter toute valeur en dur.
10. **Détection des talus** (rupture ≥40°, ≥2 m, ≥20 m) → éviter d'y poser lots/routes ; candidate pour murs de
    soutènement auto en zone portuaire/urbaine.

## 4. Mieux / moins bien que nous
**Mieux** : connaissance fine des formats et pièges Workbench (eau, map, textures, `.edds`, QTRE) ; outils de
diagnostic et de correction d'une carte existante ; carte en jeu clé en main ; documentation de méthode validée en jeu.
**Moins bien** : aucune génération (villages, routes, réseau, champs, électricité, militaire, aérodromes) ;
appli desktop Windows mono-utilisateur (pas de collab, pas web) ; pas de pont live vers Workbench (fichiers
uniquement) ; seeds fixes locales, pas de reproductibilité monde ; gros fichiers monolithiques (`main.py` 3 021 l.).
**Complémentarité** : MGP = aval (finition/carte/diagnostic) ; reforger-mapper = amont (création). Pas concurrent.
