# Comparaison Map Generator Pro (giorbev) ↔ Reforger Mapper, et proposition « Mode Atelier »

*2026-11-16. Sources : `docs/GIORBEV_STUDY.md`, clone lecture seule `C:\Users\benbo\tools\third_party\giorbev-map-generator\`
(à jour, rien d'exécuté, aucun binaire), `gh release list/view` (V7.0.0 → V8.3.0), README/README_EN/TOPO_README,
et chez nous README, CHANGELOG (0.5.0), `src/modules/*`. Les releases publiées commencent à V7 ; V1-V6 ne sont
connues que par le README/CONCEPTION (masques, biomes, QTRE, satmap V2, K-means).*

Légende : ✅ on l'a · 🟡 partiel · ❌ absent · ⭐ on fait mieux.

---

## 1. Qui il vise et son workflow

**Cible** : un mappeur qui a **déjà sculpté sa carte dans Workbench** (cas d'origine : Zimnitrita, 32×32 tuiles) et
qui veut la **finir et la diagnostiquer** sans peindre des milliers de blocs à la main. Appli desktop Windows
(Python + PyWebView, installeur `.exe`), mono-utilisateur, **hors ligne, sur les fichiers du projet**.
Règle d'or de son README : « le terrain est finalisé dans Workbench, MGP vient après ».

Workflow A→Z (README + TOPO_README) :
1. **Workbench** : sculpter, exporter la heightmap `.asc`, copier le texte « General Info » (grille, préfixe tuiles, m/px).
2. **Projet MGP** : créer un projet, importer heightmap, *parser* General Info, analyse terrain (pente, TPI, courbure, flux, distance côte).
3. **Matériaux** : preset biome (7 presets, base vanilla 60 matériaux) ou textures du projet (« Synchroniser » copie les `.emat` de l'addon, décode les `.edds` pour retrouver les middles).
4. **Masques** : 13 masques par soustraction ordonnée, aperçu, itération.
5. **Contrôle qualité** : budget **QTRE 5/7 textures par bloc** (lu du projet), page **Tile Diagnostic** (budget par bloc, slots négligeables, recherche de texture, inspection `.ttile`, export CSV).
6. **Export** : PNG 16 bits par masque, **satmap** texturée 4096/8192 (multiple de 4).
7. **Carte en jeu (V8.2-8.3)** :
   - **EAU** : recalcule l'eau « comme en jeu » à partir des `.layer` (niveau lac = min Y + décalages ; rivière = spline + `Width`), propose des formes corrigées (≤ 60 points, pas de doublons, tronçons + recouvrement, `ReverseFlow`), **réécrit les `.layer`** avec Appliquer/Restaurer ;
   - **2D MAP** 4k/8k (arbres lus des `.layer`) ;
   - **TOPO / fond `SCR_MapEntity`** : styles « Militaire années 80 » (forêts 3 densités, **quais/ports**, **murs/clôtures**, **talus/berges** ≥ 40°/2 m/20 m, légende FR/EN) et « Satellite réaliste » (arbres + ombres, routes par revêtement lues du `.topo`, toits maison/industriel) ;
   - **courbes de niveau** : génère `MGP_MapFullscreen_courbes.conf` (densité, majeures, largeurs, `m_CoastalColor` alpha 0), à brancher sur le `SCR_MapConfigComponent` du GameMode ;
   - réglages d'import Workbench documentés (ToSRGB, pas Tiled, pas Mips).
8. **Partage** : export/import projet **`.mgp.zip`** (réglages + entrées ± résultats, repointage des dossiers).

**Sécurité fichiers** (très soignée, à reprendre telle quelle) : depuis V8.0 **lecture seule** sur `.ttile/.dds/.edds` ;
pour les `.layer` : **refus si Workbench est ouvert**, **SHA du fichier** vérifié avant écriture, **sauvegarde dans
`_originaux`** + bouton **Restaurer**. Aucune valeur de projet en dur (grille et budget lus du projet).

---

## 2. Tableau complet

| Release | Fonction MGP | Nous | Détail / où on est meilleur |
|---|---|---|---|
| V1-V6 | Analyse heightmap (pente, aspect, TPI multi-rayon, courbure ZT, flux, distance côte) | 🟡 | On calcule pente/flux (`hydro.ts`, `network.ts`) pour l'eau et les routes, pas TPI/courbure pour les surfaces |
| V1-V6 | 13 masques par soustraction ordonnée | 🟡 | `computeSurfaces` + `cover.ts` : surfaces depuis relief, OSM/WorldCover et zones dessinées ; règles moins riches que ses rampes/cloches |
| V1-V6 | Presets biomes JSON (7) | 🟡 | Atelier A2 : 4 presets portés (MIT), présence des textures vérifiée ; pas d'application des masques |
| V1-V6 | Auto-calibration des paramètres | ❌ | Non porté : dépend de son pipeline de masques numpy |
| V1-V6 | Budget QTRE 5/7 par bloc | ✅ | `limitPerBlock` (`island.ts`) ; mais pas de **visualisation par bloc** |
| V1-V6 | Satmap V2 texturée depuis `.edds` | ❌ | Décodeur `.edds` non écrit ; le style « réaliste » A4 utilise des couleurs plates |
| V1-V6 → retiré V8 | K-means satmap → masques | ✅⭐ | `satmask.ts` (Lab, flou, médiane, régions mini) — lui l'a retiré |
| V1-V6 | Écriture binaire `.ttile` (LRS2) | ❌ | Volontairement non (il l'a lui-même abandonnée en V8) ; nous envoyons les masques via le pont (`POST /masks`) |
| V7.0 | i18n FR/EN | ✅⭐ | FR/EN + % traduit + export/import d'un fichier langue |
| V7.0 | Metric Atlas | ❌ | Non porté (outil d'analyse annexe, priorité basse) |
| V8.0 | Multi-projets générique (grille, préfixe, m/px, budget lus du projet) | ✅ | Atelier A0 : `.terr` (HEAD), `.ttile`, `.layer`, `.gproj` lus sur disque, Workbench fermé |
| V8.0 | Base vanilla 60 matériaux | 🟡 | Matériaux lus du monde importé, couleurs devinées par nom |
| V8.0 | Lecture seule des fichiers terrain | ✅ | On n'écrit jamais de fichier terrain : tout passe par l'API Workbench |
| V8.1 | Export/import projet `.mgp.zip` | ✅⭐ | Fichier projet + salons collaboratifs (curseurs, historique, commentaires) |
| V8.1 | Textures par projet + « Synchroniser » (`.emat`, décodage `.edds`) | 🟡 | Atelier : `.emat` comptés, matériaux du `.terr` listés ; pas de décodage `.edds` |
| V8.1 | Tile Diagnostic (QTRE par bloc, slots négligeables, CSV, inspection `.ttile`) | ✅ | Atelier A1 (`diag.ts`, `ttile.ts`, index LRS2 linéaire, juste aussi hors puissances de 2) ; **slots négligeables manquants** (poids peints = décodeur `.edds`) |
| V8.2 | 2D MAP 4k/8k | ✅ | Atelier A4 : PNG 2k/4k/8k |
| V8.2 | Fond de carte en jeu `SCR_MapEntity` (satellite / militaire) | ✅ | Atelier A4 + consignes d'import ; branchement sur `SCR_MapEntity` manuel |
| V8.2 | Eau « comme en jeu » + correction + réécriture `.layer` | ✅ | Atelier A3, Appliquer / Restaurer via safeWrite |
| V8.2 | Règles générateur d'eau (≤ 60 pts, tronçons, `Width`, `ReverseFlow`) | ✅ | Atelier `water.ts` (pas encore imposé à l'export du mode générateur) |
| V8.3 | Style satellite réaliste (arbres + ombres, routes par revêtement, toits) | 🟡 | Atelier A4 « réaliste » : revêtements, toits, forêts ; sans textures `.edds` ni ombres portées d'arbres |
| V8.3 | Quais/ports, murs/clôtures, talus/berges sur la carte | ✅ | Atelier A4 (talus = pente ≥ 30° rampe 10°, comme `talus.py`) ; routes depuis `.layer`, format ROAD du `.topo` non décodé |
| V8.3 | Config courbes de niveau `.conf` | ✅ | Atelier A5 |
| V8.x | Sécurité : refus si Workbench ouvert, SHA, `_originaux`, Restaurer | ✅ | `bridge/safewrite.mjs` + A6 ; écriture seulement via le relais (lecture seule en navigateur) |
| — | **Génération** relief, rivières, routes, villages, champs, forêts, électricité, bases, aérodromes, zones industrielles, monde aléatoire « une seed » | ⭐ | Rien de tout ça chez lui |
| — | Données réelles (Copernicus, IGN LiDAR, GeoTIFF, OSM) | ⭐ | |
| — | Envoi live vers Workbench + rapport envoyé/construit | ⭐ | Lui : fichiers seulement |
| — | Web, multiplateforme, collaboration temps réel, tour guidé, aide | ⭐ | Lui : desktop Windows mono-utilisateur |

---

## 3. Écarts de fond et implications d'architecture

**Ce qu'il fait et que nous ne faisons fondamentalement pas** : travailler **hors ligne sur les fichiers d'un projet
Workbench existant** (lire `.layer`, `.ent`, `.ttile`, `.topo`, `.emat/.edds`, General Info) et **réécrire** certains
d'entre eux en toute sécurité. Nous, nous **générons** puis **envoyons en live** via le pont (addon `Mapgenerator` +
NET API) ; notre seule lecture d'un monde existant passe par `GET /world` (hauteurs + matériaux), Workbench ouvert.

Implications :
1. **Accès fichiers depuis un navigateur** : File System Access API (`showDirectoryPicker`, Chrome/Edge) pour ouvrir
   le dossier d'un addon en lecture, et écrire avec permission. Firefox : repli « glisser un dossier » (lecture seule)
   + téléchargement d'un zip des fichiers corrigés. Alternative : endpoint fichiers dans notre serveur local
   (`collab`/bridge Node) — plus puissant (SHA, détection process Workbench) mais demande Node, déjà requis chez nous.
   **Recommandation : passer par le serveur local Node** pour l'écriture (seul moyen fiable de « refuser si Workbench
   ouvert » via `tasklist`), File System Access pour la lecture pure.
2. **Parseurs** à écrire en TS (workers) : `.layer`/`.ent` texte Enfusion à repères imbriqués (port de `layer_objets.py:73`),
   `.topo`, General Info, `.ttile` LRS2 en lecture (doc dans `docs/technical/`), `.edds` (décodage, plus tard).
3. **Deux sources de vérité** : mode live (Workbench = vérité, pont) et mode fichiers (disque = vérité, Workbench fermé).
   Le modèle interne (`Island`, routes, eau, objets) doit pouvoir être **alimenté depuis les fichiers** et non
   seulement par nos générateurs — c'est aussi le **round-trip** Workbench → mapper qui nous manque déjà.
4. **Écriture sûre** : module unique `safeWrite` (Workbench fermé ? SHA identique à la lecture ? backup `_originaux/`
   horodaté ; journal ; Restaurer) réutilisé par toute fonction qui écrit.
5. **Perf** : cartes 16-32 km, satmap 8192² → workers + OffscreenCanvas, rendu par tuiles ; pas de numpy/opencv :
   `fillPoly` sous-pixel, distance transform, hillshade à porter (simples).

---

## 4. Proposition : « Mode Atelier » (finition d'un projet existant)

### 4.1 Entrée
Nouvelle carte sur l'écran d'accueil, à côté de « Nouvelle île / Monde aléatoire / Lieu réel / Rejoindre / Ouvrir » :
**« 🛠️ Atelier — Ouvrir un projet Workbench existant »** · sous-titre « Diagnostiquer, corriger l'eau, faire la
carte en jeu. Pour une carte déjà sculptée. » · badge « avec les outils de Giorbev ».

### 4.2 Écrans (barre d'étapes propre au mode, mêmes codes ✓/ambre/gris que nos 7 étapes)
| # | Panneau | Contenu |
|---|---|---|
| A0 | **Projet** | Choisir le dossier addon, détecter le `.ent`/les `.layer`, coller General Info (ou le lire via le pont si connecté), état « Workbench ouvert / fermé », résumé (grille, tuiles, budget 5/7) |
| A1 | **Diagnostic** | Carte des tuiles colorée par budget QTRE, slots négligeables, recherche de texture, export CSV ; + nos contrôles (`validate.ts`) si routes lues |
| A2 | **Surfaces** | Masques par règles (biomes) et/ou depuis satellite (`satmask.ts`) ; aperçu ; export PNG ou envoi live |
| A3 | **Eau** | Eau « comme en jeu » superposée, liste des lacs/rivières en défaut (points, doublons, Width…), correction proposée, **Appliquer / Restaurer** |
| A4 | **Carte en jeu** | Styles Militaire / Satellite réaliste, couches (forêts, ports, murs, talus, routes, toits), légende FR/EN, 4k/8k, export + aide d'import |
| A5 | **Courbes** | Densité, majeures, largeurs → `.conf` téléchargeable + où le brancher (GameMode) |
| A6 | **Export** | Fichiers produits, journal des écritures/sauvegardes, archive projet (compatible `.mgp.zip` en import si possible) |

Passerelle : bouton « Continuer dans le générateur » (envoie le monde lu vers nos étapes 3-6 pour ajouter routes,
villages…) — c'est l'argument qui rend la fusion intéressante pour ses utilisateurs.

### 4.3 Maquette (pour une planche de design)
```
┌─ RM ▸ ATELIER ── projet: Zimnitrita (32×32 · 2 m/px · QTRE 5) ── Workbench: ● fermé ── FR|EN ── ? ─┐
│ [A0 Projet ✓][A1 Diagnostic ✓][A2 Surfaces ·][A3 Eau ⚠ 3][A4 Carte ·][A5 Courbes ·][A6 Export ·]  │
├───────────────┬──────────────────────────────────────────────────────────────┬─────────────────────┤
│ CALQUES       │                                                              │ INSPECTEUR          │
│ ☑ Relief      │                                                              │ Lac « Lake_04 »     │
│ ☑ Tuiles QTRE │            CARTE (canvas tuilé, zoom/pan habituels)          │ 182 pts  ✖ > 60     │
│ ☑ Eau en jeu  │     tuiles rouges = budget dépassé · eau bleue = calculée    │ 2 points doublons   │
│ ☐ Objets .layer│     contour orange = forme corrigée proposée                │ niveau 12,4 m       │
│ ☐ Fond carte  │                                                              │ [Voir correction]   │
│               │                                                              │ [Appliquer] [Ignorer]│
│ LÉGENDE       │                                                              │                     │
├───────────────┴──────────────────────────────────────────────────────────────┴─────────────────────┤
│ Journal : 14:02 Lake_04.layer sauvegardé → _originaux/2026-11-16_1402/  SHA ok  [Restaurer]   X Z Y │
└──────────────────────────────────────────────────────────────────────────────────────────────────────┘
```
Même habillage MILSPEC (encre sombre, ambre), même barre de statut X/Z/altitude.

### 4.4 Réutilisable chez nous
Shell d'étapes + états, canvas carte/zoom/pan, i18n, aide/tour, collab (commentaires épinglés = revue d'une carte
existante !), `satmask.ts`, `limitPerBlock`, `importWorld.ts`, `hydro.ts`/`water.ts` (géométrie eau), `validate.ts`,
fichier projet, pont live (lecture General Info/monde si Workbench ouvert).

### 4.5 À porter de son code MIT (avec en-tête « Portions © 2026 [otea] Giorbev — MIT » + `THIRD_PARTY_NOTICES`)
`layer_objets.py` (parseur `.layer`), `eau_layers.py` (`_lake` l.184, `_river` l.298, écriture l.494, garde-fous
l.558-624), règles TOPO_README §1/§5, `layer_vegetation.py`, `layer_port.py` + `mur_prefabs.py` + `quais.py`,
`talus.py`, `fond_militaire.py`/`fond_realiste.py`/`legende.py`, `tile_inspector.py` + `lrs2_parser.py`,
`clean_weights.py`, `terrain_algorithms.py`, `data/biomes/*.json`, `project_archive.py` (format `.mgp.zip`).

### 4.6 Feuille de route (petits pas, estimations pour un dev aidé par IA)
| Étape | Livrable | Effort |
|---|---|---|
| **Q1** (quick win) | Générateur de **`.conf` courbes de niveau** (formulaire → fichier + aide d'import) | 0,5 j |
| **Q2** (quick win) | **Règles eau Enfusion** dans notre validateur + export (≤ 60 pts, doublons, tronçons, Width, ReverseFlow) | 1 j |
| **Q3** (quick win) | Carte d'accueil Atelier + A0 en **lecture seule** (dossier, General Info, liste `.layer`) | 1-2 j |
| 1 | Parseur `.layer`/`.ent` TS (worker) + affichage objets/routes/eau lus | 2-3 j |
| 2 | A3 Eau « comme en jeu » (aperçu seul) | 2 j |
| 3 | `safeWrite` via serveur local (Workbench fermé, SHA, `_originaux`, Restaurer, journal) + A3 Appliquer | 2 j |
| 4 | A1 Diagnostic QTRE (lecture `.ttile`, carte par bloc, CSV) | 3-4 j |
| 5 | A5/A4 fond militaire (hillshade, forêts, routes, eau, légende) | 3-4 j |
| 6 | Ports/murs/talus sur fond + style Satellite réaliste | 4-5 j |
| 7 | A2 biomes + textures projet (`.emat`), satmap texturée (`.edds`) | 5+ j |
| 8 | Import `.mgp.zip` + passerelle « Continuer dans le générateur » | 2 j |

**Première version crédible pour lui (≈ 1 semaine)** : Q1 + Q2 + Q3 + étapes 1-3 → il voit son propre projet ouvert
dans le navigateur, l'eau calculée comme en jeu, les mêmes garde-fous que les siens, et un `.conf` de courbes —
c'est-à-dire **son savoir-faire repris fidèlement, crédité**, plus la passerelle vers la génération.

---

## 5. Pitch de collaboration

**Ce qu'on peut lui offrir** :
- **Crédit visible** : « Atelier — avec les outils de Giorbev » sur la carte d'accueil, page À propos, CHANGELOG, notices MIT conservées.
- **Ses modules comme « plugins »** : dossier `src/atelier/` (ou paquet séparé) dont il est propriétaire / CODEOWNER ; il garde la main sur l'eau, la carte en jeu, le diagnostic.
- **Gouvernance** : soit une **organisation GitHub commune** (ex. « reforger-mapping-tools ») avec les deux dépôts, soit **co-mainteneur** du nôtre ; MIT des deux côtés, pas de changement de licence.
- **Ce qu'il y gagne** : web multiplateforme sans installeur, collaboration/commentaires, envoi live Workbench, génération (routes, villages…) en amont de ses outils, i18n et aide déjà faits, des testeurs.
- **Ce qu'on ne lui demande pas** : abandonner MGP. Les deux peuvent coexister ; on vise d'abord l'**interopérabilité** (lire ses `.mgp.zip`, mêmes règles eau).

### Brouillon FR (à NE PAS envoyer sans relecture de Benji)
> Salut Giorbev,
> Je suis Benji, j'ai fait Reforger Mapper (outil web MIT qui génère une carte — relief, eau, routes, villages,
> champs — et l'envoie en live dans Workbench). J'ai lu Map Generator Pro de près : ton travail sur l'eau « comme en
> jeu », la carte en jeu, les courbes et le diagnostic QTRE est exactement ce qui nous manque, et nos outils sont
> complémentaires (toi l'aval, nous l'amont).
> Je te propose d'en faire un **mode « Atelier »** dans Reforger Mapper, crédité à ton nom, où tu gardes la main sur
> tes modules (co-mainteneur ou orga GitHub commune, au choix). Tes utilisateurs ne perdraient rien, et gagneraient
> le web, la collaboration et la génération. Ça te dirait d'en discuter ? Aucun engagement, et MGP reste le tien.
> Merci pour la doc, notamment le TOPO_README — elle nous a déjà beaucoup appris.

### Draft EN
> Hi Giorbev,
> I'm Benji, author of Reforger Mapper (an MIT web tool that generates a map — terrain, water, roads, villages,
> fields — and sends it live to the Workbench). I've studied Map Generator Pro closely: your "water as in game",
> in-game map, contour config and QTRE diagnostic are exactly what we lack, and our tools fit together (you finish
> maps, we start them).
> Would you be open to bringing them in as a **"Workshop" mode** inside Reforger Mapper, credited to you, with you
> owning those modules (co-maintainer or a shared GitHub org, your call)? Your users would lose nothing and gain the
> web, collaboration and generation. Happy to talk it over — no strings attached, MGP stays yours.
> Thanks for the docs, especially TOPO_README — we've already learned a lot from it.

## 4. Mode Atelier — reste à faire (2026-11-16)
- Slots négligeables du diagnostic et satmap texturée : demandent un décodeur `.edds` (DXT/BC) — non écrit.
- Format ROAD du `.topo` non décodé : les routes de la carte viennent des `.layer` (générateurs de routes).
- « Continuer dans le générateur » (passer le monde de l'Atelier au mode générateur) : bouton présent, désactivé.
- Auto-calibration et Metric Atlas : non portés.
- Application des biomes (écriture des masques) : non ; A2 ne fait que vérifier les textures.
